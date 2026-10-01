---
title: 部署轻笑前端
description: >-
  前言
  最近开始做博客的时候，注意到很多网站上都加上了Ai摘要功能，于是我也开始尝试了，经过九九八十一难，最终选择了轻笑前端和TianliGPT文章摘要的组合。
  @『轻笑Chuckle』AI摘要原文链接
author: 南烛
pubDatetime: 2026-03-07T08:22:49.000Z
modDatetime: 2026-03-07T15:03:45.000Z
tags:
  - 摘要
featured: false
draft: false
---

## 前言

最近开始做博客的时候，注意到很多网站上都加上了Ai摘要功能，于是我也开始尝试了，经过九九八十一难，最终选择了轻笑前端和TianliGPT文章摘要的组合。

[@『轻笑Chuckle』AI摘要原文链接](https://www.qcqx.cn/article/17d3383a.html)

---

## 轻笑前端的特性：

1. **真AI！**，接入tianliGPT，JS动态获取全文所有纯文本，传给api实时获取文章摘要（受限于tianliGPT的成本，目前仍有缓存机制）
2. 基于tianliGPT标注关键词、Python分析相关度的相关文章AI推荐
3. 遇到标点符号慢下来，动态打字速度
4. 使用requestAnimationFrame优化性能，动态清除setTimeout、打断fetch请求，交互放心
5. 使用IntersectionObserver监听，当容器在视口不可见后停止生成摘要，重新出现在视口后继续生成
6. 模拟GPT的光标效果
7. 多个按钮实现多个功能，自我介绍、文章摘要、推荐相关文章等
8. 良好兼容性，性能消耗小。
9. 适配pjax
10. 简单引入js后，即可生成QX-AI并自动挂载初始化
11. 配置项多样，高度自定义
12. 支持切换摘要、摘要语音朗读

## 快速上手

项目地址[Post-Summary-AI]([https://](https://github.com/qxchuckle/Post-Summary-AI))

非常简单，引入下面这些代码到你的网站内，并修改配置项后即可

TIP: 为避免CDN和浏览器缓存的影响，建议指定资源版本号使用

```html
<!-- css -->
<link rel="stylesheet" href="https://cdn1.tianli0.top/gh/qxchuckle/Post-Summary-AI/chuckle-post-ai.css">
<!-- chuckle-post-ai.js现在可以在网页结构的任何位置插入，只要你能够 -->
<script src="https://cdn1.tianli0.top/gh/qxchuckle/Post-Summary-AI/chuckle-post-ai.js"></script>
<!-- 但要确保的是，AI构造代码一定要在chuckle-post-ai.js之后插入 -->
<script data-pjax defer>
  // AI构造函数
  new ChucklePostAI({
    /* 必须配置 */
    // 文章内容所在的元素属性的选择器，也是AI挂载的容器，AI将会挂载到该容器的最前面
    el: '#post>#article-container',
    // 驱动AI所必须的key，即是tianliGPT后端服务所必须的key
    key:'123456',
    /* 非必须配置 */
    // 文章标题所在的元素属性的选择器，默认获取当前网页的标题
    title_el: '.post-title',
    // 文章推荐方式，all：匹配数据库内所有文章进行推荐，web：仅当前站内的文章，默认all
    rec_method: 'web',
    // 获取文章内容时，需要排除的元素及其子元素，默认如下
    exclude: ['highlight', 'Copyright-Notice', 'post-ai', 'post-series', 'mini-sandbox']
  })
</script>

```

AI构造函数 `ChucklePostAI({ /* 传入配置对象 */ })` 详解

1. `el` 文章内容所在的元素属性的选择器，也是AI挂载的容器，AI将会挂载到该容器的最前面
2. `key` 驱动AI所必须的key，即是tianliGPT后端服务所必须的key
3. `title_el `文章标题所在的元素属性的选择器，默认获取当前网页的标题
4. `rec_method` 文章推荐方式，`all`：匹配数据库内所有文章进行推荐，`web`：仅当前站内的文章，默认all
5. `exclude` 获取文章内容时，需要排除的元素及其子元素

tianliGPT的key请到[爱发电](https://afdian.com/item/f18c2e08db4411eda2f25254001e7c00)中购买，10元5万字符（常有优惠）。请求过的内容再次请求不会消耗key，可以无限期使用。

更多详情请看项目仓库README

## 注意事项

如果是跟站主一样的butterfly主题博客的话，可以放在`博客根目录\themes\butterfly\_config.yml`中`inject:`-`bottom:`下哦，记一下站主犯过的小错误，快速入手的那段代码插入文件后记得要变成一行的格式哦，鉴于是在yml文件里那行代码中不允许出现空格哦！

如果还有问题的话请私信原作者chuckle，或者备注评论区，有空且会的情况下会回复。
