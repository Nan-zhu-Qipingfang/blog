/**
 * Admin backend data layer: post CRUD (markdown files), stats and operation logs.
 *
 * Posts live in src/data/blog/*.md (content collection). Deleted posts are
 * moved to src/data/admin/trash/ (outside the collection glob) instead of
 * being destroyed.
 *
 * On serverless (Vercel KV configured) the filesystem is read-only, so saved
 * posts/logs are persisted to KV instead; `scripts/sync-kv-content.mjs` runs
 * at build time to pull KV posts back into src/data/blog/ before the static
 * build, and a deploy hook can trigger that rebuild automatically.
 */
import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { BLOG_PATH } from "@/content.config";
// Generated at build time by scripts/sync-kv-content.mjs (see that file for why).
import { postsSnapshot } from "@/generated/postsSnapshot";
import { kvDel, kvEnabled, kvGet, kvKeys, kvSet } from "@/utils/kvStore";

export const BLOG_DIR = path.resolve(BLOG_PATH);
const ADMIN_DIR = path.resolve("src/data/admin");
const TRASH_DIR = path.join(ADMIN_DIR, "trash");
const LOG_FILE = path.join(ADMIN_DIR, "logs.json");

/** Used in Vercel serverless when KV is not configured. */
export function requireKvOnServerless(): void {
  if (kvEnabled) return;
  if (process.env.VERCEL || process.env.VERCEL_ENV) {
    throw new Error(
      "Vercel 文件系统为只读，必须先在项目设置里绑定 Redis(Upstash) 数据库，" +
        "让 KV_REST_API_URL / KV_REST_API_TOKEN 自动注入，然后重新部署。"
    );
  }
}

export type PostMeta = {
  slug: string;
  title: string;
  description: string;
  /** AI 摘要（或线下手写的摘要），优先于 description */
  summary: string;
  tags: string[];
  author: string;
  pubDatetime: string;
  modDatetime: string | null;
  draft: boolean;
  featured: boolean;
  chars: number;
};

/** Keep slugs filesystem- and URL-safe. */
export function safeSlug(slug: string): string {
  return slug
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function toIsoDate(value: unknown, fallback = new Date()): string {
  const date = value instanceof Date ? value : new Date(String(value ?? ""));
  return Number.isNaN(date.getTime())
    ? fallback.toISOString()
    : date.toISOString();
}

/** Serialize frontmatter by hand so datetime stays unquoted (YAML date). */
function buildFrontmatter(fm: Record<string, unknown>): string {
  const lines: string[] = ["---"];
  lines.push(`title: ${JSON.stringify(String(fm.title ?? "无题"))}`);
  lines.push(`description: ${JSON.stringify(String(fm.description ?? ""))}`);
  // AI 摘要：只在有值时才写，空字符串会把已有摘要抹掉
  const summary = String(fm.summary ?? "").trim();
  if (summary) lines.push(`summary: ${JSON.stringify(summary)}`);
  lines.push(`author: ${JSON.stringify(String(fm.author ?? "南烛"))}`);
  lines.push(
    `pubDatetime: ${toIsoDate(fm.pubDatetime).replace(/\.\d{3}Z$/, "Z")}`
  );
  if (fm.modDatetime) {
    lines.push(
      `modDatetime: ${toIsoDate(fm.modDatetime).replace(/\.\d{3}Z$/, "Z")}`
    );
  }
  const tags =
    Array.isArray(fm.tags) && fm.tags.length ? fm.tags.map(String) : ["others"];
  lines.push("tags:");
  for (const tag of tags) lines.push(`  - ${JSON.stringify(tag)}`);
  lines.push(`featured: ${Boolean(fm.featured)}`);
  lines.push(`draft: ${Boolean(fm.draft)}`);
  lines.push("---");
  return lines.join("\n");
}

function parsePostFile(fileName: string, raw: string): PostMeta | null {
  if (!/\.mdx?$/i.test(fileName) || fileName.startsWith("_")) return null;
  const { data, content } = matter(raw);
  return {
    slug: fileName.replace(/\.mdx?$/i, ""),
    title: String(data.title ?? fileName),
    description: String(data.description ?? ""),
    summary: String(data.summary ?? ""),
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    author: String(data.author ?? "南烛"),
    pubDatetime: toIsoDate(data.pubDatetime),
    modDatetime: data.modDatetime ? toIsoDate(data.modDatetime) : null,
    draft: Boolean(data.draft),
    featured: Boolean(data.featured),
    chars: content.replace(/\s/g, "").length,
  };
}

/**
 * Every post the admin should be able to see, as slug → raw markdown.
 *
 * Two sources merged:
 *   - `postsSnapshot`: baked in at build time from src/data/blog/*.md. On
 *     Vercel the function bundle cannot enumerate those files at runtime.
 *   - Redis (`blog:post:*`): whatever was saved/edited since the last deploy.
 *     Redis wins for the same slug so edits show up immediately.
 *   - `blog:trash:*` tombstones hide a slug until the next deploy removes it.
 */
async function allRawPosts(): Promise<Map<string, string>> {
  const merged = new Map<string, string>();
  for (const item of postsSnapshot) merged.set(item.slug, item.raw);

  // Dev-time convenience: files dropped into src/data/blog after the last
  // build. On Vercel this directory simply isn't there and the catch fires.
  try {
    const entries = await fs.readdir(BLOG_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || entry.name.startsWith("_")) continue;
      if (!/\.mdx?$/i.test(entry.name)) continue;
      const slug = entry.name.replace(/\.mdx?$/i, "");
      if (merged.has(slug)) continue;
      merged.set(
        slug,
        await fs.readFile(path.join(BLOG_DIR, entry.name), "utf-8")
      );
    }
  } catch {
    /* serverless: no readable blog dir, snapshot is enough */
  }

  if (kvEnabled) {
    const keys = await kvKeys("blog:post:*");
    for (const key of keys) {
      const slug = key.replace("blog:post:", "");
      const raw = await kvGet<string>(key, "");
      if (raw) merged.set(slug, raw);
    }
    const trashed = await kvKeys("blog:trash:*");
    for (const key of trashed) {
      merged.delete(key.replace("blog:trash:", ""));
    }
  }
  return merged;
}

