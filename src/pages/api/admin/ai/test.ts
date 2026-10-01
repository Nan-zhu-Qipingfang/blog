export const prerender = false;

import { isAuthed } from "@/utils/adminAuth";
import { getAiConfig, probeApi, type AiConfig } from "@/utils/aiSummary";

/**
 * 可达性探测：用当前（或这次临时填的）配置发一次 4 字请求，
 * 返回延迟、取到的内容、以及真实/估算的 token 数。
 */
export async function POST({ request, cookies }: { request: Request; cookies: any }) {
  if (!(await isAuthed(cookies))) {
    return Response.json({ ok: false, error: "未登录" }, { status: 401 });
  }
  let body: Partial<AiConfig> = {};
  try {
    body = (await request.json()) ?? {};
  } catch {
    /* 没带 body 就用已保存的配置 */
  }

  const cfg = await getAiConfig();
  let target = cfg;
  if (body.apiUrl || body.apiKey || body.model || body.preset || body.authMode) {
    target = { ...cfg, ...body };
  }

  if (!target.enabled) {
    return Response.json({ ok: false, error: "尚未启用 AI 摘要，请先把开关打开" }, { status: 400 });
  }
  if (!target.apiUrl) {
    return Response.json({ ok: false, error: "请先填写请求地址 URL" }, { status: 400 });
  }
  if (!target.apiKey) {
    return Response.json({ ok: false, error: "请先填写 API Key" }, { status: 400 });
  }

  try {
    const result = await probeApi(target);
    return Response.json({
      ok: true,
      latencyMs: result.latencyMs,
      summary: result.summary,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      estimated: result.estimated,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "未知错误";
    return Response.json({ ok: false, error: message.slice(0, 500) }, { status: 200 });
  }
}
