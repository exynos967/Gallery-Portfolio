<h2 align="center">
  <img width="27" src="./public/assets/favicon.svg" />
  Gallery-Portfolio
</h2>

<p align="center">
  一个支持 <strong>CloudFlare ImgBed API</strong>、<strong>/admin 管理后台</strong>、<strong>按域名配置展示模式</strong> 的静态图片画廊。
</p>

---

## ✨ 主要功能

- ImgBed 接入：通过 `generate-gallery-index-imgbed.js` 生成 `gallery-index.json`
- 动态图库模式：可由 `/admin` 配置后端拉取 ImgBed 列表（无需本地 `.env` 生成索引）
- 瀑布流画廊：懒加载、自动滚动、分类筛选、模态原图查看
- 展示模式：支持 `fullscreen`（单图沉浸）与 `waterfall`（瀑布流）
- 随机能力：支持随机排序 + ImgBed `/random` 随机图
- 全屏投稿：可在全屏模式右下角显示上传按钮，普通访客可投稿到指定目录
- 管理后台：`/admin` 登录后按域名配置前台行为
- 配置存储：支持 Cloudflare `D1` 或 `KV`

---

## 🗂️ 项目结构（关键）

```text
Gallery-Portfolio/
├── index.html
├── gallery-index.json
├── admin/
│   ├── index.html
│   ├── admin.css
│   └── admin.js
├── functions/
│   ├── api/public-config.js
│   ├── api/gallery-data.js
│   ├── api/public-upload.js
│   ├── api/admin/login.js
│   ├── api/admin/config.js
│   ├── api/admin/directories.js
│   └── _lib/
├── public/
├── generate-gallery-index-imgbed.js
└── package.json
```

---

## 🚀 快速开始（推荐：纯 WebUI 配置）

### 1) 安装依赖

```bash
npm install
```

### 2) 在 Cloudflare Pages 配置最小变量

仅需（启用 `/admin`）：

```text
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin
ADMIN_SESSION_SECRET=change-this-secret
```

并绑定存储：

- `GALLERY_CONFIG_DB`（D1）或 `GALLERY_CONFIG_KV`（KV）

### 3) 部署后进入 WebUI

访问 `/admin/`，在域名配置里：

1. 把“图库数据源”切为 `ImgBed API 动态拉取`
2. 填写 ImgBed 基础域名与 `API Token`
3. 选择展示模式：`fullscreen`（黑底单图）或 `waterfall`（瀑布流）
4. 保存后前台即按该域名动态加载图片

### 4) 本地预览（可选）

```bash
npm run serve
```

> 说明：`npm run serve` 仅启动静态服务，不会启用 `functions`。  
> 如需本地调试 `/api/*` 和 `/admin` 完整流程，建议使用 `wrangler pages dev .`。

---

## 🧰 本地脚本模式（可选）

如果你偏好离线生成 `gallery-index.json`，再静态部署：

```bash
cp .env_template .env
npm run imgbed:generate-index
```

这时才需要填写 `IMGBED_BASE_URL`、`IMGBED_API_TOKEN` 等脚本变量。

---

## 🔐 管理后台（/admin）

访问路径：

```text
https://your-domain.com/admin/
```

默认登录账号密码：

```text
admin / admin
```

**强烈建议上线后立即修改：**

- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`（或 `ADMIN_PASSWORD_SHA256`）
- `ADMIN_SESSION_SECRET`

### 管理后台可配置项

- 图库数据源：`static` / `imgbed-api`
- 访问模式：
  - `fullscreen`：仅显示一张自适应图片，黑色背景，隐藏 header/footer/admin 等所有页面控件
  - `waterfall`：多图瀑布流展示，保留筛选与交互按钮
- 默认随机排序：开/关
- `gallery-index.json` 自定义地址
- ImgBed API 参数：
  - 基础域名 `baseUrl`
  - 私有令牌 `apiToken`（仅管理端保存，不在 public-config 暴露）
  - 列表接口 `listEndpoint`
  - 随机图接口 `randomEndpoint`
  - 文件前缀 `fileRoutePrefix`
  - 显示目录 `listDir`
  - 预览目录 `previewDir`
  - 分页大小 `pageSize`
  - 递归子目录 `recursive`
- 前台上传弹窗参数：
  - 开关 `publicUpload.enabled`
  - 按钮文案 `publicUpload.buttonText`
  - 弹窗标题 `publicUpload.modalTitle`
  - 说明文案 `publicUpload.description`（管理员自定义，前台显示）

`listDir` 用于按 ImgBed 文件夹筛选展示内容：
- `waterfall`：仅展示该目录下图片
- `fullscreen`：随机图接口会附带 `dir` 参数，仅从该目录随机
- 随机接口失败时，前端回退到图库随机时也只会从已筛选结果中取图
- 管理后台支持“获取目录”按钮，可分层浏览并一层层选择目录

前台上传说明：
- 上传按钮仅在 `fullscreen` 模式显示
- 上传默认写入 `listDir` 指定目录（为空则上传到根目录）
- `/upload` 调用使用服务端保存的 ImgBed Token，不在前台暴露

---

## ☁️ Cloudflare 绑定与环境变量

在 Cloudflare Pages 项目中配置：

### Functions 绑定（任选其一或都配）

- D1 绑定名：`GALLERY_CONFIG_DB`
- KV 绑定名：`GALLERY_CONFIG_KV`

### 关键环境变量

```text
# 管理员
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin
ADMIN_SESSION_SECRET=change-this-secret
ADMIN_SESSION_HOURS=24

# 配置存储后端：d1 / kv（不填则自动检测）
CONFIG_STORE_DRIVER=d1

