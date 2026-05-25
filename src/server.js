import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NewsStore } from "./store.js";
import { Ingestor } from "./ingest.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const publicDir = path.join(root, "public");
const port = Number(process.env.PORT ?? 4173);
const host = process.env.HOST ?? "127.0.0.1";

const sources = JSON.parse(await readFile(path.join(root, "config", "sources.json"), "utf8"));
const watchlist = JSON.parse(await readFile(path.join(root, "config", "watchlist.json"), "utf8"));
const store = new NewsStore();
await store.load();

const ingestor = new Ingestor({ store, sources });
ingestor.start();

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function sendJson(res, value) {
  res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}

async function serveStatic(req, res) {
  const requested = new URL(req.url, `http://${req.headers.host}`);
  const routeMap = {
    "/": "/index.html",
    "/app": "/app.js",
    "/styles": "/styles.css"
  };
  const pathname = routeMap[requested.pathname] ?? requested.pathname;
  const filePath = path.normalize(path.join(publicDir, pathname));
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const body = await readFile(filePath);
    res.writeHead(200, { "content-type": contentTypes[path.extname(filePath)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/api/items") {
    sendJson(res, {
      now: new Date().toISOString(),
      items: store.list({
        q: url.searchParams.get("q"),
        source: url.searchParams.get("source"),
        limit: url.searchParams.get("limit") ?? 150
      })
    });
    return;
  }

  if (url.pathname === "/api/sources") {
    sendJson(res, { sources: ingestor.getStatus() });
    return;
  }

  if (url.pathname === "/api/watchlist") {
    sendJson(res, watchlist);
    return;
  }

  await serveStatic(req, res);
});

server.listen(port, host, () => {
  console.log(`News Aggregator running at http://${host}:${port}`);
});
