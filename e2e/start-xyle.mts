// Playwright web server: boots the real Xyle dev server against a throwaway
// copy of the example site, with a deterministic editor key for tests.
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startXyleDevServer } from "../src/cli.ts";

const EXAMPLE = new URL("../example/plain-html/", import.meta.url).pathname;
const PORT = Number(process.env.XYLE_PORT ?? 4173);
const TEST_KEY = process.env.XYLE_TEST_KEY ?? "xyle-e2e-test-key-0123456789abcdef";

const root = join(tmpdir(), `xyle-e2e-${process.pid}`);
await rm(root, { recursive: true, force: true });
await mkdir(root, { recursive: true });
await cp(EXAMPLE, root, { recursive: true });

const secretsDir = join(root, ".xyle");
await mkdir(secretsDir, { recursive: true });
await writeFile(
  join(secretsDir, "secrets.local.json"),
  JSON.stringify({
    editorKey: TEST_KEY,
    sessionSecretB64: Buffer.from("xyle-test-session-secret-0123456789").toString("base64"),
  }),
);

const resetFixture = async (): Promise<void> => {
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  await cp(EXAMPLE, root, { recursive: true });
  await mkdir(secretsDir, { recursive: true });
  await writeFile(
    join(secretsDir, "secrets.local.json"),
    JSON.stringify({
      editorKey: TEST_KEY,
      sessionSecretB64: Buffer.from("xyle-test-session-secret-0123456789").toString("base64"),
    }),
  );
};

const { server, url } = await startXyleDevServer({
  directory: root,
  port: PORT,
  resetForTests: resetFixture,
});

console.log(`xyle e2e server on ${url} (site copy in ${root})`);

const shutdown = async (): Promise<void> => {
  server.close();
  await rm(root, { recursive: true, force: true }).catch(() => {});
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
