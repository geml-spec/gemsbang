import { test } from "node:test";
import assert from "node:assert/strict";
import { ASK_ACTIONS, askText, canAdvance, consecutiveLosses, decide, DEFAULT_RISK, DISCLAIMER, EMPTY_EXEC, execLine, FOOTER, HIT_RATE, localRecord, PAPER_DAYS, riskOf, settleRecords, SMALL_DAYS, STAGE_WORDS, stageLines, stopHit } from "../dist/core/im/risk.js";

const NOW = "2026-10-30T09:30:00Z";
const SIGNAL = { id: "signal-1", market: "m", side: "yes", sizeHint: { kind: "fraction-of-bankroll", value: 0.02 }, priceCap: 0.63, expires: "2026-10-30T10:00:00Z", confidence: 0.7, from: "agent:alpha@zhang", at: "2026-10-30T09:12:04Z", received: "2026-10-30T09:12:05Z" };
const state = (records = [], extra = {}) => ({ ...EMPTY_EXEC, records: [...records], asks: [], objections: {}, ...extra });
const SMALL = riskOf({ stage: "small", stageSince: "2026-10-20T00:00:00Z", markets: ["m"], perOrder: 5, perDay: 20, maxPositions: 3 });
const AUTO = riskOf({ ...SMALL, stage: "auto" });

test("the risk file (§10.5): its fields with the defaults, a body's values over the current, a bad one kept out", () => {
  assert.deepEqual(DEFAULT_RISK, { markets: [], perOrder: 0, perDay: 0, maxPositions: 0, maxSlippage: 0.02, cooldownMinutes: 60, minConfidence: 0.6, askAbove: 0, stop: { drawdown: 0.1, losses: 3 }, stage: "paper", stageSince: "", muted: false, agentReads: false });
  assert.deepEqual(riskOf({ markets: ["m", " n "], perOrder: 5, perDay: -1, stop: { losses: 2 }, stage: "auto", stageSince: "2026-10-01T00:00:00Z", muted: true, agentReads: true, connector: "node order.mjs" }), { ...DEFAULT_RISK, markets: ["m", "n"], perOrder: 5, stop: { drawdown: 0.1, losses: 2 }, stage: "auto", stageSince: "2026-10-01T00:00:00Z", muted: true, agentReads: true, connector: "node order.mjs" });
  assert.deepEqual(riskOf({ stage: "big", connector: null }, riskOf({ connector: "x", perOrder: 3 })), { ...DEFAULT_RISK, perOrder: 3 });
  assert.deepEqual(STAGE_WORDS, { paper: "纸面", small: "小仓", auto: "限额内自动" });
});

test("the decision (§10.5): 纸面 records what following would have been; 小仓 asks; 限额内自动 orders within the file, asks above the line; each check of the file is a skip with its reason", () => {
  assert.deepEqual(decide(SIGNAL, DEFAULT_RISK, state(), 0.61, NOW), { kind: "paper", entry: 0.61, note: "若跟：0.61 进，2%" });
  assert.deepEqual(decide(SIGNAL, DEFAULT_RISK, state(), undefined, NOW), { kind: "paper", entry: 0.63, note: "若跟：0.63 进，2%" }, "no price: the cap");
  assert.deepEqual(decide({ ...SIGNAL, retracted: "x" }, SMALL, state(), 0.61, NOW), { kind: "skip", reason: "已撤回" });
  assert.deepEqual(decide(SIGNAL, SMALL, state(), 0.61, "2026-10-30T10:00:00Z"), { kind: "skip", reason: "已过期" });
  assert.deepEqual(decide(SIGNAL, SMALL, state([], { objections: { "signal-1": "论点引用的数据过时" } }), 0.61, NOW), { kind: "skip", reason: "agent 反对：论点引用的数据过时" });
  assert.deepEqual(decide({ ...SIGNAL, market: "x" }, SMALL, state(), 0.61, NOW), { kind: "skip", reason: "市场不在白名单" });
  assert.deepEqual(decide({ ...SIGNAL, confidence: 0.5 }, SMALL, state(), 0.61, NOW), { kind: "skip", reason: "信心 0.5 低于 0.6" });
  assert.deepEqual(decide(SIGNAL, riskOf({ ...SMALL, perOrder: 0 }), state(), 0.61, NOW), { kind: "skip", reason: "单笔上限是 0" });
  const spent = [{ signal: "s-0", at: "2026-10-30T08:00:00Z", kind: "ordered", amount: 18, note: "", expires: "2026-10-30T08:30:00Z" }];
  assert.deepEqual(decide(SIGNAL, SMALL, state(spent), 0.61, NOW), { kind: "skip", reason: "超当日上限 20" });
  const open = [1, 2, 3].map((i) => ({ signal: `s-${i}`, at: "2026-10-30T07:00:00Z", kind: "followed", amount: 1, note: "", expires: "2026-10-31T00:00:00Z" }));
  assert.deepEqual(decide(SIGNAL, SMALL, state(open), 0.61, NOW), { kind: "skip", reason: "持仓已满 3" });
  assert.deepEqual(decide(SIGNAL, SMALL, state([{ signal: "s-0", at: "2026-10-30T09:00:00Z", kind: "ordered", amount: 1, note: "", expires: "2026-10-30T09:10:00Z" }]), 0.61, NOW), { kind: "skip", reason: "冷却中 60 分钟" });
  assert.deepEqual(decide(SIGNAL, SMALL, state(), 0.66, NOW), { kind: "skip", reason: "价 0.66 超上限 0.63" });
  assert.deepEqual(decide(SIGNAL, SMALL, state(), 0.64, NOW), { kind: "ask", price: 0.64, amount: 5 }, "within the slippage");
  assert.deepEqual(decide(SIGNAL, SMALL, state(), undefined, NOW), { kind: "ask", amount: 5 }, "no price: never an order, a question");
  assert.deepEqual(decide(SIGNAL, riskOf({ ...SMALL, muted: true }), state(), 0.61, NOW), { kind: "skip", reason: "已全停，询问静音" });
  assert.deepEqual(decide(SIGNAL, AUTO, state(), 0.61, NOW), { kind: "order", price: 0.61, amount: 5 });
  assert.deepEqual(decide(SIGNAL, riskOf({ ...AUTO, askAbove: 4 }), state(), 0.61, NOW), { kind: "ask", price: 0.61, amount: 5 }, "above the line: ask");
  assert.deepEqual(decide(SIGNAL, AUTO, state(), undefined, NOW), { kind: "ask", amount: 5 });
});

