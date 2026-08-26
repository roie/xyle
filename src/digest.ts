import type { ManifestFile, XyleDigest } from "./types.ts";

/** Hash raw bytes without applying text decoding or normalization. */
export async function digestBytes(bytes: Uint8Array): Promise<XyleDigest> {
  const hash = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  const hex = Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
  return `sha256:${hex}`;
}

/** Build a deterministic digest from normalized site paths and their file digests. */
export async function computeSnapshotDigest(
  files: Record<string, ManifestFile>,
): Promise<XyleDigest> {
  const paths = Object.keys(files).sort();
  const parts: number[] = [];
  const encoder = new TextEncoder();
  for (const path of paths) {
    const entry = files[path];
    if (!entry) throw new Error(`missing manifest entry for ${path}`);
    for (const chunk of [path, "\0", entry.digest, "\n"]) {
      parts.push(...encoder.encode(chunk));
    }
  }
  return digestBytes(new Uint8Array(parts));
}
