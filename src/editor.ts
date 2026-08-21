// Xyle editor shell — browser-side control layer.
// Drafts live only in memory; publish patches original static source server-side.

interface NodeMeta {
  id: string;
  pagePath: string;
  kind: "text" | "link" | "image";
  tag?: string;
  multiline?: boolean;
  textEditable?: boolean;
  segmentCount?: number;
}

interface PageData {
  pagePath: string;
  baseDigest: string;
  html: string;
  nodes: NodeMeta[];
}

type Op =
  | { type: "text"; nodeId: string; value: string }
  | { type: "href"; nodeId: string; value: string }
  | { type: "src"; nodeId: string; value: string; assetName?: string }
  | { type: "alt"; nodeId: string; value: string };

interface PageOps {
  pagePath: string;
  baseDigest: string;
  operations: Op[];
}

interface HistoryEntry {
  label: string;
  undo: () => void;
  redo: () => void;
}

const MAX_HISTORY = 100;

const state = {
  current: null as PageData | null,
  ops: [] as { pagePath: string; op: Op }[],
  history: [] as HistoryEntry[],
  historyIndex: 0,
  assets: new Map<string, { file: File; objectUrl: string }>(),
  publishedSnapshotDigest: "",
  showEditables: localStorage.getItem("xyle.showEditables") === "1",
};

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document): T =>
  root.querySelector(sel) as T;

function api(path: string, init?: RequestInit): Promise<Response> {
  return fetch(path, init);
}

function flash(message: string): void {
  const el = $("#xyle-flash");
  el.textContent = message;
  el.classList.add("visible");
  window.clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => el.classList.remove("visible"), 1800);
}
let flashTimer = 0;

async function boot(): Promise<void> {
  const session = await (await api("/__xyle/api/session")).json();
  if (!session.authenticated) {
    location.assign("/edit");
    return;
  }

  buildChrome();
  const params = new URLSearchParams(location.search);
  await loadPage(params.get("page") ?? "/index.html", { pushHistory: false });

  window.addEventListener("beforeunload", (event) => {
    if (dirtyCount() > 0) event.preventDefault();
  });
}

async function loadPage(pagePath: string, opts: { pushHistory: boolean }): Promise<void> {
  const res = await api(`/__xyle/api/page?path=${encodeURIComponent(pagePath)}`);
  if (!res.ok) {
    flash("That page could not be loaded.");
    return;
  }
  const data = (await res.json()) as PageData & { baseDigest: string };
  state.current = data;
  state.publishedSnapshotDigest = state.publishedSnapshotDigest || (await snapshotDigest());

  renderPreview();
  if (opts.pushHistory) {
    const url = new URL(location.href);
    url.searchParams.set("page", data.pagePath);
    history.replaceState(null, "", url);
  }
}

let iframe: HTMLIFrameElement;

function renderPreview(): void {
  const host = $("#xyle-preview-host");
  host.innerHTML = "";
  iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-same-origin");
  iframe.id = "xyle-preview";
  host.append(iframe);
  iframe.srcdoc = state.current!.html;
  iframe.addEventListener("load", () => wirePreview(), { once: true });
}

function previewDoc(): Document | null {
  return iframe?.contentDocument ?? null;
}

function wirePreview(): void {
  const doc = previewDoc();
  if (!doc || !state.current) return;

  metaById.clear();
  for (const meta of state.current.nodes) metaById.set(meta.id, meta);

  // overlay layer for outlines/markers — never part of a candidate subtree
  const overlay = doc.createElement("div");
  overlay.id = "xyle-overlay-root";
  doc.body.append(overlay);

  const style = doc.createElement("style");
  style.textContent = `
    #xyle-overlay-root{position:absolute;inset:0;pointer-events:none;z-index:2147483646}
    .xyle-hover{outline:2px solid rgba(15,110,168,.55);outline-offset:2px;border-radius:4px}
    .xyle-editable-candidate{outline:1.5px dashed rgba(15,110,168,.35);outline-offset:2px;border-radius:4px}
    [data-xyle-node]{cursor:text}
    img[data-xyle-node]{cursor:pointer}
    #xyle-overlay-root .xyle-img-tools{position:absolute;display:flex;gap:.4rem;pointer-events:auto}
    #xyle-overlay-root .xyle-img-tools button{font:600 .78rem system-ui;padding:.3em .7em;border:0;border-radius:5px;background:#0f6ea8;color:#fff;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.25)}
    #xyle-overlay-root .xyle-marker{position:absolute;width:9px;height:9px;border-radius:50%;background:#e8a13a;box-shadow:0 0 0 2px rgba(255,255,255,.85)}
    #xyle-overlay-root *{transition:outline-color .12s ease}
  `;
  doc.head.append(style);

  for (const el of doc.querySelectorAll<HTMLElement>("[data-xyle-node]")) {
    const id = el.getAttribute("data-xyle-node")!;
    wireCandidate(el, metaById.get(id));
  }

  // suppress all navigation inside the preview; route through the shell
  doc.body.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const anchor = target.closest("a");
    if (!anchor) return;
    event.preventDefault();
    if (anchor.hasAttribute("data-xyle-node")) return; // link editing handles it
    handlePreviewNavigation(anchor as HTMLAnchorElement);
  });
  doc.body.addEventListener("submit", (e) => e.preventDefault(), true);

  applyShowEditables();
  restoreOpsIntoDom();
}

const metaById = new Map<string, NodeMeta>();

function handlePreviewNavigation(anchor: HTMLAnchorElement): void {
  const href = anchor.getAttribute("href") ?? "";
  if (/^(https?:)?\/\//i.test(href) || /^(mailto|tel):/i.test(href)) {
    flash("External links do not navigate in edit mode.");
    return;
  }
  try {
    const resolved = new URL(href, `${location.origin}${state.current!.pagePath}`);
    loadPage(resolved.pathname, { pushHistory: true }).then(() => {
      // re-apply pending text ops for this page after reload
      restoreOpsIntoDom();
    });
  } catch {
    flash("That link could not be followed.");
  }
}

