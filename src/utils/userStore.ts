/**
 * Site users & comments storage (KV in production, JSON files in local dev).
 */
import crypto from "node:crypto";
import { jsonStore } from "@/utils/kvStore";

const USERS_FILE = "src/data/admin/users.json";
const COMMENTS_FILE = "src/data/admin/comments.json";
const LINKS_FILE = "src/data/admin/links.json";

const USERS = jsonStore<SiteUser[]>(USERS_FILE, "site:users");
const COMMENTS = jsonStore<SiteComment[]>(COMMENTS_FILE, "site:comments");
const LINKS = jsonStore<PortalLink[]>(LINKS_FILE, "site:links");

export interface SiteUser {
  id: string;
  name: string;
  email: string;
  salt: string;
  hash: string;
  createdAt: string;
  banned?: boolean;
}

export interface SiteComment {
  id: string;
  slug: string;
  userId: string;
  name: string;
  content: string;
  createdAt: string;
}

export interface PortalLink {
  name: string;
  url: string;
}

async function readJson<T>(store: { read: <U>(fallback: U) => Promise<U> }, fallback: T): Promise<T> {
  return store.read(fallback);
}

async function writeJson(store: { write: (data: unknown) => Promise<void> }, data: unknown): Promise<void> {
  await store.write(data);
}

export function newId(): string {
  return crypto.randomBytes(8).toString("hex");
}

/* ── Users ─────────────────────────────────────────────────────────────── */

export async function listUsers(): Promise<SiteUser[]> {
  return readJson(USERS, []);
}

export async function findUserByEmail(email: string): Promise<SiteUser | undefined> {
  const users = await listUsers();
  const needle = email.trim().toLowerCase();
  return users.find(u => u.email.toLowerCase() === needle);
}

export async function findUserById(id: string): Promise<SiteUser | undefined> {
  return (await listUsers()).find(u => u.id === id);
}

export async function addUser(
  name: string,
  email: string,
  password: string,
): Promise<SiteUser> {
  const users = await listUsers();
  const salt = crypto.randomBytes(8).toString("hex");
  const user: SiteUser = {
    id: newId(),
    name: name.trim(),
    email: email.trim().toLowerCase(),
    salt,
    hash: crypto.createHash("sha256").update(salt + password, "utf-8").digest("hex"),
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  await writeJson(USERS, users);
  return user;
}

export async function deleteUser(id: string): Promise<boolean> {
  const users = await listUsers();
  const next = users.filter(u => u.id !== id);
  if (next.length === users.length) return false;
  await writeJson(USERS, next);
  // also drop their comments? keep comments (community record) — just mark name
  return true;
}

export function verifyUserPassword(user: SiteUser, password: string): boolean {
  const hash = crypto.createHash("sha256").update(user.salt + password, "utf-8").digest("hex");
  const a = Buffer.from(hash);
  const b = Buffer.from(user.hash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ── Comments ──────────────────────────────────────────────────────────── */

export async function listComments(slug?: string): Promise<SiteComment[]> {
  const all = await readJson(COMMENTS, []);
  const items = slug ? all.filter(c => c.slug === slug) : all;
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function addComment(
  slug: string,
  userId: string,
  name: string,
  content: string,
): Promise<SiteComment> {
  const all = await readJson(COMMENTS, []);
  const comment: SiteComment = {
    id: newId(),
    slug,
    userId,
    name,
    content: content.trim().slice(0, 1000),
    createdAt: new Date().toISOString(),
  };
  all.push(comment);
  await writeJson(COMMENTS, all);
  return comment;
}

export async function deleteComment(id: string): Promise<boolean> {
  const all = await readJson(COMMENTS, []);
  const next = all.filter(c => c.id !== id);
  if (next.length === all.length) return false;
  await writeJson(COMMENTS, next);
  return true;
}

export async function recentComments(n = 8): Promise<SiteComment[]> {
  return (await listComments()).slice(0, n);
}

export async function commentCount(): Promise<number> {
  return (await listComments()).length;
}

/* ── Portal quick links (fingerprint menu) ─────────────────────────────── */

const DEFAULT_LINKS: PortalLink[] = [
  { name: "云盘", url: "https://cloud.qinanzhu.site" },
  { name: "相册", url: "https://image.qinanzhu.site" },
];

export async function getLinks(): Promise<PortalLink[]> {
  const links = await readJson(LINKS, []);
  return links.length ? links : DEFAULT_LINKS;
}

export async function saveLinks(links: PortalLink[]): Promise<void> {
  const clean = links
    .filter(l => l.name?.trim() && l.url?.trim())
    .slice(0, 12)
    .map(l => ({ name: l.name.trim(), url: l.url.trim() }));
  await writeJson(LINKS, clean);
}
