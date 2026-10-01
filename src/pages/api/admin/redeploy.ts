export const prerender = false;

import { isAuthed } from "@/utils/adminAuth";
import { deployHookStatus, triggerRedeploy } from "@/utils/redeploy";

/**
 * Manual trigger + the escape hatch used by the editor when a save lands but
 * the front-end doesn't move. Summary writes happen *after* the post save and
 * never carry the hook from that request, so a summary-only change needs its
 * own rebuild too.
 */
export async function POST({ cookies }: { cookies: any }) {
  if (!(await isAuthed(cookies))) {
    return Response.json({ ok: false, error: "未登录" }, { status: 401 });
  }
  const [result, status] = await Promise.all([triggerRedeploy(), deployHookStatus()]);
  return Response.json({
    ok: result.triggered,
    triggered: result.triggered,
    source: result.source ?? status.source,
    message: result.message || (status.configured ? "" : "未配置部署钩子"),
  });
}
