export const prerender = false;

import { isAuthed } from "@/utils/adminAuth";
import { deleteComment, listComments } from "@/utils/userStore";

export async function GET({ url }: { url: URL }) {
  const slug = url.searchParams.get("slug") ?? undefined;
  return Response.json({ ok: true, comments: await listComments(slug) });
}

export async function DELETE({ url, cookies }: { url: URL; cookies: any }) {
  if (!(await isAuthed(cookies))) {
    return Response.json({ ok: false, error: "未登录" }, { status: 401 });
  }
  const id = url.searchParams.get("id") ?? "";
  const ok = id ? await deleteComment(id) : false;
  return Response.json({ ok });
}
