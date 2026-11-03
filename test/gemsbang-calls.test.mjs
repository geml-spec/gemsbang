import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startAvatarRelay } from "../dist/relay/avatar-server.js";
import { runGb } from "../dist/gemsbang/ops.js";

const ok = (x) => { assert.equal(x.ok, true, x.reason); return x; };
const codeIn = (text) => text.match(/(\d{6})/)[1];

test("被叫到 in the client (architecture §6.3): a line that calls the avatar is a call in the view; 不回 lets it go; 回 hands back a round for that chat, replying to the line with its hops; its answer lands as the avatar's agent, and when it asks, a card with nothing said first; 以后这个群自动回 keeps the chat on the avatar, and the session that speaks for it gets its rounds", async () => {
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
    assert.equal(ok(await gb("status", { session: "s-0" })).view.firstSession, "s-0", "the first session after the install, kept (Q14)");
    assert.equal(ok(await gb("status", { session: "s-9" })).view.firstSession, "s-0", "kept once");
    assert.equal(ok(await gb("status")).view.zoneMinutes, 0, "the machine's zone, for the pane's card times");
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
    assert.deepEqual([lines.at(-1).value.text, lines.at(-1).id], ["@John 今天能看吗", m2.id], "it asked: nothing said in the chat until the person answers");
    view = ok(await gb("status")).view;
    assert.deepEqual([view.needs.map((n) => [n.kind, n.summary, n.from]), view.calls], [[["promise", "李四要你周五前给稿子反馈", liA.id]], []], "the card it asked; the call was let go when it was handed over");

    say("@John 那配色呢");
    ok(await gb("bind", { session: "s-1", avatar: me }));
    const auto = ok(await gb("wake", { avatar: me, owner: g.owner, id: g.id, choice: "auto" }));
    assert.match(auto.round.prompt, /这个聊天他设成了自动回/);
    assert.deepEqual(auto.view.avatars[0].autos, [{ venue, name: "设置页改版" }]);
    assert.deepEqual(r.autoOf(me), [venue], "kept on the avatar");
    say("@John 还有登录页");
    const unplayed = ok(await gb("status")).view;
    assert.deepEqual([unplayed.played, unplayed.calls.map((c) => [c.group, c.auto, c.unplayed])], [[], [["设置页改版", false, true]]], "no open session plays John yet: the person is asked (B1)");
    ok(await gb("bind", { session: "s-3", avatar: "a-ffffffffff" }));
    assert.deepEqual(ok(await gb("rounds", { session: "s-3" })).rounds, [], "a session that plays another avatar gets none");
    const rounds = ok(await gb("rounds", { session: "s-2" })).rounds;
    assert.deepEqual(rounds.map((x) => [x.group, x.hops]), [["设置页改版", 0]], "a new session plays the avatar last spoken as (S21), and takes it");
    assert.deepEqual(ok(await gb("rounds", { session: "s-1" })).rounds, [], "handed out once: one session only");
    assert.equal(ok(await gb("status")).view.bodies["s-2"], me, "kept for that session from then on");
    const live = ok(await gb("status")).view;
    assert.deepEqual([live.played.includes(me), live.calls], [true, []], "a session came for its rounds: it plays John, and the chat answers on its own again");
    assert.deepEqual(ok(await gb("auto", { avatar: me, venue, on: false })).view.avatars[0].autos, [], "撤");
  } finally {
    await s.close();
  }
});

test("a round that fails (B3): its call comes back to the person with why — the line let go before it again — until they hand it over again; an agent that judged nothing needs saying folds away; in a chat set to answer on its own, the failed call is asked, not handed out again, until the avatar speaks", async () => {
  const texts = [];
  const s = await startAvatarRelay({ root: mkdtempSync(join(tmpdir(), "gemsbang-failed-relay-")), name: "relay.test", texter: (t) => { texts.push(t); } });
  try {
    const home = mkdtempSync(join(tmpdir(), "gemsbang-failed-home-"));
    const gb = (call, args = {}) => runGb(call, args, { home, now: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), zoneMinutes: 0 });
    ok(await gb("setup", { relay: s.url }));
    ok(await gb("login-start", { phone: "13800138000" }));
    ok(await gb("login-verify", { phone: "13800138000", code: codeIn(texts.at(-1).text) }));
    const g = ok(await gb("group", { name: "设置页改版", avatarName: "John" })).chat;
    const me = g.as.id, r = s.relay;
    ok(r.startLogin({ phone: "13900139000" }));
    const li = r.verify(ok(r.finishLogin({ phone: "13900139000", code: codeIn(texts.at(-1).text) })).token);
    const liA = ok(r.growAvatar(li, { name: "李四" })).avatar;
    ok(r.addMember(r.verify(JSON.parse(readFileSync(join(home, "client.json"), "utf8")).token), g.owner, g.id, { as: me, avatar: liA.id }));
    const say = (text) => ok(r.say(li, g.owner, g.id, { as: liA.id, text })).message;
    const calls = async () => ok(await gb("status")).view.calls.map((c) => [c.lines.map((l) => l.text), c.auto, c.failed]);

    const m0 = say("@John 在吗");
    ok(await gb("wake", { avatar: me, owner: g.owner, id: g.id, choice: "no" }));
    say("@John 今天能看吗");
    const asked = ok(await gb("wake", { avatar: me, owner: g.owner, id: g.id, choice: "reply" }));
    assert.equal(asked.round.since, m0.id, "the line let go before it, for the call to come back to");
    assert.deepEqual(await calls(), [], "handed over: the card folds");
    const back = ok(await gb("round-failed", { ...asked.round, why: "error" })).view.calls;
    assert.deepEqual(back.map((c) => [c.lines.map((l) => l.text), c.failed]), [[["@John 今天能看吗"], "error"]], "back, with why, and only the lines after the one let go");
    const again = ok(await gb("wake", { avatar: me, owner: g.owner, id: g.id, choice: "reply" }));
    assert.deepEqual(again.view.calls, [], "handed over again: no longer marked");
    ok(await gb("round-done", { ...again.round, text: "" }));
    assert.deepEqual(await calls(), [], "it judged nothing needs saying: folded, nothing back");

    ok(await gb("bind", { session: "s-1", avatar: me }));
    ok(await gb("rounds", { session: "s-1" }));
    say("@John 那配色呢");
    const auto = ok(await gb("wake", { avatar: me, owner: g.owner, id: g.id, choice: "auto" }));
    ok(await gb("round-failed", { ...auto.round, why: "aborted" }));
    assert.deepEqual(await calls(), [[["@John 那配色呢"], false, "aborted"]], "a chat that answers on its own: the failed call is asked");
    assert.deepEqual(ok(await gb("rounds", { session: "s-1" })).rounds, [], "and not handed out again");
    say("@John 还有登录页");
    assert.deepEqual(await calls(), [[["@John 那配色呢", "@John 还有登录页"], false, "aborted"]], "a later line joins it, still the person's");
    ok(await gb("say", { owner: g.owner, id: g.id, text: "我晚点看" }));
    say("@John 好的，那明天？");
    assert.deepEqual(await calls(), [[["@John 好的，那明天？"], true, undefined]], "the avatar spoke since: a new call, answered on its own again");
    assert.deepEqual(ok(await gb("rounds", { session: "s-1" })).rounds.map((x) => x.group), ["设置页改版"]);
  } finally {
    await s.close();
  }
});
