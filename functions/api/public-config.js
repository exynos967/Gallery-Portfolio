import { getDomainConfig, toPublicConfig } from "../_lib/config-store.js";
import { json, noContent, normalizeDomain, pickRequestDomain } from "../_lib/http.js";

export function onRequestOptions() {
  return noContent();
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

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
        "Cache-Control": "public, max-age=60, s-maxage=60",
      },
    }
  );

  // 异步写入 Cache API（不阻塞响应），降低 D1/KV 调用频率。
  const finalResponse = new Response(response.body, response);
  finalResponse.headers.set("X-Config-Cache", "MISS");
  context.waitUntil(cache.put(cacheKey, finalResponse.clone()));

  return finalResponse;
}
