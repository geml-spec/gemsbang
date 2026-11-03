import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AvatarRelay } from "../dist/relay/avatars.js";
import { baseFor, baseOf, splitBaseLine } from "../dist/core/avatar/base.js";

const BASE = Date.UTC(2026, 10, 3, 9, 0, 0);
function relay() {
  let offset = 0;
  const texts = [];
  const now = () => { const t = new Date(BASE + offset).toISOString().replace(/\.\d{3}Z$/, "Z"); offset += 1000; return t; };
  const r = new AvatarRelay({ root: mkdtempSync(join(tmpdir(), "gemsbang-base-")), name: "relay.test", now, texter: (t) => { texts.push(t); } });
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

test("底子 (S27, design §8.2): the person keeps entries, each given to some of their avatars; an avatar's agent reads only the kept ones given to it, and what it writes waits for the person's yes; 记下 keeps it, 不记 and 删 drop it; other people read nothing", () => {
  const r = relay();
  const john = login(r, "13800138000"), wang = login(r, "13700137000");
  const lily = ok(r.growAvatar(john.by, { name: "Lily 爸爸" })).avatar, work = ok(r.growAvatar(john.by, { name: "John" })).avatar;
  const lilyAgent = r.verify(ok(r.issueAvatar(john.by, lily.id)).token), workAgent = r.verify(ok(r.issueAvatar(john.by, work.id)).token);
  const kid = ok(r.addBase(john.by, { label: "家人", text: "Lily，8 岁，三年二班", for: [lily.id] })).item;
  assert.deepEqual([kid.label, kid.text, kid.for, kid.state, kid.by], ["家人", "Lily，8 岁，三年二班", [lily.id], "kept", "person"]);
  ok(r.addBase(john.by, { label: "时区", text: "上海", for: [lily.id, work.id] }));
  bad(r.addBase(john.by, { text: "x", for: [] }), 400, "要给你的至少一个身份");
  bad(r.addBase(wang.by, { text: "x", for: [lily.id] }), 400, "要给你的至少一个身份");
  bad(r.addBase(john.by, { text: " ", for: [lily.id] }), 400);
  assert.deepEqual(ok(r.baseFor(lilyAgent)).base.map((x) => x.text), ["Lily，8 岁，三年二班", "上海"], "Lily 爸爸's agent: both");
  assert.deepEqual(ok(r.baseFor(workAgent)).base.map((x) => x.text), ["上海"], "the work avatar's: only what is given to it");
  assert.deepEqual(ok(r.baseFor(wang.by)).base, [], "another person: their own, none of John's");
  // An agent writes one: it waits, given to its avatar alone, with who said it; agents read none of it until it is kept.
  const nut = ok(r.addBase(lilyAgent, { label: "家人", text: "Lily 对花生过敏", who: "王老师", for: [work.id] })).item;
  assert.deepEqual([nut.state, nut.for, nut.by, nut.who], ["pending", [lily.id], lily.id, "王老师"]);
  assert.equal(ok(r.baseFor(lilyAgent)).base.length, 2, "waiting: not read yet");
  assert.deepEqual(r.baseOfPerson(john.person).map((x) => [x.text, x.state]), [["Lily，8 岁，三年二班", "kept"], ["上海", "kept"], ["Lily 对花生过敏", "pending"]]);
  bad(r.setBase(lilyAgent, nut.id, { keep: true }), 403);
  ok(r.setBase(john.by, nut.id, { keep: true }));
  assert.deepEqual(ok(r.baseFor(lilyAgent)).base.map((x) => x.text), ["Lily，8 岁，三年二班", "上海", "Lily 对花生过敏"], "记下: kept, and read");
  bad(r.setBase(john.by, nut.id, { keep: false }), 409, "这一条已经记下了");
  const later = ok(r.addBase(workAgent, { text: "周三下午不开会" })).item;
  ok(r.setBase(john.by, later.id, { keep: false }));
  assert.equal(r.baseOfPerson(john.person).some((x) => x.id === later.id), false, "不记: gone");
  // The person changes one: new words, given to another avatar too, then 删.
  ok(r.setBase(john.by, kid.id, { text: "Lily，9 岁，四年二班", for: [lily.id, work.id] }));
  assert.deepEqual(ok(r.baseFor(workAgent)).base.map((x) => x.text), ["Lily，9 岁，四年二班", "上海"]);
  bad(r.setBase(john.by, kid.id, { for: ["a-ffffffffff"] }), 400);
  bad(r.setBase(john.by, kid.id, {}), 400);
  ok(r.setBase(john.by, kid.id, { drop: true }));
  assert.deepEqual(ok(r.baseFor(workAgent)).base.map((x) => x.text), ["上海"]);
  bad(r.setBase(john.by, kid.id, { drop: true }), 404);
  bad(r.setBase(wang.by, nut.id, { drop: true }), 404, "没有这一条");
});

test("底子's pure part: entries folded from their blocks in order; an avatar's share; a line typed as 「家人：Lily，8 岁」 split at its first colon", () => {
  const items = baseOf([
    { id: "base-1", value: { label: "家人", text: "Lily", for: ["a-1"], state: "kept", by: "person", at: "t" } },
    { id: "base-2", value: { text: "过敏", for: ["a-1"], state: "pending", by: "a-1", who: "王老师", at: "t" } },
    { id: "baseset-1", value: { item: "base-1", text: "Lily，8 岁" } },
    { id: "lang-1", value: { lang: "zh" } },
  ]);
  assert.deepEqual(items.map((x) => [x.id, x.text, x.state]), [["base-1", "Lily，8 岁", "kept"], ["base-2", "过敏", "pending"]]);
  assert.deepEqual(baseFor(items, "a-1").map((x) => x.id), ["base-1"]);
  assert.deepEqual(splitBaseLine(" 家人：Lily，8 岁 "), { label: "家人", text: "Lily，8 岁" });
  assert.deepEqual(splitBaseLine("timezone: Shanghai"), { label: "timezone", text: "Shanghai" });
  assert.deepEqual(splitBaseLine("周三不开会"), { label: "", text: "周三不开会" });
});
