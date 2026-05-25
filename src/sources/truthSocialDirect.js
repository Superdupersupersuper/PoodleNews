const DEFAULT_ACCOUNT_ID = "107780257626128497";

function stripHtml(value = "") {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, entity) => {
      if (entity[0] === "#") {
        const code = entity[1]?.toLowerCase() === "x"
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : "";
      }
      return {
        amp: "&",
        lt: "<",
        gt: ">",
        quot: "\"",
        apos: "'",
        nbsp: " "
      }[entity.toLowerCase()] ?? `&${entity};`;
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function postText(status) {
  const reblog = status.reblog;
  const original = stripHtml(status.content ?? "");
  if (!reblog) return original;
  const boosted = stripHtml(reblog.content ?? "");
  const boostedBy = reblog.account?.acct ? `@${reblog.account.acct}` : "retruth";
  return `ReTruth ${boostedBy}: ${boosted || original}`;
}

export async function fetchTruthSocialDirect(source, cache) {
  const accountId = source.accountId ?? DEFAULT_ACCOUNT_ID;
  cache.truthBackoff ??= new Map();
  const backoff = cache.truthBackoff.get(source.id);
  if (backoff?.until > Date.now()) {
    throw new Error(`Truth Social backing off after ${backoff.status}`);
  }

  const params = new URLSearchParams({
    exclude_replies: "true",
    limit: String(source.limit ?? 5)
  });

  cache.truthSince ??= new Map();
  const sinceId = cache.truthSince.get(source.id);
  if (sinceId) params.set("since_id", sinceId);

  const url = `https://truthsocial.com/api/v1/accounts/${accountId}/statuses?${params}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), source.timeoutMs ?? 4000);
  const response = await fetch(url, {
    signal: controller.signal,
    headers: {
      accept: "application/json, text/plain, */*",
      "accept-language": "en-US,en;q=0.9",
      "cache-control": "no-cache",
      "user-agent": "PoodleNews/0.1 (+private terminal)"
    }
  }).finally(() => clearTimeout(timeout));

  if (!response.ok) {
    if ([403, 429, 503].includes(response.status)) {
      cache.truthBackoff.set(source.id, {
        status: response.status,
        until: Date.now() + (source.errorBackoffMs ?? 15000)
      });
    }
    throw new Error(`Truth Social returned ${response.status}`);
  }

  cache.truthBackoff.delete(source.id);

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error(`Truth Social returned ${contentType || "non-json response"}`);
  }

  const payload = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error("Truth Social returned unexpected payload");
  }

  if (payload[0]?.id) cache.truthSince.set(source.id, payload[0].id);

  return payload.map((status) => {
    const text = postText(status);
    return {
      id: `${source.id}:${status.id}`,
      sourceId: source.id,
      sourceLabel: source.label,
      type: "social-post",
      title: text.slice(0, 280) || `${source.label} post`,
      summary: text,
      url: status.url ?? status.uri ?? `https://truthsocial.com/@${source.handle}/posts/${status.id}`,
      publishedAt: status.created_at ? new Date(status.created_at).toISOString() : new Date().toISOString(),
      priority: source.priority ?? 100,
      tags: source.tags ?? ["critical", "truth-social"]
    };
  }).filter((item) => item.title);
}
