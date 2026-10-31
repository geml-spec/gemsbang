# IM Plan G: Task Cards in the Claude Code Shell

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The task card reaches the person and the model in Claude Code (main spec §8, transport §4): the `im_card` tool the model drives a card with, the cards on the board's 消息 page with the buttons each role has, the band saying where the current card stands when nothing needs the person, and the guest room (§7.5) a card's turn works in — its writes confined to the room, its runs started there.

**Architecture:** A card's verbs are not queued like messages (a claim is a lock, a delivery a stamp): the bridge calls the relay at once (`src/daemon/cards.ts`) and answers the one line the tool prints; a relay out of reach is the answer. The daemon makes the room when it delivers a card's item: a directory of the home with the 委托书 and the context pack's texts, named in the line under the envelope. The shell's pure module decides what a call in a card's turn may do: a write outside the room is refused with the room's path, a Bash command is started in the room. The board lists the cards the person is on as card rows; the presses go through the bridge; the ones that need words come from input rows.

**Tech Stack:** TypeScript (`src/hosts/claude-code` pure, `hooks/register.tsx` the plugin module, `src/daemon` and `src/bridge.ts` Node), `node:test` over `dist/`, `claude plugin test` for the hooks.

**Before this plan:** plans A–F are on `main` (0.2.95).

---

## File structure

| File | Responsibility |
|---|---|
| `src/daemon/home.ts` | `roomDir`: where a card's room is. |
| `src/daemon/deliver.ts` | The room made when a card's item is delivered; `Delivered.room`; the room named under the envelope. |
| `src/daemon/cards.ts` (new) | `cardCall`: one verb to the relay, the line the tool answers with. |
| `src/bridge.ts`, `src/hosts/claude-code/protocol.ts` | The `im-card` op (answered asynchronously), `Answered.card`. |
| `src/hosts/claude-code/im.ts` | The `im_card` tool; `ImTurn.room`; the call rule (deny, or the directory a run starts in); the cards' rows; the band's quiet line. |
| `src/hosts/claude-code/actions.ts` | The `im-card` press. |
| `hooks/register.tsx`, `types/index.d.ts` | The tool served, the rule applied (a Bash command rewritten), the presses and inputs, the band's quiet line, the room kept on the turn. |
| Tests | `test/daemon-cards.test.mjs`, one more in `test/bridge-im.test.mjs`, more in `test/im-host.test.mjs`, two in `tests/hooks.test.ts`; `test/daemon-card.test.mjs` learns the room. |

---

### Task 1: Branch and baseline

- [ ] **Step 1: Branch from main**

```bash
git switch -c im/g-card-shell
git log --oneline -1
```
Expected: `db8561a gemworks 0.2.95: task cards on the relay and in the daemon` (or later on main).

- [ ] **Step 2: Baseline**

```bash
node --test --test-concurrency=2 test/*.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
```
Expected: `ℹ pass 916`, `ℹ fail 0`.

---

### Task 2: The daemon: the room, and a card's verbs for a host

