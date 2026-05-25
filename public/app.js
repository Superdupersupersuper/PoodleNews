const socialFeed = document.querySelector("#socialFeed");
const headlineFeed = document.querySelector("#headlineFeed");
const socialHealth = document.querySelector("#socialHealth");
const keywordsEl = document.querySelector("#keywords");
const itemTemplate = document.querySelector("#itemTemplate");
const search = document.querySelector("#search");
const itemCount = document.querySelector("#itemCount");
const lastUpdate = document.querySelector("#lastUpdate");
const socialCount = document.querySelector("#socialCount");
const headlineCount = document.querySelector("#headlineCount");
const clock = document.querySelector("#clock");

let items = [];
let sources = [];
let headlineKeywords = [];

const socialSourceIds = new Set(["trump-truth-provider", "trump-x"]);

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

function renderHealth(rows) {
  socialHealth.replaceChildren();
  for (const row of rows.filter((entry) => socialSourceIds.has(entry.source.id))) {
    const el = document.createElement("div");
    el.className = "health-card";
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

  renderFeed(socialFeed, socialItems, "Waiting for Trump Truth Social / X posts.");
  renderFeed(headlineFeed, headlineItems, "No watched headlines yet.");

  socialCount.textContent = socialItems.length;
  headlineCount.textContent = headlineItems.length;
  itemCount.textContent = `${socialItems.length + headlineItems.length} shown`;
}

async function refresh() {
  const [itemsResponse, sourcesResponse, watchlistResponse] = await Promise.all([
    fetch("/api/items?limit=250"),
    fetch("/api/sources"),
    fetch("/api/watchlist")
  ]);
  items = (await itemsResponse.json()).items;
  sources = (await sourcesResponse.json()).sources;
  headlineKeywords = (await watchlistResponse.json()).headlineKeywords ?? [];
  renderHealth(sources);
  renderKeywords();
  renderItems();
  lastUpdate.textContent = `Updated ${timeAgo(new Date().toISOString())}`;
}

search.addEventListener("input", renderItems);

setClock();
setInterval(setClock, 1000);
refresh();
setInterval(refresh, 2000);
