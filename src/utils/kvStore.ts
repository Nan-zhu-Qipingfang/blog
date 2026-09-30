/**
 * Persistent KV storage for serverless environments (Vercel KV / Upstash Redis).
 *
 * On Vercel the filesystem is read-only, so the admin backend cannot persist
 * data in JSON files. This adapter talks to the Upstash-compatible REST API
 * that both "Vercel KV (Redis)" and a standalone Upstash Redis database expose:
 *
 *   KV_REST_API_URL / KV_REST_API_TOKEN   (Vercel KV, injected automatically)
 *   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
 *
 * When neither pair is configured (local development) the store transparently
 * falls back to JSON files on disk, preserving the original dev experience.
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

export const kvEnabled = Boolean(REST_URL && REST_TOKEN);

const LOCAL_DIR = path.resolve(".data/kv");

function localFile(key: string): string {
  const safe = key.replace(/[^a-zA-Z0-9_-]/g, "__");
  return path.join(LOCAL_DIR, `${safe}.json`);
}

async function rest(command: string): Promise<unknown> {
  const res = await fetch(`${REST_URL}/${command}`, {
    headers: { Authorization: `Bearer ${REST_TOKEN}` },
  });
  if (!res.ok) throw new Error(`KV ${command.split("/")[0]} failed: ${res.status}`);
  const json = (await res.json()) as { result?: unknown; error?: string };
  if (json?.error) throw new Error(`KV error: ${json.error}`);
  return json?.result;
}

/** Read a JSON value. Returns `fallback` when missing/unavailable. */
export async function kvGet<T>(key: string, fallback: T): Promise<T> {
  if (kvEnabled) {
    try {
      const raw = await rest(`get/${encodeURIComponent(key)}`);
      if (raw == null) return fallback;
      return JSON.parse(String(raw)) as T;
    } catch {
      return fallback;
    }
  }
  try {
    return JSON.parse(await fs.readFile(localFile(key), "utf-8")) as T;
  } catch {
    return fallback;
  }
}

/** Write a JSON value. Throws on failure so callers can surface errors. */
export async function kvSet(key: string, value: unknown): Promise<void> {
  const payload = JSON.stringify(value);
  if (kvEnabled) {
    await rest(`set/${encodeURIComponent(key)}/${encodeURIComponent(payload)}`);
    return;
  }
  await fs.mkdir(LOCAL_DIR, { recursive: true });
  await fs.writeFile(localFile(key), payload, "utf-8");
}

export async function kvDel(key: string): Promise<void> {
  if (kvEnabled) {
    await rest(`del/${encodeURIComponent(key)}`);
    return;
  }
  try {
    await fs.rm(localFile(key), { force: true });
  } catch {
    /* ignore */
  }
}

/** KEYS by glob pattern (used by the build-time content sync). */
export async function kvKeys(pattern: string): Promise<string[]> {
  if (kvEnabled) {
    try {
      const result = await rest(`keys/${encodeURIComponent(pattern)}`);
      return Array.isArray(result) ? (result as string[]) : [];
    } catch {
      return [];
    }
  }
  try {
    const files = await fs.readdir(LOCAL_DIR);
    const rx = new RegExp(
      "^" + pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, ".*") + "$",
    );
    return files.filter(f => f.endsWith(".json")).map(f => f.replace(/\.json$/, "")).filter(f => rx.test(f));
  } catch {
    return [];
  }
}

/**
 * A JSON "file" store that persists to KV in production and to the original
 * JSON file locally, so existing dev data keeps working.
 */
export function jsonStore(file: string, key: string) {
  return {
    read: async <T,>(fallback: T): Promise<T> => {
      if (kvEnabled) return kvGet<T>(key, fallback);
      try {
        return JSON.parse(await fs.readFile(file, "utf-8")) as T;
      } catch {
        return fallback;
      }
    },
    write: async (data: unknown): Promise<void> => {
      if (kvEnabled) return kvSet(key, data);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, JSON.stringify(data, null, 2), "utf-8");
    },
  };
}
