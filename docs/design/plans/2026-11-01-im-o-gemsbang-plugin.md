# IM Plan O: gemsbang, the IM's Own Claude Code Plugin

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** This checkout's Claude Code plugin becomes **gemsbang** — the IM alone — so it installs beside gemworks's own plugin (or without it) without the two clashing: its own name, tool prefix (`mcp__gemsbang__im_*`), state, store, panes (`gemsbang-board`, `gemsbang-dialog`) and command (`/gemsbang`); one line above the prompt drawn under the line of the plugin below it; a pane with the agent's line and three tabs (消息, 任务, 钱包); a settings dialog (whom this session speaks for, the relay with 重连, a code for the phone's bot, the language) and an about dialog. Nothing of the workflow comes over: no stage line, no work items, no journal, no tool dictionary, no `flow` tools. The screens are the four agreed artboards of row ⑥ (`Coexist`, `BandPair`, `GemsbangPane`, `GemsbangSettings`).

**Architecture:** The bridge learns **bare** requests: `shellAt` answers one with a shell of no status and no policy (the CLI's locale and versions only), so an IM request never opens the workspace — `openWorkspace` would `ensureStarted()` a gemworks journal in a project that has a workflow. Two async ops join the IM's: `im-sync` (重连: one round of `Daemon.syncOnce` from the plugin, the IM after it) and `im-phone-code` (the relay's one-time code, through a new `daemon/phone-code.ts` the CLI's `connect phone-code` now uses too); `statusView` counts the outbox (`outbox`, 待发). `im.ts` signs its tools `mcp__gemsbang__`, and its 消息 page comes apart into `imNeedRows`, `imDraftRows`, `imVenueRows`, `imBriefRow` and `imThreadRows`, which `imTabRows` composes as before. A new pure module, `src/hosts/claude-code/gemsbang.ts`, lays out the tabs, the three pages, the agent's line, the band's line and the two dialogs. A new `hooks/register.tsx`, written for the IM alone (about 800 lines, where the combined module was 3,645), runs the IM: the seven tools, the delivery between turns and its scope, presence, the band, the pane, the dialogs and `/gemsbang`; its drawing helpers are the old module's, cut to the row kinds the IM draws. The manifest is renamed and drops the `geml` dependency; `skills/` (gemworks's two skills) leaves the plugin — `host-skills/` keeps them for the hosts that read one folder.

