import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AvatarRelay } from "../dist/relay/avatars.js";
import { readDoc } from "../dist/relay/store.js";

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

function group() {
  const r = relay();
  const john = login(r, "13800138000");
  const johnA = ok(r.growAvatar(john.by, { name: "John" })).avatar;
  const g = ok(r.createGroup(john.by, { as: johnA.id, name: "三年二班家长" })).venue;
  const code = ok(r.linkFor(john.by, g.owner, g.id, { as: johnA.id })).link.code;
  return { r, john, johnA, g, code };
}

test("joining from a link with a person's token (spec §6.2, §6.4, §6.5): a first avatar grows with the name given; skipped, a random one in the person's language; the next group, the avatar the inviter knows; one already in is answered as it is; another's avatar is refused; a stopped link lets nobody in; the link's uses are counted", () => {
  const { r, john, johnA, g, code } = group();
  const mei = login(r, "13900139000");
  const joined = ok(r.joinByLink(mei.by, code, { name: "乐乐 妈妈" }));
  assert.deepEqual([joined.avatar.name, joined.already, joined.pending, joined.token], ["乐乐 妈妈", false, undefined, undefined]);
  assert.deepEqual(joined.venue.members.map((m) => m.name), ["John", "乐乐 妈妈"]);
  assert.deepEqual(r.venuesOf(mei.person).map((v) => [v.id, v.as]), [[g.id, joined.avatar.id]]);
  const again = ok(r.joinByLink(mei.by, code, { name: "别的名字" }));
  assert.deepEqual([again.avatar.id, again.already], [joined.avatar.id, true], "already in: that avatar, nothing new");
  const zhou = login(r, "13700137000");
  ok(r.setLanguage(zhou.by, { lang: "en" }));
  const random = ok(r.joinByLink(zhou.by, code, { new: true })).avatar.name;
  assert.match(random, /^[A-Z][a-z]+ \d{2}$/, "skipped: a random English name");
  const second = ok(r.createGroup(john.by, { as: johnA.id, name: "家委会" })).venue;
  const code2 = ok(r.linkFor(john.by, second.owner, second.id, { as: johnA.id })).link.code;
  const next = ok(r.joinByLink(mei.by, code2, {}));
  assert.equal(next.avatar.id, joined.avatar.id, "John knows 乐乐 妈妈: that one comes in, no new avatar");
  assert.equal(r.avatarsOf(mei.person).length, 1);
  const named = ok(r.joinByLink(zhou.by, code2, { name: "Zhou" })).avatar;
  assert.notEqual(named.name, random, "a name given makes a new avatar even where one is known");
  assert.equal(r.avatarsOf(zhou.person).length, 2);
  const wu = login(r, "13600136000");
  bad(r.joinByLink(wu.by, code2, { as: named.id }), 403, "这不是你的分身");
  bad(r.joinByLink(wu.by, code2, { name: "  " }), 400, "名字不能是空的");
  const third = ok(r.createGroup(john.by, { as: johnA.id, name: "周末爬山" })).venue;
  const code3 = ok(r.linkFor(john.by, third.owner, third.id, { as: johnA.id })).link.code;
  const asked = ok(r.joinByLink(mei.by, code3, { as: joined.avatar.id }));
  assert.equal(asked.avatar.id, joined.avatar.id, "the avatar named in `as`");
  ok(r.rotateLink(john.by, third.owner, third.id, { as: johnA.id }));
  bad(r.joinByLink(wu.by, code3, { name: "吴" }), 410, "这个链接已经失效，找拉你的人要个新的");
  bad(r.joinByLink(wu.by, "abcdefgh", {}), 404, "没有这个链接");
  assert.equal(readDoc(r.root, "_relay", `links/${code}.geml`).blocks.filter((b) => b.id.startsWith("use-")).length, 2, "two came in by the first link");
});

