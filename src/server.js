import http from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NewsStore } from "./store.js";
import { Ingestor } from "./ingest.js";
import { normalizeTruthStatus } from "./sources/truthSocialNormalize.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const publicDir = path.join(root, "public");
const port = Number(process.env.PORT ?? 4173);
const host = process.env.HOST ?? "127.0.0.1";
const appStartedAt = new Date();
const adminPassword = process.env.ADMIN_PASSWORD ?? "poodlenews";
const adminSessions = new Set();

const configuredSources = JSON.parse(await readFile(path.join(root, "config", "sources.json"), "utf8"));
const sources = JSON.parse(JSON.stringify(configuredSources));
const watchlist = JSON.parse(await readFile(path.join(root, "config", "watchlist.json"), "utf8"));
const runtimeSourcesPath = path.join(root, "data", "runtime-sources.json");
const store = new NewsStore();
await store.load();
await mkdir(path.dirname(runtimeSourcesPath), { recursive: true });

async function loadRuntimeSources() {
  try {
    const value = JSON.parse(await readFile(runtimeSourcesPath, "utf8"));
    return {
      whiteHouseX: value.whiteHouseX ?? [],
      headlineX: value.headlineX ?? [],
      removed: {
        whiteHouseX: value.removed?.whiteHouseX ?? [],
        headlineX: value.removed?.headlineX ?? []
      }
    };
  } catch {
    return {
      whiteHouseX: [],
      headlineX: [],
      removed: {
        whiteHouseX: [],
        headlineX: []
      }
    };
  }
}

async function saveRuntimeSources(value) {
  await writeFile(runtimeSourcesPath, JSON.stringify(value, null, 2));
}

const runtimeSources = await loadRuntimeSources();

const xListDefinitions = {
  whiteHouseX: {
    id: "whiteHouseX",
    label: "White House X",
    description: "White House-adjacent and press pool accounts.",
    idPrefix: "x",
    pollMs: 10000,
    priority: 78,
    tags: ["white-house", "x"]
  },
  headlineX: {
    id: "headlineX",
    label: "Headlines / News X",
    description: "Fast headline and market-moving news accounts.",
    idPrefix: "x-headline",
    pollMs: 10000,
    priority: 72,
    tags: ["headline-x", "x"]
  }
};

for (const listId of Object.keys(xListDefinitions)) {
  runtimeSources[listId] ??= [];
  runtimeSources.removed ??= {};
  runtimeSources.removed[listId] ??= [];
  const removedIds = new Set(runtimeSources.removed[listId]);
  sources[listId] = [
    ...(configuredSources[listId] ?? []).filter((source) => !removedIds.has(source.id)),
    ...runtimeSources[listId]
  ];
}

const eventClients = new Set();
const truthWebhookHealth = {
  configured: Boolean(process.env.TRUTH_WEBHOOK_SECRET),
  lastSeenAt: null,
  lastPayloadAt: null,
  lastFreshAt: null,
  lastWatcherErrorAt: null,
  lastWatcherError: null,
  totalPayloads: 0,
  totalStatuses: 0,
  totalFresh: 0,
  totalMedia: 0,
  lastReceived: 0,
  lastFresh: 0,
  lastMedia: 0,
  lastWatcher: null
};

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

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const index = part.indexOf("=");
      if (index === -1) return [part, ""];
      return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
    }));
}

function passwordMatches(value) {
  const left = createHash("sha256").update(String(value ?? "")).digest();
  const right = createHash("sha256").update(adminPassword).digest();
  return left.equals(right);
}

function cookieOptions(req, { maxAge, clear = false } = {}) {
  const secure = req.headers["x-forwarded-proto"] === "https";
  return [
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : "",
    maxAge != null ? `Max-Age=${maxAge}` : "",
    clear ? "Expires=Thu, 01 Jan 1970 00:00:00 GMT" : ""
  ].filter(Boolean).join("; ");
}

function setAdminSession(req, res) {
  const token = randomUUID();
  adminSessions.add(token);
  res.setHeader("set-cookie", `poodlenews_admin=${encodeURIComponent(token)}; ${cookieOptions(req, { maxAge: 60 * 60 * 12 })}`);
}

function clearAdminSession(req, res) {
  const token = parseCookies(req).poodlenews_admin;
  if (token) adminSessions.delete(token);
  res.setHeader("set-cookie", `poodlenews_admin=; ${cookieOptions(req, { maxAge: 0, clear: true })}`);
}

function hasAdminSession(req) {
  const token = parseCookies(req).poodlenews_admin;
  return Boolean(token && adminSessions.has(token));
}

function requireAdmin(req, res) {
  if (hasAdminSession(req)) return true;
  res.writeHead(401, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error: "Settings password required" }));
  return false;
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

