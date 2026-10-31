# IM Plan M: The Hosted Agent's Body — the Orchestrator and 搬家

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The hosted agent's body (transport §6): no process while it idles; an item on its queue wakes the orchestrator on the relay, which runs one round through a runner — a command on the platform, a function in tests — in the agent's own persistent workspace, with the prompt the desktop's daemon would have built (the envelope with the sender's scope, the text, the context pack resolved by the agent's own permission), posts the answer as the agent under the message that raised it (or into the card's thread), marks the item read and answered, and sleeps again; the owner pays a round from their wallet through the agent's caps (先免费额度，再积分), and a broke owner's item is answered with a system line; 搬家: the owner takes the token and the workspace's files to their desktop with one command, the account and the queue stay, the rounds here stop.

**Architecture:** `src/relay/hosted.ts` holds the `Orchestrator` (wakes on the relay's own append events for `queues/*.geml` of hosted agents, one agent's rounds at a time, `sweep()` for a full pass, `idle()` for tests), the `Runner` type with `commandRunner` (the round in `HOSTED_*` variables, the prompt on stdin, the answer on stdout, a time limit), and `workspaceFiles`. The relay learns `moveHosted` (a `moved-*` block under `_relay/hosted.geml`, which `hostedAgents()` honours) and `hostedOf`; `appendSystem` becomes public for the orchestrator's lines. `startRelay` takes `hosted: { runner, credits }` and runs the orchestrator with the server. The CLI gets `relay --hosted-command <cmd> [--hosted-credits N]` and `connect adopt <agent>`.

**Tech Stack:** TypeScript (`src/relay`, `src/cli.ts`), `node:test` over `dist/`.

**Before this plan:** plans A–L are on `main` (0.3.5).

---

## File structure

| File | Responsibility |
|---|---|
| `src/relay/hosted.ts` (new) | `Orchestrator`, `Round`, `Runner`, `commandRunner`, `workspaceFiles`, `ROUND_CREDITS`. |
| `src/relay/relay.ts` | `appendSystem` public; `hostedAgents()` without the moved; `moveHosted`, `hostedOf`. |
| `src/relay/api.ts` | `GET /hosted`, `POST /hosted/<agent>/move`. |
| `src/relay/server.ts` | The orchestrator started and stopped with the server. |
| `src/cli.ts` | `relay --hosted-command`, `--hosted-credits`; `connect adopt <agent>`. |
| Tests | `test/relay-hosted.test.mjs`, `test/hosted-cli.test.mjs` new. |

---

### Task 1: Branch and baseline

- [ ] **Step 1: Branch from main**

```bash
git switch -c im/m-hosted
git log --oneline -1
```
Expected: `gemsbang 0.3.5: …` (or later on main).

- [ ] **Step 2: Baseline**

```bash
node --test --test-concurrency=2 test/*.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
```
Expected: `ℹ pass 977`, `ℹ fail 0`.

---

### Task 2: The orchestrator, the relay's move, the API, the server

