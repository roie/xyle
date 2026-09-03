import { describe, expect, it } from "vitest";
import {
  analyzeGroups,
  analyzePage,
  escapeHtmlAttr,
  escapeHtmlText,
  isValidSiteUrl,
  patchHtml,
  preparePreview,
} from "../src/html.ts";
import { digestBytes } from "../src/manifest.ts";
import {
  createdNodeIdentity,
  duplicateGroupHtmlId,
  duplicateHtmlId,
  replayGroupOrder,
} from "../src/structural.ts";
import { sourceTargetIdentity } from "../src/identity.ts";
import type { PageChange, SnapshotOperation, XyleDigest } from "../src/types.ts";

const enc = new TextEncoder();
const dec = new TextDecoder();

async function patchSource(source: string, operations: PageChange["operations"]) {
  const bytes = enc.encode(source);
  return patchHtml(bytes, {
    pagePath: "/index.html",
    baseDigest: await digestBytes(bytes),
    operations,
  });
}

async function patchAndGetText(source: string, operations: PageChange["operations"]) {
  const out = await patchSource(source, operations);
  return dec.decode(out);
}

function firstNodeId(source: string): string {
  const { candidates } = analyzePage(source);
  const first = candidates.keys().next();
  if (first.done) throw new Error("no candidate");
  return first.value;
}

