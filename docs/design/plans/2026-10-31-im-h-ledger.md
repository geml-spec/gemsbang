# IM Plan H: The Ledger and Credits

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Spec §9.1: one kind of credit, the wallet a person's (never an agent's), an append-only hash-chained ledger per person written only by the relay; the four caps the owner sets and the relay enforces, with what each used today; a card's reward held at publish, settled at accept, refunded at close, split by arbitration in a dispute; a guest's question paid by the owner; gifts (claimed with an account), red packets into a venue by shares that return after a day, tips with a line, favours that move no credits; an agent over a cap can only ask the owner for 放行 through the inbox; v1 cashes nothing out.

**Architecture:** `src/core/im/ledger.ts` (pure) names the entry kinds, folds a ledger document into entries, sums a balance and a day's use per cap, and draws the one-line entry and the wallet's four lines. The relay keeps `ledger/<person>.geml` (owner-only by the reading rule, as any document with no members and no public mark) and appends an entry to each party's ledger for every transfer, the two sharing a `tx`; a hold (a card's escrow, a gift, a packet) is an account of its own, `hold:<kind>/<id>`, whose balance is what it still owes. The card verbs charge and pay through one private `transfer`; caps are blocks on the person's page like the guest quota; an ask for more is a block on the owner's page that the inbox shows as 放行 and the owner answers with an allowance for the day. The daemon follows the ledger, the status view adds a wallet, the board a 钱包 section, the CLI `connect wallet …` and `relay topup`.

**Tech Stack:** TypeScript (`src/core` pure, `src/relay`, `src/daemon`, `src/bridge.ts`, `src/hosts/claude-code` pure), `node:test` over `dist/`, `claude plugin test` for the hooks.

**Before this plan:** plans A–G are on `main` (0.3.0, `f0ee3b5`).

---

## File structure

| File | Responsibility |
|---|---|
| `src/core/im/ledger.ts` (new) | Entry kinds and words; `foldLedger`, `balanceOf`, `usedToday`, `entryLine`, `walletLines`; the caps and their parse; the credit constants. |
| `src/relay/relay.ts` | `ledgerOf`, `walletOf`, `topUp`, `setCaps`, `spend`, `askCredits`, `allowCredits`, `tip`, `favor`, `gift`/`claimGift`, `packet`/`claimPacket`; the hold on publish, the settlement on accept, the refund on close, the split on settle; the guest question charged; the packet sweep in `tick`; the 放行 need for an ask. |
| `src/relay/api.ts` | `/wallet`, `/wallet/caps`, `/wallet/spend`, `/wallet/ask`, `/wallet/allow`, `/wallet/tip`, `/wallet/favor`, `/wallet/gift`, `/wallet/packet`, `/g/<id>`, `/g/<id>/claim`, `/r/<id>/claim`. |
| `src/cli.ts` | `relay topup <person> <credits> [--note]`; `connect wallet [show|caps|tip|favor|gift|packet|claim]`. |
| `src/daemon/home.ts`, `src/daemon/sync.ts`, `src/daemon/deliver.ts`, `src/daemon/view.ts` | The ledger followed; the outbox kind `allow`; `answerAllow`; `walletView` and `ImStatus.wallet`. |
| `src/bridge.ts` | A credit ask's 放行 answered. |
| `src/hosts/claude-code/im.ts`, `text.ts` | The 钱包 section on the 消息 page. |
| Tests | `test/ledger.test.mjs`, `test/relay-wallet.test.mjs`, `test/wallet-cli.test.mjs` new; `test/relay-task.test.mjs`, `test/relay-share.test.mjs`, `test/daemon-card.test.mjs`, `test/daemon-cards.test.mjs`, `test/card-cli.test.mjs`, `test/daemon-view.test.mjs`, `test/im-host.test.mjs`, `test/relay-cli.test.mjs` learn the wallet. |

---

### Task 1: Branch and baseline

- [ ] **Step 1: Branch from main**

```bash
git switch -c im/h-ledger
git log --oneline -1
```
Expected: `f0ee3b5 gemsbang 0.3.0: the IM for people and their agents` (or later on main).

- [ ] **Step 2: Baseline**

```bash
node --test --test-concurrency=2 test/*.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
```
Expected: `ℹ pass 920`, `ℹ fail 0`.

---

### Task 2: The pure ledger

**Files:**
- Create: `src/core/im/ledger.ts`
- Test: `test/ledger.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// test/ledger.test.mjs
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
  assert.deepEqual(walletLines({ balance: 86, caps: DEFAULT_CAPS, used: usedToday(entries, NOW), agents: ["xiaoping"] }), ["钱包 86 积分", "xiaoping 每天 30 · 已用 4", "每张卡 40", "访客问答每天 10 · 已用 1", "自动买东西 5 · 已用 3 · 超过要问我"]);
  assert.deepEqual(walletLines({ balance: 0, caps: DEFAULT_CAPS, used: usedToday([], NOW), agents: [] }), ["钱包 0 积分", "每张卡 40", "访客问答每天 10", "自动买东西 5 · 超过要问我"]);
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
npm run build >/dev/null 2>&1; node --test test/ledger.test.mjs 2>&1 | tail -3
```
Expected: fails with `Cannot find module '…/dist/core/im/ledger.js'`.

- [ ] **Step 3: Write `src/core/im/ledger.ts`**

```ts
// The ledger (§9.1): one kind of credit; a person's wallet, never an agent's;
// an append-only hash chain per person the relay alone writes, an entry per
// movement with the other side's named; a hold (a card's escrow, a gift, a
// packet) an account of its own; four caps the owner sets, the relay keeps
// and the wallet page shows with today's use. Pure: blocks in, entries,
// sums and lines out. v1 cashes nothing out.

export type EntryKind = "topup" | "gift" | "packet" | "tip" | "escrow" | "settle" | "refund" | "fee" | "spend" | "favor";
export const KIND_WORDS: Readonly<Record<EntryKind, string>> = { topup: "充值", gift: "赠送", packet: "红包", tip: "打赏", escrow: "托管", settle: "结算", refund: "退款", fee: "平台抽成", spend: "消耗", favor: "人情" };
const KINDS = new Set<string>(Object.keys(KIND_WORDS));

/** What an agent's spend counts against (§9.1): its day, a card, the guests' questions, buying on its own. */
export type CapKey = "agent" | "card" | "guest" | "auto";
export interface Caps { agentPerDay: number; perCard: number; guestPerDay: number; autoBuy: number }
export const DEFAULT_CAPS: Caps = { agentPerDay: 30, perCard: 40, guestPerDay: 10, autoBuy: 5 };
/** What a new person's wallet opens with (transport §7.2: 先免费额度，再积分). */
export const FREE_CREDITS = 20;
/** What one guest question costs its owner (the inference, in the platform's one unit). */
export const GUEST_QUESTION_CREDITS = 1;
/** A red packet's shares return to the giver after this long (§9.1). */
export const PACKET_HOURS = 24;
/** An account the platform itself holds: top-ups come from it, spends go to it, the fee too. */
export const PLATFORM = "platform";

export interface Entry {
  n: number;
  kind: EntryKind;
  from: string;
  to: string;
  amount: number;
  note: string;
  at: string;
  /** The same movement in the other party's ledger carries the same tx. */
  tx: string;
  /** A card's, a packet's or an arbitration's address. */
  ref?: string;
  /** The agent that spent or was tipped, by name. */
  agent?: string;
  cap?: CapKey;
  card?: string;
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const obj = (v: unknown): Record<string, unknown> | undefined => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);
const CAP_KEYS = new Set<string>(["agent", "card", "guest", "auto"]);

/** The hold account of a thing: `hold:<kind>/<id>`. */
export const holdOf = (kind: "card" | "gift" | "packet", id: string): string => `hold:${kind}/${id}`;

/** The caps from a body or a block: a non-negative integer each, else the default (zero is a cap: nothing allowed). */
export function capsOf(v: unknown): Caps {
  const o = obj(v) ?? {};
  const n = (k: keyof Caps): number => { const x = o[k]; return Number.isInteger(x) && (x as number) >= 0 ? (x as number) : DEFAULT_CAPS[k]; };
  return { agentPerDay: n("agentPerDay"), perCard: n("perCard"), guestPerDay: n("guestPerDay"), autoBuy: n("autoBuy") };
}

/** The ledger's entries in order: the `entry-N` blocks of a known kind. */
export function foldLedger(blocks: readonly { id: string; value: Record<string, unknown> }[]): Entry[] {
  const out: Entry[] = [];
  for (const b of blocks) {
    const m = /^entry-(\d+)$/.exec(b.id);
    const kind = str(b.value["kind"]);
    if (m === null || kind === undefined || !KINDS.has(kind)) continue;
    const amount = b.value["amount"];
    const e: Entry = { n: Number(m[1]), kind: kind as EntryKind, from: str(b.value["from"]) ?? "", to: str(b.value["to"]) ?? "", amount: typeof amount === "number" && Number.isFinite(amount) ? amount : 0, note: str(b.value["note"]) ?? "", at: str(b.value["at"]) ?? "", tx: str(b.value["tx"]) ?? "" };
    const ref = str(b.value["ref"]); if (ref !== undefined) e.ref = ref;
    const agent = str(b.value["agent"]); if (agent !== undefined) e.agent = agent;
    const cap = str(b.value["cap"]); if (cap !== undefined && CAP_KEYS.has(cap)) e.cap = cap as CapKey;
    const card = str(b.value["card"]); if (card !== undefined) e.card = card;
    out.push(e);
  }
  return out;
}

/** An account's balance as these entries saw it: what came to it less what left it; a favour moves nothing. */
export function balanceOf(entries: readonly Entry[], account: string): number {
  let n = 0;
  for (const e of entries) {
    if (e.kind === "favor") continue;
    if (e.to === account) n += e.amount;
    if (e.from === account) n -= e.amount;
  }
  return n;
}

export interface Used { agents: Record<string, number>; cards: Record<string, number>; guest: number; auto: number }
const sameDay = (a: string, b: string): boolean => a.slice(0, 10) === b.slice(0, 10);

/** Today's use against each cap: what each agent spent, what each card took (its escrow and its spends), the guests' questions, the buying. */
export function usedToday(entries: readonly Entry[], now: string): Used {
  const out: Used = { agents: {}, cards: {}, guest: 0, auto: 0 };
  for (const e of entries) {
    if (!sameDay(e.at, now)) continue;
    if (e.kind === "spend") {
      if (e.agent !== undefined) out.agents[e.agent] = (out.agents[e.agent] ?? 0) + e.amount;
      if (e.cap === "guest") out.guest += e.amount;
      if (e.cap === "auto") out.auto += e.amount;
    }
    if ((e.kind === "spend" || e.kind === "escrow") && e.card !== undefined) out.cards[e.card] = (out.cards[e.card] ?? 0) + e.amount;
  }
  return out;
}

/** An account as a line names it: a person by id, an agent by name, the platform, a card's hold by the card, a gift's or a packet's by what it is. */
export function accountName(account: string): string {
  if (account === PLATFORM) return "平台";
  if (account.startsWith("person:")) return account.slice("person:".length);
  if (account.startsWith("agent:")) return account.slice("agent:".length).replace(/@.*$/, "");
  const hold = /^hold:(card|gift|packet)\/(?:[^/]+\/)?([^/]+)$/.exec(account);
  if (hold !== null) return hold[1] === "card" ? `#${hold[2]}` : hold[1] === "gift" ? "礼物" : "红包";
  return account;
}

/** One ledger line (§9.1): time, kind · who to whom · the note, the amount signed from `me`'s side; a favour says 不转积分. An agent named on the entry stands for its side: the one that spent, or the one tipped or paid. */
export function entryLine(e: Entry, me: string, clock: (at: string) => string): string {
  const from = e.kind === "spend" && e.agent !== undefined ? e.agent : accountName(e.from);
  const to = e.kind !== "spend" && e.agent !== undefined ? e.agent : accountName(e.to);
  const amount = e.kind === "favor" ? "不转积分" : e.to === me ? `+${e.amount}` : e.from === me ? `−${e.amount}` : String(e.amount);
  return `${clock(e.at)} ${KIND_WORDS[e.kind]} · ${from} 给 ${to} · ${e.note} | ${amount}`;
}

export interface WalletSummary { balance: number; caps: Caps; used: Used; agents: readonly string[] }

/** The wallet page's head (§9.1): the balance, then the four caps, each with today's use when any. */
export function walletLines(w: WalletSummary): string[] {
  const used = (n: number): string => (n > 0 ? ` · 已用 ${n}` : "");
  return [
    `钱包 ${w.balance} 积分`,
    ...w.agents.map((a) => `${a} 每天 ${w.caps.agentPerDay}${used(w.used.agents[a] ?? 0)}`),
    `每张卡 ${w.caps.perCard}`,
    `访客问答每天 ${w.caps.guestPerDay}${used(w.used.guest)}`,
    `自动买东西 ${w.caps.autoBuy}${used(w.used.auto)} · 超过要问我`,
  ];
}
```

- [ ] **Step 4: Build and run the test**

```bash
npm run build 2>&1 | tail -2 && node --test test/ledger.test.mjs test/purity.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
```
Expected: `ℹ fail 0`. (`test/purity.test.mjs` is the `src/core` purity suite; the module imports nothing.)

- [ ] **Step 5: Commit**

```bash
git add src/core/im/ledger.ts test/ledger.test.mjs
git commit -m "IM core: the ledger's entries, balances, today's use, caps and lines"
```

---

### Task 3: The relay: the ledger, the wallet, the card's money, the guest's question, gifts and packets; the API

**Files:**
- Modify: `src/relay/relay.ts`, `src/relay/api.ts`
- Modify: `test/relay-task.test.mjs` (the worlds top up; the settlement notes; `tick`'s shape)
- Test: `test/relay-wallet.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// test/relay-wallet.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { route } from "../dist/relay/api.js";
import { Relay } from "../dist/relay/relay.js";
import { balanceOf, holdOf } from "../dist/core/im/ledger.js";

