#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { appendFile, link, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateEditorKey } from "./auth.ts";
import { ensureDirectUploadProject, uploadPagesSecrets } from "./cloudflare-setup.ts";
import { FilesystemPublisher } from "./publishers/filesystem.ts";
import { CloudflarePagesPublisher } from "./publishers/cloudflare.ts";
import { createXyleHandler, type RuntimeContext } from "./server.ts";
import { buildManifestFromDirectory, digestBytes } from "./manifest.ts";
import { MAX_UPLOAD_BYTES } from "./media.ts";
import type { AuthConfig, LocalXyleState, XyleDigest } from "./types.ts";

const SECRETS_DIR = ".xyle";
const SECRETS_FILE = "secrets.local.json";
const STATE_FILE = ".xyle.json";

export interface Secrets {
  editorKey: string;
  sessionSecretB64: string;
}

function isValidEditorKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 32 &&
    value.length <= 256 &&
    !/[\u0000-\u0020\u007f]/.test(value)
  );
}

function isCanonicalSessionSecret(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const decoded = Buffer.from(value, "base64");
  return decoded.byteLength === 32 && decoded.toString("base64") === value;
}

function validateSecrets(value: unknown): Secrets {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("secrets must be an object");
  }
  const secrets = value as Record<string, unknown>;
  if (
    Object.keys(secrets).length !== 2 ||
    !Object.hasOwn(secrets, "editorKey") ||
    !Object.hasOwn(secrets, "sessionSecretB64")
  ) {
    throw new Error("secrets have missing or unknown fields");
  }
  if (!isValidEditorKey(secrets.editorKey)) {
    throw new Error("editorKey must contain 32 to 256 non-whitespace characters");
  }
  if (!isCanonicalSessionSecret(secrets.sessionSecretB64)) {
    throw new Error("sessionSecretB64 must encode exactly 32 bytes");
  }
  return {
    editorKey: secrets.editorKey,
    sessionSecretB64: secrets.sessionSecretB64,
  };
}

function parseSecrets(contents: string, secretsPath: string): Secrets {
  try {
    return validateSecrets(JSON.parse(contents));
  } catch (error) {
    throw new Error(`Invalid Xyle secrets file ${secretsPath}: ${(error as Error).message}`, {
      cause: error,
    });
  }
}

async function readSecretsIfPresent(secretsPath: string): Promise<Secrets | null> {
  try {
    return parseSecrets(await readFile(secretsPath, "utf8"), secretsPath);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return null;
    throw error;
  }
}

async function ensureSecretsIgnored(directory: string): Promise<void> {
  const gitignorePath = join(directory, ".gitignore");
  let existing: string;
  try {
    existing = await readFile(gitignorePath, "utf8");
  } catch (error) {
    if (!hasErrorCode(error, "ENOENT")) throw error;
    try {
      await writeFileAtomically(gitignorePath, `${SECRETS_DIR}/\n`, { createOnly: true });
      return;
    } catch (createError) {
      if (!hasErrorCode(createError, "EEXIST")) throw createError;
      return ensureSecretsIgnored(directory);
    }
  }
  if (existing.split(/\r?\n/).includes(`${SECRETS_DIR}/`)) return;
  const separator = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  await appendFile(gitignorePath, `${separator}${SECRETS_DIR}/\n`);
}

export async function loadOrCreateSecrets(
  directory: string,
): Promise<{ secrets: Secrets; freshKey: string | null }> {
  const secretsDir = join(directory, SECRETS_DIR);
  const secretsPath = join(secretsDir, SECRETS_FILE);
  const existing = await readSecretsIfPresent(secretsPath);
  if (existing) {
    await ensureSecretsIgnored(directory);
    return { secrets: existing, freshKey: null };
  }

  const generated: Secrets = {
    editorKey: generateEditorKey(),
    sessionSecretB64: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64"),
  };
  await mkdir(secretsDir, { recursive: true });
  await ensureSecretsIgnored(directory);
  try {
    await writeFileAtomically(secretsPath, `${JSON.stringify(generated, null, 2)}\n`, {
      mode: 0o600,
      createOnly: true,
    });
    return { secrets: generated, freshKey: generated.editorKey };
  } catch (error) {
    if (!hasErrorCode(error, "EEXIST")) throw error;
    const concurrentSecrets = await readSecretsIfPresent(secretsPath);
    if (!concurrentSecrets) throw error;
    return { secrets: concurrentSecrets, freshKey: null };
  }
}

