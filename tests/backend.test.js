import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { issueAdminToken, requireAdmin, verifyAdminToken } from "../functions/_lib/admin-auth.js";
import { getDomainConfig, saveDomainConfig, StorageConfigurationError } from "../functions/_lib/config-store.js";
import { onRequest as middleware } from "../functions/api/_middleware.js";
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

test("显式 D1/KV 绑定缺失时拒绝读写，并返回可识别的 HTTP 配置错误", async () => {
  for (const driver of ["d1", "kv"]) {
    const env = { ...credentials, CONFIG_STORE_DRIVER: driver };
    await assert.rejects(saveDomainConfig(env, "gallery.example", {}), StorageConfigurationError);
    await assert.rejects(getDomainConfig(env, "gallery.example"), StorageConfigurationError);
    const { token } = await issueAdminToken(env, env.ADMIN_USERNAME);
    const context = { env, request: request("/api/admin/config", {
      token, method: "PUT", body: { domain: "gallery.example", config: {} },
    }) };
    const response = await middleware({ ...context, next: () => writeConfig(context) });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, "storage-not-configured");
  }
});

test("老配置中未提供的字段仍可继承环境默认值", async () => {
  const env = makeEnv({ DEFAULT_IMGBED_LIST_DIR: "default-folder" });
  await env.GALLERY_CONFIG_KV.put("domain:gallery.example", JSON.stringify({ imgbed: {} }));
  const { config } = await getDomainConfig(env, "gallery.example");
  assert.equal(config.imgbed.listDir, "default-folder");
});

test("绑定类型错误在显式选择和自动检测时都返回受控配置错误", async () => {
  for (const overrides of [
    { GALLERY_CONFIG_DB: { get() {}, put() {} } },
    { GALLERY_CONFIG_KV: { prepare() {} } },
  ]) {
    const driver = overrides.GALLERY_CONFIG_DB ? "d1" : "kv";
    for (const explicit of [true, false]) {
      const env = { ...credentials, ...overrides, ...(explicit ? { CONFIG_STORE_DRIVER: driver } : {}) };
      const context = { env, request: request("/api/public-config") };
      const response = await middleware({ ...context, next: () => publicConfig(context) });
      assert.equal(response.status, 503);
      assert.equal((await response.json()).error, "storage-not-configured");
    }
  }
});
