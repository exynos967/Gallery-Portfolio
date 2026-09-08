import { json } from "./http.js";

const DEFAULT_SESSION_HOURS = 24;

function toBase64Url(input) {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(input) {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (input.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function bytesToHex(buffer) {
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(value) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return bytesToHex(digest);
}

async function hmacHex(secret, value) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return bytesToHex(signature);
}

function secureEqual(a, b) {
  const left = String(a ?? "");
  const right = String(b ?? "");
  if (left.length !== right.length) return false;

  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return result === 0;
}

export function getAdminUsername(env) {
  return String(env.ADMIN_USERNAME || "").trim();
}

export function adminAuthConfigurationError(env) {
  const passwordHash = String(env.ADMIN_PASSWORD_SHA256 || "").trim();
  const hasPassword = passwordHash
    ? /^[a-f0-9]{64}$/i.test(passwordHash)
    : Boolean(String(env.ADMIN_PASSWORD || "").trim());
  if (getAdminUsername(env) && hasPassword && getSessionSecret(env)) return null;

  return json(
    {
      success: false,
      error: "admin-auth-not-configured",
      message: "管理员认证配置不完整，请设置 ADMIN_USERNAME、ADMIN_PASSWORD（或有效的 ADMIN_PASSWORD_SHA256）及 ADMIN_SESSION_SECRET。",
    },
    { status: 503 }
  );
}

export async function verifyAdminCredentials(env, username, password) {
  if (adminAuthConfigurationError(env)) return false;
  const expectedUser = getAdminUsername(env);
  if (!secureEqual(username, expectedUser)) {
    return false;
  }

  const expectedPasswordHash = String(env.ADMIN_PASSWORD_SHA256 || "").trim().toLowerCase();
  if (expectedPasswordHash) {
    const providedHash = (await sha256Hex(String(password || ""))).toLowerCase();
    return secureEqual(providedHash, expectedPasswordHash);
  }

  const expectedPassword = String(env.ADMIN_PASSWORD || "");
  return secureEqual(String(password || ""), expectedPassword);
}

function getSessionSecret(env) {
  return String(env.ADMIN_SESSION_SECRET || "").trim();
}

function getSessionHours(env) {
  const hours = Number(env.ADMIN_SESSION_HOURS || DEFAULT_SESSION_HOURS);
  if (!Number.isFinite(hours) || hours <= 0) return DEFAULT_SESSION_HOURS;
  return Math.min(hours, 24 * 30);
}

export async function issueAdminToken(env, username) {
  if (adminAuthConfigurationError(env)) {
    throw new Error("管理员认证配置不完整，无法签发令牌。");
  }
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + getSessionHours(env) * 3600;
  const payload = {
    u: username,
    iat: now,
    exp: expiresAt,
  };

  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signature = await hmacHex(getSessionSecret(env), encodedPayload);
  return {
    token: `${encodedPayload}.${signature}`,
    expiresAt,
  };
}

export async function verifyAdminToken(env, token) {
  if (adminAuthConfigurationError(env)) {
    return { valid: false, reason: "admin-auth-not-configured" };
  }
  const rawToken = String(token || "").trim();
  if (!rawToken.includes(".")) {
    return { valid: false, reason: "invalid-token-format" };
  }

  const [encodedPayload, signature, extra] = rawToken.split(".");
  if (!encodedPayload || !signature || extra !== undefined) {
    return { valid: false, reason: "invalid-token-format" };
  }

  const expectedSignature = await hmacHex(getSessionSecret(env), encodedPayload);
  if (!secureEqual(signature, expectedSignature)) {
    return { valid: false, reason: "invalid-signature" };
  }

  let payload;
  try {
    payload = JSON.parse(fromBase64Url(encodedPayload));
  } catch {
    return { valid: false, reason: "invalid-payload" };
  }

  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(payload?.exp) || payload.exp <= now) {
    return { valid: false, reason: "token-expired" };
  }

  if (payload.u !== getAdminUsername(env)) {
    return { valid: false, reason: "invalid-user" };
  }

  return { valid: true, payload };
}

export function readBearerToken(request) {
  const authHeader = request.headers.get("Authorization") || "";
  if (!authHeader) return "";

  if (authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice(7).trim();
  }
  return authHeader.trim();
}

export async function requireAdmin(request, env) {
  const configurationError = adminAuthConfigurationError(env);
  if (configurationError) return { ok: false, response: configurationError };

  const token = readBearerToken(request);
  if (!token) {
    return {
      ok: false,
      response: json(
        {
          success: false,
          error: "unauthorized",
          message: "缺少管理员令牌，请先登录。",
        },
        { status: 401 }
      ),
    };
  }

  const verified = await verifyAdminToken(env, token);
  if (!verified.valid) {
    return {
      ok: false,
      response: json(
        {
          success: false,
          error: "unauthorized",
          message: "管理员令牌无效或已过期，请重新登录。",
          reason: verified.reason,
        },
        { status: 401 }
      ),
    };
  }

  return {
    ok: true,
    username: verified.payload.u,
  };
}
