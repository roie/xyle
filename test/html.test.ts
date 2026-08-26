import { describe, expect, it } from "vitest";
import {
  analyzePage,
  escapeHtmlAttr,
  escapeHtmlText,
  isValidSiteUrl,
  patchHtml,
  preparePreview,
} from "../src/html.ts";
import { digestBytes } from "../src/manifest.ts";
import type { PageChange, XyleDigest } from "../src/types.ts";

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
    expect(images).toHaveLength(1);
    expect(images[0]!.attrs.has("src")).toBe(true);
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
        { type: "lineBreak", nodeId: "n1#0", position: 3 },
      ]),
    ).rejects.toThrow(/duplicate/);
  });

  it("applies controlled line breaks to multiline containers only", async () => {
    const p = `<p>Serving Edmonton and surrounding areas.</p>`;
    const pId = firstNodeId(p);
    const out = await patchAndGetText(p, [{ type: "lineBreak", nodeId: `${pId}#0`, position: 16 }]);
    expect(out).toBe(`<p>Serving Edmonton<br> and surrounding areas.</p>`);

    const h = `<h1>Plumbing you can depend on</h1>`;
    const hId = firstNodeId(h);
    await expect(
      patchAndGetText(h, [{ type: "lineBreak", nodeId: `${hId}#0`, position: 8 }]),
    ).rejects.toThrow(/single-line|rejects line breaks/);
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
