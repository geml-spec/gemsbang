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