test("an agent joins with its person's yes (spec §6.3, transport §2.5): with no token on the machine, the number and the code the person typed in the plugin's box give the avatar's token and a device token, never the person's; with the device token, the person's answer gives the avatar's token; an avatar's token cannot join anything", () => {
  const { r, g, code } = group();
  ok(r.startLogin({ phone: "13900139000", lang: "ja" }));
  bad(r.joinWithCode(code, { phone: "13900139000", code: "000000", name: "x" }), 401, "验证码不对或过期了");
  const sent = codeIn(r.texts[r.texts.length - 1]);
  const first = ok(r.joinWithCode(code, { phone: "13900139000", code: sent, lang: "ja", name: "李四" }));
  assert.equal(first.avatar.name, "李四");
  const avatarRec = r.verify(first.token), deviceRec = r.verify(first.device);
  assert.deepEqual([avatarRec.scope, avatarRec.speaker], ["avatar", `avatar:${first.avatar.id}`]);
  assert.equal(deviceRec.scope, "device");
  assert.equal(avatarRec.by, deviceRec.id, "the avatar's token was issued to that device");
  const person = deviceRec.speaker.slice("person:".length);
  assert.equal(r.languageOf(person), "ja", "a new person in the language of the code");
  bad(r.createGroup(deviceRec, { as: first.avatar.id, name: "x" }), 403, "这个令牌不能说话");
  ok(r.say(avatarRec, g.owner, g.id, { text: "大家好" }));
  const msgs = ok(r.read(avatarRec, g.owner, `venues/${g.id}.geml`)).blocks.filter((b) => b.id.startsWith("msg-"));
  assert.deepEqual(msgs.map((b) => [b.value.speaker, b.value.by]), [[`avatar:${first.avatar.id}`, "agent"]]);
  bad(r.joinWithCode(code, { phone: "13900139000", code: sent }), 401, "验证码不对或过期了"); // a code is spent once
  const owner = login(r, "13500135000");
  const ownerA = ok(r.growAvatar(owner.by, { name: "班主任" })).avatar;
  const second = ok(r.createGroup(owner.by, { as: ownerA.id, name: "班级通知" })).venue;
  const code2 = ok(r.linkFor(owner.by, second.owner, second.id, { as: ownerA.id })).link.code;
  const byDevice = ok(r.joinByLink(deviceRec, code2, { as: first.avatar.id }));
  assert.equal(r.verify(byDevice.token).speaker, `avatar:${first.avatar.id}`, "the device's join brings the avatar's token");
  bad(r.joinByLink(avatarRec, code2, {}), 403, "进群要本人点头");
  bad(r.joinWithCode("abcdefgh", { phone: "13900139000", code: "123456" }), 404, "没有这个链接"); // the link is checked before a code is spent
});

test("the owner's approval (spec §6.1): with it on, a newcomer's avatar grows and waits in the owner's requests; asking twice is one request; only the owner answers, once; a yes puts the avatar in, a no leaves it out; members never see the requests", () => {
  const { r, john, johnA, g, code } = group();
  ok(r.setLinkRules(john.by, g.owner, g.id, { as: johnA.id, approve: true }));
  const mei = login(r, "13900139000");
  const waiting = ok(r.joinByLink(mei.by, code, { name: "乐乐 妈妈" }));
  assert.equal(waiting.pending, "request-1");
  assert.deepEqual(waiting.venue.members.map((m) => m.name), ["John"], "not in yet");
  assert.equal(ok(r.joinByLink(mei.by, code, { as: waiting.avatar.id })).pending, "request-1", "asking again is the same request");
  const wu = login(r, "13700137000");
  const wuWaits = ok(r.joinByLink(wu.by, code, { name: "吴" }));
  assert.deepEqual(r.requestsOf(g.owner).map((q) => [q.id, q.avatar.name]), [["request-1", "乐乐 妈妈"], ["request-2", "吴"]]);
  bad(r.answerRequest(mei.by, g.owner, "request-1", { as: waiting.avatar.id, yes: true }), 403, "只有群主能换链接、改进群的规矩");
  bad(r.answerRequest(john.by, g.owner, "request-1", { as: johnA.id, yes: "ok" }), 400, "yes 要是 true 或 false");
  bad(r.answerRequest(john.by, g.owner, "request-9", { as: johnA.id, yes: true }), 404, "没有这条进群申请");
  assert.equal(ok(r.answerRequest(john.by, g.owner, "request-1", { as: johnA.id, yes: true })).joined, true);
  bad(r.answerRequest(john.by, g.owner, "request-1", { as: johnA.id, yes: false }), 409, "这条进群申请已经答过了");
  assert.equal(ok(r.answerRequest(john.by, g.owner, "request-2", { as: johnA.id, yes: false })).joined, false);
  assert.deepEqual(r.venueView(g.owner, g.id).members.map((m) => m.name), ["John", "乐乐 妈妈"]);
  assert.equal(r.venuesOf(wu.person).length, 0, "the no left 吴 out");
  assert.deepEqual(r.requestsOf(g.owner), []);
  bad(r.read(mei.by, g.owner, "requests.geml"), 403);
  assert.equal(ok(r.read(john.by, g.owner, "requests.geml")).blocks.length, 4);
  assert.equal(wuWaits.pending, "request-2");
});

test("guessing a code (spec §6.2): five wrong codes for a number in ten minutes stop every code of it, the right one too, until ten minutes pass; another number is not stopped", () => {
  const r = relay();
  ok(r.startLogin({ phone: "13900139000" }));
  const right = codeIn(r.texts[0]);
  const wrong = right === "000000" ? "111111" : "000000";
  for (let i = 0; i < 4; i++) bad(r.finishLogin({ phone: "13900139000", code: wrong }), 401, "验证码不对或过期了");
  bad(r.finishLogin({ phone: "13900139000", code: wrong }), 429, "验证码输错太多次了，过十分钟再试");
  bad(r.finishLogin({ phone: "13900139000", code: right }), 429, "验证码输错太多次了，过十分钟再试");
  ok(r.startLogin({ phone: "13700137000" }));
  ok(r.finishLogin({ phone: "13700137000", code: codeIn(r.texts[1]) }));
  r.advance(10 * 60_000);
  ok(r.startLogin({ phone: "13900139000" }));
  ok(r.finishLogin({ phone: "13900139000", code: codeIn(r.texts[2]) }));
});