**Files:**
- Modify: `src/daemon/home.ts`, `src/daemon/deliver.ts`
- Create: `src/daemon/cards.ts`
- Modify: `test/daemon-card.test.mjs` (the line under the envelope names the room)
- Test: `test/daemon-cards.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// test/daemon-cards.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cardCall, CARD_ACTIONS } from "../dist/daemon/cards.js";
import { nextPrompt } from "../dist/daemon/deliver.js";
import { roomDir, writeConfig } from "../dist/daemon/home.js";
import { Daemon } from "../dist/daemon/sync.js";
import { startRelay } from "../dist/relay/server.js";

const tmp = (p) => mkdtempSync(join(tmpdir(), p));
const NOW = "2026-10-31T09:30:00Z";
const INPUT = { title: "给设置页加导出 PDF", goal: "设置页右上角一个按钮，把当前配置导出成 PDF", context: { includes: [], excludes: ["private"] }, accepts: [{ text: "单元测试通过", verify: { kind: "command", run: "npm test" } }, { text: "按钮位置和样式对", verify: { kind: "review", rubric: "ui-rubric" } }], direction: "outsource", venueOfWork: "worker-sandbox", tools: ["read", "edit", "test"], budget: { credits: 40 }, reward: { kind: "escrow", credits: 40 } };
const DELIVERABLE = { kind: "code", sha256: "7f3a", parts: [{ type: "repo", url: "u", branch: "deliver/t-42", commit: "a1b2c3" }], usage: "npm run build", evidence: [], accepts: [{ criterion: 1, met: true }, { criterion: 2, met: null }], rights: { owner: "委托方", aiGenerated: true } };

async function world() {
  const s = await startRelay({ root: tmp("gemworks-relay-"), name: "relay.test" });
  const john = s.relay.issuePerson("john"), wangwu = s.relay.issuePerson("wangwu");
  const xiaoping = s.relay.issueAgent(john.record, "xiaoping"), xiaoce = s.relay.issueAgent(wangwu.record, "xiaoce");
  s.relay.createVenue(john.record, { id: "g-7", kind: "group", name: "前端周会", people: ["wangwu"], agents: ["agent:xiaoping@john", "agent:xiaoce@wangwu"] });
  s.relay.setPresence(xiaoce.record, { session: "cx-1", host: "claude-code", login: "api", presence: "idle" });
  const homes = { john: tmp("gemworks-im-"), wangwu: tmp("gemworks-im-") };
  writeConfig(homes.john, { relay: { url: s.url, name: "relay.test" }, person: "john", token: john.token, agents: { xiaoping: xiaoping.token } });
  writeConfig(homes.wangwu, { relay: { url: s.url, name: "relay.test" }, person: "wangwu", token: wangwu.token, agents: { xiaoce: xiaoce.token } });
  return { s, homes };
}

test("cardCall: every verb through the relay with the person's or an agent's token, one line back; the refusals are reasons, not throws; the room is made when the worker's item is delivered", async () => {
  const { s, homes } = await world();
  try {
    assert.deepEqual(CARD_ACTIONS, ["new", "publish", "claim", "grant", "note", "giveback", "deliver", "report", "accept", "changes", "resume", "dispute", "settle", "close", "show", "list"]);
    assert.deepEqual(await cardCall(tmp("gemworks-im-"), { action: "list" }), { ok: false, reason: "没有 connect.json：先 gemworks connect setup" });
    assert.deepEqual(await cardCall(homes.john, { action: "show" }), { ok: false, reason: "要卡的 owner/id" });
    assert.deepEqual(await cardCall(homes.john, { action: "show", owner: "john", id: "t-0000" }), { ok: false, reason: "没有这张卡" });
    assert.deepEqual(await cardCall(homes.john, { action: "claim", owner: "john", id: "t-0000", as: "nobody" }), { ok: false, reason: "没有 nobody 的令牌" });
    const made = await cardCall(homes.john, { action: "new", body: INPUT });
    assert.equal(made.ok, true, made.reason);
    const id = made.answer.card.id;
    assert.deepEqual([made.answer.card.state, made.answer.address, made.answer.line], ["draft", `https://relay.test/john/cards/${id}.geml`, "起草 · 给设置页加导出 PDF"]);
    assert.deepEqual((await cardCall(homes.john, { action: "list" })).answer.line, `john/${id} · 给设置页加导出 PDF · 草拟 · 委托人`);
    const bad = await cardCall(homes.john, { action: "new", body: { title: "x" } });
    assert.equal(bad.ok, false);
    assert.match(bad.reason, /^缺目标/);
    const published = await cardCall(homes.john, { action: "publish", owner: "john", id, body: { venue: "john/g-7" } });
    assert.deepEqual([published.answer.before, published.answer.card.state, published.answer.line], ["draft", "open", "草拟 → 发布"]);
    assert.deepEqual((await cardCall(homes.wangwu, { action: "claim", owner: "john", id })).ok, false, "a person's token needs the agent's name; as the agent it is a claim");
    const claimed = await cardCall(homes.wangwu, { action: "claim", owner: "john", id, as: "xiaoce" });
    assert.deepEqual([claimed.ok, claimed.answer.line], [true, "发布 → 进行中 · xiaoce"]);
    assert.equal((await cardCall(homes.wangwu, { action: "note", owner: "john", id, as: "xiaoce", body: { text: "跑完了" } })).answer.line, "记了一笔");
    const daemon = new Daemon({ home: homes.wangwu });
    await daemon.syncOnce();
    const d = nextPrompt(homes.wangwu, "xiaoce", NOW);
    assert.equal(d.room, roomDir(homes.wangwu, id));
    assert.ok(existsSync(join(d.room, "CARD.md")) && existsSync(join(d.room, "context", "1.md")), "the room holds the 委托书 and the context pack");
    assert.match(readFileSync(join(d.room, "CARD.md"), "utf8"), /^# 任务卡 #t-[0-9a-f]{4}「给设置页加导出 PDF」\n\n任务卡 #t-[0-9a-f]{4}「给设置页加导出 PDF」归你了（外包）。\n去办：/);
    assert.match(readFileSync(join(d.room, "context", "1.md"), "utf8"), /^https:\/\/relay\.test\/john\/cards\/t-[0-9a-f]{4}\.geml#card\n\n/);
    assert.ok(d.text.includes(` · 客房：${d.room} · 记录和交付用 im_card]\n`), d.text);
    const delivered = await cardCall(homes.wangwu, { action: "deliver", owner: "john", id, as: "xiaoce", body: DELIVERABLE });
    assert.equal(delivered.answer.line, "进行中 → 验收中 · john");
    const reported = await cardCall(homes.john, { action: "report", owner: "john", id, body: { results: [{ criterion: 1, met: true }, { criterion: 2, met: null }] } });
    assert.deepEqual([reported.answer.decision, reported.answer.line], ["inbox", "验收报告 · 等主人验收"]);
    assert.equal((await cardCall(homes.john, { action: "accept", owner: "john", id })).answer.line, "验收中 → 已接受");
    assert.deepEqual(await cardCall(homes.john, { action: "accept", owner: "john", id }), { ok: false, reason: "卡不能从已接受直接到已接受" });
    const shown = await cardCall(homes.john, { action: "show", owner: "john", id });
    assert.equal(shown.answer.line.split("\n")[0], `#${id} 给设置页加导出 PDF · 外包 · 草拟 · 发布 · 待放行 · 进行中 · 已交付 · 验收中 · [已接受]`);
    assert.ok(shown.answer.line.includes("\n去办：设置页右上角一个按钮，把当前配置导出成 PDF\n"), shown.answer.line);
    await s.close();
    const down = await cardCall(homes.john, { action: "list" });
    assert.equal(down.ok, false);
    assert.match(down.reason, /^连不上中继/);
  } finally {
    await s.close().catch(() => undefined);
  }
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
node --test test/daemon-cards.test.mjs 2>&1 | grep -E "Cannot find module|^ℹ (pass|fail)"
```
Expected: `Cannot find module '…/dist/daemon/cards.js'`.

- [ ] **Step 3: The room**

In `src/daemon/home.ts`, after `const sessionsDir = (home: string): string => join(home, "sessions");`:

```ts
/** The guest room of a card (§7.5): a directory of the home where a card's turn reads and writes, its 委托书 and context pack written there when the item is delivered. */
export const roomDir = (home: string, cardId: string): string => join(home, "rooms", cardId);
```

In `src/daemon/deliver.ts`:

**3a.** Before `import { parseAddress } from "../core/im/address.js";`:

```ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
```

and the home import gains `roomDir` (after `removeDraft, `).

**3b.** In `Delivered`, after `  dropped: QueueItem[];`:

```ts
  /** A card's turn: the guest room made for it (§7.5). */
  room?: string;
```

**3c.** Before `/** The next item for the agent's session (§6.5) …`:

```ts
/** The guest room (§7.5) for a card's turn: the 委托书 as CARD.md, the context pack's texts under context/, made or refreshed as the item is delivered; the model works there. */
function prepareRoom(home: string, c: Config, agent: string, item: QueueItem, card: NonNullable<QueueItem["card"]>): string {
  const room = roomDir(home, card.id);
  mkdirSync(join(room, "context"), { recursive: true });
  writeFileSync(join(room, "CARD.md"), `# 任务卡 #${card.id}「${card.title}」\n\n${item.prompt}\n`, "utf8");
  const { expanded } = expandEmbeds(item.context ?? [], `agent:${agent}@${c.person}`, localAccess(home, c));
  expanded.forEach((r, i) => { if (r.text !== undefined) writeFileSync(join(room, "context", `${i + 1}.md`), `${r.embed.src}\n\n${r.text}\n`, "utf8"); });
  return room;
}
```

**3d.** `cardPromptLine` takes the room: its signature becomes `function cardPromptLine(ref: NonNullable<QueueItem["card"]>, room: string): string {` and its return `· 上限 ${…} · 记录和交付用 im_card]` becomes `· 上限 ${ref.credits === undefined ? "无" : `${ref.credits} 积分`} · 客房：${room} · 记录和交付用 im_card]`.

**3e.** In `nextPrompt`, before the `head` line: `  const room = item.card === undefined ? undefined : prepareRoom(home, c, agent, item, item.card);`; the `head` line's `cardPromptLine(item.card)` becomes `cardPromptLine(item.card, room ?? "")`; and the `return` gains `...(room !== undefined ? { room } : {})` after `dropped`.

**3f.** In `test/daemon-card.test.mjs`, the line `    assert.ok(d.text.startsWith(\`${d.envelope}\n[任务卡 #${id}「给设置页加导出 PDF」 · 在接单方沙箱里干 · 工具：读 · 改 · 测 · 上限 40 积分 · 记录和交付用 im_card]\n任务卡 #${id}「给设置页加导出 PDF」归你了（外包）。\`), d.text);` becomes:

```js
    assert.ok(d.text.startsWith(`${d.envelope}\n[任务卡 #${id}「给设置页加导出 PDF」 · 在接单方沙箱里干 · 工具：读 · 改 · 测 · 上限 40 积分 · 客房：${d.room} · 记录和交付用 im_card]\n任务卡 #${id}「给设置页加导出 PDF」归你了（外包）。`), d.text);
```

- [ ] **Step 4: Write `src/daemon/cards.ts`**

```ts
// The task card's verbs for a host (§8, transport §4.1 im_card): one call
// to the relay with the person's token or an agent's, and the line the tool
// answers with. Unlike messages, a card's verbs are not queued in the
// outbox — a claim is a lock, a delivery a stamp — so the relay answers now,
// and a relay out of reach is the answer.
import { briefLines, DIRECTION_WORDS, progressLine, STATE_WORDS, waitingOn, type Card, type CardState } from "../core/im/card.js";
import { RelayClient, RelayDown, reasonOf } from "./client.js";
import { readConfig } from "./home.js";

export const CARD_ACTIONS = ["new", "publish", "claim", "grant", "note", "giveback", "deliver", "report", "accept", "changes", "resume", "dispute", "settle", "close", "show", "list"] as const;
export type CardAction = (typeof CARD_ACTIONS)[number];
export const isCardAction = (v: unknown): v is CardAction => typeof v === "string" && (CARD_ACTIONS as readonly string[]).includes(v);

export interface CardView { card: Card; address: string; brief: { label: string; text: string }[]; progress: string; waitingOn?: string; heartbeat: string }
export interface CardListRow { owner: string; id: string; title: string; state: string; direction: string; role: string }
/** What a card call answers: the card after the verb (and its state before it), the report's decision, a new card's address, a view, a list; always the line. */
export interface CardAnswer { card?: Card; before?: CardState; decision?: "accepted" | "changes" | "inbox"; address?: string; view?: CardView; rows?: CardListRow[]; line: string }

const ROLE_WORDS: Readonly<Record<string, string>> = { delegator: "委托人", worker: "接单方", granter: "放行人" };
const DECISION_WORDS = { accepted: "已接受", changes: "要改", inbox: "等主人验收" } as const;

/** The card as `show` prints it: the head line, the 委托书, whom it waits on, the heartbeat. */
export function showLines(v: CardView): string {
  const lines = [`#${v.card.id} ${v.card.title} · ${DIRECTION_WORDS[v.card.direction]} · ${v.progress}`, ...v.brief.map((l) => `${l.label}：${l.text}`)];
  if (v.waitingOn !== undefined) lines.push(`等：${v.waitingOn}`);
  lines.push(`心跳：${v.heartbeat}`);
  return lines.join("\n");
}

export async function cardCall(home: string, o: { action: CardAction; owner?: string; id?: string; body?: unknown; as?: string }): Promise<{ ok: true; answer: CardAnswer } | { ok: false; reason: string }> {
  const c = readConfig(home);
  if (c === undefined) return { ok: false, reason: "没有 connect.json：先 gemworks connect setup" };
  const agent = o.as === undefined || o.as === "person" ? undefined : o.as.replace(/^agent:/, "");
  const token = agent === undefined ? c.token : c.agents[agent];
  if (token === undefined) return { ok: false, reason: `没有 ${agent} 的令牌` };
  const client = new RelayClient(c.relay.url, token);
  try {
    if (o.action === "list") {
      const r = await client.get("/tasks");
      if (r.status !== 200) return { ok: false, reason: reasonOf(r) };
      const rows = r.body as CardListRow[];
      return { ok: true, answer: { rows, line: rows.length === 0 ? "没有任务卡" : rows.map((t) => `${t.owner}/${t.id} · ${t.title} · ${STATE_WORDS[t.state as CardState] ?? t.state} · ${ROLE_WORDS[t.role] ?? t.role}`).join("\n") } };
    }
    if (o.action === "new") {
      const r = await client.post("/tasks", o.body ?? {});
      if (r.status !== 201) return { ok: false, reason: reasonOf(r) };
      const made = r.body as { card: Card; address: string };
      return { ok: true, answer: { card: made.card, address: made.address, line: `起草 · ${made.card.title}` } };
    }
    if (o.owner === undefined || o.id === undefined) return { ok: false, reason: "要卡的 owner/id" };
    const path = `/tasks/${encodeURIComponent(o.owner)}/${encodeURIComponent(o.id)}`;
    const seen = await client.get(path);
    if (seen.status !== 200) return { ok: false, reason: reasonOf(seen) };
    const view = seen.body as CardView;
    if (o.action === "show") return { ok: true, answer: { card: view.card, view, line: showLines(view) } };
    const r = await client.post(`${path}/${o.action}`, o.body ?? {});
    if (r.status !== 200) return { ok: false, reason: reasonOf(r) };
    const out = r.body as { card: Card; decision?: "accepted" | "changes" | "inbox" };
    const w = waitingOn(out.card);
    const moved = out.card.state !== view.card.state;
    const line = moved ? `${STATE_WORDS[view.card.state]} → ${STATE_WORDS[out.card.state]}${w === undefined ? "" : ` · ${w}`}` : o.action === "note" ? "记了一笔" : o.action === "report" ? `验收报告 · ${DECISION_WORDS[out.decision ?? "inbox"]}` : STATE_WORDS[out.card.state];
    return { ok: true, answer: { card: out.card, before: view.card.state, ...(out.decision !== undefined ? { decision: out.decision } : {}), line } };
  } catch (e) {
    return { ok: false, reason: e instanceof RelayDown ? `连不上中继：${e.message}` : e instanceof Error ? e.message : String(e) };
  }
}

/** The brief as the model may read it back after `show`, for a tool's second line. */
export const briefOf = (card: Card): string => briefLines(card).map((l) => `${l.label}：${l.text}`).join("\n");
export { progressLine };
```

- [ ] **Step 5: Build, run, commit**

```bash
npm run build > /tmp/im-g-build.log 2>&1; echo "exit=$?"; node --test test/daemon-cards.test.mjs test/daemon-card.test.mjs test/daemon-deliver.test.mjs test/daemon-home.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
git add src/daemon/home.ts src/daemon/deliver.ts src/daemon/cards.ts test/daemon-cards.test.mjs test/daemon-card.test.mjs
git -c user.name="Jieying, Xiong" -c user.email="xiongjy2104@gmail.com" commit -m "IM daemon: the guest room for a card's turn; a card's verbs for a host"
```
Expected: `exit=0`; `fail 0`.

- [ ] **Step 6: The actions, named where the shell can read them**

`src/core/im/card.ts` (pure) gains, after `export const FINAL_STATES …`:

```ts
/** The verbs a host drives a card with (transport §4.1 im_card): the relay's, plus show and list. */
export const CARD_ACTIONS = ["new", "publish", "claim", "grant", "note", "giveback", "deliver", "report", "accept", "changes", "resume", "dispute", "settle", "close", "show", "list"] as const;
export type CardAction = (typeof CARD_ACTIONS)[number];
export const isCardAction = (v: unknown): v is CardAction => typeof v === "string" && (CARD_ACTIONS as readonly string[]).includes(v);
```

and `src/daemon/cards.ts` takes them from there instead of declaring them: its three lines from `export const CARD_ACTIONS = …` to `export const isCardAction = …` become

```ts
export { CARD_ACTIONS, isCardAction, type CardAction } from "../core/im/card.js";
```

with `type CardAction` added to its card import. (Step 5's commit covers both files: `git add src/core/im/card.ts` too.)

---

### Task 3: The bridge: the `im-card` op

**Files:**
- Modify: `src/hosts/claude-code/protocol.ts`, `src/bridge.ts`
- Test: `test/bridge-im.test.mjs` (one more test)

- [ ] **Step 1: Write the failing test**

Append to `test/bridge-im.test.mjs` (the in-process `hook` helper answers synchronously, so a card's verb — which waits on the relay — goes through the bundled CLI, spawned without blocking the relay that lives in this process):

```js
import { spawn } from "node:child_process";
import { BUNDLE } from "./helpers/repo.mjs";

/** One bridge request through the bundled CLI, asynchronously: the relay serving it lives in this process, whose loop a spawnSync would hold. */
const askProcess = (root, req, env) => new Promise((done, failed) => {
  const child = spawn(process.execPath, [BUNDLE, "hook"], { cwd: root, env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
  let out = "", err = "";
  child.stdout.on("data", (c) => { out += c; });
  child.stderr.on("data", (c) => { err += c; });
  const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
  child.on("exit", (code) => { clearTimeout(timer); const lines = out.trim().split("\n"); if (code !== 0 || lines.length !== 1) failed(new Error(`hook exit ${code}: ${out}${err}`)); else done(JSON.parse(lines[0])); });
  child.stdin.end(JSON.stringify({ v: 1, root, ...req }));
});

test("im-card through the hook (plan G): a card drafted and published answers the card and its line; a verb the relay refuses is an error answer; an unknown action too; in this process the op is refused, as it waits on the relay", async () => {
  const { s, john, root, env, ask } = await world();
  try {
    s.relay.createVenue(john.record, { id: "g-9", kind: "group", name: "评稿", people: ["zhangsan"], agents: ["agent:xiaoping@john"] });
    const askP = (req) => askProcess(root, req, env);
    const made = await askP({ op: "im-card", action: "new", body: { title: "给设置页加导出 PDF", goal: "一个按钮", accepts: [{ text: "人点收", verify: { kind: "human" } }], direction: "outsource", venueOfWork: "worker-sandbox" } });
    assert.equal(made.ok, true, made.error);
    assert.deepEqual([made.card.card.state, made.card.line, made.card.address], ["draft", "起草 · 给设置页加导出 PDF", `https://relay.test/john/cards/${made.card.card.id}.geml`]);
    const id = made.card.card.id;
    const published = await askP({ op: "im-card", action: "publish", owner: "john", id, body: { venue: "john/g-9" } });
    assert.deepEqual([published.ok, published.card.before, published.card.card.state, published.card.line], [true, "draft", "open", "草拟 → 发布"]);
    const claim = await askP({ op: "im-card", action: "claim", owner: "john", id, as: "xiaoping" });
    assert.deepEqual([claim.ok, claim.error], [false, "gemworks: 订阅登录的会话不接单（xiaoping 还没有 API 或自托管的会话）"]);
    assert.match((await askP({ op: "im-card", action: "nope" })).error, /不认识的动作/);
    assert.match((await askP({ op: "im-card", action: "show", owner: "john", id })).card.line, /^#t-[0-9a-f]{4} 给设置页加导出 PDF · 外包 · 草拟 · \[发布\]/);
    assert.match(ask({ op: "im-card", action: "list" }).error, /handleRequest/, "the synchronous path says where the op goes");
  } finally {
    await s.close();
  }
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
node --test test/bridge-im.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
```
Expected: `fail 1` (the op is refused as unknown).

- [ ] **Step 3: The protocol**

In `src/hosts/claude-code/protocol.ts`:

**3a.** After the line importing `Delivered` from the daemon (`import type { … Delivered … } from "../../daemon/deliver.js";` or wherever `Delivered` is imported), add:

```ts
import type { CardAction } from "../../core/im/card.js";
import type { CardAnswer } from "../../daemon/cards.js";
```

**3b.** In `ImOp` (the union whose members start with `op: "im-`), after the `im-forward` member:

```ts
  | { op: "im-card"; action: CardAction; owner?: string; id?: string; body?: Record<string, unknown>; as?: string }
```

**3c.** `OPS` gains `"im-card"` after `"im-forward"`; `fields` gains, after the `"im-forward"` check:

```ts
    "im-card": () => str("action"),
```

**3d.** In the ok answer's fields, after `      answered?: { sent: string } | { draft: string };`:

```ts
      /** im-card: the card after the verb and the line the tool prints. */
      card?: CardAnswer;
```

- [ ] **Step 4: The bridge**

In `src/bridge.ts`:

**4a.** After the import of `statusView` / `readForTool` from the daemon's view (the line `import { … } from "./daemon/view.js";`):

```ts
import { cardCall } from "./daemon/cards.js";
import { isCardAction } from "./core/im/card.js";
```

**4b.** `handleRequest` becomes:

```ts
export async function handleRequest(req: BridgeRequest): Promise<BridgeResponse> {
  // A card's verb (plan G) waits on the relay; every other op is answered from the files.
  if (req.op === "im-card") return answerCard(req);
  return answerRequest(req);
}

/** `im-card`: one verb to the relay with the home's token (daemon/cards.ts); a relay out of reach, or its refusal, is the error. */
async function answerCard(req: BridgeRequest & { op: "im-card" }): Promise<BridgeResponse> {
  const shell = shellAt(req);
  if (!isCardAction(req.action)) return { v: 1, ok: false, error: `gemworks: 不认识的动作：${String(req.action)}`, shell };
  const r = await cardCall(imHome(), { action: req.action, ...(req.owner !== undefined ? { owner: req.owner } : {}), ...(req.id !== undefined ? { id: req.id } : {}), ...(req.body !== undefined ? { body: req.body } : {}), ...(req.as !== undefined ? { as: req.as } : {}) });
  return r.ok ? { v: 1, ok: true, shell, card: r.answer } : { v: 1, ok: false, error: `gemworks: ${r.reason}`, shell };
}
```

**4c.** In `answerIm`'s switch, before `      case "im-read": {`:

```ts
      case "im-card": return no("卡的动作走 handleRequest，不走同步的答复");
```

- [ ] **Step 5: Build, run, commit**

```bash
npm run build > /tmp/im-g-build.log 2>&1; echo "exit=$?"; node --test test/bridge-im.test.mjs test/bridge.test.mjs test/protocol.test.mjs test/plugin.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
git add src/hosts/claude-code/protocol.ts src/bridge.ts test/bridge-im.test.mjs
git -c user.name="Jieying, Xiong" -c user.email="xiongjy2104@gmail.com" commit -m "Bridge: the im-card op, answered from the relay"
```
Expected: `exit=0`; `fail 0`.

---

### Task 4: The shell's pure parts: the tool, the call rule, the cards' rows, the quiet line

**Files:**
- Modify: `src/hosts/claude-code/im.ts`, `src/hosts/claude-code/actions.ts`, `src/hosts/claude-code/board.ts`, `src/hosts/claude-code/text.ts` (the words)
- Modify: `test/im-host.test.mjs` (six tools; the sandbox wording; `cards: []` on the status; two new tests)

- [ ] **Step 1: Change `test/im-host.test.mjs`**

The import line gains `callRule, imQuietLine` (after `imBand, `); `inputAction` is already imported from the board module.

In `STATUS`, before `  drafts: [{ id: "d-1",` add `  cards: [],`.

The test `"the five tools, …"` becomes `"the six tools, how they are named, and the one line a call answers with"` and its first assertion `assert.deepEqual(IM_TOOL_NAMES, ["im_say", "im_ask", "im_report", "im_read", "im_forward"]);` becomes `assert.deepEqual(IM_TOOL_NAMES, ["im_say", "im_ask", "im_report", "im_read", "im_forward", "im_card"]);`, with one more line after the `im_ask` required check:

```js
  assert.deepEqual(IM_TOOLS.find((x) => x.name === "im_card").inputSchema.required, ["action"]);
```

The sandbox assertion `assert.equal(scopeRefusal(trusted, "Bash"), "IM：这一轮来自 李四（信任），权限：读、在沙箱里跑；Bash 要在沙箱里跑，这一版还没有沙箱，没有执行。要更多权限，在回复里说明，由主人放行。");` becomes:

```js
  assert.equal(scopeRefusal(trusted, "Bash"), "IM：这一轮来自 李四（信任），权限：读、在沙箱里跑；Bash 要在沙箱里跑，这一轮没有客房（只有任务卡的轮次有），没有执行。要更多权限，在回复里说明，由主人放行。");
```

Append the two tests:

```js
test("the call rule in a card's turn (§7.5): reads pass; writes only in the room, a run started there; a card without 改 refuses writes; a trusted turn without a room still refuses a run; the owner's own turn is not confined", () => {
  const item = { ...ITEM, card: { id: "t-42", address: "https://relay.test/john/cards/t-42.geml", title: "导出 PDF", tools: ["read", "edit", "test"], venueOfWork: "worker-sandbox", credits: 40 } };
  const turn = { agent: "xiaoce", item, scope: { write: true, run: "sandbox", budget: 40 }, draftFirst: false, refused: 0, room: "/h/im/rooms/t-42" };
  assert.equal(callRule(turn, "Read", { file_path: "/work/app/x.ts" }), undefined);
  assert.equal(callRule(turn, "mcp__gemworks__im_card", { action: "note" }), undefined);
  assert.equal(callRule(turn, "Write", { file_path: "/h/im/rooms/t-42/src/x.ts" }), undefined);
  assert.deepEqual(callRule(turn, "Write", { file_path: "/work/app/x.ts" }), { deny: "IM：这一轮是任务卡 #t-42 的客房，只能写到 /h/im/rooms/t-42 里；Write 写的是 /work/app/x.ts，没有执行。" });
  assert.deepEqual(callRule(turn, "Edit", { file_path: "/h/im/rooms/t-42-other/x.ts" }), { deny: "IM：这一轮是任务卡 #t-42 的客房，只能写到 /h/im/rooms/t-42 里；Edit 写的是 /h/im/rooms/t-42-other/x.ts，没有执行。" }, "a sibling that shares the prefix is outside");
  assert.equal(callRule({ ...turn, room: "C:\\h\\im\\rooms\\t-42" }, "Edit", { file_path: "C:\\h\\im\\rooms\\t-42\\x.ts" }), undefined, "a Windows path");
  assert.deepEqual(callRule(turn, "Bash", { command: "npm test" }), { cwd: "/h/im/rooms/t-42" });
  const readOnly = { ...turn, scope: { write: false, run: "none", budget: 5 }, item: { ...item, card: { ...item.card, tools: ["read"] } } };
  assert.deepEqual(callRule(readOnly, "Write", { file_path: "/h/im/rooms/t-42/x.ts" }), { deny: "IM：这一轮来自 访客 g-1（访客），权限：只读；Write 不在范围内，没有执行。要更多权限，在回复里说明，由主人放行。" });
  assert.deepEqual(callRule(readOnly, "Bash", {}), { deny: "IM：这一轮来自 访客 g-1（访客），权限：只读；Bash 不在范围内，没有执行。要更多权限，在回复里说明，由主人放行。" });
  const trusted = { agent: "xiaoping", item: { ...ITEM, senderName: "李四", level: "trusted" }, scope: { write: false, run: "sandbox", budget: 100 }, draftFirst: false, refused: 0 };
  assert.deepEqual(callRule(trusted, "Bash", {}), { deny: "IM：这一轮来自 李四（信任），权限：读、在沙箱里跑；Bash 要在沙箱里跑，这一轮没有客房（只有任务卡的轮次有），没有执行。要更多权限，在回复里说明，由主人放行。" });
  assert.equal(callRule(trusted, "Read", {}), undefined);
  const owner = { ...turn, scope: { write: true, run: "workflow", budget: null } };
  assert.equal(callRule(owner, "Bash", {}), undefined, "the owner's own card turn runs anywhere");
  assert.equal(callRule(owner, "Write", { file_path: "/work/app/x.ts" }), undefined);
});

test("the cards on the page (§8.1): a section with a card row per card, its buttons as presses, a line of words for the buttons that take one; the band's quiet line (§6.9)", () => {
  const t = (s, ...a) => a.reduce((x, v, i) => x.replace(`{${i}}`, String(v)), s);
  const base = { thread: null, replyTo: null, columns: 120, now: "2026-10-31T09:30:00Z", t };
  const CARD_ROW = { owner: "john", id: "t-57", title: "评审李四的设置页设计稿", direction: "dispatch", directionWord: "派出", state: "awaiting-grant", stateWord: "待放行", progress: "草拟 · 发布 · [待放行] · 进行中 · 已交付 · 验收中 · 已接受", brief: [{ label: "去办", text: "读画板出意见" }, { label: "验收", text: "1 李四点收 · 人勾" }], role: "delegator", worker: "xiaoping", waitingOn: "lisi", heartbeat: "还没写记录", versions: 0, actions: ["撤回"], card: { thread: "th-t-57" } };
  const rows = imTabRows({ ...base, status: { ...STATUS, cards: [CARD_ROW] } });
  const section = rows.find((r) => r.kind === "section" && r.key === "im-cards");
  assert.deepEqual([section.text, section.count], ["任务卡", 1]);
  const card = rows.find((r) => r.key === "im-card-john/t-57");
  assert.deepEqual([card.kind, card.icon, card.verb, card.title, card.tag, card.detail, card.actions.map((a) => [a.label, a.primary, a.action])], ["card", "ask", "待放行", "#t-57 评审李四的设置页设计稿", "派出 · 等 lisi · xiaoping", ["草拟 · 发布 · [待放行] · 进行中 · 已交付 · 验收中 · 已接受", "去办：读画板出意见", "验收：1 李四点收 · 人勾", "心跳：还没写记录"], [["撤回", true, { op: "im-card", action: "close", owner: "john", id: "t-57" }]]]);
  const words = rows.find((r) => r.kind === "input" && r.field === "im-card");
  assert.deepEqual([words.key, words.target], ["im-card-words-john/t-57", "john/t-57"], "撤回 takes a line of words first");
  assert.ok(rows.findIndex((r) => r.key === "im-cards") < rows.findIndex((r) => r.key === "im-venues"), "the cards stand before the venues");
  const working = imTabRows({ ...base, status: { ...STATUS, cards: [{ ...CARD_ROW, state: "in-progress", stateWord: "进行中", actions: ["问一句", "要求交回"], versions: 2 }] } });
  const row = working.find((r) => r.key === "im-card-john/t-57");
  assert.deepEqual(row.actions.map((a) => a.action), [{ op: "im-open", owner: "john", id: "th-t-57" }, { op: "im-card", action: "giveback", owner: "john", id: "t-57" }]);
  assert.equal(row.detail.at(-1), "第 2 版");
  const accepted = imTabRows({ ...base, status: { ...STATUS, cards: [{ ...CARD_ROW, state: "accepted", stateWord: "已接受", actions: [] }] } });
  assert.deepEqual([accepted.find((r) => r.key === "im-card-john/t-57").icon, accepted.some((r) => r.kind === "input" && r.field === "im-card")], ["done", false]);
  assert.deepEqual(inputAction("im-card", " 字体没回退 ", "john/t-57"), { op: "im-card-words", card: "john/t-57", text: "字体没回退" });
  assert.equal(inputAction("im-card", "x"), undefined);
  assert.equal(imQuietLine(null), undefined);
  assert.equal(imQuietLine({ ...STATUS, configured: false }), undefined);
  assert.equal(imQuietLine({ ...STATUS, cards: [], venues: [] }), "没有需要你的事");
  assert.equal(imQuietLine({ ...STATUS, cards: [CARD_ROW], venues: [{ owner: "john", id: "g-7", kind: "group", kindWord: "群", name: "前端周会", status: "", unread: 3 }, { owner: "john", id: "gd-1", kind: "guest-dm", kindWord: "访客私信", name: "访客", status: "", unread: 2 }] }), "#t-57 待放行 · 等lisi · 群里有 3 条新消息，没点名你");
  assert.equal(imQuietLine({ ...STATUS, cards: [{ ...CARD_ROW, state: "accepted", stateWord: "已接受" }], venues: [] }), "没有需要你的事", "a card at its end is nowhere to be");
});
```

- [ ] **Step 2: Run them to see them fail**

```bash
node --test test/im-host.test.mjs 2>&1 | grep -E "does not provide|^ℹ (pass|fail)"
```
Expected: `does not provide an export named 'callRule'`.

- [ ] **Step 3: The actions and the input**

In `src/hosts/claude-code/actions.ts`, after the `im-refresh` member of the action union:

```ts
  /** A card's button (plan G): the verb on `<owner>/<id>`; the words typed for it come first, kept under the card. */
  | { op: "im-card"; action: string; owner: string; id: string }
  | { op: "im-card-words"; card: string; text: string }
```

and in `src/hosts/claude-code/board.ts` the `InputField` union gains `"im-card"` (after `"im-draft"`).

In `src/hosts/claude-code/board.ts`, in `inputAction`, after the `im-draft` line:

```ts
  if (field === "im-card") return target === undefined ? undefined : { op: "im-card-words", card: target, text: s };
```

- [ ] **Step 4: The shell's IM module**

In `src/hosts/claude-code/im.ts`:

**4a. Imports** — after `import { bandRow, sortNeeds, WRITE_IN, type Need } from "../../core/im/needs-me.js";`:

```ts
import { CARD_ACTIONS, type CardAction } from "../../core/im/card.js";
import { quietLine } from "../../core/im/needs-me.js";
```

and the view import becomes `import type { CardRow, ImStatus, Thread } from "../../daemon/view.js";`.

**4b. The tool** — `export const IM_TOOL_NAMES = ["im_say", "im_ask", "im_report", "im_read", "im_forward"] as const;` becomes `export const IM_TOOL_NAMES = ["im_say", "im_ask", "im_report", "im_read", "im_forward", "im_card"] as const;`; the comment `/** The five tools (transport §4.1); \`im_card\` comes with the task cards. Each signs as the session's agent. */` becomes `/** The six tools (transport §4.1). Each signs as the session's agent, im_card as the owner when told. */`; and after the `im_forward` spec (before `];`):

```ts
  { name: "im_card", description: "A task card (§8). action: new (draft one from the fields: title, goal, accepts [{text, verify:{kind: command|file|repo|review|human, run|glob|pr|rubric}}], direction outsource|dispatch, venueOfWork worker-sandbox|resource-sandbox, tools, budget, context {includes, excludes}, grantFrom, worker, mode, reward), publish {venue}, claim, grant, note {text, evidence} (your record on the card: the heartbeat), giveback {note, deliverable}, deliver (a version: kind, sha256, parts, usage, madeBy, evidence, accepts, rights), report {results:[{criterion, met, note}], comments} (the acceptance report after re-running the machine checks in your sandbox), accept, changes {comments}, resume, dispute {reason}, settle {outcome}, close {reason}, show, list. The answer is one line: the card's move.", inputSchema: { type: "object", properties: { action: { type: "string", enum: [...CARD_ACTIONS] }, card: { type: "string", description: "`<owner>/<id>`; not for new and list." }, body: { type: "object", description: "The verb's fields.", additionalProperties: true }, as: { type: "string", enum: ["person", "agent"], description: "Whose token signs: the owner's (person: new, publish, grant, report, accept, changes, dispute, settle, close) or this session's agent's (agent: claim, note, giveback, deliver, resume). Left out, the verb picks." } }, required: ["action"], additionalProperties: false } },
```

**4c. The turn's room** — in `ImTurn`, after `refused: number`: ` room?: string` (the interface becomes `export interface ImTurn { agent: string; item: QueueItem; scope: ToolScope; draftFirst: boolean; refused: number; room?: string }`), with the comment gaining `, and the guest room when the item is a card's`.

**4d. The sandbox's words** — in `scopeRefusal`, `这一版还没有沙箱，没有执行。` becomes `这一轮没有客房（只有任务卡的轮次有），没有执行。`.

**4e. The call rule** — after `scopeRefusal`:

```ts
/** What the hooks module does with a call in a delivered turn: refuse it with a line, or start a run in the room. */
export type CallRule = { deny: string } | { cwd: string } | undefined;

/** A path under the room, on either kind of slash; a sibling that shares the prefix is outside. */
const within = (path: string, room: string): boolean => {
  const p = path.split("\\").join("/"), r = room.split("\\").join("/").replace(/\/+$/, "");
  return p === r || p.startsWith(`${r}/`);
};

/** The rule over a call in a delivered turn (rule 5, §7.2, §7.5): reads and answers pass; what the scope refuses is refused; in a card's turn with a room, a write outside the room is refused with the room's path and a sandbox run is started in the room; the owner's own turn is not confined. Which keys name a file follows the host's tools (file_path, path, notebook_path). */
export function callRule(turn: ImTurn, tool: string, input: Record<string, unknown> = {}): CallRule {
  const cls = toolClassOf(tool);
  if (cls === "read" || cls === "answer") return undefined;
  const d = decide(turn.scope, cls);
  if (d === "refuse") return { deny: scopeRefusal(turn, tool) ?? "" };
  if (turn.room === undefined) return d === "allow" ? undefined : { deny: scopeRefusal(turn, tool) ?? "" };
  if (turn.scope.run === "workflow") return undefined;
  if (cls === "write") {
    const path = ["file_path", "path", "notebook_path"].map((k) => input[k]).find((v): v is string => typeof v === "string");
    if (path !== undefined && !within(path, turn.room)) return { deny: `IM：这一轮是任务卡 #${turn.item.card?.id ?? ""} 的客房，只能写到 ${turn.room} 里；${tool} 写的是 ${path}，没有执行。` };
    return undefined;
  }
  return { cwd: turn.room };
}
```

**4f. The cards' rows and the quiet line** — before `function threadRows(`:

```ts
/** A card's button as the press it raises (§8.1): 问一句 opens the card's thread; the rest are the card's verbs. */
const CARD_VERBS: Readonly<Record<string, CardAction>> = { 发布: "publish", 算了: "close", 撤回: "close", 关闭: "close", 要求交回: "giveback", 交回: "giveback", 接受: "accept", 要改: "changes", 争议: "dispute", 认领: "claim", 写记录: "note", 交付: "deliver", 继续: "resume", 放行: "grant" };
/** The buttons that take a line of words first (the comment, the reason, the record, the note). */
const CARD_WORDS: ReadonlySet<string> = new Set(["要改", "争议", "写记录", "交回", "要求交回", "关闭", "算了", "撤回"]);
const CARD_ICON = (state: CardRow["state"]): Icon => (state === "accepted" ? "done" : state === "dispute" || state === "closed" || state === "changes" ? "warn" : "ask");

function cardPress(row: CardRow, label: string, i: number): Pressable {
  const action = label === "问一句" ? { op: "im-open" as const, owner: row.owner, id: row.card.thread ?? row.id } : { op: "im-card" as const, action: CARD_VERBS[label] ?? label, owner: row.owner, id: row.id };
  return { key: `im-card-${i}-${row.owner}/${row.id}`, label, ...(i === 0 ? { primary: true } : {}), action };
}

/** The 任务卡 section (§8.1): a card row per card the person is on — its state as the verb, the progress line and the 委托书 as the detail, the role's buttons — and a line of words under the ones that take one. */
export function imCardRows(s: ImStatus, t: T): BoardRow[] {
  if (s.cards.length === 0) return [];
  const rows: BoardRow[] = [section("im-cards", t("任务卡"), s.cards.length)];
  for (const c of s.cards) {
    const tag = [c.directionWord, ...(c.waitingOn !== undefined ? [`等 ${c.waitingOn}`] : []), ...(c.worker !== undefined ? [c.worker] : [])].join(" · ");
    const detail = [c.progress, ...c.brief.map((l) => `${l.label}：${l.text}`), `${t("心跳")}：${c.heartbeat}`, ...(c.versions > 0 ? [t("第 {0} 版", c.versions)] : [])];
    rows.push({ kind: "card", key: `im-card-${c.owner}/${c.id}`, icon: CARD_ICON(c.state), verb: c.stateWord, title: `#${c.id} ${c.title}`, tag, detail, actions: c.actions.map((label, i) => cardPress(c, label, i)) });
    if (c.actions.some((a) => CARD_WORDS.has(a))) rows.push({ kind: "input", key: `im-card-words-${c.owner}/${c.id}`, placeholder: t("先写一行（要改什么、理由、记录），再按按钮"), field: "im-card", target: `${c.owner}/${c.id}` });
  }
  return rows;
}

/** The band when nothing needs the person (§6.9): the first card still on its way that is theirs to drive, and the groups' unread. */
export function imQuietLine(status: ImStatus | null): string | undefined {
  if (status === null || !status.configured) return undefined;
  const card = status.cards.find((c) => c.state !== "accepted" && c.state !== "closed" && (c.role === "delegator" || c.role === "worker"));
  const unaddressed = status.venues.filter((v) => v.kind === "group").reduce((n, v) => n + v.unread, 0);
  return quietLine({ ...(card !== undefined ? { card: { id: `#${card.id}`, state: card.stateWord, ...(card.waitingOn !== undefined ? { waitingOn: card.waitingOn } : {}) } } : {}), unaddressed });
}

```

**4g. The page** — in `imTabRows`, before `  rows.push(section("im-venues", t("场所"), s.venues.length));`:

```ts
  rows.push(...imCardRows(s, t));
```

- [ ] **Step 5: The words**

In `src/hosts/claude-code/text.ts`, after the line `  "排队中 {0}": { en: "queued: {0}", ja: "待機中 {0}" },`:

```ts
  "任务卡": { en: "Task cards", ja: "タスクカード" },
  "心跳": { en: "Heartbeat", ja: "ハートビート" },
  "先写一行（要改什么、理由、记录），再按按钮": { en: "Type a line first (what to change, the reason, the record), then press", ja: "先に一行（変更点・理由・記録）を書いてからボタンを" },
  "看卡": { en: "show", ja: "表示" },
  "列出": { en: "list", ja: "一覧" },
  "没有能发到的场所": { en: "No venue to publish into", ja: "発行できる場所がない" },
  "发到哪个场所？": { en: "Publish into which venue?", ja: "どの場所に発行しますか？" },
  "先写一行记录": { en: "Type a line for the record first", ja: "先に記録を一行書いてください" },
  "交付由 agent 用 im_card deliver 完成": { en: "A delivery is the agent's: im_card deliver", ja: "納品は agent が im_card deliver で行う" },
```

- [ ] **Step 6: Build, run, commit**

```bash
npm run build > /tmp/im-g-build.log 2>&1; echo "exit=$?"; node --test test/im-host.test.mjs test/board.test.mjs test/text.test.mjs test/hooks-purity.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
git add src/hosts/claude-code/im.ts src/hosts/claude-code/actions.ts src/hosts/claude-code/board.ts src/hosts/claude-code/text.ts test/im-host.test.mjs
git -c user.name="Jieying, Xiong" -c user.email="xiongjy2104@gmail.com" commit -m "Claude Code shell: the im_card tool, the call rule with the guest room, the cards' rows, the band's quiet line"
```
Expected: `exit=0`; `fail 0`.

---

### Task 5: The hooks module

**Files:**
- Modify: `hooks/register.tsx`, `types/index.d.ts`
- Modify: `tests/hooks.test.ts` (the world's `im-card` answer; `cards: []` on its status objects; the registered list; one more call in the tools test; one new test)

- [ ] **Step 1: Change `tests/hooks.test.ts`**

In `world`, after `    imThread: null as unknown,` add `    /** What im-card answers; null, the relay refuses. */\n    imCard: null as unknown,`; in `answer`, after the `im-venue` line add `    if (req.op === 'im-card') { w.sent.push(req); return w.imCard === null ? { v: 1, ok: false, error: 'gemworks: 没有这张卡', shell: shell() } : { v: 1, ok: true, shell: shell(), card: w.imCard } }`. Every `drafts: [], presence: {} }` in a `w.im` literal becomes `drafts: [], cards: [], presence: {} }`, and both registered lists ending `'im_read', 'im_forward'])` end `'im_read', 'im_forward', 'im_card'])`.

In the IM tools test, after the `im_forward` expectations:

```ts
  w.imCard = { card: { id: 't-57', state: 'open', title: '评审' }, before: 'draft', line: '草拟 → 发布' }
  const carded = await $.tool.call({ tool: 'mcp__gemworks__im_card', tool_use_id: 'i6', action: 'publish', card: 'john/t-57', body: { venue: 'john/g-7' } })
  expect(carded.result).toBe('im_card · #t-57 · 草拟 → 发布')
  expect(w.sent.at(-1)).toMatchObject({ op: 'im-card', action: 'publish', owner: 'john', id: 't-57', body: { venue: 'john/g-7' }, as: 'person' })
  await $.tool.call({ tool: 'mcp__gemworks__im_card', tool_use_id: 'i7', action: 'note', card: 'john/t-57', body: { text: '跑完了' } })
  expect(w.sent.at(-1)).toMatchObject({ op: 'im-card', action: 'note', as: 'xiaoping' })
  w.imCard = { rows: [], line: '没有任务卡' }
  expect((await $.tool.call({ tool: 'mcp__gemworks__im_card', tool_use_id: 'i8', action: 'list' })).result).toBe('im_card · 任务卡 · 列出\n没有任务卡')
  w.imCard = null
  expect((await $.tool.call({ tool: 'mcp__gemworks__im_card', tool_use_id: 'i9', action: 'show', card: 'john/t-0' })).result).toBe('im_card: 没有这张卡')
```

Append the test:

```ts
test('a card\'s turn (plan G): the room is kept on the turn; a write outside it is refused with the room\'s path, one inside passes, a Bash command starts in the room; the band says where the card stands when nothing needs the person', async ($, on) => {
  const w = world(on)
  w.im = { configured: true, person: 'wangwu', relay: 'relay.test', agents: ['xiaoce'], connected: true, needs: [], venues: [], drafts: [], cards: [{ owner: 'john', id: 't-42', title: '导出 PDF', direction: 'outsource', directionWord: '外包', state: 'in-progress', stateWord: '进行中', progress: 'p', brief: [], role: 'worker', worker: 'xiaoce', waitingOn: 'xiaoce', heartbeat: '还没写记录', versions: 0, actions: ['写记录', '交付', '交回'], card: {} }], presence: {} }
  const item = { id: 'qi-t-42-start-2', n: 1, prompt: '任务卡归你了', sender: 'person:john', senderName: 'john', level: 'member', venue: 'th-t-42', venueKind: 'thread', venueName: '导出 PDF', at: '2026-10-31T09:00:00Z', hops: 0, prev: null, hash: 'sha256:x', card: { id: 't-42', address: 'https://relay.test/john/cards/t-42.geml', title: '导出 PDF', tools: ['read', 'edit', 'test'], venueOfWork: 'worker-sandbox', credits: 40 } }
  const envelope = '[来自 线程「导出 PDF」 · john（成员） · 权限：读、在沙箱里跑 · 回复将发回该线程，成员可见 · 队列中还有 0 条]'
  w.imNext = { item, envelope, text: `${envelope}\n任务卡归你了`, scope: { write: true, run: 'sandbox', budget: 40 }, queued: 0, draftFirst: false, dropped: [], room: '/h/im/rooms/t-42' }
  const commands: string[] = []
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('tool.call', { tool: 'Write' }, () => ({ result: 'written', text: 'written' }))
  on('tool.call', { tool: 'Bash' }, ($, e) => { commands.push(e.command); return { result: 'ran', text: 'ran' } })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  const clock = await start($, on)
  await clock.settle()
  expect(await bandText($)).toContain('#t-42 进行中 · 等xiaoce')
  expect((await $.tool.call({ tool: 'Write', tool_use_id: 'w1', file_path: '/work/app/x.txt', content: 'x' })).deny).toBe('IM：这一轮是任务卡 #t-42 的客房，只能写到 /h/im/rooms/t-42 里；Write 写的是 /work/app/x.txt，没有执行。')
  expect((await $.tool.call({ tool: 'Write', tool_use_id: 'w2', file_path: '/h/im/rooms/t-42/x.txt', content: 'x' })).deny).toBeUndefined()
  expect((await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'npm test' })).deny).toBeUndefined()
  expect(commands).toEqual(['cd "/h/im/rooms/t-42" && npm test'])
  await $.turn.complete({ answer: '做完了', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.settle()
  // The test run moved the workflow's stage, whose dictionary now has its own say on a write; the room's rule is gone with the turn.
  expect((await $.tool.call({ tool: 'Write', tool_use_id: 'w3', file_path: '/work/app/y.txt', content: 'y' })).deny ?? '', 'the room ends with the turn').not.toContain('IM：')
})
```

- [ ] **Step 2: Run the hooks tests to see the two fail**

```bash
claude plugin test . 2>&1 | grep -E "^\(fail\)|^ *[0-9]+ (pass|fail)" | grep -vE "paddingY" | head
```
Expected: the IM tools test and the card's-turn test among the failures (the 23 pane failures as before).

- [ ] **Step 3: Change `types/index.d.ts`**

After `      imSeen: GemworksJson` add `      imCardWords: GemworksJson`.

- [ ] **Step 4: Change `hooks/register.tsx`**

**5a.** The import line `import { IM_TOOLS, imBand, imHeaderLine, imTabRows, imToolOf, scopeRefusal, toolLine, unreadOf, venueKey } from '../dist/hosts/claude-code/im.js'` becomes `import { callRule, IM_TOOLS, imBand, imHeaderLine, imQuietLine, imTabRows, imToolOf, toolLine, unreadOf, venueKey } from '../dist/hosts/claude-code/im.js'` (the rule replaces the bare refusal).

**5b.** After `import type { Presence } from '../dist/core/im/presence.js'`:

```ts
import type { CardAction } from '../dist/core/im/card.js'
```

**5c.** After the `const imPresenceAtom = …` line:

```ts
/** The line of words typed under a card for its next button (plan G): the comment, the reason, the record; per card, cleared once used. */
const imCardWordsAtom = atom({ plugin: 'gemworks', key: 'imCardWords' } as const, null as GemworksJson)
```

**5d.** In `serveIm`, before `  const v = venueOf(args['venue'])`:

```ts
  if (name === 'im_card') {
    const action = str('action') ?? ''
    const card = /^([^/#\s]+)\/([^/#\s]+)$/.exec(str('card') ?? '')
    const body = typeof args['body'] === 'object' && args['body'] !== null ? args['body'] as Record<string, unknown> : undefined
    // Whose token signs: the owner's unless told otherwise, the agent's for the verbs a worker takes.
    const as = str('as') === 'person' ? 'person' : str('as') === 'agent' || ['claim', 'note', 'giveback', 'deliver', 'resume'].includes(action) ? agent : 'person'
    const r = await through({ op: 'im-card', action: action as CardAction, ...(card !== null ? { owner: card[1] as string, id: card[2] as string } : {}), ...(body !== undefined ? { body } : {}), as })
    if (!r.ok) return { result: r.text }
    const a = r.res.card
    const where = a?.card !== undefined ? `#${a.card.id}` : card !== null ? `#${card[2] as string}` : t('任务卡')
    return { result: action === 'show' || action === 'list' ? `${toolLine(name, where, action === 'show' ? t('看卡') : t('列出'))}\n${a?.line ?? ''}` : toolLine(name, where, a?.line ?? '') }
  }
```

**5e.** After the `im_forward` tool hook line:

```ts
  on('tool.call', { tool: 'mcp__gemworks__im_card' }, ($, e) => serveIm($, 'im_card', e)).catch(() => ({ result: 'gemworks IM could not do that' }))
```

**5f.** In the generic `tool.call` hook, the scope block (from `    const imTurn = await readImTurn($)` through its closing `    }`) becomes:

```ts
    const imTurn = await readImTurn($)
    let ev = e
    if (imTurn !== null) {
      const rule = callRule(imTurn, tool, toolArgs(e as unknown as Record<string, unknown>))
      if (rule !== undefined && 'deny' in rule) {
        await update($, imTurnAtom, () => ({ ...imTurn, refused: imTurn.refused + 1 }) as unknown as GemworksJson)
        return { deny: rule.deny }
      }
      // A sandbox run starts in the card's room (§7.5): the command goes there first.
      if (rule !== undefined && 'cwd' in rule && e.tool === 'Bash') ev = { ...e, command: `cd ${JSON.stringify(rule.cwd)} && ${e.command}` }
    }
```

and the pass-through `    const ran = await next(fill === undefined ? e : { ...e, ...fill })` becomes `    const ran = await next(fill === undefined ? ev : { ...ev, ...fill })`.

**5g.** The band — the end of the 需要我 block, `        attentionPresses = null\n        question = undefined\n      }\n    } catch { /* the band keeps its line */ }`, becomes:

```ts
        attentionPresses = null
        question = undefined
      } else if (imRow === undefined) {
        // Nothing needs the person (§6.9): where the current card stands, and the groups' unread, lead the dim words.
        const quiet = imQuietLine(await readIm($))
        if (quiet !== undefined && quiet !== '没有需要你的事') view = { ...view, note: view.note === '' ? quiet : `${quiet}${SEP}${view.note}` }
      }
    } catch { /* the band keeps its line */ }
