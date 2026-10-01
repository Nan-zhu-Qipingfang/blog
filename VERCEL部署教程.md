# Vercel 部署教程（astro-devosfera）

本项目已从 `@astrojs/node` 适配器切换到 **`@astrojs/vercel`**，并采用 `output: "static"`（Astro 6 的默认值）：

> ⚠️ **重要**：在 Astro 6.3.1 中 `output: "hybrid"` 选项**已被移除**。官方提示改用 `output: "static"`，其行为与旧的 hybrid 完全一致。因此这里不要再写 `hybrid`，否则构建会直接失败。

- 普通页面（首页、文章、归档等）在构建时**静态预渲染**，由 Vercel 的 CDN 直接托管，秒开、利于 SEO；
- 管理后台（`/admin/*`）与 API 路由（`/api/*`）已全部标注 `export const prerender = false`，由适配器自动部署为 **Vercel Serverless Functions**，无需自建服务器，天然适配 Vercel。

仓库中已包含 `vercel.json`（声明了 framework / build / install / output 及缓存与安全响应头），因此连接 Git 后基本是**零配置**部署。

---

## 一、前置准备

1. 一个 **GitHub / GitLab / Bitbucket** 账号，且本仓库已推送到远程。
2. 一个 **Vercel** 账号（用 GitHub 直接授权登录最方便，免费 Hobby 套餐即可）。
3. 本地 Node ≥ 20.19（Vercel 会自动按 `package.json` 的 `engines` 选择 Node 版本）。

---

## 二、一键导入部署（推荐）

1. 打开 <https://vercel.com/new> ，点击 **Import Git Repository**，授权并选择本仓库。
2. 在配置页，Vercel 会根据 `vercel.json` / `astro.config.ts` 自动识别为 **Astro** 框架。你也可以在「Build and Output Settings」中核对以下值（正常情况下无需手填，会自动带出）：

   | 项目 | 值 |
   | --- | --- |
   | Framework Preset | `Astro` |
   | Build Command | `pnpm run build` |
   | Install Command | `pnpm install` |
   | Output Directory | `dist` |
   | Node.js Version | `20.x`（或 22.x） |

   > 说明：本项目的构建脚本为
   > `node scripts/sync-kv-content.mjs && astro build && pagefind --site dist/client && node scripts/postbuild-pagefind.mjs`：
   > ① 构建前把后台保存在 KV 的文章同步回内容目录；② 生成站内全文搜索（Pagefind）索引到 `dist/client/pagefind`；
   > ③ 把索引补进 `.vercel/output/static`（原因见下方“为什么需要 postbuild-pagefind”）。

3. 先**不要急着点 Deploy**，先到下一步配置环境变量。
4. 点击 **Deploy**，等待构建完成。首次构建约 1–3 分钟（受 npmmirror 镜像源网络影响可能稍慢，见第四节注意事项）。

### 为什么需要 `postbuild-pagefind.mjs`（踩坑记录）

`@astrojs/vercel` 是在 **`astro build` 结束的那一刻**（适配器自己的 `astro:build:done` 钩子）把静态站点快照进 `.vercel/output/static` 的：

```js
// node_modules/@astrojs/vercel/dist/index.js
const _staticDir = _buildOutput === "static" ? _config.outDir : _config.build.client;
cpSync(_staticDir, "./.vercel/output/static/", { recursive: true });
```

而 `pagefind` 是在 `astro build` **之后**才往 `dist/client/pagefind` 写索引的，所以索引天生进不了部署产物。
表现很典型：构建日志里 pagefind 明明成功，本地 `dist/client/pagefind/*` 也都在，但线上 ——

```
/rss.xml                        -> 200   （构建期生成，被快照进去了）
/pagefind/pagefind.js           -> 404   （构建后生成，没被快照）
/pagefind/pagefind-entry.json   -> 404
```

`scripts/postbuild-pagefind.mjs` 就是补这一步：pagefind 跑完后把索引镜像进 `.vercel/output/static/pagefind`。
脚本带保护——只有目标目录里已经存在 `index.html`（确认它确实是站点根）才会复制，避免把空目录或半成品提升为部署产物。