/* ---------- candidate wiring ---------- */

function wireCandidate(el: HTMLElement, meta: NodeMeta | undefined): void {
  if (!meta) return;
  el.addEventListener("mouseenter", () => el.classList.add("xyle-hover"));
  el.addEventListener("mouseleave", () => el.classList.remove("xyle-hover"));

  if (meta.kind === "text" && meta.textEditable) wireText(el, meta);
  if (meta.kind === "link") {
    wireLink(el, meta);
    if (meta.textEditable) wireText(el, meta);
  }
  if (meta.kind === "image") wireImage(el, meta);
}

/* ---------- text editing ---------- */

function wireText(el: HTMLElement, meta: NodeMeta): void {
  el.addEventListener("click", (event) => {
    if (session?.el === el) return;
    // let link dialogs win; otherwise click-to-edit
    event.stopPropagation();
    startEdit(el, meta);
  });
}

interface EditSession {
  el: HTMLElement;
  meta: NodeMeta;
  baselineClone: DocumentFragment;
  /** Baseline segment values in server segment order (document order). */
  baselineValues: string[];
  /** Slot keys aligned with baselineValues. */
  baselineKeys: string[];
  baselineSkeleton: string;
}

let session: EditSession | null = null;

const SKIP_TAGS = new Set([
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

function isNestedCandidate(el: HTMLElement, root: HTMLElement): boolean {
  return el !== root && el.hasAttribute("data-xyle-node");
}

/**
 * Structural identity of a text node: indexes of non-BR elements along its
 * ancestor chain up to (not including) the editable root. Two text nodes
 * share a slot iff the user inserted only <br> elements between them, so a
 * slot maps to exactly one server-side patchable segment.
 */
function slotKeyOf(textNode: Node, root: Node): string {
  const chain: number[] = [];
  let node: Node | null = textNode;
  while (node && node.parentNode && node.parentNode !== root) {
    const parent: Node = node.parentNode;
    let index = 0;
    const children = Array.from(parent.childNodes) as Node[];
    for (const sibling of children) {
      if (sibling === node) break;
      if (sibling.nodeType === Node.ELEMENT_NODE && (sibling as HTMLElement).tagName !== "BR") {
        index += 1;
      }
    }
    chain.unshift(index);
    node = parent;
  }
  return chain.join("/");
}

interface SegmentPair {
  key: string;
  /** Final text for this segment; "\n" marks controlled <br> positions. */
  value: string;
}

/** Mirrors the server's segment enumeration over live or cloned DOM. */
function collectSegments(rootEl: HTMLElement): SegmentPair[] {
  const pairs: SegmentPair[] = [];
  const seen = new Map<string, string[]>();

  const walk = (element: HTMLElement, isRoot: boolean): void => {
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const key = slotKeyOf(child, rootEl);
        let parts = seen.get(key);
        if (!parts) {
          parts = [""];
          seen.set(key, parts);
          pairs.push({ key, value: "" });
        }
        parts[parts.length - 1] += child.textContent ?? "";
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const childEl = child as HTMLElement;
      if (SKIP_TAGS.has(childEl.tagName.toLowerCase())) continue;
      if (isNestedCandidate(childEl, rootEl)) continue;
      if (childEl.tagName === "BR" && !isRoot) {
        // br inside an inline formatting child continues the enclosing slot
        const key = slotKeyOf(childEl, rootEl);
        const parts = seen.get(key);
        if (parts) parts.push("");
        continue;
      }
      walk(childEl, false);
    }
  };

  // top-level brs terminate the leading slot directly
  const topWalk = (): void => {
    let openKey: string | null = null;
    for (const child of Array.from(rootEl.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        openKey = slotKeyOf(child, rootEl);
        let parts = seen.get(openKey);
        if (!parts) {
          parts = [""];
          seen.set(openKey, parts);
          pairs.push({ key: openKey, value: "" });
        }
        parts[parts.length - 1] += child.textContent ?? "";
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const childEl = child as HTMLElement;
      if (SKIP_TAGS.has(childEl.tagName.toLowerCase())) continue;
      if (isNestedCandidate(childEl, rootEl)) continue;
      if (childEl.tagName === "BR") {
        if (openKey) seen.get(openKey)?.push("");
        continue;
      }
      walk(childEl, false);
    }
  };
  topWalk();

  for (const pair of pairs) pair.value = (seen.get(pair.key) ?? []).join("\n");
  return pairs;
}

/** Structural skeleton used by post-input validation (elements only). */
function skeleton(el: HTMLElement): string {
  let out = "";
  const walk = (node: Node): void => {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as HTMLElement;
    if (element.id === "xyle-overlay-root") return;
    out += `<${element.tagName}>`;
    for (const child of Array.from(node.childNodes)) walk(child);
  };
  for (const child of Array.from(el.childNodes)) walk(child);
  return out;
}

function startEdit(el: HTMLElement, meta: NodeMeta): void {
  if (session) commitEdit();
  const doc = previewDoc()!;
  const baselineClone = doc.createDocumentFragment();
  for (const child of Array.from(el.childNodes)) baselineClone.append(child.cloneNode(true));

  const baselinePairs = collectSegments(el);
  session = {
    el,
    meta,
    baselineClone,
    baselineValues: baselinePairs.map((p) => p.value),
    baselineKeys: baselinePairs.map((p) => p.key),
    baselineSkeleton: skeleton(el),
  };

  for (const [i, value] of session.baselineValues.entries()) {
    rememberOriginalSegment(`${meta.id}#${i}`, value);
  }

  const plainOnly =
    meta.segmentCount === 1 && !Array.from(el.children).some((c) => c.tagName !== "BR");

  (el as unknown as { contentEditable: string }).contentEditable =
    plainOnly && supportsPlaintextOnly() ? "plaintext-only" : "true";
  el.classList.add("xyle-editing");
  el.focus();

  el.addEventListener("beforeinput", onBeforeInput);
  el.addEventListener("input", onInput);
  el.addEventListener("keydown", onKeyDown);
}

function supportsPlaintextOnly(): boolean {
  const probe = document.createElement("div");
  try {
    probe.contentEditable = "plaintext-only";
    return probe.contentEditable === "plaintext-only";
  } catch {
    return false;
  }
}

function onKeyDown(event: KeyboardEvent): void {
  if (!session) return;
  if (event.key === "Escape") {
    event.preventDefault();
    revertEdit();
  }
}

function allowedMultiline(): boolean {
  return session?.meta.multiline === true;
}

function selectionInsideEditable(): boolean {
  const selection = getSelection();
  if (!selection || selection.rangeCount === 0 || !session) return false;
  return session.el.contains(selection.anchorNode) && session.el.contains(selection.focusNode);
}

function onBeforeInput(event: InputEvent): void {
  if (!session) return;
  switch (event.inputType) {
    case "insertParagraph":
    case "insertLineBreak": {
      event.preventDefault();
      if (!allowedMultiline() || !selectionInsideEditable()) {
        flash("Line breaks are not supported here.");
        return;
      }
      insertManualBr();
      dispatchSyntheticInput(session.el);
      return;
    }
    case "formatBold":
    case "formatItalic":
    case "formatUnderline":
    case "formatStrikeThrough":
    case "insertHorizontalRule":
    case "insertOrderedList":
    case "insertUnorderedList": {
      event.preventDefault();
      flash("Formatting commands are not available.");
      return;
    }
    case "insertFromPaste": {
      const htmlData = event.dataTransfer?.getData("text/html");
      if (htmlData && !(session.meta.segmentCount === 1)) {
        event.preventDefault();
        flash("Formatted paste is not supported here.");
        return;
      }
      // plain text paste flows through normal input path
      return;
    }
    default:
      return; // structural damage is caught by post-input validation
  }
}

function insertManualBr(): void {
  const selection = getSelection()!;
  if (selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const br = document.createElement("br");
  range.insertNode(br);
  range.setStartAfter(br);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function dispatchSyntheticInput(el: HTMLElement): void {
  el.dispatchEvent(new InputEvent("input", { bubbles: true, data: "\n" }));
}

function onInput(_event: Event): void {
  if (!session) return;
  validateStructure();
}

/** Second guard: revert any developer-owned structure change. */
function validateStructure(): void {
  if (!session) return;
  if (!structureAllowed(skeleton(session.el), session.baselineSkeleton)) {
    flash("That change was reverted to protect your design.");
    restoreBaseline();
  }
}

/** Only text mutations plus multiline <br> changes may pass. */
function structureAllowed(current: string, baseline: string): boolean {
  if (current === baseline) return true;
  const strip = (s: string) => s.replaceAll("<BR>", "");
  const allowed = session?.meta.multiline === true && strip(current) === strip(baseline);
  return allowed;
}

function restoreBaseline(): void {
  if (!session) return;
  const { el, baselineClone } = session;
  el.innerHTML = "";
  for (const child of Array.from(baselineClone.childNodes)) el.append(child.cloneNode(true));
}

function revertEdit(): void {
  if (!session) return;
  restoreBaseline();
  endEdit(false);
}

function commitEdit(): void {
  if (!session) return;
  const currentPairs = collectSegments(session.el);
  const changed = currentPairs.some((pair, i) => pair.value !== session?.baselineValues[i]);
  endEdit(changed);
}

function endEdit(recordChanges: boolean): void {
  const s = session!;
  s.el.removeEventListener("beforeinput", onBeforeInput);
  s.el.removeEventListener("input", onInput);
  s.el.removeEventListener("keydown", onKeyDown);
  s.el.classList.remove("xyle-editing");
  (s.el as unknown as { contentEditable: string }).contentEditable = "false";

  if (recordChanges) {
    const currentPairs = collectSegments(s.el);
    for (const [i, pair] of currentPairs.entries()) {
      if (pair.value !== s.baselineValues[i]) {
        applyOp(
          s.meta.pagePath,
          {
            type: "text",
            nodeId: `${s.meta.id}#${i}`,
            value: pair.value,
          },
          "Edit text",
        );
      }
    }
  }
  session = null;
  updateDirtyUi();
}

/* ---------- link editing ---------- */

function wireLink(el: HTMLElement, meta: NodeMeta): void {
  el.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest("[data-xyle-editing-url]")) return;
    event.preventDefault();
    event.stopPropagation();
    openHrefDialog(el, meta);
  });
}

function openHrefDialog(el: HTMLElement, meta: NodeMeta): void {
  const dialog = document.createElement("dialog");
  dialog.setAttribute("data-xyle-editing-url", "1");
  dialog.innerHTML = `
    <form method="dialog" style="display:grid;gap:.6rem;font:system-ui,sans-serif">
      <label style="font-weight:600">Link destination</label>
      <input name="href" style="padding:.45em .6em;font:inherit;border:1px solid #bbb;border-radius:6px;min-width:22rem"
        value="${(el.getAttribute("href") ?? "").replaceAll('"', "&quot;")}">
      <p class="err" style="color:#b3261e;font-size:.8rem;margin:0"></p>
      <div style="display:flex;gap:.5rem;justify-content:flex-end">
        <button value="cancel" style="font:inherit;padding:.4em .9em;border-radius:6px;border:1px solid #ccc;background:#fff">Cancel</button>
        <button value="save" style="font:inherit;padding:.4em .9em;border-radius:6px;border:0;background:#0f6ea8;color:#fff">Save</button>
      </div>
    </form>`;
  document.body.append(dialog);
  dialog.addEventListener("close", () => {
    const value = (dialog.querySelector("input") as HTMLInputElement).value;
    if (dialog.returnValue === "save") {
      if (isSafeUrl(value)) {
        applyOp(meta.pagePath, { type: "href", nodeId: meta.id, value }, "Edit link");
        el.setAttribute("href", value);
      } else {
        flash("That destination is not allowed.");
      }
    }
    dialog.remove();
  });
  dialog.querySelector("form")!.addEventListener("submit", (event) => {
    const input = dialog.querySelector("input") as HTMLInputElement;
    if (dialog.returnValue !== "cancel" && !isSafeUrl(input.value)) {
      event.preventDefault();
      (dialog.querySelector(".err") as HTMLElement).textContent =
        "Use a relative path, https:, http:, mailto: or tel:";
    }
  });
  (dialog.querySelector("input") as HTMLInputElement).select();
  dialog.showModal();
}

function isSafeUrl(url: string): boolean {
  const trimmed = url.trim();
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return false;
  if (/^\s*(javascript|data|vbscript)\s*:/i.test(trimmed)) return false;
  try {
    const parsed = new URL(trimmed, location.origin);
    return ["http:", "https:", "mailto:", "tel:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

/* ---------- images & media ---------- */

let selectedImage: { el: HTMLImageElement; meta: NodeMeta } | null = null;

function wireImage(el: HTMLElement, meta: NodeMeta): void {
  const img = el as HTMLImageElement;
  img.addEventListener("click", () => selectImage(img, meta));

  img.addEventListener("mouseenter", () => showImageTools(img, meta));
  img.addEventListener("mouseleave", () => hideImageTools(img));
}

function showImageTools(img: HTMLImageElement, meta: NodeMeta): void {
  const doc = previewDoc()!;
  const overlay = doc.getElementById("xyle-overlay-root")!;
  hideImageTools(img);
  const rect = img.getBoundingClientRect();
  const tools = doc.createElement("div");
  tools.className = "xyle-img-tools";
  tools.dataset.forNode = meta.id;
  tools.style.left = `${rect.left + windowScrollX(doc)}px`;
  tools.style.top = `${rect.bottom - 34 + windowScrollY(doc)}px`;
  const replace = doc.createElement("button");
  replace.textContent = "Replace";
  replace.addEventListener("click", (event) => {
    event.stopPropagation();
    pickLocalFile(img, meta);
  });
  const media = doc.createElement("button");
  media.textContent = "Media";
  media.addEventListener("click", (event) => {
    event.stopPropagation();
    selectImage(img, meta);
    openMediaDrawer();
  });
  tools.append(replace, media);
  overlay.append(tools);
}

function windowScrollX(doc: Document): number {
  return doc.defaultView?.scrollX ?? 0;
}
function windowScrollY(doc: Document): number {
  return doc.defaultView?.scrollY ?? 0;
}

function hideImageTools(img: HTMLImageElement): void {
  previewDoc()
    ?.querySelectorAll(`.xyle-img-tools[data-for-node="${img.getAttribute("data-xyle-node")}"]`)
    ?.forEach((t) => {
      t.remove();
    });
}

function pickLocalFile(img: HTMLImageElement, meta: NodeMeta): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/jpeg,image/png,image/webp,image/avif";
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    await useFileForImage(img, meta, file);
  });
  input.click();
}

async function useFileForImage(img: HTMLImageElement, meta: NodeMeta, file: File): Promise<void> {
  if (file.size > 20 * 1024 * 1024) {
    flash("Images must be 20 MB or smaller.");
    return;
  }
  const buffer = await file.arrayBuffer();
  if (!isRasterSignature(new Uint8Array(buffer))) {
    flash("Only JPEG, PNG, WebP and AVIF uploads are supported.");
    return;
  }
  const objectUrl = URL.createObjectURL(file);
  img.src = objectUrl;

  const digestHex = await sha256Hex(new Uint8Array(buffer));
  const ext = extFor(file.type);
  const assetPath = `/__media/${digestHex.slice(0, 12)}.${ext}`;

  state.assets.set(assetPath, { file, objectUrl });
  applyOp(
    meta.pagePath,
    { type: "src", nodeId: meta.id, value: assetPath, assetName: file.name },
    "Replace image",
  );
  img.setAttribute("src", assetPath);
  img.src = objectUrl; // keep blob preview until publish
  updateDirtyUi();
}

function isRasterSignature(bytes: Uint8Array): boolean {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return true;
  }
  const riff = String.fromCharCode(...bytes.slice(0, 4));
  const webp = String.fromCharCode(...bytes.slice(8, 12));
  if (riff === "RIFF" && webp === "WEBP") return true;
  const brand = String.fromCharCode(...bytes.slice(8, 12));
  if (String.fromCharCode(...bytes.slice(4, 8)) === "ftyp" && brand.startsWith("avif")) return true;
  return false;
}

