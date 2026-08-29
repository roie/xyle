import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { isControlSitePath, isPathInsideRoot } from "../control-paths.ts";
import {
  buildManifestFromDirectory,
  isManagedLayoutAssetPath as isManagedManifestAssetPath,
  validateManagedAssetManifest,
  validateManifest,
  XYLE_MANAGED_ASSET_MANIFEST_PATH,
} from "../manifest.ts";
import type { PublishResult, PublishSnapshot, PublishedSnapshot, Publisher } from "../types.ts";

export const MANIFEST_PATH = "/_xyle/manifest.json";
const publishQueues = new Map<string, Promise<void>>();

export class StaleSnapshotError extends Error {
  readonly currentDigest: string;
  readonly expectedDigest: string;
  constructor(currentDigest: string, expectedDigest: string) {
    super(`stale snapshot: expected ${expectedDigest}, current ${currentDigest}`);
    this.name = "StaleSnapshotError";
    this.currentDigest = currentDigest;
    this.expectedDigest = expectedDigest;
  }
}

function assertInsideRoot(root: string, sitePath: string): string {
  if (
    (isControlSitePath(sitePath) &&
      !isManagedManifestAssetPath(sitePath) &&
      sitePath !== XYLE_MANAGED_ASSET_MANIFEST_PATH) ||
    sitePath === MANIFEST_PATH
  ) {
    throw new Error(`Xyle control path cannot be published: ${sitePath}`);
  }
  const target = resolve(root, `.${sitePath}`);
  if (!isPathInsideRoot(root, target)) throw new Error(`path escapes static root: ${sitePath}`);
  return target;
}

