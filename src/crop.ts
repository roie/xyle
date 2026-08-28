import sharp from "sharp";
import { digestBytes } from "./digest.ts";
import type { CropRect } from "./types.ts";
import { MEDIA_PREFIX } from "./media.ts";

const MAX_DECODED_PIXELS = 100_000_000;

function validCrop(crop: CropRect): boolean {
  return (
    [crop.x, crop.y, crop.width, crop.height].every(
      (value) => Number.isFinite(value) && value >= 0 && value <= 1,
    ) &&
    crop.width > 0 &&
    crop.height > 0 &&
    crop.x + crop.width <= 1 &&
    crop.y + crop.height <= 1
  );
}

function bytesEqualAt(bytes: Uint8Array, offset: number, text: string): boolean {
  return [...text].every((character, index) => bytes[offset + index] === character.charCodeAt(0));
}

function hasAnimatedPng(bytes: Uint8Array): boolean {
  if (!bytesEqualAt(bytes, 0, "\x89PNG\r\n\x1a\n")) return false;
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0);
    if (offset + 12 + length > bytes.length) return false;
    if (bytesEqualAt(bytes, offset + 4, "acTL")) return true;
    offset += 12 + length;
  }
  return false;
}

function hasAnimatedWebp(bytes: Uint8Array): boolean {
  if (!bytesEqualAt(bytes, 0, "RIFF") || !bytesEqualAt(bytes, 8, "WEBP")) return false;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const length = new DataView(bytes.buffer, bytes.byteOffset + offset + 4, 4).getUint32(0, true);
    if (offset + 8 + length > bytes.length) return false;
    if (bytesEqualAt(bytes, offset, "ANIM")) return true;
    if (bytesEqualAt(bytes, offset, "VP8X") && (bytes[offset + 8]! & 0x02) !== 0) return true;
    offset += 8 + length + (length % 2);
  }
  return false;
}

function isAnimatedImage(bytes: Uint8Array, pages: number | undefined): boolean {
  return (pages ?? 1) > 1 || hasAnimatedPng(bytes) || hasAnimatedWebp(bytes);
}

/** Apply EXIF orientation before extracting a normalized source rectangle. */
export async function deriveCroppedImage(
  bytes: Uint8Array,
  crop: CropRect,
): Promise<{ bytes: Uint8Array; path: string; contentType: "image/webp" }> {
  if (!validCrop(crop)) throw new Error("invalid normalized crop rectangle");
  const source = sharp(bytes);
  const rawMetadata = await source.metadata();
  const rawWidth = rawMetadata.width ?? 0;
  const rawHeight = rawMetadata.height ?? 0;
  if (isAnimatedImage(bytes, rawMetadata.pages)) {
    throw new Error("animated images support replacement and alt text only");
  }
  if (!rawWidth || !rawHeight || rawWidth * rawHeight > MAX_DECODED_PIXELS) {
    throw new Error("image dimensions are too large to crop safely");
  }
  // Materialize orientation first so normalized coordinates match what the user saw.
  const oriented = sharp(await source.rotate().png().toBuffer());
  const metadata = await oriented.metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (!width || !height || width * height > MAX_DECODED_PIXELS) {
    throw new Error("image dimensions are too large to crop safely");
  }
  const left = Math.min(width - 1, Math.floor(crop.x * width));
  const top = Math.min(height - 1, Math.floor(crop.y * height));
  const extractWidth = Math.max(1, Math.min(width - left, Math.round(crop.width * width)));
  const extractHeight = Math.max(1, Math.min(height - top, Math.round(crop.height * height)));
  const output = new Uint8Array(
    await oriented
      .extract({ left, top, width: extractWidth, height: extractHeight })
      .webp({ quality: 90 })
      .toBuffer(),
  );
  const digest = await digestBytes(output);
  return {
    bytes: output,
    path: `${MEDIA_PREFIX}${digest.slice("sha256:".length)}.webp`,
    contentType: "image/webp",
  };
}
