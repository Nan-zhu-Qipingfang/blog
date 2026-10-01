export const prerender = false;

import { isAuthed } from "@/utils/adminAuth";
import { deployHookConfigured, triggerRedeploy } from "@/utils/redeploy";

/**
 * 摘要是在文章保存**之后**才写回 frontmatter 的，不会带上保存那次的部署钩子，
 * 所以补摘要改成后需要再手动触发一次重建，否则前台永远看不到新摘要。
 */
export async function POST({ cookies }: { cookies: any }) {
  if (!(await isAuthed(cookies))) {
    return Response.json({ ok: false, error: "未登录" }, { status: 401 });
  }
  const result = await triggerRedeploy();
  return Response.json({
    ok: result.triggered,
    triggered: result.triggered,
    message: result.message || (deployHookConfigured() ? "" : "未配置 DEPLOY_HOOK_URL"),
  });
}
