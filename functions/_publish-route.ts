import type { Env } from "./_auth";
import {
  deployCompleteSnapshot,
  materializeHostedMediaOperations,
  type CloudflareImagesBinding,
} from "./_publish";
import { patchHtml } from "../src/html.ts";
import { uploadPathFor, validateUpload } from "../src/media.ts";
import { computeSnapshotDigest, digestBytes } from "../src/digest.ts";
import { LAYOUT_CSS, layoutAssetPath } from "../src/layout.ts";
import { bufferRequestBody, RequestBodyTooLargeError } from "../src/request-body.ts";
import type { ManifestFile, PageOperation, XyleDigest } from "../src/types.ts";

export type HostedPublishEnv = Env & {
  ASSETS: { fetch(request: Request): Promise<Response> };
  CLOUDFLARE_PROJECT?: string;
  IMAGES?: CloudflareImagesBinding;
};

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_PUBLISH_REQUEST_BYTES = MAX_UPLOAD_BYTES + 1024 * 1024;
const activePublishRequests = new Set<string>();

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
      directives.get("style-src-elem") ??
      directives.get("style-src") ??
      directives.get("default-src");
    if (!sources || sources.length === 0) return true;
    if (sources.includes("'none'")) return false;
    if (sources.some((value) => value.startsWith("'nonce-") || value.startsWith("'sha")))
      return false;
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

function requestOrigin(request: Request): string {
  try {
    return new URL(request.url).origin;
  } catch {
    return request.url;
  }
}

