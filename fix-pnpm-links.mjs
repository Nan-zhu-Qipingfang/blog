/**
 * One-off repair: pnpm linking partially failed on Windows in this session,
 * leaving new store entries without dependency junctions. This script walks
 * the dependency graph of the affected entries and creates missing junctions.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const STORE = path.join(ROOT, "node_modules", ".pnpm");

// ---- parse store entry dir names: name@version[_peerhash...] ----
function parseEntry(dir) {
  const parts = dir.split("@");
  let name, version;
  if (dir.startsWith("@")) {
    name = "@" + parts[1].replace(/\+/g, "/");
    version = (parts[2] || "").split("_")[0];
  } else {
    name = parts[0];
    version = (parts[1] || "").split("_")[0];
  }
  return { name, version, dir };
}

// ---- minimal semver satisfies for ^, ~, exact ----
const cmp = (a, b) => {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1;
  }
  return 0;
};
function satisfies(version, spec) {
  if (spec === "*" || spec === "latest") return true;
  const m = spec.match(/^[\^~]?(\d+\.\d+\.\d+)/);
  if (!m) return false;
  const c = cmp(version, m[1]);
  if (spec.startsWith("^")) return c >= 0 && version.split(".")[0] === m[1].split(".")[0];
  if (spec.startsWith("~")) {
    return (
      c >= 0 &&
      version.split(".")[0] === m[1].split(".")[0] &&
      version.split(".")[1] === m[1].split(".")[1]
    );
  }
  return c === 0;
}

// ---- index all store entries by name ----
const byName = new Map();
for (const dir of fs.readdirSync(STORE)) {
  if (!dir.includes("@")) continue;
  const info = parseEntry(dir);
  if (!info.name || !info.version || !/^\d/.test(info.version)) continue;
  const pkgDir = path.join(STORE, dir, "node_modules", info.name);
  if (!fs.existsSync(path.join(pkgDir, "package.json"))) continue;
  if (!byName.has(info.name)) byName.set(info.name, []);
  byName.get(info.name).push({ ...info, pkgDir, nm: path.join(STORE, dir, "node_modules") });
}
const pick = (name, spec) => {
  const candidates = (byName.get(name) || []).filter(e => satisfies(e.version, spec));
  candidates.sort((a, b) => cmp(b.version, a.version));
  return candidates[0] || null;
};

const created = [];
const visited = new Set();

function ensureDeps(entry) {
  const key = entry.dir;
  if (visited.has(key)) return;
  visited.add(key);
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(entry.pkgDir, "package.json"), "utf-8"));
  } catch {
    return;
  }
  const deps = { ...(pkg.dependencies || {}) };
  for (const [name, spec] of Object.entries(deps)) {
    const target = pick(name, spec);
    if (!target) {
      console.warn(`  !! no store entry for ${name}@${spec} (needed by ${entry.name})`);
      continue;
    }
    const linkPath = path.join(entry.nm, name);
    if (!fs.existsSync(linkPath)) {
      fs.mkdirSync(path.dirname(linkPath), { recursive: true });
      fs.symlinkSync(target.pkgDir, linkPath, "junction");
      created.push(path.relative(ROOT, linkPath));
    }
    ensureDeps(target);
  }
}

// ---- roots: recently added packages ----
const roots = [
  pick("@astrojs/node", "10.1.4"),
  pick("gray-matter", "*"),
  pick("marked", "*"),
];
for (const root of roots) {
  if (!root) continue;
  console.log(`checking ${root.name}@${root.version}`);
  ensureDeps(root);
}

// ---- top-level junctions for the new direct deps ----
const topLevel = [
  ["@astrojs/node", "10.1.4"],
  ["gray-matter", "*"],
  ["marked", "*"],
];
for (const [name, spec] of topLevel) {
  const target = pick(name, spec);
  const linkPath = path.join(ROOT, "node_modules", name);
  if (target && !fs.existsSync(linkPath)) {
    fs.mkdirSync(path.dirname(linkPath), { recursive: true });
    fs.symlinkSync(target.pkgDir, linkPath, "junction");
    created.push(path.relative(ROOT, linkPath));
  }
}

console.log(created.length ? `created ${created.length} junctions:\n${created.join("\n")}` : "nothing to create");
