import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "@geml/geml";
import { kindAllowed, draftFaults, stamp, renderMessageBlock, readMessages, WRITE_IN } from "../dist/core/im/message.js";
import { readDataBlocks, verifyChain } from "../dist/core/im/chain.js";

const john = { kind: "person", id: "john" }, xp = { kind: "agent", name: "xiaoping", owner: "john" }, host = { kind: "host" };
const T0 = "2026-10-30T09:12:04Z";

test("who may send which kind (§6.3)", () => {
  assert.equal(kindAllowed("chat", john), true);
  assert.equal(kindAllowed("chat", xp), true);
  assert.equal(kindAllowed("chat", host), false);
  for (const k of ["report", "ask", "signal"]) { assert.equal(kindAllowed(k, xp), true, k); assert.equal(kindAllowed(k, john), false, k); }
  assert.equal(kindAllowed("system", host), true);
  assert.equal(kindAllowed("system", xp), false);
  assert.equal(kindAllowed("card", john), true);
  assert.equal(kindAllowed("card", host), false);
});

test("draftFaults names what a draft lacks or claims wrongly", () => {
  assert.deepEqual(draftFaults({ venue: "g-7", kind: "chat", text: "你好" }, john), []);
  assert.deepEqual(draftFaults({ venue: "g-7", kind: "report", text: "跑完了" }, john), ["汇报：person:john 不能发这种消息"]);
  assert.deepEqual(draftFaults({ venue: "g-7", kind: "ask", text: "" }, xp), ["询问：缺问题或问谁"]);
  assert.deepEqual(draftFaults({ venue: "g-7", kind: "ask", text: "", ask: { question: "哪种？", options: [], who: "主人" } }, xp), []);
  assert.deepEqual(draftFaults({ venue: "g-7", kind: "card", text: "" }, john), ["卡片：缺卡的地址"]);
  assert.deepEqual(draftFaults({ venue: "g-7", kind: "chat", text: "  " }, john), ["正文为空"]);
  assert.deepEqual(draftFaults({ venue: "g-7", kind: "chat", text: "", parts: [{ src: "https://r/john/d.geml#x" }] }, john), []);
  assert.deepEqual(draftFaults({ venue: "g-7", kind: "chat", text: "x", turn: "turn:12" }, john), ["只有 agent 的消息能链接回那一轮"]);
  assert.deepEqual(draftFaults({ venue: "g-7", kind: "chat", text: "x", source: "agent" }, john), ["本人的消息不能标为 agent 发言"]);
});

test("stamp: the host's speaker, time and chain win over whatever the draft claims; text is normalized; an ask ends in 自己写", () => {
  const draft = { venue: "g-7", kind: "report", text: "测试跑完了，\r\n三条过两条。 \r\n", evidence: [{ src: "https://r/john/journals/t-42.geml#rev-14", rev: 14 }], speaker: "person:john", at: "1999-01-01T00:00:00Z", hash: "sha256:fake", prev: "sha256:fake" };
  const m = stamp(draft, { id: "m-000417", speaker: xp, at: T0, prev: null, session: "cc-7f3a" });
  assert.equal(m.id, "m-000417");
  assert.equal(m.speaker, "agent:xiaoping@john");
  assert.equal(m.at, T0);
  assert.equal(m.session, "cc-7f3a");
  assert.equal(m.text, "测试跑完了，\n三条过两条。");
  assert.equal(m.source, "agent");
  assert.equal(m.hops, 0);
  assert.deepEqual(m.mentions, []);
  assert.deepEqual(m.parts, []);
  assert.deepEqual(m.evidence, draft.evidence);
  assert.equal(m.prev, null);
  assert.match(m.hash, /^sha256:[0-9a-f]{64}$/);
  assert.equal("thread" in m, false);
  const ask = stamp({ venue: "g-7", kind: "ask", text: "", ask: { question: "用哪种导出？", options: ["PDF", "PNG"], who: "主人", expires: "2026-10-31T00:00:00Z" } }, { id: "m-2", speaker: xp, at: T0, prev: m.hash });
  assert.deepEqual(ask.ask, { question: "用哪种导出？", options: ["PDF", "PNG", WRITE_IN], who: "主人", expires: "2026-10-31T00:00:00Z" });
  assert.equal(ask.prev, m.hash);
  assert.equal(stamp({ venue: "g-7", kind: "chat", text: "嗯" }, { id: "m-3", speaker: john, at: T0, prev: null }).source, "self");
});

test("a rendered venue document is clean GEML, chains, and reads back equal", () => {
  const m1 = stamp({ venue: "g-7", kind: "chat", text: "@小评 看看", mentions: [{ name: "小评", call: true }] }, { id: "m-1", speaker: john, at: T0, prev: null });
  const m2 = stamp({ venue: "g-7", kind: "report", text: "看了", thread: "m-1", opinion: "方案 B 更稳", parts: [{ src: "https://r/john/journals/t-42.geml#rev-3" }], turn: "turn:12", hops: 1 }, { id: "m-2", speaker: xp, at: T0, prev: m1.hash, session: "cc-1" });
  const m3 = stamp({ venue: "g-7", kind: "system", text: "小评 进入 #verify" }, { id: "m-3", speaker: host, at: T0, prev: m2.hash });
  const text = renderMessageBlock(m1) + renderMessageBlock(m2) + renderMessageBlock(m3);
  assert.deepEqual(parse(text).diagnostics, []);
  assert.deepEqual(verifyChain(readDataBlocks(text).blocks), []);
  const { messages, diagnostics } = readMessages(text);
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(messages, [m1, m2, m3]);
});

test("readMessages reports a block that is no message and keeps the rest", () => {
  const good = stamp({ venue: "g-7", kind: "chat", text: "a" }, { id: "m-1", speaker: john, at: T0, prev: null });
  const text = renderMessageBlock(good)
    + '=== data {#m-2 format=json}\n{"kind":"dance","text":"b"}\n===\n\n'
    + '=== data {#m-3 format=json}\n{"id":"m-9","kind":"chat","text":"b","speaker":"person:john","venue":"g-7","at":"t","hash":"h","prev":null}\n===\n\n'
    + '=== data {#m-4 format=json}\n{"id":"m-4","kind":"chat","text":"b","speaker":"someone","venue":"g-7","at":"t","hash":"h","prev":null}\n===\n';
  const { messages, diagnostics } = readMessages(text);
  assert.deepEqual(messages, [good]);
  assert.deepEqual(diagnostics, ["#m-2: kind missing or unknown", "#m-3: id does not match the block", "#m-4: speaker missing or malformed"]);
});
