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
} from "./types.ts";
import { digestBytes } from "./digest.ts";
import { sourceTargetIdentity } from "./identity.ts";
import { mediaSourcePath, normalizeMediaState } from "./media-state.ts";

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

  return { html, nodes };
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
        if (
          !candidate ||
          candidate.kind !== "section" ||
          !target ||
          target.kind !== "section" ||
          candidate.id === target.id ||
          candidate.parentStart === undefined ||
          candidate.parentEnd === undefined ||
          candidate.parentStart !== target.parentStart ||
          candidate.parentEnd !== target.parentEnd
        ) {
          throw new Error("sections must be safe siblings in one parent");
        }
        if (typeof op.before !== "boolean")
          throw new Error(`invalid section move for ${candidate.id}`);
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
          !sectionChildren.some(
            (child) => child.sourceCodeLocation?.startOffset === target.startTagStart,
          )
        ) {
          throw new Error("section sibling source mapping is ambiguous");
        }
        const originalIndex = sectionChildren.findIndex(
          (child) => child.sourceCodeLocation?.startOffset === candidate.startTagStart,
        );
        moveSectionOps.push({ candidate, op: { ...op, originalIndex } });
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
  for (const { candidate, op } of moveSectionOps) {
    const parent =
      candidate.parentStart !== undefined && candidate.parentEnd !== undefined
        ? elementAtSourceRange(sourceDocument, candidate.parentStart, candidate.parentEnd)
        : null;
    const target = analysis.candidates.get(op.targetId);
    if (
      !parent ||
      !target ||
      !parent.sourceCodeLocation?.startTag ||
      !parent.sourceCodeLocation.endTag
    ) {
      throw new Error("section parent source mapping is ambiguous");
    }
    const children = parent.childNodes.filter(isElement);
    const sourceChild = children.find(
      (child) => child.sourceCodeLocation?.startOffset === candidate.startTagStart,
    );
    const targetChild = children.find(
      (child) => child.sourceCodeLocation?.startOffset === target.startTagStart,
    );
    if (!sourceChild || !targetChild)
      throw new Error("section sibling source mapping is ambiguous");
    const sourceIndex = children.indexOf(sourceChild);
    const targetIndex = children.indexOf(targetChild);
    const order = [...children];
    order.splice(sourceIndex, 1);
    let insertAt = targetIndex + (op.before ? 0 : 1);
    if (sourceIndex < insertAt) insertAt -= 1;
    order.splice(insertAt, 0, sourceChild);
    const contentStart = parent.sourceCodeLocation.startTag.endOffset;
    const contentEnd = parent.sourceCodeLocation.endTag.startOffset;
    const blocks = children.map((child, index) => {
      const location = child.sourceCodeLocation;
      if (!location) throw new Error("section sibling source mapping is ambiguous");
      const blockStart =
        index === 0 ? contentStart : children[index - 1]!.sourceCodeLocation!.endOffset;
      return sourceText.slice(blockStart, location.endOffset);
    });
    const trailing = sourceText.slice(children.at(-1)!.sourceCodeLocation!.endOffset, contentEnd);
    const replacement = order.map((child) => blocks[children.indexOf(child)]).join("") + trailing;
    patches.push({ start: contentStart, end: contentEnd, replacement });
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
