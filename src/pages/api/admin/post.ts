export const prerender = false;

import type { APIRoute } from "astro";
import { isAuthed } from "@/utils/adminAuth";
import { appendLog, getPost, savePost, trashPost } from "@/utils/adminStore";
import { triggerRedeploy } from "@/utils/redeploy";

const unauthorized = () =>
  new Response(JSON.stringify({ ok: false, message: "未登录" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/** GET /api/admin/post?slug=xxx — raw post for the editor */
export const GET: APIRoute = async Astro => {
  if (!(await isAuthed(Astro.cookies))) return unauthorized();
  const slug = Astro.url.searchParams.get("slug") ?? "";
  const post = await getPost(slug);
  if (!post) return json({ ok: false, message: "文章不存在" }, 404);
  return json({ ok: true, post });
};

/** POST /api/admin/post — create or update (with optional rename) */
export const POST: APIRoute = async Astro => {
  if (!(await isAuthed(Astro.cookies))) return unauthorized();
  let body: Record<string, unknown>;
  try {
    body = await Astro.request.json();
  } catch {
    return json({ ok: false, message: "请求格式错误" }, 400);
  }

  const title = String(body.title ?? "").trim();
  if (!title) return json({ ok: false, message: "标题不能为空" }, 400);
  const content = String(body.content ?? "").trim();
  if (!content) return json({ ok: false, message: "正文不能为空" }, 400);

  const slugInput = String(body.slug ?? "").trim() || title.toLowerCase().replace(/\s+/g, "-");
  const isNew = !body.originalSlug;
  try {
    const { slug } = await savePost({
      slug: slugInput,
      originalSlug: body.originalSlug ? String(body.originalSlug) : undefined,
      title,
      description: String(body.description ?? ""),
      tags: Array.isArray(body.tags) ? body.tags.map(t => String(t).trim()).filter(Boolean) : [],
      pubDatetime: String(body.pubDatetime ?? new Date().toISOString()),
      modDatetime: body.modDatetime ? String(body.modDatetime) : null,
      featured: Boolean(body.featured),
      draft: Boolean(body.draft),
      content,
    });
    await appendLog(isNew ? "新建文章" : "更新文章", `${title}（${slug}）`);
    const deploy = await triggerRedeploy();
    return json({ ok: true, slug, deploy });
  } catch (error) {
    return json({ ok: false, message: String((error as Error).message ?? error) }, 400);
  }
};

/** DELETE /api/admin/post?slug=xxx — move to trash */
export const DELETE: APIRoute = async Astro => {
  if (!(await isAuthed(Astro.cookies))) return unauthorized();
  const slug = Astro.url.searchParams.get("slug") ?? "";
  const removed = await trashPost(slug);
  if (!removed) return json({ ok: false, message: "文章不存在" }, 404);
  await appendLog("删除文章", `${slug}（已移入回收站）`);
  const deploy = await triggerRedeploy();
  return json({ ok: true, deploy });
};
