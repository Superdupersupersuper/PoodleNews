import { fetchRss } from "./sources/rss.js";
import { fetchTruthSocialDirect } from "./sources/truthSocialDirect.js";
import { fetchTruthProvider } from "./sources/truthProvider.js";
import { fetchXUser } from "./sources/xApi.js";

const sourceHandlers = {
  rss: fetchRss,
  "truth-social-direct": fetchTruthSocialDirect,
  "truth-provider": fetchTruthProvider,
  "x-user": fetchXUser
};

export class Ingestor {
  constructor({ store, sources, onFresh }) {
    this.store = store;
    this.sources = sources;
    this.cache = {};
    this.status = new Map();
    this.stats = new Map();
    this.timers = new Map();
    this.inFlight = new Set();
    this.onFresh = onFresh;
  }

  allSources() {
    return Object.values(this.sources).flat().filter((source) => source?.id);
  }

  start() {
    for (const source of this.allSources()) {
      this.addSource(source);
    }
  }

  addSource(source) {
    if (!source?.id || this.timers.has(source.id)) return;
    this.poll(source);
    const timer = setInterval(() => this.poll(source), source.pollMs ?? 30000);
    this.timers.set(source.id, { source, timer });
  }

  removeSource(sourceId) {
    const entry = this.timers.get(sourceId);
    if (!entry) return;
    clearInterval(entry.timer);
    this.timers.delete(sourceId);
    this.status.delete(sourceId);
  }

  async poll(source) {
    const handler = sourceHandlers[source.type];
    if (!handler) return;
    if (this.inFlight.has(source.id)) return;

    const startedAt = Date.now();
    this.inFlight.add(source.id);
    const previous = this.stats.get(source.id) ?? {
      totalPolls: 0,
      successfulPolls: 0,
      failedPolls: 0,
      consecutiveFailures: 0,
      receivedTotal: 0,
      freshTotal: 0,
      latencyTotalMs: 0,
      maxLatencyMs: 0
    };
    try {
      const items = await handler(source, this.cache);
      const fresh = this.store.addMany(items);
      if (fresh.length > 0) await this.store.persist();
      if (fresh.length > 0) this.onFresh?.(fresh, source);
      const latencyMs = Date.now() - startedAt;
      const nextStats = {
        ...previous,
        totalPolls: previous.totalPolls + 1,
        successfulPolls: previous.successfulPolls + 1,
        consecutiveFailures: 0,
        receivedTotal: previous.receivedTotal + items.length,
        freshTotal: previous.freshTotal + fresh.length,
        latencyTotalMs: previous.latencyTotalMs + latencyMs,
        maxLatencyMs: Math.max(previous.maxLatencyMs, latencyMs),
        lastSuccessAt: new Date().toISOString(),
        lastErrorAt: previous.lastErrorAt,
        lastError: previous.lastError
      };
      this.stats.set(source.id, nextStats);
      this.status.set(source.id, {
        ok: true,
        source,
        lastPollAt: new Date().toISOString(),
        nextPollInMs: source.pollMs ?? 30000,
        pollMs: source.pollMs ?? 30000,
        latencyMs,
        received: items.length,
        fresh: fresh.length,
        stats: {
          ...nextStats,
          avgLatencyMs: Math.round(nextStats.latencyTotalMs / Math.max(1, nextStats.successfulPolls))
        }
      });
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      const nextStats = {
        ...previous,
        totalPolls: previous.totalPolls + 1,
        failedPolls: previous.failedPolls + 1,
        consecutiveFailures: previous.consecutiveFailures + 1,
        latencyTotalMs: previous.latencyTotalMs + latencyMs,
        maxLatencyMs: Math.max(previous.maxLatencyMs, latencyMs),
        lastErrorAt: new Date().toISOString(),
        lastError: error.message
      };
      this.stats.set(source.id, nextStats);
      this.status.set(source.id, {
        ok: false,
        source,
        lastPollAt: new Date().toISOString(),
        nextPollInMs: source.pollMs ?? 30000,
        pollMs: source.pollMs ?? 30000,
        latencyMs,
        error: error.message,
        stats: {
          ...nextStats,
          avgLatencyMs: Math.round(nextStats.latencyTotalMs / Math.max(1, nextStats.totalPolls))
        }
      });
    } finally {
      this.inFlight.delete(source.id);
    }
  }

  getStatus() {
    return [...this.timers.values()].map(({ source }) => {
      return this.status.get(source.id) ?? {
        ok: null,
        source,
        lastPollAt: null,
        nextPollInMs: source.pollMs ?? 30000,
        pollMs: source.pollMs ?? 30000,
        latencyMs: null,
        received: 0,
        fresh: 0,
        stats: this.stats.get(source.id) ?? null
      };
    });
  }
}
