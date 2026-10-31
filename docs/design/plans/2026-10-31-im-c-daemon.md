# IM C — The Daemon `gemworks connect` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `gemworks connect`: one daemon per person (transport §1.1, §3) that holds the person's and their agents' tokens, mirrors the relay into `~/.gemworks/im/` as GEML files, pushes the machine's pending writes when it can, reports each session's presence with a heartbeat, and — as pure functions over the mirror that every host calls through the bridge — hands a session the next queue item with its envelope and sends its answer back, or holds it as a draft when the owner wants to see it first.

**Architecture:** The daemon is a synchroniser and nothing else: relay ⇄ mirror files ⇄ outbox. Four Node-side modules under `src/daemon/`. `home.ts` is the layout of the home directory and every read and write in it (config, mirrors, outbox, drafts, session reports, state). `client.ts` is the relay over `fetch` and the global `WebSocket`, throwing `RelayDown` when the network fails and answering a status otherwise. `sync.ts` is the daemon: one `syncOnce` (list what to follow, mirror it whole, flush the outbox, heartbeat, record the state) that `run` repeats with a subscription in between, pushed blocks appended to the mirrors as they land. `deliver.ts` never touches the network: a host asks it for the next prompt (plan A's `next`, `envelopeLine`, `scopeFor`, `expandEmbeds` over the mirror), tells it the item was read in, gives it the final answer — each a file in the outbox or a draft, which the daemon pushes when it is up. So a host with no daemon running still reads the last mirror and still writes; nothing is lost and nothing blocks (transport §2.7, §3 心跳). The relay gains two listings for the daemon (`GET /venues`, `GET /agents`) and exports its venue fold and grant fold for the host side.

**Tech Stack:** TypeScript 5 (`strict`, `noUncheckedIndexedAccess`, `nodenext`), Node ≥ 22 (`fetch`, `WebSocket` global, `node:fs`), `node:test` over `dist/`, the relay of plan B started in-process by the tests (`startRelay`).

**Spec:** transport §1.1 (the daemon chosen), §2.3 (the mirror's path), §2.7 (offline: pending blocks, the relay orders), §3 (the ten duties: tokens, mirror, pending, delivery, envelope and scope, session registration, heartbeat; packages, local execution and the guest room are plans F and ⑥'s), §8 (a scripted relay: stamping, stubs, backlog offline, idempotent resend); main spec §5 rules 3, 4, 8, §5.1 (expansion within a budget), §6.5 (the envelope, 回群前先给我看, the three states), §6.8 (the context segment), §7.2–§7.3 (scope by level, widened by grants).

**Series:** A core (0.2.90) → B relay (0.2.91) → **C daemon (this)** → D Claude Code shell → E share card and guest page → F task cards.

**Working directory:** `/Users/xiong/software/gemsbang`, in place, on a branch `im/c-daemon` cut from `main` in Task 1. Never switch to another branch, never `git stash`, never push.

**Conventions:** as plan B's: English commit messages; no attribution lines; commits as `git -c user.name="Jieying, Xiong" -c user.email="xiongjy2104@gmail.com" commit -m "…"`; the version bumped once, in the last task; the CHANGELOG untouched; `.geml/` never added; an expensive gate once. Words to a person at the terminal are English (the CLI's); words into the prompt are Chinese (the core's).

**Baseline (2026-10-31, main at 0af85dc, 0.2.91):** `pass 867, fail 0`.

---

## Decisions this plan makes

1. **The home is `~/.gemworks/im/`** (`GEMWORKS_IM_HOME` or `--home` override it; the tests use a temporary one): `connect.json` (the relay's url and name, the person, their token, their agents' tokens by name), `<relay>/<owner>/<doc>.geml` mirrors (plan A's `mirrorRelPath`, a port as `_port`), `outbox/<id>.json` pending writes, `outbox/failed/<id>.json` ones the relay refused (with the reason), `drafts/<id>.json` answers waiting for the owner, `sessions/<agent>/<session>.json` the hosts' presence reports, `state.json` whether the relay was reached and when. Tokens live on the person's own disk, as §3 says the daemon holds them.
2. **A mirror is the relay's answer, whole.** `syncOnce` rewrites each followed document from `GET …?format=geml` (atomically, so a host reads the old text or the new, never half); a pushed block is appended; a block already there is not appended twice; a document pushed that has no mirror yet is fetched whole. A stub is a data block `{"stub": true, …}` in the mirror, as the relay renders it. The mirror holds no meta head: it is the relay's text.
3. **What is followed:** the venues the person is in (`GET /venues`, new), the queues of their agents (`GET /agents`, new), their own page (`people/<me>.geml`, for grants), and the inbox (`GET /inbox`, kept as `<relay>/<me>/inbox.json`, since it is computed, not a document). The list is read again on every `syncOnce` (once a minute in `run`), so a venue the person is added to appears within a minute; the subscription is renewed with it.
4. **The outbox is the only way a host writes.** An entry is one JSON file: `{id, kind: "message" | "marker", as: "person" | "agent:<name>", owner, doc, body, at, tries}`, its id the entry's time, a sequence within the process and a random part, so entries sort in the order they were made. The daemon pushes entries oldest first; a 2xx removes the entry (the block comes back through the mirror); a 4xx moves it to `outbox/failed/` with the relay's reason (a draft the relay refuses is not sent again); a network failure leaves it for the next try and records 断了 in `state.json`. A message's block id is chosen when the entry is made (`m-<time>-<random>`), so a push that was answered but not heard is not duplicated (transport §2.5).
5. **Delivery is the host's read of the mirror** (§6.5, rule 8). `nextPrompt(home, agent, now)` reads the agent's mirrored queue, counts the outbox's unpushed markers as markers too (an item read in while offline is not delivered twice), takes plan A's `next`, and writes the envelope from the item's level and the scope `scopeFor` gives it (the person's grants from the mirrored page, the venue's 回群前先给我看 from the mirrored venue). The context pack is expanded within 16 KB by plan A's `expandEmbeds` against the mirror: an embed of a mirrored block becomes its text, a mirrored stub a 你看不到 line, anything not mirrored a line saying to read it with the read tool. `markRead` and `answer` are outbox entries; `answer` into a venue with `draftFirst` is a draft instead, `sendDraft` moves it to the outbox, `dropDraft` deletes it.
6. **Presence is reported by the hosts, sent by the daemon.** A host writes `sessions/<agent>/<session>.json` (`{host, login, presence, task?, at}`); the daemon posts every report every 30 seconds (the heartbeat) and on each `syncOnce`; a report of `asleep` is posted once and then removed. The relay's three-minute rule (plan B) then yields 断了 for the phone bridge.
7. **The relay is reachable or it is not.** Every network failure is one `RelayDown`; `syncOnce` records it in `state.json` (`{connected: false, error, at}`) and returns; `run` tries again with a backoff of 5, 15, 30, 60 seconds; a host that reads `state.json` draws 断了 (plan D). Nothing in the daemon ever throws out of `run`.
8. **`gemworks connect setup --relay <url> --token <token> [--home dir]`** asks the relay `GET /` for its name and `GET /me` for the person, and writes `connect.json`; `gemworks connect agent <name> --token <token>` adds an agent's token; `gemworks connect [--home dir] [--once]` runs the daemon (`--once`: one `syncOnce`, its report on stdout, exit 0 when the relay was reached and 1 when not); `gemworks connect status` prints `state.json` and the outbox's count. The usage line and `test/cli.test.mjs`'s regex grow with it.
9. **Relay exports.** `foldVenue` and `scopeGrantsFrom` move out as named exports of `src/relay/relay.ts` (the fold of a venue document, the fold of grant blocks into plan A's `Grant`), so the host side reads mirrors with the relay's own folds. `GET /venues` answers `[{owner, id, kind, name}]` for the person's token; `GET /agents` answers the names of the person's agents.

---

## File map

| Path | Task | Responsibility |
|---|---|---|
| `src/relay/relay.ts`, `src/relay/api.ts` | 2 | `foldVenue` and `scopeGrantsFrom` exported; `agentsOf`; `GET /venues`, `GET /agents` |
| `src/daemon/home.ts` | 3 | The home: config, mirror paths and reads, outbox, drafts, session reports, state |
| `src/daemon/client.ts` | 4 | The relay over `fetch` and `WebSocket`: `RelayClient`, `RelayDown` |
| `src/daemon/sync.ts` | 5 | `Daemon`: `syncOnce`, `flushOutbox`, `heartbeat`, `connect`/`disconnect`, `run`/`stop` |
| `src/daemon/deliver.ts` | 6 | `nextPrompt`, `markRead`, `answer`, `sendDraft`, `dropDraft`, `say`, `reportPresence` over the home |
| `src/cli.ts` | 7 | `gemworks connect …`; the usage line |
| `test/relay-api.test.mjs`, `test/daemon-home.test.mjs` … `test/daemon-cli.test.mjs` | 2–7 | One suite per module; `test/cli.test.mjs` usage regex |
| version files | 8 | `0.2.91` → `0.2.92` |

Module dependencies: `home → ../host-fs, ../core/im/{address,chain}`; `client → (globals)`; `sync → home, client, ../core/im/chain`; `deliver → home, ../relay/{relay,access}, ../core/im/{queue,envelope,sender,embed,identity,address}`.

---

### Task 1: Branch and baseline

- [ ] **Step 1: Confirm the starting point and cut the branch**

```bash
git status --short --branch | head -3
git switch -c im/c-daemon
npm run build > /tmp/im-c-build.log 2>&1; echo "exit=$?"
node --test --test-concurrency=2 test/*.test.mjs > /tmp/im-c-baseline.log 2>&1; echo "exit=$?"; grep -E "^ℹ (pass|fail)" /tmp/im-c-baseline.log
```
Expected: `## main`, clean; `exit=0` twice; `ℹ pass 867`, `ℹ fail 0`.

---

### Task 2: What the relay adds for the daemon

**Files:**
- Modify: `src/relay/relay.ts` (export `foldVenue`, add `scopeGrantsFrom` and `agentsOf`)
- Modify: `src/relay/api.ts` (`GET /venues`, `GET /agents`)
- Modify: `test/relay-api.test.mjs` (one test added)

- [ ] **Step 1: Add the failing test**

Append to `test/relay-api.test.mjs`:

```js
test("the daemon's listings: the venues I am in across owners, and my agents", () => {
  const r = relay();
  const john = r.issuePerson("john").token;
  const zhang = r.issuePerson("zhangsan").token;
  call(r, "POST /tokens", { token: john, body: { agent: "xiaoping" } });
  call(r, "POST /tokens", { token: john, body: { agent: "xiaoguan" } });
  call(r, "POST /venues", { token: john, body: { id: "g-7", kind: "group", name: "前端周会", people: ["zhangsan"] } });
  call(r, "POST /venues", { token: zhang, body: { id: "t-1", kind: "thread", name: "回复：看看这个", people: ["john"] } });
  call(r, "POST /venues", { token: zhang, body: { id: "g-9", kind: "group", name: "没我" } });
  assert.deepEqual(call(r, "GET /venues", { token: john }).json, [{ owner: "john", id: "g-7", kind: "group", name: "前端周会" }, { owner: "zhangsan", id: "t-1", kind: "thread", name: "回复：看看这个" }]);
  assert.deepEqual(call(r, "GET /agents", { token: john }).json, ["xiaoguan", "xiaoping"]);
  assert.deepEqual(call(r, "GET /agents", { token: zhang }).json, []);
  assert.equal(call(r, "GET /venues", { token: call(r, "POST /tokens", { token: john, body: { agent: "x" } }).json.token }).status, 403);
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
node --test test/relay-api.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
```
Expected: `ℹ pass 3`, `ℹ fail 1`.

- [ ] **Step 3: Change `src/relay/relay.ts`**

Make `foldVenue` an export (`export function foldVenue(`), and add after `shownName`:

```ts
/** The grants that widen a tool scope (core/im/sender.ts `scopeFor`) among a person's page's blocks. */
export function scopeGrantsFrom(blocks: readonly DataBlock[]): Grant[] {
  const out: Grant[] = [];
  for (const b of blocks) {
    if (!/^grant-\d+$/.test(b.id)) continue;
    const person = str(obj(b.value["to"])?.["person"]), widen = obj(b.value["widen"]);
    if (person === undefined || widen === undefined) continue;
    const g: Grant = { to: { person }, widen: widen as Grant["widen"], at: str(b.value["at"]) ?? "" };
    const until = str(b.value["until"]); if (until !== undefined) g.until = until;
    out.push(g);
  }
  return out;
}
```

Replace the body of `scopeGrantsOf` with `return scopeGrantsFrom(this.grantBlocks(owner));`, and add after `venuesOf`:

```ts
  /** The person's agents by name, from their pages. */
  agentsOf(person: string): string[] {
    return listDocs(this.root, person, "agents").map((d) => d.slice("agents/".length, -".geml".length));
  }
```

- [ ] **Step 4: Change `src/relay/api.ts`**

In the `venues` branch, before `if (parts.length === 4 …`, replace the `parts.length === 1` line with:

```ts
    if (parts.length === 1) {
      if (m === "POST") return answer(relay.createVenue(by, r.body), 201);
      if (m !== "GET") return fail(405, "GET 或 POST");
      if (scopeOf(by) !== "person") return fail(403, "只有本人能列场所");
      return json(200, relay.venuesOf(by.speaker.slice("person:".length)).map((vd) => ({ owner: parseAddress(vd.venue.address)?.owner ?? "", id: vd.venue.id, kind: vd.venue.kind, name: vd.venue.name })));
    }
```

and add before the `queues` branch:

```ts
  if (a === "agents" && parts.length === 1) {
    if (m !== "GET") return fail(405, "只有 GET");
    if (scopeOf(by) !== "person") return fail(403, "只有本人能列自己的 agent");
    return json(200, relay.agentsOf(by.speaker.slice("person:".length)));
  }
```

with `import { parseAddress } from "../core/im/address.js";` at the top.

- [ ] **Step 5: Build, run, commit**

```bash
npm run build > /tmp/im-c-build.log 2>&1; echo "exit=$?"; node --test test/relay-api.test.mjs test/relay-core.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
git add src/relay/relay.ts src/relay/api.ts test/relay-api.test.mjs
git -c user.name="Jieying, Xiong" -c user.email="xiongjy2104@gmail.com" commit -m "IM relay: list a person's venues and agents; export the folds for the daemon"
```
Expected: `exit=0`, `ℹ pass 12`, `ℹ fail 0`.

---

### Task 3: The home

**Files:**
- Create: `src/daemon/home.ts`
- Test: `test/daemon-home.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// test/daemon-home.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { appendMirror, enqueueOutbox, failOutbox, homeDir, listDrafts, listOutbox, listSessions, mirrorPath, newBlockId, readConfig, readDraft, readInbox, readMirror, readState, removeDraft, removeOutbox, removeSession, reportSession, updateOutbox, writeConfig, writeDraft, writeInbox, writeMirror, writeState } from "../dist/daemon/home.js";
import { readDataBlocks, renderDataBlock } from "../dist/core/im/chain.js";

const home = () => mkdtempSync(join(tmpdir(), "gemworks-im-"));
const CONFIG = { relay: { url: "http://127.0.0.1:7700", name: "relay.test" }, person: "john", token: "gwx_p", agents: { xiaoping: "gwx_a" } };

test("the home directory: the override, the environment, the default", () => {
  assert.equal(homeDir("/x/y"), "/x/y");
  assert.equal(homeDir(undefined, { GEMWORKS_IM_HOME: "/from/env" }), "/from/env");
  assert.equal(homeDir(undefined, {}), join(homedir(), ".gemworks", "im"));
  assert.equal(homeDir(undefined, { GEMWORKS_IM_HOME: "" }), join(homedir(), ".gemworks", "im"), "an empty variable is no override");
});

test("the config is written and read back; a missing or malformed one is nothing", () => {
  const h = home();
  assert.equal(readConfig(h), undefined);
  writeConfig(h, CONFIG);
  assert.deepEqual(readConfig(h), CONFIG);
  assert.match(readFileSync(join(h, "connect.json"), "utf8"), /^\{\n  "relay"/, "pretty, for a person to read");
  writeFileSync(join(h, "connect.json"), "{not json");
  assert.equal(readConfig(h), undefined);
  writeFileSync(join(h, "connect.json"), JSON.stringify({ relay: { url: "x" } }));
  assert.equal(readConfig(h), undefined, "the person and the token are required");
  writeFileSync(join(h, "connect.json"), JSON.stringify({ relay: { url: "x", name: "n" }, person: "john", token: "t" }));
  assert.deepEqual(readConfig(h), { relay: { url: "x", name: "n" }, person: "john", token: "t", agents: {} }, "agents default to none");
});

test("mirrors: written whole, appended by block once, read as blocks; the path follows the address", () => {
  const h = home();
  assert.equal(mirrorPath(h, "relay.test:8443", "john", "venues/g-7.geml"), join(h, "relay.test_8443", "john", "venues", "g-7.geml"));
  assert.deepEqual(readMirror(h, "relay.test", "john", "venues/g-7.geml"), { blocks: [], text: "", exists: false });
  assert.equal(appendMirror(h, "relay.test", "john", "venues/g-7.geml", { id: "m-1", value: { id: "m-1", text: "hi" } }), "missing", "a document never mirrored must be fetched whole");
  writeMirror(h, "relay.test", "john", "venues/g-7.geml", renderDataBlock("venue", { id: "venue", kind: "group" }));
  assert.equal(appendMirror(h, "relay.test", "john", "venues/g-7.geml", { id: "m-1", value: { id: "m-1", text: "hi" } }), "appended");
  assert.equal(appendMirror(h, "relay.test", "john", "venues/g-7.geml", { id: "m-1", value: { id: "m-1", text: "again" } }), "present");
  assert.equal(appendMirror(h, "relay.test", "john", "venues/g-7.geml", { id: "turn-3", stub: { from: "john", note: "你看不到", action: "申请看" } }), "appended", "a stub is a stub block");
  const m = readMirror(h, "relay.test", "john", "venues/g-7.geml");
  assert.deepEqual(m.blocks.map((b) => [b.id, b.value.text ?? b.value.stub]), [["venue", undefined], ["m-1", "hi"], ["turn-3", true]]);
  assert.deepEqual(readDataBlocks(m.text).diagnostics, []);
  writeMirror(h, "relay.test", "john", "venues/g-7.geml", "");
  assert.deepEqual(readMirror(h, "relay.test", "john", "venues/g-7.geml"), { blocks: [], text: "", exists: true });
  assert.deepEqual(readInbox(h, "relay.test", "john"), []);
  writeInbox(h, "relay.test", "john", [{ kind: "decide", key: "k", text: "t", actions: ["a"], since: "s", level: 0 }]);
  assert.equal(readInbox(h, "relay.test", "john")[0].text, "t");
});

test("the outbox: entries in time order, tried, removed, or failed with the reason", () => {
  const h = home();
  assert.deepEqual(listOutbox(h), []);
  const a = enqueueOutbox(h, { kind: "message", as: "person", owner: "john", doc: "venues/g-7.geml", body: { id: "m-x", text: "hi" }, at: "2026-10-31T09:00:00Z" });
  const b = enqueueOutbox(h, { kind: "marker", as: "agent:xiaoping", owner: "john", doc: "queues/xiaoping.geml", body: { kind: "read", item: "qi-1" }, at: "2026-10-31T09:00:01Z" });
  assert.match(a.id, /^o-\d{13}-\d{6}-[0-9a-f]{8}$/);
  assert.ok(a.id < b.id);
  assert.deepEqual(listOutbox(h).map((e) => [e.id, e.kind, e.tries]), [[a.id, "message", 0], [b.id, "marker", 0]]);
  updateOutbox(h, { ...a, tries: 1 });
  assert.equal(listOutbox(h)[0].tries, 1);
  removeOutbox(h, a.id);
  failOutbox(h, b.id, "令牌无效");
  assert.deepEqual(listOutbox(h), []);
  assert.equal(JSON.parse(readFileSync(join(h, "outbox", "failed", `${b.id}.json`), "utf8")).error, "令牌无效");
  removeOutbox(h, "o-nothing");
  assert.match(newBlockId("2026-10-31T09:00:00Z"), /^m-1793\d{9}-[0-9a-f]{8}$/, "a message's id from its time and a random part");
});

test("drafts, session reports and the state", () => {
  const h = home();
  writeDraft(h, { id: "d-1", agent: "xiaoping", item: "qi-1", owner: "john", doc: "venues/g-7.geml", body: { id: "m-r", text: "回答" }, at: "2026-10-31T09:00:00Z", venueName: "前端周会", reply: "https://relay.test/john/venues/g-7.geml#m-r" });
  assert.deepEqual(listDrafts(h).map((d) => d.id), ["d-1"]);
  assert.equal(readDraft(h, "d-1").body.text, "回答");
  assert.equal(readDraft(h, "d-9"), undefined);
  removeDraft(h, "d-1");
  assert.deepEqual(listDrafts(h), []);
  reportSession(h, "xiaoping", "cc-1", { host: "claude-code", login: "subscription", presence: "idle", at: "2026-10-31T09:00:00Z" });
  reportSession(h, "xiaoping", "cc-2", { host: "claude-code", login: "api", presence: "tool", task: "#42", at: "2026-10-31T09:00:01Z" });
  assert.deepEqual(listSessions(h).map((s) => [s.agent, s.session, s.report.presence]), [["xiaoping", "cc-1", "idle"], ["xiaoping", "cc-2", "tool"]]);
  removeSession(h, "xiaoping", "cc-1");
  assert.equal(listSessions(h).length, 1);
  assert.equal(readState(h), undefined);
  writeState(h, { connected: false, at: "2026-10-31T09:00:00Z", error: "连不上" });
  assert.deepEqual(readState(h), { connected: false, at: "2026-10-31T09:00:00Z", error: "连不上" });
  assert.ok(existsSync(join(h, "state.json")));
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
node --test test/daemon-home.test.mjs 2>&1 | tail -3
```
Expected: `Cannot find module … dist/daemon/home.js`.

- [ ] **Step 3: Write `src/daemon/home.ts`**

```ts
// The daemon's home (transport §2.3, §3): `~/.gemworks/im/` holds the
// config with the tokens, a mirror of every followed document under
// `<relay>/<owner>/<doc>`, the outbox of writes not yet pushed, the drafts
// an owner has not sent, the hosts' session reports, and whether the relay
// was reached. Every host reads and writes only these files; the daemon is
// the one process that talks to the relay. Writes are atomic (a reader sees
// the old file or the new); an outbox entry is its own file, so nothing is
// locked.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { mirrorRelPath } from "../core/im/address.js";
import { readDataBlocks, renderDataBlock, type DataBlock } from "../core/im/chain.js";
import type { Stub } from "../core/im/embed.js";
import type { Need } from "../core/im/needs-me.js";
import type { Presence } from "../core/im/presence.js";
import type { JsonValue } from "../core/schema.js";
import { appendText, writeAtomic, writeNew } from "../host-fs.js";

export interface Config { relay: { url: string; name: string }; person: string; token: string; agents: Record<string, string> }
export const CONFIG = "connect.json";

/** The home: the override, else `GEMWORKS_IM_HOME`, else `~/.gemworks/im`. */
export function homeDir(override?: string, env: Record<string, string | undefined> = {}): string {
  if (override !== undefined && override !== "") return override;
  const fromEnv = env["GEMWORKS_IM_HOME"];
  return fromEnv !== undefined && fromEnv !== "" ? fromEnv : join(homedir(), ".gemworks", "im");
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const obj = (v: unknown): Record<string, unknown> | undefined => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);

function readJson(path: string): unknown {
  if (!existsSync(path)) return undefined;
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return undefined; }
}

export function readConfig(home: string): Config | undefined {
  const c = obj(readJson(join(home, CONFIG)));
  const relay = c === undefined ? undefined : obj(c["relay"]);
  const url = relay === undefined ? undefined : str(relay["url"]), name = relay === undefined ? undefined : str(relay["name"]);
  const person = c === undefined ? undefined : str(c["person"]), token = c === undefined ? undefined : str(c["token"]);
  if (c === undefined || url === undefined || name === undefined || person === undefined || token === undefined) return undefined;
  const agents: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj(c["agents"]) ?? {})) if (typeof v === "string") agents[k] = v;
  return { relay: { url, name }, person, token, agents };
}

export function writeConfig(home: string, c: Config): void {
  writeAtomic(join(home, CONFIG), `${JSON.stringify(c, null, 2)}\n`);
}

// --- mirrors ---

export const mirrorPath = (home: string, relayName: string, owner: string, doc: string): string => join(home, ...mirrorRelPath({ relay: relayName, owner, doc }).split("/"));

export interface Mirror { blocks: DataBlock[]; text: string; exists: boolean }

export function readMirror(home: string, relayName: string, owner: string, doc: string): Mirror {
  const path = mirrorPath(home, relayName, owner, doc);
  if (!existsSync(path)) return { blocks: [], text: "", exists: false };
  const text = readFileSync(path, "utf8");
  return { blocks: readDataBlocks(text).blocks, text, exists: true };
}

export function writeMirror(home: string, relayName: string, owner: string, doc: string, text: string): void {
  writeAtomic(mirrorPath(home, relayName, owner, doc), text);
}

/** A block as the relay pushes or renders it: its value, or a stub in its place. */
export interface Pushed { id: string; value?: Record<string, JsonValue>; stub?: Stub }

/** A pushed block appended to its mirror: `present` when it is there already, `missing` when the document was never mirrored (fetch it whole). */
export function appendMirror(home: string, relayName: string, owner: string, doc: string, block: Pushed): "appended" | "present" | "missing" {
  const m = readMirror(home, relayName, owner, doc);
  if (!m.exists) return "missing";
  if (m.blocks.some((b) => b.id === block.id)) return "present";
  const value = block.value !== undefined ? block.value : ({ stub: true, ...block.stub } as unknown as JsonValue);
  appendText(mirrorPath(home, relayName, owner, doc), renderDataBlock(block.id, value));
  return "appended";
}

const inboxPath = (home: string, relayName: string, me: string): string => join(home, relayName.replace(/:/g, "_"), me, "inbox.json");

export function readInbox(home: string, relayName: string, me: string): Need[] {
  const v = readJson(inboxPath(home, relayName, me));
  return Array.isArray(v) ? (v as Need[]) : [];
}

export function writeInbox(home: string, relayName: string, me: string, needs: readonly Need[]): void {
  writeAtomic(inboxPath(home, relayName, me), `${JSON.stringify(needs)}\n`);
}

// --- the outbox ---

export interface OutboxEntry {
  id: string;
  kind: "message" | "marker";
  /** Whose token signs it: `person`, or `agent:<name>`. */
  as: string;
  owner: string;
  doc: string;
  body: Record<string, JsonValue>;
  at: string;
  tries: number;
  error?: string;
}

const rand = (): string => randomBytes(4).toString("hex");
const stampOf = (at: string): string => String(Date.parse(at)).padStart(13, "0");
/** Entries made in one process in the same millisecond keep their order. */
let seq = 0;
const nextSeq = (): string => String(++seq).padStart(6, "0");

/** A message's block id, chosen before the push so a resend repeats it (transport §2.5). */
export const newBlockId = (at: string): string => `m-${stampOf(at)}-${rand()}`;

const outboxDir = (home: string): string => join(home, "outbox");

export function enqueueOutbox(home: string, e: Omit<OutboxEntry, "id" | "tries">): OutboxEntry {
  const entry: OutboxEntry = { ...e, id: `o-${stampOf(e.at)}-${nextSeq()}-${rand()}`, tries: 0 };
  writeNew(join(outboxDir(home), `${entry.id}.json`), `${JSON.stringify(entry)}\n`);
  return entry;
}

export function listOutbox(home: string): OutboxEntry[] {
  const dir = outboxDir(home);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => n.startsWith("o-") && n.endsWith(".json")).sort().map((n) => readJson(join(dir, n))).filter((e): e is OutboxEntry => obj(e) !== undefined);
}

export function updateOutbox(home: string, e: OutboxEntry): void {
  writeAtomic(join(outboxDir(home), `${e.id}.json`), `${JSON.stringify(e)}\n`);
}

export function removeOutbox(home: string, id: string): void {
  try { unlinkSync(join(outboxDir(home), `${id}.json`)); } catch { /* already gone */ }
}

/** An entry the relay refused: kept under `failed/` with the reason, never pushed again. */
export function failOutbox(home: string, id: string, error: string): void {
  const from = join(outboxDir(home), `${id}.json`);
  const e = readJson(from) as OutboxEntry | undefined;
  if (e === undefined) return;
  mkdirSync(join(outboxDir(home), "failed"), { recursive: true });
  writeAtomic(join(outboxDir(home), "failed", `${id}.json`), `${JSON.stringify({ ...e, error })}\n`);
  removeOutbox(home, id);
}

// --- drafts ---

/** An answer the owner sees before it goes (§6.5 回群前先给我看): what the outbox entry will be, and the address the answered marker will name. */
export interface Draft { id: string; agent: string; item: string; owner: string; doc: string; body: Record<string, JsonValue>; at: string; venueName: string; reply: string }

const draftsDir = (home: string): string => join(home, "drafts");

export function writeDraft(home: string, d: Draft): void { writeAtomic(join(draftsDir(home), `${d.id}.json`), `${JSON.stringify(d)}\n`); }
export function readDraft(home: string, id: string): Draft | undefined { const d = readJson(join(draftsDir(home), `${id}.json`)); return obj(d) === undefined ? undefined : (d as Draft); }
export function listDrafts(home: string): Draft[] {
  const dir = draftsDir(home);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => n.endsWith(".json")).sort().map((n) => readJson(join(dir, n))).filter((d): d is Draft => obj(d) !== undefined);
}
export function removeDraft(home: string, id: string): void { try { unlinkSync(join(draftsDir(home), `${id}.json`)); } catch { /* gone */ } }

// --- session reports ---

export interface SessionReport { host: string; login: string; presence: Presence; task?: string; at: string }

const sessionsDir = (home: string): string => join(home, "sessions");

export function reportSession(home: string, agent: string, session: string, r: SessionReport): void {
  writeAtomic(join(sessionsDir(home), agent, `${session}.json`), `${JSON.stringify(r)}\n`);
}

export function listSessions(home: string): { agent: string; session: string; report: SessionReport }[] {
  const dir = sessionsDir(home);
  if (!existsSync(dir)) return [];
  const out: { agent: string; session: string; report: SessionReport }[] = [];
  for (const agent of readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()) {
    for (const n of readdirSync(join(dir, agent)).filter((f) => f.endsWith(".json")).sort()) {
      const report = readJson(join(dir, agent, n));
      if (obj(report) !== undefined) out.push({ agent, session: n.slice(0, -".json".length), report: report as SessionReport });
    }
  }
  return out;
}

export function removeSession(home: string, agent: string, session: string): void {
  try { unlinkSync(join(sessionsDir(home), agent, `${session}.json`)); } catch { /* gone */ }
}

// --- the state ---

/** Whether the relay was reached the last time the daemon tried, and when; the band's 断了 reads it. */
export interface State { connected: boolean; at: string; error?: string }

export function readState(home: string): State | undefined {
  const s = obj(readJson(join(home, "state.json")));
  return s !== undefined && typeof s["connected"] === "boolean" && typeof s["at"] === "string" ? (s as unknown as State) : undefined;
}

export function writeState(home: string, s: State): void {
  mkdirSync(dirname(join(home, "state.json")), { recursive: true });
  writeAtomic(join(home, "state.json"), `${JSON.stringify(s)}\n`);
}

/** Moves a file aside (a draft sent, a report retired); nothing when it is not there. */
export function moveFile(from: string, to: string): boolean {
  if (!existsSync(from)) return false;
  mkdirSync(dirname(to), { recursive: true });
  renameSync(from, to);
  return true;
}
```

- [ ] **Step 4: Build and run the test**

```bash
npm run build > /tmp/im-c-build.log 2>&1; echo "exit=$?"; node --test test/daemon-home.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
```
Expected: `exit=0`, `ℹ pass 5`, `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/daemon/home.ts test/daemon-home.test.mjs
git -c user.name="Jieying, Xiong" -c user.email="xiongjy2104@gmail.com" commit -m "IM daemon: the home directory, mirrors, outbox, drafts, session reports"
```

---

### Task 4: The relay client

**Files:**
- Create: `src/daemon/client.ts`
- Test: `test/daemon-client.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// test/daemon-client.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RelayClient, RelayDown, reasonOf } from "../dist/daemon/client.js";
import { startRelay } from "../dist/relay/server.js";

const root = () => mkdtempSync(join(tmpdir(), "gemworks-relay-"));

test("the client against a relay: the root, me, listings, a document as text, an append, a refusal with its reason", async () => {
  const s = await startRelay({ root: root(), name: "relay.test", version: "0.0.0" });
  try {
    const john = s.relay.issuePerson("john");
    const xiaoping = s.relay.issueAgent(john.record, "xiaoping");
    s.relay.createVenue(john.record, { id: "g-7", kind: "group", name: "前端周会", agents: ["agent:xiaoping@john"] });
    const anon = new RelayClient(s.url);
    assert.deepEqual(await anon.root(), { name: "relay.test", version: "0.0.0", federation: "closed" });
    const c = new RelayClient(s.url, john.token);
    assert.deepEqual(await c.me(), { speaker: "person:john", scope: "person", id: john.record.id });
    assert.deepEqual(await c.venues(), [{ owner: "john", id: "g-7", kind: "group", name: "前端周会" }]);
    assert.deepEqual(await c.agents(), ["xiaoping"]);
    assert.deepEqual(await c.inbox(), []);
    const appended = await c.append("john", "venues/g-7.geml", { id: "m-1", text: "@xiaoping 看" });
    assert.equal(appended.status, 201);
    assert.equal(appended.body.message.speaker, "person:john");
    const text = await c.readGeml("john", "venues/g-7.geml");
    assert.match(text, /^=== data \{#venue format=json\}\n[\s\S]*#m-1 format=json/);
    assert.equal(await c.readGeml("john", "venues/none.geml"), undefined);
    const a = new RelayClient(s.url, xiaoping.token);
    assert.equal((await a.presence({ session: "cc-1", presence: "idle" })).status, 200);
    const refused = await c.append("john", "venues/g-7.geml", { id: "sys-1", text: "x" });
    assert.equal(refused.status, 400);
    assert.equal(reasonOf(refused), "消息 id 不合法");
    assert.equal(reasonOf({ status: 502, body: "<html>" }), "HTTP 502");
    await assert.rejects(anon.me(), /HTTP 401|要令牌/);
    await assert.rejects(new RelayClient(s.url, "gwx_bad").venues(), /令牌无效/);
  } finally {
    await s.close();
  }
});

test("a relay that cannot be reached is RelayDown, from every call", async () => {
  const s = await startRelay({ root: root(), name: "relay.test" });
  const url = s.url;
  await s.close();
  const c = new RelayClient(url, "gwx_x");
  await assert.rejects(c.root(), RelayDown);
  await assert.rejects(c.append("john", "venues/g-7.geml", {}), (e) => e instanceof RelayDown && /连不上中继/.test(e.message));
  const stub = new RelayClient("http://relay", "t", async () => { throw new TypeError("fetch failed"); });
  await assert.rejects(stub.inbox(), RelayDown);
});

test("a subscription: the documents named on open, blocks as they land, the close reported", async () => {
  const s = await startRelay({ root: root(), name: "relay.test" });
  try {
    const john = s.relay.issuePerson("john");
    s.relay.createVenue(john.record, { id: "g-7", kind: "group", name: "群" });
    const c = new RelayClient(s.url, john.token);
    const got = [];
    let closed = null;
    const ws = c.subscribe(["john/venues/g-7.geml", "john/venues/none.geml"], { onBlock: (doc, block) => got.push([doc, block.id]), onClose: (why) => { closed = why; } });
    await new Promise((done) => { const tick = () => (ws.readyState === 1 ? done() : setTimeout(tick, 10)); tick(); });
    await new Promise((done) => setTimeout(done, 30));
    s.relay.appendMessage(john.record, "john", "g-7", { id: "m-1", text: "hi" });
    await new Promise((done) => { const tick = () => (got.length >= 1 ? done() : setTimeout(tick, 10)); tick(); });
    assert.deepEqual(got, [["john/venues/g-7.geml", "m-1"]]);
    ws.close();
    await new Promise((done) => { const tick = () => (closed !== null ? done() : setTimeout(tick, 10)); tick(); });
    assert.match(closed, /^closed/);
  } finally {
    await s.close();
  }
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
node --test test/daemon-client.test.mjs 2>&1 | tail -3
```
Expected: `Cannot find module … dist/daemon/client.js`.

- [ ] **Step 3: Write `src/daemon/client.ts`**

```ts
// The relay as the daemon reaches it (transport §2.5): the three channels
// over the global `fetch` and `WebSocket`, with one token. A network failure
// is `RelayDown`, whatever the call; an answer is its status and its body,
// parsed when it is JSON. The typed calls throw on a status they cannot use,
// with the relay's own reason.
import type { Visible } from "../relay/relay.js";

export class RelayDown extends Error {
  constructor(message: string) { super(message); this.name = "RelayDown"; }
}

export interface Answer { status: number; body: unknown }

/** The relay's reason for an answer, or its status when it gave none. */
export function reasonOf(a: Answer): string {
  const b = a.body as { error?: unknown } | null;
  return typeof b === "object" && b !== null && typeof b.error === "string" ? b.error : `HTTP ${a.status}`;
}

export interface VenueRow { owner: string; id: string; kind: string; name: string }

export class RelayClient {
  constructor(readonly url: string, readonly token?: string, private readonly fetchImpl: typeof fetch = fetch) {}

  async call(method: string, path: string, body?: unknown, accept?: string): Promise<Answer> {
    const headers: Record<string, string> = {};
    if (this.token !== undefined) headers["authorization"] = `Bearer ${this.token}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    if (accept !== undefined) headers["accept"] = accept;
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.url}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    } catch (e) {
      throw new RelayDown(`连不上中继 ${this.url}：${e instanceof Error ? e.message : String(e)}`);
    }
    const text = await res.text();
    let parsed: unknown = text;
    if ((res.headers.get("content-type") ?? "").startsWith("application/json")) { try { parsed = JSON.parse(text); } catch { parsed = text; } }
    return { status: res.status, body: parsed };
  }

  get(path: string, accept?: string): Promise<Answer> { return this.call("GET", path, undefined, accept); }
  post(path: string, body: unknown): Promise<Answer> { return this.call("POST", path, body); }

  /** A call that must answer 200 with JSON; anything else is an error carrying the relay's reason. */
  private async expect<T>(a: Promise<Answer>): Promise<T> {
    const r = await a;
    if (r.status !== 200) throw new Error(reasonOf(r));
    return r.body as T;
  }

  root(): Promise<{ name: string; version: string; federation: string }> { return this.expect(this.get("/")); }
  me(): Promise<{ speaker: string; scope: string; id: string }> { return this.expect(this.get("/me")); }
  venues(): Promise<VenueRow[]> { return this.expect(this.get("/venues")); }
  agents(): Promise<string[]> { return this.expect(this.get("/agents")); }
  inbox(): Promise<unknown[]> { return this.expect(this.get("/inbox")); }

  /** The document as the relay renders it for this token, or undefined when there is none. */
  async readGeml(owner: string, doc: string): Promise<string | undefined> {
    const r = await this.get(`/${encodeURIComponent(owner)}/${doc.split("/").map(encodeURIComponent).join("/")}?format=geml`, "text/plain");
    if (r.status === 404) return undefined;
    if (r.status !== 200) throw new Error(reasonOf(r));
    return String(r.body);
  }

  append(owner: string, doc: string, body: unknown): Promise<Answer> { return this.post(`/${encodeURIComponent(owner)}/${doc.split("/").map(encodeURIComponent).join("/")}`, body); }
  presence(body: unknown): Promise<Answer> { return this.post("/presence", body); }

  /** Follow documents (`<owner>/<doc>`): their blocks as they land, and the close with why. The caller closes the socket. */
  subscribe(docs: readonly string[], o: { onBlock: (doc: string, block: Visible) => void; onOpen?: () => void; onClose?: (why: string) => void }): WebSocket {
    const ws = new WebSocket(`${this.url.replace(/^http/, "ws")}/subscribe?token=${encodeURIComponent(this.token ?? "")}`);
    let told = false;
    const closed = (why: string): void => { if (told) return; told = true; o.onClose?.(why); };
    ws.addEventListener("open", () => { for (const d of docs) ws.send(JSON.stringify({ subscribe: d })); o.onOpen?.(); });
    ws.addEventListener("message", (e) => {
      let m: unknown;
      try { m = JSON.parse(String(e.data)); } catch { return; }
      const r = m as { doc?: unknown; block?: unknown } | null;
      if (r !== null && typeof r === "object" && typeof r.doc === "string" && typeof r.block === "object" && r.block !== null) o.onBlock(r.doc, r.block as Visible);
    });
    ws.addEventListener("close", (e) => closed(`closed ${e.code}`));
    ws.addEventListener("error", () => closed("error"));
    return ws;
  }
}
```

- [ ] **Step 4: Build and run the test**

```bash
npm run build > /tmp/im-c-build.log 2>&1; echo "exit=$?"; node --test test/daemon-client.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
```
Expected: `exit=0`, `ℹ pass 3`, `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/daemon/client.ts test/daemon-client.test.mjs
git -c user.name="Jieying, Xiong" -c user.email="xiongjy2104@gmail.com" commit -m "IM daemon: the relay over fetch and WebSocket"
```

---

### Task 5: The daemon

**Files:**
- Create: `src/daemon/sync.ts`
- Test: `test/daemon-sync.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// test/daemon-sync.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Daemon } from "../dist/daemon/sync.js";
import { enqueueOutbox, listOutbox, readInbox, readMirror, readState, reportSession, writeConfig } from "../dist/daemon/home.js";
import { startRelay } from "../dist/relay/server.js";

