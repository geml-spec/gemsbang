# IM Plan J: Digests, the Social Secretary, Public Rooms, 牵线

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The rest of §11 (⑦): 日报动态 the agent drafts and the owner nods to (rule 6's second source), only public things; the 社交秘书's first word in a guest DM (who I am, for whom, the owner is away, their latest public thing, what a guest can do); 公共房间 anyone may join where an agent is 只潜水 by default, 被问才答 or 可以搭话 by the owner's choice (§7.4), and agents never talk to each other; 牵线 by the owners' public works, both nodding before the cards show.

**Architecture:** `src/core/im/social.ts` (pure) holds the three modes and their words, the reception text, the digest's rule and need words, the match's words and the keyword rule. The venue kind `room` joins `venue.ts`; `delivery.ts` learns an agent's mode in a venue: a lurker is never prompted, a chatty one also by a mid-sentence mention or a reply to its own word. The relay keeps the mode on the agent's page, drafts in `digests/<person>.geml` (owner-only) and published digests on the public page, proposals in `matches/<id>.geml` under the proposer; the inbox gets 定 for a draft and for a proposal; a reception system message opens every guest DM. The daemon follows the agents' pages (the mode, and plan K's declaration), answers the new needs through the outbox, and writes the reception line under a first question's envelope.

**Tech Stack:** TypeScript (`src/core` pure, `src/relay`, `src/daemon`, `src/bridge.ts`), `node:test` over `dist/`.

**Before this plan:** plans A–I are on `main` (0.3.2).

---

## File structure

| File | Responsibility |
|---|---|
| `src/core/im/social.ts` (new) | `SocialMode`, `MODE_WORDS`, `modeOf`; `receptionText`, `RECEPTION_PREFIX`; `digestFault`, `digestHead`, `digestNeedText`, `DIGEST_ACTIONS`; `keywordsOf`, `sharedKeywords`, `matchNeedText`, `ownMatchNeedText`, `MATCH_ACTIONS`, `nameCard`, `MATCHED_TEXT`. |
| `src/core/im/venue.ts` | The kind `room` and its row. |
| `src/core/im/delivery.ts` | `AgentInVenue.mode`, `DeliveryInput.repliedTo`; the lurker degraded, the chatty one prompted by a mention or a reply. |
| `src/relay/relay.ts` | `socialModeOf`, `setSocialMode`, rooms (`listRooms`, `joinRoom`), the reception message, digests (`draftDigest`, `answerDigest`, `digestsOf`), matches (`proposeMatch`, `answerMatch`, `suggestMatches`), the inbox's 定 for drafts and proposals. |
| `src/relay/api.ts` | `/rooms`, `/rooms/<o>/<id>/join`, `/agents/<name>/social`, `/digests`, `/digests/answer`, `/digests/<person>`, `/match`, `/match/suggest`, `/match/<o>/<id>/answer`. |
| `src/daemon/home.ts`, `sync.ts`, `deliver.ts`, `view.ts`, `src/bridge.ts` | The outbox kinds `digest` and `match`; the agents' pages followed; `answerDigest`, `answerMatch`; the reception line; the room row's mode. |
| `src/cli.ts` | `connect room new|list|join`, `connect mode`, `connect digest`, `connect match`. |
| Tests | `test/social.test.mjs`, `test/relay-social.test.mjs`, `test/social-cli.test.mjs` new; `test/im-venue.test.mjs`, `test/im-delivery.test.mjs`, `test/relay-share.test.mjs`, `test/daemon-deliver.test.mjs`, `test/daemon-sync.test.mjs`, `test/daemon-card.test.mjs`, `test/daemon-cli.test.mjs`, `test/daemon-view.test.mjs`, `test/bridge-im.test.mjs` learn the rest. |

---

### Task 1: Branch and baseline

- [ ] **Step 1: Branch from main**

```bash
git switch -c im/j-social
git log --oneline -1
```
Expected: `c5a094c gemsbang 0.3.2: login, registration, the hosted agent's account, the pages` (or later on main).

- [ ] **Step 2: Baseline**

```bash
node --test --test-concurrency=2 test/*.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
```
Expected: `ℹ pass 937`, `ℹ fail 0`.

---

### Task 2: The pure parts: the words and rules, the room kind, the modes in delivery

**Files:**
- Create: `src/core/im/social.ts`
- Modify: `src/core/im/venue.ts`, `src/core/im/envelope.ts`, `src/core/im/delivery.ts`
- Modify: `test/im-venue.test.mjs`, `test/im-envelope.test.mjs`, `test/im-delivery.test.mjs`
- Test: `test/social.test.mjs`

- [ ] **Step 1: Write the failing tests**

```js
// test/social.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MODE, DIGEST_ACTIONS, DIGEST_LIMIT, digestFault, digestHead, digestNeedText, keywordsOf, MATCH_ACTIONS, MATCHED_TEXT, matchNeedText, MODE_WORDS, modeOf, nameCard, ownMatchNeedText, RECEPTION_PREFIX, receptionText, sharedKeywords } from "../dist/core/im/social.js";

test("the three modes (§7.4): 只潜水 by default; a word for each; anything else is the default", () => {
  assert.deepEqual(MODE_WORDS, { lurk: "只潜水", ask: "被问才答", chat: "可以搭话" });
  assert.equal(DEFAULT_MODE, "lurk");
  assert.deepEqual(["lurk", "ask", "chat", "nope", undefined, 3].map(modeOf), ["lurk", "ask", "chat", "lurk", "lurk", "lurk"]);
});

test("the social secretary's first word (§11): who I am, for whom, the owner is away, their latest public thing when there is one, what a guest can do", () => {
  assert.equal(receptionText("xiaoping", "john", "设置页导出 PDF"), "接待：第一句自报家门——我是 xiaoping，代 john；john 现在不在；john 最近公开的一件事：设置页导出 PDF；访客可以留言，或问公开范围内的。");
  assert.equal(receptionText("xiaoping", "john"), "接待：第一句自报家门——我是 xiaoping，代 john；john 现在不在；访客可以留言，或问公开范围内的。");
  assert.ok(receptionText("a", "b").startsWith(RECEPTION_PREFIX));
});

test("a digest (§11): a body of at most a thousand characters; its head for the need; the owner's three answers", () => {
  assert.equal(digestFault("今天把缓存修好了。"), undefined);
  assert.equal(digestFault("  "), "日报要有正文");
  assert.equal(digestFault(7), "日报要有正文");
  assert.equal(digestFault("字".repeat(DIGEST_LIMIT + 1)), "日报最多 1000 字");
  assert.equal(digestHead("今天把设置页的缓存写路径修好了，顺手把导出 PDF 的按钮也挪到了右上角，明天接着做样式。"), "今天把设置页的缓存写路径修好了，顺手把导出 PDF 的按钮也挪到了右上角，明天接…");
  assert.equal(digestHead(" 短的 "), "短的");
  assert.equal(digestNeedText("xiaoping", "今天把缓存修好了。"), "xiaoping 起草了日报：今天把缓存修好了。");
  assert.deepEqual(DIGEST_ACTIONS, ["发", "不发", "自己写"]);
});

test("牵线 (§11): the words of public works, two characters or more, lowered, marks and blanks dropped; what two people share; the need's words; the name card", () => {
  assert.deepEqual(keywordsOf(["设置页导出 PDF，能跑的", "src/settings/* 和这 63 轮的记录"]), ["设置页导出", "pdf", "能跑的", "src", "settings", "和这", "63", "轮的记录"]);
  assert.deepEqual(sharedKeywords(["pdf", "设置页导出", "react"], ["react", "pdf", "vue"]), ["pdf", "react"]);
  assert.equal(matchNeedText("john", true), "牵线：john 的 agent 觉得你们合得来");
  assert.equal(matchNeedText("lisi", false, "都在做 PDF 导出"), "牵线：lisi 想和你互相亮名片：都在做 PDF 导出");
  assert.equal(ownMatchNeedText("xiaoping", "lisi"), "你的 agent xiaoping 想替你和 lisi 牵线，亮名片吗？");
  assert.deepEqual(MATCH_ACTIONS, ["亮名片", "不用"]);
  assert.equal(nameCard("john", ["xiaoping", "helper"], "设置页导出 PDF"), "名片：john · agent xiaoping、helper · 最近公开：设置页导出 PDF");
  assert.equal(nameCard("lisi", []), "名片：lisi");
  assert.equal(MATCHED_TEXT, "牵线成功：双方亮名片");
});
```

In `test/im-venue.test.mjs`, `  assert.deepEqual(VENUE_WORDS, { dm: "私信", "guest-dm": "访客私信", group: "群", thread: "线程", channel: "订阅频道" });` becomes `  assert.deepEqual(VENUE_WORDS, { dm: "私信", "guest-dm": "访客私信", group: "群", thread: "线程", channel: "订阅频道", room: "房间" });` and after `  assert.equal(listRow({ ...g, id: "d-1", kind: "dm", name: "小评" }, { unread: 0 }).status, "就是会话本身");`:

```js
  assert.deepEqual(listRow({ ...g, id: "r-1", kind: "room", name: "前端茶水间" }, { unread: 4, mode: "小评 只潜水" }), { kind: "房间", name: "前端茶水间", status: "3 人 · 小评 只潜水", unread: 4 });
  assert.equal(listRow({ ...g, id: "r-1", kind: "room", name: "前端茶水间" }, { unread: 0 }).status, "3 人 · 自己的 agent 不在");
```

Append to `test/im-envelope.test.mjs`:

```js
test("a room's envelope (§7.4): the reply goes back to the room, or to the owner first", async () => {
  const { replyWords, venueLabel } = await import("../dist/core/im/envelope.js");
  assert.deepEqual([replyWords("room", false), replyWords("room", true), venueLabel("room", "前端茶水间")], ["回复将发回该房间，成员可见", "回复先给主人过目，再发回该房间", "房间「前端茶水间」"]);
});
```

Append to `test/im-delivery.test.mjs`:

