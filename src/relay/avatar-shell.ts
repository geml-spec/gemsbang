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
import { groupPage, HTML_TYPE, joinPage, loginPage, minePage } from "./avatar-pages.js";
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
const PAGES: readonly [RegExp, (lang: Lang) => string][] = [[/^\/i\/[a-z0-9]{1,16}$/, joinPage], [/^\/g\/[gd]-[0-9a-f]{10}$/, groupPage], [/^\/login$/, loginPage], [/^\/$/, minePage]];

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