function extFor(contentType: string): string {
  switch (contentType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/avif":
      return "avif";
    default:
      return "bin";
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

function selectImage(img: HTMLImageElement, meta: NodeMeta): void {
  selectedImage = { el: img, meta };
  openAltEditor(img, meta);
}

function openAltEditor(img: HTMLImageElement, meta: NodeMeta): void {
  const existing = img.getAttribute("alt") ?? "";
  const dialog = document.createElement("dialog");
  dialog.innerHTML = `
    <form method="dialog" style="display:grid;gap:.6rem;font:system-ui,sans-serif">
      <label style="font-weight:600">Alt text</label>
      <input name="alt" value="${existing.replaceAll('"', "&quot;")}"
        style="padding:.45em .6em;font:inherit;border:1px solid #bbb;border-radius:6px;min-width:20rem">
      <div style="display:flex;gap:.5rem;justify-content:flex-end">
        <button value="cancel" style="font:inherit;padding:.4em .9em;border-radius:6px;border:1px solid #ccc;background:#fff">Cancel</button>
        <button value="save" style="font:inherit;padding:.4em .9em;border-radius:6px;border:0;background:#0f6ea8;color:#fff">Save</button>
      </div>
    </form>`;
  document.body.append(dialog);
  dialog.addEventListener("close", () => {
    if (dialog.returnValue === "save") {
      const value = (dialog.querySelector("input") as HTMLInputElement).value;
      applyOp(meta.pagePath, { type: "alt", nodeId: meta.id, value }, "Edit alt text");
      img.setAttribute("alt", value);
    }
    dialog.remove();
  });
  dialog.showModal();
}

/* ---------- media drawer ---------- */

interface MediaItem {
  path: string;
  contentType: string;
  source: "site" | "xyle-upload";
  usedBySimpleImg: boolean;
}

let drawerOpen = false;

async function openMediaDrawer(): Promise<void> {
  if (drawerOpen) return;
  drawerOpen = true;
  const res = await api("/__xyle/api/media");
  const items = (await res.json()) as MediaItem[];
  renderMediaDrawer(items);
}

function closeMediaDrawer(): void {
  $("#xyle-media-drawer")?.remove();
  drawerOpen = false;
}

function renderMediaDrawer(items: MediaItem[]): void {
  closeMediaDrawer();
  drawerOpen = true;
  const drawer = document.createElement("aside");
  drawer.id = "xyle-media-drawer";
  drawer.style.cssText =
    "position:fixed;top:0;right:0;bottom:0;width:min(24rem,90vw);background:#fff;box-shadow:-12px 0 30px rgba(0,0,0,.15);z-index:2147483647;display:flex;flex-direction:column;padding:1rem;font-family:system-ui,sans-serif";
  drawer.innerHTML = `
    <header style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.75rem">
      <strong>Media</strong>
      <button id="xyle-media-close" style="border:0;background:none;font-size:1.2rem;cursor:pointer">×</button>
    </header>
    <input id="xyle-media-search" placeholder="Search images..."
      style="padding:.45em .6em;border:1px solid #ccc;border-radius:6px;margin-bottom:.6rem">
    <nav id="xyle-media-tabs" style="display:flex;gap:.35rem;margin-bottom:.6rem">
      <button data-tab="all" style="flex:1">All</button>
      <button data-tab="used" style="flex:1">Used</button>
      <button data-tab="uploads" style="flex:1">Uploads</button>
    </nav>
    <div id="xyle-media-grid" style="flex:1;overflow:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(6.5rem,1fr));gap:.5rem"></div>
    <button id="xyle-media-upload" style="margin-top:.6rem;padding:.55em;font:600 .9rem system-ui;color:#fff;background:#0f6ea8;border:0;border-radius:6px">Upload image</button>
  `;
  document.body.append(drawer);

  const grid = $<HTMLElement>("#xyle-media-grid", drawer);
  const search = $<HTMLInputElement>("#xyle-media-search", drawer);
  let tab = "all";

  const drawGrid = (): void => {
    const query = search.value.trim().toLowerCase();
    grid.innerHTML = "";
    for (const item of items) {
      if (tab === "used" && !item.usedBySimpleImg) continue;
      if (tab === "uploads" && item.source !== "xyle-upload") continue;
      if (query && !item.path.toLowerCase().includes(query)) continue;
      const cell = document.createElement("button");
      cell.style.cssText =
        "border:1px solid #ddd;border-radius:6px;padding:.25rem;background:#fafafa;cursor:pointer";
      const thumb = document.createElement("img");
      thumb.src = item.path;
      thumb.alt = item.path.split("/").pop() ?? "";
      thumb.loading = "lazy";
      thumb.style.cssText = "width:100%;height:4.5rem;object-fit:cover;display:block";
      cell.append(thumb);
      cell.title = item.path;
      cell.addEventListener("click", () => chooseExistingMedia(item.path));
      grid.append(cell);
    }
  };
  search.addEventListener("input", drawGrid);
  for (const button of drawer.querySelectorAll<HTMLButtonElement>("#xyle-media-tabs button")) {
    button.addEventListener("click", () => {
      tab = button.dataset.tab!;
      drawGrid();
    });
  }
  $("#xyle-media-close", drawer).addEventListener("click", closeMediaDrawer);
  $("#xyle-media-upload", drawer).addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/png,image/webp,image/avif";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file || !selectedImage) {
        if (file) flash("Select an image in the page first.");
        return;
      }
      await useFileForImage(selectedImage.el, selectedImage.meta, file);
      flash("Image updated.");
    });
    input.click();
  });
  drawGrid();
}