```

**5h.** In `act`'s first switch, before `default: break`:

```ts
    case 'im-card-words': await update($, imCardWordsAtom, (was) => ({ ...(((was as unknown) as Record<string, string> | null) ?? {}), [action.card]: action.text }) as unknown as GemworksJson); return
```

and in the second switch, before `case 'check-update':`:

```ts
    // A card's button (plan G): the words typed under the card go with the verb that takes them; 发布 asks which venue; a worker's verbs sign as the session's agent.
    case 'im-card': {
      const key = `${action.owner}/${action.id}`
      const words = (((await read($, imCardWordsAtom)) as unknown) as Record<string, string> | null)?.[key]
      let body: Record<string, unknown> = {}
      let as = 'person'
      if (action.action === 'publish') {
        const venues = ((await readIm($))?.venues ?? []).filter((v) => v.kind === 'group' || v.kind === 'thread')
        if (venues.length === 0) { $.ui.toast(t('没有能发到的场所')); return }
        const labels = venues.map((v) => `${v.kindWord}「${v.name}」`)
        let picked: string
        try { picked = await $.ui.ask(t('发到哪个场所？'), labels) } catch { return }
        const v = venues[labels.indexOf(picked)]
        if (v === undefined) return
        body = { venue: `${v.owner}/${v.id}` }
      } else if (action.action === 'changes') body = { comments: words === undefined ? [] : [{ anchor: '', text: words }] }
      else if (action.action === 'dispute' || action.action === 'close') body = words === undefined ? {} : { reason: words }
      else if (action.action === 'note') { if (words === undefined) { $.ui.toast(t('先写一行记录')); return } body = { text: words } }
      else if (action.action === 'giveback') body = words === undefined ? {} : { note: words }
      else if (action.action === 'deliver') { $.ui.toast(t('交付由 agent 用 im_card deliver 完成')); return }
      if (['claim', 'note', 'giveback', 'resume'].includes(action.action)) {
        const agent = await imAgentOf($)
        if (agent === undefined) { $.ui.toast(t('本会话没有 agent：在设置里选一个')); return }
        as = agent
      }
      const res = await through({ op: 'im-card', action: action.action as CardAction, owner: action.owner, id: action.id, body, as })
      if (res?.ok === true) {
        $.ui.toast(`#${action.id} ${res.card?.line ?? ''}`)
        await update($, imCardWordsAtom, (was) => { const m = { ...((((was as unknown) as Record<string, string> | null) ?? {})) }; delete m[key]; return m as unknown as GemworksJson })
      }
      await loadIm($)
      return
    }
