/**
 * remark 插件：把 hexo-theme-anzhiyu（安知鱼）的外挂标签语法原样搬到 Astro。
 *
 * 两套语法都支持：
 *   1) 安知鱼的 {% %} 语法：
 *      行内：{% audio url %}、{% video url %}、{% hideInline 内容,按钮文字,背景色,文字色 %}
 *      块级：{% videos 对齐,列数 %}…{% endvideos %}
 *           {% tip 样式 %}…{% endtip %}
 *           {% hideBlock 按钮文字,背景色,文字色 %}…{% endhideBlock %}
 *           {% hideToggle 标题,背景色,文字色 %}…{% endhideToggle %}
 *   2) 更通用的 ::: 容器语法（key=value 属性，可单行也可多行）：
 *      :::video-gallery cols=1 ratio=16:9 url=… title=… desc=… :::
 *      :::tip warning 内容 :::   /   :::details 标题 ::: … :::
 *
 * 实现要点：
 * - 块级标签各自独占一行时会被 remark 解析成独立 paragraph，取首尾两个
 *   节点之间的所有兄弟节点作为内容，套一层容器（与 Hexo 的 { ends: true } 等价）
 * - 行内标签出现在 text 节点里，用正则替换成 mdast 的 html 节点，
 *   Astro 的 markdown 管线会把 html 节点原样输出
 * - 不处理 code / inlineCode 节点，代码块里的 {% ... %} 保持原样
 */
type MdNode = {
  type: string;
  value?: string;
  children?: MdNode[];
  [key: string]: unknown;
};

const html = (value: string): MdNode => ({ type: "html", value });
const text = (value: string): MdNode => ({ type: "text", value });

