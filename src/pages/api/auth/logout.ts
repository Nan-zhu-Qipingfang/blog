export const prerender = false;

import { USER_COOKIE } from "@/utils/userAuth";

export async function POST({ cookies }: { cookies: any }) {
  cookies.delete(USER_COOKIE, { path: "/" });
  return Response.json({ ok: true });
}
