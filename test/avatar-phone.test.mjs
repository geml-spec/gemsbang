import { test } from "node:test";
import assert from "node:assert/strict";
import { codeText, hashPhone, normalizePhone, phoneFault, tailOf } from "../dist/core/avatar/phone.js";

test("phone (spec §6.2): a mainland number gets +86, an international one keeps its +, separators drop; the hash needs the salt and never shows the digits; the code's text speaks the language asked in", () => {
  assert.equal(normalizePhone("138 0013 8000"), "+8613800138000");
  assert.equal(normalizePhone("+1 (415) 555-0100"), "+14155550100");
  for (const bad of ["12345", "0800-123", "abc", 13800138000]) assert.equal(normalizePhone(bad), undefined, String(bad));
  assert.deepEqual(phoneFault("hello"), { code: "phone.required" });
  assert.equal(phoneFault("13800138000"), undefined);
  const h = hashPhone("+8613800138000", "salt-a");
  assert.match(h, /^sha256:[0-9a-f]{64}$/);
  assert.equal(h, hashPhone("+8613800138000", "salt-a"));
  assert.notEqual(h, hashPhone("+8613800138000", "salt-b"));
  assert.ok(!h.includes("13800138000"));
  assert.equal(tailOf("+8613800138000"), "8000");
  assert.equal(codeText("123456"), "GemsBang 验证码 123456，10 分钟内有效。如非本人操作，请忽略。");
  assert.match(codeText("123456", "ja"), /^GemsBang 認証コード 123456/);
});
