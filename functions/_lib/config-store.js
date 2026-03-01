const memoryStore = new Map();
const initializedD1 = new WeakSet();

const D1_TABLE_NAME = "gallery_admin_config";
const MAX_IMGBED_PAGE_SIZE = 500;
const MAX_UPLOAD_TEXT_LENGTH = 500;
const VALID_RANDOM_ORIENTATIONS = new Set(["", "auto", "landscape", "portrait", "square"]);
const MAX_SITE_TITLE_LENGTH = 80;
const MAX_SITE_IMAGE_URL_LENGTH = 2048;

const DEFAULT_UPLOAD_MODAL_TITLE = "上传图片";
const DEFAULT_UPLOAD_BUTTON_TEXT = "上传图片";
const DEFAULT_UPLOAD_DESCRIPTION = "请填写图片描述并选择图片后上传。";
const DEFAULT_SITE_TITLE = "Gallery-Portfolio";
const DEFAULT_SITE_IMAGE_URL = "";

function parseBoolean(input, fallbackValue) {
  if (input === undefined || input === null || input === "") return fallbackValue;
  if (typeof input === "boolean") return input;
  const value = String(input).toLowerCase();
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return fallbackValue;
}

export function resolveStorageBackend(env) {
  const fromEnv = String(env.CONFIG_STORE_DRIVER || "").toLowerCase().trim();
  if (fromEnv === "d1") return "d1";
  if (fromEnv === "kv") return "kv";

  if (env.GALLERY_CONFIG_DB) return "d1";
  if (env.GALLERY_CONFIG_KV) return "kv";
  return "memory";
}

async function ensureD1Schema(env) {
  if (!env.GALLERY_CONFIG_DB || initializedD1.has(env.GALLERY_CONFIG_DB)) {
    return;
  }

  await env.GALLERY_CONFIG_DB.prepare(
    `CREATE TABLE IF NOT EXISTS ${D1_TABLE_NAME} (
      domain TEXT PRIMARY KEY,
      config_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`
  ).run();

  initializedD1.add(env.GALLERY_CONFIG_DB);
}

function toPositiveInt(input, fallbackValue, maxValue = Number.MAX_SAFE_INTEGER) {
  const value = Number(input);
  if (!Number.isFinite(value) || value <= 0) return fallbackValue;
  return Math.min(Math.floor(value), maxValue);
}

function normalizeRandomOrientation(input, fallbackValue = "") {
  const normalizedFallback = String(fallbackValue || "").trim().toLowerCase();
  const safeFallback = VALID_RANDOM_ORIENTATIONS.has(normalizedFallback) ? normalizedFallback : "";
  const normalized = String(input || "").trim().toLowerCase();
  if (!normalized) return safeFallback;
  return VALID_RANDOM_ORIENTATIONS.has(normalized) ? normalized : safeFallback;
}

function normalizeImgbedConfig(imgbedConfig = {}, fallbackImgbed = {}) {
  return {
    baseUrl: String(imgbedConfig.baseUrl || fallbackImgbed.baseUrl || "").trim(),
    listEndpoint: String(imgbedConfig.listEndpoint || fallbackImgbed.listEndpoint || "").trim(),
    randomEndpoint: String(imgbedConfig.randomEndpoint || fallbackImgbed.randomEndpoint || "").trim(),
    randomOrientation: normalizeRandomOrientation(
      imgbedConfig.randomOrientation,
      fallbackImgbed.randomOrientation || ""
    ),
    fileRoutePrefix:
      String(imgbedConfig.fileRoutePrefix || fallbackImgbed.fileRoutePrefix || "/file").trim() || "/file",
    apiToken: String(imgbedConfig.apiToken || fallbackImgbed.apiToken || "").trim(),
    listDir: String(imgbedConfig.listDir || fallbackImgbed.listDir || "").trim(),
    previewDir: String(imgbedConfig.previewDir || fallbackImgbed.previewDir || "0_preview").trim() || "0_preview",
    recursive: parseBoolean(imgbedConfig.recursive, parseBoolean(fallbackImgbed.recursive, true)),
    pageSize: toPositiveInt(
      imgbedConfig.pageSize,
      toPositiveInt(fallbackImgbed.pageSize, 200, MAX_IMGBED_PAGE_SIZE),
      MAX_IMGBED_PAGE_SIZE
    ),
  };
}

function normalizeText(input, fallbackValue = "", maxLength = MAX_UPLOAD_TEXT_LENGTH) {
  const text = String(input ?? "").trim();
  const fallback = String(fallbackValue ?? "").trim();
  const value = text || fallback;
  if (!value) return "";
  return value.slice(0, maxLength);
}

