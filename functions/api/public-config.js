import { getDomainConfig, toPublicConfig } from "../_lib/config-store.js";
import { json, noContent, normalizeDomain, pickRequestDomain } from "../_lib/http.js";

export function onRequestOptions() {
  return noContent();
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const domain = normalizeDomain(url.searchParams.get("domain"), pickRequestDomain(request));
  const configResult = await getDomainConfig(env, domain);

  return json(
    {
      success: true,
      domain,
      matchedDomain: configResult.matchedDomain,
      config: toPublicConfig(configResult.config),
      storageBackend: configResult.backend,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
