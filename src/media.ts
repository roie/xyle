import type { MediaItem, XyleDigest, XyleManifest } from "./types.ts";
import { digestBytes } from "./manifest.ts";
import { simpleImageSources } from "./html.ts";

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20 MiB
export const MEDIA_PREFIX = "/__media/";

export type UploadValidation =
  | { ok: true; contentType: string }
  | { ok: false; reason: string };

function startsWith(bytes: Uint8Array, magic: number[], offset = 0): boolean {
  if (bytes.length < offset + magic.length) return false;
  return magic.every((b, i) => bytes[offset + i] === b);
}

function isWebP(bytes: Uint8Array): boolean {
  return (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  );
}

function avifBrand(bytes: Uint8Array): string | null {
  if (!startsWith(bytes, [0x66, 0x74, 0x79, 0x70], 4)) return null;
  const brand = String.fromCharCode(...bytes.slice(8, 12));
  return brand.startsWith("avif") || brand.startsWith("avis") ? "image/avif" : null;
}

/** Executable / polyglot markers that must never pass as an image. */
function looksExecutable(bytes: Uint8Array): boolean {
  const head = Array.from(bytes.slice(0, 4));
  // MZ (PE), ELF, shebang, Mach-O
  if (head[0] === 0x4d && head[1] === 0x5a) return true;
  if (head[0] === 0x7f && head[1] === 0x45 && head[2] === 0x4c && head[3] === 0x46) return true;
  if (head[0] === 0x23 && head[1] === 0x21) return true;
  if (
    (head[0] === 0xfe && head[1] === 0xed && head[2] === 0xfa) ||
    (head[0] === 0xcf && head[1] === 0xfa)
  ) {
    return true;
  }
  return false;
}

const SIGNATURE_TYPES: [string, string][] = [
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
];

export function detectImageType(bytes: Uint8Array): string | null {
  if (looksExecutable(bytes)) return null;
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (isWebP(bytes)) return "image/webp";
  const avif = avifBrand(bytes);
  if (avif) return avif;
  return null;
}

export function validateUpload(
  filename: string,
  bytes: Uint8Array,
): UploadValidation {
  if (bytes.byteLength === 0) return { ok: false, reason: "empty upload" };
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    return { ok: false, reason: `upload exceeds ${MAX_UPLOAD_BYTES} bytes` };
  }
  const lower = filename.toLowerCase();
  if (lower.endsWith(".svg")) {
    return { ok: false, reason: "SVG uploads are rejected in v1" };
  }
  if (/[\u0000-\u001f]/.test(filename)) {
    return { ok: false, reason: "filename contains control characters" };
  }
  if (looksExecutable(bytes)) {
    return { ok: false, reason: "executable signature rejected" };
  }
  const type = detectImageType(bytes);
  if (!type) {
    return { ok: false, reason: "unsupported or unrecognized image format" };
  }
  void SIGNATURE_TYPES;
  return { ok: true, contentType: type };
}

/** Deterministic, collision-resistant Xyle-owned upload path. */
export async function uploadPathFor(bytes: Uint8Array, contentType: string): Promise<string> {
  const digest = await digestBytes(bytes);
  const hex = digest.slice("sha256:".length, "sha256:".length + 12);
  const ext =
    { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/avif": "avif" }[
      contentType
    ] ?? "bin";
  return `${MEDIA_PREFIX}${hex}.${ext}`;
}

export interface DiscoveredMedia extends MediaItem {}

export function discoverMedia(
  manifest: XyleManifest,
  htmlSources: Map<string, string>,
): MediaItem[] {
  const used = new Set<string>();
  for (const source of htmlSources.values()) {
    for (const src of simpleImageSources(source)) {
      used.add(resolveRelative(src));
    }
  }

  const items: MediaItem[] = [];
  for (const [path, file] of Object.entries(manifest.files)) {
    if (!file.contentType.startsWith("image/")) continue;
    items.push({
      path,
      contentType: file.contentType,
      size: file.size,
      digest: file.digest,
      source: path.startsWith(MEDIA_PREFIX) ? "xyle-upload" : "site",
      usedBySimpleImg: used.has(path),
    });
  }
  return items.sort((a, b) => a.path.localeCompare(b.path));
}

function resolveRelative(src: string): string {
  try {
    const url = new URL(src, "https://xyle.invalid/");
    return url.pathname;
  } catch {
    return src;
  }
}
