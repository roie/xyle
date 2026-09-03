import { spawn } from "node:child_process";
import { access, cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type {
  PublishResult,
  PublishSnapshot,
  PublishedSnapshot,
  Publisher,
  XyleManifest,
} from "../types.ts";
import { MANIFEST_PATH, StaleSnapshotError } from "./filesystem.ts";
import {
  digestBytes,
  scanStaticDirectory,
  validateManifest,
  XYLE_MANAGED_ASSET_MANIFEST_PATH,
} from "../manifest.ts";

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

async function assertStagedSnapshot(staging: string, manifest: XyleManifest): Promise<void> {
  for (const [path, entry] of Object.entries(manifest.files)) {
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await readFile(join(staging, path.replace(/^\/+/, ""))));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") {
        throw new CloudflareConfigurationError(
          `Refusing deployment: staged file is missing from the final snapshot: ${path}`,
        );
      }
      throw error;
    }
    if (bytes.byteLength !== entry.size || (await digestBytes(bytes)) !== entry.digest) {
      throw new CloudflareConfigurationError(
        `Refusing deployment: staged file does not match the final manifest: ${path}`,
      );
    }
  }
}

interface PagesProject {
  source?: unknown;
}

export class CloudflarePagesPublisher implements Publisher {
  private readonly root: string;
  private readonly wrangler: string;
  private readonly options: CloudflarePublisherOptions;

