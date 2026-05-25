const socialFeed = document.querySelector("#socialFeed");
const headlineFeed = document.querySelector("#headlineFeed");
const whiteHouseFeed = document.querySelector("#whiteHouseFeed");
const socialHealth = document.querySelector("#socialHealth");
const whiteHouseAccounts = document.querySelector("#whiteHouseAccounts");
const keywordsEl = document.querySelector("#keywords");
const accountForm = document.querySelector("#accountForm");
const accountInput = document.querySelector("#accountInput");
const itemTemplate = document.querySelector("#itemTemplate");
const search = document.querySelector("#search");
const itemCount = document.querySelector("#itemCount");
const lastUpdate = document.querySelector("#lastUpdate");
const socialCount = document.querySelector("#socialCount");
const headlineCount = document.querySelector("#headlineCount");
const whiteHouseCount = document.querySelector("#whiteHouseCount");
const clock = document.querySelector("#clock");
const truthHealthDialog = document.querySelector("#truthHealthDialog");
const truthHealthBody = document.querySelector("#truthHealthBody");

let items = [];
let sources = [];
let headlineKeywords = [];

const socialSourceIds = new Set(["trump-truth-direct", "trump-x"]);
let refreshInFlight = false;
let refreshAgain = false;

function isWhiteHouseSource(source) {
  return source.tags?.includes("white-house");
}

function timeAgo(value) {
  const then = new Date(value).getTime();
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function setClock() {
  clock.textContent = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date());
}

