export const prerender = false;

import type { APIRoute } from "astro";
import matter from "gray-matter";
import { isAuthed } from "@/utils/adminAuth";
import { appendLog, getPost, savePost } from "@/utils/adminStore";
import { kvEnabled } from "@/utils/kvStore";
import { slugify } from "@/utils/slug";

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

/** Fire-and-forget Vercel deploy hook so imported posts go live. */
function triggerRebuild(): void {
  const hook = import.meta.env.DEPLOY_HOOK_URL as string | undefined;
  if (!hook) return;
  fetch(hook, { method: "POST" }).catch(() => {});
}

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB per file

type IncomingFile = { name?: unknown; content?: unknown };

/** Normalise a frontmatter date (Date | "YYYY-MM-DD" | ISO) to an ISO string. */
function toIsoDate(value: unknown): string {
  if (!value) return new Date().toISOString();
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? new Date().toISOString()
      : value.toISOString();
  }
  const raw = String(value).trim();
  if (!raw) return new Date().toISOString();
  // Astro/yaml may parse "YYYY-MM-DD" into a Date already; plain strings like
  // "2024/06/01 10:00" need a nudge. Fall back to now on anything unparsable.
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime())
    ? new Date().toISOString()
    : parsed.toISOString();
}

function toStringList(value: unknown): string[] {
  if (Array.isArray(value))
    return value.map(v => String(v).trim()).filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(/[,，、\s]+/)
      .map(v => v.trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * POST /api/admin/import
 * Body: { files: [{ name, content }], overwrite?: boolean }
 * Parses frontmatter and stores each file as a post.
 */
export const POST: APIRoute = async Astro => {
  if (!(await isAuthed(Astro.cookies))) return unauthorized();

  // Vercel's filesystem is read-only. Without KV the write below would only
  // fail much later with a cryptic EROFS, so refuse up front with a message
  // that actually tells you what to fix.
  if (!kvEnabled) {
    return json(
      {
        ok: false,
        message:
          "线上未启用 KV 存储：请在 Vercel 项目设置里绑定 Redis(Upstash) 数据库，" +
          "让 KV_REST_API_URL / KV_REST_API_TOKEN 自动注入，然后重新部署。",
      },
      503
    );
  }

  let body: { files?: unknown; overwrite?: unknown };
  try {
    body = await Astro.request.json();
  } catch {
    return json({ ok: false, message: "请求格式错误" }, 400);
  }

  const files = Array.isArray(body.files) ? (body.files as IncomingFile[]) : [];
  if (files.length === 0)
    return json({ ok: false, message: "没有待导入的文件" }, 400);
  const overwrite = Boolean(body.overwrite);

  const results: {
    name: string;
    slug: string;
    title: string;
    status: "created" | "updated" | "skipped" | "error";
    message?: string;
  }[] = [];

  for (const file of files) {
    const name = String(file?.name ?? "").trim() || "未命名.md";
    try {
      const raw = String(file?.content ?? "");
      if (!raw.trim()) {
        results.push({
          name,
          slug: "",
          title: "",
          status: "error",
          message: "文件为空",
        });
        continue;
      }
      if (Buffer.byteLength(raw, "utf8") > MAX_BYTES) {
        results.push({
          name,
          slug: "",
          title: "",
          status: "error",
          message: "文件超过 2MB",
        });
        continue;
      }

      // Strip a UTF-8 BOM so `---` frontmatter is still detected
      const parsed = matter(raw.replace(/^\uFEFF/, ""));
      const fm = (parsed.data ?? {}) as Record<string, unknown>;
      const content = parsed.content.trim();

      // 标题保留原文（中文就中文），只有 slug 才转拼音
      const title =
        String(fm.title ?? "").trim() ||
        name.replace(/\.(md|markdown|mdx|txt)$/i, "") ||
        name;
      const description = String(
        fm.description ?? fm.desc ?? fm.summary ?? fm.subtitle ?? ""
      ).trim();
      const tags = toStringList(
        fm.tags ?? fm.tag ?? fm.categories ?? fm.category
      );
      const pubDatetime = toIsoDate(
        fm.pubDatetime ?? fm.date ?? fm.published ?? fm.created
      );
      const modDatetime = fm.modDatetime ?? fm.updated ?? fm.lastmod ?? null;
      const draft = Boolean(fm.draft ?? false);
      const featured = Boolean(fm.featured ?? fm.sticky ?? false);

      const wantedSlug =
        slugify(String(fm.slug ?? "").trim() || name) || slugify(title);
      if (!wantedSlug) {
        results.push({
          name,
          slug: "",
          title,
          status: "error",
          message: "无法生成 slug",
        });
        continue;
      }

      const existing = await getPost(wantedSlug);
      if (existing && !overwrite) {
        results.push({
          name,
          slug: wantedSlug,
          title,
          status: "skipped",
          message: "已存在同名文章",
        });
        continue;
      }

      const { slug } = await savePost({
        slug: wantedSlug,
        originalSlug: existing ? wantedSlug : undefined,
        title,
        description,
        tags,
        pubDatetime,
        modDatetime: modDatetime ? toIsoDate(modDatetime) : null,
        featured,
        draft,
        content,
      });

      results.push({
        name,
        slug,
        title,
        status: existing ? "updated" : "created",
      });
    } catch (error) {
      results.push({
        name,
        slug: "",
        title: "",
        status: "error",
        message: String((error as Error).message ?? error),
      });
    }
  }

  const created = results.filter(r => r.status === "created").length;
  const updated = results.filter(r => r.status === "updated").length;
  if (created + updated > 0) {
    await appendLog(
      "导入文章",
      `成功 ${created + updated} 篇（新建 ${created} / 覆盖 ${updated}）`
    );
    triggerRebuild();
  }

  return json({ ok: true, results });
};
