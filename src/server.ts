import { readFile, realpath } from "node:fs/promises";
import { extname, resolve } from "node:path";
import type { AuthConfig } from "./auth.ts";
import { createSessionCookie, logoutCookie, verifyEditorKey, verifySessionCookie } from "./auth.ts";
import { XYLE_LOGO_DATA_URL } from "./brand.ts";
import { managedStyleCspPermits } from "./csp.ts";
import {
  computeSnapshotDigest,
  isManagedLayoutAssetPath,
  normalizeSitePath,
  XYLE_MANAGED_ASSET_MANIFEST_PATH,
} from "./manifest.ts";
import { isControlSitePath, isPathInsideRoot } from "./control-paths.ts";
import { analyzeGroups, analyzeLayouts, analyzePage, preparePreview, patchHtml } from "./html.ts";
import { discoverMedia, MAX_UPLOAD_BYTES, validateUpload, uploadPathFor } from "./media.ts";
import { deriveCroppedImage } from "./crop.ts";
import { mediaSourcePath, mediaUrlPathname } from "./media-state.ts";
import { digestBytes } from "./digest.ts";
import { LAYOUT_CSS, layoutAssetPath } from "./layout.ts";
import { bufferRequestBody, RequestBodyTooLargeError } from "./request-body.ts";
import type {
  MediaState,
  PageOperation,
  XyleManagedAssetManifest,
  SnapshotOperation,
  PublishedSnapshot,
  Publisher,
  SiteFile,
  XyleManifest,
  XyleDigest,
} from "./types.ts";

