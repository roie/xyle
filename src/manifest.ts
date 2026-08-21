import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ManifestFile, XyleDigest, XyleManifest } from "./types.ts";

const RESERVED_PREFIXES = ["/edit", "/__xyle/", "/__media/", "/_xyle/"];
export const RESERVED_PATHS = [
  "/edit",
  "/_xyle/manifest.json",
  ...RESERVED_PREFIXES,
];

export async function digestBytes(bytes: Uint8Array): Promise<XyleDigest> {
  const hash = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  const hex = Array.from(new Uint8Array(hash), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  return `sha256:${hex}`;
}

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

export async function computeSnapshotDigest(
  files: Record<string, ManifestFile>,
): Promise<XyleDigest> {
  const paths = Object.keys(files).sort();
  const parts: number[] = [];
  for (const path of paths) {
    const entry = files[path];
    if (!entry) throw new Error(`missing manifest entry for ${path}`);
    for (const chunk of [path, "\0", entry.digest, "\n"]) {
      parts.push(...new TextEncoder().encode(chunk));
    }
  }
  return digestBytes(new Uint8Array(parts));
}

async function walk(dir: string, base: string, out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await walk(full, rel, out);
    } else if (entry.isFile()) {
      out.push(rel);
    }
  }
}

export async function scanStaticDirectory(
  root: string,
): Promise<{ manifest: XyleManifest; files: Map<string, Uint8Array> }> {
  const relativePaths: string[] = [];
  await walk(root, "", relativePaths);

  const files = new Map<string, Uint8Array>();
  const manifestFiles: Record<string, ManifestFile> = {};

  for (const rel of relativePaths.sort()) {
    const sitePath = normalizeSitePath(rel);
    if (isReservedSitePath(sitePath)) {
      throw new Error(`site file collides with reserved Xyle path: ${sitePath}`);
    }
    const bytes = await readFile(join(root, rel));
    const info = await stat(join(root, rel));
    files.set(sitePath, new Uint8Array(bytes));
    const ext = rel.slice(rel.lastIndexOf("."));
    manifestFiles[sitePath] = {
      digest: await digestBytes(new Uint8Array(bytes)),
      size: info.size,
      contentType: contentTypeFor(ext),
    };
  }

  const manifest: XyleManifest = {
    version: 1,
    snapshotDigest: await computeSnapshotDigest(manifestFiles),
    files: manifestFiles,
  };
  return { manifest, files };
}
