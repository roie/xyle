import { describe, expect, it, vi } from "vitest";
import worker from "../src/cloudflare-worker.ts";

describe("Cloudflare Worker entry", () => {
  it("serves the editor and forwards ordinary static assets", async () => {
    const assetFetch = vi.fn(async () => new Response("public asset"));
    const env = { ASSETS: { fetch: assetFetch } };

    const edit = await worker.fetch(new Request("https://site.example/edit"), env);
    expect(edit.status).toBe(200);
    expect(await edit.text()).toContain("Open your site editor");
    expect(assetFetch).not.toHaveBeenCalled();

    const assetRequest = new Request("https://site.example/styles.css");
    const asset = await worker.fetch(assetRequest, env);
    expect(await asset.text()).toBe("public asset");
    expect(assetFetch).toHaveBeenCalledWith(assetRequest);
  });

  it("keeps the publication manifest and runtime bundle private", async () => {
    const assetFetch = vi.fn(async () => new Response("must not be served"));
    const env = { ASSETS: { fetch: assetFetch } };

    for (const path of ["/_xyle/manifest.json", "/_xyle/worker.bundle"]) {
      const response = await worker.fetch(new Request(`https://site.example${path}`), env);
      expect(response.status).toBe(404);
    }
    expect(assetFetch).not.toHaveBeenCalled();
  });

  it("routes Xyle API requests without exposing the asset fallback", async () => {
    const assetFetch = vi.fn(async () => new Response("must not be served"));
    const response = await worker.fetch(new Request("https://site.example/__xyle/api/session"), {
      ASSETS: { fetch: assetFetch },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ authenticated: false });
    expect(response.headers.get("x-xyle-runtime")).toBe("1");
    expect(assetFetch).not.toHaveBeenCalled();
  });
});