```js
test("a room (§7.4): a lurker is never prompted, even by a leading @; one in 被问才答 as in a group; one in 可以搭话 also by a mid-sentence mention or a reply to its own word, from a person only", () => {
  const room = { ...g, id: "r-1", kind: "room", name: "前端茶水间" };
  const lurk = { ...agents[0], mode: "lurk" }, ask = { ...agents[0], mode: "ask" }, chat = { ...agents[0], mode: "chat" };
  assert.deepEqual(deliver(msg("@小评 看看", lisi), { venue: room, agents: [lurk], roster }), { ...nothing, degraded: [{ agent: "小评", reason: "只潜水" }] });
  assert.deepEqual(deliver(msg("@小评 看看", lisi), { venue: room, agents: [ask], roster }).prompts, [{ agent: "小评", level: "trusted", hops: 0 }]);
  assert.deepEqual(deliver(msg("刚才 @小评 说的对", lisi), { venue: room, agents: [ask], roster }), { ...nothing, mentioned: ["小评"] });
  assert.deepEqual(deliver(msg("刚才 @小评 说的对", lisi), { venue: room, agents: [chat], roster }), { ...nothing, mentioned: ["小评"], prompts: [{ agent: "小评", level: "trusted", hops: 0, via: "提到" }] });
  assert.deepEqual(deliver(msg("不对吧", lisi, { replyTo: "m-0" }), { venue: room, agents: [chat], roster, repliedTo: "agent:xiaoping@john" }).prompts, [{ agent: "小评", level: "trusted", hops: 0, via: "回复" }]);
  assert.deepEqual(deliver(msg("不对吧", lisi, { replyTo: "m-0" }), { venue: room, agents: [chat], roster, repliedTo: "person:john" }), nothing, "a reply to someone else");
  assert.deepEqual(deliver(msg("@小评 看看 @小评", lisi), { venue: room, agents: [chat], roster }).prompts.length, 1, "called and mentioned: once");
  const other = { name: "小测", speaker: "agent:xiaoce@zhangsan", relations: relXc, mode: "chat" };
  assert.deepEqual(deliver(msg("刚才 @小评 说的对", other.speaker === "x" ? john : { kind: "agent", name: "xiaoce", owner: "zhangsan" }), { venue: room, agents: [chat, other], roster, handling: 0 }), { ...nothing, mentioned: ["小评"] }, "an agent's mention prompts no chatty agent");
});
```

- [ ] **Step 2: Run them to see them fail**

```bash
node --test test/social.test.mjs test/im-venue.test.mjs test/im-delivery.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
```
Expected: `ℹ fail 3` or more.

- [ ] **Step 3: Write `src/core/im/social.ts`**

```ts
// The social side (§11, §7.4): a room is a group anyone may join, where an
// agent is in one of three modes — 只潜水 (the default), 被问才答, 可以搭话 —
// and agents never talk to each other; the social secretary's first word
// in a guest DM; a digest the agent drafts and the owner nods to (rule 6's
// second source), only public things; 牵线 by the owners' public works,
// both nodding before the cards show. Pure: words and rules.

export type SocialMode = "lurk" | "ask" | "chat";
export const MODE_WORDS: Readonly<Record<SocialMode, string>> = { lurk: "只潜水", ask: "被问才答", chat: "可以搭话" };
export const DEFAULT_MODE: SocialMode = "lurk";
export const modeOf = (v: unknown): SocialMode => (typeof v === "string" && v in MODE_WORDS ? (v as SocialMode) : DEFAULT_MODE);

export const RECEPTION_PREFIX = "接待：";
/** The social secretary's first word (§11): who I am, for whom, the owner is away, their latest public thing, what a guest can do. */
export function receptionText(agent: string, owner: string, latest?: string): string {
  return `${RECEPTION_PREFIX}第一句自报家门——我是 ${agent}，代 ${owner}；${owner} 现在不在${latest === undefined ? "" : `；${owner} 最近公开的一件事：${latest}`}；访客可以留言，或问公开范围内的。`;
}

export const DIGEST_LIMIT = 1000;
export function digestFault(v: unknown): string | undefined {
  if (typeof v !== "string" || v.trim() === "") return "日报要有正文";
  if ([...v].length > DIGEST_LIMIT) return `日报最多 ${DIGEST_LIMIT} 字`;
  return undefined;
}
/** The first forty characters, with an ellipsis when there are more. */
export function digestHead(text: string, n = 40): string {
  const chars = [...text.trim()];
  return chars.length > n ? `${chars.slice(0, n).join("")}…` : chars.join("");
}
/** The 定 need for a draft (§6.9): the agent and the head; 发, 不发, or the owner's own words (rule 6: 起草 · 改过). */
export const digestNeedText = (agent: string, text: string): string => `${agent} 起草了日报：${digestHead(text)}`;
export const DIGEST_ACTIONS = ["发", "不发", "自己写"] as const;

/** The words of public works: titles and scopes split on blanks and marks, two characters or more, lowered; a CJK run is one word. */
export function keywordsOf(texts: readonly string[]): string[] {
  const out = new Set<string>();
  for (const t of texts) for (const w of t.toLowerCase().split(/[\s,，。；;：:·、()（）「」【】/|\-_]+/)) if ([...w].length >= 2) out.add(w);
  return [...out];
}
/** What two people's public works share (§11 牵线), for an agent to judge by — never a match by itself. */
export const sharedKeywords = (mine: readonly string[], theirs: readonly string[]): string[] => mine.filter((w) => theirs.includes(w));
/** The other side's 定: an agent judged the match, or the person themself asked. */
export const matchNeedText = (from: string, byAgent: boolean, note?: string): string => `牵线：${from}${byAgent ? " 的 agent 觉得你们合得来" : " 想和你互相亮名片"}${note === undefined ? "" : `：${note}`}`;
export const ownMatchNeedText = (agent: string, to: string): string => `你的 agent ${agent} 想替你和 ${to} 牵线，亮名片吗？`;
export const MATCH_ACTIONS = ["亮名片", "不用"] as const;
/** A person's card as the match shows it: their agents and their latest public thing. */
export const nameCard = (person: string, agents: readonly string[], latest?: string): string => `名片：${person}${agents.length === 0 ? "" : ` · agent ${agents.join("、")}`}${latest === undefined ? "" : ` · 最近公开：${latest}`}`;
export const MATCHED_TEXT = "牵线成功：双方亮名片";
```

- [ ] **Step 4: The room kind**

In `src/core/im/venue.ts`, `export type VenueKind = "dm" | "guest-dm" | "group" | "thread" | "channel";` becomes `export type VenueKind = "dm" | "guest-dm" | "group" | "thread" | "channel" | "room";`; `VENUE_WORDS` gains `, room: "房间"` before its closing ` }`; the header's line `// independent and the anchor owner's), a subscription channel (signals only).` becomes `// independent and the anchor owner's), a subscription channel (signals only), a room (open to join; an agent there only as its mode allows, §7.4).`. In `RowState`, after `  today?: number;`:

```ts
  /** A room: which of my agents is in it and in which mode. */
  mode?: string;
```

In `listRow`, after `    case "dm": status = "就是会话本身"; break;`:

```ts
    case "room": status = `${v.people.length} 人 · ${s.mode ?? "自己的 agent 不在"}`; break;
```

In `src/core/im/envelope.ts`, `replyWords` gains, after `    case "channel": return "回复不会发出";`:

```ts
    case "room": return draftFirst ? "回复先给主人过目，再发回该房间" : "回复将发回该房间，成员可见";
```

- [ ] **Step 5: The modes in delivery**

In `src/core/im/delivery.ts`, `export interface AgentInVenue { name: string; speaker: string; relations: Relations; policy?: { promptFrom: PromptFrom; allow: string[] } }` becomes:

```ts
export interface AgentInVenue { name: string; speaker: string; relations: Relations; policy?: { promptFrom: PromptFrom; allow: string[] }; /** In a room (§7.4): 只潜水 is never prompted; 可以搭话 also by a mid-sentence mention or a reply to its own word. */ mode?: "lurk" | "ask" | "chat" }
```

`DeliveryInput` gains, after `  handling?: number;`:

```ts
  /** The speaker of the message this one replies to, when it does. */
  repliedTo?: string;
```

In `deliver`, `    if (target.speaker === m.speaker) continue;` (in the calls loop) becomes:

```ts
    if (target.speaker === m.speaker) continue;
    if (target.mode === "lurk") { out.degraded.push({ agent: name, reason: "只潜水" }); continue; }
```

and the function's last `  return out;` (before its closing `}`) becomes:

```ts
  if (speaker.kind === "person") {
    for (const target of d.agents) {
      if (target.mode !== "chat" || target.speaker === m.speaker || out.prompts.some((p) => p.agent === target.name)) continue;
      const via = out.mentioned.includes(target.name) ? "提到" : d.repliedTo === target.speaker ? "回复" : undefined;
      if (via !== undefined) out.prompts.push({ agent: target.name, level: levelOf(speaker, target.relations), hops, via });
    }
  }
  return out;
```

- [ ] **Step 6: Build and run**

```bash
npm run build 2>&1 | tail -2 && node --test test/social.test.mjs test/im-venue.test.mjs test/im-envelope.test.mjs test/im-delivery.test.mjs test/purity.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
```
Expected: `ℹ fail 0`.

- [ ] **Step 7: Commit**

```bash
git add src/core/im/social.ts src/core/im/venue.ts src/core/im/envelope.ts src/core/im/delivery.ts test/social.test.mjs test/im-venue.test.mjs test/im-envelope.test.mjs test/im-delivery.test.mjs
git commit -m "IM core: the social words and rules, the room kind, an agent's mode in delivery"
```

---

### Task 3: The relay: modes, rooms, the reception, digests, matches; the API