function chooseExistingMedia(path: string): void {
  if (!selectedImage) return;
  const { el, meta } = selectedImage;
  state.assets.delete(el.getAttribute("src") ?? "");
  el.setAttribute("src", path);
  el.src = path;
  removeOpsFor(`${meta.id}:src`);
  applyOp(meta.pagePath, { type: "src", nodeId: meta.id, value: path }, "Replace image");
  closeMediaDrawer();
  flash("Image updated.");
}

/* ---------- ChangeSet / history / chrome ---------- */

function applyOp(pagePath: string, op: Op, label: string): void {
  const key = opKey(op);
  removeOpsFor(key);
  const beforeOps = [...state.ops];
  state.ops.push({ pagePath, op });

  const undo = (): void => {
    state.ops = beforeOps
      .filter((entry) => entryKey(entry) !== key)
      .concat(state.ops.filter((entry) => entryKey(entry) !== key));
    revertOpInDom(pagePath, op);
    updateDirtyUi();
  };
  const redo = (): void => {
    state.ops.push({ pagePath, op });
    updateDirtyUi();
  };
  pushHistory({ label, undo, redo });
  updateDirtyUi();
}

function opKey(op: Op): string {
  const target = op.nodeId.includes("#") ? op.nodeId : `${op.nodeId}:${op.type}`;
  return `${op.type}@${target}`;
}
function entryKey(entry: { op: Op }): string {
  return opKey(entry.op);
}
function removeOpsFor(key: string): void {
  state.ops = state.ops.filter((entry) => entryKey(entry) !== key);
}

