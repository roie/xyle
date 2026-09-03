const SEPARATOR = "\u001f";

/** Deterministic, opaque identity for source-backed editor targets. */
export function stableIdentity(parts: readonly string[]): string {
  const input = parts.join(SEPARATOR);
  let hash = 14_695_981_039_346_656_037n;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 1_099_511_628_211n);
  }
  return `x-${hash.toString(16).padStart(16, "0")}`;
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