const tmp = (p) => mkdtempSync(join(tmpdir(), p));
/** A relay with John, 张三, John's agent 小评, a group of all three; a home set up for John. */
async function world(o = {}) {
  const s = await startRelay({ root: tmp("gemworks-relay-"), name: "relay.test" });
  const john = s.relay.issuePerson("john");
  const zhang = s.relay.issuePerson("zhangsan");
  const xiaoping = s.relay.issueAgent(john.record, "xiaoping");
  s.relay.createVenue(john.record, { id: "g-7", kind: "group", name: "前端周会", people: ["zhangsan"], agents: ["agent:xiaoping@john"] });
  const home = tmp("gemworks-im-");
  writeConfig(home, { relay: { url: s.url, name: "relay.test" }, person: "john", token: john.token, agents: { xiaoping: xiaoping.token } });
  const daemon = new Daemon({ home, ...o });
  return { s, john, zhang, xiaoping, home, daemon };
}
const until = (fn, ms = 3000) => new Promise((done, failed) => { const t0 = Date.now(); const tick = () => (fn() ? done() : Date.now() - t0 > ms ? failed(new Error("not in time")) : setTimeout(tick, 10)); tick(); });

test("syncOnce mirrors my page, the venues I am in across owners, my agents' queues and the inbox, and records the state", async () => {
  const { s, john, zhang, home, daemon } = await world();
  try {
    s.relay.createVenue(zhang.record, { id: "t-1", kind: "thread", name: "回复：看看", people: ["john"] });
    s.relay.appendMessage(zhang.record, "john", "g-7", { id: "m-1", text: "@xiaoping 跑一下" });
    s.relay.appendMessage(zhang.record, "john", "g-7", { id: "m-2", kind: "chat", text: "顺便" });
    const r = await daemon.syncOnce();
    assert.deepEqual(r, { connected: true, docs: 4, pushed: 0, failed: 0, left: 0, heartbeats: 0 });
    const venue = readMirror(home, "relay.test", "john", "venues/g-7.geml");
    assert.deepEqual(venue.blocks.map((b) => b.id), ["venue", "m-1", "m-2"]);
    assert.equal(venue.text, s.relay.renderVisible(s.relay.read("john", "venues/g-7.geml", "person:john").blocks), "the relay's text, whole");
    assert.deepEqual(readMirror(home, "relay.test", "zhangsan", "venues/t-1.geml").blocks.map((b) => b.id), ["venue"]);
    assert.deepEqual(readMirror(home, "relay.test", "john", "queues/xiaoping.geml").blocks.map((b) => b.id), ["qi-g-7-m-1"]);
    assert.deepEqual(readMirror(home, "relay.test", "john", "people/john.geml").blocks.map((b) => b.id), ["person"]);
    assert.deepEqual(readInbox(home, "relay.test", "john"), []);
    assert.deepEqual(readState(home), { connected: true, at: readState(home).at });
    s.relay.appendMessage(john.record, "john", "g-7", { id: "m-3", text: "再来" });
    assert.equal((await daemon.syncOnce()).docs, 4);
    assert.deepEqual(readMirror(home, "relay.test", "john", "venues/g-7.geml").blocks.map((b) => b.id), ["venue", "m-1", "m-2", "m-3"], "rewritten whole");
  } finally {
    await s.close();
  }
});