function pushHistory(entry: HistoryEntry): void {
  state.history = state.history.slice(0, state.historyIndex);
  state.history.push(entry);
  if (state.history.length > MAX_HISTORY) state.history.shift();
  state.historyIndex = state.history.length;
}

function dirtyCount(): number {
  return state.ops.length;
}

function updateDirtyUi(): void {
  const count = dirtyCount();
  $("#xyle-dirty").style.display = count > 0 ? "" : "none";
  $("#xyle-count").textContent = `${count} change${count === 1 ? "" : "s"}`;
  refreshMarkers();
}

function snapshotDigest(): Promise<string> {
  return api("/__xyle/api/manifest")
    .then((r) => r.json())
    .then((m) => m.snapshotDigest);
}

function buildChrome(): void {
  document.body.innerHTML = `
  <main style="position:fixed;inset:0;display:flex;flex-direction:column">
    <div id="xyle-preview-host" style="flex:1;position:relative"></div>
  </main>
  <div id="xyle-flash" style="position:fixed;top:1rem;left:50%;transform:translateX(-50%);background:#1d2733;color:#fff;padding:.5em 1em;border-radius:8px;font:500 .85rem system-ui;opacity:0;transition:opacity .2s;pointer-events:none;z-index:2147483647"></div>

  <div id="xyle-bar-left" style="position:fixed;left:1rem;bottom:1rem;display:flex;gap:.5rem;z-index:2147483647;font-family:system-ui,sans-serif">
    <div style="position:relative">
      <button id="xyle-menu-btn" style="font:600 .85rem system-ui;padding:.5em .9em;border:0;border-radius:8px;background:#1d2733;color:#fff;cursor:pointer">Xyle</button>
      <div id="xyle-menu" style="display:none;position:absolute;bottom:2.4rem;left:0;background:#fff;border:1px solid #ddd;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.18);min-width:11rem;overflow:hidden">
        <button data-action="exit" style="all:unset;display:block;width:100%;box-sizing:border-box;padding:.6em 1em;font:500 .88rem system-ui;cursor:pointer">Exit editor</button>
        <button data-action="live" style="all:unset;display:block;width:100%;box-sizing:border-box;padding:.6em 1em;font:500 .88rem system-ui;cursor:pointer">View live site</button>
        <hr style="border:0;border-top:1px solid #eee;margin:.15rem 0">
        <button data-action="logout" style="all:unset;display:block;width:100%;box-sizing:border-box;padding:.6em 1em;font:500 .88rem system-ui;cursor:pointer">Log out</button>
      </div>
    </div>
    <button id="xyle-show-editables" style="font:500 .85rem system-ui;padding:.5em .9em;border:1px solid #d5d2cb;border-radius:8px;background:#fff;cursor:pointer">Show editables</button>
  </div>

  <div id="xyle-dirty" style="position:fixed;right:1rem;bottom:1rem;display:none;gap:.5rem;z-index:2147483647;font-family:system-ui,sans-serif">
    <button id="xyle-changes" style="font:500 .85rem system-ui;padding:.5em .9em;border:1px solid #d5d2cb;border-radius:8px;background:#fff;cursor:pointer"><span id="xyle-count">0 changes</span></button>
    <button id="xyle-publish" style="font:600 .85rem system-ui;padding:.5em 1.1em;border:0;border-radius:8px;background:#0f6ea8;color:#fff;cursor:pointer">Publish</button>
  </div>
  <div id="xyle-conflict" style="display:none;position:fixed;top:1rem;left:50%;transform:translateX(-50%);background:#7a1f1f;color:#fff;padding:1rem;border-radius:10px;z-index:2147483647;font-family:system-ui,sans-serif;max-width:32rem">
    <strong>The published site changed.</strong>
    <p style="margin:.4rem 0 .8rem;font-size:.88rem">Your edits are still here, but publishing would overwrite newer content.</p>
    <button id="xyle-conflict-reload" style="font:inherit;padding:.4em .9em;margin-right:.5rem;border:0;border-radius:6px;background:#fff;color:#1d2733;cursor:pointer">Reload published site</button>
    <button id="xyle-conflict-dismiss" style="font:inherit;padding:.4em .9em;border:1px solid #ffffff66;border-radius:6px;background:none;color:#fff;cursor:pointer">Keep editing</button>
  </div>
  `;

  const menuBtn = $("#xyle-menu-btn");
  const menu = $("#xyle-menu");
  menuBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    menu.style.display = menu.style.display === "none" ? "block" : "none";
  });
  document.addEventListener("click", () => (menu.style.display = "none"));
  for (const button of menu.querySelectorAll<HTMLButtonElement>("button[data-action]")) {
    button.addEventListener("click", () => menuAction(button.dataset.action!));
  }

  const toggle = $("#xyle-show-editables");
  toggle.textContent = state.showEditables ? "Hide editables" : "Show editables";
  toggle.addEventListener("click", () => {
    state.showEditables = !state.showEditables;
    localStorage.setItem("xyle.showEditables", state.showEditables ? "1" : "0");
    toggle.textContent = state.showEditables ? "Hide editables" : "Show editables";
    applyShowEditables();
  });

  $("#xyle-publish").addEventListener("click", publish);
  $("#xyle-changes").addEventListener("click", openChangesDrawer);
  $("#xyle-conflict-reload").addEventListener("click", () => location.reload());
  $("#xyle-conflict-dismiss").addEventListener("click", () => {
    $("#xyle-conflict").style.display = "none";
  });

  document.addEventListener("keydown", (event) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    const inField = (document.activeElement as HTMLElement | null)?.isContentEditable === true;
    if (event.key === "z" || event.key === "Z") {
      if (inField) return; // browser-native field handling wins
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    }
    if (event.key === "y" && !inField) {
      event.preventDefault();
      redo();
    }
  });

  // click outside finishes the active field edit
  document.addEventListener("mousedown", (event) => {
    if (!session) return;
    const doc = previewDoc();
    const target = event.target as Node;
    const inShellUi = (target as Element)?.closest?.(
      "#xyle-dirty,#xyle-bar-left,#xyle-media-drawer,dialog",
    );
    if (inShellUi) {
      commitEdit();
      return;
    }
    if (doc && doc.body.contains(target)) {
      const editableHost = (target as Element)?.closest?.("[data-xyle-node]");
      if (editableHost !== session.el) commitEdit();
    }
  });
}

