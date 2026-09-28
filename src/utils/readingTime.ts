/**
 * Calculates the estimated reading time for a given piece of text.
 * Strips markdown/MDX syntax before counting for a more accurate result.
 * CJK characters (Chinese/Japanese/Korean) are counted individually,
 * while Latin text is counted in words.
 *
 * @param body - Raw markdown/MDX string content
 * @param cpm - Average CJK reading speed in characters per minute (default: 300)
 * @param wordsPerMinute - Average Latin reading speed (default: 200 wpm)
 * @returns Formatted string like "3 分钟阅读" or "不到 1 分钟"
 */
export function getReadingTime(
  body: string,
  cpm = 300,
  wordsPerMinute = 200
): string {
  // Strip frontmatter
  const withoutFrontmatter = body.replace(/^---[\s\S]*?---\n?/, "");

  // Strip common markdown/MDX syntax that isn't real words
  const plainText = withoutFrontmatter
    .replace(/```[\s\S]*?```/g, "") // fenced code blocks
    .replace(/`[^`]*`/g, "") // inline code
    .replace(/!\[.*?\]\(.*?\)/g, "") // images
    .replace(/\[.*?\]\(.*?\)/g, "$1") // links → keep link text
    .replace(/^#{1,6}\s+/gm, "") // headings
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, "$1") // bold/italic
    .replace(/^\s*[-*+>|]\s*/gm, "") // lists, blockquotes, tables
    .replace(/\s+/g, " ") // collapse whitespace
    .trim();

  // Count CJK characters separately (they are not space-separated)
  const cjkChars = (plainText.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
  const latinWords = plainText
    .replace(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g, " ")
    .split(" ")
    .filter(Boolean).length;

  const minutes = Math.ceil(cjkChars / cpm + latinWords / wordsPerMinute);

  return minutes < 1 ? "不到 1 分钟" : `${minutes} 分钟阅读`;
}
