import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startAvatarRelay } from "../dist/relay/avatar-server.js";
import { runGb } from "../dist/gemsbang/ops.js";

const ok = (x) => { assert.equal(x.ok, true, x.reason); return x; };

test("the hosted body in the client (spec §7.5, §8.3): 我的分身 shows each avatar's rounds this week, whether it only receives, 暂停自动回复, the quota and how the person pays; a chat names whoever answers only when here", async () => {
  const texts = [];
  const s = await startAvatarRelay({ root: mkdtempSync(join(tmpdir(), "gemsbang-hosted-relay-")), name: "relay.test", texter: (t) => { texts.push(t); }, hosted: { runner: async () => ({ ok: true, text: "好的" }), replies: 1 } });
  try {
    const home = mkdtempSync(join(tmpdir(), "gemsbang-hosted-home-"));
    const gb = (call, args = {}) => runGb(call, args, { home, now: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), zoneMinutes: 0 });
    ok(await gb("setup", { relay: s.url }));
    ok(await gb("login-start", { phone: "13800138000" }));
    ok(await gb("login-verify", { phone: "13800138000", code: /(\d{6})/.exec(texts.at(-1).text)[1] }));
    const g = ok(await gb("group", { name: "三年二班家长", avatarName: "王老师" })).chat;
    let view = ok(await gb("status")).view;
    assert.deepEqual([view.avatars[0].paused, view.avatars[0].away, view.avatars[0].week], [false, false, 0]);
    assert.deepEqual(view.quota, { free: true, daysLeft: 7, repliesLeft: 1, key: false });
    // Another person's avatar in the group: one free reply, then it only receives.
    const r = s.relay;
    ok(r.startLogin({ phone: "13900139000" }));
    const li = r.verify(ok(r.finishLogin({ phone: "13900139000", code: /(\d{6})/.exec(texts.at(-1).text)[1] })).token);
    const liA = ok(r.growAvatar(li, { name: "李四" })).avatar;
    const wang = r.verify(JSON.parse((await import("node:fs")).readFileSync(join(home, "client.json"), "utf8")).token);
    ok(r.addMember(wang, g.owner, g.id, { as: g.as.id, avatar: liA.id }));
    ok(r.setHosted(wang, g.as.id, { paused: true }));
    ok(await gb("say", { owner: g.owner, id: g.id, text: "@李四 周五能来吗？" }));
    await s.hosted.idle();
    ok(await gb("say", { owner: g.owner, id: g.id, text: "@李四 在吗？" }));
    await s.hosted.idle();
    const chat = ok(await gb("open", { owner: g.owner, id: g.id })).chat;
    assert.deepEqual(chat.items.filter((i) => i.kind === "message").map((i) => [i.who, i.text]), [["王老师", "@李四 周五能来吗？"], ["李四", "好的"], ["王老师", "@李四 在吗？"]]);
    assert.deepEqual(chat.away, ["李四"]);
    view = ok(await gb("pause", { avatar: g.as.id, paused: false })).view;
    assert.equal(view.avatars[0].paused, false);
    view = ok(await gb("key", { apiKey: "sk-test-1" })).view;
    assert.equal(view.quota.key, true);
    assert.equal(JSON.stringify(view).includes("sk-test-1"), false, "the key is not kept by the client");
    view = ok(await gb("key", {})).view;
    assert.equal(view.quota.key, false);
  } finally {
    await s.close();
  }
});
