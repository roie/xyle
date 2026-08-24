import { spawn } from "node:child_process";
import { cp, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import type {
  PublishResult,
  PublishSnapshot,
  PublishedSnapshot,
  Publisher,
  XyleManifest,
} from "../types.ts";
import { MANIFEST_PATH, StaleSnapshotError } from "./filesystem.ts";

/** Direct Upload only. Every deployment is a complete materialized snapshot. */
export interface CloudflarePublisherOptions {
  root: string;
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

interface PagesProject {
  source?: unknown;
  uses_functions?: boolean;
}

export class CloudflarePagesPublisher implements Publisher {
  private readonly root: string;
  private readonly wrangler: string;

  constructor(private readonly options: CloudflarePublisherOptions) {
    this.root = resolve(options.root);
    this.wrangler = options.wranglerCommand ?? "wrangler";
  }

  private credentials(): { accountId: string; apiToken: string } {
    const accountId = this.options.accountId ?? process.env.CLOUDFLARE_ACCOUNT_ID;
    const apiToken = this.options.apiToken ?? process.env.CLOUDFLARE_API_TOKEN;
    if (!accountId || !apiToken) {
      throw new CloudflareConfigurationError(
        "Cloudflare publishing requires CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.",
      );
    }
    return { accountId, apiToken };
  }

  private async request(path: string): Promise<Response> {
    const { accountId, apiToken } = this.credentials();
    return fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}${path}`, {
      headers: { authorization: `Bearer ${apiToken}` },
    });
  }

  private async assertSupportedProject(): Promise<void> {
    const response = await this.request(
      `/pages/projects/${encodeURIComponent(this.options.projectName)}`,
    );
    if (!response.ok)
      throw new CloudflareConfigurationError(`cannot inspect Pages project (${response.status})`);
    const body = (await response.json()) as { result?: PagesProject };
    if (body.result?.source || body.result?.uses_functions) {
      throw new CloudflareConfigurationError(
        "Xyle supports only Direct Upload Pages projects without Functions or worker behavior.",
      );
    }
  }

  async readSnapshot(): Promise<PublishedSnapshot> {
    await this.assertSupportedProject();
    const response = await fetch(`https://${this.options.projectName}.pages.dev${MANIFEST_PATH}`, {
      cache: "no-store",
    });
    if (!response.ok) {
      throw new CloudflareConfigurationError(
        "Refusing to adopt this Pages project: its current deployment has no Xyle manifest.",
      );
    }
    const manifest = (await response.json()) as XyleManifest;
    if (manifest?.version !== 1 || typeof manifest.snapshotDigest !== "string") {
      throw new CloudflareConfigurationError("Refusing malformed remote Xyle manifest.");
    }
    return { snapshotDigest: manifest.snapshotDigest, manifest };
  }

  async publish(next: PublishSnapshot): Promise<PublishResult> {
    const current = await this.readSnapshot();
    if (current.snapshotDigest !== next.baseSnapshotDigest) {
      throw new StaleSnapshotError(current.snapshotDigest, next.baseSnapshotDigest);
    }
    const staging = await mkdtemp(join(tmpdir(), "xyle-cf-"));
    try {
      await cp(this.root, staging, {
        recursive: true,
        filter: (source) => !relative(this.root, source).split("/").includes(".xyle"),
      });
      for (const file of [...next.changedFiles, ...next.addedFiles]) {
        const target = join(staging, file.path.replace(/^\/+/, ""));
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, file.bytes);
      }
      const manifestPath = join(staging, MANIFEST_PATH.replace(/^\//, ""));
      await mkdir(dirname(manifestPath), { recursive: true });
      await writeFile(manifestPath, JSON.stringify(next.manifest, null, 2));
      const id = await this.runWrangler(staging);
      return {
        snapshot: { snapshotDigest: next.manifest.snapshotDigest, manifest: next.manifest },
        id,
      };
    } finally {
      await rm(staging, { recursive: true, force: true }).catch(() => {});
    }
  }

  /** Explicit initial adoption: uploads the complete local snapshot and marker. */
  async bootstrap(manifest: XyleManifest): Promise<PublishResult> {
    await this.assertSupportedProject();
    const staging = await mkdtemp(join(tmpdir(), "xyle-cf-"));
    try {
      await cp(this.root, staging, {
        recursive: true,
        filter: (source) => !relative(this.root, source).split("/").includes(".xyle"),
      });
      const manifestPath = join(staging, MANIFEST_PATH.replace(/^\//, ""));
      await mkdir(dirname(manifestPath), { recursive: true });
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
      const id = await this.runWrangler(staging);
      return { snapshot: { snapshotDigest: manifest.snapshotDigest, manifest }, id };
    } finally {
      await rm(staging, { recursive: true, force: true }).catch(() => {});
    }
  }

  private runWrangler(directory: string): Promise<string> {
    const { accountId, apiToken } = this.credentials();
    const { promise, resolve: resolveDeployment, reject } = Promise.withResolvers<string>();
    const child = spawn(
      this.wrangler,
      ["pages", "deploy", ".", `--project-name=${this.options.projectName}`],
      {
        cwd: directory,
        env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_API_TOKEN: apiToken },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    child.stdout.on("data", (chunk) => (output += String(chunk)));
    child.stderr.on("data", (chunk) => (output += String(chunk)));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`wrangler exited ${code}: ${output.slice(-2000)}`));
      const id = /https:\/\/([a-f0-9-]+)\./.exec(output)?.[1];
      if (!id) return reject(new Error("wrangler did not report a deployment URL"));
      resolveDeployment(id);
    });
    return promise;
  }
}
