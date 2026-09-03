import { digestBytes } from "./digest.ts";
import { patchHtml, preparePreview } from "./html.ts";
import type { PageChange } from "./types.ts";

export interface BrowserDemoConfig {
  initialPage: string;
  pages: Record<string, string>;
  publicBaseUrl: string;
}

export interface BrowserDemoTransport {
  request(path: string, init?: RequestInit): Promise<Response>;
}

interface PublishMetadata {
  baseSnapshotDigest: string;
  pages: PageChange[];
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Browser demo request failed";
}

function isPublishMetadata(value: unknown): value is PublishMetadata {
  if (!value || typeof value !== "object") return false;
  const metadata = value as Partial<PublishMetadata>;
  return typeof metadata.baseSnapshotDigest === "string" && Array.isArray(metadata.pages);
}

async function dataUrl(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:${file.type || "application/octet-stream"};base64,${btoa(binary)}`;
}

export function createBrowserDemoTransport(config: BrowserDemoConfig): BrowserDemoTransport {
  const sources = new Map<string, string>();

  const sourceFor = async (pagePath: string): Promise<string> => {
    const existing = sources.get(pagePath);
    if (existing !== undefined) return existing;
    const sourceUrl = config.pages[pagePath];
    if (!sourceUrl) throw new Error(`Demo page is unavailable: ${pagePath}`);
    const response = await fetch(sourceUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`Demo page could not load: ${pagePath}`);
    const source = await response.text();
    sources.set(pagePath, source);
    return source;
  };

  const snapshotDigest = async (): Promise<string> => {
    const parts: string[] = [];
    for (const pagePath of Object.keys(config.pages).sort()) {
      parts.push(pagePath, "\0", await sourceFor(pagePath), "\n");
    }
    return digestBytes(encoder.encode(parts.join("")));
  };

  const pageResponse = async (pagePath: string): Promise<Response> => {
    if (!config.pages[pagePath]) return json({ error: "not an editable demo page" }, 404);
    const source = await sourceFor(pagePath);
    const baseDigest = await digestBytes(encoder.encode(source));
    const prepared = preparePreview(source, pagePath, config.publicBaseUrl);
    return json({
      pagePath,
      baseDigest,
      html: prepared.html,
      nodes: [...prepared.nodes.values()],
      groups: prepared.groups,
      layouts: prepared.layouts,
    });
  };

  const publishResponse = async (init?: RequestInit): Promise<Response> => {
    if (!(init?.body instanceof FormData)) return json({ error: "invalid demo publication" }, 400);
    const rawMetadata = init.body.get("metadata");
    if (typeof rawMetadata !== "string")
      return json({ error: "missing publication metadata" }, 400);
    let metadata: unknown;
    try {
      metadata = JSON.parse(rawMetadata);
    } catch {
      return json({ error: "invalid publication metadata" }, 400);
    }
    if (!isPublishMetadata(metadata)) return json({ error: "invalid publication metadata" }, 400);
    if (metadata.baseSnapshotDigest !== (await snapshotDigest())) {
      return json({ error: "demo snapshot changed" }, 409);
    }

    const nextSources = new Map(sources);
    try {
      for (const change of metadata.pages) {
        if (!config.pages[change.pagePath])
          throw new Error(`Demo page is unavailable: ${change.pagePath}`);
        const source = await sourceFor(change.pagePath);
        let nextSource = decoder.decode(await patchHtml(encoder.encode(source), change));
        for (const [name, value] of init.body.entries()) {
          if (name === "metadata" || !(value instanceof File)) continue;
          nextSource = nextSource.replaceAll(name, await dataUrl(value));
        }
        nextSources.set(change.pagePath, nextSource);
      }
    } catch (error) {
      return json({ error: errorMessage(error) }, 422);
    }

    sources.clear();
    for (const [pagePath, source] of nextSources) sources.set(pagePath, source);
    return json({ snapshotDigest: await snapshotDigest() });
  };

  return {
    async request(path, init) {
      const url = new URL(path, config.publicBaseUrl);
      if (url.pathname === "/__xyle/api/session") return json({ authenticated: true });
      if (url.pathname === "/__xyle/api/manifest") {
        return json({ snapshotDigest: await snapshotDigest() });
      }
      if (url.pathname === "/__xyle/api/page") {
        return pageResponse(url.searchParams.get("path") ?? config.initialPage);
      }
      if (url.pathname === "/__xyle/api/media") return json({ available: false });
      if (url.pathname === "/__xyle/api/logout") return json({ ok: true });
      if (url.pathname === "/__xyle/api/publish" && init?.method === "POST") {
        return publishResponse(init);
      }
      return json({ error: "unknown browser demo request" }, 404);
    },
  };
}
