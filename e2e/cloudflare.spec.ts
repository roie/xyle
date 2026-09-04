import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "@playwright/test";
import { CloudflarePagesPublisher } from "../src/publishers/cloudflare.ts";
import { buildManifestFromDirectory, digestBytes } from "../src/manifest.ts";
import type { SiteFile } from "../src/types.ts";

/** Credential-gated read-side smoke tests for a disposable Pages project. */
const projectName = process.env.XYLE_CLOUDFLARE_PROJECT ?? process.env.CLOUDFLARE_PROJECT;
const gated =
  !!process.env.CLOUDFLARE_API_TOKEN && !!process.env.CLOUDFLARE_ACCOUNT_ID && !!projectName;
const liveGated = gated && process.env.XYLE_CLOUDFLARE_LIVE_E2E === "1";

test.describe("cloudflare live publishing", () => {
  test.skip(!gated, "set Cloudflare credentials and XYLE_CLOUDFLARE_PROJECT to run");

  test("reads the current Xyle-managed Direct Upload snapshot", async () => {
    const publisher = new CloudflarePagesPublisher({
      root: process.cwd(),
      projectName: projectName!,
    });
    const snapshot = await publisher.readSnapshot();
    expect(snapshot.manifest.version).toBe(1);
    expect(snapshot.snapshotDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(Object.keys(snapshot.manifest.files)).not.toHaveLength(0);
  });

  test("deploys, changes, and fetches a complete static snapshot", async () => {
    test.skip(!liveGated, "set XYLE_CLOUDFLARE_LIVE_E2E=1 for the destructive live test");
    const root = await mkdtemp(join(tmpdir(), "xyle-cloudflare-live-"));
    try {
      await cp(new URL("../demo/site/", import.meta.url), root, { recursive: true });
      const publisher = new CloudflarePagesPublisher({ root, projectName: projectName! });
      const initial = await buildManifestFromDirectory(root);
      const first = await publisher.bootstrap(initial.manifest);
      const firstUrl = `https://${first.id}.${projectName}.pages.dev`;
      const firstPage = await fetch(`${firstUrl}/index.html`, { cache: "no-store" });
      expect(firstPage.ok).toBe(true);
      expect(await firstPage.text()).toContain("Edit your static site visually");
      const firstImage = await fetch(`${firstUrl}/assets/hero.webp`, { cache: "no-store" });
      expect(firstImage.ok).toBe(true);
      expect((await firstImage.arrayBuffer()).byteLength).toBeGreaterThan(0);

      const changedBytes = new TextEncoder().encode(
        "<!doctype html><html><body><h1>Cloudflare live change</h1></body></html>",
      );
      await writeFile(join(root, "index.html"), changedBytes);
      const next = await buildManifestFromDirectory(root);
      const changedFile: SiteFile = {
        path: "/index.html",
        bytes: changedBytes,
        digest: await digestBytes(changedBytes),
        contentType: "text/html",
      };
      const second = await publisher.publish({
        baseSnapshotDigest: initial.manifest.snapshotDigest,
        manifest: next.manifest,
        changedFiles: [changedFile],
        addedFiles: [],
      });
      const secondUrl = `https://${second.id}.${projectName}.pages.dev`;
      const changedPage = await fetch(`${secondUrl}/index.html`, { cache: "no-store" });
      expect(await changedPage.text()).toContain("Cloudflare live change");
      const retainedImage = await fetch(`${secondUrl}/assets/hero.webp`, { cache: "no-store" });
      expect(retainedImage.ok).toBe(true);
      expect((await retainedImage.arrayBuffer()).byteLength).toBeGreaterThan(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
const hostedUrl = process.env.XYLE_HOSTED_URL;

test("hosted publish rejects missing mutation header", async ({ request }) => {
  test.skip(!hostedUrl || !process.env.XYLE_TEST_KEY, "set XYLE_HOSTED_URL + XYLE_TEST_KEY to run");
  const login = await request.post(`${hostedUrl}/__xyle/api/login`, {
    data: { key: process.env.XYLE_TEST_KEY },
  });
  expect(login.ok()).toBe(true);
  const response = await request.post(`${hostedUrl}/__xyle/api/publish`, {
    multipart: { metadata: JSON.stringify({ pages: [] }) },
  });
  expect(response.status()).toBe(403);
});
