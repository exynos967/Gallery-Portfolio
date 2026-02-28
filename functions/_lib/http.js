const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
};

export function json(data, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("Content-Type", "application/json; charset=utf-8");

  if (init.cors !== false) {
    Object.entries(CORS_HEADERS).forEach(([key, value]) => {
      if (!headers.has(key)) {
        headers.set(key, value);
      }
    });
  }

  return new Response(JSON.stringify(data), {
    ...init,
    headers,
  });
}

export function noContent(init = {}) {
  const headers = new Headers(init.headers || {});
  Object.entries(CORS_HEADERS).forEach(([key, value]) => {
    if (!headers.has(key)) {
      headers.set(key, value);
    }
  });

  return new Response(null, {
    status: 204,
    ...init,
    headers,
  });
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export function normalizeDomain(input, fallback = "default") {
  const source = String(input || "").trim();
  if (!source) return fallback;

  try {
    if (source.includes("://")) {
      return new URL(source).host.toLowerCase();
    }
  } catch {
    // ignore invalid URL and fallback to string normalization
  }

  return source
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .toLowerCase();
}

export function pickRequestDomain(request) {
  const url = new URL(request.url);
  const domainFromQuery = url.searchParams.get("domain");
  if (domainFromQuery) {
    return normalizeDomain(domainFromQuery);
  }

  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost) {
    return normalizeDomain(forwardedHost);
  }

  const host = request.headers.get("host") || url.host;
  return normalizeDomain(host);
}
