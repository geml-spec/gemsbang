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

/** John's work avatar owns 前端周会, with Li's avatar in it. */
function group() {
  const r = relay();
  const john = login(r, "13800138000");
  const li = login(r, "13900139000");
  const johnA = ok(r.growAvatar(john.by, { name: "John" })).avatar;
  const liA = ok(r.growAvatar(li.by, { name: "李四" })).avatar;
  const g = ok(r.createGroup(john.by, { as: johnA.id, name: "前端周会" })).venue;
  ok(r.addMember(john.by, g.owner, g.id, { as: johnA.id, avatar: liA.id }));
  return { r, john, li, johnA, liA, g };
}

test("a group's link (spec §6.1): a member gets the current one, made the first time, carrying who passes it on; it lasts seven days and then a new one is made; the owner swaps it and the old one stops at once; a two-person talk and an outsider get none", () => {
  const { r, john, li, johnA, liA, g } = group();
  const first = ok(r.linkFor(john.by, g.owner, g.id, { as: johnA.id })).link;
  assert.match(first.code, /^[a-hj-km-np-z2-9]{8}$/);
  assert.deepEqual([first.path, first.forward, first.approve], [`/i/${first.code}?by=${johnA.id}`, true, false]);
  assert.equal(Date.parse(first.expires) - Date.parse("2026-11-01T09:00:00Z") >= 7 * 86_400_000, true);
  const liSees = ok(r.linkFor(li.by, g.owner, g.id, { as: liA.id })).link;
  assert.deepEqual([liSees.code, liSees.path], [first.code, `/i/${first.code}?by=${liA.id}`], "one current link; the path says who passed it on");
  assert.equal(ok(r.linkInfo(first.code)).group.name, "前端周会");
  r.advance(7 * 86_400_000);
  bad(r.linkInfo(first.code), 410, "这个链接已经失效，找拉你的人要个新的");
  const second = ok(r.linkFor(li.by, g.owner, g.id, { as: liA.id })).link;
  assert.notEqual(second.code, first.code, "past its day, the next ask makes a new one");
  bad(r.rotateLink(li.by, g.owner, g.id, { as: liA.id }), 403, "只有群主能换链接、改进群的规矩");
  const third = ok(r.rotateLink(john.by, g.owner, g.id, { as: johnA.id })).link;
  bad(r.linkInfo(second.code), 410);
  assert.equal(ok(r.linkInfo(third.code)).group.id, g.id);
  bad(r.linkInfo("abcdefgh"), 404, "没有这个链接");
  bad(r.linkInfo("NOT A CODE"), 404);
  const wang = login(r, "13700137000");
  const wangA = ok(r.growAvatar(wang.by, { name: "王五" })).avatar;
  bad(r.linkFor(wang.by, g.owner, g.id, { as: wangA.id }), 403, "不在这个群里");
  const dm = ok(r.openDm(john.by, { as: johnA.id, with: liA.id })).venue;
  bad(r.linkFor(john.by, dm.owner, dm.id, { as: johnA.id }), 400, "两个人的私聊没有链接");
});

test("link rules (spec §6.1): only the owner turns forwarding off or the approval on; with forwarding off members get no link and the owner still does; a bad rule is refused; the rules are in the group for its members to see", () => {
  const { r, john, li, johnA, liA, g } = group();
  bad(r.setLinkRules(li.by, g.owner, g.id, { as: liA.id, forward: false }), 403, "只有群主能换链接、改进群的规矩");
  bad(r.setLinkRules(john.by, g.owner, g.id, { as: johnA.id, forward: "no" }), 400, "forward 和 approve 要是 true 或 false");
  assert.deepEqual(ok(r.setLinkRules(john.by, g.owner, g.id, { as: johnA.id, forward: false })).rules, { forward: false, approve: false });
  bad(r.linkFor(li.by, g.owner, g.id, { as: liA.id }), 403, "只有群主能转这个群");
  assert.equal(ok(r.linkFor(john.by, g.owner, g.id, { as: johnA.id })).link.forward, false);
  assert.deepEqual(ok(r.setLinkRules(john.by, g.owner, g.id, { as: johnA.id, approve: true })).rules, { forward: false, approve: true });
  assert.deepEqual(r.linkRulesOf(g.owner, g.id), { forward: false, approve: true });
  const seen = ok(r.read(li.by, g.owner, `venues/${g.id}.geml`)).blocks.filter((b) => b.id.startsWith("link-rules-")).map((b) => [b.value.forward, b.value.approve]);
  assert.deepEqual(seen, [[false, false], [false, true]]);
});

