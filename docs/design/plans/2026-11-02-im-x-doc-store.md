# Gemsbang Plan X: The Relay on a Store of Documents

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The relay keeps its documents behind one interface, so the same relay — every rule of it unchanged — runs on files (the Node shell, a company's own deployment, the tests), in memory, or on SQLite: node:sqlite here, and a Cloudflare Durable Object's own SQLite in plan AA. Nothing a person sees changes; every suite of the relay, the client and the pane passes as before.

**Architecture:** A new module, `src/relay/doc-store.ts`: a `DocStore` reads a document (its sealed data blocks in order), appends one block built from the document as it stands (a block whose id is already there answered as it is), lists the documents under a folder, and keeps a secret made once. `fileStore(root)` is what the relay has always done (store.ts, the document's lock); `memoryStore()` keeps everything in maps; `sqlStore(sql)` keeps one row per block over anything with an `exec(query, …bindings).toArray()` — a Durable Object's `ctx.storage.sql` as it is, node:sqlite's `DatabaseSync` through `nodeSql`. `AvatarRelay` takes `store` beside `root` (a folder means `fileStore`), and every document it touches goes through it: people, avatars, groups and lines, cards, jobs, links, the phone hashes' salt (the store's secret); its tokens too (`tokens.ts` takes a folder or a store). Without a folder, a login text goes nowhere until the operator gives a route (plan Y gives mail). The Node shell keeps its folder.

**Tech Stack:** TypeScript (`src/relay`), node:sqlite (Node 22.13 and later; the SQLite test skips with its reason on an older Node), `node:test` over `dist/`.

**Before this plan:** gemsbang 0.5.8 on `main` (plan W, `docs/design/plans/2026-11-02-im-w-ask-first.md`). The spec is `docs/design/specs/2026-11-01-gemsbang-architecture.md` §2.3 (the beta on a Cloudflare Worker with Durable Objects), §2.4 (a company's own deployment: the same core in a Node shell), §8 (`avatars.ts` … 存储走接口).

## The series

| Plan | What it builds | What runs after it |
|---|---|---|
| P–U (done, 0.5.1–0.5.6) | Avatars as accounts, a group one link, the side panel, 需要你, hosted agents, borrowing Claude Code | The IM of avatars on a Node relay |
| V (done, 0.5.7) · no hosted layer, nothing on a clock | The hosted layer gone; cards wait unless the matter has a deadline; 借电脑 → 任务 | Avatars speak only through their person's own agents |
| W (done, 0.5.8) · ask before answering | Calls on the client, 回 / 以后这个群自动回 / 不回; 自动回 on the avatar; rounds in the background | An avatar answers when its person says so |
| **X (this one)** · the relay on a store | `DocStore`: files, memory, SQLite; the relay and its tokens on it | The same relay, ready to run inside a Durable Object |
| Y · email sign-in and the account | Several sign-in methods, email codes, sign-in in the panel, the account page, the join pages by email, no relay address | A person signs in with an email |
| Z · the box and sync | Each person's box with `pts`, long polling, `getDifference`, the client's update manager and cache | The panel is current within a second |
| AA · Cloudflare | A Worker and a Durable Object around the relay on `sqlStore`, alarms for deadlines, mail from `gemsbang.com`, the beta deployed | gemsbang at gemsbang.com |

## What the spec decided, and what this plan does about each

- **Storage behind an interface (architecture §8).** Done with `DocStore` and its three stores; the relay's logic is moved as it is, not rewritten: the same documents, the same seals, the same ids.
- **The beta on Durable Objects (architecture §2.3) — one object, for now.** The spec's table gives each person, group, avatar, login and join code a Durable Object of its own. A Durable Object's SQLite is synchronous, and so is this relay; so the beta runs the whole relay in **one** Durable Object on `sqlStore` (plan AA), its logic unchanged. One object orders every write and holds tens of people's chats easily; splitting it per entity means making every rule asynchronous and passing messages between objects, which waits until the load asks for it. The documents are already one per entity (a person's, an avatar's, a group's), so that split stays open.
- **A company's own deployment (architecture §2.4).** The Node shell keeps `fileStore`; a deployment that wants a database can use `sqlStore` over node:sqlite.
- **Not in this plan:** splitting the relay per entity; moving the documents of a relay on files into SQLite (the beta starts empty); the Worker itself (plan AA).

## File structure

| File | Responsibility |
|---|---|
| `src/relay/doc-store.ts` (new) | `DocStore`, `Build`, `appendSealed`; `fileStore`, `memoryStore`; `SqlLike`, `nodeSql`, `sqlStore`. |
| `src/relay/avatars.ts` | `store` beside `root`; every document through the store; the salt as its secret. |
| `src/relay/tokens.ts` | Tokens kept in a folder or a store. |
| `src/relay/avatar-server.ts` | The Node shell keeps a folder. |
| `test/relay-doc-store.test.mjs`, `test/avatar-memory.test.mjs` (new) | The stores' one contract on files, memory and SQLite; a relay on a store of its own. |

---

### Task 1: The document store: one interface, on files and in memory

**Files:**
- Create: `src/relay/doc-store.ts` (`DocStore`, `Build`, `appendSealed`, `fileStore`, `memoryStore`)
- Test: `test/relay-doc-store.test.mjs` (one contract, run on both)

- [ ] **Step 1: Write the failing test**

**Create `test/relay-doc-store.test.mjs`:**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendSealed, fileStore, memoryStore } from "../dist/relay/doc-store.js";
import { nextId, sealed } from "../dist/relay/store.js";

/** What every store does the same (architecture §2.3): documents of sealed blocks in order, an id already there answered as it is, the documents under a folder, a secret made once. */
function contract(s) {
  assert.deepEqual(s.read("a-0000000001", "venues/g-000000000a.geml"), { blocks: [], diagnostics: [], text: "", exists: false });
  const one = s.append("a-0000000001", "venues/g-000000000a.geml", nextId("msg"), (_d, prev, id) => sealed({ id, text: "你好", at: "2026-11-02T09:00:00Z" }, prev));
  const two = s.append("a-0000000001", "venues/g-000000000a.geml", nextId("msg"), (_d, prev, id) => sealed({ id, text: "在吗", at: "2026-11-02T09:01:00Z" }, prev));
  assert.deepEqual([one.existed, one.block.id, one.block.value.prev, two.block.id, two.block.value.prev], [false, "msg-1", null, "msg-2", one.block.value.hash], "sealed on the document's chain");
  const again = s.append("a-0000000001", "venues/g-000000000a.geml", () => "msg-1", () => ({ text: "changed" }));
  assert.deepEqual([again.existed, again.block.value.text], [true, "你好"], "an id already there is answered as it is");
  const d = s.read("a-0000000001", "venues/g-000000000a.geml");
  assert.deepEqual([d.exists, d.blocks.map((b) => [b.id, b.value.text]), d.text.startsWith("=== meta")], [true, [["msg-1", "你好"], ["msg-2", "在吗"]], true]);
  appendSealed(s, "a-0000000001", "venues/d-000000000b.geml", "member-1", { avatar: "a-0000000002" });
  appendSealed(s, "a-0000000001", "venues/old/x.geml", "member-1", { avatar: "a-0000000003" });
  appendSealed(s, "a-0000000009", "venues/g-000000000c.geml", "member-1", { avatar: "a-0000000009" });
  assert.deepEqual(s.list("a-0000000001", "venues"), ["venues/d-000000000b.geml", "venues/g-000000000a.geml"], "directly under the folder, this owner's");
  assert.deepEqual(s.list("a-0000000001", "needs"), []);
  let made = 0;
  const make = () => { made++; return `salt-${made}`; };
  assert.deepEqual([s.secret("avatar-salt.txt", make), s.secret("avatar-salt.txt", make), made], ["salt-1", "salt-1", 1], "made once");
  assert.throws(() => s.append("a-0000000001", "x.geml", () => "bad id!", () => ({})), /is not one/);
}

test("the documents on files (architecture §2.3): as the Node shell has always kept them", () => {
  contract(fileStore(mkdtempSync(join(tmpdir(), "gemsbang-store-"))));
});

test("the documents in memory (architecture §2.3): the same, kept nowhere", () => {
  contract(memoryStore());
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run build && node --test test/relay-doc-store.test.mjs`

Expected: the build passes; `dist/relay/doc-store.js` does not exist yet (`ERR_MODULE_NOT_FOUND`): `ℹ fail 1`.

- [ ] **Step 3: Write the code**

**Create `src/relay/doc-store.ts`:**

```ts
// Where the relay's documents live (architecture §2.3, §2.4): behind one
// interface, so the same relay runs on files (the Node shell, a company's own
// deployment, the tests), in memory, or on SQLite — a Durable Object's own
// (plan AA), or node:sqlite. A document is its data blocks in order, each
// sealed on the document's chain; an append is built from the document as it
// stands, under its lock where there are several writers, and a block whose
// id is already there is answered as it is (a client that sends again does
// not duplicate). A secret is made once and kept: the phone hashes' salt.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderDataBlock, type DataBlock } from "../core/im/chain.js";
import type { JsonValue } from "../core/schema.js";
import { appendBlock, BLOCK_ID, docHead, lastHash, listDocs, readDoc, RELAY_OWNER, sealed, type Appended, type Doc } from "./store.js";

/** The whole value of a block, built from the document as it stands, the last block's hash and the id. */
export type Build = (d: Doc, prev: string | null, id: string) => Record<string, JsonValue>;

export interface DocStore {
  /** A document as it stands; one never written is there with no blocks. */
  read(owner: string, doc: string): Doc;
  /** One block appended, its id from `idOf`; a block of that id already there is answered as it is. */
  append(owner: string, doc: string, idOf: (d: Doc) => string, build: Build): Appended;
  /** The documents under `<owner>/<dir>/`, as doc paths, sorted. */
  list(owner: string, dir: string): string[];
  /** A secret made once by `make` and kept. */
  secret(name: string, make: () => string): string;
}

/** A block sealed on the document's chain under the id given. */
export const appendSealed = (s: DocStore, owner: string, doc: string, id: string, value: Record<string, JsonValue>): Appended =>
  s.append(owner, doc, () => id, (_d, prev) => sealed({ ...value, id }, prev));

/** Files under `root`, as the Node shell has always kept them: `<root>/<owner>/<doc>`, each append under the document's lock. */
export function fileStore(root: string): DocStore & { root: string } {
  return {
    root,
    read: (owner, doc) => readDoc(root, owner, doc),
    append: (owner, doc, idOf, build) => appendBlock(root, owner, doc, idOf, build),
    list: (owner, dir) => listDocs(root, owner, dir),
    secret: (name, make) => {
      const dir = join(root, RELAY_OWNER), path = join(dir, name);
      if (!existsSync(path)) {
        mkdirSync(dir, { recursive: true });
        try { writeFileSync(path, make(), { flag: "wx" }); } catch { /* another writer made it first */ }
      }
      return readFileSync(path, "utf8").trim();
    },
  };
}

/** The append the other stores share: the existing block answered as it is, else the value built on the chain and put. */
function appendTo(d: Doc, idOf: (d: Doc) => string, build: Build, put: (id: string, value: Record<string, JsonValue>) => void): Appended {
  const id = idOf(d);
  if (!BLOCK_ID.test(id)) throw new Error(`block id ${JSON.stringify(id)} is not one`);
  const existing = d.blocks.find((b) => b.id === id);
  if (existing !== undefined) return { block: existing, existed: true };
  const value = build(d, lastHash(d), id);
  put(id, value);
  return { block: { id, value }, existed: false };
}

const docOf = (owner: string, doc: string, blocks: DataBlock[]): Doc =>
  blocks.length === 0 ? { blocks: [], diagnostics: [], text: "", exists: false } : { blocks, diagnostics: [], text: docHead(owner, doc) + blocks.map((b) => renderDataBlock(b.id, b.value)).join(""), exists: true };

/** Is `doc` directly under `dir/`? */
const directlyUnder = (doc: string, dir: string): boolean => doc.startsWith(`${dir}/`) && !doc.slice(dir.length + 1).includes("/");

/** Everything in memory, gone when the process is: tests, and a relay that keeps nothing. */
export function memoryStore(): DocStore {
  const docs = new Map<string, DataBlock[]>();
  const secrets = new Map<string, string>();
  const key = (owner: string, doc: string): string => `${owner}\n${doc}`;
  const read = (owner: string, doc: string): Doc => docOf(owner, doc, [...(docs.get(key(owner, doc)) ?? [])]);
  return {
    read,
    append: (owner, doc, idOf, build) => appendTo(read(owner, doc), idOf, build, (id, value) => { docs.set(key(owner, doc), [...(docs.get(key(owner, doc)) ?? []), { id, value }]); }),
    list: (owner, dir) => [...docs.keys()].map((k) => k.split("\n")).filter(([o, d]) => o === owner && directlyUnder(d!, dir)).map(([, d]) => d!).sort(),
    secret: (name, make) => {
      if (!secrets.has(name)) secrets.set(name, make());
      return secrets.get(name)!;
    },
  };
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npm run build && node --test test/relay-doc-store.test.mjs`

Expected: `ℹ pass 2`, `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/relay/doc-store.ts test/relay-doc-store.test.mjs
git commit -m "gemsbang X1: the relay's documents behind one interface, on files and in memory"
```


### Task 2: The relay and its tokens on a store

**Files:**
- Modify: `src/relay/tokens.ts` (a folder or a store)
- Modify: `src/relay/avatars.ts` (`store` beside `root`; every document through it; the salt as the store's secret; no texts to files without a folder)
- Modify: `src/relay/avatar-server.ts` (the Node shell keeps a folder)
- Test: `test/avatar-memory.test.mjs`

- [ ] **Step 1: Write the failing test**

**Create `test/avatar-memory.test.mjs`:**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { AvatarRelay } from "../dist/relay/avatars.js";
import { routeAvatars } from "../dist/relay/avatar-api.js";
import { memoryStore } from "../dist/relay/doc-store.js";

const ok = (x) => { assert.equal(x.ok, true, x.reason); return x; };
const codeIn = (text) => text.match(/(\d{6})/)[1];

test("the relay on a store of its own (architecture §2.3): with no folder, everything — people, avatars, groups, lines, cards, links, tokens, the salt — lives in the store, and the HTTP routes answer the same", () => {
  const texts = [];
  const store = memoryStore();
  const r = new AvatarRelay({ store, name: "relay.test", texter: (t) => { texts.push(t); } });
  assert.equal(r.root, undefined);
  const login = (phone) => {
    ok(r.startLogin({ phone }));
    const done = ok(r.finishLogin({ phone, code: codeIn(texts.at(-1).text) }));
    return { by: r.verify(done.token), person: done.person, token: done.token };
  };
  const john = login("13800138000"), li = login("13900139000");
  const me = ok(r.growAvatar(john.by, { name: "John" })).avatar;
  const liA = ok(r.growAvatar(li.by, { name: "李四" })).avatar;
  const g = ok(r.createGroup(john.by, { as: me.id, name: "设置页改版" })).venue;
  ok(r.addMember(john.by, g.owner, g.id, { as: me.id, avatar: liA.id }));
  const line = ok(r.say(li.by, g.owner, g.id, { as: liA.id, text: "@John 周五前能给反馈吗？" })).message;
  const agent = r.verify(ok(r.issueAvatar(john.by, me.id)).token);
  ok(r.ask(agent, { venue: `${g.owner}/${g.id}`, kind: "promise", summary: "李四要周五前的反馈", message: line.id }));
  assert.deepEqual(r.needsOf(john.person).map((n) => [n.kind, n.group]), [["promise", "设置页改版"]]);
  const link = ok(r.linkFor(john.by, g.owner, g.id, { as: me.id })).link;
  assert.equal(ok(r.linkInfo(link.code, undefined)).group.name, "设置页改版");
  assert.deepEqual(store.list(g.owner, "venues"), [`venues/${g.id}.geml`]);
  assert.equal(store.read("_relay", "tokens.geml").blocks.length, 3, "two people's tokens and an avatar's");
  const res = routeAvatars({ method: "GET", path: `/venues/${g.owner}/${g.id}`, query: {}, base: "https://im.example", token: john.token }, r);
  assert.deepEqual([res.status, JSON.parse(res.body).blocks.filter((b) => typeof b.value.text === "string").map((b) => b.value.text)], [200, ["@John 周五前能给反馈吗？"]]);
  assert.equal(new AvatarRelay({ store, name: "relay.test", texter: () => undefined }).verify(john.token)?.speaker, `person:${john.person}`, "a second relay on the same store knows the same tokens");
  assert.throws(() => new AvatarRelay({ name: "nowhere" }), /a root or a store/);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run build && node --test test/avatar-memory.test.mjs`

Expected: the build passes; a relay with no folder cannot keep anything (`TypeError`): `ℹ fail 1`.

- [ ] **Step 3: Write the code**

**In `src/relay/avatar-server.ts`, replace:**

```ts

export function startAvatarRelay(o: AvatarRelayOptions & { port?: number; host?: string; publicUrl?: string; version?: string }): Promise<AvatarServer> {
  // The file channel unless the operator gave others (spec §7.3: the outlet first, real channels later).
```

**with:**

```ts

/** The Node shell keeps the relay on files under `root`. */
export function startAvatarRelay(o: AvatarRelayOptions & { root: string; port?: number; host?: string; publicUrl?: string; version?: string }): Promise<AvatarServer> {
  // The file channel unless the operator gave others (spec §7.3: the outlet first, real channels later).
```

**In `src/relay/avatars.ts`, replace:**

```ts
import { createHash, randomBytes, randomInt } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeText, type DataBlock } from "../core/im/chain.js";
```

**with:**

```ts
import { createHash, randomBytes, randomInt } from "node:crypto";
import { normalizeText, type DataBlock } from "../core/im/chain.js";
```

**In `src/relay/avatars.ts`, replace:**

```ts
import { DEFAULT_LANG, isLang, say, type Fault, type Lang } from "../core/avatar/words.js";
import { appendBlock, appendSealed, BLOCK_ID, DOC, nextId, readDoc, RELAY_OWNER, sealed } from "./store.js";
import type { PushAdapter } from "./push.js";
```

**with:**

```ts
import { DEFAULT_LANG, isLang, say, type Fault, type Lang } from "../core/avatar/words.js";
import { BLOCK_ID, DOC, nextId, RELAY_OWNER, sealed } from "./store.js";
import { appendSealed, fileStore, type DocStore } from "./doc-store.js";
import type { PushAdapter } from "./push.js";
```

**In `src/relay/avatars.ts`, replace:**

```ts

export interface AvatarRelayOptions { root: string; name: string; now?: () => string; texter?: Texter; rand?: () => number; /** The push channels the relay offers (spec §7.3); none unless given. */ push?: PushAdapter[] }
/** A refusal: the status, the code and its parameters, and the code's words in Chinese. */
```

**with:**

```ts

/** Where its documents live: a folder (`root`, files as the Node shell keeps them) or a store (doc-store.ts: memory, SQLite). */
export interface AvatarRelayOptions { root?: string; store?: DocStore; name: string; now?: () => string; texter?: Texter; rand?: () => number; /** The push channels the relay offers (spec §7.3); none unless given. */ push?: PushAdapter[] }
/** A refusal: the status, the code and its parameters, and the code's words in Chinese. */
```

**In `src/relay/avatars.ts`, replace:**

```ts
export class AvatarRelay {
  readonly root: string;
  readonly name: string;
```

**with:**

```ts
export class AvatarRelay {
  /** The folder of a relay on files; none on another store. */
  readonly root: string | undefined;
  readonly store: DocStore;
  readonly name: string;
```

**In `src/relay/avatars.ts`, replace:**

```ts
  constructor(o: AvatarRelayOptions) {
    this.root = o.root;
    this.name = o.name;
    this.texter = o.texter ?? fileTexter(o.root);
    this.rand = o.rand ?? Math.random;
```

**with:**

```ts
  constructor(o: AvatarRelayOptions) {
    if (o.store === undefined && o.root === undefined) throw new Error("a relay needs a root or a store");
    this.root = o.root;
    this.store = o.store ?? fileStore(o.root!);
    this.name = o.name;
    // On files, a text the operator has no route for is a file; elsewhere it goes nowhere until they give one.
    this.texter = o.texter ?? (o.root !== undefined ? fileTexter(o.root) : () => undefined);
    this.rand = o.rand ?? Math.random;
```

**In `src/relay/avatars.ts`, replace:**

```ts
  private emit(owner: string, doc: string, block: DataBlock): void { for (const fn of this.listeners) fn({ owner, doc, block }); }
  verify(token: string): TokenRecord | undefined { return verifyToken(this.root, token); }

  /** The salt of the phone hashes, made once: a hash of a phone number without it could be undone by trying every number. */
  private salt(): string {
    const dir = join(this.root, RELAY_OWNER), path = join(dir, SALT);
    if (!existsSync(path)) {
      mkdirSync(dir, { recursive: true });
      try { writeFileSync(path, hex(16), { flag: "wx" }); } catch { /* another writer made it first */ }
    }
    return readFileSync(path, "utf8").trim();
  }
```

**with:**

```ts
  private emit(owner: string, doc: string, block: DataBlock): void { for (const fn of this.listeners) fn({ owner, doc, block }); }
  verify(token: string): TokenRecord | undefined { return verifyToken(this.store, token); }

  /** The salt of the phone hashes, made once: a hash of a phone number without it could be undone by trying every number. */
  private salt(): string { return this.store.secret(SALT, () => hex(16)); }
```

**In `src/relay/avatars.ts`, replace:**

```ts
    const age = (b: DataBlock): number => t - Date.parse(str(b.value["at"]) ?? "");
    const recent = readDoc(this.root, RELAY_OWNER, CODES).blocks.filter((b) => /^code-\d+$/.test(b.id) && age(b) < ONE_HOUR_MS);
    if (recent.filter((b) => b.value["phone"] === h && age(b) < CODE_TTL_MS).length >= CODES_PER_PHONE) return fail(429, "code.tooMany");
```

**with:**

```ts
    const age = (b: DataBlock): number => t - Date.parse(str(b.value["at"]) ?? "");
    const recent = this.store.read(RELAY_OWNER, CODES).blocks.filter((b) => /^code-\d+$/.test(b.id) && age(b) < ONE_HOUR_MS);
    if (recent.filter((b) => b.value["phone"] === h && age(b) < CODE_TTL_MS).length >= CODES_PER_PHONE) return fail(429, "code.tooMany");
```

**In `src/relay/avatars.ts`, replace:**

```ts
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    appendBlock(this.root, RELAY_OWNER, CODES, nextId("code"), (_d, prev, id) => sealed({ id, phone: h, code: hashToken(`${h}:${code}`), at: now, ...(ip !== undefined ? { ip } : {}) }, prev));
    try { void Promise.resolve(this.texter({ to: phone, text: codeText(code, lang) })).catch(() => { /* the operator's route failed; the next code tries again */ }); } catch { /* the same */ }
```

**with:**

```ts
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    this.store.append(RELAY_OWNER, CODES, nextId("code"), (_d, prev, id) => sealed({ id, phone: h, code: hashToken(`${h}:${code}`), at: now, ...(ip !== undefined ? { ip } : {}) }, prev));
    try { void Promise.resolve(this.texter({ to: phone, text: codeText(code, lang) })).catch(() => { /* the operator's route failed; the next code tries again */ }); } catch { /* the same */ }
```

**In `src/relay/avatars.ts`, replace:**

```ts
  private personByPhone(h: string): string | undefined {
    const b = readDoc(this.root, RELAY_OWNER, PHONES).blocks.find((x) => x.id === `phone-${h.slice(7, 31)}`);
    return b === undefined ? undefined : str(b.value["person"]);
```

**with:**

```ts
  private personByPhone(h: string): string | undefined {
    const b = this.store.read(RELAY_OWNER, PHONES).blocks.find((x) => x.id === `phone-${h.slice(7, 31)}`);
    return b === undefined ? undefined : str(b.value["person"]);
```

**In `src/relay/avatars.ts`, replace:**

```ts
    if (isFail(p)) return p;
    const { token } = issueToken(this.root, { speaker: `person:${p.person}`, scope: "person", by: "login", at: this.now() });
    return { ok: true, token, person: p.person, new: p.new };
```

**with:**

```ts
    if (isFail(p)) return p;
    const { token } = issueToken(this.store, { speaker: `person:${p.person}`, scope: "person", by: "login", at: this.now() });
    return { ok: true, token, person: p.person, new: p.new };
```

**In `src/relay/avatars.ts`, replace:**

```ts
    const h = hashPhone(phone, this.salt()), now = this.now(), t = Date.parse(now);
    const d = readDoc(this.root, RELAY_OWNER, CODES);
    const recent = (b: DataBlock): boolean => t - Date.parse(str(b.value["at"]) ?? "") < CODE_TTL_MS;
```

**with:**

```ts
    const h = hashPhone(phone, this.salt()), now = this.now(), t = Date.parse(now);
    const d = this.store.read(RELAY_OWNER, CODES);
    const recent = (b: DataBlock): boolean => t - Date.parse(str(b.value["at"]) ?? "") < CODE_TTL_MS;
```

**In `src/relay/avatars.ts`, replace:**

```ts
    if (hit === undefined) {
      appendBlock(this.root, RELAY_OWNER, CODES, nextId("miss"), (_d, prev, id) => sealed({ id, phone: h, at: now }, prev));
      return misses + 1 >= CODE_MISSES ? fail(429, "code.locked") : fail(401, "code.wrong");
    }
    appendBlock(this.root, RELAY_OWNER, CODES, nextId("used"), (_d, prev, id) => sealed({ id, code: hit.id, at: now }, prev));
    const candidate = `p-${hex(5)}`;
    const mapped = appendSealed(this.root, RELAY_OWNER, PHONES, `phone-${h.slice(7, 31)}`, { phone: h, person: candidate, at: now });
    const person = str(mapped.block.value["person"]) ?? candidate;
    const asked = o["lang"];
    if (!mapped.existed) appendSealed(this.root, RELAY_OWNER, peopleDoc(person), "person", { phone: h, lang: isLang(asked) ? asked : DEFAULT_LANG, at: now });
    return { person, new: !mapped.existed };
```

**with:**

```ts
    if (hit === undefined) {
      this.store.append(RELAY_OWNER, CODES, nextId("miss"), (_d, prev, id) => sealed({ id, phone: h, at: now }, prev));
      return misses + 1 >= CODE_MISSES ? fail(429, "code.locked") : fail(401, "code.wrong");
    }
    this.store.append(RELAY_OWNER, CODES, nextId("used"), (_d, prev, id) => sealed({ id, code: hit.id, at: now }, prev));
    const candidate = `p-${hex(5)}`;
    const mapped = appendSealed(this.store, RELAY_OWNER, PHONES, `phone-${h.slice(7, 31)}`, { phone: h, person: candidate, at: now });
    const person = str(mapped.block.value["person"]) ?? candidate;
    const asked = o["lang"];
    if (!mapped.existed) appendSealed(this.store, RELAY_OWNER, peopleDoc(person), "person", { phone: h, lang: isLang(asked) ? asked : DEFAULT_LANG, at: now });
    return { person, new: !mapped.existed };
```

**In `src/relay/avatars.ts`, replace:**

```ts
    let lang: Lang = DEFAULT_LANG;
    for (const b of readDoc(this.root, RELAY_OWNER, peopleDoc(person)).blocks) {
      const v = b.value["lang"];
```

**with:**

```ts
    let lang: Lang = DEFAULT_LANG;
    for (const b of this.store.read(RELAY_OWNER, peopleDoc(person)).blocks) {
      const v = b.value["lang"];
```

**In `src/relay/avatars.ts`, replace:**

```ts
    if (!isLang(lang)) return fail(400, "lang.unknown");
    appendBlock(this.root, RELAY_OWNER, peopleDoc(person), nextId("lang"), (_d, prev, id) => sealed({ id, lang, at: this.now() }, prev));
    return { ok: true, lang };
```

**with:**

```ts
    if (!isLang(lang)) return fail(400, "lang.unknown");
    this.store.append(RELAY_OWNER, peopleDoc(person), nextId("lang"), (_d, prev, id) => sealed({ id, lang, at: this.now() }, prev));
    return { ok: true, lang };
```

**In `src/relay/avatars.ts`, replace:**

```ts
    let name: string | undefined;
    for (const b of readDoc(this.root, RELAY_OWNER, peopleDoc(person)).blocks) if (/^default-\d+$/.test(b.id)) name = str(b.value["name"]);
    return name;
```

**with:**

```ts
    let name: string | undefined;
    for (const b of this.store.read(RELAY_OWNER, peopleDoc(person)).blocks) if (/^default-\d+$/.test(b.id)) name = str(b.value["name"]);
    return name;
```

**In `src/relay/avatars.ts`, replace:**

```ts
    const name = v === null ? null : (v as string).trim();
    appendBlock(this.root, RELAY_OWNER, peopleDoc(person), nextId("default"), (_d, prev, id) => sealed({ id, name, at: this.now() }, prev));
    return name === null ? { ok: true } : { ok: true, name };
```

**with:**

```ts
    const name = v === null ? null : (v as string).trim();
    this.store.append(RELAY_OWNER, peopleDoc(person), nextId("default"), (_d, prev, id) => sealed({ id, name, at: this.now() }, prev));
    return name === null ? { ok: true } : { ok: true, name };
```

**In `src/relay/avatars.ts`, replace:**

```ts
    let name: string | undefined;
    for (const b of readDoc(this.root, avatar, "avatar.geml").blocks) if (b.id === "avatar" || /^name-\d+$/.test(b.id)) name = str(b.value["name"]) ?? name;
    if (name === undefined) return undefined;
```

**with:**

```ts
    let name: string | undefined;
    for (const b of this.store.read(avatar, "avatar.geml").blocks) if (b.id === "avatar" || /^name-\d+$/.test(b.id)) name = str(b.value["name"]) ?? name;
    if (name === undefined) return undefined;
```

**In `src/relay/avatars.ts`, replace:**

```ts
    const out: AvatarCard[] = [];
    for (const b of readDoc(this.root, RELAY_OWNER, peopleDoc(person)).blocks) {
      if (!/^avatar-\d+$/.test(b.id)) continue;
```

**with:**

```ts
    const out: AvatarCard[] = [];
    for (const b of this.store.read(RELAY_OWNER, peopleDoc(person)).blocks) {
      if (!/^avatar-\d+$/.test(b.id)) continue;
```

**In `src/relay/avatars.ts`, replace:**

```ts
  private ownerOf(avatar: string): string | undefined {
    const b = readDoc(this.root, RELAY_OWNER, OWNERS).blocks.find((x) => x.id === `owner-${avatar}`);
    return b === undefined ? undefined : str(b.value["person"]);
```

**with:**

```ts
  private ownerOf(avatar: string): string | undefined {
    const b = this.store.read(RELAY_OWNER, OWNERS).blocks.find((x) => x.id === `owner-${avatar}`);
    return b === undefined ? undefined : str(b.value["person"]);
```

**In `src/relay/avatars.ts`, replace:**

```ts
    const avatar = `a-${hex(5)}`, now = this.now();
    appendSealed(this.root, RELAY_OWNER, OWNERS, `owner-${avatar}`, { person, at: now });
    appendBlock(this.root, RELAY_OWNER, peopleDoc(person), nextId("avatar"), (_d, prev, id) => sealed({ id, avatar, at: now }, prev));
    const made = appendSealed(this.root, avatar, "avatar.geml", "avatar", { name, at: now });
    this.emit(avatar, "avatar.geml", made.block);
```

**with:**

```ts
    const avatar = `a-${hex(5)}`, now = this.now();
    appendSealed(this.store, RELAY_OWNER, OWNERS, `owner-${avatar}`, { person, at: now });
    this.store.append(RELAY_OWNER, peopleDoc(person), nextId("avatar"), (_d, prev, id) => sealed({ id, avatar, at: now }, prev));
    const made = appendSealed(this.store, avatar, "avatar.geml", "avatar", { name, at: now });
    this.emit(avatar, "avatar.geml", made.block);
```

**In `src/relay/avatars.ts`, replace:**

```ts
    const name = (v as string).trim();
    const a = appendBlock(this.root, avatar, "avatar.geml", nextId("name"), (_d, prev, id) => sealed({ id, name, at: this.now() }, prev));
    this.emit(avatar, "avatar.geml", a.block);
```

**with:**

```ts
    const name = (v as string).trim();
    const a = this.store.append(avatar, "avatar.geml", nextId("name"), (_d, prev, id) => sealed({ id, name, at: this.now() }, prev));
    this.emit(avatar, "avatar.geml", a.block);
```

**In `src/relay/avatars.ts`, replace:**

```ts
    let rules = DEFAULT_RULES;
    for (const b of readDoc(this.root, avatar, "rules.geml").blocks) {
      if (!/^rules-\d+$/.test(b.id)) continue;
```

**with:**

```ts
    let rules = DEFAULT_RULES;
    for (const b of this.store.read(avatar, "rules.geml").blocks) {
      if (!/^rules-\d+$/.test(b.id)) continue;
```

**In `src/relay/avatars.ts`, replace:**

```ts
    if ("code" in next) return refuse(400, next);
    appendBlock(this.root, avatar, "rules.geml", nextId("rules"), (_d, prev, id) => sealed({ id, mark: next.mark, borrow: next.borrow, at: this.now() }, prev));
    return { ok: true, rules: next };
```

**with:**

```ts
    if ("code" in next) return refuse(400, next);
    this.store.append(avatar, "rules.geml", nextId("rules"), (_d, prev, id) => sealed({ id, mark: next.mark, borrow: next.borrow, at: this.now() }, prev));
    return { ok: true, rules: next };
```

**In `src/relay/avatars.ts`, replace:**

```ts
    if (refused !== undefined) return refused;
    return { ok: true, ...issueToken(this.root, { speaker: avatarSpeaker(avatar), scope: "avatar", by: by.speaker, at: this.now() }) };
  }
```

**with:**

```ts
    if (refused !== undefined) return refused;
    return { ok: true, ...issueToken(this.store, { speaker: avatarSpeaker(avatar), scope: "avatar", by: by.speaker, at: this.now() }) };
  }
```

**In `src/relay/avatars.ts`, replace:**

```ts
    if (typeof person !== "string") return person;
    return { ok: true, ...issueToken(this.root, { speaker: by.speaker, scope: "device", by: by.speaker, at: this.now() }) };
  }
```

**with:**

```ts
    if (typeof person !== "string") return person;
    return { ok: true, ...issueToken(this.store, { speaker: by.speaker, scope: "device", by: by.speaker, at: this.now() }) };
  }
```

**In `src/relay/avatars.ts`, replace:**

```ts
    if (!AVATAR_ID.test(owner) || !VENUE_ID.test(venue)) return undefined;
    const d = readDoc(this.root, owner, venueDoc(venue));
    const meta = d.blocks.find((b) => b.id === "venue")?.value;
```

**with:**

```ts
    if (!AVATAR_ID.test(owner) || !VENUE_ID.test(venue)) return undefined;
    const d = this.store.read(owner, venueDoc(venue));
    const meta = d.blocks.find((b) => b.id === "venue")?.value;
```

**In `src/relay/avatars.ts`, replace:**

```ts
    const now = this.now();
    const m = appendBlock(this.root, owner, venueDoc(venue), nextId("member"), (_d, prev, id) => sealed({ id, avatar: avatarSpeaker(avatar), by, at: now }, prev));
    this.emit(owner, venueDoc(venue), m.block);
    const j = appendBlock(this.root, avatar, "joined.geml", nextId("join"), (_d, prev, id) => sealed({ id, owner, venue, at: now }, prev));
    this.emit(avatar, "joined.geml", j.block);
```

**with:**

```ts
    const now = this.now();
    const m = this.store.append(owner, venueDoc(venue), nextId("member"), (_d, prev, id) => sealed({ id, avatar: avatarSpeaker(avatar), by, at: now }, prev));
    this.emit(owner, venueDoc(venue), m.block);
    const j = this.store.append(avatar, "joined.geml", nextId("join"), (_d, prev, id) => sealed({ id, owner, venue, at: now }, prev));
    this.emit(avatar, "joined.geml", j.block);
```

**In `src/relay/avatars.ts`, replace:**

```ts
    const out: { owner: string; venue: string }[] = [];
    for (const b of readDoc(this.root, avatar, "joined.geml").blocks) {
      const owner = str(b.value["owner"]), venue = str(b.value["venue"]);
```

**with:**

```ts
    const out: { owner: string; venue: string }[] = [];
    for (const b of this.store.read(avatar, "joined.geml").blocks) {
      const owner = str(b.value["owner"]), venue = str(b.value["venue"]);
```

**In `src/relay/avatars.ts`, replace:**

```ts
    const venue = `g-${hex(5)}`;
    const made = appendSealed(this.root, a.avatar, venueDoc(venue), "venue", { kind: "group", name, by: avatarSpeaker(a.avatar), at: this.now() });
    this.emit(a.avatar, venueDoc(venue), made.block);
```

**with:**

```ts
    const venue = `g-${hex(5)}`;
    const made = appendSealed(this.store, a.avatar, venueDoc(venue), "venue", { kind: "group", name, by: avatarSpeaker(a.avatar), at: this.now() });
    this.emit(a.avatar, venueDoc(venue), made.block);
```

**In `src/relay/avatars.ts`, replace:**

```ts
    const venue = `d-${createHash("sha256").update(`${first}:${second}`, "utf8").digest("hex").slice(0, 10)}`;
    const made = appendSealed(this.root, first, venueDoc(venue), "venue", { kind: "dm", by: avatarSpeaker(a.avatar), at: this.now() });
    if (!made.existed) {
```

**with:**

```ts
    const venue = `d-${createHash("sha256").update(`${first}:${second}`, "utf8").digest("hex").slice(0, 10)}`;
    const made = appendSealed(this.store, first, venueDoc(venue), "venue", { kind: "dm", by: avatarSpeaker(a.avatar), at: this.now() });
    if (!made.existed) {
```

**In `src/relay/avatars.ts`, replace:**

```ts
    const replyTo = str(o["replyTo"]);
    if (replyTo !== undefined && !readDoc(this.root, owner, doc).blocks.some((b) => b.id === replyTo)) return fail(400, "message.badReply");
    // Avatars calling avatars (§5 rule 7): an agent's line carries its hops, one more than the agent's line it answers.
```

**with:**

```ts
    const replyTo = str(o["replyTo"]);
    if (replyTo !== undefined && !this.store.read(owner, doc).blocks.some((b) => b.id === replyTo)) return fail(400, "message.badReply");
    // Avatars calling avatars (§5 rule 7): an agent's line carries its hops, one more than the agent's line it answers.
```

**In `src/relay/avatars.ts`, replace:**

```ts
    const now = this.now();
    const made = appendBlock(this.root, owner, doc, own !== undefined ? () => own : nextId("msg"), (_d, prev, id) => sealed({ id, speaker: avatarSpeaker(a.avatar), by: a.by, text: normalizeText(text), at: now, ...(replyTo !== undefined ? { replyTo } : {}), ...(typeof hops === "number" ? { hops } : {}) }, prev));
    if (!made.existed) this.emit(owner, doc, made.block);
```

**with:**

```ts
    const now = this.now();
    const made = this.store.append(owner, doc, own !== undefined ? () => own : nextId("msg"), (_d, prev, id) => sealed({ id, speaker: avatarSpeaker(a.avatar), by: a.by, text: normalizeText(text), at: now, ...(replyTo !== undefined ? { replyTo } : {}), ...(typeof hops === "number" ? { hops } : {}) }, prev));
    if (!made.existed) this.emit(owner, doc, made.block);
```

**In `src/relay/avatars.ts`, replace:**

```ts
    if (!AVATAR_ID.test(owner) || !DOC.test(doc)) return fail(404, "doc.missing");
    const d = readDoc(this.root, owner, doc);
    if (!d.exists) return fail(404, "doc.missing");
```

**with:**

```ts
    if (!AVATAR_ID.test(owner) || !DOC.test(doc)) return fail(404, "doc.missing");
    const d = this.store.read(owner, doc);
    if (!d.exists) return fail(404, "doc.missing");
```

**In `src/relay/avatars.ts`, replace:**

```ts
    let rules = DEFAULT_LINK_RULES;
    for (const b of readDoc(this.root, owner, venueDoc(venue)).blocks) {
      if (!/^link-rules-\d+$/.test(b.id)) continue;
```

**with:**

```ts
    let rules = DEFAULT_LINK_RULES;
    for (const b of this.store.read(owner, venueDoc(venue)).blocks) {
      if (!/^link-rules-\d+$/.test(b.id)) continue;
```

**In `src/relay/avatars.ts`, replace:**

```ts
  private currentCode(venue: string): string | undefined {
    const codes = readDoc(this.root, RELAY_OWNER, `links/${venue}.geml`).blocks.filter((b) => /^code-\d+$/.test(b.id));
    return str(codes[codes.length - 1]?.value["code"]);
```

**with:**

```ts
  private currentCode(venue: string): string | undefined {
    const codes = this.store.read(RELAY_OWNER, `links/${venue}.geml`).blocks.filter((b) => /^code-\d+$/.test(b.id));
    return str(codes[codes.length - 1]?.value["code"]);
```

**In `src/relay/avatars.ts`, replace:**

```ts
    if (!LINK_CODE.test(code)) return undefined;
    const v = readDoc(this.root, RELAY_OWNER, `links/${code}.geml`).blocks.find((b) => b.id === "link")?.value;
    const owner = str(v?.["owner"]), venue = str(v?.["venue"]), expires = str(v?.["expires"]);
```

**with:**

```ts
    if (!LINK_CODE.test(code)) return undefined;
    const v = this.store.read(RELAY_OWNER, `links/${code}.geml`).blocks.find((b) => b.id === "link")?.value;
    const owner = str(v?.["owner"]), venue = str(v?.["venue"]), expires = str(v?.["expires"]);
```

**In `src/relay/avatars.ts`, replace:**

```ts
      const code = makeCode(randomBytes(8));
      if (appendSealed(this.root, RELAY_OWNER, `links/${code}.geml`, "link", { owner, venue, by, at: now, expires }).existed) continue;
      appendBlock(this.root, RELAY_OWNER, `links/${venue}.geml`, nextId("code"), (_d, prev, id) => sealed({ id, code, at: now }, prev));
      return { code, expires };
```

**with:**

```ts
      const code = makeCode(randomBytes(8));
      if (appendSealed(this.store, RELAY_OWNER, `links/${code}.geml`, "link", { owner, venue, by, at: now, expires }).existed) continue;
      this.store.append(RELAY_OWNER, `links/${venue}.geml`, nextId("code"), (_d, prev, id) => sealed({ id, code, at: now }, prev));
      return { code, expires };
```

**In `src/relay/avatars.ts`, replace:**

```ts
    if (next === undefined) return fail(400, "link.rules");
    const made = appendBlock(this.root, owner, venueDoc(venue), nextId("link-rules"), (_d, prev, id) => sealed({ id, forward: next.forward, approve: next.approve, by: avatarSpeaker(g.avatar), at: this.now() }, prev));
    this.emit(owner, venueDoc(venue), made.block);
```

**with:**

```ts
    if (next === undefined) return fail(400, "link.rules");
    const made = this.store.append(owner, venueDoc(venue), nextId("link-rules"), (_d, prev, id) => sealed({ id, forward: next.forward, approve: next.approve, by: avatarSpeaker(g.avatar), at: this.now() }, prev));
    this.emit(owner, venueDoc(venue), made.block);
```

**In `src/relay/avatars.ts`, replace:**

```ts
    const card = this.card(avatar)!;
    const token = by.scope === "device" ? issueToken(this.root, { speaker: avatarSpeaker(avatar), scope: "avatar", by: by.id, at: this.now() }).token : undefined;
    const done = (x: Partial<Joined>): Result<Joined> => ({ ok: true, venue: this.venueView(link.owner, link.venue, avatar)!, avatar: card, already: false, ...x, ...(token !== undefined ? { token } : {}) });
```

**with:**

```ts
    const card = this.card(avatar)!;
    const token = by.scope === "device" ? issueToken(this.store, { speaker: avatarSpeaker(avatar), scope: "avatar", by: by.id, at: this.now() }).token : undefined;
    const done = (x: Partial<Joined>): Result<Joined> => ({ ok: true, venue: this.venueView(link.owner, link.venue, avatar)!, avatar: card, already: false, ...x, ...(token !== undefined ? { token } : {}) });
```

**In `src/relay/avatars.ts`, replace:**

```ts
      if (asked !== undefined) return done({ pending: asked.id });
      const made = appendBlock(this.root, link.owner, "requests.geml", nextId("request"), (_d, prev, id) => sealed({ id, venue: link.venue, avatar: avatarSpeaker(avatar), link: code, at: this.now() }, prev));
      this.emit(link.owner, "requests.geml", made.block);
```

**with:**

```ts
      if (asked !== undefined) return done({ pending: asked.id });
      const made = this.store.append(link.owner, "requests.geml", nextId("request"), (_d, prev, id) => sealed({ id, venue: link.venue, avatar: avatarSpeaker(avatar), link: code, at: this.now() }, prev));
      this.emit(link.owner, "requests.geml", made.block);
```

**In `src/relay/avatars.ts`, replace:**

```ts
    this.join(link.owner, link.venue, avatar, avatarSpeaker(avatar));
    appendBlock(this.root, RELAY_OWNER, `links/${code}.geml`, nextId("use"), (_d, prev, id) => sealed({ id, at: this.now() }, prev));
    return done({});
```

**with:**

```ts
    this.join(link.owner, link.venue, avatar, avatarSpeaker(avatar));
    this.store.append(RELAY_OWNER, `links/${code}.geml`, nextId("use"), (_d, prev, id) => sealed({ id, at: this.now() }, prev));
    return done({});
```

**In `src/relay/avatars.ts`, replace:**

```ts
    if (isFail(p)) return p;
    const device = issueToken(this.root, { speaker: `person:${p.person}`, scope: "device", by: "login", at: this.now() });
    const { phone: _p, code: _c, lang: _l, ...rest } = obj(body) ?? {};
```

**with:**

```ts
    if (isFail(p)) return p;
    const device = issueToken(this.store, { speaker: `person:${p.person}`, scope: "device", by: "login", at: this.now() });
    const { phone: _p, code: _c, lang: _l, ...rest } = obj(body) ?? {};
```

**In `src/relay/avatars.ts`, replace:**

```ts
  requestsOf(owner: string): { id: string; venue: string; avatar: AvatarCard; at: string }[] {
    const d = readDoc(this.root, owner, "requests.geml");
    const answered = new Set(d.blocks.filter((b) => /^answer-\d+$/.test(b.id)).map((b) => b.value["request"]));
```

**with:**

```ts
  requestsOf(owner: string): { id: string; venue: string; avatar: AvatarCard; at: string }[] {
    const d = this.store.read(owner, "requests.geml");
    const answered = new Set(d.blocks.filter((b) => /^answer-\d+$/.test(b.id)).map((b) => b.value["request"]));
```

**In `src/relay/avatars.ts`, replace:**

```ts
  private settleRequest(owner: string, request: string, yes: boolean): Result<{ joined: boolean }> {
    const d = readDoc(this.root, owner, "requests.geml");
    const asked = d.blocks.find((b) => b.id === request && /^request-\d+$/.test(b.id));
```

**with:**

```ts
  private settleRequest(owner: string, request: string, yes: boolean): Result<{ joined: boolean }> {
    const d = this.store.read(owner, "requests.geml");
    const asked = d.blocks.find((b) => b.id === request && /^request-\d+$/.test(b.id));
```

**In `src/relay/avatars.ts`, replace:**

```ts
    if (d.blocks.some((b) => /^answer-\d+$/.test(b.id) && b.value["request"] === request)) return fail(409, "request.answered");
    const made = appendBlock(this.root, owner, "requests.geml", nextId("answer"), (_d, prev, id) => sealed({ id, request, yes, by: avatarSpeaker(owner), at: this.now() }, prev));
    this.emit(owner, "requests.geml", made.block);
```

**with:**

```ts
    if (d.blocks.some((b) => /^answer-\d+$/.test(b.id) && b.value["request"] === request)) return fail(409, "request.answered");
    const made = this.store.append(owner, "requests.geml", nextId("answer"), (_d, prev, id) => sealed({ id, request, yes, by: avatarSpeaker(owner), at: this.now() }, prev));
    this.emit(owner, "requests.geml", made.block);
```

**In `src/relay/avatars.ts`, replace:**

```ts
  needsOfAvatar(avatar: string): Need[] {
    const d = readDoc(this.root, avatar, "needs.geml");
    const answers = new Map(d.blocks.filter((b) => /^answer-\d+$/.test(b.id)).map((b) => [str(b.value["need"]) ?? "", b] as const));
    const expired = new Set(d.blocks.filter((b) => /^expired-\d+$/.test(b.id)).map((b) => str(b.value["need"]) ?? ""));
    const settled = new Set(readDoc(this.root, avatar, "requests.geml").blocks.filter((b) => /^answer-\d+$/.test(b.id)).map((b) => str(b.value["request"]) ?? ""));
    return d.blocks.filter((b) => /^need-\d+$/.test(b.id)).map((b) => this.needOf(avatar, b, answers, expired, settled));
```

**with:**

```ts
  needsOfAvatar(avatar: string): Need[] {
    const d = this.store.read(avatar, "needs.geml");
    const answers = new Map(d.blocks.filter((b) => /^answer-\d+$/.test(b.id)).map((b) => [str(b.value["need"]) ?? "", b] as const));
    const expired = new Set(d.blocks.filter((b) => /^expired-\d+$/.test(b.id)).map((b) => str(b.value["need"]) ?? ""));
    const settled = new Set(this.store.read(avatar, "requests.geml").blocks.filter((b) => /^answer-\d+$/.test(b.id)).map((b) => str(b.value["request"]) ?? ""));
    return d.blocks.filter((b) => /^need-\d+$/.test(b.id)).map((b) => this.needOf(avatar, b, answers, expired, settled));
```

**In `src/relay/avatars.ts`, replace:**

```ts
    const expires = n.expires;
    const made = appendBlock(this.root, avatar, "needs.geml", nextId("need"), (_d, prev, id) => sealed({
      id, kind: n.kind, summary: n.summary.trim(), options: n.options.map((o) => ({ label: o.label.trim(), ...(o.text !== undefined ? { text: o.text } : {}) })), ...(expires !== undefined ? { expires } : {}), at: now,
```

**with:**

```ts
    const expires = n.expires;
    const made = this.store.append(avatar, "needs.geml", nextId("need"), (_d, prev, id) => sealed({
      id, kind: n.kind, summary: n.summary.trim(), options: n.options.map((o) => ({ label: o.label.trim(), ...(o.text !== undefined ? { text: o.text } : {}) })), ...(expires !== undefined ? { expires } : {}), at: now,
```

**In `src/relay/avatars.ts`, replace:**

```ts
    // Only a card whose matter has a deadline is the sweep's; the rest wait until the person answers (architecture §6.3).
    if (expires !== undefined) appendBlock(this.root, RELAY_OWNER, "needs-open.geml", nextId("open"), (_d, prev, id) => sealed({ id, avatar, need: made.block.id, expires }, prev));
    if (n.kind === "borrow" && this.borrowAllowed(avatar, n.from, n.venue)) {
      // 以后不用问 was pressed for this asker or this chat (spec §7.4): nothing waits on the person; the card is answered by the relay, marked, and the job starts.
      const auto = appendBlock(this.root, avatar, "needs.geml", nextId("answer"), (_d, prev, bid) => sealed({ id: bid, need: made.block.id, choice: 0, by: "relay", auto: true, at: now }, prev));
      this.emit(avatar, "needs.geml", auto.block);
```

**with:**

```ts
    // Only a card whose matter has a deadline is the sweep's; the rest wait until the person answers (architecture §6.3).
    if (expires !== undefined) this.store.append(RELAY_OWNER, "needs-open.geml", nextId("open"), (_d, prev, id) => sealed({ id, avatar, need: made.block.id, expires }, prev));
    if (n.kind === "borrow" && this.borrowAllowed(avatar, n.from, n.venue)) {
      // 以后不用问 was pressed for this asker or this chat (spec §7.4): nothing waits on the person; the card is answered by the relay, marked, and the job starts.
      const auto = this.store.append(avatar, "needs.geml", nextId("answer"), (_d, prev, bid) => sealed({ id: bid, need: made.block.id, choice: 0, by: "relay", auto: true, at: now }, prev));
      this.emit(avatar, "needs.geml", auto.block);
```

**In `src/relay/avatars.ts`, replace:**

```ts
    const doc = venueDoc(venue.id);
    const reply = replyTo !== undefined && readDoc(this.root, venue.owner, doc).blocks.some((b) => b.id === replyTo) ? replyTo : undefined;
    const made = appendBlock(this.root, venue.owner, doc, nextId("msg"), (_d, prev, id) => sealed({ id, speaker: avatarSpeaker(avatar), by, text: normalizeText(text), at: this.now(), ...(reply !== undefined ? { replyTo: reply } : {}), ...extra }, prev));
    this.emit(venue.owner, doc, made.block);
```

**with:**

```ts
    const doc = venueDoc(venue.id);
    const reply = replyTo !== undefined && this.store.read(venue.owner, doc).blocks.some((b) => b.id === replyTo) ? replyTo : undefined;
    const made = this.store.append(venue.owner, doc, nextId("msg"), (_d, prev, id) => sealed({ id, speaker: avatarSpeaker(avatar), by, text: normalizeText(text), at: this.now(), ...(reply !== undefined ? { replyTo: reply } : {}), ...extra }, prev));
    this.emit(venue.owner, doc, made.block);
```

**In `src/relay/avatars.ts`, replace:**

```ts
    const allowPerson = need.kind === "borrow" && o["allowPerson"] === true, allowVenue = need.kind === "borrow" && o["allowVenue"] === true;
    const made = appendBlock(this.root, avatar, "needs.geml", nextId("answer"), (_d, prev, bid) => sealed({ id: bid, need: id, choice, ...(text !== undefined ? { text } : {}), ...(allowPerson ? { allowPerson: true } : {}), ...(allowVenue ? { allowVenue: true } : {}), by: "person", at: this.now() }, prev));
    this.emit(avatar, "needs.geml", made.block);
```

**with:**

```ts
    const allowPerson = need.kind === "borrow" && o["allowPerson"] === true, allowVenue = need.kind === "borrow" && o["allowVenue"] === true;
    const made = this.store.append(avatar, "needs.geml", nextId("answer"), (_d, prev, bid) => sealed({ id: bid, need: id, choice, ...(text !== undefined ? { text } : {}), ...(allowPerson ? { allowPerson: true } : {}), ...(allowVenue ? { allowVenue: true } : {}), by: "person", at: this.now() }, prev));
    this.emit(avatar, "needs.geml", made.block);
```

**In `src/relay/avatars.ts`, replace:**

```ts
  private closeOpen(avatar: string, need: string): void {
    appendBlock(this.root, RELAY_OWNER, "needs-open.geml", nextId("closed"), (_d, prev, id) => sealed({ id, avatar, need }, prev));
  }
```

**with:**

```ts
  private closeOpen(avatar: string, need: string): void {
    this.store.append(RELAY_OWNER, "needs-open.geml", nextId("closed"), (_d, prev, id) => sealed({ id, avatar, need }, prev));
  }
```

**In `src/relay/avatars.ts`, replace:**

```ts
  borrowAllowed(avatar: string, from: string | undefined, venue: { owner: string; id: string } | undefined): boolean {
    const d = readDoc(this.root, avatar, "needs.geml");
    const needs = new Map(d.blocks.filter((b) => /^need-\d+$/.test(b.id)).map((b) => [b.id, b.value] as const));
```

**with:**

```ts
  borrowAllowed(avatar: string, from: string | undefined, venue: { owner: string; id: string } | undefined): boolean {
    const d = this.store.read(avatar, "needs.geml");
    const needs = new Map(d.blocks.filter((b) => /^need-\d+$/.test(b.id)).map((b) => [b.id, b.value] as const));
```

**In `src/relay/avatars.ts`, replace:**

```ts
  sweep(): number {
    const d = readDoc(this.root, RELAY_OWNER, "needs-open.geml");
    const closed = new Set(d.blocks.filter((b) => /^closed-\d+$/.test(b.id)).map((b) => `${str(b.value["avatar"])}/${str(b.value["need"])}`));
```

**with:**

```ts
  sweep(): number {
    const d = this.store.read(RELAY_OWNER, "needs-open.geml");
    const closed = new Set(d.blocks.filter((b) => /^closed-\d+$/.test(b.id)).map((b) => `${str(b.value["avatar"])}/${str(b.value["need"])}`));
```

**In `src/relay/avatars.ts`, replace:**

```ts
      if (card === undefined || card.state === "answered") continue;
      const made = appendBlock(this.root, avatar, "needs.geml", nextId("expired"), (_d, prev, id) => sealed({ id, need, at: this.now() }, prev));
      this.emit(avatar, "needs.geml", made.block);
```

**with:**

```ts
      if (card === undefined || card.state === "answered") continue;
      const made = this.store.append(avatar, "needs.geml", nextId("expired"), (_d, prev, id) => sealed({ id, need, at: this.now() }, prev));
      this.emit(avatar, "needs.geml", made.block);
```

**In `src/relay/avatars.ts`, replace:**

```ts
    const on = new Set<string>();
    for (const b of readDoc(this.root, RELAY_OWNER, peopleDoc(person)).blocks) {
      if (!/^push-\d+$/.test(b.id)) continue;
```

**with:**

```ts
    const on = new Set<string>();
    for (const b of this.store.read(RELAY_OWNER, peopleDoc(person)).blocks) {
      if (!/^push-\d+$/.test(b.id)) continue;
```

**In `src/relay/avatars.ts`, replace:**

```ts
    if (!this.push.some((p) => p.id === channel)) return fail(404, "push.unknown", { channel });
    appendBlock(this.root, RELAY_OWNER, peopleDoc(person), nextId("push"), (_d, prev, id) => sealed({ id, channel, on: o["on"] !== false, at: this.now() }, prev));
    return { ok: true, channels: this.pushOf(person), offered: this.push.map((p) => p.id) };
```

**with:**

```ts
    if (!this.push.some((p) => p.id === channel)) return fail(404, "push.unknown", { channel });
    this.store.append(RELAY_OWNER, peopleDoc(person), nextId("push"), (_d, prev, id) => sealed({ id, channel, on: o["on"] !== false, at: this.now() }, prev));
    return { ok: true, channels: this.pushOf(person), offered: this.push.map((p) => p.id) };
```

**In `src/relay/avatars.ts`, replace:**

```ts
    let text: string | undefined;
    for (const b of readDoc(this.root, avatar, "templates.geml").blocks) if (/^placeholder-\d+$/.test(b.id)) text = str(b.value["text"]);
    return text ?? say("need.placeholder", this.languageOf(this.ownerOf(avatar) ?? ""));
```

**with:**

```ts
    let text: string | undefined;
    for (const b of this.store.read(avatar, "templates.geml").blocks) if (/^placeholder-\d+$/.test(b.id)) text = str(b.value["text"]);
    return text ?? say("need.placeholder", this.languageOf(this.ownerOf(avatar) ?? ""));
```

**In `src/relay/avatars.ts`, replace:**

```ts
    if (v !== null && (typeof v !== "string" || v.trim() === "" || [...v].length > 200)) return fail(400, "message.empty");
    appendBlock(this.root, avatar, "templates.geml", nextId("placeholder"), (_d, prev, id) => sealed({ id, text: v === null ? null : (v as string).trim(), at: this.now() }, prev));
    return { ok: true, text: this.placeholderOf(avatar) };
```

**with:**

```ts
    if (v !== null && (typeof v !== "string" || v.trim() === "" || [...v].length > 200)) return fail(400, "message.empty");
    this.store.append(avatar, "templates.geml", nextId("placeholder"), (_d, prev, id) => sealed({ id, text: v === null ? null : (v as string).trim(), at: this.now() }, prev));
    return { ok: true, text: this.placeholderOf(avatar) };
```

**In `src/relay/avatars.ts`, replace:**

```ts
    const on = new Map<string, boolean>();
    for (const b of readDoc(this.root, avatar, "auto.geml").blocks) if (/^auto-\d+$/.test(b.id) && typeof b.value["venue"] === "string") on.set(b.value["venue"], b.value["on"] === true);
    return [...on].filter(([, v]) => v).map(([k]) => k);
```

**with:**

```ts
    const on = new Map<string, boolean>();
    for (const b of this.store.read(avatar, "auto.geml").blocks) if (/^auto-\d+$/.test(b.id) && typeof b.value["venue"] === "string") on.set(b.value["venue"], b.value["on"] === true);
    return [...on].filter(([, v]) => v).map(([k]) => k);
```

**In `src/relay/avatars.ts`, replace:**

```ts
    if (on && this.venueState(m[1]!, m[2]!)?.members.includes(avatar) !== true) return fail(403, "venue.notMember");
    appendBlock(this.root, avatar, "auto.geml", nextId("auto"), (_d, prev, id) => sealed({ id, venue: `${m[1]}/${m[2]}`, on, at: this.now() }, prev));
    return { ok: true, auto: this.autoOf(avatar) };
```

**with:**

```ts
    if (on && this.venueState(m[1]!, m[2]!)?.members.includes(avatar) !== true) return fail(403, "venue.notMember");
    this.store.append(avatar, "auto.geml", nextId("auto"), (_d, prev, id) => sealed({ id, venue: `${m[1]}/${m[2]}`, on, at: this.now() }, prev));
    return { ok: true, auto: this.autoOf(avatar) };
```

**In `src/relay/avatars.ts`, replace:**

```ts
  private startWork(avatar: string, need: Need, state: "waiting" | "queued", auto: boolean): string {
    const made = appendBlock(this.root, avatar, WORK_DOC, nextId("work"), (_d, prev, id) => sealed({
      id, need: need.id, summary: need.summary, state, at: this.now(),
```

**with:**

```ts
  private startWork(avatar: string, need: Need, state: "waiting" | "queued", auto: boolean): string {
    const made = this.store.append(avatar, WORK_DOC, nextId("work"), (_d, prev, id) => sealed({
      id, need: need.id, summary: need.summary, state, at: this.now(),
```

**In `src/relay/avatars.ts`, replace:**

```ts
    const out = new Map<string, Work>();
    for (const b of readDoc(this.root, avatar, WORK_DOC).blocks) {
      const v = b.value;
```

**with:**

```ts
    const out = new Map<string, Work>();
    for (const b of this.store.read(avatar, WORK_DOC).blocks) {
      const v = b.value;
```

**In `src/relay/avatars.ts`, replace:**

```ts
        const view = w.venue === undefined ? undefined : this.venueView(w.venue.owner, w.venue.id, a.id);
        const line = w.venue !== undefined && w.message !== undefined ? readDoc(this.root, w.venue.owner, venueDoc(w.venue.id)).blocks.find((b) => b.id === w.message) : undefined;
        const asker = w.from ?? str(line?.value["speaker"])?.replace(/^avatar:/, "");
```

**with:**

```ts
        const view = w.venue === undefined ? undefined : this.venueView(w.venue.owner, w.venue.id, a.id);
        const line = w.venue !== undefined && w.message !== undefined ? this.store.read(w.venue.owner, venueDoc(w.venue.id)).blocks.find((b) => b.id === w.message) : undefined;
        const asker = w.from ?? str(line?.value["speaker"])?.replace(/^avatar:/, "");
```

**In `src/relay/avatars.ts`, replace:**

```ts
  private markWork(avatar: string, work: string, state: WorkState): void {
    const made = appendBlock(this.root, avatar, WORK_DOC, nextId("state"), (_d, prev, id) => sealed({ id, work, state, at: this.now() }, prev));
    this.emit(avatar, WORK_DOC, made.block);
```

**with:**

```ts
  private markWork(avatar: string, work: string, state: WorkState): void {
    const made = this.store.append(avatar, WORK_DOC, nextId("state"), (_d, prev, id) => sealed({ id, work, state, at: this.now() }, prev));
    this.emit(avatar, WORK_DOC, made.block);
```

**In `src/relay/tokens.ts`, replace:**

```ts
// speaker is its token's — a person's token speaks as `person:<id>`, an
// agent's as `agent:<name>@<owner>` — whatever the body claims.
import { createHash, randomBytes } from "node:crypto";
import { appendSealed, readDoc, RELAY_OWNER } from "./store.js";
```

**with:**

```ts
// speaker is its token's — a person's token speaks as `person:<id>`, an
// agent's as `agent:<name>@<owner>` — whatever the body claims. Kept on the
// relay's documents: its folder (`root`), or its store (doc-store.ts).
import { createHash, randomBytes } from "node:crypto";
import { appendSealed, fileStore, type DocStore } from "./doc-store.js";
import { RELAY_OWNER } from "./store.js";
```

**In `src/relay/tokens.ts`, replace:**

```ts
const rand = (): string => randomBytes(6).toString("hex");

export function issueToken(root: string, o: { speaker: string; scope: Scope; by: string; at: string }): { token: string; record: TokenRecord } {
  const token = `gwx_${randomBytes(24).toString("hex")}`;
  const id = `token-${rand()}`;
  appendSealed(root, RELAY_OWNER, TOKENS, id, { token: hashToken(token), speaker: o.speaker, scope: o.scope, at: o.at, by: o.by });
  return { token, record: { id, speaker: o.speaker, scope: o.scope, at: o.at, by: o.by } };
```

**with:**

```ts
const rand = (): string => randomBytes(6).toString("hex");
const storeOf = (at: string | DocStore): DocStore => (typeof at === "string" ? fileStore(at) : at);

export function issueToken(at: string | DocStore, o: { speaker: string; scope: Scope; by: string; at: string }): { token: string; record: TokenRecord } {
  const token = `gwx_${randomBytes(24).toString("hex")}`;
  const id = `token-${rand()}`;
  appendSealed(storeOf(at), RELAY_OWNER, TOKENS, id, { token: hashToken(token), speaker: o.speaker, scope: o.scope, at: o.at, by: o.by });
  return { token, record: { id, speaker: o.speaker, scope: o.scope, at: o.at, by: o.by } };
```

**In `src/relay/tokens.ts`, replace:**

```ts
/** The record a token stands for, or nothing: unknown, malformed, or revoked. */
export function verifyToken(root: string, token: string): TokenRecord | undefined {
  if (!token.startsWith("gwx_")) return undefined;
  const h = hashToken(token);
  const d = readDoc(root, RELAY_OWNER, TOKENS);
  const revoked = new Set(d.blocks.filter((b) => b.id.startsWith("revoke-")).map((b) => b.value["token"]));
```

**with:**

```ts
/** The record a token stands for, or nothing: unknown, malformed, or revoked. */
export function verifyToken(at: string | DocStore, token: string): TokenRecord | undefined {
  if (!token.startsWith("gwx_")) return undefined;
  const h = hashToken(token);
  const d = storeOf(at).read(RELAY_OWNER, TOKENS);
  const revoked = new Set(d.blocks.filter((b) => b.id.startsWith("revoke-")).map((b) => b.value["token"]));
```

**In `src/relay/tokens.ts`, replace:**

```ts
/** Revoke a token by its record's id; false when there is no such token. */
export function revokeToken(root: string, id: string, at: string): boolean {
  if (!readDoc(root, RELAY_OWNER, TOKENS).blocks.some((b) => b.id === id)) return false;
  appendSealed(root, RELAY_OWNER, TOKENS, `revoke-${rand()}`, { token: id, at });
  return true;
```

**with:**

```ts
/** Revoke a token by its record's id; false when there is no such token. */
export function revokeToken(root: string | DocStore, id: string, at: string): boolean {
  const s = storeOf(root);
  if (!s.read(RELAY_OWNER, TOKENS).blocks.some((b) => b.id === id)) return false;
  appendSealed(s, RELAY_OWNER, TOKENS, `revoke-${rand()}`, { token: id, at });
  return true;
```

- [ ] **Step 4: Run them to see them pass**

Run: `npm run build && node --test test/avatar-memory.test.mjs`

Expected: `ℹ pass 1`, `ℹ fail 0`.

Run: `node --test --test-concurrency=4 test/avatar-*.test.mjs test/relay-*.test.mjs test/gemsbang*.test.mjs test/gb-panel*.test.mjs`

Expected: every suite of the relay, the client and the pane passes as before: `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/relay/avatar-server.ts src/relay/avatars.ts src/relay/tokens.ts test/avatar-memory.test.mjs
git commit -m "gemsbang X2: the relay and its tokens keep their documents in a store"
```


### Task 3: SQLite: a Durable Object's store, and node:sqlite's

**Files:**
- Modify: `src/relay/doc-store.ts` (`SqlLike`, `nodeSql`, `sqlStore`)
- Test: `test/relay-doc-store.test.mjs` (the contract on SQLite; a relay across restarts)

- [ ] **Step 1: Write the failing test**

**In `test/relay-doc-store.test.mjs`, replace:**

```js
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendSealed, fileStore, memoryStore } from "../dist/relay/doc-store.js";
import { nextId, sealed } from "../dist/relay/store.js";

/** What every store does the same (architecture §2.3): documents of sealed blocks in order, an id already there answered as it is, the documents under a folder, a secret made once. */
```

**with:**

```js
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendSealed, fileStore, memoryStore, nodeSql, sqlStore } from "../dist/relay/doc-store.js";
import { AvatarRelay } from "../dist/relay/avatars.js";
import { nextId, sealed } from "../dist/relay/store.js";

/** What every store does the same (architecture §2.3): documents of sealed blocks in order, an id already there answered as it is, the documents under a folder, a secret made once. */
```

**In `test/relay-doc-store.test.mjs`, replace:**

```js
  contract(memoryStore());
});
```

**with:**

```js
  contract(memoryStore());
});

/** node:sqlite where this Node has it (22.13 and later), else the test says why it skipped. */
const sqlite = await import("node:sqlite").catch(() => undefined);

test("the documents on SQLite (architecture §2.3; a Durable Object's own in plan AA): the same, one row per block; a relay on it keeps its people and tokens across restarts", { skip: sqlite === undefined && "no node:sqlite in this Node" }, () => {
  contract(sqlStore(nodeSql(new sqlite.DatabaseSync(":memory:"))));
  const db = new sqlite.DatabaseSync(":memory:");
  const texts = [];
  const first = new AvatarRelay({ store: sqlStore(nodeSql(db)), name: "relay.test", texter: (t) => { texts.push(t); } });
  assert.equal(first.startLogin({ phone: "13800138000" }).ok, true);
  const done = first.finishLogin({ phone: "13800138000", code: texts.at(-1).text.match(/(\d{6})/)[1] });
  const again = new AvatarRelay({ store: sqlStore(nodeSql(db)), name: "relay.test", texter: () => undefined });
  assert.equal(again.verify(done.token)?.speaker, `person:${done.person}`, "the same database, a new relay: the token still holds");
  assert.equal(again.avatarsOf(done.person).length, 0);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run build && node --test test/relay-doc-store.test.mjs`

Expected: the build passes; `doc-store.js` has no `nodeSql` yet (`SyntaxError`): `ℹ fail 1`.

- [ ] **Step 3: Write the code**

**In `src/relay/doc-store.ts`, replace:**

```ts
      return secrets.get(name)!;
    },
  };
}
```

**with:**

```ts
      return secrets.get(name)!;
    },
  };
}

/** The part of a SQL database a store needs: a Durable Object's `ctx.storage.sql` is one as it is, node:sqlite's `DatabaseSync` through `nodeSql`. */
export interface SqlLike { exec(query: string, ...bindings: (string | number | null)[]): { toArray(): Record<string, unknown>[] } }

/** node:sqlite's `DatabaseSync` as a `SqlLike`. */
export function nodeSql(db: { prepare(query: string): { all(...p: (string | number | null)[]): unknown[]; run(...p: (string | number | null)[]): unknown } }): SqlLike {
  return {
    exec: (query, ...bindings) => {
      const st = db.prepare(query);
      const rows = /^\s*select\b/i.test(query) ? (st.all(...bindings) as Record<string, unknown>[]) : (st.run(...bindings), []);
      return { toArray: () => rows };
    },
  };
}

/** SQLite: one row per block, in order per document, its value as JSON; one row per secret. A Durable Object runs one writer at a time, so no lock is taken. */
export function sqlStore(sql: SqlLike): DocStore {
  sql.exec("CREATE TABLE IF NOT EXISTS blocks (owner TEXT NOT NULL, doc TEXT NOT NULL, seq INTEGER NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (owner, doc, seq))");
  sql.exec("CREATE UNIQUE INDEX IF NOT EXISTS blocks_by_id ON blocks (owner, doc, id)");
  sql.exec("CREATE TABLE IF NOT EXISTS secrets (name TEXT PRIMARY KEY, value TEXT NOT NULL)");
  const read = (owner: string, doc: string): Doc =>
    docOf(owner, doc, sql.exec("SELECT id, value FROM blocks WHERE owner = ? AND doc = ? ORDER BY seq", owner, doc).toArray().map((r) => ({ id: String(r["id"]), value: JSON.parse(String(r["value"])) as Record<string, JsonValue> })));
  return {
    read,
    append: (owner, doc, idOf, build) => appendTo(read(owner, doc), idOf, build, (id, value) => {
      sql.exec("INSERT INTO blocks (owner, doc, seq, id, value) VALUES (?, ?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM blocks WHERE owner = ? AND doc = ?), ?, ?)", owner, doc, owner, doc, id, JSON.stringify(value));
    }),
    list: (owner, dir) => sql.exec("SELECT DISTINCT doc FROM blocks WHERE owner = ? AND substr(doc, 1, ?) = ?", owner, dir.length + 1, `${dir}/`).toArray().map((r) => String(r["doc"])).filter((d) => directlyUnder(d, dir)).sort(),
    secret: (name, make) => {
      const kept = sql.exec("SELECT value FROM secrets WHERE name = ?", name).toArray()[0];
      if (kept !== undefined) return String(kept["value"]);
      sql.exec("INSERT OR IGNORE INTO secrets (name, value) VALUES (?, ?)", name, make());
      return String(sql.exec("SELECT value FROM secrets WHERE name = ?", name).toArray()[0]!["value"]);
    },
  };
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npm run build && node --test test/relay-doc-store.test.mjs`

Expected: `ℹ pass 3`, `ℹ fail 0` (on a Node without `node:sqlite`, the third is skipped and says why).

- [ ] **Step 5: Commit**

```bash
git add src/relay/doc-store.ts test/relay-doc-store.test.mjs
git commit -m "gemsbang X3: the relay's documents on SQLite — a Durable Object's own, or node:sqlite's"
```


### Task 4: The version and the four gates

**Files:**
- Modify: `package.json`, `package-lock.json`, `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json` (by the script)

- [ ] **Step 1: Bump the patch version**

```bash
node scripts/bump.mjs 0.5.9
```

- [ ] **Step 2: Run the four gates**

Run each as its own command and note the result:

```bash
npm run build
claude plugin validate .
claude plugin test .
node --test --test-concurrency=2 test/*.test.mjs
```

Expected: build passes; validate passes (the root `CLAUDE.md` warning it has always shown is not new); the plugin suite passes its 13; the node suite passes, with four more tests than before this plan.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json .claude-plugin/plugin.json .codex-plugin/plugin.json
git commit -m "gemsbang 0.5.9: the relay on a store of documents — files, memory or SQLite (plan X)"
```

