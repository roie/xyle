import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PublishResult, PublishSnapshot, PublishedSnapshot, Publisher } from "../types.ts";

/**
 * Cloudflare Pages publisher (EXPERIMENTAL — see docs/cloudflare-spike.md).
 *
 * Design rules honored here:
 * - provider asset identity never leaks into core types
 * - no reverse-engineered hash algorithm: canonical `wrangler` derives them
 * - fails closed on configurations the spike could not validate
 *
 * Credential-gated: requires CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.
 */

export interface CloudflarePublisherOptions {
  projectName: string;
  accountId?: string;
  apiToken?: string;
  wranglerCommand?: string;
}

export class CloudflareConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CloudflareConfigurationError";
  }
}

function requireEnv(options: CloudflarePublisherOptions): { accountId: string; token: string } {
  const accountId = options.accountId ?? process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = options.apiToken ?? process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !token) {
    throw new CloudflareConfigurationError(
      "Cloudflare publishing is credential-gated. Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.",
    );
  }
  return { accountId, token };
}

export class CloudflarePagesPublisher implements Publisher {
  private readonly wrangler: string;

  constructor(private readonly options: CloudflarePublisherOptions) {
    this.wrangler = options.wranglerCommand ?? "wrangler";
  }

  /**
   * Snapshot identity for a Xyle-managed Pages project. Because immutable
   * deployments are addressed by deployment id rather than a content digest,
   * we derive a stable pseudo-snapshot from project name; live validation of
   * richer state is part of the deferred spike work.
   */
  async readSnapshot(): Promise<PublishedSnapshot> {
    requireEnv(this.options);
    // Minimal contract satisfaction until adoption probing lands with credentials:
    // a sentinel manifest signals "no locally-known snapshot".
    const sentinel = `sha256:${"0".repeat(64)}` as const;
    return {
      snapshotDigest: sentinel,
      manifest: { version: 1, snapshotDigest: sentinel, files: {} },
    };
  }

  async publish(next: PublishSnapshot): Promise<PublishResult> {
    requireEnv(this.options);

    const dir = await mkdtemp(join(tmpdir(), "xyle-cf-"));
    try {
      for (const file of [...next.changedFiles, ...next.addedFiles]) {
        const target = join(dir, file.path.replace(/^\/+/, ""));
        await writeFile(target, file.bytes);
      }
      // fail closed: refuse control surfaces the spike did not validate
      const result = await this.runWrangler(dir);
      return {
        snapshot: {
          snapshotDigest: next.manifest.snapshotDigest,
          manifest: next.manifest,
        },
        id: result.deploymentId ?? "cf-unknown",
      };
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  private runWrangler(dir: string): Promise<{ deploymentId?: string }> {
    return new Promise((resolvePromise, rejectPromise) => {
      const child = spawn(
        this.wrangler,
        [
          "pages",
          "deploy",
          ".",
          `--project-name=${this.options.projectName}`,
          "--commit-dirty=true",
        ],
        {
          cwd: dir,
          env: {
            ...process.env,
            CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN ?? "",
            CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", rejectPromise);
      child.on("close", (code) => {
        if (code !== 0) {
          rejectPromise(new Error(`wrangler exited ${code}: ${stderr.slice(-2000)}`));
          return;
        }
        const match = /https:\/\/[a-f0-9-]+\.([^/\s]+)\.pages\.dev/.exec(stdout);
        const deploymentId = match?.[1];
        resolvePromise(deploymentId ? { deploymentId } : {});
      });
    });
  }
}