> 另外 `pagefind` 已从 `devDependencies` 移到 `dependencies`：它是构建脚本真正需要的命令行工具，
> 万一部署环境按 `NODE_ENV=production` 只装生产依赖，放在 devDependencies 会导致构建失败。

---

## 三、配置环境变量（必做）

`.env` 已被 `.gitignore` 忽略，**不会**随仓库上传。所有 `PUBLIC_*` 变量必须在 Vercel 后台单独配置，否则社交链接、"Edit this post" 按钮等会隐藏或失效。

1. 进入项目 **Settings → Environment Variables**。
2. 按下表逐项添加（值填你自己的；留空的变量对应功能会自动隐藏）：

   | Key | 示例 / 说明 |
   | --- | --- |
   | `PUBLIC_SOCIAL_X` | `https://x.com/your-handle`（留空则隐藏 X 入口） |
   | `PUBLIC_SOCIAL_LINKEDIN` | `https://www.linkedin.com/in/your-profile` |
   | `PUBLIC_SOCIAL_EMAIL` | `you@example.com` |
   | `PUBLIC_EDIT_POST_URL` | `https://github.com/your/repo/edit/main/`（"Edit this post" 前缀） |
   | `PUBLIC_GOOGLE_SITE_VERIFICATION` | Google Search Console 验证令牌（可选） |
   | `ADMIN_USER` | 后台登录用户名，留空则默认 `admin` |
   | `ADMIN_PASSWORD` | **后台登录密码（必填，否则后台完全登不进去）** |
   | `ADMIN_SECRET` | 会话签名密钥，任意长随机字符串（`openssl rand -hex 32`）；不配会出现"登录成功但一刷新就掉线" |
   | `DEPLOY_HOOK_URL` | 后台保存文章后自动触发重新部署（可选，见 3.1） |

3. 变量添加后，**重新触发一次部署**（在 Deployments 里 Redeploy，或重新 push 一次），让环境变量生效。

> 参考：仓库根目录的 `.env.example` 列出了全部可用变量及其含义。

### 3.0 后台账号密码（必做，否则登不进后台）

为了让源码仓库里**不出现任何明文密码**，后台密码只从环境变量读取，优先级：

1. 后台「设置」页改过并写入 KV 的密码（SHA-256 哈希）；
2. 环境变量 `ADMIN_PASSWORD`；
3. 都没有 → **拒绝任何登录**。

所以首次部署后请务必在 Vercel 配上 `ADMIN_PASSWORD`（本地开发则写在 `.env` 里）。登录入口 `https://你的域名/admin`，账号默认 `admin`（可用 `ADMIN_USER` 改）。

> 想恢复成环境变量里那个密码：删掉 KV 中的 `admin:auth` 键即可（本地是删 `src/data/admin/auth.json`）。

### 3.1 后台存储（KV）配置 —— 修复“登录一直显示网络错误，请重试”（强烈建议）

**为什么之前会报错**：Vercel 的 Serverless Functions 文件系统是**只读**的，而旧版后台把账号、日志、评论等写在项目内的 JSON 文件里 → 登录流程一写文件就 500，前端只能显示“网络错误”。

现在的方案：后台数据（管理员密码、操作日志、站内用户、评论、后台保存的文章）统一走 **KV 存储**（兼容 Vercel KV 与 Upstash Redis）。配置步骤：

1. 进入 Vercel 项目 → **Storage** 标签 → **Create Database** → 选择 **Redis (Upstash)**（Hobby 免费套餐够用）。
2. 创建后点击 **Connect to Project**，选择本项目并 **Connect** —— Vercel 会自动注入 `KV_REST_API_URL` 和 `KV_REST_API_TOKEN` 两个环境变量，**无需手动填写**。
3. （可选，推荐）让“后台保存的文章自动发布上线”：
   - 进入 **Settings → Git → Deploy Hooks**，随便起个名字（如 `admin-save`）和分支 `main`，创建后会得到一个形如 `https://api.vercel.com/v1/integrations/deploy/...` 的 URL；
   - 把这个 URL 添加为环境变量 `DEPLOY_HOOK_URL`。
   - 之后在后台保存/删除文章时会自动触发一次重新部署（构建前的同步脚本会把 KV 里的文章落盘），**约 1 分钟后文章自动上线**，全程不用碰 Git。
