import assert from "node:assert/strict";
import test from "node:test";
import { GalleryCache } from "../functions/_lib/gallery-cache.js";
import { listImgbedFiles } from "../scripts/lib/list-imgbed-files.js";

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

test("索引分页使用连续游标，完整页后可通过空页正常结束", async (t) => {
  const starts = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    const parsed = new URL(url);
    const start = Number(parsed.searchParams.get("start"));
    starts.push(start);
    assert.equal(parsed.searchParams.get("dir"), "foo");
    return Response.json({ files: start === 0 ? [{ name: "a.jpg" }, { name: "b.jpg" }] : [] });
  });
  const files = await listImgbedFiles({ endpoint: "https://img.example/list", pageSize: 2, listDir: "foo" });
  assert.equal(files.length, 2);
  assert.deepEqual(starts, [0, 2]);
});

test("上游重复整页或游标无进展时终止，不返回截断索引", async (t) => {
  let calls = 0;
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json({ files: [{ name: "same.jpg" }], returnedCount: 1 });
  });
  await assert.rejects(listImgbedFiles({ endpoint: "https://img.example/list", pageSize: 1 }), /重复/);
  assert.equal(calls, 2);
  fetchMock.mock.mockImplementation(async () => Response.json({ files: [{ name: "a.jpg" }], returnedCount: 0 }));
  await assert.rejects(listImgbedFiles({ endpoint: "https://img.example/list" }), /未前进/);
});

test("页数和文件数达到保护上限时明确失败", async (t) => {
  let count = 0;
  const fetchMock = t.mock.method(globalThis, "fetch", async () => Response.json({ files: [{ name: `${count++}.jpg` }] }));
  await assert.rejects(listImgbedFiles({ endpoint: "https://img.example/list", pageSize: 1, maxPages: 2 }), /2 页/);
  fetchMock.mock.mockImplementation(async () => Response.json({ files: [{ name: "a.jpg" }, { name: "b.jpg" }] }));
  await assert.rejects(listImgbedFiles({ endpoint: "https://img.example/list", maxFiles: 1 }), /1 个文件/);
});

test("上游计数大于或小于实际文件数量时不能跳过文件或提前结束", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch");
  for (const returnedCount of [1, 3]) {
    fetchMock.mock.mockImplementation(async () => Response.json({
      files: [{ name: "a.jpg" }, { name: "b.jpg" }], returnedCount,
    }));
    await assert.rejects(listImgbedFiles({ endpoint: "https://img.example/list", pageSize: 2 }), /不一致/);
  }
});
