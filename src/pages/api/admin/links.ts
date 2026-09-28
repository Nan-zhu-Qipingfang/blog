export const prerender = false;

import { isAuthed } from "@/utils/adminAuth";
import { getLinks, saveLinks } from "@/utils/userStore";

export async function GET({ cookies }: { cookies: any }) {
  if (!(await isAuthed(cookies))) {
    return Response.json({ ok: false, error: "未登录" }, { status: 401 });
  }
  return Response.json({ ok: true, links: await getLinks() });
}

export async function POST({ request, cookies }: { request: Request; cookies: any }) {
  if (!(await isAuthed(cookies))) {
    return Response.json({ ok: false, error: "未登录" }, { status: 401 });
  }
  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "无效请求" }, { status: 400 });
  }
  if (!Array.isArray(body.links)) {
    return Response.json({ ok: false, error: "links 必须是数组" }, { status: 400 });
  }
  await saveLinks(body.links);
  return Response.json({ ok: true, links: await getLinks() });
}