function xSourceForList(listId, handle, { runtime = true } = {}) {
  const definition = xListDefinitions[listId];
  if (!definition) return null;
  const username = normalizeHandle(handle);
  const slug = username.toLowerCase().replace(/[^a-z0-9_]/g, "");
  return {
    id: `${definition.idPrefix}-${slug}`,
    type: "x-user",
    label: username,
    username,
    pollMs: definition.pollMs,
    priority: definition.priority,
    tags: runtime ? [...definition.tags, "runtime"] : definition.tags
  };
}

function whiteHouseSource(handle) {
  return xSourceForList("whiteHouseX", handle);
}

function configuredSourceForList(listId, sourceId) {
  return (configuredSources[listId] ?? []).find((source) => source.id === sourceId) ?? null;
}

function removeRuntimeSource(listId, sourceId) {
  const before = runtimeSources[listId]?.length ?? 0;
  runtimeSources[listId] = (runtimeSources[listId] ?? []).filter((item) => item.id !== sourceId);
  return (runtimeSources[listId]?.length ?? 0) !== before;
}

function xListPayload() {
  const statusRows = ingestor.getStatus();
  return Object.values(xListDefinitions).map((definition) => {
    const rows = statusRows
      .filter((entry) => sources[definition.id]?.some((source) => source.id === entry.source.id))
      .map((entry) => ({
        ...entry,
        removable: true
      }));

    return {
      id: definition.id,
      label: definition.label,
      description: definition.description,
      accounts: rows
    };
  });
}

const truthWebhookSource = {
  id: "trump-truth-direct",
  label: "Trump Truth Social",
  handle: "realDonaldTrump",
  priority: 100,
  tags: ["critical", "truth-social"]
};

async function receiveTruthWebhook(req, res) {
  const configuredSecret = process.env.TRUTH_WEBHOOK_SECRET;
  const providedSecret = req.headers["x-poodlenews-secret"];
  if (configuredSecret && providedSecret !== configuredSecret) {
    res.writeHead(401);
    res.end("Unauthorized");
    return;
  }
  if (!configuredSecret && process.env.NODE_ENV === "production") {
    res.writeHead(503);
    res.end("TRUTH_WEBHOOK_SECRET is not configured");
    return;
  }

  const body = await readJsonBody(req);
  const statuses = Array.isArray(body) ? body : body.statuses ?? body.items ?? [];
  const source = {
    ...truthWebhookSource,
    handle: body.handle ?? truthWebhookSource.handle,
    accountId: body.accountId
  };
  const items = statuses.map((status) => normalizeTruthStatus(source, status));
  const fresh = store.addMany(items);
  const mediaCount = items.reduce((count, item) => count + (item.media?.length ?? 0), 0);
  const now = new Date().toISOString();
  truthWebhookHealth.configured = Boolean(configuredSecret);
  truthWebhookHealth.lastSeenAt = now;
  truthWebhookHealth.lastPayloadAt = statuses.length > 0 ? now : truthWebhookHealth.lastPayloadAt;
  truthWebhookHealth.lastFreshAt = fresh.length > 0 ? now : truthWebhookHealth.lastFreshAt;
  truthWebhookHealth.totalPayloads += 1;
  truthWebhookHealth.totalStatuses += items.length;
  truthWebhookHealth.totalFresh += fresh.length;
  truthWebhookHealth.totalMedia += mediaCount;
  truthWebhookHealth.lastReceived = items.length;
  truthWebhookHealth.lastFresh = fresh.length;
  truthWebhookHealth.lastMedia = mediaCount;
  truthWebhookHealth.lastWatcher = body.watcher ?? null;
  if (body.watcher?.error) {
    truthWebhookHealth.lastWatcherErrorAt = now;
    truthWebhookHealth.lastWatcherError = body.watcher.error;
  } else if (body.watcher) {
    truthWebhookHealth.lastWatcherError = null;
  }
  if (fresh.length > 0) {
    await store.persist();
    sendEvent("items", {
      at: now,
      sourceId: source.id,
      items: fresh
    });
  }
  sendJson(res, { received: items.length, fresh: fresh.length });
}

function truthHealth() {
  const sourceStatus = ingestor.getStatus().find((entry) => entry.source.id === "trump-truth-direct") ?? null;
  const pollMs = truthWebhookHealth.lastWatcher?.pollMs
    ?? sourceStatus?.source?.pollMs
    ?? sourceStatus?.pollMs
    ?? 500;
  const truthLatencyMs = truthWebhookHealth.lastWatcher?.truthLatencyMs ?? null;
  const webhookLatencyMs = truthWebhookHealth.lastWatcher?.webhookLatencyMs ?? null;
  const expectedPushMs = {
    optimistic: Math.max(50, Math.round((pollMs / 2) + (truthLatencyMs ?? 0) + (webhookLatencyMs ?? 0))),
    worstTypical: Math.max(50, Math.round(pollMs + (truthLatencyMs ?? 0) + (webhookLatencyMs ?? 0)))
  };

  return {
    now: new Date().toISOString(),
    app: {
      startedAt: appStartedAt.toISOString(),
      uptimeMs: Date.now() - appStartedAt.getTime(),
      eventClients: eventClients.size
    },
    source: sourceStatus,
    webhook: truthWebhookHealth,
    expectedPushMs,
    notes: [
      "Render direct polling is a fallback and may be Cloudflare-blocked.",
      "The dedicated watcher reports health only after it is running with the webhook URL and shared secret.",
      "Expected push time is poll wait plus Truth response time plus webhook/SSE/app refresh time."
    ]
  };
}

