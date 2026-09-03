import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FilesystemPublisher, MANIFEST_PATH } from "../src/publishers/filesystem.ts";
import { digestBytes } from "../src/manifest.ts";
import type { PublishedSnapshot, SiteFile, XyleManifest } from "../src/types.ts";

const enc = new TextEncoder();

async function makeSiteFile(path: string, text: string): Promise<SiteFile> {
  const bytes = enc.encode(text);
  return { path, bytes, digest: await digestBytes(bytes), contentType: "text/html" };
}

async function manifestWithFiles(
  base: PublishedSnapshot,
  files: SiteFile[],
): Promise<XyleManifest> {
  const entries = { ...base.manifest.files };
  for (const file of files) {
    entries[file.path] = {
      digest: file.digest,
      size: file.bytes.byteLength,
      contentType: file.contentType,
    };
  }
  const { computeSnapshotDigest } = await import("../src/manifest.ts");
  return {
    version: 1,
    snapshotDigest: await computeSnapshotDigest(entries),
    files: entries,
  };
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

  it("detects external edits even when an older manifest marker exists", async () => {
    const publisher = new FilesystemPublisher({ root });
    const before = await publisher.readSnapshot();
    await mkdir(join(root, "_xyle"), { recursive: true });
    await writeFile(join(root, MANIFEST_PATH), JSON.stringify(before.manifest));
    await writeFile(join(root, "index.html"), "<h1>changed outside Xyle</h1>");
    const after = await publisher.readSnapshot();
    expect(after.snapshotDigest).not.toBe(before.snapshotDigest);
    expect(after.manifest.files["/index.html"]?.digest).not.toBe(
      before.manifest.files["/index.html"]?.digest,
    );
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

  it("rejects a symlinked destination parent", async () => {
    const outside = await mkdtemp(join(tmpdir(), "xyle-pub-outside-"));
    try {
      const publisher = new FilesystemPublisher({ root });
      const base = await publisher.readSnapshot();
      await symlink(outside, join(root, "nested"), "dir");
      const added = await makeSiteFile("/nested/page.html", "<h1>outside</h1>");
      const manifest = await manifestWithFiles(base, [added]);

      await expect(
        publisher.publish({
          baseSnapshotDigest: base.snapshotDigest,
          manifest,
          changedFiles: [],
          addedFiles: [added],
        }),
      ).rejects.toThrow(/symlinked parent/);
      await expect(readFile(join(outside, "page.html"), "utf8")).rejects.toThrow();
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("rejects a symlink at the final destination", async () => {
    const outside = join(tmpdir(), `xyle-pub-outside-${Date.now()}.html`);
    await writeFile(outside, "outside stays unchanged");
    try {
      const publisher = new FilesystemPublisher({ root });
      const base = await publisher.readSnapshot();
      await symlink(outside, join(root, "about.html"));
      const added = await makeSiteFile("/about.html", "<h1>replacement</h1>");
      const manifest = await manifestWithFiles(base, [added]);

      await expect(
        publisher.publish({
          baseSnapshotDigest: base.snapshotDigest,
          manifest,
          changedFiles: [],
          addedFiles: [added],
        }),
      ).rejects.toThrow(/target is a symlink/);
      expect(await readFile(outside, "utf8")).toBe("outside stays unchanged");
    } finally {
      await rm(outside, { force: true });
    }
  });

  it("rejects a symlinked manifest parent and rolls back page writes", async () => {
    const outside = await mkdtemp(join(tmpdir(), "xyle-pub-manifest-outside-"));
    try {
      const publisher = new FilesystemPublisher({ root });
      const base = await publisher.readSnapshot();
      const before = await readFile(join(root, "index.html"), "utf8");
      const changed = await makeSiteFile("/index.html", "<h1>must roll back</h1>");
      const manifest = await manifestWithFiles(base, [changed]);
      await symlink(outside, join(root, "_xyle"), "dir");

      await expect(
        publisher.publish({
          baseSnapshotDigest: base.snapshotDigest,
          manifest,
          changedFiles: [changed],
          addedFiles: [],
        }),
      ).rejects.toThrow(/symlinked parent/);
      expect(await readFile(join(root, "index.html"), "utf8")).toBe(before);
      await expect(readFile(join(outside, "manifest.json"), "utf8")).rejects.toThrow();
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("publishes HTML + a new image together", async () => {
    const publisher = new FilesystemPublisher({ root });
    const base = await publisher.readSnapshot();

    const pngBytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64",
    );
    const imageDigest = await digestBytes(new Uint8Array(pngBytes));
    const imagePath = `/__media/${imageDigest.slice("sha256:".length)}.png`;
    const html = await makeSiteFile("/index.html", `<img src="${imagePath}">`);
    const image: SiteFile = {
      path: imagePath,
      bytes: new Uint8Array(pngBytes),
      digest: imageDigest,
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
      [imagePath]: {
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

    expect(await readFile(join(root, imagePath.slice(1)))).toEqual(pngBytes);
    expect((await publisher.readSnapshot()).manifest.files[imagePath]).toBeDefined();
  });

  it("serializes concurrent compare-and-swap publishes", async () => {
    const publisher = new FilesystemPublisher({ root });
    const base = await publisher.readSnapshot();
    const changed = await makeSiteFile("/index.html", "<h1>first winner</h1>");
    const files = {
      ...base.manifest.files,
      "/index.html": {
        digest: changed.digest,
        size: changed.bytes.byteLength,
        contentType: changed.contentType,
      },
    };
    const manifest = {
      version: 1 as const,
      snapshotDigest: await (await import("../src/manifest.ts")).computeSnapshotDigest(files),
      files,
    };
    const request = {
      baseSnapshotDigest: base.snapshotDigest,
      manifest,
      changedFiles: [changed],
      addedFiles: [],
    };
    const results = await Promise.allSettled([
      publisher.publish(request),
      publisher.publish(request),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await readFile(join(root, "index.html"), "utf8")).toBe("<h1>first winner</h1>");
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
