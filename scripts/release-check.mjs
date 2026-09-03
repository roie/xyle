import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const steps = [
  { label: "static checks and unit tests", args: ["check"] },
  { label: "Cloudflare Functions types", args: ["typecheck:functions"] },
  { label: "installed npm package journey", args: ["test:package"] },
  { label: "product website and browser demo", args: ["test:website"] },
  { label: "local Cloudflare Pages runtime", args: ["test:cloudflare-runtime"] },
  {
    label: "Chromium editing journeys",
    args: ["exec", "playwright", "test", "--project=chromium", "--workers=1"],
  },
  {
    label: "Firefox editing journeys",
    args: ["exec", "playwright", "test", "--project=firefox", "--workers=1"],
  },
  {
    label: "WebKit editing journeys",
    args: ["exec", "playwright", "test", "--project=webkit", "--workers=1"],
  },
  {
    label: "native Chrome WebMCP journeys",
    args: ["exec", "playwright", "test", "--project=webmcp", "--workers=1"],
    env: { XYLE_WEBMCP: "1" },
  },
];

for (const step of steps) {
  process.stdout.write(`\n==> ${step.label}\n`);
  const code = await new Promise((resolveExit, reject) => {
    const child = spawn(pnpm, step.args, {
      cwd: repository,
      env: { ...process.env, ...step.env },
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (exitCode) => resolveExit(exitCode ?? 1));
  });
  if (code !== 0) process.exit(code);
}

process.stdout.write("\nAll local release checks passed.\n");
