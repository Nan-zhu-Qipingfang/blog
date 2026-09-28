export const prerender = false;

import { isAuthed } from "@/utils/adminAuth";
import { deleteUser, listUsers } from "@/utils/userStore";

export async function GET({ cookies }: { cookies: any }) {
  if (!(await isAuthed(cookies))) {
    return Response.json({ ok: false, error: "未登录" }, { status: 401 });
  }
  const users = (await listUsers()).map(({ salt, hash, ...safe }) => safe);
  return Response.json({ ok: true, users });
}

export async function DELETE({ url, cookies }: { url: URL; cookies: any }) {
  if (!(await isAuthed(cookies))) {
    return Response.json({ ok: false, error: "未登录" }, { status: 401 });
  }
  const id = url.searchParams.get("id") ?? "";
  const ok = id ? await deleteUser(id) : false;
  return Response.json({ ok });
}