**Tech Stack:** TypeScript (`src/bridge.ts`, `src/daemon`, `src/hosts/claude-code`), the hooks module (TSX against the engine's declarations), `node:test` over `dist/`, `claude plugin test` for `tests/hooks.test.ts`.

**Before this plan:** plans A–N are on `main` as gemsbang 0.4.0 (`6ca9db6`), pushed.

---

## What the screens decided, and what this build does about each

- **Two lines, one per plugin.** The engine draws one `AbovePrompt` tree: the outermost hook that draws wins, and a hook that wants the lines below it calls `next(e)` and lays its own under what comes back (the declarations' own example: `<Box>{await next(e)}…</Box>`). gemsbang does that: with something to say it draws `[what the plugin below drew]` over its own line; with nothing it passes (`return next(e)`). The order of plugins is the engine's ("in list order, first outermost"); when gemsbang sits below gemworks, gemworks's band — which draws without calling `next` — covers it, and the cure is the same few lines in gemworks. Task 9 finds out which order this machine loads them in.
- **No digit hotkeys on gemsbang's band.** Two buttons on one hotkey: the later wins. The digits stay gemworks's; gemsbang's buttons are pressed by a click or under the band's focus.
- **The band's line:** a problem of the plugin's own first (no Node, a bridge that has not answered for two minutes, a tool it could not register); then the first need with its buttons, 还有 N 件 and 看板; else the agent's name, its presence and the quiet line (`xiaoping 空闲 · #t-57 待放行 · 等李四 · 群里有 3 条新消息，没点名你`); a home not set up says 还没连上中继 · 看板里有连法. 断了's 重试 is 重连.
- **The pane:** the mark, Gemsbang, the version chip, 设置 and 关于; the agent's line (`xiaoping 代 john · 空闲 · 钱包 86 … 在线`); 消息 N (what waits on the person: the needs and the drafts) · 任务 N (cards on their way) · 钱包. 消息 is 需要我, 回群前先给你看 (the drafts) and 场所 with 刷新; a venue opens its thread, as before. 任务 is the cards and the one-line brief; 钱包 the wallet.
- **Settings:** 本会话代谁说话 lists the agents with their presence, the chosen one marked; 中继 shows `relay · person · HH:MM 同步过 · 待发 N` and 重连; 手机 has 生成绑定码 and then the code line; 语言; 完成. Two lines of the artboard are not drawn: an agent's login (API or subscription) and its 接单 declaration live on the relay, which the daemon does not mirror; and whether the phone is bound lives with the phone bridge. Both say so in the canvas's decisions (Task 7).
- **Fail open, as before:** with no Node, a bridge that does not answer or an answer that does not parse, every call goes through; the line says why once it is worth saying.

## File structure

| File | Responsibility |
|---|---|
| `src/hosts/claude-code/protocol.ts` | `bare` on the request; the ops `im-sync`, `im-phone-code`; `phoneCode` on the answer. |
| `src/bridge.ts` | `bareShell`; `answerSync`, `answerPhoneCode`. |
| `src/daemon/phone-code.ts` (new) | `phoneCode(home)`: the relay's one-time code. |
| `src/daemon/view.ts` | `ImStatus.outbox`. |
| `src/cli.ts` | `connect phone-code` through `phoneCode`. |
| `src/hosts/claude-code/im.ts` | `OWN = "mcp__gemsbang__"`; the 消息 page in parts. |
| `src/hosts/claude-code/actions.ts` | `im-tab`, `im-sync`, `im-phone-code`. |
| `src/hosts/claude-code/gemsbang.ts` (new) | The tabs, the pages, the agent's line, the band's line, the dialogs, the mark. |
| `src/hosts/claude-code/text.ts` | The new words in English and Japanese. |
| `hooks/register.tsx` (rewritten) | The IM alone. |
| `types/index.d.ts` (rewritten) | The `gemsbang` state. |
| `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` | gemsbang; no dependency; the checkout as its own marketplace. |
| `skills/` (removed), `package.json` | gemworks's skills stay gemworks's; `host-skills/` keeps them. |
| `README.md`, `README.zh.md` | How to install gemsbang. |
| Tests | `test/bridge-gemsbang.test.mjs`, `test/gemsbang.test.mjs` new; `tests/hooks.test.ts` rewritten; `test/im-host.test.mjs`, `test/plugin-files.test.mjs`, `test/smoke.test.mjs`, `test/mcp.test.mjs`, `test/split-session.test.mjs` follow. |
| `docs/design/ui/2026-10-30-agent-im-ui/` | Row ⑥'s four artboards, `canvas.json`, the README's row and decision. |

Each edit below is named (**O-1** … **O-36**) by the file it changes and the place, then the code; an edit that adds lines says after (or before) which line, one that replaces says what.

---

### Task 1: Branch and baseline

- [ ] **Step 1: Branch from main**

```bash
git switch -c im/o-gemsbang
git log --oneline -1
```
Expected: `6ca9db6 gemsbang 0.4.0: …`.

- [ ] **Step 2: Baseline**

```bash
npm run build && node --test --test-concurrency=2 test/*.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
```
Expected: `ℹ pass 991`, `ℹ fail 0`.

---

### Task 2: The bridge: bare requests, 重连, the phone's code, 待发

**Files:**
- Modify: `src/hosts/claude-code/protocol.ts`, `src/bridge.ts`, `src/daemon/view.ts`, `src/cli.ts`
- Create: `src/daemon/phone-code.ts`
- Test: `test/bridge-gemsbang.test.mjs`

- [ ] **Step 1: Write `test/bridge-gemsbang.test.mjs`**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUNDLE, gitRepo, hook } from "./helpers/repo.mjs";
import { decodeRequest } from "../dist/hosts/claude-code/protocol.js";
import { startRelay } from "../dist/relay/server.js";
import { writeConfig } from "../dist/daemon/home.js";

// The bridge as the gemsbang plugin asks it (plan O): bare requests that open
// no workspace, 重连 as one round of the daemon's sync, and a phone's code.
const tmp = (p) => mkdtempSync(join(tmpdir(), p));
const askProcess = (root, req, env) => new Promise((done, failed) => {
  const child = spawn(process.execPath, [BUNDLE, "hook"], { cwd: root, env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
  let out = "", err = "";
  child.stdout.on("data", (c) => { out += c; });
  child.stderr.on("data", (c) => { err += c; });
  const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
  child.on("exit", (code) => { clearTimeout(timer); const lines = out.trim().split("\n"); if (code !== 0 || lines.length !== 1) failed(new Error(`hook exit ${code}: ${out}${err}`)); else done(JSON.parse(lines[0])); });
  child.stdin.end(JSON.stringify({ v: 1, root, ...req }));
});
async function world() {
  const s = await startRelay({ root: tmp("gemsbang-relay-"), name: "relay.test" });
  const john = s.relay.issuePerson("john");
  const zhang = s.relay.issuePerson("zhangsan");
  const xiaoping = s.relay.issueAgent(john.record, "xiaoping");
  s.relay.createVenue(john.record, { id: "g-7", kind: "group", name: "前端周会", people: ["zhangsan"], agents: ["agent:xiaoping@john"] });
  const home = tmp("gemsbang-im-");
  writeConfig(home, { relay: { url: s.url, name: "relay.test" }, person: "john", token: john.token, agents: { xiaoping: xiaoping.token } });
  const root = gitRepo();
  const env = { GEMWORKS_IM_HOME: home, GEMWORKS_GH: "gh-definitely-not-installed" };
  return { s, john, zhang, home, root, env, ask: (req) => hook(root, req, env), askP: (req) => askProcess(root, req, env) };
}

test("a bare request opens no workspace: its shell holds no status, no policy and no problem, only the CLI's locale and versions; bare is a boolean", () => {
  const root = gitRepo();
  const env = { GEMWORKS_IM_HOME: tmp("gemsbang-im-"), GEMWORKS_GH: "gh-definitely-not-installed" };
  const bare = hook(root, { op: "im-status", bare: true }, env);
  assert.equal(bare.ok, true);
  assert.deepEqual([bare.shell.status, bare.shell.policy, bare.shell.contextKey, bare.shell.problem, bare.shell.suggest], [null, null, null, undefined, undefined]);
  assert.match(bare.shell.versions.gemworks, /^\d+\.\d+\.\d+/);
  const full = hook(root, { op: "im-status" }, env);
  assert.equal(full.shell.problem?.quiet, true, "the same request opened as before says the project has no workflow");
  assert.deepEqual(decodeRequest(JSON.stringify({ v: 1, root, op: "im-status", bare: "yes" })), { error: "bare is a boolean" });
  assert.equal(decodeRequest(JSON.stringify({ v: 1, root, op: "im-status", bare: true })).bare, true);
});

test("im-sync (重连): one round of the daemon's sync — the mirrors and the outbox — answers the IM after it; a relay out of reach is the error and leaves 断了 for the band; no home, no sync", async () => {
  const { s, zhang, ask, askP, root } = await world();
  let open = true;
  try {
    s.relay.appendMessage(zhang.record, "john", "g-7", { id: "m-1", text: "@xiaoping 在吗" });
    assert.deepEqual(ask({ op: "im-status", bare: true }).im.venues, [], "nothing mirrored yet");
    const first = await askP({ op: "im-sync", bare: true });
    assert.equal(first.ok, true, first.error);
    assert.match(first.text, /^同步过：\d+ 份文档$/);
    assert.deepEqual([first.im.connected, first.im.venues.map((v) => [v.id, v.unread])], [true, [["g-7", 1]]]);
    assert.equal(ask({ op: "im-say", owner: "john", venue: "g-7", text: "在", bare: true }).ok, true);
    assert.equal(ask({ op: "im-status", bare: true }).im.outbox, 1, "待发 1");
    const pushed = await askP({ op: "im-sync", bare: true });
    assert.match(pushed.text, /，推出 1 条$/);
    assert.equal(pushed.im.outbox, undefined, "nothing waits");
    await s.close();
    open = false;
    const down = await askP({ op: "im-sync", bare: true });
    assert.deepEqual([down.ok, /^gemworks: 连不上中继：/.test(down.error)], [false, true]);
    const after = ask({ op: "im-status", bare: true }).im;
    assert.deepEqual([after.connected, after.needs[0]?.kind], [false, "offline"]);
    assert.match(ask({ op: "im-sync" }).error, /handleRequest/, "the synchronous path says where the op goes");
    const none = await askProcess(root, { op: "im-sync", bare: true }, { GEMWORKS_IM_HOME: tmp("gemsbang-im-"), GEMWORKS_GH: "gh-definitely-not-installed" });
    assert.deepEqual([none.ok, none.error], [false, "gemworks: 没有 connect.json：先 gemworks connect setup"]);
  } finally {
    if (open) await s.close();
  }
});

test("im-phone-code: a code from the relay the bot's /bind takes once; no home says so", async () => {
  const { s, askP, ask, root } = await world();
  try {
    const r = await askP({ op: "im-phone-code", bare: true });
    assert.equal(r.ok, true, r.error);
    assert.match(r.phoneCode, /^\d{6}$/);
    assert.equal(s.relay.phoneBind({ code: r.phoneCode }).person, "john");
    assert.match(ask({ op: "im-phone-code" }).error, /handleRequest/);
    const none = await askProcess(root, { op: "im-phone-code", bare: true }, { GEMWORKS_IM_HOME: tmp("gemsbang-im-"), GEMWORKS_GH: "gh-definitely-not-installed" });
    assert.deepEqual([none.ok, none.error], [false, "gemworks: 没有 connect.json：先 gemworks connect setup"]);
  } finally {
    await s.close();
  }
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
npm run build && node --test test/bridge-gemsbang.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
```
Expected: `ℹ fail 3` — `bare: "yes"` decodes, the shell of a bare request still says the project has no workflow, and `im-sync` and `im-phone-code` are unknown ops.

- [ ] **Step 3: Write `src/daemon/phone-code.ts`**

```ts
// A one-time code to bind the phone's bot with (transport §7.2): asked of the
// relay with the person's token; it holds for ten minutes, and the bot's /bind
// takes it once. The CLI's `connect phone-code` and the plugin's 生成绑定码.
import { RelayClient, reasonOf } from "./client.js";
import { readConfig } from "./home.js";

export async function phoneCode(home: string, fetchImpl?: typeof fetch): Promise<{ ok: true; code: string } | { ok: false; reason: string }> {
  const c = readConfig(home);
  if (c === undefined) return { ok: false, reason: "没有 connect.json：先 gemworks connect setup" };
  try {
    const r = await new RelayClient(c.relay.url, c.token, fetchImpl).post("/phone/code", {});
    return r.status === 201 ? { ok: true, code: (r.body as { code: string }).code } : { ok: false, reason: reasonOf(r) };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
```

- [ ] **Step 4: The protocol, the bridge, the view and the CLI**

**O-1** · `src/hosts/claude-code/protocol.ts` — the request type gains `bare` (it and its comment replace the `imSeen` comment and the type under it):

```ts
/**
 * `imSeen`: per venue (owner/id), the last message id the 消息 page showed, for the unread counts.
 * `bare`: the IM alone (the gemsbang plugin) — no workspace is opened, so nothing under the project's .geml/ is read or
 * started; the shell carries the CLI's locale and versions only.
 */
export type BridgeRequest = { v: 1; root: string; lastFile?: string; gh?: GhSeen; imSeen?: Record<string, string>; bare?: boolean } & BridgeOp;
```

**O-2** · `src/hosts/claude-code/protocol.ts` — two ops after the `im-signal` op of `BridgeOp`:

```ts
  /** 重连: one round of the daemon's sync from here — the outbox pushed, what the person follows mirrored; the IM after it. */
  | { op: "im-sync" }
  /** A one-time code to bind the phone's bot with (transport §7.2). */
  | { op: "im-phone-code" }
```

**O-3** · `src/hosts/claude-code/protocol.ts` — the answer's fields, after `signal`:

```ts
      /** im-phone-code: the code, good for ten minutes. */
      phoneCode?: string;
```

**O-4** · `src/hosts/claude-code/protocol.ts` — the end of the `OPS` set:

```ts
"im-card", "im-brief", "im-signal", "im-sync", "im-phone-code"]);
```

**O-5** · `src/hosts/claude-code/protocol.ts` — in `decodeRequest`, after the line that requires `root`:

```ts
  if (v["bare"] !== undefined && typeof v["bare"] !== "boolean") return { error: "bare is a boolean" };
```

**O-6** · `src/bridge.ts` — `shellAt` answers a bare request without opening the workspace (its first two lines become):

```ts
function shellAt(req: BridgeRequest): ShellStatus {
  // A bare request (the gemsbang plugin) opens no workspace: the project's .geml/ is gemworks's, never started from here.
  if (req.bare === true) return bareShell();
  const opened = openFor(req);
```

**O-7** · `src/bridge.ts` — before `function notOpened`:

```ts
/** The shell of a bare request: no status and no policy; the CLI's locale and versions, for the IM's words and its header. */
function bareShell(): ShellStatus {
  const locale = localeOf();
  return { status: null, policy: null, contextKey: null, ...(locale !== undefined ? { locale } : {}), versions: { gemworks: gemworksVersion(), parser: PARSER_VERSION } };
}

```

**O-8** · `src/bridge.ts` — in `handleRequest`, after the `im-signal` line:

```ts
  if (req.op === "im-sync") return answerSync(req);
  if (req.op === "im-phone-code") return answerPhoneCode(req);
```

**O-9** · `src/bridge.ts` — the two answers, before the comment of `answerExecPress`:

```ts
/** `im-sync` (重连): one round of the daemon's sync from here (daemon/sync.ts), the state it writes the band's 断了 or not; the IM after it. */
async function answerSync(req: BridgeRequest & { op: "im-sync" }): Promise<BridgeResponse> {
  const shell = shellAt(req);
  const home = imHome();
  if (readConfig(home) === undefined) return { v: 1, ok: false, error: "gemworks: 没有 connect.json：先 gemworks connect setup", shell };
  const r = await new Daemon({ home }).syncOnce();
  if (!r.connected) return { v: 1, ok: false, error: `gemworks: 连不上中继：${r.error ?? ""}`, shell };
  return { v: 1, ok: true, shell, im: statusView(home, req.imSeen ?? {}, nowIso()), text: `同步过：${r.docs} 份文档${r.pushed > 0 ? `，推出 ${r.pushed} 条` : ""}${r.left > 0 ? `，还有 ${r.left} 条待发` : ""}` };
}

/** `im-phone-code`: a one-time code from the relay (daemon/phone-code.ts) for the phone's /bind. */
async function answerPhoneCode(req: BridgeRequest & { op: "im-phone-code" }): Promise<BridgeResponse> {
  const shell = shellAt(req);
  const r = await phoneCode(imHome());
  return r.ok ? { v: 1, ok: true, shell, phoneCode: r.code } : { v: 1, ok: false, error: `gemworks: ${r.reason}`, shell };
}

```

**O-10** · `src/bridge.ts` — in `answerIm`'s switch, after the `im-signal` case:

```ts
      case "im-sync": return no("同步走 handleRequest，不走同步的答复");
      case "im-phone-code": return no("绑定码走 handleRequest，不走同步的答复");
```

**O-11** · `src/bridge.ts` — the imports, after the client's:

```ts
import { Daemon } from "./daemon/sync.js";
import { phoneCode } from "./daemon/phone-code.js";
```

**O-12** · `src/daemon/view.ts` — `ImStatus` gains the outbox's count, after `wallet`:

```ts
  /** What waits in the outbox for the relay (待发), when anything does. */
  outbox?: number;
```

**O-13** · `src/daemon/view.ts` — the import from `./home.js` takes `listOutbox`:

```ts
import { listDrafts, listOutbox, listSessions, readConfig, readInbox, readMirror, readState, type Config } from "./home.js";
```

**O-14** · `src/daemon/view.ts` — in `statusView`, after the line that makes `out`:

```ts
  const outbox = listOutbox(home).length;
  if (outbox > 0) out.outbox = outbox;
```

**O-15** · `src/cli.ts` — the import, after the daemon's:

```ts
import { phoneCode } from "./daemon/phone-code.js";
```

**O-16** · `src/cli.ts` — in `connect phone-code`, the `try` that posts to `/phone/code` becomes:

```ts
    const r = await phoneCode(home);
    if (!r.ok) return fail(`gemworks connect phone-code: ${r.reason}`, 1);
    console.log(`绑定码 ${r.code} · 十分钟内在 bot 里发 /bind ${r.code}`);
    return 0;
```

- [ ] **Step 5: Build and run**

```bash
npm run build && node --test test/bridge-gemsbang.test.mjs test/bridge-im.test.mjs test/phone-cli.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
```
Expected: `ℹ pass 9`, `ℹ fail 0`.

- [ ] **Step 6: Commit**

```bash
git add src/hosts/claude-code/protocol.ts src/bridge.ts src/daemon/view.ts src/daemon/phone-code.ts src/cli.ts test/bridge-gemsbang.test.mjs
git commit -m "Bare IM requests open no workspace; im-sync and im-phone-code; the outbox's count"
```

---

### Task 3: The IM tools under gemsbang; the 消息 page in parts

**Files:**
- Modify: `src/hosts/claude-code/im.ts`
- Test: `test/im-host.test.mjs`

- [ ] **Step 1: The test names the new prefix**

**O-20** · `test/im-host.test.mjs` — every `mcp__gemworks__im_` (five places) becomes:

```text
mcp__gemsbang__im_
```

- [ ] **Step 2: Run it to see it fail**

```bash
npm run build && node --test test/im-host.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
```
Expected: `ℹ fail 1` — the test that names the tools (`isImTool`, `imToolOf`); the others take the prefix as a read either way.

- [ ] **Step 3: The prefix, and the page in parts**

**O-17** · `src/hosts/claude-code/im.ts` — the tools' prefix:

```ts
export const OWN = "mcp__gemsbang__";
```
**O-18** · `src/hosts/claude-code/im.ts` — the 消息 page's rows come apart, so the gemsbang pane takes them one by one; `imTabRows` composes them as before. Everything from the comment `/** The 消息 page's rows` up to the comment `/** A card's button as the press it raises` becomes:

```ts
/** The 消息 page's rows (decision 5): the list, or the open thread. */
export function imTabRows(o: ImPageInput): BoardRow[] {
  const { t, columns } = o;
  const s = o.status;
  if (s === null) return [text(t("正在读取消息…"))];
  if (!s.configured) return [text(t("还没连上中继：在终端里运行 gemworks connect setup --relay <地址> --token <令牌>，再 gemworks connect。"))];
  if (o.thread !== null) return imThreadRows(o.thread, o.replyTo, columns, t);
  const link = s.connected === false ? t("断了") : s.connected === true ? t("在线") : t("没同步过");
  return [
    { kind: "heading", key: "im-head", text: t("消息"), sub: `${s.person ?? ""} @ ${s.relay ?? ""} · ${link}`, action: { key: "im-refresh", label: t("刷新"), action: { op: "im-refresh" } } },
    ...imNeedRows(s, t), ...imDraftRows(s, t), ...imCardRows(s, t), ...(s.agents.length > 0 ? [imBriefRow(t)] : []), ...imWalletRows(s, t), ...imVenueRows(s, t),
  ];
}

/** 需要我 (§6.9): a card per need, in the band's order, its buttons the need's own. */
export function imNeedRows(s: ImStatus, t: T): BoardRow[] {
  if (s.needs.length === 0) return [];
  return [section("im-needs", t("需要我"), s.needs.length), ...sortNeeds(s.needs).map((n): BoardRow => ({ kind: "card", key: `im-need-${n.key}`, icon: NEED_ICON[n.kind], verb: NEED_VERB[n.kind], title: n.text, ...(n.venue !== undefined ? { tag: n.venue } : {}), detail: [], actions: n.actions.map((label, i) => needPress(n, label, i, `im-need-${i}-${n.key}`)) }))];
}

/** The drafts held for the person (§6.5, 回群前先给我看): each as its card, then a line to change it before it goes. */
export function imDraftRows(s: ImStatus, t: T, heading: string = t("等你过目")): BoardRow[] {
  if (s.drafts.length === 0) return [];
  const rows: BoardRow[] = [section("im-drafts", heading, s.drafts.length)];
  for (const d of s.drafts) {
    rows.push({ kind: "card", key: `im-draft-${d.id}`, icon: "ask", verb: t("草稿"), title: d.venueName, tag: d.agent, detail: [d.text], actions: [{ key: `im-send-${d.id}`, label: t("就这么发"), primary: true, action: { op: "im-draft", id: d.id, send: true } }, { key: `im-drop-${d.id}`, label: t("不发"), action: { op: "im-draft", id: d.id, send: false } }] });
    rows.push({ kind: "input", key: `im-draft-${d.id}`, placeholder: t("改一下再发"), field: "im-draft", target: d.id, value: d.text });
  }
  return rows;
}

/** 一句话起草委托书 (plan K): the line the agent drafts a card from. */
export const imBriefRow = (t: T): BoardRow => ({ kind: "input", key: "im-brief", placeholder: t("一句话起草委托书：去帮谁办什么、按什么准则、别花超过多少积分"), field: "im-brief" });

/** 场所: the venues, each a press that opens its thread; `actions` at the heading's end. */
export function imVenueRows(s: ImStatus, t: T, actions?: Pressable[]): BoardRow[] {
  const rows: BoardRow[] = [{ ...section("im-venues", t("场所"), s.venues.length), ...(actions !== undefined ? { actions } : {}) }];
  if (s.venues.length === 0) rows.push(text(t("还没有场所：等守护进程同步，或在中继上建一个群")));
  for (const v of s.venues) rows.push({ kind: "entry", key: `im-venue-${v.owner}-${v.id}`, title: `${v.kindWord}「${v.name}」`, tag: v.unread > 0 ? t("{0} 未读", v.unread) : "", tone: v.unread > 0 ? "normal" : "dim", detail: v.status, action: { op: "im-open", owner: v.owner, id: v.id } });
  return rows;
}
```
**O-19** · `src/hosts/claude-code/im.ts` — `threadRows` is exported as `imThreadRows` (its first line becomes):

```ts
/** One venue open: its head, the messages as notes, a question's options, the box that speaks as the person (a channel has none). */
export function imThreadRows(th: Thread, replyTo: string | null, columns: number, t: T): BoardRow[] {
```

- [ ] **Step 4: Build and run**

```bash
npm run build && node --test test/im-host.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
```
Expected: `ℹ pass 10`, `ℹ fail 0` — `imTabRows` draws what it drew.

- [ ] **Step 5: Commit**

```bash
git add src/hosts/claude-code/im.ts test/im-host.test.mjs
git commit -m "The IM tools sign as mcp__gemsbang__; the 消息 page's rows in parts"
```

---

### Task 4: The pure module: the tabs, the pages, the band's line, the dialogs

**Files:**
- Create: `src/hosts/claude-code/gemsbang.ts`
- Modify: `src/hosts/claude-code/actions.ts`, `src/hosts/claude-code/text.ts`
- Test: `test/gemsbang.test.mjs`

- [ ] **Step 1: Write `test/gemsbang.test.mjs`**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { agentLine, gemsbangAboutRows, gemsbangBand, gemsbangRows, gemsbangSettingsRows, gemsbangTabs, GEMSBANG_MARK_SVG } from "../dist/hosts/claude-code/gemsbang.js";
import { DEFAULT_SETTINGS } from "../dist/hosts/claude-code/settings.js";
import { wordsFor, ZH } from "../dist/hosts/claude-code/text.js";
import { hhmm } from "../dist/hosts/claude-code/time.js";

// The gemsbang plugin's pure parts (plan O): the band's one line, the pane's tabs and rows, the dialogs.
const t = ZH;
const grant = { kind: "grant", key: "https://relay.test/john/people/john.geml#request-1", text: "李四的 agent 请小评评它的设计稿 · 访客", actions: ["允许一次", "允许此人", "拒绝"], since: "2026-11-01T08:00:00Z", level: 0 };
const decide = { kind: "decide", key: "https://relay.test/john/venues/g-7.geml#m-ask", text: "小评问：按哪版准则评？", actions: ["v3", "v2", "自己写"], since: "2026-11-01T09:00:00Z", venue: "g-7", level: 0 };
const card = (state, extra = {}) => ({ owner: "john", id: "t-57", title: "评审", direction: "outsource", directionWord: "外包", state, stateWord: state === "open" ? "待放行" : "进行中", progress: "p", brief: [], role: "delegator", heartbeat: "—", versions: 0, actions: [], card: {}, waitingOn: "李四", ...extra });
const im = (extra = {}) => ({ configured: true, person: "john", relay: "relay.test", agents: ["xiaoping", "xiaoguan"], connected: true, at: "2026-11-01T05:09:00Z", needs: [], venues: [{ owner: "john", id: "g-7", kind: "group", kindWord: "群", name: "前端周会", status: "2 人 · 1 个 agent", unread: 3 }], drafts: [], cards: [], presence: { xiaoping: "idle" }, ...extra });
const kinds = (rows) => rows.map((r) => `${r.kind}:${r.text ?? r.title ?? r.key ?? ""}`);

test("the tabs: 消息 counts what waits on the person (needs and drafts), 任务 the cards on their way, 钱包 none", () => {
  const draft = { id: "d-1", agent: "xiaoping", venueName: "群「先看」", text: "要改就直接改", at: "2026-11-01T09:00:00Z" };
  assert.deepEqual(gemsbangTabs(im({ needs: [grant, decide], drafts: [draft], cards: [card("open"), card("accepted", { id: "t-1" })] }), t).map((x) => x.label), ["消息 3", "任务 1", "钱包"]);
  assert.deepEqual(gemsbangTabs(null, t).map((x) => x.label), ["消息", "任务", "钱包"]);
  assert.deepEqual(gemsbangTabs(im(), wordsFor("en")).map((x) => x.label), ["Messages", "Tasks", "Wallet"]);
});

test("the band: the plugin's own problem first; nothing before the first read; not connected says so; a need leads with its buttons and how many more; else the agent, its presence and where things stand", () => {
  assert.deepEqual(gemsbangBand(im(), "xiaoping", "gemsbang：找不到 node", t), { verb: "", title: "gemsbang：找不到 node", tone: "error", note: "", actions: [], more: 0 });
  assert.equal(gemsbangBand(null, undefined, null, t), undefined);
  assert.deepEqual(gemsbangBand({ ...im(), configured: false }, undefined, null, t), { verb: "", title: "还没连上中继", tone: "dim", note: "看板里有连法", actions: [], more: 0 });
  const need = gemsbangBand(im({ needs: [grant, decide] }), "xiaoping", null, t);
  assert.deepEqual([need.verb, need.title, need.more, need.actions.map((a) => a.label)], ["定", decide.text, 1, ["v3", "v2", "自己写"]], "the band's order: a question before a request");
  assert.deepEqual(need.actions[0].action, { op: "im-need", key: decide.key, action: "v3" });
  const quiet = gemsbangBand(im({ cards: [card("open")] }), "xiaoping", null, t);
  assert.deepEqual([quiet.verb, quiet.title, quiet.tone, quiet.actions], ["xiaoping", "空闲 · #t-57 待放行 · 等李四 · 群里有 3 条新消息，没点名你", "dim", []]);
  assert.equal(gemsbangBand(im({ venues: [] }), "xiaoping", null, t).title, "空闲");
  assert.deepEqual([gemsbangBand(im({ venues: [] }), undefined, null, t).verb, gemsbangBand(im({ venues: [] }), undefined, null, t).title], ["", "没选 agent"]);
  const offline = gemsbangBand(im({ connected: false, needs: [{ kind: "offline", key: "offline:relay", text: "连不上中继 relay.test", actions: ["重试"], since: "2026-11-01T09:00:00Z", level: 0 }] }), "xiaoping", null, t);
  assert.deepEqual([offline.verb, offline.title, offline.tone], ["断了", "连不上中继 relay.test", "error"]);
});

test("the agent's line: its name, 代 whom, its presence and the wallet's balance, and whether the relay is reached", () => {
  assert.deepEqual(agentLine(im({ wallet: { balance: 86, caps: {}, used: {}, lines: [], recent: [] } }), "xiaoping", t), { name: "xiaoping", line: "代 john · 空闲 · 钱包 86", link: "在线", tone: "success" });
  assert.deepEqual(agentLine(im({ connected: false }), "xiaoguan", t), { name: "xiaoguan", line: "代 john · 睡着", link: "断了", tone: "error" });
  assert.equal(agentLine(null, "xiaoping", t), undefined);
  assert.equal(agentLine(im(), undefined, t).name, "没选 agent");
});

test("the pages: 消息 holds 需要我, 回群前先给你看 and 场所 with 刷新, or the open thread; 任务 the cards and the brief; 钱包 the wallet; nothing read yet, and not connected, say so", () => {
  const draft = { id: "d-1", agent: "xiaoping", venueName: "群「先看」", text: "要改就直接改", at: "2026-11-01T09:00:00Z" };
  const msgs = gemsbangRows({ tab: "messages", status: im({ needs: [grant], drafts: [draft] }), thread: null, replyTo: null, columns: 80, t });
  assert.deepEqual(msgs.filter((r) => r.kind === "section").map((r) => [r.text, r.count]), [["需要我", 1], ["回群前先给你看", 1], ["场所", 1]]);
  assert.deepEqual(msgs.find((r) => r.key === "im-venues").actions.map((a) => a.action), [{ op: "im-refresh" }]);
  assert.deepEqual(msgs.find((r) => r.kind === "entry").action, { op: "im-open", owner: "john", id: "g-7" });
  const thread = { owner: "john", id: "g-7", kind: "group", kindWord: "群", name: "前端周会", people: ["john", "zhangsan"], agents: ["xiaoping"], draftFirst: false, total: 1, messages: [] };
  const opened = gemsbangRows({ tab: "messages", status: im(), thread, replyTo: null, columns: 80, t });
  assert.deepEqual([opened[0].kind, opened[0].text, opened.at(-1).field], ["heading", "群「前端周会」", "im-say"]);
  const tasks = gemsbangRows({ tab: "tasks", status: im({ cards: [card("open", { actions: ["算了"] })] }), thread: null, replyTo: null, columns: 80, t });
  assert.deepEqual(kinds(tasks).map((k) => k.split(":")[0]), ["section", "card", "input", "input"]);
  assert.equal(tasks.at(-1).field, "im-brief");
  assert.deepEqual(kinds(gemsbangRows({ tab: "tasks", status: im({ agents: [] }), thread: null, replyTo: null, columns: 80, t })), ["text:还没有任务卡：一句话起草委托书，agent 起草成卡给你过目，你点发布才发。"]);
  assert.deepEqual(kinds(gemsbangRows({ tab: "wallet", status: im({ wallet: { balance: 86, caps: {}, used: {}, lines: ["余额 86"], recent: ["+20 收到"] } }), thread: null, replyTo: null, columns: 80, t })), ["section:钱包", "text:余额 86", "text:+20 收到"]);
  assert.match(gemsbangRows({ tab: "wallet", status: im(), thread: null, replyTo: null, columns: 80, t })[0].text, /^钱包还没同步过来/);
  assert.deepEqual(kinds(gemsbangRows({ tab: "messages", status: null, thread: null, replyTo: null, columns: 80, t })), ["text:正在读取消息…"]);
  const setup = gemsbangRows({ tab: "tasks", status: { ...im(), configured: false }, thread: null, replyTo: null, columns: 80, t });
  assert.deepEqual([setup[0].text, setup[2].text, setup.at(-1).items[0].action], ["还没连上中继", "gemworks connect setup --relay <url> --token <token>\ngemworks connect", { op: "im-refresh" }]);
});

test("the settings: whose words this session speaks (the chosen one, else the first), the relay with its last sync and what waits, 重连, the phone's code, the language, 完成", () => {
  const rows = gemsbangSettingsRows({ status: im({ outbox: 2 }), settings: { ...DEFAULT_SETTINGS, im: { agent: "xiaoguan" } }, locale: "zh_CN.UTF-8", phoneCode: "482913", columns: 100, t });
  assert.deepEqual(rows.filter((r) => r.kind === "section").map((r) => r.text), ["本会话代谁说话", "中继", "手机", "语言"]);
  assert.deepEqual(rows.filter((r) => r.kind === "button").map((r) => [r.label, r.primary === true, r.action]), [["( ) xiaoping · 空闲", false, { op: "setting", key: "im.agent", value: "xiaoping" }], ["(•) xiaoguan · 睡着", true, { op: "setting", key: "im.agent", value: "xiaoguan" }]]);
  assert.ok(rows.some((r) => r.kind === "text" && r.text === `relay.test · john · ${hhmm("2026-11-01T05:09:00Z")} 同步过 · 待发 2`));
  const presses = rows.filter((r) => r.kind === "buttons").flatMap((r) => r.items);
  assert.deepEqual(presses.map((b) => b.key), ["im-sync", "im-phone-code", "lang-system", "lang-zh", "lang-en", "lang-ja", "settings-done"]);
  assert.equal(presses.find((b) => b.key === "lang-system").primary, true);
  assert.deepEqual(presses.at(-1).action, { op: "dialog", dialog: null });
  assert.ok(rows.some((r) => r.kind === "text" && r.text === "绑定码 482913 · 十分钟内在 bot 里发 /bind 482913"));
  const first = gemsbangSettingsRows({ status: im({ connected: false, error: "ECONNREFUSED" }), settings: DEFAULT_SETTINGS, locale: undefined, phoneCode: null, columns: 100, t });
  assert.equal(first.find((r) => r.key === "im-agent-xiaoping").primary, true, "none chosen: the first");
  assert.ok(first.some((r) => r.kind === "text" && r.tone === "error" && r.text.includes("连不上")));
  assert.ok(first.some((r) => r.kind === "text" && r.text === "ECONNREFUSED"));
  const none = gemsbangSettingsRows({ status: { ...im(), configured: false }, settings: DEFAULT_SETTINGS, locale: undefined, phoneCode: null, columns: 100, t });
  assert.deepEqual(none.filter((r) => r.kind === "buttons").flatMap((r) => r.items).map((b) => b.key), ["lang-system", "lang-zh", "lang-en", "lang-ja", "settings-done"], "no relay: no 重连 and no code");
});

test("the about dialog: the mark, what it is, its version, beside gemworks, the licence, the repository", () => {
  const rows = gemsbangAboutRows("0.5.0", t);
  assert.deepEqual([rows[0].kind, rows[0].svg, rows.at(-1).href], ["image", GEMSBANG_MARK_SVG, "https://github.com/geml-spec/gemsbang"]);
  assert.ok(rows.some((r) => r.kind === "text" && r.text === "插件 gemsbang 0.5.0"));
  assert.match(GEMSBANG_MARK_SVG, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
npm run build && node --test test/gemsbang.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)|ERR_MODULE_NOT_FOUND"
```
Expected: `ERR_MODULE_NOT_FOUND` for `dist/hosts/claude-code/gemsbang.js`.

- [ ] **Step 3: Write `src/hosts/claude-code/gemsbang.ts`**

```ts
// The gemsbang plugin as the Claude Code shell draws it (plan O): the IM on
// its own, beside gemworks or without it. One line above the prompt (the
// 「需要我」 row, else where the session's agent is), a pane with the agent's
// line and three tabs (消息, 任务, 钱包), and its settings and about dialogs,
// as rows of the kinds the board already draws. Pure and Node-free: the bridge
// brings ImStatus (daemon/view.ts); the hooks module draws and runs the presses.
import { PRESENCE_WORDS } from "../../core/im/presence.js";
import type { ImStatus, Thread } from "../../daemon/view.js";
import type { Pressable } from "./actions.js";
import { truncate, type Tone } from "./band.js";
import type { BoardRow } from "./board.js";
import { imBand, imBriefRow, imCardRows, imDraftRows, imNeedRows, imQuietLine, imThreadRows, imVenueRows, imWalletRows } from "./im.js";
import type { Settings } from "./settings.js";
import { langOf, type T } from "./text.js";
import { hhmm } from "./time.js";

export const GEMSBANG_BOARD_ID = "gemsbang-board";
export const GEMSBANG_DIALOG_ID = "gemsbang-dialog";
export const GEMSBANG_TABS = ["messages", "tasks", "wallet"] as const;
export type GemsbangTab = (typeof GEMSBANG_TABS)[number];
export const GEMSBANG_REPO = "https://github.com/geml-spec/gemsbang";

/** The mark: a speech bubble holding a gem, on a blue disc, with the red dot of something new. */
export const GEMSBANG_MARK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="gb" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="64"><stop offset="0" stop-color="#42b4f4"/><stop offset="1" stop-color="#0a74c0"/></linearGradient></defs><circle cx="32" cy="32" r="32" fill="url(#gb)"/><path d="M20 16H44A6 6 0 0 1 50 22V38A6 6 0 0 1 44 44H28L17 53L19 44H20A6 6 0 0 1 14 38V22A6 6 0 0 1 20 16Z" fill="#fff"/><path d="M26 23H38L43 29L32 40L21 29Z" fill="url(#gb)"/><path d="M21 29H43M26 23l6 6 6-6M32 29v11" fill="none" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/><circle cx="52" cy="12" r="8" fill="#ef3b3f" stroke="#fff" stroke-width="2.5"/></svg>';
/** The mark where the surface draws no pictures: one character in the mark's blue. */
export const GEMSBANG_MARK_CHAR = "@";
export const GEMSBANG_BLUE = "#0a74c0";

const text = (s: string, tone: Tone = "dim"): BoardRow => ({ kind: "text", text: s, tone });
const section = (key: string, s: string): BoardRow => ({ kind: "section", key, text: s });
const open = (c: ImStatus["cards"][number]): boolean => c.state !== "accepted" && c.state !== "closed";

/** The tabs with their counts: 消息 what waits on the person (the needs and the drafts), 任务 the cards still on their way. */
export function gemsbangTabs(s: ImStatus | null, t: T): { id: GemsbangTab; label: string }[] {
  const waiting = s === null || !s.configured ? 0 : s.needs.length + s.drafts.length;
  const cards = s === null || !s.configured ? 0 : s.cards.filter(open).length;
  return [
    { id: "messages", label: waiting > 0 ? `${t("消息")} ${waiting}` : t("消息") },
    { id: "tasks", label: cards > 0 ? `${t("任务")} ${cards}` : t("任务") },
    { id: "wallet", label: t("钱包") },
  ];
}

/** The session's agent as the pane's second line shows it: its name, 代 whom, its presence and the wallet; whether the relay is reached. */
export interface AgentLine { name: string; line: string; link: string; tone: Tone }

export function agentLine(s: ImStatus | null, agent: string | undefined, t: T): AgentLine | undefined {
  if (s === null || !s.configured) return undefined;
  const link = s.connected === false ? t("断了") : s.connected === true ? t("在线") : t("没同步过");
  const tone: Tone = s.connected === false ? "error" : s.connected === true ? "success" : "dim";
  const wallet = s.wallet !== undefined ? ` · ${t("钱包")} ${s.wallet.balance}` : "";
  if (agent === undefined) return { name: t("没选 agent"), line: `${s.person ?? ""}${wallet}`, link, tone };
  return { name: agent, line: `代 ${s.person ?? ""} · ${PRESENCE_WORDS[s.presence[agent] ?? "asleep"]}${wallet}`, link, tone };
}

export interface PageInput { tab: GemsbangTab; status: ImStatus | null; thread: Thread | null; replyTo: string | null; columns: number; t: T }

/** One tab's rows: 消息 the needs, the drafts and the venues, or the open thread; 任务 the cards and the brief; 钱包 the wallet. */
export function gemsbangRows(o: PageInput): BoardRow[] {
  const { status: s, t } = o;
  if (s === null) return [text(t("正在读取消息…"))];
  if (!s.configured) return setupRows(t);
  if (o.tab === "messages") {
    if (o.thread !== null) return imThreadRows(o.thread, o.replyTo, o.columns, t);
    const refresh: Pressable = { key: "im-refresh", label: t("刷新"), action: { op: "im-refresh" } };
    return [...imNeedRows(s, t), ...imDraftRows(s, t, t("回群前先给你看")), ...imVenueRows(s, t, [refresh])];
  }
  if (o.tab === "tasks") {
    const rows = imCardRows(s, t);
    if (rows.length === 0) rows.push(text(t("还没有任务卡：一句话起草委托书，agent 起草成卡给你过目，你点发布才发。")));
    if (s.agents.length > 0) rows.push(imBriefRow(t));
    return rows;
  }
  const wallet = imWalletRows(s, t);
  return wallet.length > 0 ? wallet : [text(t("钱包还没同步过来：守护进程镜像了账本，这里就有余额、上限和最近的流水。"))];
}

/** Not connected yet: what to run, and a press to read again. */
function setupRows(t: T): BoardRow[] {
  return [
    { kind: "heading", key: "setup", text: t("还没连上中继"), sub: "" },
    text(t("gemsbang 通过本机的守护进程收发消息。在终端里运行："), "normal"),
    { kind: "prose", key: "setup-command", text: "gemworks connect setup --relay <url> --token <token>\ngemworks connect" },
    text(t("连上之后，这里列出需要你的事、场所、任务卡和钱包。")),
    { kind: "buttons", items: [{ key: "im-refresh", label: t("再读一次"), action: { op: "im-refresh" } }] },
  ];
}

/** The band's line: what it says, in which tone, its buttons, how many more wait. */
export interface GemsbangBand { verb: string; title: string; tone: Tone; note: string; actions: Pressable[]; more: number }

/** The band (§6.9): a problem of the plugin's own first, then the first need with its buttons, else the agent and where things stand; nothing before the first read. */
export function gemsbangBand(s: ImStatus | null, agent: string | undefined, problem: string | null, t: T): GemsbangBand | undefined {
  if (problem !== null) return { verb: "", title: problem, tone: "error", note: "", actions: [], more: 0 };
  if (s === null) return undefined;
  if (!s.configured) return { verb: "", title: t("还没连上中继"), tone: "dim", note: t("看板里有连法"), actions: [], more: 0 };
  const row = imBand(s);
  if (row !== undefined) return { verb: row.verb, title: row.text, tone: row.tone, note: "", actions: row.actions, more: row.more };
  const quiet = imQuietLine(s);
  const presence = agent !== undefined ? PRESENCE_WORDS[s.presence[agent] ?? "asleep"] : t("没选 agent");
  return { verb: agent ?? "", title: quiet === undefined || quiet === "没有需要你的事" ? presence : `${presence} · ${quiet}`, tone: "dim", note: "", actions: [], more: 0 };
}

export interface SettingsInput { status: ImStatus | null; settings: Settings; locale: string | undefined; phoneCode: string | null; columns: number; t: T }

/** The settings dialog: whose words this session speaks, the relay and 重连, the phone's code, the language; 完成 closes it. */
export function gemsbangSettingsRows(o: SettingsInput): BoardRow[] {
  const { status: s, settings, t } = o;
  const ready = s !== null && s.configured;
  const rows: BoardRow[] = [section("agent", t("本会话代谁说话"))];
  if (!ready || s.agents.length === 0) rows.push(text(t("还没有 agent：连上中继、在中继上建好 agent 之后在这里选。")));
  else {
    const chosen = settings.im.agent !== "" && s.agents.includes(settings.im.agent) ? settings.im.agent : s.agents[0];
    for (const a of s.agents) rows.push({ kind: "button", key: `im-agent-${a}`, label: `${a === chosen ? "(•)" : "( )"} ${a} · ${PRESENCE_WORDS[s.presence[a] ?? "asleep"]}`, ...(a === chosen ? { primary: true } : {}), action: { op: "setting", key: "im.agent", value: a } });
    rows.push(text(t("这个会话用它的身份说话、接它队列里的事；换一个，从下一件起算。")));
  }
  rows.push(section("relay", t("中继")));
  if (!ready) rows.push(text(t("还没连上：在终端里运行 gemworks connect setup --relay <地址> --token <令牌>")));
  else {
    const when = s.at === undefined ? t("还没同步过") : s.connected === false ? t("{0} 连不上", hhmm(s.at)) : t("{0} 同步过", hhmm(s.at));
    rows.push(text(truncate(`${s.relay ?? ""} · ${s.person ?? ""} · ${when} · ${t("待发 {0}", s.outbox ?? 0)}`, o.columns), s.connected === false ? "error" : "normal"));
    if (s.connected === false && s.error !== undefined) rows.push(text(truncate(s.error, o.columns)));
    rows.push({ kind: "buttons", items: [{ key: "im-sync", label: t("重连"), action: { op: "im-sync" } }] });
  }
  rows.push(section("phone", t("手机")));
  rows.push(text(t("在手机的 bot 里收「需要我」、按按钮、/tell 你的 agent。")));
  if (ready) rows.push({ kind: "buttons", items: [{ key: "im-phone-code", label: t("生成绑定码"), action: { op: "im-phone-code" } }] });
  if (o.phoneCode !== null) rows.push(text(t("绑定码 {0} · 十分钟内在 bot 里发 /bind {0}", o.phoneCode), "success"));
  rows.push(section("language", t("语言")));
  const system = langOf("system", o.locale);
  const names: Record<string, string> = { zh: "中文", en: "English", ja: "日本語" };
  rows.push({ kind: "buttons", items: ([["system", t("跟随系统（{0}）", names[system] ?? system)], ["zh", "中文"], ["en", "English"], ["ja", "日本語"]] as const).map(([v, label]): Pressable => ({ key: `lang-${v}`, label, ...(settings.language === v ? { primary: true } : {}), action: { op: "setting", key: "language", value: v } })) });
  rows.push({ kind: "buttons", items: [{ key: "settings-done", label: t("完成"), primary: true, action: { op: "dialog", dialog: null } }] });
  return rows;
}

/** The about dialog: the mark, what gemsbang is, its version beside gemworks, the licence and the repository. */
export function gemsbangAboutRows(version: string, t: T): BoardRow[] {
  return [
    { kind: "image", key: "mark", svg: GEMSBANG_MARK_SVG, alt: "Gemsbang", width: 48 },
    text(t("给人和他们的 agent 用的 IM：需要你的事在输入框上方一行，消息、任务卡和钱包在看板里；这个会话的 agent 收它队列里的事，照发件人的权限办，把回复发回去。"), "normal"),
    text(t("插件 gemsbang {0}", version)),
    text(t("可以和 gemworks 并排装：gemworks 管流程，gemsbang 管 IM，状态带上各占一行。")),
    text(t("许可 AGPL-3.0-only")),
    { kind: "link", key: "link-repo", href: GEMSBANG_REPO, label: t("仓库") },
  ];
}
```

- [ ] **Step 4: The actions and the words**

**O-21** · `src/hosts/claude-code/actions.ts` — `BoardAction`, after the `im-brief` op:

```ts
  /** The gemsbang pane (plan O): one of its three tabs; 重连 (one round of the daemon's sync); a code to bind the phone's bot with. */
  | { op: "im-tab"; tab: "messages" | "tasks" | "wallet" }
  | { op: "im-sync" }
  | { op: "im-phone-code" }
```

**O-22** · `src/hosts/claude-code/text.ts` — the words table, after its last entry (`"已发布 {0}"`), in English and Japanese:

```ts
  // The gemsbang plugin (plan O).
  "任务": { en: "Tasks", ja: "タスク" },
  "回群前先给你看": { en: "Shown to you before it goes", ja: "送る前に確認" },
  "还没有任务卡：一句话起草委托书，agent 起草成卡给你过目，你点发布才发。": { en: "No task cards yet: say in one line what is to be done; the agent drafts the card for you to look over, and it goes out when you publish it.", ja: "タスクカードはまだありません。一行で依頼を書くと agent がカードに起こし、確認して公開すると出ます。" },
  "钱包还没同步过来：守护进程镜像了账本，这里就有余额、上限和最近的流水。": { en: "The wallet is not here yet: once the daemon mirrors the ledger, the balance, the caps and the latest entries show here.", ja: "財布はまだ同期されていません。デーモンが台帳を写すと、残高・上限・最近の明細がここに出ます。" },
  "还没连上中继": { en: "Not connected to a relay", ja: "リレーに未接続" },
  "gemsbang 通过本机的守护进程收发消息。在终端里运行：": { en: "gemsbang sends and receives through this machine's daemon. In a terminal, run:", ja: "gemsbang はこのマシンのデーモン経由で送受信します。ターミナルで実行:" },
  "连上之后，这里列出需要你的事、场所、任务卡和钱包。": { en: "Once connected, what needs you, the venues, the task cards and the wallet are listed here.", ja: "接続すると、あなたが必要な件・場・タスクカード・財布がここに並びます。" },
  "再读一次": { en: "Read again", ja: "再読み込み" },
  "看板里有连法": { en: "the board says how", ja: "方法はボードに" },
  "本会话代谁说话": { en: "Whom this session speaks for", ja: "このセッションの代理" },
  "还没有 agent：连上中继、在中继上建好 agent 之后在这里选。": { en: "No agent yet: connect to a relay and make an agent there, then pick it here.", ja: "agent はまだありません。リレーに接続して agent を作ってから、ここで選びます。" },
  "这个会话用它的身份说话、接它队列里的事；换一个，从下一件起算。": { en: "This session speaks as it and takes what waits in its queue; a change counts from the next item.", ja: "このセッションはその名前で話し、そのキューの件を受けます。変更は次の件から。" },
  "中继": { en: "Relay", ja: "リレー" },
  "还没连上：在终端里运行 gemworks connect setup --relay <地址> --token <令牌>": { en: "Not connected: in a terminal, run gemworks connect setup --relay <url> --token <token>", ja: "未接続:ターミナルで gemworks connect setup --relay <url> --token <token> を実行" },
  "还没同步过": { en: "never synced", ja: "未同期" },
  "{0} 连不上": { en: "out of reach at {0}", ja: "{0} 接続不可" },
  "{0} 同步过": { en: "synced at {0}", ja: "{0} 同期" },
  "待发 {0}": { en: "{0} to send", ja: "送信待ち {0}" },
  "重连": { en: "Reconnect", ja: "再接続" },
  "手机": { en: "Phone", ja: "スマホ" },
  "在手机的 bot 里收「需要我」、按按钮、/tell 你的 agent。": { en: "On the phone's bot: what needs you, its buttons, and /tell to your agent.", ja: "スマホの bot で「要対応」を受け、ボタンを押し、/tell で agent に伝えます。" },
  "生成绑定码": { en: "Make a binding code", ja: "連携コードを作る" },
  "绑定码 {0} · 十分钟内在 bot 里发 /bind {0}": { en: "Code {0} · send /bind {0} to the bot within ten minutes", ja: "コード {0} · 10 分以内に bot へ /bind {0} を送信" },
  "给人和他们的 agent 用的 IM：需要你的事在输入框上方一行，消息、任务卡和钱包在看板里；这个会话的 agent 收它队列里的事，照发件人的权限办，把回复发回去。": { en: "An IM for people and their agents: what needs you is one line above the prompt; messages, task cards and the wallet are on the board. This session's agent takes what waits in its queue, works within the sender's permissions, and sends the reply back.", ja: "人とその agent のための IM。要対応の件は入力欄の上の一行に、メッセージ・タスクカード・財布はボードに。このセッションの agent はキューの件を受け、送り手の権限の範囲で処理し、返事を送り返します。" },
  "插件 gemsbang {0}": { en: "Plugin gemsbang {0}", ja: "プラグイン gemsbang {0}" },
  "可以和 gemworks 并排装：gemworks 管流程，gemsbang 管 IM，状态带上各占一行。": { en: "Installs beside gemworks: gemworks keeps the workflow, gemsbang the IM, each with its own line above the prompt.", ja: "gemworks と並べて入れられます。gemworks はフロー、gemsbang は IM を受け持ち、それぞれ一行ずつ表示します。" },
  "许可 AGPL-3.0-only": { en: "Licence AGPL-3.0-only", ja: "ライセンス AGPL-3.0-only" },
```

- [ ] **Step 5: Build and run**

```bash
npm run build && node --test test/gemsbang.test.mjs test/text.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
```
Expected: `ℹ pass 9`, `ℹ fail 0` — the words table holds every `t("…")` of the new module in English and Japanese.

- [ ] **Step 6: Commit**

```bash
git add src/hosts/claude-code/gemsbang.ts src/hosts/claude-code/actions.ts src/hosts/claude-code/text.ts test/gemsbang.test.mjs
git commit -m "The gemsbang pane, band line and dialogs as rows"
```

---

### Task 5: The plugin: the hooks module, its state, its tests, the manifest

**Files:**
- Rewrite: `hooks/register.tsx`, `types/index.d.ts`, `tests/hooks.test.ts`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`
- Modify: `test/plugin-files.test.mjs`

The new module keeps from the old one what the IM needs — the Node search, the bridge call, the IM's functions (`imAgentOf`, `loadIm`, `loadImThread`, `imPresence`, `imDeliverNext`, `imAnswerTurn`, `serveIm`), the IM cases of `act`, and the drawing helpers cut to the row kinds the IM draws — and adds the band composed over `next(e)`, the pane's agent line and tabs, the dialogs, `im-sync`, `im-phone-code`, a poll every 30 s (the IM read again, the thread too, then delivery), and `/gemsbang [messages|tasks|wallet|settings]`. Every request is bare and carries no `lastFile` and no `gh`.

- [ ] **Step 1: Write `tests/hooks.test.ts`**

```ts
// The gemsbang hooks module under the engine's own test host (plan O). A
// scripted bridge answers `process.run`; nothing here touches a disk or
// starts a process. The hooks this file registers sit beneath the plugin's:
// an AbovePrompt drawn here is the line of a plugin below it (gemworks's).
import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const ROOT = '/work/app'
const BAND = { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 140, scroll: { offset: 0, bodyRows: 4 }, view: {} }
const PANE = { title: 'Gemsbang', isFocused: true, bodyColumns: 80, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} }
const COMPOSER = { kind: 'composer' as const }
const PRESENTATION = { isFullscreen: true, columns: 160 }
const TOOLS = ['im_say', 'im_ask', 'im_report', 'im_read', 'im_forward', 'im_card', 'im_signal']

type Req = { op: string; [key: string]: unknown }

const VENUE = { owner: 'john', id: 'g-7', kind: 'group', kindWord: '群', name: '前端周会', status: '2 人 · 1 个 agent', unread: 3 }
/** The daemon's home as the bridge carries it on im-status. */
const IM = (extra: Record<string, unknown> = {}) => ({ configured: true, person: 'john', relay: 'relay.test', agents: ['xiaoping'], connected: true, at: '2026-11-01T05:09:00Z', needs: [], venues: [VENUE], drafts: [], cards: [], presence: { xiaoping: 'idle' }, ...extra })
const CARD = { owner: 'john', id: 't-57', title: '评审', direction: 'outsource', directionWord: '外包', state: 'open', stateWord: '待放行', progress: 'p', brief: [], role: 'delegator', waitingOn: '李四', heartbeat: '—', versions: 0, actions: [], card: {} }

/** The bridge, scripted: every request kept, each IM op answered as the CLI would. */
function world(on: On) {
  const w = {
    sent: [] as Req[],
    registered: [] as string[],
    commands: [] as string[],
    node: true,
    bridge: true,
    /** The home as im-status carries it; null, not set up. */
    im: null as unknown,
    /** What the next im-next answers, once; null, nothing waits. */
    imNext: null as unknown,
    imThread: null as unknown,
    imCard: null as unknown,
    /** What im-sync answers: the IM after it and a line, or the relay out of reach. */
    sync: { ok: true, text: '同步过：3 份文档' } as { ok: boolean; text?: string; error?: string },
    store: new Map<string, unknown>(),
    toasts: [] as string[],
    opened: [] as string[],
    closed: [] as string[],
  }
  const shell = { status: null, policy: null, contextKey: null, versions: { gemworks: '0.5.0', parser: '1.12.5' } }
  const answer = (req: Req): Record<string, unknown> => {
    w.sent.push(req)
    const ok = (extra: Record<string, unknown> = {}) => ({ v: 1, ok: true, shell, ...extra })
    switch (req.op) {
      case 'im-status': return ok(w.im !== null ? { im: w.im } : {})
      case 'im-next': { const d = w.imNext; w.imNext = null; return ok(d !== null ? { delivered: d } : {}) }
      case 'im-answer': return ok({ answered: { sent: 'https://relay.test/john/venues/gd-1.geml#m-r' } })
      case 'im-say': case 'im-forward': return ok({ text: '排入待发 o-1' })
      case 'im-read': return ok({ text: `群「前端周会」· 最近 ${String(req.limit ?? 12)} 条` })
      case 'im-venue': return ok(w.imThread !== null ? { thread: w.imThread } : {})
      case 'im-card': return w.imCard === null ? { v: 1, ok: false, error: 'gemworks: 没有这张卡', shell } : ok({ card: w.imCard })
      case 'im-brief': return ok({ brief: { venue: 'john/dm-xiaoping' } })
      case 'im-signal': return ok({ signal: { line: req.action === 'list' ? '命中 0/0 · 90 天收益 0% · 最大回撤 0% · 已撤回 0（仍计入）' : '已排入待发：信号 s-1 → 频道 john/ch-9 · 本机哈希 sha256:abcd' } })
      case 'im-sync': return w.sync.ok ? ok({ ...(w.im !== null ? { im: w.im } : {}), text: w.sync.text }) : { v: 1, ok: false, error: `gemworks: ${w.sync.error ?? ''}`, shell }
      case 'im-phone-code': return ok({ phoneCode: '482913' })
      default: return ok()
    }
  }
  const ran = (stdout: string, exitCode = 0) => ({ exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false })
  on('process.run', ($, e) => {
    if (e.argv[1] === '--version') return w.node ? { value: ran('v24.1.0\n') } : { deny: 'spawn node ENOENT' }
    if (e.argv[0] === '/bin/sh') return { value: ran('', 1) }
    if (e.argv[2] === 'hook') {
      if (!w.bridge) return { deny: 'timed out after 15000 ms' }
      return { value: ran(`${JSON.stringify(answer(JSON.parse(e.init?.stdin ?? '{}') as Req))}\n`) }
    }
    return { deny: `unexpected ${e.argv.join(' ')}` }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('fs.read', ($, e) => (e.path.split('\\').join('/').endsWith('/.claude-plugin/plugin.json') ? { value: JSON.stringify({ version: '0.5.0' }) } : { deny: 'ENOENT' }))
  on('tool.register', ($, e) => { w.registered.push(e.name); return { value: { tool: `mcp__gemsbang__${e.name}` } } })
  on('command.register', ($, e) => { w.commands.push(e.name); return { value: { command: e.name } } })
  on('ui.open', ($, e) => { w.opened.push(e.id); return { value: { isPlaced: true } } })
  on('ui.close', ($, e) => { w.closed.push(e.id); return { value: undefined } })
  on('ui.toast', ($, e) => { w.toasts.push(e.text); return { value: undefined } })
  on('store.get', ($, e) => ({ value: w.store.get(e.key) }))
  on('store.set', ($, e) => { w.store.set(e.key, e.value); return { value: undefined } })
  on('env.get', ($, e) => ({ value: e.name === 'LANG' ? 'zh_CN.UTF-8' : undefined }))
  on('session.id', () => ({ value: 'sess-1234567890' }))
  return w
}

async function start($: Engine, on: On): Promise<ReturnType<typeof mock.clock>> {
  const clock = mock.clock(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await clock.settle()
  return clock
}

type Drawn = { type: string; key?: string; props?: Record<string, unknown>; children?: (Drawn | string)[] }
/** The words a drawing shows, in order: what a Box drawn hidden holds left out; a Button with no children as [label]. */
const shown = (el: Drawn | string, out: string[] = []): string[] => {
  if (typeof el === 'string') { if (el.trim() !== '') out.push(el.trim()); return out }
  if (el.props?.display === 'none') return out
  if (el.type === 'Button' && (el.children ?? []).length === 0) out.push(`[${String(el.props?.label)}]`)
  for (const c of el.children ?? []) shown(c, out)
  return out
}
const linkTo = (el: Drawn | string, href: string): boolean => typeof el !== 'string' && ((el.type === 'Link' && el.props?.href === href) || (el.children ?? []).some((c) => linkTo(c, href)))
const hasSvg = (el: Drawn | string, alt: string): boolean => typeof el !== 'string' && ((el.type === 'Svg' && el.props?.alt === alt) || (el.children ?? []).some((c) => hasSvg(c, alt)))

const bandText = async ($: Engine, surface: 'terminal' | 'desktop' = 'terminal'): Promise<string> => {
  const band = await $.ui.mount({ plugin: 'gemsbang', surface, component: 'AbovePrompt', props: BAND })
  const text = shown((await band.drawn()) as unknown as Drawn).join(' ')
  await band.unmount()
  return text
}
const paneText = async ($: Engine, requestId: 'gemsbang-board' | 'gemsbang-dialog' = 'gemsbang-board'): Promise<string> => {
  const pane = await $.ui.mount({ plugin: 'gemsbang', surface: 'terminal', component: 'Pane', requestId, props: PANE })
  const text = shown((await pane.drawn()) as unknown as Drawn).join(' ')
  await pane.unmount()
  return text
}

test('the start: the seven IM tools and /gemsbang registered; every request bare at the session\'s directory, the first a read of the IM, then the presence and the queue', async ($, on) => {
  const w = world(on)
  w.im = IM()
  await start($, on)
  expect(w.registered).toEqual(TOOLS)
  expect(w.commands).toEqual(['gemsbang'])
  expect(w.sent[0]).toMatchObject({ v: 1, root: ROOT, bare: true, op: 'im-status', imSeen: {} })
  expect(w.sent.map((r) => r.op)).toEqual(['im-status', 'im-presence', 'im-next'])
  expect(w.sent.every((r) => r.bare === true && r.lastFile === undefined && r.gh === undefined)).toBe(true)
})

test('no Node: the line says so, nothing is asked of a bridge, and a call goes through', async ($, on) => {
  const w = world(on)
  w.node = false
  on('tool.call', { tool: 'Read' }, () => ({ result: 'text', text: 'text' }))
  await start($, on)
  expect(await bandText($)).toContain('gemsbang：找不到 node — 请安装 Node ≥ 22')
  expect((await $.tool.call({ tool: 'Read', tool_use_id: 'r1', file_path: '/work/app/a.txt' })).deny).toBeUndefined()
  expect(w.sent).toEqual([])
})

test('a bridge that does not answer never stops a call; gemsbang adds nothing to the band until it has missed for two minutes, then says so under the line below', async ($, on) => {
  const w = world(on)
  w.bridge = false
  on('tool.call', { tool: 'Bash' }, () => ({ result: 'ran', text: 'ran' }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => { const { Text } = $.ui.resolve(e); return h(Text, { key: 'below' }, '实现 #12 设置页缓存写路径') })
  const clock = await start($, on)
  expect((await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'npm test' })).deny).toBeUndefined()
  expect(await bandText($)).toBe('实现 #12 设置页缓存写路径')
  await clock.advance(121_000)
  await $.command.run({ command: 'gemsbang', args: '', origin: COMPOSER, presentation: PRESENTATION })
  const text = await bandText($)
  expect(text.startsWith('实现 #12 设置页缓存写路径 @ gemsbang：暂时没应答，不拦操作'), text).toBe(true)
})

test('the IM tools: each goes through the bridge as the session\'s agent and answers one line; without an agent it says so', async ($, on) => {
  const w = world(on)
  w.im = IM({ agents: [], presence: {} })
  await start($, on)
  expect((await $.tool.call({ tool: 'mcp__gemsbang__im_say', tool_use_id: 'i0', venue: 'john/g-7', text: 'x' })).result).toBe('im_say: 本会话没有 agent：在设置里选一个')
  w.im = IM()
  await $.command.run({ command: 'gemsbang', args: '', origin: COMPOSER, presentation: PRESENTATION })
  const said = await $.tool.call({ tool: 'mcp__gemsbang__im_say', tool_use_id: 'i1', venue: 'john/g-7', text: '测试跑完了' })
  expect(said.result).toBe('im_say · 群「前端周会」· 已排入待发')
  expect(w.sent.at(-1)).toMatchObject({ op: 'im-say', owner: 'john', venue: 'g-7', text: '测试跑完了', as: 'xiaoping', kind: 'chat', session: 'sess-1234567890', bare: true })
  const asked = await $.tool.call({ tool: 'mcp__gemsbang__im_ask', tool_use_id: 'i2', venue: 'john/g-7', question: '合吗', options: ['合', '不合'], who: 'person:john' })
  expect(asked.result).toBe('im_ask · 群「前端周会」· 问 person:john：合吗')
  expect(w.sent.at(-1)).toMatchObject({ op: 'im-say', kind: 'ask', text: '合吗', ask: { question: '合吗', options: ['合', '不合'], who: 'person:john' } })
  const reported = await $.tool.call({ tool: 'mcp__gemsbang__im_report', tool_use_id: 'i3', venue: 'john/g-7', text: '跑完了', evidence: [{ src: 'https://relay.test/john/journals/t-42.geml#rev-14', rev: 14 }], opinion: '可以合' })
  expect(reported.result).toBe('im_report · 群「前端周会」· 汇报，带证据 1 条')
  const read = await $.tool.call({ tool: 'mcp__gemsbang__im_read', tool_use_id: 'i4', venue: 'john/g-7', limit: 2 })
  expect(read.result).toBe('im_read · 群「前端周会」· 最近 2 条\n群「前端周会」· 最近 2 条')
  const fwd = await $.tool.call({ tool: 'mcp__gemsbang__im_forward', tool_use_id: 'i5', from: 'john/g-7#m-1', to: 'john/g-7', note: '看' })
  expect(fwd.result).toBe('im_forward · 群「前端周会」· 已排入待发：john/g-7#m-1')
  w.imCard = { card: { id: 't-57', state: 'open', title: '评审' }, before: 'draft', line: '草拟 → 发布' }
  const carded = await $.tool.call({ tool: 'mcp__gemsbang__im_card', tool_use_id: 'i6', action: 'publish', card: 'john/t-57', body: { venue: 'john/g-7' } })
  expect(carded.result).toBe('im_card · #t-57 · 草拟 → 发布')
  expect(w.sent.at(-1)).toMatchObject({ op: 'im-card', action: 'publish', owner: 'john', id: 't-57', body: { venue: 'john/g-7' }, as: 'person' })
  await $.tool.call({ tool: 'mcp__gemsbang__im_card', tool_use_id: 'i7', action: 'note', card: 'john/t-57', body: { text: '跑完了' } })
  expect(w.sent.at(-1)).toMatchObject({ op: 'im-card', action: 'note', as: 'xiaoping' })
  w.imCard = null
  expect((await $.tool.call({ tool: 'mcp__gemsbang__im_card', tool_use_id: 'i8', action: 'show', card: 'john/t-0' })).result).toBe('im_card: 没有这张卡')
  expect((await $.tool.call({ tool: 'mcp__gemsbang__im_report', tool_use_id: 'i9', venue: 'nowhere', text: 'x' })).result).toBe('im_report: venue is owner/id (im_read lists them)')
})

test('im_signal: publish with the channel in its body, list with its target, as the session\'s agent; an unknown action says what it takes', async ($, on) => {
  const w = world(on)
  w.im = IM()
  await start($, on)
  const body = { channel: 'john/ch-9', market: 'polymarket:x', side: 'yes', sizeHint: { kind: 'fraction-of-bankroll', value: 0.02 }, priceCap: 0.63, expires: '2099-01-01T00:00:00Z', confidence: 0.7 }
  const made = await $.tool.call({ tool: 'mcp__gemsbang__im_signal', tool_use_id: 's1', action: 'publish', body })
  expect(w.sent.filter((r) => r.op === 'im-signal').at(-1)).toMatchObject({ action: 'publish', as: 'xiaoping', body })
  expect(String(made.result)).toContain('已排入待发：信号 s-1 → 频道 john/ch-9')
  const listed = await $.tool.call({ tool: 'mcp__gemsbang__im_signal', tool_use_id: 's2', action: 'list', target: 'xiaoping@john' })
  expect(String(listed.result)).toContain('命中 0/0')
  expect(String((await $.tool.call({ tool: 'mcp__gemsbang__im_signal', tool_use_id: 's3', action: 'sell' })).result)).toContain('action is publish, retract, skip or list')
})

test('a queue item is delivered between turns with its envelope: the turn it starts keeps the sender\'s scope, and its answer goes back as the agent; presence follows the session', async ($, on) => {
  const w = world(on)
  w.im = IM({ venues: [], presence: {} })
  const item = { id: 'qi-gd-1-g-1', n: 1, prompt: '这个项目怎么跑？', sender: 'guest:g-1', senderName: '访客 g-1', level: 'guest', venue: 'gd-1', venueKind: 'guest-dm', venueName: '访客', at: '2026-10-31T09:00:00Z', hops: 0, prev: null, hash: 'sha256:x' }
  const envelope = '[来自 访客私信 · 访客 g-1（访客） · 权限：只读 · 回复将发给访客 · 队列中还有 0 条]'
  w.imNext = { item, envelope, text: `${envelope}\n这个项目怎么跑？`, scope: { write: false, run: 'none', budget: 5 }, queued: 0, draftFirst: false, dropped: [] }
  const prompts: { text: string; origin: unknown }[] = []
  on('prompt.submit', ($, e) => { prompts.push({ text: e.text, origin: e.origin }); return { text: e.text } })
  on('tool.call', { tool: 'Read' }, () => ({ result: 'file text', text: 'file text' }))
  on('tool.call', { tool: 'Write' }, () => ({ result: 'written', text: 'written' }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  const clock = await start($, on)
  expect(w.sent.filter((r) => r.op === 'im-next').at(-1)).toMatchObject({ agent: 'xiaoping', take: true })
  expect(prompts).toEqual([{ text: `${envelope}\n这个项目怎么跑？`, origin: { kind: 'plugin', name: 'gemsbang' } }])
  expect(w.sent.filter((r) => r.op === 'im-presence').map((r) => [r.agent, r.session, r.presence, r.login])).toEqual([['xiaoping', 'sess-1234567890', 'idle', 'subscription'], ['xiaoping', 'sess-1234567890', 'thinking', 'subscription']])
  expect((await $.tool.call({ tool: 'Read', tool_use_id: 'r1', file_path: '/work/app/README.md' })).deny).toBeUndefined()
  const write = await $.tool.call({ tool: 'Write', tool_use_id: 'w1', file_path: '/work/app/x.txt', content: 'x' })
  expect(write.deny).toBe('IM：这一轮来自 访客 g-1（访客），权限：只读；Write 不在范围内，没有执行。要更多权限，在回复里说明，由主人放行。')
  await clock.settle()
  expect(w.sent.filter((r) => r.op === 'im-presence').map((r) => r.presence)).toEqual(['idle', 'thinking', 'tool'])
  await $.turn.complete({ answer: '跑 npm start 就行', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.settle()
  expect(w.sent.filter((r) => r.op === 'im-answer')).toMatchObject([{ agent: 'xiaoping', text: '跑 npm start 就行', session: 'sess-1234567890', item: { id: 'qi-gd-1-g-1' } }])
  expect(w.toasts.at(-1)).toBe('已发回 访客私信')
  expect(w.sent.filter((r) => r.op === 'im-next').length).toBe(2)
  expect(w.sent.filter((r) => r.op === 'im-presence').map((r) => r.presence)).toEqual(['idle', 'thinking', 'tool', 'idle'])
  expect((await $.tool.call({ tool: 'Write', tool_use_id: 'w2', file_path: '/work/app/y.txt', content: 'y' })).deny, 'the scope ends with the turn').toBeUndefined()
})

test('a card\'s turn: a write outside its room is refused with the room\'s path, one inside passes, a Bash command starts in the room; all of it ends with the turn', async ($, on) => {
  const w = world(on)
  w.im = IM({ person: 'wangwu', agents: ['xiaoce'], venues: [], presence: {} })
  const item = { id: 'qi-t-42-start-2', n: 1, prompt: '任务卡归你了', sender: 'person:john', senderName: 'john', level: 'member', venue: 'th-t-42', venueKind: 'thread', venueName: '导出 PDF', at: '2026-10-31T09:00:00Z', hops: 0, prev: null, hash: 'sha256:x', card: { id: 't-42', address: 'https://relay.test/john/cards/t-42.geml', title: '导出 PDF', tools: ['read', 'edit', 'test'], venueOfWork: 'worker-sandbox', credits: 40 } }
  const envelope = '[来自 线程「导出 PDF」 · john（成员） · 权限：读、在沙箱里跑 · 回复将发回该线程，成员可见 · 队列中还有 0 条]'
  w.imNext = { item, envelope, text: `${envelope}\n任务卡归你了`, scope: { write: true, run: 'sandbox', budget: 40 }, queued: 0, draftFirst: false, dropped: [], room: '/h/im/rooms/t-42' }
  const commands: string[] = []
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('tool.call', { tool: 'Write' }, () => ({ result: 'written', text: 'written' }))
  on('tool.call', { tool: 'Bash' }, ($, e) => { commands.push(e.command); return { result: 'ran', text: 'ran' } })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  const clock = await start($, on)
  expect((await $.tool.call({ tool: 'Write', tool_use_id: 'w1', file_path: '/work/app/x.txt', content: 'x' })).deny).toBe('IM：这一轮是任务卡 #t-42 的客房，只能写到 /h/im/rooms/t-42 里；Write 写的是 /work/app/x.txt，没有执行。')
  expect((await $.tool.call({ tool: 'Write', tool_use_id: 'w2', file_path: '/h/im/rooms/t-42/x.txt', content: 'x' })).deny).toBeUndefined()
  expect((await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'npm test' })).deny).toBeUndefined()
  expect(commands).toEqual(['cd "/h/im/rooms/t-42" && npm test'])
  await $.turn.complete({ answer: '做完了', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.settle()
  expect((await $.tool.call({ tool: 'Write', tool_use_id: 'w3', file_path: '/work/app/y.txt', content: 'y' })).deny).toBeUndefined()
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b2', command: 'ls' })
  expect(commands.at(-1)).toBe('ls')
})

test('the band: gemsbang\'s line under the line a plugin below it drew; the 需要我 row leads with its buttons, a press goes through the bridge and reads the IM again; 断了\'s 重试 is a round of sync', async ($, on) => {
  const w = world(on)
  const decide = { kind: 'decide', key: 'https://relay.test/john/venues/g-7.geml#m-ask', text: '群「前端周会」· xiaoping 问：要不要合并？', actions: ['合', '不合', '自己写'], since: '2026-10-31T09:00:00Z', venue: 'g-7', level: 0 }
  const grant = { kind: 'grant', key: 'https://relay.test/john/people/john.geml#request-1', text: 'lisi 申请看一块', actions: ['允许一次', '允许此人', '拒绝'], since: '2026-10-31T08:00:00Z', level: 0 }
  w.im = IM({ needs: [decide, grant] })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => { const { Text } = $.ui.resolve(e); return h(Text, { key: 'below' }, '实现 #12 设置页缓存写路径') })
  await start($, on)
  const text = await bandText($)
  expect(text.startsWith('实现 #12 设置页缓存写路径 @ 定 群「前端周会」· xiaoping 问：要不要合并？'), text).toBe(true)
  expect(text).toContain('[合] [不合] [自己写] [还有 1 件] [看板]')
  const band = await $.ui.mount({ plugin: 'gemsbang', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  await band.press({ key: 'im-need-0' })
  expect(w.sent.at(-2)).toMatchObject({ op: 'im-need', key: decide.key, action: '合' })
  expect(w.sent.at(-1)).toMatchObject({ op: 'im-status' })
  await band.unmount()
  w.im = IM({ connected: false, needs: [{ kind: 'offline', key: 'offline:relay', text: '连不上中继 relay.test', actions: ['重试'], since: '2026-10-31T09:00:00Z', level: 0 }, decide, grant] })
  await $.command.run({ command: 'gemsbang', args: '', origin: COMPOSER, presentation: PRESENTATION })
  expect(await bandText($)).toContain('断了 连不上中继 relay.test [重试] [还有 2 件] [看板]')
  const again = await $.ui.mount({ plugin: 'gemsbang', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  await again.press({ key: 'im-need-0' })
  await again.unmount()
  expect(w.sent.at(-1)).toMatchObject({ op: 'im-sync', bare: true })
  expect(w.toasts.at(-1)).toBe('同步过：3 份文档')
})

test('the band when nothing needs the person: the agent, its presence and where things stand; not set up says so; on the desktop the mark and the board are pictures', async ($, on) => {
  const w = world(on)
  w.im = IM({ cards: [CARD] })
  await start($, on)
  expect(await bandText($)).toBe('@ xiaoping 空闲 · #t-57 待放行 · 等李四 · 群里有 3 条新消息，没点名你 [看板]')
  const desk = await $.ui.mount({ plugin: 'gemsbang', surface: 'desktop', component: 'AbovePrompt', props: BAND })
  expect(hasSvg((await desk.drawn()) as unknown as Drawn, 'Gemsbang')).toBe(true)
  await desk.press({ key: 'band-board' })
  await desk.unmount()
  expect(w.opened).toContain('gemsbang-board')
  w.im = null
  await $.command.run({ command: 'gemsbang', args: '', origin: COMPOSER, presentation: PRESENTATION })
  expect(await bandText($)).toBe('@ 还没连上中继 · 看板里有连法 [看板]')
})

test('the pane: the agent\'s line, 消息 3 · 任务 1 · 钱包; a venue opens its thread, the box speaks as the person, 返回 goes back; 钱包 says when nothing is mirrored', async ($, on) => {
  const w = world(on)
  const grant = { kind: 'grant', key: 'https://relay.test/john/people/john.geml#request-1', text: 'lisi 申请看一块', actions: ['允许一次', '允许此人', '拒绝'], since: '2026-10-31T08:00:00Z', level: 0 }
  const draft = { id: 'd-1', agent: 'xiaoping', venueName: '群「先看」', text: '要改就直接改', at: '2026-11-01T09:00:00Z' }
  w.im = IM({ needs: [grant], drafts: [draft, { ...draft, id: 'd-2' }], cards: [CARD] })
  w.imThread = { owner: 'john', id: 'g-7', kind: 'group', kindWord: '群', name: '前端周会', people: ['john', 'zhangsan'], agents: ['xiaoping'], draftFirst: false, total: 1, messages: [{ id: 'm-1', speaker: 'person:zhangsan', label: 'zhangsan', kind: 'chat', kindWord: '消息', text: '@xiaoping 缓存多久失效？', at: '2026-11-01T05:02:00Z', source: 'typed', parts: [], evidence: [], decision: false }] }
  await start($, on)
  const opened = await $.command.run({ command: 'gemsbang', args: '', origin: COMPOSER, presentation: PRESENTATION })
  expect(opened.text).toBe('已打开 Gemsbang 看板。')
  const text = await paneText($)
  expect(text.startsWith('@ Gemsbang 0.5.0 [设置] [关于] xiaoping 代 john · 空闲 在线'), text).toBe(true)
  expect(text).toContain('消息 3 [任务 1] [钱包]')
  expect(text).toContain('需要我 1')
  expect(text).toContain('回群前先给你看 2')
  expect(text).toContain('场所 1 [刷新]')
  let pane = await $.ui.mount({ plugin: 'gemsbang', surface: 'terminal', component: 'Pane', requestId: 'gemsbang-board', props: PANE })
  await pane.press({ key: 'go-im-venue-john-g-7' })
  await pane.unmount()
  expect(w.sent.at(-1)).toMatchObject({ op: 'im-venue', owner: 'john', id: 'g-7' })
  expect(await paneText($)).toContain('群「前端周会」 2 人 · 1 个 agent [返回]')
  pane = await $.ui.mount({ plugin: 'gemsbang', surface: 'terminal', component: 'Pane', requestId: 'gemsbang-board', props: PANE })
  await pane.input({ key: 'im-say', text: '十分钟' })
  expect(w.sent.filter((r) => r.op === 'im-say').at(-1)).toMatchObject({ owner: 'john', venue: 'g-7', text: '十分钟', as: 'person' })
  await pane.press({ key: 'im-back' })
  await pane.press({ key: 'tab-wallet' })
  await pane.unmount()
  expect(await paneText($)).toContain('钱包还没同步过来')
})

test('the 任务 tab: the cards, and the brief under them goes through the bridge as im-brief; 改一下 under a draft takes the words typed first, and says so when there are none', async ($, on) => {
  const w = world(on)
  w.im = IM({ cards: [{ ...CARD, state: 'draft', stateWord: '草拟', actions: ['发布', '改一下', '算了'], card: { id: 't-57', state: 'draft', title: '评审' } }] })
  const clock = await start($, on)
  const pane = await $.ui.mount({ plugin: 'gemsbang', surface: 'terminal', component: 'Pane', requestId: 'gemsbang-board', props: PANE })
  await pane.press({ key: 'tab-tasks' })
  await pane.input({ key: 'im-brief', text: '去帮李四评一下设置页，别花超过 20 积分' })
  await clock.settle()
  expect(w.sent.filter((r) => r.op === 'im-brief').at(-1)).toMatchObject({ text: '去帮李四评一下设置页，别花超过 20 积分' })
  expect(w.toasts.at(-1)).toBe('已交给 agent 起草')
  const sent = w.sent.length
  await pane.press({ key: 'im-card-1-john/t-57' })
  expect(w.sent.length).toBe(sent)
  expect(w.toasts.at(-1)).toBe('先写一行：怎么改')
  await pane.input({ key: 'im-card-words-john/t-57', text: '预算改成 20' })
  await pane.press({ key: 'im-card-1-john/t-57' })
  await pane.unmount()
  expect(w.sent.filter((r) => r.op === 'im-brief').at(-1)).toMatchObject({ text: '预算改成 20', card: 't-57' })
})

test('the settings: the agent picked is kept and reported; 重连 runs a round of sync; 生成绑定码 shows the code; the language changes the words; 完成 closes', async ($, on) => {
  const w = world(on)
  w.im = IM({ agents: ['xiaoping', 'xiaoguan'], presence: { xiaoping: 'idle' }, outbox: 2 })
  await start($, on)
  const board = await $.ui.mount({ plugin: 'gemsbang', surface: 'terminal', component: 'Pane', requestId: 'gemsbang-board', props: PANE })
  await board.press({ key: 'dialog-settings' })
  await board.unmount()
  expect(w.opened).toContain('gemsbang-dialog')
  expect(await paneText($, 'gemsbang-dialog')).toContain('本会话代谁说话 [(•) xiaoping · 空闲] [( ) xiaoguan · 睡着]')
  let dialog = await $.ui.mount({ plugin: 'gemsbang', surface: 'terminal', component: 'Pane', requestId: 'gemsbang-dialog', props: PANE })
  await dialog.press({ key: 'im-agent-xiaoguan' })
  expect(w.store.get('settings')).toMatchObject({ im: { agent: 'xiaoguan' } })
  expect(w.sent.filter((r) => r.op === 'im-presence').at(-1)).toMatchObject({ agent: 'xiaoguan', presence: 'idle' })
  expect(w.sent.filter((r) => r.op === 'im-next').at(-1)).toMatchObject({ agent: 'xiaoguan' })
  await dialog.press({ key: 'im-sync' })
  expect(w.sent.at(-1)).toMatchObject({ op: 'im-sync' })
  expect(w.toasts.at(-1)).toBe('同步过：3 份文档')
  w.sync = { ok: false, error: '连不上中继：ECONNREFUSED' }
  await dialog.press({ key: 'im-sync' })
  expect(w.toasts.at(-1)).toBe('gemsbang：连不上中继：ECONNREFUSED')
  await dialog.press({ key: 'im-phone-code' })
  await dialog.unmount()
  const text = await paneText($, 'gemsbang-dialog')
  expect(text).toContain('relay.test · john ·')
  expect(text).toContain('同步过 · 待发 2 [重连]')
  expect(text).toContain('绑定码 482913 · 十分钟内在 bot 里发 /bind 482913')
  dialog = await $.ui.mount({ plugin: 'gemsbang', surface: 'terminal', component: 'Pane', requestId: 'gemsbang-dialog', props: PANE })
  await dialog.press({ key: 'lang-en' })
  await dialog.unmount()
  expect(w.store.get('settings')).toMatchObject({ language: 'en' })
  expect(await paneText($, 'gemsbang-dialog')).toContain('Relay')
  dialog = await $.ui.mount({ plugin: 'gemsbang', surface: 'terminal', component: 'Pane', requestId: 'gemsbang-dialog', props: PANE })
  await dialog.press({ key: 'settings-done' })
  await dialog.unmount()
  expect(w.closed).toContain('gemsbang-dialog')
})

test('/gemsbang: a tab by name opens the board there; settings opens the settings; about shows the version and the repository', async ($, on) => {
  const w = world(on)
  w.im = IM({ cards: [CARD] })
  await start($, on)
  expect((await $.command.run({ command: 'gemsbang', args: 'tasks', origin: COMPOSER, presentation: PRESENTATION })).text).toBe('已打开 Gemsbang 看板。')
  expect(await paneText($)).toContain('[消息] 任务 1 [钱包]')
  expect((await $.command.run({ command: 'gemsbang', args: 'settings', origin: COMPOSER, presentation: PRESENTATION })).text).toBe('已打开 gemsbang 设置。')
  expect(w.opened.filter((id) => id === 'gemsbang-dialog').length).toBe(1)
  const board = await $.ui.mount({ plugin: 'gemsbang', surface: 'terminal', component: 'Pane', requestId: 'gemsbang-board', props: PANE })
  await board.press({ key: 'dialog-about' })
  await board.unmount()
  expect(await paneText($, 'gemsbang-dialog')).toContain('插件 gemsbang 0.5.0')
  const about = await $.ui.mount({ plugin: 'gemsbang', surface: 'terminal', component: 'Pane', requestId: 'gemsbang-dialog', props: PANE })
  expect(linkTo((await about.drawn()) as unknown as Drawn, 'https://github.com/geml-spec/gemsbang')).toBe(true)
  await about.unmount()
})
```

- [ ] **Step 2: The manifest's test**

**O-23** · `test/plugin-files.test.mjs` — the manifest's test names gemsbang (its first four lines become):

```js
test("the plugin manifest names gemsbang, keeps the package's version, points at the state contract and depends on no other plugin", () => {
  const plugin = json(".claude-plugin/plugin.json");
  const pkg = json("package.json");
  assert.equal(plugin.name, "gemsbang");
  assert.equal(plugin.dependencies, undefined);
```

**O-24** · `test/plugin-files.test.mjs` — its last assertion:

```js
assert.equal(plugin.mcpServers, undefined, "the hooks module serves the im_* tools; a manifest MCP server would list them twice");
```

**O-25** · `test/plugin-files.test.mjs` — the command test: the one command, and a plugin with no skills folder:

```js
  assert.deepEqual(commands, ["gemsbang"], "the hooks module registers /gemsbang");
  for (const dir of existsSync(at("skills")) ? readdirSync(at("skills")) : []) {
```

- [ ] **Step 3: Run them to see them fail**

```bash
npm run build && node --test test/plugin-files.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"; claude plugin test . 2>&1 | grep -E "^ [0-9]+ (pass|fail)"
```
Expected: `ℹ fail 2` (the name and the command); the hooks suite fails throughout — there is no plugin named gemsbang to mount, and its tools are not registered.

- [ ] **Step 4: Write `hooks/register.tsx`**

```tsx
// Gemsbang's Claude Code shell (plan O): the IM on its own, a plugin that sits
// beside gemworks or stands without it. It asks the bundled CLI
// (dist/gemworks.mjs: one JSON request on stdin, one JSON answer on stdout),
// every request bare, so no workspace is opened and the project's .geml/
// stays gemworks's. What it does for the model: the seven IM tools; a queue
// item delivered between turns with its envelope, the turn it starts held to
// the sender's scope (a refused call says why, a card's run starts in its
// room), its final answer sent back as the agent; the presence the senders
// see. What the person sees: one line above the prompt — the 「需要我」 row
// with its buttons, else the agent and where things stand — drawn under the
// line of any plugin it runs above, and the pane: the agent's line and three
// tabs, 消息, 任务, 钱包; the settings and about dialogs. It fails open: with
// no Node, a bridge that does not answer, or an answer that does not parse,
// every call goes through and the line says what is wrong. Its band buttons
// carry no digit hotkeys: those stay gemworks's, whose line sits beside it.
import type { EngineInterface, Register, ToolCallResult } from 'claude-code'
import { atom, read, update } from 'claude-code'
import type { GemsbangJson, GemsbangTab } from '../types'
import type { BoardAction, Pressable } from '../dist/hosts/claude-code/actions.js'
import { asksOf } from '../dist/hosts/claude-code/attention.js'
import { cellWidth, SEP, toneProps, truncate } from '../dist/hosts/claude-code/band.js'
import { glyphSvg, ICON_CHAR, ICON_SVG, ICON_TONE, inputAction } from '../dist/hosts/claude-code/board.js'
import type { BoardRow, Glyph, Icon } from '../dist/hosts/claude-code/board.js'
import type { Tone } from '../dist/hosts/claude-code/band.js'
import { fitToBudget } from '../dist/hosts/claude-code/budget.js'
import { agentLine, GEMSBANG_BLUE, GEMSBANG_BOARD_ID, GEMSBANG_DIALOG_ID, GEMSBANG_MARK_CHAR, GEMSBANG_MARK_SVG, GEMSBANG_TABS, gemsbangAboutRows, gemsbangBand, gemsbangRows, gemsbangSettingsRows, gemsbangTabs } from '../dist/hosts/claude-code/gemsbang.js'
import type { GemsbangBand } from '../dist/hosts/claude-code/gemsbang.js'
import { callRule, IM_TOOLS, imToolOf, toolLine, venueKey } from '../dist/hosts/claude-code/im.js'
import type { ImTurn } from '../dist/hosts/claude-code/im.js'
import { BRIDGE_TIMEOUT_MS, decodeResponse, encodeRequest, SLOW_TIMEOUT_MS, unreadableText } from '../dist/hosts/claude-code/protocol.js'
import type { BridgeOp, BridgeRequest, BridgeResponse } from '../dist/hosts/claude-code/protocol.js'
import { nodeMajor, toolArgs } from '../dist/hosts/claude-code/readers.js'
import { DEFAULT_SETTINGS, settingsFrom, withSetting } from '../dist/hosts/claude-code/settings.js'
import type { Settings } from '../dist/hosts/claude-code/settings.js'
import { langOf, wordsFor } from '../dist/hosts/claude-code/text.js'
import type { T } from '../dist/hosts/claude-code/text.js'
import type { CardAction } from '../dist/core/im/card.js'
import { venueLabel } from '../dist/core/im/envelope.js'
import type { Presence } from '../dist/core/im/presence.js'
import type { ImStatus, Thread } from '../dist/daemon/view.js'

const problemAtom = atom({ plugin: 'gemsbang', key: 'problem' } as const, null as string | null)
const nodeAtom = atom({ plugin: 'gemsbang', key: 'node' } as const, null as string | null)
const rootAtom = atom({ plugin: 'gemsbang', key: 'root' } as const, null as string | null)
const startedAtAtom = atom({ plugin: 'gemsbang', key: 'startedAt' } as const, null as number | null)
const setupAtom = atom({ plugin: 'gemsbang', key: 'setup' } as const, null as string | null)
const versionAtom = atom({ plugin: 'gemsbang', key: 'version' } as const, null as string | null)
const localeAtom = atom({ plugin: 'gemsbang', key: 'locale' } as const, null as string | null)
const settingsAtom = atom({ plugin: 'gemsbang', key: 'settings' } as const, null as GemsbangJson)
const tabAtom = atom({ plugin: 'gemsbang', key: 'tab' } as const, 'messages' as GemsbangTab)
const dialogAtom = atom({ plugin: 'gemsbang', key: 'dialog' } as const, null as string | null)
const phoneCodeAtom = atom({ plugin: 'gemsbang', key: 'phoneCode' } as const, null as string | null)
const imAtom = atom({ plugin: 'gemsbang', key: 'im' } as const, null as GemsbangJson)
const imThreadAtom = atom({ plugin: 'gemsbang', key: 'imThread' } as const, null as GemsbangJson)
const imReplyAtom = atom({ plugin: 'gemsbang', key: 'imReply' } as const, null as string | null)
const imTurnAtom = atom({ plugin: 'gemsbang', key: 'imTurn' } as const, null as GemsbangJson)
const imSeenAtom = atom({ plugin: 'gemsbang', key: 'imSeen' } as const, {} as GemsbangJson)
const imPresenceAtom = atom({ plugin: 'gemsbang', key: 'imPresence' } as const, null as string | null)
const imCardWordsAtom = atom({ plugin: 'gemsbang', key: 'imCardWords' } as const, null as GemsbangJson)

const STORE_SETTINGS = 'settings'
const PANE_TITLE = 'Gemsbang'
/** After a start that got no answer, a call or a prompt starts again at most this often; sooner when no Node was found. */
const START_RETRY_MS = 60_000
const NODE_RETRY_MS = 10_000
const START_BACKOFF_MS = [5_000, 15_000, 30_000, 60_000]
/** A probe's time: a first run of node behind an antivirus, or off a cold disk, takes longer than a warm one. */
const PROBE_MS = 10_000
/** A busy machine is no news: the line says the bridge is not answering only once none came back for this long. */
const QUIET_MS = 120_000
/** How often the IM is read again while nothing else asks: what came in shows, and what waits is delivered. */
const POLL_MS = 30_000
/** The ops whose answers carry the IM: they take the page's marks with them. */
const IM_CARRIERS: ReadonlySet<string> = new Set(['im-status', 'im-sync'])
/** The home not set up: an im-status answered with no IM. */
const NOT_SET_UP: ImStatus = { configured: false, agents: [], needs: [], venues: [], drafts: [], cards: [], presence: {} }

const reasonOf = (err: unknown): string => (err instanceof Error ? err.message : String(err)).replace(/^gemsbang: /, '')
const cliReason = (error: string): string => error.replace(/^gemworks: /, '')
const readSettings = async ($: EngineInterface): Promise<Settings> => settingsFrom(await read($, settingsAtom))
const readIm = async ($: EngineInterface): Promise<ImStatus | null> => (await read($, imAtom)) as unknown as ImStatus | null
const readImTurn = async ($: EngineInterface): Promise<ImTurn | null> => (await read($, imTurnAtom)) as unknown as ImTurn | null

/** The words in the language chosen: the setting, else the CLI's locale or the host's LANG. */
async function words($: EngineInterface): Promise<T> {
  const [s, locale] = await Promise.all([readSettings($), read($, localeAtom)])
  return wordsFor(langOf(s.language, locale ?? undefined))
}

async function setProblem($: EngineInterface, problem: string | null): Promise<void> {
  if ((await read($, problemAtom)) !== problem) await update($, problemAtom, () => problem)
}

/**
 * Node ≥ 22: on the session's PATH; else where a login shell finds it (Unix)
 * or `where` does (Windows); else where the installers put it; or why there is
 * none. The first candidate that answers with a new enough version is the one.
 */
async function findNode($: EngineInterface): Promise<{ node: string } | { problem: string }> {
  const major = async (bin: string): Promise<number | undefined> => {
    try {
      const r = await $.process.run([bin, '--version'], { timeoutMs: PROBE_MS })
      return r.exitCode === 0 ? nodeMajor(r.stdout) : undefined
    } catch {
      return undefined
    }
  }
  const candidates: string[] = ['node']
  const offer = (p: string): void => { const q = p.trim(); if (q !== '' && !candidates.includes(q)) candidates.push(q) }
  for (const argv of [['/bin/sh', '-lc', 'command -v node'], ['cmd.exe', '/d', '/c', 'where node']]) {
    try {
      const r = await $.process.run(argv, { timeoutMs: PROBE_MS })
      if (r.exitCode === 0) for (const line of r.stdout.split(/\r?\n/)) offer(line)
    } catch { /* not this OS, or no such shell */ }
  }
  // Each variable is named at its own call: the engine lists what a module reads, so the name must be a literal there.
  try { const v = await $.env.get('ProgramFiles'); if (v) offer(`${v}\\nodejs\\node.exe`) } catch { /* no env */ }
  try { const v = await $.env.get('LOCALAPPDATA'); if (v) { offer(`${v}\\Programs\\nodejs\\node.exe`); offer(`${v}\\Volta\\bin\\node.exe`) } } catch { /* no env */ }
  try { const v = await $.env.get('NVM_SYMLINK'); if (v) offer(`${v}\\node.exe`) } catch { /* no env */ }
  for (const p of ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node']) offer(p)
  let seen: number | undefined
  for (const bin of candidates) {
    const m = await major(bin)
    if (m === undefined) continue
    if (m >= 22) return { node: bin }
    seen = seen === undefined ? m : Math.max(seen, m)
  }
  return { problem: seen !== undefined ? `gemsbang：Node ${seen} 太旧，需要 Node ≥ 22` : 'gemsbang：找不到 node — 请安装 Node ≥ 22' }
}

/** Since when the bridge has not answered, or undefined while it answers. */
let missedSince: number | undefined
/** Whether a turn of the main loop is under way: a queue item waits for it to end. */
let turnBusy = false
let startTries = 0

/** One bare request to the CLI. Undefined when the bridge is unavailable; the line then says why. */
async function bridge($: EngineInterface, op: BridgeOp, timeoutMs: number = BRIDGE_TIMEOUT_MS): Promise<BridgeResponse | undefined> {
  const node = await read($, nodeAtom)
  const root = await read($, rootAtom)
  if (node === null || root === null) return undefined
  const request = { v: 1, root, bare: true, ...(IM_CARRIERS.has(op.op) ? { imSeen: ((await read($, imSeenAtom)) as unknown as Record<string, string> | null) ?? {} } : {}), ...op } as BridgeRequest
  let out: { exitCode: number; stdout: string; stderr: string }
  try {
    out = await $.process.run([node, `${$.plugin.root}/dist/gemworks.mjs`, 'hook'], { cwd: root, stdin: encodeRequest(request), timeoutMs })
  } catch (err) {
    const now = await $.clock.now()
    missedSince ??= now
    if (now - missedSince >= QUIET_MS) await setProblem($, `gemsbang：暂时没应答，不拦操作（${reasonOf(err)}）`)
    return undefined
  }
  missedSince = undefined
  const res = decodeResponse(out.stdout)
  if (res === undefined) {
    await setProblem($, unreadableText(out.exitCode, out.stderr, $.plugin.root).replace(/^gemworks：/, 'gemsbang：'))
    return undefined
  }
  // An answer with no shell is a request that failed outright; an IM op's own refusal is said where it was asked.
  await setProblem($, !res.ok && res.shell === undefined ? `gemsbang：${cliReason(res.error)}` : null)
  const locale = res.shell?.locale
  if (locale !== undefined && locale !== (await read($, localeAtom))) await update($, localeAtom, () => locale)
  await keepIm($, res, IM_CARRIERS.has(op.op))
  return res
}

/** The IM as an answer carried it: kept when it changed, so the line and the pane draw it; a carrier with none is a home not set up. */
async function keepIm($: EngineInterface, res: BridgeResponse, carrier: boolean): Promise<void> {
  if (!res.ok) return
  const im = res.im ?? (carrier ? NOT_SET_UP : undefined)
  if (im === undefined) return
  if (JSON.stringify(im) !== JSON.stringify(await read($, imAtom))) await update($, imAtom, () => im as unknown as GemsbangJson)
}

/** A start that got no answer tries again by itself: in 5 s, 15 s, 30 s, then every minute, until one comes. */
function scheduleStartRetry($: EngineInterface): void {
  const wait = START_BACKOFF_MS[Math.min(startTries, START_BACKOFF_MS.length - 1)] as number
  startTries += 1
  $.clock.after(wait, () => {
    void (async () => { if ((await read($, rootAtom)) !== null && (await readIm($)) === null) await startBridge($) })().catch(() => undefined)
  })
}

/** Node, then the first read of the IM. */
async function startBridge($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  await update($, startedAtAtom, () => now)
  if ((await read($, nodeAtom)) === null) {
    const found = await findNode($)
    if ('problem' in found) { await setProblem($, found.problem); return }
    await update($, nodeAtom, () => found.node)
  }
  const res = await bridge($, { op: 'im-status' })
  if (res === undefined) { scheduleStartRetry($); return }
  startTries = 0
}

/** After a start that got no answer, a tool call or a prompt starts again — at most once a minute. */
async function retryStart($: EngineInterface): Promise<void> {
  if ((await read($, rootAtom)) === null || (await readIm($)) !== null) return
  const last = await read($, startedAtAtom)
  const wait = (await read($, nodeAtom)) === null ? NODE_RETRY_MS : START_RETRY_MS
  if (last !== null && (await $.clock.now()) - last < wait) return
  await startBridge($)
}

/** Register one tool or command; a refusal is noted for the line, and the start goes on. */
async function registerOne($: EngineInterface, name: string, register: () => Promise<unknown>): Promise<void> {
  try {
    await register()
  } catch (err) {
    const reason = reasonOf(err)
    await update($, setupAtom, (was) => `${was ?? 'gemsbang：没有注册上'} ${name}（${reason}）`)
  }
}

// ---- the IM ---------------------------------------------------------------------------

/** Which agent this session is: the setting, else the first the daemon lists; none when it lists none. */
async function imAgentOf($: EngineInterface): Promise<string | undefined> {
  const im = await readIm($)
  if (im === null || !im.configured) return undefined
  const chosen = (await readSettings($)).im.agent
  return chosen !== '' && im.agents.includes(chosen) ? chosen : im.agents[0]
}

/** The IM read again, with the page's marks. */
async function loadIm($: EngineInterface): Promise<void> {
  await bridge($, { op: 'im-status' })
}

/** The open thread read again; what it shows is marked seen. */
async function loadImThread($: EngineInterface): Promise<void> {
  const open = (await read($, imThreadAtom)) as unknown as { owner: string; id: string } | null
  if (open === null) return
  const res = await bridge($, { op: 'im-venue', owner: open.owner, id: open.id })
  if (res === undefined || !res.ok || res.thread === undefined) return
  const thread = res.thread
  await update($, imThreadAtom, () => ({ owner: open.owner, id: open.id, thread }) as unknown as GemsbangJson)
  const last = thread.messages.filter((m) => m.kind !== 'system').at(-1)
  if (last !== undefined) await update($, imSeenAtom, (was) => ({ ...((((was as unknown) as Record<string, string> | null) ?? {})), [venueKey(open.owner, open.id)]: last.id }) as unknown as GemsbangJson)
}

/** The session's presence, reported when it changes; the daemon posts it with its heartbeat. */
async function imPresence($: EngineInterface, presence: Presence, task?: string): Promise<void> {
  const agent = await imAgentOf($)
  if (agent === undefined) return
  const key = `${presence}${task === undefined ? '' : `:${task}`}`
  if ((await read($, imPresenceAtom)) === key) return
  await update($, imPresenceAtom, () => key)
  const session = await $.session.id().catch(() => '')
  if (session === '') return
  let login = 'subscription'
  try { if ((await $.env.get('ANTHROPIC_API_KEY')) !== undefined) login = 'api' } catch { /* subscription */ }
  await bridge($, { op: 'im-presence', agent, session, presence, login, ...(task !== undefined ? { task } : {}) })
}

/** Between turns: the next queue item taken and submitted with its envelope; the turn it starts is marked, so the scope holds and the answer goes back. */
async function imDeliverNext($: EngineInterface): Promise<void> {
  if (turnBusy || (await readImTurn($)) !== null) return
  const agent = await imAgentOf($)
  if (agent === undefined) return
  const res = await bridge($, { op: 'im-next', agent, take: true })
  const d = res?.ok === true ? res.delivered : undefined
  if (d === undefined) return
  const turn: ImTurn = { agent, item: d.item, scope: d.scope, draftFirst: d.draftFirst, refused: 0, ...(d.room !== undefined ? { room: d.room } : {}) }
  await update($, imTurnAtom, () => turn as unknown as GemsbangJson)
  try { await $.prompt.submit({ text: d.text }) } catch { await update($, imTurnAtom, () => null); return }
  // A plugin's own submit goes through every hook but its own (the engine's rule): the turn it starts is marked here.
  turnBusy = true
  await imPresence($, 'thinking')
}

/** A delivered turn's end: the final answer back to its venue as the agent, or held as a draft; an aborted turn sends nothing. */
async function imAnswerTurn($: EngineInterface, answer: string, aborted: boolean): Promise<void> {
  const turn = await readImTurn($)
  if (turn === null) return
  await update($, imTurnAtom, () => null)
  if (aborted) return
  const t = await words($)
  const session = await $.session.id().catch(() => '')
  const res = await bridge($, { op: 'im-answer', agent: turn.agent, item: turn.item, text: answer, ...(session !== '' ? { session } : {}) })
  if (res === undefined || !res.ok) { $.ui.toast(t('IM：{0}', res === undefined ? ((await read($, problemAtom)) ?? '') : cliReason(res.error))); return }
  const a = res.answered
  if (a !== undefined && 'draft' in a) $.ui.toast(t('已成草稿，到「消息」页过目'))
  else if (a !== undefined) $.ui.toast(t('已发回 {0}', venueLabel(turn.item.venueKind, turn.item.venueName)))
}

type ImToolName = NonNullable<ReturnType<typeof imToolOf>>

/** One of the IM tools: one bridge call, one line back. */
async function serveIm($: EngineInterface, name: ImToolName, event: unknown): Promise<ToolCallResult> {
  const args = toolArgs(event as Record<string, unknown>)
  const t = await words($)
  const agent = await imAgentOf($)
  if (agent === undefined) return { result: `${name}: ${t('本会话没有 agent：在设置里选一个')}` }
  const session = await $.session.id().catch(() => '')
  const venueOf = (v: unknown): { owner: string; id: string } | undefined => { const m = typeof v === 'string' ? /^([^/#\s]+)\/([^/#\s]+)$/.exec(v) : null; return m === null ? undefined : { owner: m[1] as string, id: m[2] as string } }
  const labelOf = async (v: { owner: string; id: string }): Promise<string> => { const row = (await readIm($))?.venues.find((x) => x.owner === v.owner && x.id === v.id); return row === undefined ? `${v.owner}/${v.id}` : venueLabel(row.kind, row.name) }
  const str = (k: string): string | undefined => (typeof args[k] === 'string' ? args[k] as string : undefined)
  const embeds = (k: string): { src: string; rev?: number; hash?: string }[] | undefined => (Array.isArray(args[k]) ? (args[k] as unknown[]).filter((x): x is { src: string; rev?: number; hash?: string } => typeof x === 'object' && x !== null && typeof (x as { src?: unknown }).src === 'string') : undefined)
  const through = async (op: BridgeOp): Promise<{ ok: true; res: Extract<BridgeResponse, { ok: true }> } | { ok: false; text: string }> => {
    const res = await bridge($, op)
    if (res === undefined) return { ok: false, text: `${name}: gemsbang is unavailable: ${(await read($, problemAtom)) ?? ''}` }
    if (!res.ok) return { ok: false, text: `${name}: ${cliReason(res.error)}` }
    return { ok: true, res }
  }
  if (name === 'im_read') {
    const v = venueOf(args['venue'])
    const src = str('src')
    const limit = typeof args['limit'] === 'number' ? args['limit'] as number : undefined
    const r = await through({ op: 'im-read', ...(v !== undefined ? { owner: v.owner, venue: v.id } : {}), ...(src !== undefined ? { src } : {}), ...(limit !== undefined ? { limit } : {}) })
    if (!r.ok) return { result: r.text }
    const where = v !== undefined ? await labelOf(v) : src ?? t('场所')
    return { result: `${toolLine(name, where, v !== undefined ? `最近 ${limit ?? 12} 条` : src !== undefined ? '读了一块' : '列出场所')}\n${r.res.text ?? ''}` }
  }
  if (name === 'im_forward') {
    const to = venueOf(args['to'])
    const from = str('from')
    if (to === undefined || from === undefined) return { result: `${name}: from is an address or owner/venue#message, to is owner/id` }
    const note = str('note')
    const r = await through({ op: 'im-forward', from, to: `${to.owner}/${to.id}`, ...(note !== undefined ? { note } : {}), as: agent, ...(session !== '' ? { session } : {}) })
    return { result: r.ok ? toolLine(name, await labelOf(to), `已排入待发：${from}`) : r.text }
  }
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
  const v = venueOf(args['venue'])
  if (v === undefined) return { result: `${name}: venue is owner/id (im_read lists them)` }
  const kind = name === 'im_ask' ? 'ask' : name === 'im_report' ? 'report' : 'chat'
  const text = name === 'im_ask' ? str('question') ?? '' : str('text') ?? ''
  const ask = name === 'im_ask' ? { question: str('question') ?? '', options: Array.isArray(args['options']) ? (args['options'] as unknown[]).filter((x): x is string => typeof x === 'string') : [], who: str('who') ?? '', ...(str('expires') !== undefined ? { expires: str('expires') as string } : {}) } : undefined
  const evidence = embeds('evidence'), parts = embeds('parts'), opinion = str('opinion'), turn = str('turn'), replyTo = str('replyTo')
  const r = await through({ op: 'im-say', owner: v.owner, venue: v.id, text, as: agent, kind, ...(ask !== undefined ? { ask } : {}), ...(evidence !== undefined ? { evidence } : {}), ...(parts !== undefined ? { parts } : {}), ...(opinion !== undefined ? { opinion } : {}), ...(turn !== undefined ? { turn } : {}), ...(replyTo !== undefined ? { replyTo } : {}), ...(session !== '' ? { session } : {}) })
  if (!r.ok) return { result: r.text }
  const what = name === 'im_ask' ? `问 ${ask?.who ?? ''}：${text}` : name === 'im_report' ? `汇报${(evidence ?? []).length > 0 ? `，带证据 ${(evidence ?? []).length} 条` : ''}` : '已排入待发'
  return { result: toolLine(name, await labelOf(v), what) }
}

// ---- the pane and the dialogs ---------------------------------------------------------

async function openBoard($: EngineInterface, tab?: GemsbangTab): Promise<{ isPlaced: boolean; reason?: string }> {
  if (tab !== undefined) await update($, tabAtom, () => tab)
  const opened = await $.ui.open({ id: GEMSBANG_BOARD_ID, title: PANE_TITLE })
  $.clock.after(0, () => { void loadIm($).then(() => loadImThread($)).catch(() => undefined) })
  return opened
}

async function openDialog($: EngineInterface, dialog: 'settings' | 'about' | null): Promise<void> {
  await update($, dialogAtom, () => dialog)
  await update($, phoneCodeAtom, () => null)
  if (dialog === null) { await $.ui.close({ id: GEMSBANG_DIALOG_ID }); return }
  const t = await words($)
  await $.ui.open({ id: GEMSBANG_DIALOG_ID, title: dialog === 'settings' ? t('设置') : t('关于'), focus: true, closeOnEscape: true, holdToasts: true })
}

/**
 * A reload: a pane the module before this one left up still answers to that
 * module, so its presses do nothing. The board is closed and opened again,
 * drawn anew from this module; a dialog is closed.
 */
async function adoptPanes($: EngineInterface): Promise<void> {
  try {
    const up = await $.ui.panes()
    if (up.some((p) => p.id === GEMSBANG_BOARD_ID)) { await $.ui.close({ id: GEMSBANG_BOARD_ID }); await $.ui.open({ id: GEMSBANG_BOARD_ID, title: PANE_TITLE }) }
    if (up.some((p) => p.id === GEMSBANG_DIALOG_ID)) { await update($, dialogAtom, () => null); await $.ui.close({ id: GEMSBANG_DIALOG_ID }) }
  } catch { /* no pane to adopt */ }
}

/** A press: a view change at once; anything else through the bridge, its refusal one toast. */
async function act($: EngineInterface, action: BoardAction): Promise<void> {
  switch (action.op) {
    case 'im-tab': await update($, tabAtom, () => action.tab); return
    case 'im-open': {
      await update($, imThreadAtom, () => ({ owner: action.owner, id: action.id }) as unknown as GemsbangJson)
      await update($, imReplyAtom, () => null)
      await loadImThread($)
      return
    }
    case 'im-close': await update($, imThreadAtom, () => null); await update($, imReplyAtom, () => null); return
    case 'im-reply': await update($, imReplyAtom, () => action.message); return
    case 'im-card-words': await update($, imCardWordsAtom, (was) => ({ ...(((was as unknown) as Record<string, string> | null) ?? {}), [action.card]: action.text }) as unknown as GemsbangJson); return
    default: break
  }
  const t = await words($)
  const through = async (op: BridgeOp, timeout = BRIDGE_TIMEOUT_MS): Promise<BridgeResponse | undefined> => {
    const res = await bridge($, op, timeout)
    if (res !== undefined && !res.ok) $.ui.toast(`gemsbang：${cliReason(res.error)}`)
    return res
  }
  const forget = (key: string) => update($, imCardWordsAtom, (was) => { const m = { ...((((was as unknown) as Record<string, string> | null) ?? {})) }; delete m[key]; return m as unknown as GemsbangJson })
  switch (action.op) {
    case 'im-refresh': await loadIm($); await loadImThread($); return
    case 'im-say': {
      const open = (await read($, imThreadAtom)) as unknown as { owner: string; id: string } | null
      if (open === null) { $.ui.toast(t('先打开一个场所')); return }
      const replyTo = action.replyTo ?? (await read($, imReplyAtom)) ?? undefined
      await through({ op: 'im-say', owner: open.owner, venue: open.id, text: action.text, as: 'person', ...(replyTo !== undefined ? { replyTo } : {}) })
      await update($, imReplyAtom, () => null)
      await loadImThread($)
      return
    }
    case 'im-draft': await through({ op: 'im-draft', id: action.id, send: action.send, ...(action.text !== undefined ? { text: action.text } : {}) }); await loadIm($); return
    case 'im-need': {
      // 重试 under 断了 is 重连: one round of sync from here.
      if (action.key.startsWith('offline:')) { await act($, { op: 'im-sync' }); return }
      // 自己写: the thread opens with its box answering the ask.
      if (action.action === '自己写') {
        const m = /^https:\/\/[^/]+\/([^/]+)\/venues\/([^/]+)\.geml#(.+)$/.exec(action.key)
        if (m !== null) {
          await update($, imThreadAtom, () => ({ owner: m[1], id: m[2] }) as unknown as GemsbangJson)
          await update($, imReplyAtom, () => m[3] as string)
          await openBoard($, 'messages')
          await loadImThread($)
        }
        return
      }
      await through({ op: 'im-need', key: action.key, action: action.action })
      await loadIm($)
      return
    }
    case 'im-brief': {
      const res = await through({ op: 'im-brief', text: action.text })
      if (res?.ok === true) $.ui.toast(t('已交给 agent 起草'))
      await loadIm($)
      return
    }
    // A card's button: the words typed under the card go with the verb that takes them; 发布 asks which venue; a worker's verbs sign as the session's agent.
    case 'im-card': {
      const key = `${action.owner}/${action.id}`
      const typed = (((await read($, imCardWordsAtom)) as unknown) as Record<string, string> | null)?.[key]
      let body: Record<string, unknown> = {}
      let as = 'person'
      if (action.action === 'brief') {
        if (typed === undefined) { $.ui.toast(t('先写一行：怎么改')); return }
        const res = await through({ op: 'im-brief', text: typed, card: action.id })
        if (res?.ok === true) { $.ui.toast(t('已交给 agent 改')); await forget(key) }
        await loadIm($)
        return
      }
      if (action.action === 'publish') {
        const venues = ((await readIm($))?.venues ?? []).filter((v) => v.kind === 'group' || v.kind === 'thread')
        if (venues.length === 0) { $.ui.toast(t('没有能发到的场所')); return }
        const labels = venues.map((v) => `${v.kindWord}「${v.name}」`)
        let picked: string
        try { picked = await $.ui.ask(t('发到哪个场所？'), labels) } catch { return }
        const v = venues[labels.indexOf(picked)]
        if (v === undefined) return
        body = { venue: `${v.owner}/${v.id}` }
      } else if (action.action === 'changes') body = { comments: typed === undefined ? [] : [{ anchor: '', text: typed }] }
      else if (action.action === 'dispute' || action.action === 'close') body = typed === undefined ? {} : { reason: typed }
      else if (action.action === 'note') { if (typed === undefined) { $.ui.toast(t('先写一行记录')); return } body = { text: typed } }
      else if (action.action === 'giveback') body = typed === undefined ? {} : { note: typed }
      else if (action.action === 'deliver') { $.ui.toast(t('交付由 agent 用 im_card deliver 完成')); return }
      if (['claim', 'note', 'giveback', 'resume'].includes(action.action)) {
        const agent = await imAgentOf($)
        if (agent === undefined) { $.ui.toast(t('本会话没有 agent：在设置里选一个')); return }
        as = agent
      }
      const res = await through({ op: 'im-card', action: action.action as CardAction, owner: action.owner, id: action.id, body, as })
      if (res?.ok === true) { $.ui.toast(`#${action.id} ${res.card?.line ?? ''}`); await forget(key) }
      await loadIm($)
      return
    }
    case 'im-sync': {
      const res = await through({ op: 'im-sync' }, SLOW_TIMEOUT_MS)
      if (res?.ok === true && res.text !== undefined) $.ui.toast(res.text)
      if (res?.ok !== true) await loadIm($)
      await loadImThread($)
      return
    }
    case 'im-phone-code': {
      const res = await through({ op: 'im-phone-code' })
      const code = res?.ok === true ? res.phoneCode : undefined
      if (code !== undefined) await update($, phoneCodeAtom, () => code)
      return
    }
    case 'dialog': await openDialog($, action.dialog === 'settings' || action.dialog === 'about' ? action.dialog : null); return
    case 'open-board': {
      const opened = await openBoard($, action.tab === 'messages' ? 'messages' : undefined)
      if (!opened.isPlaced) $.ui.toast(t('看板没有打开：{0}', opened.reason ?? ''))
      return
    }
    case 'setting': {
      const next = withSetting(await readSettings($), action.key, action.value)
      await update($, settingsAtom, () => next as unknown as GemsbangJson)
      try { await $.store.set(STORE_SETTINGS, next) } catch { /* read-only store */ }
      // Another agent: what waits in its queue is its own, and the senders see it here.
      if (action.key === 'im.agent') { await update($, imPresenceAtom, () => null); await imPresence($, turnBusy ? 'thinking' : 'idle'); await imDeliverNext($) }
      return
    }
    default: return
  }
}

function press($: EngineInterface, action: BoardAction): () => void {
  return () => { void act($, action).catch((err: unknown) => $.ui.toast(`gemsbang：${reasonOf(err)}`)) }
}

// ---- the drawings ---------------------------------------------------------------------

/** The elements, loosely typed: the pane is drawn on every surface, and only some have Input, Link or Svg. */
type Els = { Box: any; Text: any; Button: any; Link?: any; Input?: any; Svg?: any }

/** The surface's elements, with no Svg on the terminal: a character reads better there than an empty box. */
function elementsOf($: EngineInterface, e: Parameters<EngineInterface['ui']['resolve']>[0]): Els {
  const els = $.ui.resolve(e) as unknown as Els
  return (e as { surface?: string }).surface === 'terminal' ? { ...els, Svg: undefined } : els
}

function drawLink(els: Els, key: string, href: string, label: string): unknown {
  const { Link, Text } = els
  return Link !== undefined ? <Link key={key} href={href} label={label} /> : <Text key={key} dimColor>{label}: {href}</Text>
}

/** A card's icon: a line drawing where the surface draws pictures, its character in the icon's colour elsewhere. */
function drawIcon(els: Els, k: Icon): unknown {
  const { Svg, Text } = els
  return Svg !== undefined ? <Svg source={ICON_SVG[k]} alt={k} width={14} height={14} /> : <Text {...toneProps(ICON_TONE[k])}>{ICON_CHAR[k]}</Text>
}

/** The blank label of a button laid over a picture: ideographic spaces, which a desktop's HTML does not collapse. */
const HIT = '　　'

function drawGlyph(els: Els, g: Glyph, tone: Tone | 'active' = 'dim', size = 15): unknown {
  const { Svg } = els
  return Svg !== undefined ? <Svg source={glyphSvg(g, tone)} alt={g} width={size} height={size} /> : null
}

/** An icon that is a press by itself: a blank Button laid over the glyph, its name under the pointer; the label as a button where no pictures are drawn. */
function iconButton($: EngineInterface, els: Els, b: Pressable, g: Glyph, o: { from?: 'left' | 'right'; size?: number } = {}): unknown {
  const { Box, Button, Text, Svg } = els
  if (Svg === undefined) return <Button key={b.key} plain dimColor label={b.label} onPress={press($, b.action)} />
  const edge = o.from === 'left' ? { left: 0 } : { right: 0 }
  return (
    <Box key={`${b.key}-icon`} flexShrink={0} alignItems="center" paddingX={1}>
      {drawGlyph(els, g, 'dim', o.size ?? 18)}
      <Box position="absolute" top={1} {...edge} width={cellWidth(b.label) + 2} paddingX={1} display="none" hover={{ display: 'flex' }} backgroundColor="inverseText">
        <Text wrap="truncate-end">{b.label}</Text>
      </Box>
      <Box position="absolute" top={0} left={0} right={0} bottom={0} justifyContent="center" alignItems="center">
        <Button key={b.key} plain label={HIT} onPress={press($, b.action)} />
      </Box>
    </Box>
  )
}

const RULE = '#8a898666'
const HEADING = '#8a8986'
const SHADE = '#8a89861a'
const RULE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="1" viewBox="0 0 4000 1" preserveAspectRatio="none"><rect width="4000" height="1" fill="#8a8986" fill-opacity="0.22"/></svg>'
function hairline(els: Els, key: string): unknown {
  const { Box, Svg } = els
  return Svg !== undefined ? <Box key={key} paddingY="xs"><Svg source={RULE_SVG} alt="—" height={1} /></Box> : null
}

/** One row as drawRow draws it; a row that cannot be drawn says so in its place. */
function safeRow($: EngineInterface, els: Els, row: BoardRow, i: number): unknown {
  try {
    return drawRow($, els, row, i)
  } catch (err) {
    return <els.Text key={`row-failed-${i}`} color="error">{`gemsbang：${reasonOf(err)}`}</els.Text>
  }
}

/** The rows; where the surface draws pictures, a run of entries (the venues) in one rounded box, a rule between them. */
function drawRows($: EngineInterface, els: Els, rows: BoardRow[]): unknown[] {
  if (els.Svg === undefined) return rows.map((r, i) => safeRow($, els, r, i))
  const { Box } = els
  const out: unknown[] = []
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] as BoardRow
    if (r.kind !== 'entry') { out.push(safeRow($, els, r, i)); continue }
    const run: Extract<BoardRow, { kind: 'entry' }>[] = []
    while (i < rows.length && (rows[i] as BoardRow).kind === 'entry') run.push(rows[i++] as Extract<BoardRow, { kind: 'entry' }>)
    i--
    out.push(
      <Box key={`list-${r.key}`} flexDirection="column" borderStyle="round" borderColor={RULE} paddingX={1}>
        {run.flatMap((x, n) => n === 0 ? [safeRow($, els, x, n)] : [hairline(els, `sep-${x.key}`), safeRow($, els, x, n)])}
      </Box>,
    )
  }
  return out
}

function drawRow($: EngineInterface, els: Els, row: BoardRow, i: number): unknown {
  const { Box, Text, Button, Input } = els
  switch (row.kind) {
    case 'section': return (
      <Box key={row.key} gap={1} marginTop={i > 0 ? 1 : 0}>
        {els.Svg !== undefined ? <Text color={HEADING} bold>{row.text}</Text> : <Text dimColor bold>{row.text}</Text>}
        {row.count !== undefined && <Text dimColor>{String(row.count)}</Text>}
        {row.note !== undefined && <Text dimColor>{row.note}</Text>}
        {row.actions !== undefined && <Box flexGrow={1} />}
        {(row.actions ?? []).map((b) => <Button key={b.key} plain label={b.label} onPress={press($, b.action)} />)}
      </Box>
    )
    case 'card': return (
      <Box key={row.key} flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
        <Box gap={1}>
          {drawIcon(els, row.icon)}
          {row.verb !== '' && <Text dimColor>{row.verb}</Text>}
          <Box flexShrink={1} minWidth={0}><Text bold wrap="wrap">{row.title}</Text></Box>
          {row.tag !== undefined && row.tag !== '' && <Text dimColor>{row.tag}</Text>}
        </Box>
        {row.detail.map((d, n) => <Text key={`d${n}`} dimColor wrap="truncate-end">{d}</Text>)}
        {row.actions.length > 0 && (
          <Box gap={1}>
            {row.actions.map((b) => <Button key={b.key} label={b.label} {...(b.primary ? { variant: 'primary' } : {})} onPress={press($, b.action)} />)}
          </Box>
        )}
      </Box>
    )
    case 'entry': return (
      <Box key={row.key} flexDirection="column" paddingX={1} {...(row.action !== undefined ? { hover: { backgroundColor: SHADE } } : {})}>
        <Box gap={2}>
          {row.action !== undefined
            ? <Button key={`go-${row.key}`} plain onPress={press($, row.action)}><Text {...toneProps(row.tone)}>{row.title}</Text></Button>
            : <Text {...toneProps(row.tone)} wrap="truncate-end">{row.title}</Text>}
          <Box flexGrow={1} />
          {row.tag !== '' && <Text dimColor>{row.tag}</Text>}
        </Box>
        {row.detail !== undefined && row.detail !== '' && (row.action !== undefined
          ? <Button key={`go-2-${row.key}`} plain dimColor label={row.detail} onPress={press($, row.action)} />
          : <Text dimColor wrap="truncate-end">{row.detail}</Text>)}
      </Box>
    )
    case 'text': return <Text key={`r${i}`} {...toneProps(row.tone)}>{row.text}</Text>
    case 'button': return <Button key={row.key} plain label={row.label} {...(row.primary ? { variant: 'primary' } : {})} onPress={press($, row.action)} />
    case 'buttons': return (
      <Box key={`b${i}`} gap={2} flexWrap="wrap">
        {row.items.map((b) => <Button key={b.key} label={b.label} {...(b.primary ? { variant: 'primary' } : {})} onPress={press($, b.action)} />)}
      </Box>
    )
    case 'link': return drawLink(els, row.key, row.href, row.label)
    case 'input': {
      const run = (value: string): void => { const a = inputAction(row.field, value, row.target); if (a !== undefined) void act($, a).catch((err: unknown) => $.ui.toast(`gemsbang：${reasonOf(err)}`)) }
      if (Input === undefined) return <Text key={row.key} dimColor>{row.placeholder}</Text>
      return <Input key={row.key} placeholder={row.placeholder} {...(row.value !== undefined ? { value: row.value } : {})} onSubmit={run} />
    }
    case 'heading': return (
      <Box key={row.key} gap={1}>
        <Text bold>{row.text}</Text>
        {row.sub !== '' && <Text dimColor>{row.sub}</Text>}
        {row.action !== undefined && <Box flexGrow={1} />}
        {row.action !== undefined && <Button key={row.action.key} plain label={row.action.label} onPress={press($, row.action.action)} />}
      </Box>
    )
    // A message: each line a button labelled with its words (a reply to it), its tag under it at the right.
    case 'note': return (
      <Box key={row.key} flexDirection="column" paddingX={1} {...(els.Svg !== undefined ? { hover: { backgroundColor: SHADE } } : {})}>
        {row.lines.map((l, n) => <Button key={`go-${row.key}-${n}`} plain label={l} onPress={press($, row.action)} />)}
        <Box><Box flexGrow={1} /><Text dimColor>{row.tag}</Text></Box>
      </Box>
    )
    case 'image': return els.Svg !== undefined
      ? <els.Svg key={row.key} source={row.svg} alt={row.alt} {...(row.width !== undefined ? { width: row.width } : {})} />
      : <Text key={row.key} bold>{row.alt}</Text>
    case 'prose': return (
      <Box key={row.key} paddingX={1} marginLeft={2} {...(els.Svg !== undefined ? { backgroundColor: SHADE } : {})}>
        <Text wrap="wrap">{row.text}</Text>
      </Box>
    )
    default: return null
  }
}

/** The pane's header: the mark, the name, the version, the two dialogs. */
function drawHeader($: EngineInterface, els: Els, version: string, t: T): unknown {
  const { Box, Text, Svg } = els
  const dialogs: Pressable[] = [
    { key: 'dialog-settings', label: t('设置'), action: { op: 'dialog', dialog: 'settings' } },
    { key: 'dialog-about', label: t('关于'), action: { op: 'dialog', dialog: 'about' } },
  ]
  return (
    <Box key="header" gap={1} alignItems="center">
      {Svg !== undefined ? <Svg source={GEMSBANG_MARK_SVG} alt="Gemsbang" width={18} height={18} /> : <Text color={GEMSBANG_BLUE} bold>{GEMSBANG_MARK_CHAR}</Text>}
      <Text bold>Gemsbang</Text>
      {version !== '' && (Svg !== undefined
        ? <Box key="version" borderStyle="round" borderColor={RULE} paddingX={1}><Text dimColor>{version}</Text></Box>
        : <Text dimColor>{version}</Text>)}
      <Box flexGrow={1} />
      <Box key="dialogs" gap={Svg !== undefined ? 2 : 1} alignItems="center">
        {dialogs.map((d) => iconButton($, els, d, d.key.replace(/^dialog-/, '') as Glyph))}
      </Box>
    </Box>
  )
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    await update($, rootAtom, () => e.cwd)
    await update($, setupAtom, () => null)
    for (const x of IM_TOOLS) {
      await registerOne($, x.name, () => $.tool.register({ name: x.name, description: x.description, inputSchema: x.inputSchema, isDeferred: false }))
    }
    await registerOne($, '/gemsbang', () => $.command.register({ name: 'gemsbang', description: 'Gemsbang：消息、任务卡、钱包；/gemsbang settings 打开设置', argumentHint: '[messages|tasks|wallet|settings]' }))
    try {
      const stored = await $.store.get(STORE_SETTINGS)
      await update($, settingsAtom, () => settingsFrom(stored) as unknown as GemsbangJson)
    } catch { await update($, settingsAtom, () => DEFAULT_SETTINGS as unknown as GemsbangJson) }
    try { const lang = await $.env.get('LANG'); if (lang !== undefined) await update($, localeAtom, () => lang) } catch { /* no env */ }
    try {
      const manifest = JSON.parse(String(await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`))) as { version?: unknown }
      if (typeof manifest.version === 'string') { const v = manifest.version; await update($, versionAtom, () => v) }
    } catch { /* no manifest */ }
    await adoptPanes($)
    await startBridge($)
    $.clock.every(POLL_MS, () => { void loadIm($).then(() => loadImThread($)).then(() => imDeliverNext($)).catch(() => undefined) })
    $.clock.after(0, () => { void imPresence($, 'idle').then(() => imDeliverNext($)).catch(() => undefined) })
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    try { await imPresence($, 'asleep') } catch { /* the daemon's heartbeat retires it */ }
    return next(e)
  }).catch(($, e, next) => next(e))

  // Every tool call. A turn a queue item started is held to the sender's scope; anything else goes through untouched.
  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    if (imToolOf(tool) !== undefined) return next(e)
    const turn = await readImTurn($)
    let ev = e
    if (turn !== null) {
      const rule = callRule(turn, tool, toolArgs(e as unknown as Record<string, unknown>))
      if (rule !== undefined && 'deny' in rule) {
        await update($, imTurnAtom, () => ({ ...turn, refused: turn.refused + 1 }) as unknown as GemsbangJson)
        return { deny: rule.deny }
      }
      // A sandbox run starts in the card's room: the command goes there first.
      if (rule !== undefined && 'cwd' in rule && e.tool === 'Bash') ev = { ...e, command: `cd ${JSON.stringify(rule.cwd)} && ${e.command}` }
    }
    if (e.agentId === undefined) $.clock.after(0, () => { void imPresence($, 'tool').catch(() => undefined) })
    $.clock.after(0, () => { void retryStart($).catch(() => undefined) })
    return next(ev)
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'mcp__gemsbang__im_say' }, ($, e) => serveIm($, 'im_say', e)).catch(() => ({ result: 'gemsbang could not do that' }))
  on('tool.call', { tool: 'mcp__gemsbang__im_ask' }, ($, e) => serveIm($, 'im_ask', e)).catch(() => ({ result: 'gemsbang could not do that' }))
  on('tool.call', { tool: 'mcp__gemsbang__im_report' }, ($, e) => serveIm($, 'im_report', e)).catch(() => ({ result: 'gemsbang could not do that' }))
  on('tool.call', { tool: 'mcp__gemsbang__im_read' }, ($, e) => serveIm($, 'im_read', e)).catch(() => ({ result: 'gemsbang could not do that' }))
  on('tool.call', { tool: 'mcp__gemsbang__im_forward' }, ($, e) => serveIm($, 'im_forward', e)).catch(() => ({ result: 'gemsbang could not do that' }))
  on('tool.call', { tool: 'mcp__gemsbang__im_card' }, ($, e) => serveIm($, 'im_card', e)).catch(() => ({ result: 'gemsbang could not do that' }))
  on('tool.call', { tool: 'mcp__gemsbang__im_signal' }, ($, e) => serveIm($, 'im_signal', e)).catch(() => ({ result: 'gemsbang could not do that' }))

  on('prompt.submit', async ($, e, next) => {
    turnBusy = true
    $.clock.after(0, () => { void imPresence($, 'thinking').catch(() => undefined) })
    $.clock.after(0, () => { void retryStart($).catch(() => undefined) })
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) {
      turnBusy = false
      const answer = e.answer, aborted = e.isAborted
      $.clock.after(0, () => { void imAnswerTurn($, answer, aborted).then(() => imPresence($, asksOf(answer).length > 0 ? 'waiting' : 'idle')).then(() => loadIm($)).then(() => imDeliverNext($)).catch(() => undefined) })
    }
    return done
  }).catch(($, e, next) => next(e))

  // The band (§6.9): gemsbang's one line, under whatever a plugin below it drew (gemworks's line, when it runs there).
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const els = elementsOf($, e)
    const { Box, Text, Button, Svg } = els
    let t: T = wordsFor('zh')
    let band: GemsbangBand | undefined
    try {
      t = await words($)
      const [im, problem, setup] = await Promise.all([readIm($), read($, problemAtom), read($, setupAtom)])
      band = gemsbangBand(im, await imAgentOf($), problem ?? setup, t)
    } catch (err) {
      band = { verb: '', title: `gemsbang：状态带画不出来（${reasonOf(err)}）`, tone: 'error', note: '', actions: [], more: 0 }
    }
    if (band === undefined) return next(e)
    // What a plugin below drew (gemworks's line), or nothing: a chain with none beneath that draws ends in no tree.
    const below = await next(e).catch(() => null)
    const columns: number = e.props.bodyColumns
    const tail: Pressable[] = [
      ...(band.more > 0 ? [{ key: 'band-more', label: t('还有 {0} 件', band.more), action: { op: 'open-board', tab: 'messages' } as BoardAction }] : []),
      { key: 'band-board', label: t('看板'), action: { op: 'open-board' } as BoardAction },
    ]
    const reserve = [...band.actions, ...tail].reduce((w, b) => w + (b.key === 'band-board' && Svg !== undefined ? 4 : cellWidth(b.label) + 5), 0)
    const lead = 2 + (band.verb !== '' ? cellWidth(band.verb) + 1 : 0)
    const title = truncate(band.title, Math.max(6, columns - reserve - lead))
    const pressable = (b: Pressable) => Svg !== undefined && b.key === 'band-board'
      ? iconButton($, els, b, 'board', { from: 'right', size: 15 })
      : <Button key={b.key} {...(Svg === undefined ? { plain: true } : {})} label={b.label} {...(b.primary ? { variant: 'primary' } : {})} onPress={press($, b.action)} />
    const line = (
      <Box key="gemsbang-band" gap={1} alignItems="center" flexGrow={1}>
        {Svg !== undefined
          ? (
            <Box key="band-mark" flexShrink={0} alignItems="center" paddingX={1}>
              <Svg source={GEMSBANG_MARK_SVG} alt="Gemsbang" width={13} height={13} />
              <Box position="absolute" top={0} left={0} right={0} bottom={0} justifyContent="center" alignItems="center">
                <Button key="band-mark-open" plain label={HIT} onPress={press($, { op: 'open-board' })} />
              </Box>
            </Box>
          )
          : <Button key="band-mark-open" plain label={t('看板')} onPress={press($, { op: 'open-board' })}><Text color={GEMSBANG_BLUE} bold>{GEMSBANG_MARK_CHAR}</Text></Button>}
        {band.verb !== '' && <Text dimColor>{band.verb}</Text>}
        <Box key="band-title" flexShrink={1} minWidth={0}>
          <Text wrap="truncate-end"><Text {...toneProps(band.tone)}>{title}</Text>{band.note !== '' && <Text dimColor>{`${SEP}${band.note}`}</Text>}</Text>
        </Box>
        {band.actions.length > 0 && <Box key="band-options" gap={1} flexShrink={0} alignItems="center">{band.actions.map(pressable)}</Box>}
        <Box key="band-push" flexGrow={1} />
        {tail.map(pressable)}
      </Box>
    )
    return below === null ? line : <Box flexDirection="column" flexGrow={1}>{below}{line}</Box>
  })

  // The pane: the header, the agent's line, the three tabs, and the tab's rows.
  // The matcher spells GEMSBANG_BOARD_ID's value: the engine reads matchers statically.
  on('ui.render', { component: 'Pane', requestId: 'gemsbang-board' }, async ($, e) => {
    const els = elementsOf($, e)
    const { Box, Text, Button } = els
    const columns: number = e.props.bodyColumns
    const [t, kept] = await Promise.all([words($).catch(() => wordsFor('zh')), read($, tabAtom).catch(() => null)])
    const tab: GemsbangTab = (GEMSBANG_TABS as readonly string[]).includes(kept as string) ? kept as GemsbangTab : 'messages'
    const [im, open, replyTo, agent, version] = await Promise.all([
      readIm($).catch(() => null), read($, imThreadAtom).catch(() => null), read($, imReplyAtom).catch(() => null), imAgentOf($).catch(() => undefined), read($, versionAtom).catch(() => null),
    ])
    let rows: BoardRow[]
    try {
      rows = gemsbangRows({ tab, status: im, thread: ((open as unknown) as { thread?: Thread } | null)?.thread ?? null, replyTo, columns, t })
    } catch (err) {
      rows = [{ kind: 'text', text: truncate(`gemsbang：${reasonOf(err)}`, columns), tone: 'error' }]
    }
    let body = drawRows($, els, rows)
    // The desktop draws and presses a pane of some 1,100 elements and none past it: the body stops short, and says what it left out.
    if (els.Svg !== undefined) {
      const fit = fitToBudget(body)
      if (fit.left > 0) body = [...fit.kept, <Text key="rows-cut" dimColor>{t('内容太多，后面 {0} 项没画出来：收起一些，或换个页签。', fit.left)}</Text>]
    }
    const who = agentLine(im, agent, t)
    return (
      <Box flexDirection="column">
        {drawHeader($, els, version ?? '', t)}
        {who !== undefined && (
          <Box key="agent" gap={1}>
            <Text bold>{who.name}</Text>
            <Box flexShrink={1} minWidth={0}><Text dimColor wrap="truncate-end">{who.line}</Text></Box>
            <Box flexGrow={1} />
            <Text {...toneProps(who.tone)}>{who.link}</Text>
          </Box>
        )}
        {hairline(els, 'rule-head')}
        <Box key="tabs" gap={els.Svg !== undefined ? 3 : 2} flexWrap="wrap" alignItems="center">
          {gemsbangTabs(im, t).map((x) => x.id === tab
            ? <Button key={`tab-${x.id}`} plain onPress={press($, { op: 'im-tab', tab: x.id })}><Text bold underline>{x.label}</Text></Button>
            : <Button key={`tab-${x.id}`} plain dimColor label={x.label} onPress={press($, { op: 'im-tab', tab: x.id })} />)}
        </Box>
        {hairline(els, 'rule-tabs')}
        {body}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: 'gemsbang-dialog' }, async ($, e) => {
    const els = elementsOf($, e)
    const { Box, Button } = els
    const t = await words($)
    const dialog = await read($, dialogAtom)
    let rows: BoardRow[]
    try {
      if (dialog === 'settings') {
        const [im, settings, locale, phoneCode] = await Promise.all([readIm($), readSettings($), read($, localeAtom), read($, phoneCodeAtom)])
        rows = gemsbangSettingsRows({ status: im, settings, locale: locale ?? undefined, phoneCode, columns: e.props.bodyColumns, t })
      } else if (dialog === 'about') rows = gemsbangAboutRows((await read($, versionAtom)) ?? '', t)
      else rows = []
    } catch (err) {
      rows = [{ kind: 'text', text: `gemsbang：${reasonOf(err)}`, tone: 'error' }]
    }
    return (
      <Box flexDirection="column">
        {rows.map((r, i) => safeRow($, els, r, i))}
        {dialog !== 'settings' && <Box><Button key="close" role="dismiss" plain dimColor label={t('关闭')} onPress={press($, { op: 'dialog', dialog: null })} /></Box>}
      </Box>
    )
  })

  // /gemsbang: the board on 消息 (or the tab named), or the settings.
  on('command.run', { command: 'gemsbang' }, async ($, e) => {
    await retryStart($)
    const t = await words($)
    const arg = String(e.args ?? '').trim()
    if (arg === 'settings' || arg === '设置') { await openDialog($, 'settings'); return { text: t('已打开 gemsbang 设置。') } }
    const tab: GemsbangTab = arg === 'tasks' || arg === '任务' ? 'tasks' : arg === 'wallet' || arg === '钱包' ? 'wallet' : 'messages'
    await loadIm($)
    const opened = await openBoard($, tab)
    return { text: opened.isPlaced ? t('已打开 Gemsbang 看板。') : t('看板没有打开：{0}', opened.reason ?? '') }
  }).catch(() => ({ text: 'gemsbang：命令没有完成，原因见输入框上方的状态带' }))
}
```

- [ ] **Step 5: Write `types/index.d.ts`**

```ts
// The values gemsbang's hooks module keeps in $.state (plan O). What the bridge
// answers is kept as JSON; the module reads it as the daemon view's and the
// IM shell's types (src/daemon/view.ts, src/hosts/claude-code/im.ts).
export type GemsbangJson = null | boolean | number | string | readonly GemsbangJson[] | { readonly [key: string]: GemsbangJson }
export type GemsbangTab = 'messages' | 'tasks' | 'wallet'

declare module 'claude-code' {
  interface PluginState {
    gemsbang: {
      /** Why the plugin cannot do its part (no Node, a bridge that does not answer or answers what does not parse); null while it can. */
      problem: string | null
      node: string | null
      /** The session's directory: the bridge runs there, and a bare request opens nothing in it. */
      root: string | null
      startedAt: number | null
      /** A tool or the command the engine would not register. */
      setup: string | null
      /** The plugin's version, from its manifest. */
      version: string | null
      /** The CLI's locale, else the host's LANG. */
      locale: string | null
      settings: GemsbangJson
      tab: GemsbangTab
      /** The dialog open: settings or about. */
      dialog: string | null
      /** The last code made for the phone, shown in the settings until they close. */
      phoneCode: string | null
      /** The daemon's home as the bridge last read it (ImStatus). */
      im: GemsbangJson
      /** The venue open on 消息 ({ owner, id, thread }), and the message its box answers. */
      imThread: GemsbangJson
      imReply: string | null
      /** The turn a queue item started (ImTurn). */
      imTurn: GemsbangJson
      /** Per venue, the last message id the page showed. */
      imSeen: GemsbangJson
      /** The presence last reported. */
      imPresence: string | null
      /** The line typed under a card for its next button, per card. */
      imCardWords: GemsbangJson
    }
  }
}
```

- [ ] **Step 6: Write `.claude-plugin/plugin.json`**

```json
{
  "name": "gemsbang",
  "version": "0.4.0",
  "description": "The IM for people and their agents, in Claude Code: what needs you on one line above the prompt, messages, task cards and the wallet on a board, and this session's agent taking what waits in its queue within the sender's permissions. Sits beside gemworks or stands alone.",
  "author": {
    "name": "geml-spec",
    "url": "https://github.com/geml-spec"
  },
  "homepage": "https://github.com/geml-spec/gemsbang",
  "repository": "https://github.com/geml-spec/gemsbang",
  "license": "AGPL-3.0-only",
  "keywords": [
    "im",
    "agents",
    "relay",
    "geml",
    "hooks"
  ],
  "types": "./types/index.d.ts"
}
```

- [ ] **Step 7: Write `.claude-plugin/marketplace.json`**

```json
{
  "name": "gemsbang",
  "owner": {
    "name": "geml-spec",
    "url": "https://github.com/geml-spec"
  },
  "description": "Gemsbang for Claude Code: the IM for people and their agents, beside gemworks or on its own.",
  "plugins": [
    {
      "name": "gemsbang",
      "source": "./",
      "description": "Gemsbang: what needs you above the prompt, messages, task cards and the wallet on a board, and this session's agent working its queue. Build first: npm ci && npm run build.",
      "strict": true
    }
  ]
}
```

The marketplace names the checkout itself (`"source": "./"`): `dist/` is built, not committed, so the plugin installs from a built checkout until a package carries it.

- [ ] **Step 8: Build and run**

```bash
npm run build && node --test test/plugin-files.test.mjs test/hooks-types.test.mjs test/hooks-purity.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
claude plugin validate . 2>&1 | tail -1
claude plugin test . 2>&1 | grep -E "^ [0-9]+ (pass|fail)"
```
Expected: `ℹ pass 7`, `ℹ fail 0`; `✔ Validation passed`; ` 13 pass`, ` 0 fail` — the IM-only suite draws on the terminal and the band once on the desktop, none of it on the pane's desktop rule that the PATH's older `claude` refuses.

- [ ] **Step 9: Commit**

```bash
git add hooks/register.tsx types/index.d.ts tests/hooks.test.ts .claude-plugin/plugin.json .claude-plugin/marketplace.json test/plugin-files.test.mjs
git commit -m "gemsbang: the Claude Code plugin is the IM alone"
```

---

### Task 6: The skills stay gemworks's; the README says how to install gemsbang

**Files:**
- Remove: `skills/`
- Modify: `package.json`, `test/smoke.test.mjs`, `test/mcp.test.mjs`, `test/split-session.test.mjs`, `README.md`, `README.zh.md`

- [ ] **Step 1: The tests read host-skills/ and want no skills/**

**O-27** · `test/smoke.test.mjs` — the package's files:

```js
"examples", "hooks", "host-skills", "spec", "types", "workflows"]);
```
**O-28** · `test/smoke.test.mjs` — the split-session test reads host-skills/ (its first two lines become):

```js
test("the split-session skill ships to the hosts that read host-skills/: their board's 从这里拆分 and 删除 hand the model its script", () => {
  const skill = readFileSync(new URL("../host-skills/split-session/SKILL.md", here), "utf8");
```
**O-29** · `test/smoke.test.mjs` — and its script:

```js
const script = readFileSync(new URL("../host-skills/split-session/split-session.mjs", here), "utf8");
```
**O-30** · `test/smoke.test.mjs` — the skills test: its head, down to the loop that compared the two copies, becomes:

```js
test("the skills: the Claude Code plugin (gemsbang, the IM alone) loads none and needs no other plugin; the hosts that read one folder read host-skills/, gemworks's two and the geml plugin's two", () => {
  const claude = JSON.parse(readFileSync(new URL("../.claude-plugin/plugin.json", here), "utf8"));
  assert.equal(claude.dependencies, undefined);
  assert.ok(!existsSync(new URL("../skills", here)), "nothing where Claude Code loads a plugin's skills: gemworks's own stay gemworks's");
  for (const f of ["geml/SKILL.md", "geml-code-graph/SKILL.md", "gemworks-mcp/SKILL.md", "split-session/SKILL.md", "split-session/split-session.mjs"]) assert.ok(existsSync(new URL(`../host-skills/${f}`, here)), f);
```
**O-31** · `test/mcp.test.mjs` — the MCP skill's test reads host-skills/:

```js
new URL("../host-skills/gemworks-mcp/SKILL.md", import.meta.url)
```
**O-32** · `test/split-session.test.mjs` — the script's path:

```js
new URL("../host-skills/split-session/split-session.mjs", import.meta.url)
```

- [ ] **Step 2: Run them to see them fail**

```bash
node --test test/smoke.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
```
Expected: `ℹ fail 2` — `package.json` still ships `skills`, and the folder is there.

- [ ] **Step 3: Out of the plugin**

```bash
git rm -r -q skills
```

**O-26** · `package.json` — `files` loses `skills`:

```json
"files": ["dist", "spec", "examples",
```
**O-33** · `README.md` — under `### Claude Code`, before the gemworks install line:

````md
This checkout's Claude Code plugin is **gemsbang**: the IM alone, installed beside gemworks's own plugin (from
[geml-spec/gemworks](https://github.com/geml-spec/gemworks)) or without it. gemworks keeps the workflow and its line
above the prompt; gemsbang adds its own line under it — what needs you, else where this session's agent is — a board
with 消息, 任务 and 钱包, the seven `im_*` tools, and the agent taking what waits in its queue within each sender's
permissions. It asks the bundled CLI with bare requests, which read and write only the daemon's home
(`~/.gemworks/im`), never the project's `.geml/`. `dist/` is built, not committed: build the checkout, then add it as a
marketplace.

```sh
npm ci && npm run build
claude plugin marketplace add /path/to/gemsbang
claude plugin install gemsbang@gemsbang
```

`/gemsbang` opens the board (`/gemsbang tasks`, `/gemsbang wallet` on those tabs) and `/gemsbang settings` the
settings: the agent this session speaks for, the relay with 重连, a code for the phone's bot, the language. The rest
of this section describes gemworks's plugin.

````
**O-34** · `README.zh.md` — the same in `README.zh.md`:

````md
这个检出的 Claude Code 插件是 **gemsbang**：只管 IM，可以和 gemworks 自己的插件（在
[geml-spec/gemworks](https://github.com/geml-spec/gemworks)）并排装，也可以单独装。gemworks 管流程和它在输入框上方的那一行；
gemsbang 在它下面加自己的一行——需要你的事，没有就是这个会话的 agent 在干什么——再加一个看板（消息、任务、钱包）、七个 `im_*`
工具，以及 agent 按发件人的权限处理它队列里的事。它用 bare 请求问打包的 CLI，只读写守护进程的家（`~/.gemworks/im`），
从不碰项目的 `.geml/`。`dist/` 是构建出来的、不进 git：先构建这个检出，再把它加成 marketplace。

```sh
npm ci && npm run build
claude plugin marketplace add /path/to/gemsbang
claude plugin install gemsbang@gemsbang
```

`/gemsbang` 打开看板（`/gemsbang tasks`、`/gemsbang wallet` 直接到那一页），`/gemsbang settings` 打开设置：这个会话代哪个
agent 说话、中继和重连、给手机 bot 的绑定码、语言。这一节下面讲的是 gemworks 的插件。

````

- [ ] **Step 4: Run them**

```bash
node --test test/smoke.test.mjs test/mcp.test.mjs test/split-session.test.mjs test/plugin-files.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
```
Expected: `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add package.json test/smoke.test.mjs test/mcp.test.mjs test/split-session.test.mjs README.md README.zh.md
git commit -m "gemworks's skills leave the gemsbang plugin; the README says how to install it"
```

---

### Task 7: The screens

**Files:**
- Add: `docs/design/ui/2026-10-30-agent-im-ui/project/{Coexist,BandPair,GemsbangPane,GemsbangSettings}.dc.html`
- Modify: `docs/design/ui/2026-10-30-agent-im-ui/project/canvas.json`, `docs/design/ui/2026-10-30-agent-im-ui/README.md`

The four artboards and the canvas index are in the working tree already (published to the canvas on 2026-11-01). The README gains their row and the decision:

**O-35** · `docs/design/ui/2026-10-30-agent-im-ui/README.md` — the table of artboards gains row ⑥, after `Band.dc.html`'s:

```md
| ⑥ 和 gemworks 并排 | `Coexist.dc.html` | 桌面全景：gemworks 管流程、gemsbang 管 IM，输入框上方两行状态带各说各的，右栏面板在 Gemsbang 和 Gemworks 之间切换 |
| | `BandPair.dc.html` | 两行状态带的六种时候：两边都没事、gemsbang 需要我、gemworks 要我定、两边都要我（「还有 N 件」各数各的）、中继断了只在 gemsbang 那行、只装 gemsbang |
| | `GemsbangPane.dc.html` | gemsbang 的面板：页头、agent 一行（代谁 · 在干什么 · 钱包 · 在线），消息 · 任务 · 钱包三页；消息页是需要我、回群前先给你看、场所 |
| | `GemsbangSettings.dc.html` | gemsbang 的设置：本会话代谁说话、中继和重连、手机绑定码、语言 |
```

**O-36** · `docs/design/ui/2026-10-30-agent-im-ui/README.md` — and the decisions, after the last one:

```md
- **gemsbang 只管 IM（2026-11-01，⑥）**：这个检出的 Claude Code 插件改名 gemsbang，和 gemworks 并排装；gemworks 管流程，gemsbang 管 IM。gemsbang 的状态带一行画在它下层插件那一行之下；按钮不带数字热键，数字留给 gemworks。它问 CLI 时一律用 bare 请求，只碰守护进程的家，项目的 `.geml/` 归 gemworks。设置页的 agent 一行只写在线状态：登录方式和接单声明在中继上，守护进程没有镜像；手机一节不说绑没绑，绑定的记录在手机桥那一头。
```

- [ ] **Step 1: Commit**

```bash
git add docs/design/ui/2026-10-30-agent-im-ui docs/design/plans/2026-11-01-im-o-gemsbang-plugin.md
git commit -m "Row 6 of the IM screens: gemsbang beside gemworks; plan O"
```

---

### Task 8: Gates, the version, the merge

- [ ] **Step 1: The four gates, each its own command**

```bash
npm run build
claude plugin validate .
claude plugin test .
node --test --test-concurrency=2 test/*.test.mjs
```
Expected: the build is clean; `✔ Validation passed`; the hooks suite ` 13 pass`, ` 0 fail`; the node suites `ℹ pass 1000`, `ℹ fail 0`.

- [ ] **Step 2: The version and the merge**

```bash
node scripts/bump.mjs 0.5.0
npm run build && node --test test/smoke.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
git commit -am "gemsbang 0.5.0: the IM's own Claude Code plugin, beside gemworks"
git switch main && git merge --ff-only im/o-gemsbang
```
Expected: `0.4.0 -> 0.5.0`; the smoke suite passes (every manifest names 0.5.0). Nothing is pushed: that waits for the maintainer's word.

---

### Task 9: Load gemsbang beside gemworks

The local marketplace `~/.claude/local-marketplaces/geml-dev` already serves gemworks from its checkout. gemsbang joins it as a third entry, synced from this checkout the same way.

- [ ] **Step 1: The entry and the copy**

Add to the `plugins` of `~/.claude/local-marketplaces/geml-dev/.claude-plugin/marketplace.json`:

```json
{
  "name": "gemsbang",
  "source": "./gemsbang",
  "description": "Gemsbang (the IM alone) from /Users/xiong/software/gemsbang: npm run build there, then node scripts/sync-dev.mjs ~/.claude/local-marketplaces/geml-dev/gemsbang, then /reload-plugins."
}
```

```bash
node scripts/sync-dev.mjs ~/.claude/local-marketplaces/geml-dev/gemsbang
claude plugin marketplace update geml-dev
claude plugin install gemsbang@geml-dev
claude plugin list
```
Expected: `gemsbang@geml-dev` 0.5.0 enabled, `gemworks@geml-dev` enabled beside it.

- [ ] **Step 2: Which is outer**

After `/reload-plugins` (or a new session), the band shows gemworks's line with gemsbang's under it when gemsbang is the outer hook. If only gemworks's line shows while gemsbang has something to say, gemworks is outer and draws without `next(e)`: the same composition belongs in gemworks's band (its own repository, its own version), which is a task of its own.
