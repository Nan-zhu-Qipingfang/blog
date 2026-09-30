/**
 * 统一的文章 slug 生成规则 —— 后台导入、编辑器、服务端存储共用同一份实现，
 * 保证「前端预览显示的 slug」与「服务端真正写入的 slug」永远一致。
 *
 * 设计要点：
 * 1. **slug 里不能出现中文**：URL 里的中文会被百分号编码，既难看又容易在
 *    分享、统计、RSS 里出问题；而 adminStore 的 safeSlug() 只保留
 *    [a-z0-9-]，中文会被直接清空成空字符串。所以这里先把中文转成拼音。
 * 2. 中英混排要保留英文原样（"Astro 教程" → "astro-jiao-cheng"）。
 * 3. 纯符号/emoji 导致 slug 为空时，用输入内容的稳定哈希兜底，
 *    前后端算法一致，保证冲突检测依然准确。
 */
import { pinyin } from "pinyin-pro";

const HAN_RE = /\p{Script=Han}/u;
const EXT_RE = /\.(md|markdown|mdx|txt)$/i;

/** 稳定哈希（djb2），仅用于兜底，前后端实现必须完全一致 */
function stableHash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

/**
 * 生成 URL 安全的 slug（纯 ASCII）。
 * @param input  文件名、标题或 frontmatter 里的 slug
 * @param seed   兜底哈希种子，默认就是 input 本身
 */
export function slugify(input: string, seed?: string): string {
  const raw = String(input ?? "").trim();
  if (!raw) return "";

  // 先去掉扩展名，避免 ".md" 被打进拼音流程
  const noExt = raw.replace(EXT_RE, "");

  let text = noExt;
  if (HAN_RE.test(text)) {
    // nonZh: "consecutive" —— 连续的非中文字符原样保留，不做拆分
    const parts = pinyin(text, {
      toneType: "none",
      type: "array",
      nonZh: "consecutive",
      v: false,
    });
    text = parts.join("-");
  }

  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");

  if (slug) return slug;

  // 全是符号/emoji 等无法转写的内容 → 用哈希兜底，保证不为空且稳定
  return `post-${stableHash(seed ?? raw)}`;
}
