export const prerender = false;

import type { APIRoute } from "astro";
import { isAuthed } from "@/utils/adminAuth";
import { getStats } from "@/utils/adminStore";

export const GET: APIRoute = async Astro => {
  if (!(await isAuthed(Astro.cookies))) {
    return new Response(JSON.stringify({ ok: false, message: "未登录" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify({ ok: true, stats: await getStats() }), {
    headers: { "Content-Type": "application/json" },
  });
};