# 默认站点配置（当域名未写入存储时使用）
DEFAULT_GALLERY_DATA_MODE=static
DEFAULT_DISPLAY_MODE=fullscreen
DEFAULT_SHUFFLE_ENABLED=true
DEFAULT_GALLERY_INDEX_URL=
DEFAULT_IMGBED_BASE_URL=
DEFAULT_IMGBED_API_TOKEN=
DEFAULT_IMGBED_LIST_ENDPOINT=/api/manage/list
DEFAULT_IMGBED_RANDOM_ENDPOINT=/random
DEFAULT_IMGBED_FILE_ROUTE_PREFIX=/file
DEFAULT_IMGBED_LIST_DIR=
DEFAULT_IMGBED_PREVIEW_DIR=0_preview
DEFAULT_IMGBED_RECURSIVE=true
DEFAULT_IMGBED_PAGE_SIZE=200
DEFAULT_PUBLIC_UPLOAD_ENABLED=false
DEFAULT_PUBLIC_UPLOAD_BUTTON_TEXT=上传图片
DEFAULT_PUBLIC_UPLOAD_MODAL_TITLE=上传图片
DEFAULT_PUBLIC_UPLOAD_DESCRIPTION=请填写图片描述并选择图片后上传。
```

### 这些变量是否都要填到 Pages？

不需要，按下面分类配置即可：

#### A. Pages 建议必填（启用 `/admin` 时）

```text
ADMIN_USERNAME
ADMIN_PASSWORD 或 ADMIN_PASSWORD_SHA256（二选一）
ADMIN_SESSION_SECRET
```

并绑定至少一个存储：

- `GALLERY_CONFIG_DB`（D1）或
- `GALLERY_CONFIG_KV`（KV）

#### B. Pages 可选（不填也能跑）

```text
ADMIN_SESSION_HOURS
CONFIG_STORE_DRIVER
DEFAULT_DISPLAY_MODE
DEFAULT_SHUFFLE_ENABLED
DEFAULT_GALLERY_DATA_MODE
DEFAULT_GALLERY_INDEX_URL
DEFAULT_IMGBED_BASE_URL
DEFAULT_IMGBED_API_TOKEN
DEFAULT_IMGBED_LIST_ENDPOINT
DEFAULT_IMGBED_RANDOM_ENDPOINT
DEFAULT_IMGBED_FILE_ROUTE_PREFIX
DEFAULT_IMGBED_LIST_DIR
DEFAULT_IMGBED_PREVIEW_DIR
DEFAULT_IMGBED_RECURSIVE
DEFAULT_IMGBED_PAGE_SIZE
DEFAULT_PUBLIC_UPLOAD_ENABLED
DEFAULT_PUBLIC_UPLOAD_BUTTON_TEXT
DEFAULT_PUBLIC_UPLOAD_MODAL_TITLE
DEFAULT_PUBLIC_UPLOAD_DESCRIPTION
```

#### C. 通常不需要填 Pages（本地/CI 脚本用）

```text
IMGBED_BASE_URL
IMGBED_API_TOKEN
IMGBED_LIST_*
IMGBED_PREVIEW_*
```

> 完整模板见 `.env_template`。

---

## 🌐 前台配置加载逻辑

前台会请求：

- `GET /api/public-config`

按“当前访问域名”读取配置并应用。优先级：

1. URL 参数（`?fullscreen=0` / `?shuffle=0`）
2. 远端域名配置（`/api/public-config`）
3. 默认值

说明：

- `fullscreen`：不使用本地缓存，默认跟随域名配置（除非 URL 参数覆盖）
- `shuffle`：会记忆本地开关状态（`localStorage`）

当 `galleryDataMode=imgbed-api` 时，前台会请求：

- `GET /api/gallery-data`

由服务端使用已保存的 ImgBed Token 拉取列表并返回图库数据。

---

## 🧩 API 概览

### 公开接口

- `GET /api/public-config`  
  返回当前域名可公开配置（前台读取）
- `GET /api/gallery-data`  
  动态拉取并返回当前域名图库数据（需在配置里启用 `imgbed-api` 模式）
- `POST /api/public-upload`  
  全屏投稿上传接口（需在域名配置中开启 `publicUpload.enabled`）

### 管理接口（需 Bearer Token）

- `POST /api/admin/login`：登录获取 token
- `GET /api/admin/config?domain=example.com`：读取域名配置
- `PUT /api/admin/config`：保存域名配置
- `POST /api/admin/directories`：按当前 ImgBed 配置拉取目录树（用于后台分层选择 `listDir`）

---

## 🛠️ 可用脚本

- `npm run build`：静态站点无需构建（占位）
- `npm run serve`：本地静态预览
- `npm run generate-index`：ImgBed 生成索引（推荐）
- `npm run imgbed:generate-index`：ImgBed 生成索引

---

## 🚢 部署建议（Cloudflare Pages）

推荐部署方式：

1. 连接 Git 仓库到 Cloudflare Pages
2. 设置构建命令为 `npm install`（或按你项目策略）
3. 输出目录为仓库根目录
4. 配置本文中的环境变量与 D1/KV 绑定
5. 部署后访问：
   - `/` 前台画廊
   - `/admin/` 管理后台

---

## 🔧 常见问题

### 1) `/admin` 登录成功但配置不生效

- 确认前台域名与后台保存的域名一致（含子域名）
- 确认已绑定 D1/KV，或 `CONFIG_STORE_DRIVER` 设置正确
- 检查 `GET /api/public-config` 返回内容

### 2) 随机图按钮不显示

- 前台会在配置里检测 ImgBed 参数
- 确认 `baseUrl` 或 `randomEndpoint` 已配置

### 3) 本地 `npm run serve` 下 `/api/*` 404

- 这是正常现象（静态服务不跑 Functions）
- 使用 `wrangler pages dev .` 调试 Functions

---

## 📄 License

ISC
