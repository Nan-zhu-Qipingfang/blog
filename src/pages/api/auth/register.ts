export const prerender = false;

import { addUser, findUserByEmail } from "@/utils/userStore";
import { createUserSessionToken, USER_COOKIE, userSessionCookieOptions } from "@/utils/userAuth";

export async function POST({ request, cookies }: { request: Request; cookies: any }) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "无效请求" }, { status: 400 });
  }

  const name = String(body.name ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");

  if (!name || name.length > 24) {
    return Response.json({ ok: false, error: "昵称不能为空且不超过 24 字" }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ ok: false, error: "邮箱格式不正确" }, { status: 400 });
  }
  if (password.length < 6) {
    return Response.json({ ok: false, error: "密码至少 6 位" }, { status: 400 });
  }

  const existing = await findUserByEmail(email);
  if (existing) {
    return Response.json({ ok: false, error: "该邮箱已注册，请直接登录" }, { status: 409 });
  }

  const user = await addUser(name, email, password);
  cookies.set(USER_COOKIE, await createUserSessionToken(user.id), userSessionCookieOptions());
  return Response.json({ ok: true, user: { id: user.id, name: user.name, email: user.email } });
}