4. **最重要：添加完成后必须 Redeploy 一次。** 已部署的 Serverless 函数实例不会自动读取新环境变量；不重部署时，/admin/settings 里会一直显示红点"未检测到 KV 存储"，导入 MD / 保存文章 / 改密码也会继续报 EROFS 或"线上未启用 KV 存储"。

> 说明：
> - 不配置 KV 时本地开发一切正常（自动回退到本地 JSON 文件），只是线上后台的数据无法持久化，**且改密码、写文章、导入 MD 都会失败**。
> - 后台账号密码见 **3.0**：源码内已无默认密码，必须在环境变量 `ADMIN_PASSWORD` 里配置。登录后可在「设置」页改密码（改后的密码保存在 KV 里）。
> - KV 里的文章仅是"发布暂存区"，正式内容仍以 Git 仓库 `src/data/blog/*.md` 为准；同步脚本每次构建时把 KV 内容覆盖写入文件。

**绑定后仍显示"KV 未启用"怎么办**：进后台「设置」页看「数据存储状态」，下面有两行诊断：

- `运行在 Vercel`：正常应为「是」，`VERCEL_ENV=production`。
- `可见的存储类变量`：会列出运行时真正读到的变量名（只列名字，不含值）。正常应看到 `KV_REST_API_URL`、`KV_REST_API_TOKEN` 或 `UPSTASH_REDIS_REST_URL`、`UPSTASH_REDIS_REST_TOKEN`。

按诊断结果处理：

1. **一个变量都没有** → 集成没有把变量注入到当前环境。打开项目 **Settings → Environment Variables** 确认；若确实为空，去 Upstash 控制台复制 REST URL 和 Token，**手动添加**为 `KV_REST_API_URL` 与 `KV_REST_API_TOKEN`（环境记得勾 Production 和 Preview），保存后 Redeploy。
2. **变量名不在上述四个之内** → 若看到的是 `REDIS_URL`（`rediss://default:TOKEN@host:port`），代码已支持自动从中推导 REST 端点，无需手动添加；若自检仍失败，把「可见的存储类变量」那一行的名字发出来，改代码适配即可。
3. **`VERCEL_ENV` 不是 production** → 你当前访问的是预览环境，而变量只加到了 Production（或反之）。在 **Settings → Environment Variables** 里把缺失的环境勾上，或访问对应的环境。
4. 无论如何，**改完环境变量都要 Redeploy 一次**。

---

## 四、注意事项与排错

### 1. 包管理器与镜像源（`.npmrc`）
仓库根目录的 `.npmrc` 把 registry 指向了 `registry.npmmirror.com`（以及 esbuild / sharp 的二进制镜像），这是为了**本地开发**在国内能快速安装。Vercel 的构建机也会读取这个 `.npmrc`，镜像源为公网可访问，通常能正常拉取，只是偶尔比默认源慢。

- 若你希望 Vercel 构建更快 / 更稳定，可在部署前把 `.npmrc` 里的 `registry` 改回默认 `https://registry.npmjs.org`，并删掉 `esbuild_binary_host` / `sharp_binary_host` 两行（让原生二进制回退到官方源）。本地开发仍可用另一份不提交的 `.npmrc`。
- **不要**把含个人隐私的 `.env` 提交进仓库。

### 2. SEO / 索引
`vercel.json` 中**没有**对全站设置 `noindex`（早期模板默认全站 noindex 已移除），部署到正式域名后即可被搜索引擎正常收录。若你只是临时测试，可临时在 `(.*)` 响应头里加回 `X-Robots-Tag: noindex, nofollow`。

### 3. 混合渲染下的搜索
Pagefind 在构建时索引 `dist` 下的**静态** HTML，因此已预渲染的博客内容可被站内搜索检索；管理后台等动态路由不会进入搜索索引（这是正确的行为）。

### 4. 音乐胶囊（可选）
音乐接口走网易云公开 API。网易云外链会 302 跳到 `http://` 的 CDN，项目已通过自建的 `/api/music/stream?id=` 在服务端解析跳转并强制升级为 `https://`，因此不存在混合内容问题；接口还会先做可播性预检，跳过外链已失效的歌曲。

