# Gemsbang Plan Z: Each Person's Box, and the Sync

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The panel is current within a second, and no machine reads every chat again every thirty seconds. Everything a person should know — a line in one of their chats, a card, a job, a chat joined, a name changed, their own record — is one numbered update in their box on the relay. Their machine keeps the number it reached and a cache of their chats, one file per chat with its lines by id; it catches up with the difference after that number, or waits on the box (at most 25 seconds) and is answered the moment something lands. The Claude Code plugin keeps no resident process and no poll: while someone is signed in, it waits on the box through the client, one wait after another.

**Architecture:** A pure module, `src/core/avatar/updates.ts`, holds the rules as Telegram keeps them (architecture §5): an update's `pts` and `count`, applied when it follows on, dropped when seen, held beyond a gap; a gap waits `GAP_WAIT_MS` and then the difference fills it; a difference gives a page and says whether it reached the box's end; the box keeps a week, and a client behind that is told it is too far behind. The relay (`src/relay/avatars.ts`) wraps its store: every block appended goes into the box (`_relay/boxes/<person>.geml`, one block `u-<pts>` each) of every person it concerns — a chat's members, each seeing a line's `by` as they may; an avatar's own documents, its person; its card, everyone in a chat with it too; a person's record, that person — and wakes whoever waits on that box. `GET /updates/state`, `GET /updates/difference?pts=…` and `GET /updates?pts=…&timeout=…` answer it; the Node shell holds an empty wait open until the box grows or the time is up. The client (`src/gemsbang/home.ts`, `ops.ts`) keeps `cache/state.json` (the number reached, the person and what is not a chat) and `cache/venues/<owner>-<id>.json`; `status` catches up by difference, `wait` waits; a line is kept by its id, anything else names the one piece to read again (the person, the list of chats, one chat, 需要你, the jobs); with no number yet, or too far behind, it reads everything again after taking the box's number first. The hooks module drops its 30-second poll for a chain of waits that stops while nobody is signed in and starts again on sign-in.

**Tech Stack:** TypeScript (`src/core/avatar`, `src/relay`, `src/gemsbang`), the hooks module in TSX, `node:test` over `dist/`, `claude plugin test` for the module.

