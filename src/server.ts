import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import type { AuthConfig } from "./auth.ts";
import { createSessionCookie, logoutCookie, verifyEditorKey, verifySessionCookie } from "./auth.ts";
import { computeSnapshotDigest, digestBytes, normalizeSitePath } from "./manifest.ts";
import { preparePreview, patchHtml } from "./html.ts";
import { discoverMedia, validateUpload, uploadPathFor } from "./media.ts";
import type { Publisher, SiteFile, XyleManifest, XyleDigest } from "./types.ts";

export interface RuntimeContext {
  root: string;
  publicBaseUrl: string;
  publisher: Publisher;
  auth: AuthConfig;
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });
}

function htmlResponse(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

export class HttpError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(String(status));
    this.status = status;
    this.body = body;
  }
}

async function requireSession(request: Request, context: RuntimeContext): Promise<void> {
  const ok = await verifySessionCookie(
    request.headers.get("cookie"),
    context.auth.sessionSecret,
    Date.now(),
  );
  if (!ok) throw new HttpError(401, { error: "authentication required" });
}

function assertMutationAllowed(request: Request, context: RuntimeContext): void {
  const origin = request.headers.get("origin");
  if (origin !== context.publicBaseUrl) {
    throw new HttpError(403, { error: "cross-origin mutation rejected" });
  }
  if (request.headers.get("x-xyle-request") !== "1") {
    throw new HttpError(403, { error: "missing mutation header" });
  }
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data") && !contentType.includes("application/json")) {
    throw new HttpError(415, { error: "unsupported content type" });
  }
}

