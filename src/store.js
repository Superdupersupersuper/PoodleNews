import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DATA_DIR = path.resolve("data");
const STORE_PATH = path.join(DATA_DIR, "items.json");
const MAX_ITEMS = 1000;

export class NewsStore {
  constructor() {
    this.items = [];
    this.seen = new Set();
  }

  async load() {
    await mkdir(DATA_DIR, { recursive: true });
    try {
      const raw = await readFile(STORE_PATH, "utf8");
      this.items = JSON.parse(raw);
      this.seen = new Set(this.items.map((item) => item.id));
    } catch {
      this.items = [];
      this.seen = new Set();
      await this.persist();
    }
  }

  addMany(items) {
    const fresh = [];
    for (const item of items) {
      if (!item?.id || this.seen.has(item.id)) continue;
      this.seen.add(item.id);
      const normalized = {
        priority: 0,
        tags: [],
        createdAt: new Date().toISOString(),
        ...item
      };
      this.items.unshift(normalized);
      fresh.push(normalized);
    }

    if (fresh.length > 0) {
      this.items = this.items
        .sort((a, b) => new Date(b.publishedAt || b.createdAt) - new Date(a.publishedAt || a.createdAt))
        .slice(0, MAX_ITEMS);
      this.seen = new Set(this.items.map((item) => item.id));
    }

    return fresh;
  }

  list({ source, q, limit = 150 } = {}) {
    const query = q?.trim().toLowerCase();
    return this.items
      .filter((item) => !source || item.sourceId === source)
      .filter((item) => {
        if (!query) return true;
        return `${item.title} ${item.summary || ""} ${item.sourceLabel}`.toLowerCase().includes(query);
      })
      .slice(0, Number(limit));
  }

  async persist() {
    await writeFile(STORE_PATH, JSON.stringify(this.items, null, 2));
  }
}
