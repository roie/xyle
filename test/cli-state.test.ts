import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildAuthConfig,
  loadOrCreateSecrets,
  main,
  readOrCreateState,
  updateState,
} from "../src/cli.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "xyle-state-"));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

describe("Cloudflare CLI validation", () => {
  it("rejects an unsafe project name before creating local state", async () => {
    await expect(
      main(["cloudflare", root, "--project=Unsafe_Name", "--account-id=account"]),
    ).rejects.toThrow(/requires --project/);
    expect(await readdir(root)).toEqual([]);
  });

  it("requires account credentials before creating local state", async () => {
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "");
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "");
    await expect(main(["cloudflare", root, "--project=owner-site"])).rejects.toThrow(
      /requires --account-id and CLOUDFLARE_API_TOKEN/,
    );
    expect(await readdir(root)).toEqual([]);
  });
});

describe("local Xyle secrets", () => {
  it("creates one valid secret file without rotating it", async () => {
    const first = await loadOrCreateSecrets(root);
    const second = await loadOrCreateSecrets(root);
    await rm(join(root, ".gitignore"));
    const third = await loadOrCreateSecrets(root);

    expect(first.freshKey).toBe(first.secrets.editorKey);
    expect(second).toEqual({ secrets: first.secrets, freshKey: null });
    expect(third).toEqual({ secrets: first.secrets, freshKey: null });
    expect(Buffer.from(first.secrets.editorKey, "base64url")).toHaveLength(32);
    expect(Buffer.from(first.secrets.sessionSecretB64, "base64")).toHaveLength(32);
    expect((await stat(join(root, ".xyle", "secrets.local.json"))).mode & 0o777).toBe(0o600);
    expect((await readFile(join(root, ".gitignore"), "utf8")).split(/\r?\n/)).toContain(".xyle/");
  });

  it("does not create secrets when the ignore file cannot be updated", async () => {
    const gitignorePath = join(root, ".gitignore");
    const secretsPath = join(root, ".xyle", "secrets.local.json");
    await mkdir(gitignorePath);

    await expect(loadOrCreateSecrets(root)).rejects.toThrow();
    await expect(readFile(secretsPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });

    await rm(gitignorePath, { recursive: true });
    const retry = await loadOrCreateSecrets(root);
    expect(retry.freshKey).toBe(retry.secrets.editorKey);
  });

  it("fails closed and preserves malformed secrets", async () => {
    const secretsDir = join(root, ".xyle");
    const secretsPath = join(secretsDir, "secrets.local.json");
    await mkdir(secretsDir);
    const malformed = "{not valid JSON";
    await writeFile(secretsPath, malformed);

    await expect(loadOrCreateSecrets(root)).rejects.toThrow(/Invalid Xyle secrets file/);
    expect(await readFile(secretsPath, "utf8")).toBe(malformed);
  });

  it("rejects invalid existing keys and session secrets without replacing them", async () => {
    const secretsDir = join(root, ".xyle");
    const secretsPath = join(secretsDir, "secrets.local.json");
    await mkdir(secretsDir);
    const invalidValues = [
      { editorKey: "short", sessionSecretB64: Buffer.alloc(32).toString("base64") },
      { editorKey: Buffer.alloc(32).toString("base64url"), sessionSecretB64: "short" },
    ];

    for (const invalid of invalidValues) {
      const contents = JSON.stringify(invalid);
      await writeFile(secretsPath, contents);
      await expect(loadOrCreateSecrets(root)).rejects.toThrow(/Invalid Xyle secrets file/);
      expect(await readFile(secretsPath, "utf8")).toBe(contents);
    }
  });

  it("does not replace a secrets path that cannot be read as a file", async () => {
    const secretsPath = join(root, ".xyle", "secrets.local.json");
    await mkdir(secretsPath, { recursive: true });

    await expect(loadOrCreateSecrets(root)).rejects.toThrow();
    expect((await stat(secretsPath)).isDirectory()).toBe(true);
  });

  it("creates one complete secret file under concurrent initialization", async () => {
    const results = await Promise.all([
      loadOrCreateSecrets(root),
      loadOrCreateSecrets(root),
      loadOrCreateSecrets(root),
    ]);

    expect(results.filter((result) => result.freshKey !== null)).toHaveLength(1);
    expect(results[1]!.secrets).toEqual(results[0]!.secrets);
    expect(results[2]!.secrets).toEqual(results[0]!.secrets);
    expect(
      (await readdir(join(root, ".xyle"))).filter((name) => name.includes(".xyle-tmp-")),
    ).toEqual([]);
  });

  it("validates secrets again when building authentication config", async () => {
    await expect(
      buildAuthConfig({ editorKey: "invalid", sessionSecretB64: "invalid" }),
    ).rejects.toThrow(/editorKey must contain 32 to 256 non-whitespace characters/);
  });
});

describe("local Xyle state", () => {
  it("creates a complete state file only when it is absent", async () => {
    const state = await readOrCreateState(root);

    expect(state).toEqual({
      directory: ".",
      publisher: "filesystem",
      lastManagedSnapshotDigest: null,
      editorPath: "/edit",
      ignorePaths: [],
      ignoreSelectors: [],
    });
    expect(JSON.parse(await readFile(join(root, ".xyle.json"), "utf8"))).toEqual(state);
  });

  it("fails closed and preserves malformed state", async () => {
    const statePath = join(root, ".xyle.json");
    const malformed = "{not valid JSON";
    await writeFile(statePath, malformed);

    await expect(readOrCreateState(root)).rejects.toThrow(/Invalid Xyle state file/);
    expect(await readFile(statePath, "utf8")).toBe(malformed);
  });

  it("rejects an incomplete state without replacing it", async () => {
    const statePath = join(root, ".xyle.json");
    const incomplete = JSON.stringify({ directory: ".", publisher: "filesystem" });
    await writeFile(statePath, incomplete);

    await expect(readOrCreateState(root)).rejects.toThrow(/missing or unknown fields/);
    expect(await readFile(statePath, "utf8")).toBe(incomplete);
  });

  it("does not replace a state path that cannot be read as a file", async () => {
    const statePath = join(root, ".xyle.json");
    await mkdir(statePath);

    await expect(readOrCreateState(root)).rejects.toThrow();
    expect((await readdir(root)).includes(".xyle.json")).toBe(true);
  });

  it("creates one complete state under concurrent initialization", async () => {
    const states = await Promise.all([
      readOrCreateState(root),
      readOrCreateState(root),
      readOrCreateState(root),
    ]);

    expect(states[1]).toEqual(states[0]);
    expect(states[2]).toEqual(states[0]);
    expect(JSON.parse(await readFile(join(root, ".xyle.json"), "utf8"))).toEqual(states[0]);
    expect((await readdir(root)).filter((name) => name.includes(".xyle-tmp-"))).toEqual([]);
  });

  it("updates state through an atomic replacement", async () => {
    await readOrCreateState(root);
    const digest = `sha256:${"a".repeat(64)}` as const;

    await updateState(root, { lastManagedSnapshotDigest: digest });

    expect(await readOrCreateState(root)).toMatchObject({ lastManagedSnapshotDigest: digest });
    expect((await readdir(root)).filter((name) => name.includes(".xyle-tmp-"))).toEqual([]);
  });

  it("validates state updates before replacing the file", async () => {
    const original = await readOrCreateState(root);

    await expect(updateState(root, { editorPath: "relative" })).rejects.toThrow(
      /editorPath must be an absolute site path/,
    );
    expect(JSON.parse(await readFile(join(root, ".xyle.json"), "utf8"))).toEqual(original);
  });
});
