import process from "node:process";

const accountId = process.env.TRUTH_ACCOUNT_ID ?? "107780257626128497";
const handle = process.env.TRUTH_HANDLE ?? "realDonaldTrump";
const pollMs = Number(process.env.TRUTH_POLL_MS ?? 500);
const endpoint = process.env.POODLENEWS_TRUTH_WEBHOOK_URL;
const secret = process.env.TRUTH_WEBHOOK_SECRET;
const limit = Number(process.env.TRUTH_LIMIT ?? 5);

if (!endpoint) {
  throw new Error("Missing POODLENEWS_TRUTH_WEBHOOK_URL");
}

let sinceId = process.env.TRUTH_SINCE_ID ?? "";
let inFlight = false;
let consecutiveErrors = 0;

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

async function pushStatuses(statuses) {
  if (statuses.length === 0) return;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret ? { "x-poodlenews-secret": secret } : {})
    },
    body: JSON.stringify({
      handle,
      accountId,
      statuses
    })
  });
  if (!response.ok) {
    throw new Error(`PoodleNews webhook returned ${response.status}: ${await response.text()}`);
  }
  const payload = await response.json();
  console.log(`${new Date().toISOString()} pushed=${payload.received} fresh=${payload.fresh}`);
}

async function tick() {
  if (inFlight) return;
  inFlight = true;
  const startedAt = Date.now();
  try {
    const statuses = await fetchStatuses();
    await pushStatuses(statuses);
    consecutiveErrors = 0;
  } catch (error) {
    consecutiveErrors += 1;
    console.error(`${new Date().toISOString()} ${error.message}`);
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