function normalizePublicUploadConfig(publicUploadConfig = {}, fallbackPublicUpload = {}) {
  return {
    enabled: parseBoolean(publicUploadConfig.enabled, parseBoolean(fallbackPublicUpload.enabled, false)),
    modalTitle: normalizeText(
      publicUploadConfig.modalTitle,
      fallbackPublicUpload.modalTitle || DEFAULT_UPLOAD_MODAL_TITLE,
      80
    ),
    buttonText: normalizeText(
      publicUploadConfig.buttonText,
      fallbackPublicUpload.buttonText || DEFAULT_UPLOAD_BUTTON_TEXT,
      24
    ),
    description: normalizeText(
      publicUploadConfig.description,
      fallbackPublicUpload.description || DEFAULT_UPLOAD_DESCRIPTION,
      MAX_UPLOAD_TEXT_LENGTH
    ),
  };
}

function normalizeSiteConfig(siteConfig = {}, fallbackSite = {}) {
  return {
    title: normalizeText(siteConfig.title, fallbackSite.title || DEFAULT_SITE_TITLE, MAX_SITE_TITLE_LENGTH),
    imageUrl: normalizeText(siteConfig.imageUrl, fallbackSite.imageUrl || DEFAULT_SITE_IMAGE_URL, MAX_SITE_IMAGE_URL_LENGTH),
  };
}

function toStoredConfig(domain, config, nowIso) {
  return {
    domain,
    displayMode: config.displayMode === "waterfall" ? "waterfall" : "fullscreen",
    shuffleEnabled: parseBoolean(config.shuffleEnabled, true),
    galleryDataMode: String(config.galleryDataMode || "static").toLowerCase() === "imgbed-api" ? "imgbed-api" : "static",
    galleryIndexUrl: String(config.galleryIndexUrl || "").trim(),
    site: normalizeSiteConfig(config.site),
    imgbed: normalizeImgbedConfig(config.imgbed),
    publicUpload: normalizePublicUploadConfig(config.publicUpload),
    updatedAt: nowIso,
  };
}

function makeDefaultConfig(env) {
  return {
    displayMode: String(env.DEFAULT_DISPLAY_MODE || "fullscreen").toLowerCase() === "waterfall" ? "waterfall" : "fullscreen",
    shuffleEnabled: parseBoolean(env.DEFAULT_SHUFFLE_ENABLED, true),
    galleryDataMode:
      String(env.DEFAULT_GALLERY_DATA_MODE || "static").toLowerCase() === "imgbed-api" ? "imgbed-api" : "static",
    galleryIndexUrl: String(env.DEFAULT_GALLERY_INDEX_URL || "").trim(),
    site: normalizeSiteConfig(
      {
        title: env.DEFAULT_SITE_TITLE,
        imageUrl: env.DEFAULT_SITE_IMAGE_URL,
      },
      {
        title: DEFAULT_SITE_TITLE,
        imageUrl: DEFAULT_SITE_IMAGE_URL,
      }
    ),
    imgbed: normalizeImgbedConfig(
      {
        baseUrl: env.DEFAULT_IMGBED_BASE_URL,
        listEndpoint: env.DEFAULT_IMGBED_LIST_ENDPOINT,
        randomEndpoint: env.DEFAULT_IMGBED_RANDOM_ENDPOINT,
        randomOrientation: env.DEFAULT_IMGBED_RANDOM_ORIENTATION,
        fileRoutePrefix: env.DEFAULT_IMGBED_FILE_ROUTE_PREFIX,
        apiToken: env.DEFAULT_IMGBED_API_TOKEN,
        listDir: env.DEFAULT_IMGBED_LIST_DIR,
        previewDir: env.DEFAULT_IMGBED_PREVIEW_DIR,
        recursive: env.DEFAULT_IMGBED_RECURSIVE,
        pageSize: env.DEFAULT_IMGBED_PAGE_SIZE,
      },
      {}
    ),
    publicUpload: normalizePublicUploadConfig(
      {
        enabled: env.DEFAULT_PUBLIC_UPLOAD_ENABLED,
        modalTitle: env.DEFAULT_PUBLIC_UPLOAD_MODAL_TITLE,
        buttonText: env.DEFAULT_PUBLIC_UPLOAD_BUTTON_TEXT,
        description: env.DEFAULT_PUBLIC_UPLOAD_DESCRIPTION,
      },
      {
        enabled: false,
        modalTitle: DEFAULT_UPLOAD_MODAL_TITLE,
        buttonText: DEFAULT_UPLOAD_BUTTON_TEXT,
        description: DEFAULT_UPLOAD_DESCRIPTION,
      }
    ),
  };
}