async function serveStatic(req, res) {
  const requested = new URL(req.url, `http://${req.headers.host}`);
  const routeMap = {
    "/": "/index.html",
    "/admin": "/admin.html",
    "/app": "/app.js",
    "/admin.js": "/admin.js",
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
        type: url.searchParams.get("type"),
        tag: url.searchParams.get("tag"),
        limit: url.searchParams.get("limit") ?? 150
      })
    });
    return;
  }

  if (url.pathname === "/api/sources") {
    sendJson(res, { sources: ingestor.getStatus() });
    return;
  }

  if (url.pathname === "/api/truth-health") {
    sendJson(res, truthHealth());
    return;
  }

  if (url.pathname === "/api/admin-session" && req.method === "GET") {
    sendJson(res, { authenticated: hasAdminSession(req) });
    return;
  }

  if (url.pathname === "/api/admin-login" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      if (!passwordMatches(body.password)) {
        res.writeHead(401, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Incorrect password" }));
        return;
      }
      setAdminSession(req, res);
      sendJson(res, { ok: true });
    } catch (error) {
      res.writeHead(400);
      res.end(error.message);
    }
    return;
  }

  if (url.pathname === "/api/admin-logout" && req.method === "POST") {
    clearAdminSession(req, res);
    sendJson(res, { ok: true });
    return;
  }

  if (url.pathname === "/api/webhooks/truth-social" && req.method === "POST") {
    try {
      await receiveTruthWebhook(req, res);
    } catch (error) {
      res.writeHead(400);
      res.end(error.message);
    }
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
    if (!requireAdmin(req, res)) return;
    sendJson(res, {
      accounts: ingestor.getStatus()
        .map((entry) => entry.source)
        .filter((source) => source.tags?.includes("white-house"))
    });
    return;
  }

  if (url.pathname === "/api/x-lists" && req.method === "GET") {
    if (!requireAdmin(req, res)) return;
    sendJson(res, { lists: xListPayload() });
    return;
  }

  const xListMatch = url.pathname.match(/^\/api\/x-lists\/([^/]+)(?:\/([^/]+))?$/);
  if (xListMatch && req.method === "POST") {
    if (!requireAdmin(req, res)) return;
    try {
      const listId = decodeURIComponent(xListMatch[1]);
      const body = await readJsonBody(req);
      const source = xSourceForList(listId, body.handle ?? "");
      if (!source) {
        res.writeHead(404);
        res.end("Unknown X list");
        return;
      }
      if (!source.username) {
        res.writeHead(400);
        res.end("Missing handle");
        return;
      }
      runtimeSources[listId] ??= [];
      runtimeSources.removed ??= {};
      runtimeSources.removed[listId] ??= [];
      sources[listId] ??= [];
      const exists = sources[listId].some((item) => item.id === source.id);
      if (!exists) {
        const configuredSource = configuredSourceForList(listId, source.id);
        if (configuredSource) {
          runtimeSources.removed[listId] = runtimeSources.removed[listId].filter((id) => id !== source.id);
          sources[listId].push(configuredSource);
          ingestor.addSource(configuredSource);
        } else {
          runtimeSources[listId].push(source);
          sources[listId].push(source);
          ingestor.addSource(source);
        }
        await saveRuntimeSources(runtimeSources);
      }
      sendJson(res, { account: source });
    } catch (error) {
      res.writeHead(400);
      res.end(error.message);
    }
    return;
  }

  if (xListMatch && req.method === "DELETE") {
    if (!requireAdmin(req, res)) return;
    const listId = decodeURIComponent(xListMatch[1]);
    const handle = decodeURIComponent(xListMatch[2] ?? "");
    const source = xSourceForList(listId, handle);
    if (!source) {
      res.writeHead(404);
      res.end("Unknown X list");
      return;
    }
    runtimeSources.removed ??= {};
    runtimeSources.removed[listId] ??= [];

    const removedRuntime = removeRuntimeSource(listId, source.id);
    if (!removedRuntime && configuredSourceForList(listId, source.id)) {
      runtimeSources.removed[listId] = [...new Set([...runtimeSources.removed[listId], source.id])];
    }
    sources[listId] = (sources[listId] ?? []).filter((item) => item.id !== source.id);
    ingestor.removeSource(source.id);
    await saveRuntimeSources(runtimeSources);
    sendJson(res, { ok: true });
    return;
  }

  if (url.pathname === "/api/white-house-x" && req.method === "POST") {
    if (!requireAdmin(req, res)) return;
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
    if (!requireAdmin(req, res)) return;
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
