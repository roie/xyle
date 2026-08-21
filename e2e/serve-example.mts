// Minimal static server for Playwright runs. Serves example/plain-html only.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const ROOT = new URL("../example/plain-html/", import.meta.url).pathname;
const PORT = 4173;

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".png": "image/png",
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith("/")) pathname += "index.html";
    const clean = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
    const bytes = await readFile(join(ROOT, clean));
    res.writeHead(200, {
      "content-type": TYPES[extname(clean)] ?? "application/octet-stream",
      "content-length": bytes.length,
    });
    res.end(bytes);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`serving example on http://127.0.0.1:${PORT}`);
});
