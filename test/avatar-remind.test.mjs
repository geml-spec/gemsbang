import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AvatarRelay } from "../dist/relay/avatars.js";

const BASE = Date.UTC(2026, 10, 3, 9, 0, 0);
const ok = (x) => { assert.equal(x.ok, true, x.reason); return x; };

test("reminders by mail (S8, Q8): a person on the web — no device of theirs runs the plugin — gets a mail when someone @s their avatar or answers its line, with the line and the group's page, at most one a group in three hours; someone with the plugin gets none (their pane says it), nor does anyone for their own line", () => {
  let offset = 0;
  const mails = [];
  const now = () => { const t = new Date(BASE + offset).toISOString().replace(/\.\d{3}Z$/, "Z"); offset += 1000; return t; };
  const r = new AvatarRelay({ root: mkdtempSync(join(tmpdir(), "gemsbang-remind-")), name: "gemsbang.test", now, mailer: (m) => { mails.push(m); } });
  const login = (email, device) => {
    ok(r.startLogin({ email, lang: "zh" }));
    const code = /(\d{6})/.exec(mails.at(-1).text)[1];
    mails.length = 0;
    const done = ok(r.finishLogin({ email, code, device, lang: "zh" }));
    return r.verify(done.token);
  };
  const john = login("john@example.com", "Mac · Claude Code"), chen = login("chen@example.com", "网页 · Safari");
  const lily = ok(r.growAvatar(john, { name: "Lily 爸爸" })).avatar, mom = ok(r.growAvatar(chen, { name: "陈晨妈妈" })).avatar;
  const g = ok(r.createGroup(john, { as: lily.id, name: "三年二班家长" })).venue;
  ok(r.addMember(john, g.owner, g.id, { as: lily.id, avatar: mom.id }));
  ok(r.say(john, g.owner, g.id, { as: lily.id, text: "@陈晨妈妈 周五家长会你去吗？" }));
  assert.deepEqual(mails.map((m) => [m.to, m.subject]), [["chen@example.com", "Lily 爸爸 在「三年二班家长」中 @ 了你"]]);
  assert.equal(mails[0].text, "「@陈晨妈妈 周五家长会你去吗？」\n\n打开群聊：https://gemsbang.test/g/" + g.id + "\n\n同一群聊几小时内最多提醒一次。");
  ok(r.say(john, g.owner, g.id, { as: lily.id, text: "@陈晨妈妈 在吗" }));
  assert.equal(mails.length, 1, "one a group in three hours");
  const hers = ok(r.say(chen, g.owner, g.id, { as: mom.id, text: "@Lily 爸爸 我去" })).message;
  assert.equal(mails.length, 1, "Lily 爸爸's person has the plugin: the pane says it; nor is she mailed for her own line");
  offset += 3 * 3_600_000;
  ok(r.say(john, g.owner, g.id, { as: lily.id, text: "好的", replyTo: hers.id }));
  assert.deepEqual(mails.slice(1).map((m) => m.subject), ["Lily 爸爸 在「三年二班家长」中回复了你"], "three hours on, a reply to her line");
});
