import { getDomainConfig, toPublicConfig } from "../_lib/config-store.js";
import { json, noContent, normalizeDomain, pickRequestDomain } from "../_lib/http.js";

const CACHE_TTL_SECONDS = 60;
const CACHE_STALE_SECONDS = 300;

export function onRequestOptions() {
  return noContent();
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // Cache API 优先：命中时避免重复读取 D1/KV，降低首屏等待时间与数据库压力。
  const cache = caches.default;
  const cacheKey = new Request(url.toString(), { method: "GET" });
  const cached = await cache.match(cacheKey);
  if (cached) {
    const resp = new Response(cached.body, cached);
    resp.headers.set("X-Config-Cache", "HIT");
    return resp;
  }

  const domain = normalizeDomain(url.searchParams.get("domain"), pickRequestDomain(request));
  const configResult = await getDomainConfig(env, domain);

  const response = json(
    {
      success: true,
      domain,
      matchedDomain: configResult.matchedDomain,
      config: toPublicConfig(configResult.config),
      storageBackend: configResult.backend,
    },
    {
      headers: {
        "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}, s-maxage=${CACHE_TTL_SECONDS}, stale-while-revalidate=${CACHE_STALE_SECONDS}`,
      },
    }
  );

  response.headers.set("X-Config-Cache", "MISS");
  context.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}
