export const prerender = false;

import { isAuthed } from "@/utils/adminAuth";
import {
  deployHookStatus,
  saveDeployHook,
} from "@/utils/redeploy";

/**
 * The Deploy Hook used to be a Vercel env var only, which left the admin with
 * a dead end ("文章已保存但前台不更新") when the variable was never set. The
 * URL can now be pasted here and lives in KV, so it survives every deploy.
 */
export async function GET({ cookies }: { cookies: any }) {
  if (!(await isAuthed(cookies))) {
    return Response.json({ ok: false, error: "未登录" }, { status: 401 });
  }
  const status = await deployHookStatus();
  return Response.json({ ok: true, ...status });
}

export async function POST({ cookies, request }: { cookies: any; request: Request }) {
  if (!(await isAuthed(cookies))) {
    return Response.json({ ok: false, error: "未登录" }, { status: 401 });
  }
  let body: { url?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, error: "请求格式错误" }, { status: 400 });
  }
  const url = String(body.url ?? "").trim();
  if (url && !/^https?:\/\//i.test(url)) {
    return Response.json(
      { ok: false, error: "地址不合法，请以 http:// 或 https:// 开头" },
      { status: 400 }
    );
  }
  try {
    await saveDeployHook(url);
  } catch (error) {
    // 最常见的就是 KV 没启用（Vercel 只读 FS）：给可执行的中文提示，别抛 500
    return Response.json(
      { ok: false, error: (error as Error).message || "保存失败" },
      { status: 503 }
    );
  }
  const status = await deployHookStatus();
  return Response.json({
    ok: true,
    ...status,
    message: url
      ? "部署钩子已保存，之后保存文章会自动触发重建。"
      : "已清除后台保存的部署钩子（如有环境变量 DEPLOY_HOOK_URL 仍会生效）。",
  });
}
