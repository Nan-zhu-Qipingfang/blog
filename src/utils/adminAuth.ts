/**
 * Admin backend auth helpers.
 *
 * Session = expiry timestamp + HMAC signature, stored in an HttpOnly cookie.
 * Password: default admin / admin12346 (local demo), can be replaced by a
 * SHA-256 hash persisted via the KV store (falls back to src/data/admin/auth.json
 * in local dev).
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

/** Verify credentials. Saved hash wins; falls back to the local demo default. */
export async function verifyCredentials(
  username: string,
  password: string,
): Promise<boolean> {
  if (username !== "admin") return false;
  const saved = await readSavedAuth();
  if (saved?.passwordHash) {
    return timingSafeEqual(saved.passwordHash, sha256(password));
  }
  return timingSafeEqual("admin12346", password);
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

export async function hasCustomPassword(): Promise<boolean> {
  const saved = await readSavedAuth();
  return Boolean(saved?.passwordHash);
}