export async function managementSecretFor(secrets: Secrets): Promise<string> {
  const validSecrets = validateSecrets(secrets);
  return digestBytes(new TextEncoder().encode(`xyle-management:${validSecrets.sessionSecretB64}`));
}

export async function buildAuthConfig(
  secrets: Secrets,
  maxAgeSeconds = 8 * 60 * 60,
): Promise<AuthConfig> {
  const validSecrets = validateSecrets(secrets);
  const sessionSecret = new Uint8Array(Buffer.from(validSecrets.sessionSecretB64, "base64"));
  return {
    editorKeyDigest: await digestBytes(new TextEncoder().encode(validSecrets.editorKey)),
    sessionSecret,
    sessionMaxAgeSeconds: maxAgeSeconds,
  };
}

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

async function writeFileAtomically(
  path: string,
  contents: string,
  options: { mode?: number; createOnly?: boolean } = {},
): Promise<void> {
  const tempPath = `${path}.xyle-tmp-${process.pid}-${crypto.randomUUID()}`;
  try {
    const handle = await open(tempPath, "wx", options.mode ?? 0o644);
    try {
      await handle.writeFile(contents, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (options.createOnly) await link(tempPath, path);
    else await rename(tempPath, path);
  } finally {
    try {
      await rm(tempPath, { force: true });
    } catch {
      // Best-effort cleanup must not hide the write or link error.
    }
  }
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function requireXyleDigestOrNull(value: unknown): XyleDigest | null {
  if (value === null) return null;
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new Error("lastManagedSnapshotDigest must be null or a SHA-256 digest");
  }
  return value as XyleDigest;
}

function requireStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`${field} must be an array of strings`);
  }
  return value;
}

function validateState(value: unknown): LocalXyleState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("state must be an object");
  }
  const state = value as Record<string, unknown>;
  const expectedKeys = [
    "directory",
    "publisher",
    "lastManagedSnapshotDigest",
    "editorPath",
    "ignorePaths",
    "ignoreSelectors",
  ];
  if (
    Object.keys(state).length !== expectedKeys.length ||
    expectedKeys.some((key) => !Object.hasOwn(state, key))
  ) {
    throw new Error("state has missing or unknown fields");
  }
  const directory = requireNonEmptyString(state.directory, "directory");
  const publisher = requireNonEmptyString(state.publisher, "publisher");
  const lastManagedSnapshotDigest = requireXyleDigestOrNull(state.lastManagedSnapshotDigest);
  const editorPath = requireNonEmptyString(state.editorPath, "editorPath");
  if (!editorPath.startsWith("/")) throw new Error("editorPath must be an absolute site path");
  const ignorePaths = requireStringArray(state.ignorePaths, "ignorePaths");
  const ignoreSelectors = requireStringArray(state.ignoreSelectors, "ignoreSelectors");
  return {
    directory,
    publisher,
    lastManagedSnapshotDigest,
    editorPath,
    ignorePaths,
    ignoreSelectors,
  };
}

function parseState(contents: string, statePath: string): LocalXyleState {
  try {
    return validateState(JSON.parse(contents));
  } catch (error) {
    throw new Error(`Invalid Xyle state file ${statePath}: ${(error as Error).message}`, {
      cause: error,
    });
  }
}

async function readStateIfPresent(statePath: string): Promise<LocalXyleState | null> {
  try {
    return parseState(await readFile(statePath, "utf8"), statePath);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return null;
    throw error;
  }
}

export async function readOrCreateState(directory: string): Promise<LocalXyleState> {
  const statePath = join(directory, STATE_FILE);
  const existing = await readStateIfPresent(statePath);
  if (existing) return existing;
  const state: LocalXyleState = {
    directory: ".",
    publisher: "filesystem",
    lastManagedSnapshotDigest: null,
    editorPath: "/edit",
    ignorePaths: [],
    ignoreSelectors: [],
  };
  try {
    await writeFileAtomically(statePath, `${JSON.stringify(state, null, 2)}\n`, {
      createOnly: true,
    });
    return state;
  } catch (error) {
    if (!hasErrorCode(error, "EEXIST")) throw error;
    const concurrentState = await readStateIfPresent(statePath);
    if (!concurrentState) throw error;
    return concurrentState;
  }
}

