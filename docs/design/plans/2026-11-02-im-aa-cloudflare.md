# Gemsbang Plan AA: gemsbang.com on Cloudflare

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The beta can run at gemsbang.com. A Cloudflare Worker hands every request to one Durable Object. That object runs the relay, with its rules and answers unchanged, on its own SQLite. It sends sign-in codes through the Worker's mail binding from `noreply@gemsbang.com`, holds the waits on people's boxes, and marks cards expired when its alarm rings at their deadline. The Node shell and the object answer through one core, so the same tests hold for both. The configuration for gemsbang.com is in the repository, along with the steps to deploy it. Deploying, onboarding the domain for mail and choosing the plan are the maintainer's to do.

**Architecture:** A new module, `src/relay/avatar-shell.ts`, is what every shell does with a request (architecture §2.4):
- a browser's page;
- the body (at most a megabyte, and JSON);
- the token;
- a wait on the box, held until something lands, the time is up, or the asker went away;
- otherwise `routeAvatars`.

It returns the answer and never throws. `avatar-server.ts` keeps only Node's wire: reading the body, the WebSocket and the sweep.

The relay names its next deadline (`nextDeadline`): the earliest among the cards that still wait with one.

`src/relay/worker.ts` holds `RelayObject` and the Worker:
- **`RelayObject`** — the Durable Object. Its relay runs on `sqlStore(ctx.storage.sql)`. Its mailer is the `send_email` binding, and every answer waits for its mail to be handed over. After each request it sets its alarm to the next deadline; when the alarm rings, it sweeps and moves the alarm on.
- **The Worker** — sends every request to the one object.

The module types only the parts of the runtime it touches, so it builds with the rest. Node's tests run it with `node:sqlite` standing in for the object's database.

`cloudflare/wrangler.jsonc` has:
- the built worker as `main`;
- `nodejs_compat`;
- the object on SQLite (migration `v1`);
- the mail binding;
- the custom domain `gemsbang.com`;
- the name and the sender.

`cloudflare/README.md` lists the deploy steps.

