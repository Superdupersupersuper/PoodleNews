const feed = document.querySelector("#feed");
const sourcesEl = document.querySelector("#sources");
const itemTemplate = document.querySelector("#itemTemplate");
const search = document.querySelector("#search");
const sourceFilter = document.querySelector("#sourceFilter");
const itemCount = document.querySelector("#itemCount");
const lastUpdate = document.querySelector("#lastUpdate");
const clock = document.querySelector("#clock");

let activeKind = "all";
let knownSources = new Map();
let items = [];

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

function renderSources(rows) {
  sourcesEl.replaceChildren();
  sourceFilter.replaceChildren(new Option("All sources", ""));

  for (const row of rows) {
    knownSources.set(row.source.id, row.source);
    sourceFilter.append(new Option(row.source.label, row.source.id));

    const el = document.createElement("div");
    el.className = "source-row";
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
    sourcesEl.append(el);
  }
}

function renderItems() {
  const query = search.value.trim().toLowerCase();
  const selectedSource = sourceFilter.value;
  const visible = items.filter((item) => {
    if (selectedSource && item.sourceId !== selectedSource) return false;
    if (activeKind === "critical" && !item.tags.includes("critical")) return false;
    if (activeKind === "headline" && item.type !== "headline") return false;
    if (!query) return true;
    return `${item.title} ${item.summary} ${item.sourceLabel}`.toLowerCase().includes(query);
  });

  feed.replaceChildren();
  for (const item of visible) {
    const node = itemTemplate.content.cloneNode(true);
    const article = node.querySelector(".item");
    article.classList.add(item.tags.includes("critical") ? "critical" : "headline");
    node.querySelector(".source").textContent = item.sourceLabel;
    node.querySelector(".age").textContent = timeAgo(item.publishedAt || item.createdAt);
    const title = node.querySelector(".title");
    title.textContent = item.title;
    title.href = item.url || "#";
    const summary = node.querySelector(".summary");
    summary.textContent = item.summary || "";
    summary.hidden = !item.summary || item.summary === item.title;
    const tags = node.querySelector(".tags");
    for (const tag of item.tags ?? []) {
      const pill = document.createElement("span");
      pill.className = "tag";
      pill.textContent = tag;
      tags.append(pill);
    }
    feed.append(node);
  }

  itemCount.textContent = `${visible.length} items`;
}

async function refresh() {
  const [itemsResponse, sourcesResponse] = await Promise.all([
    fetch("/api/items?limit=250"),
    fetch("/api/sources")
  ]);
  items = (await itemsResponse.json()).items;
  const sourceRows = (await sourcesResponse.json()).sources;
  renderSources(sourceRows);
  renderItems();
  lastUpdate.textContent = `Updated ${timeAgo(new Date().toISOString())}`;
}

document.querySelectorAll("[data-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-filter]").forEach((el) => el.classList.remove("is-active"));
    button.classList.add("is-active");
    activeKind = button.dataset.filter;
    renderItems();
  });
});

search.addEventListener("input", renderItems);
sourceFilter.addEventListener("change", renderItems);

setClock();
setInterval(setClock, 1000);
refresh();
setInterval(refresh, 2000);
