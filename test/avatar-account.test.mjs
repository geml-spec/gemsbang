import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AvatarRelay } from "../dist/relay/avatars.js";

const BASE = Date.UTC(2026, 10, 2, 9, 0, 0);
/** A relay whose clock moves a second per look; its mail and texts kept. */
function relay() {
  let offset = 0;
  const mail = [], texts = [];
  const now = () => { const t = new Date(BASE + offset).toISOString().replace(/\.\d{3}Z$/, "Z"); offset += 1000; return t; };
  const r = new AvatarRelay({ root: mkdtempSync(join(tmpdir(), "gemsbang-account-")), name: "relay.test", mailFrom: "gemsbang.com", now, mailer: (m) => { mail.push(m); }, texter: (t) => { texts.push(t); } });
  return Object.assign(r, { mail, texts });
}
const ok = (x) => { assert.equal(x.ok, true, x.reason); return x; };
const bad = (x, status, code) => { assert.equal(x.ok, false); assert.equal(x.status, status, x.reason); if (code !== undefined) assert.equal(x.code, code); return x; };
const codeIn = (m) => /(\d{6})/.exec(m.text)[1];
/** Signed in by email from a device: the token's record and the answer. */
function signIn(r, email, device) {
  ok(r.startLogin({ email }));
  const done = ok(r.finishLogin({ email, code: codeIn(r.mail[r.mail.length - 1]), ...(device !== undefined ? { device } : {}) }));
  return { ...done, by: r.verify(done.token) };
}

test("sign in by email (architecture §3.2): the code mailed in the language asked in, where it went shown masked and who it comes from; the address in any case is one person; a bad address refused", () => {
  const r = relay();
  bad(r.startLogin({ email: "john" }), 400, "email.bad");
  bad(r.startLogin({}), 400, "address.required");
  const started = ok(r.startLogin({ email: " John@Example.com ", lang: "en" }));
  assert.deepEqual([started.known, started.to, started.from, started.tail], [false, "j***@example.com", "gemsbang.com", undefined]);
  assert.deepEqual([r.mail[0].to, r.mail[0].subject.startsWith("Gemsbang code "), r.texts.length], ["john@example.com", true, 0]);
  const first = ok(r.finishLogin({ email: "john@example.com", code: codeIn(r.mail[0]), lang: "en" }));
  assert.equal(first.new, true);
  assert.equal(r.languageOf(first.person), "en");
  const again = signIn(r, "JOHN@example.com");
  assert.deepEqual([again.person, again.new], [first.person, false]);
  assert.deepEqual(r.methodsOf(first.person).map((m) => [m.kind, m.shown]), [["email", "j***@example.com"]]);
});

test("ways in (architecture §3.1): one more added with a code, the same person by either; another's address refused before any code; the last one stays; one taken off is no way in any more", () => {
  const r = relay();
  const john = signIn(r, "john@example.com");
  const lily = signIn(r, "lily@example.com");
  const sent = ok(r.startMethod(john.by, { phone: "13800138000" }));
  assert.deepEqual([sent.to, r.texts[0].to], ["•••• 8000", "+8613800138000"]);
  bad(r.addMethod(john.by, { phone: "13800138000", code: "12" }), 400, "code.short");
  const added = ok(r.addMethod(john.by, { phone: "13800138000", code: codeIn(r.texts[0]) }));
  assert.deepEqual(added.methods.map((m) => [m.kind, m.shown]), [["email", "j***@example.com"], ["phone", "•••• 8000"]]);
  ok(r.startLogin({ phone: "13800138000" }));
  assert.equal(ok(r.finishLogin({ phone: "13800138000", code: codeIn(r.texts[1]) })).person, john.person);
  const mails = r.mail.length;
  bad(r.startMethod(john.by, { email: "lily@example.com" }), 409, "login.taken");
  assert.equal(r.mail.length, mails, "no code goes to someone else's address");
  bad(r.removeMethod(lily.by, r.methodsOf(lily.person)[0].id), 409, "login.last");
  bad(r.removeMethod(lily.by, added.methods[1].id), 404, "login.missing");
  const left = ok(r.removeMethod(john.by, added.methods[0].id));
  assert.deepEqual(left.methods.map((m) => m.kind), ["phone"]);
  const fresh = signIn(r, "john@example.com");
  assert.deepEqual([fresh.new, fresh.person === john.person], [true, false], "the email taken off now makes a new person");
  bad(r.startMethod({ ...john.by, scope: "avatar" }, { email: "x@example.com" }), 403, "person.only");
});

