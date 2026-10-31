import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitRepo, hook } from "./helpers/repo.mjs";
import { startRelay } from "../dist/relay/server.js";
import { Daemon } from "../dist/daemon/sync.js";
import { listOutbox, listSessions, writeConfig } from "../dist/daemon/home.js";

const tmp = (p) => mkdtempSync(join(tmpdir(), p));
async function world() {
  const s = await startRelay({ root: tmp("gemworks-relay-"), name: "relay.test" });
  const john = s.relay.issuePerson("john");
  const zhang = s.relay.issuePerson("zhangsan");
  const lisi = s.relay.issuePerson("lisi");
  const xiaoping = s.relay.issueAgent(john.record, "xiaoping");
  s.relay.createVenue(john.record, { id: "g-7", kind: "group", name: "前端周会", people: ["zhangsan"], agents: ["agent:xiaoping@john"] });
  s.relay.createVenue(john.record, { id: "g-8", kind: "group", name: "先看", people: ["zhangsan"], agents: ["agent:xiaoping@john"], policy: { draftFirst: true } });
  const home = tmp("gemworks-im-");
  writeConfig(home, { relay: { url: s.url, name: "relay.test" }, person: "john", token: john.token, agents: { xiaoping: xiaoping.token } });
  const root = gitRepo();
  const env = { GEMWORKS_IM_HOME: home, GEMWORKS_GH: "gh-definitely-not-installed" };
  return { s, john, zhang, lisi, xiaoping, home, root, env, daemon: new Daemon({ home }), ask: (req) => hook(root, req, env) };
}

test("status, refresh and attention carry the IM when the home is set up, with the unread by the marks sent; a project without a workflow still gets it", async () => {
  const { s, zhang, home, daemon, ask } = await world();
  try {
    s.relay.appendMessage(zhang.record, "john", "g-7", { id: "m-1", text: "@xiaoping 跑一下" });
    s.relay.appendMessage(zhang.record, "john", "g-7", { id: "m-2", text: "再说" });
    await daemon.syncOnce();
    const status = ask({ op: "status" });
    assert.equal(status.ok, true);
    assert.equal(status.shell.status, null, "no workflow here");
    assert.deepEqual([status.im.configured, status.im.person, status.im.agents, status.im.connected, status.im.venues.map((v) => [v.id, v.unread])], [true, "john", ["xiaoping"], true, [["g-7", 2], ["g-8", 0]]]);
    assert.deepEqual(ask({ op: "status", imSeen: { "john/g-7": "m-1" } }).im.venues.map((v) => v.unread), [1, 0]);
    assert.equal(ask({ op: "refresh" }).im?.configured, true);
    assert.equal(ask({ op: "attention" }).im?.configured, true);
    assert.equal(ask({ op: "before", tool: "Read", callId: "c1", input: {}, cwd: "." }).im, undefined, "a cheap op reads no mirrors");
    assert.equal(hook(gitRepo(), { op: "status" }, { GEMWORKS_IM_HOME: tmp("gemworks-im-"), GEMWORKS_GH: "gh-definitely-not-installed" }).im, undefined, "not set up: nothing");
    const explicit = ask({ op: "im-status", imSeen: { "john/g-7": "m-2" } });
    assert.deepEqual([explicit.ok, explicit.im.venues[0].unread], [true, 0]);
    void home;
  } finally {
    await s.close();
  }
});

