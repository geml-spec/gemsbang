import { test } from "node:test";
import assert from "node:assert/strict";
import { FOLLOW_FRACTION, foldSignals, performanceLine, performanceOf, priceAt, RULE_WORDS, SIDE_WORDS, signalFaults, signalInput, signalLines, signalText } from "../dist/core/im/signal.js";

const INPUT = { market: "polymarket:will-x-happen-by-dec", side: "yes", sizeHint: { kind: "fraction-of-bankroll", value: 0.02 }, priceCap: 0.63, expires: "2026-10-30T10:00:00Z", confidence: 0.7, thesis: "https://relay.test/zhang/venues/ch-1.geml#why-2041" };

test("a signal's fields (§10.1): every one checked, the thesis optional; the input normalized", () => {
  assert.deepEqual(signalFaults(INPUT), []);
  assert.deepEqual(signalFaults({ ...INPUT, thesis: undefined }), []);
  assert.deepEqual(signalFaults({}), ["缺市场", "方向是 yes 或 no", "仓位提示是 { kind: fraction-of-bankroll, value: 0 到 1 }", "价格上限是正数", "过期时间要是 ISO 时间", "信心是 0 到 1"]);
  assert.deepEqual(signalFaults({ ...INPUT, side: "long", sizeHint: { kind: "fraction-of-bankroll", value: 1.5 }, priceCap: 0, expires: "tomorrow", confidence: 2, thesis: 3 }), ["方向是 yes 或 no", "仓位提示是 { kind: fraction-of-bankroll, value: 0 到 1 }", "价格上限是正数", "过期时间要是 ISO 时间", "信心是 0 到 1", "论点引用是地址"]);
  assert.deepEqual(signalInput({ ...INPUT, market: "  polymarket:x  ", thesis: "", extra: 1 }), { market: "polymarket:x", side: "yes", sizeHint: { kind: "fraction-of-bankroll", value: 0.02 }, priceCap: 0.63, expires: "2026-10-30T10:00:00Z", confidence: 0.7 });
  assert.equal(signalInput({}), undefined);
  assert.deepEqual(SIDE_WORDS, { yes: "买是", no: "买否" });
});

test("the chain folded (§10.2): a block a signal with both stamps, a retraction marking it and leaving it in; the text of its message and the card's lines", () => {
  const blocks = [
    { id: "signal-1", value: { id: "signal-1", ...INPUT, from: "agent:alpha@zhang", at: "2026-10-30T09:12:04Z", received: "2026-10-30T09:12:05Z", hostHash: "sha256:h1", channel: "zhang/ch-1" } },
    { id: "signal-2", value: { id: "signal-2", ...INPUT, side: "no", from: "agent:alpha@zhang", at: "2026-10-30T09:20:00Z", received: "2026-10-30T09:20:01Z" } },
    { id: "retract-1", value: { id: "retract-1", signal: "signal-1", at: "2026-10-30T09:30:00Z", by: "agent:alpha@zhang" } },
    { id: "signal-3", value: { id: "signal-3", market: "" } },
  ];
  const all = foldSignals(blocks);
  assert.deepEqual(all.map((s) => [s.id, s.side, s.at, s.received, s.hostHash, s.channel, s.retracted]), [["signal-1", "yes", "2026-10-30T09:12:04Z", "2026-10-30T09:12:05Z", "sha256:h1", "zhang/ch-1", "2026-10-30T09:30:00Z"], ["signal-2", "no", "2026-10-30T09:20:00Z", "2026-10-30T09:20:01Z", undefined, undefined, undefined]]);
  assert.equal(signalText(all[0]), "信号 signal-1 · polymarket:will-x-happen-by-dec · 买是 · 价 ≤0.63 · 过期 10:00");
  assert.deepEqual(signalLines(all[0], "纸面 · 记为『若跟：0.61 进，2%』· 没下单"), ["信号 signal-1 · 发布 09:12:04 · 中继收到 09:12:05 · 已撤回", "市场 polymarket:will-x-happen-by-dec · 买是 · 价 ≤0.63 · 仓位 2% · 过期 10-30 10:00 · 信心 0.7", "论点 https://relay.test/zhang/venues/ch-1.geml#why-2041", "纸面 · 记为『若跟：0.61 进，2%』· 没下单"]);
  assert.deepEqual(signalLines(all[1]), ["信号 signal-2 · 发布 09:20:00 · 中继收到 09:20:01", "市场 polymarket:will-x-happen-by-dec · 买否 · 价 ≤0.63 · 仓位 2% · 过期 10-30 10:00 · 信心 0.7", "论点 https://relay.test/zhang/venues/ch-1.geml#why-2041"]);
});

