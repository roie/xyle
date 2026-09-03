import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(repository, "website");
const host = "127.0.0.1";
const portArgument = process.argv.find((argument) => argument.startsWith("--port="));
const port = Number(portArgument?.slice("--port=".length) ?? process.env.PORT ?? 4174);
const demoOnly = process.argv.includes("--demo");

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("The development server requires a port from 1 to 65535.");
}

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${host}`);
    if (url.pathname === "/demo" || url.pathname === "/guide") {
      response.writeHead(302, { location: `${url.pathname}/`, "cache-control": "no-store" });
      response.end();
      return;
    }

    const requestedPath = decodeURIComponent(url.pathname);
    let path = resolve(root, `.${requestedPath}`);
    if (path !== root && !path.startsWith(`${root}${sep}`)) {
      response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
      response.end("Forbidden");
      return;
    }

    const fileStats = await stat(path);
    if (fileStats.isDirectory()) path = resolve(path, "index.html");
    const resolvedStats = fileStats.isDirectory() ? await stat(path) : fileStats;
    if (!resolvedStats.isFile()) throw new Error("Not a file");

    response.writeHead(200, {
      "content-type": contentTypes[extname(path)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    createReadStream(path).pipe(response);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

server.listen(port, host, () => {
  if (!demoOnly) process.stdout.write(`Xyle website: http://${host}:${port}/\n`);
  process.stdout.write(`Xyle browser demo: http://${host}:${port}/demo/\n`);
  process.stdout.write("No editor key is required. Refresh the page to reset the demo.\n");
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