**Files:**
- Modify: `src/relay/relay.ts`, `src/relay/api.ts`
- Modify: `test/relay-share.test.mjs`
- Test: `test/relay-social.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// test/relay-social.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { route } from "../dist/relay/api.js";
import { Relay } from "../dist/relay/relay.js";
import { readDoc } from "../dist/relay/store.js";
import { readQueue } from "../dist/core/im/queue.js";

const BASE = Date.UTC(2026, 9, 31, 9, 0, 0);
function relay() {
  let offset = 0;
  const now = () => { const t = new Date(BASE + offset).toISOString().replace(/\.\d{3}Z$/, "Z"); offset += 1000; return t; };
  return new Relay({ root: mkdtempSync(join(tmpdir(), "gemworks-relay-")), name: "relay.test", version: "0.0.0", now });
}
function call(r, line, { token, body, ip } = {}) {
  const [method, path] = line.split(" ");
  const res = route({ method, path, query: {}, ...(token !== undefined ? { token } : {}), ...(body !== undefined ? { body } : {}), ...(ip !== undefined ? { ip } : {}) }, r);
  return { status: res.status, json: res.type.startsWith("application/json") ? JSON.parse(res.body) : undefined, text: res.body };
}
const queueOf = (r, owner, agent) => readQueue(readDoc(r.root, owner, `queues/${agent}.geml`).text).queue;

/** John (agent 小评), 王五 (agent 小测), 李四; john's room r-1. */
function world() {
  const r = relay();
  const john = r.issuePerson("john"), wangwu = r.issuePerson("wangwu"), lisi = r.issuePerson("lisi");
  const xiaoping = r.issueAgent(john.record, "xiaoping"), xiaoce = r.issueAgent(wangwu.record, "xiaoce");
  assert.equal(r.createVenue(john.record, { id: "r-1", kind: "room", name: "前端茶水间" }).ok, true);
  return { r, john, wangwu, lisi, xiaoping, xiaoce };
}

test("rooms (§7.4): listed for anyone, joined by a person with or without one of their agents; the mode on the agent's page, 只潜水 by default; a lurker is never prompted, 被问才答 by a leading @, 可以搭话 by a mention or a reply too; agents never prompt each other there", () => {
  const { r, john, wangwu, lisi, xiaoping, xiaoce } = world();
  assert.deepEqual(call(r, "GET /rooms", { token: lisi.token }).json, [{ owner: "john", id: "r-1", name: "前端茶水间", people: 1, agents: 0 }]);
  assert.equal(call(r, "POST /rooms/john/r-1/join", { token: xiaoce.token, body: {} }).status, 403, "a person joins; their agent rides along");
  assert.equal(call(r, "POST /rooms/john/nope/join", { token: lisi.token, body: {} }).status, 404);
  r.createVenue(john.record, { id: "g-7", kind: "group", name: "群" });
  assert.equal(call(r, "POST /rooms/john/g-7/join", { token: lisi.token, body: {} }).json.error, "不是公共房间");
  assert.deepEqual(call(r, "POST /rooms/john/r-1/join", { token: lisi.token, body: {} }).json.venue.people, ["john", "lisi"]);
  assert.equal(call(r, "POST /rooms/john/r-1/join", { token: wangwu.token, body: { agent: "xiaoping" } }).json.error, "要自己名下的 agent");
  const joined = call(r, "POST /rooms/john/r-1/join", { token: wangwu.token, body: { agent: "xiaoce" } });
  assert.deepEqual([joined.json.venue.people, joined.json.venue.agents], [["john", "lisi", "wangwu"], ["xiaoce"]]);
  assert.deepEqual(call(r, "POST /rooms/john/r-1/join", { token: john.token, body: { agent: "xiaoping" } }).json.venue.agents, ["xiaoce", "xiaoping"]);
  assert.deepEqual(call(r, "GET /rooms", { token: lisi.token }).json, [{ owner: "john", id: "r-1", name: "前端茶水间", people: 3, agents: 2 }]);
  assert.equal(r.socialModeOf("john", "xiaoping"), "lurk");
  assert.equal(call(r, "POST /agents/xiaoce/social", { token: john.token, body: { mode: "chat" } }).status, 404, "not his agent");
  assert.equal(call(r, "POST /agents/xiaoce/social", { token: wangwu.token, body: { mode: "loud" } }).json.error, "档位是 lurk、ask 或 chat");
  assert.deepEqual(call(r, "POST /agents/xiaoce/social", { token: wangwu.token, body: { mode: "chat" } }).json, { agent: "xiaoce", mode: "chat" });
  assert.equal(r.socialModeOf("wangwu", "xiaoce"), "chat");
  const lurk = r.appendMessage(lisi.record, "john", "r-1", { id: "m-1", text: "@xiaoping 看看这个" });
  assert.deepEqual([lurk.delivery.prompts, lurk.delivery.degraded], [[], [{ agent: "xiaoping", reason: "只潜水" }]]);
  assert.equal(readDoc(r.root, "john", "queues/xiaoping.geml").exists, false, "nothing reached the lurker");
  call(r, "POST /agents/xiaoping/social", { token: john.token, body: { mode: "ask" } });
  const asked = r.appendMessage(lisi.record, "john", "r-1", { id: "m-2", text: "@xiaoping 看看这个" });
  assert.deepEqual(asked.delivery.prompts, [{ agent: "xiaoping", level: "member", hops: 0 }]);
  assert.equal(queueOf(r, "john", "xiaoping").items.length, 1);
  const mentioned = r.appendMessage(lisi.record, "john", "r-1", { id: "m-3", text: "刚才 @xiaoce 说得对，@xiaoping 也是" });
  assert.deepEqual(mentioned.delivery.prompts, [{ agent: "xiaoce", level: "member", hops: 0, via: "提到" }], "可以搭话 takes a mention; 被问才答 does not");
  r.appendMessage(xiaoce.record, "john", "r-1", { id: "m-4", text: "谢谢" , handling: 0 });
  const replied = r.appendMessage(lisi.record, "john", "r-1", { id: "m-5", text: "不客气", replyTo: "m-4" });
  assert.deepEqual(replied.delivery.prompts, [{ agent: "xiaoce", level: "member", hops: 0, via: "回复" }]);
  const a2a = r.appendMessage(xiaoping.record, "john", "r-1", { id: "m-6", text: "@xiaoce 你看呢", handling: 0 });
  assert.deepEqual(a2a.delivery.degraded, [{ agent: "xiaoce", reason: "对方策略不收 agent 的指令，只当消息读到" }], "agents never prompt each other in a room");
  assert.equal(queueOf(r, "wangwu", "xiaoce").items.length, 2);
  assert.equal(call(r, "GET /john/venues/r-1.geml", { token: wangwu.token }).status, 200, "a member reads the room");
  const zhao = r.issuePerson("zhao");
  assert.equal(call(r, "GET /john/venues/r-1.geml", { token: zhao.token }).status, 403, "not before joining");
});

test("the social secretary (§11): every guest DM opens with the reception as a system message — the agent, the owner, the latest public thing (the newest digest, else the card's title)", () => {
  const { r, john, xiaoping } = world();
  const id = call(r, "POST /cards", { token: john.token, body: { title: "设置页导出 PDF，能跑的", summary: "一句话", agent: "xiaoping", scope: "src/settings/*", evidence: [] } }).json.card.id;
  const first = call(r, `POST /ask/${id}`, { body: { text: "这个项目怎么跑？" }, ip: "10.0.0.1" });
  assert.equal(first.status, 201, first.text);
  const dm = r.venueOf("john", first.json.venue);
  assert.deepEqual(dm.messages.map((m) => [m.kind, m.speaker]), [["system", "host"], ["chat", first.json.speaker]]);
  assert.equal(dm.messages[0].text, "接待：第一句自报家门——我是 xiaoping，代 john；john 现在不在；john 最近公开的一件事：设置页导出 PDF，能跑的；访客可以留言，或问公开范围内的。");
  assert.equal(queueOf(r, "john", "xiaoping").items.length, 1, "the system message prompts nobody");
  assert.equal(call(r, "POST /digests", { token: xiaoping.token, body: { text: "今天把设置页的缓存写路径修好了，顺手把导出 PDF 的按钮也挪到了右上角，明天接着做样式。" } }).status, 201);
  assert.equal(call(r, "POST /digests/answer", { token: john.token, body: { draft: "draft-1", publish: true } }).json.published, true);
  const second = call(r, `POST /ask/${id}`, { body: { text: "另一位访客" }, ip: "10.0.0.2" });
  assert.equal(r.venueOf("john", second.json.venue).messages[0].text, "接待：第一句自报家门——我是 xiaoping，代 john；john 现在不在；john 最近公开的一件事：今天把设置页的缓存写路径修好了，顺手把导出 PDF 的按钮也挪到了右上角，明天接…；访客可以留言，或问公开范围内的。");
});

test("digests (§11): the agent drafts, the owner's 定 stands in the inbox; 发 as drafted, 发 with the owner's words (起草 · 改过), or 不发; the published ones on the public page and at /digests/<person>; the drafts are the owner's alone", () => {
  const { r, john, lisi, xiaoping } = world();
  assert.equal(call(r, "POST /digests", { token: john.token, body: { text: "x" } }).json.error, "日报由 agent 起草");
  assert.equal(call(r, "POST /digests", { token: xiaoping.token, body: { text: " " } }).json.error, "日报要有正文");
  assert.deepEqual(call(r, "POST /digests", { token: xiaoping.token, body: { text: "今天把缓存修好了。" } }).json, { id: "draft-1" });
  assert.deepEqual(r.inbox("john").map((n) => [n.kind, n.key, n.text, n.actions]), [["decide", "https://relay.test/john/digests/john.geml#draft-1", "xiaoping 起草了日报：今天把缓存修好了。", ["发", "不发", "自己写"]]]);
  assert.equal(call(r, "POST /digests/answer", { token: xiaoping.token, body: { draft: "draft-1", publish: true } }).status, 403);
  assert.equal(call(r, "POST /digests/answer", { token: john.token, body: { draft: "draft-9", publish: true } }).status, 404);
  assert.deepEqual(call(r, "POST /digests/answer", { token: john.token, body: { draft: "draft-1", publish: true } }).json, { published: true, id: "digest-1" });
  assert.deepEqual(r.inbox("john"), []);
  assert.equal(call(r, "POST /digests/answer", { token: john.token, body: { draft: "draft-1", publish: false } }).json.error, "已经定过了");
  const listed = call(r, "GET /digests/john", { token: lisi.token });
  assert.deepEqual(listed.json.map((d) => [d.id, d.text, d.agent, d.source]), [["digest-1", "今天把缓存修好了。", "xiaoping", "drafted"]]);
  assert.ok(call(r, "GET /john/people/john.geml", { token: lisi.token }).json.blocks.some((b) => b.id === "digest-1" && b.value.text === "今天把缓存修好了。"), "public, on the page");
  assert.equal(call(r, "GET /john/digests/john.geml", { token: lisi.token }).status, 403, "the drafts are the owner's alone");
  call(r, "POST /digests", { token: xiaoping.token, body: { text: "第二天。" } });
  assert.deepEqual(call(r, "POST /digests/answer", { token: john.token, body: { draft: "draft-2", publish: true, text: "第二天，改过的。" } }).json, { published: true, id: "digest-2" });
  call(r, "POST /digests", { token: xiaoping.token, body: { text: "第三天。" } });
  assert.deepEqual(call(r, "POST /digests/answer", { token: john.token, body: { draft: "draft-3", publish: false } }).json, { published: false });
  assert.deepEqual(call(r, "GET /digests/john", { token: john.token }).json.map((d) => [d.id, d.text, d.source]), [["digest-2", "第二天，改过的。", "edited"], ["digest-1", "今天把缓存修好了。", "drafted"]], "newest first; the dropped one nowhere");
  assert.deepEqual(r.inbox("john"), []);
  assert.deepEqual(call(r, "GET /digests/nobody", { token: john.token }).json, []);
  assert.equal(call(r, "GET /digests", { token: john.token }).status, 405);
});

test("牵线 (§11): proposed by a person (their own nod given) or by their agent (their own 定 too); the other side's 定; 不用 ends it; both 亮名片 and a small group opens under the proposer with both people, their agents and the two cards; what two people's public works share", () => {
  const { r, john, wangwu, lisi, xiaoping } = world();
  assert.equal(call(r, "POST /match", { token: lisi.token, body: { person: "lisi" } }).json.error, "不能跟自己牵线");
  assert.equal(call(r, "POST /match", { token: lisi.token, body: { person: "nobody" } }).status, 404);
  const m1 = call(r, "POST /match", { token: lisi.token, body: { person: "john", note: "都在做 PDF" } });
  assert.equal(m1.status, 201, m1.text);
  assert.match(m1.json.id, /^m-[0-9a-f]{8}$/);
  assert.equal(call(r, "POST /match", { token: lisi.token, body: { person: "john" } }).json.error, "已经提过了，等对方点头");
  assert.deepEqual(r.inbox("lisi"), [], "the proposer's own nod is given");
  assert.deepEqual(r.inbox("john").map((n) => [n.kind, n.key, n.text, n.actions]), [["decide", `https://relay.test/lisi/matches/${m1.json.id}.geml#match`, "牵线：lisi 想和你互相亮名片：都在做 PDF", ["亮名片", "不用"]]]);
  assert.equal(call(r, `POST /match/lisi/${m1.json.id}/answer`, { token: wangwu.token, body: { yes: true } }).json.error, "不是你的牵线");
  assert.deepEqual(call(r, `POST /match/lisi/${m1.json.id}/answer`, { token: john.token, body: { yes: false } }).json, { matched: false });
  assert.deepEqual(r.inbox("john"), []);
  assert.equal(call(r, `POST /match/lisi/${m1.json.id}/answer`, { token: john.token, body: { yes: true } }).json.error, "已经答过了");
  assert.equal(call(r, "POST /match/lisi/m-00000000/answer", { token: john.token, body: { yes: true } }).status, 404);
  // by an agent: its owner nods too
  const m2 = call(r, "POST /match", { token: xiaoping.token, body: { person: "wangwu" } });
  assert.equal(m2.status, 201, m2.text);
  assert.deepEqual(r.inbox("john").map((n) => [n.kind, n.text]), [["decide", "你的 agent xiaoping 想替你和 wangwu 牵线，亮名片吗？"]]);
  assert.deepEqual(r.inbox("wangwu").map((n) => [n.kind, n.text]), [["decide", "牵线：john 的 agent 觉得你们合得来"]]);
  assert.deepEqual(call(r, `POST /match/john/${m2.json.id}/answer`, { token: wangwu.token, body: { yes: true } }).json, { matched: false }, "one nod");
  assert.deepEqual(r.inbox("wangwu"), []);
  const done = call(r, `POST /match/john/${m2.json.id}/answer`, { token: john.token, body: { yes: true } });
  assert.deepEqual(done.json, { matched: true, venue: `john/mt-${m2.json.id.slice(2)}` });
  const vd = r.venueOf("john", `mt-${m2.json.id.slice(2)}`);
  assert.deepEqual([vd.venue.kind, vd.venue.name, vd.venue.people, vd.venue.agents], ["group", "牵线：john · wangwu", ["john", "wangwu"], ["xiaoping", "xiaoce"]]);
  assert.deepEqual(vd.messages.map((m) => [m.kind, m.text]), [["system", "牵线成功：双方亮名片"], ["system", "名片：john · agent xiaoping"], ["system", "名片：wangwu · agent xiaoce"]]);
  assert.equal(call(r, `POST /match/john/${m2.json.id}/answer`, { token: john.token, body: { yes: true } }).json.error, "已经答过了");
  assert.deepEqual([r.inbox("john"), r.inbox("wangwu")], [[], []]);
  // suggestions
  call(r, "POST /cards", { token: john.token, body: { title: "设置页导出 PDF，能跑的", summary: "", agent: "xiaoping", scope: "src/settings/*", evidence: [] } });
  r.issueAgent(lisi.record, "xiaoli");
  call(r, "POST /cards", { token: lisi.token, body: { title: "导出 PDF 的另一种做法", summary: "", agent: "xiaoli", scope: "src/export/*", evidence: [] } });
  assert.deepEqual(call(r, "GET /match/suggest", { token: john.token }).json, [{ person: "lisi", shared: ["pdf", "src"] }]);
  assert.deepEqual(call(r, "GET /match/suggest", { token: xiaoping.token }).json, [{ person: "lisi", shared: ["pdf", "src"] }], "an agent asks for its owner");
  assert.deepEqual(call(r, "GET /match/suggest", { token: wangwu.token }).json, []);
  assert.equal(call(r, "GET /match", { token: john.token }).status, 405);
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
node --test test/relay-social.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
```
Expected: `ℹ fail 4`.

- [ ] **Step 3: The relay**

**3a. Imports** — after the login import line (`import { CODE_RE, … } from "../core/im/login.js";`):

```ts
import { DIGEST_ACTIONS, digestFault, digestHead, digestNeedText, keywordsOf, MATCH_ACTIONS, matchNeedText, MATCHED_TEXT, MODE_WORDS, modeOf, nameCard, ownMatchNeedText, receptionText, sharedKeywords, type SocialMode } from "../core/im/social.js";
```

**3b. The modes in delivery** — `    const delivery = deliver(message, this.deliveryInput(vd, handling));` becomes:

```ts
    const replied = draft.replyTo === undefined ? undefined : vd.messages.find((x) => x.id === draft.replyTo)?.speaker;
    const delivery = deliver(message, this.deliveryInput(vd, handling, replied));
