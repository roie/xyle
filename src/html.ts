import { parse, parseFragment, serialize } from "parse5";
import type { DefaultTreeAdapterTypes } from "parse5";
import type {
  PageChange,
  PageOperation,
  PreparedPreview,
  TextFormat,
  PreviewNode,
  XyleDigest,
  MediaState,
  SnapshotOperation,
  GroupDescriptor,
  GroupItemDescriptor,
} from "./types.ts";
import { digestBytes } from "./digest.ts";
import { sourceTargetIdentity, stableIdentity } from "./identity.ts";
import { mediaSourcePath, normalizeMediaState } from "./media-state.ts";
import {
  STRUCTURAL_ID_REFERENCE_ATTRIBUTES,
  createdNodeIdentity,
  duplicateGroupHtmlId,
  duplicateHtmlId,
  replayGroupOrder,
  type GroupOrderOperation,
  rewriteFragmentReference,
  rewriteIdTokens,
} from "./structural.ts";

type P5Document = DefaultTreeAdapterTypes.Document;
type P5Node = DefaultTreeAdapterTypes.Node;
type P5Element = DefaultTreeAdapterTypes.Element;
type P5Attribute = { name: string; value: string };

const EXCLUDED_TAGS = new Set([
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "canvas",
  "code",
  "pre",
  "input",
  "textarea",
  "select",
  "option",
  "button",
]);

const TEXT_CONTAINER_TAGS = new Set([
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "blockquote",
  "figcaption",
  "li",
  "dt",
  "dd",
  "strong",
  "em",
  "span",
  "small",
]);

const MULTILINE_TAGS = new Set(["p", "blockquote", "figcaption", "li"]);
const STRUCTURAL_UNSAFE_TAGS = new Set(["canvas", "form", "iframe", "script", "section", "video"]);

const INLINE_TAGS = new Set([
  "a",
  "strong",
  "em",
  "b",
  "i",
  "u",
  "s",
  "small",
  "sub",
  "sup",
  "mark",
  "abbr",
  "cite",
  "q",
  "span",
  "br",
  "time",
  "kbd",
  "var",
  "samp",
  "del",
  "ins",
  "wbr",
  "bdi",
  "bdo",
]);

function sanitizeInlineMarkup(markup: string): string {
  const fragment = parseFragment(markup);
  const allowedAttributes = new Set(["class", "id", "title", "lang", "dir", "role"]);
  const visit = (node: P5Node): void => {
    if (node.nodeName === "#text") return;
    if (!isElement(node)) throw new Error("formatting HTML contains an unsupported node");
    if (!INLINE_TAGS.has(node.tagName)) {
      throw new Error(`formatting HTML contains unsupported <${node.tagName}>`);
    }
    for (const attribute of [...node.attrs] as P5Attribute[]) {
      const name = attribute.name.toLowerCase();
      if (name === "data-xyle-format" || name === "data-xyle-controlled-break") {
        node.attrs = node.attrs.filter((candidate) => candidate !== attribute);
        continue;
      }
      if (name.startsWith("data-xyle-")) {
        throw new Error("formatting HTML contains a reserved Xyle attribute");
      }
      if (name.startsWith("on") || name === "style" || name === "src") {
        throw new Error("formatting HTML contains an unsafe attribute");
      }
      if (name === "href") {
        if (node.tagName !== "a" || !isValidSiteUrl(attribute.value)) {
          throw new Error("formatting HTML contains an unsafe link");
        }
        continue;
      }
      if (!allowedAttributes.has(name) && !name.startsWith("aria-") && !name.startsWith("data-")) {
        throw new Error(`formatting HTML contains unsupported attribute ${name}`);
      }
    }
    for (const child of node.childNodes) visit(child);
  };
  for (const child of fragment.childNodes) visit(child);
  return serialize(fragment);
}

export interface SegmentInfo {
  /** Source offset of first byte of the text node. */
  start: number;
  /** Source offset past the last byte of the text node. */
  end: number;
  /** Decoded text content. */
  text: string;
}

interface AttrRange {
  name: string;
  sliceStart: number;
  sliceEnd: number;
}

function hasUnsafeStructuralDescendant(el: P5Element): boolean {
  const visit = (node: P5Node): boolean => {
    if (!isElement(node)) return false;
    if (STRUCTURAL_UNSAFE_TAGS.has(node.tagName)) return true;
    return node.childNodes.some(visit);
  };
  return el.childNodes.some(visit);
}

interface Candidate {
  id: string;
  kind: PreviewNode["kind"];
  tag: string;
  parentStart?: number;
  parentEnd?: number;
  parentTag?: string;
  parentStartTagEnd?: number;
  parentEndTagStart?: number;
  startTagStart: number;
  startTagEnd: number;
  contentStart?: number;
  contentEnd?: number;
  elementEnd?: number;
  previewWrapper?: boolean;
  tagNameStart?: number;
  tagNameEnd?: number;
  endTagNameStart?: number;
  endTagNameEnd?: number;
  multiline: boolean;
  textEditable: boolean;
  /** Descendant text nodes (excluding nested link/image candidates), document order. */
  segments: SegmentInfo[];
  attrs: Map<string, AttrRange>;
  mediaCapabilities?: import("./types.ts").MediaCapabilities;
}

function parentRange(
  parent: P5Element | null,
): Pick<
  Candidate,
  "parentStart" | "parentEnd" | "parentTag" | "parentStartTagEnd" | "parentEndTagStart"
> {
  const location = parent?.sourceCodeLocation;
  if (!location || location.startOffset === undefined || location.endOffset === undefined)
    return {};
  return {
    parentStart: location.startOffset,
    parentEnd: location.endOffset,
    parentTag: parent.tagName,
    ...(location.startTag ? { parentStartTagEnd: location.startTag.endOffset } : {}),
    ...(location.endTag ? { parentEndTagStart: location.endTag.startOffset } : {}),
  };
}

export interface PageAnalysis {
  candidates: Map<string, Candidate>;
  injections: { offset: number; text: string }[];
  removals: { start: number; end: number }[];
  baseTagNeeded: boolean;
}

function isElement(node: P5Node): node is P5Element {
  return (
    node.nodeName !== "#text" &&
    node.nodeName !== "#comment" &&
    node.nodeName !== "#documentType" &&
    node.nodeName !== "#document"
  );
}

function elementAtSourceRange(root: P5Node, start: number, end: number): P5Element | null {
  if (isElement(root)) {
    const location = root.sourceCodeLocation;
    if (location?.startOffset === start && location.endOffset === end) return root;
  }
  const children = "childNodes" in root ? root.childNodes : [];
  for (const child of children) {
    const found = elementAtSourceRange(child, start, end);
    if (found) return found;
  }
  return null;
}

function attrValue(el: P5Element, name: string): string | null {
  for (const attr of el.attrs as P5Attribute[]) {
    if (attr.name === name) return attr.value ?? "";
  }
  return null;
}

function hasOnlyInlineDescendants(el: P5Element): boolean {
  const stack = [...el.childNodes];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || !isElement(node)) continue;
    if (!INLINE_TAGS.has(node.tagName)) return false;
    stack.push(...node.childNodes);
  }
  return true;
}

/**
 * Collect descendant text nodes in document order, stopping descent at
 * excluded tags and at nested candidates (links, images) so that every
 * source text node is owned by exactly one candidate.
 */
function collectSegments(root: P5Element, stopAt: (el: P5Element) => boolean): SegmentInfo[] {
  const segments: SegmentInfo[] = [];
  const visit = (node: P5Node): void => {
    if (node.nodeName === "#text") {
      const loc = node.sourceCodeLocation;
      if (loc) {
        // SAFETY: parse5 text nodes expose `value`, omitted from the broad node union.
        const value = String((node as unknown as { value: string }).value);
        segments.push({ start: loc.startOffset, end: loc.endOffset, text: value });
      }
      return;
    }
    if (!isElement(node)) return;
    if (stopAt(node)) return;
    for (const child of node.childNodes) visit(child);
  };
  for (const child of root.childNodes) visit(child);
  return segments;
}

