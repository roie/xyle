import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { isControlSitePath, isLocalXyleStatePath } from "./control-paths.ts";
import { computeSnapshotDigest, digestBytes } from "./digest.ts";
import type { ManifestFile, XyleManifest } from "./types.ts";

export { computeSnapshotDigest, digestBytes } from "./digest.ts";

const XYLE_MANIFEST_PATH = "/_xyle/manifest.json";
const RESERVED_PREFIXES = ["/edit", "/__xyle/", "/__media/"];
export const RESERVED_PATHS = ["/edit", XYLE_MANIFEST_PATH, ...RESERVED_PREFIXES];

export function normalizeSitePath(path: string): string {
  if (path.includes("\0")) throw new Error("path contains NUL byte");
  const posix = path.replaceAll("\\", "/");
  if (posix.split("/").includes("..")) throw new Error(`path traversal: ${path}`);
  const segments = posix.split("/").filter((s) => s.length > 0 && s !== ".");
  return `/${segments.join("/")}`;
}

export function isReservedSitePath(sitePath: string): boolean {
  if (sitePath === "/") return false;
  return RESERVED_PATHS.some(
    (r) => sitePath === r || sitePath.startsWith(r.endsWith("/") ? r : `${r}/`),
  );
}

function contentTypeFor(ext: string): string {
  const map: Record<string, string> = {
    ".html": "text/html",
    ".htm": "text/html",
    ".css": "text/css",
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".ico": "image/x-icon",
    ".txt": "text/plain",
    ".xml": "application/xml",
    ".pdf": "application/pdf",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
  };
  return map[ext.toLowerCase()] ?? "application/octet-stream";
}

/** Reject attacker-controlled manifest data before it influences publish state. */
export async function validateManifest(manifest: unknown): Promise<XyleManifest> {
  if (!manifest || typeof manifest !== "object") throw new Error("malformed Xyle manifest");
  const candidate = manifest as Partial<XyleManifest>;
  if (
    candidate.version !== 1 ||
    typeof candidate.snapshotDigest !== "string" ||
    !candidate.snapshotDigest.startsWith("sha256:") ||
    !candidate.files ||
    typeof candidate.files !== "object" ||
    Array.isArray(candidate.files)
  ) {
    throw new Error("malformed Xyle manifest");
  }
  for (const [path, entry] of Object.entries(candidate.files)) {
    if (
      normalizeSitePath(path) !== path ||
      isControlSitePath(path) ||
      (isReservedSitePath(path) && !path.startsWith("/__media/"))
    ) {
      throw new Error(`untrusted manifest path: ${path}`);
    }
    if (
      !entry ||
      typeof entry !== "object" ||
      typeof entry.digest !== "string" ||
      !entry.digest.startsWith("sha256:") ||
      !Number.isSafeInteger(entry.size) ||
      entry.size < 0 ||
      typeof entry.contentType !== "string"
    ) {
      throw new Error(`malformed manifest entry: ${path}`);
    }
  }
  const typed = candidate as XyleManifest;
  if ((await computeSnapshotDigest(typed.files)) !== typed.snapshotDigest) {
    throw new Error("manifest snapshot digest does not match its files");
  }
  return typed;
}

async function walk(dir: string, base: string, out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    const sitePath = normalizeSitePath(rel);
    // Do not follow links: a symlink can point outside the site root.
    if (entry.isSymbolicLink() || isLocalXyleStatePath(sitePath)) continue;
    if (entry.isDirectory()) await walk(join(dir, entry.name), rel, out);
    else if (entry.isFile()) out.push(rel);
  }
}

function xyleUploadExtension(contentType: string): string | null {
  return (
    (
      {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
        "image/avif": "avif",
      } as Record<string, string>
    )[contentType] ?? null
  );
}

async function isValidXyleUploadPath(
  sitePath: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<boolean> {
  if (!sitePath.startsWith("/__media/")) return false;
  const extension = xyleUploadExtension(contentType);
  if (!extension) return false;
  const name = sitePath.slice("/__media/".length);
  const digest = await digestBytes(bytes);
  const expectedDigest = digest.slice("sha256:".length);
  return name === `${expectedDigest}.${extension}`;
}

export async function scanStaticDirectory(
  root: string,
): Promise<{ manifest: XyleManifest; files: Map<string, Uint8Array> }> {
  const relativePaths: string[] = [];
  await walk(root, "", relativePaths);
  const files = new Map<string, Uint8Array>();
  const manifestFiles = Object.create(null) as Record<string, ManifestFile>;
  for (const rel of relativePaths.sort((a, b) => a.localeCompare(b))) {
    const sitePath = normalizeSitePath(rel);
    const bytes = new Uint8Array(await readFile(join(root, rel)));
    if (sitePath === XYLE_MANIFEST_PATH) {
      try {
        await validateManifest(JSON.parse(new TextDecoder().decode(bytes)));
        continue;
      } catch {
        throw new Error(`site file collides with reserved Xyle path: ${sitePath}`);
      }
    }
    const contentType = contentTypeFor(rel.slice(rel.lastIndexOf(".")));
    if (isReservedSitePath(sitePath)) {
      const validUpload = sitePath.startsWith("/__media/")
        ? await isValidXyleUploadPath(sitePath, bytes, contentType)
        : false;
      if (!validUpload) {
        throw new Error(`site file collides with reserved Xyle path: ${sitePath}`);
      }
    }
    const info = await stat(join(root, rel));
    files.set(sitePath, bytes);
    manifestFiles[sitePath] = {
      digest: await digestBytes(bytes),
      size: info.size,
      contentType,
    };
  }
  const manifest: XyleManifest = {
    version: 1,
    snapshotDigest: await computeSnapshotDigest(manifestFiles),
    files: manifestFiles,
  };
  return { manifest, files };
}

export async function buildManifestFromDirectory(
  root: string,
): Promise<{ manifest: XyleManifest }> {
  const { manifest } = await scanStaticDirectory(root);
  return { manifest };
}
