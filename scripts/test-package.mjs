import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";

const execFileAsync = promisify(execFile);
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspace = await mkdtemp(join(tmpdir(), "xyle-package-"));
const archive = join(workspace, "xyle.tgz");
const consumer = join(workspace, "consumer");
const site = join(consumer, "site");
let server;
let browser;

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
  for (const runtimeFile of ["cloudflare-worker.js", "xyle-worker.bundle"]) {
    const runtimePath = join(consumer, "node_modules", "xyle", "dist", runtimeFile);
    const runtimeStat = await stat(runtimePath);
    if (!runtimeStat.isFile()) {
      fail(`The package is missing its Cloudflare runtime: ${runtimeFile}`);
    }
  }
  const wrangler = join(
    consumer,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "wrangler.cmd" : "wrangler",
  );
  const wranglerStat = await stat(wrangler);
  if (!wranglerStat.isFile()) fail("The package did not install its Cloudflare deployer.");
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

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`${url}/edit?page=%2Findex.html`);
  await page.getByLabel("Editor key").fill(secrets.editorKey);
  await page.getByRole("button", { name: "Sign in to Xyle" }).click();
  await page.locator("#xyle-preview").waitFor({ state: "visible" });
  await page.waitForFunction(() => {
    const preview = document.querySelector("#xyle-preview");
    if (!(preview instanceof HTMLIFrameElement)) return false;
    return preview.contentDocument?.body.dataset.xyleWired === "true";
  });

  const heading = page.frameLocator("#xyle-preview").locator("h1");
  const nodeId = await heading.getAttribute("data-xyle-node");
  if (!nodeId) fail("The packaged editor did not expose the static heading.");
  await heading.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("Edited with packaged Xyle");
  await page.frameLocator("#xyle-preview").locator("html").click({ position: { x: 1, y: 1 } });
  await page.locator("#xyle-dirty").waitFor({ state: "visible" });

  await page.locator("#xyle-changes").click();
  const changeRow = page.locator("#xyle-changes-list .xyle-change-row").first();
  await changeRow.locator(".xyle-change-before").waitFor();
  if (!(await changeRow.locator(".xyle-change-before").textContent())?.includes("Packaged Xyle")) {
    fail("The Changes drawer did not show the original heading.");
  }
  if (
    !(await changeRow.locator(".xyle-change-after").textContent())?.includes(
      "Edited with packaged Xyle",
    )
  ) {
    fail("The Changes drawer did not show the edited heading.");
  }
  await page.locator("#xyle-drawer-publish").click();
  await page.locator("#xyle-dirty").waitFor({ state: "hidden" });

  await page.goto(url);
  await page.getByRole("heading", { name: "Edited with packaged Xyle" }).waitFor();
  const publishedSource = await readFile(join(site, "index.html"), "utf8");
  if (!publishedSource.includes("Edited with packaged Xyle")) {
    fail("The packaged editor did not publish the heading to index.html.");
  }

  process.stdout.write("Packaged Xyle completed the static-site editing journey.\n");
} finally {
  await browser?.close();
  server?.kill("SIGTERM");
  await rm(workspace, { recursive: true, force: true });
}
