export const prerender = false;

import type { APIRoute } from "astro";
import { isAuthed } from "@/utils/adminAuth";
import { getPost, savePost, appendLog } from "@/utils/adminStore";
import { getCoverSvg, saveCoverSvg, removeCover, coverPath } from "@/utils/coverStore";
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

/** GET /api/admin/cover?slug=xxx — 当前封面 SVG（空串表示未设置） */
export const GET: APIRoute = async ({ url, cookies }) => {
  if (!(await isAuthed(cookies))) return unauthorized();
  const slug = url.searchParams.get("slug") ?? "";
  if (!slug) return json({ ok: false, message: "缺少 slug" }, 400);
  const post = await getPost(slug);
  return json({
    ok: true,
    slug,
    title: (post?.frontmatter?.title as string) ?? slug,
    description: (post?.frontmatter?.description as string) ?? "",
    cover: await getCoverSvg(slug),
  });
};

/**
 * POST /api/admin/cover — 保存封面。
 * body: { slug, svg }
 * 把 SVG 存进 KV，并把 frontmatter 的 coverImage 写成 /api/cover/<slug>，
 * 最后触发一次重新部署（前台是静态页，不重建不会换图）。
 */
export const POST: APIRoute = async ({ request, cookies }) => {
  if (!(await isAuthed(cookies))) return unauthorized();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, message: "请求格式错误" }, 400);
  }

  const slug = String(body.slug ?? "").trim();
  const svg = String(body.svg ?? "").trim();
  if (!slug) return json({ ok: false, message: "缺少 slug" }, 400);
  if (!svg) return json({ ok: false, message: "封面内容为空" }, 400);
  if (!/^<\?xml|<svg[\s>]/i.test(svg)) {
    return json({ ok: false, message: "封面必须是 SVG 内容" }, 400);
  }

  try {
    const post = await getPost(slug);
    if (!post) return json({ ok: false, message: "文章不存在" }, 404);
    await saveCoverSvg(slug, svg);
    await savePost({
      slug,
      title: String(post.frontmatter.title ?? slug),
      description: String(post.frontmatter.description ?? ""),
      tags: Array.isArray(post.frontmatter.tags) ? (post.frontmatter.tags as string[]) : [],
      pubDatetime: String(post.frontmatter.pubDatetime ?? new Date().toISOString()),
      modDatetime: (post.frontmatter.modDatetime as string) ?? null,
      featured: Boolean(post.frontmatter.featured),
      draft: Boolean(post.frontmatter.draft),
      content: post.content,
      coverImage: coverPath(slug),
    });
    await appendLog("生成封面", `${slug}`);
    const deploy = await triggerRedeploy();
    return json({ ok: true, cover: svg, coverImage: coverPath(slug), deploy });
  } catch (error) {
    return json({ ok: false, message: String((error as Error).message ?? error) }, 400);
  }
};

/** DELETE /api/admin/cover?slug=xxx — 清除封面 */
export const DELETE: APIRoute = async ({ url, cookies }) => {
  if (!(await isAuthed(cookies))) return unauthorized();
  const slug = url.searchParams.get("slug") ?? "";
  if (!slug) return json({ ok: false, message: "缺少 slug" }, 400);
  try {
    await removeCover(slug);
    const post = await getPost(slug);
    if (post) {
      await savePost({
        slug,
        title: String(post.frontmatter.title ?? slug),
        description: String(post.frontmatter.description ?? ""),
        tags: Array.isArray(post.frontmatter.tags) ? (post.frontmatter.tags as string[]) : [],
        pubDatetime: String(post.frontmatter.pubDatetime ?? new Date().toISOString()),
        modDatetime: (post.frontmatter.modDatetime as string) ?? null,
        featured: Boolean(post.frontmatter.featured),
        draft: Boolean(post.frontmatter.draft),
        content: post.content,
        coverImage: "",
      });
    }
    await appendLog("清除封面", `${slug}`);
    const deploy = await triggerRedeploy();
    return json({ ok: true, deploy });
  } catch (error) {
    return json({ ok: false, message: String((error as Error).message ?? error) }, 400);
  }
};
