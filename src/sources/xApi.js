async function getUserId(username, token) {
  const response = await fetch(`https://api.x.com/2/users/by/username/${username}`, {
    headers: { authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error(`X user lookup returned ${response.status}`);
  const payload = await response.json();
  return payload.data?.id;
}

export async function fetchXUser(source, cache) {
  const token = process.env.X_BEARER_TOKEN;
  if (!token) return [];

  cache.xUsers ??= new Map();
  let userId = cache.xUsers.get(source.username);
  if (!userId) {
    userId = await getUserId(source.username, token);
    if (!userId) return [];
    cache.xUsers.set(source.username, userId);
  }

  const params = new URLSearchParams({
    max_results: "10",
    "tweet.fields": "created_at,entities"
  });
  const response = await fetch(`https://api.x.com/2/users/${userId}/tweets?${params}`, {
    headers: { authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error(`X timeline returned ${response.status}`);

  const payload = await response.json();
  return (payload.data ?? []).map((post) => ({
    id: `${source.id}:${post.id}`,
    sourceId: source.id,
    sourceLabel: source.label,
    type: "social-post",
    title: post.text.slice(0, 280),
    summary: post.text,
    url: `https://x.com/${source.username}/status/${post.id}`,
    publishedAt: post.created_at,
    priority: source.priority ?? 90,
    tags: ["critical", "x"]
  }));
}
