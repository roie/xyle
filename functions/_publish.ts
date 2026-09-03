import type { PageOperation, MediaState } from "../src/types.ts";
import { digestBytes } from "../src/digest.ts";
import { MAX_UPLOAD_BYTES, MEDIA_PREFIX } from "../src/media.ts";
import { mediaSourcePath } from "../src/media-state.ts";
import { BodyTooLargeError, readBodyBytes } from "../src/request-body.ts";
import {
  pagesAssetHash,
  pagesRequest,
  type PagesEnv,
  XYLE_WORKER_BUNDLE_PATH,
} from "./_pages";

export interface PublishFile { path: string; bytes: Uint8Array; contentType: string; }

type ImageOutput = { response(): Promise<Response> };
type ImageInput = {
  transform(options: Record<string, unknown>): ImageInput;
  output(options: Record<string, unknown>): Promise<ImageOutput>;
};
export interface CloudflareImagesBinding {
  input(source: Uint8Array | ReadableStream<Uint8Array>): ImageInput;
}

export interface HostedPublishEnv extends PagesEnv {
  IMAGES?: CloudflareImagesBinding;
}

const MAX_HOSTED_CROP_BYTES = MAX_UPLOAD_BYTES;

export interface HostedCropBudget {
  remainingBytes: number;
}

