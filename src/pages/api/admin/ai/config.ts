export const prerender = false;

import { isAuthed } from "@/utils/adminAuth";
import {
  getAiConfig,
  getUsageStats,
  PRESETS,
  saveAiConfig,
  type AiConfig,
} from "@/utils/aiSummary";

/** Key 是 secret，回传时只给"有没有配置过"和掩码，绝不回明文。 */
function mask(key: string) {
  if (!key) return "";
  if (key.length <= 8) return "••••••••";
  return `${key.slice(0, 4)}${"•".repeat(Math.min(12, key.length - 8))}${key.slice(-4)}`;
}

export async function GET({ cookies }: { cookies: any }) {
  if (!(await isAuthed(cookies))) {
    return Response.json({ ok: false, error: "未登录" }, { status: 401 });
  }
  const cfg = await getAiConfig();
  const usage = await getUsageStats();
  return Response.json({
    ok: true,
    config: {
      ...cfg,
      apiKey: mask(cfg.apiKey),
      hasKey: Boolean(cfg.apiKey),
    } satisfies AiConfig & { apiKey: string; hasKey: boolean },
    usage,
    presets: Object.fromEntries(
      Object.entries(PRESETS).map(([k, v]) => [k, { label: v.label, authMode: v.authMode }])
    ),
  });
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
  if (typeof body !== "object" || body === null) {
    return Response.json({ ok: false, error: "无效请求" }, { status: 400 });
  }

  const { apiKey, ...rest } = body as AiConfig & { apiKey?: string };
  const typed = typeof apiKey === "string" ? apiKey.trim() : "";
  const next = await saveAiConfig({
    ...(rest as Partial<AiConfig>),
    // 空字符串或掩码值 = 保留原样，避免前端回传把真 key 覆盖成 •••• 或清空
    apiKey:
      typed && !typed.includes("•")
        ? typed
        : (await getAiConfig()).apiKey,
  });
  return Response.json({
    ok: true,
    config: { ...next, apiKey: mask(next.apiKey), hasKey: Boolean(next.apiKey) },
  });
}