test("settlement, the stop-loss and the stages: a record settles at expiry against the entry; losses in a row; the stop by drawdown or by losses; the days and the hit rate a stage needs; the lines", () => {
  const price = (_m, at) => (at === "2026-10-30T10:00:00Z" ? 0.5 : at === "2026-10-30T08:30:00Z" ? 0.7 : undefined);
  const s = state([
    { signal: "s-0", at: "2026-10-30T08:00:00Z", kind: "ordered", amount: 5, note: "", market: "m", side: "yes", entry: 0.6, expires: "2026-10-30T08:30:00Z" },
    { signal: "s-1", at: "2026-10-30T09:12:05Z", kind: "followed", amount: 5, note: "", market: "m", side: "yes", entry: 0.61, expires: "2026-10-30T10:00:00Z" },
    { signal: "s-2", at: "2026-10-30T09:12:05Z", kind: "ordered", amount: 5, note: "", market: "m", side: "no", entry: 0.61, expires: "2026-10-30T10:00:00Z" },
    { signal: "s-3", at: "2026-10-30T09:12:05Z", kind: "ordered", amount: 5, note: "", market: "m", side: "yes", entry: 0.61, expires: "2026-10-30T11:00:00Z" },
    { signal: "s-4", at: "2026-10-30T08:00:00Z", kind: "paper", note: "", market: "m", side: "yes", entry: 0.6, expires: "2026-10-30T08:30:00Z" },
  ]);
  assert.equal(settleRecords(s, price, "2026-10-30T10:30:00Z"), 4, "paper records settle too: they are the evidence");
  assert.deepEqual(s.records.map((r) => r.outcome), ["win", "loss", "win", undefined, "win"]);
  assert.deepEqual(localRecord(s), { hits: 3, counted: 4 });
  assert.equal(consecutiveLosses(s), 0, "the latest settled is a win");
  s.records[2].outcome = "loss";
  assert.equal(consecutiveLosses(s), 2);
  assert.equal(stopHit(SMALL, { drawdown: 0.05, losses: 2 }), undefined);
  assert.equal(stopHit(SMALL, { drawdown: 0.12, losses: 0 }), "回撤 12% 到了止损线 10%");
  assert.equal(stopHit(SMALL, { losses: 3 }), "连亏 3 次");
  assert.equal(stopHit(riskOf({ ...SMALL, stop: { drawdown: 0, losses: 0 } }), { drawdown: 0.5, losses: 9 }), undefined, "zero turns a stop off");
  const paper = riskOf({ stageSince: "2026-10-20T00:00:00Z" });
  assert.deepEqual(canAdvance(paper, { hits: 7, counted: 10 }, "2026-10-30T09:00:00Z"), { ok: false, why: `还要 ${PAPER_DAYS - 10} 天` });
  assert.deepEqual(canAdvance(paper, { hits: 5, counted: 10 }, "2026-11-10T09:00:00Z"), { ok: false, why: "命中 ≥ 60%（现在 50%）" });
  assert.deepEqual(canAdvance(paper, undefined, "2026-10-21T09:00:00Z"), { ok: false, why: `还要 ${PAPER_DAYS - 1} 天，且命中 ≥ 60%（现在没有结算的信号）` });
  assert.deepEqual(canAdvance(paper, { hits: 6, counted: 10 }, "2026-11-10T09:00:00Z"), { ok: true, to: "small" });
  assert.deepEqual(canAdvance(SMALL, undefined, "2026-10-30T09:00:00Z"), { ok: false, why: `还要 ${SMALL_DAYS - 10} 天` });
  assert.deepEqual(canAdvance(SMALL, undefined, "2026-11-10T09:00:00Z"), { ok: true, to: "auto" });
  assert.deepEqual(canAdvance(AUTO, undefined, "2026-11-10T09:00:00Z"), { ok: false, why: "已是最高阶段" });
  assert.deepEqual(stageLines(paper, { hits: 7, counted: 10 }, "2026-10-30T09:00:00Z"), ["阶段：纸面 · 第 11 天 · 命中 70%", `升级：还要 ${PAPER_DAYS - 10} 天，主人批准`]);
  assert.deepEqual(stageLines(riskOf({ ...paper, muted: true }), undefined, "2026-10-20T01:00:00Z"), ["阶段：纸面 · 第 1 天 · 命中 — · 询问已静音", `升级：还要 ${PAPER_DAYS} 天，且命中 ≥ 60%（现在没有结算的信号），主人批准`]);
  assert.deepEqual(stageLines(riskOf({ ...paper, stageSince: "2026-10-01T00:00:00Z" }), { hits: 6, counted: 10 }, "2026-10-30T09:00:00Z"), ["阶段：纸面 · 第 30 天 · 命中 60%", "可升级到小仓：主人批准"]);
  assert.deepEqual(stageLines(AUTO, undefined, "2026-10-30T09:00:00Z"), ["阶段：限额内自动 · 第 11 天 · 命中 —", "限额：单笔 ≤ 5 · 当日 ≤ 20 · 最多 3 仓"]);
  assert.equal(HIT_RATE, 0.6);
});

