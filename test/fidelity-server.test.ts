import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  loadOrCreateSecrets,
  readOrCreateState,
  startXyleDevServer,
  updateState,
} from "../src/cli.ts";

const IMAGE_FIXTURE = new URL("fixtures/exif-orientation-6.jpg", import.meta.url).pathname;

let root: string;
let server: Server | undefined;
let base: string;
let editorKey: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "xyle-fidelity-"));
  await writeFile(
    join(root, "index.html"),
    [
      "<!doctype html><html><head><title>Test</title></head><body>",
      '<section class="generated" data-xyle-layout="split"><div>A</div><div>B</div></section>',
      '<img src="/source.jpg?v=2" alt="Source">',
      "</body></html>",
    ].join(""),
  );
  await copyFile(IMAGE_FIXTURE, join(root, "source.jpg"));
  const { secrets } = await loadOrCreateSecrets(root);
  editorKey = secrets.editorKey;
  await readOrCreateState(root);
  await updateState(root, { ignoreSelectors: [".generated"] });
  const started = await startXyleDevServer({ directory: root, port: 0 });
  server = started.server;
  base = started.url;
}, 30_000);

afterAll(async () => {
  server?.close();
  await rm(root, { recursive: true, force: true });
});

async function login(): Promise<string> {
  const response = await fetch(`${base}/__xyle/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key: editorKey }),
  });
  expect(response.status).toBe(200);
  return response.headers.get("set-cookie")!.split(";")[0]!;
}

describe("publication fidelity boundaries", () => {
  it("crops cache-busted local images and ignores excluded Layout metadata", async () => {
    const cookie = await login();
    const pageResponse = await fetch(`${base}/__xyle/api/page?path=/index.html`, {
      headers: { cookie },
    });
    expect(pageResponse.status).toBe(200);
    const page = (await pageResponse.json()) as {
      baseDigest: string;
      nodes: Array<{ id: string; kind: string }>;
    };
    const image = page.nodes.find((node) => node.kind === "image");
    expect(image).toBeTruthy();
    const manifestResponse = await fetch(`${base}/__xyle/api/manifest`, {
      headers: { cookie },
    });
    const manifest = (await manifestResponse.json()) as { snapshotDigest: string };
    const form = new FormData();
    form.set(
      "metadata",
      JSON.stringify({
        baseSnapshotDigest: manifest.snapshotDigest,
        pages: [
          {
            pagePath: "/index.html",
            baseDigest: page.baseDigest,
            operations: [
              {
                type: "media",
                nodeId: image!.id,
                value: {
                  source: { kind: "existing", src: "/source.jpg?v=2" },
                  alt: { present: true, value: "Source" },
                  crop: { x: 0, y: 0, width: 0.5, height: 0.5 },
                  focus: null,
                },
              },
            ],
          },
        ],
      }),
    );

    const publishResponse = await fetch(`${base}/__xyle/api/publish`, {
      method: "POST",
      headers: {
        cookie,
        origin: new URL(base).origin,
        "x-xyle-request": "1",
      },
      body: form,
    });

    const publishBody = await publishResponse.clone().text();
    expect(publishResponse.status, publishBody).toBe(200);
    const published = await readFile(join(root, "index.html"), "utf8");
    expect(published).toMatch(/src="\/__media\/[a-f0-9]+\.webp"/);
    expect(published).not.toContain("data-xyle-resource");
    await expect(readFile(join(root, "__xyle", "manifest.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
