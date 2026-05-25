const adminStatus = document.querySelector("#adminStatus");
const xListAdmin = document.querySelector("#xListAdmin");

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

function statusText(row) {
  if (row.ok === true) return "online";
  if (row.ok === false) return row.error || "fault";
  return "pending";
}

function accountRow(row) {
  const account = document.createElement("div");
  account.className = "admin-account";

  const detail = document.createElement("div");
  detail.className = "admin-account-detail";

  const head = document.createElement("div");
  head.className = "source-head";

  const handle = document.createElement("strong");
  handle.textContent = `@${row.source.username}`;

  const dot = document.createElement("span");
  dot.className = `dot ${row.ok === true ? "ok" : row.ok === false ? "bad" : ""}`;

  head.append(handle, dot);

  const meta = document.createElement("div");
  meta.className = "item-meta";

  const state = document.createElement("span");
  state.textContent = statusText(row);

  const latency = document.createElement("span");
  latency.textContent = `${row.latencyMs ?? "-"}ms`;

  const lastPoll = document.createElement("span");
  lastPoll.textContent = row.lastPollAt ? timeAgo(row.lastPollAt) : "pending";

  meta.append(state, latency, lastPoll);
  detail.append(head, meta);
  account.append(detail);

  const remove = document.createElement("button");
  remove.className = "remove-account";
  remove.type = "button";
  remove.dataset.handle = row.source.username;
  remove.textContent = "Remove";
  account.append(remove);

  return account;
}

function listPanel(list) {
  const panel = document.createElement("article");
  panel.className = "admin-panel";
  panel.dataset.listId = list.id;

  const header = document.createElement("header");
  header.className = "admin-panel-head";

  const titleWrap = document.createElement("div");
  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = `${list.accounts.length} accounts`;
  const title = document.createElement("h3");
  title.textContent = list.label;
  const description = document.createElement("p");
  description.textContent = list.description;
  titleWrap.append(eyebrow, title, description);
  header.append(titleWrap);

  const form = document.createElement("form");
  form.className = "account-form admin-account-form";
  form.dataset.listId = list.id;

  const input = document.createElement("input");
  input.name = "handle";
  input.type = "text";
  input.placeholder = "@handle or x.com/profile";

  const button = document.createElement("button");
  button.type = "submit";
  button.textContent = "Add";

  form.append(input, button);

  const accounts = document.createElement("div");
  accounts.className = "account-list admin-account-list";
  if (list.accounts.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No accounts yet.";
    accounts.append(empty);
  } else {
    for (const row of list.accounts) accounts.append(accountRow(row));
  }

  panel.append(header, form, accounts);
  return panel;
}

async function refreshLists() {
  const response = await fetch("/api/x-lists");
  const payload = await response.json();
  xListAdmin.replaceChildren(...payload.lists.map(listPanel));
  adminStatus.textContent = `Updated ${timeAgo(new Date().toISOString())}`;
}

xListAdmin.addEventListener("submit", async (event) => {
  const form = event.target.closest("[data-list-id]");
  if (!form) return;
  event.preventDefault();

  const input = form.elements.handle;
  const handle = input.value.trim();
  if (!handle) return;

  input.value = "";
  await fetch(`/api/x-lists/${encodeURIComponent(form.dataset.listId)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ handle })
  });
  await refreshLists();
});

xListAdmin.addEventListener("click", async (event) => {
  const remove = event.target.closest("[data-handle]");
  if (!remove) return;

  const panel = remove.closest("[data-list-id]");
  await fetch(`/api/x-lists/${encodeURIComponent(panel.dataset.listId)}/${encodeURIComponent(remove.dataset.handle)}`, {
    method: "DELETE"
  });
  await refreshLists();
});

refreshLists();
setInterval(() => {
  if (!xListAdmin.contains(document.activeElement)) refreshLists();
}, 5000);
