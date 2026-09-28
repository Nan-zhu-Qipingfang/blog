export const prerender = false;

import { recentComments } from "@/utils/userStore";

/** GET /api/comments/recent — latest comments for the console panel. */
export async function GET() {
  const comments = await recentComments(8);
  return Response.json({ ok: true, comments });
}
