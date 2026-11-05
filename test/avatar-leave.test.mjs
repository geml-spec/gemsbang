import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AvatarRelay } from "../dist/relay/avatars.js";
import { memoryStore } from "../dist/relay/doc-store.js";

const BASE = Date.UTC(2026, 10, 3, 9, 0, 0);
function relay(o = {}) {
  let offset = 0;
  const texts = [];
  const now = () => { const t = new Date(BASE + offset).toISOString().replace(/\.\d{3}Z$/, "Z"); offset += 1000; return t; };
  const r = new AvatarRelay({ root: mkdtempSync(join(tmpdir(), "gemsbang-leave-")), name: "relay.test", now, texter: (t) => { texts.push(t); }, ...o });
  r.texts = texts;
  return r;
}
const ok = (x) => { assert.equal(x.ok, true, x.reason); return x; };
const bad = (x, status, reason) => { assert.equal(x.ok, false); assert.equal(x.status, status, x.reason); if (reason !== undefined) assert.equal(x.reason, reason); return x; };
function login(r, phone) {
  ok(r.startLogin({ phone }));
  const done = ok(r.finishLogin({ phone, code: /(\d{6})/.exec(r.texts.at(-1).text)[1] }));
  return { by: r.verify(done.token), person: done.person };
}
/** 设置页改版: John's avatar owns it, 李四 and 张三 are in it. */
function world(o) {
  const r = relay(o);
  const john = login(r, "13800138000"), li = login(r, "13900139000"), zhang = login(r, "13700137000");
  const j = ok(r.growAvatar(john.by, { name: "John" })).avatar, l = ok(r.growAvatar(li.by, { name: "李四" })).avatar, z = ok(r.growAvatar(zhang.by, { name: "张三" })).avatar;
  const g = ok(r.createGroup(john.by, { as: j.id, name: "设置页改版" })).venue;
  ok(r.addMember(john.by, g.owner, g.id, { as: j.id, avatar: l.id }));
  ok(r.addMember(john.by, g.owner, g.id, { as: j.id, avatar: z.id }));
  return { r, john, li, zhang, j, l, z, g };
}
const said = (r, g, by) => ok(r.read(by, g.owner, `venues/${g.id}.geml`)).blocks.map((b) => b.id.replace(/-\d+$/, ""));

test("退出群聊 (S19): a member leaves — out of the group and their own list, their 自动回复 there gone, the group says so — and their past lines keep their name; a two-person chat is not left", () => {
  const { r, john, li, j, l, g } = world();
  ok(r.setAuto(li.by, l.id, { venue: `${g.owner}/${g.id}`, on: true }));
  ok(r.say(li.by, g.owner, g.id, { as: l.id, text: "我先走了" }));
  const left = ok(r.leaveVenue(li.by, g.owner, g.id, { as: l.id }));
  assert.equal(left.gone, undefined);
  const view = r.venueView(g.owner, g.id, j.id);
  assert.deepEqual([view.members.map((m) => m.name), view.former.map((m) => m.name), view.keeper], [["John", "张三"], ["李四"], j.id]);
  assert.deepEqual(r.joinedOf(l.id), [], "gone from their list");
  assert.deepEqual(r.autoOf(l.id), [], "their 自动回复 there with it");
  assert.equal(said(r, g, john.by).at(-1), "leave", "the group says so");
  bad(r.read(li.by, g.owner, `venues/${g.id}.geml`), 403);
  bad(r.leaveVenue(li.by, g.owner, g.id, { as: l.id }), 403, "不在该群聊中");
  const dm = ok(r.openDm(john.by, { as: j.id, with: r.venueView(g.owner, g.id, j.id).members[1].id })).venue;
  bad(r.leaveVenue(john.by, dm.owner, dm.id, { as: j.id }), 400, "私聊不能退出");
});

test("the 群主 leaves (S19, Q13②): not before naming someone in the group; then that one is the 群主 — adds members, sets the link's rules, gets the join requests — and the group says who took it over", () => {
  const { r, john, li, zhang, j, l, z, g } = world();
  bad(r.leaveVenue(john.by, g.owner, g.id, { as: j.id }), 400, "你是群主，请先选择新群主");
  bad(r.leaveVenue(john.by, g.owner, g.id, { as: j.id, heir: "a-ffffffffff" }), 400);
  ok(r.leaveVenue(john.by, g.owner, g.id, { as: j.id, heir: l.id }));
  const view = r.venueView(g.owner, g.id, l.id);
  assert.deepEqual([view.keeper, view.members.map((m) => m.name), view.owner], [l.id, ["李四", "张三"], j.id], "kept where it was made, its 群主 李四");
  assert.deepEqual(said(r, g, li.by).slice(-2), ["owner", "leave"]);
  const mei = login(r, "13600136000"), m = ok(r.growAvatar(mei.by, { name: "乐乐妈妈" })).avatar;
  bad(r.addMember(zhang.by, g.owner, g.id, { as: z.id, avatar: m.id }), 403);
  ok(r.addMember(li.by, g.owner, g.id, { as: l.id, avatar: m.id }));
  ok(r.setLinkRules(li.by, g.owner, g.id, { as: l.id, approve: true }));
  const code = ok(r.linkFor(li.by, g.owner, g.id, { as: l.id })).link.code;
  const zhou = login(r, "13500135000");
  assert.ok(ok(r.joinByLink(zhou.by, code, { name: "周" })).pending, "waits for the 群主");
  const cards = r.needsOf(li.person);
  assert.deepEqual(cards.map((n) => [n.kind, n.summary]), [["promise", "「周」申请加入「设置页改版」"]], "the new 群主's 承诺");
  ok(r.answerNeed(li.by, l.id, cards[0].id, { choice: 0 }));
  assert.deepEqual(r.venueView(g.owner, g.id, l.id).members.map((x) => x.name), ["李四", "张三", "乐乐妈妈", "周"], "let in where the group is kept");
  assert.equal(r.needsOf(john.person).length, 0, "nothing for the one who left");
});

test("the last one leaves (S19, P7c): the group is gone with its chat — no one reads it, its link names nothing — on files and in memory alike (every store removes alike: relay-doc-store.test.mjs)", () => {
  for (const store of ["files", "memory"]) {
    const { r, john, li, zhang, j, l, z, g } = world(store === "memory" ? { store: memoryStore() } : {});
    const code = ok(r.linkFor(john.by, g.owner, g.id, { as: j.id })).link.code;
    ok(r.leaveVenue(li.by, g.owner, g.id, { as: l.id }));
    ok(r.leaveVenue(zhang.by, g.owner, g.id, { as: z.id }));
    const last = ok(r.leaveVenue(john.by, g.owner, g.id, { as: j.id }));
    assert.equal(last.gone, true, store);
    assert.equal(r.venueView(g.owner, g.id), undefined);
    assert.deepEqual(r.joinedOf(j.id), []);
    bad(r.joinByLink(login(r, "13400134000").by, code, { name: "新人" }), 404, "未找到该链接");
    if (store === "files") assert.equal(existsSync(join(r.root, g.owner, "venues", `${g.id}.geml`)), false, "the file itself gone");
  }
});
