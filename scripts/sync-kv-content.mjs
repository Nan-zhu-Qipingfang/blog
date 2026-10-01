/**
 * Build-time content sync.
 *
 * 1. Pull posts saved through the admin backend (Redis) back into
 *    src/data/blog/*.md so the static build includes them, and apply
 *    deletions recorded as `blog:trash:<slug>` tombstones.
 * 2. Snapshot every local markdown post into `src/generated/postsSnapshot.ts`.
 *    The Vercel function bundle only ships files the tracer can see, and
 *    `src/data/blog/*.md` is not one of them — the admin backend therefore
 *    cannot list existing article files at runtime. A generated module is
 *    statically imported, so it is always bundled.
 *
 * Runs before `astro build`. Skips the Redis part silently when no Redis env
 * is configured; the snapshot is always written.
 *
 * Two Redis transports, mirroring src/utils/kvStore.ts:
 *   REST — KV_REST_API_URL + KV_REST_API_TOKEN (Upstash)
 *   TCP  — REDIS_URL / KV_URL (any Redis, e.g. Redis Cloud), via ioredis
 */
import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";

const REST_URL = (
  process.env.KV_REST_API_URL ||
  process.env.UPSTASH_REDIS_REST_URL ||
  ""
).replace(/\/+$/, "");
const REST_TOKEN =
  process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
const TCP_URL = process.env.REDIS_URL || process.env.KV_URL || "";

const BLOG_DIR = path.resolve("src/data/blog");
const GENERATED_DIR = path.resolve("src/generated");
const SNAPSHOT_FILE = path.join(GENERATED_DIR, "postsSnapshot.ts");

const tcpUsable = (() => {
  if (!TCP_URL) return false;
  try {
    return Boolean(new URL(TCP_URL).hostname);
  } catch {
    return false;
  }
})();

const mode = REST_URL && REST_TOKEN ? "rest" : tcpUsable ? "tcp" : "none";
const enc = encodeURIComponent;

console.log(`[sync-kv] transport: ${mode}`);

async function rest(command) {
  const res = await fetch(`${REST_URL}/${command}`, {
    headers: { Authorization: `Bearer ${REST_TOKEN}` },
  });
  if (!res.ok) throw new Error(`KV ${command} -> ${res.status}`);
  const json = await res.json();
  if (json?.error) throw new Error(`KV error: ${json.error}`);
  return json?.result;
}

let redis = null;
async function tcp() {
  if (!redis) {
    const { default: Redis } = await import("ioredis");
    redis = new Redis(TCP_URL, {
      connectTimeout: 8000,
      maxRetriesPerRequest: 2,
    });
    redis.on("error", () => {
      /* swallowed */
    });
  }
  return redis;
}

async function cmdGet(key) {
  return mode === "rest" ? rest(`get/${enc(key)}`) : (await tcp()).get(key);
}
async function cmdKeys(pattern) {
  const out =
    mode === "rest"
      ? await rest(`keys/${enc(pattern)}`)
      : await (await tcp()).keys(pattern);
  return out || [];
}
async function cmdDel(key) {
  return mode === "rest" ? rest(`del/${enc(key)}`) : (await tcp()).del(key);
}

await fs.mkdir(BLOG_DIR, { recursive: true });

let written = 0;
let removed = 0;

/**
 * Admin posts are stored with `kvSet`, which JSON-encodes the value, so a raw
 * GET returns `"---\ntitle: …\n---"` with literal \n escapes. Decode it back to
 * real markdown before writing it to disk — otherwise the file has no parseable
 * frontmatter and the content collection rejects it.
 */
function decode(raw) {
  const text = String(raw ?? "");
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === "string") return parsed;
  } catch {
    /* not JSON — already plain markdown */
  }
  return text;
}

