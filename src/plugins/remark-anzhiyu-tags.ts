/**
 * remark 插件：把 hexo-theme-anzhiyu（安知鱼）的外挂标签语法原样搬到 Astro。
 *
 * 支持的标签（与主题 scripts/tag/*.js 一一对应）：
 *   行内：{% audio url %}、{% video url %}、{% hideInline 内容,按钮文字,背景色,文字色 %}
 *   块级：{% videos 对齐,列数 %}…{% endvideos %}
 *        {% tip 样式 %}…{% endtip %}
 *        {% hideBlock 按钮文字,背景色,文字色 %}…{% endhideBlock %}
 *        {% hideToggle 标题,背景色,文字色 %}…{% endhideToggle %}
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

/* ────────────────── 行内标签 ────────────────── */

const INLINE_RE = /\{%\s*(audio|video|hideInline)\s+([^%]*?)\s*%\}/g;

let hideSeq = 0;

function renderInline(name: string, argsRaw: string): string {
  const raw = String(argsRaw ?? "").trim();

  if (name === "audio" || name === "video") {
    const url = raw.split(/\s+/).filter(Boolean)[0] ?? "";
    if (!url) return "";
    return name === "audio"
      ? `<div class="audio"><audio controls preload><source src='${escAttr(url)}' type='audio/mp3'>Your browser does not support the audio tag.</audio></div>`
      : `<div class="video"><video controls preload><source src='${escAttr(url)}' type='video/mp4'>Your browser does not support the video tag.</video></div>`;
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
  return (tree: MdNode) => {
    transformBlocks(tree);
    transformInline(tree, processor);
  };
}
