/**
 * 构建前清掉 Astro 内容层的渲染缓存。
 *
 * Astro 会把内容集合（blog / gallery）**渲染后的 HTML** 缓存在
 * `node_modules/.astro/data-store.json`。一旦缓存命中，markdown 就不会
 * 重新走 remark/rehype 管线 —— 于是会出现「CSS 和 JS 都是新版本，唯独
 * 文章正文还是旧渲染结果」的怪现象（外挂标签原样输出、样式改动不生效）。
 *
 * 本地和 Vercel 都会踩到（Vercel 的构建缓存会保留 node_modules/.astro），
 * 所以在 astro build 之前显式删掉它。
 */
import { rmSync, statSync } from "node:fs";
import { join } from "node:path";

const targets = [
  join("node_modules", ".astro", "data-store.json"),
  join(".astro", "data-store.json"),
];

let removed = 0;
for (const file of targets) {
  try {
    statSync(file);
    rmSync(file, { force: true });
    removed++;
    console.log(`[clear-astro-cache] removed ${file}`);
  } catch {
    // 不存在就跳过
  }
}

if (removed === 0) {
  console.log("[clear-astro-cache] no content cache found, skip");
}