```

and `deliveryInput` becomes:

```ts
  /** The venue's agents as delivery sees them: each with its owner's relations and its own policy (the venue's when none); in a room (§7.4) with its mode, and a policy that takes no agent's call. */
  private deliveryInput(vd: VenueDoc, handling: number | undefined, repliedTo?: string): DeliveryInput {
    const room = vd.venue.kind === "room";
    const agents: AgentInVenue[] = [...vd.agentSpeakers].map(([name, speaker]) => {
      const a = parseSpeaker(speaker) as Extract<Speaker, { kind: "agent" }>;
      const policy = room ? { promptFrom: "nobody" as PromptFrom, allow: [] } : this.agentPolicy(a.owner, a.name);
      return { name, speaker, relations: { owner: a.owner, trusted: this.trustedOf(a.owner), members: vd.venue.people }, ...(policy !== undefined ? { policy } : {}), ...(room ? { mode: this.socialModeOf(a.owner, a.name) } : {}) };
    });
    const roster: RosterEntry[] = [
      ...vd.venue.people.filter((p) => !p.includes(":")).map((name): RosterEntry => ({ name, kind: "person" })),
      ...vd.venue.agents.map((name): RosterEntry => ({ name, kind: "agent" })),
      { name: "所有人", kind: "everyone" },
    ];
    return { venue: vd.venue, agents, roster, ...(handling !== undefined ? { handling } : {}), ...(repliedTo !== undefined ? { repliedTo } : {}) };
  }
```

**3c. The reception** — in `askAsGuest`, after `      const made = this.createVenueAs(owner, { id: venueId, kind: "guest-dm", … });\n      if (!made.ok) return made;`:

```ts
      this.appendSystem(owner, venueId, receptionText(card.agent, owner, this.latestPublic(owner) ?? card.title));
```

**3d. The inbox** — before `    const allowed = new Set(pd.blocks.filter((b) => /^cap-allow-\d+$/.test(b.id)).map((b) => str(b.value["ask"])));`:

```ts
    const dd = readDoc(this.root, person, this.digestsDoc(person)).blocks;
    const decided = new Set(dd.filter((b) => /^(sent|drop)-\d+$/.test(b.id)).map((b) => str(b.value["draft"])));
    for (const b of dd) {
      if (!/^draft-\d+$/.test(b.id) || decided.has(b.id)) continue;
      out.push({ kind: "decide", key: this.address(person, this.digestsDoc(person), b.id), text: digestNeedText(str(b.value["agent"]) ?? "", str(b.value["text"]) ?? ""), actions: [...DIGEST_ACTIONS], since: str(b.value["at"]) ?? "", level: 0 });
    }
    for (const owner of listOwners(this.root)) for (const d of listDocs(this.root, owner, "matches")) {
      const m = this.matchDoc(owner, d.slice("matches/".length, -".geml".length));
      if (m === undefined || m.venue !== undefined || m.no.length > 0 || m.yes.includes(person)) continue;
      const byAgent = m.by.startsWith("agent:");
      if (m.to === person) out.push({ kind: "decide", key: this.address(owner, d, "match"), text: matchNeedText(m.from, byAgent, m.note), actions: [...MATCH_ACTIONS], since: m.at, level: 0 });
      else if (m.from === person && byAgent) out.push({ kind: "decide", key: this.address(owner, d, "match"), text: ownMatchNeedText(shownName(m.by), m.to), actions: [...MATCH_ACTIONS], since: m.at, level: 0 });
    }
```

**3e. The verbs** — before `  // --- login and registration (transport §2.5, §7.1 /login) ---`:

