const memoryStore = new Map();
const initializedD1 = new WeakSet();

const D1_TABLE_NAME = "gallery_admin_config";
const MAX_IMGBED_PAGE_SIZE = 500;

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

function normalizeImgbedConfig(imgbedConfig = {}, fallbackImgbed = {}) {
  return {
    baseUrl: String(imgbedConfig.baseUrl || fallbackImgbed.baseUrl || "").trim(),
    listEndpoint: String(imgbedConfig.listEndpoint || fallbackImgbed.listEndpoint || "").trim(),
    randomEndpoint: String(imgbedConfig.randomEndpoint || fallbackImgbed.randomEndpoint || "").trim(),
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

function toStoredConfig(domain, config, nowIso) {
  return {
    domain,
    displayMode: config.displayMode === "waterfall" ? "waterfall" : "fullscreen",
    shuffleEnabled: parseBoolean(config.shuffleEnabled, true),
    galleryDataMode: String(config.galleryDataMode || "static").toLowerCase() === "imgbed-api" ? "imgbed-api" : "static",
    galleryIndexUrl: String(config.galleryIndexUrl || "").trim(),
    imgbed: normalizeImgbedConfig(config.imgbed),
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
    imgbed: normalizeImgbedConfig(
      {
        baseUrl: env.DEFAULT_IMGBED_BASE_URL,
        listEndpoint: env.DEFAULT_IMGBED_LIST_ENDPOINT,
        randomEndpoint: env.DEFAULT_IMGBED_RANDOM_ENDPOINT,
        fileRoutePrefix: env.DEFAULT_IMGBED_FILE_ROUTE_PREFIX,
        apiToken: env.DEFAULT_IMGBED_API_TOKEN,
        listDir: env.DEFAULT_IMGBED_LIST_DIR,
        previewDir: env.DEFAULT_IMGBED_PREVIEW_DIR,
        recursive: env.DEFAULT_IMGBED_RECURSIVE,
        pageSize: env.DEFAULT_IMGBED_PAGE_SIZE,
      },
      {}
    ),
  };
}

export async function getDomainConfig(env, domain) {
  const backend = resolveStorageBackend(env);
  let stored = null;

  if (backend === "d1" && env.GALLERY_CONFIG_DB) {
    await ensureD1Schema(env);
    const row = await env.GALLERY_CONFIG_DB.prepare(
      `SELECT config_json FROM ${D1_TABLE_NAME} WHERE domain = ?1 LIMIT 1`
    )
      .bind(domain)
      .first();
    if (row?.config_json) {
      try {
        stored = JSON.parse(row.config_json);
      } catch {
        stored = null;
      }
    }
  } else if (backend === "kv" && env.GALLERY_CONFIG_KV) {
    const raw = await env.GALLERY_CONFIG_KV.get(`domain:${domain}`);
    if (raw) {
      try {
        stored = JSON.parse(raw);
      } catch {
        stored = null;
      }
    }
  } else {
    stored = memoryStore.get(domain) || null;
  }

  const defaults = makeDefaultConfig(env);
  const merged = {
    ...defaults,
    ...(stored || {}),
    imgbed: normalizeImgbedConfig(stored?.imgbed, defaults.imgbed),
  };

  return {
    backend,
    config: merged,
    existed: Boolean(stored),
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
    imgbed: {
      baseUrl: String(config.imgbed?.baseUrl || "").trim(),
      listEndpoint: String(config.imgbed?.listEndpoint || "").trim(),
      randomEndpoint: String(config.imgbed?.randomEndpoint || "").trim(),
      fileRoutePrefix: String(config.imgbed?.fileRoutePrefix || "/file").trim() || "/file",
      listDir: String(config.imgbed?.listDir || "").trim(),
      previewDir: String(config.imgbed?.previewDir || "0_preview").trim() || "0_preview",
      recursive: parseBoolean(config.imgbed?.recursive, true),
      pageSize: toPositiveInt(config.imgbed?.pageSize, 200, MAX_IMGBED_PAGE_SIZE),
    },
  };
}