async function serveStatic(context: RuntimeContext, pathname: string): Promise<Response> {
  let sitePath: string;
  try {
    sitePath = normalizeSitePath(pathname);
  } catch {
    return new Response("forbidden", { status: 403 });
  }
  if (sitePath.endsWith("/")) sitePath += "index.html";
  try {
    const bytes = await readFile(join(context.root, sitePath));
    const type = MIME_TYPES[extname(sitePath).toLowerCase()] ?? "application/octet-stream";
    return new Response(bytes as unknown as BodyInit, {
      headers: { "content-type": type, "cache-control": "no-cache" },
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
}

const LOGIN_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Xyle — Sign in</title><style>
body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f6f5f2;color:#1d2733}
form{display:grid;gap:.75rem;padding:2rem;background:#fff;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.08);min-width:20rem}
input{padding:.55em .7em;font:inherit;border:1px solid #ccc;border-radius:6px}
button{padding:.55em;font:inherit;background:#0f6ea8;color:#fff;border:0;border-radius:6px;cursor:pointer}
label{font-weight:600;font-size:.9rem}
p{color:#b3261e;font-size:.85rem;min-height:1em;margin:0}
</style></head><body>
<form id="login">
<label for="key">Editor key</label>
<input id="key" name="key" type="password" autofocus autocomplete="current-password">
<p id="err"></p>
<button type="submit">Sign in</button>
</form>
<script type="module">
const form = document.getElementById("login");
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const key = document.getElementById("key").value;
  const res = await fetch("/__xyle/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key }),
  });
  if (res.ok) location.reload();
  else document.getElementById("err").textContent = "That key was not accepted.";
});
</script></body></html>`;

function editorShellPage(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Xyle Editor</title><style>html,body{margin:0;height:100%}</style></head>
<body><div id="xyle-root"></div>
<script type="module" src="/__xyle/editor.js"></script></body></html>`;
}

interface PublishMetadata {
  baseSnapshotDigest: XyleDigest;
  pages: {
    pagePath: string;
    baseDigest: XyleDigest;
    operations: Parameters<typeof patchHtml>[1]["operations"];
  }[];
}

async function handlePublish(request: Request, context: RuntimeContext): Promise<Response> {
  await requireSession(request, context);
  assertMutationAllowed(request, context);

  const form = await request.formData();
  const metadataRaw = form.get("metadata");
  if (typeof metadataRaw !== "string") {
    return json({ error: "missing metadata part" }, 400);
  }
  let metadata: PublishMetadata;
  try {
    metadata = JSON.parse(metadataRaw) as PublishMetadata;
  } catch {
    return json({ error: "invalid metadata JSON" }, 400);
  }

  // re-read current snapshot for conflict detection
  const current = await context.publisher.readSnapshot();
  if (current.snapshotDigest !== metadata.baseSnapshotDigest) {
    return json(
      {
        error: "stale-site",
        message:
          "The published site changed after this editing session started. Discard or reload before publishing.",
        currentSnapshotDigest: current.snapshotDigest,
      },
      409,
    );
  }

  const changedFiles: SiteFile[] = [];
  const updatedEntries: Record<string, { digest: XyleDigest; size: number; contentType: string }> =
    {};

  for (const change of metadata.pages) {
    let pagePath: string;
    try {
      pagePath = normalizeSitePath(change.pagePath);
    } catch {
      return json({ error: `bad page path ${change.pagePath}` }, 400);
    }
    const entry = current.manifest.files[pagePath];
    if (!entry || entry.contentType !== "text/html") {
      return json({ error: `page not editable: ${pagePath}` }, 400);
    }
    const bytes = new Uint8Array(await readFile(join(context.root, pagePath)));
    let patched: Uint8Array;
    try {
      patched = await patchHtml(bytes, {
        pagePath,
        baseDigest: change.baseDigest,
        operations: change.operations,
      });
    } catch (error) {
      return json({ error: `patch failed for ${pagePath}: ${(error as Error).message}` }, 400);
    }
    const patchedDigest = await digestBytes(patched);
    changedFiles.push({
      path: pagePath,
      bytes: patched,
      digest: patchedDigest,
      contentType: "text/html",
    });
    updatedEntries[pagePath] = {
      digest: patchedDigest,
      size: patched.byteLength,
      contentType: "text/html",
    };
  }

  const addedFiles: SiteFile[] = [];
  for (const [name, value] of form.entries()) {
    if (!(value instanceof File) || !name.startsWith("/__media/")) continue;
    const bytes = new Uint8Array(await value.arrayBuffer());
    const validation = validateUpload(value.name, bytes);
    if (!validation.ok) {
      return json({ error: `upload rejected: ${validation.reason}` }, 400);
    }
    const digest = await digestBytes(bytes);
    // never trust the submitted path; recompute the content-derived destination
    const path = await uploadPathFor(bytes, validation.contentType);
    if (path !== name) {
      return json({ error: "upload path mismatch" }, 400);
    }
    const existing = current.manifest.files[path];
    if (!existing || existing.digest !== digest) {
      addedFiles.push({ path, bytes, digest, contentType: validation.contentType });
      updatedEntries[path] = {
        digest,
        size: bytes.byteLength,
        contentType: validation.contentType,
      };
    }
  }

  const manifestFiles: XyleManifest["files"] = { ...current.manifest.files };
  for (const [path, entry] of Object.entries(updatedEntries)) {
    manifestFiles[path] = entry;
  }
  const manifest: XyleManifest = {
    version: 1,
    snapshotDigest: await computeSnapshotDigest(manifestFiles),
    files: manifestFiles,
  };

  const result = await context.publisher.publish({
    baseSnapshotDigest: current.snapshotDigest,
    manifest,
    changedFiles,
    addedFiles,
  });

  return json({
    snapshotDigest: result.snapshot.snapshotDigest,
    publishId: result.id,
    changedPages: changedFiles.map((f) => f.path),
    addedAssets: addedFiles.map((f) => f.path),
  });
}

async function loadEditorBundle(): Promise<Response | null> {
  try {
    const bundle = await readFile(new URL("../dist/editor.js", import.meta.url));
    return new Response(bundle as unknown as BodyInit, {
      headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" },
    });
  } catch {
    return null;
  }
}

export function createXyleHandler(
  context: RuntimeContext,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const pathname = url.pathname;

    try {
      if (pathname === "/edit") {
        const authenticated = await verifySessionCookie(
          request.headers.get("cookie"),
          context.auth.sessionSecret,
          Date.now(),
        );
        return authenticated ? htmlResponse(editorShellPage()) : htmlResponse(LOGIN_PAGE);
      }

      if (pathname === "/__xyle/editor.js") {
        const bundle = await loadEditorBundle();
        if (!bundle)
          return new Response("// editor bundle missing; run pnpm build", { status: 503 });
        return bundle;
      }

      if (pathname === "/__xyle/api/login" && request.method === "POST") {
        const body = (await request.json().catch(() => null)) as { key?: string } | null;
        const valid =
          typeof body?.key === "string" &&
          (await verifyEditorKey(body.key, context.auth.editorKeyDigest));
        if (!valid) {
          // slow brute force slightly
          await new Promise((r) => setTimeout(r, 300));
          return json({ error: "invalid editor key" }, 401);
        }
        const cookie = await createSessionCookie(
          context.auth.sessionSecret,
          Date.now(),
          context.auth.sessionMaxAgeSeconds ?? 8 * 60 * 60,
        );
        return json({ ok: true }, 200, { "set-cookie": cookie });
      }

      if (pathname === "/__xyle/api/logout" && request.method === "POST") {
        return json({ ok: true }, 200, { "set-cookie": logoutCookie() });
      }

      if (pathname === "/__xyle/api/session") {
        const authenticated = await verifySessionCookie(
          request.headers.get("cookie"),
          context.auth.sessionSecret,
          Date.now(),
        );
        return json({ authenticated });
      }

      if (pathname === "/__xyle/api/manifest") {
        await requireSession(request, context);
        const snapshot = await context.publisher.readSnapshot();
        return json(snapshot.manifest);
      }

      if (pathname === "/__xyle/api/page") {
        await requireSession(request, context);
        const requested = url.searchParams.get("path");
        if (!requested) return json({ error: "missing path" }, 400);
        let sitePath: string;
        try {
          sitePath = normalizeSitePath(requested).replace(/\/$/, "") || "/";
        } catch {
          return json({ error: "unsafe path" }, 400);
        }
        if (sitePath.endsWith("/")) sitePath += "index.html";
        const snapshot = await context.publisher.readSnapshot();
        const file = snapshot.manifest.files[sitePath];
        if (!file || file.contentType !== "text/html") {
          return json({ error: "not an editable page" }, 404);
        }
        const source = await readFile(join(context.root, sitePath), "utf8");
        const prepared = preparePreview(source, sitePath, context.publicBaseUrl);
        return json({
          pagePath: sitePath,
          baseDigest: file.digest,
          html: prepared.html,
          nodes: [...prepared.nodes.values()],
        });
      }

      if (pathname === "/__xyle/api/media") {
        await requireSession(request, context);
        const snapshot = await context.publisher.readSnapshot();
        const sources = new Map<string, string>();
        for (const [path, file] of Object.entries(snapshot.manifest.files)) {
          if (file.contentType !== "text/html") continue;
          try {
            sources.set(path, await readFile(join(context.root, path), "utf8"));
          } catch {
            // unreadable page contributes no usage info
          }
        }
        return json(discoverMedia(snapshot.manifest, sources));
      }

      if (pathname === "/__xyle/api/publish" && request.method === "POST") {
        return await handlePublish(request, context);
      }

      if (pathname.startsWith("/__xyle/") || pathname === "/_xyle/manifest.json") {
        return json({ error: "reserved path" }, 404);
      }

      return await serveStatic(context, pathname);
    } catch (error) {
      if (error instanceof HttpError) {
        return json(error.body, error.status);
      }
      return json({ error: "internal error" }, 500);
    }
  };
}