```ts
  // --- the social side (§11, §7.4): modes, rooms, digests, 牵线 ---

  /** An agent's mode in rooms (§7.4): the last `social-N` block on its page, 只潜水 when none. */
  socialModeOf(owner: string, name: string): SocialMode {
    const all = readDoc(this.root, owner, `agents/${name}.geml`).blocks.filter((b) => /^social-\d+$/.test(b.id));
    return modeOf(all[all.length - 1]?.value["mode"]);
  }

  setSocialMode(by: TokenRecord, body: unknown): Result<{ agent: string; mode: SocialMode }> {
    const s = parseSpeaker(by.speaker);
    if (by.scope !== "person" || s?.kind !== "person") return fail(403, "只有主人定 agent 的档位");
    const b = obj(body) ?? {};
    const agent = str(b["agent"]) ?? "", mode = str(b["mode"]);
    if (!NAME.test(agent) || !readDoc(this.root, s.id, `agents/${agent}.geml`).exists) return fail(404, "没有这个 agent");
    if (mode === undefined || !(mode in MODE_WORDS)) return fail(400, "档位是 lurk、ask 或 chat");
    const doc = `agents/${agent}.geml`;
    const a = appendBlock(this.root, s.id, doc, nextId("social"), (_d, prev, bid) => sealed({ id: bid, mode, at: this.now() }, prev));
    this.emit(s.id, doc, a.block);
    return { ok: true, agent, mode: mode as SocialMode };
  }

  /** Every room on the relay (§11 公共房间): open to join, so listed for anyone with a token. */
  listRooms(): { owner: string; id: string; name: string; people: number; agents: number }[] {
    const out: { owner: string; id: string; name: string; people: number; agents: number }[] = [];
    for (const owner of listOwners(this.root)) for (const d of listDocs(this.root, owner, "venues")) {
      const vd = this.venueOf(owner, d.slice("venues/".length, -".geml".length));
      if (vd?.venue.kind === "room") out.push({ owner, id: vd.venue.id, name: vd.venue.name, people: vd.venue.people.length, agents: vd.venue.agents.length });
    }
    return out;
  }

  /** A person joins a room, and one of their agents with them when named; the agent comes in at its mode. */
  joinRoom(by: TokenRecord, owner: string, id: string, body: unknown): Result<{ venue: Venue }> {
    const s = parseSpeaker(by.speaker);
    if (by.scope !== "person" || s?.kind !== "person") return fail(403, "本人进房间；agent 跟着主人进");
    const vd = this.venueOf(owner, id);
    if (vd === undefined) return fail(404, "没有这个房间");
    if (vd.venue.kind !== "room") return fail(400, "不是公共房间");
    const agent = str(obj(body)?.["agent"]);
    if (agent !== undefined && !this.agentsOf(s.id).includes(agent)) return fail(403, "要自己名下的 agent");
    this.joinVenue(owner, id, by.speaker);
    if (agent !== undefined) this.joinVenue(owner, id, `agent:${agent}@${s.id}`);
    return { ok: true, venue: this.venueOf(owner, id)!.venue };
  }

  private digestsDoc(person: string): string { return `digests/${person}.geml`; }

  /** A digest drafted by the agent from the session (§11): a draft under the owner, their 定 in the inbox. */
  draftDigest(by: TokenRecord, body: unknown): Result<{ id: string }> {
    const s = parseSpeaker(by.speaker);
    if (by.scope !== "agent" || s?.kind !== "agent") return fail(403, "日报由 agent 起草");
    const text = str(obj(body)?.["text"]);
    const fault = digestFault(text);
    if (fault !== undefined) return fail(400, fault);
    const doc = this.digestsDoc(s.owner);
    const a = appendBlock(this.root, s.owner, doc, nextId("draft"), (_d, prev, bid) => sealed({ id: bid, agent: s.name, text: (text as string).trim(), at: this.now() }, prev));
    this.emit(s.owner, doc, a.block);
    return { ok: true, id: a.block.id };
  }

  /** The owner's nod (rule 6): 发 as drafted, 发 with their own words (起草 · 改过), or 不发; a published one is a block on their public page. */
  answerDigest(by: TokenRecord, body: unknown): Result<{ published: boolean; id?: string }> {
    const s = parseSpeaker(by.speaker);
    if (by.scope !== "person" || s?.kind !== "person") return fail(403, "只有本人定日报发不发");
    const b = obj(body) ?? {};
    const draftId = str(b["draft"]) ?? "", publish = b["publish"] === true, own = (str(b["text"]) ?? "").trim();
    const doc = this.digestsDoc(s.id);
    const d = readDoc(this.root, s.id, doc);
    const draft = d.blocks.find((x) => x.id === draftId && /^draft-\d+$/.test(x.id));
    if (draft === undefined) return fail(404, "没有这份草稿");
    if (d.blocks.some((x) => /^(sent|drop)-\d+$/.test(x.id) && x.value["draft"] === draftId)) return fail(409, "已经定过了");
    const at = this.now();
    if (!publish) {
      const a = appendBlock(this.root, s.id, doc, nextId("drop"), (_d, prev, bid) => sealed({ id: bid, draft: draftId, at }, prev));
      this.emit(s.id, doc, a.block);
      return { ok: true, published: false };
    }
    const drafted = str(draft.value["text"]) ?? "";
    const text = own === "" ? drafted : own;
    const fault = digestFault(text);
    if (fault !== undefined) return fail(400, fault);
    const page = this.personDoc(s.id);
    const p = appendBlock(this.root, s.id, page, nextId("digest"), (_d, prev, bid) => sealed({ id: bid, text, agent: str(draft.value["agent"]) ?? "", source: text === drafted ? "drafted" : "edited", at }, prev));
    this.emit(s.id, page, p.block);
    const a = appendBlock(this.root, s.id, doc, nextId("sent"), (_d, prev, bid) => sealed({ id: bid, draft: draftId, digest: p.block.id, at }, prev));
    this.emit(s.id, doc, a.block);
    return { ok: true, published: true, id: p.block.id };
  }

  /** A person's published digests (§11 日报动态), newest first: on their public page. */
  digestsOf(person: string): { id: string; text: string; agent: string; source: string; at: string }[] {
    if (!NAME.test(person)) return [];
    return readDoc(this.root, person, this.personDoc(person)).blocks.filter((b) => /^digest-\d+$/.test(b.id)).map((b) => ({ id: b.id, text: str(b.value["text"]) ?? "", agent: str(b.value["agent"]) ?? "", source: str(b.value["source"]) ?? "drafted", at: str(b.value["at"]) ?? "" })).reverse();
  }

  /** The owner's latest public thing, for the reception and the name card: the newest digest's head. */
  private latestPublic(owner: string): string | undefined {
    const d = this.digestsOf(owner)[0];
    return d === undefined ? undefined : digestHead(d.text);
  }

  private matchDoc(owner: string, id: string): { from: string; to: string; by: string; note?: string; at: string; yes: string[]; no: string[]; venue?: string } | undefined {
    if (!NAME.test(owner) || !NAME.test(id)) return undefined;
    const d = readDoc(this.root, owner, `matches/${id}.geml`);
    const m = d.blocks.find((b) => b.id === "match")?.value;
    if (!d.exists || m === undefined) return undefined;
    const names = (prefix: string): string[] => d.blocks.filter((b) => b.id.startsWith(prefix)).map((b) => str(b.value["person"]) ?? "");
    const note = str(m["note"]), venue = str(d.blocks.find((b) => b.id === "matched")?.value["venue"]);
    return { from: str(m["from"]) ?? "", to: str(m["to"]) ?? "", by: str(m["by"]) ?? "", at: str(m["at"]) ?? "", yes: names("yes-"), no: names("no-"), ...(note !== undefined ? { note } : {}), ...(venue !== undefined ? { venue } : {}) };
  }

  private nod(owner: string, id: string, person: string, yes: boolean): void {
    const doc = `matches/${id}.geml`;
    const a = appendBlock(this.root, owner, doc, nextId(yes ? "yes" : "no"), (_d, prev, bid) => sealed({ id: bid, person, at: this.now() }, prev));
    this.emit(owner, doc, a.block);
  }

  /** 牵线 proposed (§11): by a person (their nod given), or by their agent on the public works (their owner's 定 too); a record under the proposer; the other side's 定 in their inbox. */
  proposeMatch(by: TokenRecord, body: unknown): Result<{ id: string }> {
    const s = parseSpeaker(by.speaker);
    if (!((by.scope === "person" && s?.kind === "person") || (by.scope === "agent" && s?.kind === "agent"))) return fail(403, "要本人或其 agent 的令牌");
    const from = s.kind === "person" ? s.id : s.owner;
    const b = obj(body) ?? {};
    const to = str(b["person"]), note = str(b["note"]);
    if (to === from) return fail(400, "不能跟自己牵线");
    if (to === undefined || !NAME.test(to) || !this.hasPage(to)) return fail(404, "跟谁牵线？要一个有账号的人");
    for (const d of listDocs(this.root, from, "matches")) {
      const m = this.matchDoc(from, d.slice("matches/".length, -".geml".length));
      if (m !== undefined && m.to === to && m.no.length === 0 && m.venue === undefined) return fail(409, "已经提过了，等对方点头");
    }
    const id = `m-${rand()}`;
    const doc = `matches/${id}.geml`;
    const a = appendSealed(this.root, from, doc, "match", { from, to, by: by.speaker, at: this.now(), ...(note !== undefined ? { note } : {}) });
    this.emit(from, doc, a.block);
    if (s.kind === "person") this.nod(from, id, from, true);
    return { ok: true, id };
  }

  /** A side's answer: 不用 ends it; both 亮名片 and a small group opens under the proposer with both people, their first agents, and the two cards as system messages. */
  answerMatch(by: TokenRecord, owner: string, id: string, body: unknown): Result<{ matched: boolean; venue?: string }> {
    const s = parseSpeaker(by.speaker);
    if (by.scope !== "person" || s?.kind !== "person") return fail(403, "只有本人点头");
    const m = this.matchDoc(owner, id);
    if (m === undefined) return fail(404, "没有这条牵线");
    if (s.id !== m.from && s.id !== m.to) return fail(403, "不是你的牵线");
    if (m.yes.includes(s.id) || m.no.includes(s.id)) return fail(409, "已经答过了");
    if (m.venue !== undefined || m.no.length > 0) return fail(409, "这条牵线已经结束");
    const yes = obj(body)?.["yes"] === true;
    this.nod(owner, id, s.id, yes);
    const after = this.matchDoc(owner, id)!;
    if (!yes || !after.yes.includes(m.from) || !after.yes.includes(m.to)) return { ok: true, matched: false };
    const venue = `mt-${id.slice(2)}`;
    const agents = [...this.agentsOf(m.from).slice(0, 1).map((a) => `agent:${a}@${m.from}`), ...this.agentsOf(m.to).slice(0, 1).map((a) => `agent:${a}@${m.to}`)];
    const made = this.createVenueAs(m.from, { id: venue, kind: "group", name: `牵线：${m.from} · ${m.to}`, people: [m.to], agents });
    if (!made.ok) return made;
    this.appendSystem(m.from, venue, MATCHED_TEXT);
    for (const p of [m.from, m.to]) this.appendSystem(m.from, venue, nameCard(p, this.agentsOf(p), this.latestPublic(p) ?? this.sharesOf(p)[0]?.title));
    const doc = `matches/${id}.geml`;
    const a = appendBlock(this.root, owner, doc, () => "matched", (_d, prev, bid) => sealed({ id: bid, venue: `${m.from}/${venue}`, at: this.now() }, prev));
    this.emit(owner, doc, a.block);
    return { ok: true, matched: true, venue: `${m.from}/${venue}` };
  }

  /** People whose public works share words with the person's (§11 牵线): for an agent to judge by, never a match by itself. */
  suggestMatches(person: string): { person: string; shared: string[] }[] {
    const words = (p: string): string[] => keywordsOf(this.sharesOf(p).flatMap((c) => [c.title, c.scope]));
    const mine = words(person);
    const out: { person: string; shared: string[] }[] = [];
    for (const other of listOwners(this.root)) {
      if (other === person) continue;
      const shared = sharedKeywords(mine, words(other));
      if (shared.length > 0) out.push({ person: other, shared });
    }
    return out.sort((a, b) => b.shared.length - a.shared.length || (a.person < b.person ? -1 : 1));
  }

```

