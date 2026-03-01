import { getDomainConfig } from "../_lib/config-store.js";
import { noContent, normalizeDomain } from "../_lib/http.js";

// 允许代理的图片 MIME 类型
const ALLOWED_MIME_PREFIXES = ["image/"];

// 代理缓存时间（7 天）
const PROXY_CACHE_TTL = 7 * 24 * 60 * 60;

// 客户端缓存时间（1 天）
const CLIENT_CACHE_TTL = 86400;

// 请求上游超时（15 秒）
const UPSTREAM_TIMEOUT_MS = 15000;

// 最大允许代理的文件大小（50 MB）
const MAX_BODY_BYTES = 50 * 1024 * 1024;

// 域名配置缓存（降低 D1/KV 读取频率）
const DOMAIN_CONFIG_TTL_MS = 60 * 1000;
const domainConfigCache = new Map();
const domainConfigInflight = new Map();

export function onRequestOptions() {
  return noContent();
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // 0. Cache API 优先：命中时直接返回，避免任何 D1/KV 读取。
  // 同时忽略 ?domain= 参与缓存 key，防止人为制造缓存碎片。
  const cacheKeyUrl = new URL(url.toString());
  cacheKeyUrl.searchParams.delete("domain");
  const cacheKey = new Request(cacheKeyUrl.toString(), { method: "GET" });
  const cache = caches.default;
  const cachedResponse = await cache.match(cacheKey);
  if (cachedResponse) {
    const resp = new Response(cachedResponse.body, cachedResponse);
    resp.headers.set("X-Proxy-Cache", "HIT");
    return resp;
  }

  // 1. 提取 ?url= 参数作为需要代理的图片地址
  const targetUrl = url.searchParams.get("url");
  if (!targetUrl) {
    return errorResponse(400, "缺少 url 参数");
  }

  // 2. 校验目标 URL 格式
  let parsedTarget;
  try {
    parsedTarget = new URL(targetUrl);
  } catch {
    return errorResponse(400, "无效的 url 参数");
  }
  if (!/^https?:$/i.test(parsedTarget.protocol)) {
    return errorResponse(400, "仅支持 HTTP/HTTPS 协议");
  }

  // 3. 校验目标域名是否为配置的图床域名（安全策略）
  // 注意：此接口不接受 ?domain= 覆盖，严格以请求 Host 作为域名配置来源。
  const domain = pickRequestHostDomain(request);
  const configResult = await getDomainConfigCached(env, domain);
  const config = configResult.config;

  const imgbedBaseUrl = String(
    config.imgbed?.baseUrl || config.imgbed?.base_url || ""
  ).trim();

  if (!imgbedBaseUrl) {
    return errorResponse(400, "未配置图床基础地址");
  }

  let imgbedHost;
  try {
    imgbedHost = new URL(imgbedBaseUrl).host.toLowerCase();
  } catch {
    return errorResponse(500, "图床基础地址格式错误");
  }

  if (parsedTarget.host.toLowerCase() !== imgbedHost) {
    return errorResponse(403, "目标域名不在允许的图床范围内");
  }

  // 4. 从上游拉取图片
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  let upstream;
  try {
    upstream = await fetch(targetUrl, {
      method: "GET",
      headers: {
        Accept: "image/*,*/*;q=0.8",
        "User-Agent": "Gallery-Portfolio-Proxy/1.0",
      },
      signal: controller.signal,
      redirect: "follow",
    });
  } catch (err) {
    clearTimeout(timer);
    const msg =
      err.name === "AbortError" ? "上游请求超时" : `上游请求失败: ${err.message}`;
    return errorResponse(502, msg);
  } finally {
    clearTimeout(timer);
  }

  if (!upstream.ok) {
    return errorResponse(upstream.status, `上游返回 HTTP ${upstream.status}`);
  }

  // 5. 校验内容类型
  const contentType = (upstream.headers.get("content-type") || "").toLowerCase();
  const isImage = ALLOWED_MIME_PREFIXES.some((prefix) =>
    contentType.startsWith(prefix)
  );
  if (!isImage) {
    return errorResponse(403, "上游返回的不是图片类型");
  }

  // 6. 校验内容大小
  const contentLength = upstream.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_BODY_BYTES) {
    return errorResponse(413, "图片文件过大");
  }

  // 7. 构建响应并写入缓存
  const responseHeaders = new Headers();
  responseHeaders.set("Content-Type", contentType);
  responseHeaders.set(
    "Cache-Control",
    `public, max-age=${CLIENT_CACHE_TTL}, s-maxage=${PROXY_CACHE_TTL}`
  );
  responseHeaders.set("X-Proxy-Cache", "MISS");
  responseHeaders.set("Access-Control-Allow-Origin", "*");

  // 保留上游的 content-length
  if (contentLength) {
    responseHeaders.set("Content-Length", contentLength);
  }

  // 保留 ETag 用于条件请求
  const etag = upstream.headers.get("etag");
  if (etag) {
    responseHeaders.set("ETag", etag);
  }

  const body = upstream.body;
  const response = new Response(body, {
    status: 200,
    headers: responseHeaders,
  });

  // 异步写入 Cache API（不阻塞响应）
  context.waitUntil(cache.put(cacheKey, response.clone()));

  return response;
}

function pickRequestHostDomain(request) {
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost) {
    return normalizeDomain(forwardedHost);
  }

  const host = request.headers.get("host") || new URL(request.url).host;
  return normalizeDomain(host);
}

async function getDomainConfigCached(env, domain) {
  const now = Date.now();
  const cached = domainConfigCache.get(domain);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const inflight = domainConfigInflight.get(domain);
  if (inflight) {
    return inflight;
  }

  const promise = (async () => {
    try {
      const result = await getDomainConfig(env, domain);
      domainConfigCache.set(domain, {
        expiresAt: now + DOMAIN_CONFIG_TTL_MS,
        value: result,
      });
      return result;
    } finally {
      domainConfigInflight.delete(domain);
    }
  })();

  domainConfigInflight.set(domain, promise);
  return promise;
}

function errorResponse(status, message) {
  return new Response(JSON.stringify({ success: false, message }), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
