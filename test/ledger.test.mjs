import { test } from "node:test";
import assert from "node:assert/strict";
import { balanceOf, capsOf, DEFAULT_CAPS, entryLine, foldLedger, FREE_CREDITS, GUEST_QUESTION_CREDITS, holdOf, KIND_WORDS, usedToday, walletLines } from "../dist/core/im/ledger.js";

const NOW = "2026-10-31T09:30:00Z";
const BLOCKS = [
  { id: "entry-1", value: { id: "entry-1", kind: "topup", from: "platform", to: "person:john", amount: 100, note: "免费额度", at: "2026-10-30T08:00:00Z", tx: "a1", prev: null, hash: "h1" } },
  { id: "entry-2", value: { id: "entry-2", kind: "escrow", from: "person:john", to: "hold:card/t-42", amount: 40, note: "发布时托管", at: "2026-10-31T08:00:00Z", tx: "a2", ref: "https://relay.test/john/cards/t-42.geml", card: "t-42", prev: "h1", hash: "h2" } },
  { id: "entry-3", value: { id: "entry-3", kind: "tip", from: "person:zhangsan", to: "person:john", amount: 5, note: "「那个缓存修得漂亮」", at: "2026-10-31T09:00:00Z", tx: "a3", agent: "xiaoping", prev: "h2", hash: "h3" } },
  { id: "entry-4", value: { id: "entry-4", kind: "spend", from: "person:john", to: "platform", amount: 1, note: "访客问答", at: "2026-10-31T09:10:00Z", tx: "a4", agent: "xiaoping", cap: "guest", prev: "h3", hash: "h4" } },
  { id: "entry-5", value: { id: "entry-5", kind: "spend", from: "person:john", to: "platform", amount: 3, note: "买了 skill pdf-export", at: "2026-10-31T09:20:00Z", tx: "a5", agent: "xiaoping", cap: "auto", card: "t-42", prev: "h4", hash: "h5" } },
  { id: "entry-6", value: { id: "entry-6", kind: "favor", from: "person:lisi", to: "person:john", amount: 0, note: "帮跑了一次，约 30 万 token", at: "2026-10-31T09:25:00Z", tx: "a6", prev: "h5", hash: "h6" } },
  { id: "entry-7", value: { id: "entry-7", kind: "spend", from: "person:john", to: "platform", amount: 2, note: "昨天的", at: "2026-10-30T09:25:00Z", tx: "a7", agent: "xiaoping", cap: "guest", prev: "h6", hash: "h7" } },
  { id: "junk", value: { x: 1 } },
  { id: "entry-9", value: { id: "entry-9", kind: "nope", from: "a", to: "b", amount: 1, at: NOW } },
];

test("foldLedger: the entries in order, a block of another id or an unknown kind left out; the balance from my side; the favours move nothing", () => {
  const entries = foldLedger(BLOCKS);
  assert.deepEqual(entries.map((e) => [e.n, e.kind, e.amount]), [[1, "topup", 100], [2, "escrow", 40], [3, "tip", 5], [4, "spend", 1], [5, "spend", 3], [6, "favor", 0], [7, "spend", 2]]);
  assert.deepEqual([entries[1].ref, entries[4].card, entries[4].cap, entries[2].agent], ["https://relay.test/john/cards/t-42.geml", "t-42", "auto", "xiaoping"]);
  assert.equal(balanceOf(entries, "person:john"), 100 - 40 + 5 - 1 - 3 - 2);
  assert.equal(balanceOf(entries, "hold:card/t-42"), 40);
  assert.equal(balanceOf(entries, "person:zhangsan"), -5, "the other side, as this ledger saw it");
  assert.equal(balanceOf([], "person:john"), 0);
});

test("usedToday: a day's spend per cap, per agent and per card; yesterday's does not count", () => {
  const entries = foldLedger(BLOCKS);
  assert.deepEqual(usedToday(entries, NOW), { agents: { xiaoping: 4 }, cards: { "t-42": 43 }, guest: 1, auto: 3 });
  assert.deepEqual(usedToday(entries, "2026-11-01T00:00:00Z"), { agents: {}, cards: {}, guest: 0, auto: 0 });
});

test("the caps: the defaults, a body's positive integers, the rest kept; the hold's address", () => {
  assert.deepEqual(DEFAULT_CAPS, { agentPerDay: 30, perCard: 40, guestPerDay: 10, autoBuy: 5 });
  assert.deepEqual(capsOf({ agentPerDay: 50, perCard: "x", guestPerDay: -1, autoBuy: 0 }), { agentPerDay: 50, perCard: 40, guestPerDay: 10, autoBuy: 0 }, "zero is a cap too");
  assert.deepEqual(capsOf(undefined), DEFAULT_CAPS);
  assert.equal(holdOf("card", "john/t-42"), "hold:card/john/t-42");
  assert.deepEqual([FREE_CREDITS, GUEST_QUESTION_CREDITS], [20, 1]);
});

test("entryLine: time, kind · who to whom · the note, the amount signed from my side, 不转积分 for a favour; walletLines: the balance and the four caps with today's use", () => {
  const entries = foldLedger(BLOCKS);
  assert.equal(entryLine(entries[1], "person:john", (at) => at.slice(11, 16)), "08:00 托管 · john 给 #t-42 · 发布时托管 | −40");
  assert.equal(entryLine(entries[2], "person:john", (at) => at.slice(11, 16)), "09:00 打赏 · zhangsan 给 xiaoping · 「那个缓存修得漂亮」 | +5");
  assert.equal(entryLine(entries[3], "person:john", (at) => at.slice(11, 16)), "09:10 消耗 · xiaoping 给 平台 · 访客问答 | −1");
  assert.equal(entryLine(entries[5], "person:john", (at) => at.slice(11, 16)), "09:25 人情 · lisi 给 john · 帮跑了一次，约 30 万 token | 不转积分");
  assert.equal(entryLine(entries[0], "person:john", (at) => at.slice(11, 16)), "08:00 充值 · 平台 给 john · 免费额度 | +100");
  assert.deepEqual(KIND_WORDS.settle, "结算");
  assert.equal(KIND_WORDS.subscribe, "订阅");
  assert.deepEqual(walletLines({ balance: 86, caps: DEFAULT_CAPS, used: usedToday(entries, NOW), agents: ["xiaoping"] }), ["钱包 86 积分", "xiaoping 每天 30 · 已用 4", "每张卡 40", "访客问答每天 10 · 已用 1", "自动买东西 5 · 已用 3 · 超过要问我"]);
  assert.deepEqual(walletLines({ balance: 0, caps: DEFAULT_CAPS, used: usedToday([], NOW), agents: [] }), ["钱包 0 积分", "每张卡 40", "访客问答每天 10", "自动买东西 5 · 超过要问我"]);
});
