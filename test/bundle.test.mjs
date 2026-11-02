import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const BUNDLE = fileURLToPath(new URL("../dist/gemsbang.mjs", import.meta.url));

test("the bundle is one file that runs with no node_modules beside it", () => {
  const dir = mkdtempSync(join(tmpdir(), "gemsbang-bundle-"));
  copyFileSync(BUNDLE, join(dir, "gemsbang.mjs"));
  const usage = spawnSync(process.execPath, [join(dir, "gemsbang.mjs")], { cwd: dir, encoding: "utf8" });
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /^usage: gemsbang /);
  const hook = spawnSync(process.execPath, [join(dir, "gemsbang.mjs"), "hook"], { cwd: dir, encoding: "utf8", input: '{"v":2,"call":"status"}\n' });
  assert.equal(hook.status, 0, hook.stderr);
  assert.deepEqual(JSON.parse(hook.stdout), { v: 1, ok: false, error: "protocol version 2; this CLI speaks 1" });
});

test("the bundle imports only Node's built-ins and carries no parser CLI hand-off", () => {
  const src = readFileSync(BUNDLE, "utf8");
  const specs = [...src.matchAll(/^import\s[^;]*?from\s*"([^"]+)";?$/gm)].map((m) => m[1]);
  assert.ok(specs.length > 0);
  for (const s of specs) assert.match(s, /^node:/, s);
  assert.doesNotMatch(src, /if \(isCliInvocation\(\)\) \{/);
});
