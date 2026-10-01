/**
 * AI 摘要：真实调用远端大模型接口生成博客摘要。
 *
 * 设计要点
 * - 接口形态完全可配置（预设 + 手写模板），因为第三方中转站的
 *   OpenAI 兼容 / GenAI 原生两种格式都可能被用到，写死任何一种都会挂。
 * - 摘要在**保存文章时**生成并写回 frontmatter 的 `summary` 字段，
 *   静态构建根本不碰 AI，省 token 也避免每次部署重复烧钱。
 * - token 统计：接口返回 usage 就用真实值，没有就用中英混排启发式估算，
 *   两者分开标记，设置页分别展示。
 */
import { jsonStore } from "@/utils/kvStore";

export type AiPreset = "openai" | "gemini" | "custom";
export type AiAuthMode = "bearer" | "x-goog-api-key" | "query-key" | "none";

export type AiConfig = {
  enabled: boolean;
  preset: AiPreset;
  apiKey: string;
  apiUrl: string;
  model: string;
  authMode: AiAuthMode;
  requestTemplate: string;
  responsePath: string;
  usagePromptPath: string;
  usageCompletionPath: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  temperature: number;
  systemPrompt: string;
};

export type AiUsageEntry = {
  ts: string;
  slug: string;
  source: "online" | "manual";
  model: string;
  promptTokens: number;
  completionTokens: number;
  estimated: boolean;
  latencyMs: number;
  ok: boolean;
  note?: string;
};

export type AiUsageStats = {
  calls: number;
  onlineCalls: number;
  manualCalls: number;
  promptTokens: number;
  completionTokens: number;
  estimated: boolean;
  last: AiUsageEntry | null;
};

const STORE = jsonStore("src/data/admin/aiSummary.json", "site:ai-summary");
const USAGE = jsonStore<AiUsageStats>(
  "src/data/admin/aiUsage.json",
  "admin:ai:usage"
);

export const DEFAULT_SYSTEM_PROMPT =
  "你是一个中文博客编辑。请为下面这篇文章写一句 60–100 字的梗概：" +
  "抓住核心结论或关键信息，语气口语化，可以带 1–2 个 emoji；" +
  "不要写「本文介绍了」「这篇文章讲述了」这类套话，不要分段，不要加标题，只输出结果。";

export const DEFAULT_MAX_INPUT_TOKENS = 6000;
export const DEFAULT_MAX_OUTPUT_TOKENS = 220;

/** 模板占位符：content 是「标题 + 分隔 + 正文」组装好的最终输入 */
export const TEMPLATE_VARS = ["model", "content", "title"] as const;

export const PRESETS: Record<
  Exclude<AiPreset, "custom">,
  {
    label: string;
    authMode: AiAuthMode;
    requestTemplate: string;
    responsePath: string;
    usagePromptPath: string;
    usageCompletionPath: string;
  }
> = {
  openai: {
    label: "OpenAI 兼容（/v1/chat/completions）",
    authMode: "bearer",
    requestTemplate: `{
  "model": "{{model}}",
  "messages": [
    { "role": "system", "content": "你是一个中文博客编辑，只输出摘要正文，不要解释。" },
    { "role": "user", "content": "{{content}}" }
  ],
  "temperature": 0.6,
  "max_tokens": 220
}`,
    responsePath: "choices[0].message.content",
    usagePromptPath: "usage.prompt_tokens",
    usageCompletionPath: "usage.completion_tokens",
  },
  gemini: {
    label: "Gemini 原生（:generateContent）",
    authMode: "x-goog-api-key",
    requestTemplate: `{
  "contents": [
    { "role": "user", "parts": [{ "text": "{{content}}" }] }
  ],
  "systemInstruction": { "parts": [{ "text": "你是一个中文博客编辑，只输出摘要正文，不要解释。" }] },
  "generationConfig": { "temperature": 0.6, "maxOutputTokens": 220 }
}`,
    responsePath: "candidates[0].content.parts[0].text",
    usagePromptPath: "usage_metadata.promptTokenCount",
    usageCompletionPath: "usage_metadata.completionTokenCount",
  },
};

