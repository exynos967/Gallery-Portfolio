import { requireAdmin } from "../../_lib/admin-auth.js";
import { getDomainConfig, saveDomainConfig } from "../../_lib/config-store.js";
import { json, noContent, normalizeDomain, pickRequestDomain, readJson } from "../../_lib/http.js";

function sanitizeInputConfig(config) {
  const displayMode = String(config?.displayMode || "").toLowerCase() === "waterfall" ? "waterfall" : "fullscreen";
  const shuffleEnabled = config?.shuffleEnabled === undefined ? true : Boolean(config.shuffleEnabled);
  const galleryDataMode =
    String(config?.galleryDataMode || "").toLowerCase() === "imgbed-api" ? "imgbed-api" : "static";
  const galleryIndexUrl = String(config?.galleryIndexUrl || "").trim();
  const pageSize = Number(config?.imgbed?.pageSize);

  return {
    displayMode,
    shuffleEnabled,
    galleryDataMode,
    galleryIndexUrl,
    imgbed: {
      baseUrl: String(config?.imgbed?.baseUrl || "").trim(),
      listEndpoint: String(config?.imgbed?.listEndpoint || "").trim(),
      randomEndpoint: String(config?.imgbed?.randomEndpoint || "").trim(),
      fileRoutePrefix: String(config?.imgbed?.fileRoutePrefix || "/file").trim() || "/file",
      apiToken: String(config?.imgbed?.apiToken || "").trim(),
      listDir: String(config?.imgbed?.listDir || "").trim(),
      previewDir: String(config?.imgbed?.previewDir || "0_preview").trim() || "0_preview",
      recursive: config?.imgbed?.recursive === undefined ? true : Boolean(config.imgbed.recursive),
      pageSize: Number.isFinite(pageSize) && pageSize > 0 ? Math.min(Math.floor(pageSize), 500) : 200,
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
