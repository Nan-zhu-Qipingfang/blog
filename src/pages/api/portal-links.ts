export const prerender = false;

import { getLinks } from "@/utils/userStore";

/** GET /api/portal-links — public, consumed by the fingerprint popup. */
export async function GET() {
  return Response.json({ ok: true, links: await getLinks() });
}
