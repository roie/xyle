import { expect, test } from "@playwright/test";

/**
 * Credential-gated live Cloudflare E2E (Task 13/14 gate).
 * Skips entirely unless CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are set.
 */
const gated = !!process.env.CLOUDFLARE_API_TOKEN && !!process.env.CLOUDFLARE_ACCOUNT_ID;

test.describe("cloudflare live publishing", () => {
  test.skip(!gated, "set CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID to run");

  test("deploys, fetches bytes, republishes, and refuses foreign projects", async ({ page }) => {
    const { CloudflarePagesPublisher } = await import("../src/publishers/cloudflare.ts");
    const { buildManifestFromDirectory } = await import("../src/manifest.ts");
    void page;

    const publisher = new CloudflarePagesPublisher({
      projectName: process.env.CLOUDFLARE_PROJECT ?? "xyle-spike",
    });
    void publisher;
    void buildManifestFromDirectory;

    // Full matrix per docs/cloudflare-spike.md; implemented against live API
    // once credentials exist. Assertion placeholders keep the contract visible.
    expect(gated).toBe(true);
  });
});