describe("byte-preserving HTML patches", () => {
  it("preserves a UTF-8 BOM while patching", async () => {
    const source = "\uFEFF<h1>Hello</h1>";
    const bytes = enc.encode(source);
    const nodeId = firstNodeId(source);
    const output = await patchHtml(bytes, {
      pagePath: "/index.html",
      baseDigest: await digestBytes(bytes),
      operations: [{ type: "text", nodeId: `${nodeId}#0`, value: "Updated" }],
    });
    expect([...output.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(dec.decode(output)).toContain("Updated");
  });

  it("rejects invalid UTF-8 rather than replacing bytes", async () => {
    const bytes = new Uint8Array([0x3c, 0x68, 0x31, 0x3e, 0xff, 0x3c, 0x2f, 0x68, 0x31, 0x3e]);
    await expect(
      patchHtml(bytes, {
        pagePath: "/index.html",
        baseDigest: await digestBytes(bytes),
        operations: [],
      }),
    ).rejects.toThrow(/valid UTF-8/);
  });
});

describe("Layout presets", () => {
  it("swaps safe regions as physical source subtrees", async () => {
    const source = `<!doctype html><html><body><section><div id="left"><h2>Left</h2></div><div id="right"><p>Right</p></div></section></body></html>`;
    const prepared = preparePreview(source, "/index.html", "https://example.test");
    const target = prepared.layouts[0]!;
    const swapped = await patchHtml(enc.encode(source), {
      pagePath: "/index.html",
      baseDigest: await digestBytes(enc.encode(source)),
      operations: [
        {
          type: "setRegionOrder",
          targetId: target.id,
          firstRegionId: target.regions[0]!.id,
          secondRegionId: target.regions[1]!.id,
          order: "swapped",
          targetSignature: target.signature,
          regionSignatures: [target.regions[0]!.signature, target.regions[1]!.signature],
          sequence: 1,
        },
      ],
    });
    const html = dec.decode(swapped);
    expect(html.indexOf('id="right"')).toBeLessThan(html.indexOf('id="left"'));
    expect(html).toContain('id="left"');
    expect(html).toContain('id="right"');
  });

  it("preserves a swapped order in a duplicated section snapshot", async () => {
    const source = `<main><section id="first"><div class="image"><p>Image</p></div><div class="content"><p>Content</p></div></section></main>`;
    const prepared = preparePreview(source, "/index.html", "https://example.test");
    const target = prepared.layouts[0]!;
    const sourceNodes = [...analyzePage(source).candidates.values()].filter(
      (candidate) => candidate.kind === "text",
    );
    const nodeMap = Object.fromEntries(
      sourceNodes.map((candidate) => [
        candidate.id,
        createdNodeIdentity(
          "x-12345678",
          sourceTargetIdentity(
            "/index.html",
            candidate.kind,
            candidate.startTagStart,
            candidate.elementEnd ?? candidate.startTagEnd,
            candidate.tag,
          ),
        ),
      ]),
    );
    const duplicated = await patchAndGetText(source, [
      {
        type: "duplicateSection",
        sourceId: target.id,
        createdId: "x-12345678",
        sequence: 1,
        insert: "after",
        snapshotOperations: [
          {
            type: "setRegionOrder",
            targetId: target.id,
            firstRegionId: target.regions[0]!.id,
            secondRegionId: target.regions[1]!.id,
            order: "swapped",
            targetSignature: target.signature,
            regionSignatures: [target.regions[0]!.signature, target.regions[1]!.signature],
            sequence: 2,
          },
        ],
        nodeMap: { ...nodeMap },
        idMap: { first: duplicateHtmlId("x-12345678", "first") },
        assetRefs: [],
      },
    ]);
    const firstClone = duplicated.indexOf(`id="${duplicateHtmlId("x-12345678", "first")}"`);
    expect(firstClone).toBeGreaterThan(duplicated.indexOf('class="content"'));
    expect(duplicated.lastIndexOf('class="content"')).toBeLessThan(
      duplicated.lastIndexOf('class="image"'),
    );
  });

  it("preserves authored baselines and manages the fixed stylesheet", async () => {
    const source = `<!doctype html><html><head></head><body><section><div><img src="a.jpg"></div><div><h2>Title</h2></div></section></body></html>`;
    const prepared = preparePreview(source, "/index.html", "https://example.test");
    const target = prepared.layouts[0]!;
    const bytes = enc.encode(source);
    const split = await patchHtml(
      bytes,
      {
        pagePath: "/index.html",
        baseDigest: await digestBytes(bytes),
        operations: [
          {
            type: "setLayoutPreset",
            nodeId: target.id,
            preset: "two-column",
            baseline: "stacked",
            targetSignature: target.signature,
            regionSignatures: [target.regions[0]!.signature, target.regions[1]!.signature],
          },
        ],
      },
      { layoutAssetHref: "/__xyle/assets/layout.css", layoutAssetRequired: true },
    );
    const splitHtml = dec.decode(split);
    expect(splitHtml).toContain('data-xyle-layout="split"');
    expect(splitHtml).toContain('data-xyle-resource="layout-v1"');

    const managed = preparePreview(splitHtml, "/index.html", "https://example.test");
    const managedTarget = managed.layouts[0]!;
    const managedBytes = enc.encode(splitHtml);
    const restored = await patchHtml(managedBytes, {
      pagePath: "/index.html",
      baseDigest: await digestBytes(managedBytes),
      operations: [
        {
          type: "setLayoutPreset",
          nodeId: managedTarget.id,
          preset: "stacked",
          baseline: "stacked",
          targetSignature: managedTarget.signature,
          regionSignatures: [
            managedTarget.regions[0]!.signature,
            managedTarget.regions[1]!.signature,
          ],
        },
      ],
    });
    expect(dec.decode(restored)).not.toContain("data-xyle-layout");
    expect(dec.decode(restored)).not.toContain('data-xyle-resource="layout-v1"');
  });
});

describe("preparePreview source locations", () => {
  it("finds usable source ranges without modifying the original string", () => {
    const source = `<h1>Hello</h1>`;
    const before = source;
    const { html, nodes } = preparePreview(source, "/index.html", "http://localhost:4173");
    expect(source).toBe(before);
    expect(nodes.size).toBe(1);

    const node = [...nodes.values()][0]!;
    expect(node.kind).toBe("text");
    // the original range still points into the untouched source
    expect(source.slice(node.sourceStart!, node.sourceEnd!)).toContain("Hello");

    // preview copy carries ephemeral instrumentation
    expect(html).toContain('data-xyle-node="n1"');
    expect(html).not.toBe(source);
  });

  it("decodes entities for text mapping", () => {
    const source = `<p>Tom &amp; Jerry</p>`;
    const analysis = analyzePage(source);
    const candidate = [...analysis.candidates.values()][0]!;
    expect(candidate.segments[0]?.text).toBe("Tom & Jerry");
  });

  it("wraps standalone inline formatting roots for safe editing", () => {
    const source = `<strong>100%</strong>`;
    const preview = preparePreview(source, "/index.html", "https://example.com");
    expect(preview.html).toContain('<span data-xyle-node="n1"><strong>100%</strong></span>');
    expect(preview.nodes.get("n1")?.tag).toBe("strong");
  });

  it("assigns stable ephemeral ids in document order", () => {
    const source = `<h1>A</h1><p>B</p><a href="/x">C</a><img src="/i.png" alt="">`;
    const { nodes } = preparePreview(source, "/index.html", "http://localhost:4173");
    expect([...nodes.values()].map((n) => n.kind)).toEqual(["text", "text", "link", "image"]);
    expect(nodes.get("n3")?.kind).toBe("link");
  });

  it("discovers editable inline text in proof-style metric items", () => {
    const source =
      '<section class="proof-strip"><div><strong>24/7</strong><span>emergency response</span></div></section>';
    const text = [...analyzePage(source).candidates.values()].filter((c) => c.kind === "text");
    expect(text.map((candidate) => candidate.segments[0]?.text)).toEqual([
      "24/7",
      "emergency response",
    ]);
  });

  it("excludes unsafe containers from discovery", () => {
    const source = [
      "<div>",
      "<p>editable</p>",
      "<pre>not editable</pre>",
      "<code>nope</code>",
      "<button>nope</button>",
      "<div hidden><p>hidden nope</p></div>",
      "</div>",
    ].join("");
    const analysis = analyzePage(source);
    const texts = [...analysis.candidates.values()].filter((c) => c.kind === "text");
    expect(texts).toHaveLength(1);
    expect(texts[0]!.segments[0]!.text).toBe("editable");
  });

  it("skips srcset and picture images", () => {
    const source = [
      '<img src="/a.jpg" srcset="/b.jpg 2x">',
      "<picture>",
      '<source srcset="/w.webp 1200w">',
      '<img src="/f.jpg" alt="fallback">',
      "</picture>",
      '<img src="/ok.jpg" alt="fine">',
    ].join("");
    const images = [...analyzePage(source).candidates.values()].filter((c) => c.kind === "image");
    expect(images).toHaveLength(3);
    expect(images[0]!.mediaCapabilities?.replace).toBe(false);
    expect(images[1]!.mediaCapabilities?.replace).toBe(false);
    expect(images[2]!.attrs.has("src")).toBe(true);
  });

  it("patches safe image framing while preserving other styles", async () => {
    const source = `<img src="/hero.jpg" style="width: 100%; object-fit: contain; color: red;">`;
    const id = [...analyzePage(source).candidates.values()][0]!.id;
    await expect(
      patchAndGetText(source, [
        {
          type: "media",
          nodeId: id,
          value: {
            source: { kind: "existing", src: "/hero.jpg" },
            alt: { present: false, value: "" },
            crop: null,
            focus: { x: 0.2, y: 0.7 },
            framing: { fit: "cover" },
          },
        },
      ]),
    ).resolves.toBe(
      `<img src="/hero.jpg" style="width: 100%; color: red; object-fit: cover; object-position: 20% 70%;">`,
    );
  });

  it("patches one unified media state", async () => {
    const source = `<a href="/"><img src="/hero.jpg" alt="Old" style="width: 100%;"></a>`;
    const id = [...analyzePage(source).candidates.values()].find(
      (candidate) => candidate.kind === "image",
    )!.id;
    await expect(
      patchAndGetText(source, [
        {
          type: "media",
          nodeId: id,
          value: {
            source: { kind: "existing", src: "/new.webp" },
            alt: { present: true, value: "New" },
            crop: null,
            focus: { x: 0.7, y: 0.3 },
            framing: { fit: "cover" },
          },
        },
      ]),
    ).resolves.toBe(
      `<a href="/"><img src="/new.webp" alt="New" style="width: 100%; object-fit: cover; object-position: 70% 30%;"></a>`,
    );
  });

  it("patches SEO metadata and safely adds missing fields", async () => {
    const source = `<!doctype html><html><head><title>Old title</title><meta name="description" content="Old description"><link rel="canonical" href="/old.html"></head><body><p>Content</p></body></html>`;
    await expect(
      patchAndGetText(source, [
        { type: "seo", nodeId: "seo:title", field: "title", value: "New <title>" },
        { type: "seo", nodeId: "seo:description", field: "description", value: "New description" },
        { type: "seo", nodeId: "seo:canonical", field: "canonical", value: "/new.html" },
        { type: "seo", nodeId: "seo:ogTitle", field: "ogTitle", value: "Social title" },
      ]),
    ).resolves.toContain(`<title>New &lt;title&gt;</title>`);
    await expect(
      patchAndGetText(source, [
        { type: "seo", nodeId: "seo:description", field: "description", value: "" },
        { type: "seo", nodeId: "seo:canonical", field: "canonical", value: "javascript:bad" },
      ]),
    ).rejects.toThrow(/unsafe SEO URL/);
  });

  it("groups contiguous sibling text blocks into one list", async () => {
    const source = `<section><p class="lead">One</p>\n<p>Two</p>\n<p>Three</p></section>`;
    const blocks = [...analyzePage(source).candidates.values()].filter(
      (candidate) => candidate.kind === "text",
    );
    await expect(
      patchAndGetText(source, [
        {
          type: "toggleList",
          nodeIds: blocks.map((block) => block.id),
          value: "ul",
          before: "plain",
          after: "ul",
        },
      ]),
    ).resolves.toBe(
      `<section><ul><li class="lead">One</li>\n<li>Two</li>\n<li>Three</li></ul></section>`,
    );
  });

  it("merges same-tag adjacent lists around selected paragraphs", async () => {
    const source =
      `<div><ul class="items"><li>Before</li></ul>\n` +
      `<p class="selected">One</p>\n<p>Two</p>\n` +
      `<ul class="items"><li>After</li></ul></div>`;
    const candidates = [...analyzePage(source).candidates.values()];
    const paragraphs = candidates.filter((candidate) => candidate.tag === "p");
    await expect(
      patchAndGetText(source, [
        {
          type: "toggleList",
          nodeIds: paragraphs.map((paragraph) => paragraph.id).reverse(),
          value: "ul",
          before: "plain",
          after: "ul",
        },
      ]),
    ).resolves.toBe(
      `<div><ul class="items"><li>Before</li>\n<li class="selected">One</li>\n<li>Two</li>\n<li>After</li></ul></div>`,
    );
  });

  it("rejects mixed list and plain selections when undo cannot preserve wrappers", async () => {
    const source = `<div><p>One</p>\n<ul><li>Two</li></ul></div>`;
    const candidates = [...analyzePage(source).candidates.values()];
    await expect(
      patchAndGetText(source, [
        {
          type: "toggleList",
          nodeIds: candidates.map((candidate) => candidate.id),
          value: "ol",
          before: "plain",
          after: "ol",
        },
      ]),
    ).rejects.toThrow(/mix list items and plain blocks/);
  });

  it("rejects list grouping across different parents", async () => {
    const source = `<section><p>One</p></section><section><p>Two</p></section>`;
    const blocks = [...analyzePage(source).candidates.values()].filter(
      (candidate) => candidate.kind === "text",
    );
    await expect(
      patchAndGetText(source, [
        {
          type: "toggleList",
          nodeIds: blocks.map((block) => block.id),
          value: "ol",
          before: "plain",
          after: "ol",
        },
      ]),
    ).rejects.toThrow(/parent/);
  });

  it("toggles selected paragraphs into one list while preserving inline markup", async () => {
    const source = `<div><p>Plumbing <strong>services</strong></p>\n<p>Heating <em>services</em></p>\n<p>Drain <a href="/contact.html">cleaning</a></p></div>`;
    const blocks = [...analyzePage(source).candidates.values()].filter(
      (candidate) => candidate.kind === "text",
    );
    await expect(
      patchAndGetText(source, [
        {
          type: "toggleList",
          nodeIds: blocks.map((block) => block.id),
          value: "ul",
          before: "plain",
          after: "ul",
        },
      ]),
    ).resolves.toBe(
      `<div><ul><li>Plumbing <strong>services</strong></li>\n<li>Heating <em>services</em></li>\n<li>Drain <a href="/contact.html">cleaning</a></li></ul></div>`,
    );
  });

  it("splits a list when selected items are unlisted or changed to another type", async () => {
    const source = `<div><ul><li>One</li>\n<li>Two</li>\n<li>Three</li>\n<li>Four</li></ul></div>`;
    const items = [...analyzePage(source).candidates.values()].filter(
      (candidate) => candidate.kind === "text" && candidate.tag === "li",
    );
    const selected = items.slice(1, 3).map((item) => item.id);
    await expect(
      patchAndGetText(source, [
        {
          type: "toggleList",
          nodeIds: selected,
          value: "ol",
          before: "ul",
          after: "ol",
        },
      ]),
    ).resolves.toContain(
      `<div><ul><li>One</li></ul>\n<ol><li>Two</li>\n<li>Three</li></ol>\n<ul><li>Four</li></ul></div>`,
    );
    await expect(
      patchAndGetText(source, [
        {
          type: "toggleList",
          nodeIds: selected,
          value: "ul",
          before: "ul",
          after: "plain",
        },
      ]),
    ).resolves.toContain(
      `<div><ul><li>One</li></ul>\n<p>Two</p>\n<p>Three</p>\n<ul><li>Four</li></ul></div>`,
    );
  });

  it("detects non-croppable image formats from cache-busted URL pathnames", () => {
    const source = `<img src="/logo.svg?v=logo.jpg" alt="Logo">`;
    const image = [...analyzePage(source).candidates.values()][0]!;

    expect(image.mediaCapabilities).toMatchObject({ crop: false, focus: false });
  });

  it("allows SVG replacement but rejects SVG framing", async () => {
    const source = `<img src="/logo.svg" alt="Logo">`;
    const image = [...analyzePage(source).candidates.values()][0]!;
    expect(image.mediaCapabilities).toMatchObject({
      replace: true,
      alt: true,
      crop: false,
      focus: false,
    });
    await expect(
      patchAndGetText(source, [
        {
          type: "media",
          nodeId: image.id,
          value: {
            source: { kind: "existing", src: "/new-logo.svg" },
            alt: { present: true, value: "New logo" },
            crop: null,
            focus: null,
          },
        },
      ]),
    ).resolves.toBe(`<img src="/new-logo.svg" alt="New logo">`);
    await expect(
      patchAndGetText(source, [
        {
          type: "media",
          nodeId: image.id,
          value: {
            source: { kind: "existing", src: "/new-logo.svg" },
            alt: { present: true, value: "New logo" },
            crop: null,
            focus: { x: 0.5, y: 0.5 },
            framing: { fit: "contain" },
          },
        },
      ]),
    ).rejects.toThrow(/raster-cropped|framing is not supported/);
  });

  it("excludes ignored managed Layout attributes from analysis", () => {
    const source = `<section class="generated" data-xyle-layout="split"><div>A</div><div>B</div></section>`;

    expect(analyzePage(source).managedLayoutAttributeCount).toBe(1);
    expect(analyzePage(source, [".generated"]).managedLayoutAttributeCount).toBe(0);
  });

  it("honors simple ignore selectors for preview and patches", async () => {
    const source = `<p class="generated">ignored</p><p>editable</p>`;
    const preview = preparePreview(source, "/index.html", "https://example.com", [".generated"]);
    expect(preview.html).toContain('<p class="generated">ignored</p>');
    expect(preview.html).not.toContain('<p class="generated" data-xyle-node=');
    expect([...preview.nodes.values()]).toHaveLength(1);
    const bytes = enc.encode(source);
    await expect(
      patchHtml(
        bytes,
        {
          pagePath: "/index.html",
          baseDigest: await digestBytes(bytes),
          operations: [{ type: "text", nodeId: "n2#0", value: "tampered" }],
        },
        { ignoreSelectors: [".generated"] },
      ),
    ).rejects.toThrow(/unknown text target/);
  });

  it("injects a base tag only when missing and neutralizes meta refresh", () => {
    const withRefresh = `<!doctype html><html><head><meta http-equiv="refresh" content="5"><title>t</title></head><body><p>x</p></body></html>`;
    const { html } = preparePreview(withRefresh, "/index.html", "https://example.com");
    expect(html).not.toContain('http-equiv="refresh"');
    expect(html).toContain('<base href="https://example.com/index.html">');

    const withBase = `<!doctype html><html><head><base href="/other/"><title>t</title></head><body><p>x</p></body></html>`;
    const result = preparePreview(withBase, "/index.html", "https://example.com");
    expect(result.html.match(/<base /g)).toHaveLength(1);
    expect(result.html).toContain('<base href="/other/">');
  });
});

describe("patchHtml text fidelity", () => {
  it("replaces entity-containing text nodes with correctly escaped output", async () => {
    const source = `<p>Tom &amp; Jerry</p>`;
    const out = await patchAndGetText(source, [
      { type: "text", nodeId: `${firstNodeId(source)}#0`, value: "Tom & <Jerry> & Co" },
    ]);
    expect(out).toBe(`<p>Tom &amp; &lt;Jerry&gt; &amp; Co</p>`);
  });

  it("preserves nbsp as an entity", async () => {
    const source = `<p>A\u00A0B</p>`;
    const id = firstNodeId(source);
    const out = await patchAndGetText(source, [
      { type: "text", nodeId: `${id}#0`, value: "X\u00A0Y" },
    ]);
    expect(out).toBe(`<p>X&nbsp;Y</p>`);
  });

  it("leaves everything outside the patched range byte-for-byte intact", async () => {
    const source = `<div class="odd   spacing" data-x='keep' >\r\n   <p>old text</p>\t\r\n<!-- keep me --></div>`;
    const out = await patchAndGetText(source, [
      { type: "text", nodeId: `${firstNodeId(source)}#0`, value: "new text" },
    ]);
    expect(out.startsWith(`<div class="odd   spacing" data-x='keep' >\r\n   <p>`)).toBe(true);
    expect(out.endsWith(`</p>\t\r\n<!-- keep me --></div>`)).toBe(true);
    expect(out).not.toContain("old text");
    expect(out).toContain("\r\n");
  });

  it("rejects stale base digests", async () => {
    const source = `<p>a</p>`;
    await expect(
      patchHtml(enc.encode(source), {
        pagePath: "/",
        baseDigest: `sha256:${"0".repeat(64)}` as XyleDigest,
        operations: [{ type: "text", nodeId: "n1#0", value: "b" }],
      }),
    ).rejects.toThrow(/stale/);
  });

  it("rejects overlapping patches", async () => {
    const source = `<p>one two</p>`;
    // same segment targeted twice via duplicate intent is rejected as duplicate
    await expect(
      patchSource(source, [
        { type: "text", nodeId: "n1#0", value: "a" },
        { type: "text", nodeId: "n1#0", value: "b" },
      ]),
    ).rejects.toThrow(/duplicate/);
  });

  it("rejects deferred line-break operations", async () => {
    const source = `<p>Serving Edmonton and surrounding areas.</p>`;
    const id = firstNodeId(source);
    await expect(
      patchAndGetText(source, [{ type: "lineBreak", nodeId: `${id}#0`, position: 16 }]),
    ).rejects.toThrow(/line-break editing is deferred/i);
  });

  it("applies safe formatting and combines it with a text edit", async () => {
    const source = `<p>Hello</p>`;
    const id = firstNodeId(source);
    await expect(
      patchAndGetText(source, [{ type: "format", nodeId: id, value: "bold" }]),
    ).resolves.toBe(`<p><strong>Hello</strong></p>`);
    await expect(
      patchAndGetText(source, [
        { type: "text", nodeId: `${id}#0`, value: "Updated" },
        { type: "format", nodeId: id, value: "italic" },
      ]),
    ).resolves.toBe(`<p><em>Updated</em></p>`);
  });

  it("patches inline HTML changes for standalone formatted roots", async () => {
    const source = `<strong>100%</strong>`;
    const id = firstNodeId(source);
    await expect(
      patchAndGetText(source, [
        { type: "html", nodeId: id, value: "<strong>10</strong>0<strong>%</strong>" },
      ]),
    ).resolves.toBe(`<strong>10</strong>0<strong>%</strong>`);
  });

  it("patches one net inline HTML change and rejects unsafe markup", async () => {
    const source = `<p>Hello amazing world</p>`;
    const id = firstNodeId(source);
    await expect(
      patchAndGetText(source, [
        { type: "html", nodeId: id, value: `Hello <strong>amazing</strong> world` },
      ]),
    ).resolves.toBe(`<p>Hello <strong>amazing</strong> world</p>`);
    await expect(
      patchAndGetText(source, [
        { type: "html", nodeId: id, value: `Hello <script>alert(1)</script>` },
      ]),
    ).rejects.toThrow(/unsupported/);
  });

  it("formats only a safe selected text range", async () => {
    const source = `<p>Hello brave world</p>`;
    const id = firstNodeId(source);
    await expect(
      patchAndGetText(source, [{ type: "format", nodeId: id, value: "bold", start: 6, end: 11 }]),
    ).resolves.toBe(`<p>Hello <strong>brave</strong> world</p>`);
    await expect(
      patchAndGetText(source, [
        { type: "format", nodeId: id, value: "bold", start: 0, end: 5 },
        { type: "format", nodeId: id, value: "italic", start: 12, end: 17 },
      ]),
    ).resolves.toBe(`<p><strong>Hello</strong> brave <em>world</em></p>`);
    await expect(
      patchAndGetText(source, [
        { type: "text", nodeId: `${id}#0`, value: "Hello bold world" },
        { type: "format", nodeId: id, value: "bold", start: 6, end: 10 },
      ]),
    ).resolves.toBe(`<p>Hello <strong>bold</strong> world</p>`);
  });

  it("formats a multiline selection while preserving line breaks", async () => {
    const source = `<p>Serving Edmonton and surrounding areas<br />with calm, capable help for<br />the leaks that cannot wait.</p>`;
    const id = firstNodeId(source);
    const candidate = [...analyzePage(source).candidates.values()][0]!;
    const segments = candidate.segments;
    const textLength = segments.reduce((total, segment) => total + segment.text.length, 0);
    await expect(
      patchAndGetText(source, [
        {
          type: "format",
          nodeId: id,
          value: "bold",
          start: 0,
          end: textLength,
          sourceStart: segments[0]!.start,
          sourceEnd: segments.at(-1)!.end,
        },
      ]),
    ).resolves.toBe(
      `<p><strong>Serving Edmonton and surrounding areas<br />with calm, capable help for<br />the leaks that cannot wait.</strong></p>`,
    );
  });

  it("changes a simple text block to a safe heading level", async () => {
    const source = `<p>Hello</p>`;
    const id = firstNodeId(source);
    await expect(
      patchAndGetText(source, [{ type: "formatBlock", nodeId: id, value: "h2" }]),
    ).resolves.toBe(`<h2>Hello</h2>`);
    await expect(
      patchAndGetText(source, [
        { type: "text", nodeId: `${id}#0`, value: "Updated" },
        { type: "formatBlock", nodeId: id, value: "h3" },
      ]),
    ).resolves.toBe(`<h3>Updated</h3>`);
  });

  it("converts one safely mapped text block into a list item", async () => {
    const source = `<p class="features">Hello</p>`;
    const id = firstNodeId(source);
    await expect(
      patchAndGetText(source, [{ type: "formatBlock", nodeId: id, value: "ul" }]),
    ).resolves.toBe(`<ul class="features"><li>Hello</li></ul>`);
    await expect(
      patchAndGetText(source, [
        { type: "text", nodeId: `${id}#0`, value: "Updated" },
        { type: "formatBlock", nodeId: id, value: "ol" },
      ]),
    ).resolves.toBe(`<ol class="features"><li>Updated</li></ol>`);
  });

  it("rejects list formatting for an existing list item", async () => {
    const source = `<ul><li>Already a list item</li><li>Another item</li></ul>`;
    const id = firstNodeId(source);
    await expect(
      patchSource(source, [{ type: "formatBlock", nodeId: id, value: "ul" }]),
    ).rejects.toThrow(/safely editable/);
  });

  it("rejects unsupported formatting values", async () => {
    const source = `<p>Hello</p>`;
    await expect(
      patchSource(source, [
        { type: "format", nodeId: firstNodeId(source), value: "strike" as never },
      ]),
    ).rejects.toThrow(/unsupported text format/);
  });

  it("escapes injected markup as literal text", async () => {
    const source = `<h1>Hello</h1>`;
    const out = await patchAndGetText(source, [
      { type: "text", nodeId: `${firstNodeId(source)}#0`, value: "<script>alert(1)</script>" },
    ]);
    expect(out).toBe(`<h1>&lt;script&gt;alert(1)&lt;/script&gt;</h1>`);
  });

  it("edits individual mixed-content segments independently", async () => {
    const source = `<p>We are a <strong>family-owned</strong> company.</p>`;
    const analysis = analyzePage(source);
    const c = [...analysis.candidates.values()][0]!;
    expect(c.segments.map((s) => s.text)).toEqual(["We are a ", "family-owned", " company."]);
    const out = await patchAndGetText(source, [
      { type: "text", nodeId: `${c.id}#1`, value: "family-run" },
    ]);
    expect(out).toBe(`<p>We are a <strong>family-run</strong> company.</p>`);
  });
});

describe("attribute patching", () => {
  it("patches exact href values", async () => {
    const source = `<a href="/contact.html">Get a quote</a>`;
    const out = await patchAndGetText(source, [
      { type: "href", nodeId: firstNodeId(source), value: "/quote.html?from=home&x=1" },
    ]);
    expect(out).toBe(`<a href="/quote.html?from=home&amp;x=1">Get a quote</a>`);
  });

  it("escapes quotes in attribute values", async () => {
    const source = `<img src="/a.png" alt="old alt">`;
    const id = firstNodeId(source);
    const out = await patchAndGetText(source, [{ type: "alt", nodeId: id, value: 'say "hello"' }]);
    expect(out).toBe(`<img src="/a.png" alt="say &quot;hello&quot;">`);
  });

  it("inserts a missing alt narrowly into the start tag", async () => {
    const source = `<img src="/a.png">`;
    const out = await patchAndGetText(source, [
      { type: "alt", nodeId: firstNodeId(source), value: "new alt" },
    ]);
    expect(out).toBe(`<img src="/a.png" alt="new alt">`);
  });

  it.each([
    "javascript:alert(1)",
    " javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "data:text/html,<h1>hi</h1>",
    "vbscript:msgbox(1)",
    "java\nscript:alert(1)",
    "/ok\x00path",
  ])("rejects unsafe link destination %j", async (bad) => {
    expect(isValidSiteUrl(bad)).toBe(false);
    const source = `<a href="/safe.html">link</a>`;
    await expect(
      patchSource(source, [{ type: "href", nodeId: firstNodeId(source), value: bad }]),
    ).rejects.toThrow();
  });

  it.each([
    "about.html",
    "/root/rel",
    "#frag",
    "https://example.com/x?a=1",
    "mailto:a@b.c",
    "tel:+15550142",
  ])("accepts safe link destination %j", (good) => {
    expect(isValidSiteUrl(good)).toBe(true);
  });

  it("rejects unknown node ids", async () => {
    const source = `<h1>x</h1>`;
    await expect(
      patchSource(source, [{ type: "text", nodeId: "n999#0", value: "y" }]),
    ).rejects.toThrow(/unknown/);
  });
});

describe("escaping helpers", () => {
  it("round-trips common entities", () => {
    expect(escapeHtmlText(`&<>"'`)).toBe(`&amp;&lt;&gt;"'`);
    expect(escapeHtmlAttr(`say "hi"`)).toBe("say &quot;hi&quot;");
  });
});

describe("safe Group discovery", () => {
  const discover = (source: string) => analyzeGroups(source, "/index.html");

  it.each([
    [
      "article cards",
      `<section><div class="cards"><article><h3>A</h3><p>One</p></article><article><h3>B</h3><p>Two</p></article></div></section>`,
    ],
    [
      "div cards",
      `<section><div><div><h3>A</h3><p>One</p></div><div><h3>B</h3><p>Two</p></div></div></section>`,
    ],
    [
      "transparent wrappers",
      `<section><div class="container"><div class="cards"><article><h3>A</h3><p>One</p></article><article><h3>B</h3><p>Two</p></article></div></div></section>`,
    ],
    [
      "three items",
      `<section><div><article><h3>A</h3><p>One</p></article><article><h3>B</h3><p>Two</p></article><article><h3>C</h3><p>Three</p></article></div></section>`,
    ],
    [
      "inline formatting differences",
      `<section><div><article><h3><strong>A</strong></h3><p><em>One</em></p></article><article><h3>B</h3><p><u>Two</u></p></article></div></section>`,
    ],
    [
      "different content values",
      `<section><div><article><a href="/a"><img src="/a.jpg" alt="A"></a><p>One</p></article><article><a href="/b"><img src="/b.jpg" alt="B"></a><p>Two</p></article></div></section>`,
    ],
  ])("accepts %s", (_name, source) => {
    const groups = discover(source);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.items).toHaveLength(source.includes("Three") ? 3 : 2);
  });

  it("keeps Group and item identities stable across content and inline formatting edits", () => {
    const before = discover(
      `<section><div><article><h3>A</h3><p>One</p></article><article><h3>B</h3><p>Two</p></article></div></section>`,
    )[0]!;
    const after = discover(
      `<section><div><article><h3><strong>Changed</strong></h3><p><em>Updated</em></p></article><article><h3>B changed</h3><p>Two changed</p></article></div></section>`,
    )[0]!;
    expect(after.id).toBe(before.id);
    expect(after.items.map((item) => item.id)).toEqual(before.items.map((item) => item.id));
    expect(after.signature).toBe(before.signature);
  });

  it.each([
    [
      "hero columns",
      `<section><div><div><h1>Copy</h1><p>Text</p></div><div><img src="/hero.jpg"></div></div></section>`,
    ],
    [
      "mixed item tags",
      `<section><div><article><h3>A</h3><p>One</p></article><article><h3>B</h3><p>Two</p></article><aside><p>Note</p></aside></div></section>`,
    ],
    [
      "ordinary unordered list",
      `<section><div><ul><li><h3>A</h3><p>One</p></li></ul><ul><li><h3>B</h3><p>Two</p></li></ul></div></section>`,
    ],
    ["sibling rich text", `<section><div><p>One</p><p>Two</p></div></section>`],
    [
      "nested sections",
      `<section><div><article><h3>A</h3><section><p>Nested</p></section></article><article><h3>B</h3><p>Two</p></article></div></section>`,
    ],
    [
      "unsafe descendants",
      `<section><div><article><h3>A</h3><form><input></form></article><article><h3>B</h3><form><input></form></article></div></section>`,
    ],
    [
      "mixed direct text",
      `<section><div>Do not group this<article><h3>A</h3><p>One</p></article><article><h3>B</h3><p>Two</p></article></div></section>`,
    ],
    [
      "incompatible signatures",
      `<section><div><article><h3>A</h3><p>One</p></article><article><h3>B</h3><img src="/two.jpg"></article></div></section>`,
    ],
    [
      "nested repeating candidates",
      `<section><div class="outer"><div class="inner"><article><h3>A</h3><p>One</p></article><article><h3>B</h3><p>Two</p></article></div><div class="inner"><article><h3>C</h3><p>Three</p></article><article><h3>D</h3><p>Four</p></article></div></div></section>`,
    ],
    [
      "ambiguous wrapper path",
      `<section><div class="container">Important note<div class="cards"><article><h3>A</h3><p>One</p></article><article><h3>B</h3><p>Two</p></article></div></div></section>`,
    ],
    ["one item", `<section><div><article><h3>Only</h3><p>One</p></article></div></section>`],
  ])("rejects %s", (_name, source) => {
    expect(discover(source)).toEqual([]);
  });
});

describe("Group order replay", () => {
  it("replays duplicate and move operations by their shared sequence", () => {
    expect(
      replayGroupOrder(
        ["a", "b", "c"],
        [
          {
            type: "moveGroupItem",
            itemId: "c",
            targetItemId: "a",
            position: "before",
            sequence: 2,
          },
          { type: "duplicateGroupItem", sourceItemId: "a", createdId: "a-copy", sequence: 1 },
        ],
      ),
    ).toEqual(["c", "a", "a-copy", "b"]);
  });

  it("does not create a visible move when the moved item returns to its prior order", () => {
    expect(
      replayGroupOrder(
        ["a", "b"],
        [
          {
            type: "moveGroupItem",
            itemId: "b",
            targetItemId: "a",
            position: "before",
            sequence: 1,
          },
          { type: "moveGroupItem", itemId: "b", targetItemId: "a", position: "after", sequence: 2 },
        ],
      ),
    ).toEqual(["a", "b"]);
  });
});

describe("Group item duplication", () => {
  function operationFor(
    source: string,
    createdId: string,
    snapshotOperations: SnapshotOperation[] = [],
  ) {
    const group = analyzeGroups(source, "/index.html")[0]!;
    const item = group.items[0]!;
    const nodeMap: Record<string, string> = { [item.id]: createdId };
    for (const candidate of analyzePage(source).candidates.values()) {
      const end = candidate.elementEnd ?? candidate.startTagEnd;
      if (candidate.startTagStart < item.sourceStart || end > item.sourceEnd) continue;
      nodeMap[candidate.id] = createdNodeIdentity(
        createdId,
        sourceTargetIdentity(
          "/index.html",
          candidate.kind,
          candidate.startTagStart,
          end,
          candidate.tag,
        ),
      );
    }
    return {
      type: "duplicateGroupItem" as const,
      groupId: group.id,
      sourceItemId: item.id,
      sourceItemIndex: item.index,
      groupSignature: group.signature,
      itemSignature: item.signature,
      createdId,
      sequence: 1,
      insert: "after" as const,
      snapshotOperations,
      nodeMap,
      idMap: {},
      assetRefs: [],
    };
  }

  it("duplicates an item while freezing its snapshot before later source edits", async () => {
    const source = `<main><section><div><article><h3>Original</h3><p>Before</p></article><article><h3>Other</h3><p>Other copy</p></article></div></section></main>`;
    const group = analyzeGroups(source, "/index.html")[0]!;
    const item = group.items[0]!;
    const title = [...analyzePage(source).candidates.values()].find(
      (candidate) => candidate.tag === "h3" && candidate.startTagStart > item.sourceStart,
    )!;
    const operation = operationFor(source, "x-12345678", [
      { type: "text", nodeId: `${title.id}#0`, value: "Frozen title" },
    ]);
    const output = await patchAndGetText(source, [
      operation,
      { type: "text", nodeId: `${title.id}#0`, value: "Changed original" },
    ]);
    expect(output).toContain("<h3>Changed original</h3>");
    expect(output).toContain("<h3>Frozen title</h3>");
  });

  it("remaps item-root HTML ids and local references", async () => {
    const source = `<main><section><div><article id="card-a" aria-labelledby="title-a"><h3 id="title-a">A</h3><p>One</p></article><article id="card-b" aria-labelledby="title-b"><h3 id="title-b">B</h3><p>Two</p></article></div></section></main>`;
    const createdId = "x-12345678";
    const idMap = Object.fromEntries(
      ["card-a", "title-a"].map((id) => [id, duplicateGroupHtmlId(createdId, id)]),
    );
    const operation = { ...operationFor(source, createdId), idMap };
    const output = await patchAndGetText(source, [operation]);
    expect(output).toContain(`id="${idMap["card-a"]}" aria-labelledby="${idMap["title-a"]}"`);
    expect(output).toContain(`id="${idMap["title-a"]}">A</h3>`);
    expect((output.match(new RegExp(`id="${idMap["card-a"]}"`, "g")) ?? []).length).toBe(1);
  });

  it("keeps repeated duplicates in sequence order", async () => {
    const source = `<main><section><div><article><h3>A</h3><p>One</p></article><article><h3>B</h3><p>Two</p></article></div></section></main>`;
    const first = operationFor(source, "x-12345678");
    const second = { ...operationFor(source, "x-87654321"), sequence: 2 };
    const output = await patchAndGetText(source, [first, second]);
    expect(output.indexOf('data-xyle-group-item="')).toBe(-1);
    expect(output.indexOf("<h3>A</h3>")).toBeLessThan(output.indexOf("<h3>B</h3>"));
    expect(output.split("<h3>A</h3>").length - 1).toBe(3);
  });
});

describe("safe structural patches", () => {
  const source =
    '<main>\n  <section id="first"><h2>First</h2></section>\n  <section id="second"><h2>Second</h2></section>\n</main>';

  function sectionIds() {
    return [...analyzePage(source).candidates.values()]
      .filter((candidate) => candidate.kind === "section")
      .map((candidate) => candidate.id);
  }

  it("discovers only safe top-level sections", () => {
    const prepared = preparePreview(source, "/index.html", "http://localhost:4173");
    expect(sectionIds()).toEqual(["s1", "s2"]);
    expect(prepared.html).toContain('data-xyle-node="s1"');
    expect(prepared.html).toContain('data-xyle-node="s2"');
  });

  it("hides and shows a section through the hidden attribute", async () => {
    const [first] = sectionIds();
    const hidden = await patchAndGetText(source, [
      { type: "sectionVisibility", nodeId: first!, visible: false, before: true },
    ]);
    expect(hidden).toContain('<section id="first" hidden>');

    const hiddenSource = hidden;
    const shown = await patchAndGetText(hiddenSource, [
      { type: "sectionVisibility", nodeId: "s1", visible: true, before: false },
    ]);
    expect(shown).toContain('<section id="first">');
    expect(shown).not.toContain('<section id="first" hidden>');
  });

  it("duplicates a safe section after its source with deterministic id remapping", async () => {
    const [first] = sectionIds();
    const createdId = "x-12345678";
    const duplicateSource = source.replace(
      '<section id="first"><h2>First</h2>',
      '<section id="first"><h2>First</h2><a href="#first">First</a>',
    );
    const duplicated = await patchAndGetText(duplicateSource, [
      {
        type: "duplicateSection",
        sourceId: first!,
        createdId,
        sequence: 1,
        insert: "after",
        snapshotOperations: [],
        nodeMap: {},
        idMap: { first: duplicateHtmlId(createdId, "first") },
        assetRefs: [],
      },
    ]);
    const cloneId = duplicateHtmlId(createdId, "first");
    expect((duplicated.match(new RegExp(`id="${cloneId}"`, "g")) ?? []).length).toBe(1);
    expect(duplicated).toContain(`href="#${cloneId}"`);
    expect(duplicated.indexOf(`id="first"`)).toBeLessThan(duplicated.indexOf(`id="${cloneId}"`));
  });

  it("replays edits scoped to the created duplicate", async () => {
    const duplicateSource = "<main><section><h2>First</h2></section></main>";
    const sourceText = [...analyzePage(duplicateSource).candidates.values()].find(
      (candidate) => candidate.kind === "text",
    )!;
    const createdTextId = createdNodeIdentity(
      "x-12345678",
      sourceTargetIdentity(
        "/index.html",
        sourceText.kind,
        sourceText.startTagStart,
        sourceText.elementEnd ?? sourceText.startTagEnd,
        sourceText.tag,
      ),
    );
    const duplicated = await patchAndGetText(duplicateSource, [
      {
        type: "duplicateSection",
        sourceId: "s1",
        createdId: "x-12345678",
        sequence: 1,
        insert: "after",
        snapshotOperations: [{ type: "text", nodeId: "n1#0", value: "Snapshot" }],
        nodeMap: { n1: createdTextId },
        createdOperations: [{ type: "text", nodeId: `${createdTextId}#0`, value: "Second" }],
        idMap: {},
        assetRefs: [],
      },
    ]);
    expect(duplicated).toBe(
      "<main><section><h2>First</h2></section><section><h2>Second</h2></section></main>",
    );
  });

  it("rejects duplicate sections with repeated HTML ids", async () => {
    const repeated =
      '<main><section id="first"><div id="same"></div><p id="same">x</p></section></main>';
    const [first] = [...analyzePage(repeated).candidates.values()]
      .filter((candidate) => candidate.kind === "section")
      .map((candidate) => candidate.id);
    await expect(
      patchSource(repeated, [
        {
          type: "duplicateSection",
          sourceId: first!,
          createdId: "x-12345678",
          sequence: 1,
          insert: "after",
          snapshotOperations: [],
          nodeMap: {},
          idMap: { first: duplicateHtmlId("x-12345678", "first") },
          assetRefs: [],
        },
      ]),
    ).rejects.toThrow(/duplicate HTML ids/);
  });

  it("replays a duplicate before moving its original", async () => {
    const [first, second] = sectionIds();
    const duplicated = await patchAndGetText(source, [
      {
        type: "duplicateSection",
        sourceId: first!,
        createdId: "x-12345678",
        sequence: 1,
        insert: "after",
        snapshotOperations: [],
        nodeMap: {},
        idMap: { first: duplicateHtmlId("x-12345678", "first") },
        assetRefs: [],
      },
      {
        type: "moveSection",
        nodeId: first!,
        targetId: second!,
        before: false,
        originalIndex: 0,
        sequence: 2,
      },
    ]);
    const cloneId = duplicateHtmlId("x-12345678", "first");
    expect(duplicated.indexOf(`id="${cloneId}"`)).toBeLessThan(duplicated.indexOf('id="second"'));
    expect(duplicated.lastIndexOf('id="first"')).toBeGreaterThan(duplicated.indexOf('id="second"'));
  });

  it("moves only safe sibling sections while preserving their contents", async () => {
    const [first, second] = sectionIds();
    const moved = await patchAndGetText(source, [
      {
        type: "moveSection",
        nodeId: second!,
        targetId: first!,
        before: true,
        originalIndex: 1,
      },
    ]);
    expect(moved.indexOf('id="second"')).toBeLessThan(moved.indexOf('id="first"'));
    expect(moved).toContain("<h2>Second</h2>");
    expect(moved).toContain("<h2>First</h2>");
  });

  it("rejects unsafe sections and unsupported sibling parents", async () => {
    const unsafe = "<main><section><form><input></form></section></main>";
    expect(
      [...analyzePage(unsafe).candidates.values()].some((node) => node.kind === "section"),
    ).toBe(false);
    const sourceWithDiv =
      '<main><section id="first">A</section><div>other</div><section id="second">B</section></main>';
    const ids = [...analyzePage(sourceWithDiv).candidates.values()]
      .filter((node) => node.kind === "section")
      .map((node) => node.id);
    await expect(
      patchSource(sourceWithDiv, [
        { type: "moveSection", nodeId: ids[1]!, targetId: ids[0]!, before: true, originalIndex: 1 },
      ]),
    ).rejects.toThrow(/unsupported sibling/);
  });
});