function sanitizeText(value = "") {
  const el = document.createElement("textarea");
  el.innerHTML = value;
  return el.value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function formatMs(value) {
  if (value == null || Number.isNaN(Number(value))) return "-";
  const ms = Math.round(Number(value));
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(value ?? 0);
}

function metric(label, value, hint = "") {
  return `
    <div class="metric">
      <span>${label}</span>
      <strong>${value}</strong>
      ${hint ? `<small>${hint}</small>` : ""}
    </div>
  `;
}

function renderHealth(rows) {
  socialHealth.replaceChildren();
  for (const row of rows.filter((entry) => socialSourceIds.has(entry.source.id))) {
    const el = document.createElement(row.source.id === "trump-truth-direct" ? "button" : "div");
    el.className = "health-card";
    if (row.source.id === "trump-truth-direct") {
      el.type = "button";
      el.dataset.healthSource = row.source.id;
      el.title = "Open Truth Social health dashboard";
    }
    const dotClass = row.ok === true ? "ok" : row.ok === false ? "bad" : "";
    el.innerHTML = `
      <div class="source-head">
        <strong>${row.source.label}</strong>
        <span class="dot ${dotClass}"></span>
      </div>
      <div class="item-meta">
        <span>${row.latencyMs ?? "-"}ms</span>
        <span>${row.fresh ?? 0} new</span>
        <span>${row.lastPollAt ? timeAgo(row.lastPollAt) : "pending"}</span>
      </div>
      ${row.error ? `<div class="item-meta">${row.error}</div>` : ""}
    `;
    socialHealth.append(el);
  }
}

function statusText(ok) {
  if (ok === true) return "Online";
  if (ok === false) return "Fault";
  return "Pending";
}

async function openTruthHealth() {
  truthHealthDialog.showModal();
  truthHealthBody.innerHTML = `<div class="empty">Loading Truth Social health.</div>`;
  const response = await fetch("/api/truth-health");
  const health = await response.json();
  const direct = health.source;
  const webhook = health.webhook ?? {};
  const watcher = webhook.lastWatcher ?? {};
  const directStats = direct?.stats ?? {};
  const watcherAge = webhook.lastSeenAt ? timeAgo(webhook.lastSeenAt) : "never";
  const directAge = direct?.lastPollAt ? timeAgo(direct.lastPollAt) : "pending";
  const expected = health.expectedPushMs ?? {};
  const hasWatcher = Boolean(webhook.lastSeenAt);
  const directDot = direct?.ok === true ? "ok" : direct?.ok === false ? "bad" : "";
  const watcherDot = watcher.ok === true ? "ok" : watcher.ok === false ? "bad" : hasWatcher ? "ok" : "bad";

  truthHealthBody.innerHTML = `
    <section class="dashboard-section">
      <div class="section-title">
        <span class="dot ${watcherDot}"></span>
        <div>
          <h3>Dedicated Watcher</h3>
          <p>${hasWatcher ? `Last heartbeat ${watcherAge}` : "No watcher heartbeat yet"}</p>
        </div>
      </div>
      <div class="metric-grid">
        ${metric("Configured poll", formatMs(watcher.pollMs ?? direct?.source?.pollMs ?? 500), "Truth check cadence")}
        ${metric("Truth response", formatMs(watcher.truthLatencyMs), "Last fetch duration")}
        ${metric("Webhook push", formatMs(watcher.webhookLatencyMs), "Watcher to PoodleNews")}
        ${metric("Errors", formatNumber(watcher.consecutiveErrors), "Consecutive watcher failures")}
      </div>
      <div class="wire-line">
        <span>Expected post-to-screen</span>
        <strong>${formatMs(expected.optimistic)} - ${formatMs(expected.worstTypical)}</strong>
      </div>
      ${watcher.error ? `<div class="alert-line">${sanitizeText(watcher.error)}</div>` : ""}
    </section>

    <section class="dashboard-section">
      <div class="section-title">
        <span class="dot ${directDot}"></span>
        <div>
          <h3>Render Direct Poller</h3>
          <p>${statusText(direct?.ok)} · last poll ${directAge}</p>
        </div>
      </div>
      <div class="metric-grid">
        ${metric("Poll interval", formatMs(direct?.pollMs ?? direct?.source?.pollMs), "Render fallback")}
        ${metric("Last latency", formatMs(direct?.latencyMs), "Request duration")}
        ${metric("Total polls", formatNumber(directStats.totalPolls), `${formatNumber(directStats.failedPolls)} failed`)}
        ${metric("Fresh posts", formatNumber(directStats.freshTotal), "Accepted by feed")}
      </div>
      ${direct?.error ? `<div class="alert-line">${sanitizeText(direct.error)}</div>` : ""}
    </section>

    <section class="dashboard-section">
      <div class="section-title">
        <span class="dot ${webhook.configured ? "ok" : "bad"}"></span>
        <div>
          <h3>Webhook Intake</h3>
          <p>${webhook.configured ? "Secret configured" : "Secret missing"} · ${formatNumber(webhook.totalPayloads)} payloads</p>
        </div>
      </div>
      <div class="metric-grid">
        ${metric("Statuses seen", formatNumber(webhook.totalStatuses), `${formatNumber(webhook.totalFresh)} fresh`)}
        ${metric("Media seen", formatNumber(webhook.totalMedia), "Truth attachments")}
        ${metric("Last payload", webhook.lastPayloadAt ? timeAgo(webhook.lastPayloadAt) : "none", "Had posts")}
        ${metric("Last fresh", webhook.lastFreshAt ? timeAgo(webhook.lastFreshAt) : "none", "New item accepted")}
      </div>
    </section>
  `;
}

function renderWhiteHouseAccounts(rows) {
  whiteHouseAccounts.replaceChildren();
  const whiteHouseRows = rows.filter((entry) => isWhiteHouseSource(entry.source));
  for (const row of whiteHouseRows) {
    const card = document.createElement("div");
    card.className = "account-card";
    const dotClass = row.ok === true ? "ok" : row.ok === false ? "bad" : "";
    const removable = row.source.tags?.includes("runtime");
    card.innerHTML = `
      <div>
        <div class="source-head">
          <strong>@${row.source.username}</strong>
          <span class="dot ${dotClass}"></span>
        </div>
        <div class="item-meta">
          <span>${row.latencyMs ?? "-"}ms</span>
          <span>${row.lastPollAt ? timeAgo(row.lastPollAt) : "pending"}</span>
        </div>
      </div>
      ${removable ? `<button class="remove-account" type="button" data-handle="${row.source.username}">Remove</button>` : ""}
    `;
    whiteHouseAccounts.append(card);
  }
}

function keywordMatch(item) {
  if (headlineKeywords.length === 0) return false;
  const haystack = `${item.title} ${item.summary || ""}`.toLowerCase();
  return headlineKeywords.some((keyword) => haystack.includes(keyword.toLowerCase()));
}

function renderKeywords() {
  keywordsEl.replaceChildren();
  for (const keyword of headlineKeywords) {
    const chip = document.createElement("span");
    chip.className = "keyword";
    chip.textContent = keyword;
    keywordsEl.append(chip);
  }
}

function itemMatchesSearch(item, query) {
  if (!query) return true;
  return `${item.title} ${item.summary || ""} ${item.sourceLabel}`.toLowerCase().includes(query);
}

function renderFeed(target, visible, emptyText) {
  target.replaceChildren();
  target.classList.toggle("empty-feed", visible.length === 0);
  if (visible.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = emptyText;
    target.append(empty);
    return;
  }

  for (const item of visible) {
    const node = itemTemplate.content.cloneNode(true);
    const article = node.querySelector(".item");
    article.classList.add(item.tags.includes("critical") ? "critical" : "headline");
    node.querySelector(".source").textContent = item.sourceLabel;
    node.querySelector(".age").textContent = timeAgo(item.publishedAt || item.createdAt);
    const title = node.querySelector(".title");
    title.textContent = sanitizeText(item.title);
    title.href = item.url || "#";
    const summary = node.querySelector(".summary");
    const summaryText = sanitizeText(item.summary || "");
    summary.textContent = summaryText;
    summary.hidden = !summaryText || summaryText === sanitizeText(item.title);
    const tags = node.querySelector(".tags");
    for (const tag of item.tags ?? []) {
      const pill = document.createElement("span");
      pill.className = "tag";
      pill.textContent = tag;
      tags.append(pill);
    }
    const media = node.querySelector(".media");
    for (const asset of item.media ?? []) {
      const url = asset.previewUrl || asset.url;
      if (!url) continue;
      if (asset.type === "image" || asset.type === "gifv" || asset.type === "unknown") {
        const link = document.createElement("a");
        link.href = asset.url || url;
        link.target = "_blank";
        link.rel = "noreferrer";
        const image = document.createElement("img");
        image.src = url;
        image.alt = asset.description || "Truth Social media";
        image.loading = "lazy";
        link.append(image);
        media.append(link);
      } else {
        const link = document.createElement("a");
        link.href = asset.url || url;
        link.target = "_blank";
        link.rel = "noreferrer";
        link.textContent = asset.type;
        media.append(link);
      }
    }
    media.hidden = media.childElementCount === 0;
    target.append(node);
  }
}

function renderItems() {
  const query = search.value.trim().toLowerCase();

  const socialItems = items
    .filter((item) => socialSourceIds.has(item.sourceId))
    .filter((item) => itemMatchesSearch(item, query));

  const headlineItems = items
    .filter((item) => item.type === "headline")
    .filter(keywordMatch)
    .filter((item) => itemMatchesSearch(item, query));

  const whiteHouseItems = items
    .filter((item) => item.tags?.includes("white-house"))
    .filter((item) => itemMatchesSearch(item, query));

  renderFeed(socialFeed, socialItems, "Waiting for Trump Truth Social / X posts.");
  renderFeed(headlineFeed, headlineItems, "No watched headlines yet.");
  renderFeed(whiteHouseFeed, whiteHouseItems, "Waiting for configured White House X accounts.");

  socialCount.textContent = socialItems.length;
  headlineCount.textContent = headlineItems.length;
  whiteHouseCount.textContent = whiteHouseItems.length;
  itemCount.textContent = `${socialItems.length + headlineItems.length + whiteHouseItems.length} shown`;
}

async function refresh() {
  if (refreshInFlight) {
    refreshAgain = true;
    return;
  }
  refreshInFlight = true;
  try {
    const [itemsResponse, sourcesResponse, watchlistResponse] = await Promise.all([
      fetch("/api/items?limit=250"),
      fetch("/api/sources"),
      fetch("/api/watchlist")
    ]);
    items = (await itemsResponse.json()).items;
    sources = (await sourcesResponse.json()).sources;
    headlineKeywords = (await watchlistResponse.json()).headlineKeywords ?? [];
    renderHealth(sources);
    renderWhiteHouseAccounts(sources);
    renderKeywords();
    renderItems();
    lastUpdate.textContent = `Updated ${timeAgo(new Date().toISOString())}`;
  } finally {
    refreshInFlight = false;
    if (refreshAgain) {
      refreshAgain = false;
      refresh();
    }
  }
}

search.addEventListener("input", renderItems);
accountForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const handle = accountInput.value.trim();
  if (!handle) return;
  accountInput.value = "";
  await fetch("/api/white-house-x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ handle })
  });
  await refresh();
});

whiteHouseAccounts.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-handle]");
  if (!button) return;
  await fetch(`/api/white-house-x/${encodeURIComponent(button.dataset.handle)}`, { method: "DELETE" });
  await refresh();
});

socialHealth.addEventListener("click", (event) => {
  const card = event.target.closest("[data-health-source='trump-truth-direct']");
  if (!card) return;
  openTruthHealth();
});

setClock();
setInterval(setClock, 1000);
refresh();
setInterval(refresh, 2000);

const events = new EventSource("/api/events");
events.addEventListener("items", () => refresh());
