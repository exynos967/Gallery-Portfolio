import { requireAdmin } from "../../_lib/admin-auth.js";
import { getDomainConfig } from "../../_lib/config-store.js";
import { json, noContent, normalizeDomain, pickRequestDomain, readJson } from "../../_lib/http.js";

const MAX_FILES_LIMIT = 10000;
const MAX_PAGES = 120;

function toPositiveInt(input, fallbackValue, maxValue = Number.MAX_SAFE_INTEGER) {
  const value = Number(input);
  if (!Number.isFinite(value) || value <= 0) return fallbackValue;
  return Math.min(Math.floor(value), maxValue);
}

function normalizeDirPath(input) {
  return String(input || "")
    .trim()
    .replace(/^\/+|\/+$/g, "");
}

function sanitizeImgbedInput(imgbed = {}) {
  return {
    baseUrl: String(imgbed.baseUrl || "").trim(),
    listEndpoint: String(imgbed.listEndpoint || "").trim(),
    fileRoutePrefix: String(imgbed.fileRoutePrefix || "").trim(),
    apiToken: String(imgbed.apiToken || "").trim(),
    listDir: normalizeDirPath(imgbed.listDir),
    recursive: imgbed.recursive === undefined ? undefined : Boolean(imgbed.recursive),
    pageSize: toPositiveInt(imgbed.pageSize, undefined, 500),
  };
}

function mergeImgbedConfig(storedImgbed = {}, overrideImgbed = {}) {
  const recursiveFallback = storedImgbed.recursive === undefined ? true : Boolean(storedImgbed.recursive);

  return {
    baseUrl: String(overrideImgbed.baseUrl || storedImgbed.baseUrl || "").trim(),
    listEndpoint:
      String(overrideImgbed.listEndpoint || storedImgbed.listEndpoint || "/api/manage/list").trim() || "/api/manage/list",
    fileRoutePrefix:
      String(overrideImgbed.fileRoutePrefix || storedImgbed.fileRoutePrefix || "/file").trim() || "/file",
    apiToken: String(overrideImgbed.apiToken || storedImgbed.apiToken || "").trim(),
    listDir: normalizeDirPath(overrideImgbed.listDir || storedImgbed.listDir || ""),
    recursive: overrideImgbed.recursive === undefined ? recursiveFallback : Boolean(overrideImgbed.recursive),
    pageSize: toPositiveInt(overrideImgbed.pageSize, toPositiveInt(storedImgbed.pageSize, 200, 500), 500),
  };
}

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
  const cleanDir = normalizeDirPath(listDir);
  if (!cleanDir) return normalizedPath;
  if (normalizedPath === cleanDir) return "";
  if (normalizedPath.startsWith(`${cleanDir}/`)) {
    return normalizedPath.slice(cleanDir.length + 1);
  }
  return normalizedPath;
}

function toAuthHeader(token) {
  if (!token) return "";
  return token.toLowerCase().startsWith("bearer ") ? token : `Bearer ${token}`;
}

async function listAllFiles(sourceConfig) {
  const allFiles = [];
  let start = 0;
  let page = 1;

  while (allFiles.length < MAX_FILES_LIMIT && page <= MAX_PAGES) {
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
    const authHeader = toAuthHeader(sourceConfig.apiToken);
    if (authHeader) {
      headers.Authorization = authHeader;
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
  }

  return allFiles.slice(0, MAX_FILES_LIMIT);
}

function extractDirectoriesFromFiles(files, sourceConfig) {
  const directories = new Set();

  for (const item of files) {
    const rawPath = item?.name || item?.path || item?.src || "";
    const normalizedPath = normalizeListedPath(rawPath, sourceConfig.fileRoutePrefix);
    if (!normalizedPath) continue;

    const pathWithoutDir = stripDirPrefix(normalizedPath, sourceConfig.listDir);
    if (!pathWithoutDir) continue;

    const parts = pathWithoutDir.split("/").filter(Boolean);
    if (parts.length <= 1) continue;

    for (let index = 1; index < parts.length; index += 1) {
      directories.add(parts.slice(0, index).join("/"));
    }
  }

  return Array.from(directories).sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function buildDirectoryTree(directoryPaths) {
  const root = {
    name: "",
    path: "",
    children: [],
  };

  const nodeMap = new Map([["", root]]);

  for (const dirPath of directoryPaths) {
    const parts = dirPath.split("/").filter(Boolean);
    let parentPath = "";

    for (const part of parts) {
      const currentPath = parentPath ? `${parentPath}/${part}` : part;
      if (!nodeMap.has(currentPath)) {
        const parentNode = nodeMap.get(parentPath);
        const node = {
          name: part,
          path: currentPath,
          children: [],
        };
        parentNode.children.push(node);
        nodeMap.set(currentPath, node);
      }
      parentPath = currentPath;
    }
  }

  const sortTree = (node) => {
    node.children.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
    node.children.forEach(sortTree);
  };
  sortTree(root);

  return root;
}

export function onRequestOptions() {
  return noContent();
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const authResult = await requireAdmin(request, env);
  if (!authResult.ok) {
    return authResult.response;
  }

  const body = await readJson(request);
  const domain = normalizeDomain(body?.domain, pickRequestDomain(request));
  const configResult = await getDomainConfig(env, domain);
  const sourceConfig = mergeImgbedConfig(
    configResult?.config?.imgbed || {},
    sanitizeImgbedInput(body?.imgbed || body?.config?.imgbed || {})
  );

  if (!sourceConfig.baseUrl) {
    return json(
      {
        success: false,
        error: "missing-imgbed-base-url",
        message: "请先配置 ImgBed 基础地址（baseUrl）。",
      },
      { status: 400 }
    );
  }

  try {
    const files = await listAllFiles(sourceConfig);
    const directories = extractDirectoriesFromFiles(files, sourceConfig);
    const tree = buildDirectoryTree(directories);

    return json({
      success: true,
      data: {
        domain,
        sourceListDir: sourceConfig.listDir || "",
        fileCount: files.length,
        directoryCount: directories.length,
        tree,
      },
    });
  } catch (error) {
    return json(
      {
        success: false,
        error: "imgbed-directory-fetch-failed",
        message: `获取目录失败：${error.message}`,
      },
      { status: 502 }
    );
  }
}
