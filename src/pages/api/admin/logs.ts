export const prerender = false;

import type { APIRoute } from "astro";
import { isAuthed } from "@/utils/adminAuth";
import { clearLogs, getLogs } from "@/utils/adminStore";

const unauthorized = () =>
  new Response(JSON.stringify({ ok: false, message: "未登录" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });

export const GET: APIRoute = async Astro => {
  if (!(await isAuthed(Astro.cookies))) return unauthorized();
  return new Response(JSON.stringify({ ok: true, logs: await getLogs() }), {
    headers: { "Content-Type": "application/json" },
  });
};

export const DELETE: APIRoute = async Astro => {
  if (!(await isAuthed(Astro.cookies))) return unauthorized();
  await clearLogs();
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
};