function escAttr(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 只转义标签，保留 &apos; 这类实体（hide 系列文档里允许使用） */
function escText(value: string): string {
  return String(value ?? "")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function styleAttr(bg?: string, color?: string): string {
  let style = "";
  if (bg) style += `background-color:${escAttr(bg)};`;
  if (color) style += `color:${escAttr(color)};`;
  return style ? ` style="${style}"` : "";
}

/* ────────────────── 媒体源通用处理 ────────────────── */

/** HLS（m3u8）流：Chrome/Edge/Firefox 原生放不了，交给 hls.js */
function isHls(url: string): boolean {
  return /\.m3u8(\?|#|$)/i.test(String(url ?? "").trim());
}

function videoTag(url: string, poster?: string, cls = ""): string {
  const src = escAttr(url);
  const posterAttr = poster ? ` poster="${escAttr(poster)}"` : "";
  const hls = isHls(url);
  const srcAttr = hls ? "" : ` src="${src}"`;
  const hlsAttr = hls ? ` data-hls-src="${src}"` : "";
  const classAttr = cls ? ` class="${cls}"` : "";
  return `<video${classAttr} controls playsinline preload="metadata"${srcAttr}${hlsAttr}${posterAttr}></video>`;
}

function audioTag(url: string): string {
  return `<audio controls preload="metadata"><source src="${escAttr(url)}">Your browser does not support the audio tag.</audio>`;
}

function dedupe(list: string[]): string[] {
  return [...new Set(list.filter(Boolean))];
}

/* ────────────────── 行内标签 ────────────────── */

const INLINE_RE = /\{%\s*(audio|video|hideInline)\s+([^%]*?)\s*%\}/g;

let hideSeq = 0;

function renderInline(name: string, argsRaw: string): string {
  const raw = String(argsRaw ?? "").trim();

  if (name === "audio" || name === "video") {
    const url = raw.split(/\s+/).filter(Boolean)[0] ?? "";
    if (!url) return "";
    return name === "audio"
      ? `<div class="audio">${audioTag(url)}</div>`
      : `<div class="video">${videoTag(url)}</div>`;
  }

  if (name === "hideInline") {
    // {% hideInline 内容,按钮文字,背景色,文字色 %}
    const parts = raw.split(",");
    const content = escText(parts[0] ?? "");
    const display = escText(parts[1] || "Click");
    const id = `hide-inline-${++hideSeq}`;
    return (
      `<span class="hide-inline">` +
      `<input class="hide-cb" id="${id}" type="checkbox" />` +
      `<label class="hide-button" for="${id}"${styleAttr(parts[2], parts[3])}>${display}</label>` +
      `<span class="hide-content">${content}</span>` +
      `</span>`
    );
  }

  return "";
}

function splitInline(value: string): MdNode[] | null {
  const out: MdNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;
  while ((match = INLINE_RE.exec(value)) !== null) {
    if (match.index > last) out.push(text(value.slice(last, match.index)));
    const rendered = renderInline(match[1], match[2] ?? "");
    if (rendered) out.push(html(rendered));
    last = match.index + match[0].length;
  }
  if (out.length === 0) return null;
  if (last < value.length) out.push(text(value.slice(last)));
  return out;
}

/* ────────────────── 块级标签 ────────────────── */

type BlockTag = {
  name: string;
  open: RegExp;
  close: RegExp;
  openHtml: (arg: string) => string;
  closeHtml: (arg: string) => string;
};

const BLOCK_TAGS: BlockTag[] = [
  {
    name: "videos",
    open: /^\{%\s*videos\s*([^%]*?)\s*%\}$/,
    close: /^\{%\s*endvideos\s*%\}$/,
    openHtml: arg => {
      // 与主题一致：args 先按空格合并再按逗号切分 → [对齐, 列数]
      const [align = "", colRaw = ""] = arg.split(",").map(s => s.trim());
      const col = Number(colRaw) || 0;
      const cls = align ? ` ${align}` : "";
      return `<div class="videos${cls}"${col > 0 ? ` col="${col}"` : ""}>`;
    },
    closeHtml: () => "</div>",
  },
  {
    name: "tip",
    open: /^\{%\s*tip\s*([^%]*?)\s*%\}$/,
    close: /^\{%\s*endtip\s*%\}$/,
    openHtml: arg => `<div class="tip ${escAttr(arg || "info")}">`,
    closeHtml: () => "</div>",
  },
  {
    name: "hideBlock",
    open: /^\{%\s*hideBlock\s*([^%]*?)\s*%\}$/,
    close: /^\{%\s*endhideBlock\s*%\}$/,
    openHtml: arg => {
      const [display = "Click", bg, color] = arg.split(",").map(s => s.trim());
      return (
        `<details class="hide-block">` +
        `<summary class="hide-button"${styleAttr(bg, color)}>${escText(display)}</summary>` +
        `<div class="hide-content">`
      );
    },
    closeHtml: () => "</div></details>",
  },
  {
    name: "hideToggle",
    open: /^\{%\s*hideToggle\s*([^%]*?)\s*%\}$/,
    close: /^\{%\s*endhideToggle\s*%\}$/,
    openHtml: arg => {
      const [display = "Toggle", bg, color] = arg.split(",").map(s => s.trim());
      return (
        `<details class="toggle">` +
        `<summary class="toggle-button"${styleAttr(bg, color)}>${escText(display)}</summary>` +
        `<div class="toggle-content">`
      );
    },
    closeHtml: () => "</div></details>",
  },
];

function nodeText(node: MdNode): string {
  if (typeof node.value === "string") return node.value;
  if (node.children) return node.children.map(nodeText).join("");
  return "";
}

/** 把 {% xxx %} … {% endxxx %} 这对节点之间的兄弟节点包进容器 */
function transformBlocks(parent: MdNode): void {
  if (!parent.children) return;
  // 先处理深层，保证内层标签先被包装
  for (const child of parent.children) transformBlocks(child);

  const kids = parent.children;
  let i = 0;
  while (i < kids.length) {
    const own = nodeText(kids[i]).trim();
    const tag = BLOCK_TAGS.find(t => t.open.test(own));
    if (!tag) {
      i++;
      continue;
    }

    let end = -1;
    for (let j = i + 1; j < kids.length; j++) {
      if (tag.close.test(nodeText(kids[j]).trim())) {
        end = j;
        break;
      }
    }
    if (end === -1) {
      i++; // 没找到结束标签，原样保留
      continue;
    }

    const arg = own.match(tag.open)?.[1] ?? "";
    const inner = kids.slice(i + 1, end);
    kids.splice(
      i,
      end - i + 1,
      html(tag.openHtml(arg)),
      ...inner,
      html(tag.closeHtml(arg))
    );
    i += inner.length + 2;
  }
}

/* ────────────────── ::: 容器语法 ──────────────────
   与 {% %} 并列的另一套写法，属性用 key=value：
     单行：:::video-gallery cols=1 ratio=16:9 url=… title=… desc=… :::
     多行：:::video-gallery cols=2
           https://a.m3u8
           https://b.m3u8
           :::
   另支持 :::tip info / :::warning / :::details 标题 等容器。 */

type ContainerKind = "video-gallery" | "audio" | "tip" | "details";

const CONTAINER_ALIASES: Record<string, ContainerKind> = {
  "video-gallery": "video-gallery",
  videogallery: "video-gallery",
  videos: "video-gallery",
  video: "video-gallery",
  audio: "audio",
  "audio-gallery": "audio",
  tip: "tip",
  note: "tip",
  info: "tip",
  success: "tip",
  warning: "tip",
  danger: "tip",
  error: "tip",
  details: "details",
  fold: "details",
  hidetoggle: "details",
};

// 围栏按惯例至少三个冒号，但用户常写成四个（::::video-gallery … :::），一并认
const CONTAINER_OPEN_RE = /^:{3,}([a-zA-Z][\w-]*)\s*([\s\S]*)$/;
const CONTAINER_SOLO_RE = /^:{3,}([a-zA-Z][\w-]*)\s*([\s\S]*?):{3,}\s*$/;
const CONTAINER_CLOSE_RE = /^:{3,}\s*$/;

const TIP_STYLES = [
  "info",
  "primary",
  "success",
  "warning",
  "error",
  "danger",
  "ban",
  "bolt",
  "home",
  "sync",
  "cogs",
  "key",
  "bell",
  "note",
];

/**
 * 属性只认白名单里的 key。URL 的 query 里常有 vcode= / userId= 之类，
 * 若不限定 key 名会把查询参数误当成属性。
 */
const ATTR_KEYS = [
  "cols",
  "column",
  "columns",
  "ratio",
  "url",
  "urls",
  "src",
  "srcs",
  "title",
  "titles",
  "desc",
  "descs",
  "poster",
  "cover",
  "type",
  "name",
];

const ATTR_RE = new RegExp(`(?:^|\\s)(${ATTR_KEYS.join("|")})\\s*=`, "g");

function parseAttrs(input: string): Record<string, string> {
  const src = String(input ?? "").trim();
  const attrs: Record<string, string> = {};
  const marks: { key: string; valueStart: number; matchStart: number }[] = [];
  let m: RegExpExecArray | null;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(src)) !== null) {
    const lead = /^\s/.test(m[0]) ? 1 : 0;
    marks.push({
      key: m[1],
      valueStart: m.index + m[0].length,
      matchStart: m.index + lead,
    });
  }
  marks.forEach((mark, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].matchStart : src.length;
    let value = src.slice(mark.valueStart, end).trim();
    // 属性不跨行：多行容器会把正文一起喂进来，不截断的话最后一个属性值
    // 会把后面的 url / 正文全吞掉
    const nl = value.search(/\r?\n/);
    if (nl >= 0) value = value.slice(0, nl).trim();
    const quote = value[0];
    if (quote === '"' || quote === "'") {
      if (value.length > 1 && value.endsWith(quote)) value = value.slice(1, -1);
    } else if (quote === "“" && value.endsWith("”")) {
      value = value.slice(1, -1);
    }
    attrs[mark.key] = value;
  });
  return attrs;
}

