export const prerender = false;

import type { APIRoute } from "astro";
import { isAuthed } from "@/utils/adminAuth";
import { deleteComment, listComments, updateComment } from "@/utils/userStore";

export async function GET({ url }: { url: URL }) {
  const slug = url.searchParams.get("slug") ?? undefined;
  return Response.json({ ok: true, comments: await listComments(slug) });
}

/**
 * POST /api/admin/comments — 改评论（置顶 / 称号 / 属地）。
 * body: { id, pinned?, badge?, region? }
 */
export const POST: APIRoute = async ({ request, cookies }) => {
  if (!(await isAuthed(cookies))) {
    return Response.json({ ok: false, error: "未登录" }, { status: 401 });
  }
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "无效请求" }, { status: 400 });
  }
  const id = String(body.id ?? "").trim();
  if (!id) return Response.json({ ok: false, error: "缺少 id" }, { status: 400 });

  const patch: { pinned?: boolean; badge?: string | null; region?: string | null } = {};
  if (typeof body.pinned === "boolean") patch.pinned = body.pinned;
  if (body.badge !== undefined) patch.badge = body.badge === null ? null : String(body.badge);
  if (body.region !== undefined) patch.region = body.region === null ? null : String(body.region);

  const ok = await updateComment(id, patch);
  if (!ok) return Response.json({ ok: false, error: "评论不存在" }, { status: 404 });
  return Response.json({ ok: true });
};

export async function DELETE({ url, cookies }: { url: URL; cookies: any }) {
  if (!(await isAuthed(cookies))) {
    return Response.json({ ok: false, error: "未登录" }, { status: 401 });
  }
  const id = url.searchParams.get("id") ?? "";
  const ok = id ? await deleteComment(id) : false;
  return Response.json({ ok });
}
