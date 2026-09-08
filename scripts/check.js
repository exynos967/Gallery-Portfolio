import { readFile, readdir, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = fileURLToPath(new URL("../", import.meta.url));
const decoder = new TextDecoder("utf-8", { fatal: true });

async function readUtf8(file) {
  const bytes = await readFile(file);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new Error(`${path.relative(root, file)} 必须为 UTF-8 无 BOM。`);
  }
  return decoder.decode(bytes);
}

async function checkDirectory(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await checkDirectory(file);
    else if (/\.(js|html|css|json)$/.test(entry.name)) await checkFile(file);
  }
}

async function checkFile(file) {
  const text = await readUtf8(file);
  if (file.endsWith(".js")) {
    const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr || `语法检查失败：${file}`);
  } else if (file.endsWith(".json")) {
    JSON.parse(text);
  } else if (file.endsWith(".html")) {
    for (const match of text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
      if (!/\bsrc\s*=/i.test(match[1])) new vm.Script(match[2], { filename: file });
    }
    for (const match of text.matchAll(/<(?:script|link|img)\b[^>]*\b(?:src|href)=["']([^"']+)["']/gi)) {
      const url = match[1];
      if (/^(?:[a-z]+:|\/\/|#)/i.test(url)) continue;
      const relative = decodeURIComponent(url.split(/[?#]/)[0]);
      const target = relative.startsWith("/")
        ? path.join(root, relative.slice(1))
        : path.resolve(path.dirname(file), relative);
      if (!(await stat(target)).isFile()) throw new Error(`静态资源不存在：${url}`);
    }
  }
}

try {
  for (const name of ["index.html", "gallery-index.json", "package.json", "generate-gallery-index-imgbed.js"]) {
    await checkFile(path.join(root, name));
  }
  for (const name of ["public", "admin", "functions", "scripts", "tests"]) {
    await checkDirectory(path.join(root, name));
  }
  console.log("检查通过：JavaScript、HTML 内联脚本、JSON、静态资源和 UTF-8 编码。");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