/** 多个值用 ; 分隔（URL 里可能带 , 和 &，不能用逗号切） */
function splitList(value: string): string[] {
  return String(value ?? "")
    .split(/[;；]/)
    .map(s => s.trim())
    .filter(Boolean);
}

function attrUrls(attrs: Record<string, string>): string[] {
  return splitList(attrs.url || attrs.urls || attrs.src || attrs.srcs || "");
}

function ratioCss(raw?: string): string {
  const m = /^(\d+(?:\.\d+)?)\s*[:：]\s*(\d+(?:\.\d+)?)$/.exec(
    String(raw ?? "").trim()
  );
  if (!m) return "16 / 9";
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!w || !h) return "16 / 9";
  return `${w} / ${h}`;
}

function colsNum(raw?: string): number {
  const n = Number(String(raw ?? "").trim());
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.max(1, Math.min(4, Math.round(n)));
}

function videoGalleryHtml(
  attrs: Record<string, string>,
  extraUrls: string[]
): string {
  const urls = dedupe([...attrUrls(attrs), ...extraUrls]);
  if (urls.length === 0) return "";
  const cols = Math.min(colsNum(attrs.cols || attrs.column || attrs.columns), urls.length);
  const ratio = ratioCss(attrs.ratio);
  const poster = attrs.poster || attrs.cover || "";
  const titles = splitList(attrs.titles || "");
  const descs = splitList(attrs.descs || "");

  const items = urls
    .map((u, i) => {
      const t = escText(titles[i] ?? "");
      const d = escText(descs[i] ?? "");
      const cap =
        t || d
          ? `<div class="vg-item-caption">` +
            (t ? `<span class="vg-item-title">${t}</span>` : "") +
            (d ? `<span class="vg-item-desc">${d}</span>` : "") +
            `</div>`
          : "";
      return `<div class="vg-item"><div class="vg-frame">${videoTag(u, poster, "vg-video")}</div>${cap}</div>`;
    })
    .join("");

  const gTitle = escText(attrs.title ?? "");
  const gDesc = escText(attrs.desc ?? "");
  const caption =
    gTitle || gDesc
      ? `<figcaption class="vg-caption">` +
        (gTitle ? `<span class="vg-title">${gTitle}</span>` : "") +
        (gDesc ? `<span class="vg-desc">${gDesc}</span>` : "") +
        `</figcaption>`
      : "";

  return (
    `<figure class="video-gallery" style="--vg-cols:${cols};--vg-ratio:${ratio}">` +
    `<div class="vg-grid">${items}</div>${caption}</figure>`
  );
}

