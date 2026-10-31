import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { answer, contextText, dropDraft, markRead, nextPrompt, reportPresence, say, sendDraft } from "../dist/daemon/deliver.js";
import { Daemon } from "../dist/daemon/sync.js";
import { listDrafts, listOutbox, listSessions, readMirror, writeConfig, writeMirror } from "../dist/daemon/home.js";
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
  const home = tmp("gemworks-im-");
  writeConfig(home, { relay: { url: s.url, name: "relay.test" }, person: "john", token: john.token, agents: { xiaoping: xiaoping.token } });
  const daemon = new Daemon({ home });
  return { s, john, zhang, xiaoping, home, daemon };
}
const JOHN = { speaker: "person:john", scope: "person" };

test("nextPrompt: the spec's envelope word for word, the context pack expanded from the mirror, the queue in priority order; nothing when the queue is empty", async () => {
  const { s, john, zhang, home, daemon } = await world();
  try {
    assert.equal(nextPrompt(home, "xiaoping", NOW), undefined, "nothing mirrored yet");
    s.relay.setAnnounce(john.record, "john", "g-7", "先跑测试再合");
    s.relay.appendMessage(zhang.record, "john", "g-7", { id: "m-0", text: "定了：用 pnpm" });
    s.relay.markDecision(zhang.record, "john", "g-7", "m-0");
    s.relay.appendMessage(zhang.record, "john", "g-7", { id: "m-1", text: "@xiaoping 跑一下测试", parts: [{ src: "https://relay.test/john/journals/t-42.geml#rev-3" }] });
    s.relay.appendMessage(zhang.record, "john", "g-7", { id: "m-2", text: "@xiaoping 再跑一次" });
    await daemon.syncOnce();
    const d = nextPrompt(home, "xiaoping", NOW);
    assert.equal(d.envelope, "[来自 群「前端周会」 · zhangsan（成员） · 权限：只读 · 回复将发回该群，成员可见 · 队列中还有 1 条]");
    assert.equal(d.item.id, "qi-g-7-m-1");
    assert.deepEqual([d.queued, d.draftFirst, d.scope, d.dropped], [1, false, { write: false, run: "none", budget: 20 }, []]);
    assert.equal(d.text, [
      d.envelope,
      "@xiaoping 跑一下测试",
      "",
      "（上下文）",
      "https://relay.test/john/venues/g-7.geml#announce",
      "先跑测试再合",
      "",
      "https://relay.test/john/venues/g-7.geml#m-0",
      "定了：用 pnpm",
      "",
      "https://relay.test/john/journals/t-42.geml#rev-3",
      "（没展开，用读取工具按需取）",
    ].join("\n"));
    s.relay.appendMessage(john.record, "john", "g-7", { id: "m-3", text: "@xiaoping 主人先" });
    await daemon.syncOnce();
    assert.equal(nextPrompt(home, "xiaoping", NOW).item.id, "qi-g-7-m-3", "the owner's prompt before the member's");
    assert.match(nextPrompt(home, "xiaoping", NOW).envelope, /john（主人） · 权限：工作流允许的一切 · 回复将发回该群，成员可见 · 队列中还有 2 条/);
    assert.throws(() => nextPrompt(tmp("gemworks-im-"), "xiaoping", NOW), /没有 connect.json/);
  } finally {
    await s.close();
  }
});