**Files:**
- Create: `src/relay/hosted.ts`
- Modify: `src/relay/relay.ts`, `src/relay/api.ts`, `src/relay/server.ts`
- Test: `test/relay-hosted.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// test/relay-hosted.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { route } from "../dist/relay/api.js";
import { commandRunner, Orchestrator, workspaceFiles } from "../dist/relay/hosted.js";
import { Relay } from "../dist/relay/relay.js";
import { startRelay } from "../dist/relay/server.js";

const BASE = Date.UTC(2026, 9, 31, 9, 0, 0);
function relay() {
  let offset = 0;
  const mails = [];
  const now = () => { const t = new Date(BASE + offset).toISOString().replace(/\.\d{3}Z$/, "Z"); offset += 1000; return t; };
  const r = new Relay({ root: mkdtempSync(join(tmpdir(), "gemworks-relay-")), name: "relay.test", version: "0.0.0", now, mailer: (m) => { mails.push(m); } });
  r.mails = mails;
  return r;
}
function call(r, line, { token, body } = {}) {
  const [method, path] = line.split(" ");
  const res = route({ method, path, query: {}, ...(token !== undefined ? { token } : {}), ...(body !== undefined ? { body } : {}) }, r);
  return { status: res.status, json: res.type.startsWith("application/json") ? JSON.parse(res.body) : undefined, text: res.body };
}

/** 赵 registers (and so gets the hosted helper, with the free 20); john (100 credits) has a group with 赵 and helper in it. */
function world() {
  const r = relay();
  const john = r.issuePerson("john");
  r.topUp("john", 100);
  r.startLogin({ email: "zhao@x.io" });
  const zhao = r.finishLogin({ email: "zhao@x.io", code: /验证码是 (\d{6})/.exec(r.mails[0].text)[1], name: "zhao" });
  assert.equal(zhao.ok, true, zhao.reason);
  const helper = r.hostedAgents()[0];
  r.createVenue(john.record, { id: "g-1", kind: "group", name: "开源周会", people: ["zhao"], agents: ["agent:helper@zhao"] });
  const rounds = [];
  const runner = async (round) => { rounds.push(round); return round.item.prompt.includes("炸") ? { ok: false, error: "boom" } : { ok: true, text: `答：${round.prompt.split("\n").at(-1)}` }; };
  return { r, john, zhao, helper, rounds, runner, zhaoBy: r.verify(zhao.token) };
}
const lastOf = (r, owner, venue) => r.venueOf(owner, venue).messages.at(-1);

test("a round (transport §6 睡醒): an item on the hosted agent's queue, one run through the runner with the daemon's prompt — the envelope with the sender's scope, the text — in the agent's workspace; the answer posted as the agent under the message, the item read and answered with the reply's address, the owner's wallet charged a round through the agent's cap; an empty queue runs nothing", async () => {
  const { r, john, zhao, helper, rounds, runner } = world();
  const orch = new Orchestrator({ relay: r, runner, relayUrl: "http://relay.test" });
  assert.equal(r.appendMessage(john.record, "john", "g-1", { id: "m-1", text: "@helper 这个项目怎么跑？" }).ok, true);
  assert.equal(await orch.sweep(), 1);
  assert.equal(rounds.length, 1);
  const [round] = rounds;
  assert.deepEqual([round.person, round.agent, round.token, round.relayUrl, round.item.id, round.scope], ["zhao", "helper", helper.token, "http://relay.test", "qi-g-1-m-1", { write: false, run: "none", budget: round.scope.budget }]);
  assert.match(round.prompt, /^\[来自 群「开源周会」 · john（成员） · 权限：[^\]]+ · 队列中还有 0 条\]\n@helper 这个项目怎么跑？$/);
  assert.equal(round.workspace, join(r.root, "_hosted", "zhao", "helper"));
  assert.equal(existsSync(round.workspace), true, "the persistent workspace");
  const reply = lastOf(r, "john", "g-1");
  assert.deepEqual([reply.speaker, reply.kind, reply.text, reply.replyTo, reply.hops], ["agent:helper@zhao", "chat", "答：@helper 这个项目怎么跑？", "m-1", 0]);
  const q = r.queueOf(r.verify(helper.token), "zhao", "helper");
  assert.deepEqual(q.queue.markers.map((m) => [m.kind, m.item, m.reply !== undefined]), [["read", "qi-g-1-m-1", false], ["answered", "qi-g-1-m-1", true]]);
  assert.deepEqual(q.pending, []);
  const spent = r.ledgerOf("zhao").at(-1);
  assert.deepEqual([spent.kind, spent.amount, spent.agent, spent.cap, spent.note, r.balance("zhao")], ["spend", 1, "helper", "auto", "托管一轮 · 开源周会", 19]);
  assert.equal(await orch.sweep(), 0, "nothing pending");
  void zhao;
});

test("awake to the queue: with the orchestrator started, an append wakes the rounds on their own; a runner's error answers the item with a system line; a broke owner's item too; a second wake while the agent runs waits its turn", async () => {
  const { r, john, runner, rounds } = world();
  const orch = new Orchestrator({ relay: r, runner, relayUrl: "http://relay.test" });
  orch.start();
  r.appendMessage(john.record, "john", "g-1", { id: "m-1", text: "@helper 第一问" });
  r.appendMessage(john.record, "john", "g-1", { id: "m-2", text: "@helper 第二问" });
  await orch.idle();
  assert.deepEqual(rounds.map((x) => x.item.id), ["qi-g-1-m-1", "qi-g-1-m-2"]);
  assert.deepEqual(r.venueOf("john", "g-1").messages.map((m) => [m.speaker, m.replyTo]).slice(2), [["agent:helper@zhao", "m-1"], ["agent:helper@zhao", "m-2"]]);
  r.appendMessage(john.record, "john", "g-1", { id: "m-3", text: "@helper 炸一下" });
  await orch.idle();
  assert.deepEqual([lastOf(r, "john", "g-1").kind, lastOf(r, "john", "g-1").text], ["system", "helper 这一轮没跑成：boom"]);
  assert.equal(r.queueOf(r.verify(r.hostedAgents()[0].token), "zhao", "helper").pending.length, 0, "answered all the same");
  orch.stop();
  r.appendMessage(john.record, "john", "g-1", { id: "m-4", text: "@helper 停了以后" });
  await orch.idle();
  assert.equal(rounds.length, 3, "stopped: no round");
  const dear = new Orchestrator({ relay: r, runner, relayUrl: "http://relay.test", credits: 25 });
  assert.equal(await dear.sweep(), 1);
  assert.deepEqual([lastOf(r, "john", "g-1").kind, lastOf(r, "john", "g-1").text, rounds.length], ["system", "helper 这一轮没跑：积分不够：钱包 17", 3]);
});

test("the runner as a command: the prompt on stdin, the round in HOSTED_* variables, the workspace as its directory, the answer on stdout; a non-zero exit and the time limit are errors", async () => {
  const round = { person: "zhao", agent: "helper", token: "t", relayUrl: "http://relay.test", item: { id: "qi-1", prompt: "x" }, prompt: "[信封]\n问题", scope: { write: false, run: "none", budget: 5 }, workspace: mkdtempSync(join(tmpdir(), "gemworks-hosted-")) };
  const echo = commandRunner("node -e \"let s='';process.stdin.on('data',(c)=>{s+=c}).on('end',()=>{process.stdout.write('echo:'+s.split(String.fromCharCode(10)).pop()+'|'+process.env.HOSTED_AGENT+'|'+JSON.parse(process.env.HOSTED_SCOPE).budget+'|'+(require('fs').realpathSync(process.cwd())===require('fs').realpathSync(process.env.HOSTED_WORKSPACE)))})\"");
  assert.deepEqual(await echo(round), { ok: true, text: "echo:问题|helper|5|true" });
  assert.deepEqual(await commandRunner("node -e \"process.stderr.write('no model');process.exit(2)\"")(round), { ok: false, error: "runner exited 2: no model" });
  assert.deepEqual(await commandRunner("node -e \"setTimeout(()=>{},5000)\"", 1000)(round), { ok: false, error: "超时 1 秒" });
  assert.deepEqual(await commandRunner("node -e \"process.exit(0)\"")(round), { ok: true, text: "（这一轮没有回答）" });
});

test("搬家 (transport §6): the owner takes the token and the workspace's files (the cache left behind); the account stays, the queue goes on, the agent is hosted no more — no round, no 天然资格; the listing says which agents are hosted", () => {
  const { r, john, zhao, helper } = world();
  const workspace = join(r.root, "_hosted", "zhao", "helper");
  mkdirSync(join(workspace, "cache"), { recursive: true });
  mkdirSync(join(workspace, "skills"), { recursive: true });
  writeFileSync(join(workspace, "HOME.md"), "# helper\n", "utf8");
  writeFileSync(join(workspace, "skills", "pdf.md"), "pdf\n", "utf8");
  writeFileSync(join(workspace, "cache", "big.bin"), "x".repeat(10), "utf8");
  assert.deepEqual(workspaceFiles(workspace), [{ path: "HOME.md", text: "# helper\n" }, { path: "skills/pdf.md", text: "pdf\n" }]);
  assert.deepEqual(workspaceFiles(join(r.root, "_hosted", "nobody", "x")), []);
  assert.deepEqual(call(r, "GET /hosted", { token: zhao.token }).json, [{ agent: "helper" }]);
  assert.equal(call(r, "POST /hosted/helper/move", { token: john.token }).status, 404);
  assert.equal(call(r, "POST /hosted/helper/move", { token: helper.token }).status, 403);
  const moved = call(r, "POST /hosted/helper/move", { token: zhao.token });
  assert.deepEqual([moved.status, moved.json.token, moved.json.files], [200, helper.token, [{ path: "HOME.md", text: "# helper\n" }, { path: "skills/pdf.md", text: "pdf\n" }]]);
  assert.deepEqual([r.hostedAgents(), call(r, "GET /hosted", { token: zhao.token }).json, r.eligibilityOf("zhao", "helper")], [[], [], "还没有会话"]);
  assert.equal(call(r, "POST /hosted/helper/move", { token: zhao.token }).status, 404, "moved once");
  r.appendMessage(john.record, "john", "g-1", { id: "m-1", text: "@helper 还在吗" });
  assert.equal(r.verify(helper.token) !== undefined, true, "the token still works on the desktop");
  assert.equal(r.queueOf(r.verify(helper.token), "zhao", "helper").pending.length, 1, "the queue goes on");
});

test("the server runs the orchestrator when told: a round through the relay's own append, stopped with the server", async () => {
  const mails = [];
  const rounds = [];
  const s = await startRelay({ root: mkdtempSync(join(tmpdir(), "gemworks-relay-")), name: "relay.test", mailer: (m) => { mails.push(m); }, hosted: { runner: async (round) => { rounds.push(round); return { ok: true, text: "在" }; } } });
  try {
    assert.ok(s.hosted !== undefined, "the orchestrator on the server");
    const john = s.relay.issuePerson("john");
    s.relay.startLogin({ email: "zhao@x.io" });
    const zhao = s.relay.finishLogin({ email: "zhao@x.io", code: /验证码是 (\d{6})/.exec(mails[0].text)[1], name: "zhao" });
    assert.equal(zhao.ok, true, zhao.reason);
    s.relay.createVenue(john.record, { id: "g-1", kind: "group", name: "群", people: ["zhao"], agents: ["agent:helper@zhao"] });
    s.relay.appendMessage(john.record, "john", "g-1", { id: "m-1", text: "@helper 在吗" });
    await s.hosted.idle();
    assert.deepEqual([rounds.length, rounds[0].relayUrl, s.relay.venueOf("john", "g-1").messages.at(-1).text], [1, s.url, "在"]);
  } finally {
    await s.close();
  }
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
node --test test/relay-hosted.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
```
Expected: `ℹ fail 5` (the module is not there).

