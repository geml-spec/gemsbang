import { test } from "node:test";
import assert from "node:assert/strict";
import { addressFault, addressOf, codeMail, hashAddress, keyOf, maskAddress, normalizeEmail } from "../dist/core/avatar/address.js";
import { hashPhone } from "../dist/core/avatar/phone.js";

test("an email as a way in (architecture §3.2): trimmed and in lower case; one @, a dot in the domain, no spaces, at most 254 characters", () => {
  assert.equal(normalizeEmail("  John.Doe@Example.COM "), "john.doe@example.com");
  for (const bad of ["john", "john@", "@example.com", "john@example", "jo hn@example.com", "john@@example.com", "john@example..com", 42, undefined, `${"a".repeat(250)}@x.co`]) assert.equal(normalizeEmail(bad), undefined, String(bad));
});

test("the address a body gives: its email first, else its phone; what is wrong with it otherwise", () => {
  assert.deepEqual(addressOf({ email: "J@x.com", phone: "13800138000" }), { kind: "email", value: "j@x.com" });
  assert.deepEqual(addressOf({ phone: "138 0013 8000" }), { kind: "phone", value: "+8613800138000" });
  assert.equal(addressOf({ email: "nope", phone: "13800138000" }), undefined, "a bad email is not a phone's way in");
  assert.deepEqual([addressFault({ email: "nope" }), addressFault({ phone: "1" }), addressFault({}), addressFault({ email: "a@b.co" })], [{ code: "email.bad" }, { code: "phone.required" }, { code: "address.required" }, undefined]);
});

test("kept as a salted hash, its key in the login index by kind; a number's hash is the one it always was; shown masked", () => {
  const e = { kind: "email", value: "john@example.com" }, p = { kind: "phone", value: "+8613800138000" };
  assert.equal(hashAddress(p, "salt"), hashPhone("+8613800138000", "salt"));
  assert.notEqual(hashAddress(e, "salt"), hashAddress(e, "pepper"));
  assert.match(hashAddress(e, "salt"), /^sha256:[0-9a-f]{64}$/);
  assert.match(keyOf("email", hashAddress(e, "salt")), /^email-[0-9a-f]{24}$/);
  assert.deepEqual([maskAddress(e), maskAddress(p)], ["j***@example.com", "•••• 8000"]);
});

test("the mail that carries a code says it in the person's language", () => {
  assert.deepEqual(codeMail("123456", "zh"), { subject: "Gemsbang 验证码 123456", text: "Gemsbang 验证码 123456，10 分钟内有效。不是你在登录的话，不用管。" });
  assert.match(codeMail("654321", "en").subject, /654321/);
});
