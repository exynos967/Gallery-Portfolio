export class GalleryCache {
  constructor({ ttlMs = 60000, maxEntries = 16, maxBytes = 8 * 1024 * 1024 } = {}) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1 || !Number.isFinite(maxBytes) || maxBytes <= 0 || !Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new RangeError("图库缓存的容量和有效期必须为正数，条目数必须为整数。");
    }
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes;
    this.entries = new Map();
    this.totalBytes = 0;
  }

  delete(key) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.totalBytes -= entry.bytes;
    this.entries.delete(key);
  }

  prune(now) {
    for (const [key, entry] of this.entries) {
      if (now - entry.timestamp >= this.ttlMs) this.delete(key);
    }
  }

  get(key, signature, now = Date.now()) {
    this.prune(now);
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.signature !== signature) {
      this.delete(key);
      return null;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.data;
  }

  set(key, signature, data, now = Date.now()) {
    this.prune(now);
    this.delete(key);
    const bytes = new TextEncoder().encode(JSON.stringify(data)).byteLength;
    if (bytes > this.maxBytes) return;
    while (this.entries.size >= this.maxEntries || this.totalBytes + bytes > this.maxBytes) {
      this.delete(this.entries.keys().next().value);
    }
    this.entries.set(key, { signature, data, timestamp: now, bytes });
    this.totalBytes += bytes;
  }
}
