import process from "node:process";

const accountId = process.env.TRUTH_ACCOUNT_ID ?? "107780257626128497";
const handle = process.env.TRUTH_HANDLE ?? "realDonaldTrump";
const pollMs = Number(process.env.TRUTH_POLL_MS ?? 500);
const endpoint = process.env.POODLENEWS_TRUTH_WEBHOOK_URL;
const secret = process.env.TRUTH_WEBHOOK_SECRET;
const limit = Number(process.env.TRUTH_LIMIT ?? 5);
const heartbeatMs = Number(process.env.TRUTH_HEARTBEAT_MS ?? 5000);

if (!endpoint) {
  throw new Error("Missing POODLENEWS_TRUTH_WEBHOOK_URL");
}

let sinceId = process.env.TRUTH_SINCE_ID ?? "";
let inFlight = false;
let consecutiveErrors = 0;
let lastHeartbeatAt = 0;
let lastWebhookLatencyMs = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchStatuses() {
  const params = new URLSearchParams({
    exclude_replies: "true",
    limit: String(limit)
  });
  if (sinceId) params.set("since_id", sinceId);

  const url = `https://truthsocial.com/api/v1/accounts/${accountId}/statuses?${params}`;
  const response = await fetch(url, {
    headers: {
      accept: "application/json, text/plain, */*",
      "accept-language": "en-US,en;q=0.9",
      "cache-control": "no-cache",
      "user-agent": "PoodleNewsTruthWatcher/0.1"
    }
  });

  if (!response.ok) {
    throw new Error(`Truth Social returned ${response.status}`);
  }

  const statuses = await response.json();
  if (!Array.isArray(statuses)) {
    throw new Error("Truth Social returned unexpected payload");
  }
  if (statuses[0]?.id) sinceId = statuses[0].id;
  return statuses;
}

async function pushPayload(statuses, watcher) {
  if (statuses.length === 0 && Date.now() - lastHeartbeatAt < heartbeatMs && !watcher.error) return null;
  const watcherPayload = {
    ...watcher,
    webhookLatencyMs: lastWebhookLatencyMs
  };
  const startedAt = Date.now();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret ? { "x-poodlenews-secret": secret } : {})
    },
    body: JSON.stringify({
      handle,
      accountId,
      statuses,
      watcher: watcherPayload
    })
  });
  if (!response.ok) {
    throw new Error(`PoodleNews webhook returned ${response.status}: ${await response.text()}`);
  }
  lastHeartbeatAt = Date.now();
  const payload = await response.json();
  const webhookLatencyMs = Date.now() - startedAt;
  lastWebhookLatencyMs = webhookLatencyMs;
  console.log(`${new Date().toISOString()} pushed=${payload.received} fresh=${payload.fresh} truth=${watcherPayload.truthLatencyMs ?? "-"}ms webhook=${webhookLatencyMs}ms`);
  return { ...payload, webhookLatencyMs };
}

async function tick() {
  if (inFlight) return;
  inFlight = true;
  const startedAt = Date.now();
  try {
    const statuses = await fetchStatuses();
    const truthLatencyMs = Date.now() - startedAt;
    consecutiveErrors = 0;
    await pushPayload(statuses, {
      ok: true,
      pollMs,
      limit,
      sinceId,
      statusCount: statuses.length,
      truthLatencyMs,
      checkedAt: new Date().toISOString(),
      consecutiveErrors
    });
  } catch (error) {
    consecutiveErrors += 1;
    console.error(`${new Date().toISOString()} ${error.message}`);
    try {
      await pushPayload([], {
        ok: false,
        pollMs,
        limit,
        sinceId,
        statusCount: 0,
        truthLatencyMs: Date.now() - startedAt,
        checkedAt: new Date().toISOString(),
        consecutiveErrors,
        error: error.message
      });
    } catch (webhookError) {
      console.error(`${new Date().toISOString()} health webhook failed: ${webhookError.message}`);
    }
  } finally {
    inFlight = false;
    const elapsed = Date.now() - startedAt;
    const backoff = consecutiveErrors > 0 ? Math.min(15000, 1000 * consecutiveErrors) : 0;
    setTimeout(tick, Math.max(50, pollMs - elapsed) + backoff);
  }
}

console.log(`Watching Truth Social @${handle} every ${pollMs}ms`);
await sleep(50);
tick();
