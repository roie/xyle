import { mkdir, readFile, writeFile, chmod, appendFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { join, resolve } from "node:path";
import { generateEditorKey } from "./auth.ts";
import { FilesystemPublisher } from "./publishers/filesystem.ts";
import { createXyleHandler, type RuntimeContext } from "./server.ts";
import { digestBytes } from "./manifest.ts";
import type { AuthConfig, LocalXyleState } from "./types.ts";

const SECRETS_DIR = ".xyle";
const SECRETS_FILE = "secrets.local.json";
const STATE_FILE = ".xyle.json";

interface Secrets {
  editorKey: string;
  sessionSecretB64: string;
}

async function _writeIfMissing(path: string, contents: string, mode?: number): Promise<boolean> {
  try {
    await readFile(path);
    return false;
  } catch {
    await writeFile(path, contents, mode ? { mode } : undefined);
    if (mode !== undefined) await chmod(path, mode);
    return true;
  }
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

export async function readOrCreateState(directory: string): Promise<LocalXyleState> {
  const statePath = join(directory, STATE_FILE);
  try {
    return JSON.parse(await readFile(statePath, "utf8")) as LocalXyleState;
  } catch {
    const state: LocalXyleState = {
      directory: ".",
      publisher: "filesystem",
      lastManagedSnapshotDigest: null,
      editorPath: "/edit",
      ignorePaths: [],
      ignoreSelectors: [],
    };
    await writeFile(statePath, JSON.stringify(state, null, 2));
    return state;
  }
}

export async function updateState(
  directory: string,
  patch: Partial<LocalXyleState>,
): Promise<void> {
  const state = await readOrCreateState(directory);
  await writeFile(join(directory, STATE_FILE), JSON.stringify({ ...state, ...patch }, null, 2));
}

export interface DevServerOptions {
  directory: string;
  host?: string;
  port?: number;
  publicBaseUrl?: string;
}

export async function startXyleDevServer(options: DevServerOptions): Promise<{
  server: Server;
  url: string;
}> {
  const root = resolve(options.directory);
  const host = options.host ?? "127.0.0.1";
  const requestedPort = options.port ?? Number(process.env.XYLE_PORT ?? 4173);

  const { secrets } = await loadOrCreateSecrets(root);
  const auth = await buildAuthConfig(secrets);
  const publisher = new FilesystemPublisher({ root });

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
        body = await new Promise<Uint8Array>((resolveBody, reject) => {
          const chunks: Buffer[] = [];
          req.on("data", (chunk: Buffer) => chunks.push(chunk));
          req.on("end", () => resolveBody(new Uint8Array(Buffer.concat(chunks))));
          req.on("error", reject);
        });
      }
      const requestInit: RequestInit & { duplex?: string } = {
        method,
        headers,
        body: body ? (body as unknown as BodyInit) : null,
      };
      requestInit.duplex = "half";
      const request = new Request(url, requestInit);
      const response = await handler(request);
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: (error as Error).message }));
    }
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(requestedPort, host, resolveListen);
  });

  const address = server.address();
  const actualPort = typeof address === "object" && address !== null ? address.port : requestedPort;
  const publicBaseUrl =
    options.publicBaseUrl ?? process.env.XYLE_BASE_URL ?? `http://${host}:${actualPort}`;

  const context: RuntimeContext = { root, publicBaseUrl, publisher, auth };
  handler = createXyleHandler(context);

  return { server, url: publicBaseUrl };
}