**Tech Stack:** TypeScript (`src/relay`), Cloudflare Workers with a SQLite-backed Durable Object and Email Service (configuration only; the module imports nothing of theirs), `node:test` over `dist/` (the Worker's tests on node:sqlite, skipped with their reason on a Node without it).

**Before this plan:** gemsbang 0.5.11 on `main` (plan Z, `docs/design/plans/2026-11-02-im-z-box-sync.md`). The spec is `docs/design/specs/2026-11-01-gemsbang-architecture.md`:
- §2.3 — the beta on a Worker with Durable Objects; codes mailed from gemsbang.com; deadlines by the objects' own alarms.
- §2.4 — two shells, one core, the same tests.
- §7 — no global sweep on the beta.

## The series

| Plan | What it builds | What runs after it |
|---|---|---|
| P–U (done, 0.5.1–0.5.6) | Avatars as accounts, a group one link, the side panel, 需要你, hosted agents, borrowing Claude Code | The IM of avatars on a Node relay |
| V (done, 0.5.7) · no hosted layer, nothing on a clock | The hosted layer gone; cards wait unless the matter has a deadline; 借电脑 → 任务 | Avatars speak only through their person's own agents |
| W (done, 0.5.8) · ask before answering | Calls on the client, 回 / 以后这个群自动回 / 不回; 自动回 on the avatar; rounds in the background | An avatar answers when its person says so |
| X (done, 0.5.9) · the relay on a store | `DocStore`: files, memory, SQLite; the relay and its tokens on it | The same relay, ready to run inside a Durable Object |
| Y (done, 0.5.10) · email sign-in and the account | Ways in by email or phone, the service built in, the sign-in screens, the account page | A person signs in with an email |
| Z (done, 0.5.11) · the box and sync | Each person's box; state, difference and the wait; the client's cache per chat; waits instead of the poll | The panel is current within a second |
| **AA (this one)** · Cloudflare | One core for both shells; the next deadline; the Worker and its Durable Object; the configuration and the steps for gemsbang.com | gemsbang at gemsbang.com, once the maintainer deploys it |

## What the spec decided, and what this plan does about each

- **The beta on a Worker and Durable Objects (architecture §2.3).** The beta runs one object, as plan X said. The spec's table gives each entity an object of its own. This relay is synchronous, and so is the object's SQLite, so one object runs all of it with its rules unchanged and orders every write. Splitting by person, group and avatar waits until the load asks for it, and the documents are already one per entity. The Worker forwards every request to the object named `relay`.
- **Codes by mail from gemsbang.com (architecture §2.3, §3.2).** The object's mailer sends through the `send_email` binding `EMAIL` from `MAIL_FROM` (`noreply@gemsbang.com`), as "Gemsbang". An answer waits until its mail is handed over, so a code is never lost with the request. Before the first send, the domain must be onboarded (`wrangler email sending enable gemsbang.com`), which adds the SPF and DKIM records. Sending to any address needs Workers Paid. Both are the maintainer's steps.
- **Long polls inside the object (architecture §2.3, §5.2).** A wait is held there by the same core as on Node, for at most 25 seconds. Its time is billed as duration, which the spec accepts for the beta.
- **Deadlines by alarm, no global sweep (architecture §2.3, §7).** After each request the object sets its one alarm to the relay's next deadline, or removes it. When the alarm rings, it sweeps and moves the alarm on. The Node shell keeps its sweep every 30 seconds for a company's own servers.
- **Two shells, one core, the same tests (architecture §2.4).** `answerRequest` is the core. The Node shell's suites pass through it unchanged, and the Worker's tests drive the same flows: sign-in, pages, an agent's instructions, the wait and the alarm.
- **Not in this plan:**
  - deploying, onboarding mail and the paid plan (the maintainer's steps, `cloudflare/README.md`);
  - splitting the object;
  - the WebSocket `/subscribe` on Cloudflare (the client waits on the box instead);
  - removing the old base's `gemworks connect` stack.

## File structure

| File | Responsibility |
|---|---|
| `src/relay/avatar-shell.ts` (new) | `answerRequest`, `ShellRequest`, `BODY_LIMIT`: pages, bodies, tokens, the held wait, `server.error`. |
| `src/relay/avatar-server.ts` | Node's wire only: reading the body, `close` as the asker going away, the WebSocket, the sweep. |
| `src/relay/avatars.ts` | `nextDeadline`. |
| `src/relay/worker.ts` (new) | `RelayObject` (the relay on the object's SQLite, mail through the binding, the alarm) and the Worker. |
| `cloudflare/wrangler.jsonc`, `cloudflare/README.md` (new) | The configuration for gemsbang.com; the steps to deploy it. |
| `test/relay-shell`, `relay-worker`, `relay-cloudflare` `.test.mjs` (new); `test/avatar-need-relay.test.mjs` | Each task's tests. |

---

### Task 1: One core for every shell

**Files:**
- Create: `src/relay/avatar-shell.ts` (`answerRequest`, `ShellRequest`, `BODY_LIMIT`)
- Modify: `src/relay/avatar-server.ts` (Node's wire around the core: the body, `close` as the asker going away)
- Test: `test/relay-shell.test.mjs`

- [ ] **Step 1: Write the failing test**

**Create `test/relay-shell.test.mjs`:**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { AvatarRelay } from "../dist/relay/avatars.js";
import { memoryStore } from "../dist/relay/doc-store.js";
import { answerRequest } from "../dist/relay/avatar-shell.js";

/** A relay in memory, its mail kept; `ask` one request the way any shell would hand it over. */
function shell() {
  const mail = [];
  const relay = new AvatarRelay({ store: memoryStore(), name: "gemsbang.com", mailer: (m) => { mail.push(m); } });
  const ask = async (method, path, o = {}) => {
    const out = await answerRequest(relay, { method, url: new URL(path, "https://gemsbang.com"), base: "https://gemsbang.com", body: async () => (o.tooLarge ? undefined : o.raw !== undefined ? o.raw : o.body !== undefined ? JSON.stringify(o.body) : ""), ...(o.token ? { authorization: `Bearer ${o.token}` } : {}), ...(o.accept ? { accept: o.accept } : {}), ...(o.languages ? { languages: o.languages } : {}), ...(o.gone ? { gone: o.gone } : {}) });
    return { ...out, json: out.type.startsWith("application/json") ? JSON.parse(out.body) : undefined };
  };
  const signIn = async (email) => {
    await ask("POST", "/login", { body: { email } });
    return (await ask("POST", "/login/verify", { body: { email, code: /(\d{6})/.exec(mail[mail.length - 1].text)[1] } })).json.token;
  };
  return { relay, ask, signIn };
}

test("one core for every shell (architecture §2.4): a browser gets the page in its language, a script the JSON; a body too large or not JSON is refused in the asker's language; the token from the header", async () => {
  const { ask, signIn } = shell();
  const page = await ask("GET", "/login", { accept: "text/html", languages: "ja" });
  assert.deepEqual([page.status, page.type.startsWith("text/html"), /<html lang="ja">/.test(page.body)], [200, true, true]);
  assert.deepEqual((await ask("GET", "/")).json, { name: "gemsbang.com", kind: "gemsbang" });
  assert.deepEqual((await ask("POST", "/login", { tooLarge: true, languages: "en" })).json, { error: "body.tooLarge", reason: "The body is over 1 MB" });
  assert.equal((await ask("POST", "/login", { raw: "{nope", languages: "en" })).json.reason, "The body is not JSON");
  const token = await signIn("john@example.com");
  assert.equal((await ask("GET", "/me", { token })).json.scope, "person");
});

test("a wait on the box, in any shell (architecture §5.2): held while nothing is after `pts`, answered when something lands, or when the asker goes away", async () => {
  const { ask, signIn } = shell();
  const token = await signIn("john@example.com");
  await ask("POST", "/avatars", { token, body: { name: "John" } });
  const pts = (await ask("GET", "/updates/state", { token })).json.pts;
  let answered = false;
  const waiting = ask("GET", `/updates?pts=${pts}&timeout=20`, { token }).then((r) => { answered = true; return r; });
  await new Promise((done) => setTimeout(done, 50));
  assert.equal(answered, false, "held");
  await ask("POST", "/me/default-name", { token, body: { name: "老张" } });
  const got = (await waiting).json;
  assert.deepEqual(got.updates.map((u) => u.pts), [pts + 1]);
  let leave;
  const gone = new Promise((done) => { leave = done; });
  const left = ask("GET", `/updates?pts=${got.pts}&timeout=20`, { token, gone });
  leave();
  assert.deepEqual((await left).json.updates, [], "the asker went away: answered empty, nothing held");
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run build && node --test test/relay-shell.test.mjs`

Expected: the build passes; `dist/relay/avatar-shell.js` does not exist yet (`ERR_MODULE_NOT_FOUND`): `ℹ fail 1`.

- [ ] **Step 3: Write the code**

**In `src/relay/avatar-server.ts`, replace:**

```ts
// `node:http` around gemsbang's relay (transport §2.5, §7.1): a browser at
// `/i/<code>`, `/g/<group>` or `/login` gets the page (avatar-pages.ts), in
// its language; everything else is the JSON of avatar-api.ts, a body of at
// most a megabyte, the token from the Authorization header or the query.
// `GET /subscribe` is upgraded to a WebSocket whose client names the
```

**with:**

```ts
// `node:http` around gemsbang's relay (transport §2.5, §7.1; architecture
// §2.4: a company's own servers and local work), its documents on files.
// `GET /subscribe` is upgraded to a WebSocket whose client names the
```

**In `src/relay/avatar-server.ts`, replace:**

```ts
// pushed as it lands, as the client may read it — a venue's to its members,
// a message's `by` left out where its avatar does not mark. `GET /updates`
// with a `timeout` is a person's wait on their box (architecture §5.2): held
// open, at most 25 seconds, until something lands after their `pts`.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { JSON_TYPE, langOf, refusal, routeAvatars, type AvatarRequest } from "./avatar-api.js";
import { groupPage, HTML_TYPE, joinPage, loginPage } from "./avatar-pages.js";
import { AvatarRelay, type AvatarRelayOptions } from "./avatars.js";
```

**with:**

```ts
// pushed as it lands, as the client may read it — a venue's to its members,
// a message's `by` left out where its avatar does not mark. What it answers
// is avatar-shell.ts's, the same core the Worker's Durable Object runs.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { answerRequest, BODY_LIMIT } from "./avatar-shell.js";
import { AvatarRelay, type AvatarRelayOptions } from "./avatars.js";
```

**In `src/relay/avatar-server.ts`, replace:**

```ts
import { upgrade, type WsConnection } from "./ws.js";
import type { Lang } from "../core/avatar/words.js";
import { WAIT_MAX_S } from "../core/avatar/updates.js";
```

**with:**

```ts
import { upgrade, type WsConnection } from "./ws.js";
```

**In `src/relay/avatar-server.ts`, replace:**

```ts

/** A request body may be this long: a message, never a file's bytes. */
export const BODY_LIMIT = 1_048_576;

/** The pages by path, for a browser (`Accept: text/html`); a script at the same path gets the JSON. */
const PAGES: readonly [RegExp, (lang: Lang) => string][] = [[/^\/i\/[a-z0-9]{1,16}$/, joinPage], [/^\/g\/[gd]-[0-9a-f]{10}$/, groupPage], [/^\/login$/, loginPage]];
```

**with:**

```ts

export { BODY_LIMIT };
```

**In `src/relay/avatar-server.ts`, replace:**

```ts
}

/** How long a wait for updates may hold, in seconds: the `timeout` asked, at most WAIT_MAX_S; none asked, no wait. */
const waitOf = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.min(n, WAIT_MAX_S) : 0; };
```

**with:**

```ts
}
```

**In `src/relay/avatar-server.ts`, replace:**

```ts
      const url = new URL(req.url ?? "/", "http://relay");
      const languages = typeof req.headers["accept-language"] === "string" ? req.headers["accept-language"] : undefined;
      const query = Object.fromEntries(url.searchParams);
      try {
        const page = (req.method ?? "GET").toUpperCase() === "GET" && /text\/html/.test(String(req.headers["accept"] ?? "")) ? PAGES.find(([re]) => re.test(url.pathname)) : undefined;
        if (page !== undefined) { reply(res, 200, page[1](langOf({ query, ...(languages !== undefined ? { languages } : {}) })), HTML_TYPE); return; }
        const text = await readBody(req);
        const lang = langOf({ query, ...(languages !== undefined ? { languages } : {}) });
        if (text === undefined) { const r = refusal(413, "body.tooLarge", lang); reply(res, r.status, r.body, r.type); return; }
        let body: unknown;
        if (text !== "") {
          try { body = JSON.parse(text); } catch { const r = refusal(400, "body.notJson", lang); reply(res, r.status, r.body, r.type); return; }
        }
        const token = tokenOf(req, url);
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
      } catch (e) {
        const r = refusal(500, "server.error", langOf({ query }), { detail: e instanceof Error ? e.message : String(e) });
        reply(res, r.status, r.body, JSON_TYPE);
      }
    })();
```

**with:**

```ts
      const url = new URL(req.url ?? "/", "http://relay");
      const header = (name: string): string | undefined => (typeof req.headers[name] === "string" ? req.headers[name] : undefined);
      const out = await answerRequest(relay, {
        method: req.method ?? "GET", url, base: o.publicUrl ?? `http://${req.headers["host"] ?? host}`, body: () => readBody(req),
        gone: new Promise<void>((done) => { res.once("close", () => done()); }),
        ...(header("accept") !== undefined ? { accept: header("accept")! } : {}), ...(header("accept-language") !== undefined ? { languages: header("accept-language")! } : {}),
        ...(header("authorization") !== undefined ? { authorization: header("authorization")! } : {}), ...(req.socket.remoteAddress !== undefined ? { ip: req.socket.remoteAddress } : {}), ...(o.version !== undefined ? { version: o.version } : {}),
      });
      if (!res.destroyed) reply(res, out.status, out.body, out.type);
    })();
