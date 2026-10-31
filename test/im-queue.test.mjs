import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "@geml/geml";
import { EMPTY_QUEUE, rankOf, enqueue, pending, next, positionOf, stateOf, markRead, markAnswered, expiredSystemText, senderStatus, MENTION_STATUS, renderQueue, readQueue } from "../dist/core/im/queue.js";
import { readDataBlocks, verifyChain } from "../dist/core/im/chain.js";

const T = (m, s = 0) => `2026-10-30T10:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}Z`;
const base = { venue: "g-7", venueKind: "group", venueName: "前端周会", hops: 0 };
const item = (id, sender, senderName, level, at, extra = {}) => ({ id, prompt: `给 ${id}`, sender, senderName, level, at, ...base, ...extra });

let q = EMPTY_QUEUE;
q = enqueue(q, item("q-1", "person:zhangsan", "张三", "member", T(0))).queue;
q = enqueue(q, item("q-2", "agent:xiaoce@john", "小测", "owner", T(1))).queue;
q = enqueue(q, item("q-3", "person:lisi", "李四", "trusted", T(2), { expires: T(10) })).queue;
q = enqueue(q, item("q-4", "person:john", "John", "owner", T(3), { message: "https://r/john/venues/g-7.geml#m-9" })).queue;

test("items chain in arrival order; the next item is by priority, people before agents, then arrival (§6.5)", () => {
  assert.deepEqual(q.items.map((i) => i.n), [1, 2, 3, 4]);
  assert.equal(q.items[0].prev, null);
  assert.equal(q.items[1].prev, q.items[0].hash);
  assert.equal(q.items[3].prev, q.items[2].hash);
  assert.deepEqual([rankOf(q.items[3]), rankOf(q.items[2]), rankOf(q.items[0]), rankOf(q.items[1])], [0, 1, 2, 4]);
  assert.deepEqual(pending(q, T(4)).map((i) => i.id), ["q-4", "q-3", "q-1", "q-2"]);
  assert.equal(next(q, T(4)).item.id, "q-4");
  assert.deepEqual(next(q, T(4)).dropped, []);
  assert.equal(positionOf(q, "q-1", T(4)), 3);
  assert.equal(positionOf(q, "q-9", T(4)), undefined);
  assert.equal(EMPTY_QUEUE.items.length, 0);
  assert.equal(next(EMPTY_QUEUE, T(4)).item, undefined);
});

test("read and answered markers take an item out; an expired item is dropped with a system message", () => {
  let r = markRead(q, "q-4", T(5));
  assert.equal(stateOf(r, "q-4", T(5)), "read");
  r = markAnswered(r, "q-4", T(6), "https://r/john/venues/g-7.geml#m-20");
  assert.equal(stateOf(r, "q-4", T(6)), "answered");
  assert.deepEqual(r.markers, [{ kind: "read", n: 1, item: "q-4", at: T(5) }, { kind: "answered", n: 2, item: "q-4", at: T(6), reply: "https://r/john/venues/g-7.geml#m-20" }]);
  assert.equal(stateOf(r, "q-3", T(9)), "queued");
  const late = next(r, T(11));
  assert.equal(late.item.id, "q-1");
  assert.deepEqual(late.dropped.map((i) => i.id), ["q-3"]);
  assert.equal(stateOf(r, "q-3", T(11)), "expired");
  assert.equal(stateOf(r, "q-9", T(11)), undefined);
  assert.equal(expiredSystemText(late.dropped[0]), `过期未投递：前端周会 里 ${T(2)} 给它的那条过了 ${T(10)}，已丢弃`);
  assert.equal(q.markers.length, 0, "the input is not changed");
});

test("the sender's status line under the message (§6.5)", () => {
  assert.equal(senderStatus(q, "q-1", T(4), { alive: true, doing: "跑工具 40 秒" }), "点名 · 排队中（前面 2 条 · 跑工具 40 秒）");
  assert.equal(senderStatus(q, "q-4", T(4), { alive: true }), "点名 · 排队中（前面 0 条）");
  assert.equal(senderStatus(q, "q-3", T(4), { alive: false }), `离线，已留言 · 过期 ${T(10)}`);
  assert.equal(senderStatus(q, "q-1", T(4), { alive: false }), "离线，已留言");
  assert.equal(senderStatus(markRead(q, "q-4", T(5)), "q-4", T(5), { alive: true }), `已读入 ✓✓（${T(5)}）`);
  assert.equal(senderStatus(markAnswered(markRead(q, "q-4", T(5)), "q-4", T(6)), "q-4", T(6), { alive: true }), "已回应");
  assert.equal(senderStatus(q, "q-3", T(11), { alive: true }), "过期，没投递");
  assert.equal(senderStatus(q, "q-9", T(4), { alive: true }), undefined);
  assert.equal(MENTION_STATUS, "提及 · 没投递");
});

test("the queue document round-trips as clean GEML; items chain, markers stand outside the chain", () => {
  const r = markRead(q, "q-4", T(5));
  const text = renderQueue(r);
  assert.deepEqual(parse(text).diagnostics, []);
  assert.deepEqual(parse(text).ids, ["q-1", "q-2", "q-3", "q-4", "read-1"]);
  assert.ok(!text.includes("\r"));
  const back = readQueue(text);
  assert.deepEqual(back.diagnostics, []);
  assert.deepEqual(back.queue, r);
  assert.deepEqual(verifyChain(readDataBlocks(text).blocks.filter((b) => typeof b.value.prompt === "string")), []);
  const bad = readQueue(text + '=== data {#x format=json}\n{"what":"ever"}\n===\n');
  assert.deepEqual(bad.diagnostics, ["#x: neither an item nor a marker"]);
  assert.deepEqual(bad.queue, r);
});