function tipSplit(key: string, arg: string): { style: string; content: string } {
  const trimmed = String(arg ?? "").trim();
  const first = (trimmed.split(/\s+/)[0] ?? "").toLowerCase();
  if (TIP_STYLES.includes(first)) {
    return { style: first, content: trimmed.slice(first.length).trim() };
  }
  const fromKey = key.toLowerCase();
  const style = fromKey !== "tip" && TIP_STYLES.includes(fromKey) ? fromKey : "info";
  return { style: style === "note" ? "info" : style, content: trimmed };
}

/** 单行容器：:::name … ::: */
function containerSolo(rawName: string, arg: string): string {
  const key = String(rawName ?? "").toLowerCase();
  const kind = CONTAINER_ALIASES[key];
  if (!kind) return "";
  const attrs = parseAttrs(arg);

  if (kind === "video-gallery") return videoGalleryHtml(attrs, []);

  if (kind === "audio") {
    const urls = attrUrls(attrs);
    if (urls.length === 0) return "";
    return urls.map(u => `<div class="audio">${audioTag(u)}</div>`).join("");
  }

  if (kind === "tip") {
    const { style, content } = tipSplit(key, arg);
    if (!content) return "";
    return `<div class="tip ${escAttr(style)}"><p>${escText(content)}</p></div>`;
  }

  const [head = "", ...rest] = String(arg ?? "").trim().split(/\s+/);
  return (
    `<details class="toggle">` +
    `<summary class="toggle-button">${escText(head || "展开")}</summary>` +
    `<div class="toggle-content"><p>${escText(rest.join(" "))}</p></div>` +
    `</details>`
  );
}