test("a thread, a word as the person, the next item taken and answered, a draft sent, presence, a need answered, a read, a forward", async () => {
  const { s, zhang, lisi, home, daemon, ask } = await world();
  try {
    s.relay.appendMessage(zhang.record, "john", "g-7", { id: "m-1", text: "@xiaoping 跑一下" });
    s.relay.appendMessage(zhang.record, "john", "g-8", { id: "n-1", text: "@xiaoping 看看" });
    await daemon.syncOnce();
    const thread = ask({ op: "im-venue", owner: "john", id: "g-7" });
    assert.deepEqual([thread.ok, thread.thread.name, thread.thread.messages.map((m) => m.id)], [true, "前端周会", ["m-1"]]);
    assert.equal(ask({ op: "im-venue", owner: "john", id: "none" }).ok, false);
    const said = ask({ op: "im-say", owner: "john", venue: "g-7", text: "大家好" });
    assert.equal(said.ok, true);
    assert.match(said.text, /^排入待发 o-/);
    const next = ask({ op: "im-next", agent: "xiaoping", take: true });
    assert.deepEqual([next.ok, next.delivered.item.id, next.delivered.scope, next.delivered.draftFirst], [true, "qi-g-7-m-1", { write: false, run: "none", budget: 20 }, false]);
    assert.match(next.delivered.text, /^\[来自 群「前端周会」 · zhangsan（成员） · 权限：只读 · 回复将发回该群，成员可见 · 队列中还有 1 条\]\n@xiaoping 跑一下$/);
    assert.deepEqual(listOutbox(home).map((e) => [e.kind, e.kind === "marker" ? e.body.kind : e.body.text]), [["message", "大家好"], ["marker", "read"]], "take marks it read");
    assert.equal(ask({ op: "im-next", agent: "xiaoping" }).delivered.item.id, "qi-g-8-n-1", "the read one is not offered again; without take, no marker");
    assert.equal(ask({ op: "im-next", agent: "nobody" }).delivered, undefined);
    const answered = ask({ op: "im-answer", agent: "xiaoping", item: next.delivered.item, text: "跑完了", kind: "report", session: "cc-1", evidence: [{ src: "https://relay.test/john/venues/g-7.geml#m-1" }] });
    assert.match(answered.answered.sent, /^https:\/\/relay\.test\/john\/venues\/g-7\.geml#m-/);
    const second = ask({ op: "im-next", agent: "xiaoping", take: true });
    const held = ask({ op: "im-answer", agent: "xiaoping", item: second.delivered.item, text: "看过了", session: "cc-1" });
    assert.match(held.answered.draft, /^d-/);
    assert.equal(ask({ op: "im-draft", id: held.answered.draft, send: true, text: "看过了，改过" }).ok, true);
    assert.equal(ask({ op: "im-draft", id: "d-nothing", send: true }).ok, false);
    assert.equal(ask({ op: "im-presence", agent: "xiaoping", session: "cc-1", presence: "tool", task: "#42", login: "api" }).ok, true);
    assert.deepEqual(listSessions(home).map((x) => [x.agent, x.session, x.report.presence, x.report.host, x.report.login, x.report.task]), [["xiaoping", "cc-1", "tool", "claude-code", "api", "#42"]]);
    s.relay.appendMessage(s.relay.issueAgent({ speaker: "person:john", scope: "person" }, "xiaoping").record, "john", "g-7", { id: "m-ask", kind: "ask", text: "合吗", ask: { question: "合吗", options: ["合"], who: "person:john" } });
    s.relay.requestGrant(lisi.record, "john", "https://relay.test/john/sessions/cc-1.geml#turn-3", "看看");
    s.relay.askCredits(s.relay.issueAgent({ speaker: "person:john", scope: "person" }, "xiaoping").record, { credits: 5, cap: "auto", note: "还差一个 skill" });
    s.relay.draftDigest(s.relay.issueAgent({ speaker: "person:john", scope: "person" }, "xiaoping").record, { text: "今天修好了缓存" });
    s.relay.proposeMatch(lisi.record, { person: "john", note: "都在做 PDF" });
    const r = await daemon.syncOnce();
    assert.deepEqual([r.pushed, r.failed, r.heartbeats], [7, 0, 1], "the word, two reads, the report and its answered marker, the sent draft and its marker");
    const needs = ask({ op: "status" }).im.needs;
    assert.deepEqual(needs.map((n) => n.kind), ["decide", "decide", "decide", "grant", "grant"]);
    assert.equal(ask({ op: "im-need", key: needs[0].key, action: "合" }).ok, true);
    assert.equal(ask({ op: "im-need", key: needs[0].key, action: "自己写", text: "合，但先改名字" }).ok, true);
    assert.equal(ask({ op: "im-need", key: needs[3].key, action: "允许此人" }).ok, true);
    assert.deepEqual([needs[4].text, needs[4].actions], ["xiaoping 想再花 5 积分（自动买东西）：还差一个 skill", ["今天再 5", "不行"]]);
    assert.equal(ask({ op: "im-need", key: needs[4].key, action: "今天再 5" }).ok, true);
    assert.deepEqual([needs[1].text, needs[2].text], ["xiaoping 起草了日报：今天修好了缓存", "牵线：lisi 想和你互相亮名片：都在做 PDF"]);
    assert.equal(ask({ op: "im-need", key: needs[1].key, action: "发" }).ok, true);
    assert.equal(ask({ op: "im-need", key: needs[2].key, action: "亮名片" }).ok, true);
    assert.equal(ask({ op: "im-need", key: "offline:relay", action: "重试" }).ok, true);
    assert.equal(ask({ op: "im-need", key: "nonsense", action: "x" }).ok, false);
    assert.deepEqual(listOutbox(home).map((e) => [e.kind, e.body.replyTo ?? e.body.person, e.body.text ?? e.body.once]), [["message", "m-ask", "合"], ["message", "m-ask", "合，但先改名字"], ["grant", "lisi", undefined], ["allow", undefined, undefined], ["digest", undefined, undefined], ["match", undefined, undefined]]);
    const read = ask({ op: "im-read", owner: "john", venue: "g-7", limit: 3 });
    assert.match(read.text, /^群「前端周会」· 最近 3 条/);
    assert.equal(ask({ op: "im-read", src: "https://relay.test/john/venues/g-7.geml#m-1" }).text, "@xiaoping 跑一下");
    assert.match(ask({ op: "im-read" }).text, /^群「先看」（john\/g-8）· 2 人 · 1 个 agent\n群「前端周会」（john\/g-7）/, "the venues newest first: the sent draft was the last word");
    const fwd = ask({ op: "im-forward", from: "john/g-7#m-1", to: "john/g-8", note: "转给你们看" });
    assert.equal(fwd.ok, true);
    const forwarded = listOutbox(home).at(-1);
    assert.deepEqual([forwarded.doc, forwarded.body.text, forwarded.body.parts], ["venues/g-8.geml", "转给你们看", [{ src: "https://relay.test/john/venues/g-7.geml#m-1" }]]);
    assert.equal(ask({ op: "im-forward", from: "nope", to: "john/g-8" }).ok, false);
    const r2 = await daemon.syncOnce();
    assert.deepEqual([r2.pushed, r2.failed], [7, 0]);
  } finally {
    await s.close();
  }
});

import { spawn } from "node:child_process";
import { BUNDLE } from "./helpers/repo.mjs";

/** One bridge request through the bundled CLI, asynchronously: the relay serving it lives in this process, whose loop a spawnSync would hold. */
const askProcess = (root, req, env) => new Promise((done, failed) => {
  const child = spawn(process.execPath, [BUNDLE, "hook"], { cwd: root, env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
  let out = "", err = "";
  child.stdout.on("data", (c) => { out += c; });
  child.stderr.on("data", (c) => { err += c; });
  const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
  child.on("exit", (code) => { clearTimeout(timer); const lines = out.trim().split("\n"); if (code !== 0 || lines.length !== 1) failed(new Error(`hook exit ${code}: ${out}${err}`)); else done(JSON.parse(lines[0])); });
  child.stdin.end(JSON.stringify({ v: 1, root, ...req }));
});

test("im-card through the hook (plan G): a card drafted and published answers the card and its line; a verb the relay refuses is an error answer; an unknown action too; in this process the op is refused, as it waits on the relay", async () => {
  const { s, john, root, env, ask } = await world();
  try {
    s.relay.createVenue(john.record, { id: "g-9", kind: "group", name: "评稿", people: ["zhangsan"], agents: ["agent:xiaoping@john"] });
    const askP = (req) => askProcess(root, req, env);
    const made = await askP({ op: "im-card", action: "new", body: { title: "给设置页加导出 PDF", goal: "一个按钮", accepts: [{ text: "人点收", verify: { kind: "human" } }], direction: "outsource", venueOfWork: "worker-sandbox" } });
    assert.equal(made.ok, true, made.error);
    assert.deepEqual([made.card.card.state, made.card.line, made.card.address], ["draft", "起草 · 给设置页加导出 PDF", `https://relay.test/john/cards/${made.card.card.id}.geml`]);
    const id = made.card.card.id;
    const published = await askP({ op: "im-card", action: "publish", owner: "john", id, body: { venue: "john/g-9" } });
    assert.deepEqual([published.ok, published.card.before, published.card.card.state, published.card.line], [true, "draft", "open", "草拟 → 发布"]);
    const claim = await askP({ op: "im-card", action: "claim", owner: "john", id, as: "xiaoping" });
    assert.deepEqual([claim.ok, claim.error], [false, "gemworks: 订阅登录的会话不接单（xiaoping 还没有 API 或自托管的会话）"]);
    assert.match((await askP({ op: "im-card", action: "nope" })).error, /不认识的动作/);
    assert.match((await askP({ op: "im-card", action: "show", owner: "john", id })).card.line, /^#t-[0-9a-f]{4} 给设置页加导出 PDF · 外包 · 草拟 · \[发布\]/);
    assert.match(ask({ op: "im-card", action: "list" }).error, /handleRequest/, "the synchronous path says where the op goes");
  } finally {
    await s.close();
  }
});

test("im-brief through the hook (plan K): the owner's line makes their DM with the agent when there is none and goes into it as the owner's word, which the agent's next turn drafts from; 改一下 under a draft says its words the same way; in this process the op is refused, as it waits on the relay", async () => {
  const { s, john, home, root, env, daemon, ask } = await world();
  try {
    const askP = (req) => askProcess(root, req, env);
    const b = await askP({ op: "im-brief", text: "去帮李四评一下设置页，别花超过 20 积分" });
    assert.deepEqual([b.ok, b.brief], [true, { venue: "john/dm-xiaoping" }], b.error);
    const dm = s.relay.venueOf("john", "dm-xiaoping");
    assert.deepEqual([dm.venue.kind, dm.venue.people, dm.venue.agents], ["dm", ["john"], ["xiaoping"]]);
    await daemon.syncOnce();
    const said = s.relay.venueOf("john", "dm-xiaoping").messages;
    assert.deepEqual([said.length, said[0].speaker, said[0].text], [1, "person:john", "起草一张委托书：去帮李四评一下设置页，别花超过 20 积分。用 im_card new 起草成草稿给我过目；我说「改一下」就用 im_card edit 改，我点发布才发。"]);
    const item = s.relay.queueOf(john.record, "john", "xiaoping").pending.at(-1);
    assert.deepEqual([item.level, item.venueKind, item.prompt.startsWith("起草一张委托书")], ["owner", "dm", true], "the owner's word in the DM is a prompt");
    const again = await askP({ op: "im-brief", text: "预算改成 20", card: "t-57" });
    assert.deepEqual([again.ok, again.brief.venue], [true, "john/dm-xiaoping"], "the DM is reused");
    await daemon.syncOnce();
    assert.equal(s.relay.venueOf("john", "dm-xiaoping").messages.at(-1).text, "改一下 #t-57：预算改成 20。用 im_card edit 改草稿，改完说一声。");
    assert.match((await askP({ op: "im-brief", text: "x", agent: "nobody" })).error, /没有 nobody 的令牌|本会话没有 agent/);
    assert.match(ask({ op: "im-brief", text: "x" }).error, /handleRequest/, "the synchronous path says where the op goes");
  } finally {
    await s.close();
  }
});

test("im-signal through the hook (plan L): publish seals on the host's chain and queues for the relay, retract queues, list reads the chain and the four numbers, skip records the agent's objection; a press on an exec need goes to the module; the synchronous path says where the op goes", async () => {
  const { s, john, home, root, env, daemon, ask } = await world();
  try {
    const askP = (req) => askProcess(root, req, env);
    s.relay.createVenue(john.record, { id: "ch-9", kind: "channel", name: "小评的信号", agents: ["agent:xiaoping@john"], price: { month: 10 } });
    const fields = { channel: "john/ch-9", market: "polymarket:x", side: "yes", sizeHint: { kind: "fraction-of-bankroll", value: 0.02 }, priceCap: 0.63, expires: "2099-01-01T00:00:00Z", confidence: 0.7 };
    assert.match((await askP({ op: "im-signal", action: "publish", body: { ...fields, side: "long" } })).error, /方向是 yes 或 no/);
    assert.match((await askP({ op: "im-signal", action: "publish", body: { market: "m" } })).error, /publish 要 channel/);
    const made = await askP({ op: "im-signal", action: "publish", body: fields });
    assert.equal(made.ok, true, made.error);
    assert.match(made.signal.line, /^已排入待发：信号 s-\S+ → 频道 john\/ch-9 · 本机哈希 sha256:/);
    assert.deepEqual(listOutbox(home).map((e) => [e.kind, e.as]), [["signal", "agent:xiaoping"]]);
    await daemon.syncOnce();
    assert.deepEqual(s.relay.signalsOf("john", "xiaoping").map((x) => [x.id, x.market, typeof x.hostHash]), [["signal-1", "polymarket:x", "string"]]);
    const listed = await askP({ op: "im-signal", action: "list", target: "xiaoping@john" });
    assert.deepEqual(listed.signal.line.split("\n"), ["命中 0/0 · 90 天收益 0% · 最大回撤 0% · 已撤回 0（仍计入）", "信号 signal-1 · polymarket:x · 买是 · 价 ≤0.63 · 过期 00:00"]);
    assert.match((await askP({ op: "im-signal", action: "list", target: "xiaoping" })).error, /agent>@<owner/);
    const retracted = await askP({ op: "im-signal", action: "retract", id: "signal-1" });
    assert.deepEqual([retracted.ok, retracted.signal.line], [true, "已排入待发：撤回 signal-1"]);
    await daemon.syncOnce();
    assert.equal(s.relay.signalsOf("john", "xiaoping")[0].retracted !== undefined, true);
    assert.match((await askP({ op: "im-signal", action: "list", target: "xiaoping@john" })).signal.line, /· 已撤回$/);
    assert.match((await askP({ op: "im-signal", action: "skip", id: "signal-1", reason: "数据过时" })).error, /没有这条信号：signal-1/, "not a channel this person subscribes to");
    assert.match((await askP({ op: "im-signal", action: "retract" })).error, /retract 要信号的 id/);
    assert.match((await askP({ op: "im-need", key: "exec:john/ch-9/signal-1", action: "跟" })).error, /这条询问已经过了/);
    assert.equal((await askP({ op: "im-need", key: "exec-stuck:john/ch-9", action: "知道了" })).ok, true);
    assert.match(ask({ op: "im-signal", action: "list", target: "xiaoping@john" }).error, /handleRequest/);
  } finally {
    await s.close();
  }
});
