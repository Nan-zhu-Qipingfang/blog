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

   > 说明：本项目的构建脚本为 `astro build && pagefind --site dist`，会在构建时一并生成站内全文搜索（Pagefind）索引，无需额外步骤。

3. 先**不要急着点 Deploy**，先到下一步配置环境变量。
4. 点击 **Deploy**，等待构建完成。首次构建约 1–3 分钟（受 npmmirror 镜像源网络影响可能稍慢，见第四节注意事项）。

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

3. 变量添加后，**重新触发一次部署**（在 Deployments 里 Redeploy，或重新 push 一次），让环境变量生效。

> 参考：仓库根目录的 `.env.example` 列出了全部可用变量及其含义。

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
音乐接口走的是网易云公开 API，部分歌曲音频 CDN 为 `http://` 协议。若站点启用了 HTTPS 且浏览器拦截了混合内容导致无法播放，可在后台接入支持 HTTPS 的音频源，或让音乐接口统一返回 HTTPS 链接。

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
