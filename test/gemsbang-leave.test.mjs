import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startAvatarRelay } from "../dist/relay/avatar-server.js";
import { runGb } from "../dist/gemsbang/ops.js";

const ok = (x) => { assert.equal(x.ok, true, x.reason); return x; };
const codeIn = (text) => /(\d{6})/.exec(text)[1];

test("退出群 in the client (S19): the 群主 hands the group to someone in it and leaves — it is gone from their list and their muting with it, and the others see who left and who keeps it; the last one leaves a group, and it is gone", async () => {
  const texts = [];
  const s = await startAvatarRelay({ root: mkdtempSync(join(tmpdir(), "gemsbang-leave-relay-")), name: "relay.test", texter: (t) => { texts.push(t); } });
  try {
    const home = mkdtempSync(join(tmpdir(), "gemsbang-leave-home-"));
    const gb = (call, args = {}) => runGb(call, args, { home, now: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), zoneMinutes: 0 });
    ok(await gb("setup", { relay: s.url }));
    ok(await gb("login-start", { phone: "13800138000" }));
    ok(await gb("login-verify", { phone: "13800138000", code: codeIn(texts.at(-1).text) }));
    const g = ok(await gb("group", { name: "设置页改版", avatarName: "John" })).chat;
    assert.equal(g.isOwner, true);
    const r = s.relay;
    ok(r.startLogin({ phone: "13900139000" }));
    const li = r.verify(ok(r.finishLogin({ phone: "13900139000", code: codeIn(texts.at(-1).text) })).token);
    const liA = ok(r.growAvatar(li, { name: "李四" })).avatar;
    ok(r.addMember(r.verify(JSON.parse(readFileSync(join(home, "client.json"), "utf8")).token), g.owner, g.id, { as: g.as.id, avatar: liA.id }));
    ok(await gb("mute", { venue: `${g.owner}/${g.id}` }));
    assert.equal((await gb("leave", { owner: g.owner, id: g.id })).reason, "你是群主，先选一个群里的人接手");
    const view = ok(await gb("leave", { owner: g.owner, id: g.id, heir: liA.id })).view;
    assert.deepEqual([view.rows.map((x) => x.name), view.muted.venues], [[], []], "gone from the list, its muting with it");
    const theirs = r.venueView(g.owner, g.id, liA.id);
    assert.deepEqual([theirs.keeper, theirs.members.map((m) => m.name), theirs.former.map((m) => m.name)], [liA.id, ["李四"], ["John"]]);
    const lines = ok(r.read(li, g.owner, `venues/${g.id}.geml`)).blocks.map((b) => b.id.replace(/-\d+$/, ""));
    assert.deepEqual(lines.slice(-2), ["owner", "leave"], "the group says who left and who keeps it");
    const alone = ok(await gb("group", { name: "只有我", avatarName: "John" })).chat;
    assert.equal((await gb("leave", { owner: alone.owner, id: alone.id })).ok, true);
    assert.equal(r.venueView(alone.owner, alone.id), undefined, "the last one out: the group is gone");
    assert.equal((await gb("open", { owner: alone.owner, id: alone.id })).ok, false);
  } finally {
    await s.close();
  }
});
