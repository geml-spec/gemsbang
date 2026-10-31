import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readForTool, statusView, threadView } from "../dist/daemon/view.js";
import { answer, answerGrant, reportPresence, say } from "../dist/daemon/deliver.js";
import { Daemon } from "../dist/daemon/sync.js";
import { listOutbox, writeConfig, writeMirror, writeState } from "../dist/daemon/home.js";
import { renderDataBlock } from "../dist/core/im/chain.js";
import { startRelay } from "../dist/relay/server.js";

const tmp = (p) => mkdtempSync(join(tmpdir(), p));
const NOW = "2026-10-31T09:30:00Z";
async function world() {
  const s = await startRelay({ root: tmp("gemworks-relay-"), name: "relay.test" });
  const john = s.relay.issuePerson("john");
  const zhang = s.relay.issuePerson("zhangsan");
  const xiaoping = s.relay.issueAgent(john.record, "xiaoping");
  s.relay.createVenue(john.record, { id: "g-7", kind: "group", name: "前端周会", people: ["zhangsan"], agents: ["agent:xiaoping@john"] });
  s.relay.createVenue(zhang.record, { id: "t-1", kind: "thread", name: "回复：看看这个", people: ["john"], policy: { draftFirst: true } });
  const home = tmp("gemworks-im-");
  writeConfig(home, { relay: { url: s.url, name: "relay.test" }, person: "john", token: john.token, agents: { xiaoping: xiaoping.token } });
  return { s, john, zhang, xiaoping, home, daemon: new Daemon({ home }) };
}

test("statusView: nothing when not set up; the venues with their unread, the needs with 断了 from the state file, the drafts, the agents' presence", async () => {
  assert.deepEqual(statusView(tmp("gemworks-im-"), {}, NOW), { configured: false, agents: [], needs: [], venues: [], drafts: [], cards: [], presence: {} });
  const { s, john, zhang, xiaoping, home, daemon } = await world();
  try {
    s.relay.appendMessage(zhang.record, "john", "g-7", { id: "m-1", text: "@xiaoping 跑一下" });
    s.relay.appendMessage(zhang.record, "john", "g-7", { id: "m-2", text: "再说一句" });
    s.relay.setAnnounce(john.record, "john", "g-7", "公告");
    s.relay.appendMessage(xiaoping.record, "john", "g-7", { id: "m-ask", kind: "ask", text: "合吗", ask: { question: "合吗", options: ["合"], who: "person:john" } });
    s.relay.appendMessage(zhang.record, "zhangsan", "t-1", { id: "n-1", text: "线程里" });
    await daemon.syncOnce();
    reportPresence(home, "xiaoping", "cc-1", { host: "claude-code", login: "api", presence: "tool", task: "#42" }, NOW);
    const v = statusView(home, {}, NOW);
    assert.deepEqual([v.configured, v.person, v.relay, v.agents, v.connected, v.presence], [true, "john", "relay.test", ["xiaoping"], true, { xiaoping: "tool" }]);
    assert.deepEqual(v.venues.map((x) => [x.owner, x.id, x.kindWord, x.name, x.status, x.unread, x.last]), [["john", "g-7", "群", "前端周会", "2 人 · 1 个 agent", 3, "m-ask"], ["zhangsan", "t-1", "线程", "回复：看看这个", "没人在干", 1, "n-1"]], "newest venue first; system messages do not count");
    assert.deepEqual(v.needs.map((n) => [n.kind, n.text]), [["decide", "群「前端周会」· xiaoping 问：合吗"]]);
    assert.deepEqual(statusView(home, { "john/g-7": "m-2" }, NOW).venues[0].unread, 1, "seen up to m-2: one after it");
    assert.deepEqual(statusView(home, { "john/g-7": "m-ask", "zhangsan/t-1": "n-1" }, NOW).venues.map((x) => x.unread), [0, 0]);
    assert.deepEqual(statusView(home, { "john/g-7": "m-gone" }, NOW).venues[0].unread, 3, "a mark the mirror no longer has counts everything");
    const d = s.relay.queueOf({ speaker: "person:john", scope: "person" }, "john", "xiaoping").pending[0];
    const held = answer(home, "xiaoping", { ...d, venue: "t-1", venueName: "回复：看看这个", message: "https://relay.test/zhangsan/venues/t-1.geml#n-1" }, "草稿正文", NOW);
    assert.match(held.draft, /^d-/);
    writeState(home, { connected: false, at: NOW, error: "连不上中继 http://x：fetch failed" });
    const off = statusView(home, {}, NOW);
    assert.deepEqual([off.connected, off.error], [false, "连不上中继 http://x：fetch failed"]);
    assert.deepEqual(off.needs.map((n) => [n.kind, n.key, n.text, n.actions]), [["offline", "offline:relay", "连不上中继 relay.test：连不上中继 http://x：fetch failed", ["重试"]], ["decide", "https://relay.test/john/venues/g-7.geml#m-ask", "群「前端周会」· xiaoping 问：合吗", ["合", "自己写"]]], "断了 first");
    assert.deepEqual(off.drafts.map((x) => [x.id, x.agent, x.venueName, x.text]), [[held.draft, "xiaoping", "回复：看看这个", "草稿正文"]]);
  } finally {
    await s.close();
  }
});

