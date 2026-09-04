import type {
  CropRect,
  GroupDescriptor,
  MediaCapabilities,
  Point,
  LayoutPreset,
  RegionOrder,
  SeoField,
  SeoState,
} from "./types.ts";

export interface EditableContent {
  id: string;
  type: "text" | "link" | "image" | "section";
  preview: string;
  capabilities?: MediaCapabilities;
}

export interface ContentResult {
  id: string;
  type: "text" | "link" | "image" | "section";
  content: string;
  alt?: string;
}

export interface TextUpdateResult {
  id: string;
  pagePath: string;
  text: string;
}

export interface LinkUpdateResult {
  id: string;
  pagePath: string;
  text: string;
  href: string;
}

export interface AssetUpdateResult {
  id: string;
  pagePath: string;
  src: string;
  alt: string;
}

export interface MediaPatchInput {
  src?: string;
  alt?: string;
  crop?: CropRect | null;
  focus?: Point | null;
  fit?: "cover" | "contain";
}

export interface MediaUpdateResult {
  id: string;
  pagePath: string;
  src: string;
  alt: string;
}

export interface SeoUpdateResult {
  field: SeoField;
  pagePath: string;
  value: string;
}

export type Formatting =
  | "bold"
  | "italic"
  | "underline"
  | "strikethrough"
  | "paragraph"
  | "heading-1"
  | "heading-2"
  | "heading-3"
  | "heading-4"
  | "heading-5"
  | "heading-6"
  | "unordered-list"
  | "ordered-list";

export interface FormattingUpdateResult {
  id: string;
  pagePath: string;
  format: Formatting;
}

export interface ListFormattingUpdateResult {
  ids: string[];
  pagePath: string;
  format: "unordered-list" | "ordered-list";
}

export interface ChangeInfo {
  changeId: string;
  elementId: string;
  type:
    | "text"
    | "href"
    | "src"
    | "alt"
    | "format"
    | "setBlockFormat"
    | "formatBlock"
    | "html"
    | "replaceTextBlock"
    | "media"
    | "seo"
    | "toggleList"
    | "sectionVisibility"
    | "moveSection"
    | "duplicateSection"
    | "duplicateGroupItem"
    | "moveGroupItem"
    | "setLayoutPreset"
    | "setRegionOrder";
  before: string;
  after: string;
  changeSetId?: string;
  changeSetLabel?: string;
}

export interface UndoResult {
  changeId: string;
  undone: true;
}

export type ChangeSetOperation =
  | { type: "text"; id: string; text: string }
  | { type: "link"; id: string; text?: string; href?: string }
  | { type: "asset"; id: string; src: string; alt?: string }
  | { type: "formatting"; id: string; format: Formatting }
  | { type: "sectionVisibility"; id: string; visible: boolean }
  | { type: "moveSection"; id: string; targetId: string; before: boolean };

export interface ChangeSetResult {
  changeSetId: string;
  label: string;
  changes: ChangeInfo[];
}

export interface ChangeSetUndoResult {
  changeSetId: string;
  undone: true;
}

export interface WebMcpBridge {
  listEditableContent(): EditableContent[];
  listGroups?: () => GroupDescriptor[];
  getContent(id: string): ContentResult;
  listChanges(): ChangeInfo[];
  revertChange(changeId: string): UndoResult;
  applyChangeSet(label: string, changes: ChangeSetOperation[]): ChangeSetResult;
  undoChangeSet(changeSetId: string): ChangeSetUndoResult;
  replaceAsset(id: string, src: string, alt?: string): AssetUpdateResult;
  updateMedia?: (id: string, patch: MediaPatchInput) => MediaUpdateResult;
  getSeo?: () => SeoState;
  updateSeo?: (field: SeoField, value: string) => SeoUpdateResult;
  updateFormatting(id: string, format: Formatting): FormattingUpdateResult;
  updateList?: (
    ids: string[],
    format: "unordered-list" | "ordered-list",
  ) => ListFormattingUpdateResult;
  updateSectionVisibility?: (id: string, visible: boolean) => { id: string; visible: boolean };
  moveSection?: (
    id: string,
    targetId: string,
    before: boolean,
  ) => { id: string; targetId: string; before: boolean };
  duplicateSection?: (id: string) => { id: string; sourceId: string };
  duplicateGroupItem?: (
    groupId: string,
    itemId: string,
  ) => { id: string; groupId: string; sourceItemId: string };
  moveGroupItem?: (
    groupId: string,
    itemId: string,
    targetItemId: string,
    position: "before" | "after",
  ) => { id: string; targetItemId: string; position: "before" | "after" };
  listLayoutOptions?: (targetId: string) => {
    id: string;
    current: LayoutPreset;
    baseline: LayoutPreset;
    options: LayoutPreset[];
  };
  setLayoutPreset?: (
    targetId: string,
    preset: LayoutPreset,
  ) => { id: string; preset: LayoutPreset };
  setRegionOrder?: (targetId: string, order: RegionOrder) => { id: string; order: RegionOrder };
  insertParagraph?: (
    id: string,
    offset: number,
  ) => { id: string; createdId: string; pagePath: string };
  insertLineBreak?: (id: string, offset: number) => { id: string; pagePath: string };
  createLink?: (
    id: string,
    start: number,
    end: number,
    href: string,
  ) => { id: string; href: string; pagePath: string };
  updateText(id: string, text: string): TextUpdateResult;
  updateLink(id: string, text?: string, href?: string): LinkUpdateResult;
}
