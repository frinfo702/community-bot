import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "dist");
const port = Number(process.env.PORT ?? 4321);

const types = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".woff2", "font/woff2"],
  [".txt", "text/plain; charset=utf-8"],
]);

async function resolve(urlPath) {
  const clean = decodeURIComponent(urlPath.split("?")[0]);
  let file = path.join(root, path.normalize(clean));
  if (!file.startsWith(root)) return null;
  try {
    const info = await stat(file);
    if (info.isDirectory()) file = path.join(file, "index.html");
    else return file;
  } catch {
    if (clean.endsWith("/")) return null;
    try {
      file = path.join(root, `${clean}.html`);
      await stat(file);
    } catch {
      return null;
    }
  }
  try {
    const info = await stat(file);
    return info.isFile() ? file : null;
  } catch {
    return null;
  }
}

createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  let file = await resolve(url.pathname);
  if (!file && !url.pathname.endsWith("/") && !path.extname(url.pathname)) {
    response.writeHead(308, { Location: `${url.pathname}/${url.search}` });
    response.end();
    return;
  }
  if (!file) {
    file = path.join(root, "404.html");
    response.statusCode = 404;
  }
  const type = types.get(path.extname(file)) ?? "application/octet-stream";
  response.setHeader("Content-Type", type);
  response.setHeader("Cache-Control", "no-store");
  createReadStream(file)
    .on("error", () => {
      response.statusCode = 500;
      response.end("read error");
    })
    .pipe(response);
}).listen(port, () => {
  console.log(`docs preview: http://localhost:${port}`);
});
