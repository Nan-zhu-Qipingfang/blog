export const prerender = false;

import { findUserByEmail, verifyUserPassword } from "@/utils/userStore";
import { createUserSessionToken, USER_COOKIE, userSessionCookieOptions } from "@/utils/userAuth";

export async function POST({ request, cookies }: { request: Request; cookies: any }) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "无效请求" }, { status: 400 });
  }

  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");

  const user = await findUserByEmail(email);
  if (!user || !verifyUserPassword(user, password)) {
    return Response.json({ ok: false, error: "邮箱或密码错误" }, { status: 401 });
  }
  if (user.banned) {
    return Response.json({ ok: false, error: "该账号已被禁用" }, { status: 403 });
  }

  cookies.set(USER_COOKIE, await createUserSessionToken(user.id), userSessionCookieOptions());
  return Response.json({ ok: true, user: { id: user.id, name: user.name, email: user.email } });
}
