import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
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
/** A person logged in by the number: their token's record and their id. */
function login(r, phone) {
  ok(r.startLogin({ phone }));
  const done = ok(r.finishLogin({ phone, code: codeIn(r.texts[r.texts.length - 1]) }));
  return { by: r.verify(done.token), person: done.person, token: done.token };
}

test("avatars (spec §6.4, §6.5): one grows with the name given, else a random one in the person's language (the one they logged in with, or chose), never the default name unasked; a rename changes that card alone; only the person does either; a new person has none", () => {
  const r = relay({ rand: () => 0 });
  const john = login(r, "13800138000");
  assert.deepEqual(r.avatarsOf(john.person), [], "a new person has no avatar yet");
  const first = ok(r.growAvatar(john.by, {})).avatar;
  assert.match(first.id, /^a-[0-9a-f]{10}$/);
  assert.equal(first.name, "云朵 10");
  ok(r.setDefaultName(john.by, { name: " John " }));
  assert.equal(r.defaultNameOf(john.person), "John");
  const work = ok(r.growAvatar(john.by, {})).avatar;
  assert.equal(work.name, "云朵 10", "the default name is a suggestion, never used unasked");
  ok(r.rename(john.by, work.id, { name: "John" }));
  const lily = ok(r.growAvatar(john.by, { name: "Lily 爸爸" })).avatar;
  assert.equal(bad(r.growAvatar(john.by, { name: "" }), 400, "名字不能是空的").code, "name.empty");
  assert.deepEqual(bad(r.growAvatar(john.by, { name: "长".repeat(25) }), 400, "名字最多 24 个字").params, { max: 24 });
  ok(r.setDefaultName(john.by, { name: null }));
  assert.equal(r.defaultNameOf(john.person), undefined);
  assert.deepEqual(r.avatarsOf(john.person).map((a) => a.name), ["云朵 10", "John", "Lily 爸爸"]);
  ok(r.startLogin({ phone: "+14155550100", lang: "en" }));
  const en = ok(r.finishLogin({ phone: "+14155550100", code: codeIn(r.texts[r.texts.length - 1]), lang: "en" }));
  assert.equal(r.languageOf(en.person), "en", "a person keeps the language they logged in with");
  assert.equal(r.languageOf(john.person), "zh");
  ok(r.setLanguage(john.by, { lang: "en" }));
  assert.equal(ok(r.growAvatar(john.by, {})).avatar.name, "Cloud 10", "a random name in the person's language");
  assert.equal(bad(r.setLanguage(john.by, { lang: "fr" }), 400, "不支持这种语言").code, "lang.unknown");
  ok(r.rename(john.by, first.id, { name: "陈太太" }));
  assert.deepEqual(r.avatarsOf(john.person).map((a) => a.name), ["陈太太", "John", "Lily 爸爸", "Cloud 10"]);
  const zhang = login(r, "13900139000");
  bad(r.rename(zhang.by, first.id, { name: "x" }), 403, "这不是你的身份");
  const lilyToken = r.verify(ok(r.issueAvatar(john.by, lily.id)).token);
  bad(r.growAvatar(lilyToken, {}), 403, "只有本人能这么做");
  bad(r.rename(lilyToken, lily.id, { name: "x" }), 403);
});

test("tokens: an avatar's token is issued by its person and speaks as the avatar, by an agent; a device's token cannot grow an avatar or issue another device; another person cannot issue one for an avatar not theirs", () => {
  const r = relay();
  const john = login(r, "13800138000");
  const zhang = login(r, "13900139000");
  const a = ok(r.growAvatar(john.by, { name: "John" })).avatar;
  const issued = ok(r.issueAvatar(john.by, a.id));
  assert.deepEqual([issued.record.speaker, issued.record.scope], [`avatar:${a.id}`, "avatar"]);
  bad(r.issueAvatar(zhang.by, a.id), 403, "这不是你的身份");
  const device = ok(r.issueDevice(john.by));
  assert.deepEqual([device.record.speaker, device.record.scope], [`person:${john.person}`, "device"]);
  bad(r.issueDevice(device.record), 403);
  bad(r.growAvatar(device.record, {}), 403);
});