export const DEFAULT_CONFIG: AiConfig = {
  enabled: false,
  preset: "openai",
  apiKey: "",
  apiUrl: "",
  model: "gemini-3.1-pro",
  authMode: "bearer",
  requestTemplate: PRESETS.openai.requestTemplate,
  responsePath: PRESETS.openai.responsePath,
  usagePromptPath: PRESETS.openai.usagePromptPath,
  usageCompletionPath: PRESETS.openai.usageCompletionPath,
  maxInputTokens: DEFAULT_MAX_INPUT_TOKENS,
  maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
  temperature: 0.6,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
};

const num = (value: unknown, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** 补齐缺字段，旧配置 / 半填配置都能直接用。 */
export function normalizeConfig(input: Partial<AiConfig> | null | undefined): AiConfig {
  const preset = (input?.preset ?? "openai") as AiPreset;
  const known = preset === "gemini" || preset === "openai";
  const base = known ? PRESETS[preset] : null;
  return {
    enabled: Boolean(input?.enabled),
    preset,
    apiKey: String(input?.apiKey ?? ""),
    apiUrl: String(input?.apiUrl ?? "").trim(),
    model: String(input?.model ?? "").trim() || "gemini-3.1-pro",
    authMode: (input?.authMode ?? base?.authMode ?? "bearer") as AiAuthMode,
    // custom 或模板为空时回落到该预设的模板，避免用户清空后发出坏请求
    requestTemplate:
      String(input?.requestTemplate ?? "").trim() || base?.requestTemplate || DEFAULT_CONFIG.requestTemplate,
    responsePath:
      String(input?.responsePath ?? "").trim() || base?.responsePath || DEFAULT_CONFIG.responsePath,
    usagePromptPath:
      String(input?.usagePromptPath ?? "").trim() ||
      base?.usagePromptPath ||
      DEFAULT_CONFIG.usagePromptPath,
    usageCompletionPath:
      String(input?.usageCompletionPath ?? "").trim() ||
      base?.usageCompletionPath ||
      DEFAULT_CONFIG.usageCompletionPath,
    maxInputTokens: Math.round(num(input?.maxInputTokens, DEFAULT_MAX_INPUT_TOKENS)),
    maxOutputTokens: Math.round(num(input?.maxOutputTokens, DEFAULT_MAX_OUTPUT_TOKENS)),
    temperature: num(input?.temperature, DEFAULT_CONFIG.temperature),
    systemPrompt: String(input?.systemPrompt ?? "").trim() || DEFAULT_SYSTEM_PROMPT,
  };
}

export async function getAiConfig(): Promise<AiConfig> {
  try {
    return normalizeConfig(await STORE.read<Partial<AiConfig> | null>(null));
  } catch {
    return normalizeConfig(null);
  }
}

export async function saveAiConfig(input: Partial<AiConfig>): Promise<AiConfig> {
  const next = normalizeConfig(input);
  await STORE.write(next);
  return next;
}

/* ───────────────────────── token 估算 ───────────────────────── */

const isWide = (cp: number) =>
  (cp >= 0x3040 && cp <= 0x30ff) || // 日文假名
  (cp >= 0x3400 && cp <= 0x4dbf) || // CJK 扩展
  (cp >= 0x4e00 && cp <= 0x9fff) || // 常用汉字
  (cp >= 0xf900 && cp <= 0xfaff) || // 兼容表意文字
  (cp >= 0xff00 && cp <= 0xff60) || // 全角标点
  (cp >= 0xac00 && cp <= 0xd7af); // 韩文音节

/** 中英混排启发式：CJK 1 字≈1 token，其余 4 字符≈1 token。偏保守（高估）。 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let tokens = 0;
  for (const ch of text) {
    tokens += isWide(ch.codePointAt(0) ?? 0) ? 1 : 0.25;
  }
  return Math.ceil(tokens);
}

/** 按 token 预算截断，返回被截掉与否，便于在正文末尾标注。 */
export function truncateByBudget(
  text: string,
  budgetTokens: number
): { text: string; truncated: boolean; tokens: number } {
  const chars = Array.from(text);
  let acc = 0;
  let cut = 0;
  for (let i = 0; i < chars.length; i++) {
    const w = isWide(chars[i].codePointAt(0) ?? 0) ? 1 : 0.25;
    if (acc + w > budgetTokens) break;
    acc += w;
    cut = i + 1;
  }
  const truncated = cut < chars.length;
  return { text: chars.slice(0, cut).join(""), truncated, tokens: Math.ceil(acc) };
}

/* ───────────────────────── 模板 / 路径解析 ───────────────────────── */

function renderTemplate(template: string, vars: Record<string, string>): string {
  // `^` 分支让模板开头的占位符也能命中（此时前面没有引号，按裸值处理）
  return template.replace(
    /(^|[^\w{])\{\{\s*(\w+)\s*\}\}/g,
    (full, before: string, key: string) => {
      if (!(key in vars)) return full;
      const value = JSON.stringify(vars[key]);
      // 占位符写在 JSON 字符串内部时（`"model": "{{model}}"`），外层引号由模板
      // 提供，这里只填转义后的内容；否则会得到 `""值""`，JSON.parse 直接失败。
      return before + (before === '"' ? value.slice(1, -1) : value);
    }
  );
}

/** 支持 `a.b[0].c` 与 `a.b[c]` 两种写法。 */
export function resolvePath(root: unknown, path: string): unknown {
  let cur: any = root;
  for (const raw of String(path).split(".")) {
    if (cur == null) return undefined;
    const m = raw.match(/^([^[\]]+)((\[[^[\]]*\])+)$/);
    const key = m ? m[1] : raw;
    cur = cur?.[key];
    if (!m) continue;
    for (const idx of m[2].match(/\[([^[\]]*)\]/g) ?? []) {
      const n = Number(idx.slice(1, -1));
      cur = Array.isArray(cur) ? cur[n] : undefined;
    }
  }
  return cur;
}

export function authHeaders(cfg: AiConfig): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (!cfg.apiKey) return headers;
  if (cfg.authMode === "bearer") headers.Authorization = `Bearer ${cfg.apiKey}`;
  else if (cfg.authMode === "x-goog-api-key") headers["x-goog-api-key"] = cfg.apiKey;
  return headers;
}

/** apiUrl 里支持 `{{model}}` 占位（Gemini 原生把模型写在路径里）。 */
function buildUrl(cfg: AiConfig): string {
  const url = cfg.apiUrl.replace(/\{\{\s*model\s*\}\}/g, encodeURIComponent(cfg.model));
  if (!cfg.apiKey) return url;
  if (cfg.authMode === "query-key") {
    const [base, search = ""] = url.split("?");
    const params = new URLSearchParams(search);
    params.set("key", cfg.apiKey);
    return `${base}?${params.toString()}`;
  }
  return url;
}

function buildBody(cfg: AiConfig, userPrompt: string, title: string): string | null {
  const rendered = renderTemplate(cfg.requestTemplate, {
    model: cfg.model,
    content: userPrompt,
    title,
  });
  try {
    JSON.parse(rendered);
    return rendered;
  } catch {
    return null; // 模板不是合法 JSON，交给调用方报错
  }
}

/** 模型偶尔会包一层引号或 markdown 围栏，这里统一剥掉。 */
export function cleanSummary(raw: string): string {
  let text = String(raw ?? "").trim();
  text = text.replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```$/, "").trim();
  text = text.replace(/^["'“]/, "").replace(/["'”]$/, "").trim();
  return text.replace(/\s+/g, " ").trim();
}

export type AiResult = {
  summary: string;
  promptTokens: number;
  completionTokens: number;
  estimated: boolean;
  latencyMs: number;
};

async function callApi(
  cfg: AiConfig,
  userPrompt: string,
  title: string,
  signal?: AbortSignal
): Promise<AiResult> {
  const started = Date.now();
  const body = buildBody(cfg, userPrompt, title);
  if (!body) {
    throw new Error("请求体模板不是合法 JSON，请检查「请求体模板」或换回预设模板");
  }
  const response = await fetch(buildUrl(cfg), {
    method: "POST",
    headers: authHeaders(cfg),
    body,
    signal: signal ?? AbortSignal.timeout(60000),
  });
  const raw = await response.text();
  let parsed: any = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    /* 裸文本响应 */
  }
  if (!response.ok) {
    const detail = parsed?.error?.message ?? parsed?.message ?? raw.slice(0, 300);
    throw new Error(
      `接口返回 ${response.status}${detail ? `：${detail}` : ""}`
    );
  }

  const text = resolvePath(parsed, cfg.responsePath);
  const summary = cleanSummary(
    typeof text === "string"
      ? text
      : Array.isArray(text)
        ? text.map((t: any) => (typeof t === "string" ? t : t?.text ?? "")).join("")
        : ""
  );
  if (!summary) {
    throw new Error(
      `没能从响应里取出摘要（按路径 ${cfg.responsePath} 取值为空）。` +
        "响应预览：" +
        raw.slice(0, 200)
    );
  }

  const up = resolvePath(parsed, cfg.usagePromptPath);
  const uc = resolvePath(parsed, cfg.usageCompletionPath);
  const pTokens = Number(up);
  const cTokens = Number(uc);
  const hasUsage = Number.isFinite(pTokens) && Number.isFinite(cTokens);

  return {
    summary: summary.slice(0, 400),
    promptTokens: hasUsage ? pTokens : estimateTokens(userPrompt),
    completionTokens: hasUsage ? cTokens : estimateTokens(summary),
    estimated: !hasUsage,
    latencyMs: Date.now() - started,
  };
}

/* ───────────────────────── 对外接口 ───────────────────────── */

/** 组装最终喂给模型的内容，并按预算截断。 */
export function buildUserPrompt(cfg: AiConfig, title: string, content: string) {
  const full = `标题：${title}\n\n正文：\n${content}`;
  const truncated = truncateByBudget(full, cfg.maxInputTokens);
  return {
    prompt: truncated.text,
    truncated: truncated.truncated,
    promptTokens: estimateTokens(truncated.text),
  };
}

export async function generateSummary(cfg: AiConfig, title: string, content: string) {
  const { prompt, truncated, promptTokens } = buildUserPrompt(cfg, title, content);
  const result = await callApi(cfg, prompt, title);
  return { ...result, promptTokens: result.estimated ? promptTokens : result.promptTokens, truncated };
}

/** 可达性探测：用同一套配置发一次最小请求，返回延迟与响应片段。 */
export async function probeApi(cfg: AiConfig) {
  const result = await callApi(
    cfg,
    "请只回复两个字：可用",
    "连接测试"
  );
  return { ...result, summary: cleanSummary(result.summary).slice(0, 120) };
}

/* ───────────────────────── 用量统计 ───────────────────────── */

export async function getUsageStats(): Promise<AiUsageStats> {
  try {
    return (await USAGE.read<AiUsageStats>({
      calls: 0,
      onlineCalls: 0,
      manualCalls: 0,
      promptTokens: 0,
      completionTokens: 0,
      estimated: false,
      last: null,
    })) ?? {
      calls: 0,
      onlineCalls: 0,
      manualCalls: 0,
      promptTokens: 0,
      completionTokens: 0,
      estimated: false,
      last: null,
    };
  } catch {
    return {
      calls: 0,
      onlineCalls: 0,
      manualCalls: 0,
      promptTokens: 0,
      completionTokens: 0,
      estimated: false,
      last: null,
    };
  }
}

/** 累加一次调用；线下摘要不产生 token，但仍计入次数。 */
export async function recordUsage(entry: AiUsageEntry): Promise<AiUsageStats> {
  const stats = await getUsageStats();
  const next: AiUsageStats = {
    calls: stats.calls + 1,
    onlineCalls: stats.onlineCalls + (entry.source === "online" ? 1 : 0),
    manualCalls: stats.manualCalls + (entry.source === "manual" ? 1 : 0),
    promptTokens: stats.promptTokens + Math.max(0, entry.promptTokens || 0),
    completionTokens: stats.completionTokens + Math.max(0, entry.completionTokens || 0),
    estimated: entry.source === "online" ? entry.estimated : false,
    last: entry,
  };
  await USAGE.write(next);
  return next;
}