test("the outbox is pushed oldest first with the right token; a refusal goes to failed/ with the reason; a missing token fails the entry", async () => {
  const { s, home, daemon } = await world();
  try {
    enqueueOutbox(home, { kind: "message", as: "person", owner: "john", doc: "venues/g-7.geml", body: { id: "m-a", text: "@xiaoping 看看" }, at: "2026-10-31T09:00:00Z" });
    enqueueOutbox(home, { kind: "marker", as: "agent:xiaoping", owner: "john", doc: "queues/xiaoping.geml", body: { kind: "read", item: "qi-g-7-m-a" }, at: "2026-10-31T09:00:01Z" });
    enqueueOutbox(home, { kind: "message", as: "person", owner: "john", doc: "venues/g-7.geml", body: { id: "sys-9", text: "forged" }, at: "2026-10-31T09:00:02Z" });
    enqueueOutbox(home, { kind: "message", as: "agent:nobody", owner: "john", doc: "venues/g-7.geml", body: { id: "m-b", text: "x" }, at: "2026-10-31T09:00:03Z" });
    const r = await daemon.syncOnce();
    assert.deepEqual([r.pushed, r.failed, r.left], [2, 2, 0]);
    assert.deepEqual(listOutbox(home), []);
    const failed = readFileSync(join(home, "outbox", "failed", require_name(home, "sys-9")), "utf8");
    assert.match(failed, /"error":"消息 id 不合法"/);
    assert.match(readFileSync(join(home, "outbox", "failed", require_name(home, "m-b")), "utf8"), /"error":"没有 agent:nobody 的令牌"/);
    const vd = s.relay.venueOf("john", "g-7");
    assert.deepEqual(vd.messages.map((m) => [m.id, m.speaker]), [["m-a", "person:john"]]);
    assert.deepEqual(s.relay.queueOf({ speaker: "person:john", scope: "person" }, "john", "xiaoping").queue.markers.map((m) => m.kind), ["read"]);
    assert.deepEqual(readMirror(home, "relay.test", "john", "queues/xiaoping.geml").blocks.map((b) => b.id), ["qi-g-7-m-a", "read-1"], "the outbox went first, so this round's mirror carries what it pushed");
  } finally {
    await s.close();
  }
});
/** The failed entry's file name: the one whose body names the block. */
function require_name(home, blockId) {
  const dir = join(home, "outbox", "failed");
  for (const n of existsSync(dir) ? readdirSync(dir) : []) if (readFileSync(join(dir, n), "utf8").includes(`"id":"${blockId}"`)) return n;
  throw new Error(`no failed entry for ${blockId}`);
}

