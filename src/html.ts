import { parse } from "parse5";
import type { DefaultTreeAdapterTypes } from "parse5";
import type {
  PageChange,
  PageOperation,
  PreparedPreview,
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
        candidates.set(id, {
          id,
          kind: "text",
          tag,
          startTagStart: loc.startTag!.startOffset,
          startTagEnd: loc.startTag!.endOffset,
          multiline: MULTILINE_TAGS.has(tag),
          textEditable: true,
          segments,
          attrs: collectAttrRanges(node),
        });
        becameCandidate = true;
      }
    }

    if (becameCandidate) {
      const id = [...candidates.values()].at(-1)!.id;
      injections.push({
        offset: candidates.get(id)!.startTagStart + 1 + tag.length,
        text: ` data-xyle-node="${id}"`,
      });
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

  for (const op of change.operations) {
    switch (op.type) {
      case "text": {
        const ref = parseSegmentRef(op.nodeId);
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

  for (const intent of textIntents.values()) {
    patches.push({
      start: intent.segment.start,
      end: intent.segment.end,
      replacement: intent.markup,
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