- [ ] **Step 4: The API**

In `src/relay/api.ts`, before `  if (a === "agents" && parts.length === 1) {`:

```ts
  if (a === "agents" && parts.length === 3 && b !== undefined && c === "social") return m === "POST" ? answer(relay.setSocialMode(by, { ...obj(r.body), agent: b })) : fail(405, "只有 POST");
  if (a === "rooms") {
    if (parts.length === 1) return m === "GET" ? json(200, relay.listRooms()) : fail(405, "只有 GET");
    if (parts.length === 4 && b !== undefined && c !== undefined && d === "join") return m === "POST" ? answer(relay.joinRoom(by, b, c, r.body)) : fail(405, "只有 POST");
    return fail(404, "没有这个路径");
  }
  if (a === "digests") {
    if (parts.length === 1) return m === "POST" ? answer(relay.draftDigest(by, r.body), 201) : fail(405, "只有 POST");
    if (parts.length === 2 && b === "answer") return m === "POST" ? answer(relay.answerDigest(by, r.body)) : fail(405, "只有 POST");
    if (parts.length === 2 && b !== undefined) return m === "GET" ? json(200, relay.digestsOf(b)) : fail(405, "只有 GET");
    return fail(404, "没有这个路径");
  }
  if (a === "match") {
    if (parts.length === 1) return m === "POST" ? answer(relay.proposeMatch(by, r.body), 201) : fail(405, "只有 POST");
    if (parts.length === 2 && b === "suggest") return m === "GET" ? json(200, relay.suggestMatches(by.speaker.startsWith("person:") ? by.speaker.slice("person:".length) : by.speaker.replace(/^agent:[^@]+@/, ""))) : fail(405, "只有 GET");
    if (parts.length === 4 && b !== undefined && c !== undefined && d === "answer") return m === "POST" ? answer(relay.answerMatch(by, b, c, r.body)) : fail(405, "只有 POST");
    return fail(404, "没有这个路径");
  }
```

- [ ] **Step 5: The share test learns the reception**

In `test/relay-share.test.mjs`, `  assert.equal(vd.messages.length, 1, "no system message for a first announce");` becomes:

```js
  assert.deepEqual(vd.messages.map((m) => [m.kind, m.speaker]), [["system", "host"], ["chat", first.json.speaker]], "the reception opens the DM; no system message for a first announce");
  assert.equal(vd.messages[0].text, "接待：第一句自报家门——我是 xiaoping，代 john；john 现在不在；john 最近公开的一件事：设置页导出 PDF，能跑的；访客可以留言，或问公开范围内的。");
```

and the DM-read count `.length, 2, "the DM is the guest's to read");` becomes `.length, 3, "the DM is the guest's to read");`.

- [ ] **Step 6: Build and run**

```bash
npm run build 2>&1 | tail -2 && node --test test/relay-social.test.mjs test/relay-share.test.mjs test/relay-page.test.mjs test/relay-core.test.mjs test/relay-api.test.mjs test/relay-task.test.mjs test/relay-wallet.test.mjs test/relay-login.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
```
Expected: `ℹ fail 0`.

- [ ] **Step 7: Commit**

```bash
git add src/relay/relay.ts src/relay/api.ts test/relay-social.test.mjs test/relay-share.test.mjs
git commit -m "IM relay: agents' modes and public rooms, the reception in a guest DM, digests with the owner's nod, 牵线 with both nods"
```

---

### Task 4: The daemon and the bridge: the agents' pages followed, the reception line, the room's row, the two needs answered

**Files:**
- Modify: `src/daemon/home.ts`, `src/daemon/sync.ts`, `src/daemon/deliver.ts`, `src/daemon/view.ts`, `src/bridge.ts`
- Modify: `test/daemon-view.test.mjs`, `test/daemon-sync.test.mjs`, `test/daemon-card.test.mjs`, `test/daemon-cli.test.mjs`, `test/daemon-deliver.test.mjs`, `test/bridge-im.test.mjs`

- [ ] **Step 1: The tests learn the rest**

**4a.** In `test/daemon-view.test.mjs`, the import `import { answer, answerAllow, answerGrant, reportPresence, say } from "../dist/daemon/deliver.js";` becomes `import { answer, answerAllow, answerDigest, answerGrant, answerMatch, reportPresence, say } from "../dist/daemon/deliver.js";`. In the `statusView` test, after `    s.relay.appendMessage(zhang.record, "zhangsan", "t-1", { id: "n-1", text: "线程里" });`:

```js
    s.relay.createVenue(john.record, { id: "r-1", kind: "room", name: "前端茶水间" });
    s.relay.joinRoom(john.record, "john", "r-1", { agent: "xiaoping" });
```

Its venues list `["zhangsan", "t-1", "线程", "回复：看看这个", "没人在干", 1, "n-1"]], "newest venue first; system messages do not count");` becomes `["zhangsan", "t-1", "线程", "回复：看看这个", "没人在干", 1, "n-1"], ["john", "r-1", "房间", "前端茶水间", "1 人 · xiaoping 只潜水", 0, undefined]], "newest venue first; system messages do not count; a room says my agent's mode");` and `.venues.map((x) => x.unread), [0, 0]);` becomes `.venues.map((x) => x.unread), [0, 0, 0]);`.

In the `readForTool` test, after `    s.relay.askCredits(xiaoping.record, { credits: 5, cap: "auto" });`:

```js
    s.relay.draftDigest(xiaoping.record, { text: "今天修好了缓存" });
    const digest = answerDigest(home, { draft: "draft-1", publish: true, text: "今天修好了缓存，改过" }, NOW);
    assert.deepEqual([digest.kind, digest.as, digest.body], ["digest", "person", { draft: "draft-1", publish: true, text: "今天修好了缓存，改过" }]);
```

after `    for (let i = 0; i < 3; i++) s.relay.requestGrant(lisi.record, "john", block);`:

```js
    const proposed = s.relay.proposeMatch(lisi.record, { person: "john" });
    const nod = answerMatch(home, { owner: "lisi", id: proposed.id, yes: true }, NOW);
    assert.deepEqual([nod.kind, nod.as, nod.owner, nod.doc, nod.body], ["match", "person", "lisi", proposed.id, { yes: true }]);
```

`    assert.deepEqual([r.pushed, r.failed], [6, 0]);` becomes `    assert.deepEqual([r.pushed, r.failed], [8, 0]);`, and after `    assert.deepEqual(s.relay.blockGrantsOf("john").map((g) => g.person), ["lisi", "lisi"]);`:

```js
    assert.deepEqual(s.relay.digestsOf("john").map((d) => [d.text, d.source]), [["今天修好了缓存，改过", "edited"]]);
    assert.equal(s.relay.venueOf("lisi", `mt-${proposed.id.slice(2)}`)?.venue.kind, "group", "both nodded: the cards shown");
```

**4b.** In `test/daemon-sync.test.mjs`, `docs: 5` becomes `docs: 6`, `.docs, 5);` becomes `.docs, 6);`, and after the ledger mirror line (`…"ledger/john.geml").blocks.map((b) => b.id), ["entry-1"], "the ledger is followed");`):

```js
    assert.deepEqual(readMirror(home, "relay.test", "john", "agents/xiaoping.geml").blocks.map((b) => b.id), ["agent"], "the agent's page is followed");
```

**4c.** In `test/daemon-card.test.mjs`, `.docs, 4, "the draft counts among my documents (my page, my ledger, the group, the card; no queue yet)");` becomes `.docs, 5, "the draft counts among my documents (my page, my ledger, my agent's page, the group, the card; no queue yet)");` and `.docs, 3, "not among 王五's until published");` becomes `.docs, 4, "not among 王五's until published");`. In `test/daemon-cli.test.mjs`, `docs: 3, pushed: 0` becomes `docs: 4, pushed: 0`.

**4d.** In `test/daemon-deliver.test.mjs`, the guest's prompt text `请访客给主人留言]\n缓存键为什么不用 URL 直接当键？` becomes `请访客给主人留言]\n[接待：第一句自报家门——我是 xiaoping，代 john；john 现在不在；john 最近公开的一件事：设置页导出 PDF；访客可以留言，或问公开范围内的。]\n缓存键为什么不用 URL 直接当键？`, and the DM's messages `[[asked.speaker, "缓存键为什么不用 URL 直接当键？"], ["agent:xiaoping@john", "因为同一个 URL 带不同的用户态会出不同的配置。"]]` become `[["host", "接待：第一句自报家门——我是 xiaoping，代 john；john 现在不在；john 最近公开的一件事：设置页导出 PDF；访客可以留言，或问公开范围内的。"], [asked.speaker, "缓存键为什么不用 URL 直接当键？"], ["agent:xiaoping@john", "因为同一个 URL 带不同的用户态会出不同的配置。"]]`.

**4e.** In `test/bridge-im.test.mjs`, after the `askCredits` line (`    s.relay.askCredits(s.relay.issueAgent({ speaker: "person:john", scope: "person" }, "xiaoping").record, { credits: 5, cap: "auto", note: "还差一个 skill" });`):

```js
    s.relay.draftDigest(s.relay.issueAgent({ speaker: "person:john", scope: "person" }, "xiaoping").record, { text: "今天修好了缓存" });
    s.relay.proposeMatch(lisi.record, { person: "john", note: "都在做 PDF" });
```

`["decide", "grant", "grant"]` becomes `["decide", "decide", "decide", "grant", "grant"]`; `key: needs[1].key, action: "允许此人"` becomes `key: needs[3].key, action: "允许此人"`; `[needs[2].text, needs[2].actions]` becomes `[needs[4].text, needs[4].actions]` and `key: needs[2].key, action: "今天再 5"` becomes `key: needs[4].key, action: "今天再 5"`; after that line:

