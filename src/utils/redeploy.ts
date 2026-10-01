/**
 * Trigger a Vercel rebuild through a Deploy Hook.
 *
 * The public site is static: a post saved through the admin lives in Redis
 * until `scripts/sync-kv-content.mjs` runs during the *next* build and turns
 * it into src/data/blog/*.md. No rebuild means the article never shows up on
 * the front-end, which is exactly the "I saved it but the site doesn't show
 * it" bug — so callers must surface the result instead of firing and forgetting.
 */
export type RedeployResult = { triggered: boolean; message: string };

export function deployHookConfigured(): boolean {
  return Boolean(hookUrl());
}

function hookUrl(): string {
  return (
    process.env.DEPLOY_HOOK_URL ||
    (import.meta.env.DEPLOY_HOOK_URL as string | undefined) ||
    ""
  );
}

export async function triggerRedeploy(): Promise<RedeployResult> {
  const hook = hookUrl();
  if (!hook) {
    return {
      triggered: false,
      message:
        "已保存到 Redis，但没配置 DEPLOY_HOOK_URL，前台要等下次部署才更新。",
    };
  }
  try {
    const res = await fetch(hook, { method: "POST" });
    return res.ok
      ? { triggered: true, message: "已触发重新部署，约 1 分钟后前台生效。" }
      : { triggered: false, message: `部署钩子返回 ${res.status}，前台暂不会更新。` };
  } catch (error) {
    return {
      triggered: false,
      message: `触发部署失败：${(error as Error).message}`,
    };
  }
}
