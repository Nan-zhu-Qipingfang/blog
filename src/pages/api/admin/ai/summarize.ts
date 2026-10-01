export const prerender = false;

import { isAuthed } from "@/utils/adminAuth";
import { appendLog, setPostSummary } from "@/utils/adminStore";
import {
  generateSummary,
  getAiConfig,
  recordUsage,
  saveAiConfig,
  type AiConfig,
} from "@/utils/aiSummary";

type Body = {
  slug?: string;
  title?: string;
  content?: string;
  source?: "online" | "manual";
  summary?: string;
  apiUrl?: string;
  apiKey?: string;
  model?: string;
  preset?: AiConfig["preset"];
  authMode?: AiConfig["authMode"];
  requestTemplate?: string;
  responsePath?: string;
  usagePromptPath?: string;
  usageCompletionPath?: string;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  enabled?: boolean;
};

export async function POST({ request, cookies }: { request: Request; cookies: any }) {
  if (!(await isAuthed(cookies))) {
    return Response.json({ ok: false, error: "未登录" }, { status: 401 });
  }
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ ok: false, error: "无效请求" }, { status: 400 });
  }

  const slug = String(body.slug ?? "").trim();
  const source = body.source === "manual" ? "manual" : "online";
  if (!slug) return Response.json({ ok: false, error: "缺少 slug" }, { status: 400 });

  const stored = await getAiConfig();
  let cfg = stored;
  // 编辑器里"顺手配一次就能用"：这次传了就临时生效并落盘
  if (body.apiUrl || body.apiKey || body.model) {
    cfg = await saveAiConfig({
      ...(stored as Partial<AiConfig>),
      enabled: true,
      apiUrl: body.apiUrl ?? stored.apiUrl,
      apiKey: body.apiKey ?? stored.apiKey,
      model: body.model ?? stored.model,
      preset: body.preset ?? stored.preset,
      authMode: body.authMode ?? stored.authMode,
      requestTemplate: body.requestTemplate ?? stored.requestTemplate,
      responsePath: body.responsePath ?? stored.responsePath,
      usagePromptPath: body.usagePromptPath ?? stored.usagePromptPath,
      usageCompletionPath: body.usageCompletionPath ?? stored.usageCompletionPath,
      maxInputTokens: body.maxInputTokens ?? stored.maxInputTokens,
      maxOutputTokens: body.maxOutputTokens ?? stored.maxOutputTokens,
      temperature: body.temperature ?? stored.temperature,
      systemPrompt: body.systemPrompt ?? stored.systemPrompt,
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
    });
  }

  const title = String(body.title ?? "").trim() || slug;
  const content = String(body.content ?? "");
  if (!content && source === "online") {
    return Response.json({ ok: false, error: "正文为空，无法生成摘要" }, { status: 400 });
  }

  let summary = "";
  let promptTokens = 0;
  let completionTokens = 0;
  let estimated = false;
  let latencyMs = 0;
  let truncated = false;
  let note = "";

  try {
    if (source === "manual") {
      summary = String(body.summary ?? "").trim().slice(0, 400);
      note = "线下手写摘要";
    } else {
      if (!cfg.enabled) {
        return Response.json({ ok: false, error: "AI 摘要尚未启用，请先在设置页配置" }, { status: 400 });
      }
      if (!cfg.apiUrl || !cfg.apiKey) {
        return Response.json(
          { ok: false, error: "缺少请求地址或 API Key，请先在设置页填写并测试连接" },
          { status: 400 }
        );
      }
      const result = await generateSummary(cfg, title, content);
      summary = result.summary;
      promptTokens = result.promptTokens;
      completionTokens = result.completionTokens;
      estimated = result.estimated;
      latencyMs = result.latencyMs;
      truncated = result.truncated;
    }

    await setPostSummary(slug, summary);
    const stats = await recordUsage({
      ts: new Date().toISOString(),
      slug,
      source,
      model: cfg.model,
      promptTokens,
      completionTokens,
      estimated,
      latencyMs,
      ok: true,
      note: truncated ? "正文按 token 预算截断" : note,
    });
    await appendLog("AI 摘要", `${source === "online" ? "线上生成" : "线下手写"}：${slug}`);

    return Response.json({
      ok: true,
      summary,
      promptTokens,
      completionTokens,
      estimated,
      latencyMs,
      truncated,
      usage: stats,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : typeof error === "string" ? error : "生成失败";
    await recordUsage({
      ts: new Date().toISOString(),
      slug,
      source,
      model: cfg.model,
      promptTokens: 0,
      completionTokens: 0,
      estimated: true,
      latencyMs,
      ok: false,
      note: message.slice(0, 200),
    });
    return Response.json({ ok: false, error: message.slice(0, 500) }, { status: 200 });
  }
}