function menuAction(action: string): void {
  if (action === "exit") exitEditor();
  if (action === "live") {
    window.open(state.current ? `${location.origin}${state.current.pagePath}` : "/", "_blank");
  }
  if (action === "logout") logout();
}

function confirmDiscard(action: string): boolean {
  if (dirtyCount() === 0) return true;
  const message = `Discard ${dirtyCount()} unpublished change(s) and ${action}?`;
  return confirm(message);
}

function discardAll(): void {
  for (const { objectUrl } of state.assets.values()) URL.revokeObjectURL(objectUrl);
  state.assets.clear();
  state.ops = [];
  state.history = [];
  state.historyIndex = 0;
}

async function exitEditor(): Promise<void> {
  if (!confirmDiscard("exit")) return;
  discardAll();
  location.assign(state.current?.pagePath ?? "/");
}

async function logout(): Promise<void> {
  if (!confirmDiscard("log out")) return;
  discardAll();
  await api("/__xyle/api/logout", { method: "POST" });
  location.assign("/");
}

/* ---------- editables toggle & markers ---------- */

function applyShowEditables(): void {
  const doc = previewDoc();
  if (!doc) return;
  for (const el of doc.querySelectorAll("[data-xyle-node]")) {
    const meta = metaById.get(el.getAttribute("data-xyle-node")!);
    const supported =
      meta &&
      ((meta.kind === "text" && meta.textEditable) ||
        meta.kind === "link" ||
        meta.kind === "image");
    el.classList.toggle("xyle-editable-candidate", state.showEditables && !!supported);
  }
}

