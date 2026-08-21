import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FilesystemPublisher, MANIFEST_PATH } from "../src/publishers/filesystem.ts";
import { digestBytes } from "../src/manifest.ts";
import type { SiteFile } from "../src/types.ts";

const enc = new TextEncoder();

async function makeSiteFile(path: string, text: string): Promise<SiteFile> {
  const bytes = enc.encode(text);
  return { path, bytes, digest: await digestBytes(bytes), contentType: "text/html" };
}

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "xyle-pub-"));
  await writeFile(
    join(root, "index.html"),
    "<!doctype html><html><head><title>t</title></head><body><h1>start</h1></body></html>",
  );
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("FilesystemPublisher", () => {
  it("adopts a fresh directory as its initial snapshot", async () => {
    const publisher = new FilesystemPublisher({ root });
    const snapshot = await publisher.readSnapshot();
    expect(snapshot.manifest.files["/index.html"]).toBeDefined();
    expect(snapshot.snapshotDigest).toMatch(/^sha256:/);
  });

  it("publishes a single HTML change and writes manifest last", async () => {
    const publisher = new FilesystemPublisher({ root });
    const base = await publisher.readSnapshot();
    expect(await readFile(join(root, MANIFEST_PATH), "utf8").catch(() => null)).toBeNull();

    const changed = await makeSiteFile("/index.html", "<h1>updated</h1>");
    const nextFiles = { ...base.manifest.files };
    delete (nextFiles as Record<string, unknown>)["/index.html"];
    const { computeSnapshotDigest } = await import("../src/manifest.ts");
    const manifest = {
      version: 1 as const,
      snapshotDigest: await computeSnapshotDigest({
        ...nextFiles,
        "/index.html": {
          digest: changed.digest,
          size: changed.bytes.length,
          contentType: changed.contentType,
        },
      }),
      files: {
        ...nextFiles,
        "/index.html": {
          digest: changed.digest,
          size: changed.bytes.length,
          contentType: changed.contentType,
        },
      },
    };

    const result = await publisher.publish({
      baseSnapshotDigest: base.snapshotDigest,
      manifest,
      changedFiles: [changed],
      addedFiles: [],
    });

    expect(result.snapshot.snapshotDigest).toBe(manifest.snapshotDigest);
    expect(await readFile(join(root, "index.html"), "utf8")).toBe("<h1>updated</h1>");
    const written = JSON.parse(await readFile(join(root, MANIFEST_PATH), "utf8"));
    expect(written.files["/index.html"].digest).toBe(changed.digest);

    // restart sees published state
    const reread = await new FilesystemPublisher({ root }).readSnapshot();
    expect(reread.snapshotDigest).toBe(result.snapshot.snapshotDigest);
  });

  it("rejects stale base snapshots", async () => {
    const publisher = new FilesystemPublisher({ root });
    const base = await publisher.readSnapshot();

    // simulate out-of-band site change
    await writeFile(join(root, "index.html"), "<h1>changed externally</h1>");
    const current = await new FilesystemPublisher({ root }).readSnapshot();
    expect(current.snapshotDigest).not.toBe(base.snapshotDigest);

    const changed = await makeSiteFile("/index.html", "<h1>x</h1>");
    const manifest = structuredClone(current.manifest);
    await expect(
      publisher.publish({
        baseSnapshotDigest: base.snapshotDigest,
        manifest,
        changedFiles: [changed],
        addedFiles: [],
      }),
    ).rejects.toThrow(/stale/);
    expect(await readFile(join(root, "index.html"), "utf8")).toContain("changed externally");
  });

  it("publishes HTML + a new image together", async () => {
    const publisher = new FilesystemPublisher({ root });
    const base = await publisher.readSnapshot();

    const html = await makeSiteFile("/index.html", '<img src="/__media/pic.png">');
    const pngBytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64",
    );
    const image: SiteFile = {
      path: "/__media/pic.png",
      bytes: new Uint8Array(pngBytes),
      digest: await digestBytes(new Uint8Array(pngBytes)),
      contentType: "image/png",
    };

    const files = { ...base.manifest.files };
    delete (files as Record<string, unknown>)["/index.html"];
    const { computeSnapshotDigest } = await import("../src/manifest.ts");
    const updated = {
      ...files,
      "/index.html": {
        digest: html.digest,
        size: html.bytes.length,
        contentType: "text/html",
      },
      "/__media/pic.png": {
        digest: image.digest,
        size: image.bytes.length,
        contentType: "image/png",
      },
    };
    const manifest = {
      version: 1 as const,
      snapshotDigest: await computeSnapshotDigest(updated),
      files: updated,
    };

    await publisher.publish({
      baseSnapshotDigest: base.snapshotDigest,
      manifest,
      changedFiles: [html],
      addedFiles: [image],
    });

    expect(await readFile(join(root, "__media/pic.png"))).toEqual(pngBytes);
  });

  it("rolls back all files when a later write fails", async () => {
    const publisher = new FilesystemPublisher({ root });
    const base = await publisher.readSnapshot();

    const before = await readFile(join(root, "index.html"), "utf8");

    const first = await makeSiteFile("/index.html", "<h1>first</h1>");
    const second = await makeSiteFile("/about.html", "<h1>second</h1>");

    const { computeSnapshotDigest } = await import("../src/manifest.ts");
    const files = {
      "/index.html": {
        digest: first.digest,
        size: first.bytes.length,
        contentType: "text/html",
      },
      "/about.html": {
        digest: second.digest,
        size: second.bytes.length,
        contentType: "text/html",
      },
    };
    const manifest = {
      version: 1 as const,
      snapshotDigest: await computeSnapshotDigest(files),
      files,
    };

    // make the second rename fail by placing a directory where the file goes
    await mkdir(join(root, "about.html"));
    try {
      await publisher.publish({
        baseSnapshotDigest: base.snapshotDigest,
        manifest,
        changedFiles: [first, second],
        addedFiles: [],
      });
      throw new Error("expected publish to fail");
    } catch (error) {
      expect((error as Error).message).not.toContain("expected publish");
    }

    expect(await readFile(join(root, "index.html"), "utf8")).toBe(before);
  });
});
