export type InlineFormat = "bold" | "italic" | "underline" | "strikethrough";

const FORMAT_TAGS: Record<InlineFormat, "strong" | "em" | "u" | "s"> = {
  bold: "strong",
  italic: "em",
  underline: "u",
  strikethrough: "s",
};
const INLINE_TAGS = new Set([
  "a",
  "abbr",
  "b",
  "bdi",
  "bdo",
  "cite",
  "del",
  "em",
  "ins",
  "i",
  "kbd",
  "mark",
  "q",
  "s",
  "samp",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "time",
  "u",
  "var",
  "wbr",
  "br",
]);

function tagFor(format: InlineFormat): string {
  return FORMAT_TAGS[format];
}

function textNodes(root: HTMLElement): Text[] {
  const result: Text[] = [];
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    result.push(node as Text);
    node = walker.nextNode();
  }
  return result;
}

function offsetAt(root: HTMLElement, container: Node, offset: number): number | null {
  if (!root.contains(container) || offset < 0) return null;
  const range = root.ownerDocument.createRange();
  try {
    range.setStart(root, 0);
    range.setEnd(container, offset);
    return range.toString().length;
  } catch {
    return null;
  }
}

function rangeAt(root: HTMLElement, start: number, end: number): Range | null {
  const nodes = textNodes(root);
  let total = 0;
  let startPoint: { node: Text; offset: number } | null = null;
  let endPoint: { node: Text; offset: number } | null = null;
  for (const node of nodes) {
    const next = total + node.length;
    if (!startPoint && start <= next) startPoint = { node, offset: start - total };
    if (!endPoint && end <= next) {
      endPoint = { node, offset: end - total };
      break;
    }
    total = next;
  }
  if (!startPoint || !endPoint) return null;
  const range = root.ownerDocument.createRange();
  range.setStart(startPoint.node, Math.max(0, startPoint.offset));
  range.setEnd(endPoint.node, Math.max(0, endPoint.offset));
  return range;
}

function hasUnsupportedStructure(root: HTMLElement): boolean {
  const elements = root.querySelectorAll("*");
  return [...elements].some(
    (element) =>
      element.hasAttribute("data-xyle-node") || !INLINE_TAGS.has(element.tagName.toLowerCase()),
  );
}

function hasFormat(node: Text, root: HTMLElement, tag: string): boolean {
  let parent = node.parentElement;
  while (parent && parent !== root) {
    if (parent.tagName.toLowerCase() === tag) return true;
    parent = parent.parentElement;
  }
  return false;
}

function splitSelectedText(node: Text, start: number, end: number): Text {
  if (end < node.length) node.splitText(end);
  return start > 0 ? node.splitText(start) : node;
}

function wrapText(node: Text, tag: string, format: InlineFormat): void {
  const wrapper = node.ownerDocument.createElement(tag);
  wrapper.setAttribute("data-xyle-format", format);
  node.parentNode!.insertBefore(wrapper, node);
  wrapper.append(node);
}

function unwrapSelectedText(node: Text, tag: string, root: HTMLElement): void {
  let wrapper = node.parentElement;
  while (wrapper && wrapper !== root && wrapper.tagName.toLowerCase() !== tag) {
    wrapper = wrapper.parentElement;
  }
  if (!wrapper || wrapper === root) return;

  // Split intervening inline ancestors first. This keeps overlapping formats
  // such as <strong><em>text</em></strong> intact when only bold is removed.
  let selected: Node = node;
  while (selected.parentNode !== wrapper) {
    const container = selected.parentNode;
    if (!container || container.nodeType !== Node.ELEMENT_NODE) return;
    const before = container.cloneNode(false) as HTMLElement;
    const selectedContainer = container.cloneNode(false) as HTMLElement;
    const after = container.cloneNode(false) as HTMLElement;
    while (container.firstChild && container.firstChild !== selected) {
      before.append(container.firstChild);
    }
    if (container.firstChild !== selected) return;
    container.removeChild(selected);
    selectedContainer.append(selected);
    while (container.firstChild) after.append(container.firstChild);
    const parent = container.parentNode;
    if (!parent) return;
    if (before.hasChildNodes()) parent.insertBefore(before, container);
    parent.insertBefore(selectedContainer, container);
    if (after.hasChildNodes()) parent.insertBefore(after, container);
    parent.removeChild(container);
    selected = selectedContainer;
  }

  const parent = wrapper.parentNode;
  if (!parent) return;
  const before = wrapper.cloneNode(false) as HTMLElement;
  const after = wrapper.cloneNode(false) as HTMLElement;
  while (wrapper.firstChild && wrapper.firstChild !== selected) before.append(wrapper.firstChild);
  if (wrapper.firstChild !== selected) return;
  wrapper.removeChild(selected);
  while (wrapper.firstChild) after.append(wrapper.firstChild);
  if (before.hasChildNodes()) parent.insertBefore(before, wrapper);
  parent.insertBefore(selected, wrapper);
  if (after.hasChildNodes()) parent.insertBefore(after, wrapper);
  wrapper.remove();
}

