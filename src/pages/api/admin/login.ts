export const prerender = false;

import type { APIRoute } from "astro";
import {
  ADMIN_COOKIE,
  createSessionToken,
  sessionCookieOptions,
  verifyCredentials,
} from "@/utils/adminAuth";
import { appendLog } from "@/utils/adminStore";

export const POST: APIRoute = async Astro => {
  let username = "";
  let password = "";
  try {
    const body = await Astro.request.json();
    username = String(body?.username ?? "");
    password = String(body?.password ?? "");
  } catch {
    /* fallthrough to failure */
  }

  const ok = await verifyCredentials(username, password);
  if (!ok) {
    return new Response(
      JSON.stringify({ ok: false, message: "账号或密码错误" }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }

  Astro.cookies.set(ADMIN_COOKIE, await createSessionToken(), sessionCookieOptions());
  await appendLog("登录", "管理员登录成功");
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
};
