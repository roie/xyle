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

export type TextFormat = "bold" | "italic" | "underline";
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

export type PageOperation =
  | { type: "text"; nodeId: string; value: string }
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
  | { type: "html"; nodeId: string; value: string }
  | { type: "media"; nodeId: string; value: MediaState }
  | { type: "seo"; nodeId: string; field: SeoField; value: string }
  | { type: "lineBreak"; nodeId: string; position: number }
  | { type: "href"; nodeId: string; value: string }
  | { type: "src"; nodeId: string; value: string }
  | {
      type: "imageStyle";
      nodeId: string;
      fit: "cover" | "contain";
      focalX: number;
      focalY: number;
    }
  | { type: "alt"; nodeId: string; value: string };

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

export interface PublishSnapshot {
  baseSnapshotDigest: XyleDigest;
  manifest: XyleManifest;
  changedFiles: SiteFile[];
  addedFiles: SiteFile[];
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

export interface PreviewNode {
  id: string;
  pagePath: string;
  kind: "text" | "link" | "image";
  sourceStart: number;
  sourceEnd: number;
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
