/**
 * Build-time content sync: pull posts saved through the admin backend (Redis)
 * back into src/data/blog/*.md so the static build includes them.
 *
 * Runs before `astro build`. Skips silently when no Redis env is configured.
 * Also applies deletions made in the admin (blog:trash:<slug>).
 *
 * Two transports, mirroring src/utils/kvStore.ts:
 *   REST — KV_REST_API_URL + KV_REST_API_TOKEN (Upstash)
 *   TCP  — REDIS_URL / KV_URL (any Redis, e.g. Redis Cloud), via ioredis
 */
import fs from "node:fs/promises";
import path from "node:path";

const REST_URL = (
  process.env.KV_REST_API_URL ||
  process.env.UPSTASH_REDIS_REST_URL ||
  ""
).replace(/\/+$/, "");
const REST_TOKEN =
  process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
const TCP_URL = process.env.REDIS_URL || process.env.KV_URL || "";

const BLOG_DIR = path.resolve("src/data/blog");

const tcpUsable = (() => {
  if (!TCP_URL) return false;
  try {
    return Boolean(new URL(TCP_URL).hostname);
  } catch {
    return false;
  }
})();

const mode = REST_URL && REST_TOKEN ? "rest" : tcpUsable ? "tcp" : "none";

if (mode === "none") {
  console.log("[sync-kv] no Redis configured, skipping");
  process.exit(0);
}

console.log(`[sync-kv] transport: ${mode}`);

const enc = encodeURIComponent;

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
    mode === "rest" ? await rest(`keys/${enc(pattern)}`) : await (await tcp()).keys(pattern);
  return out || [];
}
async function cmdDel(key) {
  return mode === "rest" ? rest(`del/${enc(key)}`) : (await tcp()).del(key);
}

await fs.mkdir(BLOG_DIR, { recursive: true });

// 1) upsert saved posts
const keys = await cmdKeys("blog:post:*");
let written = 0;
for (const key of keys) {
  const slug = key.replace("blog:post:", "");
  if (!/^[a-z0-9-]+$/.test(slug)) continue;
  const raw = await cmdGet(key);
  if (!raw) continue;
  await fs.writeFile(path.join(BLOG_DIR, `${slug}.md`), String(raw), "utf-8");
  written += 1;
  console.log(`[sync-kv] wrote ${slug}.md`);
}

// 2) apply deletions
const trashKeys = await cmdKeys("blog:trash:*");
let removed = 0;
for (const key of trashKeys) {
  const slug = key.replace("blog:trash:", "");
  if (!/^[a-z0-9-]+$/.test(slug)) continue;
  for (const ext of [".md", ".mdx"]) {
    try {
      await fs.rm(path.join(BLOG_DIR, slug + ext), { force: true });
      removed += 1;
    } catch {
      /* ignore */
    }
  }
  // consume the tombstone so it only applies once per deploy
  await cmdDel(key);
  console.log(`[sync-kv] removed ${slug}`);
}

if (redis) {
  try {
    await redis.quit();
  } catch {
    /* ignore */
  }
}

console.log(`[sync-kv] done: ${written} written, ${removed} removed`);
