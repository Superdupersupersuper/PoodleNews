export function stripHtml(value = "") {
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

function statusText(status) {
  const reblog = status.reblog;
  const original = stripHtml(status.content ?? "");
  if (!reblog) return original;

  const boosted = stripHtml(reblog.content ?? "");
  const boostedBy = reblog.account?.acct ? `@${reblog.account.acct}` : "retruth";
  return `ReTruth ${boostedBy}: ${boosted || original}`;
}

function statusMedia(status) {
  const sourceStatus = status.reblog ?? status;
  return (sourceStatus.media_attachments ?? []).map((media) => ({
    type: media.type,
    url: media.url,
    previewUrl: media.preview_url,
    description: media.description ?? "",
    blurhash: media.blurhash ?? ""
  })).filter((media) => media.url || media.previewUrl);
}

export function normalizeTruthStatus(source, status) {
  const sourceStatus = status.reblog ?? status;
  const text = statusText(status);
  const handle = source.handle ?? "realDonaldTrump";
  const statusId = status.id ?? sourceStatus.id;
  return {
    id: `${source.id}:${statusId}`,
    sourceId: source.id,
    sourceLabel: source.label,
    type: "social-post",
    title: text.slice(0, 280) || `${source.label} post`,
    summary: text,
    url: status.url ?? status.uri ?? `https://truthsocial.com/@${handle}/posts/${statusId}`,
    publishedAt: status.created_at ? new Date(status.created_at).toISOString() : new Date().toISOString(),
    priority: source.priority ?? 100,
    tags: source.tags ?? ["critical", "truth-social"],
    media: statusMedia(status)
  };
}