- [ ] **Step 3: Write `src/relay/hosted.ts`**

```ts
// The hosted agent's body (transport §6): no process while it idles; an
// item on its queue wakes the orchestrator, which runs one round through
// the runner — a command on the platform, a function in tests — in the
// agent's own workspace under the relay's root, with the prompt the
// desktop's daemon would have built, posts the answer as the agent, marks
// the item, and sleeps again. The owner pays a round from their wallet
// through the agent's own caps (先免费额度，再积分); a broke owner's item is
// answered with a system line. 搬家 is the relay's (moveHosted); the
// workspace's files are read here.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseAddress } from "../core/im/address.js";
import { scopeOfCard, type ToolKey, type VenueOfWork } from "../core/im/card.js";
import { expandEmbeds } from "../core/im/embed.js";
import { envelopeLine, withEnvelope } from "../core/im/envelope.js";
import { parseSpeaker, personBehind } from "../core/im/identity.js";
import { next, type QueueItem } from "../core/im/queue.js";
import { scopeFor, type ToolScope } from "../core/im/sender.js";
import { scopeGrantsFrom, type Relay } from "./relay.js";
import { readDoc } from "./store.js";

/** What a round gets: who it is, the item, the prompt as the daemon would build it, the scope the envelope names, the persistent workspace. */
export interface Round { person: string; agent: string; token: string; relayUrl: string; item: QueueItem; prompt: string; scope: ToolScope; workspace: string }
export type Runner = (round: Round) => Promise<{ ok: true; text: string } | { ok: false; error: string }>;
export interface OrchestratorOptions { relay: Relay; runner: Runner; relayUrl: string; credits?: number; log?: (line: string) => void }
/** What a round costs the owner (transport §6 计费), through the agent's 自动买 cap. */
export const ROUND_CREDITS = 1;

export class Orchestrator {
  private readonly relay: Relay;
  private readonly runner: Runner;
  private readonly relayUrl: string;
  private readonly credits: number;
  private readonly log: (line: string) => void;
  private readonly busy = new Set<string>();
  private off: (() => void) | undefined;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(o: OrchestratorOptions) {
    this.relay = o.relay;
    this.runner = o.runner;
    this.relayUrl = o.relayUrl;
    this.credits = o.credits ?? ROUND_CREDITS;
    this.log = o.log ?? (() => {});
  }

  /** Awake to the queues: an item appended to a hosted agent's queue starts its rounds, one wake after another. */
  start(): void {
    this.off = this.relay.onAppend(({ owner, doc, block }) => {
      const m = /^queues\/([^/]+)\.geml$/.exec(doc);
      if (m === null || /^(read|answered)-\d+$/.test(block.id)) return;
      this.chain = this.chain.then(() => this.wake(owner, m[1]!)).catch(() => undefined);
    });
  }

  stop(): void { this.off?.(); this.off = undefined; }

  /** Once every wake so far has run (tests wait on it). */
  idle(): Promise<void> { return this.chain.then(() => undefined); }

  /** Every hosted agent with something pending gets its rounds; how many ran. */
  async sweep(): Promise<number> {
    let n = 0;
    for (const h of this.relay.hostedAgents()) n += await this.wake(h.person, h.agent);
    return n;
  }

  /** The agent's rounds, one after another, until its queue is empty; a wake while it runs is a no-op (the running loop drains the queue). */
  async wake(person: string, agent: string): Promise<number> {
    const h = this.relay.hostedAgents().find((x) => x.person === person && x.agent === agent);
    if (h === undefined) return 0;
    const key = `${person}/${agent}`;
    if (this.busy.has(key)) return 0;
    this.busy.add(key);
    let n = 0;
    try { while (await this.round(h)) n++; } catch (e) { this.log(`${key}: ${e instanceof Error ? e.message : String(e)}`); } finally { this.busy.delete(key); }
    return n;
  }

  /** One round: the next pending item read and run, the answer posted, the item answered; the owner charged first. False when nothing is pending. */
  private async round(h: { person: string; agent: string; token: string }): Promise<boolean> {
    const by = this.relay.verify(h.token);
    if (by === undefined) return false;
    const q = this.relay.queueOf(by, h.person, h.agent);
    if (!q.ok) return false;
    const now = this.relay.now();
    const { item } = next(q.queue, now);
    if (item === undefined) return false;
    const target = targetOf(item);
    if (target === undefined) { this.relay.mark(by, h.person, h.agent, "answered", item.id); return true; }
    if (this.credits > 0) {
      const paid = this.relay.spend(by, { credits: this.credits, note: `托管一轮 · ${item.venueName}` });
      if (!paid.ok) {
        this.relay.mark(by, h.person, h.agent, "answered", item.id);
        this.relay.appendSystem(target.owner, target.venue, `${h.agent} 这一轮没跑：${paid.reason}`);
        return true;
      }
    }
    this.relay.mark(by, h.person, h.agent, "read", item.id);
    const scope = item.card !== undefined ? scopeOfCard({ tools: item.card.tools as ToolKey[], venueOfWork: item.card.venueOfWork as VenueOfWork, budget: item.card.credits !== undefined ? { credits: item.card.credits } : {} }) : this.scopeOf(h.person, item, now);
    const prompt = this.promptFor(by.speaker, item, q.pending.length - 1, scope);
    const workspace = join(this.relay.root, "_hosted", h.person, h.agent);
    mkdirSync(workspace, { recursive: true });
    let r: Awaited<ReturnType<Runner>>;
    try { r = await this.runner({ person: h.person, agent: h.agent, token: h.token, relayUrl: this.relayUrl, item, prompt, scope, workspace }); } catch (e) { r = { ok: false, error: e instanceof Error ? e.message : String(e) }; }
    if (!r.ok) {
      this.relay.mark(by, h.person, h.agent, "answered", item.id);
      this.relay.appendSystem(target.owner, target.venue, `${h.agent} 这一轮没跑成：${r.error}`);
      return true;
    }
    const id = `m-${String(Date.parse(now)).padStart(13, "0")}-${randomBytes(4).toString("hex")}`;
    const posted = this.relay.appendMessage(by, target.owner, target.venue, { id, kind: "chat", text: r.text, ...(target.replyTo !== undefined ? { replyTo: target.replyTo } : {}), handling: item.hops });
    if (posted.ok) this.relay.mark(by, h.person, h.agent, "answered", item.id, this.relay.address(target.owner, `venues/${target.venue}.geml`, id));
    else {
      this.relay.mark(by, h.person, h.agent, "answered", item.id);
      this.relay.appendSystem(target.owner, target.venue, `${h.agent} 的回答没贴上：${posted.reason}`);
    }
    return true;
  }

  /** The sender's scope for the turn (§7.2), from the owner's page's grants, as the daemon computes it. */
  private scopeOf(person: string, item: QueueItem, now: string): ToolScope {
    const sender = parseSpeaker(item.sender);
    const from = sender === undefined ? undefined : personBehind(sender);
    return scopeFor(item.level, { ...(from !== undefined ? { person: from } : {}), venue: item.venue, grants: scopeGrantsFrom(readDoc(this.relay.root, person, `people/${person}.geml`).blocks), now });
  }

  /** The prompt as the desktop's daemon would build it (transport §3): the envelope, the text, the context pack resolved by the agent's own permission. */
  private promptFor(viewer: string, item: QueueItem, queued: number, scope: ToolScope): string {
    const envelope = envelopeLine({ venueKind: item.venueKind, venueName: item.venueName, senderName: item.senderName, level: item.level, scope, queued });
    const { expanded } = expandEmbeds(item.context ?? [], viewer, this.relay.access());
    const context = expanded.map((x) => (x.text !== undefined ? `[${x.embed.src}]\n${x.text}` : `[${x.embed.src}：${x.stub !== undefined ? `看不到，来自 ${x.stub.from} 的私有范围` : x.fault ?? "找不到"}]`)).join("\n\n");
    return withEnvelope(envelope, context === "" ? item.prompt : `${item.prompt}\n\n${context}`);
  }
}

/** Where the answer goes: under the message that raised the item, or into the card's thread (daemon/deliver.ts has the same rule). */
function targetOf(item: QueueItem): { owner: string; venue: string; replyTo?: string } | undefined {
  const a = item.message === undefined ? undefined : parseAddress(item.message);
  if (a === undefined) return undefined;
  if (item.card !== undefined) return { owner: a.owner, venue: item.venue };
  const v = /^venues\/([^/]+)\.geml$/.exec(a.doc);
  return v === null || a.block === undefined ? undefined : { owner: a.owner, venue: v[1]!, replyTo: a.block };
}

/** The runner as a command (transport §6 起一个容器跑一轮): the prompt on stdin, the round in HOSTED_* variables, the workspace as its directory; its stdout is the answer; a non-zero exit or the time limit is the error. */
export function commandRunner(command: string, timeoutMs = 600_000): Runner {
  return (round) => new Promise((done) => {
    const win = process.platform === "win32";
    const child = spawn(win ? "cmd.exe" : "sh", win ? ["/d", "/s", "/c", command] : ["-c", command], { cwd: round.workspace, env: { ...process.env, HOSTED_PERSON: round.person, HOSTED_AGENT: round.agent, HOSTED_TOKEN: round.token, HOSTED_RELAY: round.relayUrl, HOSTED_WORKSPACE: round.workspace, HOSTED_ITEM: JSON.stringify(round.item), HOSTED_SCOPE: JSON.stringify(round.scope) }, stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "", finished = false;
    const finish = (r: Awaited<ReturnType<Runner>>): void => { if (finished) return; finished = true; clearTimeout(timer); done(r); };
    const timer = setTimeout(() => { child.kill("SIGKILL"); finish({ ok: false, error: `超时 ${Math.round(timeoutMs / 1000)} 秒` }); }, timeoutMs);
    child.stdout.on("data", (c: Buffer) => { out += c; });
    child.stderr.on("data", (c: Buffer) => { err += c; });
    child.on("error", (e) => finish({ ok: false, error: e.message }));
    child.on("exit", (code) => finish(code === 0 ? { ok: true, text: out.trim() === "" ? "（这一轮没有回答）" : out.trim() } : { ok: false, error: `runner exited ${code}: ${err.trim()}` }));
    child.stdin.end(round.prompt);
  });
}

/** How big a workspace file may be to travel with 搬家. */
const FILE_LIMIT = 65_536;

/** The workspace's files for 搬家 (transport §6 下载主页和 skill): every text file under it but the cache, with its content, paths with forward slashes. */
export function workspaceFiles(workspace: string): { path: string; text: string }[] {
  if (!existsSync(workspace)) return [];
  const out: { path: string; text: string }[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const path = rel === "" ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) { if (e.name !== "cache") walk(join(dir, e.name), path); continue; }
      if (!e.isFile() || statSync(join(dir, e.name)).size > FILE_LIMIT) continue;
      out.push({ path, text: readFileSync(join(dir, e.name), "utf8") });
    }
  };
  walk(workspace, "");
  return out;
}
```

