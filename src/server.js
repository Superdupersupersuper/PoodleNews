import http from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
const runtimeSourcesPath = path.join(root, "data", "runtime-sources.json");
const store = new NewsStore();
await store.load();
await mkdir(path.dirname(runtimeSourcesPath), { recursive: true });

async function loadRuntimeSources() {
  try {
    return JSON.parse(await readFile(runtimeSourcesPath, "utf8"));
  } catch {
    return { whiteHouseX: [] };
  }
}

async function saveRuntimeSources(value) {
  await writeFile(runtimeSourcesPath, JSON.stringify(value, null, 2));
}

const runtimeSources = await loadRuntimeSources();
sources.whiteHouseX = [...(sources.whiteHouseX ?? []), ...(runtimeSources.whiteHouseX ?? [])];

const eventClients = new Set();

function sendEvent(event, payload) {
  const body = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of eventClients) {
    client.write(body);
  }
}

const ingestor = new Ingestor({
  store,
  sources,
  onFresh: (items, source) => sendEvent("items", {
    at: new Date().toISOString(),
    sourceId: source.id,
    items
  })
});
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

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function normalizeHandle(value = "") {
  return value.trim().replace(/^https?:\/\/(www\.)?x\.com\//i, "").replace(/^@/, "").split(/[/?#]/)[0];
}

function whiteHouseSource(handle) {
  const username = normalizeHandle(handle);
  return {
    id: `x-${username.toLowerCase().replace(/[^a-z0-9_]/g, "")}`,
    type: "x-user",
    label: username,
    username,
    pollMs: 10000,
    priority: 78,
    tags: ["white-house", "x", "runtime"]
  };
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

  if (url.pathname === "/api/events") {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive"
    });
    res.write(": connected\n\n");
    eventClients.add(res);
    const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15000);
    req.on("close", () => {
      clearInterval(heartbeat);
      eventClients.delete(res);
    });
    return;
  }

  if (url.pathname === "/api/white-house-x" && req.method === "GET") {
    sendJson(res, {
      accounts: ingestor.getStatus()
        .map((entry) => entry.source)
        .filter((source) => source.tags?.includes("white-house"))
    });
    return;
  }

  if (url.pathname === "/api/white-house-x" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      const source = whiteHouseSource(body.handle ?? "");
      if (!source.username) {
        res.writeHead(400);
        res.end("Missing handle");
        return;
      }
      runtimeSources.whiteHouseX ??= [];
      const exists = [...(sources.whiteHouseX ?? []), ...runtimeSources.whiteHouseX].some((item) => item.id === source.id);
      if (!exists) {
        runtimeSources.whiteHouseX.push(source);
        sources.whiteHouseX.push(source);
        ingestor.addSource(source);
        await saveRuntimeSources(runtimeSources);
      }
      sendJson(res, { account: source });
    } catch (error) {
      res.writeHead(400);
      res.end(error.message);
    }
    return;
  }

  if (url.pathname.startsWith("/api/white-house-x/") && req.method === "DELETE") {
    const handle = decodeURIComponent(url.pathname.split("/").pop() ?? "");
    const source = whiteHouseSource(handle);
    runtimeSources.whiteHouseX = (runtimeSources.whiteHouseX ?? []).filter((item) => item.id !== source.id);
    sources.whiteHouseX = (sources.whiteHouseX ?? []).filter((item) => item.id !== source.id);
    ingestor.removeSource(source.id);
    await saveRuntimeSources(runtimeSources);
    sendJson(res, { ok: true });
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
