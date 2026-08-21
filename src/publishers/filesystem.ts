import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  PublishResult,
  PublishSnapshot,
  PublishedSnapshot,
  Publisher,
  SiteFile,
  XyleManifest,
} from "../types.ts";
import { buildManifestFromDirectory, digestBytes } from "../manifest.ts";

export const MANIFEST_PATH = "/_xyle/manifest.json";

export class StaleSnapshotError extends Error {
  constructor(
    public readonly currentDigest: string,
    public readonly expectedDigest: string,
  ) {
    super(`stale snapshot: expected ${expectedDigest}, current ${currentDigest}`);
    this.name = "StaleSnapshotError";
  }
}

function assertInsideRoot(root: string, sitePath: string): string {
  const target = resolve(root, "." + sitePath);
  const normalizedRoot = resolve(root);
  if (target !== normalizedRoot && !target.startsWith(normalizedRoot + sep)) {
    throw new Error(`path escapes static root: ${sitePath}`);
  }
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

  constructor(private readonly options: FilesystemPublisherOptions) {
    this.rootAbs = resolve(options.root);
  }

  get root(): string {
    return this.rootAbs;
  }

  async readSnapshot(): Promise<PublishedSnapshot> {
    try {
      const raw = await readFile(join(this.rootAbs, MANIFEST_PATH), "utf8");
      const manifest = JSON.parse(raw) as XyleManifest;
      if (manifest?.version === 1 && typeof manifest.snapshotDigest === "string") {
        return { snapshotDigest: manifest.snapshotDigest, manifest };
      }
    } catch {
      // fall through to fresh adoption scan
    }
    const { manifest } = await buildManifestFromDirectory(this.rootAbs);
    return { snapshotDigest: manifest.snapshotDigest, manifest };
  }

  async publish(next: PublishSnapshot): Promise<PublishResult> {
    const current = await this.readSnapshot();
    if (current.snapshotDigest !== next.baseSnapshotDigest) {
      throw new StaleSnapshotError(current.snapshotDigest, next.baseSnapshotDigest);
    }

    const allFiles = [...next.changedFiles, ...next.addedFiles];
    // sitePath -> original bytes | null (null = file did not exist before)
    const backups = new Map<string, Uint8Array | null>();
    const renamed: string[] = [];
    const tempPaths: string[] = [];
    let manifestWritten = false;

    try {
      for (const file of allFiles) {
        const finalPath = assertInsideRoot(this.rootAbs, file.path);
        const tempPath = `${finalPath}.xyle-tmp-${randomUUID()}`;
        tempPaths.push(tempPath);
        await mkdir(dirname(finalPath), { recursive: true });
        await writeDurable(tempPath, file.bytes);
      }

      for (let i = 0; i < allFiles.length; i++) {
        const file = allFiles[i]!;
        const finalPath = assertInsideRoot(this.rootAbs, file.path);
        const tempPath = tempPaths[i]!;
        backups.set(file.path, await readIfExists(finalPath));
        await rename(tempPath, finalPath);
        renamed.push(finalPath);
      }

      // manifest goes last
      const manifestBytes = new TextEncoder().encode(
        JSON.stringify(next.manifest, null, 2),
      );
      const manifestFinal = assertInsideRoot(this.rootAbs, MANIFEST_PATH);
      await mkdir(dirname(manifestFinal), { recursive: true });
      const manifestTemp = `${manifestFinal}.xyle-tmp-${randomUUID()}`;
      tempPaths.push(manifestTemp);
      await writeDurable(manifestTemp, manifestBytes);
      await rename(manifestTemp, manifestFinal);
      manifestWritten = true;

      return {
        snapshot: {
          snapshotDigest: next.manifest.snapshotDigest,
          manifest: next.manifest,
        },
        id: `pub-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`,
      };
    } catch (error) {
      // restore originals in reverse order; manifest restored like any file
      const restoreTargets: [string, Uint8Array | null][] = [...backups.entries()];
      if (manifestWritten) {
        restoreTargets.push([MANIFEST_PATH, null]);
      }
      for (const [sitePath, backup] of restoreTargets.reverse()) {
        try {
          const finalPath = assertInsideRoot(this.rootAbs, sitePath);
          if (backup === null) {
            await rm(finalPath, { force: true });
          } else {
            await writeDurable(finalPath, backup);
          }
        } catch {
          // best-effort rollback
        }
      }
      for (const tempPath of tempPaths) {
        await rm(tempPath, { force: true }).catch(() => {});
      }
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
  const dot = filename.lastIndexOf(".");
  const ext = dot === -1 ? "" : filename.slice(dot).toLowerCase();
  const map: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".avif": "image/avif",
  };
  return map[ext] ?? "application/octet-stream";
}