```js
    assert.deepEqual([needs[1].text, needs[2].text], ["xiaoping 起草了日报：今天修好了缓存", "牵线：lisi 想和你互相亮名片：都在做 PDF"]);
    assert.equal(ask({ op: "im-need", key: needs[1].key, action: "发" }).ok, true);
    assert.equal(ask({ op: "im-need", key: needs[2].key, action: "亮名片" }).ok, true);
```

the outbox list `["grant", "lisi", undefined], ["allow", undefined, undefined]]` becomes `["grant", "lisi", undefined], ["allow", undefined, undefined], ["digest", undefined, undefined], ["match", undefined, undefined]]`, and `[r2.pushed, r2.failed], [5, 0]` becomes `[r2.pushed, r2.failed], [7, 0]`.

- [ ] **Step 2: Run them to see them fail**

```bash
node --test test/daemon-view.test.mjs test/daemon-sync.test.mjs test/daemon-card.test.mjs test/daemon-cli.test.mjs test/daemon-deliver.test.mjs test/bridge-im.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
```
Expected: `ℹ fail 6` or so.

- [ ] **Step 3: The daemon**

**4f.** In `src/daemon/home.ts`, `  kind: "message" | "marker" | "grant" | "refuse" | "allow";` becomes `  kind: "message" | "marker" | "grant" | "refuse" | "allow" | "digest" | "match";`, and the comment's `an allowance for an agent's ask (no document: the relay's own endpoints)` becomes `an allowance for an agent's ask, a digest's 定, a match's nod (no document: the relay's own endpoints)`.

**4g.** In `src/daemon/sync.ts`, `listFollowed`'s comment `their page and their ledger (§9.1), the venues they are in` becomes `their page, their ledger (§9.1) and their agents' pages, the venues they are in`, and its return line becomes:

```ts
    return [`${c.person}/people/${c.person}.geml`, `${c.person}/ledger/${c.person}.geml`, ...agents.map((a) => `${c.person}/agents/${a}.geml`), ...venues.map((v) => `${v.owner}/venues/${v.id}.geml`), ...agents.map((a) => `${c.person}/queues/${a}.geml`), ...tasks.map((t) => `${t.owner}/cards/${t.id}.geml`)];
```

In `flushOutbox`, `e.kind === "allow" ? await client.post("/wallet/allow", e.body) :` becomes `e.kind === "allow" ? await client.post("/wallet/allow", e.body) : e.kind === "digest" ? await client.post("/digests/answer", e.body) : e.kind === "match" ? await client.post(\`/match/${encodeURIComponent(e.owner)}/${encodeURIComponent(e.doc)}/answer\`, e.body) :`.

**4h.** In `src/daemon/deliver.ts`, after `import { scopeLine } from "../core/im/share.js";`:

```ts
import { RECEPTION_PREFIX } from "../core/im/social.js";
```

After `answerAllow` (the function ending `  return enqueueOutbox(home, { kind: "allow", … });\n}`):

```ts
/** A digest's 定 (§11, rule 6): 发 as drafted, 发 with the owner's own words, or 不发, as the person, through the outbox. */
export function answerDigest(home: string, o: { draft: string; publish: boolean; text?: string }, now: string): OutboxEntry {
  const c = requireConfig(home);
  return enqueueOutbox(home, { kind: "digest", as: "person", owner: c.person, doc: "", body: { draft: o.draft, publish: o.publish, ...(o.text !== undefined ? { text: o.text } : {}) }, at: now });
}

/** A match's nod (§11 牵线), as the person, through the outbox; `owner` and `id` name the proposer's record. */
export function answerMatch(home: string, o: { owner: string; id: string; yes: boolean }, now: string): OutboxEntry {
  const c = requireConfig(home);
  return enqueueOutbox(home, { kind: "match", as: "person", owner: o.owner, doc: o.id, body: { yes: o.yes }, at: now });
}
```

In `nextPrompt`, the `head` line becomes:

```ts
  // The social secretary's first word (§11): the reception the relay wrote into the DM stands under a first question's range line, and no later one's.
  const reception = item.venueKind === "guest-dm" && vd !== undefined && vd.messages.filter((x) => x.speaker.startsWith("guest:")).length <= 1 ? vd.messages.find((x) => x.kind === "system" && x.text.startsWith(RECEPTION_PREFIX))?.text : undefined;
  const head = item.card !== undefined ? `${envelope}\n${cardPromptLine(item.card, room ?? "")}` : item.venueKind === "guest-dm" && vd?.venue.announce !== undefined ? `${envelope}\n${scopeLine(vd.venue.announce.text)}${reception === undefined ? "" : `\n[${reception}]`}` : envelope;
```

**4i.** In `src/daemon/view.ts`, after the ledger import line (`import { balanceOf, … } from "../core/im/ledger.js";`):

```ts
import { MODE_WORDS, modeOf } from "../core/im/social.js";
```

and `    const row = listRow(vd.venue, { unread });` becomes:

```ts
    // A room's row says which of my agents is in it and in which mode (§6.2), from the agent's mirrored page.
    const mine = vd.venue.kind === "room" ? vd.venue.agents.find((a) => vd.agentSpeakers.get(a) === `agent:${a}@${c.person}`) : undefined;
    const mode = mine === undefined ? undefined : `${mine} ${MODE_WORDS[modeOf(readMirror(home, c.relay.name, c.person, `agents/${mine}.geml`).blocks.filter((b) => /^social-\d+$/.test(b.id)).at(-1)?.value["mode"])]}`;
    const row = listRow(vd.venue, { unread, ...(mode !== undefined ? { mode } : {}) });
```

- [ ] **Step 4: The bridge**

In `src/bridge.ts`, the deliver import gains `answerDigest, answerMatch`: `import { answer as imAnswer, answerAllow, answerGrant, dropDraft,` becomes `import { answer as imAnswer, answerAllow, answerDigest, answerGrant, answerMatch, dropDraft,`. In `answerNeed`, before `  if (/^people\/[^/]+\.geml$/.test(a.doc)) {`:

```ts
  if (/^digests\/[^/]+\.geml$/.test(a.doc)) {
    if (action === "自己写" && (text?.trim() ?? "") === "") return { ok: false, reason: "自己写：缺正文" };
    answerDigest(home, { draft: a.block, publish: action !== "不发", ...(action === "自己写" ? { text: (text ?? "").trim() } : {}) }, now);
    return { ok: true };
  }
  if (/^matches\/[^/]+\.geml$/.test(a.doc)) { answerMatch(home, { owner: a.owner, id: a.doc.slice("matches/".length, -".geml".length), yes: action === "亮名片" }, now); return { ok: true }; }
```

- [ ] **Step 5: Build and run**

```bash
npm run build 2>&1 | tail -2 && node --test test/daemon-view.test.mjs test/daemon-sync.test.mjs test/daemon-card.test.mjs test/daemon-cards.test.mjs test/daemon-cli.test.mjs test/daemon-deliver.test.mjs test/daemon-home.test.mjs test/bridge-im.test.mjs test/bridge.test.mjs test/card-cli.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
```
Expected: `ℹ fail 0`.

- [ ] **Step 6: Commit**

```bash
git add src/daemon/home.ts src/daemon/sync.ts src/daemon/deliver.ts src/daemon/view.ts src/bridge.ts test/daemon-view.test.mjs test/daemon-sync.test.mjs test/daemon-card.test.mjs test/daemon-cli.test.mjs test/daemon-deliver.test.mjs test/bridge-im.test.mjs
git commit -m "IM daemon: the agents' pages followed, the reception under a first question, the room's row, a digest's and a match's answers through the outbox"
```

---

### Task 5: The CLI: rooms, modes, digests, matches

**Files:**
- Modify: `src/cli.ts`
- Test: `test/social-cli.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// test/social-cli.test.mjs
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

test("gemworks connect room, mode, digest, match (§11, §7.4): a room made, listed and joined with an agent; the agent's mode; a digest drafted as the agent and the published ones listed; 牵线 proposed and the suggestions; the usage errors", async () => {
  const s = await startRelay({ root: tmp("gemworks-relay-"), name: "relay.test" });
  const homes = { john: tmp("gemworks-im-"), wangwu: tmp("gemworks-im-"), nobody: tmp("gemworks-im-") };
  try {
    const john = s.relay.issuePerson("john"), wangwu = s.relay.issuePerson("wangwu");
    const xiaoping = s.relay.issueAgent(john.record, "xiaoping"), xiaoce = s.relay.issueAgent(wangwu.record, "xiaoce");
    writeConfig(homes.john, { relay: { url: s.url, name: "relay.test" }, person: "john", token: john.token, agents: { xiaoping: xiaoping.token } });
    writeConfig(homes.wangwu, { relay: { url: s.url, name: "relay.test" }, person: "wangwu", token: wangwu.token, agents: { xiaoce: xiaoce.token } });
    const J = ["--home", homes.john], W = ["--home", homes.wangwu];
    assert.equal((await run(["connect", "room", "list", "--home", homes.nobody])).code, 1, "no connect.json");
    assert.equal((await run(["connect", "room", "nope", ...J])).code, 2);
    const made = await run(["connect", "room", "new", "r-1", "--name", "前端茶水间", ...J]);
    assert.deepEqual([made.code, made.out], [0, "房间 john/r-1\n"], made.err);
    const listed = await run(["connect", "room", "list", ...W]);
    assert.deepEqual([listed.code, listed.out], [0, "john/r-1 · 前端茶水间 · 1 人 · 0 个 agent\n"], listed.err);
    const joined = await run(["connect", "room", "join", "john/r-1", "--agent", "xiaoce", ...W]);
    assert.deepEqual([joined.code, joined.out], [0, "进了房间「前端茶水间」 · xiaoce 跟着\n"], joined.err);
    assert.equal((await run(["connect", "room", "join", "r-1", ...W])).code, 2, "owner/id");
    assert.equal((await run(["connect", "room", "join", "john/r-1", "--agent", "xiaoping", ...W])).code, 1, "not his agent");
    const mode = await run(["connect", "mode", "xiaoce", "chat", ...W]);
    assert.deepEqual([mode.code, mode.out], [0, "xiaoce 可以搭话\n"], mode.err);
    assert.equal((await run(["connect", "mode", "xiaoce", "loud", ...W])).code, 1);
    assert.equal((await run(["connect", "mode", "xiaoce", ...W])).code, 2);
    assert.equal(s.relay.socialModeOf("wangwu", "xiaoce"), "chat");
    const drafted = await run(["connect", "digest", "--as", "xiaoping", "--text", "今天修好了缓存", ...J]);
    assert.deepEqual([drafted.code, drafted.out], [0, "draft-1 · 等 john 定\n"], drafted.err);
    assert.equal((await run(["connect", "digest", "--as", "nobody", "--text", "x", ...J])).code, 1, "no such agent token");
    assert.equal((await run(["connect", "digest", "--text", "x", ...J])).code, 2);
    assert.equal(s.relay.answerDigest(john.record, { draft: "draft-1", publish: true }).ok, true);
    const digests = await run(["connect", "digest", "list", "john", ...W]);
    assert.equal(digests.code, 0, digests.err);
    assert.match(digests.out, /^\d{4}-\d\d-\d\d xiaoping：今天修好了缓存\n$/);
    assert.equal((await run(["connect", "digest", "list", ...J])).out, digests.out, "mine by default");
    const proposed = await run(["connect", "match", "wangwu", "--note", "都在做 PDF", ...J]);
    assert.equal(proposed.code, 0, proposed.err);
    assert.match(proposed.out, /^m-[0-9a-f]{8} · 等 wangwu 点头\n$/);
    assert.deepEqual(s.relay.inbox("wangwu").map((n) => n.text), ["牵线：john 想和你互相亮名片：都在做 PDF"]);
    const byAgent = await run(["connect", "match", "john", "--as", "xiaoce", ...W]);
    assert.match(byAgent.out, /^m-[0-9a-f]{8} · 等 john 点头，也等你\n$/, byAgent.err);
    assert.equal((await run(["connect", "match", ...J])).code, 2);
    const suggest = await run(["connect", "match", "suggest", ...J]);
    assert.deepEqual([suggest.code, suggest.out], [0, "没有公开作品相近的人\n"], suggest.err);
    const usage = (await run([])).err;
    for (const w of ["connect room", "connect mode", "connect digest", "connect match"]) assert.match(usage, new RegExp(w));
  } finally {
    await s.close();
  }
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
node --test test/social-cli.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
```
Expected: `ℹ fail 1`.

- [ ] **Step 3: The verbs**

In `src/cli.ts`, after `import { commandMailer } from "./relay/mail.js";`:

```ts
import { MODE_WORDS, type SocialMode } from "./core/im/social.js";
```

After the `connect wallet` usage line:

```ts
  "  connect room new <id> [--name 名] | list | join <owner/id> [--agent 名]   a public room (§11): make one, list them all, join one with an agent of yours",
  "  connect mode <agent> <lurk|ask|chat>    the agent's mode in rooms (§7.4): 只潜水, 被问才答, 可以搭话",
  "  connect digest --as <agent> --text <正文> | list [person]   a digest drafted as the agent for the owner's nod (§11), or the published ones",
  "  connect match <person> [--note 一句话] [--as agent] | suggest   牵线 (§11): propose, or see whose public works share words with yours",
```

Before `/** \`gemworks connect\`: the daemon until it is stopped; …`:

```ts
/** `gemworks connect room|mode|digest|match` (§11, §7.4): rooms made, listed and joined; an agent's mode; a digest drafted as the agent, or the published ones; 牵线 proposed, or what two people's public works share. */
async function runSocial(home: string, sub: "room" | "mode" | "digest" | "match", args: string[]): Promise<number> {
  const c = readConfig(home);
  if (c === undefined) return fail(`gemworks connect ${sub}: no connect.json here; run gemworks connect setup first`, 1);
  const client = new RelayClient(c.relay.url, c.token);
  const refused = (r: { status: number; body: unknown }): number => fail(`gemworks connect ${sub}: ${reasonOf(r)}`, 1);
  try {
    if (sub === "room") {
      const verb = args[0];
      if (verb === "new") {
        const pos = positionals("connect room new", args.slice(1), [], ["--home", "--name"]);
        if (pos.length !== 1) fail("gemworks connect room new: <id> [--name 名字]", 2);
        const r = await client.post("/venues", { id: pos[0], kind: "room", name: flag(args, "--name") ?? pos[0] });
        if (r.status !== 201) return refused(r);
        console.log(`房间 ${c.person}/${pos[0]}`);
        return 0;
      }
      if (verb === "list") {
        if (positionals("connect room list", args.slice(1), [], ["--home"]).length > 0) fail(USAGE, 2);
        const r = await client.get("/rooms");
        if (r.status !== 200) return refused(r);
        for (const x of r.body as { owner: string; id: string; name: string; people: number; agents: number }[]) console.log(`${x.owner}/${x.id} · ${x.name} · ${x.people} 人 · ${x.agents} 个 agent`);
        return 0;
      }
      if (verb === "join") {
        const pos = positionals("connect room join", args.slice(1), [], ["--home", "--agent"]);
        const target = /^([^/\s]+)\/([^/\s]+)$/.exec(pos[0] ?? "");
        if (pos.length !== 1 || target === null) fail("gemworks connect room join: <owner/id> [--agent 名字]", 2);
        const agent = flag(args, "--agent");
        const r = await client.post(`/rooms/${encodeURIComponent(target![1]!)}/${encodeURIComponent(target![2]!)}/join`, agent === undefined ? {} : { agent });
        if (r.status !== 200) return refused(r);
        console.log(`进了房间「${(r.body as { venue: { name: string } }).venue.name}」${agent === undefined ? "" : ` · ${agent} 跟着`}`);
        return 0;
      }
      fail(USAGE, 2);
    }
    if (sub === "mode") {
      const pos = positionals("connect mode", args, [], ["--home"]);
      if (pos.length !== 2) fail("gemworks connect mode: <agent> <lurk|ask|chat>", 2);
      const r = await client.post(`/agents/${encodeURIComponent(pos[0]!)}/social`, { mode: pos[1] });
      if (r.status !== 200) return refused(r);
      console.log(`${pos[0]} ${MODE_WORDS[(r.body as { mode: SocialMode }).mode]}`);
      return 0;
    }
    if (sub === "digest") {
      if (args[0] === "list") {
        const pos = positionals("connect digest list", args.slice(1), [], ["--home"]);
        if (pos.length > 1) fail(USAGE, 2);
        const r = await client.get(`/digests/${encodeURIComponent(pos[0] ?? c.person)}`);
        if (r.status !== 200) return refused(r);
        for (const d of r.body as { text: string; agent: string; source: string; at: string }[]) console.log(`${d.at.slice(0, 10)} ${d.agent}${d.source === "edited" ? "（改过）" : ""}：${d.text}`);
        return 0;
      }
      if (positionals("connect digest", args, [], ["--home", "--as", "--text"]).length > 0) fail(USAGE, 2);
      const as = flag(args, "--as"), text = flag(args, "--text");
      if (as === undefined || text === undefined) fail("gemworks connect digest: --as <agent> --text <正文>, or list [person]", 2);
      const token = c.agents[as];
      if (token === undefined) return fail(`gemworks connect digest: 没有 ${as} 的令牌`, 1);
      const r = await new RelayClient(c.relay.url, token).post("/digests", { text });
      if (r.status !== 201) return refused(r);
      console.log(`${(r.body as { id: string }).id} · 等 ${c.person} 定`);
      return 0;
    }
    if (args[0] === "suggest") {
      if (positionals("connect match suggest", args.slice(1), [], ["--home"]).length > 0) fail(USAGE, 2);
      const r = await client.get("/match/suggest");
      if (r.status !== 200) return refused(r);
      const rows = r.body as { person: string; shared: string[] }[];
      if (rows.length === 0) console.log("没有公开作品相近的人");
      for (const x of rows) console.log(`${x.person} · ${x.shared.join(" ")}`);
      return 0;
    }
    const pos = positionals("connect match", args, [], ["--home", "--note", "--as"]);
    if (pos.length !== 1) fail("gemworks connect match: <person> [--note 一句话] [--as agent], or suggest", 2);
    const as = flag(args, "--as"), note = flag(args, "--note");
    const token = as === undefined ? c.token : c.agents[as];
    if (token === undefined) return fail(`gemworks connect match: 没有 ${as} 的令牌`, 1);
    const r = await new RelayClient(c.relay.url, token).post("/match", { person: pos[0], ...(note !== undefined ? { note } : {}) });
    if (r.status !== 201) return refused(r);
    console.log(`${(r.body as { id: string }).id} · 等 ${pos[0]} 点头${as === undefined ? "" : "，也等你"}`);
    return 0;
  } catch (e) { return fail(`gemworks connect ${sub}: ${e instanceof Error ? e.message : String(e)}`, 1); }
}

```

In `runConnect`, after `  if (sub === "wallet") return runWallet(home, args);`:

```ts
  if (sub === "room" || sub === "mode" || sub === "digest" || sub === "match") return runSocial(home, sub, args);
```

- [ ] **Step 4: Build and run**

```bash
npm run build 2>&1 | tail -2 && node --test test/social-cli.test.mjs test/wallet-cli.test.mjs test/card-cli.test.mjs test/cli.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
```
Expected: `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts test/social-cli.test.mjs
git commit -m "CLI: connect room, mode, digest, match"
```

---

### Task 6: Gates and the version

- [ ] **Step 1: The four gates, each its own command**

```bash
npm run build
claude plugin validate .
claude plugin test .
node --test --test-concurrency=2 test/*.test.mjs
```
Expected: build clean; validate ok; `claude plugin test` with only the machine's 23 pane failures; the node suites `ℹ fail 0`, `ℹ pass` 937 + 4 + 1 + 1 + 4 + 1 = 948.

- [ ] **Step 2: The version and the merge**

```bash
node scripts/bump.mjs 0.3.3
git add -A && git commit -m "gemsbang 0.3.3: digests, the social secretary, public rooms, 牵线 (§11)"
git switch main && git merge --ff-only im/j-social && git branch -d im/j-social
```

---

## Self-review

- **Spec coverage (§11, §7.4):** 日报动态 drafted by the agent, sent only on the owner's nod, rule 6's second source marked (`source: drafted|edited`), public on the page ✓; 社交秘书's first word with the five things ✓ (the latest public thing from the digests, else the card); 公共房间 open to join ✓, agents 只潜水 by default ✓, the three modes ✓, agents never talking to each other there ✓ (the room forces the policy nobody), the room's row saying my agent's mode ✓; 牵线 by public works (the shared words for the agent to judge) ✓, both nodding before the cards show ✓ (the name cards as system messages in a group of the two).
- **Placeholders:** none.
- **Type consistency:** `SocialMode` and `MODE_WORDS` in core, relay, view and CLI; `AgentInVenue.mode` and `DeliveryInput.repliedTo` in core and relay; the outbox kinds `digest`, `match` in home, sync, deliver and the bridge; `answerDigest`/`answerMatch` signatures the same in deliver, the bridge and the tests.