export async function updateState(
  directory: string,
  patch: Partial<LocalXyleState>,
): Promise<void> {
  const statePath = join(directory, STATE_FILE);
  const state = validateState({ ...(await readOrCreateState(directory)), ...patch });
  await writeFileAtomically(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

export interface DeployGuardDecision {
  allowed: boolean;
  reason?: string;
}

/**
 * Refuse managed redeploys that would silently overwrite remote edits made
 * after the developer's last managed deployment.
 */
export function evaluateDeployGuard(
  lastManagedSnapshotDigest: XyleDigest | null,
  currentRemoteDigest: XyleDigest,
  force = false,
): DeployGuardDecision {
  if (force) return { allowed: true };
  if (lastManagedSnapshotDigest === null) return { allowed: true };
  if (lastManagedSnapshotDigest === currentRemoteDigest) return { allowed: true };
  return {
    allowed: false,
    reason:
      "The live site contains changes made after your last managed deployment.\n" +
      "Xyle is refusing to overwrite them.\n\n" +
      `Recorded snapshot: ${lastManagedSnapshotDigest}\n` +
      `Live snapshot:     ${currentRemoteDigest}\n\n` +
      "Reconcile the site first, or redeploy deliberately with:\n" +
      "  xyle deploy --force",
  };
}

class HttpRequestTooLargeError extends Error {}

export interface DevServerOptions {
  directory: string;
  host?: string;
  port?: number;
  publicBaseUrl?: string;
  /** Test-only fixture reset hook. */
  resetForTests?: () => Promise<void>;
}

export async function startXyleDevServer(options: DevServerOptions): Promise<{
  server: Server;
  url: string;
}> {
  const root = resolve(options.directory);
  const host = options.host ?? "127.0.0.1";
  const configuredPort =
    options.port ??
    (process.env.XYLE_PORT === undefined ? undefined : Number(process.env.XYLE_PORT));
  const requestedPort = configuredPort ?? 4173;

  const { secrets } = await loadOrCreateSecrets(root);
  const auth = await buildAuthConfig(secrets);
  const state = await readOrCreateState(root);
  const projectName = process.env.XYLE_CLOUDFLARE_PROJECT;
  const publisher = projectName
    ? new CloudflarePagesPublisher({
        root,
        projectName,
        managementSecret: await managementSecretFor(secrets),
        runtimeDirectory: dirname(fileURLToPath(import.meta.url)),
      })
    : new FilesystemPublisher({ root });

  let handler: (request: Request) => Promise<Response>;

  const server = createServer(async (req, res) => {
    try {
      const hostHeader = req.headers.host ?? `${host}:${requestedPort}`;
      const url = new URL(req.url ?? "/", `http://${hostHeader}`);
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === "string") headers.set(key, value);
        else if (Array.isArray(value)) headers.set(key, value.join(", "));
      }
      const method = req.method ?? "GET";
      let body: Uint8Array | undefined;
      if (!["GET", "HEAD"].includes(method)) {
        const limit = MAX_UPLOAD_BYTES + 1024 * 1024;
        const declaredLength = Number(req.headers["content-length"] ?? "0");
        if (!Number.isSafeInteger(declaredLength) || declaredLength > limit) {
          res.writeHead(413, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "request too large" }));
          req.resume();
          return;
        }
        body = await new Promise<Uint8Array>((resolveBody, reject) => {
          const chunks: Buffer[] = [];
          let size = 0;
          req.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > limit) {
              reject(new HttpRequestTooLargeError());
              req.resume();
              return;
            }
            chunks.push(chunk);
          });
          req.on("end", () => resolveBody(new Uint8Array(Buffer.concat(chunks))));
          req.on("error", reject);
        });
      }
      const requestInit: RequestInit & { duplex?: string } = {
        method,
        headers,
        // SAFETY: Node's Uint8Array is accepted by the Fetch BodyInit implementation.
        body: body ? (body as unknown as BodyInit) : null,
      };
      requestInit.duplex = "half";
      const request = new Request(url, requestInit);
      const response = await handler(request);
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      const status = error instanceof HttpRequestTooLargeError ? 413 : 500;
      res.writeHead(status, { "content-type": "application/json" });
      res.end(
        JSON.stringify({ error: status === 413 ? "request too large" : (error as Error).message }),
      );
    }
  });

  const listen = (port: number): Promise<void> =>
    new Promise<void>((resolveListen, rejectListen) => {
      server.once("error", rejectListen);
      server.listen(port, host, resolveListen);
    });

  try {
    await listen(requestedPort);
  } catch (error) {
    if (configuredPort !== undefined || (error as NodeJS.ErrnoException).code !== "EADDRINUSE") {
      throw error;
    }
    await listen(0);
  }

  const address = server.address();
  const actualPort = typeof address === "object" && address !== null ? address.port : requestedPort;
  const publicBaseUrl =
    options.publicBaseUrl ?? process.env.XYLE_BASE_URL ?? `http://${host}:${actualPort}`;

  const context: RuntimeContext = {
    root,
    publicBaseUrl,
    publisher,
    auth,
    publicAssetRoot: "/",
    cspKnown: true,
    ignorePaths: state.ignorePaths,
    ignoreSelectors: state.ignoreSelectors,
    ...(options.resetForTests ? { resetForTests: options.resetForTests } : {}),
  };
  handler = createXyleHandler(context);

  return { server, url: publicBaseUrl };
}

