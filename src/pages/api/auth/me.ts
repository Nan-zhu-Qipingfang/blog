export const prerender = false;

import { getCurrentUser } from "@/utils/userAuth";

export async function GET({ cookies }: { cookies: any }) {
  const user = await getCurrentUser(cookies);
  return Response.json({ ok: true, user });
}