export async function listPosts(): Promise<PostMeta[]> {
  const posts: PostMeta[] = [];
  const raws = await allRawPosts();
  for (const [slug, raw] of raws) {
    const meta = parsePostFile(`${slug}.md`, raw);
    if (meta) posts.push(meta);
  }
  return posts.sort(
    (a, b) =>
      new Date(b.pubDatetime).getTime() - new Date(a.pubDatetime).getTime()
  );
}

export async function getPost(
  slug: string
): Promise<{
  slug: string;
  frontmatter: Record<string, unknown>;
  content: string;
} | null> {
  const safe = safeSlug(slug);
  if (!safe) return null;
  if (kvEnabled) {
    const raw = await kvGet<string>(`blog:post:${safe}`, "");
    if (raw) {
      const { data, content } = matter(raw);
      return { slug: safe, frontmatter: data, content };
    }
  }
  // Fall back to the repo copy (works read-only on Vercel via the snapshot).
  const raws = await allRawPosts();
  const raw = raws.get(safe);
  if (raw) {
    const { data, content } = matter(raw);
    return { slug: safe, frontmatter: data, content };
  }
  return null;
}

export async function savePost(input: {
  slug: string;
  originalSlug?: string;
  title: string;
  description: string;
  tags: string[];
  pubDatetime: string;
  modDatetime?: string | null;
  featured: boolean;
  draft: boolean;
  content: string;
}): Promise<{ slug: string }> {
  const slug = safeSlug(input.slug);
  if (!slug) throw new Error("slug 无效：只能包含字母、数字和连字符");
  requireKvOnServerless();

  const fm = {
    title: input.title,
    description: input.description,
    tags: input.tags,
    pubDatetime: input.pubDatetime,
    modDatetime: input.modDatetime || new Date().toISOString(),
    featured: input.featured,
    draft: input.draft,
  };
  const file = path.join(BLOG_DIR, `${slug}.md`);
  const body = `${buildFrontmatter(fm)}\n\n${input.content.replace(/\r\n/g, "\n").trim()}\n`;
  if (kvEnabled) {
    // Serverless: persist the markdown to KV; the build-time sync writes it
    // back to src/data/blog/ so the next deploy publishes it.
    await kvSet(`blog:post:${slug}`, body);
    if (input.originalSlug) {
      const old = safeSlug(input.originalSlug);
      if (old && old !== slug) await kvDel(`blog:post:${old}`);
    }
    return { slug };
  }
  await fs.mkdir(BLOG_DIR, { recursive: true });
  await fs.writeFile(file, body, "utf-8");
  // Renamed: remove the old file after writing the new one.
  const old = input.originalSlug ? safeSlug(input.originalSlug) : slug;
  if (old && old !== slug) {
    await fs.rm(path.join(BLOG_DIR, `${old}.md`), { force: true });
    await fs.rm(path.join(BLOG_DIR, `${old}.mdx`), { force: true });
  }
  return { slug };
}

/**
 * Rewrite *only* the `summary` line of a raw markdown file's frontmatter.
 *
 * `matter.stringify()` normalises the whole YAML block — it drops the quotes
 * around `title`, rewrites timestamps, drops the blank line after `---`, and
 * generally reorders everything. Since a summary is written on every save, that
 * churn would accumulate across the whole blog, so we patch the single line
 * textually and leave the rest of the file byte-for-byte identical.
 */
