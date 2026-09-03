import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureDirectUploadProject, uploadPagesSecrets } from "../src/cloudflare-setup.ts";

const options = {
  accountId: "account-id",
  apiToken: "api-token",
  projectName: "owner-site",
};

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.XYLE_TEST_SECRET_CAPTURE;
});

describe("Cloudflare owner setup", () => {
  it("keeps an existing Direct Upload project", async () => {
    const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ result: { source: null } }),
    );
    vi.stubGlobal("fetch", request);

    await expect(ensureDirectUploadProject(options)).resolves.toBe("existing");
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]?.[1]?.headers).toEqual({ authorization: "Bearer api-token" });
  });

  it("rejects a Pages project connected to Git", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ result: { source: { type: "github" } } })),
    );

    await expect(ensureDirectUploadProject(options)).rejects.toThrow(/Direct Upload project/);
  });

  it("creates a missing Direct Upload project", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(Response.json({ result: { name: "owner-site" } }));
    vi.stubGlobal("fetch", request);

    await expect(ensureDirectUploadProject(options)).resolves.toBe("created");
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]?.[1]).toMatchObject({ method: "POST" });
    expect(JSON.parse(String(request.mock.calls[1]?.[1]?.body))).toEqual({
      name: "owner-site",
      production_branch: "main",
    });
  });

  it("passes secrets through a private temporary file and removes it", async () => {
    const root = await mkdtemp(join(tmpdir(), "xyle-cloudflare-setup-"));
    const fakeWrangler = join(root, "fake-wrangler.sh");
    const capture = join(root, "captured-secrets.json");
    process.env.XYLE_TEST_SECRET_CAPTURE = capture;
    await writeFile(fakeWrangler, '#!/bin/sh\ncp "$4" "$XYLE_TEST_SECRET_CAPTURE"\n', {
      mode: 0o700,
    });
    await chmod(fakeWrangler, 0o700);

    try {
      await uploadPagesSecrets(root, {
        ...options,
        wranglerCommand: fakeWrangler,
        secrets: { XYLE_SESSION_SECRET: "never-print-this" },
      });

      expect(JSON.parse(await readFile(capture, "utf8"))).toEqual({
        XYLE_SESSION_SECRET: "never-print-this",
      });
      const remaining = await readdir(join(root, ".xyle"));
      expect(remaining).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
