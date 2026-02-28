import { getDomainConfig } from "../_lib/config-store.js";
import { json, noContent, normalizeDomain, pickRequestDomain } from "../_lib/http.js";

const MAX_UPLOAD_SIZE_MB = 25;

function normalizeDirPath(input) {
  return String(input || "")
    .trim()
    .replace(/^\/+|\/+$/g, "");
}

function buildAbsoluteUrl(baseUrl, endpointOrPath = "/upload") {
  if (!endpointOrPath) return "";
  if (/^https?:\/\//i.test(endpointOrPath)) return endpointOrPath;
  const clean = String(endpointOrPath).replace(/^\/+/, "");
  return `${String(baseUrl).replace(/\/+$/, "")}/${clean}`;
}

function toAuthHeader(token) {
  const raw = String(token || "").trim();
  if (!raw) return "";
  return raw.toLowerCase().startsWith("bearer ") ? raw : `Bearer ${raw}`;
}

function toAbsoluteImageUrl(rawUrl, baseUrl) {
  const value = String(rawUrl || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  return `${String(baseUrl).replace(/\/+$/, "")}/${value.replace(/^\/+/, "")}`;
}

function extractUploadSrc(payload) {
  if (!payload) return "";

  if (typeof payload === "string") {
    const text = payload.trim();
    return text.startsWith("/") || /^https?:\/\//i.test(text) ? text : "";
  }

  if (Array.isArray(payload)) {
    const first = payload[0] || {};
    return first.src || first.url || first.data?.src || first.data?.url || "";
  }

  if (typeof payload === "object") {
    if (Array.isArray(payload.data)) {
      const first = payload.data[0] || {};
      return first.src || first.url || "";
    }
    return payload.src || payload.url || payload.data?.src || payload.data?.url || "";
  }

  return "";
}

export function onRequestOptions() {
  return noContent();
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const domain = normalizeDomain(new URL(request.url).searchParams.get("domain"), pickRequestDomain(request));
  const configResult = await getDomainConfig(env, domain);
  const config = configResult?.config || {};

  if (config?.publicUpload?.enabled !== true) {
    return json(
      {
        success: false,
        error: "public-upload-disabled",
        message: "上传功能未开启。",
      },
      { status: 403 }
    );
  }

  const baseUrl = String(config?.imgbed?.baseUrl || "").trim();
  const apiToken = String(config?.imgbed?.apiToken || "").trim();
  const uploadFolder = normalizeDirPath(config?.imgbed?.listDir || "");

  if (!baseUrl) {
    return json(
      {
        success: false,
        error: "missing-imgbed-base-url",
        message: "未配置 ImgBed 基础地址。",
      },
      { status: 400 }
    );
  }

  if (!apiToken) {
    return json(
      {
        success: false,
        error: "missing-imgbed-token",
        message: "未配置 ImgBed API Token。",
      },
      { status: 400 }
    );
  }

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return json(
      {
        success: false,
        error: "invalid-form-data",
        message: "请求体必须是 multipart/form-data。",
      },
      { status: 400 }
    );
  }

  const file = formData.get("file");
  const description = String(formData.get("description") || "")
    .trim()
    .slice(0, 500);

  if (!file || typeof file !== "object" || typeof file.arrayBuffer !== "function") {
    return json(
      {
        success: false,
        error: "missing-file",
        message: "请先选择要上传的图片。",
      },
      { status: 400 }
    );
  }

  const fileType = String(file.type || "").toLowerCase();
  if (!fileType.startsWith("image/")) {
    return json(
      {
        success: false,
        error: "invalid-file-type",
        message: "仅支持上传图片文件。",
      },
      { status: 400 }
    );
  }

  const fileSize = Number(file.size || 0);
  if (fileSize <= 0) {
    return json(
      {
        success: false,
        error: "empty-file",
        message: "文件为空，无法上传。",
      },
      { status: 400 }
    );
  }

  const maxBytes = MAX_UPLOAD_SIZE_MB * 1024 * 1024;
  if (fileSize > maxBytes) {
    return json(
      {
        success: false,
        error: "file-too-large",
        message: `文件大小不能超过 ${MAX_UPLOAD_SIZE_MB}MB。`,
      },
      { status: 400 }
    );
  }

  const uploadUrl = new URL(buildAbsoluteUrl(baseUrl, "/upload"));
  uploadUrl.searchParams.set("returnFormat", "full");
  if (uploadFolder) {
    uploadUrl.searchParams.set("uploadFolder", uploadFolder);
  }

  const forwardFormData = new FormData();
  forwardFormData.append("file", file, file.name || "upload-image");
  if (description) {
    // 部分 ImgBed 版本会忽略该字段，保留为兼容扩展参数。
    forwardFormData.append("description", description);
  }

  const headers = {
    Accept: "application/json, text/plain;q=0.9, */*;q=0.8",
    Authorization: toAuthHeader(apiToken),
  };

  try {
    const response = await fetch(uploadUrl.toString(), {
      method: "POST",
      headers,
      body: forwardFormData,
    });

    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    let payload;
    if (contentType.includes("application/json")) {
      payload = await response.json().catch(() => null);
    } else {
      payload = await response.text().catch(() => "");
    }

    if (!response.ok) {
      const reason =
        (payload && typeof payload === "object" && (payload.message || payload.error)) ||
        (typeof payload === "string" ? payload : "") ||
        response.statusText;
      return json(
        {
          success: false,
          error: "imgbed-upload-failed",
          message: `上传失败：${reason}`,
        },
        { status: 502 }
      );
    }

    const rawSrc = extractUploadSrc(payload);
    const imageUrl = toAbsoluteImageUrl(rawSrc, baseUrl);
    if (!imageUrl) {
      return json(
        {
          success: false,
          error: "invalid-upload-response",
          message: "上传成功但返回结果无法解析。",
        },
        { status: 502 }
      );
    }

    return json({
      success: true,
      data: {
        url: imageUrl,
        folder: uploadFolder,
        description,
      },
    });
  } catch (error) {
    return json(
      {
        success: false,
        error: "upload-request-failed",
        message: `上传请求失败：${error.message}`,
      },
      { status: 502 }
    );
  }
}
