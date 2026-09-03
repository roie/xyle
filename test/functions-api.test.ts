import { afterEach, describe, expect, it, vi } from "vitest";
import { login } from "../functions/_auth.ts";
import { materializeHostedMediaOperations, type HostedPublishEnv } from "../functions/_publish.ts";
import { onRequest } from "../functions/__xyle/api/[[route]].ts";
import { onRequestGet } from "../functions/edit.ts";
import { computeSnapshotDigest, digestBytes } from "../src/digest.ts";

const ORIGIN = "https://site.example";
const KEY = "hosted-editor-key";
const SECRET = "hosted-session-secret-that-is-long-enough";

afterEach(() => vi.unstubAllGlobals());

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

describe("hosted media publishing", () => {
  it("materializes normalized crops through the Images binding", async () => {
    const transforms: Record<string, unknown>[] = [];
    const source = new Uint8Array([1, 2, 3]);
    const input = {
      transform(options: Record<string, unknown>) {
        transforms.push(options);
        return input;
      },
      output: async () => ({
        response: async () =>
          new Response(new Uint8Array([4, 5, 6]), { headers: { "content-type": "image/webp" } }),
      }),
    };
    const env = {
      IMAGES: {
        input(value: Uint8Array) {
          expect(value).toEqual(source);
          return input;
        },
      },
    } satisfies HostedPublishEnv;
    const operation = {
      type: "media" as const,
      nodeId: "image-1",
      value: {
        source: { kind: "existing" as const, src: "/photo.jpg?v=1" },
        alt: { present: false, value: "" },
        crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.4 },
        focus: null,
      },
    };
    const result = await materializeHostedMediaOperations(
      env,
      `${ORIGIN}/__xyle/api/publish`,
      [operation],
      new Map([["/photo.jpg", { path: "/photo.jpg", bytes: source, contentType: "image/jpeg" }]]),
      new Map(),
    );
    expect(transforms).toEqual([
      {
        trim: { top: 0.2, right: 0.4, bottom: 0.4, left: 0.1 },
        format: "webp",
        quality: 90,
        anim: false,
        metadata: "none",
      },
    ]);
    expect(result.operations[0]).toMatchObject({
      type: "media",
      value: { source: { kind: "existing" }, crop: null },
    });
    expect(result.assets[0]).toMatchObject({ contentType: "image/webp" });
  });

  it("rejects crop sources outside the current snapshot and staged uploads", async () => {
    const operation = {
      type: "media" as const,
      nodeId: "image-1",
      value: {
        source: { kind: "existing" as const, src: "https://attacker.invalid/image.jpg" },
        alt: { present: false, value: "" },
        crop: { x: 0, y: 0, width: 1, height: 1 },
        focus: null,
      },
    };

    await expect(
      materializeHostedMediaOperations(
        {},
        `${ORIGIN}/__xyle/api/publish`,
        [operation],
        new Map(),
        new Map(),
      ),
    ).rejects.toThrow(/same-origin site asset/);
  });

  it("rejects oversized crop output before buffering it", async () => {
    const input = {
      transform() {
        return input;
      },
      output: async () => ({
        response: async () =>
          new Response(new Uint8Array([1]), {
            headers: {
              "content-length": String(20 * 1024 * 1024 + 1),
              "content-type": "image/webp",
            },
          }),
      }),
    };
    const operation = {
      type: "media" as const,
      nodeId: "image-1",
      value: {
        source: { kind: "existing" as const, src: "/photo.jpg" },
        alt: { present: false, value: "" },
        crop: { x: 0, y: 0, width: 1, height: 1 },
        focus: null,
      },
    };

    await expect(
      materializeHostedMediaOperations(
        { IMAGES: { input: () => input } },
        `${ORIGIN}/__xyle/api/publish`,
        [operation],
        new Map([
          [
            "/photo.jpg",
            { path: "/photo.jpg", bytes: new Uint8Array([1]), contentType: "image/jpeg" },
          ],
        ]),
        new Map(),
      ),
    ).rejects.toThrow(/output is too large/);
  });

  it("caps aggregate crop output across one publication", async () => {
    let outputCount = 0;
    const input = {
      transform() {
        return input;
      },
      output: async () => ({
        response: async () => {
          outputCount += 1;
          return new Response(new Uint8Array([outputCount, outputCount, outputCount]), {
            headers: { "content-type": "image/webp" },
          });
        },
      }),
    };
    const operation = {
      type: "media" as const,
      nodeId: "image-1",
      value: {
        source: { kind: "existing" as const, src: "/photo.jpg" },
        alt: { present: false, value: "" },
        crop: { x: 0, y: 0, width: 0.5, height: 1 },
        focus: null,
      },
    };

    await expect(
      materializeHostedMediaOperations(
        { IMAGES: { input: () => input } },
        `${ORIGIN}/__xyle/api/publish`,
        [
          operation,
          {
            ...operation,
            nodeId: "image-2",
            value: { ...operation.value, crop: { x: 0.5, y: 0, width: 0.5, height: 1 } },
          },
        ],
        new Map([
          [
            "/photo.jpg",
            { path: "/photo.jpg", bytes: new Uint8Array([1]), contentType: "image/jpeg" },
          ],
        ]),
        new Map(),
        { remainingBytes: 5 },
      ),
    ).rejects.toThrow(/aggregate publish limit/);
    expect(outputCount).toBe(2);
  });

  it("rejects staged crops when no Images binding is configured", async () => {
    const operation = {
      type: "media" as const,
      nodeId: "image-1",
      value: {
        source: {
          kind: "staged" as const,
          assetId: "/__media/source.jpg",
          previewUrl: "blob:source",
          mime: "image/jpeg",
          width: 100,
          height: 100,
        },
        alt: { present: false, value: "" },
        crop: { x: 0, y: 0, width: 1, height: 1 },
        focus: null,
      },
    };
    await expect(
      materializeHostedMediaOperations(
        {},
        `${ORIGIN}/__xyle/api/publish`,
        [operation],
        new Map(),
        new Map([["/__media/source.jpg", new Uint8Array([1])]]),
      ),
    ).rejects.toThrow(/Images binding/);
  });
});

