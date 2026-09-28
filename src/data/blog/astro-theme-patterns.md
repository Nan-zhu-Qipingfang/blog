---
title: "Astro 主题开发常用模式：内容集合与视图过渡"
description: 以一个真实主题为例，梳理 Astro 内容集合的类型约束、草稿过滤、以及 View Transitions 全局组件常驻的实现思路。
pubDatetime: 2026-04-12T09:30:00Z
tags:
  - Astro
  - 前端
  - 教程
draft: false
---

开发博客主题时，有几类问题几乎人人都会遇到：如何管理文章元数据、如何优雅地过滤草稿、如何在页面切换时保持播放器等全局组件不重载。本文以代码为例逐一拆解。

## 内容集合：给 Markdown 加上类型

在 `src/content.config.ts` 中定义集合，可以用 zod 对 frontmatter 做严格校验：

```ts
import { defineCollection, z } from "astro:content";

const blog = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDatetime: z.coerce.date(),
    modDatetime: z.coerce.date().optional(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});

export const collections = { blog };
```

字段写错类型时构建期直接报错，比写完才发现页面空白要友好得多。

## 过滤草稿的两种姿势

查询时过滤是最常见的做法：

```astro
---
const posts = await getCollection("blog", ({ data }) => !data.draft);
---
```

注意：如果用 `glob()` 加载器，构建环境会自动剔除草稿，但开发模式仍然可见，方便预览——这正是我们想要的行为。

## 视图过渡：让全局组件常驻

Astro 的 `<ClientRouter />` 提供了 `transition:persist` 指令。把音乐播放器、搜索弹窗这类组件标记为 persist 后，页面切换时 DOM 会被保留，音乐不会中断：

```astro
<div id="global-player" transition:persist>
  <audio-player />
</div>
```

配合 `astro:page-load` 事件重新绑定监听器，就能兼顾"常驻"与"事件不重复"。

## 小结

- 类型安全的内容集合是主题稳定性的基石；
- 草稿过滤交给集合层，页面层保持简单；
- 善用 `transition:persist` 与生命周期事件，体验与正确性可以兼得。

完整的主题代码可以在本站仓库中查看，欢迎参考与吐槽。
