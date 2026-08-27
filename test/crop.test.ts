import { describe, expect, it } from "vitest";
import { deriveCroppedImage } from "../src/crop.ts";

const ONE_PIXEL_PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  ),
);

describe("derived media crops", () => {
  it("rejects rectangles outside normalized source coordinates", async () => {
    await expect(
      deriveCroppedImage(ONE_PIXEL_PNG, { x: 0.8, y: 0, width: 0.4, height: 1 }),
    ).rejects.toThrow("invalid normalized crop rectangle");
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
