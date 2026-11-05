import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AvatarRelay } from "../dist/relay/avatars.js";
import { routeAvatars } from "../dist/relay/avatar-api.js";

const BASE = Date.UTC(2026, 10, 2, 9, 0, 0);
function relay() {
  let offset = 0;
  const texts = [];
  const now = () => { const t = new Date(BASE + offset).toISOString().replace(/\.\d{3}Z$/, "Z"); offset += 1000; return t; };
  const r = new AvatarRelay({ root: mkdtempSync(join(tmpdir(), "gemsbang-auto-")), name: "relay.test", now, texter: (t) => { texts.push(t); } });
  r.texts = texts;
  return r;
}
const ok = (x) => { assert.equal(x.ok, true, x.reason); return x; };
const bad = (x, status, reason) => { assert.equal(x.ok, false); assert.equal(x.status, status, x.reason); if (reason !== undefined) assert.equal(x.reason, reason); return x; };
const codeIn = (text) => text.match(/(\d{6})/)[1];
function login(r, phone) {
  ok(r.startLogin({ phone }));
  const done = ok(r.finishLogin({ phone, code: codeIn(r.texts.at(-1).text) }));
  return { by: r.verify(done.token), person: done.person, token: done.token };
}
function world() {
  const r = relay();
  const john = login(r, "13800138000");
  const li = login(r, "13900139000");
  const me = ok(r.growAvatar(john.by, { name: "John" })).avatar;
  const liA = ok(r.growAvatar(li.by, { name: "李四" })).avatar;
  const g = ok(r.createGroup(john.by, { as: me.id, name: "设置页改版" })).venue;
  ok(r.addMember(john.by, g.owner, g.id, { as: me.id, avatar: liA.id }));
  const other = ok(r.createGroup(li.by, { as: liA.id, name: "李四自己的群" })).venue;
  return { r, john, li, me, liA, g, other, venue: `${g.owner}/${g.id}` };
}

test("自动回复 (architecture §6.3): the person sets a chat of their avatar to answer on its own, and takes it back; it is kept with the avatar, so every computer of theirs reads it; only the person, only a chat the avatar is in", () => {
  const w = world();
  assert.deepEqual(w.r.autoOf(w.me.id), [], "off by default");
  assert.deepEqual(ok(w.r.setAuto(w.john.by, w.me.id, { venue: w.venue, on: true })).auto, [w.venue]);
  assert.deepEqual(ok(w.r.read(w.john.by, w.me.id, "auto.geml")).blocks.map((b) => [b.value.venue, b.value.on]), [[w.venue, true]], "the person's client reads it");
  assert.deepEqual(ok(w.r.setAuto(w.john.by, w.me.id, { venue: w.venue, on: false })).auto, [], "撤销");
  bad(w.r.setAuto(w.li.by, w.me.id, { venue: w.venue, on: true }), 403);
  bad(w.r.setAuto(w.john.by, w.me.id, { venue: `${w.other.owner}/${w.other.id}`, on: true }), 403, "不在该群聊中");
  bad(w.r.setAuto(w.john.by, w.me.id, { venue: w.venue }), 400, "要写明是哪个聊天（venue：<owner>/<id>）、开还是关（on：true 或 false）");
  const r = routeAvatars({ method: "POST", path: `/avatars/${w.me.id}/auto`, query: {}, base: "https://im.example", token: w.john.token, body: { venue: w.venue, on: true } }, w.r);
  assert.deepEqual([r.status, JSON.parse(r.body).auto], [200, [w.venue]], "over HTTP");
});

test("hops on an agent's line (spec §5 rule 7): the avatar's agent says how many hops its answer carries; a person's line carries none; out of range, refused", () => {
  const w = world();
  const agent = w.r.verify(ok(w.r.issueAvatar(w.john.by, w.me.id)).token);
  const said = ok(w.r.say(agent, w.g.owner, w.g.id, { text: "我看一下", hops: 1 })).message;
  assert.deepEqual([said.by, said.hops], ["agent", 1]);
  bad(w.r.say(w.john.by, w.g.owner, w.g.id, { as: w.me.id, text: "我来", hops: 0 }), 400, "hops 只有 agent 说的话能带，是 0 到 9 的整数");
  bad(w.r.say(agent, w.g.owner, w.g.id, { text: "x", hops: 10 }), 400);
});