- [ ] **Step 4: The relay's part**

In `src/relay/relay.ts`, `  private appendSystem(owner: string, id: string, text: string): Message {` becomes `  appendSystem(owner: string, id: string, text: string): Message {` (the orchestrator writes its lines with it); the `hostedAgents` method:

```ts
  hostedAgents(): { person: string; agent: string; token: string }[] {
    return readDoc(this.root, RELAY_OWNER, HOSTED).blocks.filter((x) => x.id.startsWith("hosted-")).map((x) => ({ person: str(x.value["person"]) ?? "", agent: str(x.value["agent"]) ?? "", token: str(x.value["token"]) ?? "" }));
  }
```

becomes:

```ts
  /** The agents the platform runs (transport §6), the moved ones left out. */
  hostedAgents(): { person: string; agent: string; token: string }[] {
    const blocks = readDoc(this.root, RELAY_OWNER, HOSTED).blocks;
    const moved = new Set(blocks.filter((x) => x.id.startsWith("moved-")).map((x) => `${str(x.value["person"]) ?? ""}/${str(x.value["agent"]) ?? ""}`));
    return blocks.filter((x) => x.id.startsWith("hosted-")).map((x) => ({ person: str(x.value["person"]) ?? "", agent: str(x.value["agent"]) ?? "", token: str(x.value["token"]) ?? "" })).filter((h) => !moved.has(`${h.person}/${h.agent}`));
  }

  /** A person's hosted agents, as the listing shows them. */
  hostedOf(person: string): { agent: string }[] { return this.hostedAgents().filter((h) => h.person === person).map((h) => ({ agent: h.agent })); }

  /** 搬家 (transport §6): the owner takes the hosted agent's token and workspace to their desktop; the account stays, the queue on the relay goes on, the rounds here stop. */
  moveHosted(by: TokenRecord, agent: string): Result<{ token: string; workspace: string }> {
    const s = parseSpeaker(by.speaker);
    if (by.scope !== "person" || s?.kind !== "person") return fail(403, "只有主人能搬");
    const h = this.hostedAgents().find((x) => x.person === s.id && x.agent === agent);
    if (h === undefined) return fail(404, "没有这个托管 agent");
    appendSealed(this.root, RELAY_OWNER, HOSTED, `moved-${rand()}`, { person: s.id, agent, at: this.now() });
    return { ok: true, token: h.token, workspace: join(this.root, "_hosted", s.id, agent) };
  }
```

