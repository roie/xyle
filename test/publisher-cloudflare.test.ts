import { access, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { computeSnapshotDigest, digestBytes } from "../src/digest.ts";
import {
  CloudflareConfigurationError,
  CloudflarePagesPublisher,
} from "../src/publishers/cloudflare.ts";
import type { PublishedSnapshot, XyleManifest } from "../src/types.ts";

interface CloudflarePublisherInternals {
  assertSupportedProject(): Promise<void>;
  stageControlRuntime(staging: string): Promise<void>;
  runWrangler(staging: string): Promise<string>;
}

async function manifestFor(files: Record<string, Uint8Array>): Promise<XyleManifest> {
  const entries: XyleManifest["files"] = {};
  for (const [path, bytes] of Object.entries(files)) {
    entries[path] = {
      digest: await digestBytes(bytes),
      size: bytes.byteLength,
      contentType: path.endsWith(".html") ? "text/html" : "text/plain",
    };
  }
  return { version: 1, snapshotDigest: await computeSnapshotDigest(entries), files: entries };
}

function internals(publisher: CloudflarePagesPublisher): CloudflarePublisherInternals {
  return publisher as unknown as CloudflarePublisherInternals;
}

describe("Cloudflare publication staging", () => {
  it("rejects unchanged local bytes that differ from the final manifest", async () => {
    const root = await mkdtemp(join(tmpdir(), "xyle-cloudflare-"));
    try {
      const remoteBytes = new TextEncoder().encode("remote");
      await writeFile(join(root, "index.html"), "local divergence");
      const manifest = await manifestFor({ "/index.html": remoteBytes });
      const publisher = new CloudflarePagesPublisher({ root, projectName: "test" });
      const current: PublishedSnapshot = { snapshotDigest: manifest.snapshotDigest, manifest };
      publisher.readSnapshot = async () => current;
      internals(publisher).stageControlRuntime = async () => {};
      const runWrangler = vi.fn(async () => "deployment-id");
      internals(publisher).runWrangler = runWrangler;

      await expect(
        publisher.publish({
          baseSnapshotDigest: manifest.snapshotDigest,
          manifest,
          changedFiles: [],
          addedFiles: [],
          managedFiles: [],
          removedFiles: [],
        }),
      ).rejects.toThrow(
        new CloudflareConfigurationError(
          "Refusing deployment: staged file does not match the final manifest: /index.html",
        ),
      );
      expect(runWrangler).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("omits local files that are absent from an adopted manifest", async () => {
    const root = await mkdtemp(join(tmpdir(), "xyle-cloudflare-"));
    try {
      const indexBytes = new TextEncoder().encode("published");
      await writeFile(join(root, "index.html"), indexBytes);
      await writeFile(join(root, "local-only.txt"), "must not deploy");
      const manifest = await manifestFor({ "/index.html": indexBytes });
      const publisher = new CloudflarePagesPublisher({ root, projectName: "test" });
      internals(publisher).assertSupportedProject = async () => {};
      internals(publisher).stageControlRuntime = async () => {};
      internals(publisher).runWrangler = async (staging) => {
        expect(await readdir(staging)).not.toContain("local-only.txt");
        await expect(access(join(staging, "local-only.txt"))).rejects.toMatchObject({
          code: "ENOENT",
        });
        return "deployment-id";
      };

      const result = await publisher.bootstrap(manifest);

      expect(result.snapshot).toEqual({ snapshotDigest: manifest.snapshotDigest, manifest });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
