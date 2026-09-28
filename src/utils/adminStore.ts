/**
 * Admin backend data layer: post CRUD (markdown files), stats and operation logs.
 *
 * Posts live in src/data/blog/*.md (content collection). Deleted posts are
 * moved to src/data/admin/trash/ (outside the collection glob) instead of
 * being destroyed.
 */
import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { BLOG_PATH } from "@/content.config";

export const BLOG_DIR = path.resolve(BLOG_PATH);
const ADMIN_DIR = path.resolve("src/data/admin");
const TRASH_DIR = path.join(ADMIN_DIR, "trash");
const LOG_FILE = path.join(ADMIN_DIR, "logs.json");

export type PostMeta = {
  slug: string;
  title: string;
  description: string;
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
  return Number.isNaN(date.getTime()) ? fallback.toISOString() : date.toISOString();
}

/** Serialize frontmatter by hand so datetime stays unquoted (YAML date). */
function buildFrontmatter(fm: Record<string, unknown>): string {
  const lines: string[] = ["---"];
  lines.push(`title: ${JSON.stringify(String(fm.title ?? "无题"))}`);
  lines.push(`description: ${JSON.stringify(String(fm.description ?? ""))}`);
  lines.push(`author: ${JSON.stringify(String(fm.author ?? "南烛"))}`);
  lines.push(`pubDatetime: ${toIsoDate(fm.pubDatetime).replace(/\.\d{3}Z$/, "Z")}`);
  if (fm.modDatetime) {
    lines.push(`modDatetime: ${toIsoDate(fm.modDatetime).replace(/\.\d{3}Z$/, "Z")}`);
  }
  const tags = Array.isArray(fm.tags) && fm.tags.length ? fm.tags.map(String) : ["others"];
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
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    author: String(data.author ?? "南烛"),
    pubDatetime: toIsoDate(data.pubDatetime),
    modDatetime: data.modDatetime ? toIsoDate(data.modDatetime) : null,
    draft: Boolean(data.draft),
    featured: Boolean(data.featured),
    chars: content.replace(/\s/g, "").length,
  };
}

export async function listPosts(): Promise<PostMeta[]> {
  const entries = await fs.readdir(BLOG_DIR, { withFileTypes: true });
  const posts: PostMeta[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const raw = await fs.readFile(path.join(BLOG_DIR, entry.name), "utf-8");
    const meta = parsePostFile(entry.name, raw);
    if (meta) posts.push(meta);
  }
  return posts.sort(
    (a, b) => new Date(b.pubDatetime).getTime() - new Date(a.pubDatetime).getTime(),
  );
}

export async function getPost(
  slug: string,
): Promise<{ slug: string; frontmatter: Record<string, unknown>; content: string } | null> {
  const safe = safeSlug(slug);
  if (!safe) return null;
  for (const ext of [".md", ".mdx"]) {
    try {
      const raw = await fs.readFile(path.join(BLOG_DIR, safe + ext), "utf-8");
      const { data, content } = matter(raw);
      return { slug: safe, frontmatter: data, content };
    } catch {
      /* try next extension */
    }
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

/** Soft delete: move the markdown file into the admin trash folder. */
export async function trashPost(slug: string): Promise<boolean> {
  const safe = safeSlug(slug);
  if (!safe) return false;
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

export async function appendLog(action: string, detail: string): Promise<void> {
  let logs: LogEntry[] = [];
  try {
    logs = JSON.parse(await fs.readFile(LOG_FILE, "utf-8"));
    if (!Array.isArray(logs)) logs = [];
  } catch {
    /* first entry */
  }
  logs.unshift({ time: new Date().toISOString(), action, detail });
  await fs.mkdir(ADMIN_DIR, { recursive: true });
  await fs.writeFile(LOG_FILE, JSON.stringify(logs.slice(0, 200), null, 2), "utf-8");
}

export async function getLogs(): Promise<LogEntry[]> {
  try {
    const logs = JSON.parse(await fs.readFile(LOG_FILE, "utf-8"));
    return Array.isArray(logs) ? logs : [];
  } catch {
    return [];
  }
}

export async function clearLogs(): Promise<void> {
  await fs.mkdir(ADMIN_DIR, { recursive: true });
  await fs.writeFile(LOG_FILE, "[]", "utf-8");
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
