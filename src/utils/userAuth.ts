/**
 * Site user sessions — HMAC-signed tokens in an HttpOnly cookie,
 * same scheme as adminAuth but carrying the user id.
 */
import crypto from "node:crypto";
import { getAdminSecret } from "./adminAuth";
import { findUserById, type SiteUser } from "./userStore";

export const USER_COOKIE = "user_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function sign(secret: string, userId: string, exp: number): string {
  const sig = crypto
    .createHmac("sha256", secret)
    .update(`${userId}.${exp}`)
    .digest("hex");
  return `${userId}.${exp}.${sig}`;
}

export async function createUserSessionToken(userId: string): Promise<string> {
  const exp = Date.now() + SESSION_TTL_MS;
  return sign(await getAdminSecret(), userId, exp);
}

export function userSessionCookieOptions() {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    maxAge: SESSION_TTL_MS / 1000,
  };
}

export async function verifyUserSession(
  token: string | undefined,
): Promise<string | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, expStr, sig] = parts;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Date.now() > exp) return null;
  const expected = sign(await getAdminSecret(), userId, exp);
  if (!timingSafeEqual(expected, token)) return null;
  return userId;
}

export async function getCurrentUser(cookies: {
  get: (name: string) => { value: string } | undefined;
}): Promise<Pick<SiteUser, "id" | "name" | "email"> | null> {
  const userId = await verifyUserSession(cookies.get(USER_COOKIE)?.value);
  if (!userId) return null;
  const user = await findUserById(userId);
  if (!user || user.banned) return null;
  return { id: user.id, name: user.name, email: user.email };
}