**Before this plan:** gemsbang 0.5.10 on `main` (plan Y, `docs/design/plans/2026-11-02-im-y-email-sign-in.md`). The spec is `docs/design/specs/2026-11-01-gemsbang-architecture.md` §5 (the box, its interface, the client's rules), §6.1 (one client, a cache by chat and by message id in place of `mirror.json`), §6.2 (no resident process: the plugin waits through the bridge), §8 (客户端每 30 秒把所有群整份重读一遍 → 信箱、序号、补拉、长轮询；本机缓存).

## The series

| Plan | What it builds | What runs after it |
|---|---|---|
| P–U (done, 0.5.1–0.5.6) | Avatars as accounts, a group one link, the side panel, 需要你, hosted agents, borrowing Claude Code | The IM of avatars on a Node relay |
| V (done, 0.5.7) · no hosted layer, nothing on a clock | The hosted layer gone; cards wait unless the matter has a deadline; 借电脑 → 任务 | Avatars speak only through their person's own agents |
| W (done, 0.5.8) · ask before answering | Calls on the client, 回 / 以后这个群自动回 / 不回; 自动回 on the avatar; rounds in the background | An avatar answers when its person says so |
| X (done, 0.5.9) · the relay on a store | `DocStore`: files, memory, SQLite; the relay and its tokens on it | The same relay, ready to run inside a Durable Object |
| Y (done, 0.5.10) · email sign-in and the account | Ways in by email or phone, the service built in, the sign-in screens, the account page | A person signs in with an email, nowhere a server to fill in |
| **Z (this one)** · the box and sync | Each person's box with `pts`; state, difference and a wait; the client's update rules and its cache per chat; waits instead of the poll | The panel is current within a second |
| AA · Cloudflare | A Worker and a Durable Object around the relay on `sqlStore`, alarms for deadlines, mail from `gemsbang.com`, the beta deployed | gemsbang at gemsbang.com |

## What the spec decided, and what this plan does about each

- **One box per person, numbered (architecture §5.1).** Every append the relay makes goes through one wrapper of its store, so nothing that changes a person's view escapes the box. An update is `{pts, count: 1, at, owner, doc, block}` with the block as that person may see it; the relay's own records reach nobody except a person's own (language, default name, avatars, ways in). One box for all, as the spec's first version says; big groups' own boxes wait (§9 item 3). The box keeps a week (`BOX_KEEP_MS`); a client behind that is answered `tooLong`.
- **State, difference, wait (architecture §5.2).** `GET /updates/state` gives the number and the relay's time; `GET /updates/difference?pts=&limit=` a page (at most a hundred) with the number it reaches and `final`; `GET /updates?pts=&timeout=` the same, held open by the Node shell for at most 25 seconds while the box has nothing after `pts`. A person's token or a device's may ask; an avatar's agent has no box.
- **The client's rules (architecture §5.3).** `receive` applies what follows on, drops what was seen and holds what lies beyond a gap; a gap waits `GAP_WAIT_MS` (half a second) and then the difference fills it; pages are read to the box's end, at most `SYNC_ROUNDS` answers a call. At the start (no number kept) and when too far behind, the client takes the box's number first and then reads everything, so nothing lands unseen in between. The number is written with the cache before the call answers. The rules and their times are named constants in one module.
- **A cache by chat and by message id (architecture §6.1).** `mirror.json` gives way to `cache/state.json` and one file per chat; a chat's line is kept by its id (its last 200 kept); signing out or signing in as someone clears it. A line costs one call (the difference); someone new in a chat, a name or the link's rules changed, that one chat is read again; a card, a job, a rule, a waiting line or 自动回 changed, that list alone.
- **No poll, no resident process (architecture §6.2).** The hooks module waits on the box through the bridge (45 seconds given to a 25-second wait), the next wait a second after one came back, ten seconds after one failed; when nobody is signed in the waits stop, and signing in starts them again. Jobs and rounds are picked up at the start and after any wait that brought something.
- **Not in this plan:** the old base's `gemworks connect` daemon, its relay, cards and phone bridge, which gemsbang does not run (architecture §7 retires them; removing them from this repository is a cleanup of its own); the WebSocket `/subscribe` the Node shell still offers; big groups' own boxes; the Worker (plan AA).

## File structure

| File | Responsibility |
|---|---|
| `src/core/avatar/updates.ts` (new) | `Update`, `Difference`; `verdictOf`, `receive`, `differenceOf`; `GAP_WAIT_MS`, `WAIT_MAX_S`, `DIFFERENCE_LIMIT`, `BOX_KEEP_MS`. |
| `src/relay/avatars.ts` | The store wrapped: every append into the boxes of the people it concerns; `updatesState`, `difference`, `onBox`. |
| `src/relay/avatar-api.ts`, `src/relay/avatar-server.ts` | `/updates/state`, `/updates/difference`, `/updates`; the Node shell's held wait. |
| `src/gemsbang/home.ts`, `src/gemsbang/ops.ts` | The cache per chat; `status` by difference, `wait`, the full read; an update applied or a piece read again. |
| `hooks/register.tsx` | The chain of waits in place of the 30-second poll. |
| `src/core/avatar/words.ts` | `updates.pts`, `updates.limit`. |
| `test/avatar-updates`, `avatar-box`, `avatar-box-api`, `gemsbang-sync` `.test.mjs` (new); `tests/hooks.test.ts` | Each task's tests. |

---

### Task 1: The box's rules: numbered updates, gaps, differences

**Files:**
- Create: `src/core/avatar/updates.ts` (`Update`, `Difference`, `SyncState`; `verdictOf`, `receive`, `differenceOf`; `GAP_WAIT_MS`, `WAIT_MAX_S`, `DIFFERENCE_LIMIT`, `BOX_KEEP_MS`)
- Test: `test/avatar-updates.test.mjs`

- [ ] **Step 1: Write the failing test**

**Create `test/avatar-updates.test.mjs`:**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { BOX_KEEP_MS, differenceOf, GAP_WAIT_MS, receive, verdictOf, WAIT_MAX_S } from "../dist/core/avatar/updates.js";

const AT = "2026-11-02T09:00:00Z";
const U = (pts, at = AT, count = 1) => ({ pts, count, at, owner: "a-0000000001", doc: "venues/g-000000000a.geml", block: { id: `m-${pts}`, value: { text: String(pts) } } });

test("an update against the number reached (architecture §5.3): next in line is applied, at or below it was seen, beyond it leaves a gap; the times are named", () => {
  assert.deepEqual([verdictOf(4, U(5)), verdictOf(4, U(4)), verdictOf(4, U(3)), verdictOf(4, U(6)), verdictOf(4, U(6, AT, 2))], ["apply", "seen", "seen", "gap", "apply"]);
  assert.deepEqual([GAP_WAIT_MS, WAIT_MAX_S, BOX_KEEP_MS], [500, 25, 7 * 86_400_000]);
});

test("receiving (architecture §5.3): in order, applied; seen ones dropped; after a gap held, and applied once the gap fills", () => {
  const a = receive({ pts: 2, pending: [] }, [U(4), U(3), U(2), U(6)]);
  assert.deepEqual([a.apply.map((u) => u.pts), a.state.pts, a.state.pending.map((u) => u.pts), a.gap], [[3, 4], 4, [6], true]);
  const b = receive(a.state, [U(6), U(7)]);
  assert.deepEqual([b.apply, b.state.pending.map((u) => u.pts), b.gap], [[], [6, 7], true], "still a gap: the same one held once");
  const c = receive(b.state, [U(5)]);
  assert.deepEqual([c.apply.map((u) => u.pts), c.state, c.gap], [[5, 6, 7], { pts: 7, pending: [] }, false]);
});

test("a difference (architecture §5.2): the updates after the number asked, a page at a time with how far it reaches; the end said; too far behind once the week dropped them; an empty box or a client ahead, nothing", () => {
  const box = [1, 2, 3, 4, 5].map((n) => U(n));
  assert.deepEqual(differenceOf(box, 2, AT, 2), { updates: [U(3), U(4)], pts: 4, final: false, date: AT });
  assert.deepEqual(differenceOf(box, 4, AT), { updates: [U(5)], pts: 5, final: true, date: AT });
  assert.deepEqual(differenceOf(box, 5, AT), { updates: [], pts: 5, final: true, date: AT });
  const later = new Date(Date.parse(AT) + BOX_KEEP_MS + 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const aged = [...box, U(6, later)];
  assert.deepEqual(differenceOf(aged, 2, later), { tooLong: true, pts: 6, date: later });
  assert.deepEqual(differenceOf(aged, 5, later).updates.map((u) => u.pts), [6], "a client that saw what was dropped is not behind");
  assert.deepEqual(differenceOf([], 0, AT), { updates: [], pts: 0, final: true, date: AT });
  assert.deepEqual(differenceOf(box, 9, AT), { updates: [], pts: 5, final: true, date: AT }, "a client ahead of the box goes back to its end");
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run build && node --test test/avatar-updates.test.mjs`

Expected: the build passes; `dist/core/avatar/updates.js` does not exist yet (`ERR_MODULE_NOT_FOUND`): `ℹ fail 1`.

- [ ] **Step 3: Write the code**

**Create `src/core/avatar/updates.ts`:**

```ts
// Each person's box (architecture §5, as Telegram keeps it): everything the
// person should know — a line in one of their chats, a card, a job, a chat
// joined, a name changed — is one update in their box, numbered: `pts` is the
// box's number after it, `count` how many numbers it takes. The client keeps
// the number it has reached; an update whose `pts` is that number plus its
// `count` is applied, one below or at it was seen already, one beyond it
// leaves a gap: what comes after waits, half a second for the missing ones to
// arrive, then the client asks for the difference. The client writes the
// number it reached before it answers, never later. The box keeps a week; a
// client further behind is told so and reads everything again. Pure: the
// rules and their named times, the same on the relay and the client.
import type { JsonValue } from "../schema.js";

/** A gap waits this long for its missing updates before the client asks for the difference. */
export const GAP_WAIT_MS = 500;
/** A wait for updates lasts at most this long, in seconds. */
export const WAIT_MAX_S = 25;
/** A difference gives at most this many updates; the rest from its last number on. */
export const DIFFERENCE_LIMIT = 100;
/** The box keeps updates this long. */
export const BOX_KEEP_MS = 7 * 86_400_000;

/** One update: its number and how many numbers it takes, when, and the block appended to which document (as the person may see it). */
export interface Update { pts: number; count: number; at: string; owner: string; doc: string; block: { id: string; value: Record<string, JsonValue> } }
/** What a difference answers: the updates after the number asked, the number they reach, whether that is the box's end; or that the asker is too far behind. */
export type Difference = { updates: Update[]; pts: number; final: boolean; date: string } | { tooLong: true; pts: number; date: string };

export type Verdict = "apply" | "seen" | "gap";

/** Where an update stands against the number reached: next in line, seen already, or beyond a gap. */
export const verdictOf = (reached: number, u: Pick<Update, "pts" | "count">): Verdict =>
  reached + u.count === u.pts ? "apply" : reached + u.count > u.pts ? "seen" : "gap";

/** What the client holds while it syncs: the number reached, and the updates waiting beyond a gap. */
export interface SyncState { pts: number; pending: Update[] }

/** Updates arrived, with those already waiting: applied in order while they follow on, the seen dropped, the rest held; `gap` while any is held. */
export function receive(s: SyncState, arrived: readonly Update[]): { state: SyncState; apply: Update[]; gap: boolean } {
  const all = [...s.pending, ...arrived].sort((a, b) => a.pts - b.pts);
  const apply: Update[] = [], held: Update[] = [];
  let pts = s.pts;
  for (const u of all) {
    const v = verdictOf(pts, u);
    if (v === "apply" && held.length === 0) { apply.push(u); pts = u.pts; }
    else if (v === "gap" || held.length > 0) { if (v !== "seen" && !held.some((h) => h.pts === u.pts)) held.push(u); }
  }
  return { state: { pts, pending: held }, apply, gap: held.length > 0 };
}

/** The updates of a box after `pts`, at most `limit`, as kept on `now`: how far they reach and whether that is the box's end; too far behind when updates after `pts` are no longer kept. */
export function differenceOf(box: readonly Update[], pts: number, now: string, limit = DIFFERENCE_LIMIT): Difference {
  const last = box[box.length - 1]?.pts ?? 0;
  const cut = Date.parse(now) - BOX_KEEP_MS;
  const kept = box.filter((u) => Date.parse(u.at) >= cut);
  // The number just before the oldest update kept: a client behind it missed what was dropped.
  const first = kept[0] !== undefined ? kept[0].pts - kept[0].count : last;
  if (pts < first) return { tooLong: true, pts: last, date: now };
  const after = kept.filter((u) => u.pts > pts).slice(0, Math.max(1, limit));
  const reached = after[after.length - 1]?.pts ?? Math.min(pts, last);
  return { updates: after, pts: reached, final: reached >= last, date: now };
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npm run build && node --test test/avatar-updates.test.mjs`

Expected: `ℹ pass 3`, `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/core/avatar/updates.ts test/avatar-updates.test.mjs
git commit -m "gemsbang Z1: each person's box, as rules — numbered updates, gaps, differences, a week kept"
```


### Task 2: The relay writes each person's box

**Files:**
- Modify: `src/relay/avatars.ts` (the store wrapped: each append routed into the boxes of the people it concerns, as each may see it; `updatesState`, `difference`, `onBox`)
- Modify: `src/core/avatar/words.ts` (`updates.pts`, `updates.limit`)
- Test: `test/avatar-box.test.mjs`

- [ ] **Step 1: Write the failing test**

**Create `test/avatar-box.test.mjs`:**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AvatarRelay } from "../dist/relay/avatars.js";

const BASE = Date.UTC(2026, 10, 2, 9, 0, 0);
function relay() {
  let offset = 0;
  const mail = [];
  const now = () => { const t = new Date(BASE + offset).toISOString().replace(/\.\d{3}Z$/, "Z"); offset += 1000; return t; };
  const r = new AvatarRelay({ root: mkdtempSync(join(tmpdir(), "gemsbang-box-")), name: "relay.test", now, mailer: (m) => { mail.push(m); } });
  return Object.assign(r, { mail });
}
const ok = (x) => { assert.equal(x.ok, true, x.reason); return x; };
const bad = (x, status, code) => { assert.equal(x.ok, false); assert.equal(x.status, status, x.reason); assert.equal(x.code, code); return x; };
function person(r, email, name) {
  ok(r.startLogin({ email }));
  const done = ok(r.finishLogin({ email, code: /(\d{6})/.exec(r.mail[r.mail.length - 1].text)[1] }));
  const by = r.verify(done.token);
  return { by, person: done.person, avatar: ok(r.firstAvatar(by, { name })).avatar };
}
/** The person's whole box, as `<doc>#<block>` per update, after the number given. */
const box = (r, p, pts = 0) => ok(r.difference(p.by, { pts })).updates.map((u) => `${u.doc}#${u.block.id}`);

test("each person's box (architecture §5.1): their own record and their first avatar's card, numbered from one; the state says how far it reaches", () => {
  const r = relay();
  const john = person(r, "john@example.com", "John");
  const d = ok(r.difference(john.by, { pts: 0 }));
  assert.deepEqual(d.updates.map((u) => [u.pts, u.count, u.owner === "_relay" ? "_relay" : "avatar", u.doc]), [[1, 1, "_relay", `people/${john.person}.geml`], [2, 1, "_relay", `people/${john.person}.geml`], [3, 1, "_relay", `people/${john.person}.geml`], [4, 1, "avatar", "avatar.geml"]]);
  assert.deepEqual([d.pts, d.final], [4, true]);
  assert.deepEqual(ok(r.updatesState(john.by)).pts, 4);
  bad(r.difference(john.by, { pts: -1 }), 400, "updates.pts");
  bad(r.difference(john.by, { pts: 0, limit: 0 }), 400, "updates.limit");
  bad(r.updatesState({ ...john.by, scope: "avatar" }), 403, "person.only");
});

test("a chat's line goes into every member's box as they may see it — `by` left out where the speaker does not mark, kept for the speaker's own person; a card into its avatar's person's alone; nothing into a stranger's; whoever waits on a box hears of each", () => {
  const r = relay();
  const john = person(r, "john@example.com", "John"), li = person(r, "li@example.com", "李四"), wang = person(r, "wang@example.com", "王五");
  const g = ok(r.createGroup(john.by, { as: john.avatar.id, name: "设置页改版" })).venue;
  const code = ok(r.linkFor(john.by, g.owner, g.id, { as: john.avatar.id })).link.code;
  ok(r.joinByLink(li.by, code, { as: li.avatar.id }));
  ok(r.setRules(li.by, li.avatar.id, { mark: false }));
  const heard = [];
  const off = r.onBox(john.person, () => heard.push("john"));
  const johnAt = ok(r.updatesState(john.by)).pts, liAt = ok(r.updatesState(li.by)).pts, wangAt = ok(r.updatesState(wang.by)).pts;
  const agent = r.verify(ok(r.issueAvatar(li.by, li.avatar.id)).token);
  const said = ok(r.say(agent, g.owner, g.id, { text: "Safari 里导出按钮没反应" })).message;
  const toJohn = ok(r.difference(john.by, { pts: johnAt })).updates;
  assert.deepEqual(toJohn.map((u) => [u.owner, u.doc, u.block.id, u.block.value.text, "by" in u.block.value]), [[g.owner, `venues/${g.id}.geml`, said.id, "Safari 里导出按钮没反应", false]]);
  assert.equal(ok(r.difference(li.by, { pts: liAt })).updates.find((u) => u.block.id === said.id).block.value.by, "agent", "the speaker's own person sees who typed it");
  assert.deepEqual(box(r, wang, wangAt), [], "a stranger hears nothing of the chat");
  assert.deepEqual(heard, ["john"]);
  off();
  ok(r.say(john.by, g.owner, g.id, { as: john.avatar.id, text: "我看看" }));
  assert.deepEqual(heard, ["john"], "no longer waiting");
  ok(r.rename(li.by, li.avatar.id, { name: "李四（前端）" }));
  assert.deepEqual(box(r, john, johnAt).slice(-1), [`avatar.geml#name-1`], "a member's new name reaches everyone in a chat with it");
  const liNow = ok(r.updatesState(li.by)).pts, johnNow = ok(r.updatesState(john.by)).pts;
  ok(r.ask(agent, { venue: `${g.owner}/${g.id}`, kind: "promise", summary: "周五前给稿子反馈", options: [{ label: "好" }] }));
  assert.deepEqual([box(r, li, liNow).map((x) => x.split("#")[0]), box(r, john, johnNow)], [["needs.geml"], []], "a card is its person's alone");
  assert.equal(box(r, wang, wangAt).length, 0);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run build && node --test test/avatar-box.test.mjs`

Expected: the build passes; the relay has no `difference` yet (`TypeError`): `ℹ fail 2`.

- [ ] **Step 3: Write the code**

**In `src/core/avatar/words.ts`, replace:**

```ts
  "avatar.notYours": { zh: "这不是你的分身", en: "That avatar is not yours", ja: "それはあなたの分身ではありません" },
  "avatar.notFirst": { zh: "已经有分身了；新的分身在进群或建群时长出来", en: "You already have an avatar; new ones grow when you join or make a group", ja: "分身はもうあります。新しい分身はグループに参加・作成するときに生まれます" },
```

**with:**

```ts
  "avatar.notYours": { zh: "这不是你的分身", en: "That avatar is not yours", ja: "それはあなたの分身ではありません" },
  "updates.pts": { zh: "pts 要是不小于 0 的整数", en: "pts must be a whole number, 0 or more", ja: "pts は 0 以上の整数です" },
  "updates.limit": { zh: "limit 要是 1 到 {max} 的整数", en: "limit must be a whole number from 1 to {max}", ja: "limit は 1 から {max} までの整数です" },
  "avatar.notFirst": { zh: "已经有分身了；新的分身在进群或建群时长出来", en: "You already have an avatar; new ones grow when you join or make a group", ja: "分身はもうあります。新しい分身はグループに参加・作成するときに生まれます" },
```

**In `src/relay/avatars.ts`, replace:**

```ts
// for whoever has no language to ask in; words.ts says it in the others.
import { createHash, randomBytes, randomInt } from "node:crypto";
```

**with:**

```ts
// for whoever has no language to ask in; words.ts says it in the others.
// Everything appended that a person should know goes into their box too
// (architecture §5.1): a line in a chat of theirs as they may see it, their
// avatars' cards, jobs, rules and lists, a name changed, their own record.
import { createHash, randomBytes, randomInt } from "node:crypto";
```

**In `src/relay/avatars.ts`, replace:**

```ts
import { pickAvatar, type Pick } from "../core/avatar/pick.js";
import { addressFault, addressOf, codeMail, hashAddress, keyOf, maskAddress, type Address, type AddressKind } from "../core/avatar/address.js";
```

**with:**

```ts
import { pickAvatar, type Pick } from "../core/avatar/pick.js";
import { DIFFERENCE_LIMIT, differenceOf, type Difference, type Update } from "../core/avatar/updates.js";
import { addressFault, addressOf, codeMail, hashAddress, keyOf, maskAddress, type Address, type AddressKind } from "../core/avatar/address.js";
```

**In `src/relay/avatars.ts`, replace:**

```ts
const peopleDoc = (person: string): string => `people/${person}.geml`;
const venueDoc = (venue: string): string => `venues/${venue}.geml`;
```

**with:**

```ts
const peopleDoc = (person: string): string => `people/${person}.geml`;
const PEOPLE_DOC = /^people\/(p-[0-9a-f]{10})\.geml$/;
/** A person's box (architecture §5.1), under `_relay`: one block `u-<pts>` per update. */
const boxDoc = (person: string): string => `boxes/${person}.geml`;
const num = (v: unknown): number => (typeof v === "number" ? v : 0);
const lastPts = (d: { blocks: readonly DataBlock[] }): number => num(d.blocks[d.blocks.length - 1]?.value["pts"]);
const venueDoc = (venue: string): string => `venues/${venue}.geml`;
```

**In `src/relay/avatars.ts`, replace:**

```ts
  readonly root: string | undefined;
  readonly store: DocStore;
  readonly name: string;
```

**with:**

```ts
  readonly root: string | undefined;
  /** The relay's documents: every append also goes into the boxes of the people it concerns. */
  readonly store: DocStore;
  private readonly base: DocStore;
  private readonly boxWaiters = new Map<string, Set<() => void>>();
  readonly name: string;
```

**In `src/relay/avatars.ts`, replace:**

```ts
    this.root = o.root;
    this.store = o.store ?? fileStore(o.root!);
    this.name = o.name;
```

**with:**

```ts
    this.root = o.root;
    const base = o.store ?? fileStore(o.root!);
    this.base = base;
    this.store = {
      read: (owner, doc) => base.read(owner, doc),
      list: (owner, dir) => base.list(owner, dir),
      secret: (name, make) => base.secret(name, make),
      append: (owner, doc, idOf, build) => { const a = base.append(owner, doc, idOf, build); if (!a.existed) this.route(owner, doc, a.block); return a; },
    };
    this.name = o.name;
```

**In `src/relay/avatars.ts`, replace:**

```ts
    return { ok: true, revoked: this.signOut([by.id]) };
  }
```

**with:**

```ts
    return { ok: true, revoked: this.signOut([by.id]) };
  }

  // --- the box (architecture §5) ---

  /** The people a block appended to a document concerns, each with the block as they may see it: a chat's members, its lines' `by` left out where the speaker does not mark; an avatar's own documents, its person; its card, everyone in a chat with it too; a person's record, that person. */
  private audience(owner: string, doc: string, block: DataBlock): Map<string, Record<string, JsonValue>> {
    const out = new Map<string, Record<string, JsonValue>>();
    if (owner === RELAY_OWNER) {
      const p = PEOPLE_DOC.exec(doc);
      if (p !== null) out.set(p[1]!, block.value);
      return out;
    }
    if (!AVATAR_ID.test(owner)) return out;
    const v = VENUE_DOC.exec(doc);
    if (v !== null) {
      const marks = new Map<string, boolean>();
      const marked = (avatar: string): boolean => { if (!marks.has(avatar)) marks.set(avatar, this.rulesOf(avatar).mark); return marks.get(avatar)!; };
      for (const m of this.venueState(owner, v[1]!)?.members ?? []) {
        const person = this.ownerOf(m);
        if (person !== undefined && !out.has(person)) out.set(person, this.shown(block, this.avatarsOf(person).map((a) => a.id), marked).value);
      }
      return out;
    }
    const mine = this.ownerOf(owner);
    if (mine !== undefined) out.set(mine, block.value);
    if (doc === "avatar.geml") {
      for (const j of this.joinedOf(owner)) for (const m of this.venueState(j.owner, j.venue)?.members ?? []) {
        const person = this.ownerOf(m);
        if (person !== undefined && !out.has(person)) out.set(person, block.value);
      }
    }
    return out;
  }

  /** A block appended, into the box of everyone it concerns, numbered there; whoever waits on a box hears of it. */
  private route(owner: string, doc: string, block: DataBlock): void {
    if (owner === RELAY_OWNER && !PEOPLE_DOC.test(doc)) return;
    for (const [person, value] of this.audience(owner, doc, block)) {
      const at = this.now();
      this.base.append(RELAY_OWNER, boxDoc(person), (d) => `u-${lastPts(d) + 1}`, (d, prev, id) => sealed({ id, pts: lastPts(d) + 1, count: 1, at, owner, doc, block: { id: block.id, value } }, prev));
      for (const fn of [...(this.boxWaiters.get(person) ?? [])]) fn();
    }
  }

  /** The person's box, oldest first. */
  private boxOf(person: string): Update[] {
    return this.store.read(RELAY_OWNER, boxDoc(person)).blocks.filter((b) => /^u-\d+$/.test(b.id)).map((b) => {
      const kept = obj(b.value["block"]) ?? {};
      return { pts: num(b.value["pts"]), count: num(b.value["count"]), at: str(b.value["at"]) ?? "", owner: str(b.value["owner"]) ?? "", doc: str(b.value["doc"]) ?? "", block: { id: str(kept["id"]) ?? "", value: (obj(kept["value"]) ?? {}) as Record<string, JsonValue> } };
    });
  }

  /** Where the person's box stands: its number, and the relay's time. */
  updatesState(by: TokenRecord): Result<{ pts: number; date: string }> {
    const person = this.personOf(by);
    if (person === undefined) return fail(403, "person.only");
    const box = this.boxOf(person);
    return { ok: true, pts: box[box.length - 1]?.pts ?? 0, date: this.now() };
  }

  /** The updates after the number the client reached (`pts`), at most `limit` (a hundred); too far behind, said so. */
  difference(by: TokenRecord, q: Readonly<Record<string, unknown>>): Result<Difference> {
    const person = this.personOf(by);
    if (person === undefined) return fail(403, "person.only");
    const pts = Number(q["pts"]), limit = q["limit"] === undefined ? DIFFERENCE_LIMIT : Number(q["limit"]);
    if (!Number.isInteger(pts) || pts < 0) return fail(400, "updates.pts");
    if (!Number.isInteger(limit) || limit < 1) return fail(400, "updates.limit", { max: DIFFERENCE_LIMIT });
    return { ok: true, ...differenceOf(this.boxOf(person), pts, this.now(), Math.min(limit, DIFFERENCE_LIMIT)) };
  }

  /** Hear when the person's box grows; the function given back stops it. */
  onBox(person: string, fn: () => void): () => void {
    const set = this.boxWaiters.get(person) ?? new Set<() => void>();
    set.add(fn);
    this.boxWaiters.set(person, set);
    return () => { set.delete(fn); if (set.size === 0) this.boxWaiters.delete(person); };
  }
```

- [ ] **Step 4: Run them to see them pass**

Run: `npm run build && node --test test/avatar-box.test.mjs`

Expected: `ℹ pass 2`, `ℹ fail 0`.

Run: `node --test --test-concurrency=4 test/avatar-*.test.mjs test/relay-*.test.mjs test/gemsbang*.test.mjs test/gb-*.test.mjs`

Expected: every suite of the relay, the client and the pane passes as before: `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/core/avatar/words.ts src/relay/avatars.ts test/avatar-box.test.mjs
git commit -m "gemsbang Z2: the relay writes what each person should know into their box, numbered; state and difference"
```


### Task 3: The box over HTTP, and the held wait

**Files:**
- Modify: `src/relay/avatar-api.ts` (`GET /updates/state`, `/updates/difference`, `/updates`)
- Modify: `src/relay/avatar-server.ts` (a wait with a `timeout` held open until the box grows, at most 25 seconds)
- Test: `test/avatar-box-api.test.mjs`

- [ ] **Step 1: Write the failing test**

**Create `test/avatar-box-api.test.mjs`:**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startAvatarRelay } from "../dist/relay/avatar-server.js";

async function serve() {
  const mail = [];
  const s = await startAvatarRelay({ root: mkdtempSync(join(tmpdir(), "gemsbang-box-api-")), name: "relay.test", mailer: (m) => { mail.push(m); } });
  const call = async (method, path, o = {}) => {
    const res = await fetch(`${s.url}${path}`, { method, headers: { ...(o.token ? { authorization: `Bearer ${o.token}` } : {}), ...(o.body ? { "content-type": "application/json" } : {}) }, ...(o.body ? { body: JSON.stringify(o.body) } : {}) });
    return { status: res.status, body: await res.json() };
  };
  const person = async (email, name) => {
    await call("POST", "/login", { body: { email } });
    const token = (await call("POST", "/login/verify", { body: { email, code: /(\d{6})/.exec(mail[mail.length - 1].text)[1] } })).body.token;
    const avatar = (await call("POST", "/avatars", { token, body: { name } })).body.avatar;
    return { token, avatar };
  };
  return { s, call, person };
}

test("the box over HTTP (architecture §5.2): where it stands, the difference after a number, a refusal for a bad one; the agent's token has no box", async () => {
  const { s, call, person } = await serve();
  try {
    const john = await person("john@example.com", "John");
    const state = (await call("GET", "/updates/state", { token: john.token })).body;
    assert.equal(state.pts, 4);
    const d = (await call("GET", "/updates/difference?pts=2&limit=1", { token: john.token })).body;
    assert.deepEqual([d.updates.map((u) => u.pts), d.pts, d.final], [[3], 3, false]);
    assert.equal((await call("GET", "/updates/difference?pts=x", { token: john.token })).body.error, "updates.pts");
    const agent = (await call("POST", `/avatars/${john.avatar.id}/token`, { token: john.token })).body.token;
    assert.equal((await call("GET", "/updates/state", { token: agent })).status, 403);
    assert.equal((await call("GET", "/updates?pts=0", { token: john.token })).body.updates.length, 4, "no timeout, no wait");
  } finally { await s.close(); }
});

test("waiting for updates (architecture §5.2): held open while the box has nothing after the number, answered the moment a line lands; at the time asked, answered empty", async () => {
  const { s, call, person } = await serve();
  try {
    const john = await person("john@example.com", "John"), li = await person("li@example.com", "李四");
    const g = (await call("POST", "/groups", { token: john.token, body: { as: john.avatar.id, name: "设置页改版" } })).body.venue;
    const code = (await call("GET", `/venues/${g.owner}/${g.id}/link?as=${john.avatar.id}`, { token: john.token })).body.link.code;
    await call("POST", `/i/${code}/join`, { token: li.token, body: { as: li.avatar.id } });
    const pts = (await call("GET", "/updates/state", { token: john.token })).body.pts;
    const started = Date.now();
    const waiting = call("GET", `/updates?pts=${pts}&timeout=10`, { token: john.token });
    setTimeout(() => { void call("POST", `/venues/${g.owner}/${g.id}/messages`, { token: li.token, body: { as: li.avatar.id, text: "我进来了" } }); }, 300);
    const got = (await waiting).body;
    assert.ok(Date.now() - started < 5000, "answered when the line landed, not at the time asked");
    assert.deepEqual(got.updates.map((u) => [u.pts, u.block.value.text]), [[pts + 1, "我进来了"]]);
    const quiet = Date.now();
    const none = (await call("GET", `/updates?pts=${got.pts}&timeout=1`, { token: john.token })).body;
    assert.deepEqual([none.updates, none.pts, none.final], [[], got.pts, true]);
    assert.ok(Date.now() - quiet >= 900, "held for the time asked");
  } finally { await s.close(); }
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run build && node --test test/avatar-box-api.test.mjs`

Expected: the build passes; there is no `/updates` path yet: `ℹ fail 2`.

- [ ] **Step 3: Write the code**

**In `src/relay/avatar-api.ts`, replace:**

```ts
  if (a === "me" && parts.length === 2 && b === "logout") return only("POST", () => answer(relay.logout(by)));
  // 需要你 (spec §7.3): an avatar asks; the person lists and answers.
```

**with:**

```ts
  if (a === "me" && parts.length === 2 && b === "logout") return only("POST", () => answer(relay.logout(by)));
  // The person's box (architecture §5.2): where it stands, the difference, and the wait (the shell holds an empty one open).
  if (a === "updates" && parts.length === 2 && b === "state") return only("GET", () => answer(relay.updatesState(by)));
  if (a === "updates" && (parts.length === 1 || (parts.length === 2 && b === "difference"))) return only("GET", () => answer(relay.difference(by, r.query)));
  // 需要你 (spec §7.3): an avatar asks; the person lists and answers.
```

**In `src/relay/avatar-server.ts`, replace:**

```ts
// documents it follows (`{"subscribe": "<avatar>/<doc>"}`): each block is
// pushed as it lands, as the client may read it — a venue's to its members,
// a message's `by` left out where its avatar does not mark.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
```

**with:**

```ts
// documents it follows (`{"subscribe": "<avatar>/<doc>"}`): each block is
// pushed as it lands, as the client may read it — a venue's to its members,
// a message's `by` left out where its avatar does not mark. `GET /updates`
// with a `timeout` is a person's wait on their box (architecture §5.2): held
// open, at most 25 seconds, until something lands after their `pts`.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
```

**In `src/relay/avatar-server.ts`, replace:**

```ts
import { upgrade, type WsConnection } from "./ws.js";
import type { Lang } from "../core/avatar/words.js";

export interface AvatarServer { port: number; url: string; relay: AvatarRelay; close(): Promise<void> }
```

**with:**

```ts
import { upgrade, type WsConnection } from "./ws.js";
import type { Lang } from "../core/avatar/words.js";
import { WAIT_MAX_S } from "../core/avatar/updates.js";

export interface AvatarServer { port: number; url: string; relay: AvatarRelay; close(): Promise<void> }
```

**In `src/relay/avatar-server.ts`, replace:**

```ts
  res.end(body);
}

/** How often the relay expires 需要你 cards and collects answers from its push channels. */
```

**with:**

```ts
  res.end(body);
}

/** How long a wait for updates may hold, in seconds: the `timeout` asked, at most WAIT_MAX_S; none asked, no wait. */
const waitOf = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.min(n, WAIT_MAX_S) : 0; };

/** How often the relay expires 需要你 cards and collects answers from its push channels. */
```

**In `src/relay/avatar-server.ts`, replace:**

```ts
        const base = o.publicUrl ?? `http://${req.headers["host"] ?? `${host}`}`;
        const r: AvatarRequest = { method: req.method ?? "GET", path: url.pathname, query, base, ...(o.version !== undefined ? { version: o.version } : {}), ...(languages !== undefined ? { languages } : {}), ...(req.socket.remoteAddress !== undefined ? { ip: req.socket.remoteAddress } : {}), ...(token !== undefined ? { token } : {}), ...(body !== undefined ? { body } : {}) };
        const out = routeAvatars(r, relay);
        reply(res, out.status, out.body, out.type);
```

**with:**

```ts
        const base = o.publicUrl ?? `http://${req.headers["host"] ?? `${host}`}`;
        const r: AvatarRequest = { method: req.method ?? "GET", path: url.pathname, query, base, ...(o.version !== undefined ? { version: o.version } : {}), ...(languages !== undefined ? { languages } : {}), ...(req.socket.remoteAddress !== undefined ? { ip: req.socket.remoteAddress } : {}), ...(token !== undefined ? { token } : {}), ...(body !== undefined ? { body } : {}) };
        // A wait for updates (architecture §5.2): answered at once when the box has something after `pts`, else held until it has or the time is up.
        const wait = r.method.toUpperCase() === "GET" && url.pathname === "/updates" ? waitOf(query["timeout"]) : 0;
        const by = wait > 0 && token !== undefined ? relay.verify(token) : undefined;
        const person = by === undefined ? undefined : relay.personOf(by);
        if (by !== undefined && person !== undefined) {
          const first = relay.difference(by, query);
          if (first.ok && "updates" in first && first.updates.length === 0) {
            await new Promise<void>((done) => {
              const timer = setTimeout(finish, wait * 1000);
              const off = relay.onBox(person, finish);
              res.once("close", finish);
              function finish(): void { clearTimeout(timer); off(); res.off("close", finish); done(); }
            });
            if (res.destroyed) return;
          }
        }
        const out = routeAvatars(r, relay);
        reply(res, out.status, out.body, out.type);
```

- [ ] **Step 4: Run it to see it pass**

Run: `npm run build && node --test test/avatar-box-api.test.mjs`

Expected: `ℹ pass 2`, `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/relay/avatar-api.ts src/relay/avatar-server.ts test/avatar-box-api.test.mjs
git commit -m "gemsbang Z3: the box over HTTP — state, difference, and a wait held open until something lands"
```


### Task 4: The client: a cache per chat, catching up by difference, a wait

**Files:**
- Modify: `src/gemsbang/home.ts` (`Cache`, `readCache`, `writeCache`, `clearCache`; `readMirror` and `writeMirror` over the cache)
- Modify: `src/gemsbang/ops.ts` (`sync` by difference, `wait`, the full read after the box's number; an update applied or a piece read again; `open` and a round's chat by catching up; the cache cleared on signing out and in)
- Test: `test/gemsbang-sync.test.mjs`

- [ ] **Step 1: Write the failing test**

**Create `test/gemsbang-sync.test.mjs`:**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startAvatarRelay } from "../dist/relay/avatar-server.js";
import { runGb } from "../dist/gemsbang/ops.js";

/** A service whose clock can jump; machines that sign in to it by email, each counting the paths it asks for. */
async function world() {
  const mail = [];
  let offset = 0;
  const now = () => new Date(Date.now() + offset).toISOString().replace(/\.\d{3}Z$/, "Z");
  const s = await startAvatarRelay({ root: mkdtempSync(join(tmpdir(), "gemsbang-sync-relay-")), name: "relay.test", now, mailer: (m) => { mail.push(m); } });
  const machine = () => {
    const home = mkdtempSync(join(tmpdir(), "gemsbang-sync-home-")), asked = [];
    const fetchImpl = (url, init) => { asked.push(`${init?.method ?? "GET"} ${new URL(url).pathname}`); return fetch(url, init); };
    const gb = (call, args = {}) => runGb(call, args, { home, now: now(), service: s.url, fetchImpl });
    return { home, gb, asked };
  };
  const ok = (x) => { assert.equal(x.ok, true, x.reason); return x; };
  const signIn = async (email, name) => {
    const m = machine();
    ok(await m.gb("login-start", { email }));
    ok(await m.gb("login-verify", { email, code: /(\d{6})/.exec(mail[mail.length - 1].text)[1] }));
    ok(await m.gb("first-avatar", { name }));
    return m;
  };
  return { s, machine, signIn, ok, jump: (ms) => { offset += ms; } };
}

test("the cache (architecture §6.1): the number the box was read to and each chat in a file of its own, its lines by id; signing out leaves nothing", async () => {
  const { s, signIn, ok } = await world();
  try {
    const john = await signIn("john@example.com", "John");
    const g = ok(await john.gb("group", { name: "设置页改版", as: ok(await john.gb("status")).view.avatars[0].id })).chat;
    const state = JSON.parse(readFileSync(join(john.home, "cache", "state.json"), "utf8"));
    assert.equal(typeof state.pts, "number");
    assert.deepEqual(state.venues, [`${g.owner}/${g.id}`]);
    assert.deepEqual(readdirSync(join(john.home, "cache", "venues")), [`${g.owner}-${g.id}.json`]);
    assert.equal(existsSync(join(john.home, "mirror.json")), false);
    ok(await john.gb("logout"));
    assert.equal(existsSync(join(john.home, "cache")), false);
  } finally { await s.close(); }
});

test("catching up (architecture §5.3): a line said elsewhere arrives with one difference — no chat read again; someone new in a chat, that chat read again; a wait answers the moment a line lands", async () => {
  const { s, signIn, ok } = await world();
  try {
    const john = await signIn("john@example.com", "John"), li = await signIn("li@example.com", "李四"), wang = await signIn("wang@example.com", "王五");
    const g = ok(await john.gb("group", { name: "设置页改版", as: ok(await john.gb("status")).view.avatars[0].id })).chat;
    const link = ok(await john.gb("link", { owner: g.owner, id: g.id })).link;
    ok(await li.gb("join", { url: link.url, as: ok(await li.gb("status")).view.avatars[0].id }));
    ok(await john.gb("status"));
    ok(await li.gb("say", { owner: g.owner, id: g.id, text: "Safari 里导出按钮没反应" }));
    john.asked.length = 0;
    const box = ok(await john.gb("status")).view;
    assert.deepEqual(box.rows.map((r) => [r.name, r.last.text, r.unread]), [["设置页改版", "Safari 里导出按钮没反应", 1]]);
    assert.deepEqual(john.asked, ["GET /updates/difference"], "one call, nothing read again");
    ok(await wang.gb("join", { url: link.url, as: ok(await wang.gb("status")).view.avatars[0].id }));
    john.asked.length = 0;
    const opened = ok(await john.gb("open", { owner: g.owner, id: g.id })).chat;
    assert.equal(opened.count, 3);
    assert.deepEqual(john.asked, ["GET /updates/difference", `GET /venues/${g.owner}/${g.id}`], "the chat with someone new read again");
    const started = Date.now();
    const waiting = john.gb("wait", { timeout: 10 });
    setTimeout(() => { void li.gb("say", { owner: g.owner, id: g.id, text: "我先看看" }); }, 300);
    const waited = ok(await waiting).view;
    assert.ok(Date.now() - started < 5000, "back when the line landed");
    assert.equal(waited.rows[0].last.text, "我先看看");
  } finally { await s.close(); }
});

test("too far behind (architecture §5.1): a machine back after more than a week reads everything again; out of reach, the cache as it was, with why", async () => {
  const { s, signIn, ok, jump } = await world();
  try {
    const john = await signIn("john@example.com", "John"), li = await signIn("li@example.com", "李四");
    const g = ok(await john.gb("group", { name: "设置页改版", as: ok(await john.gb("status")).view.avatars[0].id })).chat;
    const link = ok(await john.gb("link", { owner: g.owner, id: g.id })).link;
    ok(await li.gb("join", { url: link.url, as: ok(await li.gb("status")).view.avatars[0].id }));
    ok(await john.gb("status"));
    jump(8 * 86_400_000);
    ok(await li.gb("say", { owner: g.owner, id: g.id, text: "还在吗" }));
    jump(8 * 86_400_000);
    ok(await li.gb("say", { owner: g.owner, id: g.id, text: "周五见" }));
    john.asked.length = 0;
    const back = ok(await john.gb("status")).view;
    assert.deepEqual(john.asked.slice(0, 2), ["GET /updates/difference", "GET /updates/state"], "told it is too far behind, it starts over");
    assert.equal(back.rows[0].last.text, "周五见");
    await s.close();
    const out = ok(await john.gb("status")).view;
    assert.deepEqual([out.rows[0].last.text, typeof out.offline], ["周五见", "string"]);
  } finally { await s.close(); }
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run build && node --test test/gemsbang-sync.test.mjs`

Expected: the build passes; the client still keeps `mirror.json`, has no `wait` and reads every chat again: `ℹ fail 3`.

- [ ] **Step 3: Write the code**

**In `src/gemsbang/home.ts`, replace:**

```ts
// person's token and the tokens of the avatars an agent here plays, which
// session speaks for which avatar, the invitations not followed, a mirror of
// the chats as last read, and which line of each chat was last seen. Tokens
// are written for the owner alone; every write is atomic.
import { chmodSync, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
```

**with:**

```ts
// person's token and the tokens of the avatars an agent here plays, which
// session speaks for which avatar, the invitations not followed, the cache
// of the chats (architecture §6.1: `cache/state.json` with the number the
// person's box was read to, and `cache/venues/<owner>-<id>.json`, one chat
// each, its lines by id), and which line of each chat was last seen. Tokens
// are written for the owner alone; every write is atomic.
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
```

**In `src/gemsbang/home.ts`, replace:**

```ts
import { writeAtomic } from "../host-fs.js";
import type { Mirror } from "../core/avatar/inbox.js";
import { isLang, type Lang } from "../core/avatar/words.js";
```

**with:**

```ts
import { writeAtomic } from "../host-fs.js";
import { venueKey, type Mirror, type MirrorVenue } from "../core/avatar/inbox.js";
import { isLang, type Lang } from "../core/avatar/words.js";
```

**In `src/gemsbang/home.ts`, replace:**

```ts

export const CLIENT = "client.json", MIRROR = "mirror.json", SEEN = "seen.json";
```

**with:**

```ts

export const CLIENT = "client.json", CACHE = "cache", SEEN = "seen.json";
/** The single file the chats were kept in before the cache; read no more, removed when the cache is cleared. */
const OLD_MIRROR = "mirror.json";
const STATE = "state.json", VENUES = "venues";
const venueFile = (key: string): string => `${key.replace("/", "-")}.json`;
```

**In `src/gemsbang/home.ts`, replace:**

```ts

export function readMirror(home: string): Mirror | undefined {
  const m = readJson(join(home, MIRROR));
  return typeof m === "object" && m !== null && Array.isArray((m as Mirror).venues) && Array.isArray((m as Mirror).avatars) ? (m as Mirror) : undefined;
}

export const writeMirror = (home: string, m: Mirror): void => writeJson(join(home, MIRROR), m);
export const readSeen = (home: string): Record<string, string> => strings(readJson(join(home, SEEN)));
```

**with:**

```ts

/** The cache: the number the box was read to (none: read everything again), and the mirror with every chat. */
export interface Cache { pts?: number; mirror: Mirror }

export function readCache(home: string): Cache | undefined {
  const s = obj(readJson(join(home, CACHE, STATE)));
  if (!Array.isArray(s["venues"]) || !Array.isArray(s["avatars"])) return undefined;
  const { pts, venues: keys, ...rest } = s;
  const venues: MirrorVenue[] = [];
  for (const k of keys as unknown[]) {
    if (typeof k !== "string") continue;
    const v = readJson(join(home, CACHE, VENUES, venueFile(k))) as MirrorVenue | undefined;
    if (typeof v === "object" && v !== null && Array.isArray(v.blocks)) venues.push(v);
  }
  return { ...(typeof pts === "number" ? { pts } : {}), mirror: { ...(rest as unknown as Omit<Mirror, "venues">), venues } };
}

/** The cache written: the state, and the chats named in `only` (every chat when not given); a chat no longer there, its file removed. */
export function writeCache(home: string, c: Cache, only?: Iterable<string>): void {
  const { venues, ...rest } = c.mirror;
  const keys = venues.map((v) => venueKey(v.owner, v.id));
  const dir = join(home, CACHE, VENUES);
  mkdirSync(dir, { recursive: true });
  const write = new Set(only ?? keys);
  for (const v of venues) if (write.has(venueKey(v.owner, v.id))) writeJson(join(dir, venueFile(venueKey(v.owner, v.id))), v);
  const files = new Set(keys.map(venueFile));
  for (const f of readdirSync(dir)) if (!files.has(f)) rmSync(join(dir, f), { force: true });
  writeJson(join(home, CACHE, STATE), { ...rest, venues: keys, ...(c.pts !== undefined ? { pts: c.pts } : {}) });
}

/** Nothing kept of anyone's chats: on signing out, or in as someone. */
export function clearCache(home: string): void {
  rmSync(join(home, CACHE), { recursive: true, force: true });
  rmSync(join(home, OLD_MIRROR), { force: true });
}

export const readMirror = (home: string): Mirror | undefined => readCache(home)?.mirror;

/** The mirror written as it stands, the number its box was read to kept. */
export function writeMirror(home: string, m: Mirror, only?: Iterable<string>): void {
  const pts = obj(readJson(join(home, CACHE, STATE)))["pts"];
  writeCache(home, { ...(typeof pts === "number" ? { pts } : {}), mirror: m }, only);
}
export const readSeen = (home: string): Record<string, string> => strings(readJson(join(home, SEEN)));
```

**In `src/gemsbang/ops.ts`, replace:**

```ts
import { RelayClient, RelayDown, type Answer } from "../daemon/client.js";
import { readClient, readMirror, readSeen, writeClient, writeMirror, writeSeen, type Client } from "./home.js";
```

**with:**

```ts
import { RelayClient, RelayDown, type Answer } from "../daemon/client.js";
import { GAP_WAIT_MS, receive, WAIT_MAX_S, type SyncState, type Update } from "../core/avatar/updates.js";
import { clearCache, readCache, readClient, readMirror, readSeen, writeCache, writeClient, writeMirror, writeSeen, type Client } from "./home.js";
```

**In `src/gemsbang/ops.ts`, replace:**

```ts
const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
/** How this machine names itself to the service when it signs in: its system, and Claude Code. */
```

**with:**

```ts
const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
/** A chat keeps this many of its last lines on this machine. */
const CHAT_LINES = 200;
/** A sync reads at most this many answers of the box (a page each, or a gap filled) before it saves what it has. */
const SYNC_ROUNDS = 20;
/** The documents of an avatar of the person's whose update says to read a piece again. */
const PIECES: Readonly<Record<string, string>> = { "joined.geml": "venues", "needs.geml": "needs", "requests.geml": "needs", "work.geml": "work", "rules.geml": "marks", "templates.geml": "placeholders", "auto.geml": "autos" };
const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));
/** How this machine names itself to the service when it signs in: its system, and Claude Code. */
```

**In `src/gemsbang/ops.ts`, replace:**

```ts

  /** Every chat of every avatar read again and kept; out of reach, the last mirror with why. */
  async sync(): Promise<GbResult> {
    const last = readMirror(this.o.home);
    if (this.client.token === undefined) return { ok: true, view: this.view(undefined) };
    const me = await this.call("GET", "/me");
    if (this.isFail(me)) return me.code === "client.unreachable" ? { ok: true, view: this.view(last, me.reason) } : me;
    if (me.status === 401) { this.logoutLocal(); return { ok: true, view: this.view(undefined) }; }
    if (me.status !== 200) return this.refused(me);
    const meBody = obj(me.body);
    const lang = isLang(meBody["lang"]) ? meBody["lang"] : DEFAULT_LANG;
    if (this.client.lang !== lang) { this.client.lang = lang; this.save(); }
    const list = await this.call("GET", "/venues");
    if (this.isFail(list)) return { ok: true, view: this.view(last, list.reason) };
    if (list.status !== 200) return this.refused(list);
    const venues: MirrorVenue[] = [];
    for (const v of (list.body as Record<string, unknown>[]) ?? []) {
      const owner = str(v["owner"]), id = str(v["id"]), as = str(v["as"]);
      if (owner === undefined || id === undefined || as === undefined) continue;
      const one = await this.call("GET", `/venues/${owner}/${id}?as=${as}`);
      if (this.isFail(one)) return { ok: true, view: this.view(last, one.reason) };
      if (one.status !== 200) continue;
      const b = obj(one.body);
      const blocks = (Array.isArray(b["blocks"]) ? b["blocks"] : []) as MirrorVenue["blocks"];
      const venue = obj(b["venue"]);
      venues.push({ owner, id, kind: v["kind"] === "dm" ? "dm" : "group", name: str(venue["name"]) ?? str(v["name"]) ?? id, members: (Array.isArray(venue["members"]) ? venue["members"] : []) as MirrorVenue["members"], as, ...(b["rules"] !== undefined ? { rules: b["rules"] as MirrorVenue["rules"] } : {}), blocks: blocks.slice(-200) });
    }
    const avatars = (Array.isArray(meBody["avatars"]) ? meBody["avatars"] : []) as Mirror["avatars"];
    const marks: Record<string, boolean> = {};
    for (const a of avatars) {
      const rules = await this.call("GET", `/${a.id}/rules.geml`);
      const blocks = !this.isFail(rules) && rules.status === 200 ? ((obj(rules.body)["blocks"] ?? []) as { value: Record<string, unknown> }[]) : [];
      const latest = [...blocks].reverse().find((x) => typeof x.value["mark"] === "boolean");
      marks[a.id] = latest === undefined ? true : (latest.value["mark"] as boolean);
    }
    const defaultName = str(meBody["defaultName"]);
    const needs = await this.call("GET", "/needs");
    const open = !this.isFail(needs) && needs.status === 200 && Array.isArray(needs.body) ? (needs.body as Mirror["needs"]) : last?.needs ?? [];
    const placeholders: Record<string, string> = {};
    for (const a of avatars) {
      const t = await this.call("GET", `/${a.id}/templates.geml`);
      const blocks = !this.isFail(t) && t.status === 200 ? ((obj(t.body)["blocks"] ?? []) as { value: Record<string, unknown> }[]) : [];
      const latest = [...blocks].reverse().find((x) => "text" in x.value);
      if (typeof latest?.value["text"] === "string") placeholders[a.id] = latest.value["text"];
    }
    const autos: Record<string, string[]> = {};
    for (const a of avatars) {
      const t = await this.call("GET", `/${a.id}/auto.geml`);
      const blocks = !this.isFail(t) && t.status === 200 ? ((obj(t.body)["blocks"] ?? []) as { value: Record<string, unknown> }[]) : [];
      const on = new Map<string, boolean>();
      for (const b of blocks) if (typeof b.value["venue"] === "string") on.set(b.value["venue"], b.value["on"] === true);
      autos[a.id] = [...on].filter(([, v]) => v).map(([k]) => k);
    }
    const jobs = await this.call("GET", "/work");
    const work = !this.isFail(jobs) && jobs.status === 200 && Array.isArray(jobs.body) ? (jobs.body as MirrorWork[]) : last?.work ?? [];
    const m: Mirror = { at: this.o.now, relay: this.origin, person: str(meBody["person"]) ?? "", lang, ...(defaultName !== undefined ? { defaultName } : {}), avatars, venues, marks, needs: open, placeholders, work, autos };
    writeMirror(this.o.home, m);
    return { ok: true, view: this.view(m) };
  }
```

**with:**

```ts

  // --- the sync (architecture §5.3, §6.1) ---

  /** The token no longer works: signed out here. */
  private signedOut(): GbResult { this.logoutLocal(); this.save(); return { ok: true, view: this.view(undefined) }; }

  /** Out of reach: the cache as it was, with why; any other refusal as it is. */
  private offline(last: Mirror | undefined, f: Fail): GbResult { return f.code === "client.unreachable" ? { ok: true, view: this.view(last, f.reason) } : f; }

  /**
   * The chats brought up to date (architecture §5.3): from the number the
   * cache reached, the difference — or, given `wait` seconds, a wait on the
   * box — applied in order; a gap waits GAP_WAIT_MS, then the difference
   * fills it; pages are read to the box's end. No number yet, or too far
   * behind: everything read again. Out of reach: the cache as it was.
   */
  async sync(wait = 0): Promise<GbResult> {
    if (this.client.token === undefined) return { ok: true, view: this.view(undefined) };
    const cache = readCache(this.o.home);
    if (cache?.pts === undefined) return this.full(cache?.mirror);
    const m = cache.mirror, dirty = new Set<string>(), stale = new Set<string>();
    let s: SyncState = { pts: cache.pts, pending: [] }, waiting = wait > 0;
    for (let round = 0; round < SYNC_ROUNDS; round++) {
      const r = await this.call("GET", waiting ? `/updates?pts=${s.pts}&timeout=${wait}` : `/updates/difference?pts=${s.pts}`);
      waiting = false;
      if (this.isFail(r)) return this.offline(m, r);
      if (r.status === 401) return this.signedOut();
      if (r.status !== 200) return this.refused(r);
      const d = obj(r.body);
      if (d["tooLong"] === true) return this.full(m);
      const updates = (Array.isArray(d["updates"]) ? d["updates"] : []) as Update[];
      const got = receive(s, updates);
      s = got.state;
      for (const u of got.apply) this.applyUpdate(m, u, dirty, stale);
      if (got.gap) { await sleep(GAP_WAIT_MS); continue; }
      // Nothing after our number, and the box says it stands elsewhere: it is the truth.
      if (updates.length === 0 && typeof d["pts"] === "number") s = { pts: d["pts"], pending: [] };
      if (d["final"] !== false) break;
    }
    const refused = await this.refresh(m, stale, dirty);
    if (refused !== undefined) return refused;
    m.at = this.o.now;
    writeCache(this.o.home, { pts: s.pts, mirror: m }, dirty);
    return { ok: true, view: this.view(m) };
  }

  /** A wait on the box (architecture §5.2, §6.2): back the moment something lands, or after `timeout` seconds (at most 25), the chats up to date. */
  wait(args: Record<string, unknown>): Promise<GbResult> {
    const t = Number(args["timeout"]);
    return this.sync(Number.isFinite(t) && t > 0 ? Math.min(t, WAIT_MAX_S) : WAIT_MAX_S);
  }

  /** Everything read again, after the number the box stood at first, so nothing lands unseen in between. */
  private async full(last: Mirror | undefined): Promise<GbResult> {
    const state = await this.call("GET", "/updates/state");
    if (this.isFail(state)) return this.offline(last, state);
    if (state.status === 401) return this.signedOut();
    if (state.status !== 200) return this.refused(state);
    const pts = obj(state.body)["pts"];
    const m: Mirror = { at: this.o.now, relay: this.origin, person: "", lang: this.lang, avatars: [], venues: [], needs: last?.needs ?? [], work: last?.work ?? [] };
    const refused = await this.refresh(m, new Set(["me", "venues", "needs", "work"]), new Set(), last);
    if (refused !== undefined) return refused;
    writeCache(this.o.home, { ...(typeof pts === "number" ? { pts } : {}), mirror: m });
    return { ok: true, view: this.view(m) };
  }

  /** One update applied: a chat's line kept by its id (a member, a name, the link's rules: the chat read again too); anything else says which piece to read again. */
  private applyUpdate(m: Mirror, u: Update, dirty: Set<string>, stale: Set<string>): void {
    const v = /^venues\/([gd]-[0-9a-f]{10})\.geml$/.exec(u.doc);
    if (v !== null) {
      const venue = m.venues.find((x) => x.owner === u.owner && x.id === v[1]);
      if (venue === undefined) { stale.add("venues"); return; }
      const i = venue.blocks.findIndex((b) => b.id === u.block.id);
      if (i >= 0) venue.blocks[i] = u.block; else venue.blocks.push(u.block);
      if (venue.blocks.length > CHAT_LINES) venue.blocks = venue.blocks.slice(-CHAT_LINES);
      dirty.add(venueKey(venue.owner, venue.id));
      if (typeof u.block.value["text"] !== "string") stale.add(`venue:${venue.owner}/${venue.id}`);
      return;
    }
    if (u.owner === "_relay") { stale.add("me"); return; }
    if (u.doc === "avatar.geml") { if (m.avatars.some((a) => a.id === u.owner)) stale.add("me"); stale.add("venues"); return; }
    const piece = PIECES[u.doc];
    if (piece !== undefined) stale.add(piece);
  }

  /** The pieces an update said changed, read again into the mirror: the person (with their avatars' marks, waiting lines and 自动回), the list of chats (a new chat whole), one chat, 需要你, the jobs. */
  private async refresh(m: Mirror, stale: ReadonlySet<string>, dirty: Set<string>, last: Mirror | undefined = m): Promise<GbResult | undefined> {
    if (stale.has("me")) {
      const me = await this.call("GET", "/me");
      if (this.isFail(me)) return this.offline(last, me);
      if (me.status === 401) return this.signedOut();
      if (me.status !== 200) return this.refused(me);
      const b = obj(me.body);
      m.person = str(b["person"]) ?? m.person;
      m.lang = isLang(b["lang"]) ? b["lang"] : DEFAULT_LANG;
      if (this.client.lang !== m.lang) { this.client.lang = m.lang; this.save(); }
      const defaultName = str(b["defaultName"]);
      if (defaultName !== undefined) m.defaultName = defaultName; else delete m.defaultName;
      m.avatars = (Array.isArray(b["avatars"]) ? b["avatars"] : []) as Mirror["avatars"];
    }
    if (stale.has("me") || stale.has("marks")) m.marks = await this.latestOf(m.avatars, "rules.geml", (v) => (typeof v["mark"] === "boolean" ? v["mark"] : undefined), true);
    if (stale.has("me") || stale.has("placeholders")) {
      const texts = await this.latestOf(m.avatars, "templates.geml", (v) => ("text" in v ? (typeof v["text"] === "string" ? v["text"] : null) : undefined), null);
      m.placeholders = Object.fromEntries(Object.entries(texts).filter((e): e is [string, string] => typeof e[1] === "string"));
    }
    if (stale.has("me") || stale.has("autos")) {
      const autos: Record<string, string[]> = {};
      for (const a of m.avatars) {
        const on = new Map<string, boolean>();
        for (const v of await this.blocksOf(a.id, "auto.geml")) if (typeof v["venue"] === "string") on.set(v["venue"], v["on"] === true);
        autos[a.id] = [...on].filter(([, x]) => x).map(([k]) => k);
      }
      m.autos = autos;
    }
    if (stale.has("venues")) {
      const list = await this.call("GET", "/venues");
      if (this.isFail(list)) return this.offline(last, list);
      if (list.status !== 200) return this.refused(list);
      const next: MirrorVenue[] = [];
      for (const v of (Array.isArray(list.body) ? list.body : []) as Record<string, unknown>[]) {
        const owner = str(v["owner"]), id = str(v["id"]), as = str(v["as"]);
        if (owner === undefined || id === undefined || as === undefined) continue;
        const known = m.venues.find((x) => x.owner === owner && x.id === id);
        if (known !== undefined) {
          known.name = str(v["name"]) ?? known.name;
          if (Array.isArray(v["members"])) known.members = v["members"] as MirrorVenue["members"];
          known.as = as;
          next.push(known);
        } else {
          const one = await this.venueOf(owner, id, as, v);
          if (this.isFail(one)) return this.offline(last, one);
          if (one === undefined) continue;
          next.push(one);
        }
        dirty.add(venueKey(owner, id));
      }
      m.venues = next;
    }
    for (const k of stale) {
      const at = /^venue:([^/]+)\/(.+)$/.exec(k);
      const known = at === null ? undefined : m.venues.find((x) => x.owner === at[1] && x.id === at[2]);
      if (known === undefined) continue;
      const one = await this.venueOf(known.owner, known.id, known.as, {});
      if (this.isFail(one)) return this.offline(last, one);
      if (one !== undefined) { Object.assign(known, one); dirty.add(venueKey(known.owner, known.id)); }
    }
    if (stale.has("needs")) { const r = await this.call("GET", "/needs"); if (!this.isFail(r) && r.status === 200 && Array.isArray(r.body)) m.needs = r.body as Mirror["needs"]; }
    if (stale.has("work")) { const r = await this.call("GET", "/work"); if (!this.isFail(r) && r.status === 200 && Array.isArray(r.body)) m.work = r.body as MirrorWork[]; }
    return undefined;
  }

  /** One chat as the relay has it: its view, its link's rules, its last lines; gone, nothing. */
  private async venueOf(owner: string, id: string, as: string, listed: Record<string, unknown>): Promise<MirrorVenue | Fail | undefined> {
    const one = await this.call("GET", `/venues/${owner}/${id}?as=${as}`);
    if (this.isFail(one)) return one;
    if (one.status !== 200) return undefined;
    const b = obj(one.body), venue = obj(b["venue"]);
    const blocks = (Array.isArray(b["blocks"]) ? b["blocks"] : []) as MirrorVenue["blocks"];
    return { owner, id, kind: (venue["kind"] ?? listed["kind"]) === "dm" ? "dm" : "group", name: str(venue["name"]) ?? str(listed["name"]) ?? id, members: (Array.isArray(venue["members"]) ? venue["members"] : []) as MirrorVenue["members"], as, ...(b["rules"] !== undefined ? { rules: b["rules"] as MirrorVenue["rules"] } : {}), blocks: blocks.slice(-CHAT_LINES) };
  }

  /** The blocks' values of one of an avatar's own documents; out of reach or refused, none. */
  private async blocksOf(avatar: string, doc: string): Promise<Record<string, unknown>[]> {
    const r = await this.call("GET", `/${avatar}/${doc}`);
    return !this.isFail(r) && r.status === 200 ? ((obj(r.body)["blocks"] ?? []) as { value: Record<string, unknown> }[]).map((b) => b.value) : [];
  }

  /** Per avatar, the latest value `pick` finds in one of its documents, else `none`. */
  private async latestOf<T>(avatars: readonly { id: string }[], doc: string, pick: (v: Record<string, unknown>) => T | undefined, none: T): Promise<Record<string, T>> {
    const out: Record<string, T> = {};
    for (const a of avatars) {
      let latest = none;
      for (const v of await this.blocksOf(a.id, doc)) { const x = pick(v); if (x !== undefined) latest = x; }
      out[a.id] = latest;
    }
    return out;
  }
```

**In `src/gemsbang/ops.ts`, replace:**

```ts
    const b = obj(r.body);
    this.client.token = str(b["token"]);
```

**with:**

```ts
    const b = obj(r.body);
    clearCache(this.o.home);
    this.client.token = str(b["token"]);
```

**In `src/gemsbang/ops.ts`, replace:**

```ts
  private logoutLocal(): void {
    delete this.client.token;
```

**with:**

```ts
  private logoutLocal(): void {
    clearCache(this.o.home);
    delete this.client.token;
```

**In `src/gemsbang/ops.ts`, replace:**

```ts

  /** One chat read again, kept in the mirror, its last line marked seen. */
  async open(args: Record<string, unknown>): Promise<GbResult> {
    const owner = str(args["owner"]) ?? "", id = str(args["id"]) ?? "";
    const at = this.mirrorVenue(owner, id);
    if (at === undefined) return this.fail("client.noVenue");
    const r = await this.call("GET", `/venues/${owner}/${id}?as=${at.v.as}`);
    if (!this.isFail(r) && r.status === 200) {
      const b = obj(r.body);
      at.v.blocks = ((Array.isArray(b["blocks"]) ? b["blocks"] : []) as MirrorVenue["blocks"]).slice(-200);
      const venue = obj(b["venue"]);
      if (Array.isArray(venue["members"])) at.v.members = venue["members"] as MirrorVenue["members"];
      if (b["rules"] !== undefined) at.v.rules = b["rules"] as MirrorVenue["rules"];
      writeMirror(this.o.home, at.m);
    }
    const said = itemsOf(at.v).filter((i) => i.kind === "message");
```

**with:**

```ts

  /** One chat brought up to date and shown, its last line marked seen. */
  async open(args: Record<string, unknown>): Promise<GbResult> {
    const owner = str(args["owner"]) ?? "", id = str(args["id"]) ?? "";
    if (this.mirrorVenue(owner, id) === undefined) return this.fail("client.noVenue");
    const synced = await this.sync();
    if (!synced.ok) return synced;
    const at = this.mirrorVenue(owner, id);
    if (at === undefined) return this.fail("client.noVenue");
    const said = itemsOf(at.v).filter((i) => i.kind === "message");
```

**In `src/gemsbang/ops.ts`, replace:**

```ts
    if (lastId !== undefined) { const seen = readSeen(this.o.home); seen[venueKey(owner, id)] = lastId; writeSeen(this.o.home, seen); }
    return { ok: true, chat: this.chat(at.m, at.v), view: this.view(at.m, this.isFail(r) ? r.reason : undefined) };
  }
```

**with:**

```ts
    if (lastId !== undefined) { const seen = readSeen(this.o.home); seen[venueKey(owner, id)] = lastId; writeSeen(this.o.home, seen); }
    return { ok: true, chat: this.chat(at.m, at.v), view: this.view(at.m, synced.view?.offline) };
  }
```

**In `src/gemsbang/ops.ts`, replace:**

```ts

  /** The chat read again into the mirror, without marking it seen: a round reads what is there now. */
  private async refresh(owner: string, id: string): Promise<{ m: Mirror; v: MirrorVenue } | undefined> {
    const at = this.mirrorVenue(owner, id);
    if (at === undefined) return undefined;
    const r = await this.call("GET", `/venues/${owner}/${id}?as=${at.v.as}`);
    if (!this.isFail(r) && r.status === 200) {
      at.v.blocks = ((Array.isArray(obj(r.body)["blocks"]) ? obj(r.body)["blocks"] : []) as MirrorVenue["blocks"]).slice(-200);
      writeMirror(this.o.home, at.m);
    }
    return at;
  }
```

**with:**

```ts

  /** The chat brought up to date, without marking it seen: a round reads what is there now. */
  private async current(owner: string, id: string): Promise<{ m: Mirror; v: MirrorVenue } | undefined> {
    if (this.mirrorVenue(owner, id) === undefined) return undefined;
    await this.sync();
    return this.mirrorVenue(owner, id);
  }
```

**In `src/gemsbang/ops.ts`, replace:**

```ts
    if (choice !== "reply" && choice !== "auto" && choice !== "no") return this.fail("call.choice");
    const at = await this.refresh(owner, id);
    const name = at?.m.avatars.find((a) => a.id === avatar)?.name;
```

**with:**

```ts
    if (choice !== "reply" && choice !== "auto" && choice !== "no") return this.fail("call.choice");
    const at = await this.current(owner, id);
    const name = at?.m.avatars.find((a) => a.id === avatar)?.name;
```

**In `src/gemsbang/ops.ts`, replace:**

```ts
/** The calls the bridge answers, by name. */
export const GB_CALLS = ["status", "setup", "login-start", "login-verify", "logout", "first-avatar", "account", "method-start", "method-verify", "method-remove", "device-revoke", "devices-revoke-others", "open", "say", "group", "link", "rotate", "link-rules", "rename", "mark", "default-name", "lang", "bind", "note", "link-info", "join", "answer", "mute", "placeholder", "wake", "auto", "rounds", "round-done", "repo", "work-take", "work-done", "work-now", "tool-read", "tool-say", "tool-ask"] as const;
export type GbCall = (typeof GB_CALLS)[number];
```

**with:**

```ts
/** The calls the bridge answers, by name. */
export const GB_CALLS = ["status", "wait", "setup", "login-start", "login-verify", "logout", "first-avatar", "account", "method-start", "method-verify", "method-remove", "device-revoke", "devices-revoke-others", "open", "say", "group", "link", "rotate", "link-rules", "rename", "mark", "default-name", "lang", "bind", "note", "link-info", "join", "answer", "mute", "placeholder", "wake", "auto", "rounds", "round-done", "repo", "work-take", "work-done", "work-now", "tool-read", "tool-say", "tool-ask"] as const;
export type GbCall = (typeof GB_CALLS)[number];
```

**In `src/gemsbang/ops.ts`, replace:**

```ts
    case "status": return gb.sync();
    case "setup": return gb.setup(args);
```

**with:**

```ts
    case "status": return gb.sync();
    case "wait": return gb.wait(args);
    case "setup": return gb.setup(args);
```

- [ ] **Step 4: Run them to see them pass**

Run: `npm run build && node --test test/gemsbang-sync.test.mjs`

Expected: `ℹ pass 3`, `ℹ fail 0`.

Run: `node --test --test-concurrency=4 test/gemsbang*.test.mjs test/bridge-gemsbang.test.mjs test/gb-*.test.mjs test/hooks-types.test.mjs`

Expected: the client's and the pane's other suites and the module's type check pass as before: `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/gemsbang/home.ts src/gemsbang/ops.ts test/gemsbang-sync.test.mjs
git commit -m "gemsbang Z4: the client keeps a cache per chat and catches up by difference; a wait; a week behind, read again"
```


### Task 5: The plugin waits on the box

**Files:**
- Modify: `hooks/register.tsx` (no 30-second poll: a chain of waits while someone is signed in, started at the start and on sign-in; jobs and rounds picked up at the start and after a wait that brought something)
- Test: `tests/hooks.test.ts` (the waits; a bridge that does not answer, said at its first miss past two minutes)

- [ ] **Step 1: Write the failing test**

**In `tests/hooks.test.ts`, replace:**

```ts
  expect(await bandText($)).toBe('实现 #12 设置页缓存写路径')
  await clock.advance(121_000)
  await $.command.run({ command: 'gemsbang', args: '', origin: COMPOSER, presentation: PRESENTATION })
```

**with:**

```ts
  expect(await bandText($)).toBe('实现 #12 设置页缓存写路径')
  await clock.advance(119_000)
  expect(await bandText($), 'missed for less than two minutes: still quiet').toBe('实现 #12 设置页缓存写路径')
  // The start is tried again at 5, 20, 50, 110 and 170 seconds: the first miss past two minutes says so.
  await clock.advance(52_000)
  await $.command.run({ command: 'gemsbang', args: '', origin: COMPOSER, presentation: PRESENTATION })
```

**In `tests/hooks.test.ts`, replace:**

```ts
  expect(after.includes('网页 · Safari'), after).toBe(false)
})
```

**with:**

```ts
  expect(after.includes('网页 · Safari'), after).toBe(false)
})

test('the box (architecture §5.2, §6.2): no poll — the module waits on the box through the client, 25 seconds a wait, one after another; what a wait brings shows at once; nobody signed in, the waits stop until someone signs in', async ($, on) => {
  const w = world(on)
  const clock = await start($, on)
  await clock.advance(1_000)
  expect(calls(w, 'wait')[0]?.args).toEqual({ timeout: 25 })
  expect(calls(w, 'status').length, 'one read at the start, none after').toBe(1)
  w.answers['wait'] = () => { w.view = VIEW({ rows: [{ ...ROW, last: { who: '李四', text: '导出修好了吗' }, unread: 3 }, ROW2], unread: 3 }); return { ok: true, view: w.view } }
  await clock.advance(1_000)
  expect(await paneText($)).toContain('导出修好了吗')
  w.answers['wait'] = () => { w.view = VIEW({ loggedIn: false, avatars: [], rows: [], unread: 0 }); return { ok: true, view: w.view } }
  await clock.advance(1_000)
  const stopped = calls(w, 'wait').length
  await clock.advance(60_000)
  expect(calls(w, 'wait').length, 'nobody signed in: no waits').toBe(stopped)
  w.answers['login-start'] = () => ({ ok: true, text: '验证码已发到 j***@example.com', info: { to: 'j***@example.com' } })
  w.answers['login-verify'] = () => { w.view = VIEW(); return { ok: true, view: w.view } }
  delete w.answers['wait']
  let pane = await mountPane($)
  await pane.input({ key: 'email', text: 'john@example.com' })
  await pane.unmount()
  pane = await mountPane($)
  await pane.input({ key: 'code', text: '123456' })
  await pane.unmount()
  await clock.advance(1_000)
  expect(calls(w, 'wait').length > stopped, 'signed in: waiting again').toBe(true)
})
```

**In `tests/hooks.test.ts`, replace:**

```ts

test('被叫到 (architecture §6.3): a call shows in the pane and on the line with 回, 以后这个群自动回, 不回; 回 starts an agent in the background with the round\'s prompt, which may use no tool, and its answer goes back as the avatar; a chat set to answer on its own is answered at the poll by the session that speaks for the avatar', async ($, on) => {
  const w = world(on)
```

**with:**

```ts

test('被叫到 (architecture §6.3): a call shows in the pane and on the line with 回, 以后这个群自动回, 不回; 回 starts an agent in the background with the round\'s prompt, which may use no tool, and its answer goes back as the avatar; a chat set to answer on its own is answered, after the wait that brings it, by the session that speaks for the avatar', async ($, on) => {
  const w = world(on)
```

**In `tests/hooks.test.ts`, replace:**

```ts
  expect((await $.tool.call({ tool: 'Bash', tool_use_id: 'r3', command: 'ls', agentId: 'agent-1' } as never)).deny, 'its round over, the agent is no longer held').toBeUndefined()
  // A chat that answers on its own: the session that speaks for the avatar runs its round at the poll.
  w.view = VIEW({ bodies: { [SESSION]: JOHN.id } })
```

**with:**

```ts
  expect((await $.tool.call({ tool: 'Bash', tool_use_id: 'r3', command: 'ls', agentId: 'agent-1' } as never)).deny, 'its round over, the agent is no longer held').toBeUndefined()
  // A chat that answers on its own: the session that speaks for the avatar runs its round once a wait brings it.
  w.view = VIEW({ bodies: { [SESSION]: JOHN.id } })
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run build && claude plugin test .`

Expected: the build passes; the module still reads every chat every 30 seconds, so the test of the waits fails: `1 fail`, `14 pass`.

- [ ] **Step 3: Write the code**

**In `hooks/register.tsx`, replace:**

```tsx
// does not parse, every call goes through and the line says what is wrong.
import type { EngineInterface, Register, ToolCallResult } from 'claude-code'
```

**with:**

```tsx
// does not parse, every call goes through and the line says what is wrong.
// No poll and no resident process (architecture §6.2): while someone is
// signed in, the module waits on their box through the client, at most 25
// seconds a wait, one after another, and what a wait brings shows at once.
import type { EngineInterface, Register, ToolCallResult } from 'claude-code'
```

**In `hooks/register.tsx`, replace:**

```tsx
const QUIET_MS = 120_000
/** How often the chats are read again while nothing else asks. */
const POLL_MS = 30_000
```

**with:**

```tsx
const QUIET_MS = 120_000
/** A wait on the box (architecture §5.2): this many seconds at most, the bridge given this long to answer; the next wait this soon after one came back, or this long after one failed. */
const WAIT_S = 25
const WAIT_TIMEOUT_MS = 45_000
const WAIT_AGAIN_MS = 1_000
const WAIT_RETRY_MS = 10_000
```

**In `hooks/register.tsx`, replace:**

```tsx
  startTries = 0
}
```

**with:**

```tsx
  startTries = 0
  await afterSync($)
  startWaiting($)
}
```

**In `hooks/register.tsx`, replace:**

```tsx
  await gb($, 'status', {}, SLOW_TIMEOUT_MS)
  await pickUp($)
```

**with:**

```tsx
  await gb($, 'status', {}, SLOW_TIMEOUT_MS)
  await afterSync($)
}

/** After the chats came up to date: this session's jobs and rounds picked up, the chat open shown as it is now. */
async function afterSync($: EngineInterface): Promise<void> {
  await pickUp($)
```

**In `hooks/register.tsx`, replace:**

```tsx
  if (chat !== null && (page === 'chat' || page === 'invite')) await gb($, 'open', { owner: chat.owner, id: chat.id })
}
```

**with:**

```tsx
  if (chat !== null && (page === 'chat' || page === 'invite')) await gb($, 'open', { owner: chat.owner, id: chat.id })
}

let waitAlive = false

/** The waits on the box begin, unless they already run: one after another while someone is signed in. */
function startWaiting($: EngineInterface): void {
  if (waitAlive) return
  waitAlive = true
  $.clock.after(0, () => { void waitRound($).catch(() => { waitAlive = false }) })
}

/** One wait on the box (architecture §6.2): back the moment something lands, or after WAIT_S; what it brought shows, then the next. Nobody signed in, the waits stop until someone is. */
async function waitRound($: EngineInterface): Promise<void> {
  const before = JSON.stringify(await read($, viewAtom))
  const r = await gb($, 'wait', { timeout: WAIT_S }, WAIT_TIMEOUT_MS)
  if (r?.ok === true && JSON.stringify(await read($, viewAtom)) !== before) await afterSync($)
  if (r?.ok === true && (await readView($))?.loggedIn !== true) { waitAlive = false; return }
  $.clock.after(r?.ok === true ? WAIT_AGAIN_MS : WAIT_RETRY_MS, () => { void waitRound($).catch(() => { waitAlive = false }) })
}
```

**In `hooks/register.tsx`, replace:**

```tsx
    if (!in_.ok) return in_.reason
    l = await langNow($)
```

**with:**

```tsx
    if (!in_.ok) return in_.reason
    startWaiting($)
    l = await langNow($)
```

**In `hooks/register.tsx`, replace:**

```tsx
  if (r?.ok !== true) return
  if (a.call === 'login-verify') { await update($, addressAtom, () => null); await update($, pageAtom, () => 'inbox') }
  if (a.call === 'method-verify') { await update($, addingAtom, () => null); await account($, Promise.resolve(r)) }
```

**with:**

```tsx
  if (r?.ok !== true) return
  if (a.call === 'login-verify') { await update($, addressAtom, () => null); await update($, pageAtom, () => 'inbox'); startWaiting($) }
  if (a.call === 'method-verify') { await update($, addingAtom, () => null); await account($, Promise.resolve(r)) }
```

**In `hooks/register.tsx`, replace:**

```tsx
    await startBridge($)
    $.clock.every(POLL_MS, () => { void reload($).catch(() => undefined) })
    return next(e)
```

**with:**

```tsx
    await startBridge($)
    return next(e)
```

- [ ] **Step 4: Run it to see it pass**

Run: `npm run build && claude plugin test .`

Expected: `15 pass`, `0 fail`.

- [ ] **Step 5: Type-check the module**

Run: `node --test test/hooks-types.test.mjs`

Expected: `ℹ pass 1`, `ℹ fail 0`.

- [ ] **Step 6: Commit**

```bash
git add hooks/register.tsx tests/hooks.test.ts
git commit -m "gemsbang Z5: the plugin waits on the box instead of reading every chat every 30 seconds"
```


### Task 6: The version and the four gates

**Files:**
- Modify: `package.json`, `package-lock.json`, `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json` (by the script)

- [ ] **Step 1: Bump the patch version**

```bash
node scripts/bump.mjs 0.5.11
```

- [ ] **Step 2: Run the four gates**

Run each as its own command and note the result:

```bash
npm run build
claude plugin validate .
claude plugin test .
node --test --test-concurrency=2 test/*.test.mjs
```

Expected: build passes; validate passes (the root `CLAUDE.md` warning it has always shown is not new); the plugin suite passes its 15; the node suite passes, with ten more tests than before this plan.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json .claude-plugin/plugin.json .codex-plugin/plugin.json
git commit -m "gemsbang 0.5.11: the box and the sync — a cache per chat, differences, waits instead of the poll (plan Z)"
```

