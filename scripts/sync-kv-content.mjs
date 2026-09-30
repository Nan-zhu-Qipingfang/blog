/**
 * Build-time content sync: pull posts saved through the admin backend (KV)
 * back into src/data/blog/*.md so the static build includes them.
 *
 * Runs before `astro build`. Skips silently when no KV env is configured.
 * Also applies deletions made in the admin (blog:trash:<slug>).
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

const BLOG_DIR = path.resolve("src/data/blog");

if (!REST_URL || !REST_TOKEN) {
  console.log("[sync-kv] no KV configured, skipping");
  process.exit(0);
}

async function rest(command) {
  const res = await fetch(`${REST_URL}/${command}`, {
    headers: { Authorization: `Bearer ${REST_TOKEN}` },
  });
  if (!res.ok) throw new Error(`KV ${command} -> ${res.status}`);
  const json = await res.json();
  if (json?.error) throw new Error(`KV error: ${json.error}`);
  return json?.result;
}

await fs.mkdir(BLOG_DIR, { recursive: true });

// 1) upsert saved posts
const keys = (await rest(`keys/${encodeURIComponent("blog:post:*")}`)) || [];
let written = 0;
for (const key of keys) {
  const slug = key.replace("blog:post:", "");
  if (!/^[a-z0-9-]+$/.test(slug)) continue;
  const raw = await rest(`get/${encodeURIComponent(key)}`);
  if (!raw) continue;
  await fs.writeFile(path.join(BLOG_DIR, `${slug}.md`), String(raw), "utf-8");
  written += 1;
  console.log(`[sync-kv] wrote ${slug}.md`);
}

// 2) apply deletions
const trashKeys = (await rest(`keys/${encodeURIComponent("blog:trash:*")}`)) || [];
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
  await rest(`del/${encodeURIComponent(key)}`);
  console.log(`[sync-kv] removed ${slug}`);
}

console.log(`[sync-kv] done: ${written} written, ${removed} removed`);
