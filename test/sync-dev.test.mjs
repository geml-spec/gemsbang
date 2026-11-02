import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { syncDev } from "../scripts/sync-dev.mjs";

const made = [];
const tmp = (name) => { const d = mkdtempSync(join(tmpdir(), `gemsbang-sync-${name}-`)); made.push(d); return d; };
const put = (root, rel, text = rel) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text); };
const MANIFEST = JSON.stringify({ name: "gemsbang", version: "0.5.13" });

test("the sync copies the checkout and removes what it no longer has; the engine's types, the copy's dependencies and what is not the plugin stay out of it", (t) => {
  t.after(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });
  const from = tmp("from");
  put(from, ".claude-plugin/plugin.json", MANIFEST);
  put(from, "hooks/register.tsx", "new");
  put(from, "dist/a.js");
  put(from, "node_modules/x/index.js");
  put(from, ".geml/w.geml");
  put(from, "gemsbang-0.5.13.tgz");
  const to = tmp("to");
  put(to, ".claude-plugin/plugin.json", MANIFEST);
  put(to, ".claude-plugin/types/engine.d.ts");
  put(to, "hooks/register.tsx", "old");
  put(to, "dist/old.js");
  put(to, "coach/coach.geml");
  put(to, "src/old.ts");
  put(to, "node_modules/kept/index.js");

  const { removed } = syncDev(from, to);

  assert.deepEqual(removed, ["coach", "dist/old.js", "src"]);
  assert.equal(readFileSync(join(to, "hooks/register.tsx"), "utf8"), "new");
  assert.ok(existsSync(join(to, "dist/a.js")));
  assert.ok(existsSync(join(to, ".claude-plugin/types/engine.d.ts")), "the engine's declarations stay");
  assert.ok(existsSync(join(to, "node_modules/kept/index.js")), "the copy's own dependencies stay");
  for (const rel of ["node_modules/x", ".geml", "gemsbang-0.5.13.tgz", "coach", "src", "dist/old.js"]) assert.ok(!existsSync(join(to, rel)), rel);
});

test("the sync removes nothing from a folder that is not a copy of this plugin, nor syncs into the checkout itself; a new or empty folder is filled", (t) => {
  t.after(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });
  const from = tmp("from");
  put(from, ".claude-plugin/plugin.json", MANIFEST);
  put(from, "hooks/register.tsx");
  const other = tmp("other");
  put(other, "notes.txt");
  assert.throws(() => syncDev(from, other), /not a copy of the gemsbang plugin/);
  assert.ok(existsSync(join(other, "notes.txt")), "nothing removed");
  assert.ok(!existsSync(join(other, "hooks")), "nothing copied either");
  assert.throws(() => syncDev(from, from), /inside this checkout/);
  assert.throws(() => syncDev(from, join(from, "hooks")), /inside this checkout/);
  const fresh = join(tmp("fresh"), "gemsbang");
  assert.deepEqual(syncDev(from, fresh).removed, []);
  assert.ok(existsSync(join(fresh, "hooks/register.tsx")));
});