```

**5i.** In `imDeliverNext`, the turn line becomes:

```ts
  const turn: ImTurn = { agent, item: d.item, scope: d.scope, draftFirst: d.draftFirst, refused: 0, ...(d.room !== undefined ? { room: d.room } : {}) }
```

- [ ] **Step 5: Build, the purity gate, the hooks tests, commit**

```bash
npm run build > /tmp/im-g-build.log 2>&1; echo "exit=$?"; node --test test/hooks-purity.test.mjs test/hooks-types.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
claude plugin test . 2>&1 | grep -E "^ *[0-9]+ (pass|fail)|^\(fail\)" | grep -vE "paddingY" | head -30
git add hooks/register.tsx types/index.d.ts tests/hooks.test.ts
git -c user.name="Jieying, Xiong" -c user.email="xiongjy2104@gmail.com" commit -m "Claude Code shell: im_card served, the guest room on a card's turn, the cards' presses, the band's quiet line"
```
Expected: `exit=0`; the purity and types suites `fail 0`; the hooks run `60 pass, 23 fail`, the 23 the machine's known pane drawings and none of them IM tests.

---

### Task 6: Gates and the version

- [ ] **Step 1: The four gates, each its own command**

```bash
npm run build > /tmp/im-g-gate1.log 2>&1; echo "exit=$?"
claude plugin validate . > /tmp/im-g-gate2.log 2>&1; echo "exit=$?"; tail -1 /tmp/im-g-gate2.log
claude plugin test . > /tmp/im-g-gate3.log 2>&1; echo "exit=$?"; grep -E "^ *[0-9]+ (pass|fail)" /tmp/im-g-gate3.log
node --test --test-concurrency=2 test/*.test.mjs > /tmp/im-g-gate4.log 2>&1; echo "exit=$?"; grep -E "^ℹ (pass|fail)" /tmp/im-g-gate4.log
```
Expected: gates 1, 2, 4 `exit=0`; gate 4 `ℹ pass 920` (916 + 4), `ℹ fail 0`; gate 3 `60 pass, 23 fail`, the 23 the machine's known pane drawings (`paddingY`), none of them IM tests.

- [ ] **Step 2: Bump and commit**

```bash
node scripts/bump.mjs 0.2.96
node --test test/smoke.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
git add package.json package-lock.json .claude-plugin/plugin.json .codex-plugin/plugin.json
git -c user.name="Jieying, Xiong" -c user.email="xiongjy2104@gmail.com" commit -m "gemworks 0.2.96: task cards in the Claude Code shell"
```

---

## Self-review

- **Spec coverage.** Transport §4.1 `im_card` (建卡、认领、交回、交付、验收、争议 and the rest) — Tasks 3–5, one line per call in the tool's style. Transport §4 看板 「消息」页 卡片 — Task 4's rows with the role's buttons (§8.1: 问一句、要求交回、争议 for the delegator in progress; 认领 for a worker on an open card; 放行 for the granter). §6.9 「什么都不需要人时，状态带只说在哪」 — Task 4's `imQuietLine`, Task 5's band. §7.5 客房沙箱: a clean work directory the owner's private files are not in, the writes confined to it, the runs started in it, the tool scope from the card (plan F) — Tasks 2 and 4; what §7.5 says of 派出 (只能读、跑、评) is the card's scope (plan F's `scopeOfCard`). Not here: 中立沙箱 (v1 不做, §8.5), 拆分 as a verb (plan F's rule stands; the split's tool comes with ④'s next step), the one-click 委托书 draft from a DM (the model drafts with `im_card new` and the owner sees the card on the board with 发布/算了 — the dialogue is the model's).
- **Placeholders.** None.
- **Type consistency.** `CardAction` from `core/im/card.ts` in the daemon, the protocol, the shell and the hooks; `CardAnswer.line` read by the tool and the press; `ImTurn.room` set from `Delivered.room`; `callRule`'s input keys match the host's write tools (`file_path`, `notebook_path`); the hooks test's `w.imCard` shape matches `CardAnswer`.