test("the heartbeat posts every session the hosts reported; one that said asleep is retired after", async () => {
  const { s, home, daemon } = await world();
  try {
    reportSession(home, "xiaoping", "cc-1", { host: "claude-code", login: "subscription", presence: "tool", task: "#42", at: "2026-10-31T09:00:00Z" });
    reportSession(home, "xiaoping", "cc-2", { host: "claude-code", login: "api", presence: "asleep", at: "2026-10-31T09:00:00Z" });
    reportSession(home, "ghost", "cc-3", { host: "pi", login: "api", presence: "idle", at: "2026-10-31T09:00:00Z" });
    assert.equal(await daemon.heartbeat(), 2);
    const p = s.relay.presenceOf("agent:xiaoping@john");
    assert.deepEqual([p.presence, p.sessions.map((x) => [x.session, x.presence, x.task])], ["tool", [["cc-1", "tool", "#42"], ["cc-2", "asleep", undefined]]]);
    assert.equal(await daemon.heartbeat(), 1, "cc-2 retired, ghost has no token");
  } finally {
    await s.close();
  }
});

test("a relay that cannot be reached: syncOnce says so, the state says so, the outbox waits, nothing throws", async () => {
  const { s, home, daemon } = await world();
  await s.close();
  enqueueOutbox(home, { kind: "message", as: "person", owner: "john", doc: "venues/g-7.geml", body: { id: "m-a", text: "x" }, at: "2026-10-31T09:00:00Z" });
  const r = await daemon.syncOnce();
  assert.equal(r.connected, false);
  assert.match(r.error, /连不上中继/);
  assert.equal(r.left, 1);
  assert.equal(readState(home).connected, false);
  assert.equal(listOutbox(home).length, 1);
  const none = new Daemon({ home: tmp("gemworks-im-") });
  assert.match((await none.syncOnce()).error, /没有 connect.json/);
});