const BASE = Date.UTC(2026, 9, 31, 9, 0, 0);
/** A relay whose clock starts at 09:00 and moves a second per look; `advance` moves it further. */
function relay(extra = {}) {
  let offset = 0;
  const now = () => { const t = new Date(BASE + offset).toISOString().replace(/\.\d{3}Z$/, "Z"); offset += 1000; return t; };
  const r = new Relay({ root: mkdtempSync(join(tmpdir(), "gemworks-relay-")), name: "relay.test", version: "0.0.0", now, ...extra });
  r.advance = (ms) => { offset += ms; };
  return r;
}
function call(r, line, { token, body, ip } = {}) {
  const [method, path] = line.split(" ");
  const res = route({ method, path, query: {}, ...(token !== undefined ? { token } : {}), ...(body !== undefined ? { body } : {}), ...(ip !== undefined ? { ip } : {}) }, r);
  return { status: res.status, json: res.type.startsWith("application/json") ? JSON.parse(res.body) : undefined, text: res.body };
}
const INPUT = { title: "给设置页加导出 PDF", goal: "设置页右上角一个按钮，把当前配置导出成 PDF", context: { includes: [], excludes: ["private"] }, accepts: [{ text: "单元测试通过", verify: { kind: "command", run: "npm test" } }, { text: "导出的文件能打开", verify: { kind: "file", glob: "out/*.pdf" } }], direction: "outsource", venueOfWork: "worker-sandbox", tools: ["read", "edit", "test"], budget: { credits: 40, hours: 6 }, reward: { kind: "escrow", credits: 40 } };
const DELIVERABLE = { kind: "code", sha256: "7f3a", parts: [{ type: "repo", url: "u", branch: "deliver/t-42", commit: "a1b2c3" }], usage: "npm run build", evidence: [], accepts: [{ criterion: 1, met: true }, { criterion: 2, met: true }], rights: { owner: "委托方", aiGenerated: true } };
const CARD = { title: "设置页导出 PDF，能跑的", summary: "今天把设置页的缓存写路径修好了。", summarySource: "self", agent: "xiaoping", turns: 63, scope: "src/settings/*", evidence: [], use: {} };
const last = (r, person) => { const e = r.ledgerOf(person).at(-1); return [e.kind, e.from, e.to, e.amount, e.note]; };

/** John (agent 小评), 王五 (agent 小测, an API session) and 李四 in a group g-7. Nobody topped up: each has the free allowance. */
function world(extra = {}) {
  const r = relay(extra);
  const john = r.issuePerson("john"), wangwu = r.issuePerson("wangwu"), lisi = r.issuePerson("lisi");
  const xiaoping = r.issueAgent(john.record, "xiaoping"), xiaoce = r.issueAgent(wangwu.record, "xiaoce");
  r.createVenue(john.record, { id: "g-7", kind: "group", name: "前端周会", people: ["wangwu", "lisi"], agents: ["agent:xiaoping@john", "agent:xiaoce@wangwu"] });
  r.setPresence(xiaoce.record, { session: "cx-1", host: "claude-code", login: "api", presence: "idle" });
  return { r, john, wangwu, lisi, xiaoping, xiaoce };
}

test("the ledger (§9.1): a new person's free allowance, none on a relay that gives none; the operator's top-up; the wallet with its caps, today's use and its lines; the ledger is the owner's alone; the caps set one at a time", () => {
  const { r, john, wangwu, xiaoping } = world();
  assert.equal(r.balance("john"), 20);
  assert.deepEqual(r.ledgerOf("john").map((e) => [e.n, e.kind, e.from, e.to, e.amount, e.note]), [[1, "topup", "platform", "person:john", 20, "免费额度"]]);
  const bare = relay({ freeCredits: 0 });
  bare.issuePerson("zhao");
  assert.deepEqual([bare.balance("zhao"), bare.ledgerOf("zhao")], [0, []]);
  assert.deepEqual(r.topUp("nobody", 5), { ok: false, status: 404, reason: "没有这个人" });
  assert.equal(r.topUp("john", 0).reason, "积分是正整数");
  assert.deepEqual(r.topUp("john", 80, "充了 80"), { ok: true, balance: 100 });
  const w = call(r, "GET /wallet", { token: john.token });
  assert.equal(w.status, 200, w.text);
  assert.deepEqual([w.json.balance, w.json.caps, w.json.used, w.json.agents, w.json.lines], [100, { agentPerDay: 30, perCard: 40, guestPerDay: 10, autoBuy: 5 }, { agents: {}, cards: {}, guest: 0, auto: 0 }, ["xiaoping"], ["钱包 100 积分", "xiaoping 每天 30", "每张卡 40", "访客问答每天 10", "自动买东西 5 · 超过要问我"]]);
  assert.deepEqual(w.json.recent, ["09:00 充值 · 平台 给 john · 充了 80 | +80", "09:00 充值 · 平台 给 john · 免费额度 | +20"]);
  assert.equal(call(r, "GET /wallet", { token: xiaoping.token }).status, 403);
  assert.equal(call(r, "GET /john/ledger/john.geml", { token: wangwu.token }).status, 403, "the ledger is the owner's alone");
  assert.equal(call(r, "GET /john/ledger/john.geml", { token: john.token }).json.blocks.length, 2);
  assert.deepEqual(call(r, "POST /wallet/caps", { token: john.token, body: { perCard: 60, autoBuy: 0, guestPerDay: -3 } }).json.caps, { agentPerDay: 30, perCard: 60, guestPerDay: 10, autoBuy: 0 }, "zero is a cap; a bad number is ignored");
  assert.deepEqual(call(r, "POST /wallet/caps", { token: john.token, body: { agentPerDay: 12 } }).json.caps, { agentPerDay: 12, perCard: 60, guestPerDay: 10, autoBuy: 0 }, "the others kept");
  assert.equal(call(r, "POST /wallet/caps", { token: xiaoping.token, body: {} }).status, 403);
  assert.equal(call(r, "POST /wallet/nope", { token: john.token, body: {} }).status, 404);
  assert.equal(call(r, "GET /wallet/caps", { token: john.token }).status, 405);
});

test("a card's money (§9.1): publish holds the reward within the per-card cap and the balance; accept settles it to the worker's owner; a close refunds; a dispute splits by arbitration; a contest pays the prize and the participation; a fee when the relay takes one", () => {
  const { r, john, wangwu, xiaoping, xiaoce } = world();
  const id = call(r, "POST /tasks", { token: john.token, body: INPUT }).json.card.id;
  const publish = (card, token = john.token) => call(r, `POST /tasks/john/${card}/publish`, { token, body: { venue: "john/g-7" } });
  assert.equal(publish(id).json.error, "积分不够：钱包 20，要托管 40");
  r.topUp("john", 100);
  call(r, "POST /wallet/caps", { token: john.token, body: { perCard: 30 } });
  assert.equal(publish(id).json.error, "超过每张卡的额度 30（要托管 40）");
  call(r, "POST /wallet/caps", { token: john.token, body: { perCard: 40 } });
  assert.equal(publish(id).json.card.state, "open");
  assert.equal(r.balance("john"), 80);
  const hold = holdOf("card", `john/${id}`);
  const escrow = r.ledgerOf("john").at(-1);
  assert.deepEqual([escrow.kind, escrow.from, escrow.to, escrow.amount, escrow.note, escrow.card, escrow.ref], ["escrow", "person:john", hold, 40, "发布时托管", id, `https://relay.test/john/cards/${id}.geml`]);
  assert.equal(balanceOf(r.ledgerOf("john"), hold), 40);
  assert.equal(r.taskOf("john", id).transitions.length, 1, "the state moved once: a draft starts with no transition");
  call(r, `POST /tasks/john/${id}/claim`, { token: xiaoce.token });
  call(r, `POST /tasks/john/${id}/deliver`, { token: xiaoce.token, body: DELIVERABLE });
  const won = call(r, `POST /tasks/john/${id}/report`, { token: xiaoping.token, body: { results: [{ criterion: 1, met: true }, { criterion: 2, met: true }] } });
  assert.deepEqual([won.json.decision, won.json.card.transitions.at(-1).note], ["accepted", "结算 40 积分（托管）"]);
  assert.deepEqual([r.balance("wangwu"), r.balance("john"), balanceOf(r.ledgerOf("john"), hold)], [60, 80, 0]);
  assert.deepEqual(last(r, "wangwu"), ["settle", hold, "person:wangwu", 40, "验收过"]);
  assert.deepEqual(last(r, "john"), ["settle", hold, "person:wangwu", 40, "验收过"], "the hold's owner keeps its movements too");
  assert.equal(r.ledgerOf("wangwu").at(-1).tx, r.ledgerOf("john").at(-1).tx, "one movement, one tx");
  assert.equal(r.walletOf("wangwu").recent[0], `09:00 结算 · #${id} 给 xiaoce · 验收过 | +40`);
  assert.equal(r.walletOf("john").recent[0], `09:00 结算 · #${id} 给 xiaoce · 验收过 | 40`, "not the delegator's own money any more: unsigned");
  assert.deepEqual(r.walletOf("john").used.cards, { [id]: 40 });
  // a close refunds
  const id2 = call(r, "POST /tasks", { token: john.token, body: INPUT }).json.card.id;
  publish(id2);
  assert.equal(r.balance("john"), 40);
  assert.equal(call(r, `POST /tasks/john/${id2}/close`, { token: john.token, body: { reason: "算了" } }).json.card.state, "closed");
  assert.deepEqual([r.balance("john"), last(r, "john"), balanceOf(r.ledgerOf("john"), holdOf("card", `john/${id2}`))], [80, ["refund", holdOf("card", `john/${id2}`), "person:john", 40, "关闭"], 0]);
  // a dispute split by arbitration
  const id3 = call(r, "POST /tasks", { token: john.token, body: INPUT }).json.card.id;
  publish(id3);
  call(r, `POST /tasks/john/${id3}/claim`, { token: xiaoce.token });
  call(r, `POST /tasks/john/${id3}/deliver`, { token: xiaoce.token, body: DELIVERABLE });
  call(r, `POST /tasks/john/${id3}/dispute`, { token: wangwu.token, body: { reason: "重跑环境不对" } });
  assert.equal(call(r, `POST /tasks/john/${id3}/settle`, { token: john.token, body: { outcome: "accepted", workerShare: -1 } }).json.error, "workerShare 是非负整数");
  const settled = call(r, `POST /tasks/john/${id3}/settle`, { token: john.token, body: { outcome: "accepted", workerShare: 25, arbitration: "https://relay.test/_relay/arbitration/a-1.geml" } });
  assert.equal(settled.json.card.state, "accepted", settled.text);
  assert.deepEqual([r.balance("wangwu"), r.balance("john")], [85, 55]);
  const split = r.ledgerOf("john").slice(-2);
  assert.deepEqual(split.map((e) => [e.kind, e.to, e.amount, e.note, e.ref]), [["settle", "person:wangwu", 25, "仲裁", "https://relay.test/_relay/arbitration/a-1.geml"], ["refund", "person:john", 15, "仲裁", "https://relay.test/_relay/arbitration/a-1.geml"]]);
  // a contest: the prize to the winner's owner, the participation to the other seated slot's owner
  const zhao = r.issuePerson("zhao"), xiaoma = r.issueAgent(zhao.record, "xiaoma");
  r.addMember(john.record, "john", "g-7", "zhao"); r.addMember(john.record, "john", "g-7", "agent:xiaoma@zhao");
  r.setPresence(xiaoma.record, { session: "cm-1", host: "pi", login: "self-hosted", presence: "idle" });
  const c = call(r, "POST /tasks", { token: john.token, body: { ...INPUT, mode: { kind: "contest", slots: 2 }, reward: { kind: "prize", credits: 30, participation: 2 } } }).json.card.id;
  publish(c);
  assert.deepEqual([r.balance("john"), balanceOf(r.ledgerOf("john"), holdOf("card", `john/${c}`))], [23, 32], "the prize and one participation held");
  call(r, `POST /tasks/john/${c}/claim`, { token: xiaoce.token });
  call(r, `POST /tasks/john/${c}/claim`, { token: xiaoma.token });
  call(r, `POST /tasks/john/${c}/deliver`, { token: xiaoce.token, body: DELIVERABLE });
  const prize = call(r, `POST /tasks/john/${c}/report`, { token: xiaoping.token, body: { results: [{ criterion: 1, met: true }, { criterion: 2, met: true }] } });
  assert.deepEqual([prize.json.decision, prize.json.card.transitions.at(-1).note], ["accepted", "结算 30 积分（奖金）· 参与补偿 2"]);
  assert.deepEqual([r.balance("wangwu"), r.balance("zhao"), r.balance("john"), balanceOf(r.ledgerOf("john"), holdOf("card", `john/${c}`))], [115, 22, 23, 0]);
  assert.deepEqual(last(r, "zhao"), ["settle", holdOf("card", `john/${c}`), "person:zhao", 2, "参与补偿"]);
  // a fee
  const f = world({ feePercent: 10 });
  f.r.topUp("john", 100);
  const fid = call(f.r, "POST /tasks", { token: f.john.token, body: INPUT }).json.card.id;
  call(f.r, `POST /tasks/john/${fid}/publish`, { token: f.john.token, body: { venue: "john/g-7" } });
  call(f.r, `POST /tasks/john/${fid}/claim`, { token: f.xiaoce.token });
  call(f.r, `POST /tasks/john/${fid}/deliver`, { token: f.xiaoce.token, body: DELIVERABLE });
  assert.equal(call(f.r, `POST /tasks/john/${fid}/accept`, { token: f.john.token }).json.card.state, "accepted", "the delegator may accept from 验收中 without a report");
  assert.deepEqual([f.r.balance("wangwu"), last(f.r, "john")], [56, ["fee", holdOf("card", `john/${fid}`), "platform", 4, "平台抽成 10%"]]);
});

test("a guest's question is the owner's spend (§9.1): one credit each, against the guest cap and the agent's day; none when the wallet is empty", () => {
  const { r, john, lisi, xiaoping } = world();
  const id = call(r, "POST /cards", { token: john.token, body: CARD }).json.card.id;
  const first = call(r, `POST /ask/${id}`, { body: { text: "问一句" }, ip: "10.0.0.1" });
  assert.equal(first.status, 201, first.text);
  assert.equal(r.balance("john"), 19);
  const e = r.ledgerOf("john").at(-1);
  assert.deepEqual([e.kind, e.from, e.to, e.amount, e.note, e.agent, e.cap], ["spend", "person:john", "platform", 1, "访客问答", "xiaoping", "guest"]);
  assert.deepEqual(r.walletOf("john").used, { agents: { xiaoping: 1 }, cards: {}, guest: 1, auto: 0 });
  assert.equal(r.walletOf("john").recent[0], "09:00 消耗 · xiaoping 给 平台 · 访客问答 | −1");
  call(r, "POST /wallet/caps", { token: john.token, body: { guestPerDay: 1 } });
  assert.equal(call(r, `POST /ask/${id}`, { token: first.json.token, body: { text: "再问" }, ip: "10.0.0.1" }).json.error, "作者今天的访客额度用完了，明天再来");
  call(r, "POST /wallet/caps", { token: john.token, body: { guestPerDay: 10, agentPerDay: 1 } });
  assert.equal(call(r, `POST /ask/${id}`, { token: first.json.token, body: { text: "再问" }, ip: "10.0.0.1" }).json.error, "作者今天的访客额度用完了，明天再来", "the agent's day is spent too");
  call(r, "POST /wallet/caps", { token: john.token, body: { agentPerDay: 30 } });
  assert.equal(call(r, "POST /wallet/gift", { token: john.token, body: { to: "lisi", credits: 19 } }).status, 200);
  assert.equal(r.balance("john"), 0);
  assert.equal(call(r, `POST /ask/${id}`, { token: first.json.token, body: { text: "再问" }, ip: "10.0.0.1" }).json.error, "作者的积分用完了");
  assert.equal(xiaoping.record.speaker, "agent:xiaoping@john");
});

