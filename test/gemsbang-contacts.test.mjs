import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startAvatarRelay } from "../dist/relay/avatar-server.js";
import { runGb } from "../dist/gemsbang/ops.js";
import { contactsOf, letterOf } from "../dist/core/avatar/contacts.js";

const ok = (x) => { assert.equal(x.ok, true, x.reason); return x; };
const codeIn = (text) => text.match(/(\d{6})/)[1];

test("a name's letter (S34): a Latin letter as it is, a Chinese name by its pinyin, anything else #", () => {
  assert.deepEqual(["李四", "刘备", "Mia", "mia", "王老师", "张三", "周", "欧阳", "1号", "😀"].map(letterOf), ["L", "L", "M", "M", "W", "Z", "Z", "O", "#", "#"]);
});

test("联系人 from the mirror (S34, Q22 (a)): the others in the person's groups and two-person chats, one per pair of avatars, never the person's own; the groups they share and their chat; by letter, then name, # last", () => {
  const card = (id, name) => ({ id, name });
  const john = card("a-1", "John"), lily = card("a-2", "Lily 爸爸"), li = card("b-1", "李四"), wang = card("b-2", "王老师"), odd = card("b-3", "1号");
  const venue = (id, kind, name, as, members) => ({ owner: as.id, id, kind, name, as: as.id, members, blocks: [] });
  const m = { at: "", relay: "", person: "p", lang: "zh", avatars: [john, lily], venues: [
    venue("g-1", "group", "设置页改版", john, [john, li, lily]),
    venue("g-2", "group", "前端周会", john, [john, li, odd]),
    venue("g-3", "group", "三年二班家长", lily, [lily, wang, li]),
    venue("d-1", "dm", "王老师", lily, [lily, wang]),
  ] };
  const got = contactsOf(m).map((c) => [c.letter, c.name, c.as.name, c.groups.map((g) => `${g.name} ${g.count}`), c.dm?.id]);
  assert.deepEqual(got, [
    ["L", "李四", "John", ["设置页改版 3", "前端周会 3"], undefined],
    ["L", "李四", "Lily 爸爸", ["三年二班家长 3"], undefined],
    ["W", "王老师", "Lily 爸爸", ["三年二班家长 3"], "d-1"],
    ["#", "1号", "John", ["前端周会 3"], undefined],
  ], "Lily 爸爸 in John's group is the person's own, so nobody's contact");
});

test("发消息 in the client (S35): the two-person chat of the person's avatar with someone it shares a group with — opened the first time, the same one after — in the list as their name, and they in 联系人 with it; someone it shares no group with, refused", async () => {
  const texts = [];
  const s = await startAvatarRelay({ root: mkdtempSync(join(tmpdir(), "gemsbang-contacts-relay-")), name: "relay.test", texter: (t) => { texts.push(t); } });
  try {
    const home = mkdtempSync(join(tmpdir(), "gemsbang-contacts-home-"));
    const gb = (call, args = {}) => runGb(call, args, { home, now: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), zoneMinutes: 0 });
    ok(await gb("setup", { relay: s.url }));
    ok(await gb("login-start", { phone: "13800138000" }));
    ok(await gb("login-verify", { phone: "13800138000", code: codeIn(texts.at(-1).text) }));
    const g = ok(await gb("group", { name: "设置页改版", avatarName: "John" })).chat;
    const r = s.relay;
    ok(r.startLogin({ phone: "13900139000" }));
    const li = r.verify(ok(r.finishLogin({ phone: "13900139000", code: codeIn(texts.at(-1).text) })).token);
    const liA = ok(r.growAvatar(li, { name: "李四" })).avatar;
    const stranger = ok(r.growAvatar(li, { name: "路人" })).avatar;
    ok(r.addMember(r.verify(JSON.parse(readFileSync(join(home, "client.json"), "utf8")).token), g.owner, g.id, { as: g.as.id, avatar: liA.id }));
    const known = ok(await gb("status")).view.contacts;
    assert.deepEqual(known.map((c) => [c.name, c.as.name, c.groups.map((x) => x.name), c.dm]), [["李四", "John", ["设置页改版"], undefined]]);
    const first = ok(await gb("dm-open", { as: g.as.id, with: liA.id }));
    assert.deepEqual([first.chat.kind, first.chat.name, first.chat.members.map((x) => x.name).sort()], ["dm", "李四", ["John", "李四"].sort()]);
    const again = ok(await gb("dm-open", { as: g.as.id, with: liA.id }));
    assert.deepEqual([again.chat.owner, again.chat.id], [first.chat.owner, first.chat.id], "one chat per pair");
    assert.deepEqual(again.view.rows.filter((x) => x.kind === "dm").map((x) => x.name), ["李四"]);
    assert.deepEqual(again.view.contacts.map((c) => [c.name, c.dm?.id]), [["李四", first.chat.id]]);
    assert.equal((await gb("dm-open", { as: g.as.id, with: stranger.id })).ok, false, "no group shared: no chat");
  } finally {
    await s.close();
  }
});
