// Bump the version everywhere it is named: package.json, the lockfile's head (twice), and the plugin manifest. The
// pane's header shows the plugin's version, and the plugin-files test fails when any of these disagree.
// Usage: node scripts/bump.mjs <version>   (e.g. 0.5.13)
import { readFileSync, writeFileSync } from "node:fs";

const to = process.argv[2] ?? "";
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/.test(to)) throw new Error("usage: node scripts/bump.mjs <version>");
const from = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
if (from === to) throw new Error(`already ${to}`);

// The first `n` occurrences only: a dependency in the lockfile may share the number further down.
function edit(rel, n) {
  const file = new URL(`../${rel}`, import.meta.url);
  const a = `"version": "${from}"`;
  const parts = readFileSync(file, "utf8").split(a);
  if (parts.length - 1 < n) throw new Error(`${rel}: expected ${n} of ${a}, found ${parts.length - 1}`);
  writeFileSync(file, parts.slice(0, n + 1).join(`"version": "${to}"`) + (parts.length > n + 1 ? a + parts.slice(n + 1).join(a) : ""));
}
edit("package.json", 1);
edit("package-lock.json", 2);
edit(".claude-plugin/plugin.json", 1);
console.log(`${from} -> ${to}`);
