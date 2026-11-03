// Copy this checkout into a folder Claude Code loads the plugin from while it is being developed (one named in
// CLAUDE_CODE_PLUGIN_DIRS, watched with CLAUDE_CODE_PLUGIN_DIR_WATCH=1: every session reloads it on the next call).
// Everything but what is not the plugin: dependencies, git, the project's own .geml/, coverage, packs and the preview. What the
// checkout no longer has is removed from the copy, so a file deleted here does not live on there; the engine's
// .claude-plugin/types/ and the copy's own dependencies stay. Only a folder that is new, empty or already a copy of
// this plugin is synced: anything else might be someone's files. Build and pass the gates first.
// Usage: node scripts/sync-dev.mjs <folder>
import { cpSync, existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const LEFT = new Set(["node_modules", ".git", ".geml", "coverage", ".nyc_output", ".pack", "preview"]);
const ENGINE_TYPES = ".claude-plugin/types";

/** Whether a path, relative to the checkout and `/`-separated, belongs in the copy. */
const kept = (rel) => !LEFT.has(rel.split("/")[0]) && !rel.endsWith(".tgz");

/** Whether `dir` may be synced into: not there yet, empty, or a copy of the gemsbang plugin. */
function isCopy(dir) {
  if (!existsSync(dir) || readdirSync(dir).length === 0) return true;
  try { return JSON.parse(readFileSync(join(dir, ".claude-plugin", "plugin.json"), "utf8")).name === "gemsbang"; } catch { return false; }
}

/** Remove what is under `to` and not in `from` (names compared exactly, so a renamed case goes too); the paths removed, sorted. */
function prune(from, to, rel = "") {
  const removed = [];
  const here = new Set(existsSync(join(from, rel)) ? readdirSync(join(from, rel)) : []);
  for (const ent of readdirSync(join(to, rel), { withFileTypes: true })) {
    const path = rel === "" ? ent.name : `${rel}/${ent.name}`;
    if (rel === "" && LEFT.has(ent.name)) continue;
    if (path === ENGINE_TYPES) continue;
    if (!here.has(ent.name) || !kept(path)) {
      rmSync(join(to, path), { recursive: true, force: true });
      removed.push(path);
    } else if (ent.isDirectory()) removed.push(...prune(from, to, path));
  }
  return removed.sort();
}

/** Sync the checkout at `from` into `to`; returns the paths removed from `to`. */
export function syncDev(from, to) {
  const FROM = resolve(from), TO = resolve(to);
  const within = relative(FROM, TO);
  if (within === "" || (!within.startsWith("..") && !isAbsolute(within))) throw new Error(`${TO} is inside this checkout`);
  if (!isCopy(TO)) throw new Error(`${TO} is not a copy of the gemsbang plugin: nothing synced`);
  cpSync(FROM, TO, { recursive: true, filter: (src) => { const rel = relative(FROM, src).split(sep).join("/"); return rel === "" || kept(rel); } });
  return { removed: prune(FROM, TO) };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const to = process.argv[2];
  if (to === undefined || to === "") throw new Error("usage: node scripts/sync-dev.mjs <folder>");
  const { removed } = syncDev(fileURLToPath(new URL("..", import.meta.url)), to);
  console.log(`synced ${resolve(to)}${removed.length > 0 ? ` · removed ${removed.length}: ${removed.join(", ")}` : ""}`);
}