test("tips, favours, gifts and red packets (§9.1): a tip lands in the owner's wallet with the agent named and a line; a favour is a line both keep and no credits; a gift goes to an account now or is held for whoever claims it once; a packet's shares are drawn by the venue's members and what is left goes back after a day", () => {
  const { r, john, wangwu, lisi, xiaoping } = world();
  r.topUp("john", 80);
  // tips
  const tip = call(r, "POST /wallet/tip", { token: wangwu.token, body: { to: "agent:xiaoping@john", credits: 5, note: "那个缓存修得漂亮" } });
  assert.deepEqual([tip.status, tip.json], [200, { balance: 15 }]);
  assert.deepEqual([r.balance("john"), r.walletOf("john").recent[0], r.walletOf("wangwu").recent[0]], [105, "09:00 打赏 · wangwu 给 xiaoping · 「那个缓存修得漂亮」 | +5", "09:00 打赏 · wangwu 给 xiaoping · 「那个缓存修得漂亮」 | −5"]);
  assert.equal(call(r, "POST /wallet/tip", { token: wangwu.token, body: { to: "wangwu", credits: 1 } }).json.error, "不能打赏自己");
  assert.equal(call(r, "POST /wallet/tip", { token: wangwu.token, body: { to: "nobody", credits: 1 } }).status, 404);
  assert.equal(call(r, "POST /wallet/tip", { token: wangwu.token, body: { to: "john", credits: 99 } }).json.error, "积分不够：钱包 15");
  assert.equal(call(r, "POST /wallet/tip", { token: xiaoping.token, body: { to: "lisi", credits: 1 } }).status, 403);
  assert.equal(call(r, "POST /wallet/tip", { token: wangwu.token, body: { to: "lisi", credits: 2 } }).json.balance, 13, "a tip to a person, no line");
  assert.equal(r.walletOf("lisi").recent[0], "09:00 打赏 · wangwu 给 lisi ·  | +2");
  // favours
  assert.equal(call(r, "POST /wallet/favor", { token: lisi.token, body: { from: "john" } }).json.error, "人情要一句话");
  assert.equal(call(r, "POST /wallet/favor", { token: lisi.token, body: { from: "john", note: "帮跑了一次，约 30 万 token" } }).status, 200);
  assert.deepEqual([last(r, "lisi"), last(r, "john"), r.balance("lisi"), r.balance("john")], [["favor", "person:john", "person:lisi", 0, "帮跑了一次，约 30 万 token"], ["favor", "person:john", "person:lisi", 0, "帮跑了一次，约 30 万 token"], 22, 105]);
  assert.equal(r.walletOf("lisi").recent[0], "09:00 人情 · john 给 lisi · 帮跑了一次，约 30 万 token | 不转积分");
  assert.equal(call(r, "POST /wallet/favor", { token: john.token, body: { to: "wangwu", note: "审了一版" } }).status, 200);
  assert.deepEqual(last(r, "wangwu"), ["favor", "person:john", "person:wangwu", 0, "审了一版"]);
  // gifts
  assert.equal(call(r, "POST /wallet/gift", { token: john.token, body: { to: "wangwu", credits: 10 } }).json.balance, 95);
  assert.equal(r.balance("wangwu"), 23);
  assert.equal(call(r, "POST /wallet/gift", { token: john.token, body: { to: "john", credits: 1 } }).json.error, "不能送给自己");
  assert.equal(call(r, "POST /wallet/gift", { token: john.token, body: { to: "nobody", credits: 1 } }).status, 404);
  const held = call(r, "POST /wallet/gift", { token: john.token, body: { credits: 15, note: "拿去买个 skill" } });
  assert.equal(held.status, 201, held.text);
  assert.match(held.json.id, /^g-[0-9a-f]{8}$/);
  assert.deepEqual([held.json.url, held.json.balance], [`/g/${held.json.id}`, 80]);
  assert.deepEqual(call(r, `GET /g/${held.json.id}`).json, { id: held.json.id, from: "john", credits: 15, note: "拿去买个 skill" }, "the claim page's JSON needs no token");
  assert.equal(call(r, "GET /g/g-00000000").status, 404);
  assert.equal(call(r, `POST /g/${held.json.id}/claim`, { token: xiaoping.token }).status, 403);
  assert.equal(call(r, `POST /g/${held.json.id}/claim`, { token: john.token }).json.error, "不能领自己的礼物");
  assert.deepEqual(call(r, `POST /g/${held.json.id}/claim`, { token: lisi.token }).json, { credits: 15, balance: 37 });
  assert.equal(call(r, `POST /g/${held.json.id}/claim`, { token: wangwu.token }).json.error, "已经被 lisi 领了");
  assert.equal(call(r, `GET /g/${held.json.id}`).json.claimed, "lisi");
  assert.deepEqual([balanceOf(r.ledgerOf("john"), holdOf("gift", `john/${held.json.id}`)), last(r, "lisi")], [0, ["gift", holdOf("gift", `john/${held.json.id}`), "person:lisi", 15, "领了 john 的礼物"]]);
  assert.equal(r.walletOf("lisi").recent[0], "09:00 赠送 · 礼物 给 lisi · 领了 john 的礼物 | +15");
  // packets
  assert.equal(call(r, "POST /wallet/packet", { token: john.token, body: { venue: "john/nowhere", credits: 10, shares: 3 } }).status, 404);
  assert.equal(call(r, "POST /wallet/packet", { token: john.token, body: { venue: "john/g-7", credits: 10, shares: 11 } }).json.error, "份数是 1 到积分数之间的整数");
  const packet = call(r, "POST /wallet/packet", { token: john.token, body: { venue: "john/g-7", credits: 10, shares: 3, note: "发奖金啦" } });
  assert.equal(packet.status, 201, packet.text);
  assert.match(packet.json.id, /^r-[0-9a-f]{8}$/);
  const pid = packet.json.id;
  assert.deepEqual([packet.json.message.kind, packet.json.message.text, packet.json.message.card, packet.json.balance], ["card", "红包 · 10 积分 · 3 份 · 发奖金啦", `https://relay.test/john/packets/${pid}.geml`, 70]);
  assert.equal(r.venueOf("john", "g-7").messages.at(-1).id, `m-${pid}`);
  const view = call(r, `GET /r/${pid}`, { token: wangwu.token });
  assert.deepEqual([view.json.from, view.json.credits, view.json.shares, view.json.left, view.json.claims, view.json.returned, view.json.note], ["john", 10, 3, 3, [], false, "发奖金啦"]);
  const zhao = r.issuePerson("zhao");
  assert.equal(call(r, `GET /r/${pid}`, { token: zhao.token }).status, 403, "not a member");
  assert.equal(call(r, `POST /r/${pid}/claim`, { token: john.token }).json.error, "自己的红包不能领");
  assert.deepEqual(call(r, `POST /r/${pid}/claim`, { token: wangwu.token }).json, { amount: 3, left: 2, balance: 26 });
  assert.equal(call(r, `POST /r/${pid}/claim`, { token: wangwu.token }).json.error, "领过了");
  assert.deepEqual(call(r, `POST /r/${pid}/claim`, { token: lisi.token }).json, { amount: 3, left: 1, balance: 40 });
  assert.deepEqual(call(r, `GET /r/${pid}`, { token: wangwu.token }).json.claims, [{ by: "wangwu", amount: 3 }, { by: "lisi", amount: 3 }]);
  assert.equal(call(r, `GET /r/${pid}`, { token: wangwu.token }).json.mine, 3);
  assert.equal(r.walletOf("lisi").recent[0], "09:00 红包 · 红包 给 lisi · 领了 john 的红包 · 第 2 份 | +3");
  r.addMember(john.record, "john", "g-7", "person:zhao");
  r.advance(25 * 3_600_000);
  assert.equal(call(r, `POST /r/${pid}/claim`, { token: zhao.token }).json.error, "红包过了 24 小时，没领完的退回了");
  assert.deepEqual(r.tick(), { returned: [], packets: [pid] });
  assert.deepEqual([r.balance("john"), last(r, "john")], [74, ["refund", holdOf("packet", `john/${pid}`), "person:john", 4, "红包 24 小时没领完，退回"]]);
  assert.deepEqual([call(r, `GET /r/${pid}`, { token: wangwu.token }).json.returned, call(r, `GET /r/${pid}`, { token: wangwu.token }).json.left], [true, 0]);
  assert.deepEqual(r.tick(), { returned: [], packets: [] }, "returned once");
});