test("threadView: every speaker as rule 6 draws them, parts as text, stub or not mirrored, the ask, the decision, the sender's status line", async () => {
  const { s, john, zhang, xiaoping, home, daemon } = await world();
  try {
    s.relay.setAnnounce(john.record, "john", "g-7", "先跑测试再合");
    s.relay.appendMessage(zhang.record, "john", "g-7", { id: "m-1", text: "@xiaoping 跑一下", parts: [{ src: "https://relay.test/john/sessions/cc-1.geml#turn-3" }, { src: "https://relay.test/john/journals/t-42.geml#rev-3" }] });
    s.relay.appendMessage(john.record, "john", "g-7", { id: "m-2", text: "@xiaoping 我也叫你", source: "drafted" });
    s.relay.appendMessage(xiaoping.record, "john", "g-7", { id: "m-3", kind: "report", text: "跑完了", session: "cc-1", evidence: [{ src: "https://relay.test/john/venues/g-7.geml#m-1" }], opinion: "可以合" });
    s.relay.appendMessage(xiaoping.record, "john", "g-7", { id: "m-4", text: "主人说：合", source: "quoted" });
    s.relay.appendMessage(xiaoping.record, "john", "g-7", { id: "m-ask", kind: "ask", text: "合吗", ask: { question: "合吗", options: ["合", "不合"], who: "person:john" } });
    s.relay.markDecision(zhang.record, "john", "g-7", "m-1");
    await daemon.syncOnce();
    writeMirror(home, "relay.test", "john", "sessions/cc-1.geml", renderDataBlock("turn-3", { stub: true, from: "john", session: "cc-1", turn: "3", note: "你看不到", action: "申请看" }));
    reportPresence(home, "xiaoping", "cc-1", { host: "claude-code", login: "api", presence: "idle" }, NOW);
    const th = threadView(home, "john", "g-7", 50, NOW);
    assert.deepEqual([th.owner, th.id, th.kind, th.kindWord, th.name, th.announce, th.people, th.agents, th.draftFirst, th.total], ["john", "g-7", "group", "群", "前端周会", "先跑测试再合", ["john", "zhangsan"], ["xiaoping"], false, 6]);
    const by = Object.fromEntries(th.messages.map((m) => [m.id, m]));
    assert.deepEqual([by["m-1"].label, by["m-1"].kindWord, by["m-1"].decision, by["m-1"].sourceTag, by["m-1"].status], ["zhangsan", "闲聊", true, undefined, undefined], "another person's call: no status line of mine");
    assert.deepEqual(by["m-1"].parts, [{ src: "https://relay.test/john/sessions/cc-1.geml#turn-3", stub: "你看不到：来自 john 的私有范围 · 申请看" }, { src: "https://relay.test/john/journals/t-42.geml#rev-3" }]);
    assert.deepEqual([by["m-2"].label, by["m-2"].sourceTag, by["m-2"].status], ["john", "起草", "xiaoping：点名 · 排队中（前面 0 条 · 空闲）"], "the owner's drafted call: its status line toward xiaoping; the owner's own call goes ahead of zhangsan's earlier one (§6.5)");
    assert.deepEqual([by["m-3"].label, by["m-3"].kindWord, by["m-3"].evidence, by["m-3"].opinion], ["xiaoping · 代 john", "汇报", [{ src: "https://relay.test/john/venues/g-7.geml#m-1", text: "@xiaoping 跑一下" }], "可以合"]);
    assert.deepEqual([by["m-4"].sourceTag, by["m-ask"].ask.options, by["m-ask"].kindWord], ["本人原话", ["合", "不合", "自己写"], "询问"]);
    assert.equal(by["sys-1"].label, "宿主");
    assert.equal(threadView(home, "john", "g-7", 2, NOW).messages.length, 2);
    assert.equal(threadView(home, "john", "none", 50, NOW), undefined);
    assert.equal(threadView(tmp("gemworks-im-"), "john", "g-7"), undefined);
  } finally {
    await s.close();
  }
});

