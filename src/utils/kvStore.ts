/**
 * Persistent KV storage for serverless environments (Vercel FS is read-only).
 *
 * Two transports are supported, picked automatically at runtime:
 *
 *   1. REST   — Upstash-compatible HTTP API, needs BOTH
 *               KV_REST_API_URL / KV_REST_API_TOKEN
 *               or UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
 *   2. TCP    — a plain Redis connection string `REDIS_URL` / `KV_URL`
 *               (redis://… or rediss://…), used with `ioredis`. This covers
 *               providers that expose no REST API at all (e.g. Redis Cloud).
 *
 * Note: `REDIS_URL` is NOT the REST endpoint. For Upstash the two happen to
 * share a host, but the token differs, so the TCP transport is only chosen
 * when no REST credentials exist.
 *
 * When nothing is configured (local development) the store transparently
 * falls back to JSON files on disk, preserving the original dev experience.
 */
import fs from "node:fs/promises";
import path from "node:path";
// Static (not dynamic) import: Vercel's file tracer only ships modules it can
// see, and a bare dynamic import risks "Cannot find module 'ioredis'" at
// runtime. ioredis is pure JS, so importing it eagerly costs nothing.
import { Redis } from "ioredis";

const REST_URL = (
  process.env.KV_REST_API_URL ||
  process.env.UPSTASH_REDIS_REST_URL ||
  ""
).replace(/\/+$/, "");
const REST_TOKEN =
  process.env.KV_REST_API_TOKEN ||
  process.env.UPSTASH_REDIS_REST_TOKEN ||
  "";

const TCP_URL = process.env.REDIS_URL || process.env.KV_URL || "";

/** `redis://default:pass@host:port` is usable as long as it parses. */
function tcpUsable(raw: string): boolean {
  if (!raw) return false;
  try {
    return Boolean(new URL(raw).hostname);
  } catch {
    return false;
  }
}

const restReady = Boolean(REST_URL && REST_TOKEN);
const tcpReady = tcpUsable(TCP_URL);

/** REST wins when available: it needs no connection pool in serverless. */
export type Transport = "rest" | "tcp" | "none";
export const transport: Transport = restReady
  ? "rest"
  : tcpReady
    ? "tcp"
    : "none";

export const kvEnabled = transport !== "none";

