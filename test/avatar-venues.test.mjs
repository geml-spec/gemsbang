import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AvatarRelay } from "../dist/relay/avatars.js";
import { readDoc } from "../dist/relay/store.js";
import { verifyChain } from "../dist/core/chain.js";

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

test("groups (spec §6, §7.2): made by an avatar, its owner; the owner pulls avatars in; only members say and read; a message carries the avatar and `by`, chained; a client's id makes a resend a no-op; the relay's ids, an empty or long text, a reply to nothing are refused; the person sees every venue of every avatar with the one in it", () => {
  const r = relay();
  const john = login(r, "13800138000");
  const li = login(r, "13900139000");
  const wang = login(r, "13700137000");
  const johnWork = ok(r.growAvatar(john.by, { name: "John" })).avatar;
  const lily = ok(r.growAvatar(john.by, { name: "Lily 爸爸" })).avatar;
  const liA = ok(r.growAvatar(li.by, { name: "李四" })).avatar;
  const wangA = ok(r.growAvatar(wang.by, { name: "王五" })).avatar;
  bad(r.createGroup(john.by, { name: "x" }), 400, "要说明以哪个分身");
  bad(r.createGroup(john.by, { as: liA.id, name: "x" }), 403, "这不是你的分身");
  bad(r.createGroup(john.by, { as: johnWork.id, name: " " }), 400, "群要有个名字");
  const g = ok(r.createGroup(john.by, { as: johnWork.id, name: "设置页改版" })).venue;
  assert.match(g.id, /^g-[0-9a-f]{10}$/);
  assert.deepEqual([g.owner, g.kind, g.name, g.members.map((m) => m.name)], [johnWork.id, "group", "设置页改版", ["John"]]);
  bad(r.addMember(li.by, g.owner, g.id, { as: liA.id, avatar: liA.id }), 403, "只有群主能拉人");
  ok(r.addMember(john.by, g.owner, g.id, { as: johnWork.id, avatar: liA.id }));
  const liToken = r.verify(ok(r.issueAvatar(li.by, liA.id)).token);
  const said = ok(r.say(john.by, g.owner, g.id, { as: johnWork.id, text: "稿子在这\r\n周五前要定  ", id: "m-1" }));
  assert.deepEqual([said.message.speaker, said.message.by, said.message.text, said.existed], [`avatar:${johnWork.id}`, "person", "稿子在这\n周五前要定", false]);
  assert.equal(ok(r.say(john.by, g.owner, g.id, { as: johnWork.id, text: "again", id: "m-1" })).existed, true);
  const agent = ok(r.say(liToken, g.owner, g.id, { text: "收到，周五前给反馈", replyTo: "m-1" }));
  assert.deepEqual([agent.message.id, agent.message.speaker, agent.message.by, agent.message.replyTo], ["msg-1", `avatar:${liA.id}`, "agent", "m-1"]);
  bad(r.say(wang.by, g.owner, g.id, { as: wangA.id, text: "hi" }), 403, "不在这个群里");
  bad(r.read(wang.by, g.owner, `venues/${g.id}.geml`), 403);
  bad(r.say(john.by, g.owner, g.id, { as: johnWork.id, text: "x", id: "member-9" }), 400, "消息 id 不合法");
  bad(r.say(john.by, g.owner, g.id, { as: johnWork.id, text: "  " }), 400, "说点什么");
  bad(r.say(john.by, g.owner, g.id, { as: johnWork.id, text: "长".repeat(4001) }), 400, "一条最多 4000 个字");
  bad(r.say(john.by, g.owner, g.id, { as: johnWork.id, text: "x", replyTo: "m-404" }), 400, "回复的那条不在这个群里");
  const d = readDoc(r.root, g.owner, `venues/${g.id}.geml`);
  assert.deepEqual(d.blocks.map((b) => b.id), ["venue", "member-1", "member-2", "m-1", "msg-1"]);
  assert.deepEqual(verifyChain(d.blocks), []);
  const read = ok(r.read(li.by, g.owner, `venues/${g.id}.geml`));
  assert.equal(read.blocks.find((b) => b.id === "msg-1").value.by, "agent");
  ok(r.createGroup(john.by, { as: lily.id, name: "三年二班家长" }));
  assert.deepEqual(r.venuesOf(john.person).map((v) => [v.name, v.as]), [["设置页改版", johnWork.id], ["三年二班家长", lily.id]]);
  assert.deepEqual(r.venuesOf(li.person).map((v) => [v.name, v.as]), [["设置页改版", liA.id]]);
  bad(r.read(li.by, lily.id, "joined.geml"), 403);
  assert.deepEqual(ok(r.read(john.by, lily.id, "joined.geml")).blocks.map((b) => b.id), ["join-1"]);
});

