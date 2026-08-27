import { parse, parseFragment, serialize } from "parse5";
import type { DefaultTreeAdapterTypes } from "parse5";
import type {
  PageChange,
  PageOperation,
  PreparedPreview,
  TextFormat,
  PreviewNode,
  XyleDigest,
} from "./types.ts";
import { digestBytes } from "./digest.ts";

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

interface Candidate {
  id: string;
  kind: PreviewNode["kind"];
  tag: string;
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

  const isNestedCandidateStop = (el: P5Element): boolean =>
    el.tagName === "a" || el.tagName === "img";

  const visit = (
    node: P5Node,
    insidePicture: boolean,
    insideTextContainer: boolean,
    insideIgnored: boolean,
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
    if (node.attrs.some((a) => a.name === "hidden")) return;

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

    if (tag === "img") {
      const src = attrValue(node, "src");
      const hidden = node.attrs.some((a) => a.name === "hidden");
      if (
        src !== null &&
        !node.attrs.some((a) => a.name === "srcset") &&
        !insidePicture &&
        !hidden
      ) {
        counter += 1;
        const id = `n${counter}`;
        const loc = node.sourceCodeLocation!;
        candidates.set(id, {
          id,
          kind: "image",
          tag,
          startTagStart: loc.startTag!.startOffset,
          startTagEnd: loc.startTag!.endOffset,
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
          tag,
          startTagStart: loc.startTag!.startOffset,
          startTagEnd: loc.startTag!.endOffset,
          contentStart: loc.startTag!.endOffset,
          contentEnd: loc.endTag?.startOffset ?? loc.endOffset,
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
    const suppressesChildren = becameCandidate;

    for (const child of node.childNodes) {
      visit(
        child,
        insidePicture || tag === "picture",
        insideTextContainer || suppressesChildren,
        ignored,
      );
    }
  };

  const htmlEl = doc.childNodes.find((n) => isElement(n) && n.tagName === "html");
  const roots = htmlEl && isElement(htmlEl) ? htmlEl.childNodes : doc.childNodes;
  for (const child of roots) visit(child, false, false, false);

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
      sourceEnd: c.segments.at(-1)?.end ?? c.startTagEnd,
      segments: c.segments.map((segment) => ({
        sourceStart: segment.start,
        sourceEnd: segment.end,
        textLength: segment.text.length,
      })),
      tag: c.tag,
      multiline: c.multiline,
      textEditable: c.textEditable,
      segmentCount: c.segments.length,
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

function isBlockTag(tag: string): tag is "p" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" {
  return tag === "p" || /^h[1-6]$/.test(tag);
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
      case "formatBlock": {
        const candidate = analysis.candidates.get(op.nodeId);
        if (
          !candidate ||
          candidate.kind !== "text" ||
          !candidate.textEditable ||
          !isBlockTag(candidate.tag) ||
          candidate.segments.length !== 1 ||
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
      case "lineBreak": {
        const ref = parseSegmentRef(op.nodeId);
        const candidate = analysis.candidates.get(ref.nodeId);
        if (!candidate) throw new Error(`unknown text target ${ref.nodeId}`);
        if (!candidate.multiline) {
          throw new Error(`<${candidate.tag}> rejects line breaks`);
        }
        const segment = candidate.segments[ref.segmentIndex];
        if (!segment) throw new Error(`segment ${ref.segmentIndex} missing on ${ref.nodeId}`);
        const pos = op.position;
        if (!Number.isInteger(pos) || pos < 0 || pos > segment.text.length) {
          throw new Error(`lineBreak position ${pos} out of bounds`);
        }
        const key = `${ref.nodeId}#${ref.segmentIndex}`;
        if (textIntents.has(key)) throw new Error(`duplicate text op on ${key}`);
        textIntents.set(key, {
          candidate,
          segment,
          markup: `${escapeHtmlText(segment.text.slice(0, pos))}<br>${escapeHtmlText(segment.text.slice(pos))}`,
        });
        break;
      }
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
          if (!isValidSiteUrl(op.value)) throw new Error("unsafe media source rejected");
        }
        attrOps.push({ candidate, op });
        break;
      }
    }
  }

  const patches: SourcePatch[] = [];
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
