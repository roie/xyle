import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const source = join(root, "..", "demo", "site");
const target = join(root, "..", "demo", ".workspace", "site");
const secretsPath = join(target, ".xyle", "secrets.local.json");
let localSecrets;
try {
  localSecrets = await readFile(secretsPath);
} catch {
  localSecrets = null;
}

const runtimePaths = [
  join(source, ".xyle"),
  join(source, ".xyle.json"),
  join(source, "_xyle"),
];
const isCanonicalSource = (path) =>
  !runtimePaths.some(
    (runtimePath) => path === runtimePath || path.startsWith(`${runtimePath}${sep}`),
  );

await rm(target, { recursive: true, force: true });
await cp(source, target, { recursive: true, filter: isCanonicalSource });
if (localSecrets) {
  await mkdir(join(target, ".xyle"), { recursive: true });
  await writeFile(secretsPath, localSecrets);
}
process.stdout.write(`Reset demo workspace at ${target}\n`);