function toIsoDate(value) {
  const date = value instanceof Date ? value : new Date(String(value ?? ""));
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

/** First ~100 chars of readable text, used when a post has no description. */
function excerpt(content) {
  return (
    content
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/<\/?[a-zA-Z][^>]*>/g, "")
      .replace(/[#>*_`~|-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 100) || ""
  );
}

/**
 * Normalise frontmatter so every synced post satisfies the collection schema
 * (title / description / pubDatetime are required). One malformed post would
 * otherwise fail the whole build.
 */
function normalize(raw, slug) {
  const { data, content } = matter(raw);
  const description = String(data.description ?? data.desc ?? "").trim();
  return matter.stringify(content, {
    title: String(data.title ?? slug),
    description: description || excerpt(content),
    // AI 摘要由后台生成，构建期原样带回来（空值会被 collection schema 忽略）
    ...(String(data.summary ?? "").trim()
      ? { summary: String(data.summary).trim() }
      : {}),
    author: String(data.author ?? "南烛"),
    pubDatetime: toIsoDate(data.pubDatetime ?? data.date ?? data.published),
    ...(data.modDatetime || data.updated || data.lastmod
      ? {
          modDatetime: toIsoDate(
            data.modDatetime ?? data.updated ?? data.lastmod
          ),
        }
      : {}),
    tags:
      Array.isArray(data.tags) && data.tags.length
        ? data.tags.map(String)
        : ["others"],
    featured: Boolean(data.featured ?? data.sticky ?? false),
    draft: Boolean(data.draft ?? false),
  });
}

// 1) Redis → files
if (mode !== "none") {
  const keys = await cmdKeys("blog:post:*");
  for (const key of keys) {
    const slug = key.replace("blog:post:", "");
    if (!/^[a-z0-9-]+$/.test(slug)) continue;
    const raw = decode(await cmdGet(key));
    if (!raw.trim()) continue;
    await fs.writeFile(
      path.join(BLOG_DIR, `${slug}.md`),
      normalize(raw, slug),
      "utf-8"
    );
    written += 1;
    console.log(`[sync-kv] wrote ${slug}.md`);
  }

  const trashKeys = await cmdKeys("blog:trash:*");
  for (const key of trashKeys) {
    const slug = key.replace("blog:trash:", "");
    if (!/^[a-z0-9-]+$/.test(slug)) continue;
    let gone = false;
    for (const ext of [".md", ".mdx"]) {
      try {
        await fs.rm(path.join(BLOG_DIR, slug + ext), { force: true });
        gone = true;
      } catch {
        /* ignore */
      }
    }
    // consume the tombstone so it only applies once per deploy
    await cmdDel(key);
    if (gone) removed += 1;
    console.log(`[sync-kv] removed ${slug}`);
  }
}

if (redis) {
  try {
    await redis.quit();
  } catch {
    /* ignore */
  }
}

// 2) Snapshot every local post for the admin backend
const entries = await fs.readdir(BLOG_DIR, { withFileTypes: true });
const snapshot = [];
for (const entry of entries) {
  if (!entry.isFile() || entry.name.startsWith("_")) continue;
  if (!/\.mdx?$/i.test(entry.name)) continue;
  const slug = entry.name.replace(/\.mdx?$/i, "");
  const raw = await fs.readFile(path.join(BLOG_DIR, entry.name), "utf-8");
  snapshot.push({ slug, raw });
}
await fs.mkdir(GENERATED_DIR, { recursive: true });
await fs.writeFile(
  SNAPSHOT_FILE,
  `// AUTO-GENERATED by scripts/sync-kv-content.mjs — do not edit.\n` +
    `// The admin backend runs on a read-only serverless filesystem and cannot\n` +
    `// enumerate src/data/blog/*.md at runtime, so the list is baked in here.\n` +
    `export type PostSnapshot = { slug: string; raw: string };\n` +
    `export const postsSnapshot: PostSnapshot[] = ${JSON.stringify(snapshot)};\n`,
  "utf-8"
);

console.log(
  `[sync-kv] done: ${written} written, ${removed} removed, ${snapshot.length} in snapshot`
);