function parseStoredConfig(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function readStoredConfigByDomain(env, backend, domain) {
  if (!domain) return null;

  if (backend === "d1" && env.GALLERY_CONFIG_DB) {
    await ensureD1Schema(env);
    const row = await env.GALLERY_CONFIG_DB.prepare(
      `SELECT config_json FROM ${D1_TABLE_NAME} WHERE domain = ?1 LIMIT 1`
    )
      .bind(domain)
      .first();
    return parseStoredConfig(row?.config_json);
  }

  if (backend === "kv" && env.GALLERY_CONFIG_KV) {
    const raw = await env.GALLERY_CONFIG_KV.get(`domain:${domain}`);
    return parseStoredConfig(raw);
  }

  return memoryStore.get(domain) || null;
}

function buildDomainCandidates(domain) {
  const normalized = String(domain || "").trim().toLowerCase();
  if (!normalized) return ["default"];

  const candidates = [normalized];

  if (normalized !== "default") {
    if (normalized.startsWith("www.") && normalized.length > 4) {
      candidates.push(normalized.slice(4));
    } else {
      candidates.push(`www.${normalized}`);
    }
    candidates.push("default");
  }

  return [...new Set(candidates)];
}

export async function getDomainConfig(env, domain) {
  const backend = resolveStorageBackend(env);
  let stored = null;
  let matchedDomain = null;
  const domainCandidates = buildDomainCandidates(domain);

  for (const candidate of domainCandidates) {
    stored = await readStoredConfigByDomain(env, backend, candidate);
    if (stored) {
      matchedDomain = candidate;
      break;
    }
  }

  const defaults = makeDefaultConfig(env);
  const merged = {
    ...defaults,
    ...(stored || {}),
    site: normalizeSiteConfig(stored?.site, defaults.site),
    imgbed: normalizeImgbedConfig(stored?.imgbed, defaults.imgbed),
    publicUpload: normalizePublicUploadConfig(stored?.publicUpload, defaults.publicUpload),
  };

  return {
    backend,
    config: merged,
    existed: Boolean(stored),
    matchedDomain,
  };
}

export async function saveDomainConfig(env, domain, configInput) {
  const backend = resolveStorageBackend(env);
  const nowIso = new Date().toISOString();
  const config = toStoredConfig(domain, configInput, nowIso);
  const payload = JSON.stringify(config);

  if (backend === "d1" && env.GALLERY_CONFIG_DB) {
    await ensureD1Schema(env);
    await env.GALLERY_CONFIG_DB.prepare(
      `INSERT INTO ${D1_TABLE_NAME} (domain, config_json, updated_at)
       VALUES (?1, ?2, ?3)
       ON CONFLICT(domain) DO UPDATE SET
         config_json = excluded.config_json,
         updated_at = excluded.updated_at`
    )
      .bind(domain, payload, nowIso)
      .run();
  } else if (backend === "kv" && env.GALLERY_CONFIG_KV) {
    await env.GALLERY_CONFIG_KV.put(`domain:${domain}`, payload);
  } else {
    memoryStore.set(domain, config);
  }

  return {
    backend,
    config,
  };
}

export function toPublicConfig(config = {}) {
  return {
    displayMode: config.displayMode === "waterfall" ? "waterfall" : "fullscreen",
    shuffleEnabled: parseBoolean(config.shuffleEnabled, true),
    galleryDataMode: String(config.galleryDataMode || "static").toLowerCase() === "imgbed-api" ? "imgbed-api" : "static",
    galleryIndexUrl: String(config.galleryIndexUrl || "").trim(),
    site: normalizeSiteConfig(config.site, {
      title: DEFAULT_SITE_TITLE,
      imageUrl: DEFAULT_SITE_IMAGE_URL,
    }),
    imgbed: {
      baseUrl: String(config.imgbed?.baseUrl || "").trim(),
      listEndpoint: String(config.imgbed?.listEndpoint || "").trim(),
      randomEndpoint: String(config.imgbed?.randomEndpoint || "").trim(),
      randomOrientation: normalizeRandomOrientation(config.imgbed?.randomOrientation, ""),
      fileRoutePrefix: String(config.imgbed?.fileRoutePrefix || "/file").trim() || "/file",
      listDir: String(config.imgbed?.listDir || "").trim(),
      previewDir: String(config.imgbed?.previewDir || "0_preview").trim() || "0_preview",
      recursive: parseBoolean(config.imgbed?.recursive, true),
      pageSize: toPositiveInt(config.imgbed?.pageSize, 200, MAX_IMGBED_PAGE_SIZE),
    },
    publicUpload: normalizePublicUploadConfig(config.publicUpload, {
      enabled: false,
      modalTitle: DEFAULT_UPLOAD_MODAL_TITLE,
      buttonText: DEFAULT_UPLOAD_BUTTON_TEXT,
      description: DEFAULT_UPLOAD_DESCRIPTION,
    }),
  };
}
