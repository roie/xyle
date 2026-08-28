const SEPARATOR = "\u001f";

/** Deterministic, opaque identity for source-backed editor targets. */
export function stableIdentity(parts: readonly string[]): string {
  const input = parts.join(SEPARATOR);
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `x-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function sourceTargetIdentity(
  pagePath: string,
  kind: string,
  sourceStart: number,
  sourceEnd: number,
  tag: string,
): string {
  return stableIdentity(["target", pagePath, kind, tag, String(sourceStart), String(sourceEnd)]);
}
