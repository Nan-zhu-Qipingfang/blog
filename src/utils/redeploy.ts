/**
 * Trigger a Vercel rebuild through a Deploy Hook.
 *
 * The public site is static: a post saved through the admin lives in Redis
 * until `scripts/sync-kv-content.mjs` runs during the *next* build and turns
 * it into src/data/blog/*.md. No rebuild means the article never shows up on
 * the front-end, which is exactly the "I saved it but the site doesn't show
 * it" bug — so callers must surface the result instead of firing and forgetting.
 *
 * The hook URL is resolved in this order:
 *   1. the value saved in the admin ("设置 → 部署钩子"), stored in KV so it
 *      survives deploys;
 *   2. the `DEPLOY_HOOK_URL` environment variable (still honoured for people
 *      who prefer to set it once in the dashboard).
 */
import { jsonStore } from "./kvStore";

export type RedeployResult = {
  triggered: boolean;
  message: string;
  /** Where the hook URL came from — shown in the admin so the state is obvious. */
  source?: "saved" | "env";
};

/** KV-backed so the value survives redeploys; local JSON in dev. */
const hookStore = jsonStore<string | null>(
  "src/data/admin/deployHook.json",
  "site:deploy-hook"
);

/** Read-only env lookup, kept separate so diagnostics can distinguish them. */
function envHookUrl(): string {
  return (
    process.env.DEPLOY_HOOK_URL ||
    (import.meta.env.DEPLOY_HOOK_URL as string | undefined) ||
    ""
  ).trim();
}

/** Resolve the hook currently in use: admin-saved value wins over the env var. */
export async function getDeployHook(): Promise<string> {
  const saved = await hookStore.read(null);
  const savedUrl = typeof saved === "string" ? saved.trim() : "";
  return savedUrl || envHookUrl();
}

/** Persist (or clear with `""`) the admin-supplied hook. */
export async function saveDeployHook(raw: string): Promise<void> {
  const url = String(raw ?? "").trim();
  await hookStore.write(url || null);
}

export async function deployHookConfigured(): Promise<boolean> {
  return Boolean(await getDeployHook());
}

/** `{ source, url }` for the settings page; the URL is never printed in full. */
export async function deployHookStatus(): Promise<{
  configured: boolean;
  source: "saved" | "env" | "none";
}> {
  const saved = await hookStore.read(null);
  const savedUrl = typeof saved === "string" ? saved.trim() : "";
  if (savedUrl) return { configured: true, source: "saved" };
  if (envHookUrl()) return { configured: true, source: "env" };
  return { configured: false, source: "none" };
}

const NOT_CONFIGURED_MESSAGE =
  "文章已保存到 Redis（前台不会自动更新）。去「设置 → 部署钩子」粘贴 Vercel 的 Deploy Hook 地址并保存，以后每次保存/生成摘要都会自动重建；临时救急可直接在设置页点「立即重新部署」按钮。";

export async function triggerRedeploy(): Promise<RedeployResult> {
  const hook = await getDeployHook();
  if (!hook) {
    return { triggered: false, message: NOT_CONFIGURED_MESSAGE, source: "none" };
  }
  const source: RedeployResult["source"] = (await hookStore.read(null))
    ? "saved"
    : "env";
  try {
    const res = await fetch(hook, { method: "POST" });
    return {
      triggered: res.ok,
      source,
      message: res.ok
        ? "已触发自动重新部署，约 1 分钟后前台生效。"
        : `部署钩子返回 ${res.status}，前台暂不会更新。请在 Vercel 确认该钩子仍有效（项目 Settings → Git → Deploy Hooks）。`,
    };
  } catch (error) {
    return {
      triggered: false,
      source,
      message: `触发部署失败：${(error as Error).message}`,
    };
  }
}
