import {
  appendFile,
  chmod,
  link,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { join, resolve } from "node:path";
import { generateEditorKey } from "./auth.ts";
import { FilesystemPublisher } from "./publishers/filesystem.ts";
import { CloudflarePagesPublisher } from "./publishers/cloudflare.ts";
import { createXyleHandler, type RuntimeContext } from "./server.ts";
import { buildManifestFromDirectory, digestBytes } from "./manifest.ts";
import { MAX_UPLOAD_BYTES } from "./media.ts";
import type { AuthConfig, LocalXyleState, XyleDigest } from "./types.ts";

const SECRETS_DIR = ".xyle";
const SECRETS_FILE = "secrets.local.json";
const STATE_FILE = ".xyle.json";

interface Secrets {
  editorKey: string;
  sessionSecretB64: string;
}

export async function loadOrCreateSecrets(
  directory: string,
): Promise<{ secrets: Secrets; freshKey: string | null }> {
  const secretsDir = join(directory, SECRETS_DIR);
  const secretsPath = join(secretsDir, SECRETS_FILE);
  try {
    const parsed = JSON.parse(await readFile(secretsPath, "utf8")) as Secrets;
    return { secrets: parsed, freshKey: null };
  } catch {
    const secrets: Secrets = {
      editorKey: generateEditorKey(),
      sessionSecretB64: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64"),
    };
    await mkdir(secretsDir, { recursive: true });
    await writeFile(secretsPath, JSON.stringify(secrets, null, 2), { mode: 0o600 });
    await chmod(secretsPath, 0o600);
    // keep local secrets out of git
    const gitignore = join(directory, ".gitignore");
    try {
      const existing = await readFile(gitignore, "utf8");
      if (!existing.includes(`${SECRETS_DIR}/`)) {
        await appendFile(gitignore, `\n${SECRETS_DIR}/\n`);
      }
    } catch {
      await writeFile(gitignore, `${SECRETS_DIR}/\n`);
    }
    return { secrets, freshKey: secrets.editorKey };
  }
}

export async function buildAuthConfig(
  secrets: Secrets,
  maxAgeSeconds = 8 * 60 * 60,
): Promise<AuthConfig> {
  const sessionSecret = new Uint8Array(Buffer.from(secrets.sessionSecretB64, "base64"));
  return {
    editorKeyDigest: await digestBytes(new TextEncoder().encode(secrets.editorKey)),
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
    await rm(tempPath, { force: true }).catch(() => {});
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isXyleDigest(value: unknown): value is XyleDigest {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
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
  if (typeof state.directory !== "string" || state.directory.length === 0) {
    throw new Error("directory must be a non-empty string");
  }
  if (typeof state.publisher !== "string" || state.publisher.length === 0) {
    throw new Error("publisher must be a non-empty string");
  }
  if (state.lastManagedSnapshotDigest !== null && !isXyleDigest(state.lastManagedSnapshotDigest)) {
    throw new Error("lastManagedSnapshotDigest must be null or a SHA-256 digest");
  }
  if (typeof state.editorPath !== "string" || !state.editorPath.startsWith("/")) {
    throw new Error("editorPath must be an absolute site path");
  }
  if (!isStringArray(state.ignorePaths)) {
    throw new Error("ignorePaths must be an array of strings");
  }
  if (!isStringArray(state.ignoreSelectors)) {
    throw new Error("ignoreSelectors must be an array of strings");
  }
  return {
    directory: state.directory,
    publisher: state.publisher,
    lastManagedSnapshotDigest: state.lastManagedSnapshotDigest,
    editorPath: state.editorPath,
    ignorePaths: state.ignorePaths,
    ignoreSelectors: state.ignoreSelectors,
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
        wranglerCommand: join(process.cwd(), "node_modules/.bin/wrangler"),
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
}

function parseArgs(argv: string[]): CliArgs {
  const [command = "dev", positional] = argv.filter((a) => !a.startsWith("--"));
  const force = argv.includes("--force");
  const portFlag = argv.find((a) => a.startsWith("--port="));
  const parsedPort = portFlag ? Number(portFlag.split("=")[1]) : undefined;
  return {
    command: command || "dev",
    directory: positional ?? ".",
    force,
    ...(parsedPort !== undefined ? { port: parsedPort } : {}),
  };
}

async function runDeploy(directory: string, force: boolean): Promise<number> {
  const root = resolve(directory);
  const state = await readOrCreateState(root);
  const projectName = process.env.XYLE_CLOUDFLARE_PROJECT;
  if (projectName) {
    const publisher = new CloudflarePagesPublisher({
      root,
      projectName,
      wranglerCommand: join(process.cwd(), "node_modules/.bin/wrangler"),
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
    default:
      console.error(`Unknown command: ${args.command}`);
      console.error("Usage: xyle <init|dev|deploy> [directory] [--force] [--port=N]");
      return 2;
  }
}

const invokedAsCli = /cli\.(ts|mts|js|mjs)$/.test(process.argv[1] ?? "");
if (invokedAsCli) {
  main()
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
}
