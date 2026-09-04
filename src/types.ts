export type XyleDigest = `sha256:${string}`;

export interface ManifestFile {
  digest: XyleDigest;
  size: number;
  contentType: string;
}

export interface XyleManifest {
  version: 1;
  snapshotDigest: XyleDigest;
  files: Record<string, ManifestFile>;
}

export interface XyleConfig {
  directory: string;
  editorPath: string;
  ignorePaths: string[];
  ignoreSelectors: string[];
}

export type TextFormat = "bold" | "italic" | "underline" | "strikethrough";
export type SeoField =
  | "title"
  | "description"
  | "canonical"
  | "ogTitle"
  | "ogDescription"
  | "ogImage";
export interface SeoState {
  title: string;
  description: string;
  canonical: string;
  ogTitle: string;
  ogDescription: string;
  ogImage: string;
}
export type BlockFormat = "p" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "ul" | "ol";

export interface SetBlockFormatOperation {
  type: "setBlockFormat";
  /** Stable anchor for one authored sibling region. */
  nodeId: string;
  /** Final target formats, relative to the authored source. */
  targets: Array<{ nodeId: string; value: BlockFormat }>;
}

export type TextBlockTag = Exclude<BlockFormat, "ul" | "ol">;

export interface ReplaceTextBlockOperation {
  type: "replaceTextBlock";
  /** Original server-backed block and publication anchor. */
  nodeId: string;
  blocks: Array<{
    /** Bounded client identity; it is never written to the page. */
    key: string;
    tag: TextBlockTag;
    html: string;
    /** Exactly one block preserves the source element's attributes. */
    source: boolean;
  }>;
}

export interface Point {
  x: number;
  y: number;
}

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type MediaSource =
  | { kind: "existing"; src: string }
  | {
      kind: "staged";
      assetId: string;
      previewUrl: string;
      mime: string;
      width: number;
      height: number;
    };

export interface MediaState {
  source: MediaSource;
  alt: { present: boolean; value: string };
  crop: CropRect | null;
  focus: Point | null;
  framing?: { fit: "cover" | "contain" };
}

export interface MediaCapabilities {
  replace: boolean;
  alt: boolean;
  crop: boolean;
  focus: boolean;
  cropReason?: string;
  focusReason?: string;
}

export interface GroupMoveCapability {
  supported: boolean;
  reason?: string;
}

export type LayoutPreset = "stacked" | "two-column";
export type RegionOrder = "original" | "swapped";

export type PageOperation =
  | { type: "text"; nodeId: string; value: string }
  | SetBlockFormatOperation
  | {
      type: "format";
      nodeId: string;
      value: TextFormat;
      start?: number;
      end?: number;
      sourceStart?: number;
      sourceEnd?: number;
    }
  | { type: "formatBlock"; nodeId: string; value: BlockFormat }
  | {
      type: "toggleList";
      nodeIds: string[];
      value: "ul" | "ol";
      before: "plain" | "ul" | "ol";
      after: "plain" | "ul" | "ol";
    }
  | { type: "html"; nodeId: string; value: string }
  | ReplaceTextBlockOperation
  | { type: "media"; nodeId: string; value: MediaState }
  | { type: "seo"; nodeId: string; field: SeoField; value: string }
  | { type: "lineBreak"; nodeId: string; position: number }
  | { type: "href"; nodeId: string; value: string }
  | { type: "src"; nodeId: string; value: string }
  | { type: "alt"; nodeId: string; value: string }
  | { type: "sectionVisibility"; nodeId: string; visible: boolean; before: boolean }
  | {
      type: "moveSection";
      nodeId: string;
      targetId: string;
      before: boolean;
      originalIndex: number;
      sequence?: number;
    }
  | DuplicateSectionOperation
  | DuplicateGroupItemOperation
  | MoveGroupItemOperation
  | SetLayoutPresetOperation
  | SetRegionOrderOperation;

export interface DuplicateSectionOperation {
  type: "duplicateSection";
  sourceId: string;
  createdId: string;
  sequence: number;
  insert: "after";
  snapshotOperations: SnapshotOperation[];
  nodeMap: Record<string, string>;
  createdOperations?: SnapshotOperation[];
  /** Client preview state only; the server never uses this as publish input. */
  previewHtml?: string;
  idMap: Record<string, string>;
  assetRefs: AssetReference[];
}

export interface DuplicateGroupItemOperation {
  type: "duplicateGroupItem";
  groupId: string;
  sourceItemId: string;
  sourceItemIndex: number;
  groupSignature: string;
  itemSignature: string;
  createdId: string;
  sequence: number;
  insert: "after";
  snapshotOperations: SnapshotOperation[];
  nodeMap: Record<string, string>;
  createdOperations?: SnapshotOperation[];
  /** Client preview state only; the server never uses this as publish input. */
  previewHtml?: string;
  idMap: Record<string, string>;
  assetRefs: AssetReference[];
}