/**
 * 多行容器：:::name … （内容）:::
 * 返回字符串 → 整个区间替换成一段 HTML；返回 {open,close} → 内容原样保留。
 */
function containerBlock(
  rawName: string,
  arg: string,
  inner: MdNode[]
): string | { open: string; close: string } | null {
  const key = String(rawName ?? "").toLowerCase();
  const kind = CONTAINER_ALIASES[key];
  if (!kind) return null;
  // 属性可能写在围栏内的后续行里（::::video-gallery cols=1 \n url=… title=… \n :::），
  // 这里把正文一起喂给 parseAttrs——它只认白名单 key，多余的纯文本会被忽略。
  const innerText = inner.map(n => nodeMarkdown(n)).join("\n");
  const attrs = parseAttrs(kind === "tip" || kind === "details" ? arg : [arg, innerText].filter(Boolean).join("\n"));

  if (kind === "video-gallery") {
    const htmlOut = videoGalleryHtml(attrs, collectUrls(inner));
    return htmlOut || null;
  }

  if (kind === "audio") {
    const urls = dedupe([...attrUrls(attrs), ...collectUrls(inner)]);
    if (urls.length === 0) return null;
    return urls.map(u => `<div class="audio">${audioTag(u)}</div>`).join("");
  }

  if (kind === "tip") {
    const { style } = tipSplit(key, arg);
    return { open: `<div class="tip ${escAttr(style)}">`, close: "</div>" };
  }

  const title = String(arg ?? "").trim() || "展开";
  return {
    open:
      `<details class="toggle">` +
      `<summary class="toggle-button">${escText(title)}</summary>` +
      `<div class="toggle-content">`,
    close: "</div></details>",
  };
}

/** 从容器正文里抓 URL（裸链接被 GFM 转成 link 节点，两种都要认） */
function collectUrls(nodes: MdNode[]): string[] {
  const out: string[] = [];
  const visit = (node: MdNode) => {
    if (node.type === "link" && typeof node.url === "string") out.push(node.url);
    const md = nodeMarkdown(node);
    if (md && node.type !== "link") {
      for (const line of md.split(/\r?\n/)) {
        const m = /^(https?:\/\/\S+)$/i.exec(line.trim());
        if (m) out.push(m[1]);
      }
    }
    (node.children ?? []).forEach(visit);
  };
  nodes.forEach(visit);
  return dedupe(out);
}

/**
 * 预处理：把「::: 独占一行」的地方先切成独立节点。
 * markdown 里连续行属于同一个段落，不开这个口子的话
 * ":::tip info\n正文\n:::" 会被当成一段，容器就没法在块级包起来。
 * 只对认识的名字动手，避免把正文里偶发的 ::: 切坏。
 */
/**
 * 节点对应的原始 markdown 源码。
 * nodeMarkdown() 是「重新拼出来」的，软换行（同一段落内的换行）会被吃掉，
 * 切 ::: 行时必须换行还在，所以优先用节点在原文里的 offset 直接切片。
 */
function rawOf(node: MdNode, source: string): string {
  const pos = node.position as
    | { start?: { offset?: number }; end?: { offset?: number } }
    | undefined;
  const start = pos?.start?.offset;
  const end = pos?.end?.offset;
  if (source && typeof start === "number" && typeof end === "number" && end > start) {
    return source.slice(start, end);
  }
  return nodeMarkdown(node);
}