test("marking (spec §5 rule 1, §8.1): every message records `by`; when the avatar does not mark, the others in the venue see no `by` on its lines, while its own person still does; only the person changes the rule", () => {
  const r = relay();
  const john = login(r, "13800138000");
  const wang = login(r, "13700137000");
  const lily = ok(r.growAvatar(john.by, { name: "Lily 爸爸" })).avatar;
  const teacher = ok(r.growAvatar(wang.by, { name: "王老师" })).avatar;
  const g = ok(r.createGroup(wang.by, { as: teacher.id, name: "三年二班家长" })).venue;
  ok(r.addMember(wang.by, g.owner, g.id, { as: teacher.id, avatar: lily.id }));
  const lilyAgent = r.verify(ok(r.issueAvatar(john.by, lily.id)).token);
  ok(r.say(lilyAgent, g.owner, g.id, { text: "我帮 John 记下了", id: "m-a" }));
  ok(r.say(john.by, g.owner, g.id, { as: lily.id, text: "周五我可以去", id: "m-p" }));
  const seen = (by) => Object.fromEntries(ok(r.read(by, g.owner, `venues/${g.id}.geml`)).blocks.filter((b) => b.id.startsWith("m-")).map((b) => [b.id, b.value.by]));
  assert.deepEqual(seen(wang.by), { "m-a": "agent", "m-p": "person" });
  bad(r.setRules(wang.by, lily.id, { mark: false }), 403, "这不是你的分身");
  bad(r.setRules(john.by, lily.id, { mark: "no" }), 400, "mark 要是 true 或 false");
  assert.deepEqual(ok(r.setRules(john.by, lily.id, { mark: false })).rules, { mark: false, borrow: ["read", "edit", "test"] });
  assert.deepEqual(seen(wang.by), { "m-a": undefined, "m-p": undefined });
  assert.deepEqual(seen(john.by), { "m-a": "agent", "m-p": "person" });
  assert.deepEqual(seen(lilyAgent), { "m-a": "agent", "m-p": "person" });
  assert.equal(readDoc(r.root, g.owner, `venues/${g.id}.geml`).blocks.find((b) => b.id === "m-a").value.by, "agent", "the record keeps it");
  assert.deepEqual(ok(r.read(john.by, lily.id, "rules.geml")).blocks.map((b) => b.value.mark), [false]);
  bad(r.read(wang.by, lily.id, "rules.geml"), 403);
});

test("two-person talk (spec §6.6): opened from a group the two share, one per pair whoever opens it, named after the other side; not with a stranger", () => {
  const r = relay();
  const john = login(r, "13800138000");
  const li = login(r, "13900139000");
  const wang = login(r, "13700137000");
  const j = ok(r.growAvatar(john.by, { name: "John" })).avatar;
  const l = ok(r.growAvatar(li.by, { name: "李四" })).avatar;
  const w = ok(r.growAvatar(wang.by, { name: "王五" })).avatar;
  const g = ok(r.createGroup(john.by, { as: j.id, name: "设置页改版" })).venue;
  ok(r.addMember(john.by, g.owner, g.id, { as: j.id, avatar: l.id }));
  bad(r.openDm(john.by, { as: j.id, with: w.id }), 403, "要先在同一个群里");
  bad(r.openDm(john.by, { as: j.id, with: j.id }), 404);
  const dm = ok(r.openDm(john.by, { as: j.id, with: l.id })).venue;
  assert.match(dm.id, /^d-[0-9a-f]{10}$/);
  assert.deepEqual([dm.kind, dm.name, dm.members.map((m) => m.name).sort()], ["dm", "李四", ["John", "李四"].sort()]);
  const back = ok(r.openDm(li.by, { as: l.id, with: j.id })).venue;
  assert.deepEqual([back.owner, back.id, back.name], [dm.owner, dm.id, "John"]);
  ok(r.say(li.by, dm.owner, dm.id, { as: l.id, text: "周五前能给反馈吗？" }));
  assert.deepEqual(r.venuesOf(john.person).map((v) => [v.kind, v.name]), [["group", "设置页改版"], ["dm", "李四"]]);
  bad(r.addMember(john.by, dm.owner, dm.id, { as: j.id, avatar: w.id }), 400, "两个人的私聊不能加人");
});

test("pushes: every block the relay appends is heard, once; a resend is not", () => {
  const r = relay();
  const heard = [];
  const stop = r.onAppend((p) => heard.push(`${p.doc}#${p.block.id}`));
  const john = login(r, "13800138000");
  const j = ok(r.growAvatar(john.by, { name: "John" })).avatar;
  const g = ok(r.createGroup(john.by, { as: j.id, name: "x" })).venue;
  ok(r.say(john.by, g.owner, g.id, { as: j.id, text: "hi", id: "m-1" }));
  ok(r.say(john.by, g.owner, g.id, { as: j.id, text: "hi", id: "m-1" }));
  stop();
  ok(r.say(john.by, g.owner, g.id, { as: j.id, text: "after" }));
  assert.deepEqual(heard, ["avatar.geml#avatar", `venues/${g.id}.geml#venue`, `venues/${g.id}.geml#member-1`, "joined.geml#join-1", `venues/${g.id}.geml#m-1`]);
});

test("reading an avatar's card: anyone may, and it names no person; the relay's own records are never read", () => {
  const r = relay();
  const john = login(r, "13800138000");
  const zhang = login(r, "13900139000");
  const lily = ok(r.growAvatar(john.by, { name: "Lily 爸爸" })).avatar;
  ok(r.rename(john.by, lily.id, { name: "Lily 的爸爸" }));
  const card = ok(r.read(zhang.by, lily.id, "avatar.geml"));
  assert.deepEqual(card.blocks.map((b) => [b.id, b.value.name]), [["avatar", "Lily 爸爸"], ["name-1", "Lily 的爸爸"]]);
  assert.ok(!JSON.stringify(card.blocks).includes(john.person), "the card names no person");
  bad(r.read(zhang.by, "_relay", "avatar-owners.geml"), 404);
  bad(r.read(zhang.by, lily.id, "nothing.geml"), 404);
});

test("a device's token says nothing and reads no venue: it may only ask for an avatar's token (plan Q)", () => {
  const r = relay();
  const john = login(r, "13800138000");
  const a = ok(r.growAvatar(john.by, { name: "John" })).avatar;
  const device = ok(r.issueDevice(john.by)).record;
  const g = ok(r.createGroup(john.by, { as: a.id, name: "设置页改版" })).venue;
  bad(r.say(device, g.owner, g.id, { text: "hi" }), 403, "这个令牌不能说话");
  bad(r.read(device, g.owner, `venues/${g.id}.geml`), 403);
  bad(r.createGroup(device, { as: a.id, name: "x" }), 403, "这个令牌不能说话");
});
