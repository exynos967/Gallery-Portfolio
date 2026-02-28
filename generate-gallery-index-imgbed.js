#!/usr/bin/env node

/**
 * 图片目录索引生成器 (CloudFlare ImgBed 版本)
 * 通过 ImgBed 列表 API 生成 gallery-index.json
 */

import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

console.log("========================================");
console.log("图片目录索引生成器 (CloudFlare ImgBed 版)");
console.log("========================================");

const OUTPUT_FILE = "gallery-index.json";
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".avif", ".svg"];

const IMGBED_BASE_URL = (process.env.IMGBED_BASE_URL || "").trim().replace(/\/+$/, "");
const IMGBED_API_TOKEN = (process.env.IMGBED_API_TOKEN || "").trim();
const IMGBED_LIST_ENDPOINT = (process.env.IMGBED_LIST_ENDPOINT || "/api/manage/list").trim();
const IMGBED_RANDOM_ENDPOINT = (process.env.IMGBED_RANDOM_ENDPOINT || "/random").trim();
const IMGBED_FILE_ROUTE_PREFIX = (process.env.IMGBED_FILE_ROUTE_PREFIX || "/file")
  .trim()
  .replace(/^\/+|\/+$/g, "");
const IMGBED_LIST_DIR = (process.env.IMGBED_LIST_DIR || "").trim().replace(/^\/+|\/+$/g, "");
const IMGBED_PREVIEW_DIR = (process.env.IMGBED_PREVIEW_DIR || "0_preview")
  .trim()
  .replace(/^\/+|\/+$/g, "");
const IMGBED_DEFAULT_CATEGORY = (process.env.IMGBED_DEFAULT_CATEGORY || "uncategorized").trim();
const IMGBED_PAGE_SIZE = Number(process.env.IMGBED_PAGE_SIZE || 200);

const IMGBED_LIST_RECURSIVE = parseBoolean(process.env.IMGBED_LIST_RECURSIVE, true);
const IMGBED_ENABLE_PREVIEW_MAPPING = parseBoolean(process.env.IMGBED_ENABLE_PREVIEW_MAPPING, true);
const IMGBED_PREVIEW_FALLBACK_TO_ORIGINAL = parseBoolean(
  process.env.IMGBED_PREVIEW_FALLBACK_TO_ORIGINAL,
  true
);

if (!IMGBED_BASE_URL) {
  console.error("错误: 缺少 IMGBED_BASE_URL，请在 .env 中配置图床域名");
  process.exit(1);
}

const normalizedPageSize = Number.isFinite(IMGBED_PAGE_SIZE) && IMGBED_PAGE_SIZE > 0 ? IMGBED_PAGE_SIZE : 200;

function parseBoolean(value, defaultValue) {
  if (value === undefined || value === null || value === "") return defaultValue;
  const normalized = String(value).toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return defaultValue;
}