/* ---------- CLI entrypoint ---------- */

interface CliArgs {
  command: string;
  directory: string;
  force: boolean;
  port?: number;
  project?: string;
  accountId?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const [command = "dev", positional] = argv.filter((a) => !a.startsWith("--"));
  const force = argv.includes("--force");
  const portFlag = argv.find((a) => a.startsWith("--port="));
  const parsedPort = portFlag ? Number(portFlag.split("=")[1]) : undefined;
  const project = argv.find((a) => a.startsWith("--project="))?.split("=")[1];
  const accountId = argv.find((a) => a.startsWith("--account-id="))?.split("=")[1];
  return {
    command: command || "dev",
    directory: positional ?? ".",
    force,
    ...(parsedPort !== undefined ? { port: parsedPort } : {}),
    ...(project ? { project } : {}),
    ...(accountId ? { accountId } : {}),
  };
}

async function runCloudflareSetup(args: CliArgs): Promise<number> {
  const root = resolve(args.directory);
  const projectName = args.project ?? process.env.XYLE_CLOUDFLARE_PROJECT;
  const accountId = args.accountId ?? process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!projectName || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(projectName)) {
    throw new Error("Cloudflare setup requires --project=<letters-numbers-and-hyphens>.");
  }
  if (!accountId || !apiToken) {
    throw new Error(
      "Cloudflare setup requires --account-id and CLOUDFLARE_API_TOKEN with Pages edit access.",
    );
  }

  const publisherOptions = {
    root,
    projectName,
    accountId,
    apiToken,
    runtimeDirectory: dirname(fileURLToPath(import.meta.url)),
  };
  await new CloudflarePagesPublisher(publisherOptions).validateLocalSite();
  const { manifest } = await buildManifestFromDirectory(root);
  const { secrets, freshKey } = await loadOrCreateSecrets(root);
  const publisher = new CloudflarePagesPublisher({
    ...publisherOptions,
    managementSecret: await managementSecretFor(secrets),
  });
  const state = await readOrCreateState(root);
  const project = await ensureDirectUploadProject({ accountId, apiToken, projectName });
  if (project === "existing") {
    try {
      const current = await publisher.readSnapshot();
      const decision = evaluateDeployGuard(
        state.lastManagedSnapshotDigest,
        current.snapshotDigest,
        args.force,
      );
      if (!decision.allowed) throw new Error(decision.reason);
    } catch (error) {
      if (!args.force) {
        throw new Error(
          `${(error as Error).message}\nUse --force only after you confirm that Xyle can replace this Direct Upload project.`,
        );
      }
    }
  }

  const auth = await buildAuthConfig(secrets);
  await uploadPagesSecrets(root, {
    accountId,
    apiToken,
    projectName,
    secrets: {
      CLOUDFLARE_ACCOUNT_ID: accountId,
      CLOUDFLARE_API_TOKEN: apiToken,
      CLOUDFLARE_PROJECT: projectName,
      XYLE_EDITOR_KEY_DIGEST: auth.editorKeyDigest,
      XYLE_MANAGEMENT_SECRET: await managementSecretFor(secrets),
      XYLE_SESSION_SECRET: secrets.sessionSecretB64,
    },
  });
  const result = await publisher.bootstrap(manifest);
  await updateState(root, {
    publisher: "cloudflare-pages",
    lastManagedSnapshotDigest: result.snapshot.snapshotDigest,
  });

  console.log(`Cloudflare Pages deployment created: ${result.id}`);
  console.log(`Editor: https://${projectName}.pages.dev/edit`);
  if (freshKey) {
    console.log("\nEditor key (stored in .xyle/secrets.local.json — shown once):\n");
    console.log(`  ${freshKey}\n`);
  }
  return 0;
}