describe("hosted publish boundaries", () => {
  it("holds the overlap guard through snapshot preparation and deployment", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input instanceof Request ? input.url : input);
        if (url.endsWith("/upload-token")) {
          return Response.json({ result: { jwt: "upload-token" } });
        }
        if (url.endsWith("/check-missing")) return Response.json({ result: [] });
        if (url.endsWith("/upsert-hashes")) return Response.json({ result: null });
        if (url.endsWith("/deployments")) {
          return Response.json({ result: { id: "deployment-id" } });
        }
        return new Response(null, { status: 404 });
      }),
    );
    const htmlBytes = new TextEncoder().encode('<img src="/photo.jpg" alt="Photo">');
    const imageBytes = new Uint8Array([1, 2, 3]);
    const files = {
      "/index.html": {
        digest: await digestBytes(htmlBytes),
        size: htmlBytes.byteLength,
        contentType: "text/html",
      },
      "/photo.jpg": {
        digest: await digestBytes(imageBytes),
        size: imageBytes.byteLength,
        contentType: "image/jpeg",
      },
    };
    const manifest = {
      version: 1 as const,
      snapshotDigest: await computeSnapshotDigest(files),
      files,
    };
    const cropStarted = Promise.withResolvers<void>();
    const releaseCrop = Promise.withResolvers<void>();
    const imageInput = {
      transform() {
        return imageInput;
      },
      output: async () => {
        cropStarted.resolve();
        await releaseCrop.promise;
        return {
          response: async () =>
            new Response(new Uint8Array([4, 5, 6]), {
              headers: { "content-type": "image/webp" },
            }),
        };
      },
    };
    const authEnv = await hostedEnv();
    const env = {
      ...authEnv,
      CLOUDFLARE_ACCOUNT_ID: "account",
      CLOUDFLARE_API_TOKEN: "token",
      CLOUDFLARE_PROJECT: "site",
      XYLE_WORKER_BUNDLE_B64: "AA==",
      IMAGES: { input: () => imageInput },
      ASSETS: {
        fetch: async (assetRequest: Request) => {
          const path = new URL(assetRequest.url).pathname;
          if (path === "/_xyle/manifest.json") return Response.json(manifest);
          if (path === "/index.html") {
            return new Response(Uint8Array.from(htmlBytes).buffer, {
              headers: { "content-type": "text/html" },
            });
          }
          if (path === "/photo.jpg") {
            return new Response(Uint8Array.from(imageBytes).buffer, {
              headers: { "content-type": "image/jpeg" },
            });
          }
          return new Response(null, { status: 404 });
        },
      },
    };
    const token = await login(KEY, env);
    const publishRequest = () => {
      const form = new FormData();
      form.set(
        "metadata",
        JSON.stringify({
          baseSnapshotDigest: manifest.snapshotDigest,
          pages: [
            {
              pagePath: "/index.html",
              baseDigest: files["/index.html"].digest,
              operations: [
                {
                  type: "media",
                  nodeId: "n1",
                  value: {
                    source: { kind: "existing", src: "/photo.jpg" },
                    alt: { present: true, value: "Photo" },
                    crop: { x: 0, y: 0, width: 1, height: 1 },
                    focus: null,
                  },
                },
              ],
            },
          ],
        }),
      );
      return new Request(`${ORIGIN}/__xyle/api/publish`, {
        method: "POST",
        headers: {
          origin: ORIGIN,
          cookie: `xyle_session=${token}`,
          "x-xyle-request": "1",
        },
        body: form,
      });
    };
    const first = onRequest({ request: publishRequest(), env, params: { route: ["publish"] } });
    await cropStarted.promise;

    const overlapping = await onRequest({
      request: publishRequest(),
      env,
      params: { route: ["publish"] },
    });

    expect(overlapping.status).toBe(409);
    expect(await overlapping.json()).toMatchObject({ error: "publish-in-progress" });
    releaseCrop.resolve();
    const completed = await first;
    expect(completed.status, await completed.clone().text()).toBe(200);
  });

  it("rejects an oversized streamed body without Content-Length", async () => {
    const env = await hostedEnv();
    const token = await login(KEY, env);
    expect(token).toBeTruthy();
    const request = new Request(`${ORIGIN}/__xyle/api/publish`, {
      method: "POST",
      headers: {
        origin: ORIGIN,
        cookie: `xyle_session=${token}`,
        "content-type": "multipart/form-data; boundary=xyle",
        "x-xyle-request": "1",
      },
      body: new Uint8Array(21 * 1024 * 1024 + 1).buffer,
    });
    expect(request.headers.get("content-length")).toBeNull();

    const response = await onRequest({
      request,
      env,
      params: { route: ["publish"] },
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "request too large" });
  });
});

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