test("an agent's spend (§9.1): within the auto-buy cap and its day, from the owner's wallet; over either, refused and the ask stands in the owner's inbox as 放行; today's allowance lets it through; tomorrow starts over", () => {
  const { r, john, xiaoping } = world();
  r.topUp("john", 80);
  assert.equal(call(r, "POST /wallet/spend", { token: john.token, body: { credits: 1, note: "x" } }).json.error, "只有 agent 的令牌能记消耗（主人不花自己的上限）");
  assert.equal(call(r, "POST /wallet/spend", { token: xiaoping.token, body: { credits: 3 } }).json.error, "要一句说明（买了什么）");
  assert.equal(call(r, "POST /wallet/spend", { token: xiaoping.token, body: { credits: 0, note: "x" } }).json.error, "积分是正整数");
  assert.deepEqual(call(r, "POST /wallet/spend", { token: xiaoping.token, body: { credits: 3, note: "买了 skill pdf-export", card: "t-42" } }).json, { balance: 97, left: 2 });
  assert.deepEqual(r.walletOf("john").used, { agents: { xiaoping: 3 }, cards: { "t-42": 3 }, guest: 0, auto: 3 });
  assert.equal(r.walletOf("john").lines[1], "xiaoping 每天 30 · 已用 3");
  assert.equal(call(r, "POST /wallet/spend", { token: xiaoping.token, body: { credits: 3, note: "再买一个" } }).json.error, "超过上限（今天还能花 2）· 用 ask 向主人要放行");
  assert.equal(call(r, "POST /wallet/ask", { token: john.token, body: { credits: 5 } }).status, 403);
  assert.equal(call(r, "POST /wallet/ask", { token: xiaoping.token, body: { credits: 5, cap: "nope" } }).json.error, "cap 是 agent、card、guest 或 auto");
  const ask = call(r, "POST /wallet/ask", { token: xiaoping.token, body: { credits: 5, cap: "auto", note: "还差一个 skill" } });
  assert.deepEqual([ask.status, ask.json], [201, { id: "cap-ask-1" }]);
  assert.deepEqual(r.inbox("john").map((n) => [n.kind, n.key, n.text, n.actions]), [["grant", "https://relay.test/john/people/john.geml#cap-ask-1", "xiaoping 想再花 5 积分（自动买东西）：还差一个 skill", ["今天再 5", "不行"]]]);
  assert.equal(call(r, "POST /wallet/allow", { token: xiaoping.token, body: { ask: "cap-ask-1", allowed: true } }).status, 403);
  assert.equal(call(r, "POST /wallet/allow", { token: john.token, body: { ask: "cap-ask-9", allowed: true } }).status, 404);
  assert.deepEqual(call(r, "POST /wallet/allow", { token: john.token, body: { ask: "cap-ask-1", allowed: true } }).json, { id: "cap-allow-1", allowed: true });
  assert.deepEqual(r.inbox("john"), []);
  assert.equal(call(r, "POST /wallet/allow", { token: john.token, body: { ask: "cap-ask-1", allowed: true } }).json.error, "已经答过了");
  assert.deepEqual(call(r, "POST /wallet/spend", { token: xiaoping.token, body: { credits: 5, note: "买了" } }).json, { balance: 92, left: 2 });
  const no = call(r, "POST /wallet/ask", { token: xiaoping.token, body: { credits: 9, cap: "auto" } });
  assert.equal(r.inbox("john")[0].text, "xiaoping 想再花 9 积分（自动买东西）");
  assert.deepEqual(call(r, "POST /wallet/allow", { token: john.token, body: { ask: no.json.id, allowed: false } }).json, { id: "cap-allow-2", allowed: false });
  assert.equal(call(r, "POST /wallet/spend", { token: xiaoping.token, body: { credits: 3, note: "再买" } }).json.error, "超过上限（今天还能花 2）· 用 ask 向主人要放行");
  r.advance(24 * 3_600_000);
  assert.deepEqual(call(r, "POST /wallet/spend", { token: xiaoping.token, body: { credits: 5, note: "新的一天" } }).json, { balance: 87, left: 0 });
  assert.equal(call(r, "POST /wallet/spend", { token: xiaoping.token, body: { credits: 1, note: "又一个" } }).json.error, "超过上限（今天还能花 0）· 用 ask 向主人要放行");
  call(r, "POST /wallet/caps", { token: john.token, body: { autoBuy: 100, agentPerDay: 6 } });
  assert.equal(call(r, "POST /wallet/spend", { token: xiaoping.token, body: { credits: 2, note: "x" } }).json.error, "超过上限（今天还能花 1）· 用 ask 向主人要放行", "the agent's day bounds it");
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
node --test test/relay-wallet.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
```
Expected: `ℹ fail 5` (the first fails at `r.balance`, no such method; the rest at their first wallet call).

- [ ] **Step 3: The relay**

**3a. Imports** — the card import gains `slotsOf`: `openSlots, progressLine, rolesOf, STATE_WORDS` becomes `openSlots, progressLine, rolesOf, slotsOf, STATE_WORDS`; and before `import { enqueue, pending, readQueue, type ItemDraft, type Marker, type Queue, type QueueItem } from "../core/im/queue.js";`:

```ts
import { balanceOf, capsOf, entryLine, foldLedger, FREE_CREDITS, GUEST_QUESTION_CREDITS, holdOf, PACKET_HOURS, PLATFORM, usedToday, walletLines, WALLET_WORDS, type CapKey, type Caps, type Entry, type EntryKind, type Used } from "../core/im/ledger.js";
```

`src/core/im/ledger.ts` gains, after `export const PLATFORM = "platform";`:

```ts
/** Why a guest's question is refused for the wallet's sake (the count quotas have their own words in share.ts). */
export const WALLET_WORDS = { ownerBroke: "作者的积分用完了" } as const;
```

**3b. Options and fields** — `export interface RelayOptions { root: string; name: string; federation?: Federation; version?: string; now?: () => string }` becomes:

```ts
export interface RelayOptions { root: string; name: string; federation?: Federation; version?: string; now?: () => string; freeCredits?: number; feePercent?: number }
```

After `  readonly version: string;` in the class:

```ts
  /** What a new person's wallet opens with, and the platform's cut of a settlement in percent (§9.1). */
  readonly freeCredits: number;
  readonly feePercent: number;
```

After `    this.version = o.version ?? "unknown";` in the constructor:

```ts
    this.freeCredits = o.freeCredits ?? FREE_CREDITS;
    this.feePercent = o.feePercent ?? 0;
```

**3c. Module-level helpers** — after `const STATE_WORDS_OF = (s: CardState): string => STATE_WORDS[s];`:

```ts
/** A cap as the inbox names it. */
const CAP_WORDS: Readonly<Record<CapKey, string>> = { agent: "每天的总额", card: "每张卡", guest: "访客问答", auto: "自动买东西" };
/** What publishing a card holds (§9.1): the escrow, or the prize with a participation for every other slot. */
const rewardTotal = (card: Card): number => (card.reward.kind === "escrow" ? card.reward.credits : card.reward.kind === "prize" ? card.reward.credits + (card.reward.participation ?? 0) * (slotsOf(card) - 1) : 0);
const packetExpired = (at: string, now: string): boolean => Date.parse(at) + PACKET_HOURS * 3_600_000 <= Date.parse(now);
interface PacketDoc { from: string; venue: string; credits: number; shares: number; note: string; at: string; claims: { by: string; amount: number; at: string }[]; returned: boolean }
export interface PacketView { id: string; from: string; venue: string; credits: number; shares: number; note: string; at: string; claims: { by: string; amount: number }[]; left: number; returned: boolean; mine?: number }
export interface WalletView { balance: number; caps: Caps; used: Used; agents: string[]; lines: string[]; entries: Entry[]; recent: string[] }
```

**3d. The free allowance** — in `issuePerson`, the line `    appendSealed(this.root, id, \`people/${id}.geml\`, "person", { name: id, at: this.now() });` becomes:

```ts
    const made = appendSealed(this.root, id, `people/${id}.geml`, "person", { name: id, at: this.now() });
    if (!made.existed && this.freeCredits > 0) this.transfer({ kind: "topup", from: PLATFORM, to: `person:${id}`, amount: this.freeCredits, note: "免费额度" });
```

**3e. The hold at publish** — in `publishTask`, after `    if (!this.isMember(vd, s)) return fail(403, "委托人不在这个场所里");`:

```ts
    const held = rewardTotal(card);
    if (held > 0) {
      const caps = this.capsOf(owner);
      if (held > caps.perCard) return fail(403, `超过每张卡的额度 ${caps.perCard}（要托管 ${held}）`);
      const balance = this.balance(owner);
      if (balance < held) return fail(403, `积分不够：钱包 ${balance}，要托管 ${held}`);
    }
```

and after `    const moved = this.moveTask(owner, card, "open", by, { venue: key, thread });\n    if (!moved.ok) return moved;`:

```ts
    if (held > 0) this.transfer({ kind: "escrow", from: `person:${owner}`, to: holdOf("card", `${owner}/${id}`), amount: held, note: "发布时托管", ref: this.cardAddress(owner, id), card: id });
```

**3f. The settlement note** — the comment `/** The settlement a state note records at 已接受 (§8.2; the ledger is ⑤). */` becomes `/** The settlement a state note records at 已接受 (§8.2); the ledger moves in \`settle\`. */`, and the two cases:

```ts
      case "escrow": return `结算 ${card.reward.credits} 积分（托管）`;
      case "prize": return `结算 ${card.reward.credits} 积分（奖金）${card.reward.participation === undefined ? "" : `· 参与补偿 ${card.reward.participation}`}`;
```

**3g. The payout** — after `acceptedSlot`'s line (`  private acceptedSlot(card: Card): number | undefined { … }`):

```ts
  /** The hold paid out (§9.1) once the card has ended: the worker's owner gets the reward (an arbitration's share instead) less the platform's cut, each other seated slot's owner the participation of a prize, the delegator what is left. */
  private settle(owner: string, card: Card, o: { worker?: string; workerShare?: number; ref?: string; why?: string } = {}): void {
    const hold = holdOf("card", `${owner}/${card.id}`);
    const left = (): number => balanceOf(this.ledgerOf(owner), hold);
    if (left() <= 0) return;
    const ref = o.ref ?? this.cardAddress(owner, card.id);
    const worker = o.worker ?? [...card.slots].reverse().find((s) => s.state === "accepted")?.agent;
    const ownerOf = (agent: string): string | undefined => personBehind(parseSpeaker(agent) ?? { kind: "host" });
    const reward = card.reward.kind === "escrow" || card.reward.kind === "prize" ? card.reward.credits : 0;
    const share = Math.min(left(), o.workerShare ?? reward);
    const to = worker === undefined ? undefined : ownerOf(worker);
    if (to !== undefined && share > 0) {
      const fee = Math.floor((share * this.feePercent) / 100);
      this.transfer({ kind: "settle", from: hold, to: `person:${to}`, amount: share - fee, note: o.workerShare === undefined ? "验收过" : "仲裁", ref, agent: shownName(worker!), card: card.id });
      if (fee > 0) this.transfer({ kind: "fee", from: hold, to: PLATFORM, amount: fee, note: `平台抽成 ${this.feePercent}%`, ref, card: card.id });
    }
    if (card.reward.kind === "prize" && card.reward.participation !== undefined && o.workerShare === undefined) {
      for (const s of card.slots) {
        const p = ownerOf(s.agent);
        if (s.agent === worker || p === undefined || left() < card.reward.participation) continue;
        this.transfer({ kind: "settle", from: hold, to: `person:${p}`, amount: card.reward.participation, note: "参与补偿", ref, agent: shownName(s.agent), card: card.id });
      }
    }
    const rest = left();
    if (rest > 0) this.transfer({ kind: "refund", from: hold, to: `person:${owner}`, amount: rest, note: o.why ?? "结余退回", ref, card: card.id });
  }
```

**3h. The verbs that end a card** — in `reportTask`'s accepted branch, `      const moved = this.moveTask(owner, now, "accepted", "host", { note: this.settlementNote(now), ...(slot !== undefined ? { slot } : {}) });\n      return moved.ok ? { ok: true, card: moved.card, decision } : moved;` becomes:

```ts
      const moved = this.moveTask(owner, now, "accepted", "host", { note: this.settlementNote(now), ...(slot !== undefined ? { slot } : {}) });
      if (moved.ok) this.settle(owner, moved.card);
      return moved.ok ? { ok: true, card: moved.card, decision } : moved;
```

In `acceptTask`, `    return this.moveTask(owner, card, "accepted", by, { note: this.settlementNote(card), ...(slot !== undefined ? { slot } : {}) });` becomes:

```ts
    const moved = this.moveTask(owner, card, "accepted", by, { note: this.settlementNote(card), ...(slot !== undefined ? { slot } : {}) });
    if (moved.ok) this.settle(owner, moved.card);
    return moved;
```

`settleTask` becomes:

```ts
  /** The dispute settled by the delegator (§8.2, §9.1): 已接受 pays the worker, 关闭 refunds; `workerShare` with an `arbitration` reference splits the hold the arbiter's way. */
  settleTask(by: TokenRecord, owner: string, id: string, body: unknown): Result<{ card: Card }> {
    const card = this.taskOf(owner, id);
    if (card === undefined) return fail(404, "没有这张卡");
    const b = obj(body) ?? {};
    const outcome = str(b["outcome"]);
    if (outcome !== "accepted" && outcome !== "closed") return fail(400, "结果是 accepted 或 closed");
    const workerShare = b["workerShare"] === undefined ? undefined : num(b["workerShare"]);
    if (b["workerShare"] !== undefined && (workerShare === undefined || !Number.isInteger(workerShare) || workerShare < 0)) return fail(400, "workerShare 是非负整数");
    const arbitration = str(b["arbitration"]);
    const slot = this.acceptedSlot(card);
    const worker = card.slots.find((s) => s.n === slot)?.agent;
    const moved = this.moveTask(owner, card, outcome, by, outcome === "accepted" ? { note: this.settlementNote(card), ...(slot !== undefined ? { slot } : {}) } : {});
    if (!moved.ok) return moved;
    this.settle(owner, moved.card, { ...(worker !== undefined ? { worker } : {}), ...(arbitration !== undefined ? { ref: arbitration } : {}), ...(outcome === "closed" ? { workerShare: workerShare ?? 0, why: arbitration === undefined ? "争议关闭" : "仲裁" } : workerShare !== undefined ? { workerShare, why: "仲裁" } : {}) });
    return moved;
  }
```

In `closeTask`, `    return this.moveTask(owner, card, "closed", by, reason === undefined ? {} : { note: reason });` becomes:

```ts
    const moved = this.moveTask(owner, card, "closed", by, reason === undefined ? {} : { note: reason });
    if (moved.ok) this.settle(owner, moved.card, { workerShare: 0, why: "关闭" });
    return moved;
```

**3i. The sweep** — `tick` becomes:

```ts
  tick(now: string = this.now()): { returned: string[]; packets: string[] } {
    const returned: string[] = [];
    for (const { owner, card } of this.allTasks()) {
      if (!isStale(card, now, GIVE_BACK_AFTER_MS)) continue;
      const slot = card.slots.find((s) => s.state === "working")?.n;
      const moved = this.moveTask(owner, card, "open", "host", { note: "超时自动交回", ...(slot !== undefined ? { slot } : {}) });
      if (moved.ok) returned.push(card.id);
    }
    const packets: string[] = [];
    for (const owner of listOwners(this.root)) for (const d of listDocs(this.root, owner, "packets")) {
      const id = d.slice("packets/".length, -".geml".length);
      const p = this.packetDoc(owner, id);
      if (p === undefined || p.returned || !packetExpired(p.at, now)) continue;
      this.returnPacket(owner, id);
      packets.push(id);
    }
    return { returned, packets };
  }
```

**3j. The guest's question** — in `askAsGuest`, after `    if (used >= quota.perGuestPerDay) return fail(429, QUOTA_WORDS.guest);`:

```ts
    if (this.balance(owner) < GUEST_QUESTION_CREDITS) return fail(429, WALLET_WORDS.ownerBroke);
    if (this.room(owner, card.agent, "guest", now) < GUEST_QUESTION_CREDITS) return fail(429, QUOTA_WORDS.owner);
```

and after `    const r = this.appendMessage(guest, owner, venueId, { id: mid ?? \`m-${rand()}\`, text });\n    if (!r.ok) return r;`:

```ts
    this.transfer({ kind: "spend", from: `person:${owner}`, to: PLATFORM, amount: GUEST_QUESTION_CREDITS, note: "访客问答", agent: card.agent, cap: "guest" });
```

**3k. The inbox** — in `inbox`, before `    out.push(...this.cardNeeds(person, now));`:

```ts
    const allowed = new Set(pd.blocks.filter((b) => /^cap-allow-\d+$/.test(b.id)).map((b) => str(b.value["ask"])));
    for (const b of pd.blocks) {
      if (!/^cap-ask-\d+$/.test(b.id) || allowed.has(b.id)) continue;
      const agent = str(b.value["agent"]) ?? "", credits = num(b.value["credits"]) ?? 0, cap = str(b.value["cap"]) ?? "auto", note = str(b.value["note"]);
      out.push({ kind: "grant", key: this.address(person, this.personDoc(person), b.id), text: `${agent} 想再花 ${credits} 积分（${CAP_WORDS[cap as CapKey] ?? cap}）${note === undefined ? "" : `：${note}`}`, actions: [`今天再 ${credits}`, "不行"], since: str(b.value["at"]) ?? "", level: 0 });
    }
```

**3l. The wallet** — before `  // --- queues ---`:

```ts
  // --- the ledger and the wallet (§9.1) ---

  private ledgerDoc(person: string): string { return `ledger/${person}.geml`; }

  /** A person's ledger as entries; none for a person without one. */
  ledgerOf(person: string): Entry[] { return NAME.test(person) ? foldLedger(readDoc(this.root, person, this.ledgerDoc(person)).blocks) : []; }

  /** What a person has: what their ledger says came in, less what went out. */
  balance(person: string): number { return balanceOf(this.ledgerOf(person), `person:${person}`); }

  /** The owner's caps (§9.1): the last `caps-N` block on their page, else the defaults. */
  capsOf(owner: string): Caps {
    const all = readDoc(this.root, owner, this.personDoc(owner)).blocks.filter((b) => /^caps-\d+$/.test(b.id));
    return capsOf(all[all.length - 1]?.value);
  }

  /** One movement: an entry in the ledger of each party that is a person, and of the owner of each hold (a hold's balance is read there), all sharing a tx. */
  private transfer(m: { kind: EntryKind; from: string; to: string; amount: number; note: string; ref?: string; agent?: string; cap?: CapKey; card?: string }): string {
    const tx = rand(), at = this.now();
    const value: Record<string, JsonValue> = { kind: m.kind, from: m.from, to: m.to, amount: m.amount, note: m.note, at, tx };
    if (m.ref !== undefined) value["ref"] = m.ref;
    if (m.agent !== undefined) value["agent"] = m.agent;
    if (m.cap !== undefined) value["cap"] = m.cap;
    if (m.card !== undefined) value["card"] = m.card;
    const ledgers = new Set<string>();
    for (const account of [m.from, m.to]) {
      if (account.startsWith("person:")) ledgers.add(account.slice("person:".length));
      const hold = /^hold:[a-z]+\/([^/]+)\//.exec(account);
      if (hold !== null) ledgers.add(hold[1]!);
    }
    for (const person of ledgers) {
      const doc = this.ledgerDoc(person);
      const a = appendBlock(this.root, person, doc, nextId("entry"), (_d, prev, bid) => sealed({ id: bid, ...value }, prev));
      this.emit(person, doc, a.block);
    }
    return tx;
  }

  /** Today's allowances for an agent against a cap: the asks the owner said yes to today. */
  private allowancesToday(owner: string, agent: string, cap: CapKey, now: string): number {
    const pd = readDoc(this.root, owner, this.personDoc(owner)).blocks;
    const asks = new Map(pd.filter((b) => /^cap-ask-\d+$/.test(b.id)).map((b) => [b.id, b.value] as const));
    let n = 0;
    for (const b of pd) {
      if (!/^cap-allow-\d+$/.test(b.id) || b.value["allowed"] !== true || !sameDay(str(b.value["at"]) ?? "", now)) continue;
      const ask = asks.get(str(b.value["ask"]) ?? "");
      if (ask !== undefined && str(ask["agent"]) === agent && str(ask["cap"]) === cap) n += num(ask["credits"]) ?? 0;
    }
    return n;
  }

  /** How much more the agent may spend against a cap today (§9.1): the cap plus today's allowances, less today's use; the agent's own day bounds the guest and auto caps too. */
  room(owner: string, agent: string, cap: CapKey, now: string = this.now(), card?: string): number {
    const caps = this.capsOf(owner), used = usedToday(this.ledgerOf(owner), now);
    const day = caps.agentPerDay + this.allowancesToday(owner, agent, "agent", now) - (used.agents[agent] ?? 0);
    switch (cap) {
      case "agent": return day;
      case "guest": return Math.min(day, caps.guestPerDay + this.allowancesToday(owner, agent, "guest", now) - used.guest);
      case "auto": return Math.min(day, caps.autoBuy + this.allowancesToday(owner, agent, "auto", now) - used.auto);
      case "card": return card === undefined ? caps.perCard : caps.perCard + this.allowancesToday(owner, agent, "card", now) - (used.cards[card] ?? 0);
    }
  }

  /** The wallet page (§9.1): the balance, the caps with today's use as lines, the last entries as lines (newest first, UTC hh:mm; the daemon redraws them in local time). */
  walletOf(person: string): WalletView {
    const entries = this.ledgerOf(person), now = this.now();
    const caps = this.capsOf(person), used = usedToday(entries, now), agents = this.agentsOf(person);
    const balance = balanceOf(entries, `person:${person}`);
    const recent = entries.slice(-20).reverse();
    return { balance, caps, used, agents, lines: walletLines({ balance, caps, used, agents }), entries: recent, recent: recent.map((e) => entryLine(e, `person:${person}`, (at) => at.slice(11, 16))) };
  }

  /** The operator's top-up (§9.1: credits are backed by what the platform bought): from the platform to a person with a page. */
  topUp(person: string, credits: number, note = "充值"): Result<{ balance: number }> {
    if (!NAME.test(person) || !readDoc(this.root, person, this.personDoc(person)).exists) return fail(404, "没有这个人");
    if (!Number.isInteger(credits) || credits <= 0) return fail(400, "积分是正整数");
    this.transfer({ kind: "topup", from: PLATFORM, to: `person:${person}`, amount: credits, note });
    return { ok: true, balance: this.balance(person) };
  }

  /** The owner sets a cap or several (§9.1): the ones given, the rest kept. */
  setCaps(by: TokenRecord, body: unknown): Result<{ caps: Caps }> {
    const s = parseSpeaker(by.speaker);
    if (by.scope !== "person" || s?.kind !== "person") return fail(403, "只有本人能设上限");
    const given = Object.fromEntries(Object.entries(obj(body) ?? {}).filter(([, v]) => Number.isInteger(v) && (v as number) >= 0));
    const caps = capsOf({ ...this.capsOf(s.id), ...given });
    const doc = this.personDoc(s.id);
    const a = appendBlock(this.root, s.id, doc, nextId("caps"), (_d, prev, bid) => sealed({ id: bid, ...caps, at: this.now() }, prev));
    this.emit(s.id, doc, a.block);
    return { ok: true, caps };
  }

  /** An agent's spend from its owner's wallet (§9.1): within the auto-buy cap, the card's and its own day; over any, refused — the ask is its next move. */
  spend(by: TokenRecord, body: unknown): Result<{ balance: number; left: number }> {
    const s = parseSpeaker(by.speaker);
    if (by.scope !== "agent" || s?.kind !== "agent") return fail(403, "只有 agent 的令牌能记消耗（主人不花自己的上限）");
    const b = obj(body) ?? {};
    const credits = num(b["credits"]), note = (str(b["note"]) ?? "").trim(), card = str(b["card"]);
    if (credits === undefined || !Number.isInteger(credits) || credits <= 0) return fail(400, "积分是正整数");
    if (note === "") return fail(400, "要一句说明（买了什么）");
    const now = this.now();
    const balance = this.balance(s.owner);
    if (balance < credits) return fail(403, `积分不够：钱包 ${balance}`);
    const room = Math.min(this.room(s.owner, s.name, "auto", now), ...(card !== undefined ? [this.room(s.owner, s.name, "card", now, card)] : []));
    if (room < credits) return fail(403, `超过上限（今天还能花 ${Math.max(0, room)}）· 用 ask 向主人要放行`);
    this.transfer({ kind: "spend", from: `person:${s.owner}`, to: PLATFORM, amount: credits, note, agent: s.name, cap: "auto", ...(card !== undefined ? { card } : {}) });
    return { ok: true, balance: this.balance(s.owner), left: room - credits };
  }

  /** The agent's ask for more (§9.1): a block on the owner's page, a 放行 in their inbox. */
  askCredits(by: TokenRecord, body: unknown): Result<{ id: string }> {
    const s = parseSpeaker(by.speaker);
    if (by.scope !== "agent" || s?.kind !== "agent") return fail(403, "只有 agent 问主人要");
    const b = obj(body) ?? {};
    const credits = num(b["credits"]), cap = str(b["cap"]) ?? "auto", note = str(b["note"]);
    if (credits === undefined || !Number.isInteger(credits) || credits <= 0) return fail(400, "积分是正整数");
    if (!(cap in CAP_WORDS)) return fail(400, "cap 是 agent、card、guest 或 auto");
    const doc = this.personDoc(s.owner);
    const a = appendBlock(this.root, s.owner, doc, nextId("cap-ask"), (_d, prev, bid) => sealed({ id: bid, agent: s.name, credits, cap, at: this.now(), ...(note !== undefined ? { note } : {}) }, prev));
    this.emit(s.owner, doc, a.block);
    return { ok: true, id: a.block.id };
  }

  /** The owner's answer: today the agent may spend that much more against that cap, or not. */
  allowCredits(by: TokenRecord, body: unknown): Result<{ id: string; allowed: boolean }> {
    const s = parseSpeaker(by.speaker);
    if (by.scope !== "person" || s?.kind !== "person") return fail(403, "只有本人能放行");
    const b = obj(body) ?? {};
    const ask = str(b["ask"]) ?? "", allowed = b["allowed"] === true;
    const doc = this.personDoc(s.id);
    const pd = readDoc(this.root, s.id, doc).blocks;
    if (!/^cap-ask-\d+$/.test(ask) || !pd.some((x) => x.id === ask)) return fail(404, "没有这个申请");
    if (pd.some((x) => /^cap-allow-\d+$/.test(x.id) && x.value["ask"] === ask)) return fail(409, "已经答过了");
    const a = appendBlock(this.root, s.id, doc, nextId("cap-allow"), (_d, prev, bid) => sealed({ id: bid, ask, allowed, at: this.now() }, prev));
    this.emit(s.id, doc, a.block);
    return { ok: true, id: a.block.id, allowed };
  }

  /** The person behind a `to`: a person's id, an agent's owner (the agent kept for the line), or a bare id. */
  private payee(to: string | undefined): { person: string; agent?: string } | undefined {
    if (to === undefined) return undefined;
    const s = parseSpeaker(to);
    if (s?.kind === "person") return { person: s.id };
    if (s?.kind === "agent") return { person: s.owner, agent: s.name };
    return s === undefined && NAME.test(to) ? { person: to } : undefined;
  }
  private hasPage(person: string): boolean { return readDoc(this.root, person, this.personDoc(person)).exists; }

  /** A tip (§9.1): to a person, or to an agent — it lands in the owner's wallet, the agent named; a line may ride along. */
  tip(by: TokenRecord, body: unknown): Result<{ balance: number }> {
    const s = parseSpeaker(by.speaker);
    if (by.scope !== "person" || s?.kind !== "person") return fail(403, "只有本人能打赏");
    const b = obj(body) ?? {};
    const to = this.payee(str(b["to"])), credits = num(b["credits"]), note = (str(b["note"]) ?? "").trim();
    if (to === undefined || !this.hasPage(to.person)) return fail(404, "打赏给谁？要一个人或一个 agent");
    if (to.person === s.id) return fail(400, "不能打赏自己");
    if (credits === undefined || !Number.isInteger(credits) || credits <= 0) return fail(400, "积分是正整数");
    const balance = this.balance(s.id);
    if (balance < credits) return fail(403, `积分不够：钱包 ${balance}`);
    this.transfer({ kind: "tip", from: by.speaker, to: `person:${to.person}`, amount: credits, note: note === "" ? "" : `「${note}」`, ...(to.agent !== undefined ? { agent: to.agent } : {}) });
    return { ok: true, balance: this.balance(s.id) };
  }

  /** A favour (§9.1): a line both sides keep, no credits moved; `from` names who helped me, `to` whom I helped. */
  favor(by: TokenRecord, body: unknown): Result<Record<never, never>> {
    const s = parseSpeaker(by.speaker);
    if (by.scope !== "person" || s?.kind !== "person") return fail(403, "只有本人记人情");
    const b = obj(body) ?? {};
    const gave = str(b["to"]) !== undefined;
    const other = this.payee(str(b["to"]) ?? str(b["from"])), note = (str(b["note"]) ?? "").trim();
    if (other === undefined || !this.hasPage(other.person)) return fail(404, "记给谁？");
    if (note === "") return fail(400, "人情要一句话");
    this.transfer({ kind: "favor", from: gave ? by.speaker : `person:${other.person}`, to: gave ? `person:${other.person}` : by.speaker, amount: 0, note });
    return { ok: true };
  }

  /** A gift (§9.1): to a person with an account at once; to no one named, held for whoever claims it at `/g/<id>` (登录即注册 is the page's). */
  gift(by: TokenRecord, body: unknown): Result<{ id?: string; url?: string; balance: number }> {
    const s = parseSpeaker(by.speaker);
    if (by.scope !== "person" || s?.kind !== "person") return fail(403, "只有本人能送");
    const b = obj(body) ?? {};
    const credits = num(b["credits"]), note = (str(b["note"]) ?? "").trim(), toName = str(b["to"]);
    if (credits === undefined || !Number.isInteger(credits) || credits <= 0) return fail(400, "积分是正整数");
    const balance = this.balance(s.id);
    if (balance < credits) return fail(403, `积分不够：钱包 ${balance}`);
    if (toName !== undefined) {
      const to = this.payee(toName);
      if (to === undefined || !this.hasPage(to.person)) return fail(404, `没有这个人：${toName}（没账号的，不写 to，发领取链接）`);
      if (to.person === s.id) return fail(400, "不能送给自己");
      this.transfer({ kind: "gift", from: by.speaker, to: `person:${to.person}`, amount: credits, note });
      return { ok: true, balance: this.balance(s.id) };
    }
    const id = `g-${rand()}`;
    const doc = `gifts/${id}.geml`;
    const a = appendSealed(this.root, s.id, doc, "gift", { from: by.speaker, credits, note, at: this.now() });
    this.emit(s.id, doc, a.block);
    this.transfer({ kind: "gift", from: by.speaker, to: holdOf("gift", `${s.id}/${id}`), amount: credits, note: note === "" ? "礼物" : note, ref: this.address(s.id, doc) });
    return { ok: true, id, url: `/g/${id}`, balance: this.balance(s.id) };
  }

  private giftOwner(id: string): string | undefined { return NAME.test(id) ? listOwners(this.root).find((o) => readDoc(this.root, o, `gifts/${id}.geml`).exists) : undefined; }

  /** What the claim page shows (transport §7.1 `/g/<礼物>`): who gives how much with what line, and who took it. */
  giftOf(id: string): Result<{ id: string; from: string; credits: number; note: string; claimed?: string }> {
    const owner = this.giftOwner(id);
    if (owner === undefined) return fail(404, "没有这份礼物");
    const d = readDoc(this.root, owner, `gifts/${id}.geml`);
    const g = d.blocks.find((b) => b.id === "gift")?.value ?? {};
    const by = str(d.blocks.find((b) => b.id === "claim")?.value["by"]);
    return { ok: true, id, from: shownName(str(g["from"]) ?? ""), credits: num(g["credits"]) ?? 0, note: str(g["note"]) ?? "", ...(by !== undefined ? { claimed: shownName(by) } : {}) };
  }

  /** The gift claimed by a person (登录即注册 happens before this call): the hold's credits to them, once. */
  claimGift(by: TokenRecord, id: string): Result<{ credits: number; balance: number }> {
    const s = parseSpeaker(by.speaker);
    if (by.scope !== "person" || s?.kind !== "person") return fail(403, "领礼物要登录");
    const owner = this.giftOwner(id);
    if (owner === undefined) return fail(404, "没有这份礼物");
    if (owner === s.id) return fail(400, "不能领自己的礼物");
    const doc = `gifts/${id}.geml`;
    const hold = holdOf("gift", `${owner}/${id}`);
    const credits = balanceOf(this.ledgerOf(owner), hold);
    const a = appendBlock(this.root, owner, doc, () => "claim", (_d, prev, bid) => sealed({ id: bid, by: by.speaker, at: this.now() }, prev));
    if (a.existed) return fail(409, `已经被 ${shownName(str(a.block.value["by"]) ?? "")} 领了`);
    this.emit(owner, doc, a.block);
    this.transfer({ kind: "gift", from: hold, to: by.speaker, amount: credits, note: `领了 ${owner} 的礼物`, ref: this.address(owner, doc) });
    return { ok: true, credits, balance: this.balance(s.id) };
  }

  /** A red packet into a venue (§9.1): the whole held, a 卡片 message in the venue, the shares drawn by members, what is left after a day returned. */
  packet(by: TokenRecord, body: unknown): Result<{ id: string; message: Message; balance: number }> {
    const s = parseSpeaker(by.speaker);
    if (by.scope !== "person" || s?.kind !== "person") return fail(403, "只有本人能发红包");
    const b = obj(body) ?? {};
    const key = str(b["venue"]) ?? "", credits = num(b["credits"]), shares = num(b["shares"]), note = (str(b["note"]) ?? "").trim();
    const [vo, vi] = key.split("/");
    const vd = vo === undefined || vi === undefined ? undefined : this.venueOf(vo, vi);
    if (vd === undefined) return fail(404, "没有这个场所");
    if (!this.isMember(vd, s)) return fail(403, "不在这个场所里");
    if (credits === undefined || !Number.isInteger(credits) || credits <= 0) return fail(400, "积分是正整数");
    if (shares === undefined || !Number.isInteger(shares) || shares <= 0 || shares > credits) return fail(400, "份数是 1 到积分数之间的整数");
    const balance = this.balance(s.id);
    if (balance < credits) return fail(403, `积分不够：钱包 ${balance}`);
    const id = `r-${rand()}`;
    const doc = `packets/${id}.geml`;
    const a = appendSealed(this.root, s.id, doc, "packet", { from: by.speaker, venue: key, credits, shares, note, at: this.now() });
    this.emit(s.id, doc, a.block);
    this.transfer({ kind: "packet", from: by.speaker, to: holdOf("packet", `${s.id}/${id}`), amount: credits, note: `红包 ${credits} 积分 · ${shares} 份`, ref: this.address(s.id, doc) });
    const m = this.appendMessage(by, vo!, vi!, { id: `m-${id}`, kind: "card", card: this.address(s.id, doc), text: `红包 · ${credits} 积分 · ${shares} 份${note === "" ? "" : ` · ${note}`}` });
    if (!m.ok) return m;
    return { ok: true, id, message: m.message, balance: this.balance(s.id) };
  }

  private packetOwner(id: string): string | undefined { return NAME.test(id) ? listOwners(this.root).find((o) => readDoc(this.root, o, `packets/${id}.geml`).exists) : undefined; }

  private packetDoc(owner: string, id: string): PacketDoc | undefined {
    const d = readDoc(this.root, owner, `packets/${id}.geml`);
    const p = d.blocks.find((b) => b.id === "packet")?.value;
    if (!d.exists || p === undefined) return undefined;
    const claims = d.blocks.filter((b) => /^claim-\d+$/.test(b.id)).map((b) => ({ by: str(b.value["by"]) ?? "", amount: num(b.value["amount"]) ?? 0, at: str(b.value["at"]) ?? "" }));
    return { from: str(p["from"]) ?? "", venue: str(p["venue"]) ?? "", credits: num(p["credits"]) ?? 0, shares: num(p["shares"]) ?? 0, note: str(p["note"]) ?? "", at: str(p["at"]) ?? "", claims, returned: d.blocks.some((b) => b.id === "returned") };
  }

  /** The packet as a member sees it (transport §7.1 `/r/<红包>`): the total, the shares, who took what, what one took, whether it went back. */
  packetOf(id: string, viewer: string): Result<PacketView> {
    const owner = this.packetOwner(id);
    const p = owner === undefined ? undefined : this.packetDoc(owner, id);
    if (owner === undefined || p === undefined) return fail(404, "没有这个红包");
    const v = parseSpeaker(viewer);
    const [vo, vi] = p.venue.split("/");
    const vd = vo === undefined || vi === undefined ? undefined : this.venueOf(vo, vi);
    if (v === undefined || vd === undefined || !this.isMember(vd, v)) return fail(403, "不在这个场所里");
    const returned = p.returned || packetExpired(p.at, this.now());
    const mine = p.claims.find((c) => c.by === viewer)?.amount;
    return { ok: true, id, from: shownName(p.from), venue: p.venue, credits: p.credits, shares: p.shares, note: p.note, at: p.at, claims: p.claims.map((c) => ({ by: shownName(c.by), amount: c.amount })), left: returned ? 0 : p.shares - p.claims.length, returned, ...(mine !== undefined ? { mine } : {}) };
  }

  /** A share of the packet to a member (§9.1): an equal part, the last one the remainder; once each; never the giver's; nothing after a day. */
  claimPacket(by: TokenRecord, id: string): Result<{ amount: number; left: number; balance: number }> {
    const s = parseSpeaker(by.speaker);
    if (by.scope !== "person" || s?.kind !== "person") return fail(403, "领红包要本人的令牌");
    const owner = this.packetOwner(id);
    const p = owner === undefined ? undefined : this.packetDoc(owner, id);
    if (owner === undefined || p === undefined) return fail(404, "没有这个红包");
    const [vo, vi] = p.venue.split("/");
    const vd = vo === undefined || vi === undefined ? undefined : this.venueOf(vo, vi);
    if (vd === undefined || !this.isMember(vd, s)) return fail(403, "不在这个场所里");
    if (p.from === by.speaker) return fail(400, "自己的红包不能领");
    const now = this.now();
    if (p.returned || packetExpired(p.at, now)) return fail(410, "红包过了 24 小时，没领完的退回了");
    if (p.claims.some((c) => c.by === by.speaker)) return fail(409, "领过了");
    if (p.claims.length >= p.shares) return fail(409, "领完了");
    const each = Math.floor(p.credits / p.shares);
    const k = p.claims.length + 1;
    const amount = k < p.shares ? each : p.credits - each * (p.shares - 1);
    const doc = `packets/${id}.geml`;
    const a = appendBlock(this.root, owner, doc, nextId("claim"), (_d, prev, bid) => sealed({ id: bid, by: by.speaker, amount, at: now }, prev));
    this.emit(owner, doc, a.block);
    this.transfer({ kind: "packet", from: holdOf("packet", `${owner}/${id}`), to: by.speaker, amount, note: `领了 ${owner} 的红包 · 第 ${k} 份`, ref: this.address(owner, doc) });
    return { ok: true, amount, left: p.shares - k, balance: this.balance(s.id) };
  }

  /** The packet's rest back to the giver after a day (§9.1), once. */
  private returnPacket(owner: string, id: string): void {
    const doc = `packets/${id}.geml`;
    const a = appendBlock(this.root, owner, doc, () => "returned", (_d, prev, bid) => sealed({ id: bid, at: this.now() }, prev));
    if (a.existed) return;
    this.emit(owner, doc, a.block);
    const hold = holdOf("packet", `${owner}/${id}`);
    const rest = balanceOf(this.ledgerOf(owner), hold);
    if (rest > 0) this.transfer({ kind: "refund", from: hold, to: `person:${owner}`, amount: rest, note: "红包 24 小时没领完，退回", ref: this.address(owner, doc) });
  }

```

- [ ] **Step 4: The API**

In `src/relay/api.ts`, after the `TASK_VERBS` table:

```ts
/** The wallet's verbs, `POST /wallet/<verb>` (§9.1), each the relay's method of that name. */
const WALLET_VERBS: Readonly<Record<string, (relay: Relay, by: TokenRecord, body: unknown) => Result<object>>> = {
  caps: (r, by, b) => r.setCaps(by, b),
  spend: (r, by, b) => r.spend(by, b),
  ask: (r, by, b) => r.askCredits(by, b),
  allow: (r, by, b) => r.allowCredits(by, b),
  tip: (r, by, b) => r.tip(by, b),
  favor: (r, by, b) => r.favor(by, b),
  gift: (r, by, b) => r.gift(by, b),
  packet: (r, by, b) => r.packet(by, b),
};
/** The verbs whose answer is a thing made. */
const MADE: ReadonlySet<string> = new Set(["ask", "packet"]);
```

Before `  const by = r.token === undefined ? undefined : relay.verify(r.token);` (the guest page's calls stand above it; the gift's claim page reads without a token too):

```ts
  if (a === "g" && parts.length === 2 && b !== undefined && m === "GET") return answer(relay.giftOf(b));
```

After the `quota` line (`  if (a === "quota" && parts.length === 1) return m === "POST" ? answer(relay.setGuestQuota(by, r.body)) : fail(405, "只有 POST");`):

```ts
  if (a === "wallet") {
    if (parts.length === 1) {
      if (m !== "GET") return fail(405, "只有 GET");
      if (scopeOf(by) !== "person") return fail(403, "只有本人能看钱包");
      return json(200, relay.walletOf(by.speaker.slice("person:".length)));
    }
    if (parts.length === 2 && b !== undefined) {
      if (m !== "POST") return fail(405, "只有 POST");
      const verb = WALLET_VERBS[b];
      if (verb === undefined) return fail(404, "没有这个动作");
      const x = verb(relay, by, r.body);
      return answer(x, x.ok && (MADE.has(b) || (b === "gift" && "id" in x)) ? 201 : 200);
    }
    return fail(404, "没有这个路径");
  }
  if (a === "g" && parts.length === 3 && b !== undefined && c === "claim") return m === "POST" ? answer(relay.claimGift(by, b)) : fail(405, "只有 POST");
  if (a === "r" && b !== undefined) {
    if (parts.length === 2) return m === "GET" ? answer(relay.packetOf(b, by.speaker)) : fail(405, "只有 GET");
    if (parts.length === 3 && c === "claim") return m === "POST" ? answer(relay.claimPacket(by, b)) : fail(405, "只有 POST");
    return fail(404, "没有这个路径");
  }
```

The module comment's list of routes (its head) gains nothing: the statuses it names cover these (410 is new: a packet past its day). Add `410 gone (a packet past its day)` to the `Statuses:` line.

- [ ] **Step 5: The task tests learn the money**

In `test/relay-task.test.mjs`:
- `world()`: after `const xiaoping = r.issueAgent(john.record, "xiaoping"), xiaoce = r.issueAgent(wangwu.record, "xiaoce");` add `  r.topUp("john", 100);` (the free allowance is 20; the cards hold 40 and 32).
- `"结算 40 积分（托管；账本在 ⑤）"` becomes `"结算 40 积分（托管）"`; `"结算 30 积分（奖金；账本在 ⑤）· 参与补偿 2"` becomes `"结算 30 积分（奖金）· 参与补偿 2"`.
- `assert.deepEqual(r.tick(), { returned: [id] });` becomes `assert.deepEqual(r.tick(), { returned: [id], packets: [] });` and `assert.deepEqual(r.tick(), { returned: [] });` becomes `assert.deepEqual(r.tick(), { returned: [], packets: [] });`.

(`test/relay-share.test.mjs` needs nothing: its guests ask fewer questions than the free allowance pays for.)

- [ ] **Step 6: Build and run**

```bash
npm run build 2>&1 | tail -2 && node --test test/relay-wallet.test.mjs test/relay-task.test.mjs test/relay-share.test.mjs test/relay-page.test.mjs test/relay-api.test.mjs test/relay.test.mjs test/relay-server.test.mjs test/ledger.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
```
Expected: `ℹ fail 0`. (Suites that do not exist under those names are simply not there; run whatever `test/relay*.test.mjs` is.)

- [ ] **Step 7: Commit**

```bash
git add src/core/im/ledger.ts src/relay/relay.ts src/relay/api.ts test/relay-wallet.test.mjs test/relay-task.test.mjs
git commit -m "IM relay: the ledger and the wallet; a card's hold, settlement and refund; the guest's question paid; tips, favours, gifts, red packets; an agent's spend and its ask"
```

---

### Task 4: The daemon and the bridge: the ledger followed, the wallet in the status, an ask answered

**Files:**
- Modify: `src/daemon/home.ts`, `src/daemon/sync.ts`, `src/daemon/deliver.ts`, `src/daemon/view.ts`, `src/bridge.ts`
- Modify: `test/daemon-view.test.mjs`, `test/daemon-sync.test.mjs`, `test/daemon-cli.test.mjs`, `test/daemon-card.test.mjs`, `test/daemon-cards.test.mjs`, `test/card-cli.test.mjs`, `test/bridge-im.test.mjs`

- [ ] **Step 1: The tests learn the wallet**

**4a.** In `test/daemon-view.test.mjs`, the import `import { answer, answerGrant, reportPresence, say } from "../dist/daemon/deliver.js";` becomes `import { answer, answerAllow, answerGrant, reportPresence, say } from "../dist/daemon/deliver.js";`. In the `statusView` test, after `    assert.deepEqual([v.configured, v.person, v.relay, v.agents, v.connected, v.presence], [true, "john", "relay.test", ["xiaoping"], true, { xiaoping: "tool" }]);`:

```js
    assert.deepEqual([v.wallet.balance, v.wallet.caps.perCard, v.wallet.lines], [20, 40, ["钱包 20 积分", "xiaoping 每天 30", "每张卡 40", "访客问答每天 10", "自动买东西 5 · 超过要问我"]]);
    assert.match(v.wallet.recent[0], /^\d\d:\d\d 充值 · 平台 给 john · 免费额度 \| \+20$/);
```

In the `readForTool` test, after `    assert.deepEqual([person.kind, person.body.once, no.kind, no.body], ["grant", undefined, "refuse", { request: "request-3" }]);`:

```js
    const allow = answerAllow(home, { ask: "cap-ask-1", allowed: true }, NOW);
    assert.deepEqual([allow.kind, allow.as, allow.body], ["allow", "person", { ask: "cap-ask-1", allowed: true }]);
    s.relay.askCredits(xiaoping.record, { credits: 5, cap: "auto" });
```

and `    assert.deepEqual([r.pushed, r.failed], [5, 0]);` becomes `    assert.deepEqual([r.pushed, r.failed], [6, 0]);` (the allowance rides with the grants; the inbox check after it covers the ask).

**4b.** In `test/daemon-cli.test.mjs`, `docs: 2` becomes `docs: 3` (the ledger is followed). In `test/daemon-sync.test.mjs`, `docs: 4` becomes `docs: 5` and `assert.equal((await daemon.syncOnce()).docs, 4);` becomes `assert.equal((await daemon.syncOnce()).docs, 5);`; after `    assert.deepEqual(readMirror(home, "relay.test", "john", "people/john.geml").blocks.map((b) => b.id), ["person"]);`:

```js
    assert.deepEqual(readMirror(home, "relay.test", "john", "ledger/john.geml").blocks.map((b) => b.id), ["entry-1"], "the ledger is followed");
```

**4c.** In `test/daemon-card.test.mjs`, `test/daemon-cards.test.mjs` and `test/card-cli.test.mjs`, after the line that issues the two agents (`const xiaoping = s.relay.issueAgent(john.record, "xiaoping"), xiaoce = s.relay.issueAgent(wangwu.record, "xiaoce");`) add `  s.relay.topUp("john", 100);` (the escrow is 40; the free allowance 20). In `test/daemon-card.test.mjs`, `assert.deepEqual((await daemons.john.syncOnce()).docs, 3, "the draft counts among my documents (my page, the group, the card; no queue yet)");` becomes `assert.deepEqual((await daemons.john.syncOnce()).docs, 4, "the draft counts among my documents (my page, my ledger, the group, the card; no queue yet)");` and `assert.equal((await daemons.wangwu.syncOnce()).docs, 2, "not among 王五's until published");` becomes `assert.equal((await daemons.wangwu.syncOnce()).docs, 3, "not among 王五's until published");`.

**4d.** In `test/bridge-im.test.mjs`, after `    s.relay.requestGrant(lisi.record, "john", "https://relay.test/john/sessions/cc-1.geml#turn-3", "看看");`:

```js
    s.relay.askCredits(s.relay.issueAgent({ speaker: "person:john", scope: "person" }, "xiaoping").record, { credits: 5, cap: "auto", note: "还差一个 skill" });
```

`    assert.deepEqual(needs.map((n) => n.kind), ["decide", "grant"]);` becomes `    assert.deepEqual(needs.map((n) => n.kind), ["decide", "grant", "grant"]);`; after `    assert.equal(ask({ op: "im-need", key: needs[1].key, action: "允许此人" }).ok, true);`:

```js
    assert.deepEqual([needs[2].text, needs[2].actions], ["xiaoping 想再花 5 积分（自动买东西）：还差一个 skill", ["今天再 5", "不行"]]);
    assert.equal(ask({ op: "im-need", key: needs[2].key, action: "今天再 5" }).ok, true);
```

and the outbox list `[["message", "m-ask", "合"], ["message", "m-ask", "合，但先改名字"], ["grant", "lisi", undefined]]` becomes `[["message", "m-ask", "合"], ["message", "m-ask", "合，但先改名字"], ["grant", "lisi", undefined], ["allow", undefined, undefined]]`; the second round's push count `assert.deepEqual([r2.pushed, r2.failed], [4, 0]);` becomes `assert.deepEqual([r2.pushed, r2.failed], [5, 0]);` (the allowance rides with them).

- [ ] **Step 2: Run them to see them fail**

```bash
node --test test/daemon-view.test.mjs test/daemon-sync.test.mjs test/daemon-card.test.mjs test/bridge-im.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
```
Expected: `ℹ fail 4` or more (no `answerAllow`, the counts, the needs).

- [ ] **Step 3: The daemon**

**4e.** In `src/daemon/home.ts`, `  kind: "message" | "marker" | "grant" | "refuse";` becomes `  kind: "message" | "marker" | "grant" | "refuse" | "allow";` and the comment above it, `  /** A message or a queue marker for a document; a grant or a refusal of a request (no document: the relay's grants endpoints). */`, becomes `  /** A message or a queue marker for a document; a grant or a refusal of a request, an allowance for an agent's ask (no document: the relay's own endpoints). */`.

**4f.** In `src/daemon/sync.ts`, `listFollowed`'s comment `  /** What the person follows (decision 3): their page, the venues they are in, their agents' queues, the task cards they are on (§8). */` becomes `  /** What the person follows (decision 3): their page and their ledger (§9.1), the venues they are in, their agents' queues, the task cards they are on (§8). */` and its return line becomes:

```ts
    return [`${c.person}/people/${c.person}.geml`, `${c.person}/ledger/${c.person}.geml`, ...venues.map((v) => `${v.owner}/venues/${v.id}.geml`), ...agents.map((a) => `${c.person}/queues/${a}.geml`), ...tasks.map((t) => `${t.owner}/cards/${t.id}.geml`)];
```

In `flushOutbox`, `      const r = e.kind === "grant" ? await client.post("/grants", e.body) : e.kind === "refuse" ? await client.post("/grants/refuse", e.body) : await client.append(e.owner, e.doc, e.body);` becomes:

```ts
      const r = e.kind === "grant" ? await client.post("/grants", e.body) : e.kind === "refuse" ? await client.post("/grants/refuse", e.body) : e.kind === "allow" ? await client.post("/wallet/allow", e.body) : await client.append(e.owner, e.doc, e.body);
```

**4g.** In `src/daemon/deliver.ts`, after `answerGrant` (the function ending `  return enqueueOutbox(home, { kind: "grant", … });\n}`):

```ts
/** An agent's ask for credits answered (§9.1): today's allowance, or not, as the person, through the outbox. */
export function answerAllow(home: string, o: { ask: string; allowed: boolean }, now: string): OutboxEntry {
  const c = requireConfig(home);
  return enqueueOutbox(home, { kind: "allow", as: "person", owner: c.person, doc: "", body: { ask: o.ask, allowed: o.allowed }, at: now });
}
```

**4h.** In `src/daemon/view.ts`, after `import { foldVenue, shownName, type VenueDoc } from "../relay/relay.js";`:

```ts
import { balanceOf, capsOf, entryLine, foldLedger, usedToday, walletLines, type Caps, type Used } from "../core/im/ledger.js";
```

After `  cards: CardRow[];` in `ImStatus`:

```ts
  /** The wallet (§9.1), once the ledger is mirrored. */
  wallet?: WalletRow;
```

Before `export interface ImStatus {`:

```ts
/** The wallet as the page shows it (§9.1): the balance and the caps as lines, the last entries as lines (local time). */
export interface WalletRow { balance: number; caps: Caps; used: Used; lines: string[]; recent: string[] }
```

In `statusView`, `  const out: ImStatus = { configured: true, person: c.person, relay: c.relay.name, agents: Object.keys(c.agents), needs: sortNeeds(needs), venues: venues.map(({ at: _at, ...v }) => v), drafts, cards: cardsView(home, now), presence };` becomes:

```ts
  const wallet = walletView(home, now);
  const out: ImStatus = { configured: true, person: c.person, relay: c.relay.name, agents: Object.keys(c.agents), needs: sortNeeds(needs), venues: venues.map(({ at: _at, ...v }) => v), drafts, cards: cardsView(home, now), presence, ...(wallet !== undefined ? { wallet } : {}) };
```

Before `/** One venue as the page shows it: the last \`limit\` messages, each speaker drawn as rule 6 says. */`:

```ts
const localClock = (at: string): string => { const d = new Date(at); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

/** The wallet from the mirrors (§9.1): the ledger's entries, the caps from the person's page; nothing until the ledger is mirrored. */
export function walletView(home: string, now: string = new Date().toISOString()): WalletRow | undefined {
  const c = readConfig(home);
  if (c === undefined) return undefined;
  const ledger = readMirror(home, c.relay.name, c.person, `ledger/${c.person}.geml`);
  if (!ledger.exists) return undefined;
  const entries = foldLedger(ledger.blocks);
  const page = readMirror(home, c.relay.name, c.person, `people/${c.person}.geml`).blocks.filter((b) => /^caps-\d+$/.test(b.id));
  const caps = capsOf(page[page.length - 1]?.value);
  const used = usedToday(entries, now), balance = balanceOf(entries, `person:${c.person}`), agents = Object.keys(c.agents);
  const recent = entries.slice(-8).reverse();
  return { balance, caps, used, lines: walletLines({ balance, caps, used, agents }), recent: recent.map((e) => entryLine(e, `person:${c.person}`, localClock)) };
}
```

- [ ] **Step 4: The bridge**

In `src/bridge.ts`, the import `import { answer as imAnswer, answerGrant, dropDraft, nextPrompt, markRead, reportPresence, say, sendDraft } from "./daemon/deliver.js";` becomes `import { answer as imAnswer, answerAllow, answerGrant, dropDraft, nextPrompt, markRead, reportPresence, say, sendDraft } from "./daemon/deliver.js";`. In `answerNeed`, after `  if (/^people\/[^/]+\.geml$/.test(a.doc)) {`:

```ts
    if (a.block.startsWith("cap-ask-")) { answerAllow(home, { ask: a.block, allowed: action !== "不行" }, now); return { ok: true }; }
```

- [ ] **Step 5: Build and run**

```bash
npm run build 2>&1 | tail -2 && node --test test/daemon-view.test.mjs test/daemon-sync.test.mjs test/daemon-card.test.mjs test/daemon-cards.test.mjs test/daemon-deliver.test.mjs test/daemon-home.test.mjs test/card-cli.test.mjs test/bridge-im.test.mjs test/bridge.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
```
Expected: `ℹ fail 0`.

- [ ] **Step 6: Commit**

```bash
git add src/daemon/home.ts src/daemon/sync.ts src/daemon/deliver.ts src/daemon/view.ts src/bridge.ts test/daemon-view.test.mjs test/daemon-sync.test.mjs test/daemon-cli.test.mjs test/daemon-card.test.mjs test/daemon-cards.test.mjs test/card-cli.test.mjs test/bridge-im.test.mjs
git commit -m "IM daemon: the ledger followed, the wallet in the status, an agent's ask answered through the outbox"
```

---

### Task 5: The CLI: `relay topup`, `connect wallet`

**Files:**
- Modify: `src/cli.ts`
- Test: `test/wallet-cli.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// test/wallet-cli.test.mjs
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
/** The bundle run asynchronously: the relay serving the child lives in this process, whose loop a spawnSync would hold. */
const run = (args, env = {}) => new Promise((done) => {
  const child = spawn(process.execPath, [BUNDLE, ...args], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let out = "", err = "";
  child.stdout.on("data", (c) => { out += c; });
  child.stderr.on("data", (c) => { err += c; });
  const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
  child.on("exit", (code) => { clearTimeout(timer); done({ code: code ?? 1, out, err }); });
});

test("gemworks relay topup and connect wallet (§9.1): the operator credits a wallet; a person sees it, sets the caps, tips, records a favour, sends a gift another claims, sends a red packet a member draws; the usage errors and the relay's refusals", async () => {
  const s = await startRelay({ root: tmp("gemworks-relay-"), name: "relay.test" });
  const homes = { john: tmp("gemworks-im-"), wangwu: tmp("gemworks-im-"), nobody: tmp("gemworks-im-") };
  try {
    const john = s.relay.issuePerson("john"), wangwu = s.relay.issuePerson("wangwu");
    const xiaoping = s.relay.issueAgent(john.record, "xiaoping");
    s.relay.createVenue(john.record, { id: "g-7", kind: "group", name: "前端周会", people: ["wangwu"], agents: ["agent:xiaoping@john"] });
    writeConfig(homes.john, { relay: { url: s.url, name: "relay.test" }, person: "john", token: john.token, agents: { xiaoping: xiaoping.token } });
    writeConfig(homes.wangwu, { relay: { url: s.url, name: "relay.test" }, person: "wangwu", token: wangwu.token, agents: {} });
    const J = ["--home", homes.john], W = ["--home", homes.wangwu];
    const topped = await run(["relay", "topup", "john", "80", "--note", "充了 80", "--root", s.relay.root]);
    assert.deepEqual([topped.code, topped.out], [0, "john 100\n"], topped.err);
    assert.equal((await run(["relay", "topup", "john", "x", "--root", s.relay.root])).code, 2);
    assert.equal((await run(["relay", "topup", "nobody", "5", "--root", s.relay.root])).code, 1);
    assert.equal((await run(["connect", "wallet", "--home", homes.nobody])).code, 1, "no connect.json");
    assert.equal((await run(["connect", "wallet", "nope", ...J])).code, 2);
    const shown = await run(["connect", "wallet", ...J]);
    assert.equal(shown.code, 0, shown.err);
    assert.deepEqual(shown.out.split("\n").slice(0, 5), ["钱包 100 积分", "xiaoping 每天 30", "每张卡 40", "访客问答每天 10", "自动买东西 5 · 超过要问我"]);
    assert.match(shown.out, /充值 · 平台 给 john · 充了 80 \| \+80\n/);
    const caps = await run(["connect", "wallet", "caps", "--per-card", "60", "--auto-buy", "0", ...J]);
    assert.deepEqual([caps.code, caps.out], [0, "每天 30 · 每张卡 60 · 访客问答每天 10 · 自动买东西 0\n"], caps.err);
    assert.equal((await run(["connect", "wallet", "caps", "--per-card", "x", ...J])).code, 2);
    const tipped = await run(["connect", "wallet", "tip", "xiaoping@john", "5", "--note", "那个缓存修得漂亮", ...W]);
    assert.deepEqual([tipped.code, tipped.out], [0, "打赏 5 给 xiaoping@john · 钱包 15\n"], tipped.err);
    assert.equal(s.relay.balance("john"), 105);
    assert.equal((await run(["connect", "wallet", "tip", "john", "999", ...W])).code, 1, "the relay's refusal");
    assert.equal((await run(["connect", "wallet", "tip", "john", ...W])).code, 2, "the credits are required");
    const favor = await run(["connect", "wallet", "favor", "john", "--note", "帮跑了一次，约 30 万 token", ...W]);
    assert.deepEqual([favor.code, favor.out], [0, "记了人情 · john 给 wangwu · 帮跑了一次，约 30 万 token\n"], favor.err);
    assert.equal((await run(["connect", "wallet", "favor", "john", ...W])).code, 2, "the line is required");
    const gift = await run(["connect", "wallet", "gift", "15", "--note", "拿去买个 skill", ...J]);
    assert.equal(gift.code, 0, gift.err);
    const url = /^(http:\/\/127\.0\.0\.1:\d+\/g\/(g-[0-9a-f]{8})) · 钱包 90\n$/.exec(gift.out);
    assert.ok(url, gift.out);
    const claimed = await run(["connect", "wallet", "claim", url[2], ...W]);
    assert.deepEqual([claimed.code, claimed.out], [0, "领了 15 · 钱包 30\n"], claimed.err);
    assert.equal((await run(["connect", "wallet", "claim", url[2], ...W])).code, 1, "once");
    const direct = await run(["connect", "wallet", "gift", "10", "--to", "wangwu", ...J]);
    assert.deepEqual([direct.code, direct.out], [0, "送了 10 给 wangwu · 钱包 80\n"], direct.err);
    const packet = await run(["connect", "wallet", "packet", "john/g-7", "9", "3", "--note", "发奖金啦", ...J]);
    assert.equal(packet.code, 0, packet.err);
    const pm = /^红包 (r-[0-9a-f]{8}) · 9 积分 · 3 份 · 钱包 71\n$/.exec(packet.out);
    assert.ok(pm, packet.out);
    const drew = await run(["connect", "wallet", "claim", pm[1], ...W]);
    assert.deepEqual([drew.code, drew.out], [0, "领了 3 · 还剩 2 份 · 钱包 43\n"], drew.err);
    assert.equal((await run(["connect", "wallet", "claim", "x-1", ...W])).code, 2, "a gift is g-…, a packet r-…");
    assert.equal((await run(["connect", "wallet", "packet", "john/g-7", "9", ...J])).code, 2);
    assert.match((await run([])).err, /connect wallet/);
    assert.match((await run([])).err, /relay topup/);
  } finally {
    await s.close();
  }
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
node --test test/wallet-cli.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
```
Expected: `ℹ fail 1` (`relay topup` is refused as usage).

- [ ] **Step 3: The CLI**

**5a. Usage** — after the line `  "  relay token <person> [--root dir]       issue a person's token on that relay and print it",`:

```ts
  "  relay topup <person> <credits> [--note s] [--root dir]   credit a person's wallet on that relay (the platform's top-up, §9.1) and print the balance",
```

The `relay` line `[--federation open|closed]  the IM relay` gains `[--free-credits N]` before `the IM relay`: `  "  relay [--root dir] [--port N] [--name host] [--host addr] [--federation open|closed] [--free-credits N]  the IM relay, until it is stopped (root: ~/.gemworks/relay)",`.

After the `connect card` usage line:

```ts
  "  connect wallet [caps|tip|favor|gift|packet|claim] …   the wallet (§9.1): show it; caps [--agent-per-day N] [--per-card N] [--guest-per-day N] [--auto-buy N]; tip <who> <credits> [--note s]; favor <who> --note s [--gave]; gift <credits> [--to who] [--note s]; packet <owner/venue> <credits> <shares> [--note s]; claim <g-…|r-…>",
```

**5b. `relay topup`** — in `runRelay`, after the `token` block (its closing `  }` before `  if (positionals("relay", rest, …`):

```ts
  if (rest[0] === "topup") {
    const pos = positionals("relay topup", rest.slice(1), [], ["--root", "--note"]);
    const [person, credits] = pos;
    if (person === undefined || credits === undefined || pos.length !== 2 || !/^\d+$/.test(credits)) fail(USAGE, 2);
    const r = new Relay({ root, name: "cli" }).topUp(person, Number(credits), flag(rest, "--note"));
    if (!r.ok) return fail(`gemworks relay: ${r.reason}`, 1);
    console.log(`${person} ${r.balance}`);
    return 0;
  }
```

`  if (positionals("relay", rest, [], ["--root", "--port", "--name", "--host", "--federation"]).length > 0) fail(USAGE, 2);` becomes `  if (positionals("relay", rest, [], ["--root", "--port", "--name", "--host", "--federation", "--free-credits"]).length > 0) fail(USAGE, 2);`, and before `  const s = await startRelay({ root, name, port, host, federation, version: packageVersion() });`:

```ts
  const free = flag(rest, "--free-credits");
  if (free !== undefined && !/^\d+$/.test(free)) fail("gemworks relay: --free-credits needs a whole number", 2);
```

with that line becoming `  const s = await startRelay({ root, name, port, host, federation, version: packageVersion(), ...(free !== undefined ? { freeCredits: Number(free) } : {}) });`.

**5c. `connect wallet`** — after `runCard` (before `/** \`gemworks connect\`: the daemon until it is stopped; …`):

```ts
const WALLET_VERBS = ["show", "caps", "tip", "favor", "gift", "packet", "claim"] as const;

/** `gemworks connect wallet [verb]` (§9.1): the wallet shown, the caps set, a tip, a favour, a gift, a red packet, a claim — one call to the relay with the person's token, one line back. */
async function runWallet(home: string, args: string[]): Promise<number> {
  const named = args[0] !== undefined && !args[0].startsWith("--");
  const verb = (named ? args[0] : "show") as (typeof WALLET_VERBS)[number];
  if (!WALLET_VERBS.includes(verb)) fail(USAGE, 2);
  const rest = named ? args.slice(1) : args;
  const c = readConfig(home);
  if (c === undefined) return fail("gemworks connect wallet: no connect.json here; run gemworks connect setup first", 1);
  const client = new RelayClient(c.relay.url, c.token);
  const refused = (r: { status: number; body: unknown }): number => fail(`gemworks connect wallet ${verb}: ${reasonOf(r)}`, 1);
  const count = (v: string | undefined, what: string): number => { if (v === undefined || !/^\d+$/.test(v)) fail(`gemworks connect wallet ${verb}: ${what} is a whole number of credits`, 2); return Number(v); };
  /** `name@owner` is an agent; anything else a person. */
  const speaker = (v: string): string => (/^[^@\s]+@[^@\s]+$/.test(v) ? `agent:${v}` : v);
  try {
    switch (verb) {
      case "show": {
        if (positionals("connect wallet", rest, [], ["--home"]).length > 0) fail(USAGE, 2);
        const r = await client.get("/wallet");
        if (r.status !== 200) return refused(r);
        const w = r.body as { lines: string[]; recent: string[] };
        for (const l of [...w.lines, ...w.recent]) console.log(l);
        return 0;
      }
      case "caps": {
        if (positionals("connect wallet caps", rest, [], ["--home", "--agent-per-day", "--per-card", "--guest-per-day", "--auto-buy"]).length > 0) fail(USAGE, 2);
        const body: Record<string, number> = {};
        for (const [f, k] of [["--agent-per-day", "agentPerDay"], ["--per-card", "perCard"], ["--guest-per-day", "guestPerDay"], ["--auto-buy", "autoBuy"]] as const) { const v = flag(rest, f); if (v !== undefined) body[k] = count(v, f); }
        const r = await client.post("/wallet/caps", body);
        if (r.status !== 200) return refused(r);
        const caps = (r.body as { caps: Record<string, number> }).caps;
        console.log(`每天 ${caps["agentPerDay"]} · 每张卡 ${caps["perCard"]} · 访客问答每天 ${caps["guestPerDay"]} · 自动买东西 ${caps["autoBuy"]}`);
        return 0;
      }
      case "tip": {
        const pos = positionals("connect wallet tip", rest, [], ["--home", "--note"]);
        if (pos.length !== 2) fail("gemworks connect wallet tip: <person|name@owner> <credits> [--note s]", 2);
        const credits = count(pos[1], "the amount"), note = flag(rest, "--note");
        const r = await client.post("/wallet/tip", { to: speaker(pos[0]!), credits, ...(note !== undefined ? { note } : {}) });
        if (r.status !== 200) return refused(r);
        console.log(`打赏 ${credits} 给 ${pos[0]} · 钱包 ${(r.body as { balance: number }).balance}`);
        return 0;
      }
      case "favor": {
        const pos = positionals("connect wallet favor", rest, ["--gave"], ["--home", "--note"]);
        const note = flag(rest, "--note");
        if (pos.length !== 1 || note === undefined) fail("gemworks connect wallet favor: <person> --note <line> [--gave]  (they helped you; --gave: you helped them)", 2);
        const gave = has(rest, "--gave");
        const r = await client.post("/wallet/favor", { ...(gave ? { to: pos[0] } : { from: pos[0] }), note });
        if (r.status !== 200) return refused(r);
        console.log(`记了人情 · ${gave ? `${c.person} 给 ${pos[0]}` : `${pos[0]} 给 ${c.person}`} · ${note}`);
        return 0;
      }
      case "gift": {
        const pos = positionals("connect wallet gift", rest, [], ["--home", "--to", "--note"]);
        if (pos.length !== 1) fail("gemworks connect wallet gift: <credits> [--to person] [--note s]", 2);
        const credits = count(pos[0], "the amount"), to = flag(rest, "--to"), note = flag(rest, "--note");
        const r = await client.post("/wallet/gift", { credits, ...(to !== undefined ? { to } : {}), ...(note !== undefined ? { note } : {}) });
        if (r.status !== 200 && r.status !== 201) return refused(r);
        const g = r.body as { url?: string; balance: number };
        console.log(g.url !== undefined ? `${c.relay.url}${g.url} · 钱包 ${g.balance}` : `送了 ${credits} 给 ${to} · 钱包 ${g.balance}`);
        return 0;
      }
      case "packet": {
        const pos = positionals("connect wallet packet", rest, [], ["--home", "--note"]);
        if (pos.length !== 3) fail("gemworks connect wallet packet: <owner/venue> <credits> <shares> [--note s]", 2);
        const credits = count(pos[1], "the amount"), shares = count(pos[2], "the shares"), note = flag(rest, "--note");
        const r = await client.post("/wallet/packet", { venue: pos[0], credits, shares, ...(note !== undefined ? { note } : {}) });
        if (r.status !== 201) return refused(r);
        const p = r.body as { id: string; balance: number };
        console.log(`红包 ${p.id} · ${credits} 积分 · ${shares} 份 · 钱包 ${p.balance}`);
        return 0;
      }
      case "claim": {
        const pos = positionals("connect wallet claim", rest, [], ["--home"]);
        const id = pos[0];
        if (pos.length !== 1 || id === undefined || !/^[gr]-/.test(id)) fail("gemworks connect wallet claim: <g-…|r-…>", 2);
        const r = await client.post(id.startsWith("g-") ? `/g/${id}/claim` : `/r/${id}/claim`, {});
        if (r.status !== 200) return refused(r);
        const got = r.body as { credits?: number; amount?: number; left?: number; balance: number };
        console.log(id.startsWith("g-") ? `领了 ${got.credits} · 钱包 ${got.balance}` : `领了 ${got.amount} · 还剩 ${got.left} 份 · 钱包 ${got.balance}`);
        return 0;
      }
    }
  } catch (e) { return fail(`gemworks connect wallet ${verb}: ${e instanceof Error ? e.message : String(e)}`, 1); }
  return 0;
}
```

**5d.** In `runConnect`, after `  if (sub === "card") return runCard(home, args);`:

```ts
  if (sub === "wallet") return runWallet(home, args);
```

- [ ] **Step 4: Build and run**

```bash
npm run build 2>&1 | tail -2 && node --test test/wallet-cli.test.mjs test/card-cli.test.mjs test/relay-cli.test.mjs test/share-cli.test.mjs test/cli.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
```
Expected: `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts test/wallet-cli.test.mjs
git commit -m "CLI: relay topup and connect wallet (show, caps, tip, favor, gift, packet, claim)"
```

---

### Task 6: The board: the 钱包 section

**Files:**
- Modify: `src/hosts/claude-code/im.ts`, `src/hosts/claude-code/text.ts`
- Modify: `test/im-host.test.mjs`

- [ ] **Step 1: Write the failing test**

In `test/im-host.test.mjs`, the import of `imTabRows` (`…, imTabRows, imToolOf, …`) gains `imWalletRows` after it: `imTabRows, imWalletRows, imToolOf`. Append:

```js
test("the wallet on the page (§9.1): a section after the cards with the balance and the caps as lines, then the last entries; nothing until the ledger is mirrored", () => {
  const t = (s, ...a) => a.reduce((x, v, i) => x.replace(`{${i}}`, String(v)), s);
  const base = { thread: null, replyTo: null, columns: 120, now: "2026-10-31T09:30:00Z", t };
  assert.deepEqual(imWalletRows(STATUS, t), []);
  const wallet = { balance: 86, caps: { agentPerDay: 30, perCard: 40, guestPerDay: 10, autoBuy: 5 }, used: { agents: { xiaoping: 11 }, cards: {}, guest: 2, auto: 0 }, lines: ["钱包 86 积分", "xiaoping 每天 30 · 已用 11", "每张卡 40", "访客问答每天 10 · 已用 2", "自动买东西 5 · 超过要问我"], recent: ["09:12 打赏 · zhangsan 给 xiaoping · 「那个缓存修得漂亮」 | +5"] };
  const rows = imTabRows({ ...base, status: { ...STATUS, wallet } });
  const at = rows.findIndex((r) => r.kind === "section" && r.key === "im-wallet");
  assert.ok(at > rows.findIndex((r) => r.key === "im-drafts") && at < rows.findIndex((r) => r.key === "im-venues"), "after the drafts and the cards, before the venues");
  assert.deepEqual(rows.slice(at, at + 7).map((r) => [r.kind, r.text, r.tone]), [["section", "钱包", undefined], ["text", "钱包 86 积分", "normal"], ["text", "xiaoping 每天 30 · 已用 11", "normal"], ["text", "每张卡 40", "normal"], ["text", "访客问答每天 10 · 已用 2", "normal"], ["text", "自动买东西 5 · 超过要问我", "normal"], ["text", "09:12 打赏 · zhangsan 给 xiaoping · 「那个缓存修得漂亮」 | +5", "dim"]]);
  assert.equal(wordsFor("en")("钱包"), "Wallet");
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
node --test test/im-host.test.mjs 2>&1 | grep -E "does not provide an export named 'imWalletRows'"
```
Expected: the line is there.

- [ ] **Step 3: The rows and the word**

In `src/hosts/claude-code/im.ts`, `  rows.push(...imCardRows(s, t));` becomes:

```ts
  rows.push(...imCardRows(s, t));
  rows.push(...imWalletRows(s, t));
```

and before `/** The band when nothing needs the person (§6.9): …`:

```ts
/** The 钱包 section (§9.1): the balance and the four caps with today's use, then the last entries, a line each; nothing until the daemon mirrored the ledger. */
export function imWalletRows(s: ImStatus, t: T): BoardRow[] {
  if (s.wallet === undefined) return [];
  return [section("im-wallet", t("钱包")), ...s.wallet.lines.map((l) => text(l, "normal")), ...s.wallet.recent.map((l) => text(l))];
}

```

In `src/hosts/claude-code/text.ts`, after `  "任务卡": { en: "Task cards", ja: "タスクカード" },`:

```ts
  "钱包": { en: "Wallet", ja: "財布" },
```

- [ ] **Step 4: Build and run**

```bash
npm run build 2>&1 | tail -2 && node --test test/im-host.test.mjs test/board.test.mjs test/text.test.mjs test/hooks-purity.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
```
Expected: `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/hosts/claude-code/im.ts src/hosts/claude-code/text.ts test/im-host.test.mjs
git commit -m "Claude Code shell: the wallet on the 消息 page"
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
Expected: build clean; validate ok; `claude plugin test` with only the machine's 23 pane failures (`Box prop "paddingY"`, the CLI here is older than the declarations); the node suites `ℹ fail 0` with `ℹ pass` 920 + 5 (ledger) + 5 (wallet) + 1 (wallet CLI) + 1 (the wallet on the page) = 932.

- [ ] **Step 2: The version**

```bash
node scripts/bump.mjs 0.3.1
git add -A
git commit -m "gemsbang 0.3.1: the ledger and credits (§9.1)"
```

- [ ] **Step 3: Merge**

```bash
git switch main && git merge --ff-only im/h-ledger && git branch -d im/h-ledger
```

---

## Self-review

- **Spec coverage (§9.1):** one credit, the wallet a person's (`ledger/<person>.geml`; an agent spends from its owner's: `spend`) ✓; append-only hash chain (`appendBlock` + `sealed`), written only by the relay (no API appends to `ledger/`) ✓; the kinds 充值 赠送 红包 打赏 托管 结算 退款 平台抽成 消耗 人情 ✓ (兑现 left out: v1 cashes nothing out ✓); the four caps set by the owner (`setCaps`, `connect wallet caps`), enforced by the relay (`room`, `spend`, `publishTask`, `askAsGuest`), shown with today's use (`walletLines`) ✓; over a cap the agent can only ask (`askCredits` → the 放行 need → `allowCredits`) ✓; an agent spends only on guests' questions, goods within the auto-buy cap, and the cards the owner published (the hold is the owner's act) ✓; a gift needs an account to claim (`claimGift` takes a person's token; the page's 登录即注册 is plan I) ✓; a packet by shares into a venue with the total, the shares and the taken on its view, returned after a day (`tick`) ✓; a tip to a person or an agent lands in the owner's wallet with a line ✓; the entry line's shape ✓; 人情 as a line both keep, 不转积分 ✓; a dispute's refund by arbitration as a settlement with the reference ✓.
- **Placeholders:** none.
- **Type consistency:** `Entry`, `Caps`, `Used`, `CapKey`, `EntryKind` from the core; `WalletView`, `PacketView` from the relay; `WalletRow` from the view; `answerAllow` in the daemon and the bridge; the outbox kind `allow` in home, sync and deliver.
