import { authenticated, login, logoutCookie, sessionCookie, type Env } from "../../_auth";
import {
  deployCompleteSnapshot,
  materializeHostedMediaOperations,
} from "../../_publish";
import { preparePreview, patchHtml } from "../../../src/html.ts";
import { discoverMedia, uploadPathFor, validateUpload } from "../../../src/media.ts";
import { computeSnapshotDigest, digestBytes } from "../../../src/digest.ts";
import { LAYOUT_CSS, layoutAssetPath } from "../../../src/layout.ts";
import type { ManifestFile, PageOperation, XyleDigest } from "../../../src/types.ts";

type RuntimeEnv = Env & {
  ASSETS: { fetch(request: Request): Promise<Response> };
  CLOUDFLARE_PROJECT?: string;
  IMAGES?: import("../../_publish").CloudflareImagesBinding;
};
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

function isLayoutNeeded(source: string, operations: PageOperation[]): boolean {
  const managedAttributeCount =
    source.match(/data-xyle-layout\s*=\s*(?:"(?:stack|split)"|'(?:stack|split)'|(?:stack|split))/g)
      ?.length ?? 0;
  const overrides = new Map<string, boolean>();
  const visit = (nested: PageOperation[]): void => {
    for (const operation of nested) {
      if (operation.type === "setLayoutPreset") {
        overrides.set(operation.nodeId, operation.preset !== operation.baseline);
      } else if (operation.type === "duplicateSection") {
        visit([...operation.snapshotOperations, ...(operation.createdOperations ?? [])]);
      }
    }
  };
  visit(operations);
  return (
    [...overrides.values()].some(Boolean) ||
    managedAttributeCount > [...overrides.values()].filter((value) => !value).length
  );
}

