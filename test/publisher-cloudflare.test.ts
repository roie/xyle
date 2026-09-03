import { access, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { computeSnapshotDigest, digestBytes } from "../src/digest.ts";
import {
  CloudflareConfigurationError,
  CloudflarePagesPublisher,
} from "../src/publishers/cloudflare.ts";
import type { PublishedSnapshot, XyleManifest } from "../src/types.ts";

afterEach(() => vi.unstubAllGlobals());

interface CloudflarePublisherInternals {
  assertSupportedProject(): Promise<void>;
  stageControlRuntime(staging: string): Promise<XyleManifest["files"]>;
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
      internals(publisher).stageControlRuntime = async () => ({});
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

  it("validates managed manifest bytes and schema before staging", async () => {
    const root = await mkdtemp(join(tmpdir(), "xyle-cloudflare-"));
    try {
      const manifest = await manifestFor({});
      const publisher = new CloudflarePagesPublisher({ root, projectName: "test" });
      const current: PublishedSnapshot = { snapshotDigest: manifest.snapshotDigest, manifest };
      publisher.readSnapshot = async () => current;
      internals(publisher).stageControlRuntime = async () => ({});
      const runWrangler = vi.fn(async () => "deployment-id");
      internals(publisher).runWrangler = runWrangler;
      const bytes = new TextEncoder().encode("{}");
      const publishWithDigest = (digest: `sha256:${string}`) =>
        publisher.publish({
          baseSnapshotDigest: manifest.snapshotDigest,
          manifest,
          changedFiles: [],
          addedFiles: [],
          managedFiles: [
            {
              path: "/__xyle/manifest.json",
              bytes,
              digest,
              contentType: "application/json",
            },
          ],
          removedFiles: [],
        });

      await expect(publishWithDigest("sha256:incorrect")).rejects.toThrow(
        /bytes do not match their digest/,
      );
      await expect(publishWithDigest(await digestBytes(bytes))).rejects.toThrow(
        /malformed managed Layout asset manifest/,
      );
      expect(runWrangler).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reads the private remote manifest with the management secret", async () => {
    const root = await mkdtemp(join(tmpdir(), "xyle-cloudflare-"));
    const manifest = await manifestFor({});
    const requests: Request[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const request = new Request(input, init);
        requests.push(request);
        if (request.url.includes("api.cloudflare.com")) {
          return Response.json({ result: { source: null } });
        }
        if (request.url.endsWith("/__xyle/api/session")) {
          return Response.json({ authenticated: false }, { headers: { "x-xyle-runtime": "1" } });
        }
        if (request.url.endsWith("/__xyle/api/managed-manifest")) {
          return Response.json(manifest);
        }
        return new Response(null, { status: 404 });
      }),
    );
    try {
      const publisher = new CloudflarePagesPublisher({
        root,
        projectName: "test",
        accountId: "account",
        apiToken: "token",
        managementSecret: "management-secret",
      });

      await expect(publisher.readSnapshot()).resolves.toEqual({
        snapshotDigest: manifest.snapshotDigest,
        manifest,
      });
      const managedRequest = requests.find((request) =>
        request.url.endsWith("/__xyle/api/managed-manifest"),
      );
      expect(managedRequest?.headers.get("x-xyle-management-secret")).toBe("management-secret");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("stages the packaged editor and self-preserving Worker runtime", async () => {
    const root = await mkdtemp(join(tmpdir(), "xyle-cloudflare-root-"));
    const runtime = await mkdtemp(join(tmpdir(), "xyle-cloudflare-runtime-"));
    const staging = await mkdtemp(join(tmpdir(), "xyle-cloudflare-staging-"));
    try {
      await writeFile(join(runtime, "editor.js"), "editor");
      await writeFile(join(runtime, "cloudflare-worker.js"), "export default {};");
      await writeFile(join(runtime, "xyle-worker.bundle"), "worker bundle");
      const publisher = new CloudflarePagesPublisher({
        root,
        projectName: "test",
        runtimeDirectory: runtime,
      });

      const entries = await internals(publisher).stageControlRuntime(staging);

      expect(await readFile(join(staging, "_xyle", "editor.js"), "utf8")).toBe("editor");
      expect(await readFile(join(staging, "_worker.js"), "utf8")).toBe("export default {};");
      expect(await readFile(join(staging, "_xyle", "worker.bundle"), "utf8")).toBe("worker bundle");
      expect(entries).toHaveProperty("/_xyle/editor.js");
      expect(entries).toHaveProperty("/_xyle/worker.bundle");
      expect(await readFile(join(staging, "_routes.json"), "utf8")).toContain('"/_xyle/*"');
    } finally {
      await Promise.all(
        [root, runtime, staging].map((path) => rm(path, { recursive: true, force: true })),
      );
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
      internals(publisher).stageControlRuntime = async () => ({});
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
