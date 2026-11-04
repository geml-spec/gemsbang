// The beta's shell (architecture §2.3): a Cloudflare Worker on gemsbang.com
// hands every request to one Durable Object, which runs the relay — its rules
// unchanged — on the object's own SQLite (doc-store.ts's sqlStore) and answers
// through avatar-shell.ts, the core the Node shell runs too. One object orders
// every write; splitting it by person, group and avatar waits for the load
// (plan X). A sign-in code goes out through Resend from an address under
// gemsbang.com, handed over before the answer — or, to an email the maintainer
// listed while the beta has no mail, given back in it; a card's deadline
// is the object's alarm. Only the shapes of the runtime it touches are written
// here, so the module builds with the rest and runs in Node's tests as well.
import { answerRequest, BODY_LIMIT } from "./avatar-shell.js";
import { AvatarRelay } from "./avatars.js";
import { sqlStore, type SqlLike } from "./doc-store.js";
import type { Mailer } from "./mail.js";
import type { Fetcher, SsoApps } from "./sso.js";
import type { Texter } from "./text.js";
import { SSO_KINDS } from "../core/avatar/address.js";

/** A Durable Object's state, as far as the relay needs it: its SQLite and its one alarm. */
export interface ObjectState { storage: { sql: SqlLike; setAlarm(at: number): Promise<void>; getAlarm(): Promise<number | null>; deleteAlarm(): Promise<void> } }
/** Resend's endpoint for one email (resend.com/docs/api-reference/emails/send-email). */
export const RESEND_URL = "https://api.resend.com/emails";
/** Twilio's endpoint for one text from the account (twilio.com/docs/messaging/api/message-resource). */
export const twilioUrl = (sid: string): string => `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`;
/** Each account a person may sign in with (S28, S30), by the names of the secrets that hold its app. */
export const SSO_SECRETS = { google: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"], github: ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"], facebook: ["FACEBOOK_APP_ID", "FACEBOOK_APP_SECRET"], wechat: ["WECHAT_APP_ID", "WECHAT_APP_SECRET"] } as const;
/** A request out of the Worker, as the mail uses it: `fetch`, or a test's stand-in. */
export type Post = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number }>;
export interface Env {
  /** The relay's object namespace. */
  RELAY: { idFromName(name: string): unknown; get(id: unknown): { fetch(request: Request): Promise<Response> } };
  /** The Resend key codes are mailed with, a secret of the maintainer's (`wrangler secret put RESEND_API_KEY`); without it no mail goes. */
  RESEND_API_KEY?: string;
  /** The relay's name, and who a code's mail says it comes from: gemsbang.com. */
  NAME?: string;
  /** The address codes are sent from, on a domain Resend sends for: no-reply@mustapi.com for the beta (2026-11-04). */
  MAIL_FROM?: string;
  /** The emails, by commas, whose code comes back in the answer and is not mailed: test accounts such as Smith's (Q21), a secret of the maintainer's. */
  SHOW_CODE_TO?: string;
  /** The other accounts' apps (S28, S30), secrets of the maintainer's: an account whose two are set gets its key on the sign-in page. */
  GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string; GITHUB_CLIENT_SECRET?: string;
  FACEBOOK_APP_ID?: string; FACEBOOK_APP_SECRET?: string;
  WECHAT_APP_ID?: string; WECHAT_APP_SECRET?: string;
  /** Twilio, for codes by text (S29): the account, its token (a secret), and the number or messaging service (`MG…`) they come from. */
  TWILIO_ACCOUNT_SID?: string; TWILIO_AUTH_TOKEN?: string; TWILIO_FROM?: string;
  /** The calling codes a number may be texted at, by commas (`+63,+1`); none set, or no Twilio, no number signs in. */
  SMS_COUNTRIES?: string;
  VERSION?: string;
}

const list = (v: string | undefined): string[] => (v ?? "").split(",").map((e) => e.trim()).filter((e) => e !== "");
const set = (v: string | undefined): v is string => v !== undefined && v !== "";

/** The one object every request goes to. */
export const OBJECT_NAME = "relay";

/** A request's going away, as a promise; a runtime that does not say, none. */
const goneOf = (signal: AbortSignal | undefined): Promise<void> | undefined =>
  signal === undefined ? undefined : new Promise((done) => { if (signal.aborted) done(); else signal.addEventListener("abort", () => done(), { once: true }); });

export class RelayObject {
  readonly relay: AvatarRelay;
  /** Mail handed to the binding and not yet taken: each answer waits for it, so a code is never dropped with the request. */
  private readonly sending: Promise<unknown>[] = [];

  constructor(private readonly state: ObjectState, private readonly env: Env, o: { now?: () => string; post?: Post; fetch?: Fetcher } = {}) {
    const name = env.NAME ?? "gemsbang.com";
    const from = env.MAIL_FROM ?? `noreply@${name}`;
    const post: Post = o.post ?? ((url, init) => fetch(url, init));
    const sso: SsoApps = {};
    for (const k of SSO_KINDS) { const [id, secret] = SSO_SECRETS[k]; const a = env[id], b = env[secret]; if (set(a) && set(b)) sso[k] = { id: a, secret: b }; }
    const twilio = set(env.TWILIO_ACCOUNT_SID) && set(env.TWILIO_AUTH_TOKEN) && set(env.TWILIO_FROM);
    // A code by text, through Twilio: from a messaging service (`MG…`) or a number.
    const texter: Texter = (t) => {
      if (!twilio) return undefined;
      const fromField: Record<string, string> = env.TWILIO_FROM!.startsWith("MG") ? { MessagingServiceSid: env.TWILIO_FROM! } : { From: env.TWILIO_FROM! };
      const sent = post(twilioUrl(env.TWILIO_ACCOUNT_SID!), { method: "POST", headers: { authorization: `Basic ${btoa(`${env.TWILIO_ACCOUNT_SID!}:${env.TWILIO_AUTH_TOKEN!}`)}`, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ To: t.to, Body: t.text, ...fromField }).toString() })
        .then((r) => { if (!r.ok) throw new Error(`Twilio answered ${r.status}`); });
      this.sending.push(sent);
      return sent;
    };
    const mailer: Mailer = (m) => {
      const key = env.RESEND_API_KEY;
      if (key === undefined || key === "") return undefined;
      const body = JSON.stringify({ from: `GemsBang <${from}>`, to: [m.to], subject: m.subject, text: m.text });
      const sent = post(RESEND_URL, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body })
        .then((r) => { if (!r.ok) throw new Error(`Resend answered ${r.status}`); });
      this.sending.push(sent);
      return sent;
    };
    const showCodeTo = list(env.SHOW_CODE_TO);
    // The sign-in says who the code comes from as the mail says it, so the person looks for that sender; numbers only where texts can go.
    this.relay = new AvatarRelay({ store: sqlStore(state.storage.sql), name, mailer, mailFrom: from, texter, textTo: twilio ? list(env.SMS_COUNTRIES) : [], sso, ...(o.fetch !== undefined ? { fetch: o.fetch } : {}), ...(showCodeTo.length > 0 ? { showCodeTo } : {}), ...(o.now !== undefined ? { now: o.now } : {}) });
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
    // A mail or a text that did not go says so in the Worker's logs: the person only sees that no code came.
    for (const r of await Promise.allSettled(this.sending.splice(0))) if (r.status === "rejected") console.error(`gemsbang: a code's mail did not go: ${String(r.reason)}`);
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
