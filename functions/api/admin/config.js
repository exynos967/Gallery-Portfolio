import { requireAdmin } from "../../_lib/admin-auth.js";
import { getDomainConfig, saveDomainConfig } from "../../_lib/config-store.js";
import { json, noContent, normalizeDomain, pickRequestDomain, readJson } from "../../_lib/http.js";

const VALID_RANDOM_ORIENTATIONS = new Set(["", "auto", "landscape", "portrait", "square"]);
const MAX_SITE_TITLE_LENGTH = 80;
const MAX_SITE_IMAGE_URL_LENGTH = 2048;

function normalizeRandomOrientation(input) {
  const normalized = String(input || "").trim().toLowerCase();
  if (!normalized) return "";
  return VALID_RANDOM_ORIENTATIONS.has(normalized) ? normalized : "";
}

function sanitizeInputConfig(config) {
  const displayMode = String(config?.displayMode || "").toLowerCase() === "waterfall" ? "waterfall" : "fullscreen";
  const shuffleEnabled = config?.shuffleEnabled === undefined ? true : Boolean(config.shuffleEnabled);
  const galleryDataMode =
    String(config?.galleryDataMode || "").toLowerCase() === "imgbed-api" ? "imgbed-api" : "static";
  const galleryIndexUrl = String(config?.galleryIndexUrl || "").trim();
  const siteTitle = String(config?.site?.title || "").trim();
  const siteImageUrl = String(config?.site?.imageUrl || "").trim();
  const pageSize = Number(config?.imgbed?.pageSize);
  const publicUploadDescription = String(config?.publicUpload?.description || "").trim();
  const publicUploadModalTitle = String(config?.publicUpload?.modalTitle || "").trim();
  const publicUploadButtonText = String(config?.publicUpload?.buttonText || "").trim();

  return {
    displayMode,
    shuffleEnabled,
    galleryDataMode,
    galleryIndexUrl,
    site: {
      title: siteTitle.slice(0, MAX_SITE_TITLE_LENGTH),
      imageUrl: siteImageUrl.slice(0, MAX_SITE_IMAGE_URL_LENGTH),
    },
    imgbed: {
      baseUrl: String(config?.imgbed?.baseUrl || "").trim(),
      listEndpoint: String(config?.imgbed?.listEndpoint || "").trim(),
      randomEndpoint: String(config?.imgbed?.randomEndpoint || "").trim(),
      randomOrientation: normalizeRandomOrientation(config?.imgbed?.randomOrientation),
      fileRoutePrefix: String(config?.imgbed?.fileRoutePrefix || "/file").trim() || "/file",
      apiToken: String(config?.imgbed?.apiToken || "").trim(),
      listDir: String(config?.imgbed?.listDir || "").trim(),
      previewDir: String(config?.imgbed?.previewDir || "0_preview").trim() || "0_preview",
      recursive: config?.imgbed?.recursive === undefined ? true : Boolean(config.imgbed.recursive),
      pageSize: Number.isFinite(pageSize) && pageSize > 0 ? Math.min(Math.floor(pageSize), 500) : 200,
    },
    publicUpload: {
      enabled: config?.publicUpload?.enabled === undefined ? false : Boolean(config.publicUpload.enabled),
      modalTitle: publicUploadModalTitle.slice(0, 80),
      buttonText: publicUploadButtonText.slice(0, 24),
      description: publicUploadDescription.slice(0, 500),
    },
  };
}

export function onRequestOptions() {
  return noContent();
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const authResult = await requireAdmin(request, env);
  if (!authResult.ok) {
    return authResult.response;
  }

  const domain = normalizeDomain(new URL(request.url).searchParams.get("domain"), pickRequestDomain(request));
  const configResult = await getDomainConfig(env, domain);

  return json({
    success: true,
    data: {
      domain,
      matchedDomain: configResult.matchedDomain,
      config: configResult.config,
      storageBackend: configResult.backend,
      existed: configResult.existed,
    },
  });
}

export async function onRequestPut(context) {
  const { request, env } = context;
  const authResult = await requireAdmin(request, env);
  if (!authResult.ok) {
    return authResult.response;
  }

  const body = await readJson(request);
  const domain = normalizeDomain(body?.domain, pickRequestDomain(request));
  const config = sanitizeInputConfig(body?.config || {});

  const saved = await saveDomainConfig(env, domain, config);
  return json({
    success: true,
    data: {
      domain,
      config: saved.config,
      storageBackend: saved.backend,
      updatedBy: authResult.username,
    },
  });
}