/** Materialize normalized crops using the Workers Images binding or cf.image fetch transforms. */
export async function materializeHostedMediaOperations(
  env: HostedPublishEnv,
  requestUrl: string,
  operations: PageOperation[],
  files: Map<string, PublishFile>,
  submitted: Map<string, Uint8Array>,
  budget: HostedCropBudget = { remainingBytes: MAX_HOSTED_CROP_BYTES },
): Promise<{ operations: PageOperation[]; assets: PublishFile[] }> {
  const assets: PublishFile[] = [];
  const derivedByKey = new Map<string, string>();
  const known = new Set(files.keys());
  const output: PageOperation[] = [];
  for (const operation of operations) {
    if (operation.type !== "media" || !operation.value.crop) {
      output.push(operation);
      continue;
    }
    const sourcePath = hostedSourcePath(mediaSourcePath(operation.value.source), requestUrl);
    if (!sourcePath) {
      throw new Error("media crop source is not a same-origin site asset");
    }
    const staged = submitted.has(sourcePath);
    const sourceFile = files.get(sourcePath);
    if (!staged && !sourceFile) {
      throw new Error("media crop source is not part of the current snapshot or staged uploads");
    }
    const sourceBytes = submitted.get(sourcePath) ?? sourceFile?.bytes;
    const sourceUrl = staged ? null : toSourceUrl(sourcePath, requestUrl);
    const key = `${sourcePath}:${JSON.stringify(operation.value.crop)}`;
    let derivedPath = derivedByKey.get(key);
    if (!derivedPath) {
      const bytes = await transformHostedCrop(
        env,
        sourceBytes,
        sourceUrl,
        operation.value.crop,
        staged,
      );
      if (bytes.byteLength > budget.remainingBytes) {
        throw new Error("hosted crop outputs exceed the aggregate publish limit");
      }
      budget.remainingBytes -= bytes.byteLength;
      const digest = await digestBytes(bytes);
      derivedPath = `${MEDIA_PREFIX}${digest.slice("sha256:".length)}.webp`;
      derivedByKey.set(key, derivedPath);
      if (!known.has(derivedPath)) {
        const asset = { path: derivedPath, bytes, contentType: "image/webp" };
        assets.push(asset);
        known.add(derivedPath);
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

function hostedSourcePath(source: string, requestUrl: string): string | null {
  const rootRelative = source.startsWith("/") && !source.startsWith("//");
  const absoluteHttp = /^https?:\/\//i.test(source);
  if (!rootRelative && !absoluteHttp) return null;
  try {
    const requestOrigin = new URL(requestUrl).origin;
    const parsed = new URL(source, requestOrigin);
    return parsed.origin === requestOrigin ? parsed.pathname : null;
  } catch {
    return null;
  }
}

function toSourceUrl(sourcePath: string, requestUrl: string): string | null {
  if (!sourcePath.startsWith("/") || sourcePath.startsWith("//")) return null;
  try {
    const requestOrigin = new URL(requestUrl).origin;
    const parsed = new URL(sourcePath, requestOrigin);
    if (
      parsed.origin !== requestOrigin ||
      parsed.pathname !== sourcePath ||
      parsed.search.length > 0 ||
      parsed.hash.length > 0
    ) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

async function transformHostedCrop(
  env: HostedPublishEnv,
  sourceBytes: Uint8Array | undefined,
  sourceUrl: string | null,
  crop: NonNullable<MediaState["crop"]>,
  staged: boolean,
): Promise<Uint8Array> {
  const image = {
    trim: { top: crop.y, right: 1 - crop.x - crop.width, bottom: 1 - crop.y - crop.height, left: crop.x },
    format: "webp",
    quality: 90,
    anim: false,
    metadata: "none",
  };
  let response: Response;
  if (sourceBytes && env.IMAGES) {
    response = await (
      await env.IMAGES.input(sourceBytes).transform(image).output({ format: "webp", quality: 90 })
    ).response();
  } else {
    if (staged) {
      throw new Error("Cloudflare crop publishing requires an Images binding for staged uploads");
    }
    if (!sourceUrl) throw new Error("media crop source is not a fetchable image URL");
    response = await fetch(sourceUrl, { cf: { image } } as RequestInit & { cf: unknown });
  }
  if (!response.ok) throw new Error(`Cloudflare image crop failed (${response.status})`);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("image/webp")) {
    throw new Error("Cloudflare image crop did not return WebP output");
  }
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!Number.isSafeInteger(Number(declaredLength)) ||
      Number(declaredLength) < 0 ||
      Number(declaredLength) > MAX_HOSTED_CROP_BYTES)
  ) {
    throw new Error("Cloudflare image crop output is too large");
  }
  try {
    return await readBodyBytes(response.body, MAX_HOSTED_CROP_BYTES);
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      throw new Error("Cloudflare image crop output is too large", { cause: error });
    }
    throw error;
  }
}

export async function deployCompleteSnapshot(
  env: PagesEnv & { CLOUDFLARE_PROJECT?: string },
  files: PublishFile[],
): Promise<string> {
  const projectName = env.CLOUDFLARE_PROJECT ?? "xyle";
  const assets = files.map((file) => ({ ...file, hash: pagesAssetHash(file.bytes, file.path) }));
  const tokenResponse = await pagesRequest(env, `/pages/projects/${projectName}/upload-token`);
  if (!tokenResponse.ok) throw new Error(`Cloudflare upload token failed (${tokenResponse.status})`);
  const tokenBody = await tokenResponse.json() as { result?: { jwt?: string }; jwt?: string };
  const jwt = tokenBody.result?.jwt ?? tokenBody.jwt;
  if (!jwt) throw new Error("Cloudflare upload token missing JWT");
  const assetHeaders = { authorization: `Bearer ${jwt}`, "content-type": "application/json" };
  const missingResponse = await fetch("https://api.cloudflare.com/client/v4/pages/assets/check-missing", { method: "POST", headers: assetHeaders, body: JSON.stringify({ hashes: assets.map((asset) => asset.hash) }) });
  const missingBody = await missingResponse.json() as { result?: string[] };
  const missing = new Set(missingBody.result ?? []);
  const uploads = assets.filter((asset) => missing.has(asset.hash)).map((asset) => ({ key: asset.hash, value: bytesToBase64(asset.bytes), base64: true, metadata: { contentType: asset.contentType } }));
  if (uploads.length) {
    const uploadResponse = await fetch("https://api.cloudflare.com/client/v4/pages/assets/upload", { method: "POST", headers: assetHeaders, body: JSON.stringify(uploads) });
    if (!uploadResponse.ok) throw new Error(`Cloudflare asset upload failed (${uploadResponse.status})`);
  }
  const upsertResponse = await fetch("https://api.cloudflare.com/client/v4/pages/assets/upsert-hashes", { method: "POST", headers: assetHeaders, body: JSON.stringify({ hashes: assets.map((asset) => asset.hash) }) });
  if (!upsertResponse.ok) throw new Error(`Cloudflare asset hash registration failed (${upsertResponse.status})`);
  const workerBundle = files.find((file) => file.path === XYLE_WORKER_BUNDLE_PATH);
  if (!workerBundle) throw new Error("Xyle Cloudflare runtime bundle is unavailable");
  const form = new FormData();
  form.set("manifest", JSON.stringify(Object.fromEntries(assets.map((asset) => [asset.path, asset.hash]))));
  form.set(
    "_worker.bundle",
    new File([new Uint8Array(workerBundle.bytes).buffer], "_worker.bundle"),
  );
  form.set(
    "_routes.json",
    new File(
      [JSON.stringify({ version: 1, include: ["/edit", "/__xyle/*", "/_xyle/*"], exclude: [] })],
      "_routes.json",
    ),
  );
  const deployment = await pagesRequest(env, `/pages/projects/${projectName}/deployments`, { method: "POST", body: form });
  if (!deployment.ok) throw new Error(`Cloudflare deployment failed (${deployment.status})`);
  const body = await deployment.json() as { result?: { id?: string; url?: string } };
  return body.result?.url ?? body.result?.id ?? "deployment-created";
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
