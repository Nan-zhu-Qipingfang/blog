export const prerender = false;

import { getCurrentUser } from "@/utils/userAuth";
import { addComment, listComments } from "@/utils/userStore";

/** GET /api/comments?slug=... — public list (newest first). */
export async function GET({ url }: { url: URL }) {
  const slug = url.searchParams.get("slug") ?? undefined;
  const comments = await listComments(slug);
  return Response.json({ ok: true, comments });
}

/** POST /api/comments — requires a logged-in user. */
export async function POST({ request, cookies }: { request: Request; cookies: any }) {
  const user = await getCurrentUser(cookies);
  if (!user) {
    return Response.json({ ok: false, error: "请先登录" }, { status: 401 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "无效请求" }, { status: 400 });
  }

  const slug = String(body.slug ?? "").trim();
  const content = String(body.content ?? "").trim();
  if (!slug || !content) {
    return Response.json({ ok: false, error: "缺少文章或评论内容" }, { status: 400 });
  }

  const comment = await addComment(slug, user.id, user.name, content);
  return Response.json({ ok: true, comment });
}
