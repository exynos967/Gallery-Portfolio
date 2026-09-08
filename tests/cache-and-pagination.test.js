import assert from "node:assert/strict";
import test from "node:test";
import { GalleryCache } from "../functions/_lib/gallery-cache.js";

test("图库缓存淘汰最久未使用条目，过期后释放容量", () => {
  const cache = new GalleryCache({ maxEntries: 2, ttlMs: 10 });
  cache.set("a", "v1", { id: "a" }, 0);
  cache.set("b", "v1", { id: "b" }, 1);
  assert.deepEqual(cache.get("a", "v1", 2), { id: "a" });
  cache.set("c", "v1", { id: "c" }, 3);
  assert.equal(cache.get("b", "v1", 4), null);
  assert.deepEqual(cache.get("a", "v1", 4), { id: "a" });
  assert.equal(cache.get("c", "v2", 4), null);
  assert.equal(cache.get("a", "v1", 10), null);
  assert.equal(cache.entries.size, 0);
  assert.equal(cache.totalBytes, 0);
});

test("图库缓存拒绝超大条目，并限制累计 UTF-8 字节数", () => {
  const cache = new GalleryCache({ maxBytes: 20 });
  cache.set("a", "v", "中文", 0);
  cache.set("b", "v", "中文", 0);
  cache.set("c", "v", "中文", 0);
  assert.ok(cache.totalBytes <= 20);
  assert.equal(cache.get("a", "v", 1), null);
  cache.set("large", "v", "中文".repeat(10), 1);
  assert.equal(cache.get("large", "v", 2), null);
  assert.ok(cache.totalBytes <= 20);
});