test("a stub in the mirror becomes a 你看不到 line; a grant widens the scope; 回群前先给我看 reaches the envelope", async () => {
  const { s, john, zhang, home, daemon } = await world();
  try {
    s.relay.createVenue(john.record, { id: "g-8", kind: "group", name: "先看", people: ["zhangsan"], agents: ["agent:xiaoping@john"], policy: { draftFirst: true } });
    s.relay.grant(john.record, { person: "zhangsan", widen: { run: "sandbox", budget: 50 } });
    s.relay.appendMessage(zhang.record, "john", "g-8", { id: "m-1", text: "@xiaoping 看看这一轮", parts: [{ src: "https://relay.test/john/sessions/cc-1.geml#turn-3" }] });
    await daemon.syncOnce();
    writeMirror(home, "relay.test", "john", "sessions/cc-1.geml", renderDataBlock("turn-3", { stub: true, from: "john", session: "cc-1", turn: "3", note: "你看不到", action: "申请看" }));
    const d = nextPrompt(home, "xiaoping", NOW);
    assert.equal(d.envelope, "[来自 群「先看」 · zhangsan（成员） · 权限：读、在沙箱里跑 · 回复先给主人过目，再发回该群 · 队列中还有 0 条]");
    assert.deepEqual([d.draftFirst, d.scope], [true, { write: false, run: "sandbox", budget: 50 }]);
    assert.match(d.text, /https:\/\/relay\.test\/john\/sessions\/cc-1\.geml#turn-3\n你看不到：来自 john 的私有范围 · 会话 cc-1 · 第 3 轮 · 申请看/);
    assert.equal(contextText(home, "xiaoping", []), "");
  } finally {
    await s.close();
  }
});

test("markRead keeps the item from being delivered again before the push; answer sends the reply as the agent with the answered marker; the relay shows both after a sync", async () => {
  const { s, zhang, home, daemon } = await world();
  try {
    s.relay.appendMessage(zhang.record, "john", "g-7", { id: "m-1", text: "@xiaoping 跑一下测试" });
    s.relay.appendMessage(zhang.record, "john", "g-7", { id: "m-2", text: "@xiaoping 再跑一次" });
    await daemon.syncOnce();
    const first = nextPrompt(home, "xiaoping", NOW);
    const read = markRead(home, "xiaoping", first.item, NOW);
    assert.deepEqual([read.kind, read.as, read.owner, read.doc, read.body], ["marker", "agent:xiaoping", "john", "queues/xiaoping.geml", { kind: "read", item: "qi-g-7-m-1" }]);
    assert.equal(nextPrompt(home, "xiaoping", NOW).item.id, "qi-g-7-m-2", "the read one is not offered again, though not pushed yet");
    const sent = answer(home, "xiaoping", first.item, "跑完了，三条过两条", NOW, { kind: "report", evidence: [{ src: "https://relay.test/john/journals/t-42.geml#rev-14", rev: 14 }], session: "cc-1" });
    assert.match(sent.sent, /^https:\/\/relay\.test\/john\/venues\/g-7\.geml#m-1793\d{9}-[0-9a-f]{8}$/);
    const out = listOutbox(home);
    assert.deepEqual(out.map((e) => [e.kind, e.as, e.doc, e.body.kind ?? e.body.replyTo]), [["marker", "agent:xiaoping", "queues/xiaoping.geml", "read"], ["message", "agent:xiaoping", "venues/g-7.geml", "report"], ["marker", "agent:xiaoping", "queues/xiaoping.geml", "answered"]]);
    assert.deepEqual([out[1].body.replyTo, out[1].body.session, out[1].body.handling, out[1].body.evidence], ["m-1", "cc-1", 0, [{ src: "https://relay.test/john/journals/t-42.geml#rev-14", rev: 14 }]]);
    assert.equal(out[2].body.reply, sent.sent);
    const r = await daemon.syncOnce();
    assert.deepEqual([r.pushed, r.failed], [3, 0]);
    const vd = s.relay.venueOf("john", "g-7");
    const reply = vd.messages.find((m) => m.replyTo === "m-1");
    assert.deepEqual([reply.speaker, reply.kind, reply.text, reply.session, reply.source], ["agent:xiaoping@john", "report", "跑完了，三条过两条", "cc-1", "agent"]);
    const q = s.relay.queueOf(JOHN, "john", "xiaoping");
    assert.deepEqual(q.queue.markers.map((m) => [m.kind, m.item, m.reply]), [["read", "qi-g-7-m-1", undefined], ["answered", "qi-g-7-m-1", sent.sent]]);
    assert.equal(nextPrompt(home, "xiaoping", NOW).item.id, "qi-g-7-m-2");
  } finally {
    await s.close();
  }
});

test("回群前先给我看: the answer is a draft; 就这么发 pushes it, 不发 marks the item answered with no reply; say and reportPresence write their files", async () => {
  const { s, john, zhang, home, daemon } = await world();
  try {
    s.relay.createVenue(john.record, { id: "g-8", kind: "group", name: "先看", people: ["zhangsan"], agents: ["agent:xiaoping@john"], policy: { draftFirst: true } });
    s.relay.appendMessage(zhang.record, "john", "g-8", { id: "m-1", text: "@xiaoping 看看" });
    s.relay.appendMessage(zhang.record, "john", "g-8", { id: "m-2", text: "@xiaoping 再看看" });
    await daemon.syncOnce();
    const d1 = nextPrompt(home, "xiaoping", NOW);
    const held = answer(home, "xiaoping", d1.item, "看过了", NOW);
    assert.match(held.draft, /^d-/);
    assert.deepEqual(listOutbox(home), [], "nothing pushed");
    const drafts = listDrafts(home);
    assert.deepEqual([drafts.length, drafts[0].agent, drafts[0].item, drafts[0].venueName, drafts[0].body.text, drafts[0].body.replyTo], [1, "xiaoping", "qi-g-8-m-1", "先看", "看过了", "m-1"]);
    assert.equal(nextPrompt(home, "xiaoping", NOW).item.id, "qi-g-8-m-2", "a drafted item is answered as far as delivery goes");
    assert.equal(sendDraft(home, "d-nothing", NOW), undefined);
    const sent = sendDraft(home, held.draft, NOW);
    assert.equal(sent.sent, drafts[0].reply);
    assert.deepEqual(listDrafts(home), []);
    assert.deepEqual(listOutbox(home).map((e) => e.kind), ["message", "marker"]);
    const d2 = nextPrompt(home, "xiaoping", NOW);
    const held2 = answer(home, "xiaoping", d2.item, "算了", NOW);
    assert.equal(dropDraft(home, held2.draft, NOW), true);
    assert.equal(dropDraft(home, held2.draft, NOW), false);
    assert.deepEqual(listOutbox(home).map((e) => [e.kind, e.body.kind ?? "", e.body.reply ?? ""]), [["message", "chat", ""], ["marker", "answered", drafts[0].reply], ["marker", "answered", ""]]);
    assert.equal(nextPrompt(home, "xiaoping", NOW), undefined);
    const said = say(home, { as: "person", owner: "john", venue: "g-7", text: "大家好" }, NOW);
    assert.deepEqual([said.kind, said.as, said.doc, said.body.text, said.body.kind], ["message", "person", "venues/g-7.geml", "大家好", "chat"]);
    reportPresence(home, "xiaoping", "cc-1", { host: "claude-code", login: "subscription", presence: "tool", task: "#42" }, NOW);
    assert.deepEqual(listSessions(home).map((x) => [x.agent, x.session, x.report]), [["xiaoping", "cc-1", { host: "claude-code", login: "subscription", presence: "tool", task: "#42", at: NOW }]]);
    const r = await daemon.syncOnce();
    assert.deepEqual([r.pushed, r.failed, r.heartbeats], [4, 0, 1]);
    assert.deepEqual(s.relay.venueOf("john", "g-8").messages.map((m) => [m.id.slice(0, 2), m.speaker]).slice(2), [["m-", "agent:xiaoping@john"]]);
    assert.deepEqual(s.relay.venueOf("john", "g-7").messages.map((m) => [m.text, m.speaker]), [["大家好", "person:john"]]);
    assert.deepEqual(s.relay.queueOf(JOHN, "john", "xiaoping").queue.markers.map((m) => [m.kind, m.item]), [["answered", "qi-g-8-m-1"], ["answered", "qi-g-8-m-2"]]);
  } finally {
    await s.close();
  }
});

test("a guest's question (§11): the envelope says 访客私信 at 访客 level, the card's public range stands under it, the announce is the context; the answer goes back to the guest DM as the agent", async () => {
  const { s, john, home, daemon } = await world();
  try {
    const made = s.relay.createShare(john.record, { title: "设置页导出 PDF", agent: "xiaoping", scope: "src/settings/* 和这 63 轮的记录" });
    assert.equal(made.ok, true, made.reason);
    const asked = s.relay.askAsGuest(undefined, made.card.id, { text: "缓存键为什么不用 URL 直接当键？" });
    assert.equal(asked.ok, true, asked.reason);
    await daemon.syncOnce();
    const d = nextPrompt(home, "xiaoping", NOW);
    const gid = asked.speaker.slice("guest:".length);
    assert.equal(d.item.id, `qi-${asked.venue}-${asked.message.id}`);
    assert.equal(d.envelope, `[来自 访客私信 · 访客 ${gid}（访客） · 权限：只读 · 回复将发给访客 · 队列中还有 0 条]`);
    assert.equal(d.text, `${d.envelope}\n[公开范围：src/settings/* 和这 63 轮的记录；不在范围内的明说不讲，请访客给主人留言]\n缓存键为什么不用 URL 直接当键？\n\n（上下文）\nhttps://relay.test/john/venues/${asked.venue}.geml#announce\nsrc/settings/* 和这 63 轮的记录`);
    assert.deepEqual(d.scope, { write: false, run: "none", budget: 5 });
    answer(home, "xiaoping", d.item, "因为同一个 URL 带不同的用户态会出不同的配置。", NOW, { session: "cc-1" });
    await daemon.syncOnce();
    assert.deepEqual(s.relay.venueOf("john", asked.venue).messages.map((m) => [m.speaker, m.text]), [[asked.speaker, "缓存键为什么不用 URL 直接当键？"], ["agent:xiaoping@john", "因为同一个 URL 带不同的用户态会出不同的配置。"]]);
  } finally {
    await s.close();
  }
});