function withSummaryField(raw: string, summary: string): string {
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/.exec(raw);
  if (!match) return raw; // 没有 frontmatter，原样返回
  const fmText = match[1];
  const rest = match[2] ?? "";
  const lines = fmText.split("\n");
  // JSON.stringify 产出的双引号标量是合法 YAML，且能安全承载换行/引号/emoji
  const value = summary ? `summary: ${JSON.stringify(summary)}` : "";

  let keyAt = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^summary[ \t]*:/.test(lines[i])) {
      keyAt = i;
      break;
    }
  }
  if (keyAt >= 0) {
    if (!summary) lines.splice(keyAt, 1);
    else lines[keyAt] = value;
  } else if (summary) {
    // 插到最后一个顶层键之后，保持阅读顺序稳定
    let last = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/^[^\s#][^:#]*:[ \t]/.test(lines[i]) || /^[^\s#][^:#]*:$/.test(lines[i])) last = i;
    }
    lines.splice(last + 1, 0, value);
  }
  return `---\n${lines.join("\n")}\n---${rest ? `\n${rest}` : "\n"}`;
}

/**
 * Write the AI summary into a post's frontmatter (`summary` field) without
 * touching the body. Used by the editor's "generate summary" flow, which
 * already saved the post and only wants to enrich it afterwards.
 */
export async function setPostSummary(
  slug: string,
  summary: string
): Promise<{ slug: string }> {
  const safe = safeSlug(slug);
  if (!safe) throw new Error("slug 无效");
  requireKvOnServerless();

  const raws = await allRawPosts();
  const raw = raws.get(safe);
  if (!raw) throw new Error("文章不存在，请先保存文章再生成摘要");
  const body = withSummaryField(raw, summary);
  if (kvEnabled) {
    await kvSet(`blog:post:${safe}`, body);
    return { slug: safe };
  }
  await fs.mkdir(BLOG_DIR, { recursive: true });
  await fs.writeFile(path.join(BLOG_DIR, `${safe}.md`), body, "utf-8");
  return { slug: safe };
}

/** Soft delete: move the markdown file into the admin trash folder. */
export async function trashPost(slug: string): Promise<boolean> {
  const safe = safeSlug(slug);
  if (!safe) return false;
  if (kvEnabled) {
    const inRedis = Boolean(await kvGet<string>(`blog:post:${safe}`, ""));
    // A post that only exists as a repo file still needs a tombstone,
    // otherwise the next build would restore it from src/data/blog.
    if (!inRedis && !(await allRawPosts()).has(safe)) return false;
    await kvSet(`blog:trash:${safe}`, new Date().toISOString());
    if (inRedis) await kvDel(`blog:post:${safe}`);
    return true;
  }
  for (const ext of [".md", ".mdx"]) {
    const from = path.join(BLOG_DIR, safe + ext);
    try {
      await fs.access(from);
      await fs.mkdir(TRASH_DIR, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      await fs.rename(from, path.join(TRASH_DIR, `${stamp}-${safe}${ext}`));
      return true;
    } catch {
      /* try next extension */
    }
  }
  return false;
}

export type LogEntry = { time: string; action: string; detail: string };

const LOG_STORE = {
  read: async (): Promise<LogEntry[]> => {
    if (kvEnabled) return kvGet<LogEntry[]>("admin:logs", []);
    try {
      const logs = JSON.parse(await fs.readFile(LOG_FILE, "utf-8"));
      return Array.isArray(logs) ? logs : [];
    } catch {
      return [];
    }
  },
  write: async (logs: LogEntry[]): Promise<void> => {
    if (kvEnabled) return kvSet("admin:logs", logs);
    await fs.mkdir(ADMIN_DIR, { recursive: true });
    await fs.writeFile(LOG_FILE, JSON.stringify(logs, null, 2), "utf-8");
  },
};

export async function appendLog(action: string, detail: string): Promise<void> {
  try {
    const logs = await LOG_STORE.read();
    logs.unshift({ time: new Date().toISOString(), action, detail });
    await LOG_STORE.write(logs.slice(0, 200));
  } catch {
    // Logging must never break the actual operation (e.g. login).
  }
}

export async function getLogs(): Promise<LogEntry[]> {
  return LOG_STORE.read();
}

export async function clearLogs(): Promise<void> {
  await LOG_STORE.write([]);
}

export async function getStats() {
  const posts = await listPosts();
  const published = posts.filter(p => !p.draft);
  const tagSet = new Set<string>();
  for (const post of posts) post.tags.forEach(t => tagSet.add(t));
  const totalChars = posts.reduce((sum, p) => sum + p.chars, 0);

  // Posts per month over the last 12 months (for the trend chart).
  const months: { label: string; count: number }[] = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    months.push({ label: key, count: 0 });
  }
  for (const post of published) {
    const key = post.pubDatetime.slice(0, 7);
    const bucket = months.find(m => m.label === key);
    if (bucket) bucket.count += 1;
  }

  return {
    totalPosts: posts.length,
    publishedPosts: published.length,
    draftPosts: posts.length - published.length,
    totalChars,
    tagCount: tagSet.size,
    lastUpdate: posts[0]?.pubDatetime ?? null,
    recent: posts.slice(0, 5),
    monthly: months,
  };
}
