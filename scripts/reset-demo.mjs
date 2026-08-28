import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const source = join(root, "..", "example", "plain-html");
const target = join(root, "..", "demo", "site");
const secretsPath = join(target, ".xyle", "secrets.local.json");
let localSecrets;
try {
  localSecrets = await readFile(secretsPath);
} catch {
  localSecrets = null;
}

await rm(target, { recursive: true, force: true });
await cp(source, target, {
  recursive: true,
  filter: (path) => !path.includes(`${join("example", "plain-html", ".xyle")}`),
});
await rm(join(target, ".xyle"), { recursive: true, force: true });
await rm(join(target, "_xyle"), { recursive: true, force: true });
if (localSecrets) {
  await mkdir(join(target, ".xyle"), { recursive: true });
  await writeFile(secretsPath, localSecrets);
}
const indexPath = join(target, "index.html");
const index = await readFile(indexPath, "utf8");
await writeFile(
  indexPath,
  index.replace(
    '      <p class="footer-meta">Licensed &amp; insured · Alberta</p>',
    '      <p class="footer-meta">Licensed &amp; insured · Alberta · <a href="https://771263f7.xyle-demo.pages.dev/">Reset demo</a></p>',
  ),
);
process.stdout.write(`Reset demo site at ${target}\n`);
