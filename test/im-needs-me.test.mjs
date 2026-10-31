import { test } from "node:test";
import assert from "node:assert/strict";
import { NEED_ORDER, NEED_VERBS, NEED_TONES, defaultActions, sortNeeds, isMuted, notifyNow, bandRow, quietLine } from "../dist/core/im/needs-me.js";

const T = (m) => `2026-10-30T10:${String(m).padStart(2, "0")}:00Z`;
const need = (kind, key, since, extra = {}) => ({ kind, key, text: `${kind} ${key}`, actions: [], since, level: 0, ...extra });

test("the five kinds, their verbs, tones and order (§6.9)", () => {
  assert.deepEqual(NEED_ORDER, ["offline", "decide", "accept", "grant", "stuck"]);
  assert.deepEqual(NEED_VERBS, { offline: "断了", decide: "定", accept: "验收", grant: "放行", stuck: "卡住" });
  assert.deepEqual(NEED_TONES, { decide: "amber", grant: "amber", accept: "green", stuck: "red", offline: "red" });
  const items = [need("stuck", "s1", T(1)), need("decide", "d2", T(3)), need("accept", "a1", T(0)), need("decide", "d1", T(2)), need("offline", "o1", T(9)), need("grant", "g1", T(0))];
  assert.deepEqual(sortNeeds(items).map((n) => n.key), ["o1", "d1", "d2", "a1", "g1", "s1"]);
  assert.equal(items[0].key, "s1", "the input is not reordered");
});

test("the default actions per kind (§6.9, transport §7.2)", () => {
  assert.deepEqual(defaultActions("decide", { options: ["PDF", "PNG", "自己写"] }), ["PDF", "PNG", "自己写"]);
  assert.deepEqual(defaultActions("decide", { options: ["PDF"] }), ["PDF", "自己写"]);
  assert.deepEqual(defaultActions("decide", {}), ["自己写"]);
  assert.deepEqual(defaultActions("accept", { settle: 120 }), ["接受 · 结算 120", "要改"]);
  assert.deepEqual(defaultActions("accept", { settle: 120, phone: true }), ["接受 · 结算 120", "要改", "看演示"]);
  assert.deepEqual(defaultActions("accept", {}), ["接受", "要改"]);
  assert.deepEqual(defaultActions("grant", {}), ["允许一次", "允许此人", "拒绝"]);
  assert.deepEqual(defaultActions("stuck", {}), ["看原因", "接管", "交回"]);
  assert.deepEqual(defaultActions("stuck", { suggestion: "让它改成提 PR" }), ["看原因", "让它改成提 PR", "接管", "交回"]);
  assert.deepEqual(defaultActions("offline", {}), ["重试"]);
});

test("mutes by item, by venue, by kind, by kind in a venue", () => {
  const n = need("decide", "d1", T(0), { venue: "g-7" });
  assert.equal(isMuted(n, [{ key: "d1" }]), true);
  assert.equal(isMuted(n, [{ venue: "g-7" }]), true);
  assert.equal(isMuted(n, [{ kind: "decide" }]), true);
  assert.equal(isMuted(n, [{ kind: "decide", venue: "g-7" }]), true);
  assert.equal(isMuted(n, [{ kind: "decide", venue: "g-8" }]), false);
  assert.equal(isMuted(n, [{ kind: "accept" }, { key: "d2" }]), false);
  assert.equal(isMuted(n, []), false);
  assert.equal(isMuted(need("decide", "d1", T(0)), [{ venue: "g-7" }]), false, "an item of no venue is not muted by a venue");
});

test("notify once: a new item, again only when it escalates; to the phone only when away long enough (§6.9)", () => {
  const items = [need("decide", "d1", T(0)), need("accept", "a1", T(1)), need("stuck", "s1", T(2), { level: 2, venue: "g-7" })];
  const first = notifyNow(items, [], [], { awayMs: 0, pushAfterMs: 600_000 });
  assert.deepEqual(first.band.map((n) => n.key), ["d1", "a1", "s1"]);
  assert.deepEqual(first.phone, []);
  const seen = [{ key: "d1", level: 0 }, { key: "a1", level: 0 }, { key: "s1", level: 1 }];
  const again = notifyNow(items, seen, [], { awayMs: 900_000, pushAfterMs: 600_000 });
  assert.deepEqual(again.band.map((n) => n.key), ["s1"], "d1 and a1 were seen at this level; s1 escalated");
  assert.deepEqual(again.phone.map((n) => n.key), ["s1"]);
  assert.deepEqual(notifyNow(items, seen, [{ venue: "g-7" }], { awayMs: 900_000, pushAfterMs: 600_000 }).band, []);
  assert.deepEqual(notifyNow(items, [], [], { awayMs: 600_000, pushAfterMs: 600_000 }).phone, [], "exactly the threshold is not past it");
});

test("the band row is the first item after sorting with the rest counted (§6.9); the quiet line says where things are", () => {
  const items = [
    need("stuck", "s1", T(1), { text: "小评 连续被拒 3 次", actions: ["看原因", "接管", "交回"] }),
    need("decide", "d1", T(0), { text: "小评 问：用哪种导出？", actions: ["PDF", "PNG", "自己写"] }),
  ];
  assert.deepEqual(bandRow(items), { verb: "定", tone: "amber", text: "小评 问：用哪种导出？", actions: ["PDF", "PNG", "自己写"], more: 1 });
  assert.deepEqual(bandRow(items, [{ key: "d1" }]), { verb: "卡住", tone: "red", text: "小评 连续被拒 3 次", actions: ["看原因", "接管", "交回"], more: 0 });
  assert.equal(bandRow([]), undefined);
  assert.equal(bandRow(items, [{ kind: "stuck" }, { kind: "decide" }]), undefined);
  assert.equal(quietLine({ card: { id: "#t-57", state: "待放行", waitingOn: "李四" }, unaddressed: 3 }), "#t-57 待放行 · 等李四 · 群里有 3 条新消息，没点名你");
  assert.equal(quietLine({ card: { id: "#t-57", state: "进行中" } }), "#t-57 进行中");
  assert.equal(quietLine({ unaddressed: 1 }), "群里有 1 条新消息，没点名你");
  assert.equal(quietLine({ unaddressed: 0 }), "没有需要你的事");
  assert.equal(quietLine({}), "没有需要你的事");
});
