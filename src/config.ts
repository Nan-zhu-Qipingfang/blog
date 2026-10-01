export const SITE = {
  website: "https://blog.qinanzhu.site",
  author: "南烛",
  desc: "提供建站教程、编程实战笔记、生活点滴，个人经验，融合技术开发与人文思考，定期更新深度指南与创意灵感，给大家提供更多帮助。",
  title: "Nanzhu's Blog",
  since: "2021-01-01", // site launch date, powers the footer uptime counter
  ogImage: "devosfera-og.webp", // located in the public folder
  lightAndDarkMode: true,
  postPerIndex: 6,
  postPerPage: 12,
  scheduledPostMargin: 15 * 60 * 1000, // 15 minutes
  showArchives: true,
  showGalleries: true,
  showGalleriesInIndex: true, // Show galleries in the general paginated list (only if showGalleries is true)
  showBackButton: true, // show back button in post detail
  showTagsInCards: true, // show tag pills at the bottom of post cards
  showCoverImages: false, // show cover images (OG) in post cards (requires pnpm build in dev mode)
  indexPostsGrid: false, // show recent/featured posts in grid layout on the home page (like /posts page)
  heroTerminalPrompt: {
    prefix: "~", // highlighted part on the left
    path: "/ready-to-go", // central prompt text
    suffix: "$", // terminal symbol on the right
  },
  backdropEffects: {
    cursorGlow: true, // cursor tracking with soft halo
    grain: true, // background visual noise layer
  },
  editPost: {
    enabled: true,
    text: "Edit this post",
    url: process.env.PUBLIC_EDIT_POST_URL ?? "", // set in .env
  },
  dynamicOgImage: true,
  // 评论区的 IP 属地：保存评论时按 x-forwarded-for 查一次免费接口，
  // 取不到就留空（前端不显示地区）。国内直连 freeipapi 成功率较高，
  // 失败会依次退回 ipapi.co / ipinfo.io，都失败就整体降级为空。
  commentRegion: {
    enabled: true,
    detail: "city", // "city" | "region" | "country" —— 显示到哪一级（越细越准但也越"暴露"）
  },
  // 评论区底部署名（对标参考站的「由 XX 驱动」）
  commentSystemName: "七平方评论",
  // 填自己的邮箱后，该邮箱发的评论自动挂「站长」称号（留空则不自动标记）
  commentOwnerEmail: "",
  dir: "ltr", // "rtl" | "auto"
  lang: "zh-CN", // html lang code. Set this empty and default will be "en"
  timezone: "Asia/Shanghai", // Default global timezone (IANA format) https://en.wikipedia.org/wiki/List_of_tz_database_time_zones
  introAudio: {
    enabled: false, // show/hide intro player in home and compact player while navigating
    // src: path to file (relative to /public or absolute URL). Example: "/intro.mp3" or "https://example.com/stream"
    src: "https://fluxfm.streamabc.net/flx-chillhop-mp3-128-8581707",
    // src: "/audio/intro-web.mp3",
    isStream: true, // true for radio/live stream URLs (example: https://fluxfm.streamabc.net/flx-chillhop-mp3-128-8581707)
    label: "LOFI", // display label in player
    duration: 30, // duration in seconds (used for local files, ignored on streams)
  },
} as const;
