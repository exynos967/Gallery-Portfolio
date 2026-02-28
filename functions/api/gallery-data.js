import { getDomainConfig } from "../_lib/config-store.js";
import { json, noContent, normalizeDomain, pickRequestDomain } from "../_lib/http.js";

const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".avif", ".svg"];
const MAX_FILES_LIMIT = 10000;
const CACHE_TTL_MS = 60 * 1000;
const VALID_RANDOM_ORIENTATIONS = new Set(["", "auto", "landscape", "portrait", "square"]);

const runtimeCache = new Map();

function buildAbsoluteUrl(baseUrl, endpointOrPath) {
  if (!endpointOrPath) return "";
  if (/^https?:\/\//i.test(endpointOrPath)) return endpointOrPath;
  const clean = String(endpointOrPath).replace(/^\/+/, "");
  return `${String(baseUrl).replace(/\/+$/, "")}/${clean}`;
}

function normalizeListedPath(rawPath, fileRoutePrefix) {
  if (!rawPath || typeof rawPath !== "string") return "";

  let normalized = rawPath.trim();
  if (!normalized) return "";

  if (/^https?:\/\//i.test(normalized)) {
    try {
      normalized = new URL(normalized).pathname;
    } catch {
      // ignore
    }
  }

  normalized = normalized.split("?")[0].split("#")[0].replace(/^\/+/, "");
  const cleanPrefix = String(fileRoutePrefix || "/file").replace(/^\/+|\/+$/g, "");

  if (cleanPrefix && normalized.startsWith(`${cleanPrefix}/`)) {
    return normalized.slice(cleanPrefix.length + 1);
  }

  return normalized;
}

function stripDirPrefix(normalizedPath, listDir) {
  const cleanDir = String(listDir || "").replace(/^\/+|\/+$/g, "");
  if (!cleanDir) return normalizedPath;
  if (normalizedPath === cleanDir) return "";
  if (normalizedPath.startsWith(`${cleanDir}/`)) {
    return normalizedPath.slice(cleanDir.length + 1);
  }
  return normalizedPath;
}

function isImageFile(item) {
  const fileName = item?.name || item?.path || "";
  const ext = getExtension(fileName).toLowerCase();
  if (IMAGE_EXTENSIONS.includes(ext)) return true;

  const metadata = item?.metadata || {};
  const mime =
    metadata["File-Mime"] ||
    metadata["file-mime"] ||
    metadata["FileType"] ||
    metadata["fileType"] ||
    metadata["mimeType"] ||
    metadata["mime"];

  return typeof mime === "string" && mime.toLowerCase().startsWith("image/");
}

function parseOriginal(relativePath, previewDir, defaultCategory = "uncategorized") {
  const parts = relativePath.split("/").filter(Boolean);
  if (parts.length === 0) return null;

  let category = defaultCategory;
  let filePath = parts[0];
  if (parts.length >= 2) {
    category = parts[0];
    filePath = parts.slice(1).join("/");
  }

  if (category === previewDir) return null;

  const ext = getExtension(filePath);
  const baseName = getBaseName(filePath, ext);
  const relativeWithoutExt = ext ? filePath.slice(0, -ext.length) : filePath;

  return {
    category,
    baseName,
    dedupeKey: `${category}/${relativeWithoutExt}`,
    relativePath,
  };
}

function parsePreview(relativePath, previewDir) {
  const parts = relativePath.split("/").filter(Boolean);
  if (parts.length < 3) return null;
  if (parts[0] !== previewDir) return null;

  const category = parts[1];
  const filePath = parts.slice(2).join("/");
  const ext = getExtension(filePath);
  const relativeWithoutExt = ext ? filePath.slice(0, -ext.length) : filePath;

  return {
    category,
    dedupeKey: `${category}/${relativeWithoutExt}`,
    relativePath,
  };
}

function getExtension(filePath) {
  const input = String(filePath || "");
  const clean = input.split("/").pop() || "";
  const index = clean.lastIndexOf(".");
  if (index <= 0) return "";
  return clean.slice(index);
}

function getBaseName(filePath, extname) {
  const input = String(filePath || "");
  const clean = input.split("/").pop() || "";
  if (!extname || !clean.toLowerCase().endsWith(extname.toLowerCase())) {
    return clean;
  }
  return clean.slice(0, clean.length - extname.length);
}

function buildFileUrl(baseUrl, fileRoutePrefix, relativePath) {
  const cleanPrefix = String(fileRoutePrefix || "/file").replace(/^\/+|\/+$/g, "");
  const cleanPath = String(relativePath || "").replace(/^\/+/, "");
  const prefix = cleanPrefix ? `${cleanPrefix}/` : "";
  return `${String(baseUrl).replace(/\/+$/, "")}/${prefix}${encodeURI(cleanPath)}`;
}

function normalizeRandomOrientation(input) {
  const normalized = String(input || "").trim().toLowerCase();
  if (!normalized) return "";
  return VALID_RANDOM_ORIENTATIONS.has(normalized) ? normalized : "";
}

function buildSourceConfig(config, domain) {
  return {
    domain,
    baseUrl: String(config.imgbed?.baseUrl || "").trim(),
    listEndpoint: String(config.imgbed?.listEndpoint || "/api/manage/list").trim() || "/api/manage/list",
    randomEndpoint: String(config.imgbed?.randomEndpoint || "/random").trim() || "/random",
    randomOrientation: normalizeRandomOrientation(config.imgbed?.randomOrientation),
    fileRoutePrefix: String(config.imgbed?.fileRoutePrefix || "/file").trim() || "/file",
    apiToken: String(config.imgbed?.apiToken || "").trim(),
    listDir: String(config.imgbed?.listDir || "").trim(),
    previewDir: String(config.imgbed?.previewDir || "0_preview").trim() || "0_preview",
    recursive: config.imgbed?.recursive !== false,
    pageSize: Number.isFinite(Number(config.imgbed?.pageSize))
      ? Math.min(Math.max(Number(config.imgbed.pageSize), 1), 500)
      : 200,
  };
}

async function listAllFiles(sourceConfig) {
  const allFiles = [];
  let start = 0;
  let page = 1;

  while (allFiles.length < MAX_FILES_LIMIT) {
    const apiUrl = new URL(buildAbsoluteUrl(sourceConfig.baseUrl, sourceConfig.listEndpoint));
    apiUrl.searchParams.set("start", String(start));
    apiUrl.searchParams.set("count", String(sourceConfig.pageSize));
    apiUrl.searchParams.set("fileType", "image");
    apiUrl.searchParams.set("accessStatus", "normal");

    if (sourceConfig.recursive) {
      apiUrl.searchParams.set("recursive", "true");
    }
    if (sourceConfig.listDir) {
      apiUrl.searchParams.set("dir", sourceConfig.listDir);
    }

    const headers = { Accept: "application/json" };
    if (sourceConfig.apiToken) {
      headers.Authorization = sourceConfig.apiToken.toLowerCase().startsWith("bearer ")
        ? sourceConfig.apiToken
        : `Bearer ${sourceConfig.apiToken}`;
    }

    const response = await fetch(apiUrl.toString(), { method: "GET", headers });
    if (!response.ok) {
      const reason = await response.text().catch(() => "");
      throw new Error(`ImgBed 列表请求失败(${response.status}): ${reason || response.statusText}`);
    }

    const payload = await response.json();
    const files = Array.isArray(payload?.files) ? payload.files : [];
    allFiles.push(...files);

    const returnedCount =
      Number.isFinite(Number(payload?.returnedCount)) && Number(payload.returnedCount) >= 0
        ? Number(payload.returnedCount)
        : files.length;
    const totalCount =
      Number.isFinite(Number(payload?.totalCount)) && Number(payload.totalCount) >= 0
        ? Number(payload.totalCount)
        : null;

    if (files.length === 0 || returnedCount < sourceConfig.pageSize) {
      break;
    }

    start += returnedCount;
    page += 1;

    if (totalCount !== null && allFiles.length >= totalCount) {
      break;
    }

    if (page > 200) {
      break;
    }
  }

  return allFiles.slice(0, MAX_FILES_LIMIT);
}

function buildGalleryPayload(sourceConfig, files) {
  const previewMap = new Map();
  const originals = [];

  for (const item of files) {
    if (!isImageFile(item)) continue;

    const rawPath = item?.name || item?.path || item?.src || "";
    const normalizedPath = normalizeListedPath(rawPath, sourceConfig.fileRoutePrefix);
    if (!normalizedPath) continue;

    const pathWithoutDir = stripDirPrefix(normalizedPath, sourceConfig.listDir);
    if (!pathWithoutDir) continue;

    const parsedPreview = parsePreview(pathWithoutDir, sourceConfig.previewDir);
    if (parsedPreview) {
      previewMap.set(parsedPreview.dedupeKey, parsedPreview.relativePath);
      continue;
    }

    const parsedOriginal = parseOriginal(pathWithoutDir, sourceConfig.previewDir);
    if (!parsedOriginal) continue;
    originals.push(parsedOriginal);
  }

  const categories = new Map();
  let totalImages = 0;

  for (const item of originals) {
    const originalUrl = buildFileUrl(sourceConfig.baseUrl, sourceConfig.fileRoutePrefix, item.relativePath);
    const mappedPreview = previewMap.get(item.dedupeKey);
    const previewUrl = mappedPreview
      ? buildFileUrl(sourceConfig.baseUrl, sourceConfig.fileRoutePrefix, mappedPreview)
      : originalUrl;

    if (!categories.has(item.category)) {
      categories.set(item.category, []);
    }

    categories.get(item.category).push({
      name: item.baseName,
      original: originalUrl,
      preview: previewUrl,
      category: item.category,
    });
    totalImages += 1;
  }

  const gallery = {};
  for (const [category, images] of categories.entries()) {
    images.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
    gallery[category] = {
      name: category,
      images,
      count: images.length,
    };
  }

  return {
    source: {
      type: "imgbed",
      base_url: sourceConfig.baseUrl,
      list_endpoint: buildAbsoluteUrl(sourceConfig.baseUrl, sourceConfig.listEndpoint),
      random_endpoint: buildAbsoluteUrl(sourceConfig.baseUrl, sourceConfig.randomEndpoint),
      random_orientation: sourceConfig.randomOrientation || "",
      file_route_prefix: sourceConfig.fileRoutePrefix,
      list_dir: sourceConfig.listDir || "/",
      preview_dir: sourceConfig.previewDir,
      mode: "imgbed-api",
    },
    gallery,
    total_images: totalImages,
    generated_at: new Date().toISOString(),
  };
}

function makeCacheKey(domain) {
  return `gallery-data:${domain}`;
}

function makeConfigSignature(sourceConfig) {
  return JSON.stringify({
    baseUrl: sourceConfig.baseUrl,
    listEndpoint: sourceConfig.listEndpoint,
    randomEndpoint: sourceConfig.randomEndpoint,
    randomOrientation: sourceConfig.randomOrientation,
    fileRoutePrefix: sourceConfig.fileRoutePrefix,
    listDir: sourceConfig.listDir,
    previewDir: sourceConfig.previewDir,
    recursive: sourceConfig.recursive,
    pageSize: sourceConfig.pageSize,
    apiToken: sourceConfig.apiToken,
  });
}

export function onRequestOptions() {
  return noContent();
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const domain = normalizeDomain(url.searchParams.get("domain"), pickRequestDomain(request));
  const configResult = await getDomainConfig(env, domain);
  const config = configResult.config;

  if (config.galleryDataMode !== "imgbed-api") {
    return json(
      {
        success: false,
        error: "gallery-mode-disabled",
        message: "当前域名未启用 ImgBed API 动态图库模式。",
      },
      { status: 400 }
    );
  }

  const sourceConfig = buildSourceConfig(config, domain);
  if (!sourceConfig.baseUrl) {
    return json(
      {
        success: false,
        error: "missing-imgbed-base-url",
        message: "未配置 ImgBed 基础地址（imgbed.baseUrl）。",
      },
      { status: 400 }
    );
  }

  if (!sourceConfig.apiToken) {
    return json(
      {
        success: false,
        error: "missing-imgbed-token",
        message: "未配置 ImgBed API Token（imgbed.apiToken）。",
      },
      { status: 400 }
    );
  }

  const cacheKey = makeCacheKey(domain);
  const now = Date.now();
  const signature = makeConfigSignature(sourceConfig);
  const cached = runtimeCache.get(cacheKey);

  if (cached && cached.signature === signature && now - cached.timestamp < CACHE_TTL_MS) {
    return json(
      {
        success: true,
        mode: "imgbed-api",
        cached: true,
        data: cached.data,
      },
      {
        headers: {
          "Cache-Control": "public, max-age=30",
        },
      }
    );
  }

  try {
    const files = await listAllFiles(sourceConfig);
    const payload = buildGalleryPayload(sourceConfig, files);

    runtimeCache.set(cacheKey, {
      signature,
      timestamp: now,
      data: payload,
    });

    return json(
      {
        success: true,
        mode: "imgbed-api",
        cached: false,
        data: payload,
      },
      {
        headers: {
          "Cache-Control": "public, max-age=30",
        },
      }
    );
  } catch (error) {
    return json(
      {
        success: false,
        error: "imgbed-fetch-failed",
        message: error.message || "从 ImgBed 拉取图库数据失败。",
      },
      { status: 502 }
    );
  }
}