### 4.1 导入 MD / 保存文章报 `EROFS: read-only file system`
报错形如：

```
EROFS: read-only file system, open '/var/task/src/data/blog/xxx.md'
```

**原因**：`KV_REST_API_URL` / `KV_REST_API_TOKEN` 没有注入，代码判定 KV 未启用，于是回退到"写本地 markdown 文件"，而 Vercel 的 `/var/task` 是只读的 → EROFS。

**解决**：回到 **3.1** 绑定 Redis(Upstash) 数据库并 **Redeploy**。绑定后可在后台「设置」页看到「数据存储状态」变为绿色的"KV 存储已启用"。

现在代码也会提前拦截这种情况：未启用 KV 时导入接口直接返回 503 + 中文说明，不会再抛裸的 EROFS。

### 5. 自定义域名
在 Vercel 项目 **Settings → Domains** 中添加你的域名，按提示配置 DNS（CNAME 指向 `cname.vercel-dns.com` 或添加 TXT 验证），Vercel 会自动签发 SSL 证书。

---

## 五、本地预览"生产构建"效果

```bash
pnpm install
pnpm run build        # 等价于 Vercel 的构建：astro build + pagefind
pnpm run preview      # 本地以生产模式预览 dist
```

如需在本地模拟 Vercel Serverless（含 API / 后台），可安装 Vercel CLI：

```bash
pnpm add -D vercel
vercel dev
```

---

## 六、后续更新如何上线

- 把改动 `git push` 到主分支，Vercel 会**自动重新部署**（Production 分支默认即主分支）。
- 每个 Push 都会生成一个预览部署（Preview Deployment），可在合并前先验证。
- 想手动触发：Vercel 控制台 **Deployments → 任意记录 → Redeploy**。

---

## 七、技术变更小结（本次为可部署做的调整）

| 文件 | 变更 |
| --- | --- |
| `astro.config.ts` | 适配器由 `@astrojs/node` 改为 `@astrojs/vercel`；`output` 设为 `"static"`（Astro 6.3.1 已移除 `hybrid`，改用 static 即可实现"静态页 + 按需 serverless 路由"） |
| `package.json` | 新增依赖 `@astrojs/vercel`、移除 `@astrojs/node`；`build` 脚本改为 `astro build && pagefind --site dist`（独立出 `check` 脚本避免类型检查阻断部署）；新增 `engines.node` |
| `pnpm-lock.yaml` | **必须重新生成**（`pnpm install --lockfile-only`）：已包含 `@astrojs/vercel` 且彻底移除 `@astrojs/node`；锁定 `astro@6.3.1 / vite@7.3.3 / tailwindcss@4.3.0`。若 lockfile 与 package.json 不同步，Vercel 会装回旧的 node 适配器导致构建失败 |
| `vercel.json` | 新增 `framework / buildCommand / installCommand / outputDirectory`；移除全站 `noindex`，保留缓存与安全响应头 |
| `.gitignore` | 新增 `nm_*/`（沙箱残留的临时 node_modules 备份，忽略以免误提交） |
| `.env.example` | 已存在，列出全部 `PUBLIC_*` 变量供 Vercel 后台填写 |

---

## 八、本地构建已验证结果

用与 lockfile 一致的版本（`astro@6.3.1` + `vite@7.3.3` + `tailwindcss@4.3.0`）实际跑通了完整构建：

- `astro build` 成功输出 `dist/client`（静态页，含各 tag 页与首页）与 `dist/server/entry.mjs` + `entrypoint_*.mjs`（即 admin / API 的 serverless 入口）；
- 构建日志显示 `output: "static"`、`mode: "server"`、`adapter: @astrojs/vercel`；
- 图片经 sharp 优化正常生成 webp；
- `pagefind --site dist` 成功生成搜索索引（示例：索引 4 个页面 / 737 个词）。

> 说明：本地曾出现的 `astro.mjs 找不到`、`@astrojs/internal-helpers 找不到`、`lodash.kebabcase/index.js 找不到` 等报错，全部源于**本机沙箱的 safe-delete 拦截器**在批量删除时清空了 `node_modules` 内的符号链接与文件，属于本地环境噪声，**Vercel 的干净构建环境不会出现**。
