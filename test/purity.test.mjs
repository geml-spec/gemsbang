import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const sources = (dir) =>
  readdirSync(dir, { recursive: true })
    .filter((n) => n.endsWith(".ts"))
    .map((n) => [n, readFileSync(new URL(n, dir), "utf8")]);

test("src/core/** imports no fs/process/child_process and never touches process or console", () => {
  const found = sources(new URL("../src/core/", import.meta.url));
  assert.ok(found.length > 0, "src/core has files to check");
  for (const [f, src] of found) {
    assert.doesNotMatch(src, /from "node:(fs|process|child_process)"/, `${f} imports a host module`);
    assert.doesNotMatch(src, /\bprocess\.|\bconsole\./, `${f} touches process or console`);
  }
});