  constructor(options: CloudflarePublisherOptions) {
    this.options = options;
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

  private async assertLocalControlState(): Promise<void> {
    const unsupported = [
      [join(this.root, "functions"), "a local Functions directory"],
      [join(this.root, "_worker.js"), "a local worker script"],
      [join(this.root, "_worker"), "a local worker directory"],
      [join(this.root, "_routes.json"), "a local _routes.json file"],
    ] as const;
    for (const [path, description] of unsupported) {
      try {
        await access(path);
        throw new CloudflareConfigurationError(
          `Refusing this Pages project: ${description} is outside Xyle's control.`,
        );
      } catch (error) {
        if (error instanceof CloudflareConfigurationError) throw error;
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
      }
    }
  }

  private async assertSupportedProject(): Promise<void> {
    await this.assertLocalControlState();
    const response = await this.request(
      `/pages/projects/${encodeURIComponent(this.options.projectName)}`,
    );
    if (!response.ok)
      throw new CloudflareConfigurationError(`cannot inspect Pages project (${response.status})`);
    const body = (await response.json()) as { result?: PagesProject };
    if (body.result?.source) {
      throw new CloudflareConfigurationError(
        "Xyle supports only Direct Upload Pages projects; Git-integrated projects are refused.",
      );
    }
  }

  private async assertRemoteRuntime(): Promise<void> {
    const response = await fetch(
      `https://${this.options.projectName}.pages.dev/__xyle/api/session`,
      { cache: "no-store" },
    );
    if (!response.ok || response.headers.get("x-xyle-runtime") !== "1") {
      throw new CloudflareConfigurationError(
        "Refusing this Pages project: the deployed Xyle control runtime is missing or foreign.",
      );
    }
  }

  async readSnapshot(): Promise<PublishedSnapshot> {
    await this.assertSupportedProject();
    await this.assertRemoteRuntime();
    const response = await fetch(`https://${this.options.projectName}.pages.dev${MANIFEST_PATH}`, {
      cache: "no-store",
    });
    if (!response.ok) {
      throw new CloudflareConfigurationError(
        "Refusing to adopt this Pages project: its current deployment has no Xyle manifest.",
      );
    }
    let manifest: XyleManifest;
    try {
      manifest = await validateManifest(await response.json());
    } catch {
      throw new CloudflareConfigurationError("Refusing malformed remote Xyle manifest.");
    }
    return { snapshotDigest: manifest.snapshotDigest, manifest };
  }

  async publish(next: PublishSnapshot): Promise<PublishResult> {
    await validateManifest(next.manifest);
    const current = await this.readSnapshot();
    if (current.snapshotDigest !== next.baseSnapshotDigest) {
      throw new StaleSnapshotError(current.snapshotDigest, next.baseSnapshotDigest);
    }
    // Stage beside installed dependencies while deploying only this isolated directory.
    const staging = await mkdtemp(join(process.cwd(), ".xyle-stage-"));
    try {
      await this.stageStaticSnapshot(staging, new Set(Object.keys(next.manifest.files)));
      await this.stageControlRuntime(staging);
      for (const file of [...next.changedFiles, ...next.addedFiles, ...(next.managedFiles ?? [])]) {
        if (
          !Object.hasOwn(next.manifest.files, file.path) &&
          file.path !== XYLE_MANAGED_ASSET_MANIFEST_PATH
        ) {
          throw new CloudflareConfigurationError(
            `Refusing deployment: staged file is not declared by the final manifest: ${file.path}`,
          );
        }
        const target = join(staging, file.path.replace(/^\/+/, ""));
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, file.bytes);
      }
      await assertStagedSnapshot(staging, next.manifest);
      const manifestPath = join(staging, MANIFEST_PATH.replace(/^\//, ""));
      await mkdir(dirname(manifestPath), { recursive: true });
      await writeFile(manifestPath, JSON.stringify(next.manifest, null, 2));
      // Pages Direct Upload has no CAS API, so verify the global snapshot again
      // at the last point before starting a deployment.
      const latest = await this.readSnapshot();
      if (latest.snapshotDigest !== next.baseSnapshotDigest) {
        throw new StaleSnapshotError(latest.snapshotDigest, next.baseSnapshotDigest);
      }
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
    await validateManifest(manifest);
    // See publish(): this keeps Wrangler's dependency resolution available.
    const staging = await mkdtemp(join(process.cwd(), ".xyle-stage-"));
    try {
      await this.stageStaticSnapshot(staging, new Set(Object.keys(manifest.files)));
      await this.stageControlRuntime(staging);
      await assertStagedSnapshot(staging, manifest);
      const manifestPath = join(staging, MANIFEST_PATH.replace(/^\//, ""));
      await mkdir(dirname(manifestPath), { recursive: true });
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
      const id = await this.runWrangler(staging);
      return { snapshot: { snapshotDigest: manifest.snapshotDigest, manifest }, id };
    } finally {
      await rm(staging, { recursive: true, force: true }).catch(() => {});
    }
  }

  private async stageStaticSnapshot(staging: string, included: ReadonlySet<string>): Promise<void> {
    const { files } = await scanStaticDirectory(this.root);
    for (const [path, bytes] of files) {
      if (!included.has(path)) continue;
      const target = join(staging, path.replace(/^\/+/, ""));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);
    }
  }

  private async stageControlRuntime(staging: string): Promise<void> {
    // Functions import shared HTML/manifest code, so stage that source beside them.
    await cp(join(process.cwd(), "functions"), join(staging, "functions"), { recursive: true });
    await cp(join(process.cwd(), "src"), join(staging, "src"), { recursive: true });
    await cp(join(process.cwd(), "dist", "editor.js"), join(staging, "editor.js"));
    await cp(
      join(process.cwd(), "functions", "blake3_js_bg.wasm"),
      join(staging, "blake3_js_bg.wasm"),
    );
    await writeFile(
      join(staging, "wrangler.jsonc"),
      JSON.stringify(
        {
          $schema: "./node_modules/wrangler/config-schema.json",
          name: this.options.projectName,
          pages_build_output_dir: ".",
          compatibility_date: "2026-08-24",
          images: { binding: "IMAGES" },
        },
        null,
        2,
      ),
    );
    await writeFile(
      join(staging, "_routes.json"),
      JSON.stringify({ version: 1, include: ["/edit", "/__xyle/*"], exclude: [] }),
    );
  }

  private runWrangler(directory: string): Promise<string> {
    const { accountId, apiToken } = this.credentials();
    const { promise, resolve: resolveDeployment, reject } = Promise.withResolvers<string>();
    const child = spawn(
      this.wrangler,
      ["pages", "deploy", directory, `--project-name=${this.options.projectName}`],
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
