import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AvatarRelay } from "../dist/relay/avatars.js";

const BASE = Date.UTC(2026, 10, 2, 9, 0, 0);
function relay() {
  let offset = 0;
  const mail = [];
  const now = () => { const t = new Date(BASE + offset).toISOString().replace(/\.\d{3}Z$/, "Z"); offset += 1000; return t; };
  const r = new AvatarRelay({ root: mkdtempSync(join(tmpdir(), "gemsbang-box-")), name: "relay.test", now, mailer: (m) => { mail.push(m); } });
  return Object.assign(r, { mail });
}
const ok = (x) => { assert.equal(x.ok, true, x.reason); return x; };
const bad = (x, status, code) => { assert.equal(x.ok, false); assert.equal(x.status, status, x.reason); assert.equal(x.code, code); return x; };
function person(r, email, name) {
  ok(r.startLogin({ email }));
  const done = ok(r.finishLogin({ email, code: /(\d{6})/.exec(r.mail[r.mail.length - 1].text)[1] }));
  const by = r.verify(done.token);
  return { by, person: done.person, avatar: ok(r.firstAvatar(by, { name })).avatar };
}
/** The person's whole box, as `<doc>#<block>` per update, after the number given. */
const box = (r, p, pts = 0) => ok(r.difference(p.by, { pts })).updates.map((u) => `${u.doc}#${u.block.id}`);

test("each person's box (architecture §5.1): their own record and their first avatar's card, numbered from one; the state says how far it reaches", () => {
  const r = relay();
  const john = person(r, "john@example.com", "John");
  const d = ok(r.difference(john.by, { pts: 0 }));
  assert.deepEqual(d.updates.map((u) => [u.pts, u.count, u.owner === "_relay" ? "_relay" : "avatar", u.doc]), [[1, 1, "_relay", `people/${john.person}.geml`], [2, 1, "_relay", `people/${john.person}.geml`], [3, 1, "_relay", `people/${john.person}.geml`], [4, 1, "avatar", "avatar.geml"]]);
  assert.deepEqual([d.pts, d.final], [4, true]);
  assert.deepEqual(ok(r.updatesState(john.by)).pts, 4);
  bad(r.difference(john.by, { pts: -1 }), 400, "updates.pts");
  bad(r.difference(john.by, { pts: 0, limit: 0 }), 400, "updates.limit");
  bad(r.updatesState({ ...john.by, scope: "avatar" }), 403, "person.only");
});

test("a chat's line goes into every member's box as they may see it — `by` left out where the speaker does not mark, kept for the speaker's own person; a card into its avatar's person's alone; nothing into a stranger's; whoever waits on a box hears of each", () => {
  const r = relay();
  const john = person(r, "john@example.com", "John"), li = person(r, "li@example.com", "李四"), wang = person(r, "wang@example.com", "王五");
  const g = ok(r.createGroup(john.by, { as: john.avatar.id, name: "设置页改版" })).venue;
  const code = ok(r.linkFor(john.by, g.owner, g.id, { as: john.avatar.id })).link.code;
  ok(r.joinByLink(li.by, code, { as: li.avatar.id }));
  ok(r.setRules(li.by, li.avatar.id, { mark: false }));
  const heard = [];
  const off = r.onBox(john.person, () => heard.push("john"));
  const johnAt = ok(r.updatesState(john.by)).pts, liAt = ok(r.updatesState(li.by)).pts, wangAt = ok(r.updatesState(wang.by)).pts;
  const agent = r.verify(ok(r.issueAvatar(li.by, li.avatar.id)).token);
  const said = ok(r.say(agent, g.owner, g.id, { text: "Safari 里导出按钮没反应" })).message;
  const toJohn = ok(r.difference(john.by, { pts: johnAt })).updates;
  assert.deepEqual(toJohn.map((u) => [u.owner, u.doc, u.block.id, u.block.value.text, "by" in u.block.value]), [[g.owner, `venues/${g.id}.geml`, said.id, "Safari 里导出按钮没反应", false]]);
  assert.equal(ok(r.difference(li.by, { pts: liAt })).updates.find((u) => u.block.id === said.id).block.value.by, "agent", "the speaker's own person sees who typed it");
  assert.deepEqual(box(r, wang, wangAt), [], "a stranger hears nothing of the chat");
  assert.deepEqual(heard, ["john"]);
  off();
  ok(r.say(john.by, g.owner, g.id, { as: john.avatar.id, text: "我看看" }));
  assert.deepEqual(heard, ["john"], "no longer waiting");
  ok(r.rename(li.by, li.avatar.id, { name: "李四（前端）" }));
  assert.deepEqual(box(r, john, johnAt).slice(-1), [`avatar.geml#name-1`], "a member's new name reaches everyone in a chat with it");
  const liNow = ok(r.updatesState(li.by)).pts, johnNow = ok(r.updatesState(john.by)).pts;
  ok(r.ask(agent, { venue: `${g.owner}/${g.id}`, kind: "promise", summary: "周五前给稿子反馈", options: [{ label: "确定" }] }));
  assert.deepEqual([box(r, li, liNow).map((x) => x.split("#")[0]), box(r, john, johnNow)], [["needs.geml"], []], "a card is its person's alone");
  assert.equal(box(r, wang, wangAt).length, 0);
});
