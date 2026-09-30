/**
 * Admin backend auth helpers.
 *
 * Session = expiry timestamp + HMAC signature, stored in an HttpOnly cookie.
 *
 * 凭据来源（源码内**不保留任何明文密码**）：
 *   1. 后台「设置」页改过并持久化的 SHA-256 哈希（KV 优先，本地为 src/data/admin/auth.json）
 *   2. 环境变量 ADMIN_PASSWORD / ADMIN_USER（Vercel 后台配置；本地写 .env）
 *   3. 都没有 → 一律拒绝登录，避免仓库里的默认值把线上后台暴露出去
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { kvEnabled, kvGet, kvSet } from "@/utils/kvStore";

export const ADMIN_COOKIE = "admin_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const ADMIN_DIR = path.resolve("src/data/admin");
const SECRET_FILE = path.join(ADMIN_DIR, "secret.key");
const AUTH_FILE = path.join(ADMIN_DIR, "auth.json");

let cachedSecret: string | null = null;

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input, "utf-8").digest("hex");
}

function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Session signing secret: env ADMIN_SECRET, then KV/file key, then auto-generated. */
export async function getAdminSecret(): Promise<string> {
  if (cachedSecret) return cachedSecret;
  const envSecret = import.meta.env.ADMIN_SECRET as string | undefined;
  if (envSecret) {
    cachedSecret = envSecret;
    return envSecret;
  }
  if (kvEnabled) {
    const saved = await kvGet<string>("admin:secret", "");
    if (saved) {
      cachedSecret = saved;
      return saved;
    }
    const secret = crypto.randomBytes(32).toString("hex");
    await kvSet("admin:secret", secret);
    cachedSecret = secret;
    return secret;
  }
  try {
    const saved = (await fs.readFile(SECRET_FILE, "utf-8")).trim();
    if (saved) {
      cachedSecret = saved;
      return saved;
    }
  } catch {
    /* first run */
  }
  const secret = crypto.randomBytes(32).toString("hex");
  await fs.mkdir(ADMIN_DIR, { recursive: true });
  await fs.writeFile(SECRET_FILE, secret, "utf-8");
  cachedSecret = secret;
  return secret;
}

function sign(secret: string, exp: number): string {
  const sig = crypto.createHmac("sha256", secret).update(String(exp)).digest("hex");
  return `${exp}.${sig}`;
}

export async function createSessionToken(): Promise<string> {
  const exp = Date.now() + SESSION_TTL_MS;
  return sign(await getAdminSecret(), exp);
}

export function sessionCookieOptions() {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    maxAge: SESSION_TTL_MS / 1000,
  };
}

export async function verifySession(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const dotIndex = token.indexOf(".");
  if (dotIndex <= 0) return false;
  const expStr = token.slice(0, dotIndex);
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Date.now() > exp) return false;
  const expected = sign(await getAdminSecret(), exp);
  return timingSafeEqual(expected, token);
}

export async function isAuthed(cookies: {
  get: (name: string) => { value: string } | undefined;
}): Promise<boolean> {
  return verifySession(cookies.get(ADMIN_COOKIE)?.value);
}

type SavedAuth = { passwordHash?: string; updatedAt?: string };

async function readSavedAuth(): Promise<SavedAuth | null> {
  if (kvEnabled) return kvGet<SavedAuth>("admin:auth", null);
  try {
    return JSON.parse(await fs.readFile(AUTH_FILE, "utf-8")) as SavedAuth;
  } catch {
    return null;
  }
}

/**
 * 读取服务端私有环境变量。Astro 的 import.meta.env 与 process.env 都取一遍，
 * 保证本地 dev 与 Vercel Serverless 下都能拿到（非 PUBLIC_ 前缀，不会进客户端包）。
 */
function envValue(name: string): string {
  const fromAstro = (import.meta.env as Record<string, string | undefined>)[name];
  // 用 || 而不是 ??：Astro 在构建期会把未设置的 import.meta.env.X 内联成空串，
  // 若用 ?? 会把空串当成"已配置"而跳过运行时的 process.env，导致线上明明配了却登不上
  const raw = fromAstro || process.env[name] || "";
  return String(raw).trim();
}

/**
 * Verify credentials.
 * 已保存的哈希 > 环境变量 ADMIN_PASSWORD > 拒绝。
 */
export async function verifyCredentials(
  username: string,
  password: string,
): Promise<boolean> {
  if (!username || !password) return false;
  const expectedUser = envValue("ADMIN_USER") || "admin";
  if (username !== expectedUser) return false;

  // 1) 后台改过的密码（SHA-256）
  const saved = await readSavedAuth();
  if (saved?.passwordHash) {
    return timingSafeEqual(saved.passwordHash, sha256(password));
  }

  // 2) 环境变量配置的密码
  const envPassword = envValue("ADMIN_PASSWORD");
  if (envPassword) {
    return timingSafeEqual(envPassword, password);
  }

  // 3) 什么都没配 → 不允许登录
  return false;
}

export async function savePasswordHash(newPassword: string): Promise<void> {
  const payload = {
    passwordHash: sha256(newPassword),
    updatedAt: new Date().toISOString(),
  };
  if (kvEnabled) {
    await kvSet("admin:auth", payload);
    return;
  }
  await fs.mkdir(ADMIN_DIR, { recursive: true });
  await fs.writeFile(AUTH_FILE, JSON.stringify(payload, null, 2), "utf-8");
}

/**
 * 当前生效的密码来源，用于后台「设置」页展示状态：
 * - "hash"：后台改过并持久化的密码
 * - "env" ：环境变量 ADMIN_PASSWORD
 * - "none"：完全没配（此时任何密码都无法登录）
 */
export async function passwordSource(): Promise<"hash" | "env" | "none"> {
  const saved = await readSavedAuth();
  if (saved?.passwordHash) return "hash";
  if (envValue("ADMIN_PASSWORD")) return "env";
  return "none";
}

export async function hasCustomPassword(): Promise<boolean> {
  const saved = await readSavedAuth();
  return Boolean(saved?.passwordHash);
}