function cspPermits(source: string, policies: string[], origin: string): boolean {
  for (const tag of source.match(/<meta\b[^>]*>/gi) ?? []) {
    const httpEquiv = /http-equiv\s*=\s*["']?([^"'\s>]+)/i.exec(tag)?.[1];
    if (httpEquiv?.toLowerCase() !== "content-security-policy") continue;
    const content = /content\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
    if (content) policies.push(content);
  }
  return policies.every((policy) => {
    const directives = new Map<string, string[]>();
    for (const directive of policy.split(";")) {
      const [name, ...values] = directive.trim().split(/\s+/);
      if (name) directives.set(name.toLowerCase(), values);
    }
    const sources =
      directives.get("style-src-elem") ?? directives.get("style-src") ?? directives.get("default-src");
    if (!sources || sources.length === 0) return true;
    if (sources.includes("'none'")) return false;
    if (sources.some((value) => value.startsWith("'nonce-") || value.startsWith("'sha"))) return false;
    return sources.some((value) => {
      if (value === "'self'") return true;
      try {
        return new URL(value).origin === origin;
      } catch {
        return false;
      }
    });
  });
}

export const onRequest = async ({ request, env, params }: { request: Request; env: RuntimeEnv; params: { route?: string[] } }): Promise<Response> => {
  try {
    const route = params.route?.join("/") ?? "";
  if (route === "login" && request.method === "POST") {
    const body = await request.json().catch(() => null) as { key?: string } | null;
    const token = typeof body?.key === "string" ? await login(body.key, env) : null;
    return token ? Response.json({ ok: true }, { headers: { "set-cookie": sessionCookie(token) } }) : Response.json({ error: "invalid editor key" }, { status: 401 });
  }
  if (route === "session") {
    return Response.json(
      { authenticated: await authenticated(request, env) },
      { headers: { "x-xyle-runtime": "1" } },
    );
  }
  if (route === "manifest.json" || route.startsWith("assets/")) {
    const assetUrl = new URL(request.url);
    assetUrl.pathname = `/__xyle/${route}`;
    return env.ASSETS.fetch(new Request(assetUrl, { method: request.method }));
  }
  if ((route === "logout" || route === "publish") && (request.method !== "POST" || request.headers.get("x-xyle-request") !== "1" || request.headers.get("origin") !== new URL(request.url).origin)) return Response.json({ error: "mutation rejected" }, { status: 403 });
  if (route === "logout" && !request.headers.get("content-type")?.includes("application/json")) return Response.json({ error: "unsupported content type" }, { status: 415 });
  if (!await authenticated(request, env)) return Response.json({ error: "authentication required" }, { status: 401 });
  if (route === "logout") return Response.json({ ok: true }, { headers: { "set-cookie": logoutCookie } });
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
    return Response.json({ pagePath: path, baseDigest: entry.digest, html: prepared.html, nodes: [...prepared.nodes.values()], groups: prepared.groups, layouts: prepared.layouts });
  }
  if (route === "media") {
    const manifestUrl = new URL(request.url);
    manifestUrl.pathname = "/_xyle/manifest.json";
    const manifest = await (await env.ASSETS.fetch(new Request(manifestUrl, { method: "GET" }))).json() as { files: Record<string, ManifestFile> };
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
    if (!request.headers.get("content-type")?.includes("multipart/form-data")) {
      return Response.json({ error: "unsupported content type" }, { status: 415 });
    }
    const length = Number(request.headers.get("content-length") ?? "0");
    if (!Number.isSafeInteger(length) || length > MAX_UPLOAD_BYTES + 1024 * 1024) return Response.json({ error: "request too large" }, { status: 413 });
    const form = await request.formData().catch(() => null);
    if (!form) return Response.json({ error: "invalid multipart body" }, { status: 400 });
    const raw = form.get("metadata");
    if (typeof raw !== "string") return Response.json({ error: "missing metadata" }, { status: 400 });
    let metadata: {
      baseSnapshotDigest?: string;
      pages?: Array<{
        pagePath: string;
        baseDigest: string;
        operations: Parameters<typeof patchHtml>[1]["operations"];
      }>;
    };
    try {
      metadata = JSON.parse(raw) as typeof metadata;
    } catch {
      return Response.json({ error: "invalid metadata JSON" }, { status: 400 });
    }
    if (!Array.isArray(metadata.pages) || metadata.pages.length > 100) {
      return Response.json({ error: "invalid publish metadata" }, { status: 400 });
    }
    const manifestUrl = new URL(request.url);
    manifestUrl.pathname = "/_xyle/manifest.json";
    // SAFETY: the manifest was produced by Xyle's staged deployment; malformed values are rejected below.
    const current = await (await env.ASSETS.fetch(new Request(manifestUrl))).json() as { files: Record<string, ManifestFile>; snapshotDigest: XyleDigest };
    if (metadata.baseSnapshotDigest !== current.snapshotDigest) {
      return Response.json({ error: "stale-site", currentSnapshotDigest: current.snapshotDigest }, { status: 409 });
    }
    const uploads: Array<{ path: string; bytes: Uint8Array; contentType: string }> = [];
    let uploadBytes = 0;
    for (const [path, value] of form.entries()) {
      if (!(value instanceof File)) continue;
      if (!path.startsWith("/__media/")) return Response.json({ error: "invalid upload path" }, { status: 400 });
      const bytes = new Uint8Array(await value.arrayBuffer());
      uploadBytes += bytes.byteLength;
      if (uploadBytes > MAX_UPLOAD_BYTES) return Response.json({ error: "uploads too large" }, { status: 413 });
      const validation = validateUpload(value.name, bytes);
      if (!validation.ok) return Response.json({ error: `upload rejected: ${validation.reason}` }, { status: 400 });
      const expectedPath = await uploadPathFor(bytes, validation.contentType);
      if (expectedPath !== path) return Response.json({ error: "upload path mismatch" }, { status: 400 });
      const existing = current.files[path];
      const digest = await digestBytes(bytes);
      if (existing && (existing.digest !== digest || existing.contentType !== validation.contentType)) {
        return Response.json({ error: "upload path collision" }, { status: 409 });
      }
      if (!existing) uploads.push({ path, bytes, contentType: validation.contentType });
    }
    const files: Array<{ path: string; bytes: Uint8Array; contentType: string }> = [];
    for (const [path, entry] of Object.entries(current.files)) {
      const assetUrl = new URL(request.url);
      assetUrl.pathname = path;
      const response = await env.ASSETS.fetch(new Request(assetUrl));
      if (!response.ok) return Response.json({ error: `snapshot asset unavailable: ${path}` }, { status: 409 });
      files.push({ path, bytes: new Uint8Array(await response.arrayBuffer()), contentType: entry.contentType });
    }
    const byPath = new Map(files.map((file) => [file.path, file]));
    for (const upload of uploads) byPath.set(upload.path, upload);
    const submitted = new Map(uploads.map((upload) => [upload.path, upload.bytes]));
    const layoutCssBytes = new TextEncoder().encode(LAYOUT_CSS);
    const layoutCssDigest = await digestBytes(layoutCssBytes);
    const layoutCssPath = layoutAssetPath(layoutCssDigest);
    const layoutRequired =
      [...byPath.values()].some(
        (file) => file.contentType === "text/html" && /data-xyle-layout="(?:stack|split)"/.test(new TextDecoder().decode(file.bytes)),
      ) ||
      (metadata.pages ?? []).some((page) => {
        const file = byPath.get(page.pagePath);
        return !!file && isLayoutNeeded(new TextDecoder().decode(file.bytes), page.operations);
      });
    if (layoutRequired) {
      const existing = byPath.get(layoutCssPath);
      if (!existing || existing.bytes.length !== layoutCssBytes.length) {
        byPath.set(layoutCssPath, { path: layoutCssPath, bytes: layoutCssBytes, contentType: "text/css" });
      }
    }
    for (const page of metadata.pages ?? []) {
      const file = byPath.get(page.pagePath);
      const entry = current.files[page.pagePath];
      if (!file || !entry || entry.digest !== page.baseDigest) return Response.json({ error: "stale-site" }, { status: 409 });
      const materialized = await materializeHostedMediaOperations(
        env,
        request.url,
        page.operations,
        byPath,
        submitted,
      );
      for (const asset of materialized.assets) byPath.set(asset.path, asset);
      const pageSource = new TextDecoder().decode(file.bytes);
      const pageNeedsLayout = isLayoutNeeded(pageSource, materialized.operations);
      if (pageNeedsLayout) {
        const pageUrl = new URL(page.pagePath, request.url);
        const pageResponse = await env.ASSETS.fetch(new Request(pageUrl));
        const policy = pageResponse.headers.get("content-security-policy");
        if (!cspPermits(pageSource, policy ? [policy] : [], pageUrl.origin)) {
          return Response.json({ error: `managed Layout stylesheet is blocked by CSP for ${page.pagePath}` }, { status: 400 });
        }
      }
      file.bytes = await patchHtml(
        file.bytes,
        { pagePath: page.pagePath, baseDigest: page.baseDigest, operations: materialized.operations },
        {
          layoutAssetRequired: pageNeedsLayout,
          ...(pageNeedsLayout ? { layoutAssetHref: `/__xyle/assets/${layoutCssPath.split("/").at(-1)}` } : {}),
        },
      );
    }
    for (const path of [...byPath.keys()]) {
      if (path.startsWith("/__xyle/assets/layout-v1.") && (!layoutRequired || path !== layoutCssPath)) byPath.delete(path);
    }
    if (layoutRequired) {
      byPath.set("/__xyle/manifest.json", {
        path: "/__xyle/manifest.json",
        bytes: new TextEncoder().encode(
          JSON.stringify({
            version: 1,
            assets: {
              [layoutCssPath]: {
                digest: layoutCssDigest,
                size: layoutCssBytes.byteLength,
                contentType: "text/css",
              },
            },
          }, null, 2),
        ),
        contentType: "application/json",
      });
    } else {
      byPath.delete("/__xyle/manifest.json");
    }
    const nextFiles = [...byPath.values()];
    const nextEntries: typeof current.files = {};
    for (const file of nextFiles) {
      if (file.path === "/__xyle/manifest.json") continue;
      nextEntries[file.path] = { digest: await digestBytes(file.bytes), size: file.bytes.byteLength, contentType: file.contentType };
    }
    const nextManifest = { version: 1 as const, snapshotDigest: await computeSnapshotDigest(nextEntries), files: nextEntries };
    try {
      const deployment = await deployCompleteSnapshot(env, [...nextFiles, { path: "/_xyle/manifest.json", bytes: new TextEncoder().encode(JSON.stringify(nextManifest, null, 2)), contentType: "application/json" }]);
      return Response.json({ snapshotDigest: nextManifest.snapshotDigest, publishId: deployment });
    } catch (error) {
      return Response.json({ error: (error as Error).message }, { status: 502 });
    }
  }
    return Response.json({ error: "not found" }, { status: 404 });
  } catch {
    return Response.json({ error: "internal error" }, { status: 500 });
  }
};