test("devices (architecture §3.1): each sign-in with the name it gave and the avatars its agents play, the one asking first; signing one out takes its avatars' tokens with it; all others; this one", () => {
  const r = relay();
  const mac = signIn(r, "john@example.com", "这台 Mac · Claude Code\u0007");
  const web = signIn(r, "john@example.com", "网页 · Safari");
  const other = signIn(r, "john@example.com", "x".repeat(80));
  const john = ok(r.growAvatar(mac.by, { name: "John" })).avatar;
  const lily = ok(r.growAvatar(mac.by, { name: "Lily 爸爸" })).avatar;
  const johnToken = ok(r.issueAvatar(mac.by, john.id)).token;
  ok(r.issueAvatar(mac.by, lily.id));
  const device = ok(r.issueDevice(other.by)).token;
  const deep = ok(r.issueAvatar(other.by, john.id)).token;
  const list = ok(r.devicesOf(mac.by)).devices;
  assert.deepEqual(list.map((d) => [d.name, d.current, d.avatars.map((a) => a.name)]), [["这台 Mac · Claude Code", true, ["John", "Lily 爸爸"]], ["x".repeat(60), false, ["John"]], ["网页 · Safari", false, []]]);
  bad(r.revokeDevice(mac.by, "token-nope"), 404, "device.missing");
  assert.equal(ok(r.revokeDevice(mac.by, other.by.id)).revoked, 3, "the sign-in, the device token and the avatar's token under it");
  assert.deepEqual([r.verify(other.token), r.verify(device), r.verify(deep)], [undefined, undefined, undefined]);
  assert.equal(ok(r.revokeOthers(mac.by)).revoked, 1);
  assert.equal(r.verify(web.token), undefined);
  assert.deepEqual(ok(r.devicesOf(mac.by)).devices.map((d) => d.name), ["这台 Mac · Claude Code"]);
  assert.equal(ok(r.logout(mac.by)).revoked, 3);
  assert.deepEqual([r.verify(mac.token), r.verify(johnToken)], [undefined, undefined]);
});

test("an agent in by a link for a person with no account here (spec §6.3, architecture §3.2): the email and the code the person typed into the plugin's own box; the machine named as a device, the avatar it plays listed under it", () => {
  const r = relay();
  const john = signIn(r, "john@example.com");
  const a = ok(r.firstAvatar(john.by, { name: "John" })).avatar;
  const g = ok(r.createGroup(john.by, { as: a.id, name: "三年二班家长" })).venue;
  const code = ok(r.linkFor(john.by, g.owner, g.id, { as: a.id })).link.code;
  ok(r.startLogin({ email: "lily@example.com" }));
  const joined = ok(r.joinWithCode(code, { email: "lily@example.com", code: codeIn(r.mail[r.mail.length - 1]), name: "Lily 爸爸", device: "Mac · Claude Code" }));
  assert.deepEqual([joined.avatar.name, typeof joined.token, typeof joined.device], ["Lily 爸爸", "string", "string"]);
  ok(r.startLogin({ email: "lily@example.com" }));
  const lily = ok(r.finishLogin({ email: "lily@example.com", code: codeIn(r.mail[r.mail.length - 1]) }));
  assert.deepEqual(ok(r.devicesOf(r.verify(lily.token))).devices.map((d) => [d.name, d.avatars.map((x) => x.name)]), [["", []], ["Mac · Claude Code", ["Lily 爸爸"]]]);
});
