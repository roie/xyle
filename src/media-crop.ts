import type { CropRect, Point } from "./types.ts";

/**
 * Return the normalized source rectangle shown by the crop editor.
 * The same rectangle is sent to Sharp when a crop is published.
 */
export function cropRectForFrame(
  sourceWidth: number,
  sourceHeight: number,
  frameWidth: number,
  frameHeight: number,
  zoom: number,
  focus: Point,
): CropRect {
  const sourceAspect = sourceWidth > 0 && sourceHeight > 0 ? sourceWidth / sourceHeight : 1;
  const frameAspect = frameWidth > 0 && frameHeight > 0 ? frameWidth / frameHeight : sourceAspect;
  const baseWidth = sourceAspect > frameAspect ? frameAspect / sourceAspect : 1;
  const baseHeight = sourceAspect > frameAspect ? 1 : sourceAspect / frameAspect;
  const width = Math.min(1, baseWidth / Math.max(1, zoom));
  const height = Math.min(1, baseHeight / Math.max(1, zoom));
  return {
    x: Math.min(1 - width, Math.max(0, focus.x - width / 2)),
    y: Math.min(1 - height, Math.max(0, focus.y - height / 2)),
    width,
    height,
  };
}
