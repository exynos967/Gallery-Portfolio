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

test("配置经管理 API 保存到 KV；显式空值覆盖环境默认值，公开结果不包含令牌", async () => {
  const env = makeEnv({
    DEFAULT_IMGBED_LIST_DIR: "old-folder",
    DEFAULT_IMGBED_API_TOKEN: "test-upstream-token",
    DEFAULT_IMGBED_RANDOM_ORIENTATION: "landscape",
    DEFAULT_SITE_IMAGE_URL: "old-logo.png",
  });
  const { token } = await issueAdminToken(env, env.ADMIN_USERNAME);
  const response = await writeConfig({ env, request: request("/api/admin/config", {
    token, method: "PUT", body: {
      domain: "gallery.example",
      config: {
        displayMode: "waterfall", shuffleEnabled: false,
        imgbed: { listDir: "", apiToken: "", randomOrientation: "" },
        site: { imageUrl: "" },
      },
    },
  }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.storageBackend, "kv");

  const read = await readConfig({ env: { ...env }, request: request("/api/admin/config", { token }) });
  const { data } = await read.json();
  assert.equal(data.config.imgbed.listDir, "");
  assert.equal(data.config.imgbed.apiToken, "");
  assert.equal(data.config.imgbed.randomOrientation, "");
  assert.equal(data.config.site.imageUrl, "");
  assert.equal(data.config.shuffleEnabled, false);

  const publicResponse = await publicConfig({ env, request: request("/api/public-config") });
  assert.equal(publicResponse.headers.get("Cache-Control"), "no-store");
  const first = await publicResponse.json();
  assert.equal(first.config.displayMode, "waterfall");
  assert.equal("apiToken" in first.config.imgbed, false);
  await saveDomainConfig(env, "gallery.example", { displayMode: "fullscreen" });
  const second = await publicConfig({ env, request: request("/api/public-config") });
  assert.equal((await second.json()).config.displayMode, "fullscreen");
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

test("目录接口兼容上游全路径和相对路径，并支持从已有目录切回根目录", async (t) => {
  const env = makeEnv();
  await saveDomainConfig(env, "gallery.example", { imgbed: {
    baseUrl: "https://img.example", listDir: "foo", apiToken: "test-upstream-token",
  } });
  const { token } = await issueAdminToken(env, env.ADMIN_USERNAME);
  const seenDirs = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    seenDirs.push(new URL(url).searchParams.get("dir"));
    return Response.json({ files: [{ name: "foo/bar/photo.jpg" }, { name: "baz/other.jpg" }] });
  });
  const response = await directories({ env, request: request("/api/admin/directories", {
    token, method: "POST", body: { domain: "gallery.example", imgbed: { listDir: "foo" } },
  }) });
  assert.equal(response.status, 200);
  const { data } = await response.json();
  const base = data.tree.children.find((node) => node.path === "foo");
  assert.ok(base);
  assert.deepEqual(base.children.map((node) => node.path), ["foo/bar", "foo/baz"]);

  const root = await directories({ env, request: request("/api/admin/directories", {
    token, method: "POST", body: { domain: "gallery.example", imgbed: { listDir: "" } },
  }) });
  assert.equal((await root.json()).data.sourceListDir, "");
  assert.deepEqual(seenDirs, ["foo", null]);
});

test("同一默认图库在不同请求域名下复用缓存，配置变化后重新获取", async (t) => {
  const env = makeEnv();
  const config = { galleryDataMode: "imgbed-api", imgbed: {
    baseUrl: "https://cache-test.example", apiToken: "test-cache-token", listDir: "",
  } };
  await saveDomainConfig(env, "default", config);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json({ files: [{ name: "photos/image.jpg" }] });
  });
  for (let index = 0; index < 20; index++) {
    const response = await galleryData({ env, request: request(`/api/gallery-data?domain=alias-${index}.example`) });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.total_images, 1);
  }
  assert.equal(calls, 1);
  await saveDomainConfig(env, "default", { ...config, imgbed: { ...config.imgbed, listDir: "new-dir" } });
  await galleryData({ env, request: request("/api/gallery-data?domain=alias-0.example") });
  assert.equal(calls, 2);
});

test("动态图库按子目录分类时，原图和预览图 URL 保留完整父目录", async (t) => {
  const env = makeEnv();
  await saveDomainConfig(env, "gallery.example", { galleryDataMode: "imgbed-api", imgbed: {
    baseUrl: "https://directory-test.example", apiToken: "test-dir-token", listDir: "foo/bar",
  } });
  t.mock.method(globalThis, "fetch", async () => Response.json({ files: [
    { name: "foo/bar/photos/image.jpg" }, { name: "foo/bar/0_preview/photos/image.webp" },
  ] }));
  const response = await galleryData({ env, request: request("/api/gallery-data") });
  assert.equal(response.status, 200);
  const { data } = await response.json();
  assert.equal(data.gallery.photos.images[0].original, "https://directory-test.example/file/foo/bar/photos/image.jpg");
  assert.equal(data.gallery.photos.images[0].preview, "https://directory-test.example/file/foo/bar/0_preview/photos/image.webp");
});
