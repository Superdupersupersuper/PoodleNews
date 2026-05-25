const entityMap = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: "\"",
  apos: "'"
};

function decodeEntities(value = "") {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, entity) => {
      if (entity[0] === "#") {
        const code = entity[1]?.toLowerCase() === "x"
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : "";
      }
      return entityMap[entity.toLowerCase()] ?? `&${entity};`;
    })
    .trim();
}

function tagValue(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return decodeEntities(match?.[1] ?? "");
}

function itemBlocks(xml) {
  const matches = xml.match(/<item[\s\S]*?<\/item>|<entry[\s\S]*?<\/entry>/gi);
  return matches ?? [];
}

export async function fetchRss(source) {
  const response = await fetch(source.url, {
    headers: {
      "accept": "application/rss+xml, application/atom+xml, text/xml;q=0.9, */*;q=0.8",
      "user-agent": "NewsAggregator/0.1 (+local dashboard)"
    }
  });

  if (!response.ok) {
    throw new Error(`RSS ${source.label} returned ${response.status}`);
  }

  const xml = await response.text();
  return itemBlocks(xml).map((block) => {
    const title = tagValue(block, "title");
    const link = tagValue(block, "link") || block.match(/<link[^>]+href="([^"]+)"/i)?.[1] || "";
    const guid = tagValue(block, "guid") || tagValue(block, "id") || link || title;
    const publishedAt = tagValue(block, "pubDate") || tagValue(block, "updated") || tagValue(block, "published");

    return {
      id: `${source.id}:${guid}`,
      sourceId: source.id,
      sourceLabel: source.label,
      type: "headline",
      title,
      summary: tagValue(block, "description") || tagValue(block, "summary"),
      url: link,
      publishedAt: publishedAt ? new Date(publishedAt).toISOString() : new Date().toISOString(),
      priority: source.priority ?? 0,
      tags: ["rss"]
    };
  }).filter((item) => item.title);
}
