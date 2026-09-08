import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { issueAdminToken, requireAdmin, verifyAdminToken } from "../functions/_lib/admin-auth.js";
import { onRequestPost as login } from "../functions/api/admin/login.js";
import { onRequestGet as readConfig, onRequestPut as writeConfig } from "../functions/api/admin/config.js";
import { onRequestPost as directories } from "../functions/api/admin/directories.js";
import { onRequestGet as publicConfig } from "../functions/api/public-config.js";
import { onRequestGet as galleryData } from "../functions/api/gallery-data.js";

const credentials = {
  ADMIN_USERNAME: "test-admin",
  ADMIN_PASSWORD: "unit-test-password",
  ADMIN_SESSION_SECRET: "unit-test-session-secret",
};

function makeEnv(overrides = {}) {
  const values = new Map();
  return {
    ...credentials,
    GALLERY_CONFIG_KV: {
      async get(key) { return values.get(key) ?? null; },
      async put(key, value) { values.set(key, value); },
    },
    ...overrides,
  };
}

function request(path, { method = "GET", body, token } = {}) {
  return new Request(`https://gallery.example${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

test("缺少任一认证配置时，登录和已有令牌均不能进入后台", async () => {
  const { token } = await issueAdminToken(credentials, credentials.ADMIN_USERNAME);
  for (const field of ["ADMIN_USERNAME", "ADMIN_PASSWORD", "ADMIN_SESSION_SECRET"]) {
    const env = { ...credentials, [field]: "" };
    const response = await login({ env, request: request("/api/admin/login", {
      method: "POST", body: { username: credentials.ADMIN_USERNAME, password: credentials.ADMIN_PASSWORD },
    }) });
    assert.equal(response.status, 503, field);
    assert.equal((await response.json()).error, "admin-auth-not-configured");
    const auth = await requireAdmin(request("/api/admin/config", { token }), env);
    assert.equal(auth.ok, false);
    assert.equal(auth.response.status, 503);
    assert.equal((await verifyAdminToken(env, token)).valid, false);
    await assert.rejects(issueAdminToken(env, credentials.ADMIN_USERNAME));
  }
});

test("支持 SHA256 密码登录；错误密码、改签名及更换账号后的旧令牌被拒绝", async () => {
  const env = makeEnv({
    ADMIN_PASSWORD: "",
    ADMIN_PASSWORD_SHA256: createHash("sha256").update(credentials.ADMIN_PASSWORD).digest("hex"),
  });
  const response = await login({ env, request: request("/api/admin/login", {
    method: "POST", body: { username: credentials.ADMIN_USERNAME, password: credentials.ADMIN_PASSWORD },
  }) });
  assert.equal(response.status, 200);
  const { data } = await response.json();
  assert.equal((await verifyAdminToken(env, data.token)).valid, true);
  assert.equal((await verifyAdminToken({ ...env, ADMIN_USERNAME: "another-admin" }, data.token)).valid, false);
  assert.equal((await verifyAdminToken(env, `${data.token}x`)).valid, false);
  const denied = await login({ env, request: request("/api/admin/login", {
    method: "POST", body: { username: credentials.ADMIN_USERNAME, password: "wrong-password" },
  }) });
  assert.equal(denied.status, 401);
  const malformed = await login({ env: { ...env, ADMIN_PASSWORD_SHA256: "invalid" }, request: request("/api/admin/login", {
    method: "POST", body: { username: credentials.ADMIN_USERNAME, password: credentials.ADMIN_PASSWORD },
  }) });
  assert.equal(malformed.status, 503);
});