and the file's imports gain, after `import { randomBytes } from "node:crypto";`:

```ts
import { join } from "node:path";
```

In `src/relay/api.ts`: after `import { JSON_TYPE, … }` — the file's import of the relay (`import { Relay, … } from "./relay.js";` or the line importing `TokenRecord`), add:

```ts
import { workspaceFiles } from "./hosted.js";
```

and before `  if (a === "rooms") {`:

```ts
  if (a === "hosted") {
    if (parts.length === 1) {
      if (m !== "GET") return fail(405, "只有 GET");
      if (scopeOf(by) !== "person") return fail(403, "只有本人能看托管的 agent");
      return json(200, relay.hostedOf(by.speaker.slice("person:".length)));
    }
    if (parts.length === 3 && b !== undefined && c === "move") {
      if (m !== "POST") return fail(405, "只有 POST");
      const r = relay.moveHosted(by, b);
      return answer(r.ok ? { ok: true as const, token: r.token, files: workspaceFiles(r.workspace) } : r);
    }
    return fail(404, "没有这个路径");
  }
```

In `src/relay/server.ts`: `import { Relay, type RelayOptions } from "./relay.js";` gains after it:

```ts
import { Orchestrator, type Runner } from "./hosted.js";
```

`export interface RelayServer { port: number; url: string; relay: Relay; close(): Promise<void> }` becomes `export interface RelayServer { port: number; url: string; relay: Relay; hosted?: Orchestrator; close(): Promise<void> }`; `export function startRelay(o: RelayOptions & { port?: number; host?: string }): Promise<RelayServer> {` becomes `export function startRelay(o: RelayOptions & { port?: number; host?: string; hosted?: { runner: Runner; credits?: number } }): Promise<RelayServer> {`; and in the listen callback, `      const port = (server.address() as AddressInfo).port;\n      done({\n        port, url: \`http://${host}:${port}\`, relay,` becomes:

