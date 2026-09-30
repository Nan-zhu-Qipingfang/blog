/**
 * Copy the generated Pagefind index into the Vercel build output.
 *
 * Why this script exists
 * ----------------------
 * `@astrojs/vercel` snapshots the static site into `.vercel/output/static`
 * inside its own `astro:build:done` hook. That hook runs when `astro build`
 * finishes, i.e. BEFORE our `pagefind --site dist/client` step. Anything
 * pagefind writes afterwards (`dist/client/pagefind/**`) never reaches the
 * deployment, so `/pagefind/pagefind.js` 404s in production even though the
 * index exists locally.
 *
 * The fix: after pagefind runs, mirror `dist/client/pagefind` into whatever
 * directory the adapter produced. We only copy when the target actually looks
 * like the deployed site root (`index.html` present), so a broken/empty
 * adapter output is never promoted into a half-baked deployment.
 *
 * NOTE: `fs.cpSync` is intentionally avoided — it is blocked by the sandbox
 * in this environment (the process exits with 127). We walk the tree manually.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "dist", "client", "pagefind");
const targets = [join(root, ".vercel", "output", "static")];

function isDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function copyTree(from, to) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from)) {
    const s = join(from, entry);
    const d = join(to, entry);
    if (isDir(s)) {
      copyTree(s, d);
    } else {
      copyFileSync(s, d);
    }
  }
}

function countFiles(dir) {
  let n = 0;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    n += isDir(p) ? countFiles(p) : 1;
  }
  return n;
}

if (!isDir(src)) {
  console.log("[pagefind-sync] no index at dist/client/pagefind — skipped");
  process.exit(0);
}

console.log(`[pagefind-sync] index built: ${countFiles(src)} files`);

let copied = 0;
for (const target of targets) {
  // Guard: only touch a target that already holds the built site, otherwise we
  // would ship a deployment whose static root contains nothing but the index.
  if (!existsSync(join(target, "index.html"))) {
    console.log(`[pagefind-sync] ${target} is not a site root — skipped`);
    continue;
  }

  const dest = join(target, "pagefind");
  copyTree(src, dest);
  copied++;
  console.log(
    `[pagefind-sync] copied index -> ${dest} (${countFiles(dest)} files)`
  );
}

if (copied === 0) {
  console.log(
    "[pagefind-sync] note: adapter output not found; relying on dist/client"
  );
}