function splitFenceLines(
  parent: MdNode,
  processor: { parse: (v: string) => MdNode },
  source: string
): void {
  if (!parent.children) return;
  const kids = parent.children;
  for (let i = 0; i < kids.length; i++) {
    const node = kids[i];
    if (node.children) splitFenceLines(node, processor, source);
    if (node.type === "code" || node.type === "inlineCode") continue;

    const md = rawOf(node, source);
    if (!/(?:^|\n)\s*:{3,}/.test(md)) continue;

  const parts = splitByFenceLines(md);
  if (parts.length <= 1) continue;
  const known = parts.some(p => {
    if (!p.isFence) return false;
    if (/^:{3,}$/.test(p.text)) return true;
    const name = /^:{3,}([a-zA-Z][\w-]*)/.exec(p.text)?.[1]?.toLowerCase();
    return Boolean(name && CONTAINER_ALIASES[name]);
  });
    if (!known) continue;

    const replacement: MdNode[] = [];
    for (const part of parts) {
      if (part.isFence) {
        replacement.push(text(part.text));
      } else if (part.text.trim()) {
        try {
          replacement.push(...(processor.parse(part.text).children ?? []));
        } catch {
          replacement.push(text(part.text));
        }
      }
    }
    if (replacement.length === 0) continue;
    kids.splice(i, 1, ...replacement);
    i += replacement.length - 1;
  }
}

/** 把源码按「独立成行的 :::」切成若干片段 */
function splitByFenceLines(md: string): { text: string; isFence: boolean }[] {
  const parts: { text: string; isFence: boolean }[] = [];
  let buf: string[] = [];
  const flush = () => {
    if (buf.length) parts.push({ text: buf.join("\n"), isFence: false });
    buf = [];
  };
  for (const line of md.split(/\r?\n/)) {
    if (/^\s*:{3,}/.test(line)) {
      flush();
      parts.push({ text: line.trim(), isFence: true });
    } else {
      buf.push(line);
    }
  }
  flush();
  return parts;
}

/** 把 :::name … ::: 多行容器包起来 */
function transformContainers(
  parent: MdNode,
  processor: { parse: (v: string) => MdNode }
): void {
  if (!parent.children) return;
  const kids = parent.children;
  let i = 0;
  while (i < kids.length) {
    const node = kids[i];
    if (node.type === "code" || node.type === "inlineCode") {
      i++;
      continue;
    }
    const own = nodeText(node).trim();
    // 单行写法交给 transformInline（那里能拿到整段的纯文本）
    if (CONTAINER_SOLO_RE.test(own)) {
      i++;
      continue;
    }
    if (node.children) transformContainers(node, processor);
    if (!CONTAINER_OPEN_RE.test(own)) {
      i++;
      continue;
    }
    const open = CONTAINER_OPEN_RE.exec(own);
    const name = open?.[1] ?? "";
    const arg = (open?.[2] ?? "").trim();
    if (!CONTAINER_ALIASES[String(name).toLowerCase()]) {
      i++;
      continue;
    }

    let end = -1;
    for (let j = i + 1; j < kids.length; j++) {
      if (CONTAINER_CLOSE_RE.test(nodeText(kids[j]).trim())) {
        end = j;
        break;
      }
    }
    if (end === -1) {
      i++;
      continue;
    }

    const inner = kids.slice(i + 1, end);
    const result = containerBlock(name, arg, inner);
    if (!result) {
      i++;
      continue;
    }
    if (typeof result === "string") {
      kids.splice(i, end - i + 1, html(result));
      i += 1;
    } else {
      kids.splice(i, end - i + 1, html(result.open), ...inner, html(result.close));
      i += inner.length + 2;
    }
  }
}

/**
 * GFM 会把裸链接自动转成 link 节点，"{% audio https://x %}" 因此被拆成
 * text + link + text 三段，只在 text 节点里匹配会漏掉。所以这里先看
 * 「整个节点的纯文本」是否恰好是一个标签，是就整节点替换。
 */
const SOLO_MEDIA_RE = /^\{%\s*(audio|video)\s+([^%]*?)\s*%\}$/;

/**
 * 把节点还原成 markdown 源码（用于段落级兜底）。link 节点要还原成
 * `[text](url)`，否则自动链接会把 url 暴露出来、后续重新解析结果不一致。
 */
