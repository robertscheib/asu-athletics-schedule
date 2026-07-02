// Minimal TTL cache matching the previous ad-hoc Map-of-{data,expiresAt}
// pattern: expired entries are evicted on read, no single-flight dedupe
// (concurrent misses each fetch, last write wins — same as before).
// Bounded: entries are evicted FIFO past maxEntries — some caches are keyed
// by client-supplied values (espnGameCache), so unbounded growth was a
// slow memory leak anyone could drive.
class TtlCache {
  constructor({ maxEntries = 500 } = {}) {
    this._map = new Map();
    this._max = maxEntries;
  }

  get(key) {
    const entry = this._map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this._map.delete(key);
      return undefined;
    }
    return entry.data;
  }

  set(key, data, ttlMs) {
    if (!this._map.has(key) && this._map.size >= this._max) {
      // Map iterates in insertion order — drop the oldest entry.
      this._map.delete(this._map.keys().next().value);
    }
    this._map.set(key, { data, expiresAt: Date.now() + ttlMs });
  }

  async getOrFetch(key, ttlMs, fn) {
    const hit = this.get(key);
    if (hit !== undefined) return hit;
    const data = await fn();
    this.set(key, data, ttlMs);
    return data;
  }
}

module.exports = { TtlCache };