test("a link's page (spec §6.2, §6.4, §6.5): anyone sees the group, its count, five members at most, the owner, the approval; a person also sees which avatar would join — the one the inviter knows, else none — and the names offered in their language, the inviter's name for them first, their default name offered", () => {
  const { r, john, li, johnA, liA, g } = group();
  const others = ["王五", "赵六", "钱七", "孙八", "周九"].map((name, i) => {
    const p = login(r, `1360013600${i}`);
    const a = ok(r.growAvatar(p.by, { name })).avatar;
    ok(r.addMember(john.by, g.owner, g.id, { as: johnA.id, avatar: a.id }));
    return a;
  });
  const code = ok(r.linkFor(john.by, g.owner, g.id, { as: johnA.id })).link.code;
  const anyone = ok(r.linkInfo(code, undefined, { lang: "en" }));
  assert.deepEqual([anyone.group.name, anyone.group.count, anyone.group.members.length, anyone.owner.name, anyone.approve], ["前端周会", 7, 5, "John", false]);
  assert.equal(anyone.you, undefined);
  assert.deepEqual(anyone.suggestions, [], "a work group with no name from the inviter: nothing to offer");
  const zhang = login(r, "13500135000");
  const zhangFamily = ok(r.growAvatar(zhang.by, { name: "乐乐爸爸" })).avatar;
  const zhangWork = ok(r.growAvatar(zhang.by, { name: "张三" })).avatar;
  const other = ok(r.createGroup(li.by, { as: liA.id, name: "设计评审" })).venue;
  ok(r.addMember(li.by, other.owner, other.id, { as: liA.id, avatar: zhangWork.id }));
  ok(r.setDefaultName(zhang.by, { name: "老张" }));
  const byLi = ok(r.linkInfo(code, zhang.by, { by: liA.id, call: "小张" }));
  assert.deepEqual(byLi.you.pick, { kind: "known", avatar: zhangWork.id }, "Li knows Zhang's work avatar");
  assert.deepEqual(byLi.you.avatars.map((a) => a.name), ["乐乐爸爸", "张三"]);
  assert.deepEqual(byLi.suggestions, [{ text: "小张", kind: "call" }, { text: "老张", kind: "default" }]);
  assert.deepEqual(ok(r.linkInfo(code, zhang.by, { by: others[0].id })).you.pick, { kind: "choose" }, "Wang shares nothing with Zhang: no default");
  assert.deepEqual(ok(r.linkInfo(code, zhang.by, { by: "a-ffffffffff" })).you.pick, { kind: "choose" }, "someone not in the group counts as the owner, whom Zhang does not know");
  assert.deepEqual(ok(r.linkInfo(code, zhang.by, { call: "\u0007" })).suggestions.map((s) => s.kind), ["default"], "a name that cannot be one is dropped");
  const parents = ok(r.createGroup(zhang.by, { as: zhangFamily.id, name: "三年二班家长" })).venue;
  const pcode = ok(r.linkFor(zhang.by, parents.owner, parents.id, { as: zhangFamily.id })).link.code;
  ok(r.setLanguage(li.by, { lang: "en" }));
  assert.deepEqual(ok(r.linkInfo(pcode, li.by)).suggestions.map((s) => s.text), ["__'s mom", "__'s dad"], "in the viewer's own language");
  assert.deepEqual(ok(r.linkInfo(pcode, undefined, { lang: "ja" })).suggestions.map((s) => s.text), ["__ママ", "__パパ"]);
});