test("readForTool: a venue's recent lines, one embed's text, a stub, or that it is not mirrored; say with an ask and evidence; a 放行 answered goes to the outbox as a grant or a refusal", async () => {
  const { s, john, zhang, xiaoping, home, daemon } = await world();
  try {
    s.relay.appendMessage(zhang.record, "john", "g-7", { id: "m-1", text: "@xiaoping 跑一下" });
    s.relay.appendMessage(xiaoping.record, "john", "g-7", { id: "m-2", kind: "report", text: "跑完了", evidence: [{ src: "https://relay.test/john/venues/g-7.geml#m-1" }] });
    await daemon.syncOnce();
    assert.equal(readForTool(home, { owner: "john", venue: "g-7", limit: 5 }), [
      "群「前端周会」· 最近 2 条（共 2 条）",
      "[" + "09:" + s.relay.venueOf("john", "g-7").messages[0].at.slice(14, 16) + "] zhangsan（闲聊）：@xiaoping 跑一下",
      "[" + "09:" + s.relay.venueOf("john", "g-7").messages[1].at.slice(14, 16) + "] xiaoping · 代 john（汇报）：跑完了",
      "  ↳ https://relay.test/john/venues/g-7.geml#m-1：@xiaoping 跑一下",
    ].join("\n").replace(/\[09:/g, "[" + s.relay.venueOf("john", "g-7").messages[0].at.slice(11, 14)));
    assert.equal(readForTool(home, { src: "https://relay.test/john/venues/g-7.geml#m-1" }), "@xiaoping 跑一下");
    assert.equal(readForTool(home, { src: "https://relay.test/john/journals/t-42.geml#rev-3" }), "没镜像到本机：https://relay.test/john/journals/t-42.geml#rev-3（让主人在看板上看，或等守护进程同步）");
    assert.equal(readForTool(home, { src: "nope" }), "不是地址：nope");
    assert.equal(readForTool(home, { owner: "john", venue: "none" }), "没有这个场所的镜像：john/none");
    assert.equal(readForTool(home, {}), "要一个场所（owner/id），或一个块的地址（src）");
    const asked = say(home, { as: "agent:xiaoping", owner: "john", venue: "g-7", text: "合吗", kind: "ask", ask: { question: "合吗", options: ["合"], who: "person:john" }, session: "cc-1" }, NOW);
    const reported = say(home, { as: "agent:xiaoping", owner: "john", venue: "g-7", text: "跑完了", kind: "report", evidence: [{ src: "https://relay.test/john/venues/g-7.geml#m-1" }], opinion: "可以合", turn: "turn-12" }, NOW);
    assert.deepEqual([asked.body.kind, asked.body.ask, asked.body.session], ["ask", { question: "合吗", options: ["合"], who: "person:john" }, "cc-1"]);
    assert.deepEqual([reported.body.kind, reported.body.evidence, reported.body.opinion, reported.body.turn], ["report", [{ src: "https://relay.test/john/venues/g-7.geml#m-1" }], "可以合", "turn-12"]);
    const once = answerGrant(home, { request: "request-1", person: "lisi", block: "https://relay.test/john/sessions/cc-1.geml#turn-3", action: "allow-once" }, NOW);
    const person = answerGrant(home, { request: "request-2", person: "lisi", block: "https://relay.test/john/sessions/cc-1.geml#turn-3", action: "allow-person" }, NOW);
    const no = answerGrant(home, { request: "request-3", person: "lisi", block: "https://relay.test/john/sessions/cc-1.geml#turn-3", action: "refuse" }, NOW);
    assert.deepEqual([once.kind, once.as, once.body], ["grant", "person", { person: "lisi", block: "https://relay.test/john/sessions/cc-1.geml#turn-3", request: "request-1", once: true }]);
    assert.deepEqual([person.kind, person.body.once, no.kind, no.body], ["grant", undefined, "refuse", { request: "request-3" }]);
    const lisi = s.relay.issuePerson("lisi");
    const block = "https://relay.test/john/sessions/cc-1.geml#turn-3";
    for (let i = 0; i < 3; i++) s.relay.requestGrant(lisi.record, "john", block);
    const r = await daemon.syncOnce();
    assert.deepEqual([r.pushed, r.failed], [5, 0]);
    assert.deepEqual(listOutbox(home), []);
    assert.deepEqual(s.relay.blockGrantsOf("john").map((g) => g.person), ["lisi", "lisi"]);
    assert.deepEqual(s.relay.inbox("john").filter((n) => n.kind === "grant"), [], "every request answered");
  } finally {
    await s.close();
  }
});
