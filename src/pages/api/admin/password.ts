export const prerender = false;

import type { APIRoute } from "astro";
import {
  isAuthed,
  savePasswordHash,
  verifyCredentials,
} from "@/utils/adminAuth";
import { appendLog } from "@/utils/adminStore";

export const POST: APIRoute = async Astro => {
  if (!(await isAuthed(Astro.cookies))) {
    return new Response(JSON.stringify({ ok: false, message: "未登录" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  let oldPassword = "";
  let newPassword = "";
  try {
    const body = await Astro.request.json();
    oldPassword = String(body?.oldPassword ?? "");
    newPassword = String(body?.newPassword ?? "");
  } catch {
    /* fallthrough */
  }

  if (newPassword.length < 6) {
    return new Response(
      JSON.stringify({ ok: false, message: "新密码至少需要 6 位" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }
  if (!(await verifyCredentials("admin", oldPassword))) {
    return new Response(
      JSON.stringify({ ok: false, message: "旧密码不正确" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  await savePasswordHash(newPassword);
  await appendLog("修改密码", "管理员密码已更新");
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
};
