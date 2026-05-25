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

The free Blueprint uses the app's local JSON store for the first skeleton deployment. For production, add a paid persistent disk or move storage to SQLite/Postgres so history survives restarts.

## Truth Social latency path

The app includes two Truth Social paths:

- Direct in-app polling from Render via the public account statuses endpoint.
- A webhook endpoint for a dedicated low-latency watcher running from any environment that can reach Truth Social reliably.

Configure the webhook endpoint with:

```bash
TRUTH_WEBHOOK_SECRET=choose-a-long-random-secret
```

Then run the watcher from the machine/VPS you want to use:

```bash
POODLENEWS_TRUTH_WEBHOOK_URL=https://news-aggregator-zujo.onrender.com/api/webhooks/truth-social \
TRUTH_WEBHOOK_SECRET=choose-a-long-random-secret \
TRUTH_POLL_MS=500 \
npm run truth:watch
```

The watcher polls Trump Truth Social, sends new posts to PoodleNews, and includes image/media attachment metadata so the terminal can display images in the Trump lane.

The older provider adapter is still available. Set:

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