function sameAttributes(left: Element, right: Element): boolean {
  if (left.attributes.length !== right.attributes.length) return false;
  return [...left.attributes].every(
    (attribute) => right.getAttribute(attribute.name) === attribute.value,
  );
}

function normalizeNode(parent: Node): void {
  for (const child of [...parent.childNodes]) {
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const element = child as HTMLElement;
    const tag = element.tagName.toLowerCase();
    if (tag === "b" || tag === "i") {
      const replacement = element.ownerDocument.createElement(tag === "b" ? "strong" : "em");
      for (const attribute of [...element.attributes]) {
        replacement.setAttribute(attribute.name, attribute.value);
      }
      while (element.firstChild) replacement.append(element.firstChild);
      element.replaceWith(replacement);
      normalizeNode(replacement);
      continue;
    }
    normalizeNode(element);
    if (["strong", "em", "u", "s"].includes(tag) && !element.hasChildNodes()) {
      element.remove();
      continue;
    }
    const parent = element.parentElement;
    if (parent && parent.tagName.toLowerCase() === tag && sameAttributes(parent, element)) {
      while (element.firstChild) parent.insertBefore(element.firstChild, element);
      element.remove();
      continue;
    }
    const previous = element.previousSibling;
    if (
      previous?.nodeType === Node.ELEMENT_NODE &&
      (previous as HTMLElement).tagName.toLowerCase() === tag &&
      sameAttributes(previous as Element, element)
    ) {
      while (element.firstChild) (previous as HTMLElement).append(element.firstChild);
      element.remove();
    }
  }
}

export type InlineFormatState = "on" | "off" | "mixed";

/** Report whether every, no, or only some selected characters have a format. */
export function inlineFormatState(
  root: HTMLElement,
  range: Range,
  format: InlineFormat,
): InlineFormatState {
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return "off";
  const start = offsetAt(root, range.startContainer, range.startOffset);
  const end = offsetAt(root, range.endContainer, range.endOffset);
  if (start === null || end === null || start >= end) return "off";
  const tag = tagFor(format);
  const states = textNodes(root)
    .map((node) => {
      const nodeStart = offsetAt(root, node, 0) ?? 0;
      const nodeEnd = nodeStart + node.length;
      return {
        node,
        selected: Math.min(end, nodeEnd) > Math.max(start, nodeStart),
      };
    })
    .filter((item) => item.selected)
    .map(({ node }) => hasFormat(node, root, tag));
  if (states.length === 0) return "off";
  if (states.every(Boolean)) return "on";
  if (states.every((state) => !state)) return "off";
  return "mixed";
}

/** Apply or remove one supported inline format and restore the selection. */
export function toggleInlineFormat(
  root: HTMLElement,
  selection: Selection,
  format: InlineFormat,
): boolean {
  if (selection.rangeCount === 0 || selection.isCollapsed || hasUnsupportedStructure(root)) {
    return false;
  }
  const sourceRange = selection.getRangeAt(0);
  if (!root.contains(sourceRange.startContainer) || !root.contains(sourceRange.endContainer)) {
    return false;
  }
  const start = offsetAt(root, sourceRange.startContainer, sourceRange.startOffset);
  const end = offsetAt(root, sourceRange.endContainer, sourceRange.endOffset);
  if (start === null || end === null || start >= end) return false;

  const tag = tagFor(format);
  const selected = textNodes(root)
    .map((node) => {
      const nodeStart = offsetAt(root, node, 0) ?? 0;
      const nodeEnd = nodeStart + node.length;
      return {
        node,
        start: Math.max(start, nodeStart) - nodeStart,
        end: Math.min(end, nodeEnd) - nodeStart,
        nodeStart,
        nodeEnd,
      };
    })
    .filter(({ node, start: nodeStart, end: nodeEnd }) => node.length > 0 && nodeEnd > nodeStart);
  if (selected.length === 0) return false;

  const remove = selected.every(({ node }) => hasFormat(node, root, tag));
  for (const item of [...selected].reverse()) {
    const selectedNode = splitSelectedText(item.node, item.start, item.end);
    if (remove) unwrapSelectedText(selectedNode, tag, root);
    else if (!hasFormat(selectedNode, root, tag)) wrapText(selectedNode, tag, format);
  }
  normalizeNode(root);
  const restored = rangeAt(root, start, end);
  if (!restored) return false;
  selection.removeAllRanges();
  selection.addRange(restored);
  return true;
}

/** Serialize editor HTML without Xyle-only instrumentation attributes. */
export function cleanInlineHtml(root: HTMLElement): string {
  const clone = root.cloneNode(true) as HTMLElement;
  clone.removeAttribute("data-xyle-node");
  for (const element of clone.querySelectorAll(
    "[data-xyle-format], [data-xyle-controlled-break]",
  )) {
    element.removeAttribute("data-xyle-format");
    element.removeAttribute("data-xyle-controlled-break");
  }
  normalizeNode(clone);
  return clone.innerHTML;
}
