export const prerender = false;

import type { APIRoute } from "astro";
import { ADMIN_COOKIE } from "@/utils/adminAuth";

export const POST: APIRoute = async Astro => {
  Astro.cookies.delete(ADMIN_COOKIE, { path: "/" });
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
};