export async function handleHostedPublish(
  request: Request,
  env: HostedPublishEnv,
): Promise<Response> {
  if (!request.headers.get("content-type")?.includes("multipart/form-data")) {
    return Response.json({ error: "unsupported content type" }, { status: 415 });
  }
  const publishKey = env.CLOUDFLARE_PROJECT ?? requestOrigin(request);
  if (activePublishRequests.has(publishKey)) {
    return Response.json(
      {
        error: "publish-in-progress",
        message: "Another publish is in progress. Wait for it to finish, then reload.",
      },
      { status: 409 },
    );
  }
  activePublishRequests.add(publishKey);
  try {
    let bufferedRequest: Request;
    try {
      bufferedRequest = await bufferRequestBody(request, MAX_PUBLISH_REQUEST_BYTES);
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return Response.json({ error: "request too large" }, { status: 413 });
      }
      throw error;
    }
    const form = await bufferedRequest.formData().catch(() => null);
    if (!form) return Response.json({ error: "invalid multipart body" }, { status: 400 });
    const raw = form.get("metadata");
    if (typeof raw !== "string")
      return Response.json({ error: "missing metadata" }, { status: 400 });
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
    const current = (await (await env.ASSETS.fetch(new Request(manifestUrl))).json()) as {
      files: Record<string, ManifestFile>;
      snapshotDigest: XyleDigest;
    };
    if (metadata.baseSnapshotDigest !== current.snapshotDigest) {
      return Response.json(
        { error: "stale-site", currentSnapshotDigest: current.snapshotDigest },
        { status: 409 },
      );
    }
    for (const page of metadata.pages) {
      const entry = current.files[page.pagePath];
      if (
        !entry ||
        entry.contentType !== "text/html" ||
        page.pagePath.startsWith("/_xyle/") ||
        page.pagePath.startsWith("/__xyle/")
      ) {
        return Response.json({ error: `invalid page target: ${page.pagePath}` }, { status: 400 });
      }
    }
    const uploads: Array<{
      path: string;
      bytes: Uint8Array;
      contentType: string;
    }> = [];
    let uploadBytes = 0;
    for (const [path, value] of form.entries()) {
      if (!(value instanceof File)) continue;
      if (!path.startsWith("/__media/"))
        return Response.json({ error: "invalid upload path" }, { status: 400 });
      const bytes = new Uint8Array(await value.arrayBuffer());
      uploadBytes += bytes.byteLength;
      if (uploadBytes > MAX_UPLOAD_BYTES)
        return Response.json({ error: "uploads too large" }, { status: 413 });
      const validation = validateUpload(value.name, bytes);
      if (!validation.ok)
        return Response.json({ error: `upload rejected: ${validation.reason}` }, { status: 400 });
      const expectedPath = await uploadPathFor(bytes, validation.contentType);
      if (expectedPath !== path)
        return Response.json({ error: "upload path mismatch" }, { status: 400 });
      const existing = current.files[path];
      const digest = await digestBytes(bytes);
      if (
        existing &&
        (existing.digest !== digest || existing.contentType !== validation.contentType)
      ) {
        return Response.json({ error: "upload path collision" }, { status: 409 });
      }
      if (!existing) uploads.push({ path, bytes, contentType: validation.contentType });
    }
    const files: Array<{
      path: string;
      bytes: Uint8Array;
      contentType: string;
    }> = [];
    for (const [path, entry] of Object.entries(current.files)) {
      const assetUrl = new URL(request.url);
      assetUrl.pathname = path;
      const response = await env.ASSETS.fetch(new Request(assetUrl));
      if (!response.ok)
        return Response.json({ error: `snapshot asset unavailable: ${path}` }, { status: 409 });
      files.push({
        path,
        bytes: new Uint8Array(await response.arrayBuffer()),
        contentType: entry.contentType,
      });
    }
    const byPath = new Map(files.map((file) => [file.path, file]));
    for (const upload of uploads) byPath.set(upload.path, upload);
    const submitted = new Map(uploads.map((upload) => [upload.path, upload.bytes]));
    const layoutCssBytes = new TextEncoder().encode(LAYOUT_CSS);
    const layoutCssDigest = await digestBytes(layoutCssBytes);
    const layoutCssPath = layoutAssetPath(layoutCssDigest);
    const layoutRequired =
      [...byPath.values()].some(
        (file) =>
          file.contentType === "text/html" &&
          /data-xyle-layout="(?:stack|split)"/.test(new TextDecoder().decode(file.bytes)),
      ) ||
      (metadata.pages ?? []).some((page) => {
        const file = byPath.get(page.pagePath);
        return !!file && isLayoutNeeded(new TextDecoder().decode(file.bytes), page.operations);
      });
    if (layoutRequired) {
      const existing = byPath.get(layoutCssPath);
      if (!existing || existing.bytes.length !== layoutCssBytes.length) {
        byPath.set(layoutCssPath, {
          path: layoutCssPath,
          bytes: layoutCssBytes,
          contentType: "text/css",
        });
      }
    }
    const cropBudget = { remainingBytes: MAX_UPLOAD_BYTES };
    for (const page of metadata.pages ?? []) {
      const file = byPath.get(page.pagePath);
      const entry = current.files[page.pagePath];
      if (!file || !entry || entry.digest !== page.baseDigest)
        return Response.json({ error: "stale-site" }, { status: 409 });
      const materialized = await materializeHostedMediaOperations(
        env,
        request.url,
        page.operations,
        byPath,
        submitted,
        cropBudget,
      );
      for (const asset of materialized.assets) byPath.set(asset.path, asset);
      const pageSource = new TextDecoder().decode(file.bytes);
      const pageNeedsLayout = isLayoutNeeded(pageSource, materialized.operations);
      if (pageNeedsLayout) {
        const pageUrl = new URL(page.pagePath, request.url);
        const pageResponse = await env.ASSETS.fetch(new Request(pageUrl));
        const policy = pageResponse.headers.get("content-security-policy");
        if (!cspPermits(pageSource, policy ? [policy] : [], pageUrl.origin)) {
          return Response.json(
            {
              error: `managed Layout stylesheet is blocked by CSP for ${page.pagePath}`,
            },
            { status: 400 },
          );
        }
      }
      file.bytes = await patchHtml(
        file.bytes,
        {
          pagePath: page.pagePath,
          baseDigest: page.baseDigest,
          operations: materialized.operations,
        },
        {
          layoutAssetRequired: pageNeedsLayout,
          ...(pageNeedsLayout
            ? {
                layoutAssetHref: `/__xyle/assets/${layoutCssPath.split("/").at(-1)}`,
              }
            : {}),
        },
      );
    }
    for (const path of [...byPath.keys()]) {
      if (
        path.startsWith("/__xyle/assets/layout-v1.") &&
        (!layoutRequired || path !== layoutCssPath)
      )
        byPath.delete(path);
    }
    if (layoutRequired) {
      byPath.set("/__xyle/manifest.json", {
        path: "/__xyle/manifest.json",
        bytes: new TextEncoder().encode(
          JSON.stringify(
            {
              version: 1,
              assets: {
                [layoutCssPath]: {
                  digest: layoutCssDigest,
                  size: layoutCssBytes.byteLength,
                  contentType: "text/css",
                },
              },
            },
            null,
            2,
          ),
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
      nextEntries[file.path] = {
        digest: await digestBytes(file.bytes),
        size: file.bytes.byteLength,
        contentType: file.contentType,
      };
    }
    const nextManifest = {
      version: 1 as const,
      snapshotDigest: await computeSnapshotDigest(nextEntries),
      files: nextEntries,
    };
    try {
      const deployment = await deployCompleteSnapshot(env, [
        ...nextFiles,
        {
          path: "/_xyle/manifest.json",
          bytes: new TextEncoder().encode(JSON.stringify(nextManifest, null, 2)),
          contentType: "application/json",
        },
      ]);
      return Response.json({
        snapshotDigest: nextManifest.snapshotDigest,
        publishId: deployment,
      });
    } catch (error) {
      return Response.json({ error: (error as Error).message }, { status: 502 });
    }
  } finally {
    activePublishRequests.delete(publishKey);
  }
}
