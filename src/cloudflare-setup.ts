import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

interface CloudflareAccountOptions {
  accountId: string;
  apiToken: string;
  projectName: string;
}

function projectEndpoint(options: CloudflareAccountOptions): string {
  return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(options.accountId)}/pages/projects/${encodeURIComponent(options.projectName)}`;
}

function authorization(options: CloudflareAccountOptions): HeadersInit {
  return { authorization: `Bearer ${options.apiToken}` };
}

export async function ensureDirectUploadProject(
  options: CloudflareAccountOptions,
): Promise<"created" | "existing"> {
  const current = await fetch(projectEndpoint(options), {
    headers: authorization(options),
  });
  if (current.ok) {
    const body = (await current.json()) as { result?: { source?: unknown } };
    if (body.result?.source) {
      throw new Error(
        "Xyle requires a Cloudflare Pages Direct Upload project; the selected project uses Git integration.",
      );
    }
    return "existing";
  }
  if (current.status !== 404) {
    throw new Error(`Cloudflare project lookup failed (${current.status})`);
  }

  const created = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(options.accountId)}/pages/projects`,
    {
      method: "POST",
      headers: { ...authorization(options), "content-type": "application/json" },
      body: JSON.stringify({ name: options.projectName, production_branch: "main" }),
    },
  );
  if (!created.ok) {
    throw new Error(`Cloudflare project creation failed (${created.status})`);
  }
  return "created";
}

export async function uploadPagesSecrets(
  root: string,
  options: CloudflareAccountOptions & {
    secrets: Record<string, string>;
    wranglerCommand?: string;
  },
): Promise<void> {
  const secretDirectory = join(root, ".xyle");
  await mkdir(secretDirectory, { recursive: true, mode: 0o700 });
  const secretFile = join(secretDirectory, `cloudflare-secrets-${randomUUID()}.json`);
  await writeFile(secretFile, `${JSON.stringify(options.secrets)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  try {
    await runWrangler(
      options.wranglerCommand ?? "wrangler",
      ["pages", "secret", "bulk", secretFile, `--project-name=${options.projectName}`],
      root,
      options,
    );
  } finally {
    await rm(secretFile, { force: true });
  }
}

function runWrangler(
  command: string,
  args: string[],
  cwd: string,
  credentials: Pick<CloudflareAccountOptions, "accountId" | "apiToken">,
): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const child = spawn(command, args, {
    cwd,
    env: {
      ...process.env,
      CLOUDFLARE_ACCOUNT_ID: credentials.accountId,
      CLOUDFLARE_API_TOKEN: credentials.apiToken,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output = `${output}${String(chunk)}`.slice(-4000);
  });
  child.stderr.on("data", (chunk) => {
    output = `${output}${String(chunk)}`.slice(-4000);
  });
  child.on("error", reject);
  child.on("close", (code) => {
    if (code === 0) resolve();
    else reject(new Error(`wrangler secret setup failed (${code ?? "unknown"}): ${output}`));
  });
  return promise;
}
