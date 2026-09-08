import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile, unlink, rmdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const exec = promisify(execFile);
const generator = fileURLToPath(new URL("../generate-gallery-index-imgbed.js", import.meta.url));

async function fixture(t, files) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gallery-index-test-"));
  const stub = path.join(directory, "fetch.mjs");
  const output = path.join(directory, "gallery-index.json");
  await writeFile(stub, `globalThis.fetch = async () => Response.json(${JSON.stringify({ files })});`, "utf8");
  await writeFile(output, "previous-index", "utf8");
  t.after(async () => {
    await unlink(stub);
    await unlink(output);
    await rmdir(directory);
  });
  return {
    output,
    run: (overrides = {}) => exec(process.execPath, ["--import", pathToFileURL(stub).href, generator], {
      cwd: directory,
      env: {
        ...process.env,
        IMGBED_BASE_URL: "https://fixture.example",
        IMGBED_API_TOKEN: "test-generator-token",
        IMGBED_LIST_DIR: "foo/bar",
        IMGBED_LIST_ENDPOINT: "/api/manage/list",
        IMGBED_FILE_ROUTE_PREFIX: "/file",
        IMGBED_PREVIEW_DIR: "0_preview",
        IMGBED_ENABLE_PREVIEW_MAPPING: "true",
        IMGBED_PAGE_SIZE: "200",
        ...overrides,
      },
      timeout: 10000,
      windowsHide: true,
    }),
  };
}

test("离线生成器保留子目录原图/预览图完整 URL", async (t) => {
  const task = await fixture(t, [
    { name: "foo/bar/photos/a.jpg" },
    { name: "foo/bar/0_preview/photos/a.webp" },
  ]);
  await task.run();
  const output = JSON.parse(await readFile(task.output, "utf8"));
  assert.equal(output.total_images, 1);
  assert.equal(output.gallery.photos.images[0].original, "https://fixture.example/file/foo/bar/photos/a.jpg");
  assert.equal(output.gallery.photos.images[0].preview, "https://fixture.example/file/foo/bar/0_preview/photos/a.webp");
});
