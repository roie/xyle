import {
  authenticated,
  constantTimeEqual,
  login,
  logoutCookie,
  sessionCookie,
  type Env,
} from "../../_auth";
import { handleHostedPublish, type HostedPublishEnv } from "../../_publish-route";
import { preparePreview } from "../../../src/html.ts";
import { discoverMedia } from "../../../src/media.ts";
import type { ManifestFile } from "../../../src/types.ts";

type RuntimeEnv = HostedPublishEnv &
  Env & {
    XYLE_MANAGEMENT_SECRET?: string;
  };
export const onRequest = async ({
  request,
  env,
  params,
}: {
  request: Request;
  env: RuntimeEnv;
  params: { route?: string[] };
}): Promise<Response> => {
  try {
    const route = params.route?.join("/") ?? "";
    if (route === "managed-manifest") {
      const supplied = request.headers.get("x-xyle-management-secret") ?? "";
      if (
        request.method !== "GET" ||
        !env.XYLE_MANAGEMENT_SECRET ||
        !constantTimeEqual(supplied, env.XYLE_MANAGEMENT_SECRET)
      ) {
        return Response.json({ error: "authentication required" }, { status: 401 });
      }
      const manifestUrl = new URL(request.url);
      manifestUrl.pathname = "/_xyle/manifest.json";
      const response = await env.ASSETS.fetch(new Request(manifestUrl, { method: "GET" }));
      const headers = new Headers(response.headers);
      headers.set("cache-control", "no-store");
      return new Response(response.body, { status: response.status, headers });
    }
    if (route === "login" && request.method === "POST") {
      const body = (await request.json().catch(() => null)) as {
        key?: string;
      } | null;
      const token = typeof body?.key === "string" ? await login(body.key, env) : null;
      return token
        ? Response.json({ ok: true }, { headers: { "set-cookie": sessionCookie(token) } })
        : Response.json({ error: "invalid editor key" }, { status: 401 });
    }
    if (route === "session") {
      return Response.json(
        { authenticated: await authenticated(request, env) },
        { headers: { "x-xyle-runtime": "1" } },
      );
    }
    if (route === "manifest.json" || route.startsWith("assets/")) {
      const assetUrl = new URL(request.url);
      assetUrl.pathname = route === "assets/editor.js" ? "/_xyle/editor.js" : `/__xyle/${route}`;
      return env.ASSETS.fetch(new Request(assetUrl, { method: request.method }));
    }
    if (
      (route === "logout" || route === "publish") &&
      (request.method !== "POST" ||
        request.headers.get("x-xyle-request") !== "1" ||
        request.headers.get("origin") !== new URL(request.url).origin)
    )
      return Response.json({ error: "mutation rejected" }, { status: 403 });
    if (route === "logout" && !request.headers.get("content-type")?.includes("application/json"))
      return Response.json({ error: "unsupported content type" }, { status: 415 });
    if (!(await authenticated(request, env)))
      return Response.json({ error: "authentication required" }, { status: 401 });
    if (route === "logout")
      return Response.json({ ok: true }, { headers: { "set-cookie": logoutCookie } });
    if (route === "manifest") {
      const url = new URL(request.url);
      url.pathname = "/_xyle/manifest.json";
      return env.ASSETS.fetch(new Request(url, { method: "GET" }));
    }
    if (route === "page") {
      const path = new URL(request.url).searchParams.get("path");
      if (!path || !path.startsWith("/") || path.includes("..") || !path.endsWith(".html"))
        return Response.json({ error: "unsafe page path" }, { status: 400 });
      const url = new URL(request.url);
      url.pathname = path;
      const response = await env.ASSETS.fetch(new Request(url, { method: "GET" }));
      if (!response.ok) return Response.json({ error: "page not found" }, { status: 404 });
      const manifestUrl = new URL(request.url);
      manifestUrl.pathname = "/_xyle/manifest.json";
      const manifest = (await (await env.ASSETS.fetch(new Request(manifestUrl))).json()) as {
        files: Record<string, { digest: string }>;
      };
      const entry = manifest.files[path];
      if (!entry) return Response.json({ error: "page not in manifest" }, { status: 404 });
      const prepared = preparePreview(await response.text(), path, url.origin);
      return Response.json({
        pagePath: path,
        baseDigest: entry.digest,
        html: prepared.html,
        nodes: [...prepared.nodes.values()],
        groups: prepared.groups,
        layouts: prepared.layouts,
      });
    }
    if (route === "media") {
      const manifestUrl = new URL(request.url);
      manifestUrl.pathname = "/_xyle/manifest.json";
      const manifest = (await (
        await env.ASSETS.fetch(new Request(manifestUrl, { method: "GET" }))
      ).json()) as { files: Record<string, ManifestFile> };
      const sources = new Map<string, string>();
      for (const [path, entry] of Object.entries(manifest.files)) {
        if (entry.contentType !== "text/html") continue;
        const pageUrl = new URL(request.url);
        pageUrl.pathname = path;
        const page = await env.ASSETS.fetch(new Request(pageUrl, { method: "GET" }));
        if (page.ok) sources.set(path, await page.text());
      }
      return Response.json(discoverMedia(manifest as Parameters<typeof discoverMedia>[0], sources));
    }
    if (route === "publish" && request.method === "POST") {
      return await handleHostedPublish(request, env);
    }
    return Response.json({ error: "not found" }, { status: 404 });
  } catch {
    return Response.json({ error: "internal error" }, { status: 500 });
  }
};
