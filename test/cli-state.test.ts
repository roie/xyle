import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readOrCreateState, updateState } from "../src/cli.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "xyle-state-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
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
