# News Aggregator

A local, low-latency news dashboard for market-moving headlines and social posts.

## What this first version does

- Polls fast critical sources separately from slower news RSS feeds.
- Shows a dense live dashboard at `http://localhost:4173`.
- Deduplicates and stores recent items in `data/items.json`.
- Supports official X timeline ingestion when `X_BEARER_TOKEN` is set.
- Supports a compliant Truth Social provider endpoint when `TRUTH_SOCIAL_PROVIDER_URL` is set.

## Run it

```bash
cp .env.example .env
npm run dev
```

Then open `http://localhost:4173`.

## Deploy on Render

This repo includes a `render.yaml` Blueprint for a Node web service. On Render:

1. Create a new Blueprint from the GitHub repository.
2. Render will use `npm install` and `npm start`.
3. Add secret values for `X_BEARER_TOKEN`, `TRUTH_SOCIAL_PROVIDER_URL`, and `TRUTH_SOCIAL_PROVIDER_TOKEN` if you have them.

The Blueprint mounts a small persistent disk at `data/` so the local JSON event store survives restarts.

## Truth Social latency path

Truth Social's public terms currently restrict automated non-human access, so this project treats Trump Truth Social monitoring as a provider adapter instead of hard-coding brittle scraping. Set:

```bash
TRUTH_SOCIAL_PROVIDER_URL=https://your-provider.example/posts
TRUTH_SOCIAL_PROVIDER_TOKEN=...
```

The provider can return:

```json
{
  "items": [
    {
      "id": "116272810363139207",
      "text": "Post text",
      "url": "https://truthsocial.com/@realDonaldTrump/posts/116272810363139207",
      "created_at": "2026-03-22T21:28:00.000Z"
    }
  ]
}
```

For production-grade latency, use a paid/compliant monitoring provider or an approved API route, poll that adapter every 500-1500ms, and keep normal websites on slower intervals.

## Add sources

Edit `config/sources.json`. RSS sources are the quickest path:

```json
{
  "id": "source-id",
  "type": "rss",
  "label": "Source Label",
  "url": "https://example.com/rss.xml",
  "pollMs": 30000,
  "priority": 50
}
```

## Next build steps

- Add keyword/ticker tagging and alert rules.
- Add WebSocket or Server-Sent Events for push updates.
- Move storage to SQLite/Postgres for richer filtering and audit history.
- Add source-specific adapters for paid feeds, Bloomberg Terminal/API exports, or licensed news APIs.
- Add browser/desktop notifications for critical posts.