function sourceAttrValue(source: string, attr: AttrRange): string {
  const raw = source.slice(attr.sliceStart, attr.sliceEnd);
  const equals = raw.indexOf("=");
  if (equals === -1) return "";
  const value = raw.slice(equals + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function mediaStyleValue(existing: string, media: MediaState): string {
  let retained = existing;
  if (media.framing) retained = retained.replace(/(?:^|;)\s*object-fit\s*:[^;]*/gi, "");
  if (media.focus) retained = retained.replace(/(?:^|;)\s*object-position\s*:[^;]*/gi, "");
  retained = retained.replace(/^\s*;|;\s*$/g, "").trim();
  const additions = [
    media.framing ? `object-fit: ${media.framing.fit}` : "",
    media.focus ? `object-position: ${media.focus.x * 100}% ${media.focus.y * 100}%` : "",
  ].filter(Boolean);
  return `${retained}${retained && additions.length ? "; " : ""}${additions.join("; ")}${additions.length ? ";" : ""}`;
}

function collectAttrRanges(el: P5Element): Map<string, AttrRange> {
  const map = new Map<string, AttrRange>();
  const loc = el.sourceCodeLocation;
  if (!loc?.attrs) return map;
  for (const [name, range] of Object.entries(loc.attrs) as [
    string,
    { startOffset: number; endOffset: number },
  ][]) {
    map.set(name, { name, sliceStart: range.startOffset, sliceEnd: range.endOffset });
  }
  return map;
}

interface SeoTarget {
  field: import("./types.ts").SeoField;
  startTagStart: number;
  startTagEnd: number;
  elementEnd: number;
  contentStart?: number;
  contentEnd?: number;
  valueAttr?: AttrRange;
}

interface SeoAnalysis {
  targets: Map<import("./types.ts").SeoField, SeoTarget>;
  headEnd: number | null;
}

function seoFieldFor(el: P5Element): import("./types.ts").SeoField | null {
  if (el.tagName === "title") return "title";
  if (el.tagName === "meta") {
    const name = (attrValue(el, "name") ?? "").toLowerCase();
    const property = (attrValue(el, "property") ?? "").toLowerCase();
    if (name === "description") return "description";
    if (property === "og:title") return "ogTitle";
    if (property === "og:description") return "ogDescription";
    if (property === "og:image") return "ogImage";
  }
  if (el.tagName === "link" && /(?:^|\\s)canonical(?:\\s|$)/i.test(attrValue(el, "rel") ?? "")) {
    return "canonical";
  }
  return null;
}

function findSeoTargets(source: string): SeoAnalysis {
  const doc = parse(source, { sourceCodeLocationInfo: true }) as P5Document;
  const targets = new Map<import("./types.ts").SeoField, SeoTarget>();
  let headEnd: number | null = null;
  const visit = (node: P5Node): void => {
    if (!isElement(node)) return;
    const loc = node.sourceCodeLocation;
    if (!loc?.startTag) return;
    if (node.tagName === "head") headEnd = loc.endTag?.startOffset ?? null;
    const field = seoFieldFor(node);
    if (field && !targets.has(field)) {
      const attrs = collectAttrRanges(node);
      const valueAttr =
        field === "title" ? undefined : attrs.get(field === "canonical" ? "href" : "content");
      targets.set(field, {
        field,
        startTagStart: loc.startTag.startOffset,
        startTagEnd: loc.startTag.endOffset,
        elementEnd: loc.endOffset,
        ...(node.tagName === "title" && loc.endTag
          ? { contentStart: loc.startTag.endOffset, contentEnd: loc.endTag.startOffset }
          : {}),
        ...(valueAttr ? { valueAttr } : {}),
      });
    }
    for (const child of node.childNodes) visit(child);
  };
  for (const node of doc.childNodes) visit(node);
  return { targets, headEnd };
}

function matchesIgnoreSelector(el: P5Element, selectors: string[]): boolean {
  const id = attrValue(el, "id");
  const classes = new Set((attrValue(el, "class") ?? "").split(/\s+/).filter(Boolean));
  return selectors.some((raw) =>
    raw
      .split(",")
      .map((selector) => selector.trim())
      .some((selector) => {
        if (!selector) return false;
        if (selector.startsWith("#")) return id === selector.slice(1);
        if (selector.startsWith(".")) return classes.has(selector.slice(1));
        return /^[a-z][a-z0-9-]*$/i.test(selector) && el.tagName === selector.toLowerCase();
      }),
  );
}

const GROUP_ITEM_TAGS = new Set(["article", "div"]);
const GROUP_FORMATTING_TAGS = new Set(["b", "strong", "i", "em", "u", "span"]);
const GROUP_CONTENT_TAGS = new Set([
  "a",
  "blockquote",
  "dd",
  "dt",
  "figcaption",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "img",
  "li",
  "p",
]);
const GROUP_UNSAFE_TAGS = new Set([
  "canvas",
  "embed",
  "form",
  "iframe",
  "input",
  "object",
  "option",
  "script",
  "section",
  "select",
  "svg",
  "template",
  "textarea",
  "video",
]);

type ElementPath = string;

interface GroupElementRecord {
  element: P5Element;
  path: ElementPath;
  ancestors: P5Element[];
}

function elementChildren(element: P5Element): P5Element[] {
  return element.childNodes.filter(isElement);
}

function hasMeaningfulDirectText(element: P5Element): boolean {
  return element.childNodes.some(
    (child) =>
      child.nodeName === "#text" && String((child as { value?: string }).value ?? "").trim(),
  );
}

function hasGroupUnsafeDescendant(element: P5Element): boolean {
  const visit = (node: P5Node): boolean => {
    if (!isElement(node)) return false;
    return GROUP_UNSAFE_TAGS.has(node.tagName) || node.childNodes.some(visit);
  };
  return element.childNodes.some(visit);
}

function isFormattingOnlyWrapper(element: P5Element): boolean {
  return (
    GROUP_FORMATTING_TAGS.has(element.tagName) &&
    element.attrs.every(
      (attribute) =>
        ["class", "id", "style"].includes(attribute.name) ||
        attribute.name.startsWith("data-xyle-"),
    )
  );
}

function canonicalGroupSignature(element: P5Element): string {
  const tag = element.tagName;
  const children = elementChildren(element).map(canonicalGroupSignature).filter(Boolean).join(",");
  if (isFormattingOnlyWrapper(element)) return children;
  if (tag === "a") return `link[${children}]`;
  if (tag === "img") return "image";
  if (/^h[1-6]$/.test(tag)) return `heading:${tag}[${children}]`;
  if (GROUP_CONTENT_TAGS.has(tag)) return `content:${tag}[${children}]`;
  if (tag === "br") return "break";
  return `${tag}[${children}]`;
}

function hasGroupContent(element: P5Element): boolean {
  if (GROUP_CONTENT_TAGS.has(element.tagName)) return true;
  return elementChildren(element).some(hasGroupContent);
}

function collectGroupElements(
  element: P5Element,
  path: ElementPath,
  ancestors: P5Element[],
): GroupElementRecord[] {
  const records: GroupElementRecord[] = [];
  for (const [index, child] of elementChildren(element).entries()) {
    const childPath = path ? `${path}.${index}` : String(index);
    records.push({ element: child, path: childPath, ancestors });
    records.push(...collectGroupElements(child, childPath, [...ancestors, child]));
  }
  return records;
}

function isTransparentGroupWrapper(element: P5Element): boolean {
  const children = elementChildren(element);
  return (
    element.tagName === "div" &&
    children.length === 1 &&
    !hasMeaningfulDirectText(element) &&
    !hasGroupUnsafeDescendant(element)
  );
}

function hasOnlyTransparentPath(section: P5Element, record: GroupElementRecord): boolean {
  const sectionIndex = record.ancestors.indexOf(section);
  if (sectionIndex < 0) return false;
  return record.ancestors.slice(sectionIndex + 1).every(isTransparentGroupWrapper);
}

interface RawGroupDescriptor {
  section: GroupElementRecord;
  container: GroupElementRecord;
  items: GroupElementRecord[];
  signature: string;
}

function repeatingGroupItems(
  container: P5Element,
  records: GroupElementRecord[],
): { items: GroupElementRecord[]; signature: string } | null {
  if (
    container.tagName !== "div" ||
    hasMeaningfulDirectText(container) ||
    hasGroupUnsafeDescendant(container)
  )
    return null;
  const items = elementChildren(container).map((element) =>
    records.find((candidate) => candidate.element === element),
  );
  if (
    items.length < 2 ||
    items.some(
      (item) =>
        !item ||
        !GROUP_ITEM_TAGS.has(item.element.tagName) ||
        hasMeaningfulDirectText(item.element) ||
        hasGroupUnsafeDescendant(item.element) ||
        !hasGroupContent(item.element),
    )
  )
    return null;
  const resolvedItems = items as GroupElementRecord[];
  const signatures = resolvedItems.map((item) => canonicalGroupSignature(item.element));
  if (new Set(signatures).size !== 1) return null;
  return { items: resolvedItems, signature: signatures[0]! };
}

function rawGroupsForSection(section: GroupElementRecord): RawGroupDescriptor[] {
  const records = collectGroupElements(section.element, "", [section.element]);
  const groups: RawGroupDescriptor[] = [];
  for (const record of records) {
    const repeated = repeatingGroupItems(record.element, records);
    if (!repeated || !hasOnlyTransparentPath(section.element, record)) continue;
    const nestedRepeating = records.some((other) => {
      if (other === record) return false;
      const candidateLocation = record.element.sourceCodeLocation;
      const otherLocation = other.element.sourceCodeLocation;
      return (
        !!candidateLocation &&
        !!otherLocation &&
        candidateLocation.startOffset < otherLocation.startOffset &&
        candidateLocation.endOffset > otherLocation.endOffset &&
        repeatingGroupItems(other.element, records) !== null
      );
    });
    if (nestedRepeating) continue;
    groups.push({
      section,
      container: record,
      items: repeated.items,
      signature: repeated.signature,
    });
  }
  return groups;
}

/**
 * Discover conservative repeating collections from an original source snapshot.
 * The caller must retain these descriptors instead of re-analysing mutated preview HTML.
 */
export function analyzeGroups(source: string, pagePath: string): GroupDescriptor[] {
  const document = parse(source, { sourceCodeLocationInfo: true }) as P5Document;
  const sections: GroupElementRecord[] = [];
  const visitSections = (node: P5Node, path: ElementPath, insideSection: boolean): void => {
    if (!isElement(node)) return;
    const loc = node.sourceCodeLocation;
    const safe =
      node.tagName === "section" &&
      !insideSection &&
      !!loc?.startTag &&
      !!loc.endTag &&
      !hasUnsafeStructuralDescendant(node);
    if (safe) sections.push({ element: node, path, ancestors: [] });
    for (const [index, child] of elementChildren(node).entries()) {
      visitSections(
        child,
        path ? `${path}.${index}` : String(index),
        insideSection || node.tagName === "section",
      );
    }
  };
  for (const [index, child] of document.childNodes.filter(isElement).entries()) {
    visitSections(child, String(index), false);
  }

  const rawGroups = sections.flatMap((section) => rawGroupsForSection(section));
  const nonOverlapping = rawGroups.filter(
    (candidate) =>
      !rawGroups.some(
        (other) =>
          other !== candidate &&
          other.container.element.sourceCodeLocation!.startOffset <=
            candidate.container.element.sourceCodeLocation!.startOffset &&
          other.container.element.sourceCodeLocation!.endOffset >=
            candidate.container.element.sourceCodeLocation!.endOffset,
      ),
  );
  return nonOverlapping
    .sort(
      (left, right) =>
        left.container.element.sourceCodeLocation!.startOffset -
        right.container.element.sourceCodeLocation!.startOffset,
    )
    .map((raw) => {
      const sectionLocation = raw.section.element.sourceCodeLocation!;
      const containerLocation = raw.container.element.sourceCodeLocation!;
      const sectionId = stableIdentity(["group-section", pagePath, raw.section.path]);
      const groupId = stableIdentity(["group", pagePath, raw.section.path, raw.container.path]);
      const items: GroupItemDescriptor[] = raw.items.map((item, index) => {
        const location = item.element.sourceCodeLocation!;
        return {
          id: stableIdentity(["group-item", groupId, String(index), item.element.tagName]),
          groupId,
          tag: item.element.tagName as "article" | "div",
          index,
          sourceStart: location.startOffset,
          sourceEnd: location.endOffset,
          startTagEnd: location.startTag!.endOffset,
          signature: raw.signature,
        };
      });
      return {
        id: groupId,
        sectionId,
        containerTag: "div",
        sourceStart: containerLocation.startOffset,
        sourceEnd: containerLocation.endOffset,
        startTagEnd: containerLocation.startTag!.endOffset,
        sectionStart: sectionLocation.startOffset,
        sectionEnd: sectionLocation.endOffset,
        signature: raw.signature,
        items,
      };
    });
}

export function analyzePage(source: string, ignoreSelectors: string[] = []): PageAnalysis {
  const doc = parse(source, { sourceCodeLocationInfo: true }) as P5Document;
  const candidates = new Map<string, Candidate>();
  const injections: PageAnalysis["injections"] = [];
  const removals: PageAnalysis["removals"] = [];
  let baseTagNeeded = true;
  let counter = 0;
  let sectionCounter = 0;

  const isNestedCandidateStop = (el: P5Element): boolean =>
    el.tagName === "a" || el.tagName === "img";

  const visit = (
    node: P5Node,
    insidePicture: boolean,
    insideTextContainer: boolean,
    insideIgnored: boolean,
    parent: P5Element | null,
    insideSection: boolean,
  ): void => {
    if (!isElement(node)) return;

    const tag = node.tagName;
    if (tag === "base") baseTagNeeded = false;
    if (tag === "script") {
      const loc = node.sourceCodeLocation;
      if (loc) removals.push({ start: loc.startOffset, end: loc.endOffset });
      return;
    }
    if (EXCLUDED_TAGS.has(tag)) return;
    if (node.attrs.some((a) => a.name === "hidden") && tag !== "section") return;

    if (tag === "meta") {
      const httpEquiv = attrValue(node, "http-equiv");
      if (httpEquiv && httpEquiv.toLowerCase() === "refresh") {
        const loc = node.sourceCodeLocation;
        if (loc) removals.push({ start: loc.startOffset, end: loc.endOffset });
      }
      return;
    }

    const ignored = insideIgnored || matchesIgnoreSelector(node, ignoreSelectors);
    if (ignored) return;

    let becameCandidate = false;

    if (
      tag === "section" &&
      !insideSection &&
      node.sourceCodeLocation?.startTag &&
      node.sourceCodeLocation.endTag &&
      !hasUnsafeStructuralDescendant(node)
    ) {
      sectionCounter += 1;
      const id = `s${sectionCounter}`;
      const loc = node.sourceCodeLocation;
      const startTag = loc.startTag;
      const endTag = loc.endTag;
      if (!startTag || !endTag) return;
      candidates.set(id, {
        id,
        kind: "section",
        ...parentRange(parent),
        tag,
        startTagStart: loc.startOffset,
        startTagEnd: startTag.endOffset,
        contentStart: startTag.endOffset,
        contentEnd: endTag.startOffset,
        elementEnd: loc.endOffset,
        multiline: false,
        textEditable: false,
        segments: [],
        attrs: collectAttrRanges(node),
      });
      becameCandidate = true;
    } else if (tag === "img") {
      const src = attrValue(node, "src");
      const hidden = node.attrs.some((a) => a.name === "hidden");
      if (src !== null && !hidden) {
        counter += 1;
        const id = `n${counter}`;
        const loc = node.sourceCodeLocation!;
        const responsive = insidePicture || node.attrs.some((a) => a.name === "srcset");
        const extension = src.split(/[?#]/, 1)[0]?.toLowerCase().slice(src.lastIndexOf("."));
        const nonCropFormat = extension === ".svg" || extension === ".gif";
        candidates.set(id, {
          id,
          kind: "image",
          ...parentRange(parent),
          mediaCapabilities: {
            replace: !responsive,
            alt: true,
            crop: !responsive && !nonCropFormat,
            focus: !responsive && !nonCropFormat,
            ...(responsive
              ? { cropReason: "Responsive image sources need deliberate mapping." }
              : nonCropFormat
                ? { cropReason: "This image format is not safely raster-cropped." }
                : {}),
            ...(responsive
              ? { focusReason: "Responsive image sources need deliberate mapping." }
              : nonCropFormat
                ? { focusReason: "This image format is not safely raster-cropped." }
                : {}),
          },
          tag,
          startTagStart: loc.startTag!.startOffset,
          startTagEnd: loc.startTag!.endOffset,
          elementEnd: loc.endOffset,
          multiline: false,
          textEditable: false,
          segments: [],
          attrs: collectAttrRanges(node),
        });
        becameCandidate = true;
      }
    } else if (tag === "a") {
      const href = attrValue(node, "href");
      if (href !== null) {
        counter += 1;
        const id = `n${counter}`;
        const loc = node.sourceCodeLocation!;
        const segments = collectSegments(node, isNestedCandidateStop);
        const onlyInline = hasOnlyInlineDescendants(node);
        candidates.set(id, {
          id,
          kind: "link",
          ...parentRange(parent),
          tag,
          startTagStart: loc.startTag!.startOffset,
          startTagEnd: loc.startTag!.endOffset,
          contentStart: loc.startTag!.endOffset,
          contentEnd: loc.endTag?.startOffset ?? loc.endOffset,
          elementEnd: loc.endOffset,
          tagNameStart: loc.startTag!.startOffset + 1,
          tagNameEnd: loc.startTag!.startOffset + 1 + tag.length,
          ...(loc.endTag
            ? {
                endTagNameStart: loc.endTag.startOffset + 2,
                endTagNameEnd: loc.endTag.startOffset + 2 + tag.length,
              }
            : {}),
          multiline: false,
          textEditable: onlyInline && segments.length > 0,
          segments,
          attrs: collectAttrRanges(node),
        });
        becameCandidate = true;
      }
    } else if (
      !insideTextContainer &&
      TEXT_CONTAINER_TAGS.has(tag) &&
      hasOnlyInlineDescendants(node)
    ) {
      const segments = collectSegments(node, isNestedCandidateStop);
      if (segments.length > 0) {
        counter += 1;
        const id = `n${counter}`;
        const loc = node.sourceCodeLocation!;
        const previewWrapper = new Set(["strong", "b", "em", "i", "u"]).has(tag);
        candidates.set(id, {
          id,
          kind: "text",
          ...parentRange(parent),
          tag,
          startTagStart: loc.startTag!.startOffset,
          startTagEnd: loc.startTag!.endOffset,
          contentStart: loc.startTag!.endOffset,
          contentEnd: loc.endTag?.startOffset ?? loc.endOffset,
          elementEnd: loc.endOffset,
          previewWrapper,
          tagNameStart: loc.startTag!.startOffset + 1,
          tagNameEnd: loc.startTag!.startOffset + 1 + tag.length,
          ...(loc.endTag
            ? {
                endTagNameStart: loc.endTag.startOffset + 2,
                endTagNameEnd: loc.endTag.startOffset + 2 + tag.length,
              }
            : {}),
          multiline: MULTILINE_TAGS.has(tag),
          textEditable: true,
          segments,
          attrs: collectAttrRanges(node),
        });
        becameCandidate = true;
      }
    }

    if (becameCandidate) {
      const candidate = [...candidates.values()].at(-1)!;
      if (candidate.previewWrapper) {
        injections.push({
          offset: candidate.startTagStart,
          text: `<span data-xyle-node="${candidate.id}">`,
        });
        injections.push({ offset: candidate.elementEnd!, text: "</span>" });
      } else {
        injections.push({
          offset: candidate.startTagStart + 1 + tag.length,
          text: ` data-xyle-node="${candidate.id}"`,
        });
      }
    }

    // A candidate owns its own subtree's text; nested text containers stay
    // suppressed only when this candidate actually formed. Links and images
    // remain discoverable inside candidates either way.
    const suppressesChildren = becameCandidate && tag !== "section";

    for (const child of node.childNodes) {
      visit(
        child,
        insidePicture || tag === "picture",
        insideTextContainer || suppressesChildren,
        ignored,
        node,
        insideSection || tag === "section",
      );
    }
  };

  const htmlEl = doc.childNodes.find((n) => isElement(n) && n.tagName === "html");
  const roots = htmlEl && isElement(htmlEl) ? htmlEl.childNodes : doc.childNodes;
  for (const child of roots) visit(child, false, false, false, null, false);

  return { candidates, injections, removals, baseTagNeeded };
}

export function escapeHtmlText(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\u00A0", "&nbsp;");
}

export function escapeHtmlAttr(value: string): string {
  return escapeHtmlText(value).replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

const ALLOWED_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:"]);

/** True for relative, root-relative, fragment, http(s), mailto, tel. */
export function isValidSiteUrl(url: string): boolean {
  const trimmed = url.trim();
  if (/[\u0000-\u001F\u007F]/.test(trimmed)) return false;
  if (/^\s*(javascript|data|vbscript)\s*:/i.test(trimmed)) return false;
  try {
    const parsed = new URL(trimmed, "https://xyle.invalid/");
    if (ALLOWED_SCHEMES.has(parsed.protocol)) return true;
    // relative / root-relative / fragment resolve against our https base
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/** src values of simple <img> candidates Xyle understands, for usage marking. */
export function simpleImageSources(source: string): string[] {
  const analysis = analyzePage(source);
  const sources: string[] = [];
  for (const c of analysis.candidates.values()) {
    if (c.kind !== "image") continue;
    const attr = c.attrs.get("src");
    if (!attr) continue;
    const value = source.slice(attr.sliceStart, attr.sliceEnd);
    // slice includes name="value"; extract between the first = and final quote
    const eq = value.indexOf("=");
    const raw = value.slice(eq + 1).trim();
    const unquoted = raw.startsWith('"') || raw.startsWith("'") ? raw.slice(1, -1) : raw;
    sources.push(unquoted);
  }
  return sources;
}

export function preparePreview(
  source: string,
  pagePath: string,
  publicBaseUrl: string,
  ignoreSelectors: string[] = [],
): PreparedPreview {
  const analysis = analyzePage(source, ignoreSelectors);
  const groups = analyzeGroups(source, pagePath);
  const nodes = new Map<string, PreviewNode>();

  for (const c of analysis.candidates.values()) {
    const node: PreviewNode &
      Partial<Pick<Candidate, "multiline" | "textEditable">> & { segmentCount?: number } = {
      id: c.id,
      pagePath,
      kind: c.kind,
      sourceStart: c.startTagStart,
      sourceEnd:
        c.kind === "section"
          ? (c.elementEnd ?? c.startTagEnd)
          : (c.segments.at(-1)?.end ?? c.startTagEnd),
      elementStart: c.startTagStart,
      ...(c.elementEnd !== undefined ? { elementEnd: c.elementEnd } : {}),
      stableTargetId: sourceTargetIdentity(
        pagePath,
        c.kind,
        c.startTagStart,
        c.elementEnd ?? c.startTagEnd,
        c.tag,
      ),
      segments: c.segments.map((segment) => ({
        sourceStart: segment.start,
        sourceEnd: segment.end,
        textLength: segment.text.length,
      })),
      tag: c.tag,
      multiline: c.multiline,
      textEditable: c.textEditable,
      segmentCount: c.segments.length,
      ...(c.mediaCapabilities ? { mediaCapabilities: c.mediaCapabilities } : {}),
    };
    nodes.set(c.id, node);
  }

  interface Patch {
    start: number;
    end: number;
    replacement: string;
  }
  const patches: Patch[] = [];

  for (const injection of analysis.injections) {
    patches.push({ start: injection.offset, end: injection.offset, replacement: injection.text });
  }
  for (const group of groups) {
    patches.push({
      start: group.startTagEnd - 1,
      end: group.startTagEnd - 1,
      replacement: ` data-xyle-group="${group.id}"`,
    });
    for (const item of group.items) {
      patches.push({
        start: item.startTagEnd - 1,
        end: item.startTagEnd - 1,
        replacement: ` data-xyle-group-item="${item.id}"`,
      });
    }
  }
  for (const removal of analysis.removals) {
    patches.push({ start: removal.start, end: removal.end, replacement: "" });
  }
  if (analysis.baseTagNeeded) {
    const headMatch = /<head[^>]*>/i.exec(source);
    if (headMatch) {
      const insertAt = headMatch.index + headMatch[0].length;
      patches.push({
        start: insertAt,
        end: insertAt,
        replacement: `<base href="${escapeHtmlAttr(publicBaseUrl + pagePath)}">`,
      });
    }
  }

  patches.sort((a, b) => b.start - a.start);
  let html = source;
  for (const patch of patches) {
    html = html.slice(0, patch.start) + patch.replacement + html.slice(patch.end);
  }

  return { html, nodes, groups };
}

function assertFreshSource(bytes: Uint8Array, expected: XyleDigest): Promise<void> {
  return digestBytes(bytes).then((actual) => {
    if (actual !== expected) {
      throw new Error(`stale base digest: expected ${expected}, site serves ${actual}`);
    }
  });
}

interface SegmentRef {
  nodeId: string;
  segmentIndex: number;
}

function parseSegmentRef(raw: string): SegmentRef {
  const hash = raw.indexOf("#");
  if (hash === -1) throw new Error(`text operation requires segment ref, got "${raw}"`);
  const nodeId = raw.slice(0, hash);
  const segmentIndex = Number.parseInt(raw.slice(hash + 1), 10);
  if (!nodeId || !Number.isInteger(segmentIndex) || segmentIndex < 0) {
    throw new Error(`malformed segment ref "${raw}"`);
  }
  return { nodeId, segmentIndex };
}

interface SourcePatch {
  start: number;
  end: number;
  replacement: string;
}

function allElementIds(root: P5Node): string[] {
  const ids: string[] = [];
  const visit = (node: P5Node): void => {
    if (!isElement(node)) return;
    const id = attrValue(node, "id");
    if (id) ids.push(id);
    node.childNodes.forEach(visit);
  };
  visit(root);
  return ids;
}

function duplicateSectionMarkup(
  markup: string,
  createdId: string,
  documentIds: ReadonlySet<string>,
  expectedMap: Record<string, string>,
): string {
  const fragment = parse(`<body>${markup}</body>`) as P5Document;
  const body = fragment.childNodes.find((node) => isElement(node) && node.tagName === "html");
  const html =
    body && isElement(body)
      ? body.childNodes.find((node) => isElement(node) && node.tagName === "body")
      : null;
  const roots = html && isElement(html) ? html.childNodes.filter(isElement) : [];
  if (roots.length !== 1 || roots[0]!.tagName !== "section")
    throw new Error("duplicate snapshot must contain one section");
  if (hasUnsafeStructuralDescendant(roots[0]!))
    throw new Error("duplicate snapshot contains unsafe descendants");
  const originalIds = allElementIds(roots[0]!);
  if (new Set(originalIds).size !== originalIds.length)
    throw new Error("duplicate section contains duplicate HTML ids");
  const idMap = new Map<string, string>();
  for (const originalId of originalIds) {
    const cloneId = duplicateHtmlId(createdId, originalId);
    if (documentIds.has(cloneId))
      throw new Error("duplicate section generated an HTML id collision");
    if (expectedMap[originalId] !== cloneId)
      throw new Error("duplicate section HTML id map is not deterministic");
    idMap.set(originalId, cloneId);
  }
  const visit = (node: P5Node): void => {
    if (!isElement(node)) return;
    for (const attribute of node.attrs) {
      const name = attribute.name.toLowerCase();
      if (name === "id") {
        const mapped = idMap.get(attribute.value);
        if (mapped) attribute.value = mapped;
      } else if (name === "href") {
        attribute.value = rewriteFragmentReference(attribute.value, idMap);
      } else if (STRUCTURAL_ID_REFERENCE_ATTRIBUTES.has(name)) {
        attribute.value = rewriteIdTokens(attribute.value, idMap);
      } else if (attribute.value.match(/#[A-Za-z][\w:.-]*/)) {
        const local = [...attribute.value.matchAll(/#([A-Za-z][\w:.-]*)/g)].some((match) =>
          idMap.has(match[1]!),
        );
        if (local) throw new Error(`unsupported local id reference in ${name}`);
      }
    }
    node.childNodes.forEach(visit);
  };
  visit(roots[0]!);
  return serialize(html as P5Element);
}

function remapSnapshotOperation(
  operation: SnapshotOperation,
  sourceToLocalMap: ReadonlyMap<string, string>,
): SnapshotOperation {
  if (operation.type === "toggleList") {
    return {
      ...operation,
      nodeIds: operation.nodeIds.map((id) => {
        const base = id.split("#")[0]!;
        const local = sourceToLocalMap.get(base);
        if (!local) throw new Error("snapshot operation targets an unknown descendant");
        return local + id.slice(base.length);
      }),
    };
  }
  if (operation.type === "moveSection" || operation.type === "seo")
    throw new Error("unsupported operation in duplicated Group item");
  if (!("nodeId" in operation)) return operation;
  const base = operation.nodeId.split("#")[0]!;
  const local = sourceToLocalMap.get(base);
  if (!local) throw new Error("snapshot operation targets an unknown descendant");
  return {
    ...operation,
    ...(operation.type === "format" &&
    operation.sourceStart !== undefined &&
    operation.sourceEnd !== undefined
      ? {
          sourceStart: operation.sourceStart,
          sourceEnd: operation.sourceEnd,
        }
      : {}),
    nodeId: local + operation.nodeId.slice(base.length),
  } as SnapshotOperation;
}

function firstBodyElement(markup: string): P5Element | null {
  const document = parse(`<body>${markup}</body>`) as P5Document;
  const html = document.childNodes.find((node) => isElement(node) && node.tagName === "html");
  const body =
    html && isElement(html)
      ? html.childNodes.find((node) => isElement(node) && node.tagName === "body")
      : null;
  return body && isElement(body) ? (body.childNodes.find(isElement) ?? null) : null;
}

function duplicateGroupItemMarkup(
  markup: string,
  createdId: string,
  documentIds: ReadonlySet<string>,
  expectedMap: Record<string, string>,
): string {
  const fragment = parse(`<body>${markup}</body>`) as P5Document;
  const body = fragment.childNodes.find((node) => isElement(node) && node.tagName === "html");
  const html =
    body && isElement(body)
      ? body.childNodes.find((node) => isElement(node) && node.tagName === "body")
      : null;
  const roots = html && isElement(html) ? html.childNodes.filter(isElement) : [];
  if (roots.length !== 1 || !["article", "div"].includes(roots[0]!.tagName))
    throw new Error("duplicate snapshot must contain one Group item");
  if (hasGroupUnsafeDescendant(roots[0]!))
    throw new Error("duplicate Group item contains unsafe descendants");
  const originalIds = allElementIds(roots[0]!);
  if (new Set(originalIds).size !== originalIds.length)
    throw new Error("Group item contains duplicate HTML ids");
  const idMap = new Map<string, string>();
  for (const originalId of originalIds) {
    const cloneId = duplicateGroupHtmlId(createdId, originalId);
    if (documentIds.has(cloneId)) throw new Error("Group item generated an HTML id collision");
    if (expectedMap[originalId] !== cloneId)
      throw new Error("Group item HTML id map is not deterministic");
    idMap.set(originalId, cloneId);
  }
  const visit = (node: P5Node): void => {
    if (!isElement(node)) return;
    for (const attribute of node.attrs) {
      const name = attribute.name.toLowerCase();
      if (name === "id") {
        const mapped = idMap.get(attribute.value);
        if (mapped) attribute.value = mapped;
      } else if (name === "href") {
        attribute.value = rewriteFragmentReference(attribute.value, idMap);
      } else if (STRUCTURAL_ID_REFERENCE_ATTRIBUTES.has(name)) {
        attribute.value = rewriteIdTokens(attribute.value, idMap);
      } else if (attribute.value.match(/#[A-Za-z][\w:.-]*/)) {
        const local = [...attribute.value.matchAll(/#([A-Za-z][\w:.-]*)/g)].some((match) =>
          idMap.has(match[1]!),
        );
        if (local) throw new Error(`unsupported local id reference in ${name}`);
      }
    }
    node.childNodes.forEach(visit);
  };
  visit(roots[0]!);
  return serialize(html as P5Element);
}

function remapCreatedOperation(
  operation: SnapshotOperation,
  createdToLocalMap: ReadonlyMap<string, string>,
): SnapshotOperation {
  if (operation.type === "toggleList") {
    return {
      ...operation,
      nodeIds: operation.nodeIds.map((id) => {
        const base = id.split("#")[0]!;
        const local = createdToLocalMap.get(base);
        if (!local) throw new Error("created operation targets an unknown descendant");
        return local + id.slice(base.length);
      }),
    };
  }
  if (operation.type === "moveSection" || operation.type === "seo")
    throw new Error("unsupported operation in created section");
  if (!("nodeId" in operation)) return operation;
  const base = operation.nodeId.split("#")[0]!;
  const local = createdToLocalMap.get(base);
  if (!local) throw new Error("created operation targets an unknown descendant");
  return {
    ...operation,
    nodeId: local + operation.nodeId.slice(base.length),
  } as SnapshotOperation;
}

function renderTextMarkup(text: string, multilineAllowed: boolean): string {
  if (!multilineAllowed && text.includes("\n")) {
    throw new Error("line breaks are not allowed in single-line elements");
  }
  return text.split("\n").map(escapeHtmlText).join("<br>");
}

function formatTag(format: TextFormat): "strong" | "em" | "u" {
  if (format === "bold") return "strong";
  if (format === "italic") return "em";
  if (format === "underline") return "u";
  throw new Error("unsupported text format");
}

function isTextBlockTag(tag: string): tag is "p" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" {
  return tag === "p" || /^h[1-6]$/.test(tag);
}

function isListTag(tag: string): tag is "ul" | "ol" {
  return tag === "ul" || tag === "ol";
}

function isBlockTag(
  tag: string,
): tag is "p" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "ul" | "ol" {
  return isTextBlockTag(tag) || isListTag(tag);
}

function rawOffsetForVisibleText(source: string, offset: number): number | null {
  if (!Number.isInteger(offset) || offset < 0) return null;
  let visible = 0;
  let index = 0;
  while (index < source.length) {
    if (visible === offset) return index;
    if (source[index] === "<") {
      const close = source.indexOf(">", index + 1);
      if (close < 0 || !/^<br\b[^>]*\/?>$/i.test(source.slice(index, close + 1))) return null;
      index = close + 1;
      continue;
    }
    const entity = source.slice(index).match(/^&(?:#\d+|#x[\da-f]+|[a-z]+);/i)?.[0];
    if (entity) {
      visible += 1;
      index += entity.length;
      continue;
    }
    visible += 1;
    index += 1;
  }
  return visible === offset ? index : null;
}

export async function patchHtml(
  source: Uint8Array,
  change: PageChange,
  options: { ignoreSelectors?: string[] } = {},
): Promise<Uint8Array> {
  await assertFreshSource(source, change.baseDigest);

  // Fail closed rather than silently replacing invalid bytes. ignoreBOM keeps an
  // existing UTF-8 BOM in the source text so encoding preserves it exactly.
  let sourceText: string;
  try {
    sourceText = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(source);
  } catch {
    throw new Error("HTML source is not valid UTF-8; byte-preserving edits are unavailable");
  }
  const encoder = new TextEncoder();
  const analysis = analyzePage(sourceText, options.ignoreSelectors ?? []);
  const groups = analyzeGroups(sourceText, change.pagePath);
  const sourceDocument = parse(sourceText, { sourceCodeLocationInfo: true }) as P5Document;
  const seoAnalysis = findSeoTargets(sourceText);

  /** key: `${nodeId}#${segmentIndex}` -> pending text/lineBreak intent */
  const textIntents = new Map<
    string,
    { candidate: Candidate; segment: SegmentInfo; markup: string }
  >();
  const attrOps: { candidate: Candidate; op: PageOperation & { type: "href" | "src" | "alt" } }[] =
    [];
  const formatOps: { candidate: Candidate; op: PageOperation & { type: "format" } }[] = [];
  const formatBlockOps: {
    candidate: Candidate;
    op: PageOperation & { type: "formatBlock" };
  }[] = [];
  const htmlOps: { candidate: Candidate; op: PageOperation & { type: "html" } }[] = [];
  const mediaOps: { candidate: Candidate; op: PageOperation & { type: "media" } }[] = [];
  const sectionVisibilityOps: {
    candidate: Candidate;
    op: PageOperation & { type: "sectionVisibility" };
  }[] = [];
  const moveSectionOps: {
    candidate: Candidate;
    op: PageOperation & { type: "moveSection" };
  }[] = [];
  const duplicateSectionOps: {
    candidate: Candidate;
    op: PageOperation & { type: "duplicateSection" };
  }[] = [];
  const duplicateGroupItemOps: {
    group: GroupDescriptor;
    item: GroupDescriptor["items"][number];
    op: PageOperation & { type: "duplicateGroupItem" };
  }[] = [];
  const moveGroupItemOps: {
    group: GroupDescriptor;
    item: GroupDescriptor["items"][number];
    op: PageOperation & { type: "moveGroupItem" };
  }[] = [];
  const structuralSequences = new Set<number>();
  const seoOps: (PageOperation & { type: "seo" })[] = [];
  const patches: SourcePatch[] = [];
  const htmlTargets = new Set(
    change.operations
      .filter((op): op is PageOperation & { type: "html" } => op.type === "html")
      .map((op) => op.nodeId),
  );

  for (const op of change.operations) {
    switch (op.type) {
      case "text": {
        const ref = parseSegmentRef(op.nodeId);
        if (htmlTargets.has(ref.nodeId)) break;
        const candidate = analysis.candidates.get(ref.nodeId);
        if (!candidate || (candidate.kind !== "text" && candidate.kind !== "link")) {
          throw new Error(`unknown text target ${op.nodeId}`);
        }
        const segment = candidate.segments[ref.segmentIndex];
        if (!segment) throw new Error(`segment ${ref.segmentIndex} missing on ${ref.nodeId}`);
        const key = `${ref.nodeId}#${ref.segmentIndex}`;
        if (textIntents.has(key)) throw new Error(`duplicate text op on ${key}`);
        textIntents.set(key, {
          candidate,
          segment,
          markup: renderTextMarkup(op.value, candidate.multiline),
        });
        break;
      }
      case "format": {
        if (htmlTargets.has(op.nodeId)) break;
        const candidate = analysis.candidates.get(op.nodeId);
        if (!candidate || (candidate.kind !== "text" && candidate.kind !== "link")) {
          throw new Error(`unknown formatting target ${op.nodeId}`);
        }
        if (
          !candidate.textEditable ||
          candidate.contentStart === undefined ||
          candidate.contentEnd === undefined
        ) {
          throw new Error(`formatting target ${op.nodeId} is not safely editable`);
        }
        const hasRange = op.start !== undefined || op.end !== undefined;
        const hasSourceRange = op.sourceStart !== undefined || op.sourceEnd !== undefined;
        if (
          (hasRange && (op.start === undefined || op.end === undefined)) ||
          (hasSourceRange && (op.sourceStart === undefined || op.sourceEnd === undefined))
        ) {
          throw new Error(`formatting range on ${op.nodeId} must include start and end`);
        }
        if (
          hasRange &&
          (!Number.isInteger(op.start) ||
            !Number.isInteger(op.end) ||
            op.start! < 0 ||
            op.end! <= op.start!)
        ) {
          throw new Error(`invalid formatting range on ${op.nodeId}`);
        }
        if (
          hasSourceRange &&
          (!Number.isInteger(op.sourceStart) ||
            !Number.isInteger(op.sourceEnd) ||
            op.sourceStart! < candidate.contentStart! ||
            op.sourceEnd! <= op.sourceStart!)
        ) {
          throw new Error(`invalid formatting source range on ${op.nodeId}`);
        }
        if (
          formatOps.some(
            ({ candidate: existing, op: existingOp }) =>
              existing.id === candidate.id &&
              existingOp.start === op.start &&
              existingOp.end === op.end,
          )
        ) {
          throw new Error(`duplicate formatting op on ${op.nodeId}`);
        }
        formatTag(op.value);
        formatOps.push({ candidate, op });
        break;
      }
      case "html": {
        const candidate = analysis.candidates.get(op.nodeId);
        if (
          !candidate ||
          (candidate.kind !== "text" && candidate.kind !== "link") ||
          !candidate.textEditable ||
          candidate.contentStart === undefined ||
          candidate.contentEnd === undefined
        ) {
          throw new Error(`html target ${op.nodeId} is not safely editable`);
        }
        const value = sanitizeInlineMarkup(op.value);
        if (!candidate.multiline && /<br\b/i.test(value)) {
          throw new Error(`formatting HTML cannot add a line break to <${candidate.tag}>`);
        }
        htmlOps.push({ candidate, op: { ...op, value } });
        break;
      }
      case "sectionVisibility": {
        const candidate = analysis.candidates.get(op.nodeId);
        if (!candidate || candidate.kind !== "section") {
          throw new Error(`section visibility target ${op.nodeId} is not a safe section`);
        }
        if (typeof op.visible !== "boolean" || typeof op.before !== "boolean") {
          throw new Error(`invalid section visibility for ${op.nodeId}`);
        }
        const beforeVisible = !candidate.attrs.has("hidden");
        if (op.before !== beforeVisible)
          throw new Error("section visibility changed before this edit");
        if (sectionVisibilityOps.some(({ candidate: existing }) => existing.id === candidate.id)) {
          throw new Error(`duplicate section visibility op on ${candidate.id}`);
        }
        sectionVisibilityOps.push({ candidate, op });
        break;
      }
      case "moveSection": {
        const candidate = analysis.candidates.get(op.nodeId);
        const target = analysis.candidates.get(op.targetId);
        const createdTarget = !target && /^x-[a-f0-9]{8}$/.test(op.targetId);
        if (
          !candidate ||
          candidate.kind !== "section" ||
          (!target && !createdTarget) ||
          (target && (target.kind !== "section" || candidate.id === target.id)) ||
          candidate.parentStart === undefined ||
          candidate.parentEnd === undefined ||
          (target &&
            (candidate.parentStart !== target.parentStart ||
              candidate.parentEnd !== target.parentEnd))
        ) {
          throw new Error("sections must be safe siblings in one parent");
        }
        if (typeof op.before !== "boolean")
          throw new Error(`invalid section move for ${candidate.id}`);
        if (
          op.sequence !== undefined &&
          (!Number.isInteger(op.sequence) ||
            op.sequence < 1 ||
            structuralSequences.has(op.sequence))
        ) {
          throw new Error(`invalid section move for ${candidate.id}`);
        }
        if (moveSectionOps.length > 0) throw new Error("only one section move is allowed per task");
        const parent = elementAtSourceRange(
          sourceDocument,
          candidate.parentStart,
          candidate.parentEnd,
        );
        const children = parent?.childNodes.filter(isElement) ?? [];
        const sectionChildren = children.filter((child) => {
          const childStart = child.sourceCodeLocation?.startOffset;
          return [...analysis.candidates.values()].some(
            (item) => item.kind === "section" && item.startTagStart === childStart,
          );
        });
        if (sectionChildren.length !== children.length) {
          throw new Error("section parent contains unsupported sibling content");
        }
        if (
          !sectionChildren.some(
            (child) => child.sourceCodeLocation?.startOffset === candidate.startTagStart,
          ) ||
          (target &&
            !sectionChildren.some(
              (child) => child.sourceCodeLocation?.startOffset === target.startTagStart,
            ))
        ) {
          throw new Error("section sibling source mapping is ambiguous");
        }
        const originalIndex = sectionChildren.findIndex(
          (child) => child.sourceCodeLocation?.startOffset === candidate.startTagStart,
        );
        moveSectionOps.push({ candidate, op: { ...op, originalIndex } });
        if (op.sequence !== undefined) structuralSequences.add(op.sequence);
        break;
      }
      case "duplicateGroupItem": {
        const group = groups.find((candidate) => candidate.id === op.groupId);
        const item = group?.items.find((candidate) => candidate.id === op.sourceItemId);
        if (!group || !item) throw new Error("duplicate target is not a source-backed Group item");
        if (
          op.insert !== "after" ||
          !/^x-[a-f0-9]{8}$/.test(op.createdId) ||
          !Number.isInteger(op.sequence) ||
          op.sequence < 1 ||
          structuralSequences.has(op.sequence) ||
          !Number.isInteger(op.sourceItemIndex) ||
          op.sourceItemIndex !== item.index ||
          op.groupSignature !== group.signature ||
          op.itemSignature !== item.signature
        ) {
          throw new Error("invalid Group item duplication");
        }
        if (
          !Array.isArray(op.snapshotOperations) ||
          !Array.isArray(op.assetRefs) ||
          !op.nodeMap ||
          typeof op.nodeMap !== "object" ||
          !op.idMap ||
          typeof op.idMap !== "object"
        ) {
          throw new Error("invalid Group item duplication recipe");
        }
        duplicateGroupItemOps.push({ group, item, op });
        structuralSequences.add(op.sequence);
        break;
      }
      case "moveGroupItem": {
        const group = groups.find((candidate) => candidate.id === op.groupId);
        const item = group?.items.find((candidate) => candidate.id === op.itemId);
        const target = group?.items.find((candidate) => candidate.id === op.targetItemId);
        if (
          !group ||
          !item ||
          !target ||
          item.id === target.id ||
          (op.position !== "before" && op.position !== "after") ||
          !Number.isInteger(op.sequence) ||
          op.sequence < 1 ||
          structuralSequences.has(op.sequence) ||
          op.groupSignature !== group.signature ||
          op.itemSignature !== item.signature
        ) {
          throw new Error("invalid Group item move");
        }
        moveGroupItemOps.push({ group, item, op });
        structuralSequences.add(op.sequence);
        break;
      }
      case "duplicateSection": {
        const candidate = analysis.candidates.get(op.sourceId);
        if (!candidate || candidate.kind !== "section" || candidate.elementEnd === undefined) {
          throw new Error("duplicate target is not a safe section");
        }
        if (candidate.parentStart === undefined || candidate.parentEnd === undefined) {
          throw new Error("duplicate section parent mapping is unavailable");
        }
        const duplicateParent = elementAtSourceRange(
          sourceDocument,
          candidate.parentStart,
          candidate.parentEnd,
        );
        const duplicateChildren = duplicateParent?.childNodes.filter(isElement) ?? [];
        const safeSectionSibling = (child: P5Element): boolean =>
          [...analysis.candidates.values()].some(
            (item) =>
              item.kind === "section" &&
              item.startTagStart === child.sourceCodeLocation?.startOffset,
          );
        if (
          !duplicateParent ||
          duplicateChildren.length === 0 ||
          !duplicateChildren.every(safeSectionSibling)
        )
          throw new Error("section parent contains unsupported sibling content");
        if (
          op.insert !== "after" ||
          !/^x-[a-f0-9]{8}$/.test(op.createdId) ||
          !Number.isInteger(op.sequence) ||
          op.sequence < 1 ||
          structuralSequences.has(op.sequence)
        ) {
          throw new Error("invalid section duplication");
        }
        if (
          !Array.isArray(op.snapshotOperations) ||
          !Array.isArray(op.assetRefs) ||
          !op.nodeMap ||
          typeof op.nodeMap !== "object"
        ) {
          throw new Error("invalid section duplication recipe");
        }
        const createdNodeIds = Object.values(op.nodeMap);
        if (
          new Set(createdNodeIds).size !== createdNodeIds.length ||
          createdNodeIds.some((id) => !/^x-[a-f0-9]{8}$/.test(id))
        ) {
          throw new Error("created descendant identity is invalid");
        }
        for (const [sourceId, createdNodeId] of Object.entries(op.nodeMap)) {
          const sourceNode = analysis.candidates.get(sourceId);
          if (!sourceNode) throw new Error("created node mapping targets an invalid source node");
          if (sourceNode.kind === "section") {
            if (sourceId !== candidate.id || createdNodeId !== op.createdId)
              throw new Error("created section identity is invalid");
            continue;
          }
          const logicalNodeKey = sourceTargetIdentity(
            change.pagePath,
            sourceNode.kind,
            sourceNode.startTagStart,
            sourceNode.elementEnd ?? sourceNode.startTagEnd,
            sourceNode.tag,
          );
          if (createdNodeIdentity(op.createdId, logicalNodeKey) !== createdNodeId)
            throw new Error("created descendant identity is not reproducible");
        }
        const ownedNodeIds = new Set(
          [...analysis.candidates.values()]
            .filter(
              (owned) =>
                owned.startTagStart >= candidate.startTagStart &&
                (owned.elementEnd ?? owned.startTagEnd) <= candidate.elementEnd!,
            )
            .map((owned) => owned.id),
        );
        ownedNodeIds.add(candidate.id);
        for (const snapshot of op.snapshotOperations) {
          if (snapshot.type === "toggleList") {
            if (snapshot.nodeIds.some((id) => !ownedNodeIds.has(id.split("#")[0]!)))
              throw new Error("snapshot operation crosses the duplicated section boundary");
          } else if (snapshot.type === "moveSection" || snapshot.type === "seo") {
            throw new Error("unsupported snapshot operation in duplicated section");
          } else if ("nodeId" in snapshot && !ownedNodeIds.has(snapshot.nodeId.split("#")[0]!)) {
            throw new Error("snapshot operation crosses the duplicated section boundary");
          }
        }
        const inverseNodeMap = new Map(
          Object.entries(op.nodeMap).map(([sourceId, createdNodeId]) => [createdNodeId, sourceId]),
        );
        const createdOperations = op.createdOperations ?? [];
        const recipeOperations = [...op.snapshotOperations, ...createdOperations];
        const recipeAssets = new Set(
          recipeOperations.flatMap((operation) =>
            operation.type === "media" && operation.value.source.kind === "staged"
              ? [operation.value.source.assetId]
              : [],
          ),
        );
        if (
          op.assetRefs.some((asset) => !recipeAssets.has(asset.assetId)) ||
          op.assetRefs.length !== recipeAssets.size
        ) {
          throw new Error("duplicate asset reference is not owned by its recipe");
        }
        for (const created of createdOperations) {
          if (created.type === "toggleList") {
            if (created.nodeIds.some((id) => !inverseNodeMap.has(id.split("#")[0]!)))
              throw new Error("created operation crosses the duplicated section boundary");
          } else if (created.type === "moveSection" || created.type === "seo") {
            throw new Error("unsupported operation in created section");
          } else if ("nodeId" in created && !inverseNodeMap.has(created.nodeId.split("#")[0]!)) {
            throw new Error("created operation crosses the duplicated section boundary");
          }
        }
        if (duplicateSectionOps.length > 0) {
          throw new Error("only one section duplication is allowed per task");
        }
        duplicateSectionOps.push({ candidate, op });
        structuralSequences.add(op.sequence);
        break;
      }
      case "seo": {
        if (!/^(title|description|canonical|ogTitle|ogDescription|ogImage)$/.test(op.field)) {
          throw new Error(`unsupported SEO field ${op.field}`);
        }
        if (op.value.length > (op.field === "description" ? 300 : 200)) {
          throw new Error(`SEO ${op.field} is too long`);
        }
        if (["canonical", "ogImage"].includes(op.field) && !isValidSiteUrl(op.value)) {
          throw new Error(`unsafe SEO URL rejected for ${op.field}`);
        }
        if (!op.value.trim() && op.field === "title") {
          throw new Error("SEO title cannot be empty");
        }
        if (seoOps.some((existing) => existing.field === op.field)) {
          throw new Error(`duplicate SEO operation for ${op.field}`);
        }
        seoOps.push(op);
        break;
      }
      case "media": {
        const candidate = analysis.candidates.get(op.nodeId);
        if (!candidate || candidate.kind !== "image") {
          throw new Error(`media target ${op.nodeId} is not an image`);
        }
        const value = normalizeMediaState(op.value);
        if (
          (value.framing && value.framing.fit !== "cover" && value.framing.fit !== "contain") ||
          (value.focus &&
            (!Number.isFinite(value.focus.x) ||
              !Number.isFinite(value.focus.y) ||
              value.focus.x < 0 ||
              value.focus.x > 1 ||
              value.focus.y < 0 ||
              value.focus.y > 1))
        ) {
          throw new Error(`invalid media framing for ${op.nodeId}`);
        }
        if ((value.framing || value.focus) && candidate.mediaCapabilities?.crop === false) {
          throw new Error(
            candidate.mediaCapabilities.cropReason ?? "image framing is not supported",
          );
        }
        if (!isValidSiteUrl(mediaSourcePath(value.source))) {
          throw new Error("unsafe media source rejected");
        }
        if (value.crop) {
          throw new Error("media crop must be materialized before publishing");
        }
        if (mediaOps.some(({ candidate: existing }) => existing.id === candidate.id)) {
          throw new Error(`duplicate media op on ${candidate.id}`);
        }
        mediaOps.push({ candidate, op: { ...op, value } });
        break;
      }
      case "formatBlock": {
        const candidate = analysis.candidates.get(op.nodeId);
        if (
          !candidate ||
          candidate.kind !== "text" ||
          !candidate.textEditable ||
          !isTextBlockTag(candidate.tag) ||
          (candidate.segments.length !== 1 && !isListTag(op.value)) ||
          candidate.tagNameStart === undefined ||
          candidate.tagNameEnd === undefined ||
          candidate.endTagNameStart === undefined ||
          candidate.endTagNameEnd === undefined
        ) {
          throw new Error(`format block target ${op.nodeId} is not safely editable`);
        }
        if (formatBlockOps.some(({ candidate: existing }) => existing.id === candidate.id)) {
          throw new Error(`duplicate format block op on ${op.nodeId}`);
        }
        if (!isBlockTag(op.value)) throw new Error("unsupported block format");
        formatBlockOps.push({ candidate, op });
        break;
      }
      case "toggleList": {
        if (
          !Array.isArray(op.nodeIds) ||
          op.nodeIds.length < 1 ||
          op.nodeIds.length > 20 ||
          new Set(op.nodeIds).size !== op.nodeIds.length ||
          !isListTag(op.value) ||
          !["plain", "ul", "ol"].includes(op.before) ||
          !["plain", "ul", "ol"].includes(op.after)
        ) {
          throw new Error("invalid list toggle");
        }
        const selected = op.nodeIds.map((nodeId) => analysis.candidates.get(nodeId));
        if (
          selected.some(
            (candidate) =>
              !candidate ||
              candidate.kind !== "text" ||
              !candidate.textEditable ||
              candidate.segments.length === 0 ||
              candidate.contentStart === undefined ||
              candidate.contentEnd === undefined ||
              candidate.elementEnd === undefined,
          )
        ) {
          throw new Error("list selection contains an unsafe text block");
        }
        // Normalize API input to source order, but keep mixed p/li selections rejected:
        // the existing toggleList schema cannot describe their original wrappers for undo.
        const resolved = (selected as Candidate[]).sort(
          (left, right) => left.startTagStart - right.startTagStart,
        );
        const selectedIsList = resolved.map((candidate) => candidate.tag === "li");
        const allList = selectedIsList.every(Boolean);
        const allPlain = selectedIsList.every((value) => !value);
        if (!allList && !allPlain)
          throw new Error("list selection cannot mix list items and plain blocks");
        const parentStart = resolved[0]!.parentStart;
        const parentEnd = resolved[0]!.parentEnd;
        const parentTag = resolved[0]!.parentTag;
        if (
          parentStart === undefined ||
          parentEnd === undefined ||
          resolved.some(
            (candidate) =>
              candidate.parentStart !== parentStart ||
              candidate.parentEnd !== parentEnd ||
              candidate.parentTag !== parentTag,
          )
        ) {
          throw new Error("list blocks must share one parent");
        }
        if (!parentTag || (allList && !isListTag(parentTag))) {
          throw new Error("list items must belong to a flat list");
        }
        if (allPlain && resolved.some((candidate) => candidate.tag !== "p")) {
          throw new Error("only paragraphs can become list items");
        }
        for (let index = 1; index < resolved.length; index += 1) {
          if (resolved[index - 1]!.startTagStart >= resolved[index]!.startTagStart) {
            throw new Error("list blocks must be in document order");
          }
        }
        const siblingCandidates = [...analysis.candidates.values()]
          .filter(
            (candidate) =>
              candidate.kind === "text" &&
              candidate.segments.length > 0 &&
              candidate.parentStart === parentStart &&
              candidate.parentEnd === parentEnd &&
              (allList ? candidate.tag === "li" : isTextBlockTag(candidate.tag)),
          )
          .sort((left, right) => left.startTagStart - right.startTagStart);
        const indexes = resolved.map((candidate) => siblingCandidates.indexOf(candidate));
        if (
          indexes.some((index) => index < 0) ||
          indexes.some((index, position) => index !== indexes[0]! + position)
        ) {
          throw new Error("list blocks must be contiguous siblings");
        }
        const actualBefore: "plain" | "ul" | "ol" = allList ? (parentTag as "ul" | "ol") : "plain";
        if (op.before !== actualBefore) throw new Error("list state changed before this edit");
        const listStart = resolved[0]!.parentStartTagEnd;
        const listEnd = resolved[0]!.parentEndTagStart;
        if (allList && (listStart === undefined || listEnd === undefined)) {
          throw new Error("list source mapping is ambiguous");
        }
        const renderList = (items: Candidate[], tag: "ul" | "ol"): string => {
          if (items.length === 0) return "";
          if (allList) {
            const open = sourceText
              .slice(parentStart, listStart!)
              .replace(new RegExp(`^<${parentTag}\\b`, "i"), `<${tag}`);
            const close = sourceText
              .slice(listEnd!, parentEnd)
              .replace(new RegExp(`^</${parentTag}\\s*>$`, "i"), `</${tag}>`);
            let body = sourceText.slice(listStart!, siblingCandidates[0]!.startTagStart);
            for (const [index, item] of items.entries()) {
              if (index > 0) {
                const previous = items[index - 1]!;
                body += sourceText.slice(previous.elementEnd!, item.startTagStart);
              }
              body += sourceText.slice(item.startTagStart, item.elementEnd!);
            }
            return `${open}${body}${close}`;
          }
          let result = `<${tag}>`;
          for (const [index, item] of items.entries()) {
            if (index > 0) {
              const previous = items[index - 1]!;
              result += sourceText.slice(previous.elementEnd!, item.startTagStart);
            }
            const attrs = sourceText.slice(
              item.startTagStart + 1 + item.tag.length,
              item.startTagEnd - 1,
            );
            result += `<li${attrs}>${sourceText.slice(item.contentStart!, item.contentEnd!)}</li>`;
          }
          return `${result}</${tag}>`;
        };
        const renderPlain = (items: Candidate[]): string =>
          items
            .map((item) => {
              const attrs = sourceText.slice(
                item.startTagStart + 1 + item.tag.length,
                item.startTagEnd - 1,
              );
              return `<p${attrs}>${sourceText.slice(item.contentStart!, item.contentEnd!)}</p>`;
            })
            .join("\n");
        const listItemsFor = (list: P5Element): Candidate[] =>
          [...analysis.candidates.values()]
            .filter(
              (candidate) =>
                candidate.tag === "li" &&
                candidate.parentStart === list.sourceCodeLocation?.startOffset &&
                candidate.parentEnd === list.sourceCodeLocation?.endOffset,
            )
            .sort((left, right) => left.startTagStart - right.startTagStart);
        const renderMergedList = (list: P5Element, items: Candidate[]): string => {
          const location = list.sourceCodeLocation;
          if (!location?.startTag || !location.endTag)
            throw new Error("list source mapping is ambiguous");
          const opening = sourceText.slice(location.startOffset, location.startTag.endOffset);
          const closing = sourceText.slice(location.endTag.startOffset, location.endOffset);
          const rendered = items.map((item) => {
            if (item.tag === "li") return sourceText.slice(item.startTagStart, item.elementEnd!);
            const attrs = sourceText.slice(
              item.startTagStart + 1 + item.tag.length,
              item.startTagEnd - 1,
            );
            return `<li${attrs}>${sourceText.slice(item.contentStart!, item.contentEnd!)}</li>`;
          });
          return `${opening}${rendered.join("\n")}${closing}`;
        };
        const sourceParent =
          parentStart !== undefined && parentEnd !== undefined
            ? elementAtSourceRange(sourceDocument, parentStart, parentEnd)
            : null;
        const directChildren = sourceParent?.childNodes.filter(isElement) ?? [];
        const directIndexes = resolved.map((candidate) =>
          directChildren.findIndex(
            (child) => child.sourceCodeLocation?.startOffset === candidate.startTagStart,
          ),
        );
        const firstIndex = indexes[0]!;
        const lastIndex = indexes.at(-1)! + 1;
        const beforeItems = siblingCandidates.slice(0, firstIndex);
        const selectedItems = siblingCandidates.slice(firstIndex, lastIndex);
        const afterItems = siblingCandidates.slice(lastIndex);
        let replacement: string;
        let replacementStart = allList ? parentStart : resolved[0]!.startTagStart;
        let replacementEnd = allList ? parentEnd : resolved.at(-1)!.elementEnd!;
        if (allPlain) {
          const directSelection =
            directIndexes.length === resolved.length &&
            directIndexes.every((index) => index >= 0) &&
            directIndexes.every(
              (index, position) => position === 0 || index === directIndexes[position - 1]! + 1,
            );
          const previousChild = directSelection ? directChildren[directIndexes[0]! - 1] : undefined;
          const nextChild = directSelection ? directChildren[directIndexes.at(-1)! + 1] : undefined;
          const isMergeableList = (child: P5Element | undefined): boolean => {
            if (!child || child.tagName !== op.after) return false;
            const children = child.childNodes.filter(isElement);
            return children.length > 0 && children.every((item) => item.tagName === "li");
          };
          const previousList = isMergeableList(previousChild) ? previousChild : null;
          const nextList = isMergeableList(nextChild) ? nextChild : null;
          const template = previousList ?? nextList;
          const templateLocation = template?.sourceCodeLocation;
          const templateOpening =
            template && templateLocation?.startTag
              ? sourceText.slice(templateLocation.startOffset, templateLocation.startTag.endOffset)
              : null;
          const sameOpening = (list: P5Element | null | undefined): boolean => {
            const location = list?.sourceCodeLocation;
            return !!(
              list &&
              location?.startTag &&
              templateOpening ===
                sourceText.slice(location.startOffset, location.startTag.endOffset)
            );
          };
          const mergePrevious = sameOpening(previousList) ? previousList : null;
          const mergeNext = sameOpening(nextList) ? nextList : null;
          if (template && (mergePrevious || mergeNext)) {
            const mergedItems = [
              ...(mergePrevious ? listItemsFor(mergePrevious) : []),
              ...selectedItems,
              ...(mergeNext ? listItemsFor(mergeNext) : []),
            ].sort((left, right) => left.startTagStart - right.startTagStart);
            replacement = renderMergedList(template, mergedItems);
            replacementStart =
              mergePrevious?.sourceCodeLocation?.startOffset ?? resolved[0]!.startTagStart;
            replacementEnd =
              mergeNext?.sourceCodeLocation?.endOffset ?? resolved.at(-1)!.elementEnd!;
          } else {
            replacement = renderList(selectedItems, op.after as "ul" | "ol");
          }
        } else if (op.after === "plain") {
          replacement = [
            renderList(beforeItems, actualBefore as "ul" | "ol"),
            renderPlain(selectedItems),
            renderList(afterItems, actualBefore as "ul" | "ol"),
          ]
            .filter(Boolean)
            .join("\n");
        } else {
          replacement = [
            renderList(beforeItems, actualBefore as "ul" | "ol"),
            renderList(selectedItems, op.after),
            renderList(afterItems, actualBefore as "ul" | "ol"),
          ]
            .filter(Boolean)
            .join("\n");
        }
        if (allList && selectedItems.length === siblingCandidates.length && op.after !== "plain") {
          replacement = renderList(selectedItems, op.after);
        }
        patches.push({
          start: replacementStart,
          end: replacementEnd,
          replacement,
        });
        break;
      }
      case "lineBreak":
        throw new Error("Line-break editing is deferred.");
      case "href":
      case "src":
      case "alt": {
        const candidate = analysis.candidates.get(op.nodeId);
        if (!candidate) throw new Error(`unknown node ${op.nodeId}`);
        if (op.type === "href") {
          if (candidate.kind !== "link") throw new Error(`href op requires a link target`);
          if (!isValidSiteUrl(op.value)) throw new Error("unsafe link destination rejected");
        } else {
          if (candidate.kind !== "image") throw new Error(`${op.type} op requires an image target`);
          if (op.type === "src" && candidate.mediaCapabilities?.replace === false) {
            throw new Error("responsive image replacement is not supported yet");
          }
          if (!isValidSiteUrl(op.value)) throw new Error("unsafe media source rejected");
        }
        attrOps.push({ candidate, op });
        break;
      }
    }
  }

  for (const { candidate, op } of htmlOps) {
    if (htmlOps.filter((item) => item.candidate.id === candidate.id).length > 1) {
      throw new Error(`duplicate html op on ${candidate.id}`);
    }
    patches.push({
      start: candidate.previewWrapper ? candidate.startTagStart : candidate.contentStart!,
      end: candidate.previewWrapper ? candidate.elementEnd! : candidate.contentEnd!,
      replacement: op.value,
    });
  }
  for (const op of seoOps) {
    const target = seoAnalysis.targets.get(op.field);
    if (!target && !seoAnalysis.headEnd) throw new Error("HTML document has no editable head");
    if (!target) continue;
    if (!op.value) {
      patches.push({ start: target.startTagStart, end: target.elementEnd, replacement: "" });
      continue;
    }
    if (op.field === "title") {
      if (target.contentStart === undefined || target.contentEnd === undefined) {
        throw new Error("title metadata has an unsafe source mapping");
      }
      patches.push({
        start: target.contentStart,
        end: target.contentEnd!,
        replacement: escapeHtmlText(op.value),
      });
      continue;
    }
    const attrName = op.field === "canonical" ? "href" : "content";
    const replacement = `${attrName}="${escapeHtmlAttr(op.value)}"`;
    if (target.valueAttr) {
      patches.push({
        start: target.valueAttr.sliceStart,
        end: target.valueAttr.sliceEnd,
        replacement,
      });
    } else {
      patches.push({
        start: target.startTagEnd - 1,
        end: target.startTagEnd - 1,
        replacement: ` ${replacement}`,
      });
    }
  }
  for (const op of seoOps) {
    if (seoAnalysis.targets.has(op.field) || !op.value || !seoAnalysis.headEnd) continue;
    const markup =
      op.field === "title"
        ? `<title>${escapeHtmlText(op.value)}</title>`
        : op.field === "description"
          ? `<meta name="description" content="${escapeHtmlAttr(op.value)}">`
          : op.field === "canonical"
            ? `<link rel="canonical" href="${escapeHtmlAttr(op.value)}">`
            : `<meta property="${op.field === "ogTitle" ? "og:title" : op.field === "ogDescription" ? "og:description" : "og:image"}" content="${escapeHtmlAttr(op.value)}">`;
    patches.push({ start: seoAnalysis.headEnd, end: seoAnalysis.headEnd, replacement: markup });
  }

  for (const { candidate, op } of sectionVisibilityOps) {
    const hidden = candidate.attrs.get("hidden");
    if (op.visible) {
      if (hidden) {
        const hasPreviousAttribute = [...candidate.attrs.values()].some(
          (attribute) => attribute.sliceEnd < hidden.sliceStart,
        );
        const start =
          hasPreviousAttribute && /\s/.test(sourceText[hidden.sliceStart - 1] ?? "")
            ? hidden.sliceStart - 1
            : hidden.sliceStart;
        patches.push({ start, end: hidden.sliceEnd, replacement: "" });
      }
    } else if (!hidden) {
      patches.push({
        start: candidate.startTagEnd - 1,
        end: candidate.startTagEnd - 1,
        replacement: " hidden",
      });
    }
  }
  let moveSourceText = sourceText;
  let moveAnalysis = analysis;
  let moveDocument = sourceDocument;
  const movedParentRanges: Array<{ start: number; end: number }> = [];
  if (moveSectionOps.length > 0) {
    const contentOperations = change.operations.filter(
      (operation) =>
        operation.type !== "duplicateSection" &&
        operation.type !== "moveSection" &&
        operation.type !== "duplicateGroupItem" &&
        operation.type !== "moveGroupItem",
    );
    if (contentOperations.length > 0) {
      const contentBytes = await patchHtml(
        encoder.encode(sourceText),
        {
          pagePath: change.pagePath,
          baseDigest: await digestBytes(encoder.encode(sourceText)),
          operations: contentOperations,
        },
        options,
      );
      moveSourceText = new TextDecoder("utf-8", { fatal: true }).decode(contentBytes);
      moveAnalysis = analyzePage(moveSourceText, options.ignoreSelectors ?? []);
      moveDocument = parse(moveSourceText, { sourceCodeLocationInfo: true }) as P5Document;
    }
  }
  const generatedDuplicateIds = new Set<string>();
  const duplicateMarkupByStart = new Map<number, string>();
  const duplicateGroupMarkupByEnd = new Map<number, string[]>();
  const duplicateGroupMarkupById = new Map<string, string>();
  const consumedDuplicateStarts = new Set<number>();
  for (const { candidate, op } of duplicateSectionOps) {
    let snapshotText = sourceText;
    // Snapshot operations are replayed against the original source document to
    // build the frozen duplicate template. Created-subtree operations are
    // replayed against an isolated section fragment below; mixing them here
    // would incorrectly mutate the original section.
    const recipe = [...op.snapshotOperations];
    if (recipe.length > 0) {
      const snapshotBytes = await patchHtml(
        encoder.encode(sourceText),
        {
          pagePath: change.pagePath,
          baseDigest: await digestBytes(encoder.encode(sourceText)),
          operations: recipe,
        },
        options,
      );
      snapshotText = new TextDecoder("utf-8", { fatal: true }).decode(snapshotBytes);
    }
    const snapshotAnalysis = analyzePage(snapshotText, options.ignoreSelectors ?? []);
    const snapshotCandidate = snapshotAnalysis.candidates.get(op.sourceId);
    if (!snapshotCandidate || snapshotCandidate.elementEnd === undefined) {
      throw new Error("duplicate snapshot source mapping is ambiguous");
    }
    const sourceMarkup = snapshotText.slice(
      snapshotCandidate.startTagStart,
      snapshotCandidate.elementEnd,
    );
    const localAnalysis = analyzePage(sourceMarkup, options.ignoreSelectors ?? []);
    const createdToLocalMap = new Map<string, string>();
    for (const [sourceId, createdId] of Object.entries(op.nodeMap)) {
      const sourceNode = snapshotAnalysis.candidates.get(sourceId);
      if (!sourceNode) throw new Error("duplicate snapshot node mapping is ambiguous");
      const relativeStart = sourceNode.startTagStart - snapshotCandidate.startTagStart;
      const localNode = [...localAnalysis.candidates.values()].find(
        (node) =>
          node.startTagStart === relativeStart &&
          node.kind === sourceNode.kind &&
          node.tag === sourceNode.tag,
      );
      if (!localNode) throw new Error("duplicate created node mapping is ambiguous");
      if (createdToLocalMap.has(createdId))
        throw new Error("duplicate created node identity is repeated");
      createdToLocalMap.set(createdId, localNode.id);
    }
    let finalMarkup = sourceMarkup;
    const createdOperations = (op.createdOperations ?? []).map((operation) =>
      remapCreatedOperation(operation, createdToLocalMap),
    );
    if (createdOperations.length > 0) {
      const createdBytes = await patchHtml(
        encoder.encode(sourceMarkup),
        {
          pagePath: change.pagePath,
          baseDigest: await digestBytes(encoder.encode(sourceMarkup)),
          operations: createdOperations,
        },
        options,
      );
      finalMarkup = new TextDecoder("utf-8", { fatal: true }).decode(createdBytes);
    }
    const cloneMarkup = duplicateSectionMarkup(
      finalMarkup,
      op.createdId,
      new Set([...allElementIds(sourceDocument), ...generatedDuplicateIds]),
      op.idMap,
    );
    const cloneDocument = parse(`<body>${cloneMarkup}</body>`) as P5Document;
    for (const id of allElementIds(cloneDocument)) generatedDuplicateIds.add(id);
    duplicateMarkupByStart.set(candidate.startTagStart, cloneMarkup);
    if (moveSectionOps.length === 0) {
      patches.push({
        start: candidate.elementEnd!,
        end: candidate.elementEnd!,
        replacement: cloneMarkup,
      });
    }
  }
  for (const { item, op } of [...duplicateGroupItemOps].sort(
    (left, right) => left.op.sequence - right.op.sequence,
  )) {
    const sourceMarkup = sourceText.slice(item.sourceStart, item.sourceEnd);
    const originalRoot = firstBodyElement(sourceMarkup);
    if (!originalRoot) throw new Error("duplicate Group item source mapping is ambiguous");
    const originalIds = allElementIds(originalRoot);
    if (new Set(originalIds).size !== originalIds.length)
      throw new Error("Group item contains duplicate HTML ids");
    const localAnalysis = analyzePage(sourceMarkup, options.ignoreSelectors ?? []);
    const sourceToLocalMap = new Map<string, string>();
    for (const [sourceId, createdId] of Object.entries(op.nodeMap)) {
      if (sourceId === op.sourceItemId) continue;
      const sourceNode = analysis.candidates.get(sourceId);
      if (
        !sourceNode ||
        sourceNode.startTagStart < item.sourceStart ||
        (sourceNode.elementEnd ?? sourceNode.startTagEnd) > item.sourceEnd
      ) {
        throw new Error("Group item node map crosses the item boundary");
      }
      const relativeStart = sourceNode.startTagStart - item.sourceStart;
      const localNode = [...localAnalysis.candidates.values()].find(
        (candidate) =>
          candidate.startTagStart === relativeStart &&
          candidate.kind === sourceNode.kind &&
          candidate.tag === sourceNode.tag,
      );
      if (!localNode) throw new Error("Group item node map is not reproducible");
      const expected = createdNodeIdentity(
        op.createdId,
        sourceTargetIdentity(
          change.pagePath,
          sourceNode.kind,
          sourceNode.startTagStart,
          sourceNode.elementEnd ?? sourceNode.startTagEnd,
          sourceNode.tag,
        ),
      );
      if (createdId !== expected) throw new Error("created Group item identity is invalid");
      if (sourceToLocalMap.has(sourceId)) throw new Error("Group item node map is repeated");
      sourceToLocalMap.set(sourceId, localNode.id);
    }
    const expectedSourceIds = [...analysis.candidates.values()]
      .filter(
        (candidate) =>
          candidate.startTagStart >= item.sourceStart &&
          (candidate.elementEnd ?? candidate.startTagEnd) <= item.sourceEnd,
      )
      .map((candidate) => candidate.id);
    if (
      Object.keys(op.nodeMap).length !== expectedSourceIds.length + 1 ||
      op.nodeMap[op.sourceItemId] !== op.createdId ||
      expectedSourceIds.some((sourceId) => !sourceToLocalMap.has(sourceId))
    ) {
      throw new Error("Group item node map is not reproducible");
    }
    const snapshotOperations = op.snapshotOperations.map((snapshot) => {
      const remapped = remapSnapshotOperation(snapshot, sourceToLocalMap);
      if (
        remapped.type === "format" &&
        remapped.sourceStart !== undefined &&
        remapped.sourceEnd !== undefined
      ) {
        return {
          ...remapped,
          sourceStart: remapped.sourceStart - item.sourceStart,
          sourceEnd: remapped.sourceEnd - item.sourceStart,
        };
      }
      return remapped;
    });
    const snapshotBytes = await patchHtml(
      encoder.encode(sourceMarkup),
      {
        pagePath: change.pagePath,
        baseDigest: await digestBytes(encoder.encode(sourceMarkup)),
        operations: snapshotOperations,
      },
      options,
    );
    let finalMarkup = new TextDecoder("utf-8", { fatal: true }).decode(snapshotBytes);
    const createdToLocalMap = new Map<string, string>();
    for (const [sourceId, createdId] of Object.entries(op.nodeMap)) {
      if (sourceId === op.sourceItemId) continue;
      const localId = sourceToLocalMap.get(sourceId);
      if (!localId) throw new Error("created Group item mapping is not reproducible");
      createdToLocalMap.set(createdId, localId);
    }
    const createdOperations = (op.createdOperations ?? []).map((created) =>
      remapCreatedOperation(created, createdToLocalMap),
    );
    if (createdOperations.length > 0) {
      const createdBytes = await patchHtml(
        encoder.encode(finalMarkup),
        {
          pagePath: change.pagePath,
          baseDigest: await digestBytes(encoder.encode(finalMarkup)),
          operations: createdOperations,
        },
        options,
      );
      finalMarkup = new TextDecoder("utf-8", { fatal: true }).decode(createdBytes);
    }
    const snapshotRoot = firstBodyElement(
      new TextDecoder("utf-8", { fatal: true }).decode(snapshotBytes),
    );
    if (!snapshotRoot) throw new Error("duplicate Group item source mapping is ambiguous");
    const snapshotIds = allElementIds(snapshotRoot);
    const finalRoot = firstBodyElement(finalMarkup);
    if (!finalRoot) throw new Error("duplicate Group item source mapping is ambiguous");
    const finalIds = allElementIds(finalRoot);
    if (
      new Set(snapshotIds).size !== new Set(finalIds).size ||
      snapshotIds.some((id) => !finalIds.includes(id)) ||
      finalIds.some((id) => !snapshotIds.includes(id))
    ) {
      throw new Error("created Group item operations cannot mutate HTML ids");
    }
    const expectedIdMap: Record<string, string> = {};
    for (const originalId of snapshotIds) {
      expectedIdMap[originalId] = duplicateGroupHtmlId(op.createdId, originalId);
    }
    if (
      Object.keys(op.idMap).length !== Object.keys(expectedIdMap).length ||
      Object.entries(expectedIdMap).some(
        ([originalId, cloneId]) => op.idMap[originalId] !== cloneId,
      )
    ) {
      throw new Error("Group item HTML id map is not reproducible");
    }
    const cloneMarkup = duplicateGroupItemMarkup(
      finalMarkup,
      op.createdId,
      new Set([...allElementIds(sourceDocument), ...generatedDuplicateIds]),
      op.idMap,
    );
    const cloneDocument = parse(`<body>${cloneMarkup}</body>`) as P5Document;
    for (const id of allElementIds(cloneDocument)) generatedDuplicateIds.add(id);
    const existing = duplicateGroupMarkupByEnd.get(item.sourceEnd) ?? [];
    existing.push(cloneMarkup);
    duplicateGroupMarkupByEnd.set(item.sourceEnd, existing);
    duplicateGroupMarkupById.set(op.createdId, cloneMarkup);
    const recipeAssets = new Set(
      [...op.snapshotOperations, ...createdOperations].flatMap((snapshot) =>
        snapshot.type === "media" && snapshot.value.source.kind === "staged"
          ? [snapshot.value.source.assetId]
          : [],
      ),
    );
    if (
      op.assetRefs.length !== recipeAssets.size ||
      op.assetRefs.some((asset) => !recipeAssets.has(asset.assetId))
    ) {
      throw new Error("Group item asset reference is not owned by its recipe");
    }
  }
  const movedGroupIds = new Set(moveGroupItemOps.map(({ group }) => group.id));
  if (moveGroupItemOps.length > 0) {
    const groupsToMove = [
      ...new Map(moveGroupItemOps.map(({ group }) => [group.id, group])).values(),
    ];
    for (const group of groupsToMove) {
      const container = elementAtSourceRange(sourceDocument, group.sourceStart, group.sourceEnd);
      const containerLocation = container?.sourceCodeLocation;
      if (!container || !containerLocation?.startTag || !containerLocation.endTag) {
        throw new Error("Group source mapping is ambiguous");
      }
      const sourceMarkups = new Map<string, string>();
      for (const item of group.items) {
        const sourceMarkup = sourceText.slice(item.sourceStart, item.sourceEnd);
        const itemAnalysis = analyzePage(sourceMarkup, options.ignoreSelectors ?? []);
        const ownedSourceIds = new Set(
          [...analysis.candidates.values()]
            .filter(
              (candidate) =>
                candidate.startTagStart >= item.sourceStart &&
                (candidate.elementEnd ?? candidate.startTagEnd) <= item.sourceEnd,
            )
            .map((candidate) => candidate.id),
        );
        const contentOperations = change.operations
          .filter((operation) => {
            if (
              operation.type === "duplicateSection" ||
              operation.type === "duplicateGroupItem" ||
              operation.type === "moveGroupItem" ||
              operation.type === "moveSection" ||
              operation.type === "seo" ||
              operation.type === "sectionVisibility"
            ) {
              return false;
            }
            const ids = operation.type === "toggleList" ? operation.nodeIds : [operation.nodeId];
            return ids.some((id) => ownedSourceIds.has(id.split("#")[0]!));
          })
          .map((operation) => {
            const remapped = remapSnapshotOperation(
              operation as SnapshotOperation,
              new Map(
                [...analysis.candidates.values()]
                  .filter((candidate) => ownedSourceIds.has(candidate.id))
                  .map((candidate) => {
                    const local = [...itemAnalysis.candidates.values()].find(
                      (localCandidate) =>
                        localCandidate.startTagStart ===
                          candidate.startTagStart - item.sourceStart &&
                        localCandidate.kind === candidate.kind &&
                        localCandidate.tag === candidate.tag,
                    );
                    return [candidate.id, local?.id] as const;
                  })
                  .filter((entry): entry is [string, string] => !!entry[1]),
              ),
            );
            if (
              remapped.type === "format" &&
              remapped.sourceStart !== undefined &&
              remapped.sourceEnd !== undefined
            ) {
              return {
                ...remapped,
                sourceStart: remapped.sourceStart - item.sourceStart,
                sourceEnd: remapped.sourceEnd - item.sourceStart,
              };
            }
            return remapped;
          });
        const effectiveBytes =
          contentOperations.length > 0
            ? await patchHtml(
                encoder.encode(sourceMarkup),
                {
                  pagePath: change.pagePath,
                  baseDigest: await digestBytes(encoder.encode(sourceMarkup)),
                  operations: contentOperations,
                },
                options,
              )
            : encoder.encode(sourceMarkup);
        sourceMarkups.set(
          item.id,
          new TextDecoder("utf-8", { fatal: true }).decode(effectiveBytes),
        );
      }
      const groupOperations: GroupOrderOperation[] = [
        ...duplicateGroupItemOps
          .filter(({ group: candidate }) => candidate.id === group.id)
          .map(({ op }) => ({
            type: "duplicateGroupItem" as const,
            sourceItemId: op.sourceItemId,
            createdId: op.createdId,
            sequence: op.sequence,
          })),
        ...moveGroupItemOps
          .filter(({ group: candidate }) => candidate.id === group.id)
          .map(({ op }) => ({
            type: "moveGroupItem" as const,
            itemId: op.itemId,
            targetItemId: op.targetItemId,
            position: op.position,
            sequence: op.sequence,
          })),
      ];
      const markups = new Map(sourceMarkups);
      for (const operation of groupOperations) {
        if (operation.type === "duplicateGroupItem") {
          const markup = duplicateGroupMarkupById.get(operation.createdId);
          if (!markup) throw new Error("Group duplicate source mapping is unavailable");
          markups.set(operation.createdId, markup);
        }
      }
      const order = replayGroupOrder(
        group.items.map((item) => item.id),
        groupOperations,
      );
      const firstItem = group.items[0];
      const lastItem = group.items.at(-1);
      if (!firstItem || !lastItem) throw new Error("Group item order is unavailable");
      const separator = sourceText.slice(firstItem.sourceEnd, group.items[1]!.sourceStart);
      const prefix = sourceText.slice(group.startTagEnd, firstItem.sourceStart);
      const trailing = sourceText.slice(lastItem.sourceEnd, containerLocation.endTag.startOffset);
      const replacement =
        prefix +
        order
          .map((id) => {
            const markup = markups.get(id);
            if (!markup) throw new Error("Group item order is unavailable");
            return markup;
          })
          .join(separator) +
        trailing;
      patches.push({
        start: containerLocation.startTag.endOffset,
        end: containerLocation.endTag.startOffset,
        replacement,
      });
      movedParentRanges.push({
        start: containerLocation.startTag.endOffset,
        end: containerLocation.endTag.startOffset,
      });
    }
  }
  const movedGroupItemEnds = new Set(
    [...movedGroupIds].flatMap(
      (groupId) =>
        groups.find((group) => group.id === groupId)?.items.map((item) => item.sourceEnd) ?? [],
    ),
  );
  for (const [end, markups] of duplicateGroupMarkupByEnd) {
    if (movedGroupItemEnds.has(end)) continue;
    patches.push({ start: end, end, replacement: markups.join("") });
  }
  if (
    (duplicateGroupItemOps.length > 0 || moveGroupItemOps.length > 0) &&
    moveSectionOps.length > 0
  ) {
    throw new Error("Group item operations cannot be combined with section movement");
  }
  for (const { candidate, op } of moveSectionOps) {
    const moveCandidate = moveAnalysis.candidates.get(op.nodeId) ?? candidate;
    const parent =
      moveCandidate.parentStart !== undefined && moveCandidate.parentEnd !== undefined
        ? elementAtSourceRange(moveDocument, moveCandidate.parentStart, moveCandidate.parentEnd)
        : null;
    const target = moveAnalysis.candidates.get(op.targetId);
    const targetDuplicate = duplicateSectionOps.find((entry) => entry.op.createdId === op.targetId);
    if (
      !parent ||
      (!target && !targetDuplicate) ||
      !parent.sourceCodeLocation?.startTag ||
      !parent.sourceCodeLocation.endTag ||
      (target &&
        (moveCandidate.parentStart !== target.parentStart ||
          moveCandidate.parentEnd !== target.parentEnd)) ||
      (targetDuplicate &&
        (candidate.parentStart !== targetDuplicate.candidate.parentStart ||
          candidate.parentEnd !== targetDuplicate.candidate.parentEnd))
    ) {
      throw new Error("section parent source mapping is ambiguous");
    }
    const children = parent.childNodes.filter(isElement);
    const sourceChild = children.find(
      (child) => child.sourceCodeLocation?.startOffset === moveCandidate.startTagStart,
    );
    if (!sourceChild) throw new Error("section sibling source mapping is ambiguous");
    const targetChild = target
      ? children.find((child) => child.sourceCodeLocation?.startOffset === target.startTagStart)
      : undefined;
    if (target && !targetChild) throw new Error("section sibling source mapping is ambiguous");
    const duplicateEntry = targetDuplicate
      ? [...duplicateMarkupByStart.entries()].find(
          ([start]) => start === targetDuplicate.candidate.startTagStart,
        )
      : [...duplicateMarkupByStart.entries()].find(([start]) => {
          const duplicateCandidate = [...analysis.candidates.values()].find(
            (item) => item.kind === "section" && item.startTagStart === start,
          );
          return (
            duplicateCandidate?.parentStart === candidate.parentStart &&
            duplicateCandidate?.parentEnd === candidate.parentEnd
          );
        });
    type VirtualChild = { source: P5Element } | { markup: string };
    const order: VirtualChild[] = children.map((child) => ({ source: child }));
    const duplicateItem: VirtualChild | undefined = duplicateEntry
      ? { markup: duplicateEntry[1] }
      : undefined;
    if (duplicateEntry && duplicateItem) {
      const duplicateIndex = order.findIndex(
        (item) => "source" in item && item.source === sourceChild,
      );
      if (duplicateIndex < 0) throw new Error("duplicate section source mapping is ambiguous");
      order.splice(duplicateIndex + 1, 0, duplicateItem);
      consumedDuplicateStarts.add(duplicateEntry[0]);
    }
    const sourceItem = order.find((item) => "source" in item && item.source === sourceChild);
    const targetItem = target
      ? order.find((item) => "source" in item && item.source === targetChild)
      : duplicateItem;
    if (!sourceItem || !targetItem) throw new Error("section sibling source mapping is ambiguous");
    const currentIndex = order.indexOf(sourceItem);
    const currentTargetIndex = order.indexOf(targetItem);
    order.splice(currentIndex, 1);
    let insertAt = currentTargetIndex + (op.before ? 0 : 1);
    if (currentIndex < insertAt) insertAt -= 1;
    order.splice(insertAt, 0, sourceItem);
    const contentStart = parent.sourceCodeLocation.startTag.endOffset;
    const contentEnd = parent.sourceCodeLocation.endTag.startOffset;
    const baseParent =
      candidate.parentStart !== undefined && candidate.parentEnd !== undefined
        ? elementAtSourceRange(sourceDocument, candidate.parentStart, candidate.parentEnd)
        : null;
    if (!baseParent?.sourceCodeLocation?.startTag || !baseParent.sourceCodeLocation.endTag)
      throw new Error("section parent source mapping is ambiguous");
    movedParentRanges.push({
      start: baseParent.sourceCodeLocation.startTag.endOffset,
      end: baseParent.sourceCodeLocation.endTag.startOffset,
    });
    const blocks = new Map<P5Element, string>();
    children.forEach((child, index) => {
      const location = child.sourceCodeLocation;
      if (!location) throw new Error("section sibling source mapping is ambiguous");
      const blockStart =
        index === 0 ? contentStart : children[index - 1]!.sourceCodeLocation!.endOffset;
      blocks.set(
        child,
        moveSourceText.slice(blockStart, location.startOffset) +
          moveSourceText.slice(location.startOffset, location.endOffset),
      );
    });
    const trailing = moveSourceText.slice(
      children.at(-1)!.sourceCodeLocation!.endOffset,
      contentEnd,
    );
    const replacement =
      order.map((item) => ("source" in item ? blocks.get(item.source) : item.markup)).join("") +
      trailing;
    patches.push({
      start: baseParent.sourceCodeLocation.startTag.endOffset,
      end: baseParent.sourceCodeLocation.endTag.startOffset,
      replacement,
    });
  }
  if (moveSectionOps.length > 0) {
    for (const [start, replacement] of duplicateMarkupByStart) {
      if (consumedDuplicateStarts.has(start)) continue;
      const duplicate = duplicateSectionOps.find(
        (entry) => entry.candidate.startTagStart === start,
      );
      if (!duplicate) throw new Error("duplicate section source mapping is ambiguous");
      patches.push({
        start: duplicate.candidate.elementEnd!,
        end: duplicate.candidate.elementEnd!,
        replacement,
      });
    }
  }
  for (const { candidate, op } of mediaOps) {
    const source = mediaSourcePath(op.value.source);
    const srcAttr = candidate.attrs.get("src");
    patches.push({
      start: srcAttr?.sliceStart ?? candidate.startTagEnd - 1,
      end: srcAttr?.sliceEnd ?? candidate.startTagEnd - 1,
      replacement: srcAttr ? `src="${escapeHtmlAttr(source)}"` : ` src="${escapeHtmlAttr(source)}"`,
    });
    const altAttr = candidate.attrs.get("alt");
    if (op.value.alt.present) {
      const replacement = `alt="${escapeHtmlAttr(op.value.alt.value)}"`;
      patches.push({
        start: altAttr?.sliceStart ?? candidate.startTagEnd - 1,
        end: altAttr?.sliceEnd ?? candidate.startTagEnd - 1,
        replacement: altAttr ? replacement : ` ${replacement}`,
      });
    } else if (altAttr) {
      patches.push({ start: altAttr.sliceStart, end: altAttr.sliceEnd, replacement: "" });
    }
    if (op.value.framing || op.value.focus) {
      const existing = candidate.attrs.has("style")
        ? sourceAttrValue(sourceText, candidate.attrs.get("style")!)
        : "";
      const style = mediaStyleValue(existing, op.value);
      const styleAttr = candidate.attrs.get("style");
      const replacement = `style="${escapeHtmlAttr(style)}"`;
      let insertAt = candidate.startTagEnd - 1;
      if (sourceText.slice(insertAt - 1, insertAt + 1) === "/>") insertAt -= 1;
      patches.push({
        start: styleAttr?.sliceStart ?? insertAt,
        end: styleAttr?.sliceEnd ?? insertAt,
        replacement: styleAttr ? replacement : ` ${replacement}`,
      });
    }
  }
  const formattedTextKeys = new Set<string>();
  const formatGroups = new Map<
    string,
    { candidate: Candidate; op: (PageOperation & { type: "format" })[] }
  >();
  for (const item of formatOps) {
    const group = formatGroups.get(item.candidate.id) ?? { candidate: item.candidate, op: [] };
    group.op.push(item.op);
    formatGroups.set(item.candidate.id, group);
  }
  for (const { candidate, op: operations } of formatGroups.values()) {
    const contentStart = candidate.contentStart!;
    const contentEnd = candidate.contentEnd!;
    let inner = sourceText.slice(contentStart, contentEnd);
    const nestedIntents = [...textIntents.entries()]
      .filter(
        ([, intent]) => intent.segment.start >= contentStart && intent.segment.end <= contentEnd,
      )
      .sort(([, left], [, right]) => right.segment.start - left.segment.start);

    for (const [key, intent] of nestedIntents) {
      const start = intent.segment.start - contentStart;
      const end = intent.segment.end - contentStart;
      inner = inner.slice(0, start) + intent.markup + inner.slice(end);
      formattedTextKeys.add(key);
    }
    const ranges = operations
      .map((op) => {
        if (op.start === undefined || op.end === undefined) {
          return { op, start: 0, end: inner.length };
        }
        if (
          op.sourceStart !== undefined &&
          op.sourceEnd !== undefined &&
          nestedIntents.length === 0
        ) {
          return {
            op,
            start: op.sourceStart - contentStart,
            end: op.sourceEnd - contentStart,
          };
        }
        const start = rawOffsetForVisibleText(inner, op.start);
        const end = rawOffsetForVisibleText(inner, op.end);
        if (start === null || end === null) {
          throw new Error("selection formatting requires plain text and line breaks");
        }
        if (nestedIntents.length > 0) return { op, start, end };
        const segment = candidate.segments[0];
        if (
          candidate.segments.length !== 1 ||
          !segment ||
          segment.end - segment.start !== segment.text.length
        ) {
          throw new Error("selection formatting requires a plain text source range");
        }
        return {
          op,
          start: segment.start - contentStart + op.start,
          end: segment.start - contentStart + op.end,
        };
      })
      .sort((left, right) => left.start - right.start);
    for (let i = 1; i < ranges.length; i++) {
      if (ranges[i]!.start < ranges[i - 1]!.end) {
        throw new Error(`overlapping formatting ranges on ${candidate.id}`);
      }
    }
    for (const { op, start, end } of [...ranges].reverse()) {
      if (start < 0 || end > inner.length || end <= start) {
        throw new Error(`formatting range on ${candidate.id} is out of bounds`);
      }
      const tag = formatTag(op.value);
      inner = `${inner.slice(0, start)}<${tag}>${inner.slice(start, end)}</${tag}>${inner.slice(end)}`;
    }
    patches.push({ start: contentStart, end: contentEnd, replacement: inner });
  }

  for (const [key, intent] of textIntents) {
    if (formattedTextKeys.has(key)) continue;
    patches.push({
      start: intent.segment.start,
      end: intent.segment.end,
      replacement: intent.markup,
    });
  }

  for (const { candidate, op } of formatBlockOps) {
    patches.push({
      start: candidate.tagNameStart!,
      end: candidate.tagNameEnd!,
      replacement: op.value,
    });
    patches.push({
      start: candidate.endTagNameStart!,
      end: candidate.endTagNameEnd!,
      replacement: op.value,
    });
    if (isListTag(op.value)) {
      patches.push({
        start: candidate.startTagEnd!,
        end: candidate.startTagEnd!,
        replacement: "<li>",
      });
      patches.push({
        start: candidate.endTagNameStart! - 2,
        end: candidate.endTagNameStart! - 2,
        replacement: "</li>",
      });
    }
  }
  for (const { candidate, op } of attrOps) {
    const escaped = `${op.type}="${escapeHtmlAttr(op.value)}"`;
    const attr = candidate.attrs.get(op.type);
    if (attr) {
      patches.push({ start: attr.sliceStart, end: attr.sliceEnd, replacement: escaped });
    } else {
      let insertAt = candidate.startTagEnd - 1;
      if (sourceText.slice(insertAt - 1, insertAt + 1) === "/>") insertAt -= 1;
      patches.push({ start: insertAt, end: insertAt, replacement: ` ${escaped}` });
    }
  }

  for (const range of movedParentRanges) {
    for (let index = patches.length - 1; index >= 0; index -= 1) {
      const patch = patches[index]!;
      if (
        patch.start >= range.start &&
        patch.end <= range.end &&
        (patch.start > range.start || patch.end < range.end)
      )
        patches.splice(index, 1);
    }
  }
  patches.sort((a, b) => b.start - a.start);
  for (let i = 1; i < patches.length; i++) {
    const prev = patches[i - 1]!;
    const cur = patches[i]!;
    if (cur.end > prev.start) throw new Error("overlapping patches rejected");
  }

  let out = sourceText;
  for (const patch of patches) {
    out = out.slice(0, patch.start) + patch.replacement + out.slice(patch.end);
  }

  // result must remain parseable HTML
  parse(out);

  return encoder.encode(out);
}
