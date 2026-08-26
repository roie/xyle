import { describe, expect, it } from "vitest";
import { login } from "../functions/_auth.ts";
import { onRequest } from "../functions/__xyle/api/[[route]].ts";
import { onRequestGet } from "../functions/edit.ts";

const ORIGIN = "https://site.example";
const KEY = "hosted-editor-key";
const SECRET = "hosted-session-secret-that-is-long-enough";

async function sha256(value: string): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return `sha256:${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function hostedEnv(): Promise<{
  XYLE_EDITOR_KEY_DIGEST: string;
  XYLE_SESSION_SECRET: string;
  ASSETS: { fetch(request: Request): Promise<Response> };
}> {
  return {
    XYLE_EDITOR_KEY_DIGEST: await sha256(KEY),
    XYLE_SESSION_SECRET: SECRET,
    ASSETS: { fetch: async () => new Response("not used", { status: 404 }) },
  };
}

async function logoutRequest(
  env: Awaited<ReturnType<typeof hostedEnv>>,
  headers: Record<string, string>,
): Promise<Response> {
  return onRequest({
    request: new Request(`${ORIGIN}/__xyle/api/logout`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: "{}",
    }),
    env,
    params: { route: ["logout"] },
  });
}

describe("hosted edit entry", () => {
  it("serves the responsive accessible sign-in experience", async () => {
    const env = await hostedEnv();
    const response = await onRequestGet({
      request: new Request(`${ORIGIN}/edit`),
      env,
    });
    const html = await response.text();
    expect(html).toContain("Open your site editor");
    expect(html).toContain("Sign in to Xyle");
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-describedby="login-description login-error"');
    expect(html).not.toContain("autofocus");
  });
});

describe("hosted logout contract", () => {
  it("rejects missing mutation proof", async () => {
    const response = await logoutRequest(await hostedEnv(), { origin: ORIGIN });
    expect(response.status).toBe(403);
  });

  it("rejects unsupported content types", async () => {
    const response = await logoutRequest(await hostedEnv(), {
      origin: ORIGIN,
      "content-type": "text/plain",
      "x-xyle-request": "1",
    });
    expect(response.status).toBe(415);
  });

  it("rejects cross-origin mutations", async () => {
    const response = await logoutRequest(await hostedEnv(), {
      origin: "https://attacker.invalid",
      "x-xyle-request": "1",
    });
    expect(response.status).toBe(403);
  });

  it("rejects unauthenticated same-origin mutations", async () => {
    const response = await logoutRequest(await hostedEnv(), {
      origin: ORIGIN,
      "x-xyle-request": "1",
    });
    expect(response.status).toBe(401);
  });

  it("clears an authenticated session", async () => {
    const env = await hostedEnv();
    const token = await login(KEY, env);
    expect(token).toBeTruthy();
    const response = await logoutRequest(env, {
      origin: ORIGIN,
      "x-xyle-request": "1",
      cookie: `xyle_session=${token}`,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
