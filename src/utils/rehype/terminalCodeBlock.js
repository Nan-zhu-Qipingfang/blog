/**
 * rehypeTerminalCodeBlock
 *
 * Wraps every fenced code block (`<pre><code>…</code></pre>`) in a macOS
 * terminal window at BUILD time:
 *
 *   <div class="code-block-wrap">
 *     <div class="code-chrome">
 *       <span class="code-dot code-dot--r"></span> …y …g
 *       <span class="code-title">ts</span>
 *       <button class="copy-code">…</button>
 *     </div>
 *     <pre>…</pre>
 *   </div>
 *
 * Why build-time instead of the old runtime `attachCopyButtons()`:
 * generating the chrome in JS meant the raw <pre> painted first and the
 * frame appeared one frame later (visible "detach / disappear" jump),
 * and view-transition swaps left freshly-parsed <pre> nodes unframed.
 * Server-rendered markup is stable on first paint and survives swaps.
 */


const COPY_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

const classList = props => {
  const raw = props?.className ?? props?.class ?? [];
  const list = Array.isArray(raw) ? raw : String(raw).split(/\s+/);
  return list.filter(Boolean).map(String);
};

/** Joins all descendant text nodes of a hast node. */
function collectText(node) {
  if (!node) return "";
  if (node.type === "text") return String(node.value ?? "");
  const children = node.children;
  if (!Array.isArray(children)) return "";
  return children.map(collectText).join("").trim();
}

const langOf = (preNode, codeNode) => {
  for (const source of [codeNode, preNode]) {
    for (const c of classList(source?.properties)) {
      const m = /^language-(.+)$/.exec(c);
      if (m) return m[1];
    }
  }
  // hast stores `data-language` as `dataLanguage`
  const dataLang =
    preNode?.properties?.dataLanguage ?? preNode?.properties?.["data-language"];
  return dataLang ? String(dataLang) : "";
};

/**
 * Minimal depth-first walk over the hast tree (avoids a hard dependency on
 * `unist-util-visit`, which pnpm does not hoist into this project).
 * The visitor may return `false` to skip descending into the current node.
 */
function walk(node, visitor, parent, index) {
  const result = visitor(node, index, parent);
  if (result === false) return;
  const children = node.children;
  if (!Array.isArray(children)) return;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child && typeof child === "object") walk(child, visitor, node, i);
  }
}

export function rehypeTerminalCodeBlock() {
  return tree => {
    walk(tree, (node, index, parent) => {
      if (node.type !== "element" || node.tagName !== "pre") return;
      if (!parent || index == null) return;
      const code = node.children?.[0];
      if (!code || code.type !== "element" || code.tagName !== "code") return;
      // never double-wrap
      if (parent.tagName === "div" && classList(parent.properties).includes("code-block-wrap"))
        return;

      const lang = langOf(node, code);

      // `file="name.md"` (transformerFileName) appends an absolutely
      // positioned badge inside the <pre> — lift it into the chrome bar as
      // the window title and drop the margin it added, otherwise the badge
      // would overlap the chrome and the margin would split the window.
      let title = lang;
      const kids = node.children;
      for (let i = kids.length - 1; i >= 1; i--) {
        const c = kids[i];
        if (c?.type !== "element" || c.tagName !== "span") continue;
        if (!classList(c.properties).includes("absolute")) continue;
        const text = collectText(c);
        if (text) title = text;
        kids.splice(i, 1);
        break;
      }
      const preClasses = classList(node.properties).filter(c => c !== "mt-8");
      if (node.properties?.className != null)
        node.properties.className = preClasses;
      else if (node.properties?.class != null)
        node.properties.class = preClasses.join(" ");

      const dot = tint => ({
        type: "element",
        tagName: "span",
        properties: { className: ["code-dot", `code-dot--${tint}`] },
        children: [],
      });

      const chrome = {
        type: "element",
        tagName: "div",
        properties: { className: ["code-chrome"] },
        children: [
          dot("r"),
          dot("y"),
          dot("g"),
          {
            type: "element",
            tagName: "span",
            properties: { className: ["code-title"] },
            children: [{ type: "text", value: title }],
          },
          {
            type: "element",
            tagName: "button",
            properties: {
              className: ["copy-code"],
              type: "button",
              "aria-label": "复制代码",
              "data-copy-code": "",
            },
            children: [
              {
                type: "element",
                tagName: "span",
                properties: { className: ["copy-icon"] },
                children: [],
              },
              {
                type: "element",
                tagName: "span",
                properties: { className: ["copy-label"] },
                children: [{ type: "text", value: "复制" }],
              },
            ],
          },
        ],
      };

      // the copy icon is raw SVG — inject as raw hast so it isn't escaped
      chrome.children[4].children[0].children = [
        { type: "raw", value: COPY_ICON },
      ];

      const wrapper = {
        type: "element",
        tagName: "div",
        properties: { className: ["code-block-wrap"] },
        children: [chrome, node],
      };

      parent.children[index] = wrapper;
      return false; // do not descend (nothing to do inside the pre)
    });
  };
}

export default rehypeTerminalCodeBlock;