```

**Create `src/relay/avatar-shell.ts`:**

```ts
// What every shell around gemsbang's relay does with a request (architecture
// §2.4: a Node process for a company's own servers and for local work, a
// Cloudflare Durable Object for the beta — one core, the same answers): a
// browser's GET of `/i/<code>`, `/g/<group>` or `/login` gets its page in its
// language; anything else is the JSON of avatar-api.ts, a body of at most a
// megabyte, the token from the Authorization header or the query; a wait on
// a person's box (`GET /updates` with a `timeout`) is held open until
// something lands after their `pts`, the time is up (at most 25 seconds), or
// the asker went away. Neither Node's nor the Workers' types: a shell reads
// its own wire into a ShellRequest and writes the answer back.
import { JSON_TYPE, langOf, refusal, routeAvatars, type AvatarRequest, type AvatarResponse } from "./avatar-api.js";
import { groupPage, HTML_TYPE, joinPage, loginPage } from "./avatar-pages.js";
import type { AvatarRelay } from "./avatars.js";
import { WAIT_MAX_S } from "../core/avatar/updates.js";
import type { Lang } from "../core/avatar/words.js";

/** A request body may be this long: a message, never a file's bytes. */
export const BODY_LIMIT = 1_048_576;

/** A request as a shell read it: the body read lazily (undefined when it is over the limit); `gone` settles when the asker went away; `base` is the origin the relay is reached at. */
export interface ShellRequest {
  method: string; url: URL; base: string; accept?: string; languages?: string; authorization?: string; ip?: string; version?: string;
  body: () => Promise<string | undefined>;
  gone?: Promise<void>;
}

