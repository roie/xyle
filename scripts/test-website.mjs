import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(repository, "website");
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    let path = resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (path !== root && !path.startsWith(`${root}${sep}`)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    if ((await stat(path)).isDirectory()) path = resolve(path, "index.html");
    const body = await readFile(path);
    response.writeHead(200, {
      "content-type": contentTypes[extname(path)] ?? "application/octet-stream",
    });
    response.end(body);
  } catch (error) {
    process.stderr.write(`Website test request failed for ${request.url}: ${String(error)}\n`);
    response.writeHead(404).end("Not found");
  }
});

await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Website test server did not start");
const baseUrl = `http://127.0.0.1:${address.port}`;
let browser;

try {
  const headers = await readFile(resolve(root, "_headers"), "utf8");
  if (!headers.includes("Content-Security-Policy:") || !headers.includes("X-Robots-Tag: noindex")) {
    throw new Error("The website deployment headers are incomplete");
  }
  const redirects = await readFile(resolve(root, "_redirects"), "utf8");
  if (!redirects.includes("/demo /demo/ 301") || !redirects.includes("/guide /guide/ 301")) {
    throw new Error("The website route redirects are incomplete");
  }
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto(baseUrl);
  await page.getByRole("heading", { name: "Your static site. Now editable." }).waitFor();
  await page.getByRole("link", { name: "Edit the live demo" }).waitFor();
  if (await page.getByLabel("Editor key").count()) {
    throw new Error("The product homepage unexpectedly requires an editor key");
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  if (hasHorizontalOverflow) throw new Error("The product homepage overflows a mobile viewport");

  await page.goto(`${baseUrl}/guide/`);
  await page.getByRole("heading", { name: "Change content without changing how your site works." }).waitFor();
  await page.getByRole("heading", { name: "Know the editing boundary" }).waitFor();
  await page.getByText("Not supported in v1", { exact: true }).waitFor();
  await page.getByRole("heading", { name: "Put the editor on Cloudflare Pages" }).waitFor();
  const guideOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  if (guideOverflow) throw new Error("The owner guide overflows a mobile viewport");

  await page.goto(baseUrl);
  await page.getByRole("link", { name: "Edit the live demo" }).click();
  await page.locator("#xyle-preview").waitFor({ state: "visible" });
  await page.waitForFunction(() => {
    const frame = document.querySelector("#xyle-preview");
    return frame instanceof HTMLIFrameElement && frame.contentDocument?.body.dataset.xyleWired === "true";
  });
  if (await page.getByLabel("Editor key").count()) {
    throw new Error("The browser demo requires an editor key");
  }

  const heading = page
    .frameLocator("#xyle-preview")
    .getByRole("heading", { name: "Edit your static site visually" });
  await heading.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("Edited in my private demo");
  await page.frameLocator("#xyle-preview").locator("html").click({ position: { x: 1, y: 1 } });
  await page.locator("#xyle-dirty").waitFor({ state: "visible" });
  await page.locator("#xyle-changes").click();
  const changeRow = page.locator("#xyle-changes-list .xyle-change-row").first();
  await changeRow.locator(".xyle-change-after").waitFor();
  if (!(await changeRow.textContent())?.includes("Edited in my private demo")) {
    throw new Error("The browser demo did not show the pending text change");
  }
  await page.locator("#xyle-drawer-publish").click();
  await page.locator("#xyle-dirty").waitFor({ state: "hidden" });
  await page
    .frameLocator("#xyle-preview")
    .getByRole("heading", { name: "Edited in my private demo" })
    .waitFor();

  await page.reload();
  await page.locator("#xyle-preview").waitFor({ state: "visible" });
  await page
    .frameLocator("#xyle-preview")
    .getByRole("heading", { name: "Edit your static site visually" })
    .waitFor();
  if (errors.length) throw new Error(`Website browser errors:\n${errors.join("\n")}`);

  process.stdout.write("Product homepage and isolated browser demo passed.\n");
} finally {
  await browser?.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
