/**
 * rehype plugin — 把正文里的 `==重点内容==` 变成 `<mark>`。
 *
 * 参考站（LiuShen）用 remark 侧的高亮语法把重点包成蓝色方框，本项目为了
 * 不额外引入 remark 插件，改成在 hast 层做一次文本切分，效果等价：
 *
 *   这是 ==重点== 的内容  →  <p>这是 <mark>重点</mark> 的内容</p>
 *
 * 说明：remark 不认识 `==`，会把它当成普通文本留在 text 节点里，所以这里
 * 遍历所有 text 节点做正则切分即可，不需要自定义 mdast / micromark。
 */

/** 只在正文（非代码块 / 非内联 code）里生效的容器选择器 */
const SKIP = new Set(["pre", "code", "style", "script", "mark"]);

function processNode(node) {
  if (!node || node.type !== "element" || SKIP.has(node.tagName)) return;
  if (!node.children || !node.children.length) return;

  const next = [];
  let changed = false;

  for (const child of node.children) {
    if (child && child.type === "text" && child.value && child.value.includes("==")) {
      const parts = splitMarks(child.value);
      if (parts.length > 1) {
        changed = true;
        for (const part of parts) {
          next.push(
            part.mark
              ? { type: "element", tagName: "mark", properties: {}, children: [{ type: "text", value: part.text }] }
              : { type: "text", value: part.text },
          );
        }
        continue;
      }
    }
    next.push(child);
  }

  if (changed) node.children = next;
}

function walk(node) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child);
    return;
  }
  if (node.type === "element") {
    processNode(node);
    for (const child of node.children ?? []) walk(child);
  } else if (node.children) {
    for (const child of node.children) walk(child);
  }
}

/** `abc ==key== def` → [{text:"abc "},{mark:true,text:"key"},{text:" def"}] */
function splitMarks(value) {
  if (!value.includes("==")) return [{ text: value, mark: false }];
  const parts = [];
  const re = /==([^=\n]+)==/g;
  let last = 0;
  let m;
  while ((m = re.exec(value)) !== null) {
    if (m.index > last) parts.push({ text: value.slice(last, m.index), mark: false });
    const inner = m[1].trim();
    if (inner) parts.push({ text: inner, mark: true });
    last = m.index + m[0].length;
  }
  if (last < value.length) parts.push({ text: value.slice(last), mark: false });
  return parts.length ? parts : [{ text: value, mark: false }];
}

/** 返回 rehype 插件：() => transformer */
export default function rehypeHighlightMarks() {
  return tree => walk(tree);
}
