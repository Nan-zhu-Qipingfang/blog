/**
 * 文章默认封面：后台「封面工作台」一键生成的 SVG。
 *
 * 线上是 Vercel（只读文件系统），所以封面既不能写成图片文件、也不能塞进
 * frontmatter 里当 data URI（content collection 的 image() 会去解析路径而报错）。
 * 方案：SVG 存 KV（键 `site:cover` 下的 { "slug": "<svg 文本>" }），
 * frontmatter 只写一个短路径 `/api/cover/<slug>`，文章页 `<img src>` 指向它，
 * 由 serverless 路由把 SVG 吐出来。这样零二进制存储、零图床依赖。
 */
import { jsonStore } from "@/utils/kvStore";

const COVERS_FILE = "src/data/admin/covers.json";
const COVERS_KEY = "site:covers";

const COVERS = jsonStore<Record<string, string>>(COVERS_FILE, COVERS_KEY);

export const COVER_PATH_PREFIX = "/api/cover/";

export function coverPath(slug: string): string {
  return `${COVER_PATH_PREFIX}${slug}`;
}

/** 取某篇文章的自定义封面 SVG，没有返回空串。 */
export async function getCoverSvg(slug: string): Promise<string> {
  const all = await COVERS.read<Record<string, string>>({});
  return all[slug] ?? "";
}

/** 保存某篇文章的封面 SVG（同一时间只有一份，后来的覆盖前面的）。 */
export async function saveCoverSvg(slug: string, svg: string): Promise<void> {
  const all = await COVERS.read<Record<string, string>>({});
  all[slug] = svg;
  await COVERS.write(all);
}

/** 删除某篇文章的封面。 */
export async function removeCover(slug: string): Promise<void> {
  const all = await COVERS.read<Record<string, string>>({});
  if (!(slug in all)) return;
  delete all[slug];
  await COVERS.write(all);
}

/* ── 兜底：按标题现生成一张默认封面 ──────────────────────────────────── */

function esc(s: string): string {
  return s.replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string),
  );
}

/**
 * 生成默认封面 SVG（不依赖任何图床）：深色玻璃底 + 双色光斑 + 大标题 + 站点署名。
 * 与后台工作台「渐变 / 光斑 / 标题」三件套风格一致，只是没有自定义文案。
 */
export function defaultCoverSvg(title: string, subtitle: string): string {
  const t = esc((title || "").slice(0, 40));
  const s = esc((subtitle || "").slice(0, 40));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 675" width="1200" height="675" role="img" aria-label="${t}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0f1720"/>
      <stop offset="55%" stop-color="#123050"/>
      <stop offset="100%" stop-color="#0a1017"/>
    </linearGradient>
    <radialGradient id="g1" cx="18%" cy="22%" r="52%">
      <stop offset="0%" stop-color="#1158d1" stop-opacity=".55"/>
      <stop offset="100%" stop-color="#1158d1" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="g2" cx="86%" cy="82%" r="58%">
      <stop offset="0%" stop-color="#bbc789" stop-opacity=".34"/>
      <stop offset="100%" stop-color="#bbc789" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="675" fill="url(#bg)"/>
  <rect width="1200" height="675" fill="url(#g1)"/>
  <rect width="1200" height="675" fill="url(#g2)"/>
  <path d="M0 470 Q 300 400 600 470 T 1200 470 L1200 675 L0 675 Z" fill="#1158d1" opacity=".16"/>
  <g font-family="system-ui,-apple-system,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif">
    <text x="88" y="330" font-size="60" font-weight="700" fill="#f6f7f8">${t}</text>
    <text x="88" y="392" font-size="26" font-weight="500" fill="#9fb4c9">${s}</text>
  </g>
</svg>`;
}
