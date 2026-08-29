import type { LayoutPreset } from "./types.ts";

export const LAYOUT_ASSET_PREFIX = "/__xyle/assets/";
export const LAYOUT_RESOURCE_ATTRIBUTE = "data-xyle-resource";
export const LAYOUT_ATTRIBUTE = "data-xyle-layout";
export const LAYOUT_RESOURCE_VALUE = "layout-v1";
export const LAYOUT_REGION_ATTRIBUTE = "data-xyle-layout-region";

/** Fixed, product-owned CSS. It must not contain page or target-specific data. */
export const LAYOUT_CSS = `[data-xyle-layout="stack"] {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
}

[data-xyle-layout="split"] {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

@media (max-width: 48rem) {
  [data-xyle-layout="split"] {
    grid-template-columns: minmax(0, 1fr);
  }
}
`;

export interface LayoutRegionDescriptor {
  sourceStart: number;
  sourceEnd: number;
  signature: string;
}

export interface LayoutTargetDescriptor {
  id: string;
  signature: string;
  regions: [LayoutRegionDescriptor, LayoutRegionDescriptor];
  baseline: LayoutPreset;
  managedPreset?: LayoutPreset;
}

export function layoutRegionId(targetId: string, index: 0 | 1): string {
  return `${targetId}:region:${index}`;
}

export function layoutAttributeValue(preset: LayoutPreset): "stack" | "split" {
  return preset === "stacked" ? "stack" : "split";
}

export function layoutPresetFromAttribute(value: string | null): LayoutPreset | null {
  if (value === "stack") return "stacked";
  if (value === "split") return "two-column";
  return null;
}

export function layoutAssetPath(cssDigest: string): string {
  return `${LAYOUT_ASSET_PREFIX}layout-v1.${cssDigest.slice("sha256:".length)}.css`;
}

export function layoutAssetName(path: string): boolean {
  return /^\/__xyle\/assets\/layout-v1\.[a-f0-9]{64}\.css$/.test(path);
}
