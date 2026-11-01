import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_RULES, withRules } from "../dist/core/avatar/rules.js";

test("rules (spec §8.1): marking on and read, edit, test by default; a change names only what it changes; anything else is refused", () => {
  assert.deepEqual(DEFAULT_RULES, { mark: true, borrow: ["read", "edit", "test"] });
  assert.deepEqual(withRules(DEFAULT_RULES, { mark: false }), { mark: false, borrow: ["read", "edit", "test"] });
  assert.deepEqual(withRules(DEFAULT_RULES, { borrow: ["test", "read", "push"] }), { mark: true, borrow: ["read", "test", "push"] });
  assert.deepEqual(withRules(DEFAULT_RULES, { mark: "no" }), { code: "rules.mark" });
  assert.deepEqual(withRules(DEFAULT_RULES, { borrow: ["delete"] }), { code: "rules.borrow", params: { allowed: "read, edit, test, push, secrets" } });
  assert.deepEqual(withRules(DEFAULT_RULES, { alone: "all" }), { code: "rules.unknown", params: { key: "alone" } });
  assert.deepEqual(withRules(DEFAULT_RULES, []), { code: "rules.notObject" });
});
