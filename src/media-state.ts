import type { MediaSource, MediaState, Point, CropRect } from "./types.ts";

export function mediaSourcePath(source: MediaSource): string {
  return source.kind === "existing" ? source.src : source.assetId;
}

export function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function normalizePoint(point: Point | null): Point | null {
  if (!point) return null;
  return { x: clampUnit(point.x), y: clampUnit(point.y) };
}

export function normalizeCrop(crop: CropRect | null): CropRect | null {
  if (!crop) return null;
  const x = Math.min(1 - Number.EPSILON, Math.max(0, crop.x));
  const y = Math.min(1 - Number.EPSILON, Math.max(0, crop.y));
  const width = Math.min(1 - x, Math.max(Number.EPSILON, crop.width));
  const height = Math.min(1 - y, Math.max(Number.EPSILON, crop.height));
  return { x, y, width, height };
}

export function normalizeMediaState(state: MediaState): MediaState {
  return {
    source: state.source,
    alt: { present: state.alt.present, value: state.alt.value },
    crop: normalizeCrop(state.crop),
    focus: normalizePoint(state.focus),
    ...(state.framing ? { framing: { fit: state.framing.fit } } : {}),
  };
}

export function mediaStatesEqual(left: MediaState, right: MediaState): boolean {
  return JSON.stringify(normalizeMediaState(left)) === JSON.stringify(normalizeMediaState(right));
}
