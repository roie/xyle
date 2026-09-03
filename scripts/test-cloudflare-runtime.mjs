import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildManifestFromDirectory } from "../src/manifest.ts";
import { digestBytes } from "../src/digest.ts";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const staging = await mkdtemp(join(tmpdir(), "xyle-pages-runtime-"));
const portProbe = createServer();
await new Promise((resolveListen) => portProbe.listen(0, "127.0.0.1", resolveListen));
const address = portProbe.address();
if (!address || typeof address === "string") throw new Error("Could not reserve a test port");
const port = address.port;
await new Promise((resolveClose) => portProbe.close(resolveClose));
let child;

try {
  await writeFile(
    join(staging, "index.html"),
    "<!doctype html><html><body><h1>Cloudflare runtime test</h1></body></html>\n",
  );
  await mkdir(join(staging, "_xyle"), { recursive: true });
  await cp(join(repository, "dist", "editor.js"), join(staging, "_xyle", "editor.js"));
  await cp(
    join(repository, "dist", "xyle-worker.bundle"),
    join(staging, "_xyle", "worker.bundle"),
  );
  const { manifest } = await buildManifestFromDirectory(staging);
  await writeFile(join(staging, "_xyle", "manifest.json"), JSON.stringify(manifest));
  await cp(join(repository, "dist", "cloudflare-worker.js"), join(staging, "_worker.js"));
  await writeFile(
    join(staging, "_routes.json"),
    JSON.stringify({
      version: 1,
      include: ["/edit", "/__xyle/*", "/_xyle/*"],
      exclude: [],
    }),
  );

  const editorKeyDigest = await digestBytes(new TextEncoder().encode("test-editor-key"));
  child = spawn(
    join(repository, "node_modules", ".bin", "wrangler"),
    [
      "pages",
      "dev",
      staging,
      `--port=${port}`,
      `--binding=XYLE_EDITOR_KEY_DIGEST=${editorKeyDigest}`,
      "--binding=XYLE_MANAGEMENT_SECRET=local-management-secret",
      "--binding=XYLE_SESSION_SECRET=local-runtime-test-secret",
      "--show-interactive-dev-session=false",
    ],
    { cwd: staging, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  child.stdout.on("data", (chunk) => {
    output = `${output}${String(chunk)}`.slice(-4000);
  });
  child.stderr.on("data", (chunk) => {
    output = `${output}${String(chunk)}`.slice(-4000);
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  let editResponse;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      editResponse = await fetch(`${baseUrl}/edit`);
      if (editResponse.ok) break;
    } catch {
      // The local Worker is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 125));
  }
  if (!editResponse?.ok || !(await editResponse.text()).includes("Open your site editor")) {
    throw new Error(`The local Cloudflare editor did not start.\n${output}`);
  }
  for (const path of ["/_xyle/manifest.json", "/_xyle/editor.js", "/_xyle/worker.bundle"]) {
    const response = await fetch(`${baseUrl}${path}`);
    if (response.status !== 404) throw new Error(`Private runtime path was exposed: ${path}`);
  }
  const session = await fetch(`${baseUrl}/__xyle/api/session`);
  if (!session.ok || !(await session.text()).includes('"authenticated":false')) {
    throw new Error("The local Cloudflare session route failed");
  }
  const deniedManifest = await fetch(`${baseUrl}/__xyle/api/managed-manifest`);
  if (deniedManifest.status !== 401) {
    throw new Error("The local Cloudflare manifest route accepted a missing management secret");
  }
  const managedManifest = await fetch(`${baseUrl}/__xyle/api/managed-manifest`, {
    headers: { "x-xyle-management-secret": "local-management-secret" },
  });
  const managedManifestSource = await managedManifest.text();
  if (!managedManifest.ok || !managedManifestSource.includes("snapshotDigest")) {
    throw new Error("The local Cloudflare managed manifest route failed");
  }
  const editorAsset = await fetch(`${baseUrl}/__xyle/api/assets/editor.js`);
  const editorAssetBytes = await editorAsset.arrayBuffer();
  if (!editorAsset.ok || editorAssetBytes.byteLength < 100_000) {
    throw new Error("The local Cloudflare editor asset route failed");
  }
  process.stdout.write("Cloudflare Pages runtime passed in local workerd.\n");
} finally {
  child?.kill("SIGTERM");
  await rm(staging, { recursive: true, force: true });
}
