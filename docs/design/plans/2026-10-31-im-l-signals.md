# IM Plan L: Signals, Subscription Channels, the Local Execution Module

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ⑥ (§10): the signal message with its fixed fields (§10.1), published by the publisher's agent into a 订阅频道 after its host sealed it on the host's own chain and stamped again by the relay on receipt (§10.2); the retraction that stays on the chain; performance computed by the platform by one fixed public rule over every signal, retracted ones included, from a price series the relay keeps with hashes (§10.3); the channel as a product sold by the month or by the signal, the subscriber's row saying the stage and today's count, the publisher seeing only the subscriber count (§10.4); the local execution module the host runs, never the model: the risk file, the three stages 纸面 → 小仓 → 限额内自动 with evidence and the owner's approval to move up, the paper record, the ask card with 跟 · 跳过 · 全停, the order through the owner's own connector command, and any error or stop-loss dropping the channel back to 纸面 with a 卡住 in the inbox (§10.5); the footer and the disclaimer (§10.6).

**Architecture:** Two pure modules: `src/core/im/signal.ts` (the record, its faults, the chain's fold, the price lookup, the rule and the words) and `src/core/im/risk.ts` (the risk file, the stages, the one decision per signal, the settlement of local records, the stop-loss, the ask and the lines). The relay grows channels with a price and a publisher, subscriptions paid through the ledger (`subscribe` entries), the signal chain `signals/<agent>.geml` under the publisher's owner, the `signal` message in the channel pointing at the chain block, retraction, prices under `_relay/prices/`, performance, and lapsed subscribers swept by `tick`. The daemon mirrors the chains of the channels the person is in and runs the execution module after every sync (`src/daemon/exec.ts`): the risk file and the execution state live under the home, the connector is a command (like the relay's mail command), the asks and the 卡住 are local needs on the band. The bridge answers those needs and the `im-signal` op; the `im_signal` tool lets the publisher's agent publish and retract, and a subscriber's agent object to one signal. The CLI gets `connect channel`, `connect signal`, `connect risk`, `relay price`.

**Tech Stack:** TypeScript (`src/core` pure, `src/relay`, `src/daemon`, `src/bridge.ts`, `src/hosts/claude-code`, `hooks/register.tsx`), `node:test` over `dist/`, `claude plugin test` for the hooks.

**Before this plan:** plans A–K are on `main` (0.3.4).

---

## File structure

| File | Responsibility |
|---|---|
| `src/core/im/signal.ts` (new) | `Signal`, `signalFaults`, `signalInput`, `foldSignals`, `signalText`, `signalLines`, `priceAt`, `performanceOf`, `performanceLine`, `RULE_WORDS`. |
| `src/core/im/risk.ts` (new) | `Risk`, `DEFAULT_RISK`, `riskOf`, `decide`, `settleRecords`, `consecutiveLosses`, `stopHit`, `canAdvance`, `stageLines`, `askText`, `execLine`, `FOOTER`, `DISCLAIMER`. |
| `src/core/im/venue.ts`, `src/core/im/message.ts`, `src/core/im/ledger.ts` | A channel's `price` and `publisher`; a message's `signal` pointer; the `subscribe` entry kind. |
| `src/relay/relay.ts`, `src/relay/api.ts` | Channels, subscriptions, the signal chain and message, retraction, prices, performance, the sweep of lapsed subscribers; the routes. |
| `src/daemon/exec.ts` (new) | The local execution module: the risk file, the state, `runExec`, `answerExecNeed`, `execNeeds`, `channelView`, `commandConnector`. |
| `src/daemon/home.ts`, `sync.ts`, `deliver.ts`, `view.ts` | The outbox kinds `signal` and `retract`; the chains followed; the module run after each sync; `publishSignal`/`retractSignal`; the channel's row, head, cards and footer. |
| `src/bridge.ts`, `src/hosts/claude-code/protocol.ts`, `im.ts`, `hooks/register.tsx` | The `im-signal` op and the needs with `exec:` keys; the `im_signal` tool; the channel's rows. |
| `src/cli.ts` | `connect channel new|list|subscribe`, `connect signal publish|retract|list`, `connect risk`, `relay price`. |
| Tests | `test/signal.test.mjs`, `test/risk.test.mjs`, `test/relay-signal.test.mjs`, `test/daemon-exec.test.mjs`, `test/signal-cli.test.mjs` new; `test/ledger.test.mjs`, `test/im-host.test.mjs`, `test/bridge-im.test.mjs`, `tests/hooks.test.ts` learn the rest. |

---

### Task 1: Branch and baseline

- [ ] **Step 1: Branch from main**

```bash
git switch -c im/l-signals
git log --oneline -1
```
Expected: `63e7800 gemsbang 0.3.4: …` (or later on main).

- [ ] **Step 2: Baseline**

```bash
node --test --test-concurrency=2 test/*.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
```
Expected: `ℹ pass 959`, `ℹ fail 0`.

---

### Task 2: The pure parts: the signal and the rule, the risk file and the decision

**Files:**
- Create: `src/core/im/signal.ts`, `src/core/im/risk.ts`
- Modify: `src/core/im/ledger.ts` (the `subscribe` kind), `test/ledger.test.mjs`
- Test: `test/signal.test.mjs`, `test/risk.test.mjs`

- [ ] **Step 1: Write the failing tests**

```js
// test/signal.test.mjs
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
```

```js
// test/risk.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { ASK_ACTIONS, askText, canAdvance, consecutiveLosses, decide, DEFAULT_RISK, DISCLAIMER, EMPTY_EXEC, execLine, FOOTER, HIT_RATE, PAPER_DAYS, riskOf, settleRecords, SMALL_DAYS, STAGE_WORDS, stageLines, stopHit } from "../dist/core/im/risk.js";

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
  ]);
  assert.equal(settleRecords(s, price, "2026-10-30T10:30:00Z"), 3);
  assert.deepEqual(s.records.map((r) => r.outcome), ["win", "loss", "win", undefined]);
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
```

In `test/ledger.test.mjs`, `  assert.deepEqual(KIND_WORDS.settle, "结算");` gains after it:

```js
  assert.equal(KIND_WORDS.subscribe, "订阅");
```

- [ ] **Step 2: Run them to see them fail**

```bash
node --test test/signal.test.mjs test/risk.test.mjs test/ledger.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
```
Expected: `ℹ fail 3` or more.

- [ ] **Step 3: Write `src/core/im/signal.ts`**

```ts
// A signal (§10.1): fixed fields, data and never a prompt, @ nobody. The
// publisher's host seals it on its own chain first and the relay stamps it
// again on receipt (§10.2); a retraction stays on the chain. Performance is
// the platform's, by one fixed public rule over every signal, the retracted
// ones included, from a price series kept with hashes (§10.3). Pure: the
// record, its faults, the chain's fold, the price lookup, the rule, the words.

export type Side = "yes" | "no";
export const SIDE_WORDS: Readonly<Record<Side, string>> = { yes: "买是", no: "买否" };
export interface SizeHint { kind: "fraction-of-bankroll"; value: number }
export interface SignalInput { market: string; side: Side; sizeHint: SizeHint; priceCap: number; expires: string; confidence: number; thesis?: string }
export interface Signal extends SignalInput {
  id: string;
  /** The publisher's agent. */
  from: string;
  /** The publisher's stamp, and the relay's on receipt (§10.2). */
  at: string;
  received: string;
  /** The hash the publisher's host sealed it with, when it sent one. */
  hostHash?: string;
  /** The channel it went into, `<owner>/<id>`. */
  channel?: string;
  /** When it was retracted; it stays on the chain and counts (§10.2). */
  retracted?: string;
}

const obj = (v: unknown): Record<string, unknown> | undefined => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** Every field checked (§10.1); the thesis is optional. */
export function signalFaults(v: unknown): string[] {
  const o = obj(v) ?? {};
  const out: string[] = [];
  if ((str(o["market"]) ?? "").trim() === "") out.push("缺市场");
  if (o["side"] !== "yes" && o["side"] !== "no") out.push("方向是 yes 或 no");
  const hint = obj(o["sizeHint"]);
  const fraction = hint === undefined ? undefined : num(hint["value"]);
  if (hint?.["kind"] !== "fraction-of-bankroll" || fraction === undefined || fraction <= 0 || fraction > 1) out.push("仓位提示是 { kind: fraction-of-bankroll, value: 0 到 1 }");
  const cap = num(o["priceCap"]);
  if (cap === undefined || cap <= 0) out.push("价格上限是正数");
  const expires = str(o["expires"]);
  if (expires === undefined || Number.isNaN(Date.parse(expires))) out.push("过期时间要是 ISO 时间");
  const confidence = num(o["confidence"]);
  if (confidence === undefined || confidence < 0 || confidence > 1) out.push("信心是 0 到 1");
  if (o["thesis"] !== undefined && typeof o["thesis"] !== "string") out.push("论点引用是地址");
  return out;
}

/** The input normalized, or nothing when it has faults. */
export function signalInput(v: unknown): SignalInput | undefined {
  if (signalFaults(v).length > 0) return undefined;
  const o = obj(v)!;
  const hint = obj(o["sizeHint"])!;
  const s: SignalInput = { market: (o["market"] as string).trim(), side: o["side"] as Side, sizeHint: { kind: "fraction-of-bankroll", value: hint["value"] as number }, priceCap: o["priceCap"] as number, expires: o["expires"] as string, confidence: o["confidence"] as number };
  const thesis = str(o["thesis"]);
  if (thesis !== undefined && thesis !== "") s.thesis = thesis;
  return s;
}

/** The chain `signals/<agent>.geml` folded: a `signal-N` block a signal, a `retract-N` block the mark on one. */
export function foldSignals(blocks: readonly { id: string; value: Record<string, unknown> }[]): Signal[] {
  const out: Signal[] = [];
  for (const b of blocks) {
    if (/^signal-\d+$/.test(b.id)) {
      const input = signalInput(b.value);
      if (input === undefined) continue;
      const s: Signal = { ...input, id: b.id, from: str(b.value["from"]) ?? "", at: str(b.value["at"]) ?? "", received: str(b.value["received"]) ?? "" };
      const hostHash = str(b.value["hostHash"]); if (hostHash !== undefined) s.hostHash = hostHash;
      const channel = str(b.value["channel"]); if (channel !== undefined) s.channel = channel;
      out.push(s);
    } else if (/^retract-\d+$/.test(b.id)) {
      const target = out.find((s) => s.id === str(b.value["signal"]));
      if (target !== undefined && target.retracted === undefined) target.retracted = str(b.value["at"]) ?? "";
    }
  }
  return out;
}

const hhmm = (at: string): string => at.slice(11, 16);
const hhmmss = (at: string): string => at.slice(11, 19);
const mmdd = (at: string): string => `${at.slice(5, 10)} ${hhmm(at)}`;
const pct = (f: number): string => `${Math.round(f * 1000) / 10}%`;
const signedPct = (f: number): string => (f < 0 ? `−${pct(-f)}` : f > 0 ? `+${pct(f)}` : "0%");

/** The message's text in the channel: the signal in one line. */
export const signalText = (s: Pick<Signal, "id" | "market" | "side" | "priceCap" | "expires">): string => `信号 ${s.id} · ${s.market} · ${SIDE_WORDS[s.side]} · 价 ≤${s.priceCap} · 过期 ${hhmm(s.expires)}`;

/** The signal card (§10.4): the kind and id with both stamps, the fields, the thesis, and what the local module did with it. */
export function signalLines(s: Signal, exec?: string): string[] {
  return [
    `信号 ${s.id} · 发布 ${hhmmss(s.at)} · 中继收到 ${hhmmss(s.received)}${s.retracted !== undefined ? " · 已撤回" : ""}`,
    `市场 ${s.market} · ${SIDE_WORDS[s.side]} · 价 ≤${s.priceCap} · 仓位 ${pct(s.sizeHint.value)} · 过期 ${mmdd(s.expires)} · 信心 ${s.confidence}`,
    ...(s.thesis !== undefined ? [`论点 ${s.thesis}`] : []),
    ...(exec !== undefined ? [exec] : []),
  ];
}

export interface PricePoint { at: string; price: number }

/** The last price at or before the moment; nothing before the first point. The points are in time order. */
export function priceAt(points: readonly PricePoint[], at: string): number | undefined {
  let found: number | undefined;
  for (const p of points) { if (p.at <= at) found = p.price; else break; }
  return found;
}

/** The fixed public rule (§10.3): in at the receipt price when it is within the cap, with this fraction; out at expiry at that price. */
export const FOLLOW_FRACTION = 0.02;
export const PERFORMANCE_DAYS = 90;
export const RULE_WORDS = `固定规则：中继收到时价格在上限内就以 ${pct(FOLLOW_FRACTION)} 仓位进，到期按当时价出；撤回的仍计入；价格来自公开源并存哈希`;

export interface Performance { hits: number; counted: number; open: number; return90: number; drawdown: number; retracted: number; rule: string }

const round4 = (n: number): number => Math.round(n * 10000) / 10000;

/** Every signal by the rule, in the order the relay received them: the hits, the return of the last 90 days, the deepest drawdown of the running return; a retracted one counts; an unentered, unpriced or still-open one does not. */
export function performanceOf(signals: readonly Signal[], price: (market: string, at: string) => number | undefined, now: string): Performance {
  let hits = 0, counted = 0, open = 0, retracted = 0, return90 = 0, equity = 0, peak = 0, drawdown = 0;
  const since = new Date(Date.parse(now) - PERFORMANCE_DAYS * 86_400_000).toISOString();
  for (const s of [...signals].sort((a, b) => (a.received < b.received ? -1 : a.received > b.received ? 1 : 0))) {
    if (s.retracted !== undefined) retracted++;
    const entry = price(s.market, s.received);
    if (entry === undefined || entry > s.priceCap) continue;
    if (s.expires > now) { open++; continue; }
    const exit = price(s.market, s.expires);
    if (exit === undefined) continue;
    counted++;
    const r = FOLLOW_FRACTION * ((exit - entry) / entry) * (s.side === "yes" ? 1 : -1);
    if (r > 0) hits++;
    if (s.received >= since) return90 += r;
    equity += r;
    peak = Math.max(peak, equity);
    drawdown = Math.max(drawdown, peak - equity);
  }
  return { hits, counted, open, return90: round4(return90), drawdown: round4(drawdown), retracted, rule: RULE_WORDS };
}

/** The four numbers of the performance page (§10.4). */
export const performanceLine = (p: Performance): string => `命中 ${p.hits}/${p.counted} · 90 天收益 ${signedPct(p.return90)} · 最大回撤 ${pct(p.drawdown)} · 已撤回 ${p.retracted}（仍计入）`;
```

- [ ] **Step 4: Write `src/core/im/risk.ts`**

```ts
// The local execution module's rules (§10.5): the risk file the host keeps
// for a channel, the three stages and what each needs to move up, the one
// decision the module makes per signal — a paper record, a question to the
// owner, an order within the file, or a skip with its reason — the
// settlement of what it followed, and the stop-loss. The host runs it, never
// the model; an agent may object to a signal, never widen the file. Pure.
import { FOLLOW_FRACTION, SIDE_WORDS, type Signal } from "./signal.js";

export type Stage = "paper" | "small" | "auto";
export const STAGE_WORDS: Readonly<Record<Stage, string>> = { paper: "纸面", small: "小仓", auto: "限额内自动" };
/** What a stage needs before the owner may move the channel up (§10.5 三阶段). */
export const PAPER_DAYS = 14;
export const SMALL_DAYS = 14;
export const HIT_RATE = 0.6;

export interface Risk {
  /** The markets allowed. */
  markets: string[];
  perOrder: number;
  perDay: number;
  maxPositions: number;
  /** How far over the signal's cap an order may still go. */
  maxSlippage: number;
  cooldownMinutes: number;
  minConfidence: number;
  /** An order above this asks first even in 限额内自动; 0 never asks. */
  askAbove: number;
  stop: { drawdown: number; losses: number };
  stage: Stage;
  stageSince: string;
  /** 全停: back on 纸面 and no more asks until the owner lifts it. */
  muted: boolean;
  /** The owner lets the agent read each thesis and object. */
  agentReads: boolean;
  /** The owner's own exchange connector: a command given the order on stdin. */
  connector?: string;
}
export const DEFAULT_RISK: Risk = { markets: [], perOrder: 0, perDay: 0, maxPositions: 0, maxSlippage: 0.02, cooldownMinutes: 60, minConfidence: 0.6, askAbove: 0, stop: { drawdown: 0.1, losses: 3 }, stage: "paper", stageSince: "", muted: false, agentReads: false };

const obj = (v: unknown): Record<string, unknown> | undefined => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const strings = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()) : undefined);
const pct = (f: number): string => `${Math.round(f * 1000) / 10}%`;

/** A risk file from a body, each field given replacing the current's, a bad one kept out; `connector: null` removes the connector. */
export function riskOf(v: unknown, current: Risk = DEFAULT_RISK): Risk {
  const o = obj(v) ?? {};
  const out: Risk = { ...current, markets: [...current.markets], stop: { ...current.stop } };
  const markets = strings(o["markets"]); if (markets !== undefined) out.markets = markets;
  for (const k of ["perOrder", "perDay", "maxPositions", "maxSlippage", "cooldownMinutes", "minConfidence", "askAbove"] as const) { const n = num(o[k]); if (n !== undefined && n >= 0) out[k] = n; }
  const stop = obj(o["stop"]);
  if (stop !== undefined) {
    const d = num(stop["drawdown"]); if (d !== undefined && d >= 0) out.stop.drawdown = d;
    const l = num(stop["losses"]); if (l !== undefined && l >= 0) out.stop.losses = l;
  }
  if (o["stage"] === "paper" || o["stage"] === "small" || o["stage"] === "auto") out.stage = o["stage"];
  const since = str(o["stageSince"]); if (since !== undefined) out.stageSince = since;
  if (typeof o["muted"] === "boolean") out.muted = o["muted"];
  if (typeof o["agentReads"] === "boolean") out.agentReads = o["agentReads"];
  if (o["connector"] === null) delete out.connector;
  else { const c = str(o["connector"]); if (c !== undefined && c.trim() !== "") out.connector = c.trim(); }
  return out;
}

/** What the module did with a signal: the record under the card. */
export interface ExecRecord {
  signal: string;
  at: string;
  kind: "paper" | "asked" | "followed" | "skipped" | "ordered" | "failed" | "stopped";
  note: string;
  market?: string;
  side?: "yes" | "no";
  entry?: number;
  amount?: number;
  expires?: string;
  order?: string;
  /** Settled at expiry against the entry. */
  outcome?: "win" | "loss";
}
/** A question to the owner not yet answered (§10.5 小仓: 每一笔都是询问卡). */
export interface PendingAsk { signal: string; at: string; price?: number; amount: number; expires: string; text: string }
export interface ExecState { records: ExecRecord[]; asks: PendingAsk[]; objections: Record<string, string>; stuck?: string }
export const EMPTY_EXEC: ExecState = { records: [], asks: [], objections: {} };

export type Decision = { kind: "paper"; entry: number; note: string } | { kind: "ask"; price?: number; amount: number } | { kind: "order"; price: number; amount: number } | { kind: "skip"; reason: string };

const placed = (r: ExecRecord): boolean => r.kind === "ordered" || r.kind === "followed";

/** The one decision per signal (§10.5): 纸面 only records; the file's checks each a skip with its reason; 小仓 asks; 限额内自动 orders, asks above the line; no price, no order. */
export function decide(s: Signal, risk: Risk, state: ExecState, price: number | undefined, now: string): Decision {
  if (s.retracted !== undefined) return { kind: "skip", reason: "已撤回" };
  if (s.expires <= now) return { kind: "skip", reason: "已过期" };
  const objection = state.objections[s.id];
  if (objection !== undefined) return { kind: "skip", reason: `agent 反对：${objection}` };
  if (risk.stage === "paper") { const entry = price ?? s.priceCap; return { kind: "paper", entry, note: `若跟：${entry} 进，${pct(FOLLOW_FRACTION)}` }; }
  if (!risk.markets.includes(s.market)) return { kind: "skip", reason: "市场不在白名单" };
  if (s.confidence < risk.minConfidence) return { kind: "skip", reason: `信心 ${s.confidence} 低于 ${risk.minConfidence}` };
  const amount = risk.perOrder;
  if (amount <= 0) return { kind: "skip", reason: "单笔上限是 0" };
  const today = state.records.filter((r) => placed(r) && r.at.slice(0, 10) === now.slice(0, 10)).reduce((n, r) => n + (r.amount ?? 0), 0);
  if (today + amount > risk.perDay) return { kind: "skip", reason: `超当日上限 ${risk.perDay}` };
  const positions = state.records.filter((r) => placed(r) && r.expires !== undefined && r.expires > now).length;
  if (positions >= risk.maxPositions) return { kind: "skip", reason: `持仓已满 ${risk.maxPositions}` };
  const last = [...state.records].reverse().find(placed);
  if (last !== undefined && Date.parse(now) - Date.parse(last.at) < risk.cooldownMinutes * 60_000) return { kind: "skip", reason: `冷却中 ${risk.cooldownMinutes} 分钟` };
  if (price !== undefined && price > s.priceCap * (1 + risk.maxSlippage)) return { kind: "skip", reason: `价 ${price} 超上限 ${s.priceCap}` };
  const ask = price === undefined || risk.stage === "small" || (risk.askAbove > 0 && amount > risk.askAbove);
  if (ask) return risk.muted ? { kind: "skip", reason: "已全停，询问静音" } : { kind: "ask", ...(price !== undefined ? { price } : {}), amount };
  return { kind: "order", price: price!, amount };
}

/** Each placed record settled once its signal expired: a win when the price moved the signal's way. How many settled now. */
export function settleRecords(state: ExecState, price: (market: string, at: string) => number | undefined, now: string): number {
  let n = 0;
  for (const r of state.records) {
    if (!placed(r) || r.outcome !== undefined || r.expires === undefined || r.expires > now || r.entry === undefined || r.market === undefined) continue;
    const exit = price(r.market, r.expires);
    if (exit === undefined) continue;
    r.outcome = (exit - r.entry) * (r.side === "no" ? -1 : 1) > 0 ? "win" : "loss";
    n++;
  }
  return n;
}

/** Losses in a row among the settled records, newest first. */
export function consecutiveLosses(state: ExecState): number {
  let n = 0;
  for (const r of [...state.records].reverse()) {
    if (!placed(r) || r.outcome === undefined) continue;
    if (r.outcome === "loss") n++; else break;
  }
  return n;
}

/** The stop-loss (§10.5): the drawdown past the file's line, or that many losses in a row; a zero turns the check off. The caller drops the channel to 纸面. */
export function stopHit(risk: Risk, o: { drawdown?: number; losses: number }): string | undefined {
  if (o.drawdown !== undefined && risk.stop.drawdown > 0 && o.drawdown >= risk.stop.drawdown) return `回撤 ${pct(o.drawdown)} 到了止损线 ${pct(risk.stop.drawdown)}`;
  if (risk.stop.losses > 0 && o.losses >= risk.stop.losses) return `连亏 ${o.losses} 次`;
  return undefined;
}

export const stageDays = (risk: Risk, now: string): number => (risk.stageSince === "" ? 0 : Math.max(0, Math.floor((Date.parse(now) - Date.parse(risk.stageSince)) / 86_400_000)));

/** Whether the owner may move the channel up (§10.5): 纸面 needs its days and the hit rate, 小仓 its days; the approval is theirs. */
export function canAdvance(risk: Risk, perf: { hits: number; counted: number } | undefined, now: string): { ok: true; to: Stage } | { ok: false; why: string } {
  const days = stageDays(risk, now);
  if (risk.stage === "paper") {
    const need: string[] = [];
    if (days < PAPER_DAYS) need.push(`还要 ${PAPER_DAYS - days} 天`);
    const rate = perf === undefined || perf.counted === 0 ? undefined : perf.hits / perf.counted;
    if (rate === undefined || rate < HIT_RATE) need.push(`命中 ≥ ${pct(HIT_RATE)}（现在${rate === undefined ? "没有结算的信号" : ` ${pct(rate)}`}）`);
    return need.length === 0 ? { ok: true, to: "small" } : { ok: false, why: need.join("，且") };
  }
  if (risk.stage === "small") return days < SMALL_DAYS ? { ok: false, why: `还要 ${SMALL_DAYS - days} 天` } : { ok: true, to: "auto" };
  return { ok: false, why: "已是最高阶段" };
}

/** The stage card (§10.5): which stage and its day, the hit rate so far, what is still missing. */
export function stageLines(risk: Risk, perf: { hits: number; counted: number } | undefined, now: string): string[] {
  const rate = perf === undefined || perf.counted === 0 ? "命中 —" : `命中 ${pct(perf.hits / perf.counted)}`;
  const head = `阶段：${STAGE_WORDS[risk.stage]} · 第 ${stageDays(risk, now) + 1} 天 · ${rate}${risk.muted ? " · 询问已静音" : ""}`;
  if (risk.stage === "auto") return [head, `限额：单笔 ≤ ${risk.perOrder} · 当日 ≤ ${risk.perDay} · 最多 ${risk.maxPositions} 仓`];
  const up = canAdvance(risk, perf, now);
  return [head, up.ok ? `可升级到${STAGE_WORDS[up.to]}：主人批准` : `升级：${up.why}，主人批准`];
}

export const ASK_ACTIONS = ["跟", "跳过", "全停"] as const;

/** The ask card of 小仓 (§10.5): the signal, its expiry, side, price, amount, that it is within the file, and whether the agent read the thesis. */
export function askText(s: Signal, d: { price?: number; amount: number }, objection: string | undefined, agentReads: boolean): string {
  const agent = !agentReads ? "未参与" : objection === undefined ? "读了论点，没反对" : `反对：${objection}`;
  return `跟 ${s.id}？过期 ${s.expires.slice(11, 16)} · ${SIDE_WORDS[s.side]} · 价 ${d.price ?? `≤${s.priceCap}（还没有报价）`} · 金额 ${d.amount} · 在风控之内 · agent：${agent}`;
}

/** The line under the signal card: what the local module did (§10.4). */
export function execLine(r: ExecRecord | undefined): string {
  if (r === undefined) return "本机：还没处理";
  switch (r.kind) {
    case "paper": return `纸面 · 记为『${r.note}』· 没下单`;
    case "asked": return "已问主人 · 等定";
    case "followed": return `跟了 · ${r.note}`;
    case "ordered": return `自动下单 · ${r.note}`;
    case "skipped": return `跳过 · ${r.note}`;
    case "failed": return `下单失败 · ${r.note}`;
    case "stopped": return `全停 · ${r.note}`;
  }
}

export const FOOTER = "平台不托管资金、不经手密钥 · 订阅时已展示免责条款 · 发布方看不到你跟没跟";
export const DISCLAIMER = "免责条款：信号只是发布方 agent 的意见，不是投资建议；平台不托管资金、不经手密钥，跟不跟、跟多少由你本机的风控文件决定，盈亏自负；有些地区卖信号受监管，订阅前请按当地规定核实。";
```

- [ ] **Step 5: The `subscribe` kind in `ledger.ts`**

`export type EntryKind = "topup" | "gift" | "packet" | "tip" | "escrow" | "settle" | "refund" | "fee" | "spend" | "favor";` becomes `export type EntryKind = "topup" | "gift" | "packet" | "tip" | "escrow" | "settle" | "refund" | "fee" | "spend" | "favor" | "subscribe";` and `KIND_WORDS` gains `, subscribe: "订阅"` before its closing ` }` (`spend: "消耗", favor: "人情" };` becomes `spend: "消耗", favor: "人情", subscribe: "订阅" };`).

- [ ] **Step 6: Build and run**

```bash
npm run build 2>&1 | tail -2 && node --test test/signal.test.mjs test/risk.test.mjs test/ledger.test.mjs test/purity.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
```
Expected: `ℹ fail 0`.

- [ ] **Step 7: Commit**

```bash
git add src/core/im/signal.ts src/core/im/risk.ts src/core/im/ledger.ts test/signal.test.mjs test/risk.test.mjs test/ledger.test.mjs
git commit -m "IM core: the signal and the fixed rule, the risk file and the one decision per signal"
```

---

### Task 3: The relay: channels and subscriptions, the signal chain and message, retraction, prices and performance

**Files:**
- Modify: `src/core/im/venue.ts`, `src/core/im/message.ts`, `src/relay/relay.ts`, `src/relay/api.ts`
- Modify: `test/relay-task.test.mjs`, `test/relay-wallet.test.mjs` (the sweep's result grows a field)
- Test: `test/relay-signal.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// test/relay-signal.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { route } from "../dist/relay/api.js";
import { Relay } from "../dist/relay/relay.js";
import { readDoc } from "../dist/relay/store.js";
import { DISCLAIMER } from "../dist/core/im/risk.js";

const BASE = Date.UTC(2026, 9, 31, 9, 0, 0);
function relay() {
  let offset = 0;
  const now = () => { const t = new Date(BASE + offset).toISOString().replace(/\.\d{3}Z$/, "Z"); offset += 1000; return t; };
  const r = new Relay({ root: mkdtempSync(join(tmpdir(), "gemworks-relay-")), name: "relay.test", version: "0.0.0", now });
  r.advance = (ms) => { offset += ms; };
  return r;
}
function call(r, line, { token, body } = {}) {
  const [method, path] = line.split(" ");
  const res = route({ method, path, query: {}, ...(token !== undefined ? { token } : {}), ...(body !== undefined ? { body } : {}) }, r);
  return { status: res.status, json: res.type.startsWith("application/json") ? JSON.parse(res.body) : undefined, text: res.body };
}
const SIGNAL = { market: "polymarket:will-x-happen-by-dec", side: "yes", sizeHint: { kind: "fraction-of-bankroll", value: 0.02 }, priceCap: 0.63, expires: "2026-10-31T10:00:00Z", confidence: 0.7, thesis: "https://relay.test/zhang/venues/ch-1.geml#why" };

/** 张 (agent alpha, the publisher), john (agent 小评, 100 credits), 李四 (the free 20). */
function world() {
  const r = relay();
  const zhang = r.issuePerson("zhang"), john = r.issuePerson("john"), lisi = r.issuePerson("lisi");
  const alpha = r.issueAgent(zhang.record, "alpha"), xiaoping = r.issueAgent(john.record, "xiaoping");
  r.topUp("john", 100);
  const made = r.createVenue(zhang.record, { id: "ch-1", kind: "channel", name: "alpha 的信号", agents: ["agent:alpha@zhang"], price: { month: 30, signal: 2 } });
  assert.equal(made.ok, true, made.reason);
  return { r, zhang, john, lisi, alpha, xiaoping };
}

test("a channel (§10.4): the owner's one agent as its publisher, a price by the month and by the signal; listed with its subscriber count and performance; the venues listing names the publisher", () => {
  const { r, zhang, john, alpha } = world();
  assert.equal(r.createVenue(zhang.record, { id: "ch-2", kind: "channel", name: "x", agents: [] }).reason, "订阅频道要一个自己的 agent 发信号，只能一个");
  assert.equal(r.createVenue(zhang.record, { id: "ch-2", kind: "channel", name: "x", agents: ["agent:alpha@zhang", "agent:xiaoping@john"] }).reason, "订阅频道要一个自己的 agent 发信号，只能一个");
  assert.equal(r.createVenue(john.record, { id: "ch-2", kind: "channel", name: "x", agents: ["agent:alpha@zhang"] }).reason, "订阅频道要一个自己的 agent 发信号，只能一个");
  assert.equal(r.createVenue(zhang.record, { id: "ch-2", kind: "channel", name: "x", agents: ["agent:alpha@zhang"], price: { month: -1 } }).reason, "价格 month 是非负整数");
  const v = r.venueOf("zhang", "ch-1").venue;
  assert.deepEqual([v.kind, v.publisher, v.price, v.people, v.agents], ["channel", "alpha", { month: 30, signal: 2 }, ["zhang"], ["alpha"]]);
  assert.deepEqual(call(r, "GET /channels", { token: john.token }).json, [{ owner: "zhang", id: "ch-1", name: "alpha 的信号", publisher: "alpha", price: { month: 30, signal: 2 }, subscribers: 0, performance: { hits: 0, counted: 0, open: 0, return90: 0, drawdown: 0, retracted: 0, rule: r.performanceOf("zhang", "alpha").rule } }]);
  assert.deepEqual(call(r, "GET /venues", { token: zhang.token }).json, [{ owner: "zhang", id: "ch-1", kind: "channel", name: "alpha 的信号", publisher: "alpha" }]);
  void alpha;
});

test("a subscription (§10.4, §10.6): paid from the wallet to the publisher's owner, the disclaimer shown; by the month until a day, by the signal counted off; the owner needs none, an agent may not, the broke may not; a subscriber may read but not speak; the publisher sees only the count", () => {
  const { r, zhang, john, lisi, alpha } = world();
  assert.equal(call(r, "POST /channels/zhang/ch-1/subscribe", { token: lisi.token, body: { month: true } }).json.error, "积分不够：钱包 20，要 30");
  assert.equal(call(r, "POST /channels/zhang/ch-1/subscribe", { token: zhang.token, body: { month: true } }).json.error, "自己的频道不用订阅");
  assert.equal(call(r, "POST /channels/zhang/ch-1/subscribe", { token: alpha.token, body: { month: true } }).status, 403);
  assert.equal(call(r, "POST /channels/zhang/ch-1/subscribe", { token: lisi.token, body: {} }).json.error, "订阅写 { month: true } 或 { signals: N }");
  assert.equal(call(r, "POST /channels/zhang/ch-1/subscribe", { token: lisi.token, body: { signals: 0 } }).status, 400);
  const bySignal = call(r, "POST /channels/zhang/ch-1/subscribe", { token: lisi.token, body: { signals: 3 } });
  assert.deepEqual([bySignal.status, bySignal.json.left, bySignal.json.until, bySignal.json.disclaimer, bySignal.json.venue.people], [200, 3, undefined, DISCLAIMER, ["zhang", "lisi"]]);
  assert.deepEqual([r.balance("lisi"), r.balance("zhang")], [14, 26]);
  assert.deepEqual(r.ledgerOf("lisi").at(-1).kind, "subscribe");
  assert.equal(r.ledgerOf("zhang").at(-1).note, "「alpha 的信号」· 3 条");
  const byMonth = call(r, "POST /channels/zhang/ch-1/subscribe", { token: john.token, body: { month: true } });
  assert.deepEqual([byMonth.status, byMonth.json.left, r.balance("john")], [200, undefined, 90]);
  assert.match(byMonth.json.until, /^2026-11-30T09:00:\d\dZ$/);
  assert.equal(call(r, "GET /channels", { token: john.token }).json[0].subscribers, 2);
  assert.equal(call(r, "GET /zhang/venues/ch-1.geml", { token: lisi.token }).status, 200, "a subscriber reads the channel");
  assert.equal(call(r, "POST /venues/zhang/ch-1/messages", { token: john.token, body: { id: "m-1", text: "hi" } }).json.error, "订阅频道只有信号，由发布方的 agent 用 im_signal 发");
  const free = relay();
  const zhao = free.issuePerson("zhao"), qian = free.issuePerson("qian");
  free.issueAgent(zhao.record, "beta");
  free.createVenue(zhao.record, { id: "ch-f", kind: "channel", name: "免费", agents: ["agent:beta@zhao"] });
  assert.equal(call(free, "POST /channels/zhao/ch-f/subscribe", { token: qian.token, body: { month: true } }).json.error, "这个频道不按月卖");
  assert.equal(call(free, "POST /channels/zhao/ch-f/subscribe", { token: qian.token, body: { signals: 5 } }).json.error, "这个频道不按条卖");
});

test("a signal (§10.1, §10.2): by the channel's publisher agent only, every field checked; onto the agent's chain with the host's stamp and hash and the relay's receipt, then a signal message in the channel pointing at the block; a retraction by the agent or its owner stays on the chain and the channel hears it", () => {
  const { r, zhang, john, lisi, alpha, xiaoping } = world();
  call(r, "POST /channels/zhang/ch-1/subscribe", { token: john.token, body: { month: true } });
  assert.equal(call(r, "POST /signals", { token: john.token, body: { ...SIGNAL, channel: "zhang/ch-1" } }).json.error, "信号由 agent 发");
  assert.equal(call(r, "POST /signals", { token: xiaoping.token, body: { ...SIGNAL, channel: "zhang/ch-1" } }).json.error, "只有频道的发布方 agent 能发信号");
  assert.equal(call(r, "POST /signals", { token: alpha.token, body: { ...SIGNAL, channel: "zhang/nope" } }).status, 404);
  assert.equal(call(r, "POST /signals", { token: alpha.token, body: { channel: "zhang/ch-1", market: "m" } }).json.error, "方向是 yes 或 no；仓位提示是 { kind: fraction-of-bankroll, value: 0 到 1 }；价格上限是正数；过期时间要是 ISO 时间；信心是 0 到 1");
  const made = call(r, "POST /signals", { token: alpha.token, body: { ...SIGNAL, channel: "zhang/ch-1", at: "2026-10-31T08:59:00Z", hostHash: "sha256:host1" } });
  assert.equal(made.status, 201, made.text);
  const s1 = made.json.signal;
  assert.deepEqual([s1.id, s1.from, s1.at, s1.hostHash, s1.channel, s1.market, s1.thesis, made.json.address], ["signal-1", "agent:alpha@zhang", "2026-10-31T08:59:00Z", "sha256:host1", "zhang/ch-1", SIGNAL.market, SIGNAL.thesis, "https://relay.test/zhang/signals/alpha.geml#signal-1"]);
  assert.match(s1.received, /^2026-10-31T09:00:\d\dZ$/, "the relay's own stamp");
  assert.deepEqual(readDoc(r.root, "zhang", "signals/alpha.geml").blocks.map((b) => b.id), ["signal-1"]);
  const msg = r.venueOf("zhang", "ch-1").messages.at(-1);
  assert.deepEqual([msg.kind, msg.speaker, msg.text, msg.signal, msg.hops], ["signal", "agent:alpha@zhang", "信号 signal-1 · polymarket:will-x-happen-by-dec · 买是 · 价 ≤0.63 · 过期 10:00", "https://relay.test/zhang/signals/alpha.geml#signal-1", 0]);
  const s2 = call(r, "POST /signals", { token: alpha.token, body: { ...SIGNAL, channel: "zhang/ch-1", at: "not a time" } }).json.signal;
  assert.equal(s2.at, s2.received, "a bad host stamp: the relay's stands for both");
  // retraction
  assert.equal(call(r, "POST /signals/signal-1/retract", { token: lisi.token, body: { agent: "alpha" } }).status, 400, "not their agent");
  assert.equal(call(r, "POST /signals/signal-1/retract", { token: xiaoping.token }).status, 404, "not on that agent's chain");
  assert.equal(call(r, "POST /signals/signal-9/retract", { token: alpha.token }).status, 404);
  const retracted = call(r, "POST /signals/signal-1/retract", { token: alpha.token });
  assert.match(retracted.json.signal.retracted, /^2026-10-31T09:00:\d\dZ$/);
  assert.deepEqual(readDoc(r.root, "zhang", "signals/alpha.geml").blocks.map((b) => b.id), ["signal-1", "signal-2", "retract-1"]);
  assert.deepEqual([r.venueOf("zhang", "ch-1").messages.at(-1).kind, r.venueOf("zhang", "ch-1").messages.at(-1).text], ["system", "信号 signal-1 已撤回"]);
  assert.equal(call(r, "POST /signals/signal-1/retract", { token: alpha.token }).status, 200, "again: no second mark");
  assert.equal(readDoc(r.root, "zhang", "signals/alpha.geml").blocks.length, 3);
  assert.equal(call(r, "POST /signals/signal-2/retract", { token: zhang.token, body: {} }).json.error, "要一个自己名下的 agent");
  assert.equal(call(r, "POST /signals/signal-2/retract", { token: zhang.token, body: { agent: "alpha" } }).status, 200, "the owner, naming the agent");
  assert.equal(r.signalsOf("zhang", "alpha").filter((s) => s.retracted !== undefined).length, 2);
});

test("prices and performance (§10.3): points under the relay's own name on a chain; the page needs no token and shows the chain with the four numbers; the agent's page carries them once it has signals; a per-signal subscription lapses once its signals came, a monthly one after its month, both swept by tick", () => {
  const { r, zhang, john, lisi, alpha } = world();
  assert.equal(r.setPrice("", 1).reason, "缺市场");
  assert.equal(r.setPrice(SIGNAL.market, 0).reason, "价格是正数");
  assert.equal(r.setPrice(SIGNAL.market, 0.6, "x").reason, "时间要是 ISO 时间");
  assert.equal(r.setPrice(SIGNAL.market, 0.6, "2026-10-31T08:00:00Z").ok, true);
  call(r, "POST /channels/zhang/ch-1/subscribe", { token: lisi.token, body: { signals: 3 } });
  call(r, "POST /channels/zhang/ch-1/subscribe", { token: john.token, body: { month: true } });
  for (const side of ["yes", "yes", "no"]) assert.equal(call(r, "POST /signals", { token: alpha.token, body: { ...SIGNAL, side, channel: "zhang/ch-1" } }).status, 201);
  call(r, "POST /signals/signal-1/retract", { token: alpha.token });
  call(r, "POST /signals/signal-2/retract", { token: zhang.token, body: { agent: "alpha" } });
  assert.equal(r.setPrice(SIGNAL.market, 0.7, "2026-10-31T10:00:00Z").ok, true);
  assert.deepEqual(call(r, `GET /prices/${encodeURIComponent(SIGNAL.market)}`, { token: john.token }).json, { market: SIGNAL.market, points: [{ at: "2026-10-31T08:00:00Z", price: 0.6 }, { at: "2026-10-31T10:00:00Z", price: 0.7 }] });
  assert.deepEqual(readDoc(r.root, "_relay", "prices/polymarket_will-x-happen-by-dec.geml").blocks.map((b) => [b.id, typeof b.value.hash]), [["p-1", "string"], ["p-2", "string"]]);
  assert.equal(call(r, "GET /a/zhang/alpha").json.performance.open, 3, "before expiry: all open");
  r.advance(2 * 3_600_000);
  const page = call(r, "GET /signals/zhang/alpha");
  assert.equal(page.status, 200);
  assert.deepEqual(page.json.signals.map((s) => [s.id, s.side, s.retracted !== undefined]), [["signal-1", "yes", true], ["signal-2", "yes", true], ["signal-3", "no", false]]);
  // in at 0.6 (the receipt price, within the cap), out at 0.7: yes +1/6 × 2%, no −1/6 × 2%
  assert.deepEqual([page.json.performance.hits, page.json.performance.counted, page.json.performance.open, page.json.performance.retracted, page.json.performance.return90, page.json.performance.drawdown], [2, 3, 0, 2, 0.0033, 0.0033]);
  assert.equal(call(r, "GET /signals/zhang/nobody").status, 404);
  assert.equal(call(r, "GET /a/john/xiaoping").json.performance, undefined, "no signals, no numbers");
  assert.equal(call(r, "GET /a/zhang/alpha").json.performance.hits, 2);
  // the sweep
  assert.deepEqual(r.subscriptionOf(r.venueOf("zhang", "ch-1"), "lisi", r.now()), { active: false, left: 0 });
  assert.equal(r.subscriptionOf(r.venueOf("zhang", "ch-1"), "john", r.now()).active, true);
  const swept = r.tick();
  assert.deepEqual([swept.lapsed, r.venueOf("zhang", "ch-1").venue.people], [["zhang/ch-1/lisi"], ["zhang", "john"]]);
  assert.equal(call(r, "GET /zhang/venues/ch-1.geml", { token: lisi.token }).status, 403, "gone from the readers");
  assert.equal(call(r, "GET /zhang/signals/alpha.geml", { token: lisi.token }).status, 200, "the chain stays public, like the page");
  r.advance(31 * 86_400_000);
  assert.deepEqual([r.tick().lapsed, r.venueOf("zhang", "ch-1").venue.people], [["zhang/ch-1/john"], ["zhang"]]);
  assert.deepEqual(r.tick().lapsed, [], "swept once");
});
```

In `test/relay-task.test.mjs`, `  assert.deepEqual(r.tick(), { returned: [id], packets: [] });` becomes `  assert.deepEqual(r.tick(), { returned: [id], packets: [], lapsed: [] });` and `  assert.deepEqual(r.tick(), { returned: [], packets: [] });` becomes `  assert.deepEqual(r.tick(), { returned: [], packets: [], lapsed: [] });`. In `test/relay-wallet.test.mjs`, `  assert.deepEqual(r.tick(), { returned: [], packets: [pid] });` becomes `  assert.deepEqual(r.tick(), { returned: [], packets: [pid], lapsed: [] });` and `  assert.deepEqual(r.tick(), { returned: [], packets: [] }, "returned once");` becomes `  assert.deepEqual(r.tick(), { returned: [], packets: [], lapsed: [] }, "returned once");`.

- [ ] **Step 2: Run it to see it fail**

```bash
node --test test/relay-signal.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
```
Expected: `ℹ fail 4`.

- [ ] **Step 3: The venue's price and publisher, the message's pointer, the chain readable**

In `src/relay/access.ts`, `  if (kind === "people" || kind === "agents") return true;` becomes `  if (kind === "people" || kind === "agents" || kind === "signals") return true;` (the signal chain is public like the page it feeds, §10.3).

In `src/core/im/venue.ts`, before `export interface Venue {`:

```ts
/** A channel's price (§10.4): by the month, by the signal, or both; neither is free. */
export interface ChannelPrice { month?: number; signal?: number }
export function priceWords(p: ChannelPrice | undefined): string {
  const parts = [...(p?.month !== undefined ? [`按月 ${p.month}`] : []), ...(p?.signal !== undefined ? [`按条 ${p.signal}`] : [])];
  return parts.length === 0 ? "免费" : parts.join(" · ");
}
```

and in `Venue`, after `  card?: string;`:

```ts
  /** A channel's price and its publisher: the owner's agent that signals (§10.4). */
  price?: ChannelPrice;
  publisher?: string;
```

In `src/core/im/message.ts`, `Draft` gains after `  replyTo?: string;`:

```ts
  /** A signal message's signal (§10.1): the chain block's address; the message carries the words, the chain the fields. */
  signal?: string;
```

`Message` gains after `  replyTo?: string;` the same two lines (`  /** A signal message's signal: the chain block's address. */` then `  signal?: string;`), and `const OPTIONAL = ["opinion", "turn", "card", "thread", "replyTo"] as const;` becomes `const OPTIONAL = ["opinion", "turn", "card", "thread", "replyTo", "signal"] as const;`.

- [ ] **Step 4: The relay**

**4a. Imports** — after the social import line (`import { DIGEST_ACTIONS, … } from "../core/im/social.js";`):

```ts
import { foldSignals, performanceOf, priceAt, signalFaults, signalInput, signalText, type Performance, type PricePoint, type Signal } from "../core/im/signal.js";
import { DISCLAIMER } from "../core/im/risk.js";
```

The venue import `import { ANNOUNCE_LIMIT, contextSegment, DEFAULT_POLICY, setAnnounce as announce, VENUE_WORDS, type Policy, type PromptFrom, type Venue, type VenueKind } from "../core/im/venue.js";` becomes `import { ANNOUNCE_LIMIT, contextSegment, DEFAULT_POLICY, setAnnounce as announce, VENUE_WORDS, type ChannelPrice, type Policy, type PromptFrom, type Venue, type VenueKind } from "../core/im/venue.js";`.

**4b. The fold** — in `foldVenue`, after `  const card = str(meta["card"]); if (card !== undefined) venue.card = card;`:

```ts
  const publisher = str(meta["publisher"]); if (publisher !== undefined) venue.publisher = publisher;
  const price = obj(meta["price"]);
  if (price !== undefined) {
    const p: ChannelPrice = {};
    const month = num(price["month"]); if (month !== undefined) p.month = month;
    const signal = num(price["signal"]); if (signal !== undefined) p.signal = signal;
    venue.price = p;
  }
```

and in its blocks loop, `    else if (/^decision-\d+$/.test(b.id)) { const m = str(b.value["message"]); if (m !== undefined && !venue.decisions.includes(m)) venue.decisions.push(m); }` gains after it:

```ts
    else if (/^leave-\d+$/.test(b.id)) { const s = parseSpeaker(str(b.value["speaker"]) ?? ""); if (s?.kind === "person") venue.people = venue.people.filter((p) => p !== s.id); }
```

**4c. A channel made** — in `createVenueAs`, after `    if (host?.kind === "agent") value["host"] = host.name;`:

```ts
    if (kind === "channel") {
      const publisher = agents[0] === undefined ? undefined : parseSpeaker(agents[0]);
      if (agents.length !== 1 || publisher?.kind !== "agent" || publisher.owner !== person || !this.agentsOf(person).includes(publisher.name)) return fail(400, "订阅频道要一个自己的 agent 发信号，只能一个");
      value["publisher"] = publisher.name;
      const price = obj(b["price"]) ?? {};
      const p: Record<string, JsonValue> = {};
      for (const k of ["month", "signal"] as const) { const n = price[k]; if (n !== undefined) { if (typeof n !== "number" || !Number.isInteger(n) || n < 0) return fail(400, `价格 ${k} 是非负整数`); p[k] = n; } }
      value["price"] = p;
    }
```

**4d. Only signals in a channel** — in `appendMessage`, after `    if (!this.isMember(vd, s)) return fail(403, "不是这个场所的成员");`:

```ts
    if (vd.venue.kind === "channel") return fail(403, "订阅频道只有信号，由发布方的 agent 用 im_signal 发");
```

**4e. The sweep** — `tick`'s `    return { returned, packets };` becomes:

```ts
    // Lapsed subscribers leave their channels (§10.4): a month over, or the signals bought all received.
    const lapsed: string[] = [];
    for (const owner of listOwners(this.root)) for (const d of listDocs(this.root, owner, "venues")) {
      const vd = this.venueOf(owner, d.slice("venues/".length, -".geml".length));
      if (vd?.venue.kind !== "channel") continue;
      for (const p of vd.venue.people) {
        if (p === owner || p.includes(":") || this.subscriptionOf(vd, p, now).active) continue;
        const a = appendBlock(this.root, owner, d, nextId("leave"), (_x, prev, bid) => sealed({ id: bid, speaker: `person:${p}`, at: now, why: "订阅到期" }, prev));
        this.emit(owner, d, a.block);
        lapsed.push(`${owner}/${vd.venue.id}/${p}`);
      }
    }
    return { returned, packets, lapsed };
```

and its signature `  tick(now: string = this.now()): { returned: string[]; packets: string[] } {` becomes `  tick(now: string = this.now()): { returned: string[]; packets: string[]; lapsed: string[] } {`.

**4f. The agent's page** — in `agentView`, `    const eligibility = this.eligibilityOf(owner, name);` becomes:

```ts
    const eligibility = this.eligibilityOf(owner, name);
    const signals = this.signalsOf(owner, name);
```

and its return's `askable: d.open };` becomes `askable: d.open, ...(signals.length > 0 ? { performance: this.performanceOf(owner, name) } : {}) };`; `AgentView` gains `performance?: Performance; ` before `askable: boolean }`.

**4g. The methods** — before `  // --- login and registration (transport §2.5, §7.1 /login) ---`:

```ts
  // --- signals and channels (§10) ---

  /** Every channel on the relay (§10.4): its publisher, its price, how many subscribe (the publisher sees no more than that), its performance. */
  listChannels(): { owner: string; id: string; name: string; publisher: string; price: ChannelPrice; subscribers: number; performance: Performance }[] {
    const out: { owner: string; id: string; name: string; publisher: string; price: ChannelPrice; subscribers: number; performance: Performance }[] = [];
    for (const owner of listOwners(this.root)) for (const d of listDocs(this.root, owner, "venues")) {
      const vd = this.venueOf(owner, d.slice("venues/".length, -".geml".length));
      if (vd?.venue.kind !== "channel" || vd.venue.publisher === undefined) continue;
      out.push({ owner, id: vd.venue.id, name: vd.venue.name, publisher: vd.venue.publisher, price: vd.venue.price ?? {}, subscribers: vd.venue.people.filter((p) => p !== owner).length, performance: this.performanceOf(owner, vd.venue.publisher) });
    }
    return out;
  }

  /** A person's standing in a channel (§10.4): their latest subscription — by the month until a day, or by so many signals, the ones received since counted off. */
  subscriptionOf(vd: VenueDoc, person: string, now: string): { active: boolean; until?: string; left?: number } {
    const subs = vd.doc.blocks.filter((b) => /^sub-\d+$/.test(b.id) && str(b.value["person"]) === person);
    const last = subs[subs.length - 1];
    if (last === undefined) return { active: false };
    const until = str(last.value["until"]);
    if (until !== undefined) return { active: until > now, until };
    const at = str(last.value["at"]) ?? "";
    const left = Math.max(0, (num(last.value["count"]) ?? 0) - vd.messages.filter((m) => m.kind === "signal" && m.at > at).length);
    return { active: left > 0, left };
  }

  /** A subscription (§10.4 一种商品): by the month or by so many signals, paid from the wallet to the publisher's owner, the disclaimer shown at that moment (§10.6); the person joins the channel and reads it until it lapses. */
  subscribe(by: TokenRecord, owner: string, id: string, body: unknown): Result<{ venue: Venue; disclaimer: string; until?: string; left?: number }> {
    const s = parseSpeaker(by.speaker);
    if (by.scope !== "person" || s?.kind !== "person") return fail(403, "本人订阅");
    const vd = this.venueOf(owner, id);
    if (vd?.venue.kind !== "channel") return fail(404, "没有这个订阅频道");
    if (s.id === owner) return fail(400, "自己的频道不用订阅");
    const b = obj(body) ?? {};
    const price = vd.venue.price ?? {};
    const count = num(b["signals"]);
    let cost: number, note: string, value: Record<string, JsonValue>;
    if (b["month"] === true) {
      if (price.month === undefined) return fail(400, "这个频道不按月卖");
      cost = price.month; note = "一个月";
      value = { person: s.id, kind: "month", until: new Date(Date.parse(this.now()) + MONTH_MS).toISOString().replace(/\.\d{3}Z$/, "Z") };
    } else if (count !== undefined && Number.isInteger(count) && count > 0) {
      if (price.signal === undefined) return fail(400, "这个频道不按条卖");
      cost = price.signal * count; note = `${count} 条`;
      value = { person: s.id, kind: "signals", count };
    } else return fail(400, "订阅写 { month: true } 或 { signals: N }");
    const balance = this.balance(s.id);
    if (balance < cost) return fail(403, `积分不够：钱包 ${balance}，要 ${cost}`);
    if (cost > 0) this.transfer({ kind: "subscribe", from: by.speaker, to: `person:${owner}`, amount: cost, note: `「${vd.venue.name}」· ${note}`, ref: vd.venue.address });
    const doc = `venues/${id}.geml`;
    const a = appendBlock(this.root, owner, doc, nextId("sub"), (_d, prev, bid) => sealed({ id: bid, ...value, at: this.now() }, prev));
    this.emit(owner, doc, a.block);
    this.joinVenue(owner, id, by.speaker);
    const after = this.venueOf(owner, id)!;
    const sub = this.subscriptionOf(after, s.id, this.now());
    return { ok: true, venue: after.venue, disclaimer: DISCLAIMER, ...(sub.until !== undefined ? { until: sub.until } : {}), ...(sub.left !== undefined ? { left: sub.left } : {}) };
  }

  /** The agent's chain `signals/<agent>.geml` folded (§10.2). */
  signalsOf(owner: string, agent: string): Signal[] {
    return NAME.test(owner) && NAME.test(agent) ? foldSignals(readDoc(this.root, owner, `signals/${agent}.geml`).blocks) : [];
  }

  /** A signal published (§10.1, §10.2): by the channel's publisher agent, every field checked; onto the agent's chain with the host's stamp and hash when it sent them and the relay's receipt, then a signal message in the channel pointing at the block — data, never a prompt. */
  publishSignal(by: TokenRecord, body: unknown): Result<{ signal: Signal; address: string }> {
    const s = parseSpeaker(by.speaker);
    if (by.scope !== "agent" || s?.kind !== "agent") return fail(403, "信号由 agent 发");
    const b = obj(body) ?? {};
    const target = /^([^/\s]+)\/([^/\s]+)$/.exec(str(b["channel"]) ?? "");
    const vd = target === null ? undefined : this.venueOf(target[1]!, target[2]!);
    if (target === null || vd?.venue.kind !== "channel") return fail(404, "没有这个订阅频道");
    if (target[1] !== s.owner || vd.venue.publisher !== s.name) return fail(403, "只有频道的发布方 agent 能发信号");
    const faults = signalFaults(b);
    if (faults.length > 0) return fail(400, faults.join("；"));
    const input = signalInput(b)!;
    const now = this.now();
    const at = str(b["at"]), hostHash = str(b["hostHash"]);
    const chain = `signals/${s.name}.geml`;
    const a = appendBlock(this.root, s.owner, chain, nextId("signal"), (_d, prev, bid) => sealed({ id: bid, ...(input as unknown as Record<string, JsonValue>), from: by.speaker, at: at !== undefined && !Number.isNaN(Date.parse(at)) ? at : now, received: now, ...(hostHash !== undefined ? { hostHash } : {}), channel: `${target[1]}/${target[2]}` }, prev));
    this.emit(s.owner, chain, a.block);
    const address = this.address(s.owner, chain, a.block.id);
    const signal = this.signalsOf(s.owner, s.name).find((x) => x.id === a.block.id)!;
    const doc = `venues/${vd.venue.id}.geml`;
    const m = appendBlock(this.root, target[1]!, doc, nextId("sig"), (_d, prev, bid) => stamp({ venue: vd.venue.id, kind: "signal", text: signalText(signal), signal: address }, { id: bid, speaker: s, at: now, prev }) as unknown as Record<string, JsonValue>);
    this.emit(target[1]!, doc, m.block);
    return { ok: true, signal, address };
  }

  /** A retraction (§10.2): by the publisher agent, or its owner naming it; the mark stays on the chain and the signal counts; the channel hears it as a system message. */
  retractSignal(by: TokenRecord, id: string, body: unknown): Result<{ signal: Signal }> {
    const s = parseSpeaker(by.speaker);
    let owner: string, agent: string;
    if (s?.kind === "agent" && by.scope === "agent") { owner = s.owner; agent = s.name; }
    else if (s?.kind === "person" && by.scope === "person") {
      const name = str(obj(body)?.["agent"]);
      if (name === undefined || !this.agentsOf(s.id).includes(name)) return fail(400, "要一个自己名下的 agent");
      owner = s.id; agent = name;
    } else return fail(403, "要 agent 的令牌，或本人的令牌加 agent 的名字");
    const chain = `signals/${agent}.geml`;
    const signal = this.signalsOf(owner, agent).find((x) => x.id === id);
    if (signal === undefined) return fail(404, "没有这条信号");
    if (signal.retracted !== undefined) return { ok: true, signal };
    const a = appendBlock(this.root, owner, chain, nextId("retract"), (_d, prev, bid) => sealed({ id: bid, signal: id, at: this.now(), by: by.speaker }, prev));
    this.emit(owner, chain, a.block);
    const ch = signal.channel === undefined ? null : /^([^/]+)\/([^/]+)$/.exec(signal.channel);
    if (ch !== null) this.appendSystem(ch[1]!, ch[2]!, `信号 ${id} 已撤回`);
    return { ok: true, signal: this.signalsOf(owner, agent).find((x) => x.id === id)! };
  }

  /** The chain and the four numbers, public (§10.3: no page shows the claim without the rule). */
  signalPage(owner: string, agent: string): Result<{ signals: Signal[]; performance: Performance }> {
    if (!NAME.test(owner) || !NAME.test(agent) || !readDoc(this.root, owner, `agents/${agent}.geml`).exists) return fail(404, "没有这个 agent");
    return { ok: true, signals: this.signalsOf(owner, agent), performance: this.performanceOf(owner, agent) };
  }

  performanceOf(owner: string, agent: string): Performance { return performanceOf(this.signalsOf(owner, agent), (m, at) => this.priceAt(m, at), this.now()); }

  private priceDoc(market: string): string { return `prices/${market.replace(/[^A-Za-z0-9_-]+/g, "_")}.geml`; }

  /** A price point from a public source (§10.3), on a hash chain under the relay's own name. */
  setPrice(market: string, price: number, at: string = this.now()): Result<{ market: string; price: number; at: string }> {
    if (market.trim() === "") return fail(400, "缺市场");
    if (!Number.isFinite(price) || price <= 0) return fail(400, "价格是正数");
    if (Number.isNaN(Date.parse(at))) return fail(400, "时间要是 ISO 时间");
    const doc = this.priceDoc(market);
    const a = appendBlock(this.root, RELAY_OWNER, doc, nextId("p"), (_d, prev, bid) => sealed({ id: bid, market, price, at }, prev));
    this.emit(RELAY_OWNER, doc, a.block);
    return { ok: true, market, price, at };
  }

  pricesOf(market: string): PricePoint[] {
    return readDoc(this.root, RELAY_OWNER, this.priceDoc(market)).blocks.filter((b) => /^p-\d+$/.test(b.id) && str(b.value["market"]) === market).map((b) => ({ at: str(b.value["at"]) ?? "", price: num(b.value["price"]) ?? 0 })).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  }

  priceAt(market: string, at: string): number | undefined { return priceAt(this.pricesOf(market), at); }

```

and, among the module's constants (after `const STATE_WORDS_OF = (s: CardState): string => STATE_WORDS[s];`):

```ts
/** A month of subscription (§10.4). */
const MONTH_MS = 30 * 86_400_000;
```

- [ ] **Step 5: The API**

In `src/relay/api.ts`, the venues listing `      return json(200, relay.venuesOf(by.speaker.slice("person:".length)).map((vd) => ({ owner: parseAddress(vd.venue.address)?.owner ?? "", id: vd.venue.id, kind: vd.venue.kind, name: vd.venue.name })));` becomes:

```ts
      return json(200, relay.venuesOf(by.speaker.slice("person:".length)).map((vd) => ({ owner: parseAddress(vd.venue.address)?.owner ?? "", id: vd.venue.id, kind: vd.venue.kind, name: vd.venue.name, ...(vd.venue.publisher !== undefined ? { publisher: vd.venue.publisher } : {}) })));
```

After the agent page line (`  if (a === "a" && parts.length === 3 && b !== undefined && c !== undefined && m === "GET") return answer(relay.agentView(b, c));`):

```ts
  // The signal chain and its performance (§10.3): public.
  if (a === "signals" && parts.length === 3 && b !== undefined && c !== undefined && m === "GET") return answer(relay.signalPage(b, c));
```

Before `  if (a === "rooms") {`:

```ts
  if (a === "signals") {
    if (parts.length === 1) return m === "POST" ? answer(relay.publishSignal(by, r.body), 201) : fail(405, "只有 POST");
    if (parts.length === 3 && b !== undefined && c === "retract") return m === "POST" ? answer(relay.retractSignal(by, b, r.body)) : fail(405, "只有 POST");
    return fail(404, "没有这个路径");
  }
  if (a === "channels") {
    if (parts.length === 1) return m === "GET" ? json(200, relay.listChannels()) : fail(405, "只有 GET");
    if (parts.length === 4 && b !== undefined && c !== undefined && d === "subscribe") return m === "POST" ? answer(relay.subscribe(by, b, c, r.body)) : fail(405, "只有 POST");
    return fail(404, "没有这个路径");
  }
  if (a === "prices" && parts.length === 2 && b !== undefined) return m === "GET" ? json(200, { market: b, points: relay.pricesOf(b) }) : fail(405, "只有 GET");
```

- [ ] **Step 6: Build and run**

```bash
npm run build 2>&1 | tail -2 && node --test test/relay-signal.test.mjs test/relay-task.test.mjs test/relay-wallet.test.mjs test/relay-core.test.mjs test/relay-api.test.mjs test/relay-social.test.mjs test/relay-share.test.mjs test/relay-split.test.mjs test/im-venue.test.mjs test/im-message.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
```
Expected: `ℹ fail 0`.

- [ ] **Step 7: Commit**

```bash
git add src/relay/access.ts src/core/im/venue.ts src/core/im/message.ts src/relay/relay.ts src/relay/api.ts test/relay-signal.test.mjs test/relay-task.test.mjs test/relay-wallet.test.mjs
git commit -m "IM relay: channels sold by the month or the signal, the signal chain with both stamps, retraction, prices and the fixed rule's performance"
```

---

### Task 4: The daemon: the chains followed, the signal published from the host's own chain, the local execution module, the channel on the page

**Files:**
- Create: `src/daemon/exec.ts`
- Modify: `src/daemon/home.ts`, `src/daemon/client.ts`, `src/daemon/sync.ts`, `src/daemon/deliver.ts`, `src/daemon/view.ts`, `src/core/im/risk.ts` (the ask keeps the order's fields; paper records settle too)
- Modify: `test/risk.test.mjs`, `test/daemon-sync.test.mjs`, `test/daemon-cli.test.mjs`
- Test: `test/daemon-exec.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// test/daemon-exec.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readDataBlocks } from "../dist/core/im/chain.js";
import { riskOf } from "../dist/core/im/risk.js";
import { answerExecNeed, commandConnector, execNeeds, objectToSignal, readExec, readRisk, runExec, writeExec, writeRisk } from "../dist/daemon/exec.js";
import { publishSignal, retractSignal } from "../dist/daemon/deliver.js";
import { listOutbox, readConfig, writeConfig } from "../dist/daemon/home.js";
import { Daemon } from "../dist/daemon/sync.js";
import { statusView, threadView } from "../dist/daemon/view.js";
import { startRelay } from "../dist/relay/server.js";

const tmp = (p) => mkdtempSync(join(tmpdir(), p));
const T0 = Date.now();
const iso = (ms) => new Date(T0 + ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const NOW = iso(0);
const MARKET = "polymarket:will-x-happen-by-dec";
const SIGNAL = { market: MARKET, side: "yes", sizeHint: { kind: "fraction-of-bankroll", value: 0.02 }, priceCap: 0.63, expires: iso(3_600_000), confidence: 0.7, thesis: "https://relay.test/zhang/venues/ch-1.geml#why", channel: "zhang/ch-1" };

/** 张 publishes through alpha into ch-1 (30 a month, 2 a signal); john (agent 小评, 100 credits) subscribes by the month; the price sits at 0.6 since an hour ago. */
async function world() {
  const s = await startRelay({ root: tmp("gemworks-relay-"), name: "relay.test" });
  const zhang = s.relay.issuePerson("zhang"), john = s.relay.issuePerson("john");
  const alpha = s.relay.issueAgent(zhang.record, "alpha"), xiaoping = s.relay.issueAgent(john.record, "xiaoping");
  s.relay.topUp("john", 100);
  s.relay.createVenue(zhang.record, { id: "ch-1", kind: "channel", name: "alpha 的信号", agents: ["agent:alpha@zhang"], price: { month: 30, signal: 2 } });
  s.relay.subscribe(john.record, "zhang", "ch-1", { month: true });
  s.relay.setPrice(MARKET, 0.6, iso(-3_600_000));
  const homes = { zhang: tmp("gemworks-im-"), john: tmp("gemworks-im-") };
  writeConfig(homes.zhang, { relay: { url: s.url, name: "relay.test" }, person: "zhang", token: zhang.token, agents: { alpha: alpha.token } });
  writeConfig(homes.john, { relay: { url: s.url, name: "relay.test" }, person: "john", token: john.token, agents: { xiaoping: xiaoping.token } });
  const orders = [];
  const connector = async (command, order) => { orders.push({ command, order }); return command === "fail" ? { ok: false, error: "connector exited 1: no creds" } : { ok: true, id: `ord-${orders.length}` }; };
  const tools = { prices: async (m) => s.relay.pricesOf(m), performance: async (o, a) => s.relay.performanceOf(o, a), connector };
  const daemons = { zhang: new Daemon({ home: homes.zhang }), john: new Daemon({ home: homes.john, connector }) };
  const publish = async (extra = {}) => { const r = publishSignal(homes.zhang, "alpha", { ...SIGNAL, ...extra }, NOW); await daemons.zhang.flushOutbox(); await daemons.john.syncOnce(); return r; };
  return { s, zhang, john, alpha, xiaoping, homes, daemons, orders, tools, connector, publish };
}

test("the publisher's host seals the signal on its own chain first (§10.2), then the outbox carries it with that stamp and hash; a retraction goes the same way; the subscriber's daemon follows the chain and runs the module: 纸面 records what following would have been; the page shows the price, the stage card, the signal card with the module's line, the footer; the row says the stage and today's count", async () => {
  const { s, homes, daemons } = await world();
  try {
    const made = publishSignal(homes.zhang, "alpha", SIGNAL, NOW);
    const chain = readDataBlocks(readFileSync(join(homes.zhang, "signals", "alpha.geml"), "utf8")).blocks;
    assert.deepEqual([chain.length, chain[0].id, chain[0].value.market, chain[0].value.from, chain[0].value.at, typeof chain[0].value.hash, chain[0].value.prev], [1, made.id, MARKET, "agent:alpha@zhang", NOW, "string", null]);
    assert.equal(made.hash, chain[0].value.hash);
    assert.deepEqual(listOutbox(homes.zhang).map((e) => [e.kind, e.as, e.body.hostHash, e.body.at, e.body.channel]), [["signal", "agent:alpha", made.hash, NOW, "zhang/ch-1"]]);
    assert.deepEqual(await daemons.zhang.flushOutbox(), { pushed: 1, failed: 0, left: 0 });
    const onRelay = s.relay.signalsOf("zhang", "alpha");
    assert.deepEqual([onRelay.length, onRelay[0].id, onRelay[0].hostHash, onRelay[0].at], [1, "signal-1", made.hash, NOW]);
    publishSignal(homes.zhang, "alpha", SIGNAL, iso(1000));
    assert.equal(readDataBlocks(readFileSync(join(homes.zhang, "signals", "alpha.geml"), "utf8")).blocks[1].value.prev, made.hash, "the host's chain links");
    retractSignal(homes.zhang, "alpha", "signal-1", iso(2000));
    assert.deepEqual(listOutbox(homes.zhang).map((e) => e.kind), ["signal", "retract"]);
    await daemons.zhang.flushOutbox();
    assert.equal(s.relay.signalsOf("zhang", "alpha")[0].retracted !== undefined, true);
    // the subscriber
    const r = await daemons.john.syncOnce();
    assert.deepEqual([r.connected, r.executed], [true, 2]);
    assert.equal(existsSync(join(homes.john, "relay.test", "zhang", "signals", "alpha.geml")), true, "the publisher's chain is followed");
    const state = readExec(homes.john, "zhang", "ch-1");
    assert.deepEqual(state.records.map((x) => [x.signal, x.kind, x.entry, x.note]), [["signal-1", "skipped", undefined, "已撤回"], ["signal-2", "paper", 0.6, "若跟：0.6 进，2%"]]);
    assert.equal((await daemons.john.syncOnce()).executed, 0, "nothing new");
    const row = statusView(homes.john, {}, NOW).venues.find((v) => v.id === "ch-1");
    assert.deepEqual([row.kindWord, row.status, row.unread], ["订阅频道", "纸面 · 今天 2 条", 2]);
    const th = threadView(homes.john, "zhang", "ch-1", 50, NOW);
    assert.deepEqual(th.channel, { price: "按月 30 · 按条 2", stage: ["阶段：纸面 · 第 1 天 · 命中 —", "升级：还要 14 天，且命中 ≥ 60%（现在没有结算的信号），主人批准"], footer: "平台不托管资金、不经手密钥 · 订阅时已展示免责条款 · 发布方看不到你跟没跟" });
    assert.deepEqual(th.messages.map((m) => [m.kind, m.signal?.length]), [["signal", 4], ["signal", 4], ["system", undefined]]);
    assert.deepEqual([th.messages[0].signal[0].endsWith("· 已撤回"), th.messages[0].signal[3], th.messages[1].signal[3]], [true, "跳过 · 已撤回", "纸面 · 记为『若跟：0.6 进，2%』· 没下单"]);
    assert.equal(th.messages[1].signal[1], `市场 ${MARKET} · 买是 · 价 ≤0.63 · 仓位 2% · 过期 ${SIGNAL.expires.slice(5, 10)} ${SIGNAL.expires.slice(11, 16)} · 信心 0.7`);
    // settled once the price at expiry is known: the stage card's evidence
    s.relay.setPrice(MARKET, 0.7, SIGNAL.expires);
    await runExec(homes.john, iso(2 * 3_600_000), { prices: async (m) => s.relay.pricesOf(m), performance: async () => undefined, connector: async () => ({ ok: false, error: "never" }) });
    assert.equal(readExec(homes.john, "zhang", "ch-1").records[1].outcome, "win");
    assert.equal(threadView(homes.john, "zhang", "ch-1", 50, iso(2 * 3_600_000)).channel.stage[0], "阶段：纸面 · 第 1 天 · 命中 100%");
  } finally {
    await s.close();
  }
});

test("小仓 (§10.5): every order is an ask on the band — 跟 places it through the connector and records it, 跳过 records that, 全停 drops the channel to 纸面 and mutes the asks with a 卡住 that 知道了 clears; an expired ask is dropped", async () => {
  const { s, homes, orders, connector, publish, tools } = await world();
  try {
    writeRisk(homes.john, "zhang", "ch-1", riskOf({ stage: "small", stageSince: iso(-20 * 86_400_000), markets: [MARKET], perOrder: 5, perDay: 20, maxPositions: 3, cooldownMinutes: 0, connector: "node order.mjs" }));
    await publish();
    const state = readExec(homes.john, "zhang", "ch-1");
    assert.deepEqual(state.asks.map((a) => [a.signal, a.price, a.amount, a.market, a.side, a.cap]), [["signal-1", 0.6, 5, MARKET, "yes", 0.63]]);
    const needs = execNeeds(homes.john, readConfig(homes.john), NOW);
    assert.deepEqual(needs.map((n) => [n.kind, n.key, n.text, n.actions, n.venue]), [["decide", "exec:zhang/ch-1/signal-1", `频道「alpha 的信号」· 跟 signal-1？过期 ${SIGNAL.expires.slice(11, 16)} · 买是 · 价 0.6 · 金额 5 · 在风控之内 · agent：未参与`, ["跟", "跳过", "全停"], "ch-1"]]);
    assert.equal(statusView(homes.john, {}, NOW).needs.some((n) => n.key === "exec:zhang/ch-1/signal-1"), true, "on the band");
    assert.equal(threadView(homes.john, "zhang", "ch-1", 50, NOW).messages[0].signal[3], "已问主人 · 等定");
    assert.deepEqual(await answerExecNeed(homes.john, "exec:zhang/ch-1/signal-1", "跟", NOW, connector), { ok: true });
    assert.deepEqual(orders, [{ command: "node order.mjs", order: { signal: "signal-1", market: MARKET, side: "yes", price: 0.6, amount: 5, channel: "zhang/ch-1" } }]);
    assert.deepEqual(readExec(homes.john, "zhang", "ch-1").records.map((x) => [x.signal, x.kind, x.note, x.order, x.amount]), [["signal-1", "followed", "单 ord-1 · 0.6 × 5", "ord-1", 5]]);
    assert.deepEqual(execNeeds(homes.john, readConfig(homes.john), NOW), []);
    assert.deepEqual(await answerExecNeed(homes.john, "exec:zhang/ch-1/signal-1", "跟", NOW, connector), { ok: false, reason: "这条询问已经过了" });
    await publish();
    assert.deepEqual(await answerExecNeed(homes.john, "exec:zhang/ch-1/signal-2", "跳过", NOW, connector), { ok: true });
    assert.deepEqual(readExec(homes.john, "zhang", "ch-1").records.at(-1).note, "主人跳过");
    await publish();
    assert.deepEqual(await answerExecNeed(homes.john, "exec:zhang/ch-1/signal-3", "全停", NOW, connector), { ok: true });
    const risk = readRisk(homes.john, "zhang", "ch-1");
    assert.deepEqual([risk.stage, risk.muted, risk.stageSince], ["paper", true, NOW]);
    const after = readExec(homes.john, "zhang", "ch-1");
    assert.deepEqual([after.asks, after.stuck, after.records.at(-1).kind], [[], { why: "主人全停", at: NOW }, "stopped"]);
    const stuck = execNeeds(homes.john, readConfig(homes.john), NOW);
    assert.deepEqual(stuck.map((n) => [n.kind, n.key, n.text, n.actions]), [["stuck", "exec-stuck:zhang/ch-1", "频道「alpha 的信号」本机执行退回纸面：主人全停", ["知道了"]]]);
    assert.deepEqual(await answerExecNeed(homes.john, "exec-stuck:zhang/ch-1", "知道了", NOW, connector), { ok: true });
    assert.deepEqual(execNeeds(homes.john, readConfig(homes.john), NOW), []);
    await publish({ expires: iso(60_000) });
    assert.equal(readExec(homes.john, "zhang", "ch-1").records.at(-1).kind, "paper", "back on 纸面, no ask");
    writeRisk(homes.john, "zhang", "ch-1", riskOf({ ...readRisk(homes.john, "zhang", "ch-1"), stage: "small", muted: false }));
    await publish({ expires: iso(120_000) });
    assert.equal(readExec(homes.john, "zhang", "ch-1").asks.length, 1);
    await runExec(homes.john, iso(200_000), tools);
    assert.deepEqual([readExec(homes.john, "zhang", "ch-1").asks.length, readExec(homes.john, "zhang", "ch-1").records.at(-1).note], [0, "过期没定"]);
  } finally {
    await s.close();
  }
});

test("限额内自动 (§10.5): an order within the file goes through the connector on its own; any error drops the channel to 纸面 with a 卡住, and the next signal in the same run is only recorded; the stop-loss by losses in a row does the same", async () => {
  const { s, homes, orders, publish, tools } = await world();
  try {
    writeRisk(homes.john, "zhang", "ch-1", riskOf({ stage: "auto", stageSince: iso(-40 * 86_400_000), markets: [MARKET], perOrder: 5, perDay: 20, maxPositions: 3, cooldownMinutes: 0, connector: "node order.mjs" }));
    await publish();
    assert.deepEqual(readExec(homes.john, "zhang", "ch-1").records.map((x) => [x.kind, x.note]), [["ordered", "单 ord-1 · 0.6 × 5"]]);
    assert.equal(orders.length, 1);
    writeRisk(homes.john, "zhang", "ch-1", riskOf({ ...readRisk(homes.john, "zhang", "ch-1"), connector: "fail" }));
    publishSignal(homes.zhang, "alpha", SIGNAL, NOW);
    await publish();
    const state = readExec(homes.john, "zhang", "ch-1");
    assert.deepEqual(state.records.slice(1).map((x) => [x.signal, x.kind, x.note]), [["signal-2", "failed", "connector exited 1: no creds"], ["", "stopped", "下单失败：connector exited 1: no creds"], ["signal-3", "paper", "若跟：0.6 进，2%"]]);
    assert.deepEqual([readRisk(homes.john, "zhang", "ch-1").stage, state.stuck.why], ["paper", "下单失败：connector exited 1: no creds"]);
    assert.equal(threadView(homes.john, "zhang", "ch-1", 50, NOW).messages[1].signal[3], "下单失败 · connector exited 1: no creds");
    // the stop-loss
    writeRisk(homes.john, "zhang", "ch-1", riskOf({ ...readRisk(homes.john, "zhang", "ch-1"), stage: "small", stageSince: NOW, stop: { drawdown: 0, losses: 2 } }));
    writeExec(homes.john, "zhang", "ch-1", { records: [1, 2].map((i) => ({ signal: `old-${i}`, at: iso(-i * 3_600_000), kind: "followed", note: "", market: MARKET, side: "yes", entry: 0.6, amount: 5, expires: iso(-60_000), outcome: "loss" })), asks: [], objections: {} });
    await runExec(homes.john, NOW, tools);
    assert.deepEqual([readRisk(homes.john, "zhang", "ch-1").stage, readExec(homes.john, "zhang", "ch-1").stuck.why], ["paper", "连亏 2 次"]);
  } finally {
    await s.close();
  }
});

test("the agent reads the thesis when the owner lets it (§10.5): the line into the owner's DM with the agent when that DM is mirrored; its objection skips the signal and shows on a pending ask; the connector as a command: the order on stdin and in the environment, the id on stdout, a non-zero exit the error", async () => {
  const { s, john, homes, daemons, publish } = await world();
  try {
    s.relay.createVenue(john.record, { id: "dm-xiaoping", kind: "dm", name: "xiaoping", agents: ["agent:xiaoping@john"] });
    writeRisk(homes.john, "zhang", "ch-1", riskOf({ stage: "small", stageSince: iso(-20 * 86_400_000), markets: [MARKET], perOrder: 5, perDay: 20, maxPositions: 3, cooldownMinutes: 0, agentReads: true, connector: "x" }));
    await daemons.john.syncOnce();
    await publish();
    const out = listOutbox(homes.john);
    assert.deepEqual([out.length, out[0].kind, out[0].as, out[0].doc, out[0].body.text], [1, "message", "person", "venues/dm-xiaoping.geml", `读一下信号 signal-1 的论点 ${SIGNAL.thesis}：要是反对，用 im_signal skip 说一句理由；不反对就不用回。`]);
    assert.match(execNeeds(homes.john, readConfig(homes.john), NOW)[0].text, /agent：读了论点，没反对$/);
    assert.deepEqual(objectToSignal(homes.john, "signal-1", "数据过时", NOW), { ok: true, channel: "zhang/ch-1" });
    assert.match(execNeeds(homes.john, readConfig(homes.john), NOW)[0].text, /agent：反对：数据过时$/);
    assert.deepEqual(objectToSignal(homes.john, "signal-9", "x", NOW), { ok: false, reason: "没有这条信号：signal-9" });
    await publish();
    assert.equal(readExec(homes.john, "zhang", "ch-1").asks.length, 2, "the next signal asks again; the objection was to one signal");
    const order = { signal: "signal-1", market: MARKET, side: "yes", price: 0.6, amount: 5, channel: "zhang/ch-1" };
    assert.deepEqual(await commandConnector("node -e \"let s='';process.stdin.on('data',(c)=>{s+=c}).on('end',()=>{const o=JSON.parse(s);process.stdout.write('ord-'+o.signal+'-'+process.env.ORDER_AMOUNT)})\"", order), { ok: true, id: "ord-signal-1-5" });
    const failed = await commandConnector("node -e \"process.stderr.write('no creds');process.exit(3)\"", order);
    assert.deepEqual(failed, { ok: false, error: "connector exited 3: no creds" });
  } finally {
    await s.close();
  }
});
```

In `test/daemon-sync.test.mjs`, `    assert.deepEqual(r, { connected: true, docs: 6, pushed: 0, failed: 0, left: 0, heartbeats: 0 });` becomes `    assert.deepEqual(r, { connected: true, docs: 6, pushed: 0, failed: 0, left: 0, heartbeats: 0, executed: 0 });`; in `test/daemon-cli.test.mjs`, `    assert.deepEqual(JSON.parse(once.out), { connected: true, docs: 4, pushed: 0, failed: 0, left: 0, heartbeats: 0 });` becomes `    assert.deepEqual(JSON.parse(once.out), { connected: true, docs: 4, pushed: 0, failed: 0, left: 0, heartbeats: 0, executed: 0 });`.

In `test/risk.test.mjs`, the settlement test's records gain a paper one: `    { signal: "s-3", at: "2026-10-30T09:12:05Z", kind: "ordered", amount: 5, note: "", market: "m", side: "yes", entry: 0.61, expires: "2026-10-30T11:00:00Z" },` gains after it:

```js
    { signal: "s-4", at: "2026-10-30T08:00:00Z", kind: "paper", note: "", market: "m", side: "yes", entry: 0.6, expires: "2026-10-30T08:30:00Z" },
```

`  assert.equal(settleRecords(s, price, "2026-10-30T10:30:00Z"), 3);` becomes `  assert.equal(settleRecords(s, price, "2026-10-30T10:30:00Z"), 4, "paper records settle too: they are the evidence");`, `  assert.deepEqual(s.records.map((r) => r.outcome), ["win", "loss", "win", undefined]);` becomes `  assert.deepEqual(s.records.map((r) => r.outcome), ["win", "loss", "win", undefined, "win"]);\n  assert.deepEqual(localRecord(s), { hits: 3, counted: 4 });`, and the import line gains `localRecord, ` before `PAPER_DAYS, `.

- [ ] **Step 2: Run it to see it fail**

```bash
node --test test/daemon-exec.test.mjs test/risk.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
```
Expected: `ℹ fail 5` (the module is not there; the risk test wants `localRecord`).

- [ ] **Step 3: The core's two small additions**

In `src/core/im/risk.ts`, `export interface PendingAsk { signal: string; at: string; price?: number; amount: number; expires: string; text: string }` becomes:

```ts
export interface PendingAsk { signal: string; at: string; market: string; side: "yes" | "no"; cap: number; price?: number; amount: number; expires: string; text: string }
```

`export interface ExecState { records: ExecRecord[]; asks: PendingAsk[]; objections: Record<string, string>; stuck?: string }` becomes `export interface ExecState { records: ExecRecord[]; asks: PendingAsk[]; objections: Record<string, string>; stuck?: { why: string; at: string } }`; in `settleRecords`, `    if (!placed(r) || r.outcome !== undefined` becomes `    if (!(placed(r) || r.kind === "paper") || r.outcome !== undefined`; and after `consecutiveLosses`:

```ts
/** What following would have done, by the records settled so far (paper ones included): the evidence a stage needs. */
export function localRecord(state: ExecState): { hits: number; counted: number } {
  let hits = 0, counted = 0;
  for (const r of state.records) if (r.outcome !== undefined) { counted++; if (r.outcome === "win") hits++; }
  return { hits, counted };
}
```

- [ ] **Step 4: Write `src/daemon/exec.ts`**

```ts
// The local execution module (§10.5): the host runs it, never the model.
// After every sync it reads each channel the person is in, the risk file
// the owner keeps for it under the home, and the state of what it did so
// far; for every new signal it makes the one decision risk.ts allows — a
// paper record, a question on the band, an order through the owner's own
// connector command — and any error or stop-loss drops the channel back to
// 纸面 with a 卡住 on the band. The agent may object to a signal, never widen
// the file.
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseAddress } from "../core/im/address.js";
import type { Need } from "../core/im/needs-me.js";
import { ASK_ACTIONS, askText, consecutiveLosses, decide, execLine, FOOTER, localRecord, riskOf, settleRecords, STAGE_WORDS, stageLines, stopHit, type ExecState, type Risk } from "../core/im/risk.js";
import { foldSignals, priceAt, type Performance, type PricePoint, type Signal } from "../core/im/signal.js";
import { priceWords } from "../core/im/venue.js";
import { foldVenue, type VenueDoc } from "../relay/relay.js";
import { writeAtomic } from "../host-fs.js";
import { say } from "./deliver.js";
import { readConfig, readMirror, type Config } from "./home.js";

export interface Order { signal: string; market: string; side: "yes" | "no"; price: number; amount: number; channel: string }
/** The owner's connector (§10.5 本机存的凭证): the risk file's command, given the order; the order's id back, or the error. */
export type Connector = (command: string, order: Order) => Promise<{ ok: true; id: string } | { ok: false; error: string }>;
/** What a run needs from outside: the relay's prices and the publisher's performance, and the connector. */
export interface ExecTools { prices: (market: string) => Promise<PricePoint[]>; performance: (owner: string, agent: string) => Promise<Performance | undefined>; connector: Connector }

const fileKey = (owner: string, id: string): string => `${owner}__${id}`;
export const riskPath = (home: string, owner: string, id: string): string => join(home, "risk", `${fileKey(owner, id)}.json`);
export const execPath = (home: string, owner: string, id: string): string => join(home, "exec", `${fileKey(owner, id)}.json`);
const readJson = (path: string): unknown => { if (!existsSync(path)) return undefined; try { return JSON.parse(readFileSync(path, "utf8")); } catch { return undefined; } };

export function readRisk(home: string, owner: string, id: string): Risk { return riskOf(readJson(riskPath(home, owner, id))); }
export function writeRisk(home: string, owner: string, id: string, risk: Risk): void { writeAtomic(riskPath(home, owner, id), `${JSON.stringify(risk, null, 2)}\n`); }
export function readExec(home: string, owner: string, id: string): ExecState {
  const v = readJson(execPath(home, owner, id)) as Partial<ExecState> | undefined;
  const stuck = v?.stuck;
  return { records: Array.isArray(v?.records) ? v.records : [], asks: Array.isArray(v?.asks) ? v.asks : [], objections: typeof v?.objections === "object" && v.objections !== null ? v.objections : {}, ...(typeof stuck === "object" && stuck !== null && typeof stuck.why === "string" ? { stuck: { why: stuck.why, at: typeof stuck.at === "string" ? stuck.at : "" } } : {}) };
}
export function writeExec(home: string, owner: string, id: string, s: ExecState): void { writeAtomic(execPath(home, owner, id), `${JSON.stringify(s)}\n`); }

/** The channels the person subscribes to, from the mirrors; their own (where they publish) are not theirs to follow. */
export function channelsOf(home: string, c: Config): { owner: string; vd: VenueDoc }[] {
  const relayDir = join(home, c.relay.name.replace(/:/g, "_"));
  if (!existsSync(relayDir)) return [];
  const out: { owner: string; vd: VenueDoc }[] = [];
  for (const owner of readdirSync(relayDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()) {
    const dir = join(relayDir, owner, "venues");
    if (!existsSync(dir)) continue;
    for (const n of readdirSync(dir).filter((f) => f.endsWith(".geml")).sort()) {
      const id = n.slice(0, -".geml".length);
      const m = readMirror(home, c.relay.name, owner, `venues/${id}.geml`);
      const vd = foldVenue(owner, id, { blocks: m.blocks, diagnostics: [], text: m.text, exists: true }, c.relay.name);
      if (vd?.venue.kind === "channel" && owner !== c.person) out.push({ owner, vd });
    }
  }
  return out;
}

/** The channel's signals from the publisher's mirrored chain, by the messages' pointers, in the channel's order. */
export function signalsIn(home: string, c: Config, owner: string, vd: VenueDoc): Signal[] {
  if (vd.venue.publisher === undefined) return [];
  const byId = new Map(foldSignals(readMirror(home, c.relay.name, owner, `signals/${vd.venue.publisher}.geml`).blocks).map((s) => [s.id, s]));
  const out: Signal[] = [];
  for (const m of vd.messages) {
    if (m.kind !== "signal" || m.signal === undefined) continue;
    const id = parseAddress(m.signal)?.block;
    const s = id === undefined ? undefined : byId.get(id);
    if (s !== undefined) out.push(s);
  }
  return out;
}

/** The channel dropped to 纸面 (§10.5 任何出错或触发止损条件): the file rewritten, the asks cleared, the reason kept for the 卡住. */
function dropToPaper(home: string, owner: string, id: string, risk: Risk, state: ExecState, why: string, now: string, extra: Partial<Risk> = {}): Risk {
  const next: Risk = { ...risk, ...extra, stage: "paper", stageSince: now };
  writeRisk(home, owner, id, next);
  state.stuck = { why, at: now };
  state.asks = [];
  state.records.push({ signal: "", at: now, kind: "stopped", note: why });
  return next;
}

async function place(risk: Risk, connector: Connector, order: Order): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (risk.connector === undefined) return { ok: false, error: "风控文件没写 connector（下单命令）" };
  try { return await connector(risk.connector, order); } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}

/** The owner lets the agent read the thesis (§10.5): a line into their DM with their first agent, when that DM is mirrored; the agent objects with `im_signal skip`. */
function askAgent(home: string, c: Config, s: Signal, now: string): void {
  const agent = Object.keys(c.agents)[0];
  if (agent === undefined || !readMirror(home, c.relay.name, c.person, `venues/dm-${agent}.geml`).exists) return;
  say(home, { as: "person", owner: c.person, venue: `dm-${agent}`, text: `读一下信号 ${s.id} 的论点${s.thesis !== undefined ? ` ${s.thesis}` : ""}：要是反对，用 im_signal skip 说一句理由；不反对就不用回。` }, now);
}

/** One run over every channel (§10.5): the records settled against the prices, the stop-loss checked, each new signal decided and acted on, an expired ask dropped. How many signals were decided. */
export async function runExec(home: string, now: string, tools: ExecTools): Promise<number> {
  const c = readConfig(home);
  if (c === undefined) return 0;
  let decided = 0;
  const prices = new Map<string, PricePoint[]>();
  const fetchPrices = async (market: string): Promise<void> => { if (!prices.has(market)) { let p: PricePoint[] = []; try { p = await tools.prices(market); } catch { /* unpriced this round */ } prices.set(market, p); } };
  for (const { owner, vd } of channelsOf(home, c)) {
    const id = vd.venue.id, channel = `${owner}/${id}`;
    let risk = readRisk(home, owner, id);
    const state = readExec(home, owner, id);
    const signals = signalsIn(home, c, owner, vd);
    for (const m of new Set([...signals.map((s) => s.market), ...state.records.map((r) => r.market).filter((m): m is string => m !== undefined)])) await fetchPrices(m);
    settleRecords(state, (market, at) => priceAt(prices.get(market) ?? [], at), now);
    for (const a of state.asks.filter((a) => a.expires <= now)) state.records.push({ signal: a.signal, at: now, kind: "skipped", note: "过期没定" });
    state.asks = state.asks.filter((a) => a.expires > now);
    if (risk.stage !== "paper") {
      let perf: Performance | undefined;
      try { perf = vd.venue.publisher === undefined ? undefined : await tools.performance(owner, vd.venue.publisher); } catch { perf = undefined; }
      const stop = stopHit(risk, { ...(perf !== undefined ? { drawdown: perf.drawdown } : {}), losses: consecutiveLosses(state) });
      if (stop !== undefined) risk = dropToPaper(home, owner, id, risk, state, stop, now);
    }
    const handled = new Set([...state.records.map((r) => r.signal), ...state.asks.map((a) => a.signal)]);
    for (const s of signals) {
      if (handled.has(s.id)) continue;
      handled.add(s.id);
      const points = prices.get(s.market) ?? [];
      const price = points[points.length - 1]?.price;
      const d = decide(s, risk, state, price, now);
      decided++;
      if (d.kind === "paper") state.records.push({ signal: s.id, at: now, kind: "paper", note: d.note, market: s.market, side: s.side, entry: d.entry, expires: s.expires });
      else if (d.kind === "skip") state.records.push({ signal: s.id, at: now, kind: "skipped", note: d.reason });
      else if (d.kind === "ask") {
        state.asks.push({ signal: s.id, at: now, market: s.market, side: s.side, cap: s.priceCap, ...(d.price !== undefined ? { price: d.price } : {}), amount: d.amount, expires: s.expires, text: askText(s, d, state.objections[s.id], risk.agentReads) });
        if (risk.agentReads) askAgent(home, c, s, now);
      } else {
        const placed = await place(risk, tools.connector, { signal: s.id, market: s.market, side: s.side, price: d.price, amount: d.amount, channel });
        if (placed.ok) state.records.push({ signal: s.id, at: now, kind: "ordered", note: `单 ${placed.id} · ${d.price} × ${d.amount}`, market: s.market, side: s.side, entry: d.price, amount: d.amount, expires: s.expires, order: placed.id });
        else { state.records.push({ signal: s.id, at: now, kind: "failed", note: placed.error }); risk = dropToPaper(home, owner, id, risk, state, `下单失败：${placed.error}`, now); }
      }
    }
    writeExec(home, owner, id, state);
  }
  return decided;
}

/** A press on the band (§10.5): 跟 places the order through the connector and records it, 跳过 records that, 全停 drops the channel to 纸面 and mutes the asks; on a 卡住, 知道了 clears it. */
export async function answerExecNeed(home: string, key: string, action: string, now: string, connector: Connector): Promise<{ ok: true } | { ok: false; reason: string }> {
  const stuck = /^exec-stuck:([^/]+)\/([^/]+)$/.exec(key);
  if (stuck !== null) {
    const s = readExec(home, stuck[1]!, stuck[2]!);
    delete s.stuck;
    writeExec(home, stuck[1]!, stuck[2]!, s);
    return { ok: true };
  }
  const m = /^exec:([^/]+)\/([^/]+)\/(.+)$/.exec(key);
  if (m === null) return { ok: false, reason: `不认识这件事：${key}` };
  const owner = m[1]!, id = m[2]!, signal = m[3]!;
  const state = readExec(home, owner, id);
  const ask = state.asks.find((a) => a.signal === signal);
  if (ask === undefined) return { ok: false, reason: "这条询问已经过了" };
  const risk = readRisk(home, owner, id);
  state.asks = state.asks.filter((a) => a.signal !== signal);
  if (action === "全停") dropToPaper(home, owner, id, risk, state, "主人全停", now, { muted: true });
  else if (action === "跟") {
    const price = ask.price ?? ask.cap;
    const placed = await place(risk, connector, { signal, market: ask.market, side: ask.side, price, amount: ask.amount, channel: `${owner}/${id}` });
    if (placed.ok) state.records.push({ signal, at: now, kind: "followed", note: `单 ${placed.id} · ${price} × ${ask.amount}`, market: ask.market, side: ask.side, entry: price, amount: ask.amount, expires: ask.expires, order: placed.id });
    else { state.records.push({ signal, at: now, kind: "failed", note: placed.error }); dropToPaper(home, owner, id, risk, state, `下单失败：${placed.error}`, now); }
  } else if (action === "跳过") state.records.push({ signal, at: now, kind: "skipped", note: "主人跳过" });
  else return { ok: false, reason: `没有这个答复：${action}` };
  writeExec(home, owner, id, state);
  return { ok: true };
}

/** The agent's objection to one signal (§10.5 读论点后决定跳过某条): kept with the channel's state, shown on a pending ask, the signal skipped if not yet decided. */
export function objectToSignal(home: string, signal: string, reason: string, now: string): { ok: true; channel: string } | { ok: false; reason: string } {
  const c = readConfig(home);
  if (c === undefined) return { ok: false, reason: "没有 connect.json：先 gemworks connect setup" };
  for (const { owner, vd } of channelsOf(home, c)) {
    const s = signalsIn(home, c, owner, vd).find((x) => x.id === signal);
    if (s === undefined) continue;
    const state = readExec(home, owner, vd.venue.id);
    state.objections[signal] = reason;
    const risk = readRisk(home, owner, vd.venue.id);
    for (const a of state.asks) if (a.signal === signal) a.text = askText(s, { ...(a.price !== undefined ? { price: a.price } : {}), amount: a.amount }, reason, risk.agentReads);
    writeExec(home, owner, vd.venue.id, state);
    void now;
    return { ok: true, channel: `${owner}/${vd.venue.id}` };
  }
  return { ok: false, reason: `没有这条信号：${signal}` };
}

/** The module's needs on the band (§10.5, §6.9): a 定 per open ask, a 卡住 while the channel sits on 纸面 after an error or a stop. */
export function execNeeds(home: string, c: Config, now: string): Need[] {
  const out: Need[] = [];
  for (const { owner, vd } of channelsOf(home, c)) {
    const s = readExec(home, owner, vd.venue.id);
    for (const a of s.asks) if (a.expires > now) out.push({ kind: "decide", key: `exec:${owner}/${vd.venue.id}/${a.signal}`, text: `频道「${vd.venue.name}」· ${a.text}`, actions: [...ASK_ACTIONS], since: a.at, venue: vd.venue.id, level: 0 });
    if (s.stuck !== undefined) out.push({ kind: "stuck", key: `exec-stuck:${owner}/${vd.venue.id}`, text: `频道「${vd.venue.name}」本机执行退回纸面：${s.stuck.why}`, actions: ["知道了"], since: s.stuck.at, venue: vd.venue.id, level: 0 });
  }
  return out;
}

/** What the page shows for a channel (§10.4): the price in the head, the stage card, the module's line under each signal, today's count, the footer. */
export interface ChannelView { price: string; stageWord: string; stage: string[]; footer: string; today: number; exec: Record<string, string> }
export function channelView(home: string, c: Config, owner: string, vd: VenueDoc, now: string): ChannelView {
  const risk = readRisk(home, owner, vd.venue.id);
  const s = readExec(home, owner, vd.venue.id);
  const exec: Record<string, string> = {};
  for (const sig of signalsIn(home, c, owner, vd)) {
    const record = [...s.records].reverse().find((r) => r.signal === sig.id);
    exec[sig.id] = execLine(record ?? (s.asks.some((a) => a.signal === sig.id) ? { signal: sig.id, at: "", kind: "asked", note: "" } : undefined));
  }
  return { price: priceWords(vd.venue.price), stageWord: STAGE_WORDS[risk.stage], stage: stageLines(risk, localRecord(s), now), footer: FOOTER, today: vd.messages.filter((m) => m.kind === "signal" && m.at.slice(0, 10) === now.slice(0, 10)).length, exec };
}

/** The connector as a command (§10.5): the order as JSON on stdin and in ORDER_* variables; its stdout is the order's id; a non-zero exit is the error. */
export function commandConnector(command: string, order: Order): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  return new Promise((done) => {
    const win = process.platform === "win32";
    const child = spawn(win ? "cmd.exe" : "sh", win ? ["/d", "/s", "/c", command] : ["-c", command], { env: { ...process.env, ORDER_SIGNAL: order.signal, ORDER_MARKET: order.market, ORDER_SIDE: order.side, ORDER_PRICE: String(order.price), ORDER_AMOUNT: String(order.amount), ORDER_CHANNEL: order.channel }, stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", (c: Buffer) => { out += c; });
    child.stderr.on("data", (c: Buffer) => { err += c; });
    child.on("error", (e) => done({ ok: false, error: e.message }));
    child.on("exit", (code) => done(code === 0 ? { ok: true, id: out.trim() === "" ? "?" : out.trim() } : { ok: false, error: `connector exited ${code}: ${err.trim()}` }));
    child.stdin.end(`${JSON.stringify(order)}\n`);
  });
}
```

- [ ] **Step 5: The outbox kinds, the chains followed, the run after each sync**

**5a.** In `src/daemon/home.ts`, `  kind: "message" | "marker" | "grant" | "refuse" | "allow" | "digest" | "match";` becomes `  kind: "message" | "marker" | "grant" | "refuse" | "allow" | "digest" | "match" | "signal" | "retract";` and the comment line above it (`  /** A message or a queue marker for a document; a grant or a refusal of a request, an allowance for an agent's ask, a digest's 定, a match's nod (no document: the relay's own endpoints). */`) becomes `  /** A message or a queue marker for a document; a grant or a refusal of a request, an allowance for an agent's ask, a digest's 定, a match's nod, a signal or its retraction (no document: the relay's own endpoints). */`.

**5b.** In `src/daemon/client.ts`, `export interface VenueRow { owner: string; id: string; kind: string; name: string }` becomes `export interface VenueRow { owner: string; id: string; kind: string; name: string; publisher?: string }`.

**5c.** In `src/daemon/sync.ts`: after `import { RelayClient, RelayDown, reasonOf } from "./client.js";`:

```ts
import type { Performance } from "../core/im/signal.js";
import { commandConnector, runExec, type Connector } from "./exec.js";
```

`export interface SyncReport { connected: boolean; docs: number; pushed: number; failed: number; left: number; heartbeats: number; error?: string }` becomes `export interface SyncReport { connected: boolean; docs: number; pushed: number; failed: number; left: number; heartbeats: number; executed: number; error?: string }`; `DaemonOptions` gains `connector?: Connector; ` before `backoffMs?: readonly number[] }`; the class gains the field `  private readonly connector: Connector;` after `  private readonly backoff: readonly number[];` and the constructor `    this.backoff = o.backoffMs ?? DEFAULT_BACKOFF_MS;` gains after it `    this.connector = o.connector ?? commandConnector;`.

`listFollowed`'s return gains the publishers' chains: `...venues.map((v) => \`${v.owner}/venues/${v.id}.geml\`), ` becomes `...venues.map((v) => \`${v.owner}/venues/${v.id}.geml\`), ...venues.flatMap((v) => (v.kind === "channel" && v.publisher !== undefined ? [\`${v.owner}/signals/${v.publisher}.geml\`] : [])), ` (and its comment gains `, the signal chains of the channels (§10.2)` before ` (§8). */`).

In `flushOutbox`, ` : e.kind === "match" ? await client.post(` becomes ` : e.kind === "signal" ? await client.post("/signals", e.body) : e.kind === "retract" ? await client.post(\`/signals/${encodeURIComponent(e.doc)}/retract\`, e.body) : e.kind === "match" ? await client.post(`.

In `syncOnce`, `      const heartbeats = await this.heartbeat(c);\n      writeState(this.home, { connected: true, at });\n      return { connected: true, docs, ...flushed, heartbeats };` becomes:

```ts
      const heartbeats = await this.heartbeat(c);
      // The local execution module (§10.5) after every sync, on what was just mirrored.
      const executed = await runExec(this.home, at, { prices: async (market) => { const r = await client.get(`/prices/${encodeURIComponent(market)}`); return r.status === 200 ? (r.body as { points: { at: string; price: number }[] }).points : []; }, performance: async (owner, agent) => { const r = await client.get(`/signals/${encodeURIComponent(owner)}/${encodeURIComponent(agent)}`); return r.status === 200 ? (r.body as { performance: Performance }).performance : undefined; }, connector: this.connector });
      writeState(this.home, { connected: true, at });
      return { connected: true, docs, ...flushed, heartbeats, executed };
```

and the failure's `      return { connected: false, docs: 0, pushed: 0, failed: 0, left: listOutbox(this.home).length, heartbeats: 0, error };` becomes `      return { connected: false, docs: 0, pushed: 0, failed: 0, left: listOutbox(this.home).length, heartbeats: 0, executed: 0, error };`.

**5d.** In `src/daemon/deliver.ts`: `import { mkdirSync, writeFileSync } from "node:fs";` becomes `import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";`; `import { join } from "node:path";` becomes `import { dirname, join } from "node:path";`; `import type { DataBlock } from "../core/im/chain.js";` becomes `import { readDataBlocks, renderDataBlock, seal, type DataBlock } from "../core/im/chain.js";`; after `import type { Presence } from "../core/im/presence.js";`:

```ts
import type { SignalInput } from "../core/im/signal.js";
import { appendText } from "../host-fs.js";
```

and after `answerMatch` (the function ending `  return enqueueOutbox(home, { kind: "match", as: "person", owner: o.owner, doc: o.id, body: { yes: o.yes }, at: now });\n}`):

```ts

/** A signal from this host's agent (§10.2 发布即双重盖戳): sealed onto the host's own chain under the home first — `<home>/signals/<agent>.geml`, each block hashed over the last — then to the relay through the outbox with that stamp and hash. */
export function publishSignal(home: string, agent: string, input: SignalInput & { channel: string }, now: string): { id: string; hash: string } {
  const c = requireConfig(home);
  const path = join(home, "signals", `${agent}.geml`);
  const blocks = existsSync(path) ? readDataBlocks(readFileSync(path, "utf8")).blocks : [];
  const last = blocks[blocks.length - 1];
  const prev = typeof last?.value["hash"] === "string" ? last.value["hash"] : null;
  const id = newBlockId(now).replace(/^m-/, "s-");
  const block = seal({ id, ...(input as unknown as Record<string, JsonValue>), from: `agent:${agent}@${c.person}`, at: now }, prev);
  if (!existsSync(path)) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, `=== meta\ntitle = "gemworks im signals ${agent}"\n===\n\n`, "utf8"); }
  appendText(path, renderDataBlock(id, block as unknown as JsonValue));
  enqueueOutbox(home, { kind: "signal", as: `agent:${agent}`, owner: c.person, doc: "", body: { ...(input as unknown as Record<string, JsonValue>), at: now, hostHash: block.hash }, at: now });
  return { id, hash: block.hash };
}

/** A retraction (§10.2), as the agent, through the outbox; the relay marks its chain. */
export function retractSignal(home: string, agent: string, id: string, now: string): OutboxEntry {
  const c = requireConfig(home);
  return enqueueOutbox(home, { kind: "retract", as: `agent:${agent}`, owner: c.person, doc: id, body: {}, at: now });
}
```

**5e.** In `src/daemon/view.ts`: after `import { localAccess } from "./deliver.js";`:

```ts
import { channelView, execNeeds, signalsIn } from "./exec.js";
import { signalLines, type Signal } from "../core/im/signal.js";
```

`ThreadMessage` gains, after `  decision: boolean;`:

```ts
  /** A signal message (§10.4): the card's lines, the module's line last. */
  signal?: string[];
```

`export interface Thread { owner: string; id: string; kind: VenueKind; kindWord: string; name: string; announce?: string; people: string[]; agents: string[]; draftFirst: boolean; messages: ThreadMessage[]; total: number }` becomes `export interface Thread { owner: string; id: string; kind: VenueKind; kindWord: string; name: string; announce?: string; people: string[]; agents: string[]; draftFirst: boolean; messages: ThreadMessage[]; total: number; channel?: { price: string; stage: string[]; footer: string } }`.

In `statusView`, `  const needs: Need[] = [...readInbox(home, c.relay.name, c.person)];` becomes `  const needs: Need[] = [...readInbox(home, c.relay.name, c.person), ...execNeeds(home, c, now)];`, and `    const row = listRow(vd.venue, { unread, ...(mode !== undefined ? { mode } : {}) });` becomes:

```ts
    const channel = vd.venue.kind === "channel" ? channelView(home, c, owner, vd, now) : undefined;
    const row = listRow(vd.venue, { unread, ...(mode !== undefined ? { mode } : {}), ...(channel !== undefined ? { stage: channel.stageWord, today: channel.today } : {}) });
```

In `threadView`, `  const me = \`person:${c.person}\`;` becomes:

```ts
  const me = `person:${c.person}`;
  const channel = vd.venue.kind === "channel" ? channelView(home, c, owner, vd, now ?? new Date().toISOString()) : undefined;
  const signals = channel === undefined ? new Map<string, Signal>() : new Map(signalsIn(home, c, owner, vd).map((s) => [s.id, s]));
```

after `    if (msg.opinion !== undefined) t.opinion = msg.opinion;`:

```ts
    if (msg.kind === "signal" && msg.signal !== undefined && channel !== undefined) {
      const sig = signals.get(parseAddress(msg.signal)?.block ?? "");
      if (sig !== undefined) t.signal = signalLines(sig, channel.exec[sig.id]);
    }
```

and `  if (vd.venue.announce !== undefined) th.announce = vd.venue.announce.text;` gains after it:

```ts
  if (channel !== undefined) th.channel = { price: channel.price, stage: channel.stage, footer: channel.footer };
```

- [ ] **Step 6: Build and run**

```bash
npm run build 2>&1 | tail -2 && node --test test/daemon-exec.test.mjs test/risk.test.mjs test/daemon-view.test.mjs test/daemon-sync.test.mjs test/daemon-card.test.mjs test/daemon-deliver.test.mjs test/daemon-home.test.mjs test/daemon-cli.test.mjs test/bridge-im.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
```
Expected: `ℹ fail 0`.

- [ ] **Step 7: Commit**

```bash
git add src/daemon/exec.ts src/daemon/home.ts src/daemon/client.ts src/daemon/sync.ts src/daemon/deliver.ts src/daemon/view.ts src/core/im/risk.ts test/daemon-exec.test.mjs test/risk.test.mjs test/daemon-sync.test.mjs test/daemon-cli.test.mjs
git commit -m "IM daemon: the signal sealed on the host's chain first, the publisher's chain followed, the local execution module with its three stages, the channel on the page"
```

---

### Task 5: The bridge, the protocol, the shell and the hooks: `im-signal`, the asks on the band, the channel on the board

**Files:**
- Modify: `src/hosts/claude-code/protocol.ts`, `src/bridge.ts`, `src/hosts/claude-code/im.ts`, `src/hosts/claude-code/text.ts`, `hooks/register.tsx`
- Modify: `test/bridge-im.test.mjs`, `test/im-host.test.mjs`, `tests/hooks.test.ts`

- [ ] **Step 1: The tests**

**1a.** Append to `test/bridge-im.test.mjs`:

```js
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
```

(and its import line `import { listOutbox, … } from "../dist/daemon/home.js";` must have `listOutbox` — the file's home import gains `listOutbox, ` if it is not there.)

**1b.** In `test/im-host.test.mjs`, `  assert.deepEqual(IM_TOOL_NAMES, ["im_say", "im_ask", "im_report", "im_read", "im_forward", "im_card"]);` becomes `  assert.deepEqual(IM_TOOL_NAMES, ["im_say", "im_ask", "im_report", "im_read", "im_forward", "im_card", "im_signal"]);` and the file gains at its end:

```js
test("a channel on the page (§10.4): the price in the head, the stage card under it, a signal drawn as its card with the module's line, the footer last, and no input (only signals go there)", () => {
  const t = (s, ...a) => a.reduce((x, v, i) => x.replace(`{${i}}`, String(v)), s);
  const base = { thread: null, replyTo: null, columns: 120, now: "2026-10-31T09:30:00Z", t };
  const thread = {
    owner: "zhang", id: "ch-1", kind: "channel", kindWord: "订阅频道", name: "alpha 的信号", people: ["zhang", "john"], agents: ["alpha"], draftFirst: false, total: 1,
    channel: { price: "按月 30 · 按条 2", stage: ["阶段：纸面 · 第 3 天 · 命中 —", "升级：还要 11 天，且命中 ≥ 60%（现在没有结算的信号），主人批准"], footer: "平台不托管资金、不经手密钥 · 订阅时已展示免责条款 · 发布方看不到你跟没跟" },
    messages: [{ id: "sig-1", speaker: "agent:alpha@zhang", label: "alpha · 代 zhang", kind: "signal", kindWord: "信号", text: "信号 signal-1 · m · 买是 · 价 ≤0.63 · 过期 10:00", at: "2026-10-31T09:12:05Z", source: "agent", parts: [], evidence: [], decision: false, signal: ["信号 signal-1 · 发布 09:12:04 · 中继收到 09:12:05", "市场 m · 买是 · 价 ≤0.63 · 仓位 2% · 过期 10-31 10:00 · 信心 0.7", "纸面 · 记为『若跟：0.61 进，2%』· 没下单"] }],
  };
  const rows = imTabRows({ ...base, status: STATUS, thread });
  assert.deepEqual(rows.map((r) => `${r.kind}:${r.key ?? r.text ?? r.lines?.[0] ?? ""}`), ["heading:im-thread", "text:阶段：纸面 · 第 3 天 · 命中 —", "text:升级：还要 11 天，且命中 ≥ 60%（现在没有结算的信号），主人批准", "note:im-m-sig-1", "text:平台不托管资金、不经手密钥 · 订阅时已展示免责条款 · 发布方看不到你跟没跟"]);
  assert.equal(rows[0].sub, "2 人 · 1 个 agent · 按月 30 · 按条 2");
  assert.deepEqual([rows[3].lines, rows[3].tag.replace(/ · \d\d:\d\d · /, " · hh:mm · ")], [thread.messages[0].signal, "alpha · 代 zhang · hh:mm · 信号"]);
  assert.equal(rows.some((r) => r.kind === "input"), false);
});
```

**1c.** In `tests/hooks.test.ts`: the scripted bridge's line `    if (req.op === 'im-brief') { … }` gains after it:

```ts
    if (req.op === 'im-signal') { w.sent.push(req); return { v: 1, ok: true, shell: shell(), signal: { line: req.action === 'list' ? '命中 0/0 · 90 天收益 0% · 最大回撤 0% · 已撤回 0（仍计入）' : '已排入待发：信号 s-1 → 频道 john/ch-9 · 本机哈希 sha256:abcd' } } }
```

every registered-tool list ending in `'im_read', 'im_forward', 'im_card'])` (three of them: at the start, under the refused registration, under the IM tools) ends in `'im_read', 'im_forward', 'im_card', 'im_signal'])`, and the file gains at its end:

```ts
test('im_signal (plan L): the tool goes through the bridge as the session\'s agent — publish with the channel in its body, list with its target — and answers with the bridge\'s line', async ($, on) => {
  const w = world(on)
  w.im = { configured: true, person: 'john', relay: 'relay.test', agents: ['xiaoping'], connected: true, needs: [], venues: [], drafts: [], cards: [], presence: {} }
  await start($, on)
  const body = { channel: 'john/ch-9', market: 'polymarket:x', side: 'yes', sizeHint: { kind: 'fraction-of-bankroll', value: 0.02 }, priceCap: 0.63, expires: '2099-01-01T00:00:00Z', confidence: 0.7 }
  const made = await $.tool.call({ tool: 'mcp__gemworks__im_signal', tool_use_id: 's1', action: 'publish', body })
  expect(w.sent.filter((r) => r.op === 'im-signal').at(-1)).toMatchObject({ op: 'im-signal', action: 'publish', as: 'xiaoping', body })
  expect(String(made.result)).toContain('已排入待发：信号 s-1 → 频道 john/ch-9')
  const listed = await $.tool.call({ tool: 'mcp__gemworks__im_signal', tool_use_id: 's2', action: 'list', target: 'xiaoping@john' })
  expect(w.sent.filter((r) => r.op === 'im-signal').at(-1)).toMatchObject({ action: 'list', target: 'xiaoping@john' })
  expect(String(listed.result)).toContain('命中 0/0')
  const bad = await $.tool.call({ tool: 'mcp__gemworks__im_signal', tool_use_id: 's3', action: 'sell' })
  expect(String(bad.result)).toContain('action is publish, retract, skip or list')
})
```

- [ ] **Step 2: Run them to see them fail**

```bash
node --test test/bridge-im.test.mjs test/im-host.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
```
Expected: `ℹ fail 3` or more.

- [ ] **Step 3: The op**

In `src/hosts/claude-code/protocol.ts`, after the `im-brief` member (`  | { op: "im-brief"; text: string; agent?: string; card?: string }`):

```ts
  /** A signal (plan L, §10): publish (the fields and the channel in `body`), retract or skip one by `id` (skip with the agent's `reason`), or list an agent's chain by `target` (`<agent>@<owner>`); `as` names the agent whose token signs. */
  | { op: "im-signal"; action: "publish" | "retract" | "skip" | "list"; as?: string; body?: Record<string, unknown>; id?: string; reason?: string; target?: string }
```

`"im-card", "im-brief"]);` becomes `"im-card", "im-brief", "im-signal"]);`; after `    "im-brief": () => str("text"),`:

```ts
    "im-signal": () => str("action"),
```

and after `      brief?: { venue: string };`:

```ts
      /** im-signal: the line the tool prints. */
      signal?: { line: string };
```

- [ ] **Step 4: The bridge**

In `src/bridge.ts`: `import { answer as imAnswer, answerAllow, answerDigest, answerGrant, answerMatch, dropDraft, nextPrompt, markRead, reportPresence, say, sendDraft } from "./daemon/deliver.js";` becomes `import { answer as imAnswer, answerAllow, answerDigest, answerGrant, answerMatch, dropDraft, nextPrompt, markRead, publishSignal, reportPresence, retractSignal, say, sendDraft } from "./daemon/deliver.js";`; after `import { briefCall } from "./daemon/brief.js";`:

```ts
import { answerExecNeed, commandConnector, objectToSignal } from "./daemon/exec.js";
import { RelayClient, reasonOf } from "./daemon/client.js";
import { performanceLine, signalFaults, signalInput, signalText, type Performance, type Signal } from "./core/im/signal.js";
```

`handleRequest`'s `  if (req.op === "im-brief") return answerBrief(req);` becomes:

```ts
  if (req.op === "im-brief") return answerBrief(req);
  if (req.op === "im-signal") return answerSignal(req);
  // A press on the local execution module's ask or 卡住 (§10.5) may place an order: it waits on the connector.
  if (req.op === "im-need" && /^exec(-stuck)?:/.test(req.key)) return answerExecPress(req);
```

After `answerBrief` (the function ending `  return r.ok ? { v: 1, ok: true, shell, brief: { venue: r.venue } } : { v: 1, ok: false, error: \`gemworks: ${r.reason}\`, shell };\n}`):

```ts

/** `im-need` on an `exec:` key: the module answers (daemon/exec.ts), an order through the risk file's connector command. */
async function answerExecPress(req: BridgeRequest & { op: "im-need" }): Promise<BridgeResponse> {
  const shell = shellAt(req);
  const r = await answerExecNeed(imHome(), req.key, req.action, new Date().toISOString(), commandConnector);
  return r.ok ? { v: 1, ok: true, shell } : { v: 1, ok: false, error: `gemworks: ${r.reason}`, shell };
}

/** `im-signal` (§10): publish seals the signal on this host's chain and queues it for the relay; retract queues the mark; skip records the agent's objection with the channel's state; list reads an agent's chain and performance from the relay. */
async function answerSignal(req: BridgeRequest & { op: "im-signal" }): Promise<BridgeResponse> {
  const shell = shellAt(req);
  const home = imHome();
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const done = (line: string): BridgeResponse => ({ v: 1, ok: true, shell, signal: { line } });
  const refuse = (reason: string): BridgeResponse => ({ v: 1, ok: false, error: `gemworks: ${reason}`, shell });
  const c = readConfig(home);
  if (c === undefined) return refuse("没有 connect.json：先 gemworks connect setup");
  if (req.action === "list") {
    const m = /^([^@\s]+)@([^@\s]+)$/.exec(req.target ?? "");
    if (m === null) return refuse("list 要 <agent>@<owner>");
    let r: { status: number; body: unknown };
    try { r = await new RelayClient(c.relay.url, c.token).get(`/signals/${encodeURIComponent(m[2]!)}/${encodeURIComponent(m[1]!)}`); } catch (e) { return refuse(`连不上中继：${e instanceof Error ? e.message : String(e)}`); }
    if (r.status !== 200) return refuse(reasonOf(r));
    const page = r.body as { signals: Signal[]; performance: Performance };
    return done([performanceLine(page.performance), ...page.signals.map((s) => `${signalText(s)}${s.retracted !== undefined ? " · 已撤回" : ""}`)].join("\n"));
  }
  if (req.action === "skip") {
    if (req.id === undefined) return refuse("skip 要信号的 id");
    const reason = (req.reason ?? "").trim();
    const r = objectToSignal(home, req.id, reason === "" ? "agent 反对" : reason, now);
    return r.ok ? done(`已反对 ${req.id}（频道 ${r.channel}）`) : refuse(r.reason);
  }
  const agent = req.as ?? Object.keys(c.agents)[0];
  if (agent === undefined) return refuse("本会话没有 agent：在设置里选一个");
  if (c.agents[agent] === undefined) return refuse(`没有 ${agent} 的令牌`);
  if (req.action === "retract") {
    if (req.id === undefined) return refuse("retract 要信号的 id");
    retractSignal(home, agent, req.id, now);
    return done(`已排入待发：撤回 ${req.id}`);
  }
  const body = req.body ?? {};
  const channel = typeof body["channel"] === "string" ? body["channel"] : undefined;
  if (channel === undefined || !/^[^/\s]+\/[^/\s]+$/.test(channel)) return refuse("publish 要 channel（owner/id）");
  const faults = signalFaults(body);
  if (faults.length > 0) return refuse(faults.join("；"));
  const made = publishSignal(home, agent, { ...signalInput(body)!, channel }, now);
  return done(`已排入待发：信号 ${made.id} → 频道 ${channel} · 本机哈希 ${made.hash}`);
}
```

and after `      case "im-brief": return no("起草走 handleRequest，不走同步的答复");`:

```ts
      case "im-signal": return no("信号走 handleRequest，不走同步的答复");
```

- [ ] **Step 5: The tool, the channel's rows, the words**

In `src/hosts/claude-code/im.ts`: `export const IM_TOOL_NAMES = ["im_say", "im_ask", "im_report", "im_read", "im_forward", "im_card"] as const;` becomes `export const IM_TOOL_NAMES = ["im_say", "im_ask", "im_report", "im_read", "im_forward", "im_card", "im_signal"] as const;`; the `IM_TOOLS` array's closing `];` (the line after the `im_card` entry) becomes:

```ts
  { name: "im_signal", description: "A signal (§10). publish: one into a channel your owner made with you as its publisher — body: channel (owner/id), market, side yes|no, sizeHint {kind: fraction-of-bankroll, value}, priceCap, expires (ISO), confidence 0..1, thesis (an address); it is data, never a prompt, sealed on this host's chain first. retract: one by id (it stays on the chain and still counts). skip: a signal in a channel your owner subscribes to, after you read its thesis and object (id, reason) — your owner must have let you take part; you can never widen the risk file. list: an agent's chain and performance (target: agent@owner).", inputSchema: { type: "object", properties: { action: { type: "string", enum: ["publish", "retract", "skip", "list"] }, body: { type: "object", description: "publish: the signal's fields and its channel.", additionalProperties: true }, id: { type: "string", description: "retract, skip: the signal's id on the relay." }, reason: { type: "string", description: "skip: why." }, target: { type: "string", description: "list: `<agent>@<owner>`." } }, required: ["action"], additionalProperties: false } },
];
```

In `threadRows`: the heading's `sub` expression `` `${th.people.length} 人 · ${th.agents.length} 个 agent${th.draftFirst ? ` · ${t("回群前先给我看")}` : ""}` `` becomes `` `${th.people.length} 人 · ${th.agents.length} 个 agent${th.draftFirst ? ` · ${t("回群前先给我看")}` : ""}${th.channel !== undefined ? ` · ${th.channel.price}` : ""}` ``; `  if (th.announce !== undefined) rows.push(text(truncate(\`${t("公告")}：${th.announce}\`, columns)));` gains after it:

```ts
  // A channel (§10.4): the stage card under the head, each signal as its card, the footer last, and no input.
  if (th.channel !== undefined) for (const l of th.channel.stage) rows.push(text(truncate(l, columns)));
```

`    rows.push({ kind: "note", key: \`im-m-${m.id}\`, lines: wrapCells(body, Math.max(10, columns - 4), 6), tag: tags.join(" · "), action: { op: "im-reply", message: replyTo === m.id ? null : m.id } });` becomes:

```ts
    rows.push({ kind: "note", key: `im-m-${m.id}`, lines: m.signal !== undefined ? m.signal.map((l) => truncate(l, Math.max(10, columns - 4))) : wrapCells(body, Math.max(10, columns - 4), 6), tag: tags.join(" · "), action: { op: "im-reply", message: replyTo === m.id ? null : m.id } });
```

and `  rows.push({ kind: "input", key: "im-say", placeholder: replyTo !== null ? t("回复 {0}…", replyTo) : t("以本人身份发到这里"), field: "im-say", target: venueKey(th.owner, th.id) });` becomes:

```ts
  if (th.channel !== undefined) rows.push(text(truncate(th.channel.footer, columns)));
  else rows.push({ kind: "input", key: "im-say", placeholder: replyTo !== null ? t("回复 {0}…", replyTo) : t("以本人身份发到这里"), field: "im-say", target: venueKey(th.owner, th.id) });
```

In `src/hosts/claude-code/text.ts`, after `  "先写一行：怎么改": { en: "Type a line first: what to change", ja: "先に一行：どう直すか" },`:

```ts
  "业绩与信号": { en: "Performance and signals", ja: "成績とシグナル" },
  "信号": { en: "Signal", ja: "シグナル" },
```

- [ ] **Step 6: The hooks module**

In `hooks/register.tsx`, `  on('tool.call', { tool: 'mcp__gemworks__im_card' }, ($, e) => serveIm($, 'im_card', e)).catch(() => ({ result: 'gemworks IM could not do that' }))` gains after it:

```ts
  on('tool.call', { tool: 'mcp__gemworks__im_signal' }, ($, e) => serveIm($, 'im_signal', e)).catch(() => ({ result: 'gemworks IM could not do that' }))
```

and before `  if (name === 'im_card') {` in `serveIm`:

```ts
  if (name === 'im_signal') {
    const action = str('action') ?? ''
    if (action !== 'publish' && action !== 'retract' && action !== 'skip' && action !== 'list') return { result: `${name}: action is publish, retract, skip or list` }
    const body = typeof args['body'] === 'object' && args['body'] !== null ? args['body'] as Record<string, unknown> : undefined
    const id = str('id'), reason = str('reason'), target = str('target')
    const r = await through({ op: 'im-signal', action, as: agent, ...(body !== undefined ? { body } : {}), ...(id !== undefined ? { id } : {}), ...(reason !== undefined ? { reason } : {}), ...(target !== undefined ? { target } : {}) })
    if (!r.ok) return { result: r.text }
    const line = r.res.signal?.line ?? ''
    const where = id ?? (typeof body?.['channel'] === 'string' ? body['channel'] as string : undefined) ?? target ?? t('信号')
    return { result: action === 'list' ? `${toolLine(name, where, t('业绩与信号'))}\n${line}` : toolLine(name, where, line) }
  }
```

- [ ] **Step 7: Build and run**

```bash
npm run build 2>&1 | tail -2 && node --test test/bridge-im.test.mjs test/bridge.test.mjs test/protocol.test.mjs test/im-host.test.mjs test/board.test.mjs test/text.test.mjs test/hooks-purity.test.mjs test/hooks-types.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
claude plugin test . 2>&1 | grep -E "^ *[0-9]+ (pass|fail)|\(fail\) im_signal"
```
Expected: `ℹ fail 0`; the hooks tests with only the machine's pane failures (and, at times, the harness's `the file ran to its end`).

- [ ] **Step 8: Commit**

```bash
git add src/hosts/claude-code/protocol.ts src/bridge.ts src/hosts/claude-code/im.ts src/hosts/claude-code/text.ts hooks/register.tsx test/bridge-im.test.mjs test/im-host.test.mjs tests/hooks.test.ts
git commit -m "IM shell: im_signal for the publisher's and the subscriber's agent, the module's asks on the band, the channel on the board"
```

---

### Task 6: The CLI: `connect channel`, `connect signal`, `connect risk`, `relay price`

**Files:**
- Modify: `src/cli.ts`
- Test: `test/signal-cli.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// test/signal-cli.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUNDLE } from "./helpers/repo.mjs";
import { startRelay } from "../dist/relay/server.js";
import { writeConfig } from "../dist/daemon/home.js";

const tmp = (p) => mkdtempSync(join(tmpdir(), p));
const run = (args, env = {}) => new Promise((done) => {
  const child = spawn(process.execPath, [BUNDLE, ...args], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let out = "", err = "";
  child.stdout.on("data", (c) => { out += c; });
  child.stderr.on("data", (c) => { err += c; });
  const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
  child.on("exit", (code) => { clearTimeout(timer); done({ code: code ?? 1, out, err }); });
});
const MARKET = "polymarket:will-x-happen-by-dec";
const EXPIRES = new Date(Date.now() + 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z");

test("gemworks connect channel|signal|risk and relay price (plan L): a channel made, listed and subscribed with the disclaimer; a signal sealed on the host's chain and pushed, listed with the four numbers, retracted; a price set on the relay; the risk file written and shown, an upgrade refused without its evidence; the usage errors", async () => {
  const root = tmp("gemworks-relay-");
  const s = await startRelay({ root, name: "relay.test" });
  const homes = { zhang: tmp("gemworks-im-"), john: tmp("gemworks-im-") };
  try {
    const zhang = s.relay.issuePerson("zhang"), john = s.relay.issuePerson("john");
    const alpha = s.relay.issueAgent(zhang.record, "alpha"), xiaoping = s.relay.issueAgent(john.record, "xiaoping");
    s.relay.topUp("john", 100);
    writeConfig(homes.zhang, { relay: { url: s.url, name: "relay.test" }, person: "zhang", token: zhang.token, agents: { alpha: alpha.token } });
    writeConfig(homes.john, { relay: { url: s.url, name: "relay.test" }, person: "john", token: john.token, agents: { xiaoping: xiaoping.token } });
    const Z = ["--home", homes.zhang], J = ["--home", homes.john];
    const made = await run(["connect", "channel", "new", "ch-1", "--name", "alpha 的信号", "--agent", "alpha", "--month", "30", "--signal", "2", ...Z]);
    assert.deepEqual([made.code, made.out], [0, "zhang/ch-1 · 按月 30 · 按条 2\n"], made.err);
    assert.equal((await run(["connect", "channel", "new", "ch-2", "--name", "x", ...Z])).code, 2, "--agent is required");
    const listed = await run(["connect", "channel", "list", ...J]);
    assert.deepEqual([listed.code, listed.out], [0, "zhang/ch-1 · alpha 的信号 · alpha · 按月 30 · 按条 2 · 0 订阅 · 命中 0/0 · 90 天收益 0% · 最大回撤 0% · 已撤回 0（仍计入）\n"], listed.err);
    const sub = await run(["connect", "channel", "subscribe", "zhang/ch-1", "--month", ...J]);
    assert.equal(sub.code, 0, sub.err);
    assert.match(sub.out, /^免责条款：[\s\S]*\n已订阅「alpha 的信号」· 到 20\d\d-\d\d-\d\dT/);
    assert.equal((await run(["connect", "channel", "subscribe", "zhang/ch-1", ...J])).code, 2, "--month or --signals");
    assert.equal(s.relay.balance("john"), 90);
    const published = await run(["connect", "signal", "publish", "--as", "alpha", "--channel", "zhang/ch-1", "--market", MARKET, "--side", "yes", "--cap", "0.63", "--expires", EXPIRES, "--confidence", "0.7", "--thesis", "https://relay.test/zhang/venues/ch-1.geml#why", ...Z]);
    assert.equal(published.code, 0, published.err);
    assert.match(published.out, /^信号 s-\S+ 已封在本机链上 · 已推送 1 条\n$/);
    const onRelay = s.relay.signalsOf("zhang", "alpha");
    assert.deepEqual([onRelay.length, onRelay[0].market, onRelay[0].side, onRelay[0].priceCap, onRelay[0].confidence, typeof onRelay[0].hostHash, onRelay[0].thesis], [1, MARKET, "yes", 0.63, 0.7, "string", "https://relay.test/zhang/venues/ch-1.geml#why"]);
    assert.equal((await run(["connect", "signal", "publish", "--as", "alpha", "--channel", "zhang/ch-1", "--market", MARKET, "--side", "up", "--cap", "0.63", "--expires", EXPIRES, "--confidence", "0.7", ...Z])).code, 1, "a fault");
    assert.equal((await run(["connect", "signal", "publish", "--channel", "zhang/ch-1", ...Z])).code, 2, "--as and the fields");
    const price = await run(["relay", "price", MARKET, "0.6", "--at", "2026-10-31T08:00:00Z", "--root", root]);
    assert.deepEqual([price.code, price.out], [0, `${MARKET} 0.6 @ 2026-10-31T08:00:00Z\n`], price.err);
    assert.equal((await run(["relay", "price", MARKET, "x", "--root", root])).code, 2);
    const list = await run(["connect", "signal", "list", "alpha@zhang", ...J]);
    assert.equal(list.code, 0, list.err);
    assert.match(list.out, /^命中 0\/0 · 90 天收益 0% · 最大回撤 0% · 已撤回 0（仍计入）\n信号 signal-1 · polymarket:will-x-happen-by-dec · 买是 · 价 ≤0.63 · 过期 \d\d:\d\d\n$/);
    assert.equal((await run(["connect", "signal", "list", "alpha", ...J])).code, 2, "agent@owner");
    const retracted = await run(["connect", "signal", "retract", "signal-1", "--as", "alpha", ...Z]);
    assert.deepEqual([retracted.code, retracted.out], [0, "撤回 signal-1 · 已推送 1 条\n"], retracted.err);
    assert.equal(s.relay.signalsOf("zhang", "alpha")[0].retracted !== undefined, true);
    // the risk file
    assert.equal((await run(["connect", "risk", "zhang/ch-1", "--stage", "small", ...J])).code, 1, "no evidence yet");
    const risk = await run(["connect", "risk", "zhang/ch-1", "--markets", `${MARKET},other`, "--per-order", "5", "--per-day", "20", "--max-positions", "3", "--min-confidence", "0.5", "--stop-losses", "2", "--connector", "node order.mjs", "--agent-reads", ...J]);
    assert.equal(risk.code, 0, risk.err);
    assert.match(risk.out, /^阶段：纸面 · 第 1 天 · 命中 —\n升级：还要 14 天，且命中 ≥ 60%（现在没有结算的信号），主人批准\n$/);
    assert.equal((await run(["connect", "risk", "zhang/ch-1", "--stage", "big", ...J])).code, 2);
    assert.equal((await run(["connect", "risk", ...J])).code, 2);
    const once = await run(["connect", "--once", ...J]);
    assert.equal(once.code, 0, once.err);
    const shown = await run(["connect", "risk", "zhang/ch-1", "show", ...J]);
    assert.equal(shown.code, 0, shown.err);
    assert.match(shown.out, /^阶段：纸面 · 第 1 天 · 命中 —\n升级：[^\n]+\n市场：polymarket:will-x-happen-by-dec、other · 单笔 5 · 当日 20 · 最多 3 仓 · 滑点 2% · 冷却 60 分钟 · 信心 ≥ 0.5 · 止损 回撤 10% \/ 连亏 2 · agent 读论点 · connector node order.mjs\n\d\d:\d\d signal-1 跳过 · 已撤回\n$/);
    assert.equal((await run(["connect", "risk", "zhang/ch-1", "--stage", "paper", ...J])).code, 0, "down or same is always allowed");
    const usage = (await run([])).err;
    for (const w of ["connect channel", "connect signal", "connect risk", "relay price"]) assert.match(usage, new RegExp(w));
  } finally {
    await s.close();
  }
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
node --test test/signal-cli.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
```
Expected: `ℹ fail 1`.

- [ ] **Step 3: The commands**

In `src/cli.ts`, after `  "  connect profile <agent@owner>            the agent's page as the public sees it (§9.3)",`:

```ts
  "  connect channel new <id> --name 名 --agent <a> [--month N] [--signal N] | list | subscribe <owner/id> --month|--signals N   a 订阅频道 (§10.4): make one your agent publishes in, list them with their performance, subscribe (the disclaimer is printed)",
  "  connect signal publish --as <agent> --channel <owner/id> --market m --side yes|no --cap x --expires iso --confidence x [--size 0.02] [--thesis addr] | retract <id> --as <agent> | list <agent@owner>   a signal (§10.1): sealed on this host's chain, then pushed; retracted; an agent's chain with the four numbers",
  "  connect risk <owner/id> [--stage paper|small|auto] [--markets a,b] [--per-order N] [--per-day N] [--max-positions N] [--slippage x] [--cooldown min] [--min-confidence x] [--ask-above N] [--stop-drawdown x] [--stop-losses N] [--connector cmd|--no-connector] [--agent-reads|--no-agent-reads] [--unmute] | show   the channel's risk file (§10.5); a stage up needs its evidence",
```

and after `  "  relay topup <person> <credits> [--note s] [--root dir]   …",` (the line starting `  "  relay topup`):

```ts
  "  relay price <market> <price> [--at iso] [--root dir]   a price point from a public source, on the relay's chain (§10.3)",
```

The imports: after `import { commandMailer } from "./relay/mail.js";`:

```ts
import { performanceLine, signalText, type Performance, type Signal } from "./core/im/signal.js";
import { canAdvance, execLine, localRecord, riskOf, stageLines, STAGE_WORDS, type Risk } from "./core/im/risk.js";
import { priceWords, type ChannelPrice } from "./core/im/venue.js";
import { readExec, readRisk, writeRisk } from "./daemon/exec.js";
import { publishSignal, retractSignal } from "./daemon/deliver.js";
```

(and `Daemon` from `./daemon/sync.js` is already imported for `connect`; if the import line reads `import { Daemon } from "./daemon/sync.js";` it stays.)

In `runRelay`, before `  if (positionals("relay", rest, [], ["--root", "--port", …`:

```ts
  if (rest[0] === "price") {
    const pos = positionals("relay price", rest.slice(1), [], ["--root", "--at"]);
    const [market, price] = pos;
    if (market === undefined || price === undefined || pos.length !== 2 || !/^\d+(\.\d+)?$/.test(price)) fail("gemworks relay price: <market> <price> [--at iso]", 2);
    const at = flag(rest, "--at");
    const r = new Relay({ root, name: "cli" }).setPrice(market!, Number(price), ...(at !== undefined ? [at] : []));
    if (!r.ok) return fail(`gemworks relay price: ${r.reason}`, 1);
    console.log(`${r.market} ${r.price} @ ${r.at}`);
    return 0;
  }
```

Before `/** \`gemworks connect declare <agent> …\` and \`connect profile <agent@owner>\` …`:

```ts
/** `gemworks connect channel|signal|risk` (§10): a channel made, listed, subscribed; a signal sealed here and pushed, retracted, an agent's chain listed; the channel's risk file. */
async function runSignals(home: string, sub: "channel" | "signal" | "risk", args: string[]): Promise<number> {
  const c = readConfig(home);
  if (c === undefined) return fail(`gemworks connect ${sub}: no connect.json here; run gemworks connect setup first`, 1);
  const client = new RelayClient(c.relay.url, c.token);
  const refused = (r: { status: number; body: unknown }): number => fail(`gemworks connect ${sub}: ${reasonOf(r)}`, 1);
  const target = (v: string | undefined, what: string): [string, string] => { const m = /^([^/\s]+)\/([^/\s]+)$/.exec(v ?? ""); if (m === null) fail(`gemworks connect ${sub} ${what}: <owner/id>`, 2); return [m![1]!, m![2]!]; };
  try {
    if (sub === "channel") {
      const verb = args[0];
      if (verb === "new") {
        const pos = positionals("connect channel new", args.slice(1), [], ["--home", "--name", "--agent", "--month", "--signal"]);
        const id = pos[0], agent = flag(args, "--agent");
        if (id === undefined || pos.length !== 1 || agent === undefined) fail("gemworks connect channel new: <id> --name 名 --agent <a> [--month N] [--signal N]", 2);
        const price: Record<string, number> = {};
        for (const [f, k] of [["--month", "month"], ["--signal", "signal"]] as const) { const v = flag(args, f); if (v !== undefined) { if (!/^\d+$/.test(v)) fail(`gemworks connect channel new: ${f} is a whole number of credits`, 2); price[k] = Number(v); } }
        const r = await client.post("/venues", { id, kind: "channel", name: flag(args, "--name") ?? id, agents: [`agent:${agent}@${c.person}`], price });
        if (r.status !== 201) return refused(r);
        const v = (r.body as { venue: { price?: ChannelPrice } }).venue;
        console.log(`${c.person}/${id} · ${priceWords(v.price)}`);
        return 0;
      }
      if (verb === "list") {
        if (positionals("connect channel list", args.slice(1), [], ["--home"]).length > 0) fail(USAGE, 2);
        const r = await client.get("/channels");
        if (r.status !== 200) return refused(r);
        const rows = r.body as { owner: string; id: string; name: string; publisher: string; price: ChannelPrice; subscribers: number; performance: Performance }[];
        if (rows.length === 0) console.log("还没有订阅频道");
        for (const x of rows) console.log(`${x.owner}/${x.id} · ${x.name} · ${x.publisher} · ${priceWords(x.price)} · ${x.subscribers} 订阅 · ${performanceLine(x.performance)}`);
        return 0;
      }
      if (verb === "subscribe") {
        const pos = positionals("connect channel subscribe", args.slice(1), ["--month"], ["--home", "--signals"]);
        const [owner, id] = target(pos[0], "subscribe");
        const signals = flag(args, "--signals");
        if (pos.length !== 1 || (!has(args, "--month") && signals === undefined) || (signals !== undefined && !/^\d+$/.test(signals))) fail("gemworks connect channel subscribe: <owner/id> --month | --signals N", 2);
        const r = await client.post(`/channels/${encodeURIComponent(owner)}/${encodeURIComponent(id)}/subscribe`, has(args, "--month") ? { month: true } : { signals: Number(signals) });
        if (r.status !== 200) return refused(r);
        const x = r.body as { venue: { name: string }; disclaimer: string; until?: string; left?: number };
        console.log(x.disclaimer);
        console.log(`已订阅「${x.venue.name}」· ${x.until !== undefined ? `到 ${x.until}` : `还有 ${x.left ?? 0} 条`}`);
        return 0;
      }
      fail(USAGE, 2);
    }
    if (sub === "signal") {
      const verb = args[0];
      if (verb === "list") {
        const pos = positionals("connect signal list", args.slice(1), [], ["--home"]);
        const m = /^([^@\s]+)@([^@\s]+)$/.exec(pos[0] ?? "");
        if (pos.length !== 1 || m === null) fail("gemworks connect signal list: <agent@owner>", 2);
        const r = await client.get(`/signals/${encodeURIComponent(m![2]!)}/${encodeURIComponent(m![1]!)}`);
        if (r.status !== 200) return refused(r);
        const page = r.body as { signals: Signal[]; performance: Performance };
        console.log(performanceLine(page.performance));
        for (const s of page.signals) console.log(`${signalText(s)}${s.retracted !== undefined ? " · 已撤回" : ""}`);
        return 0;
      }
      const as = flag(args, "--as");
      if (as === undefined || c.agents[as] === undefined) fail(`gemworks connect signal ${verb ?? ""}: --as <agent> (one with a token here)`, 2);
      const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
      if (verb === "retract") {
        const pos = positionals("connect signal retract", args.slice(1), [], ["--home", "--as"]);
        if (pos.length !== 1) fail("gemworks connect signal retract: <id> --as <agent>", 2);
        retractSignal(home, as!, pos[0]!, now);
        const pushed = await new Daemon({ home }).flushOutbox();
        if (pushed.failed > 0) return fail(`gemworks connect signal retract: the relay refused it (see ${join(home, "outbox", "failed")})`, 1);
        console.log(`撤回 ${pos[0]} · 已推送 ${pushed.pushed} 条`);
        return 0;
      }
      if (verb === "publish") {
        if (positionals("connect signal publish", args.slice(1), [], ["--home", "--as", "--channel", "--market", "--side", "--cap", "--expires", "--confidence", "--size", "--thesis"]).length > 0) fail(USAGE, 2);
        const channel = flag(args, "--channel"), market = flag(args, "--market"), side = flag(args, "--side"), cap = flag(args, "--cap"), expires = flag(args, "--expires"), confidence = flag(args, "--confidence");
        if (channel === undefined || market === undefined || side === undefined || cap === undefined || expires === undefined || confidence === undefined) fail("gemworks connect signal publish: --as <agent> --channel <owner/id> --market m --side yes|no --cap x --expires iso --confidence x [--size 0.02] [--thesis addr]", 2);
        target(channel, "publish");
        const thesis = flag(args, "--thesis");
        const body = { market, side, sizeHint: { kind: "fraction-of-bankroll", value: Number(flag(args, "--size") ?? "0.02") }, priceCap: Number(cap), expires, confidence: Number(confidence), ...(thesis !== undefined ? { thesis } : {}) };
        const faults = signalFaults(body);
        if (faults.length > 0) return fail(`gemworks connect signal publish: ${faults.join("；")}`, 1);
        const made = publishSignal(home, as!, { ...signalInput(body)!, channel: channel! }, now);
        const pushed = await new Daemon({ home }).flushOutbox();
        if (pushed.failed > 0) return fail(`gemworks connect signal publish: the relay refused it (see ${join(home, "outbox", "failed")})`, 1);
        console.log(`信号 ${made.id} 已封在本机链上 · 已推送 ${pushed.pushed} 条`);
        return 0;
      }
      fail(USAGE, 2);
    }
    // risk
    const pos = positionals("connect risk", args, ["--agent-reads", "--no-agent-reads", "--no-connector", "--unmute"], ["--home", "--stage", "--markets", "--per-order", "--per-day", "--max-positions", "--slippage", "--cooldown", "--min-confidence", "--ask-above", "--stop-drawdown", "--stop-losses", "--connector"]);
    const [owner, id] = target(pos[0], "");
    const show = pos[1] === "show";
    if (pos.length !== (show ? 2 : 1)) fail("gemworks connect risk: <owner/id> [flags] | show", 2);
    const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    const current = readRisk(home, owner, id);
    const state = readExec(home, owner, id);
    if (show) {
      for (const l of stageLines(current, localRecord(state), now)) console.log(l);
      console.log(`市场：${current.markets.length === 0 ? "没有白名单" : current.markets.join("、")} · 单笔 ${current.perOrder} · 当日 ${current.perDay} · 最多 ${current.maxPositions} 仓 · 滑点 ${Math.round(current.maxSlippage * 1000) / 10}% · 冷却 ${current.cooldownMinutes} 分钟 · 信心 ≥ ${current.minConfidence} · 止损 回撤 ${Math.round(current.stop.drawdown * 1000) / 10}% / 连亏 ${current.stop.losses}${current.askAbove > 0 ? ` · 超过 ${current.askAbove} 必须问我` : ""}${current.agentReads ? " · agent 读论点" : ""}${current.connector !== undefined ? ` · connector ${current.connector}` : " · 没有 connector"}`);
      for (const r of state.records) console.log(`${r.at.slice(11, 16)} ${r.signal === "" ? "—" : r.signal} ${execLine(r)}`);
      return 0;
    }
    const body: Record<string, unknown> = {};
    const stage = flag(args, "--stage");
    if (stage !== undefined) {
      if (stage !== "paper" && stage !== "small" && stage !== "auto") fail("gemworks connect risk: --stage is paper, small or auto", 2);
      const order: Record<Risk["stage"], number> = { paper: 0, small: 1, auto: 2 };
      if (order[stage] > order[current.stage]) {
        const up = canAdvance(current, localRecord(state), now);
        if (!up.ok || up.to !== stage) return fail(`gemworks connect risk: 不能升到${STAGE_WORDS[stage]}：${up.ok ? `先到${STAGE_WORDS[up.to]}` : up.why}`, 1);
      }
      body["stage"] = stage;
      if (stage !== current.stage) body["stageSince"] = now;
    }
    const markets = flag(args, "--markets"); if (markets !== undefined) body["markets"] = markets.split(",").map((x) => x.trim()).filter((x) => x !== "");
    for (const [f, k] of [["--per-order", "perOrder"], ["--per-day", "perDay"], ["--max-positions", "maxPositions"], ["--slippage", "maxSlippage"], ["--cooldown", "cooldownMinutes"], ["--min-confidence", "minConfidence"], ["--ask-above", "askAbove"]] as const) { const v = flag(args, f); if (v !== undefined) { if (!/^\d+(\.\d+)?$/.test(v)) fail(`gemworks connect risk: ${f} is a number`, 2); body[k] = Number(v); } }
    const stop: Record<string, number> = {};
    for (const [f, k] of [["--stop-drawdown", "drawdown"], ["--stop-losses", "losses"]] as const) { const v = flag(args, f); if (v !== undefined) { if (!/^\d+(\.\d+)?$/.test(v)) fail(`gemworks connect risk: ${f} is a number`, 2); stop[k] = Number(v); } }
    if (Object.keys(stop).length > 0) body["stop"] = stop;
    const connector = flag(args, "--connector"); if (connector !== undefined) body["connector"] = connector;
    if (has(args, "--no-connector")) body["connector"] = null;
    if (has(args, "--agent-reads")) body["agentReads"] = true;
    if (has(args, "--no-agent-reads")) body["agentReads"] = false;
    if (has(args, "--unmute")) body["muted"] = false;
    const next = riskOf(body, current);
    writeRisk(home, owner, id, next);
    for (const l of stageLines(next, localRecord(state), now)) console.log(l);
    return 0;
  } catch (e) { return fail(`gemworks connect ${sub}: ${e instanceof Error ? e.message : String(e)}`, 1); }
}

```

(`signalFaults` and `signalInput` join the signal import: `import { performanceLine, signalFaults, signalInput, signalText, type Performance, type Signal } from "./core/im/signal.js";`.)

In `runConnect`, after `  if (sub === "declare" || sub === "profile") return runDeclare(home, sub, args);`:

```ts
  if (sub === "channel" || sub === "signal" || sub === "risk") return runSignals(home, sub, args);
```

- [ ] **Step 4: Build and run**

```bash
npm run build 2>&1 | tail -2 && node --test test/signal-cli.test.mjs test/card-cli.test.mjs test/declare-cli.test.mjs test/cli.test.mjs test/daemon-cli.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
```
Expected: `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts test/signal-cli.test.mjs
git commit -m "CLI: connect channel, signal and risk; relay price"
```

---

### Task 7: Gates and the version

- [ ] **Step 1: The four gates, each its own command**

```bash
npm run build
claude plugin validate .
claude plugin test .
node --test --test-concurrency=2 test/*.test.mjs
```
Expected: build clean; validate ok; `claude plugin test` with only the machine's pane failures (and at times the harness's `the file ran to its end`), the new `im_signal` test passing; the node suites `ℹ fail 0`, `ℹ pass` 959 + 3 + 4 + 4 + 4 + 1 + 1 + 1 = 977.

- [ ] **Step 2: The version and the merge**

```bash
node scripts/bump.mjs 0.3.5
git add -A && git commit -m "gemsbang 0.3.5: signals, subscription channels, the fixed rule's performance, the local execution module (§10)"
git switch main && git merge --ff-only im/l-signals && git branch -d im/l-signals
```

---

## Self-review

- **Spec coverage:** §10.1 the fixed fields ✓ (`signalFaults`), data never a prompt ✓ (the relay writes the message itself; delivery skips signals and channels; the module is the host's); §10.2 the host's own chain first ✓ (`publishSignal` under the home), the relay's second stamp ✓ (`received`), the retraction kept and marked ✓; §10.3 the one fixed public rule ✓ (`RULE_WORDS` on every performance), the price series with hashes ✓ (`_relay/prices/*.geml` sealed blocks), the page always with the rule ✓; §10.4 by the month or by the signal ✓, the channel's row with the stage and today's count ✓, the head with the price and the stage ✓, the publisher seeing the count only ✓ (no system message on a subscription; `subscribers` a number), the signal card ✓ with both times and the module's line ✓, the four numbers ✓ with the rule ✓; §10.5 the host runs it ✓, the risk file's fields ✓ (every one), the three stages ✓ with the days and the hit rate as evidence and the owner's `connect risk --stage` as the approval ✓, the ask card's words and three buttons ✓, 全停 muting the asks and dropping to 纸面 ✓, any error or stop-loss → 纸面 + 卡住 ✓, the agent reading the thesis and objecting ✓ (`agentReads`, `im_signal skip`), never widening the file ✓ (the agent has no op on the file), the stage card ✓, the footer ✓; §10.6 the disclaimer at the subscription ✓; the regional check is the operator's, as the spec says.
- **Placeholders:** none.
- **Type consistency:** `Signal`/`Performance`/`PricePoint` from `signal.ts` in the relay, the daemon, the bridge and the CLI; `Risk`/`ExecState`/`PendingAsk` (with `market`, `side`, `cap`) from `risk.ts` in `exec.ts` and the CLI; `ChannelPrice`/`priceWords` from `venue.ts`; `Connector`/`ExecTools` from `exec.ts` in `sync.ts`; the `im-signal` op in the protocol, the bridge, the hooks module; `Thread.channel` and `ThreadMessage.signal` from `view.ts` in `im.ts`.