async function runDeploy(directory: string, force: boolean): Promise<number> {
  const root = resolve(directory);
  const state = await readOrCreateState(root);
  const projectName = process.env.XYLE_CLOUDFLARE_PROJECT;
  if (projectName) {
    const { secrets } = await loadOrCreateSecrets(root);
    const publisher = new CloudflarePagesPublisher({
      root,
      projectName,
      managementSecret: await managementSecretFor(secrets),
      runtimeDirectory: dirname(fileURLToPath(import.meta.url)),
    });
    const { manifest } = await buildManifestFromDirectory(root);
    try {
      const current = await publisher.readSnapshot();
      const decision = evaluateDeployGuard(
        state.lastManagedSnapshotDigest,
        current.snapshotDigest,
        force,
      );
      if (!decision.allowed) {
        console.error(decision.reason);
        return 1;
      }
    } catch (error) {
      if (!force) {
        console.error(
          `${(error as Error).message}\nUse xyle deploy --force for explicit initial adoption.`,
        );
        return 1;
      }
    }
    const result = await publisher.bootstrap(manifest);
    await updateState(root, {
      publisher: "cloudflare-pages",
      lastManagedSnapshotDigest: result.snapshot.snapshotDigest,
    });
    console.log(`Cloudflare Pages deployment created: ${result.id}`);
    return 0;
  }

  const publisher = new FilesystemPublisher({ root });
  const current = await publisher.readSnapshot();
  const decision = evaluateDeployGuard(
    state.lastManagedSnapshotDigest,
    current.snapshotDigest,
    force,
  );
  if (!decision.allowed) {
    console.error(decision.reason);
    return 1;
  }
  await updateState(root, { lastManagedSnapshotDigest: current.snapshotDigest });
  console.log(`Managed deployment recorded: ${current.snapshotDigest}`);
  console.log("The filesystem publisher writes in place; nothing further to upload.");
  return 0;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const args = parseArgs(argv);

  switch (args.command) {
    case "init": {
      const root = resolve(args.directory);
      const { freshKey } = await loadOrCreateSecrets(root);
      await readOrCreateState(root);
      console.log(`Xyle initialized for ${root}`);
      if (freshKey) {
        console.log("\nEditor key (stored in .xyle/secrets.local.json — shown once):\n");
        console.log(`  ${freshKey}\n`);
      }
      return 0;
    }
    case "dev": {
      const { url } = await startXyleDevServer({
        directory: args.directory,
        ...(args.port !== undefined ? { port: args.port } : {}),
      });
      console.log(`Public site: ${url}`);
      console.log(`Editor:      ${url}/edit`);
      console.log("Press Ctrl+C to stop.");
      await new Promise(() => {});
      return 0;
    }
    case "deploy":
      return runDeploy(args.directory, args.force);
    case "cloudflare":
      return runCloudflareSetup(args);
    default:
      console.error(`Unknown command: ${args.command}`);
      console.error(
        "Usage: xyle <init|dev|deploy|cloudflare> [directory] [--force] [--port=N] [--project=NAME] [--account-id=ID]",
      );
      return 2;
  }
}

let invokedAsCli = false;
try {
  invokedAsCli = realpathSync(process.argv[1] ?? "") === fileURLToPath(import.meta.url);
} catch {
  // Importers can use the CLI helpers without an executable argv entry.
}
if (invokedAsCli) {
  main()
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
}