export interface MoveGroupItemOperation {
  type: "moveGroupItem";
  groupId: string;
  itemId: string;
  targetItemId: string;
  position: "before" | "after";
  sequence: number;
  groupSignature: string;
  itemSignature: string;
}

export interface SetLayoutPresetOperation {
  type: "setLayoutPreset";
  nodeId: string;
  preset: LayoutPreset;
  baseline: LayoutPreset;
  targetSignature: string;
  regionSignatures: [string, string];
}

export interface SetRegionOrderOperation {
  type: "setRegionOrder";
  targetId: string;
  firstRegionId: string;
  secondRegionId: string;
  order: RegionOrder;
  targetSignature: string;
  regionSignatures: [string, string];
  sequence: number;
}

export type SnapshotOperation = Exclude<
  PageOperation,
  DuplicateSectionOperation | DuplicateGroupItemOperation | MoveGroupItemOperation
>;

export interface AssetReference {
  assetId: string;
  digest?: XyleDigest;
}

export interface PageChange {
  pagePath: string;
  baseDigest: XyleDigest;
  operations: PageOperation[];
}

export interface SiteFile {
  path: string;
  bytes: Uint8Array;
  digest: XyleDigest;
  contentType: string;
}

export interface PublishedSnapshot {
  snapshotDigest: XyleDigest;
  manifest: XyleManifest;
}

export interface XyleManagedAssetManifest {
  version: 1;
  assets: Record<string, { digest: XyleDigest; size: number; contentType: string }>;
}

export interface PublishSnapshot {
  baseSnapshotDigest: XyleDigest;
  manifest: XyleManifest;
  changedFiles: SiteFile[];
  addedFiles: SiteFile[];
  managedFiles?: SiteFile[];
  removedFiles?: string[];
}

export interface PublishResult {
  snapshot: PublishedSnapshot;
  id: string;
}

export interface Publisher {
  readSnapshot(): Promise<PublishedSnapshot>;
  publish(next: PublishSnapshot): Promise<PublishResult>;
}

export interface MediaItem {
  path: string;
  contentType: string;
  size: number;
  digest: XyleDigest;
  source: "site" | "xyle-upload";
  usedBySimpleImg: boolean;
}

export interface AssetChange {
  type: "add";
  path: string;
  file: File;
  digest: XyleDigest;
  contentType: string;
}

export interface ChangeSet {
  baseSnapshotDigest: XyleDigest;
  pages: PageChange[];
  assets: AssetChange[];
}

export interface HistoryEntry {
  before: ChangeSet;
  after: ChangeSet;
  label: string;
}

export interface PreviewSegment {
  sourceStart: number;
  sourceEnd: number;
  textLength: number;
}

export interface GroupItemDescriptor {
  id: string;
  groupId: string;
  tag: "article" | "div";
  index: number;
  sourceStart: number;
  sourceEnd: number;
  startTagEnd: number;
  signature: string;
}

export interface GroupDescriptor {
  id: string;
  sectionId: string;
  containerTag: "div";
  sourceStart: number;
  sourceEnd: number;
  startTagEnd: number;
  sectionStart: number;
  sectionEnd: number;
  signature: string;
  items: GroupItemDescriptor[];
  /** Runtime-only capability; not serialized into publish operations. */
  move?: GroupMoveCapability;
}

export interface LayoutRegionDescriptor {
  id: string;
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

export interface PreviewNode {
  id: string;
  pagePath: string;
  kind: "text" | "link" | "image" | "section";
  sourceStart: number;
  sourceEnd: number;
  elementStart?: number;
  elementEnd?: number;
  stableTargetId?: string;
  segments?: PreviewSegment[];
  tag?: string;
  multiline?: boolean;
  textEditable?: boolean;
  segmentCount?: number;
  mediaCapabilities?: MediaCapabilities;
}

export interface PreparedPreview {
  html: string;
  nodes: Map<string, PreviewNode>;
  groups: GroupDescriptor[];
  layouts: LayoutTargetDescriptor[];
}

export interface AuthConfig {
  editorKeyDigest: XyleDigest;
  sessionSecret: Uint8Array;
  sessionMaxAgeSeconds: number;
}

export interface LocalXyleState {
  directory: string;
  publisher: string;
  lastManagedSnapshotDigest: XyleDigest | null;
  editorPath: string;
  ignorePaths: string[];
  ignoreSelectors: string[];
}