/** The pages by path, for a browser (`Accept: text/html`); a script at the same path gets the JSON. */
const PAGES: readonly [RegExp, (lang: Lang) => string][] = [[/^\/i\/[a-z0-9]{1,16}$/, joinPage], [/^\/g\/[gd]-[0-9a-f]{10}$/, groupPage], [/^\/login$/, loginPage]];

/** How long a wait for updates may hold, in seconds: the `timeout` asked, at most WAIT_MAX_S; none asked, no wait. */
const waitOf = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.min(n, WAIT_MAX_S) : 0; };

/** The answer to one request; a failure inside is `server.error`, never a thrown error. */
export async function answerRequest(relay: AvatarRelay, q: ShellRequest): Promise<AvatarResponse> {
  const query = Object.fromEntries(q.url.searchParams);
  const lang = langOf({ query, ...(q.languages !== undefined ? { languages: q.languages } : {}) });
  try {
    const page = q.method.toUpperCase() === "GET" && /text\/html/.test(q.accept ?? "") ? PAGES.find(([re]) => re.test(q.url.pathname)) : undefined;
    if (page !== undefined) return { status: 200, body: page[1](lang), type: HTML_TYPE };
    const text = await q.body();
    if (text === undefined) return refusal(413, "body.tooLarge", lang);
    let body: unknown;
    if (text !== "") {
      try { body = JSON.parse(text); } catch { return refusal(400, "body.notJson", lang); }
    }
    const m = q.authorization !== undefined ? /^Bearer\s+(\S+)$/i.exec(q.authorization) : null;
    const token = m?.[1] ?? q.url.searchParams.get("token") ?? undefined;
    const r: AvatarRequest = { method: q.method, path: q.url.pathname, query, base: q.base, ...(q.version !== undefined ? { version: q.version } : {}), ...(q.languages !== undefined ? { languages: q.languages } : {}), ...(q.ip !== undefined ? { ip: q.ip } : {}), ...(token !== undefined ? { token } : {}), ...(body !== undefined ? { body } : {}) };
    await held(relay, r, q.gone);
    return routeAvatars(r, relay);
  } catch (e) {
    return { ...refusal(500, "server.error", lang, { detail: e instanceof Error ? e.message : String(e) }), type: JSON_TYPE };
  }
}

