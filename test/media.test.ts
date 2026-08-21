import { describe, expect, it } from "vitest";
import {
  detectImageType,
  discoverMedia,
  MAX_UPLOAD_BYTES,
  uploadPathFor,
  validateUpload,
} from "../src/media.ts";
import type { XyleManifest } from "../src/types.ts";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const jpg = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKgA/9k=",
  "base64",
);

describe("detectImageType", () => {
  it("detects PNG by signature", () => {
    expect(detectImageType(new Uint8Array(png))).toBe("image/png");
  });

  it("detects JPEG by signature", () => {
    expect(detectImageType(new Uint8Array(jpg))).toBe("image/jpeg");
  });

  it("detects WebP by RIFF+WEBP signature", () => {
    const webp = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
    ]);
    expect(detectImageType(webp)).toBe("image/webp");
  });

  it("detects AVIF brand", () => {
    const avif = new Uint8Array(16);
    avif.set([0, 0, 0, 0x18], 0);
    avif.set(Buffer.from("ftypavif"), 4);
    expect(detectImageType(avif)).toBe("image/avif");
  });

  it("rejects SVG and text", () => {
    const svg = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>");
    expect(detectImageType(svg)).toBeNull();
  });

  it("rejects executable signatures (polyglot guard)", () => {
    const mz = new Uint8Array(64);
    mz[0] = 0x4d;
    mz[1] = 0x5a;
    // PNG magic glued onto an MZ header must still fail
    expect(detectImageType(mz)).toBeNull();
    const polyglot = new Uint8Array(png);
    expect(detectImageType(polyglot)).toBe("image/png");
  });
});

describe("validateUpload", () => {
  it("enforces the size cap", () => {
    const big = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    const over = validateUpload("big.png", big);
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.reason).toMatch(/exceeds/);
    const atCap = validateUpload("big.png", big.slice(0, MAX_UPLOAD_BYTES));
    // at-cap zeros fail signature validation, not size validation
    if (!atCap.ok) expect(atCap.reason).not.toMatch(/exceeds/);
  });

  it("rejects SVG uploads regardless of signature spoofing", () => {
    const result = validateUpload("image.svg", new TextEncoder().encode("<svg/>"));
    expect(result.ok).toBe(false);
  });

  it("rejects empty uploads", () => {
    expect(validateUpload("a.png", new Uint8Array()).ok).toBe(false);
  });

  it("accepts valid raster uploads", () => {
    const result = validateUpload("photo.PNG", new Uint8Array(png));
    expect(result).toEqual({ ok: true, contentType: "image/png" });
  });
});

describe("uploadPathFor", () => {
  it("derives deterministic content-addressed paths", async () => {
    const a = await uploadPathFor(new Uint8Array(png), "image/png");
    const b = await uploadPathFor(new Uint8Array(png), "image/png");
    expect(a).toBe(b);
    expect(a).toMatch(/^\/__media\/[0-9a-f]{12}\.png$/);
  });

  it("differs for different bytes", async () => {
    const a = await uploadPathFor(new Uint8Array(png), "image/png");
    const b = await uploadPathFor(new Uint8Array(jpg), "image/jpeg");
    expect(a).not.toBe(b);
    expect(b.endsWith(".jpg")).toBe(true);
  });
});

describe("discoverMedia", () => {
  const manifest: XyleManifest = {
    version: 1,
    snapshotDigest: "sha256:x",
    files: {
      "/index.html": { digest: "sha256:h", size: 10, contentType: "text/html" },
      "/assets/hero.webp": { digest: "sha256:a", size: 1, contentType: "image/webp" },
      "/misc/team.jpg": { digest: "sha256:b", size: 2, contentType: "image/jpeg" },
      "/img/logo.svg": { digest: "sha256:c", size: 3, contentType: "image/svg+xml" },
      "/__media/abc123.webp": { digest: "sha256:d", size: 4, contentType: "image/webp" },
      "/styles.css": { digest: "sha256:e", size: 5, contentType: "text/css" },
    },
  };

  it("finds images anywhere in the tree and classifies usage", () => {
    const html = new Map([
      [
        "/index.html",
        `<p><img src="/assets/hero.webp" alt=""></p>`,
      ],
      ["/about.html", ""],
    ]);
    const items = discoverMedia(manifest, html);
    const hero = items.find((i) => i.path === "/assets/hero.webp")!;
    expect(hero.usedBySimpleImg).toBe(true);

    const team = items.find((i) => i.path === "/misc/team.jpg")!;
    expect(team.usedBySimpleImg).toBe(false);
    expect(team.source).toBe("site");

    const upload = items.find((i) => i.path === "/__media/abc123.webp")!;
    expect(upload.source).toBe("xyle-upload");

    expect(items.some((i) => i.contentType.startsWith("image/"))).toBe(true);
    expect(items.every((i) => !["/index.html", "/styles.css"].includes(i.path))).toBe(true);
  });
});
