function normalizeProviderItem(source, raw) {
  const id = raw.id ?? raw.uri ?? raw.url ?? raw.created_at ?? raw.createdAt;
  const text = raw.text ?? raw.content ?? raw.body ?? raw.title ?? "";
  const publishedAt = raw.created_at ?? raw.createdAt ?? raw.publishedAt ?? raw.date;
  const url = raw.url ?? raw.link ?? (id ? `https://truthsocial.com/@${source.handle}/posts/${id}` : "");

  return {
    id: `${source.id}:${id}`,
    sourceId: source.id,
    sourceLabel: source.label,
    type: "social-post",
    title: text.replace(/<[^>]+>/g, "").trim().slice(0, 280) || `${source.label} post`,
    summary: text.replace(/<[^>]+>/g, "").trim(),
    url,
    publishedAt: publishedAt ? new Date(publishedAt).toISOString() : new Date().toISOString(),
    priority: source.priority ?? 100,
    tags: ["critical", "truth-social"]
  };
}

export async function fetchTruthProvider(source) {
  const endpoint = process.env.TRUTH_SOCIAL_PROVIDER_URL;
  if (!endpoint) return [];

  const headers = {
    "accept": "application/json",
    "user-agent": "NewsAggregator/0.1 (+local dashboard)"
  };
  if (process.env.TRUTH_SOCIAL_PROVIDER_TOKEN) {
    headers.authorization = `Bearer ${process.env.TRUTH_SOCIAL_PROVIDER_TOKEN}`;
  }

  const url = new URL(endpoint);
  if (!url.searchParams.has("handle")) url.searchParams.set("handle", source.handle);

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`Truth provider returned ${response.status}`);
  }

  const payload = await response.json();
  const items = Array.isArray(payload) ? payload : payload.items ?? payload.statuses ?? [];
  return items.map((item) => normalizeProviderItem(source, item)).filter((item) => item.id && item.title);
}