/** A wait on the box (architecture §5.2): when the box has nothing after `pts`, held until it has, the time is up, or the asker went away. */
async function held(relay: AvatarRelay, r: AvatarRequest, gone?: Promise<void>): Promise<void> {
  const wait = r.method.toUpperCase() === "GET" && r.path === "/updates" ? waitOf(r.query["timeout"]) : 0;
  const by = wait > 0 && r.token !== undefined ? relay.verify(r.token) : undefined;
  const person = by === undefined ? undefined : relay.personOf(by);
  if (by === undefined || person === undefined) return;
  const first = relay.difference(by, r.query);
  if (!first.ok || !("updates" in first) || first.updates.length > 0) return;
  await new Promise<void>((done) => {
    const timer = setTimeout(finish, wait * 1000);
    const off = relay.onBox(person, finish);
    void gone?.then(finish);
    function finish(): void { clearTimeout(timer); off(); done(); }
  });
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `npm run build && node --test test/relay-shell.test.mjs`

Expected: `ℹ pass 2`, `ℹ fail 0`.

Run: `node --test --test-concurrency=4 test/avatar-*.test.mjs test/relay-*.test.mjs test/gemsbang*.test.mjs`

Expected: the Node shell's suites, through the core now, pass as before: `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/relay/avatar-server.ts src/relay/avatar-shell.ts test/relay-shell.test.mjs
git commit -m "gemsbang AA1: one core answers for every shell — pages, bodies, tokens, the held wait"
```


### Task 2: The relay's next deadline

**Files:**
- Modify: `src/relay/avatars.ts` (`nextDeadline`)
- Test: `test/avatar-need-relay.test.mjs` (the next deadline)

- [ ] **Step 1: Write the failing test**

**In `test/avatar-need-relay.test.mjs`, replace:**

```js

test("a task card (spec §7.4's card, once called 借电脑): its three options send no words; 现在干 with 这个人以后不用问 or 这个群以后不用问 lets the next one through without asking", () => {
```

**with:**

```js

test("the next deadline (architecture §2.3: a Durable Object sweeps by its alarm): the earliest among the cards still waiting with one; none with no deadline; past it swept, the next; an answered card, none", () => {
  const { r, john, lily, g, agent } = world();
  ok(r.ask(agent, ASK(g, { kind: "stance", summary: "要不要投票选春游地点", options: [{ label: "赞成" }] })));
  assert.equal(r.nextDeadline(), undefined, "a card with no deadline sets no alarm");
  ok(r.ask(agent, ASK(g, { expires: new Date(Date.UTC(2026, 10, 1, 10, 0, 0)).toISOString() })));
  const later = ok(r.ask(agent, ASK(g, { summary: "周日的事", expires: new Date(Date.UTC(2026, 10, 1, 14, 0, 0)).toISOString() }))).need;
  assert.equal(Date.parse(r.nextDeadline()), Date.UTC(2026, 10, 1, 10, 0, 0));
  r.advance(2 * 3_600_000);
  assert.equal(r.sweep(), 1);
  assert.equal(Date.parse(r.nextDeadline()), Date.UTC(2026, 10, 1, 14, 0, 0), "then the next");
  ok(r.answerNeed(john.by, lily.id, later.id, { choice: 0 }));
  assert.equal(r.nextDeadline(), undefined, "an answered card sets no alarm");
});

test("a task card (spec §7.4's card, once called 借电脑): its three options send no words; 现在干 with 这个人以后不用问 or 这个群以后不用问 lets the next one through without asking", () => {
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run build && node --test test/avatar-need-relay.test.mjs`

Expected: the build passes; the relay has no `nextDeadline` yet (`TypeError`): `ℹ fail 1`, `ℹ pass 6`.

- [ ] **Step 3: Write the code**

**In `src/relay/avatars.ts`, replace:**

```ts

  /** The cards past their deadline, marked expired; in its chat, the avatar says that the person must answer this themself (spec §7.3). The server's minute. */
  sweep(): number {
```

**with:**

```ts

  /** The earliest deadline among the cards still waiting with one: when a shell with alarms (architecture §2.3: a Durable Object's) should sweep next; none, no alarm. */
  nextDeadline(): string | undefined {
    const d = this.store.read(RELAY_OWNER, "needs-open.geml");
    const closed = new Set(d.blocks.filter((b) => /^closed-\d+$/.test(b.id)).map((b) => `${str(b.value["avatar"])}/${str(b.value["need"])}`));
    let next: string | undefined;
    for (const b of d.blocks) {
      const expires = str(b.value["expires"]);
      if (!/^open-\d+$/.test(b.id) || expires === undefined || closed.has(`${str(b.value["avatar"])}/${str(b.value["need"])}`)) continue;
      if (next === undefined || Date.parse(expires) < Date.parse(next)) next = expires;
    }
    return next;
  }

  /** The cards past their deadline, marked expired; in its chat, the avatar says that the person must answer this themself (spec §7.3). The Node shell's minute, or a Durable Object's alarm at the next deadline. */
  sweep(): number {
```

- [ ] **Step 4: Run it to see it pass**

Run: `npm run build && node --test test/avatar-need-relay.test.mjs`

Expected: `ℹ pass 7`, `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/relay/avatars.ts test/avatar-need-relay.test.mjs
git commit -m "gemsbang AA2: the relay names its next deadline, for a shell that sweeps by alarm"
```


### Task 3: The Worker and its Durable Object

**Files:**
- Create: `src/relay/worker.ts` (`RelayObject`, `ObjectState`, `SendEmail`, `Env`, `OBJECT_NAME`; the Worker as the default export)
- Test: `test/relay-worker.test.mjs` (the runtime's parts stood in: node:sqlite, the alarm, the mail binding, the namespace)

- [ ] **Step 1: Write the failing test**

**Create `test/relay-worker.test.mjs`:**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import worker, { OBJECT_NAME, RelayObject } from "../dist/relay/worker.js";
import { nodeSql } from "../dist/relay/doc-store.js";

/** node:sqlite where this Node has it (22.13 and later), else the tests say why they skipped. */
const sqlite = await import("node:sqlite").catch(() => undefined);
const skip = sqlite === undefined && "no node:sqlite in this Node";

/** The beta as Cloudflare runs it, with the runtime's parts stood in: the object's SQLite on node:sqlite, its alarm, the mail binding, the namespace that hands every request to the one object. */
function cloud() {
  let alarm = null, offset = 0;
  const sent = [], named = [];
  const state = { storage: { sql: nodeSql(new sqlite.DatabaseSync(":memory:")), setAlarm: async (t) => { alarm = t; }, getAlarm: async () => alarm, deleteAlarm: async () => { alarm = null; } } };
  const env = { NAME: "gemsbang.com", MAIL_FROM: "noreply@gemsbang.com", VERSION: "9.9.9", EMAIL: { send: async (m) => { sent.push(m); return { messageId: "m-1" }; } }, RELAY: { idFromName: (n) => { named.push(n); return n; }, get: () => object } };
  const object = new RelayObject(state, env, { now: () => new Date(Date.now() + offset).toISOString().replace(/\.\d{3}Z$/, "Z") });
  const call = async (method, path, o = {}) => {
    const res = await worker.fetch(new Request(`https://gemsbang.com${path}`, { method, headers: { ...(o.token ? { authorization: `Bearer ${o.token}` } : {}), ...(o.accept ? { accept: o.accept } : {}), ...(o.body ? { "content-type": "application/json" } : {}) }, ...(o.body ? { body: JSON.stringify(o.body) } : {}) }), env);
    const type = res.headers.get("content-type") ?? "", text = await res.text();
    return { status: res.status, type, body: type.startsWith("application/json") ? JSON.parse(text) : text };
  };
  const signIn = async (email, name) => {
    await call("POST", "/login", { body: { email } });
    const token = (await call("POST", "/login/verify", { body: { email, code: /(\d{6})/.exec(sent[sent.length - 1].text)[1] } })).body.token;
    const avatar = (await call("POST", "/avatars", { token, body: { name } })).body.avatar;
    return { token, avatar };
  };
  return { object, sent, named, call, signIn, alarm: () => alarm, jump: (ms) => { offset += ms; } };
}

test("the Worker (architecture §2.3): every request to the one object; a sign-in code mailed through the binding from gemsbang.com, handed over before the answer; the pages for a browser; an agent's instructions naming gemsbang.com", { skip }, async () => {
  const { sent, named, call, signIn } = cloud();
  assert.deepEqual((await call("GET", "/")).body, { name: "gemsbang.com", kind: "gemsbang", version: "9.9.9" });
  assert.deepEqual([...new Set(named)], [OBJECT_NAME]);
  assert.deepEqual((await call("POST", "/login", { body: { email: "John@Example.com" } })).body, { sent: true, known: false, to: "j***@example.com", from: "gemsbang.com" });
  assert.deepEqual([sent[0].to, sent[0].from, /^Gemsbang 验证码 \d{6}$/.test(sent[0].subject)], ["john@example.com", { email: "noreply@gemsbang.com", name: "Gemsbang" }, true]);
  const john = await signIn("john@example.com", "John");
  assert.equal((await call("GET", "/me", { token: john.token })).body.avatars[0].name, "John");
  const page = await call("GET", "/login", { accept: "text/html" });
  assert.deepEqual([page.status, page.type.startsWith("text/html")], [200, true]);
  const g = (await call("POST", "/groups", { token: john.token, body: { as: john.avatar.id, name: "设置页改版" } })).body.venue;
  const code = (await call("GET", `/venues/${g.owner}/${g.id}/link?as=${john.avatar.id}`, { token: john.token })).body.link.code;
  const md = await call("GET", `/i/${code}.md`);
  assert.match(md.body, /https:\/\/gemsbang\.com\/i\/[a-z0-9]+\/join/);
});

test("the box inside the object (architecture §5.2): a wait is held there and answered the moment a line lands", { skip }, async () => {
  const { call, signIn } = cloud();
  const john = await signIn("john@example.com", "John");
  const pts = (await call("GET", "/updates/state", { token: john.token })).body.pts;
  const waiting = call("GET", `/updates?pts=${pts}&timeout=20`, { token: john.token });
  setTimeout(() => { void call("POST", "/me/default-name", { token: john.token, body: { name: "老张" } }); }, 50);
  assert.deepEqual((await waiting).body.updates.map((u) => u.pts), [pts + 1]);
});

test("deadlines as the object's alarm (architecture §2.3): a card with a deadline sets it; when it rings, the card is expired and the alarm moves on, or goes", { skip }, async () => {
  const { object, call, signIn, alarm, jump } = cloud();
  const john = await signIn("john@example.com", "John");
  const g = (await call("POST", "/groups", { token: john.token, body: { as: john.avatar.id, name: "设置页改版" } })).body.venue;
  const agent = (await call("POST", `/avatars/${john.avatar.id}/token`, { token: john.token })).body.token;
  assert.equal(alarm(), null);
  const expires = new Date(Date.now() + 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const asked = await call("POST", "/needs", { token: agent, body: { venue: `${g.owner}/${g.id}`, kind: "promise", summary: "周五前给稿子反馈", options: [{ label: "好" }], expires } });
  assert.equal(asked.status, 201, JSON.stringify(asked.body));
  assert.equal(alarm(), Date.parse(expires));
  jump(2 * 3_600_000);
  await object.alarm();
  assert.equal(alarm(), null, "nothing else waits with a deadline");
  assert.deepEqual((await call("GET", "/needs", { token: john.token })).body.map((n) => n.state), ["expired"]);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run build && node --test test/relay-worker.test.mjs`

Expected: the build passes; `dist/relay/worker.js` does not exist yet (`ERR_MODULE_NOT_FOUND`): `ℹ fail 1`.

- [ ] **Step 3: Write the code**

**Create `src/relay/worker.ts`:**

```ts
// The beta's shell (architecture §2.3): a Cloudflare Worker on gemsbang.com
// hands every request to one Durable Object, which runs the relay — its rules
// unchanged — on the object's own SQLite (doc-store.ts's sqlStore) and answers
// through avatar-shell.ts, the core the Node shell runs too. One object orders
// every write; splitting it by person, group and avatar waits for the load
// (plan X). A sign-in code goes out through the Worker's mail binding from an
// address under gemsbang.com, handed over before the answer; a card's deadline
// is the object's alarm. Only the shapes of the runtime it touches are written
// here, so the module builds with the rest and runs in Node's tests as well.
import { answerRequest, BODY_LIMIT } from "./avatar-shell.js";
import { AvatarRelay } from "./avatars.js";
import { sqlStore, type SqlLike } from "./doc-store.js";
import type { Mailer } from "./mail.js";

/** A Durable Object's state, as far as the relay needs it: its SQLite and its one alarm. */
export interface ObjectState { storage: { sql: SqlLike; setAlarm(at: number): Promise<void>; getAlarm(): Promise<number | null>; deleteAlarm(): Promise<void> } }
/** The mail binding (`send_email`), as the relay uses it. */
export interface SendEmail { send(m: { to: string; from: { email: string; name: string }; subject: string; text: string }): Promise<unknown> }
export interface Env {
  /** The relay's object namespace. */
  RELAY: { idFromName(name: string): unknown; get(id: unknown): { fetch(request: Request): Promise<Response> } };
  EMAIL?: SendEmail;
  /** The relay's name, and who a code's mail says it comes from: gemsbang.com. */
  NAME?: string;
  /** The address codes are sent from: noreply@gemsbang.com. */
  MAIL_FROM?: string;
  VERSION?: string;
}

/** The one object every request goes to. */
export const OBJECT_NAME = "relay";

/** A request's going away, as a promise; a runtime that does not say, none. */
const goneOf = (signal: AbortSignal | undefined): Promise<void> | undefined =>
  signal === undefined ? undefined : new Promise((done) => { if (signal.aborted) done(); else signal.addEventListener("abort", () => done(), { once: true }); });

export class RelayObject {
  readonly relay: AvatarRelay;
  /** Mail handed to the binding and not yet taken: each answer waits for it, so a code is never dropped with the request. */
  private readonly sending: Promise<unknown>[] = [];

  constructor(private readonly state: ObjectState, private readonly env: Env, o: { now?: () => string } = {}) {
    const name = env.NAME ?? "gemsbang.com";
    const mailer: Mailer = (m) => {
      const sent = env.EMAIL?.send({ to: m.to, from: { email: env.MAIL_FROM ?? `noreply@${name}`, name: "Gemsbang" }, subject: m.subject, text: m.text });
      if (sent !== undefined) this.sending.push(sent);
      return sent?.then(() => undefined);
    };
    this.relay = new AvatarRelay({ store: sqlStore(state.storage.sql), name, mailer, ...(o.now !== undefined ? { now: o.now } : {}) });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const header = (n: string): string | undefined => request.headers.get(n) ?? undefined;
    const gone = goneOf(request.signal);
    const out = await answerRequest(this.relay, {
      method: request.method, url, base: url.origin,
      body: async () => { const b = await request.arrayBuffer(); return b.byteLength > BODY_LIMIT ? undefined : new TextDecoder().decode(b); },
      ...(gone !== undefined ? { gone } : {}),
      ...(header("accept") !== undefined ? { accept: header("accept")! } : {}), ...(header("accept-language") !== undefined ? { languages: header("accept-language")! } : {}),
      ...(header("authorization") !== undefined ? { authorization: header("authorization")! } : {}), ...(header("cf-connecting-ip") !== undefined ? { ip: header("cf-connecting-ip")! } : {}),
      ...(this.env.VERSION !== undefined ? { version: this.env.VERSION } : {}),
    });
    await Promise.allSettled(this.sending.splice(0));
    await this.schedule();
    return new Response(out.body, { status: out.status, headers: { "content-type": out.type } });
  }

  /** The alarm at the next deadline (architecture §2.3); none waiting, no alarm. */
  private async schedule(): Promise<void> {
    const next = this.relay.nextDeadline();
    const at = next === undefined ? undefined : Date.parse(next);
    const set = await this.state.storage.getAlarm();
    if (at === undefined) { if (set !== null) await this.state.storage.deleteAlarm(); return; }
    if (set !== at) await this.state.storage.setAlarm(at);
  }

  /** A deadline came: the cards past it swept, the alarm moved to the next. */
  async alarm(): Promise<void> {
    this.relay.sweep();
    await this.schedule();
  }
}

/** The Worker: every request to the one object. */
export default {
  fetch(request: Request, env: Env): Promise<Response> { return env.RELAY.get(env.RELAY.idFromName(OBJECT_NAME)).fetch(request); },
};
```

- [ ] **Step 4: Run it to see it pass**

Run: `npm run build && node --test test/relay-worker.test.mjs`

Expected: `ℹ pass 3`, `ℹ fail 0` (on a Node without `node:sqlite`, the three are skipped and say why).

- [ ] **Step 5: Commit**

```bash
git add src/relay/worker.ts test/relay-worker.test.mjs
git commit -m "gemsbang AA3: the Worker and its one Durable Object — the relay on the object's SQLite, mail through the binding, deadlines as its alarm"
```


### Task 4: The configuration for gemsbang.com, and the steps to deploy it

**Files:**
- Create: `cloudflare/wrangler.jsonc`, `cloudflare/README.md`
- Test: `test/relay-cloudflare.test.mjs` (the configuration agrees with the code)

- [ ] **Step 1: Write the failing test**

**Create `test/relay-cloudflare.test.mjs`:**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as worker from "../dist/relay/worker.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
/** wrangler.jsonc without its comments. */
const config = JSON.parse(readFileSync(join(root, "cloudflare", "wrangler.jsonc"), "utf8").replace(/^\s*\/\/.*$/gm, ""));

test("the Cloudflare configuration agrees with the code (architecture §2.3): the built Worker as main, its object's class exported and made on SQLite, the mail binding the object uses, gemsbang.com as the name, the route and the sender; Node's built-ins allowed", () => {
  assert.equal(existsSync(resolve(root, "cloudflare", config.main)), true, "main is the built worker");
  const [binding] = config.durable_objects.bindings;
  assert.deepEqual([binding.name, typeof worker[binding.class_name]], ["RELAY", "function"]);
  assert.deepEqual(config.migrations.map((m) => m.new_sqlite_classes), [[binding.class_name]]);
  assert.deepEqual(config.send_email, [{ name: "EMAIL" }]);
  assert.deepEqual([config.vars.NAME, config.vars.MAIL_FROM, config.routes], ["gemsbang.com", "noreply@gemsbang.com", [{ pattern: "gemsbang.com", custom_domain: true }]]);
  assert.ok(config.compatibility_flags.includes("nodejs_compat"));
  assert.equal(typeof worker.default.fetch, "function");
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run build && node --test test/relay-cloudflare.test.mjs`

Expected: the build passes; there is no `cloudflare/wrangler.jsonc` yet (`ENOENT`): `ℹ fail 1`.

- [ ] **Step 3: Write the code**

**Create `cloudflare/README.md`:**

```md
# gemsbang on Cloudflare

The beta runs as one Cloudflare Worker on `gemsbang.com` (architecture §2.3). The Worker hands
every request to one Durable Object, and that object runs the relay on its own SQLite. Its code is
`src/relay/worker.ts`, and its configuration is `wrangler.jsonc` beside this file. The plugin
signs in to `https://gemsbang.com` unless `GEMSBANG_SERVICE` names another.

Nothing here deploys on its own. Each step below changes the Cloudflare account or the domain, so
each is the maintainer's to take.

## What it needs

- The `gemsbang.com` zone on the Cloudflare account. It is there already.
- The Workers Paid plan. Email Service sends to any address only on a paid plan.
- Email sending turned on for `gemsbang.com`. This adds the SPF and DKIM records that the mail
  needs.

## Steps

    npm run build
    npx wrangler login
    npx wrangler email sending enable gemsbang.com
    npx wrangler email sending dns get gemsbang.com
    npx wrangler deploy -c cloudflare/wrangler.jsonc

1. `npm run build` makes `dist/relay/worker.js`. This is what `main` points at.
2. `wrangler login` signs in to the account in a browser.
3. `email sending enable` onboards the domain for sending, and `dns get` shows the records it
   added. They usually take 5–15 minutes to propagate.
4. `deploy` uploads the Worker. The `v1` migration creates the SQLite-backed object, and the
   custom domain route binds `gemsbang.com`.

## Checking it

    curl https://gemsbang.com/

The answer should be `{"name":"gemsbang.com","kind":"gemsbang"}`.

Then, in Claude Code with the plugin and no `GEMSBANG_SERVICE` set, open the panel, sign in with a
real email, and check that the code arrives from `noreply@gemsbang.com`.

## What one object means

One object orders every write, and it holds a few dozen people's chats easily (plan X). A wait on
someone's box is held inside the object for up to 25 seconds, and that time is billed as duration.
A card's deadline is the object's alarm.

Splitting the relay into one object per person, group and avatar waits until the load asks for it.
The documents are already kept one per entity.
```

**Create `cloudflare/wrangler.jsonc`:**

```jsonc
// gemsbang's beta on Cloudflare (architecture §2.3): the Worker on
// gemsbang.com and its one Durable Object, built from the relay
// (`npm run build` first). Deploying is the maintainer's call: see
// cloudflare/README.md.
{
  "name": "gemsbang",
  "main": "../dist/relay/worker.js",
  "compatibility_date": "2025-10-01",
  "compatibility_flags": ["nodejs_compat"],
  "routes": [{ "pattern": "gemsbang.com", "custom_domain": true }],
  "durable_objects": { "bindings": [{ "name": "RELAY", "class_name": "RelayObject" }] },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["RelayObject"] }],
  "send_email": [{ "name": "EMAIL" }],
  "vars": { "NAME": "gemsbang.com", "MAIL_FROM": "noreply@gemsbang.com" },
  "observability": { "enabled": true }
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npm run build && node --test test/relay-cloudflare.test.mjs`

Expected: `ℹ pass 1`, `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add cloudflare/README.md cloudflare/wrangler.jsonc test/relay-cloudflare.test.mjs
git commit -m "gemsbang AA4: the Cloudflare configuration for gemsbang.com and the steps to deploy it"
```


### Task 5: The version and the four gates

**Files:**
- Modify: `package.json`, `package-lock.json`, `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json` (by the script)

- [ ] **Step 1: Bump the patch version**

```bash
node scripts/bump.mjs 0.5.12
```

- [ ] **Step 2: Run the four gates**

Run each as its own command and note the result:

```bash
npm run build
claude plugin validate .
claude plugin test .
node --test --test-concurrency=2 test/*.test.mjs
```

Expected: build passes; validate passes (the root `CLAUDE.md` warning it has always shown is not new); the plugin suite passes its 15; the node suite passes, with seven more tests than before this plan.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json .claude-plugin/plugin.json .codex-plugin/plugin.json
git commit -m "gemsbang 0.5.12: gemsbang.com on Cloudflare — one core for both shells, the Worker and its object, ready to deploy (plan AA)"
```

