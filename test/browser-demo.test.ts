import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserDemoTransport } from "../src/browser-demo.ts";

const source = `<!doctype html>
<html><head><title>Demo</title></head><body><main><h1>Original heading</h1></main></body></html>`;
const config = {
  initialPage: "/demo-content/index.html",
  pages: { "/demo-content/index.html": "/demo-content/index.html" },
  publicBaseUrl: "https://xyle.test",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("browser-only demo transport", () => {
  it("publishes into one browser transport and leaves a new transport clean", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(source, { headers: { "content-type": "text/html" } })),
    );
    const transport = createBrowserDemoTransport(config);
    const initialManifest = (await (await transport.request("/__xyle/api/manifest")).json()) as {
      snapshotDigest: string;
    };
    const initialPage = (await (
      await transport.request("/__xyle/api/page?path=%2Fdemo-content%2Findex.html")
    ).json()) as {
      baseDigest: string;
      html: string;
      nodes: Array<{ id: string; tag?: string }>;
    };
    const heading = initialPage.nodes.find((node) => node.tag === "h1");
    expect(heading).toBeDefined();

    const form = new FormData();
    form.set(
      "metadata",
      JSON.stringify({
        baseSnapshotDigest: initialManifest.snapshotDigest,
        pages: [
          {
            pagePath: config.initialPage,
            baseDigest: initialPage.baseDigest,
            operations: [
              {
                type: "text",
                nodeId: `${heading!.id}#0`,
                value: "Published heading",
              },
            ],
          },
        ],
      }),
    );
    const published = await transport.request("/__xyle/api/publish", {
      method: "POST",
      body: form,
    });
    expect(published.status).toBe(200);
    expect(await published.json()).toMatchObject({
      snapshotDigest: expect.stringMatching(/^sha256:/),
    });

    const reloaded = (await (
      await transport.request("/__xyle/api/page?path=%2Fdemo-content%2Findex.html")
    ).json()) as { html: string };
    expect(reloaded.html).toContain("Published heading");

    const isolatedTransport = createBrowserDemoTransport(config);
    const isolated = (await (
      await isolatedTransport.request("/__xyle/api/page?path=%2Fdemo-content%2Findex.html")
    ).json()) as { html: string };
    expect(isolated.html).toContain("Original heading");
    expect(isolated.html).not.toContain("Published heading");
  });

  it("resolves a directory link to its configured index page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(source)),
    );
    const transport = createBrowserDemoTransport(config);

    const response = await transport.request("/__xyle/api/page?path=%2Fdemo-content%2F");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      pagePath: "/demo-content/index.html",
      html: expect.stringContaining("Original heading"),
    });
  });

  it("provides the demo media library without server storage", async () => {
    const mediaPath = "/demo-content/assets/photo.webp";
    const mediaBytes = new Uint8Array([82, 73, 70, 70]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url === mediaPath) {
          return new Response(mediaBytes, { headers: { "content-type": "image/webp" } });
        }
        return new Response(source.replace("</main>", `<img src="${mediaPath}"></main>`), {
          headers: { "content-type": "text/html" },
        });
      }),
    );
    const transport = createBrowserDemoTransport({
      ...config,
      media: { [mediaPath]: mediaPath },
    });

    const response = await transport.request("/__xyle/api/media");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([
      {
        path: mediaPath,
        contentType: "image/webp",
        size: mediaBytes.byteLength,
        digest: expect.stringMatching(/^sha256:/),
        source: "site",
        usedBySimpleImg: true,
      },
    ]);
  });

  it("rejects stale and unknown demo publication targets", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(source)),
    );
    const transport = createBrowserDemoTransport(config);
    const form = new FormData();
    form.set(
      "metadata",
      JSON.stringify({
        baseSnapshotDigest: "sha256:stale",
        pages: [],
      }),
    );

    const stale = await transport.request("/__xyle/api/publish", { method: "POST", body: form });
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toEqual({ error: "demo snapshot changed" });

    const missing = await transport.request("/__xyle/api/page?path=%2Fmissing.html");
    expect(missing.status).toBe(404);
  });
});
