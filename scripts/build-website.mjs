import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const website = join(repository, "website");
const demoSource = join(repository, "demo", "site");
const demoOutput = join(website, "demo-content");
const assetsOutput = join(website, "assets");
const excluded = new Set([".gitignore", ".xyle.json"]);

function includeDemoPath(path) {
  const name = relative(demoSource, path);
  if (!name) return true;
  const first = name.split(sep)[0];
  return first !== ".xyle" && !excluded.has(name);
}

async function prefixDemoUrls(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await prefixDemoUrls(path);
      continue;
    }
    if (!entry.name.endsWith(".html")) continue;
    const source = await readFile(path, "utf8");
    const prefixed = source
      .replaceAll('href="/', 'href="/demo-content/')
      .replaceAll('src="/', 'src="/demo-content/')
      .replaceAll('srcset="/', 'srcset="/demo-content/')
      .replaceAll('action="/', 'action="/demo-content/');
    await writeFile(path, prefixed);
  }
}

await rm(demoOutput, { recursive: true, force: true });
await rm(assetsOutput, { recursive: true, force: true });
await mkdir(assetsOutput, { recursive: true });
await sharp(join(repository, "assets", "brand", "xyle-logo.png"))
  .resize(192, 192, { fit: "inside" })
  .png({ compressionLevel: 9, palette: true, quality: 90 })
  .toFile(join(assetsOutput, "xyle-logo.png"));
await cp(join(repository, "dist", "editor.js"), join(assetsOutput, "editor.js"));
for (const name of await readdir(join(repository, "dist"))) {
  if (name.startsWith("browser-demo-") && name.endsWith(".js")) {
    await cp(join(repository, "dist", name), join(assetsOutput, name));
  }
}
await cp(demoSource, demoOutput, { recursive: true, filter: includeDemoPath });
await prefixDemoUrls(demoOutput);
process.stdout.write(`Built product website at ${website}\n`);
