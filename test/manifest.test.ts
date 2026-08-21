import { describe, expect, it } from "vitest";
import {
  computeSnapshotDigest,
  digestBytes,
  isReservedSitePath,
  normalizeSitePath,
  scanStaticDirectory,
} from "../src/manifest.ts";

describe("digestBytes", () => {
  it("hashes raw bytes with SHA-256", async () => {
    expect(
      await digestBytes(new TextEncoder().encode("abc")),
    ).toBe(
      "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("produces distinct digests for different bytes", async () => {
    const a = await digestBytes(new TextEncoder().encode("a"));
    const b = await digestBytes(new TextEncoder().encode("b"));
    expect(a).not.toBe(b);
  });
});

describe("normalizeSitePath", () => {
  it("normalizes paths to root-relative POSIX paths", () => {
    expect(normalizeSitePath("assets\\hero.jpg")).toBe("/assets/hero.jpg");
  });

  it("removes redundant dot segments", () => {
    expect(normalizeSitePath("./assets/./hero.jpg")).toBe("/assets/hero.jpg");
  });

  it("collapses duplicate slashes to one leading slash", () => {
    expect(normalizeSitePath("//assets//x.png")).toBe("/assets/x.png");
  });

  it("accepts an empty path as root", () => {
    expect(normalizeSitePath("")).toBe("/");
  });

  it("rejects traversal", () => {
    expect(() => normalizeSitePath("../secret")).toThrow();
    expect(() => normalizeSitePath("assets/../../secret")).toThrow();
  });

  it("rejects NUL bytes", () => {
    expect(() => normalizeSitePath("bad\0name")).toThrow();
  });
});

describe("scanStaticDirectory", () => {
  it("scans the canonical example", async () => {
    const { manifest, files } = await scanStaticDirectory(
      new URL("../example/plain-html/", import.meta.url).pathname,
    );
    expect(manifest.files["/index.html"]).toBeDefined();
    expect(manifest.files["/about.html"]?.contentType).toBe("text/html");
    expect(manifest.files["/assets/hero.webp"]?.contentType).toBe("image/webp");
    expect(manifest.files["/misc/team.jpg"]).toBeDefined();
    expect(manifest.files["/misc/unused-badge.png"]).toBeDefined();
    expect(manifest.files["/app.js"]?.contentType).toBe("text/javascript");
    expect(files.get("/styles.css")).toBeInstanceOf(Uint8Array);

    const index = files.get("/index.html");
    expect(index).toBeDefined();
    expect(manifest.files["/index.html"]?.digest).toBe(
      await digestBytes(index as Uint8Array),
    );
  });

  it("fails closed on reserved-path collisions", async () => {
    expect(isReservedSitePath("/edit")).toBe(true);
    expect(isReservedSitePath("/__xyle/api/page")).toBe(true);
    expect(isReservedSitePath("/_xyle/manifest.json")).toBe(true);
    expect(isReservedSitePath("/about.html")).toBe(false);
  });
});

describe("computeSnapshotDigest", () => {
  const file = (path: string) => ({
    path,
    digest: `sha256:${path}` as const,
    size: 1,
    contentType: "text/plain",
  });

  it("is independent of object insertion order", async () => {
    const a = { "/a.html": file("/a.html"), "/b.css": file("/b.css") };
    const b = { "/b.css": file("/b.css"), "/a.html": file("/a.html") };
    expect(await computeSnapshotDigest(a)).toBe(await computeSnapshotDigest(b));
  });

  it("changes when a file digest changes", async () => {
    const a = { "/a.html": file("/a.html") };
    const b = {
      "/a.html": { ...file("/a.html"), digest: "sha256:other" as const },
    };
    expect(await computeSnapshotDigest(a)).not.toBe(
      await computeSnapshotDigest(b),
    );
  });
});
