import { chromium } from "@playwright/test";
import { writeFile } from "node:fs/promises";

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent("<canvas id=c width=64 height=40></canvas>");

async function make(type) {
  return page.evaluate((t) => {
    const c = document.getElementById("c");
    const ctx = c.getContext("2d");
    const g = ctx.createLinearGradient(0, 0, 64, 40);
    g.addColorStop(0, "#0f6ea8");
    g.addColorStop(1, "#e8a13a");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 40);
    ctx.fillStyle = "#fff";
    ctx.font = "12px sans-serif";
    ctx.fillText("xyle", 18, 24);
    const url = c.toDataURL(t, 0.9);
    return url.slice(url.indexOf(",") + 1);
  }, type);
}

const png = await make("image/png");
const fixtures = new URL("./fixtures/site/", import.meta.url).pathname;
await writeFile(`${fixtures}/misc/unused-badge.png`, Buffer.from(png, "base64"));
await browser.close();
console.log("fixtures regenerated");
