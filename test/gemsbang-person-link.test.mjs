import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startAvatarRelay } from "../dist/relay/avatar-server.js";
import { runGb } from "../dist/gemsbang/ops.js";

const ok = (x) => { assert.equal(x.ok, true, x.reason); return x; };
const codeIn = (text) => text.match(/(\d{6})/)[1];

test("an avatar's own link in the client (S37): the same until it is reset; another person pastes it and is in a two-person chat with that avatar, no group shared; both see the chat and each other in 联系人; one's own link is refused", async () => {
  const texts = [];
  const s = await startAvatarRelay({ root: mkdtempSync(join(tmpdir(), "gemsbang-plink-relay-")), name: "relay.test", texter: (t) => { texts.push(t); } });
  try {
    const client = async (phone, name) => {
      const home = mkdtempSync(join(tmpdir(), "gemsbang-plink-home-"));
      const gb = (call, args = {}) => runGb(call, args, { home, now: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), zoneMinutes: 0 });
      ok(await gb("setup", { relay: s.url }));
      ok(await gb("login-start", { phone }));
      ok(await gb("login-verify", { phone, code: codeIn(texts.at(-1).text) }));
      const avatar = ok(await gb("first-avatar", { name })).view.avatars[0];
      return { gb, avatar };
    };
    const john = await client("13800138000", "John");
    const link = ok(await john.gb("my-link", { as: john.avatar.id })).link;
    assert.deepEqual([link.kind, link.group, link.days, link.url.endsWith(`/u/${link.code}`)], ["person", "John", 7, true]);
    assert.equal(link.line, `请阅读 ${s.url}/u/${link.code}.md 并按说明操作：以我的身份与 John 私聊。`);
    assert.equal(ok(await john.gb("my-link", { as: john.avatar.id })).link.code, link.code, "the same until reset");
    assert.equal((await john.gb("join", { url: link.url })).ok, false, "one's own link is refused");
    const mei = await client("13900139000", "Mei");
    const info = ok(await mei.gb("link-info", { url: link.url })).info;
    assert.deepEqual([info.kind, info.avatar.name, info.you.pick.kind], ["person", "John", "known"]);
    const joined = ok(await mei.gb("join", { url: link.url }));
    assert.deepEqual([joined.joined.venue.kind, joined.joined.venue.name], ["dm", "John"]);
    assert.deepEqual(joined.view.rows.map((r) => [r.kind, r.name]), [["dm", "John"]]);
    assert.deepEqual(joined.view.contacts.map((c) => [c.name, c.dm?.id]), [["John", joined.joined.venue.id]]);
    const seen = ok(await john.gb("status")).view;
    assert.deepEqual([seen.rows.map((r) => r.name), seen.contacts.map((c) => c.name)], [["Mei"], ["Mei"]], "John sees her chat and her in 联系人");
    const reset = ok(await john.gb("my-rotate", { as: john.avatar.id })).link;
    assert.notEqual(reset.code, link.code);
    assert.equal((await mei.gb("link-info", { url: link.url })).ok, false, "the old link stopped");
  } finally {
    await s.close();
  }
});

test("发起群聊 with contacts ticked (S38, Q26 (a)): the group is made and they are in it at once, asked nobody; a blank name is the names joined; each of them sees 「John 邀请你、…加入了群聊」 as its last line; none ticked, a name is still needed", async () => {
  const texts = [];
  const s = await startAvatarRelay({ root: mkdtempSync(join(tmpdir(), "gemsbang-pick-relay-")), name: "relay.test", texter: (t) => { texts.push(t); } });
  try {
    const client = async (phone, name) => {
      const home = mkdtempSync(join(tmpdir(), "gemsbang-pick-home-"));
      const gb = (call, args = {}) => runGb(call, args, { home, now: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), zoneMinutes: 0 });
      ok(await gb("setup", { relay: s.url }));
      ok(await gb("login-start", { phone }));
      ok(await gb("login-verify", { phone, code: codeIn(texts.at(-1).text) }));
      const avatar = ok(await gb("first-avatar", { name })).view.avatars[0];
      return { gb, avatar };
    };
    const john = await client("13800138000", "John");
    const link = ok(await john.gb("my-link", { as: john.avatar.id })).link;
    const mei = await client("13900139000", "Mei"), zhou = await client("13700137000", "周");
    ok(await mei.gb("join", { url: link.url }));
    ok(await zhou.gb("join", { url: link.url }));
    const contacts = ok(await john.gb("status")).view.contacts;
    assert.deepEqual(contacts.map((c) => c.name).sort(), ["Mei", "周"]);
    const made = ok(await john.gb("group", { name: "", as: john.avatar.id, members: contacts.map((c) => c.id) }));
    assert.deepEqual([made.chat.kind, made.chat.count], ["group", 3]);
    assert.equal([...made.chat.name].length <= 40 && made.chat.name.startsWith("John、"), true, made.chat.name);
    assert.deepEqual(made.chat.items.map((i) => i.kind), ["joined", "invited"]);
    const seen = ok(await mei.gb("status")).view.rows.find((r) => r.kind === "group");
    assert.equal(seen.name, made.chat.name, "she is in it");
    assert.match(seen.last.text, /^John 邀请你、周加入了群聊$|^John 邀请周、你加入了群聊$/);
    assert.equal((await john.gb("group", { name: "", as: john.avatar.id })).ok, false, "none ticked: a name is needed");
  } finally {
    await s.close();
  }
});
