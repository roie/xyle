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
  ".png": "image/png",
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
  const productLogos = page.locator('.wordmark img[src="/assets/xyle-logo.png"]');
  if ((await productLogos.count()) !== 2) throw new Error("The product wordmarks do not use the Xyle logo");
  if (!(await productLogos.first().evaluate((image) => image.naturalWidth > 0))) {
    throw new Error("The Xyle logo did not load");
  }
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
  if ((await page.locator('.wordmark img[src="/assets/xyle-logo.png"]').count()) !== 2) {
    throw new Error("The guide wordmarks do not use the Xyle logo");
  }
  const guideOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  if (guideOverflow) throw new Error("The owner guide overflows a mobile viewport");

  await page.goto(baseUrl);
  await page.getByRole("link", { name: "Edit the live demo" }).click();
  await page.locator("#xyle-preview").waitFor({ state: "visible" });
  await page.locator('#xyle-dock-handle img.xyle-brand-logo[src^="data:image/png;base64,"]').waitFor();
  await page.getByText("Demo site", { exact: true }).waitFor();
  await page.getByText("Changes reset on refresh.", { exact: true }).waitFor();
  await page.waitForFunction(() => {
    const frame = document.querySelector("#xyle-preview");
    return frame instanceof HTMLIFrameElement && frame.contentDocument?.body.dataset.xyleWired === "true";
  });
  if (await page.getByLabel("Editor key").count()) {
    throw new Error("The browser demo requires an editor key");
  }

  const heroImage = page.frameLocator("#xyle-preview").locator(".work-standard .work-image img");
  await heroImage.click();
  await page.getByRole("button", { name: "Replace", exact: true }).waitFor();
  if (await page.getByRole("button", { name: "Replace" }).isDisabled()) {
    throw new Error("Image replacement is disabled in the browser demo");
  }
  const mediaButton = page.getByRole("button", { name: "Media", exact: true });
  if (await mediaButton.isDisabled()) {
    throw new Error("The media library is disabled in the browser demo");
  }
  await mediaButton.click();
  const mediaDrawer = page.getByRole("dialog", { name: "Media" });
  if ((await mediaDrawer.getAttribute("data-xyle-drawer-mode")) !== "modal") {
    throw new Error("The mobile browser demo did not open Media as a modal panel");
  }
  if (!(await page.locator("#xyle-shell").evaluate((element) => element.hasAttribute("inert")))) {
    throw new Error("The mobile browser demo did not lock its preview while Media was open");
  }
  const currentMedia = mediaDrawer.getByRole("button", {
    name: /Choose .*hero-wide\.webp \(currently used\)/,
  });
  if ((await currentMedia.getAttribute("aria-current")) !== "true") {
    throw new Error("The browser demo did not identify the currently used image");
  }
  await mediaDrawer.getByRole("button", { name: /Choose .*hero-fallback\.jpg/ }).click();
  await heroImage.waitFor();
  await heroImage.click();
  const fileChooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Replace", exact: true }).click();
  await (await fileChooser).setFiles(resolve(repository, "demo/site/misc/team.jpg"));
  await page.waitForFunction(() => {
    const frame = document.querySelector("#xyle-preview");
    if (!(frame instanceof HTMLIFrameElement)) return false;
    return frame.contentDocument?.querySelector(".work-standard .work-image img")?.getAttribute("src")?.startsWith("blob:");
  });

  const heading = page
    .frameLocator("#xyle-preview")
    .getByRole("heading", { name: "Edit your static site visually" });
  await heading.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("Edited in my private demo");
  await page.keyboard.press("Enter");
  await page.keyboard.type("A new demo paragraph");
  await page
    .frameLocator("#xyle-preview")
    .getByText("A new demo paragraph", { exact: true })
    .waitFor();
  await page.locator("#xyle-dirty").waitFor({ state: "visible" });
  await page.locator("#xyle-changes").click();
  const changeRow = page
    .locator("#xyle-changes-list .xyle-change-row")
    .filter({ hasText: "Edited in my private demo" });
  await changeRow.locator(".xyle-change-after").waitFor();
  await page.locator("#xyle-drawer-publish").click();
  await page.locator("#xyle-dirty").waitFor({ state: "hidden" });
  await page
    .frameLocator("#xyle-preview")
    .getByRole("heading", { name: "Edited in my private demo" })
    .waitFor();
  await page
    .frameLocator("#xyle-preview")
    .getByText("A new demo paragraph", { exact: true })
    .waitFor();
  if (!(await heroImage.getAttribute("src"))?.startsWith("data:image/jpeg;base64,")) {
    throw new Error("The browser demo did not publish the replacement image in memory");
  }

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