export interface RuntimeContext {
  root: string;
  publicBaseUrl: string;
  publisher: Publisher;
  auth: AuthConfig;
  ignorePaths?: string[];
  ignoreSelectors?: string[];
  publicAssetRoot?: string;
  cspPolicies?: string[];
  cspKnown?: boolean;
  /** Test-only fixture reset hook; production callers do not provide it. */
  resetForTests?: () => Promise<void>;
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
  if (
    isControlSitePath(sitePath) &&
    sitePath !== XYLE_MANAGED_ASSET_MANIFEST_PATH &&
    !isManagedLayoutAssetPath(sitePath)
  )
    throw new HttpError(404, { error: "reserved path" });
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
<title>Xyle | Sign in</title><link rel="icon" href="${XYLE_LOGO_DATA_URL}"><style>
:root{color-scheme:dark;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#101311;color:#e7ebe8}
*{box-sizing:border-box}
body{display:grid;place-items:center;min-height:100svh;margin:0;padding:1rem;background:#101311}
main{width:min(100%,26rem)}
.xyle-logo{display:inline-flex;align-items:center;gap:.65rem;margin-bottom:1.5rem;color:#f2f3ef;font-size:.83rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
.xyle-logo img{width:1.75rem;height:1.75rem;object-fit:contain}
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
@media(max-width:22rem){body{padding:.75rem}form{border-radius:10px}.xyle-logo{margin-left:.25rem;margin-bottom:1rem}}
@media(prefers-reduced-motion:reduce){button{transition:none}}
</style></head><body><main>
<div class="xyle-logo" aria-label="Xyle"><img src="${XYLE_LOGO_DATA_URL}" alt=""><span>Xyle</span></div>
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
          ![
            "text",
            "lineBreak",
            "href",
            "src",
            "alt",
            "format",
            "formatBlock",
            "setBlockFormat",
            "html",
            "replaceTextBlock",
            "media",
            "seo",
            "toggleList",
            "sectionVisibility",
            "deleteSection",
            "moveSection",
            "duplicateSection",
            "duplicateGroupItem",
            "moveGroupItem",
            "setLayoutPreset",
            "setRegionOrder",
          ].includes((op as { type?: string }).type ?? ""),
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

async function materializeMediaOperations(
  operations: PageOperation[],
  current: PublishedSnapshot,
  root: string,
  submitted: Map<string, Uint8Array>,
): Promise<{ operations: PageOperation[]; assets: SiteFile[] }> {
  const assets: SiteFile[] = [];
  const knownAssets = new Set(Object.keys(current.manifest.files));
  const materialized = new Map<string, string>();
  const output: PageOperation[] = [];
  for (const operation of operations) {
    if (operation.type === "duplicateSection" || operation.type === "duplicateGroupItem") {
      const nested = await materializeMediaOperations(
        [...operation.snapshotOperations, ...(operation.createdOperations ?? [])],
        current,
        root,
        submitted,
      );
      assets.push(...nested.assets);
      const split = nested.operations.filter(
        (
          nestedOperation,
        ): nestedOperation is Exclude<PageOperation, { type: "duplicateSection" }> =>
          nestedOperation.type !== "duplicateSection",
      );
      const remainingStagedAssets = new Set(
        split.flatMap((nestedOperation) =>
          nestedOperation.type === "media" && nestedOperation.value.source.kind === "staged"
            ? [nestedOperation.value.source.assetId]
            : [],
        ),
      );
      output.push({
        ...operation,
        snapshotOperations: split.slice(
          0,
          operation.snapshotOperations.length,
        ) as SnapshotOperation[],
        createdOperations: split.slice(operation.snapshotOperations.length) as SnapshotOperation[],
        assetRefs: operation.assetRefs.filter((asset) => remainingStagedAssets.has(asset.assetId)),
      });
      continue;
    }
    if (operation.type !== "media" || !operation.value.crop) {
      output.push(operation);
      continue;
    }
    const source = mediaSourcePath(operation.value.source);
    const sourcePath = mediaUrlPathname(source);
    if (
      !source.startsWith("/") ||
      source.startsWith("//") ||
      !sourcePath ||
      !isPathInsideRoot(root, resolve(root, `.${sourcePath}`))
    ) {
      throw new Error("cropping requires a local image source");
    }
    const sourceBytes = submitted.get(sourcePath) ?? (await readSiteFile(root, sourcePath));
    const cropKey = `${sourcePath}:${JSON.stringify(operation.value.crop)}`;
    let derivedPath = materialized.get(cropKey);
    if (!derivedPath) {
      const derived = await deriveCroppedImage(sourceBytes, operation.value.crop);
      derivedPath = derived.path;
      materialized.set(cropKey, derivedPath);
      if (!knownAssets.has(derivedPath)) {
        const digest = await digestBytes(derived.bytes);
        assets.push({
          path: derivedPath,
          bytes: derived.bytes,
          digest,
          contentType: derived.contentType,
        });
        knownAssets.add(derivedPath);
      }
    }
    const value: MediaState = {
      ...operation.value,
      source: { kind: "existing", src: derivedPath },
      crop: null,
    };
    output.push({ ...operation, value });
  }
  return { operations: output, assets };
}

function layoutRequiredForPage(
  source: string,
  operations: PageOperation[],
  ignoreSelectors: string[],
): boolean {
  const analysis = analyzePage(source, ignoreSelectors);
  const groups = analyzeGroups(source, "layout-check");
  const targets = analyzeLayouts(source, analysis, groups);
  const managedAttributeCount = analysis.managedLayoutAttributeCount;
  const managed = new Map(targets.map((target) => [target.id, !!target.managedPreset]));
  const recognizedManagedCount = targets.filter((target) => target.managedPreset).length;
  const visit = (nested: PageOperation[]): void => {
    for (const operation of nested) {
      if (operation.type === "setLayoutPreset") {
        managed.set(operation.nodeId, operation.preset !== operation.baseline);
      } else if (operation.type === "duplicateSection") {
        if (managed.get(operation.sourceId)) managed.set(operation.sourceId, true);
        visit([...operation.snapshotOperations, ...(operation.createdOperations ?? [])]);
      }
    }
  };
  visit(operations);
  return managedAttributeCount > recognizedManagedCount || [...managed.values()].some(Boolean);
}

function layoutCspPermits(context: RuntimeContext, source: string): boolean {
  if (context.cspKnown !== true) return false;
  const policies = [...(context.cspPolicies ?? [])];
  for (const tag of source.match(/<meta\b[^>]*>/gi) ?? []) {
    const httpEquiv = /http-equiv\s*=\s*["']?([^"'\s>]+)/i.exec(tag)?.[1];
    if (httpEquiv?.toLowerCase() !== "content-security-policy") continue;
    const content = /content\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
    if (content) policies.push(content);
  }
  let origin: string;
  try {
    origin = new URL(context.publicBaseUrl).origin;
  } catch {
    return false;
  }
  return managedStyleCspPermits(source, policies, origin);
}

function layoutAssetHref(context: RuntimeContext, path: string): string {
  const root = context.publicAssetRoot;
  if (root !== "/") {
    throw new Error("managed Layout assets require the public root path");
  }
  return path;
}

async function handlePublish(request: Request, context: RuntimeContext): Promise<Response> {
  await requireSession(request, context);
  assertMutationAllowed(request, context);

  let bufferedRequest: Request;
  try {
    bufferedRequest = await bufferRequestBody(request, MAX_PUBLISH_REQUEST_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return json({ error: "request too large" }, 413);
    }
    throw error;
  }
  const form = await bufferedRequest.formData().catch(() => null);
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
  for (const page of metadata.pages) {
    const pagePath = normalizeSitePath(page.pagePath);
    if (isIgnoredPath(pagePath, context.ignorePaths)) {
      return json({ error: `page is ignored: ${pagePath}` }, 400);
    }
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

  const pageChanges = new Map(
    metadata.pages.map((page) => [normalizeSitePath(page.pagePath), page]),
  );
  const pageLayoutNeeds = new Map<string, boolean>();
  for (const [path, entry] of Object.entries(current.manifest.files)) {
    if (entry.contentType !== "text/html") continue;
    try {
      const source = new TextDecoder("utf-8", { fatal: true }).decode(
        await readSiteFile(context.root, path),
      );
      pageLayoutNeeds.set(
        path,
        layoutRequiredForPage(
          source,
          pageChanges.get(path)?.operations ?? [],
          context.ignoreSelectors ?? [],
        ),
      );
    } catch {
      return json({ error: `page is not valid UTF-8: ${path}` }, 400);
    }
  }
  const layoutRequired = [...pageLayoutNeeds.values()].some(Boolean);
  const layoutCssBytes = new TextEncoder().encode(LAYOUT_CSS);
  const layoutCssDigest = await digestBytes(layoutCssBytes);
  const layoutCssPath = layoutAssetPath(layoutCssDigest);
  let managedLayoutHref: string | undefined;
  if (layoutRequired) {
    try {
      managedLayoutHref = layoutAssetHref(context, layoutCssPath);
    } catch (error) {
      return json({ error: (error as Error).message }, 400);
    }
  }
  const changedFiles: SiteFile[] = [];
  const addedFiles: SiteFile[] = [];
  const managedFiles: SiteFile[] = [];
  const removedFiles: string[] = [];
  const addedAssetPaths = new Set<string>();
  const submitted = new Map<string, Uint8Array>();
  for (const [name, value] of form.entries()) {
    if (value instanceof File && name.startsWith("/__media/")) {
      submitted.set(name, new Uint8Array(await value.arrayBuffer()));
    }
  }
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
    if (
      pageLayoutNeeds.get(pagePath) &&
      !layoutCspPermits(context, new TextDecoder().decode(bytes))
    ) {
      return json({ error: `managed Layout stylesheet is blocked by CSP for ${pagePath}` }, 400);
    }
    let patched: Uint8Array;
    try {
      const materialized = await materializeMediaOperations(
        change.operations,
        current,
        context.root,
        submitted,
      );
      for (const asset of materialized.assets) {
        if (addedAssetPaths.has(asset.path)) continue;
        addedAssetPaths.add(asset.path);
        addedFiles.push(asset);
        updatedEntries[asset.path] = {
          digest: asset.digest,
          size: asset.bytes.byteLength,
          contentType: asset.contentType,
        };
      }
      patched = await patchHtml(
        bytes,
        {
          pagePath,
          baseDigest: change.baseDigest,
          operations: materialized.operations,
        },
        {
          ...(context.ignoreSelectors ? { ignoreSelectors: context.ignoreSelectors } : {}),
          ...(managedLayoutHref ? { layoutAssetHref: managedLayoutHref } : {}),
          layoutAssetRequired: pageLayoutNeeds.get(pagePath) ?? false,
        },
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
  for (const path of Object.keys(manifestFiles)) {
    if (!isManagedLayoutAssetPath(path)) continue;
    delete manifestFiles[path];
    if (path !== layoutCssPath) removedFiles.push(path);
  }
  if (layoutRequired) {
    manifestFiles[layoutCssPath] = {
      digest: layoutCssDigest,
      size: layoutCssBytes.byteLength,
      contentType: "text/css",
    };
    if (current.manifest.files[layoutCssPath]?.digest !== layoutCssDigest) {
      addedFiles.push({
        path: layoutCssPath,
        bytes: layoutCssBytes,
        digest: layoutCssDigest,
        contentType: "text/css",
      });
    }
    const managedManifest: XyleManagedAssetManifest = {
      version: 1,
      assets: {
        [layoutCssPath]: {
          digest: layoutCssDigest,
          size: layoutCssBytes.byteLength,
          contentType: "text/css",
        },
      },
    };
    const managedBytes = new TextEncoder().encode(JSON.stringify(managedManifest, null, 2));
    managedFiles.push({
      path: XYLE_MANAGED_ASSET_MANIFEST_PATH,
      bytes: managedBytes,
      digest: await digestBytes(managedBytes),
      contentType: "application/json",
    });
  } else {
    removedFiles.push(XYLE_MANAGED_ASSET_MANIFEST_PATH);
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
    managedFiles,
    removedFiles,
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
  let secureCookies = false;
  try {
    secureCookies = new URL(context.publicBaseUrl).protocol === "https:";
  } catch {
    throw new Error("Xyle publicBaseUrl must be an absolute HTTP or HTTPS URL");
  }
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

      if (pathname === "/__xyle/api/test/reset" && request.method === "POST") {
        if (!context.resetForTests) return json({ error: "not found" }, 404);
        await context.resetForTests();
        return json({ ok: true });
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
          secureCookies,
        );
        return json({ ok: true }, 200, { "set-cookie": cookie });
      }

      if (pathname === "/__xyle/api/logout") {
        if (request.method !== "POST") {
          throw new HttpError(403, { error: "mutation rejected" });
        }
        assertMutationAllowed(request, context);
        await requireSession(request, context);
        return json({ ok: true }, 200, { "set-cookie": logoutCookie(secureCookies) });
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
          groups: prepared.groups,
          layouts: prepared.layouts,
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

      if (request.method === "GET" || request.method === "HEAD") {
        const managedPath =
          pathname === XYLE_MANAGED_ASSET_MANIFEST_PATH || isManagedLayoutAssetPath(pathname)
            ? pathname
            : null;
        if (managedPath) {
          try {
            const bytes = await readSiteFile(context.root, managedPath);
            const ext = extname(managedPath).toLowerCase();
            // SAFETY: Fetch accepts the bytes read from the validated managed asset as a body.
            return new Response(request.method === "HEAD" ? null : (bytes as unknown as BodyInit), {
              headers: {
                "content-type": MIME_TYPES[ext] ?? "application/octet-stream",
                "cache-control":
                  managedPath === XYLE_MANAGED_ASSET_MANIFEST_PATH
                    ? "no-cache"
                    : "public, max-age=31536000, immutable",
              },
            });
          } catch {
            return new Response("Not found", { status: 404 });
          }
        }
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
