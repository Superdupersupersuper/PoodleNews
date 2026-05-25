import { fetchRss } from "./sources/rss.js";
import { fetchTruthProvider } from "./sources/truthProvider.js";
import { fetchXUser } from "./sources/xApi.js";

const sourceHandlers = {
  rss: fetchRss,
  "truth-provider": fetchTruthProvider,
  "x-user": fetchXUser
};

export class Ingestor {
  constructor({ store, sources }) {
    this.store = store;
    this.sources = sources;
    this.cache = {};
    this.status = new Map();
    this.timers = [];
  }

  allSources() {
    return [...(this.sources.critical ?? []), ...(this.sources.rss ?? [])];
  }

  start() {
    for (const source of this.allSources()) {
      this.poll(source);
      const timer = setInterval(() => this.poll(source), source.pollMs ?? 30000);
      this.timers.push(timer);
    }
  }

  async poll(source) {
    const handler = sourceHandlers[source.type];
    if (!handler) return;

    const startedAt = Date.now();
    try {
      const items = await handler(source, this.cache);
      const fresh = this.store.addMany(items);
      if (fresh.length > 0) await this.store.persist();
      this.status.set(source.id, {
        ok: true,
        source,
        lastPollAt: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
        received: items.length,
        fresh: fresh.length
      });
    } catch (error) {
      this.status.set(source.id, {
        ok: false,
        source,
        lastPollAt: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
        error: error.message
      });
    }
  }

  getStatus() {
    return this.allSources().map((source) => {
      return this.status.get(source.id) ?? {
        ok: null,
        source,
        lastPollAt: null,
        latencyMs: null,
        received: 0,
        fresh: 0
      };
    });
  }
}
