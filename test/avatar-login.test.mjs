import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AvatarRelay } from "../dist/relay/avatars.js";

const BASE = Date.UTC(2026, 10, 1, 9, 0, 0);
/** A relay whose clock starts at 09:00 and moves a second per look; its texts are kept; `advance` moves the clock further. */
function relay(o = {}) {
  let offset = 0;
  const texts = [];
  const now = () => { const t = new Date(BASE + offset).toISOString().replace(/\.\d{3}Z$/, "Z"); offset += 1000; return t; };
  const r = new AvatarRelay({ root: mkdtempSync(join(tmpdir(), "gemsbang-relay-")), name: "relay.test", now, texter: (t) => { texts.push(t); }, ...o });
  r.texts = texts;
  r.advance = (ms) => { offset += ms; };
  return r;
}
const ok = (x) => { assert.equal(x.ok, true, x.reason); return x; };
const bad = (x, status, reason) => { assert.equal(x.ok, false); assert.equal(x.status, status, x.reason); if (reason !== undefined) assert.equal(x.reason, reason); return x; };
const codeIn = (t) => /(\d{6})/.exec(t.text)[1];
/** Every file under the root, as text. */
function allText(dir) {
  let out = "";
  for (const n of readdirSync(dir)) { const p = join(dir, n); out += statSync(p).isDirectory() ? allText(p) : readFileSync(p, "utf8"); }
  return out;
}

test("login (spec §6.2): a code texted to the number, six digits, ten minutes, once; the wrong one, a short one, another number's; three to a number in ten minutes, ten to a network in an hour; the first login is a new person; the code is texted in the language asked in; a refusal carries its code; the number is kept only as a salted hash", () => {
  const r = relay();
  assert.equal(bad(r.startLogin({ phone: "hello" }), 400, "请填写手机号").code, "phone.required");
  const started = ok(r.startLogin({ phone: "138 0013 8000" }, "10.0.0.1"));
  assert.deepEqual([started.known, started.tail], [false, "8000"]);
  assert.equal(r.texts[0].to, "+8613800138000");
  assert.match(r.texts[0].text, /^GemsBang 验证码 \d{6}，10 分钟内有效。/);
  const code = codeIn(r.texts[0]);
  assert.equal(bad(r.finishLogin({ phone: "13800138000", code: "12" }), 400, "验证码为 6 位数字").code, "code.short");
  bad(r.finishLogin({ phone: "13800138000", code: code === "000000" ? "000001" : "000000" }), 401, "验证码错误或已过期");
  bad(r.finishLogin({ phone: "13900139000", code }), 401, "验证码错误或已过期");
  const done = ok(r.finishLogin({ phone: "+86 138-0013-8000", code }));
  assert.match(done.person, /^p-[0-9a-f]{10}$/);
  assert.equal(done.new, true);
  assert.deepEqual([r.verify(done.token).speaker, r.verify(done.token).scope], [`person:${done.person}`, "person"]);
  bad(r.finishLogin({ phone: "13800138000", code }), 401, "验证码错误或已过期");
  ok(r.startLogin({ phone: "13800138000" }));
  assert.equal(r.startLogin({ phone: "13800138000" }).ok, true);
  bad(r.startLogin({ phone: "13800138000" }), 429, "验证码发送过于频繁，请 10 分钟后再试");
  r.advance(10 * 60_000);
  const again = ok(r.startLogin({ phone: "13800138000" }));
  assert.equal(again.known, true);
  const second = ok(r.finishLogin({ phone: "13800138000", code: codeIn(r.texts[r.texts.length - 1]) }));
  assert.deepEqual([second.person, second.new], [done.person, false]);
  ok(r.startLogin({ phone: "13700137000" }));
  const stale = codeIn(r.texts[r.texts.length - 1]);
  r.advance(10 * 60_000);
  bad(r.finishLogin({ phone: "13700137000", code: stale }), 401, "验证码错误或已过期");
  const net = relay();
  for (let i = 0; i < 10; i++) ok(net.startLogin({ phone: `+1415555${String(1000 + i)}` }, "10.9.9.9"));
  bad(net.startLogin({ phone: "+14155552000" }, "10.9.9.9"), 429);
  ok(net.startLogin({ phone: "+14155552000" }, "10.9.9.8"));
  ok(r.startLogin({ phone: "+14155550100", lang: "en" }));
  assert.match(r.texts[r.texts.length - 1].text, /^GemsBang code \d{6}, valid for 10 minutes\./);
  const disk = allText(r.root);
  assert.ok(!disk.includes("13800138000") && !disk.includes("8613700137000"), "no number on disk in the clear");
});

test("the beta before mail (2026-11-04): an email the operator listed gets its code in the answer and no mail, as a way in or one more; it still counts toward the three in ten minutes; any other email is mailed as before", () => {
  const mail = [];
  const r = relay({ mailer: (m) => { mail.push(m); }, showCodeTo: [" John@Example.com ", "not an email"] });
  const shown = ok(r.startLogin({ email: "john@example.com" }));
  assert.match(shown.code, /^\d{6}$/);
  assert.equal(mail.length, 0, "no mail for it");
  const john = ok(r.finishLogin({ email: "JOHN@example.com", code: shown.code }));
  assert.equal(ok(r.startLogin({ email: "lily@example.com" })).code, undefined, "another email: mailed, no code in the answer");
  assert.deepEqual(mail.map((m) => m.to), ["lily@example.com"]);
  const more = relay({ mailer: () => undefined, showCodeTo: ["john@example.com", "john@work.example"] });
  const person = ok(more.finishLogin({ email: "john@example.com", code: ok(more.startLogin({ email: "john@example.com" })).code }));
  assert.match(ok(more.startMethod(more.verify(person.token), { email: "john@work.example" })).code, /^\d{6}$/, "one more way in, its code given back too");
  ok(r.startLogin({ email: "john@example.com" }));
  ok(r.startLogin({ email: "john@example.com" }));
  bad(r.startLogin({ email: "john@example.com" }), 429);
  assert.ok(john.token !== undefined);
});

test("a relay given no texter writes the code to a file under its own folder", () => {
  const r = new AvatarRelay({ root: mkdtempSync(join(tmpdir(), "gemsbang-relay-")), name: "relay.test" });
  ok(r.startLogin({ phone: "13800138000" }));
  const files = readdirSync(join(r.root, "_relay", "texts"));
  assert.equal(files.length, 1);
  assert.match(readFileSync(join(r.root, "_relay", "texts", files[0]), "utf8"), /^To: \+8613800138000\n\nGemsBang 验证码 \d{6}，10 分钟内有效。/);
});
