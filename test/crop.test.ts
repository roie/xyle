import { readFileSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { deriveCroppedImage } from "../src/crop.ts";
import { cropRectForFrame } from "../src/media-crop.ts";

const ONE_PIXEL_PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  ),
);
function readFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
}

const EXIF_ORIENTATION_6 = readFixture("exif-orientation-6.jpg");
const ANIMATED_WEBP = readFixture("animated.webp");
const ANIMATED_APNG = readFixture("animated.apng");

describe("derived media crops", () => {
  it("uses normalized source coordinates for the editor frame", () => {
    const crop = cropRectForFrame(400, 200, 300, 300, 2, { x: 0.7, y: 0.3 });
    expect(crop.x).toBeCloseTo(0.575);
    expect(crop.y).toBeCloseTo(0.05);
    expect(crop.width).toBeCloseTo(0.25);
    expect(crop.height).toBeCloseTo(0.5);
  });

  it("rejects rectangles outside normalized source coordinates", async () => {
    await expect(
      deriveCroppedImage(ONE_PIXEL_PNG, { x: 0.8, y: 0, width: 0.4, height: 1 }),
    ).rejects.toThrow("invalid normalized crop rectangle");
  });

  it("applies normalized coordinates after EXIF orientation", async () => {
    const result = await deriveCroppedImage(EXIF_ORIENTATION_6, {
      x: 0,
      y: 0,
      width: 0.5,
      height: 1,
    });
    const metadata = await sharp(result.bytes).metadata();
    expect(metadata.width).toBe(1);
    expect(metadata.height).toBe(4);
  });

  it.each([
    ["animated WebP", ANIMATED_WEBP],
    ["animated APNG", ANIMATED_APNG],
  ])("rejects %s from destructive crop paths", async (_label, bytes) => {
    await expect(deriveCroppedImage(bytes, { x: 0, y: 0, width: 1, height: 1 })).rejects.toThrow(
      "animated images support replacement and alt text only",
    );
  });

  it("creates a deterministic Xyle-owned WebP asset", async () => {
    const result = await deriveCroppedImage(ONE_PIXEL_PNG, {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
    expect(result.contentType).toBe("image/webp");
    expect(result.path).toMatch(/^\/__media\/[0-9a-f]{64}\.webp$/);
    expect(result.bytes.byteLength).toBeGreaterThan(0);
  });
});