test("run: follows live, pushes the outbox on its interval, syncs again on its interval (a new venue appears), reconnects, stops", async () => {
  const { s, john, zhang, home, daemon } = await world({ intervals: { heartbeatMs: 50, outboxMs: 50, syncMs: 150 }, backoffMs: [50] });
  try {
    const running = daemon.run();
    await until(() => daemon.connected);
    s.relay.appendMessage(zhang.record, "john", "g-7", { id: "m-1", text: "@xiaoping 看" });
    await until(() => readMirror(home, "relay.test", "john", "venues/g-7.geml").blocks.some((b) => b.id === "m-1"));
    await until(() => readMirror(home, "relay.test", "john", "queues/xiaoping.geml").blocks.some((b) => b.id === "qi-g-7-m-1"), 3000);
    enqueueOutbox(home, { kind: "message", as: "person", owner: "john", doc: "venues/g-7.geml", body: { id: "m-2", text: "回" }, at: "2026-10-31T09:00:00Z" });
    await until(() => s.relay.venueOf("john", "g-7").messages.some((m) => m.id === "m-2"));
    await until(() => readMirror(home, "relay.test", "john", "venues/g-7.geml").blocks.some((b) => b.id === "m-2"), 3000);
    reportSession(home, "xiaoping", "cc-1", { host: "claude-code", login: "api", presence: "idle", at: "2026-10-31T09:00:00Z" });
    await until(() => s.relay.presenceOf("agent:xiaoping@john").presence === "idle");
    s.relay.createVenue(zhang.record, { id: "g-9", kind: "group", name: "新群", people: ["john"] });
    await until(() => readMirror(home, "relay.test", "zhangsan", "venues/g-9.geml").exists, 3000);
    s.relay.appendMessage(zhang.record, "zhangsan", "g-9", { id: "n-1", text: "新群里" });
    await until(() => readMirror(home, "relay.test", "zhangsan", "venues/g-9.geml").blocks.some((b) => b.id === "n-1"), 3000);
    daemon.stop();
    await running;
    assert.equal(daemon.connected, false);
  } finally {
    await s.close();
  }
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
node --test test/daemon-sync.test.mjs 2>&1 | tail -3
```
Expected: `Cannot find module … dist/daemon/sync.js`.

- [ ] **Step 3: Write `src/daemon/sync.ts`**

```ts
// The daemon (transport §3): one per person, the one process that reaches
// the relay. `syncOnce` lists what the person follows, mirrors each document
// whole, pushes the outbox, posts the heartbeat and records whether the relay
// was reached; `run` repeats it with a subscription in between, pushed blocks
// appended to their mirrors as they land, and tries again with a backoff when
// the relay is gone. Nothing here throws out of `run`: a host reads the
// state file and says 断了. Hosts never call this module; they read the
// mirror and write the outbox (deliver.ts).
import type { Need } from "../core/im/needs-me.js";
import { RelayClient, RelayDown, reasonOf } from "./client.js";
import { appendMirror, failOutbox, listOutbox, listSessions, readConfig, removeOutbox, removeSession, updateOutbox, writeInbox, writeMirror, writeState, type Config } from "./home.js";

export interface SyncReport { connected: boolean; docs: number; pushed: number; failed: number; left: number; heartbeats: number; error?: string }
export interface Intervals { heartbeatMs: number; outboxMs: number; syncMs: number }
/** The heartbeat every 30 seconds (transport §3); the outbox every 5; the listing again every minute. */
export const DEFAULT_INTERVALS: Intervals = { heartbeatMs: 30_000, outboxMs: 5_000, syncMs: 60_000 };
export const DEFAULT_BACKOFF_MS: readonly number[] = [5_000, 15_000, 30_000, 60_000];
export interface DaemonOptions { home: string; now?: () => string; fetchImpl?: typeof fetch; log?: (line: string) => void; intervals?: Partial<Intervals>; backoffMs?: readonly number[] }

function splitKey(key: string): [string, string] {
  const i = key.indexOf("/");
  return i === -1 ? [key, ""] : [key.slice(0, i), key.slice(i + 1)];
}

export class Daemon {
  readonly home: string;
  private readonly now: () => string;
  private readonly fetchImpl: typeof fetch | undefined;
  private readonly log: (line: string) => void;
  private readonly intervals: Intervals;
  private readonly backoff: readonly number[];
  private ws: WebSocket | undefined;
  private followed: string[] = [];
  private stopped = false;
  private wake: (() => void) | undefined;

  constructor(o: DaemonOptions) {
    this.home = o.home;
    this.now = o.now ?? (() => new Date().toISOString().replace(/\.\d{3}Z$/, "Z"));
    this.fetchImpl = o.fetchImpl;
    this.log = o.log ?? (() => {});
    this.intervals = { ...DEFAULT_INTERVALS, ...o.intervals };
    this.backoff = o.backoffMs ?? DEFAULT_BACKOFF_MS;
  }

  config(): Config {
    const c = readConfig(this.home);
    if (c === undefined) throw new Error("没有 connect.json：先 gemworks connect setup");
    return c;
  }

  /** The client signing as the person, or as one of their agents (`agent:<name>`). */
  client(as: string, c: Config = this.config()): RelayClient {
    const token = as === "person" ? c.token : as.startsWith("agent:") ? c.agents[as.slice("agent:".length)] : undefined;
    if (token === undefined) throw new Error(`没有 ${as} 的令牌`);
    return new RelayClient(c.relay.url, token, this.fetchImpl);
  }

  /** What the person follows (decision 3): their page, the venues they are in, their agents' queues. */
  async listFollowed(c: Config, client: RelayClient): Promise<string[]> {
    const venues = await client.venues();
    const agents = await client.agents();
    return [`${c.person}/people/${c.person}.geml`, ...venues.map((v) => `${v.owner}/venues/${v.id}.geml`), ...agents.map((a) => `${c.person}/queues/${a}.geml`)];
  }

  /** Every followed document mirrored whole, then the inbox; how many documents the relay had. The outbox is flushed first (`syncOnce`), so a round's mirrors carry what it just pushed. */
  async mirrorAll(c: Config, client: RelayClient, docs: readonly string[]): Promise<number> {
    let n = 0;
    for (const key of docs) {
      const [owner, doc] = splitKey(key);
      const text = await client.readGeml(owner, doc);
      if (text === undefined) continue;
      writeMirror(this.home, c.relay.name, owner, doc, text);
      n++;
    }
    writeInbox(this.home, c.relay.name, c.person, (await client.inbox()) as Need[]);
    return n;
  }

  /** The outbox pushed oldest first: a 2xx removes the entry, a 4xx fails it with the reason, a 5xx leaves it for next time. A relay down stops the flush where it is. */
  async flushOutbox(c: Config = this.config()): Promise<{ pushed: number; failed: number; left: number }> {
    let pushed = 0, failed = 0, left = 0;
    for (const e of listOutbox(this.home)) {
      let client: RelayClient;
      try { client = this.client(e.as, c); } catch (err) { failOutbox(this.home, e.id, err instanceof Error ? err.message : String(err)); failed++; continue; }
      const r = await client.append(e.owner, e.doc, e.body);
      if (r.status >= 200 && r.status < 300) { removeOutbox(this.home, e.id); pushed++; }
      else if (r.status >= 400 && r.status < 500) { failOutbox(this.home, e.id, reasonOf(r)); failed++; this.log(`没发出去：${e.kind} → ${e.owner}/${e.doc}：${reasonOf(r)}`); }
      else { updateOutbox(this.home, { ...e, tries: e.tries + 1, error: reasonOf(r) }); left++; }
    }
    return { pushed, failed, left };
  }

  /** Every session the hosts reported, posted with this moment's heartbeat; one that said asleep, or that the relay refused, is retired after. */
  async heartbeat(c: Config = this.config()): Promise<number> {
    let n = 0;
    for (const s of listSessions(this.home)) {
      let client: RelayClient;
      try { client = this.client(`agent:${s.agent}`, c); } catch { continue; }
      const body: Record<string, unknown> = { session: s.session, host: s.report.host, login: s.report.login, presence: s.report.presence };
      if (s.report.task !== undefined) body["task"] = s.report.task;
      const r = await client.presence(body);
      if (r.status === 200) n++;
      if (s.report.presence === "asleep" || r.status === 400 || r.status === 403) removeSession(this.home, s.agent, s.session);
    }
    return n;
  }

  async syncOnce(): Promise<SyncReport> {
    const at = this.now();
    try {
      const c = this.config();
      const client = this.client("person", c);
      const flushed = await this.flushOutbox(c);
      this.followed = await this.listFollowed(c, client);
      const docs = await this.mirrorAll(c, client, this.followed);
      const heartbeats = await this.heartbeat(c);
      writeState(this.home, { connected: true, at });
      return { connected: true, docs, ...flushed, heartbeats };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      writeState(this.home, { connected: false, at, error });
      return { connected: false, docs: 0, pushed: 0, failed: 0, left: listOutbox(this.home).length, heartbeats: 0, error };
    }
  }

  /** Follow the listed documents live: a pushed block goes onto its mirror; a document never mirrored is fetched whole. Resolves once open. */
  connect(): Promise<void> {
    const c = this.config();
    const client = this.client("person", c);
    return new Promise((done, failed) => {
      let open = false;
      this.ws = client.subscribe(this.followed, {
        onOpen: () => { open = true; done(); },
        onBlock: (key, block) => {
          const [owner, doc] = splitKey(key);
          if (appendMirror(this.home, c.relay.name, owner, doc, block) === "missing") {
            void client.readGeml(owner, doc).then((text) => { if (text !== undefined) writeMirror(this.home, c.relay.name, owner, doc, text); }).catch(() => { /* the next sync fetches it */ });
          }
        },
        onClose: (why) => {
          this.ws = undefined;
          this.log(`订阅断了：${why}`);
          if (!open) failed(new RelayDown(why));
          this.wakeUp();
        },
      });
    });
  }

  disconnect(): void {
    const ws = this.ws;
    this.ws = undefined;
    if (ws !== undefined) { try { ws.close(); } catch { /* already closed */ } }
  }

  get connected(): boolean { return this.ws !== undefined; }

  private wakeUp(): void { const w = this.wake; this.wake = undefined; w?.(); }

  private sleep(ms: number): Promise<void> {
    return new Promise((done) => {
      const t = setTimeout(() => { this.wake = undefined; done(); }, ms);
      this.wake = () => { clearTimeout(t); done(); };
    });
  }

  stop(): void { this.stopped = true; this.disconnect(); this.wakeUp(); }

  /** The daemon's life: sync, follow, keep the heartbeat and the outbox going and the listing fresh; after a failure try again with a backoff; until `stop`. */
  async run(): Promise<void> {
    let attempt = 0;
    while (!this.stopped) {
      const r = await this.syncOnce();
      if (!r.connected) {
        this.log(`断了：${r.error ?? ""}`);
        await this.sleep(this.backoff[Math.min(attempt++, this.backoff.length - 1)] ?? 60_000);
        continue;
      }
      attempt = 0;
      try { await this.connect(); } catch (e) {
        this.log(`订阅失败：${e instanceof Error ? e.message : String(e)}`);
        await this.sleep(this.backoff[0] ?? 5_000);
        continue;
      }
      await this.whileConnected();
      this.disconnect();
    }
    this.disconnect();
  }

  /** Between a subscription's open and its close: the heartbeat, the outbox and the full sync on their intervals; a changed listing ends it so the next round subscribes anew. */
  private whileConnected(): Promise<void> {
    const guard = async (fn: () => Promise<unknown>): Promise<void> => {
      try { await fn(); } catch (e) { this.log(`断了：${e instanceof Error ? e.message : String(e)}`); this.disconnect(); this.wakeUp(); }
    };
    const resync = async (): Promise<void> => {
      const before = this.followed.join("\n");
      const r = await this.syncOnce();
      if (!r.connected) throw new Error(r.error ?? "sync");
      if (this.followed.join("\n") !== before) { this.disconnect(); this.wakeUp(); }
    };
    const timers = [
      setInterval(() => void guard(() => this.heartbeat()), this.intervals.heartbeatMs),
      setInterval(() => void guard(() => this.flushOutbox()), this.intervals.outboxMs),
      setInterval(() => void guard(resync), this.intervals.syncMs),
    ];
    return new Promise((done) => {
      this.wake = () => { for (const t of timers) clearInterval(t); this.wake = undefined; done(); };
      if (this.ws === undefined || this.stopped) this.wakeUp();
    });
  }
}
```

- [ ] **Step 4: Build and run the test**

```bash
npm run build > /tmp/im-c-build.log 2>&1; echo "exit=$?"; node --test test/daemon-sync.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
```
Expected: `exit=0`, `ℹ pass 5`, `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/daemon/sync.ts test/daemon-sync.test.mjs
git -c user.name="Jieying, Xiong" -c user.email="xiongjy2104@gmail.com" commit -m "IM daemon: mirror, outbox, heartbeat, the live subscription, the run loop"
```

---

### Task 6: Delivery over the mirror

**Files:**
- Create: `src/daemon/deliver.ts`
- Test: `test/daemon-deliver.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// test/daemon-deliver.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { answer, contextText, dropDraft, markRead, nextPrompt, reportPresence, say, sendDraft } from "../dist/daemon/deliver.js";
import { Daemon } from "../dist/daemon/sync.js";
import { listDrafts, listOutbox, listSessions, readMirror, writeConfig, writeMirror } from "../dist/daemon/home.js";
import { renderDataBlock } from "../dist/core/im/chain.js";
import { startRelay } from "../dist/relay/server.js";

const tmp = (p) => mkdtempSync(join(tmpdir(), p));
const NOW = "2026-10-31T09:30:00Z";
async function world() {
  const s = await startRelay({ root: tmp("gemworks-relay-"), name: "relay.test" });
  const john = s.relay.issuePerson("john");
  const zhang = s.relay.issuePerson("zhangsan");
  const xiaoping = s.relay.issueAgent(john.record, "xiaoping");
  s.relay.createVenue(john.record, { id: "g-7", kind: "group", name: "前端周会", people: ["zhangsan"], agents: ["agent:xiaoping@john"] });
  const home = tmp("gemworks-im-");
  writeConfig(home, { relay: { url: s.url, name: "relay.test" }, person: "john", token: john.token, agents: { xiaoping: xiaoping.token } });
  const daemon = new Daemon({ home });
  return { s, john, zhang, xiaoping, home, daemon };
}
const JOHN = { speaker: "person:john", scope: "person" };

test("nextPrompt: the spec's envelope word for word, the context pack expanded from the mirror, the queue in priority order; nothing when the queue is empty", async () => {
  const { s, john, zhang, home, daemon } = await world();
  try {
    assert.equal(nextPrompt(home, "xiaoping", NOW), undefined, "nothing mirrored yet");
    s.relay.setAnnounce(john.record, "john", "g-7", "先跑测试再合");
    s.relay.appendMessage(zhang.record, "john", "g-7", { id: "m-0", text: "定了：用 pnpm" });
    s.relay.markDecision(zhang.record, "john", "g-7", "m-0");
    s.relay.appendMessage(zhang.record, "john", "g-7", { id: "m-1", text: "@xiaoping 跑一下测试", parts: [{ src: "https://relay.test/john/journals/t-42.geml#rev-3" }] });
    s.relay.appendMessage(zhang.record, "john", "g-7", { id: "m-2", text: "@xiaoping 再跑一次" });
    await daemon.syncOnce();
    const d = nextPrompt(home, "xiaoping", NOW);
    assert.equal(d.envelope, "[来自 群「前端周会」 · zhangsan（成员） · 权限：只读 · 回复将发回该群，成员可见 · 队列中还有 1 条]");
    assert.equal(d.item.id, "qi-g-7-m-1");
    assert.deepEqual([d.queued, d.draftFirst, d.scope, d.dropped], [1, false, { write: false, run: "none", budget: 20 }, []]);
    assert.equal(d.text, [
      d.envelope,
      "@xiaoping 跑一下测试",
      "",
      "（上下文）",
      "https://relay.test/john/venues/g-7.geml#announce",
      "先跑测试再合",
      "",
      "https://relay.test/john/venues/g-7.geml#m-0",
      "定了：用 pnpm",
      "",
      "https://relay.test/john/journals/t-42.geml#rev-3",
      "（没展开，用读取工具按需取）",
    ].join("\n"));
    s.relay.appendMessage(john.record, "john", "g-7", { id: "m-3", text: "@xiaoping 主人先" });
    await daemon.syncOnce();
    assert.equal(nextPrompt(home, "xiaoping", NOW).item.id, "qi-g-7-m-3", "the owner's prompt before the member's");
    assert.match(nextPrompt(home, "xiaoping", NOW).envelope, /john（主人） · 权限：工作流允许的一切 · 回复将发回该群，成员可见 · 队列中还有 2 条/);
    assert.throws(() => nextPrompt(tmp("gemworks-im-"), "xiaoping", NOW), /没有 connect.json/);
  } finally {
    await s.close();
  }
});

test("a stub in the mirror becomes a 你看不到 line; a grant widens the scope; 回群前先给我看 reaches the envelope", async () => {
  const { s, john, zhang, home, daemon } = await world();
  try {
    s.relay.createVenue(john.record, { id: "g-8", kind: "group", name: "先看", people: ["zhangsan"], agents: ["agent:xiaoping@john"], policy: { draftFirst: true } });
    s.relay.grant(john.record, { person: "zhangsan", widen: { run: "sandbox", budget: 50 } });
    s.relay.appendMessage(zhang.record, "john", "g-8", { id: "m-1", text: "@xiaoping 看看这一轮", parts: [{ src: "https://relay.test/john/sessions/cc-1.geml#turn-3" }] });
    await daemon.syncOnce();
    writeMirror(home, "relay.test", "john", "sessions/cc-1.geml", renderDataBlock("turn-3", { stub: true, from: "john", session: "cc-1", turn: "3", note: "你看不到", action: "申请看" }));
    const d = nextPrompt(home, "xiaoping", NOW);
    assert.equal(d.envelope, "[来自 群「先看」 · zhangsan（成员） · 权限：读、在沙箱里跑 · 回复先给主人过目，再发回该群 · 队列中还有 0 条]");
    assert.deepEqual([d.draftFirst, d.scope], [true, { write: false, run: "sandbox", budget: 50 }]);
    assert.match(d.text, /https:\/\/relay\.test\/john\/sessions\/cc-1\.geml#turn-3\n你看不到：来自 john 的私有范围 · 会话 cc-1 · 第 3 轮 · 申请看/);
    assert.equal(contextText(home, "xiaoping", []), "");
  } finally {
    await s.close();
  }
});

test("markRead keeps the item from being delivered again before the push; answer sends the reply as the agent with the answered marker; the relay shows both after a sync", async () => {
  const { s, zhang, home, daemon } = await world();
  try {
    s.relay.appendMessage(zhang.record, "john", "g-7", { id: "m-1", text: "@xiaoping 跑一下测试" });
    s.relay.appendMessage(zhang.record, "john", "g-7", { id: "m-2", text: "@xiaoping 再跑一次" });
    await daemon.syncOnce();
    const first = nextPrompt(home, "xiaoping", NOW);
    const read = markRead(home, "xiaoping", first.item, NOW);
    assert.deepEqual([read.kind, read.as, read.owner, read.doc, read.body], ["marker", "agent:xiaoping", "john", "queues/xiaoping.geml", { kind: "read", item: "qi-g-7-m-1" }]);
    assert.equal(nextPrompt(home, "xiaoping", NOW).item.id, "qi-g-7-m-2", "the read one is not offered again, though not pushed yet");
    const sent = answer(home, "xiaoping", first.item, "跑完了，三条过两条", NOW, { kind: "report", evidence: [{ src: "https://relay.test/john/journals/t-42.geml#rev-14", rev: 14 }], session: "cc-1" });
    assert.match(sent.sent, /^https:\/\/relay\.test\/john\/venues\/g-7\.geml#m-1793\d{9}-[0-9a-f]{8}$/);
    const out = listOutbox(home);
    assert.deepEqual(out.map((e) => [e.kind, e.as, e.doc, e.body.kind ?? e.body.replyTo]), [["marker", "agent:xiaoping", "queues/xiaoping.geml", "read"], ["message", "agent:xiaoping", "venues/g-7.geml", "report"], ["marker", "agent:xiaoping", "queues/xiaoping.geml", "answered"]]);
    assert.deepEqual([out[1].body.replyTo, out[1].body.session, out[1].body.handling, out[1].body.evidence], ["m-1", "cc-1", 0, [{ src: "https://relay.test/john/journals/t-42.geml#rev-14", rev: 14 }]]);
    assert.equal(out[2].body.reply, sent.sent);
    const r = await daemon.syncOnce();
    assert.deepEqual([r.pushed, r.failed], [3, 0]);
    const vd = s.relay.venueOf("john", "g-7");
    const reply = vd.messages.find((m) => m.replyTo === "m-1");
    assert.deepEqual([reply.speaker, reply.kind, reply.text, reply.session, reply.source], ["agent:xiaoping@john", "report", "跑完了，三条过两条", "cc-1", "agent"]);
    const q = s.relay.queueOf(JOHN, "john", "xiaoping");
    assert.deepEqual(q.queue.markers.map((m) => [m.kind, m.item, m.reply]), [["read", "qi-g-7-m-1", undefined], ["answered", "qi-g-7-m-1", sent.sent]]);
    assert.equal(nextPrompt(home, "xiaoping", NOW).item.id, "qi-g-7-m-2");
  } finally {
    await s.close();
  }
});

test("回群前先给我看: the answer is a draft; 就这么发 pushes it, 不发 marks the item answered with no reply; say and reportPresence write their files", async () => {
  const { s, john, zhang, home, daemon } = await world();
  try {
    s.relay.createVenue(john.record, { id: "g-8", kind: "group", name: "先看", people: ["zhangsan"], agents: ["agent:xiaoping@john"], policy: { draftFirst: true } });
    s.relay.appendMessage(zhang.record, "john", "g-8", { id: "m-1", text: "@xiaoping 看看" });
    s.relay.appendMessage(zhang.record, "john", "g-8", { id: "m-2", text: "@xiaoping 再看看" });
    await daemon.syncOnce();
    const d1 = nextPrompt(home, "xiaoping", NOW);
    const held = answer(home, "xiaoping", d1.item, "看过了", NOW);
    assert.match(held.draft, /^d-/);
    assert.deepEqual(listOutbox(home), [], "nothing pushed");
    const drafts = listDrafts(home);
    assert.deepEqual([drafts.length, drafts[0].agent, drafts[0].item, drafts[0].venueName, drafts[0].body.text, drafts[0].body.replyTo], [1, "xiaoping", "qi-g-8-m-1", "先看", "看过了", "m-1"]);
    assert.equal(nextPrompt(home, "xiaoping", NOW).item.id, "qi-g-8-m-2", "a drafted item is answered as far as delivery goes");
    assert.equal(sendDraft(home, "d-nothing", NOW), undefined);
    const sent = sendDraft(home, held.draft, NOW);
    assert.equal(sent.sent, drafts[0].reply);
    assert.deepEqual(listDrafts(home), []);
    assert.deepEqual(listOutbox(home).map((e) => e.kind), ["message", "marker"]);
    const d2 = nextPrompt(home, "xiaoping", NOW);
    const held2 = answer(home, "xiaoping", d2.item, "算了", NOW);
    assert.equal(dropDraft(home, held2.draft, NOW), true);
    assert.equal(dropDraft(home, held2.draft, NOW), false);
    assert.deepEqual(listOutbox(home).map((e) => [e.kind, e.body.kind ?? "", e.body.reply ?? ""]), [["message", "chat", ""], ["marker", "answered", drafts[0].reply], ["marker", "answered", ""]]);
    assert.equal(nextPrompt(home, "xiaoping", NOW), undefined);
    const said = say(home, { as: "person", owner: "john", venue: "g-7", text: "大家好" }, NOW);
    assert.deepEqual([said.kind, said.as, said.doc, said.body.text, said.body.kind], ["message", "person", "venues/g-7.geml", "大家好", "chat"]);
    reportPresence(home, "xiaoping", "cc-1", { host: "claude-code", login: "subscription", presence: "tool", task: "#42" }, NOW);
    assert.deepEqual(listSessions(home).map((x) => [x.agent, x.session, x.report]), [["xiaoping", "cc-1", { host: "claude-code", login: "subscription", presence: "tool", task: "#42", at: NOW }]]);
    const r = await daemon.syncOnce();
    assert.deepEqual([r.pushed, r.failed, r.heartbeats], [4, 0, 1]);
    assert.deepEqual(s.relay.venueOf("john", "g-8").messages.map((m) => [m.id.slice(0, 2), m.speaker]).slice(2), [["m-", "agent:xiaoping@john"]]);
    assert.deepEqual(s.relay.venueOf("john", "g-7").messages.map((m) => [m.text, m.speaker]), [["大家好", "person:john"]]);
    assert.deepEqual(s.relay.queueOf(JOHN, "john", "xiaoping").queue.markers.map((m) => [m.kind, m.item]), [["answered", "qi-g-8-m-1"], ["answered", "qi-g-8-m-2"]]);
  } finally {
    await s.close();
  }
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
node --test test/daemon-deliver.test.mjs 2>&1 | tail -3
```
Expected: `Cannot find module … dist/daemon/deliver.js`.

- [ ] **Step 3: Write `src/daemon/deliver.ts`**

```ts
// Delivery and answers for a host, over the mirror and the outbox alone
// (transport §3 投递, §2.7; main §6.5, rule 8): the next queue item with the
// envelope the host writes above it (core/im/envelope.ts) and its context
// pack expanded within the budget from what is mirrored (rule 3, §5.1); the
// read-in and answered markers; the final answer sent back to the source
// venue as the agent, or held as a draft when the owner wants to see it
// first; what a person says from the 「消息」 page; a session's presence
// report. No network: the daemon pushes the outbox when it can, and a host
// without a daemon still reads the last mirror.
import { parseAddress } from "../core/im/address.js";
import type { DataBlock } from "../core/im/chain.js";
import { expandEmbeds, type Access, type Embed } from "../core/im/embed.js";
import { envelopeLine, withEnvelope } from "../core/im/envelope.js";
import { parseSpeaker, personBehind } from "../core/im/identity.js";
import type { MessageKind } from "../core/im/message.js";
import type { Presence } from "../core/im/presence.js";
import { next, pending, readQueue, type Marker, type Queue, type QueueItem } from "../core/im/queue.js";
import { scopeFor, type ToolScope } from "../core/im/sender.js";
import type { JsonValue } from "../core/schema.js";
import { textOf } from "../relay/access.js";
import { foldVenue, scopeGrantsFrom, type VenueDoc } from "../relay/relay.js";
import { enqueueOutbox, listDrafts, listOutbox, newBlockId, readConfig, readDraft, readMirror, removeDraft, reportSession, writeDraft, type Config, type Draft, type OutboxEntry } from "./home.js";

export interface Delivered {
  item: QueueItem;
  envelope: string;
  /** The prompt as the model sees it: the envelope, the text, the context pack. */
  text: string;
  scope: ToolScope;
  queued: number;
  draftFirst: boolean;
  /** Items that ran out meanwhile. */
  dropped: QueueItem[];
}

function requireConfig(home: string): Config {
  const c = readConfig(home);
  if (c === undefined) throw new Error("没有 connect.json：先 gemworks connect setup");
  return c;
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/** The agent's mirrored queue, the outbox's unpushed markers for it counted as markers (an item read in while offline is not delivered twice), and a draft held for an item counted as its answer. */
function queueOf(home: string, c: Config, agent: string): Queue {
  const { queue } = readQueue(readMirror(home, c.relay.name, c.person, `queues/${agent}.geml`).text);
  const doc = `queues/${agent}.geml`;
  const markers: Marker[] = [...queue.markers];
  for (const d of listDrafts(home)) if (d.agent === agent) markers.push({ kind: "answered", n: markers.length + 1, item: d.item, at: d.at });
  for (const e of listOutbox(home)) {
    if (e.kind !== "marker" || e.owner !== c.person || e.doc !== doc) continue;
    const kind = e.body["kind"], item = e.body["item"];
    if ((kind !== "read" && kind !== "answered") || typeof item !== "string") continue;
    const m: Marker = { kind, n: markers.length + 1, item, at: e.at };
    const reply = str(e.body["reply"]); if (reply !== undefined) m.reply = reply;
    markers.push(m);
  }
  return { items: queue.items, markers };
}

/** The venue an item came from, as mirrored. */
function venueOfItem(home: string, c: Config, item: QueueItem): VenueDoc | undefined {
  const owner = item.message === undefined ? undefined : parseAddress(item.message)?.owner;
  if (owner === undefined) return undefined;
  const m = readMirror(home, c.relay.name, owner, `venues/${item.venue}.geml`);
  return m.exists ? foldVenue(owner, item.venue, { blocks: m.blocks, diagnostics: [], text: m.text, exists: true }, c.relay.name) : undefined;
}

/** Embeds resolved from the mirror: a mirrored block is its text, a mirrored stub a denial, anything else unknown. */
function localAccess(home: string, c: Config): Access {
  return (e) => {
    const a = parseAddress(e.src);
    if (a === undefined || a.relay !== c.relay.name || a.block === undefined) return undefined;
    const m = readMirror(home, c.relay.name, a.owner, a.doc);
    let block: DataBlock | undefined;
    if (a.block === "announce") { const all = m.blocks.filter((b) => /^announce-\d+$/.test(b.id)); block = all[all.length - 1]; }
    else block = m.blocks.find((b) => b.id === a.block);
    if (block === undefined) return undefined;
    const session = str(block.value["session"]), turn = str(block.value["turn"]);
    const extra = { ...(session !== undefined ? { session } : {}), ...(turn !== undefined ? { turn } : {}) };
    if (block.value["stub"] === true) return { denied: true, owner: a.owner, ...extra };
    return { text: textOf(block), hash: str(block.value["hash"]) ?? "", owner: a.owner, ...extra };
  };
}

/** The context pack as the model reads it: each embed's address, then its text, a 你看不到 line, or that it was not expanded. Empty for no embeds. */
export function contextText(home: string, agent: string, embeds: readonly Embed[]): string {
  if (embeds.length === 0) return "";
  const c = requireConfig(home);
  const { expanded, left } = expandEmbeds(embeds, `agent:${agent}@${c.person}`, localAccess(home, c));
  const parts: string[] = [];
  for (const r of expanded) {
    if (r.text !== undefined) parts.push(`${r.embed.src}\n${r.text}`);
    else if (r.stub !== undefined) parts.push(`${r.embed.src}\n你看不到：来自 ${r.stub.from} 的私有范围${r.stub.session === undefined ? "" : ` · 会话 ${r.stub.session}`}${r.stub.turn === undefined ? "" : ` · 第 ${r.stub.turn} 轮`} · ${r.stub.action}`);
    else parts.push(`${r.embed.src}\n（没展开，用读取工具按需取）`);
  }
  for (const e of left) parts.push(`${e.src}\n（没展开，用读取工具按需取）`);
  return `（上下文）\n${parts.join("\n\n")}`;
}

/** The next item for the agent's session (§6.5), with its envelope and its context; nothing when none waits. */
export function nextPrompt(home: string, agent: string, now: string): Delivered | undefined {
  const c = requireConfig(home);
  const q = queueOf(home, c, agent);
  const { item, dropped } = next(q, now);
  if (item === undefined) return undefined;
  const queued = pending(q, now).length - 1;
  const sender = parseSpeaker(item.sender);
  const person = sender === undefined ? undefined : personBehind(sender);
  const page = readMirror(home, c.relay.name, c.person, `people/${c.person}.geml`);
  const scope = scopeFor(item.level, { ...(person !== undefined ? { person } : {}), venue: item.venue, grants: scopeGrantsFrom(page.blocks), now });
  const draftFirst = venueOfItem(home, c, item)?.venue.policy.draftFirst === true;
  const envelope = envelopeLine({ venueKind: item.venueKind, venueName: item.venueName, senderName: item.senderName, level: item.level, scope, queued, draftFirst });
  const context = contextText(home, agent, item.context ?? []);
  return { item, envelope, text: withEnvelope(envelope, context === "" ? item.prompt : `${item.prompt}\n\n${context}`), scope, queued, draftFirst, dropped };
}

/** The session took the item in (§6.5 已读入). */
export function markRead(home: string, agent: string, item: QueueItem, now: string): OutboxEntry {
  const c = requireConfig(home);
  return enqueueOutbox(home, { kind: "marker", as: `agent:${agent}`, owner: c.person, doc: `queues/${agent}.geml`, body: { kind: "read", item: item.id }, at: now });
}

export interface AnswerOptions { kind?: Extract<MessageKind, "chat" | "report">; evidence?: Embed[]; parts?: Embed[]; opinion?: string; turn?: string; session?: string }

/** The reply as a message body for the source venue: the agent's, answering the item's message, with the hops it was handling. */
function replyBody(item: QueueItem, text: string, now: string, o: AnswerOptions): { owner: string; doc: string; body: Record<string, JsonValue>; address: string } {
  const a = item.message === undefined ? undefined : parseAddress(item.message);
  if (a === undefined || a.block === undefined) throw new Error("这一条没有来源消息的地址");
  const body: Record<string, JsonValue> = { id: newBlockId(now), kind: o.kind ?? "chat", text, replyTo: a.block, handling: item.hops };
  if (o.evidence !== undefined) body["evidence"] = o.evidence as unknown as JsonValue;
  if (o.parts !== undefined) body["parts"] = o.parts as unknown as JsonValue;
  if (o.opinion !== undefined) body["opinion"] = o.opinion;
  if (o.turn !== undefined) body["turn"] = o.turn;
  if (o.session !== undefined) body["session"] = o.session;
  return { owner: a.owner, doc: a.doc, body, address: `https://${a.relay}/${a.owner}/${a.doc}#${String(body["id"])}` };
}

function answered(home: string, c: Config, agent: string, item: string, now: string, reply?: string): OutboxEntry {
  return enqueueOutbox(home, { kind: "marker", as: `agent:${agent}`, owner: c.person, doc: `queues/${agent}.geml`, body: { kind: "answered", item, ...(reply !== undefined ? { reply } : {}) }, at: now });
}

/**
 * The session's final answer (§6.5): sent back to the source venue as the
 * agent, with the answered marker — or, where the venue has 回群前先给我看,
 * held as a draft for the owner, the item counting as answered meanwhile.
 */
export function answer(home: string, agent: string, item: QueueItem, text: string, now: string, o: AnswerOptions = {}): { sent: string } | { draft: string } {
  const c = requireConfig(home);
  const r = replyBody(item, text, now, o);
  if (venueOfItem(home, c, item)?.venue.policy.draftFirst === true) {
    const draft: Draft = { id: `d-${String(r.body["id"]).slice(2)}`, agent, item: item.id, owner: r.owner, doc: r.doc, body: r.body, at: now, venueName: item.venueName, reply: r.address };
    writeDraft(home, draft);
    return { draft: draft.id };
  }
  enqueueOutbox(home, { kind: "message", as: `agent:${agent}`, owner: r.owner, doc: r.doc, body: r.body, at: now });
  answered(home, c, agent, item.id, now, r.address);
  return { sent: r.address };
}

/** 就这么发: the draft goes to the outbox with its answered marker. */
export function sendDraft(home: string, id: string, now: string): { sent: string } | undefined {
  const c = requireConfig(home);
  const d = readDraft(home, id);
  if (d === undefined) return undefined;
  enqueueOutbox(home, { kind: "message", as: `agent:${d.agent}`, owner: d.owner, doc: d.doc, body: d.body, at: now });
  answered(home, c, d.agent, d.item, now, d.reply);
  removeDraft(home, id);
  return { sent: d.reply };
}

/** 不发: the draft is dropped and the item marked answered with no reply, so it is not delivered again. */
export function dropDraft(home: string, id: string, now: string): boolean {
  const c = requireConfig(home);
  const d = readDraft(home, id);
  if (d === undefined) return false;
  answered(home, c, d.agent, d.item, now);
  removeDraft(home, id);
  return true;
}

/** What a person says from the 「消息」 page, or an agent through `im_say`: a message for the venue, pushed when the daemon can. */
export function say(home: string, o: { as: string; owner: string; venue: string; text: string; kind?: MessageKind; parts?: Embed[]; session?: string; replyTo?: string }, now: string): OutboxEntry {
  const body: Record<string, JsonValue> = { id: newBlockId(now), kind: o.kind ?? "chat", text: o.text };
  if (o.parts !== undefined) body["parts"] = o.parts as unknown as JsonValue;
  if (o.session !== undefined) body["session"] = o.session;
  if (o.replyTo !== undefined) body["replyTo"] = o.replyTo;
  return enqueueOutbox(home, { kind: "message", as: o.as, owner: o.owner, doc: `venues/${o.venue}.geml`, body, at: now });
}

/** A session's presence as the host sees it (transport §3 会话登记); the daemon posts it with the heartbeat. */
export function reportPresence(home: string, agent: string, session: string, r: { host: string; login: string; presence: Presence; task?: string }, now: string): void {
  reportSession(home, agent, session, { ...r, at: now });
}
```

- [ ] **Step 4: Build and run the test**

```bash
npm run build > /tmp/im-c-build.log 2>&1; echo "exit=$?"; node --test test/daemon-deliver.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
```
Expected: `exit=0`, `ℹ pass 4`, `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/daemon/deliver.ts test/daemon-deliver.test.mjs
git -c user.name="Jieying, Xiong" -c user.email="xiongjy2104@gmail.com" commit -m "IM daemon: the next prompt with its envelope, answers and drafts, over the mirror"
```

---

### Task 7: `gemworks connect`

**Files:**
- Modify: `src/cli.ts` (the usage lines, a `runConnect`, the async dispatch)
- Modify: `test/cli.test.mjs` and `test/relay-cli.test.mjs` (the usage regex)
- Test: `test/daemon-cli.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// test/daemon-cli.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUNDLE } from "./helpers/repo.mjs";
import { startRelay } from "../dist/relay/server.js";
import { readMirror } from "../dist/daemon/home.js";

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

test("connect setup, agent, --once and status against a relay; --once and status say when the relay is gone", async () => {
  const s = await startRelay({ root: tmp("gemworks-relay-"), name: "relay.test" });
  const home = tmp("gemworks-im-");
  try {
    const john = s.relay.issuePerson("john");
    const xiaoping = s.relay.issueAgent(john.record, "xiaoping");
    s.relay.createVenue(john.record, { id: "g-7", kind: "group", name: "群" });
    assert.equal((await run(["connect", "status", "--home", home])).code, 1, "not set up");
    assert.equal((await run(["connect", "setup", "--relay", s.url, "--home", home])).code, 2, "the token is required");
    assert.equal((await run(["connect", "setup", "--relay", s.url, "--token", xiaoping.token, "--home", home])).code, 1, "an agent's token is not a person's");
    const setup = await run(["connect", "setup", "--relay", `${s.url}/`, "--token", john.token, "--home", home]);
    assert.equal(setup.code, 0, setup.err);
    assert.equal(setup.out.trim(), `connected person:john to relay.test (${s.url}) · home ${home}`);
    assert.deepEqual(JSON.parse(readFileSync(join(home, "connect.json"), "utf8")), { relay: { url: s.url, name: "relay.test" }, person: "john", token: john.token, agents: {} });
    assert.equal((await run(["connect", "agent", "xiaoping", "--token", xiaoping.token, "--home", home])).out.trim(), `agent xiaoping added · home ${home}`);
    assert.equal((await run(["connect", "agent", "--token", "x", "--home", home])).code, 2);
    const once = await run(["connect", "--once"], { GEMWORKS_IM_HOME: home });
    assert.equal(once.code, 0, once.err);
    assert.deepEqual(JSON.parse(once.out), { connected: true, docs: 2, pushed: 0, failed: 0, left: 0, heartbeats: 0 });
    assert.ok(readMirror(home, "relay.test", "john", "venues/g-7.geml").exists);
    const status = await run(["connect", "status", "--home", home]);
    assert.equal(status.code, 0);
    assert.match(status.out, /^john on relay\.test \(http:\/\/127\.0\.0\.1:\d+\) · agents xiaoping · connected at 2026-\S+ · outbox 0 · home /);
    assert.equal((await run(["connect", "nonsense", "--home", home])).code, 2);
    assert.equal((await run(["connect", "--once", "--port", "1", "--home", home])).code, 2);
    assert.match((await run([])).err, /\|relay\|connect>/);
  } finally {
    await s.close();
  }
  const gone = await run(["connect", "--once", "--home", home]);
  assert.equal(gone.code, 1);
  assert.match(JSON.parse(gone.out).error, /连不上中继/);
  const status = await run(["connect", "status", "--home", home]);
  assert.equal(status.code, 1);
  assert.match(status.out, /disconnected at .*连不上中继/);
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
node --test test/daemon-cli.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
```
Expected: `ℹ pass 0`, `ℹ fail 1`.

- [ ] **Step 3: Change `src/cli.ts`**

Add after the relay imports:

```ts
import { RelayClient } from "./daemon/client.js";
import { homeDir, listOutbox, readConfig, readState, writeConfig } from "./daemon/home.js";
import { Daemon } from "./daemon/sync.js";
```

In `USAGE`, the first line's list ends `|hook|mcp|relay|connect>`, and after the `relay token` line:

```ts
  "  connect [--home dir] [--once]           the IM daemon: mirror the relay, push the outbox, heartbeat (home: ~/.gemworks/im)",
  "  connect setup --relay <url> --token <t> | agent <name> --token <t> | status   set the daemon up, add an agent's token, say where it stands",
```

Add before `function main(argv: string[]): number {`:

```ts
/** `gemworks connect`: the daemon until it is stopped; `setup`, `agent`, `status` and `--once` beside it. */
async function runConnect(rest: string[]): Promise<number> {
  const home = homeDir(flag(rest, "--home"), process.env);
  const sub = rest[0] !== undefined && !rest[0].startsWith("--") ? rest[0] : undefined;
  const args = sub === undefined ? rest : rest.slice(1);
  if (sub === "setup") {
    if (positionals("connect setup", args, [], ["--home", "--relay", "--token"]).length > 0) fail(USAGE, 2);
    const given = flag(args, "--relay"), token = flag(args, "--token");
    if (given === undefined || token === undefined) fail("gemworks connect setup: --relay <url> and --token <token> are required", 2);
    const url = given.replace(/\/+$/, "");
    try {
      const root = await new RelayClient(url).root();
      const me = await new RelayClient(url, token).me();
      if (!me.speaker.startsWith("person:") || me.scope !== "person") return fail("gemworks connect setup: the token is not a person's", 1);
      writeConfig(home, { relay: { url, name: root.name }, person: me.speaker.slice("person:".length), token, agents: readConfig(home)?.agents ?? {} });
      console.log(`connected ${me.speaker} to ${root.name} (${url}) · home ${home}`);
      return 0;
    } catch (e) {
      return fail(`gemworks connect setup: ${e instanceof Error ? e.message : String(e)}`, 1);
    }
  }
  if (sub === "agent") {
    const pos = positionals("connect agent", args, [], ["--home", "--token"]);
    const name = pos[0], token = flag(args, "--token");
    if (name === undefined || pos.length !== 1 || token === undefined) fail(USAGE, 2);
    const c = readConfig(home);
    if (c === undefined) return fail("gemworks connect agent: no connect.json here; run gemworks connect setup first", 1);
    writeConfig(home, { ...c, agents: { ...c.agents, [name]: token } });
    console.log(`agent ${name} added · home ${home}`);
    return 0;
  }
  if (sub === "status") {
    if (positionals("connect status", args, [], ["--home"]).length > 0) fail(USAGE, 2);
    const c = readConfig(home);
    if (c === undefined) { console.log(`not set up · home ${home}`); return 1; }
    const s = readState(home);
    const where = s === undefined ? "never synced" : s.connected ? `connected at ${s.at}` : `disconnected at ${s.at}: ${s.error ?? ""}`;
    console.log(`${c.person} on ${c.relay.name} (${c.relay.url}) · agents ${Object.keys(c.agents).join(", ") || "none"} · ${where} · outbox ${listOutbox(home).length} · home ${home}`);
    return s?.connected === true ? 0 : 1;
  }
  if (sub !== undefined) fail(USAGE, 2);
  if (positionals("connect", args, ["--once"], ["--home"]).length > 0) fail(USAGE, 2);
  const daemon = new Daemon({ home, log: (line) => console.error(line) });
  if (has(args, "--once")) {
    const r = await daemon.syncOnce();
    console.log(JSON.stringify(r));
    return r.connected ? 0 : 1;
  }
  const stop = (): void => daemon.stop();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  await daemon.run();
  return 0;
}
```

In the dispatch at the bottom, before the `relay` branch:

```ts
else if (argv[0] === "connect") void runConnect(argv.slice(1)).then((code) => { process.exitCode = code; });
```

In `test/cli.test.mjs`, the `USAGE` regex ends `\|hook\|mcp\|relay\|connect>/`; in `test/relay-cli.test.mjs`, the usage assertion becomes `assert.match(run([]).err, /\|relay\|/, "the usage line names it");`.

- [ ] **Step 4: Build and run the tests**

```bash
npm run build > /tmp/im-c-build.log 2>&1; echo "exit=$?"; node --test test/daemon-cli.test.mjs test/relay-cli.test.mjs test/cli.test.mjs test/bundle.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
```
Expected: `exit=0`, `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts test/cli.test.mjs test/relay-cli.test.mjs test/daemon-cli.test.mjs
git -c user.name="Jieying, Xiong" -c user.email="xiongjy2104@gmail.com" commit -m "gemworks connect: the IM daemon as a subcommand, with setup, agent and status"
```

---

### Task 8: Gates and the version

- [ ] **Step 1: The four gates, each its own command**

```bash
npm run build > /tmp/im-c-gate1.log 2>&1; echo "exit=$?"
claude plugin validate . > /tmp/im-c-gate2.log 2>&1; echo "exit=$?"; tail -1 /tmp/im-c-gate2.log
claude plugin test . > /tmp/im-c-gate3.log 2>&1; echo "exit=$?"; grep -E "^ *[0-9]+ (pass|fail)" /tmp/im-c-gate3.log
node --test --test-concurrency=2 test/*.test.mjs > /tmp/im-c-gate4.log 2>&1; echo "exit=$?"; grep -E "^ℹ (pass|fail)" /tmp/im-c-gate4.log
```
Expected: gates 1, 2, 4 `exit=0`; gate 4 `ℹ pass 886` (867 + 19), `ℹ fail 0`; gate 3 the machine's known 56 pass / 23 fail, unchanged (nothing here touches the hooks module).

- [ ] **Step 2: Bump and commit**

```bash
node scripts/bump.mjs 0.2.92
node --test test/smoke.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
git add package.json package-lock.json .claude-plugin/plugin.json .codex-plugin/plugin.json
git -c user.name="Jieying, Xiong" -c user.email="xiongjy2104@gmail.com" commit -m "gemworks 0.2.92: the IM daemon"
```

---

## Self-review

**Spec coverage (transport §3's ten duties and §2.7):**

| Duty | Task |
|---|---|
| 持有令牌: the person's and each agent's, chosen by the write's `as` | 3 (config), 5 (`client(as)`) |
| 镜像: the venues, the agents' queues, the inbox, as GEML under `~/.gemworks/im/` | 3, 5 (`mirrorAll`, pushed blocks) |
| 待发: local writes as pending entries, pushed and replaced by the mirrored block; offline they wait | 3 (outbox), 5 (`flushOutbox`), 6 |
| 投递: the queue head with the envelope at a turn's end; read in on submit; answered on the final reply; 回群前先给我看 as a draft the owner sends | 6 |
| 信封与范围: one pure module shared with the relay and the hosts | 6 (`envelopeLine`, `scopeFor`) |
| 会话登记: host, login kind, presence from the host's events, with the heartbeat | 3, 5 (`heartbeat`), 6 (`reportPresence`) |
| 包: plan F | — |
| 本机执行: ⑥, later | — |
| 客房: plan F | — |
| 心跳 every 30 s; 断了 for the desktop when the relay is gone (the state file), for the phone through the relay's rule | 5 (`DEFAULT_INTERVALS`, `writeState`), B |
| §2.7 offline: pending blocks, no merge conflicts (the relay orders), mirrors whole | 3, 5 |
| §8 testing against a scripted relay: stamping, stubs, offline backlog, idempotent resend | 4, 5, 6 (a real relay in-process) |

**Placeholders:** none. **Type consistency:** `Config`, `OutboxEntry`, `Draft`, `SessionReport`, `State`, `Pushed` from `home.ts`; `RelayClient`, `RelayDown`, `Answer`, `reasonOf` from `client.ts`; `Daemon`, `SyncReport`, `Intervals` from `sync.ts`; `Delivered`, `AnswerOptions` from `deliver.ts`; `foldVenue`, `scopeGrantsFrom`, `VenueDoc` now exported from `relay.ts`; `Visible` from `relay.ts` used by `client.ts`.

**Assumptions recorded:** (1) the daemon follows venues, queues and the person's own page, not sessions or journals: a context pack naming those shows 没展开 unless the host mirrors them itself (plan D's `im_read` asks the relay); (2) a dropped draft marks the item answered with no reply; (3) a message's id is chosen at enqueue time, so a resend after a lost answer repeats it; (4) the listing is refreshed once a minute, so a new venue is followed within a minute; (5) the first `syncOnce` rewrites mirrors whole on every run, which is fine for the sizes of v1.