```ts
      const port = (server.address() as AddressInfo).port;
      const url = `http://${host}:${port}`;
      // The hosted agents' body (transport §6), awake to their queues while the server runs.
      const hosted = o.hosted === undefined ? undefined : new Orchestrator({ relay, runner: o.hosted.runner, relayUrl: url, ...(o.hosted.credits !== undefined ? { credits: o.hosted.credits } : {}), log: (line) => console.error(`hosted: ${line}`) });
      hosted?.start();
      done({
        port, url, relay, ...(hosted !== undefined ? { hosted } : {}),
```

and its `        close: () => new Promise((closed) => {\n          clearInterval(sweep);` becomes `        close: () => new Promise((closed) => {\n          hosted?.stop();\n          clearInterval(sweep);`.

- [ ] **Step 5: Build and run**

```bash
npm run build 2>&1 | tail -2 && node --test test/relay-hosted.test.mjs test/relay-login.test.mjs test/relay-core.test.mjs test/relay-api.test.mjs test/relay-split.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
```
Expected: `ℹ fail 0`.

- [ ] **Step 6: Commit**

```bash
git add src/relay/hosted.ts src/relay/relay.ts src/relay/api.ts src/relay/server.ts test/relay-hosted.test.mjs
git commit -m "IM relay: the hosted agent's body — the orchestrator's rounds through a runner, 搬家"
```

---

### Task 3: The CLI: `relay --hosted-command`, `connect adopt`

**Files:**
- Modify: `src/cli.ts`
- Test: `test/hosted-cli.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// test/hosted-cli.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

test("gemworks connect adopt (transport §6 搬家): the hosted agent's token into connect.json and its workspace's files under the home; once only; the usage errors; relay --hosted-credits must be a number", async () => {
  const mails = [];
  const root = tmp("gemworks-relay-");
  const s = await startRelay({ root, name: "relay.test", mailer: (m) => { mails.push(m); } });
  const home = tmp("gemworks-im-");
  try {
    s.relay.startLogin({ email: "zhao@x.io" });
    const zhao = s.relay.finishLogin({ email: "zhao@x.io", code: /验证码是 (\d{6})/.exec(mails[0].text)[1], name: "zhao" });
    assert.equal(zhao.ok, true, zhao.reason);
    const helper = s.relay.hostedAgents()[0];
    mkdirSync(join(root, "_hosted", "zhao", "helper", "skills"), { recursive: true });
    writeFileSync(join(root, "_hosted", "zhao", "helper", "HOME.md"), "# helper\n", "utf8");
    writeFileSync(join(root, "_hosted", "zhao", "helper", "skills", "pdf.md"), "pdf\n", "utf8");
    writeConfig(home, { relay: { url: s.url, name: "relay.test" }, person: "zhao", token: zhao.token, agents: {} });
    assert.equal((await run(["connect", "adopt", "--home", home])).code, 2);
    const adopted = await run(["connect", "adopt", "helper", "--home", home]);
    assert.deepEqual([adopted.code, adopted.out], [0, `helper 搬来了 · 令牌已记入 connect.json · 2 个文件在 ${join(home, "hosted", "helper")}\n`], adopted.err);
    assert.deepEqual(JSON.parse(readFileSync(join(home, "connect.json"), "utf8")).agents, { helper: helper.token });
    assert.deepEqual([readFileSync(join(home, "hosted", "helper", "HOME.md"), "utf8"), readFileSync(join(home, "hosted", "helper", "skills", "pdf.md"), "utf8")], ["# helper\n", "pdf\n"]);
    assert.equal(s.relay.hostedAgents().length, 0);
    const again = await run(["connect", "adopt", "helper", "--home", home]);
    assert.deepEqual([again.code, again.err.trim()], [1, "gemworks connect adopt: 没有这个托管 agent"]);
    assert.equal((await run(["relay", "--hosted-credits", "x", "--root", root])).code, 2, "a number");
    const usage = (await run([])).err;
    for (const w of ["connect adopt", "--hosted-command"]) assert.match(usage, new RegExp(w));
  } finally {
    await s.close();
  }
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
node --test test/hosted-cli.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
```
Expected: `ℹ fail 1`.

- [ ] **Step 3: The commands**

In `src/cli.ts`: the usage line `  "  relay [--root dir] [--port N] …` — the first usage line that starts with `  "  relay ` (the server's) — gains, after it:

```ts
  "  relay … [--hosted-command cmd] [--hosted-credits N]   also run the hosted agents' rounds (transport §6): the command gets the prompt on stdin and HOSTED_* in its environment, answers on stdout; a round costs the owner N credits (1)",
```

and after `  "  connect setup --relay <url> --token <t> | agent <name> --token <t> | status   …",` (the line starting `  "  connect setup`):

```ts
  "  connect adopt <agent>                    搬家 (transport §6): the hosted agent's token into connect.json, its workspace's files under the home; the account and the queue stay",
```

The imports: `import { exists, readText, realPath } from "./host-fs.js";` becomes `import { exists, readText, realPath, writeAtomic } from "./host-fs.js";`, and after `import { commandMailer } from "./relay/mail.js";`:

```ts
import { commandRunner } from "./relay/hosted.js";
```

In `runRelay`, `  if (positionals("relay", rest, [], ["--root", "--port", "--name", "--host", "--federation", "--free-credits", "--mail-command"]).length > 0) fail(USAGE, 2);` becomes `  if (positionals("relay", rest, [], ["--root", "--port", "--name", "--host", "--federation", "--free-credits", "--mail-command", "--hosted-command", "--hosted-credits"]).length > 0) fail(USAGE, 2);`; `  const mail = flag(rest, "--mail-command");` gains after it:

```ts
  const hostedCommand = flag(rest, "--hosted-command"), hostedCredits = flag(rest, "--hosted-credits");
  if (hostedCredits !== undefined && !/^\d+$/.test(hostedCredits)) fail("gemworks relay: --hosted-credits needs a whole number", 2);
```

the `startRelay({ … ...(mail !== undefined ? { mailer: commandMailer(mail) } : {}) });` call gains ` ...(hostedCommand !== undefined ? { hosted: { runner: commandRunner(hostedCommand), ...(hostedCredits !== undefined ? { credits: Number(hostedCredits) } : {}) } } : {})` before ` });` (that is, `...(mail !== undefined ? { mailer: commandMailer(mail) } : {}) });` becomes `...(mail !== undefined ? { mailer: commandMailer(mail) } : {}), ...(hostedCommand !== undefined ? { hosted: { runner: commandRunner(hostedCommand), ...(hostedCredits !== undefined ? { credits: Number(hostedCredits) } : {}) } } : {}) });`), and `  console.log(\`relay ${name} listening on ${s.url} · documents under ${root}\`);` becomes `  console.log(\`relay ${name} listening on ${s.url} · documents under ${root}${hostedCommand !== undefined ? \` · 托管 agent 由「${hostedCommand}」跑\` : ""}\`);`.

In `runConnect`, before `  if (sub === "share") {`:

```ts
  if (sub === "adopt") {
    const pos = positionals("connect adopt", args, [], ["--home"]);
    const agent = pos[0];
    if (agent === undefined || pos.length !== 1) fail("gemworks connect adopt: <agent>", 2);
    const c = readConfig(home);
    if (c === undefined) return fail("gemworks connect adopt: no connect.json here; run gemworks connect setup first", 1);
    try {
      const r = await new RelayClient(c.relay.url, c.token).post(`/hosted/${encodeURIComponent(agent!)}/move`, {});
      if (r.status !== 200) return fail(`gemworks connect adopt: ${reasonOf(r)}`, 1);
      const moved = r.body as { token: string; files: { path: string; text: string }[] };
      writeConfig(home, { ...c, agents: { ...c.agents, [agent!]: moved.token } });
      const dir = join(home, "hosted", agent!);
      for (const f of moved.files) writeAtomic(join(dir, ...f.path.split("/")), f.text);
      console.log(`${agent} 搬来了 · 令牌已记入 connect.json · ${moved.files.length} 个文件在 ${dir}`);
      return 0;
    } catch (e) { return fail(`gemworks connect adopt: ${e instanceof Error ? e.message : String(e)}`, 1); }
  }
```

- [ ] **Step 4: Build and run**

```bash
npm run build 2>&1 | tail -2 && node --test test/hosted-cli.test.mjs test/daemon-cli.test.mjs test/login-cli.test.mjs test/cli.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
```
Expected: `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts test/hosted-cli.test.mjs
git commit -m "CLI: relay --hosted-command runs the hosted agents; connect adopt brings one home"
```

---

### Task 4: Gates and the version

- [ ] **Step 1: The four gates, each its own command**

```bash
npm run build
claude plugin validate .
claude plugin test .
node --test --test-concurrency=2 test/*.test.mjs
```
Expected: build clean; validate ok; `claude plugin test` with only the machine's pane failures (and at times the harness's `the file ran to its end`); the node suites `ℹ fail 0`, `ℹ pass` 977 + 5 + 1 = 983.

- [ ] **Step 2: The version and the merge**

```bash
node scripts/bump.mjs 0.3.6
git add -A && git commit -m "gemsbang 0.3.6: the hosted agent's body — rounds through a runner on the relay, 搬家 (transport §6)"
git switch main && git merge --ff-only im/m-hosted && git branch -d im/m-hosted
```

---

## Self-review

- **Spec coverage (transport §6):** 创建 ✓ (plan I gives each registration a hosted agent); 睡醒 ✓ (no process while idle: the orchestrator wakes on the queue's append, runs one round, posts, sleeps), the container as a runner command ✓ with the workspace as its directory (每个 agent 一个持久卷 ✓ `_hosted/<person>/<agent>`), 按信封范围限制 ✓ (the scope in `HOSTED_SCOPE` and in the envelope); 计费 ✓ (a round costs the owner through the agent's 自动买 cap: the free allowance first, then credits; a broke owner's item is answered with a system line), 推理走平台 API 池 is the runner's business, 天然有接单资格 ✓ (plan K); 搬家 ✓ (`connect adopt`: the token into connect.json, the workspace's files under the home, the account and the queue unchanged, the rounds here stopped).
- **Placeholders:** none.
- **Type consistency:** `Round`/`Runner` from `hosted.ts` in `server.ts` and the CLI; `moveHosted` returns the workspace path, the API adds the files with `workspaceFiles`; `hostedAgents()` honours `moved-*` so eligibility (plan K's `isHosted`) follows.
