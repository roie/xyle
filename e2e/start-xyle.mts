// Playwright web server: boots the real Xyle dev server against a throwaway
// copy of the canonical demo plus test-only fixture pages.
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startXyleDevServer } from "../src/cli.ts";

const DEMO_SITE = new URL("../demo/site/", import.meta.url).pathname;
const TEST_FIXTURES = new URL("./fixtures/site/", import.meta.url).pathname;
const PORT = Number(process.env.XYLE_PORT ?? 4173);
const TEST_KEY = process.env.XYLE_TEST_KEY ?? "xyle-e2e-test-key-0123456789abcdef";

const root = join(tmpdir(), `xyle-e2e-${process.pid}`);
const secretsDir = join(root, ".xyle");

const prepareTestSite = async (): Promise<void> => {
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  await cp(DEMO_SITE, root, { recursive: true });
  await cp(TEST_FIXTURES, root, { recursive: true });
  await mkdir(secretsDir, { recursive: true });
  await writeFile(
    join(secretsDir, "secrets.local.json"),
    JSON.stringify({
      editorKey: TEST_KEY,
      sessionSecretB64: Buffer.from("xyle-test-session-secret-0123456789").toString("base64"),
    }),
  );
};

await prepareTestSite();

const { server, url } = await startXyleDevServer({
  directory: root,
  port: PORT,
  resetForTests: prepareTestSite,
});

console.log(`xyle e2e server on ${url} (isolated site copy in ${root})`);

const shutdown = async (): Promise<void> => {
  server.close();
  await rm(root, { recursive: true, force: true }).catch(() => {});
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