test("the price series and the fixed rule (§10.3): the last price at or before the moment; in at the receipt price when it is within the cap, out at expiry; hits, the 90-day return, the drawdown; a retracted signal still counts; an open or unpriced one does not", () => {
  const points = [{ at: "2026-10-30T09:00:00Z", price: 0.6 }, { at: "2026-10-30T09:12:05Z", price: 0.61 }, { at: "2026-10-30T10:00:00Z", price: 0.7 }, { at: "2026-10-30T11:00:00Z", price: 0.5 }];
  assert.deepEqual([priceAt(points, "2026-10-30T08:00:00Z"), priceAt(points, "2026-10-30T09:12:05Z"), priceAt(points, "2026-10-30T09:30:00Z"), priceAt(points, "2026-10-31T00:00:00Z")], [undefined, 0.61, 0.61, 0.5]);
  const price = (market, at) => (market === "m" ? priceAt(points, at) : undefined);
  const base = { market: "m", sizeHint: { kind: "fraction-of-bankroll", value: 0.5 }, priceCap: 0.63, confidence: 0.7, from: "agent:alpha@zhang" };
  const signals = [
    { ...base, id: "signal-1", side: "yes", at: "2026-10-30T09:12:04Z", received: "2026-10-30T09:12:05Z", expires: "2026-10-30T10:00:00Z" },
    { ...base, id: "signal-2", side: "yes", at: "2026-10-30T10:00:00Z", received: "2026-10-30T10:00:00Z", expires: "2026-10-30T11:00:00Z", retracted: "2026-10-30T10:30:00Z" },
    { ...base, id: "signal-3", side: "no", at: "2026-10-30T09:12:04Z", received: "2026-10-30T09:12:05Z", expires: "2026-10-30T11:00:00Z" },
    { ...base, id: "signal-4", side: "yes", at: "2026-10-30T11:00:00Z", received: "2026-10-30T11:00:00Z", expires: "2026-11-30T11:00:00Z" },
    { ...base, id: "signal-5", market: "other", side: "yes", at: "2026-10-30T11:00:00Z", received: "2026-10-30T11:00:00Z", expires: "2026-10-30T12:00:00Z" },
  ];
  const p = performanceOf(signals, price, "2026-10-31T09:00:00Z");
  // signal-1: 0.61 → 0.70, +14.75% × 2% = +0.295%; signal-2: entry 0.70 over the cap, not entered; signal-3 (no): 0.61 → 0.50, +18.03% × 2%; signal-4 open; signal-5 no price
  assert.deepEqual([p.hits, p.counted, p.open, p.retracted, p.return90, p.drawdown, p.rule], [2, 2, 1, 1, 0.0066, 0, RULE_WORDS]);
  assert.equal(FOLLOW_FRACTION, 0.02);
  const losing = performanceOf([{ ...base, id: "signal-9", side: "no", at: "2026-10-30T09:12:04Z", received: "2026-10-30T09:12:05Z", expires: "2026-10-30T10:00:00Z" }], price, "2026-10-31T09:00:00Z");
  assert.deepEqual([losing.hits, losing.counted, losing.return90, losing.drawdown], [0, 1, -0.003, 0.003]);
  assert.equal(performanceLine(p), "命中 2/2 · 90 天收益 +0.7% · 最大回撤 0% · 已撤回 1（仍计入）");
  assert.equal(performanceLine(losing), "命中 0/1 · 90 天收益 −0.3% · 最大回撤 0.3% · 已撤回 0（仍计入）");
  assert.equal(performanceOf([], price, "2026-10-31T09:00:00Z").counted, 0);
});
