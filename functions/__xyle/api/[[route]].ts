import { authenticated, login, logoutCookie, sessionCookie, type Env } from "../../_auth";
import { deployCompleteSnapshot } from "../../_publish";
import { preparePreview, patchHtml } from "../../../src/html.ts";
import { computeSnapshotDigest, digestBytes } from "../../../src/manifest.ts";

type RuntimeEnv = Env & { ASSETS: { fetch(request: Request): Promise<Response> }; CLOUDFLARE_PROJECT?: string };

export const onRequest = async ({ request, env, params }: { request: Request; env: RuntimeEnv; params: { route?: string[] } }): Promise<Response> => {
  const route = params.route?.join("/") ?? "";
  if (route === "login" && request.method === "POST") {
    const body = await request.json().catch(() => null) as { key?: string } | null;
    const token = typeof body?.key === "string" ? await login(body.key, env) : null;
    return token ? Response.json({ ok: true }, { headers: { "set-cookie": sessionCookie(token) } }) : Response.json({ error: "invalid editor key" }, { status: 401 });
  }
  if (route === "session") return Response.json({ authenticated: await authenticated(request, env) });
  if ((route === "logout" || route === "publish") && (request.method !== "POST" || request.headers.get("x-xyle-request") !== "1" || request.headers.get("origin") !== new URL(request.url).origin)) return Response.json({ error: "mutation rejected" }, { status: 403 });
  if (route === "logout") return Response.json({ ok: true }, { headers: { "set-cookie": logoutCookie } });
  if (!await authenticated(request, env)) return Response.json({ error: "authentication required" }, { status: 401 });
  if (route === "manifest") {
    const url = new URL(request.url);
    url.pathname = "/_xyle/manifest.json";
    return env.ASSETS.fetch(new Request(url, { method: "GET" }));
  }
  if (route === "page") {
    const path = new URL(request.url).searchParams.get("path");
    if (!path || !path.startsWith("/") || path.includes("..") || !path.endsWith(".html")) return Response.json({ error: "unsafe page path" }, { status: 400 });
    const url = new URL(request.url);
    url.pathname = path;
    const response = await env.ASSETS.fetch(new Request(url, { method: "GET" }));
    if (!response.ok) return Response.json({ error: "page not found" }, { status: 404 });
    const manifestUrl = new URL(request.url);
    manifestUrl.pathname = "/_xyle/manifest.json";
    const manifest = await (await env.ASSETS.fetch(new Request(manifestUrl))).json() as { files: Record<string, { digest: string }> };
    const entry = manifest.files[path];
    if (!entry) return Response.json({ error: "page not in manifest" }, { status: 404 });
    const prepared = preparePreview(await response.text(), path, url.origin);
    return Response.json({ pagePath: path, baseDigest: entry.digest, html: prepared.html, nodes: [...prepared.nodes.values()] });
  }
  if (route === "publish" && request.method === "POST") {
    const form = await request.formData();
    const raw = form.get("metadata");
    if (typeof raw !== "string") return Response.json({ error: "missing metadata" }, { status: 400 });
    const metadata = JSON.parse(raw) as { pages?: Array<{ pagePath: string; baseDigest: string; operations: Parameters<typeof patchHtml>[1]["operations"] }> };
    const manifestUrl = new URL(request.url);
    manifestUrl.pathname = "/_xyle/manifest.json";
    const current = await (await env.ASSETS.fetch(new Request(manifestUrl))).json() as { files: Record<string, { digest: string; size: number; contentType: string }>; snapshotDigest: string };
    const files: Array<{ path: string; bytes: Uint8Array; contentType: string }> = [];
    for (const [path, entry] of Object.entries(current.files)) {
      const assetUrl = new URL(request.url);
      assetUrl.pathname = path;
      const response = await env.ASSETS.fetch(new Request(assetUrl));
      if (!response.ok) return Response.json({ error: `snapshot asset unavailable: ${path}` }, { status: 409 });
      files.push({ path, bytes: new Uint8Array(await response.arrayBuffer()), contentType: entry.contentType });
    }
    const byPath = new Map(files.map((file) => [file.path, file]));
    for (const page of metadata.pages ?? []) {
      const file = byPath.get(page.pagePath);
      const entry = current.files[page.pagePath];
      if (!file || !entry || entry.digest !== page.baseDigest) return Response.json({ error: "stale-site" }, { status: 409 });
      file.bytes = await patchHtml(file.bytes, { pagePath: page.pagePath, baseDigest: page.baseDigest, operations: page.operations });
    }
    const nextFiles = Object.entries(current.files).map(([path, entry]) => ({ path, bytes: byPath.get(path)!.bytes, contentType: entry.contentType }));
    const nextEntries: typeof current.files = {};
    for (const file of nextFiles) nextEntries[file.path] = { digest: await digestBytes(file.bytes), size: file.bytes.byteLength, contentType: file.contentType };
    const nextManifest = { version: 1 as const, snapshotDigest: await computeSnapshotDigest(nextEntries), files: nextEntries };
    try {
      const deployment = await deployCompleteSnapshot(env, [...nextFiles, { path: "/_xyle/manifest.json", bytes: new TextEncoder().encode(JSON.stringify(nextManifest, null, 2)), contentType: "application/json" }], new URL(request.url).origin);
      return Response.json({ snapshotDigest: nextManifest.snapshotDigest, publishId: deployment });
    } catch (error) {
      return Response.json({ error: (error as Error).message }, { status: 502 });
    }
  }
  return Response.json({ error: "not found" }, { status: 404 });
};