async function writeDurable(path: string, bytes: Uint8Array): Promise<void> {
  const handle = await open(path, "w");
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export interface FilesystemPublisherOptions {
  root: string;
}

export class FilesystemPublisher implements Publisher {
  private readonly rootAbs: string;
  constructor(options: FilesystemPublisherOptions) {
    this.rootAbs = resolve(options.root);
  }
  get root(): string {
    return this.rootAbs;
  }

  async readSnapshot(): Promise<PublishedSnapshot> {
    // A marker is advisory only. Re-scanning detects external edits after a publish.
    const markerPath = join(this.rootAbs, MANIFEST_PATH);
    try {
      // Validate any marker, but never let it define the snapshot. Invalid old
      // markers are ignored and cannot make a control file part of site state.
      await validateManifest(JSON.parse(await readFile(markerPath, "utf8")));
    } catch {
      // Missing or untrusted markers are equivalent to first adoption.
    }
    const { manifest } = await buildManifestFromDirectory(this.rootAbs);
    return { snapshotDigest: manifest.snapshotDigest, manifest };
  }

  async publish(next: PublishSnapshot): Promise<PublishResult> {
    const previous = publishQueues.get(this.rootAbs) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate;
    });
    const queued = previous.then(() => gate);
    publishQueues.set(this.rootAbs, queued);
    await previous;
    try {
      return await this.publishLocked(next);
    } finally {
      release();
      if (publishQueues.get(this.rootAbs) === queued) publishQueues.delete(this.rootAbs);
    }
  }

  private async publishLocked(next: PublishSnapshot): Promise<PublishResult> {
    await validateManifest(next.manifest);
    const current = await this.readSnapshot();
    if (current.snapshotDigest !== next.baseSnapshotDigest)
      throw new StaleSnapshotError(current.snapshotDigest, next.baseSnapshotDigest);
    const allFiles = [...next.changedFiles, ...next.addedFiles, ...(next.managedFiles ?? [])];
    for (const file of allFiles) {
      assertInsideRoot(this.rootAbs, file.path);
      if (file.path === XYLE_MANAGED_ASSET_MANIFEST_PATH) {
        try {
          await validateManagedAssetManifest(JSON.parse(new TextDecoder().decode(file.bytes)));
        } catch {
          throw new Error("malformed managed Layout asset manifest");
        }
        continue;
      }
      if (isManagedManifestAssetPath(file.path)) {
        if (
          file.contentType !== "text/css" ||
          next.manifest.files[file.path]?.digest !== file.digest
        ) {
          throw new Error(`invalid managed Layout asset: ${file.path}`);
        }
        continue;
      }
      if (file.path.startsWith("/__media/")) {
        const extension = (
          {
            "image/jpeg": "jpg",
            "image/png": "png",
            "image/webp": "webp",
            "image/avif": "avif",
          } as Record<string, string>
        )[file.contentType];
        if (
          !extension ||
          file.path !== `/__media/${file.digest.slice("sha256:".length)}.${extension}`
        ) {
          throw new Error(`invalid Xyle upload path: ${file.path}`);
        }
      }
      if (
        next.manifest.files[file.path]?.digest !== file.digest ||
        next.manifest.files[file.path]?.size !== file.bytes.byteLength
      ) {
        throw new Error(`publish file does not match manifest: ${file.path}`);
      }
    }
    const removedFiles = next.removedFiles ?? [];
    for (const path of removedFiles) {
      if (path !== XYLE_MANAGED_ASSET_MANIFEST_PATH && !isManagedManifestAssetPath(path)) {
        throw new Error(`invalid removed Xyle asset: ${path}`);
      }
      assertInsideRoot(this.rootAbs, path);
    }
    const backups = new Map<string, Uint8Array | null>();
    const tempPaths: string[] = [];
    try {
      for (const file of allFiles) {
        const finalPath = assertInsideRoot(this.rootAbs, file.path);
        const tempPath = `${finalPath}.xyle-tmp-${randomUUID()}`;
        tempPaths.push(tempPath);
        await mkdir(dirname(finalPath), { recursive: true });
        await writeDurable(tempPath, file.bytes);
      }
      for (let i = 0; i < allFiles.length; i++) {
        const file = allFiles[i];
        const tempPath = tempPaths[i];
        if (!file || !tempPath) throw new Error("publish staging mismatch");
        const finalPath = assertInsideRoot(this.rootAbs, file.path);
        backups.set(file.path, await readIfExists(finalPath));
        await rename(tempPath, finalPath);
      }
      for (const path of removedFiles) {
        if (backups.has(path)) continue;
        const finalPath = assertInsideRoot(this.rootAbs, path);
        backups.set(path, await readIfExists(finalPath));
        await rm(finalPath, { force: true });
      }
      const manifestBytes = new TextEncoder().encode(JSON.stringify(next.manifest, null, 2));
      const manifestFinal = join(this.rootAbs, MANIFEST_PATH);
      await mkdir(dirname(manifestFinal), { recursive: true });
      const manifestTemp = `${manifestFinal}.xyle-tmp-${randomUUID()}`;
      tempPaths.push(manifestTemp);
      await writeDurable(manifestTemp, manifestBytes);
      await rename(manifestTemp, manifestFinal);
      return {
        snapshot: { snapshotDigest: next.manifest.snapshotDigest, manifest: next.manifest },
        id: `pub-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`,
      };
    } catch (error) {
      for (const [sitePath, backup] of [...backups.entries()].slice().reverse()) {
        try {
          const finalPath = assertInsideRoot(this.rootAbs, sitePath);
          if (backup === null) await rm(finalPath, { force: true });
          else await writeDurable(finalPath, backup);
        } catch {
          /* best effort */
        }
      }
      for (const tempPath of tempPaths) await rm(tempPath, { force: true }).catch(() => {});
      throw error;
    }
  }
}

async function readIfExists(path: string): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await readFile(path));
  } catch {
    return null;
  }
}

export function contentTypeForUpload(filename: string): string {
  const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  return (
    (
      {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".avif": "image/avif",
      } as Record<string, string>
    )[ext] ?? "application/octet-stream"
  );
}
