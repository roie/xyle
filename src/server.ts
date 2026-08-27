import { readFile, realpath } from "node:fs/promises";
import { extname, resolve } from "node:path";
import type { AuthConfig } from "./auth.ts";
import { createSessionCookie, logoutCookie, verifyEditorKey, verifySessionCookie } from "./auth.ts";
import { computeSnapshotDigest, digestBytes, normalizeSitePath } from "./manifest.ts";
import { isControlSitePath, isPathInsideRoot } from "./control-paths.ts";
import { preparePreview, patchHtml } from "./html.ts";
import { discoverMedia, MAX_UPLOAD_BYTES, validateUpload, uploadPathFor } from "./media.ts";
import type { Publisher, SiteFile, XyleManifest, XyleDigest } from "./types.ts";

export interface RuntimeContext {
  root: string;
  publicBaseUrl: string;
  publisher: Publisher;
  auth: AuthConfig;
  ignorePaths?: string[];
  ignoreSelectors?: string[];
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

function isIgnoredPath(sitePath: string, ignorePaths: string[] = []): boolean {
  return ignorePaths.some((configured) => {
    try {
      const normalized = normalizeSitePath(configured);
      return normalized === "/" || sitePath === normalized || sitePath.startsWith(`${normalized}/`);
    } catch {
      return false;
    }
  });
}

async function readSiteFile(root: string, sitePath: string): Promise<Uint8Array> {
  if (isControlSitePath(sitePath)) throw new HttpError(404, { error: "reserved path" });
  const rootReal = await realpath(root);
  const target = resolve(root, `.${sitePath}`);
  const targetReal = await realpath(target);
  if (!isPathInsideRoot(rootReal, targetReal))
    throw new HttpError(403, { error: "path escapes static root" });
  return new Uint8Array(await readFile(targetReal));
}

async function serveStatic(context: RuntimeContext, pathname: string): Promise<Response> {
  const directoryRequest = pathname.endsWith("/");
  let sitePath: string;
  try {
    sitePath = normalizeSitePath(pathname);
  } catch {
    return new Response("forbidden", { status: 403 });
  }
  if (directoryRequest) sitePath = `${sitePath === "/" ? "" : sitePath}/index.html`;
  if (isControlSitePath(sitePath)) return new Response("not found", { status: 404 });
  try {
    const bytes = await readSiteFile(context.root, sitePath);
    const type = MIME_TYPES[extname(sitePath).toLowerCase()] ?? "application/octet-stream";
    // SAFETY: Node's Uint8Array is accepted by the Fetch BodyInit implementation.
    return new Response(bytes as unknown as BodyInit, {
      headers: { "content-type": type, "cache-control": "no-cache" },
    });
  } catch (error) {
    return new Response("not found", { status: error instanceof HttpError ? error.status : 404 });
  }
}

const LOGIN_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Xyle — Sign in</title><style>
:root{color-scheme:dark;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#101311;color:#e7ebe8}
*{box-sizing:border-box}
body{display:grid;place-items:center;min-height:100svh;margin:0;padding:1rem;background:#101311}
main{width:min(100%,26rem)}
.xyle-mark{display:inline-flex;align-items:center;gap:.65rem;margin-bottom:1.5rem;color:#f2f3ef;font-size:.83rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
.xyle-mark svg{width:1.75rem;height:1.75rem;padding:.35rem;border:1px solid #667a6166;border-radius:6px;background:#667a6126;color:#a1b69a;stroke:currentColor;stroke-width:1.8;fill:none}
form{display:grid;gap:1.15rem;padding:clamp(1.25rem,7vw,2rem);border:1px solid #2b342e;border-radius:12px;background:#171b18}
h1{margin:0;color:#e7ebe8;font-size:clamp(1.65rem,8vw,2.15rem);line-height:1.05;letter-spacing:-.045em}
.description{margin:-.45rem 0 .2rem;color:#a5a8a0;font-size:.95rem;line-height:1.55}
.field{display:grid;gap:.5rem}
label{color:#d9ded7;font-size:.82rem;font-weight:600}
input{width:100%;min-height:2.9rem;padding:.65rem .8rem;border:1px solid #2b342e;border-radius:6px;outline:0;background:#0b0e0c;color:#e7ebe8;font:inherit}
input:hover{border-color:#5b6058}
input:focus-visible{border-color:#a1b69a;outline:2px solid #a1b69a;outline-offset:2px}
input[aria-invalid="true"]{border-color:#d26d6d}
.error{min-height:1.2em;margin:0;color:#e38a8a;font-size:.8rem;line-height:1.45}
button{min-height:2.9rem;padding:.7rem 1rem;border:1px solid #667a61;border-radius:6px;background:#667a61;color:#fff;font:600 .9rem/1 inherit;cursor:pointer;transition:background-color .15s ease,transform .15s ease}
button:hover{background:#7f9378}
button:active{transform:translateY(1px)}
button:focus-visible{outline:3px solid #667a6166;outline-offset:3px}
button:disabled{cursor:wait;opacity:.7}
.help{margin:.25rem 0 0;color:#777b73;font-size:.75rem;line-height:1.5;text-align:center}
@media(max-width:22rem){body{padding:.75rem}form{border-radius:10px}.xyle-mark{margin-left:.25rem;margin-bottom:1rem}}
@media(prefers-reduced-motion:reduce){button{transition:none}}
</style></head><body><main>
<div class="xyle-mark" aria-label="Xyle"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5l12 14M18 5L6 19"/></svg><span>Xyle</span></div>
<form id="login" novalidate>
<h1>Open your site editor</h1>
<p id="login-description" class="description">Enter the editor key for this site to make and publish content changes.</p>
<div class="field"><label for="key">Editor key</label><input id="key" name="key" type="password" autocomplete="current-password" required aria-describedby="login-description login-error" aria-invalid="false"></div>
<p id="login-error" class="error" aria-live="polite"></p>
<button type="submit"><span id="submit-label">Sign in to Xyle</span></button>
</form>
<p class="help">The editor key is stored with your Xyle site setup.</p>
</main><script type="module">
const form = document.getElementById("login");
const input = document.getElementById("key");
const error = document.getElementById("login-error");
const button = form.querySelector("button");
const submitLabel = document.getElementById("submit-label");
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  error.textContent = "";
  input.setAttribute("aria-invalid", "false");
  if (!input.value) {
    input.setAttribute("aria-invalid", "true");
    error.textContent = "Enter your editor key.";
    input.focus();
    return;
  }
  button.disabled = true;
  submitLabel.textContent = "Signing in…";
  try {
    const res = await fetch("/__xyle/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: input.value }),
    });
    if (res.ok) {
      location.reload();
      return;
    }
    input.setAttribute("aria-invalid", "true");
    error.textContent = res.status === 401 ? "That editor key was not accepted." : "Xyle could not sign you in. Try again.";
    input.focus();
    input.select();
  } catch {
    input.setAttribute("aria-invalid", "true");
    error.textContent = "Xyle could not be reached. Check your connection and try again.";
    input.focus();
  } finally {
    button.disabled = false;
    submitLabel.textContent = "Sign in to Xyle";
  }
});
input.addEventListener("input", () => {
  if (input.getAttribute("aria-invalid") === "true") {
    input.setAttribute("aria-invalid", "false");
    error.textContent = "";
  }
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
const MAX_PUBLISH_REQUEST_BYTES = MAX_UPLOAD_BYTES + 1024 * 1024;

function isDigest(value: unknown): value is XyleDigest {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
}
function validatePublishMetadata(value: unknown): PublishMetadata | null {
  if (!value || typeof value !== "object") return null;
  const metadata = value as Partial<PublishMetadata>;
  if (
    !isDigest(metadata.baseSnapshotDigest) ||
    !Array.isArray(metadata.pages) ||
    metadata.pages.length > 100
  )
    return null;
  const pagePaths = new Set<string>();
  for (const page of metadata.pages) {
    if (
      !page ||
      typeof page.pagePath !== "string" ||
      !isDigest(page.baseDigest) ||
      !Array.isArray(page.operations) ||
      page.operations.length > 500
    )
      return null;
    if (
      page.operations.some(
        (op) =>
          !op ||
          typeof op !== "object" ||
          !["text", "lineBreak", "href", "src", "alt"].includes(
            (op as { type?: string }).type ?? "",
          ),
      )
    )
      return null;
    let normalizedPath: string;
    try {
      normalizedPath = normalizeSitePath(page.pagePath);
    } catch {
      return null;
    }
    if (pagePaths.has(normalizedPath)) return null;
    pagePaths.add(normalizedPath);
  }
  return metadata as PublishMetadata;
}

async function handlePublish(request: Request, context: RuntimeContext): Promise<Response> {
  await requireSession(request, context);
  assertMutationAllowed(request, context);

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isSafeInteger(contentLength) || contentLength > MAX_PUBLISH_REQUEST_BYTES)
    return json({ error: "request too large" }, 413);
  const form = await request.formData().catch(() => null);
  if (!form) return json({ error: "invalid multipart body" }, 400);
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
  const validMetadata = validatePublishMetadata(metadata);
  if (!validMetadata) return json({ error: "invalid publish metadata" }, 400);
  metadata = validMetadata;

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
    const bytes = await readSiteFile(context.root, pagePath);
    let patched: Uint8Array;
    try {
      patched = await patchHtml(
        bytes,
        {
          pagePath,
          baseDigest: change.baseDigest,
          operations: change.operations,
        },
        context.ignoreSelectors ? { ignoreSelectors: context.ignoreSelectors } : {},
      );
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
    // SAFETY: Node's Uint8Array is accepted by the Fetch BodyInit implementation.
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
    try {
      const url = new URL(request.url);
      const pathname = url.pathname;
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

      if (pathname === "/__xyle/api/logout") {
        if (request.method !== "POST") {
          throw new HttpError(403, { error: "mutation rejected" });
        }
        assertMutationAllowed(request, context);
        await requireSession(request, context);
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
          const directoryRequest = requested.endsWith("/");
          sitePath = normalizeSitePath(requested);
          if (directoryRequest) sitePath = `${sitePath === "/" ? "" : sitePath}/index.html`;
        } catch {
          return json({ error: "unsafe path" }, 400);
        }
        if (isIgnoredPath(sitePath, context.ignorePaths)) {
          return json({ error: "page is ignored" }, 404);
        }
        const snapshot = await context.publisher.readSnapshot();
        const file = snapshot.manifest.files[sitePath];
        if (!file || file.contentType !== "text/html") {
          return json({ error: "not an editable page" }, 404);
        }
        let source: string;
        try {
          source = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
            await readSiteFile(context.root, sitePath),
          );
        } catch {
          return json({ error: "page is not valid UTF-8" }, 400);
        }
        const prepared = preparePreview(
          source,
          sitePath,
          context.publicBaseUrl,
          context.ignoreSelectors,
        );
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
            sources.set(
              path,
              new TextDecoder("utf-8", { fatal: true }).decode(
                await readSiteFile(context.root, path),
              ),
            );
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
