import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { spawn } from "node:child_process";

const execFileAsync = promisify(execFile);
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspace = await mkdtemp(join(tmpdir(), "xyle-package-"));
const archive = join(workspace, "xyle.tgz");
const consumer = join(workspace, "consumer");
const site = join(consumer, "site");
let server;

function fail(message) {
  throw new Error(message);
}

async function waitForServer(child) {
  return new Promise((resolveUrl, rejectUrl) => {
    let output = "";
    const timeout = setTimeout(() => {
      rejectUrl(new Error(`Timed out while starting the packaged Xyle server.\n${output}`));
    }, 15_000);
    const onData = (chunk) => {
      output += chunk.toString();
      const match = output.match(/Public site:\s+(https?:\/\/\S+)/);
      if (!match) return;
      clearTimeout(timeout);
      resolveUrl(match[1]);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("error", (error) => {
      clearTimeout(timeout);
      rejectUrl(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      rejectUrl(new Error(`Packaged Xyle server exited with code ${code}.\n${output}`));
    });
  });
}

try {
  await mkdir(site, { recursive: true });
  await writeFile(
    join(site, "index.html"),
    "<!doctype html><html><body><h1>Packaged Xyle</h1></body></html>\n",
  );
  await writeFile(join(consumer, "package.json"), '{"private":true,"type":"module"}\n');

  await execFileAsync("pnpm", ["pack", "--out", archive], { cwd: repository });
  await execFileAsync(
    "npm",
    ["install", "--no-audit", "--no-fund", "--package-lock=false", archive],
    { cwd: consumer },
  );

  const executable = join(
    consumer,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "xyle.cmd" : "xyle",
  );
  const initialized = await execFileAsync("npx", ["xyle", "init", site], { cwd: consumer });
  if (!initialized.stdout.includes("Xyle initialized for")) {
    fail(`Packaged init did not report success.\n${initialized.stdout}`);
  }

  const state = JSON.parse(await readFile(join(site, ".xyle.json"), "utf8"));
  if (state.directory !== "." || state.publisher !== "filesystem" || state.editorPath !== "/edit") {
    fail("Packaged init created an invalid .xyle.json file.");
  }
  const secretsPath = join(site, ".xyle", "secrets.local.json");
  const secretsContents = await readFile(secretsPath, "utf8");
  const secrets = JSON.parse(secretsContents);
  const repeatedInit = await execFileAsync(executable, ["init", site], { cwd: consumer });
  if (repeatedInit.stdout.includes("Editor key") || (await readFile(secretsPath, "utf8")) !== secretsContents) {
    fail("Repeated packaged init replaced or disclosed the existing editor key.");
  }
  const ignore = await readFile(join(site, ".gitignore"), "utf8");
  if (!ignore.split(/\r?\n/).includes(".xyle/")) {
    fail("Packaged init did not protect the local secrets directory.");
  }

  server = spawn(executable, ["dev", site, "--port=0"], {
    cwd: consumer,
    env: { ...process.env, NO_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const url = await waitForServer(server);

  const publicResponse = await fetch(url);
  if (!publicResponse.ok || !(await publicResponse.text()).includes("Packaged Xyle")) {
    fail("The packaged server did not serve the static index.html file.");
  }

  const loginResponse = await fetch(`${url}/__xyle/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key: secrets.editorKey }),
  });
  if (!loginResponse.ok) fail("The packaged server rejected its generated editor key.");
  const cookie = loginResponse.headers.get("set-cookie")?.split(";", 1)[0];
  if (!cookie) fail("The packaged server did not create an editor session.");

  const editorResponse = await fetch(`${url}/edit`, { headers: { cookie } });
  if (!editorResponse.ok || !(await editorResponse.text()).includes('id="xyle-root"')) {
    fail("The packaged server did not serve the authenticated editor shell.");
  }
  const bundleResponse = await fetch(`${url}/__xyle/editor.js`);
  if (!bundleResponse.ok || (await bundleResponse.text()).length < 100_000) {
    fail("The package does not contain the browser editor bundle.");
  }

  process.stdout.write("Packaged Xyle initialized and served a standalone static site.\n");
} finally {
  server?.kill("SIGTERM");
  await rm(workspace, { recursive: true, force: true });
}