function refreshMarkers(): void {
  const doc = previewDoc();
  if (!doc || !state.current) return;
  doc
    .getElementById("xyle-overlay-root")
    ?.querySelectorAll(".xyle-marker")
    .forEach((m) => {
      m.remove();
    });
  const byPageOp = state.ops.filter((o) => o.pagePath === state.current!.pagePath);
  for (const { op } of byPageOp) {
    const baseId = op.nodeId.split("#")[0]!;
    const el = doc.querySelector(`[data-xyle-node="${baseId}"]`) as HTMLElement | null;
    if (!el) continue;
    const marker = doc.createElement("span");
    marker.className = "xyle-marker";
    const rect = el.getBoundingClientRect();
    const overlay = doc.getElementById("xyle-overlay-root")!;
    marker.style.left = `${rect.right + 4 + windowScrollX(doc)}px`;
    marker.style.top = `${rect.top + windowScrollY(doc)}px`;
    overlay.append(marker);
  }
}

/* ---------- changes drawer & undo ---------- */

function describeOp(op: Op): string {
  switch (op.type) {
    case "text":
      return `Text “${op.value.split("\n")[0]!.slice(0, 40)}”`;
    case "href":
      return `Link → ${op.value}`;
    case "src":
      return `Image → ${op.value}`;
    case "alt":
      return `Alt → ${op.value}`;
  }
}

function openChangesDrawer(): void {
  $("#xyle-changes-drawer")?.remove();
  const drawer = document.createElement("aside");
  drawer.id = "xyle-changes-drawer";
  drawer.style.cssText =
    "position:fixed;top:0;right:0;bottom:0;width:min(26rem,92vw);background:#fff;box-shadow:-12px 0 30px rgba(0,0,0,.15);z-index:2147483647;padding:1rem;font-family:system-ui,sans-serif;display:flex;flex-direction:column";
  drawer.innerHTML = `<header style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.75rem">
    <strong>Changes</strong>
    <button id="xyle-changes-close" style="border:0;background:none;font-size:1.2rem;cursor:pointer">×</button>
  </header><div id="xyle-changes-list" style="flex:1;overflow:auto;display:grid;gap:.5rem;align-content:start"></div>`;
  document.body.append(drawer);
  $("#xyle-changes-close", drawer).addEventListener("click", () => drawer.remove());

  const list = $("#xyle-changes-list", drawer);
  if (state.ops.length === 0) {
    list.innerHTML = `<p style="color:#5c6672;font-size:.9rem">No pending changes.</p>`;
    return;
  }
  for (const [index, entry] of state.ops.entries()) {
    const row = document.createElement("div");
    row.style.cssText =
      "border:1px solid #eee;border-radius:8px;padding:.6rem .75rem;font-size:.86rem";
    row.innerHTML = `
      <div style="color:#5c6672">${entry.pagePath}</div>
      <div>${describeOp(entry.op)}</div>`;
    const undoButton = document.createElement("button");
    undoButton.textContent = "Undo";
    undoButton.style.cssText =
      "margin-top:.4rem;font:500 .8rem system-ui;padding:.3em .8em;border:1px solid #ccc;border-radius:6px;background:#fff;cursor:pointer";
    undoButton.addEventListener("click", () => undoOp(index));
    row.append(undoButton);
    list.append(row);
  }
}

/** Undo one specific op by index. */
function undoOp(index: number): void {
  const entry = state.ops[index];
  if (!entry) return;
  removeOpsFor(opKey(entry.op));
  revertOpInDom(entry.pagePath, entry.op);
  $("#xyle-changes-drawer")?.remove();
  updateDirtyUi();
}

function revertOpInDom(pagePath: string, op: Op): void {
  if (pagePath !== state.current?.pagePath) return;
  const doc = previewDoc();
  if (!doc) return;
  if (op.type === "text") {
    const [baseId, segRaw] = op.nodeId.split("#");
    const original = originalSegments.get(op.nodeId);
    const el = doc.querySelector(`[data-xyle-node="${baseId}"]`);
    if (el && original !== undefined) {
      const runs = setSegmentValue(el as HTMLElement, Number(segRaw), original);
      void runs;
    }
  } else if (op.type === "href" || op.type === "src" || op.type === "alt") {
    const el = doc.querySelector(`[data-xyle-node="${op.nodeId}"]`) as HTMLElement | null;
    const attr = op.type;
    if (el) {
      const original = originalAttrs.get(`${op.nodeId}:${attr}`);
      if (original !== undefined) el.setAttribute(attr, original);
    }
  }
  refreshMarkers();
}

const originalSegments = new Map<string, string>();
const originalAttrs = new Map<string, string>();