test("the ask card, the execution line, the footer and the disclaimer", () => {
  assert.deepEqual(ASK_ACTIONS, ["跟", "跳过", "全停"]);
  assert.equal(askText(SIGNAL, { price: 0.61, amount: 5 }, undefined, false), "跟 signal-1？过期 10:00 · 买是 · 价 0.61 · 金额 5 · 在风控之内 · agent：未参与");
  assert.equal(askText(SIGNAL, { amount: 5 }, undefined, true), "跟 signal-1？过期 10:00 · 买是 · 价 ≤0.63（还没有报价） · 金额 5 · 在风控之内 · agent：读了论点，没反对");
  assert.equal(askText(SIGNAL, { price: 0.61, amount: 5 }, "数据过时", true), "跟 signal-1？过期 10:00 · 买是 · 价 0.61 · 金额 5 · 在风控之内 · agent：反对：数据过时");
  assert.deepEqual([execLine(undefined), execLine({ signal: "s", at: "", kind: "paper", note: "若跟：0.61 进，2%" }), execLine({ signal: "s", at: "", kind: "asked", note: "" }), execLine({ signal: "s", at: "", kind: "followed", note: "单 ord-1 · 0.61 × 5" }), execLine({ signal: "s", at: "", kind: "ordered", note: "单 ord-2 · 0.61 × 5" }), execLine({ signal: "s", at: "", kind: "skipped", note: "市场不在白名单" }), execLine({ signal: "s", at: "", kind: "failed", note: "connector exited 1" }), execLine({ signal: "s", at: "", kind: "stopped", note: "连亏 3 次" })], ["本机：还没处理", "纸面 · 记为『若跟：0.61 进，2%』· 没下单", "已问主人 · 等定", "跟了 · 单 ord-1 · 0.61 × 5", "自动下单 · 单 ord-2 · 0.61 × 5", "跳过 · 市场不在白名单", "下单失败 · connector exited 1", "全停 · 连亏 3 次"]);
  assert.equal(FOOTER, "平台不托管资金、不经手密钥 · 订阅时已展示免责条款 · 发布方看不到你跟没跟");
  assert.match(DISCLAIMER, /^免责条款：/);
});
