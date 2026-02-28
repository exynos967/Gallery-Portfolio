import { getAdminUsername, issueAdminToken, verifyAdminCredentials } from "../../_lib/admin-auth.js";
import { json, noContent, readJson } from "../../_lib/http.js";

export function onRequestOptions() {
  return noContent();
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const body = await readJson(request);
  const username = String(body?.username || "").trim();
  const password = String(body?.password || "");

  if (!username || !password) {
    return json(
      {
        success: false,
        error: "invalid-request",
        message: "请输入账号与密码。",
      },
      { status: 400 }
    );
  }

  const isValid = await verifyAdminCredentials(env, username, password);
  if (!isValid) {
    return json(
      {
        success: false,
        error: "invalid-credentials",
        message: "账号或密码错误。",
      },
      { status: 401 }
    );
  }

  const tokenResult = await issueAdminToken(env, username);
  return json({
    success: true,
    data: {
      token: tokenResult.token,
      expiresAt: tokenResult.expiresAt,
      username: getAdminUsername(env),
    },
  });
}