function rememberOriginalSegment(id: string, value: string): void {
  if (!originalSegments.has(id)) originalSegments.set(id, value);
}
function rememberOriginalAttr(id: string, attr: string, value: string): void {
  const key = `${id}:${attr}`;
  if (!originalAttrs.has(key)) originalAttrs.set(key, value);
}

/** Overwrite one segment's text inside a container (used by undo/restore). */
function setSegmentValue(el: HTMLElement, segIndex: number, value: string): void {
  const pairs = collectSegments(el);
  const pair = pairs[segIndex];
  if (!pair) return;
  // Re-locate the live text nodes that belong to this slot key.
  const nodes = textNodesForSlot(el, pair.key);
  const pieces = value.split("\n");
  if (nodes.length === 0) return;

  if (pieces.length === 1) {
    // remove brs inside this slot and collapse to a single text value
    for (const node of nodes.slice(1)) {
      const prev = node.previousSibling;
      if (prev && prev.nodeType === Node.ELEMENT_NODE && (prev as HTMLElement).tagName === "BR") {
        prev.remove();
      }
    }
    nodes[0]!.textContent = pieces[0]!;
    for (const node of nodes.slice(1)) node.textContent = "";
    return;
  }

  for (const [i, node] of nodes.entries()) {
    node.textContent = pieces[i] ?? "";
    if (i > 0) {
      const prev = node.previousSibling;
      if (
        !(prev && prev.nodeType === Node.ELEMENT_NODE && (prev as HTMLElement).tagName === "BR")
      ) {
        node.parentNode?.insertBefore(document.createElement("br"), node);
      }
    }
  }
}

function textNodesForSlot(rootEl: HTMLElement, key: string): Text[] {
  const out: Text[] = [];
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      if (slotKeyOf(node, rootEl) === key) out.push(node as Text);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as HTMLElement;
    if (element !== rootEl && element.hasAttribute("data-xyle-node")) return;
    for (const child of Array.from(node.childNodes)) walk(child);
  };
  walk(rootEl);
  return out;
}

/** Reapply surviving ops into freshly rendered DOM (after navigation). */
function restoreOpsIntoDom(): void {
  const doc = previewDoc();
  if (!doc || !state.current) return;
  for (const { pagePath, op } of state.ops) {
    if (pagePath !== state.current.pagePath) continue;
    if (op.type === "text") {
      const [baseId, segRaw] = op.nodeId.split("#");
      const el = doc.querySelector(`[data-xyle-node="${baseId}"]`) as HTMLElement | null;
      if (el) setSegmentValue(el, Number(segRaw), op.value);
    } else {
      const el = doc.querySelector(`[data-xyle-node="${op.nodeId}"]`) as HTMLElement | null;
      if (el) {
        rememberOriginalAttr(op.nodeId, op.type, el.getAttribute(op.type) ?? "");
        const asset = state.assets.get(op.value);
        el.setAttribute(op.type, asset ? asset.objectUrl : op.value);
        if (el.tagName === "IMG") (el as HTMLImageElement).src = asset ? asset.objectUrl : op.value;
      }
    }
  }
  updateDirtyUi();
}

/* ---------- global undo/redo ---------- */

function undo(): void {
  if (state.historyIndex === 0) return;
  state.historyIndex -= 1;
  state.history[state.historyIndex]?.undo();
}
function redo(): void {
  if (state.historyIndex >= state.history.length) return;
  state.history[state.historyIndex]?.redo();
  state.historyIndex += 1;
}

/* ---------- publish ---------- */

async function publish(): Promise<void> {
  if (commitActiveEditsAndCollect()) return;
  const button = $<HTMLButtonElement>("#xyle-publish");
  button.disabled = true;
  button.textContent = "Publishing…";

  const form = new FormData();
  form.set(
    "metadata",
    JSON.stringify({
      baseSnapshotDigest: state.publishedSnapshotDigest,
      pages: collectPageOps(),
    }),
  );
  for (const [path, asset] of state.assets) {
    form.set(path, asset.file, `asset-${asset.file.name}`);
  }

  try {
    const res = await api("/__xyle/api/publish", {
      method: "POST",
      headers: { "x-xyle-request": "1" },
      body: form,
    });
    if (res.status === 409) {
      $("#xyle-conflict").style.display = "block";
      button.disabled = false;
      button.textContent = "Publish";
      return;
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({ error: res.statusText }))) as {
        error?: string;
      };
      flash(`Couldn't publish: ${body.error ?? res.statusText}`);
      button.disabled = false;
      button.textContent = "Publish";
      return;
    }
    const body = (await res.json()) as { snapshotDigest: string };
    state.publishedSnapshotDigest = body.snapshotDigest;
    for (const { objectUrl } of state.assets.values()) URL.revokeObjectURL(objectUrl);
    state.assets.clear();
    state.ops = [];
    state.history = [];
    state.historyIndex = 0;
    button.textContent = "Published ✓";
    flash("Published.");
    setTimeout(() => {
      button.textContent = "Publish";
      button.disabled = false;
    }, 1500);
    updateDirtyUi();
    await loadPage(state.current!.pagePath, { pushHistory: false });
  } catch {
    flash("Couldn't publish — check your connection and retry.");
    button.disabled = false;
    button.textContent = "Publish";
  }
}

function commitActiveEditsAndCollect(): boolean {
  if (session) commitEdit();
  return false;
}

function collectPageOps(): PageOps[] {
  const byPage = new Map<string, Op[]>();
  for (const { pagePath, op } of state.ops) {
    const list = byPage.get(pagePath) ?? [];
    list.push(op);
    byPage.set(pagePath, list);
  }
  const pages: PageOps[] = [];
  for (const [pagePath, operations] of byPage) {
    const baseDigest =
      pagePath === state.current?.pagePath
        ? state.current.baseDigest
        : (cachedBaseDigest.get(pagePath) ?? state.current?.baseDigest ?? "");
    pages.push({ pagePath, baseDigest, operations });
  }
  return pages;
}

const cachedBaseDigest = new Map<string, string>();

boot().catch((error) => {
  console.error("xyle boot failed", error);
});
