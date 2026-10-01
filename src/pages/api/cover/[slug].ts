export const prerender = false;

import type { APIContext } from "astro";
import { SITE } from "@/config";
import { getCoverSvg, defaultCoverSvg } from "@/utils/coverStore";
import { getPost } from "@/utils/adminStore";

/**
 * GET /api/cover/<slug>
 *
 * 文章页 frontmatter 里 `coverImage: /api/cover/<slug>` 指向这里，返回一张 SVG：
 *  1. 后台「封面工作台」为该文章生成的自定义封面；
 *  2. 没有自定义封面时，按文章标题/描述现生成一张默认封面；
 *  3. 文章也不存在时，返回一张站点级默认封面（保证 <img> 不会 404 出现破图）。
 */
export async function GET({ params }: APIContext) {
  const slug = String(params.slug ?? "");
  let svg = slug ? await getCoverSvg(slug) : "";

  if (!svg && slug) {
    let title = SITE.title;
    let subtitle = SITE.description ?? "";
    try {
      const post = await getPost(slug);
      if (post) {
        const fm = post.frontmatter as Record<string, unknown>;
        if (typeof fm.title === "string" && fm.title) title = fm.title;
        if (typeof fm.description === "string" && fm.description) subtitle = fm.description;
      }
    } catch {
      /* 读不到就退回站点名 */
    }
    svg = defaultCoverSvg(title, subtitle);
  }

  if (!svg) svg = defaultCoverSvg(SITE.title, SITE.description ?? "");

  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
