import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startAvatarRelay } from "../dist/relay/avatar-server.js";
import { runGb } from "../dist/gemsbang/ops.js";

const ok = (x) => { assert.equal(x.ok, true, x.reason); return x; };
const codeIn = (text) => text.match(/(\d{6})/)[1];

test("被叫到 in the client (architecture §6.3): a line that calls the avatar is a call in the view; 不回 lets it go; 回 hands back a round for that chat, replying to the line with its hops; its answer lands as the avatar's agent, and a card when it asks; 以后这个群自动回 keeps the chat on the avatar, and the session that speaks for it gets its rounds", async () => {
  const texts = [];
  const s = await startAvatarRelay({ root: mkdtempSync(join(tmpdir(), "gemsbang-calls-relay-")), name: "relay.test", texter: (t) => { texts.push(t); } });
  try {
    const home = mkdtempSync(join(tmpdir(), "gemsbang-calls-home-"));
    const gb = (call, args = {}) => runGb(call, args, { home, now: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), zoneMinutes: 0 });
    ok(await gb("setup", { relay: s.url }));
    ok(await gb("login-start", { phone: "13800138000" }));
    ok(await gb("login-verify", { phone: "13800138000", code: codeIn(texts.at(-1).text) }));
    const g = ok(await gb("group", { name: "设置页改版", avatarName: "John" })).chat;
    const me = g.as.id, venue = `${g.owner}/${g.id}`;
    const r = s.relay;
    ok(r.startLogin({ phone: "13900139000" }));
    const li = r.verify(ok(r.finishLogin({ phone: "13900139000", code: codeIn(texts.at(-1).text) })).token);
    const liA = ok(r.growAvatar(li, { name: "李四" })).avatar;
    const john = r.verify(JSON.parse(readFileSync(join(home, "client.json"), "utf8")).token);
    ok(r.addMember(john, g.owner, g.id, { as: me, avatar: liA.id }));
    const say = (text) => ok(r.say(li, g.owner, g.id, { as: liA.id, text })).message;

    say("v4 稿子在这");
    assert.deepEqual(ok(await gb("status")).view.calls, [], "nobody called John");
    const m1 = say("@John 周五前能给稿子反馈吗？");
    let view = ok(await gb("status")).view;
    assert.deepEqual(view.calls.map((c) => [c.avatar, c.group, c.lines.map((l) => [l.who, l.reason]), c.last, c.auto, c.badge.initial]), [[me, "设置页改版", [["李四", "mention"]], m1.id, false, "J"]]);
    view = ok(await gb("wake", { avatar: me, owner: g.owner, id: g.id, choice: "no" })).view;
    assert.deepEqual(view.calls, [], "不回: let go");
    assert.equal((await gb("wake", { avatar: me, owner: g.owner, id: g.id, choice: "reply" })).code, "call.missing");

    const m2 = say("@John 今天能看吗");
    const asked = ok(await gb("wake", { avatar: me, owner: g.owner, id: g.id, choice: "reply" }));
    assert.deepEqual([asked.view.calls, asked.round.replyTo, asked.round.hops, asked.round.description], [[], m2.id, 0, "回「设置页改版」"]);
    assert.match(asked.round.prompt, /^你是「John」，在「设置页改版」里。你是一个人在这个场合里的分身：他让你回这一轮/);
    assert.match(asked.round.prompt, /李四：@John 今天能看吗\n$/);
    ok(await gb("round-done", { ...asked.round, text: JSON.stringify({ reply: "今天下午看", ask: { kind: "promise", summary: "李四要你周五前给稿子反馈", draft: "可以，周五前给你" } }) }));
    const lines = ok(r.read(li, g.owner, `venues/${g.id}.geml`)).blocks.filter((b) => typeof b.value.text === "string");
    assert.deepEqual([lines.at(-1).value.text, lines.at(-1).value.by, lines.at(-1).value.replyTo, lines.at(-1).value.hops], ["今天下午看", "agent", m2.id, 0]);
    view = ok(await gb("status")).view;
    assert.deepEqual([view.needs.map((n) => [n.kind, n.summary, n.from]), view.calls], [[["promise", "李四要你周五前给稿子反馈", liA.id]], []], "the card it asked; its own line ended the call");

    say("@John 那配色呢");
    ok(await gb("bind", { session: "s-1", avatar: me }));
    const auto = ok(await gb("wake", { avatar: me, owner: g.owner, id: g.id, choice: "auto" }));
    assert.match(auto.round.prompt, /这个聊天他设成了自动回/);
    assert.deepEqual(auto.view.avatars[0].autos, [{ venue, name: "设置页改版" }]);
    assert.deepEqual(r.autoOf(me), [venue], "kept on the avatar");
    say("@John 还有登录页");
    ok(await gb("status"));
    assert.deepEqual(ok(await gb("rounds", { session: "s-2" })).rounds, [], "only the session that speaks for it");
    const rounds = ok(await gb("rounds", { session: "s-1" })).rounds;
    assert.deepEqual(rounds.map((x) => [x.group, x.hops]), [["设置页改版", 0]]);
    assert.deepEqual(ok(await gb("rounds", { session: "s-1" })).rounds, [], "handed out once");
    assert.deepEqual(ok(await gb("auto", { avatar: me, venue, on: false })).view.avatars[0].autos, [], "撤");
  } finally {
    await s.close();
  }
});
