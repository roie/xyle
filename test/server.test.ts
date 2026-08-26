import { cp, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadOrCreateSecrets, readOrCreateState, startXyleDevServer } from "../src/cli.ts";
import type { Server } from "node:http";

const EXAMPLE = new URL("../example/plain-html/", import.meta.url).pathname;

let root: string;
let server: Server | undefined;
let base: string;
let editorKey: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "xyle-server-"));
  await cp(EXAMPLE, root, { recursive: true });
  const { secrets } = await loadOrCreateSecrets(root);
  editorKey = secrets.editorKey;
  await readOrCreateState(root);
  const started = await startXyleDevServer({ directory: root, port: 0 });
  server = started.server;
  base = started.url;
}, 30_000);

afterAll(async () => {
  server?.close();
  await rm(root, { recursive: true, force: true });
});

async function login(): Promise<string> {
  const res = await fetch(`${base}/__xyle/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key: editorKey }),
  });
  expect(res.status).toBe(200);
  const setCookie = res.headers.get("set-cookie")!;
  return setCookie.split(";")[0]!;
}

describe("static serving", () => {
  it("serves the public site with no Xyle runtime injected", async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Plumbing you can depend on");
    expect(html).not.toContain("xyle");
    expect(html).not.toContain("/__xyle/");
  });

  it("serves other pages and assets", async () => {
    expect((await fetch(`${base}/about.html`)).status).toBe(200);
    const css = await fetch(`${base}/styles.css`);
    expect(css.headers.get("content-type")).toContain("text/css");
  });

  it("rejects traversal", async () => {
    const res = await fetch(`${base}/../package.json`);
    expect([403, 404]).toContain(res.status);
  });

  it("404s unknown files", async () => {
    expect((await fetch(`${base}/nope.html`)).status).toBe(404);
  });

  it("does not follow a symlink outside the site root", async () => {
    const secret = join(tmpdir(), `xyle-outside-${Date.now()}.txt`);
    await writeFile(secret, "not public");
    await symlink(secret, join(root, "outside-link.txt"));
    const response = await fetch(`${base}/outside-link.txt`);
    expect([403, 404]).toContain(response.status);
    await rm(secret, { force: true });
  });
});

describe("auth", () => {
  it("shows login shell when unauthenticated", async () => {
    const res = await fetch(`${base}/edit`);
    const html = await res.text();
    expect(html).toContain("Open your site editor");
    expect(html).toContain("Sign in to Xyle");
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-invalid="false"');
    expect(html).not.toContain("autofocus");
    expect(html).not.toContain("xyle-root");
  });

  it("rejects bad keys", async () => {
    const res = await fetch(`${base}/__xyle/api/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "wrong" }),
    });
    expect(res.status).toBe(401);
  });

  it("shows editor shell once authenticated", async () => {
    const cookie = await login();
    const res = await fetch(`${base}/edit`, { headers: { cookie } });
    const html = await res.text();
    expect(html).toContain("xyle-root");
  });

  it("logout rejects requests without the same-origin mutation contract", async () => {
    const cookie = await login();
    const wrongMethod = await fetch(`${base}/__xyle/api/logout`, { headers: { cookie } });
    expect(wrongMethod.status).toBe(403);

    const missingHeader = await fetch(`${base}/__xyle/api/logout`, {
      method: "POST",
      headers: { cookie, origin: new URL(base).origin, "content-type": "application/json" },
      body: "{}",
    });
    expect(missingHeader.status).toBe(403);

    const crossOrigin = await fetch(`${base}/__xyle/api/logout`, {
      method: "POST",
      headers: {
        cookie,
        origin: "https://attacker.invalid",
        "content-type": "application/json",
        "x-xyle-request": "1",
      },
      body: "{}",
    });
    expect(crossOrigin.status).toBe(403);
  });

  it("logout requires authentication", async () => {
    const out = await fetch(`${base}/__xyle/api/logout`, {
      method: "POST",
      headers: {
        origin: new URL(base).origin,
        "content-type": "application/json",
        "x-xyle-request": "1",
      },
      body: "{}",
    });
    expect(out.status).toBe(401);
  });

  it("authenticated same-origin logout clears the session", async () => {
    const cookie = await login();
    const out = await fetch(`${base}/__xyle/api/logout`, {
      method: "POST",
      headers: {
        cookie,
        origin: new URL(base).origin,
        "content-type": "application/json",
        "x-xyle-request": "1",
      },
      body: "{}",
    });
    expect(out.status).toBe(200);
    const cleared = out.headers.get("set-cookie")!;
    expect(cleared).toContain("Max-Age=0");
  });
});

describe("page api", () => {
  it("requires authentication", async () => {
    const res = await fetch(`${base}/__xyle/api/page?path=/about.html`);
    expect(res.status).toBe(401);
  });

  it("maps directory page URLs to their index document", async () => {
    const cookie = await login();
    const res = await fetch(`${base}/__xyle/api/page?path=/`, { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { pagePath: string }).pagePath).toBe("/index.html");
  });

  it("returns prepared preview for manifest HTML pages", async () => {
    const cookie = await login();
    const res = await fetch(`${base}/__xyle/api/page?path=/about.html`, {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      html: string;
      nodes: { id: string; kind: string }[];
      baseDigest: string;
      pagePath: string;
    };
    expect(body.pagePath).toBe("/about.html");
    expect(body.html).toContain("data-xyle-node=");
    expect(body.html).toContain("<base href=");
    expect(body.nodes.length).toBeGreaterThan(0);
    expect(body.baseDigest).toMatch(/^sha256:/);
  });

  it("rejects traversal and non-HTML paths", async () => {
    const cookie = await login();
    for (const path of ["../../etc/passwd", "/styles.css", "/does-not-exist.html"]) {
      const res = await fetch(`${base}/__xyle/api/page?path=${encodeURIComponent(path)}`, {
        headers: { cookie },
      });
      expect([400, 404]).toContain(res.status);
    }
  });
});

describe("mutation guards", () => {
  it("rejects publish without a session", async () => {
    const res = await fetch(`${base}/__xyle/api/publish`, { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("rejects publish with wrong origin", async () => {
    const cookie = await login();
    const res = await fetch(`${base}/__xyle/api/publish`, {
      method: "POST",
      headers: {
        cookie,
        origin: "https://evil.example",
        "x-xyle-request": "1",
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(res.status).toBe(403);
  });

  it("rejects publish missing the custom header", async () => {
    const cookie = await login();
    const res = await fetch(`${base}/__xyle/api/publish`, {
      method: "POST",
      headers: {
        cookie,
        origin: base,
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(res.status).toBe(403);
  });
});

describe("reserved paths", () => {
  it("never serves manifest or local control state", async () => {
    for (const path of ["/_xyle/manifest.json", "/.xyle.json", "/.xyle/secrets.local.json"]) {
      const res = await fetch(`${base}${path}`);
      expect(res.status).toBe(404);
    }
  });
});