function buildAbsoluteUrl(endpointOrPath) {
  if (!endpointOrPath) return "";
  if (/^https?:\/\//i.test(endpointOrPath)) return endpointOrPath;
  const clean = endpointOrPath.replace(/^\/+/, "");
  return `${IMGBED_BASE_URL}/${clean}`;
}

function normalizeListedPath(rawPath) {
  if (!rawPath || typeof rawPath !== "string") return "";

  let normalized = rawPath.trim();
  if (!normalized) return "";

  if (/^https?:\/\//i.test(normalized)) {
    try {
      const urlObj = new URL(normalized);
      normalized = urlObj.pathname;
    } catch {
      // ignore and fallback
    }
  }

  normalized = normalized.split("?")[0].split("#")[0];
  normalized = normalized.replace(/^\/+/, "");

  if (IMGBED_FILE_ROUTE_PREFIX && normalized.startsWith(`${IMGBED_FILE_ROUTE_PREFIX}/`)) {
    normalized = normalized.slice(IMGBED_FILE_ROUTE_PREFIX.length + 1);
  }

  return normalized;
}

function stripDirPrefix(normalizedPath) {
  if (!IMGBED_LIST_DIR) return normalizedPath;
  if (normalizedPath === IMGBED_LIST_DIR) return "";
  if (normalizedPath.startsWith(`${IMGBED_LIST_DIR}/`)) {
    return normalizedPath.slice(IMGBED_LIST_DIR.length + 1);
  }
  return normalizedPath;
}

function isImageFile(file) {
  const fileName = file?.name || file?.path || "";
  const ext = path.extname(fileName).toLowerCase();
  if (IMAGE_EXTENSIONS.includes(ext)) return true;

  const metadata = file?.metadata || {};
  const mime =
    metadata["File-Mime"] ||
    metadata["file-mime"] ||
    metadata["FileType"] ||
    metadata["fileType"] ||
    metadata["mimeType"] ||
    metadata["mime"];

  return typeof mime === "string" && mime.toLowerCase().startsWith("image/");
}

function buildFileUrl(relativePath) {
  if (/^https?:\/\//i.test(relativePath)) return relativePath;
  const cleanPath = relativePath.replace(/^\/+/, "");
  const encodedPath = encodeURI(cleanPath);
  const prefix = IMGBED_FILE_ROUTE_PREFIX ? `${IMGBED_FILE_ROUTE_PREFIX}/` : "";
  return `${IMGBED_BASE_URL}/${prefix}${encodedPath}`;
}

function parseOriginalFile(relativePath) {
  const segments = relativePath.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  let categoryName = IMGBED_DEFAULT_CATEGORY;
  let filePath = segments[0];

  if (segments.length >= 2) {
    categoryName = segments[0];
    filePath = segments.slice(1).join("/");
  }

  if (categoryName === IMGBED_PREVIEW_DIR) return null;

  const ext = path.extname(filePath);
  const baseName = path.basename(filePath, ext);
  const relativeWithoutExt = ext ? filePath.slice(0, -ext.length) : filePath;
  const dedupeKey = `${categoryName}/${relativeWithoutExt}`;

  return {
    categoryName,
    filePath,
    baseName,
    dedupeKey,
    relativePath,
  };
}

function parsePreviewFile(relativePath) {
  const segments = relativePath.split("/").filter(Boolean);
  if (segments.length < 3) return null;
  if (segments[0] !== IMGBED_PREVIEW_DIR) return null;

  const categoryName = segments[1];
  const previewFilePath = segments.slice(2).join("/");
  const ext = path.extname(previewFilePath);
  const relativeWithoutExt = ext ? previewFilePath.slice(0, -ext.length) : previewFilePath;
  const dedupeKey = `${categoryName}/${relativeWithoutExt}`;

  return {
    categoryName,
    previewRelativePath: relativePath,
    dedupeKey,
  };
}

function toAuthHeader(token) {
  if (!token) return null;
  return token.toLowerCase().startsWith("bearer ") ? token : `Bearer ${token}`;
}

async function listAllFiles() {
  const allFiles = [];
  let start = 0;
  let page = 1;

  while (true) {
    const apiUrl = new URL(buildAbsoluteUrl(IMGBED_LIST_ENDPOINT));
    apiUrl.searchParams.set("start", String(start));
    apiUrl.searchParams.set("count", String(normalizedPageSize));
    apiUrl.searchParams.set("fileType", "image");
    apiUrl.searchParams.set("accessStatus", "normal");

    if (IMGBED_LIST_RECURSIVE) {
      apiUrl.searchParams.set("recursive", "true");
    }
    if (IMGBED_LIST_DIR) {
      apiUrl.searchParams.set("dir", IMGBED_LIST_DIR);
    }

    console.log(`请求第 ${page} 页: ${apiUrl.pathname}?${apiUrl.searchParams.toString()}`);

    const headers = { Accept: "application/json" };
    const authHeader = toAuthHeader(IMGBED_API_TOKEN);
    if (authHeader) {
      headers.Authorization = authHeader;
    }

    const response = await fetch(apiUrl, { method: "GET", headers });
    if (!response.ok) {
      const reason = await response.text().catch(() => "");
      throw new Error(`请求失败 (${response.status}): ${reason || response.statusText}`);
    }

    const payload = await response.json();
    const files = Array.isArray(payload?.files) ? payload.files : [];
    const returnedCount =
      Number.isFinite(Number(payload?.returnedCount)) && Number(payload.returnedCount) >= 0
        ? Number(payload.returnedCount)
        : files.length;
    const totalCount =
      Number.isFinite(Number(payload?.totalCount)) && Number(payload.totalCount) >= 0
        ? Number(payload.totalCount)
        : null;

    allFiles.push(...files);
    console.log(`第 ${page} 页返回 ${files.length} 条，累计 ${allFiles.length} 条`);

    if (files.length === 0 || returnedCount < normalizedPageSize) {
      break;
    }

    start += returnedCount;
    page += 1;

    if (totalCount !== null && allFiles.length >= totalCount) {
      break;
    }
  }

  return allFiles;
}

async function generateGalleryIndex() {
  console.log(`图床域名: ${IMGBED_BASE_URL}`);
  console.log(`列表 API: ${buildAbsoluteUrl(IMGBED_LIST_ENDPOINT)}`);
  console.log(`随机图 API: ${buildAbsoluteUrl(IMGBED_RANDOM_ENDPOINT)}`);
  console.log(`输出文件: ${OUTPUT_FILE}`);
  console.log();

  const files = await listAllFiles();
  const gallery = {};
  const previewMap = new Map();
  const images = [];

  for (const item of files) {
    if (!isImageFile(item)) continue;

    const rawPath = item?.name || item?.path || item?.src || "";
    const normalizedPath = normalizeListedPath(rawPath);
    if (!normalizedPath) continue;

    const pathWithoutDir = stripDirPrefix(normalizedPath);
    if (!pathWithoutDir) continue;

    const previewParsed = IMGBED_ENABLE_PREVIEW_MAPPING ? parsePreviewFile(pathWithoutDir) : null;
    if (previewParsed) {
      previewMap.set(previewParsed.dedupeKey, previewParsed.previewRelativePath);
      continue;
    }

    const parsed = parseOriginalFile(pathWithoutDir);
    if (!parsed) continue;
    images.push(parsed);
  }

  let totalImages = 0;
  const categoryMap = new Map();

  for (const item of images) {
    const originalUrl = buildFileUrl(item.relativePath);
    const mappedPreview = previewMap.get(item.dedupeKey);
    const previewUrl = mappedPreview
      ? buildFileUrl(mappedPreview)
      : IMGBED_PREVIEW_FALLBACK_TO_ORIGINAL
        ? originalUrl
        : "";

    if (!categoryMap.has(item.categoryName)) {
      categoryMap.set(item.categoryName, []);
    }

    categoryMap.get(item.categoryName).push({
      name: item.baseName,
      original: originalUrl,
      preview: previewUrl || originalUrl,
      category: item.categoryName,
    });
    totalImages += 1;
  }

  for (const [categoryName, categoryImages] of categoryMap.entries()) {
    categoryImages.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
    gallery[categoryName] = {
      name: categoryName,
      images: categoryImages,
      count: categoryImages.length,
    };
    console.log(`完成分类 ${categoryName}，共 ${categoryImages.length} 张图片`);
  }

  const output = {
    source: {
      type: "imgbed",
      base_url: IMGBED_BASE_URL,
      list_endpoint: buildAbsoluteUrl(IMGBED_LIST_ENDPOINT),
      random_endpoint: buildAbsoluteUrl(IMGBED_RANDOM_ENDPOINT),
      file_route_prefix: IMGBED_FILE_ROUTE_PREFIX ? `/${IMGBED_FILE_ROUTE_PREFIX}` : "/",
      list_dir: IMGBED_LIST_DIR || "/",
    },
    gallery,
    total_images: totalImages,
    generated_at: new Date().toISOString(),
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2), "utf8");

  console.log();
  console.log("========================================");
  console.log("索引生成完成！");
  console.log(`总图片数: ${totalImages}`);
  console.log(`输出文件: ${OUTPUT_FILE}`);
  console.log("========================================");
}

generateGalleryIndex().catch((error) => {
  console.error("生成索引时发生错误:", error.message);
  process.exit(1);
});