/** Admin-facing status check: which env vars are present (without leaking values). */
export const kvStatus = {
  url: Boolean(REST_URL),
  token: Boolean(REST_TOKEN),
  enabled: kvEnabled,
  transport,
  source: restReady
    ? process.env.KV_REST_API_URL
      ? "KV_REST_API_URL（REST）"
      : "UPSTASH_REDIS_REST_URL（REST）"
    : tcpReady
      ? "REDIS_URL（TCP 直连）"
      : "(无)",
  /** True when a Redis connection string exists at all. */
  redisUrlPresent: Boolean(TCP_URL),
  /** True when that connection string can actually be parsed/used. */
  redisUrlUsable: tcpReady,
  /** Host only — never the credential. */
  endpoint:
    transport === "rest"
      ? REST_URL.replace(/^https?:\/\//, "")
      : transport === "tcp"
        ? new URL(TCP_URL).host
        : "(无)",
};

const LOCAL_DIR = path.resolve(".data/kv");

/** Common guard: Vercel's filesystem is read-only, so any write that falls back
 *  to local files is guaranteed to fail with EROFS. Failing early with a clear
 *  message is much better than a cryptic filesystem error. */
function guardServerlessWrite(): void {
  if (kvEnabled) return;
  if (process.env.VERCEL || process.env.VERCEL_ENV) {
    throw new Error(
      "Vercel 文件系统为只读，必须先配置 Redis 存储（Upstash REST 变量或 REDIS_URL），然后重新部署。"
    );
  }
}

function localFile(key: string): string {
  const safe = key.replace(/[^a-zA-Z0-9_-]/g, "__");
  return path.join(LOCAL_DIR, `${safe}.json`);
}

const enc = encodeURIComponent;

/* ─── Transport: REST ──────────────────────────────────────────────────── */

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

/* ─── Transport: TCP (ioredis) ─────────────────────────────────────────── */

const globalRef = globalThis as typeof globalThis & {
  __blogRedis?: Redis;
  __blogRedisBroken?: boolean;
};

/** One client per warm process; recreated if the connection dies. */
async function tcp(): Promise<Redis> {
  if (globalRef.__blogRedis && !globalRef.__blogRedisBroken) {
    return globalRef.__blogRedis;
  }
  const client = new Redis(TCP_URL, {
    connectTimeout: 8000,
    maxRetriesPerRequest: 2,
    retryStrategy: times => (times > 3 ? null : Math.min(times * 200, 800)),
  });
  // Commands surface their own errors; without this, an idle-client error
  // would become an unhandled rejection and kill the function.
  client.on("error", () => {
    /* intentionally swallowed */
  });
  globalRef.__blogRedis = client;
  globalRef.__blogRedisBroken = false;
  return client;
}

/** Run a command, retrying once on a stale connection. */
async function tcpCall<T>(run: (client: Redis) => Promise<T>): Promise<T> {
  const client = await tcp();
  try {
    return await run(client);
  } catch (error) {
    const message = String((error as Error)?.message ?? error);
    if (/connection is closed|stream not writeable|ECONNRESET|socket|ETIMEDOUT/i.test(message)) {
      globalRef.__blogRedisBroken = true;
      try {
        await client.disconnect();
      } catch {
        /* ignore */
      }
      globalRef.__blogRedis = undefined;
      return run(await tcp());
    }
    throw error;
  }
}

/* ─── Primitives ───────────────────────────────────────────────────────── */

async function rawGet(key: string): Promise<string | null> {
  if (transport === "rest") {
    const raw = await rest(`get/${enc(key)}`);
    return raw == null ? null : String(raw);
  }
  if (transport === "tcp") {
    return tcpCall(client => client.get(key));
  }
  throw new Error("KV 未启用");
}

async function rawSet(key: string, value: string): Promise<void> {
  guardServerlessWrite();
  if (transport === "rest") {
    await rest(`set/${enc(key)}/${enc(value)}`);
    return;
  }
  if (transport === "tcp") {
    await tcpCall(client => client.set(key, value));
    return;
  }
  await fs.mkdir(LOCAL_DIR, { recursive: true });
  await fs.writeFile(localFile(key), value, "utf-8");
}

async function rawDel(key: string): Promise<void> {
  guardServerlessWrite();
  if (transport === "rest") {
    await rest(`del/${enc(key)}`);
    return;
  }
  if (transport === "tcp") {
    await tcpCall(client => client.del(key));
    return;
  }
  try {
    await fs.rm(localFile(key), { force: true });
  } catch {
    /* ignore */
  }
}

async function rawKeys(pattern: string): Promise<string[]> {
  if (transport === "rest") {
    const result = await rest(`keys/${enc(pattern)}`);
    return Array.isArray(result) ? (result as string[]) : [];
  }
  if (transport === "tcp") {
    const result = await tcpCall(client => client.keys(pattern));
    return Array.isArray(result) ? result : [];
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

/** Real read/write/delete round-trip so the admin can prove KV actually works. */
export async function kvProbe(): Promise<{ ok: boolean; error?: string }> {
  if (!kvEnabled) return { ok: false, error: "未检测到可用的 Redis 环境变量" };
  const key = "blog:__probe__";
  try {
    await rawSet(key, "1");
    const value = await rawGet(key);
    await rawDel(key);
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
      const raw = await rawGet(key);
      if (raw == null) return fallback;
      return JSON.parse(raw) as T;
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
  await rawSet(key, JSON.stringify(value));
}

export async function kvDel(key: string): Promise<void> {
  await rawDel(key);
}

/** KEYS by glob pattern (used by the build-time content sync). */
export async function kvKeys(pattern: string): Promise<string[]> {
  if (kvEnabled) {
    try {
      return await rawKeys(pattern);
    } catch {
      return [];
    }
  }
  return rawKeys(pattern);
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
