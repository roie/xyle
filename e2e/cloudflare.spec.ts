import { expect, test } from "@playwright/test";
import { CloudflarePagesPublisher } from "../src/publishers/cloudflare.ts";

/**
 * Credential-gated read-side smoke test. Full deploy/redeploy evidence is
 * recorded in docs/cloudflare-spike.md and uses a disposable project.
 */
const projectName = process.env.XYLE_CLOUDFLARE_PROJECT ?? process.env.CLOUDFLARE_PROJECT;
const gated =
  !!process.env.CLOUDFLARE_API_TOKEN && !!process.env.CLOUDFLARE_ACCOUNT_ID && !!projectName;

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