function nodeMarkdown(node: MdNode): string {
  if (
    typeof node.value === "string" &&
    (node.type === "text" || node.type === "html")
  ) {
    return node.value;
  }
  const inner = () => (node.children ?? []).map(nodeMarkdown).join("");
  switch (node.type) {
    case "inlineCode":
      return "`" + String(node.value ?? "") + "`";
    case "strong":
      return "**" + inner() + "**";
    case "emphasis":
      return "*" + inner() + "*";
    case "break":
      return "\n";
    case "link": {
      const label = inner();
      const url = String(node.url ?? "");
      return url && url !== label ? `[${label}](${url})` : label;
    }
    case "image": {
      const alt = String(node.alt ?? "");
      return `![${alt}](${String(node.url ?? "")})`;
    }
    default:
      return inner();
  }
}

/** 段落级兜底：把整段还原成 markdown 再切分，非标签片段重新解析成内联节点 */
function rebuildFromMarkdown(
  parent: MdNode,
  processor: { parse: (v: string) => MdNode }
): void {
  const md = nodeMarkdown(parent);
  const out: MdNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;
  while ((match = INLINE_RE.exec(md)) !== null) {
    const before = md.slice(last, match.index);
    if (before.trim()) out.push(...inlineNodes(processor, before));
    const rendered = renderInline(match[1], match[2] ?? "");
    if (rendered) out.push(html(rendered));
    last = match.index + match[0].length;
  }
  if (out.length === 0) return;
  const after = md.slice(last);
  if (after.trim()) out.push(...inlineNodes(processor, after));
  if (out.length === 0) return;
  parent.children = out;
}

/** 把一段 markdown 文本解析成内联节点列表 */
function inlineNodes(
  processor: { parse: (v: string) => MdNode },
  value: string
): MdNode[] {
  try {
    const parsed = processor.parse(value);
    const first = parsed.children?.[0];
    if (first?.children) return first.children;
    return parsed.children ?? [text(value)];
  } catch {
    return [text(value)];
  }
}

function transformInline(
  parent: MdNode,
  processor: { parse: (v: string) => MdNode }
): void {
  if (!parent.children) return;
  const kids = parent.children;
  let i = 0;
  while (i < kids.length) {
    const child = kids[i];

    if (child.children) {
      const own = nodeText(child).trim();

      // 单行 :::name … ::: —— GFM 会把 url 拆成 link 节点，所以看整段纯文本
      const soloContainer = CONTAINER_SOLO_RE.exec(own);
      if (soloContainer) {
        const rendered = containerSolo(soloContainer[1], soloContainer[2] ?? "");
        if (rendered) {
          kids[i] = html(rendered);
          i++;
          continue;
        }
      }

      const solo = SOLO_MEDIA_RE.exec(own);
      const rendered = solo ? renderInline(solo[1], solo[2]) : "";
      if (rendered) {
        kids[i] = html(rendered);
        i++;
        continue;
      }
      transformInline(child, processor);
      i++;
      continue;
    }

    if (
      child.type === "text" &&
      typeof child.value === "string" &&
      child.value.includes("{%")
    ) {
      const replaced = splitInline(child.value);
      if (replaced) {
        kids.splice(i, 1, ...replaced);
        i += replaced.length;
        continue;
      }
    }
    i++;
  }

  // 兜底：标签被 GFM/内联标记拆散时（如 "前面 {% audio https://x %} 后面"），
  // 整段源码匹配一次，剩下的片段重新解析，保证链接等行内语法不丢。
  if (INLINE_RE.test(nodeMarkdown(parent)))
    rebuildFromMarkdown(parent, processor);
}

export default function remarkAnzhiyuTags(this: unknown) {
  const processor = this as { parse: (v: string) => MdNode };
  hideSeq = 0;
  return (tree: MdNode, file?: { value?: unknown }) => {
    const source = String(file?.value ?? "");
    splitFenceLines(tree, processor, source);
    transformBlocks(tree);
    transformContainers(tree, processor);
    transformInline(tree, processor);
  };
}
