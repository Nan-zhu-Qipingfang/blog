/**
 * Persistent KV storage for serverless environments (Vercel KV / Upstash Redis).
 *
 * On Vercel the filesystem is read-only, so the admin backend cannot persist
 * data in JSON files. This adapter talks to the Upstash-compatible REST API
 * that both "Vercel KV (Redis)" and a standalone Upstash Redis database expose:
 *
 *   KV_REST_API_URL / KV_REST_API_TOKEN   (Vercel KV, injected automatically)
 *   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
 *   REDIS_URL                             (rediss://default:TOKEN@host:port)
 *
 * The last one matters: some Vercel / Upstash integrations inject ONLY
 * `REDIS_URL` (a direct Redis connection string) and no REST variables at all.
 * Upstash serves the REST API from the same host with the same credential, so
 * we derive `https://<host>` + the password from it.
 *
 * When nothing is configured (local development) the store transparently
 * falls back to JSON files on disk, preserving the original dev experience.
 */
import fs from "node:fs/promises";
import path from "node:path";

/** Derive an Upstash REST endpoint from a `rediss://default:TOKEN@host:port` URL. */
function deriveFromRedisUrl(
  raw: string
): { url: string; token: string } | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const host = u.hostname;
    // Upstash puts the REST token in the password slot ("default:<token>").
    const token =
      decodeURIComponent(u.password || "") ||
      decodeURIComponent(u.username || "");
    if (!host || !token || token === "default") return null;
    return { url: `https://${host}`, token };
  } catch {
    return null;
  }
}

const derived = deriveFromRedisUrl(process.env.REDIS_URL || "");

const REST_URL = (
  process.env.KV_REST_API_URL ||
  process.env.UPSTASH_REDIS_REST_URL ||
  derived?.url ||
  ""
).replace(/\/+$/, "");
const REST_TOKEN =
  process.env.KV_REST_API_TOKEN ||
  process.env.UPSTASH_REDIS_REST_TOKEN ||
  derived?.token ||
  "";

export const kvEnabled = Boolean(REST_URL && REST_TOKEN);

/** Admin-facing status check: which env vars are present (without leaking values). */
export const kvStatus = {
  url: Boolean(REST_URL),
  token: Boolean(REST_TOKEN),
  enabled: kvEnabled,
  source: process.env.KV_REST_API_URL
    ? "KV_REST_API_URL"
    : process.env.UPSTASH_REDIS_REST_URL
      ? "UPSTASH_REDIS_REST_URL"
      : derived
        ? "REDIS_URL（已自动推导 REST 端点）"
        : "(无)",
  /** True when REDIS_URL existed but could not be parsed into host + token. */
  redisUrlPresent: Boolean(process.env.REDIS_URL),
  redisUrlUsable: Boolean(derived),
  /** Host only — never the credential. */
  endpoint: REST_URL ? REST_URL.replace(/^https?:\/\//, "") : "(无)",
};

const LOCAL_DIR = path.resolve(".data/kv");

/** Common guard: Vercel's filesystem is read-only, so any write that falls back
 *  to local files is guaranteed to fail with EROFS. Failing early with a clear
 *  message is much better than a cryptic filesystem error. */
function guardServerlessWrite(): void {
  if (kvEnabled) return;
  if (process.env.VERCEL || process.env.VERCEL_ENV) {
    throw new Error(
      "Vercel 文件系统为只读，必须先在项目设置里绑定 Redis(Upstash) 数据库，" +
        "让 KV_REST_API_URL / KV_REST_API_TOKEN 自动注入，然后重新部署。"
    );
  }
}

function localFile(key: string): string {
  const safe = key.replace(/[^a-zA-Z0-9_-]/g, "__");
  return path.join(LOCAL_DIR, `${safe}.json`);
}

async function rest(command: string): Promise<unknown> {
  const res = await fetch(`${REST_URL}/${command}`, {
    headers: { Authorization: `Bearer ${REST_TOKEN}` },
  });
  if (!res.ok)
    throw new Error(`KV ${command.split("/")[0]} failed: ${res.status}`);
  const json = (await res.json()) as { result?: unknown; error?: string };
  if (json?.error) throw new Error(`KV error: ${json.error}`);
  return json?.result;
}

/** Real read/write/delete round-trip so the admin can prove KV actually works. */
export async function kvProbe(): Promise<{ ok: boolean; error?: string }> {
  if (!kvEnabled) return { ok: false, error: "未检测到可用的 KV 环境变量" };
  const key = "blog:__probe__";
  try {
    await rest(`set/${encodeURIComponent(key)}/1`);
    const value = await rest(`get/${encodeURIComponent(key)}`);
    await rest(`del/${encodeURIComponent(key)}`);
    return String(value) === "1"
      ? { ok: true }
      : { ok: false, error: `写入后读回的值不符：${String(value)}` };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
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
  guardServerlessWrite();
  const payload = JSON.stringify(value);
  if (kvEnabled) {
    await rest(`set/${encodeURIComponent(key)}/${encodeURIComponent(payload)}`);
    return;
  }
  await fs.mkdir(LOCAL_DIR, { recursive: true });
  await fs.writeFile(localFile(key), payload, "utf-8");
}

export async function kvDel(key: string): Promise<void> {
  guardServerlessWrite();
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
      "^" +
        pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, ".*") +
        "$"
    );
    return files
      .filter(f => f.endsWith(".json"))
      .map(f => f.replace(/\.json$/, ""))
      .filter(f => rx.test(f));
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
    read: async <T>(fallback: T): Promise<T> => {
      if (kvEnabled) return kvGet<T>(key, fallback);
      try {
        return JSON.parse(await fs.readFile(file, "utf-8")) as T;
      } catch {
        return fallback;
      }
    },
    write: async (data: unknown): Promise<void> => {
      if (kvEnabled) return kvSet(key, data);
      guardServerlessWrite();
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, JSON.stringify(data, null, 2), "utf-8");
    },
  };
}
