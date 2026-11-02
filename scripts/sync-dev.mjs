// Copy this checkout into a folder Claude Code loads the plugin from while it is being developed (one named in
// CLAUDE_CODE_PLUGIN_DIRS, watched with CLAUDE_CODE_PLUGIN_DIR_WATCH=1: every session reloads it on the next call).
// Everything but what is not the plugin: dependencies, git, the project's own .geml/, coverage and packs. dist/ is
// replaced whole, so a module the build no longer makes is not left behind; the engine's .claude-plugin/types/ stays.
// Build and pass the gates first.
// Usage: node scripts/sync-dev.mjs <folder>
import { cpSync, existsSync, rmSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const FROM = fileURLToPath(new URL("..", import.meta.url));
const to = process.argv[2];
if (to === undefined || to === "") throw new Error("usage: node scripts/sync-dev.mjs <folder>");
const TO = resolve(to);
const within = relative(FROM, TO);
if (within === "" || (!within.startsWith("..") && !isAbsolute(within))) throw new Error(`${TO} is inside this checkout`);
const LEFT = new Set(["node_modules", ".git", ".geml", "coverage", ".nyc_output", ".pack"]);

if (existsSync(resolve(TO, "dist"))) rmSync(resolve(TO, "dist"), { recursive: true });
cpSync(FROM, TO, { recursive: true, filter: (src) => !LEFT.has(relative(FROM, src).split(sep)[0]) && !src.endsWith(".tgz") });
console.log(`synced ${TO}`);
