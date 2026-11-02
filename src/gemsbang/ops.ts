// What the gemsbang client does for the Claude Code plugin (transport §3, §4),
// one call at a time through the bridge: sign the person in by email (or
// phone) at the service, keep their account — the ways in, the devices — read
// every chat of every avatar again and keep it in the home, open a chat and
// say something in it as the person, make a group, hand out its link, change
// an avatar's name or marking, join by a link; and for the model's tools,
// read and say as the avatar this session speaks for, with that avatar's own
// token (so the relay stamps `by: agent`). A relay out of reach leaves the
// last mirror readable. Every refusal is a code, its parameters and its
// words in the person's language.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { borrowEnvelope, factsOf, repoCommands } from "../core/avatar/borrow.js";
import { badgesOf, chatOf, inboxOf, itemsOf, venueKey, type Badge, type ChatItem, type InboxRow, type Mirror, type MirrorVenue, type MirrorWork } from "../core/avatar/inbox.js";
import { invitePrompt, parseInvite, relayOrigin } from "../core/avatar/invite.js";
import { orderNeeds, type Need } from "../core/avatar/needs.js";
import { callKey, callOf, callsOf, roundFor, type Call, type Round } from "../core/avatar/calls.js";
import { readRound, roundPrompt } from "../core/avatar/round.js";
import { DEFAULT_LANG, isLang, say, type Lang } from "../core/avatar/words.js";
import { RelayClient, RelayDown, type Answer } from "../daemon/client.js";
import { GAP_WAIT_MS, receive, WAIT_MAX_S, type SyncState, type Update } from "../core/avatar/updates.js";
import { clearCache, readCache, readClient, readMirror, readSeen, writeCache, writeClient, writeMirror, writeSeen, type Client } from "./home.js";

/** `service`: the service a person signs in to when nobody named another (home.ts's gbService); `device`: what this machine calls itself when it signs in. */
export interface GbOptions { home: string; now: string; zoneMinutes?: number; fetchImpl?: typeof fetch; service?: string; device?: string }
export type Fail = { ok: false; code: string; params?: Record<string, string | number>; reason: string };
/** A 需要你 card as the pane shows it: the avatar's badge, the chat's name, whether the person muted it; a borrow's, the repository it would work in. */
export type GbNeed = Need & { avatarName: string; group?: string; badge?: Badge; muted: boolean; repo?: string };
/** A job for this machine as the pane shows it (spec §7.4): the avatar's badge and the repository it works in. */
export type GbWork = MirrorWork & { badge?: Badge; repo?: string };
/** The pane's whole view: the service, who is signed in, the avatars, 需要你, the inbox, what is wrong. */
export interface GbView {
  relay: string; loggedIn: boolean; lang: Lang; person?: string; defaultName?: string;
  avatars: (Badge & { venues: string[]; mark: boolean; muted: boolean; placeholder?: string; repo?: string; autos: { venue: string; name: string }[] })[]; rows: InboxRow[]; unread: number;
  /** Who called the person's avatars, newest first (architecture §6.3); none from a bridge older than them. */
  calls?: GbCalled[];
  needs: GbNeed[]; muted: { avatars: string[]; venues: string[] };
  /** The jobs for this person's computers (spec §7.4); none from a bridge older than them. */
  work?: GbWork[];
  synced?: string; offline?: string; notes: { url: string; at: string }[]; bodies: Record<string, string>;
}
/** One chat for the pane; `zoneMinutes`, the machine's zone, for the times of its lines. */
export interface GbChat { owner: string; id: string; kind: "group" | "dm"; name: string; count: number; as: Badge | undefined; items: ChatItem[]; earlier: number; isOwner: boolean; rules?: { forward: boolean; approve: boolean }; zoneMinutes?: number }
export interface GbLink { code: string; url: string; line: string; days: number; forward: boolean; approve: boolean; isOwner: boolean; group: string }
/** A job taken by this machine: where the borrowed agent works, what it may run, its first turn. */
export interface GbTaken { id: string; avatar: string; summary: string; worktree: string; branch: string; commands: string[]; prompt: string }
/** A call on one of the person's avatars as the pane shows it (architecture §6.3): its badge, and whether the person muted it. */
export type GbCalled = Call & { badge?: Badge; muted: boolean };
/** A round for the plugin to run: the prompt, the agent's description, where its answer goes and with how many hops. */
export interface GbRound { avatar: string; owner: string; id: string; group: string; replyTo: string; hops: number; prompt: string; description: string }
/** The account as the pane shows it (architecture §3.1): the ways in, and the devices signed in with the avatars their agents play. */
export interface GbAccount { methods: { id: string; kind: string; shown: string; at: string }[]; devices: { id: string; name: string; at: string; current: boolean; avatars: { id: string; name: string }[] }[] }
export type GbResult = ({ ok: true; view?: GbView; chat?: GbChat; link?: GbLink; info?: Record<string, unknown>; joined?: Record<string, unknown>; text?: string; sent?: string; work?: GbTaken; round?: GbRound; rounds?: GbRound[]; account?: GbAccount }) | Fail;

const obj = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
/** A chat keeps this many of its last lines on this machine. */
const CHAT_LINES = 200;
/** A sync reads at most this many answers of the box (a page each, or a gap filled) before it saves what it has. */
const SYNC_ROUNDS = 20;
/** The documents of an avatar of the person's whose update says to read a piece again. */
const PIECES: Readonly<Record<string, string>> = { "joined.geml": "venues", "needs.geml": "needs", "requests.geml": "needs", "work.geml": "work", "rules.geml": "marks", "templates.geml": "placeholders", "auto.geml": "autos" };
const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));
/** How this machine names itself to the service when it signs in: its system, and Claude Code. */
export const deviceName = (platform: string = process.platform): string => `${platform === "darwin" ? "Mac" : platform === "win32" ? "Windows" : platform === "linux" ? "Linux" : platform} · Claude Code`;
/** The body's address: its email, else its phone. */
const addressBody = (args: Record<string, unknown>): Record<string, unknown> => (args["email"] !== undefined ? { email: args["email"] } : { phone: args["phone"] });
/** A path as the file system names it, links resolved, so two spellings of one folder compare equal. */
const samePath = (p: string): string => { try { return realpathSync(p); } catch { return resolve(p); } };
/** The top of the git repository a folder is in, or undefined. */
function gitTop(dir: string): string | undefined {
  const r = spawnSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8", timeout: 10_000, windowsHide: true });
  const top = r.status === 0 ? r.stdout.trim() : "";
  return top === "" ? undefined : samePath(top);
}

export class Gb {
  private client: Client;
  constructor(private readonly o: GbOptions) {
    this.client = readClient(o.home);
  }

  /** The person's language, as the relay last said it. */
  private get lang(): Lang { return this.client.lang ?? DEFAULT_LANG; }
  /** Where this machine talks to: the relay named with `setup` (a developer's), else the service. */
  private get origin(): string { return this.client.relay !== "" ? this.client.relay : this.o.service ?? ""; }

  private fail(code: string, params?: Record<string, string | number>): Fail {
    return { ok: false, code, ...(params !== undefined ? { params } : {}), reason: say(code, this.lang, params) };
  }

  /** The relay's refusal as it gave it, its words already in the person's language. */
  private refused(a: Answer): Fail {
    const b = obj(a.body);
    const code = str(b["error"]) ?? "server.error";
    const params = obj(b["params"]) as Record<string, string | number>;
    return { ok: false, code, ...(b["params"] !== undefined ? { params } : {}), reason: str(b["reason"]) ?? say(code, this.lang, { detail: `HTTP ${a.status}` }) };
  }

  private http(token?: string): RelayClient { return new RelayClient(this.origin, token, this.o.fetchImpl ?? fetch); }

  /** One call to the relay in the person's language; a network failure is `client.unreachable`. */
  private async call(method: string, path: string, body?: unknown, token = this.client.token): Promise<Answer | Fail> {
    if (this.origin === "") return this.fail("client.noRelay");
    try {
      return await this.http(token).call(method, `${path}${path.includes("?") ? "&" : "?"}lang=${this.lang}`, body);
    } catch (e) {
      return this.fail("client.unreachable", { detail: e instanceof RelayDown ? e.message.replace(/^连不上中继 [^：]*：/, "") : String(e) });
    }
  }

  private save(): void { writeClient(this.o.home, this.client); }
  private isFail = (x: unknown): x is Fail => (x as Fail).ok === false;

  // --- the view ---

  view(m: Mirror | undefined, offline?: string): GbView {
    const c = this.client;
    const seen = readSeen(this.o.home);
    const box = m === undefined ? { badges: [], rows: [], unread: 0 } : inboxOf(m, seen, this.o.now, { ...(this.o.zoneMinutes !== undefined ? { zoneMinutes: this.o.zoneMinutes } : {}) });
    const marks = m?.marks ?? {};
    const avatars = box.badges.map((b) => ({ ...b, venues: (m?.venues ?? []).filter((v) => v.as === b.id).map((v) => v.name), mark: marks[b.id] ?? true, muted: c.muted.avatars.includes(b.id), ...(m?.placeholders?.[b.id] !== undefined ? { placeholder: m.placeholders[b.id] } : {}), ...(c.repos[b.id] !== undefined ? { repo: c.repos[b.id] } : {}), autos: (m?.autos?.[b.id] ?? []).map((k) => ({ venue: k, name: m?.venues.find((x) => venueKey(x.owner, x.id) === k)?.name ?? k })) }));
    const needs = orderNeeds(m?.needs ?? []).map((n) => ({ ...n, ...(box.badges.find((b) => b.id === n.avatar) !== undefined ? { badge: box.badges.find((b) => b.id === n.avatar)! } : {}), muted: c.muted.avatars.includes(n.avatar) || (n.venue !== undefined && c.muted.venues.includes(venueKey(n.venue.owner, n.venue.id))) , ...(n.kind === "borrow" && c.repos[n.avatar] !== undefined ? { repo: c.repos[n.avatar] } : {}) }));
    const calls: GbCalled[] = m === undefined ? [] : callsOf(m, { dismissed: c.dismissed, autos: m.autos ?? {} }).map((x) => ({ ...x, ...(box.badges.find((b) => b.id === x.avatar) !== undefined ? { badge: box.badges.find((b) => b.id === x.avatar)! } : {}), muted: c.muted.avatars.includes(x.avatar) || c.muted.venues.includes(venueKey(x.owner, x.id)) }));
    const work = (m?.work ?? []).map((w) => ({ ...w, ...(box.badges.find((b) => b.id === w.avatar) !== undefined ? { badge: box.badges.find((b) => b.id === w.avatar)! } : {}), ...(c.repos[w.avatar] !== undefined ? { repo: c.repos[w.avatar] } : {}) }));
    return {
      relay: this.origin, loggedIn: c.token !== undefined, lang: this.lang,
      ...(c.person !== undefined ? { person: c.person } : {}), ...(m?.defaultName !== undefined ? { defaultName: m.defaultName } : {}),
      avatars, rows: box.rows, unread: box.unread, needs, calls, muted: c.muted, work, ...(m !== undefined ? { synced: m.at } : {}), ...(offline !== undefined ? { offline } : {}), notes: c.notes, bodies: c.bodies,
    };
  }

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

  // --- the service and the sign-in ---

  /** A developer's relay in place of the service (and tests'); the pane never asks for one. */
  setup(args: Record<string, unknown>): GbResult {
    const origin = relayOrigin(str(args["relay"]) ?? "");
    if (origin === undefined) return this.fail("client.badRelay");
    if (origin !== this.client.relay) this.logoutLocal();
    this.client.relay = origin;
    this.save();
    return { ok: true, view: this.view(undefined) };
  }

  /** A code sent to the email (or phone) typed: where it went, masked, and who it comes from. */
  async loginStart(args: Record<string, unknown>): Promise<GbResult> {
    const r = await this.call("POST", "/login", { ...addressBody(args), lang: this.lang }, undefined);
    if (this.isFail(r)) return r;
    return r.status === 200 ? { ok: true, text: this.sentText(args, obj(r.body)), info: obj(r.body) } : this.refused(r);
  }

  private sentText(args: Record<string, unknown>, b: Record<string, unknown>): string {
    return args["email"] !== undefined ? say("code.sentTo", this.lang, { to: str(b["to"]) ?? "", from: str(b["from"]) ?? "" }) : say("code.sent", this.lang);
  }

  /** The code checked: signed in on this machine, named as it names itself. */
  async loginVerify(args: Record<string, unknown>): Promise<GbResult> {
    const r = await this.call("POST", "/login/verify", { ...addressBody(args), code: args["code"], device: this.o.device ?? deviceName(), lang: this.lang }, undefined);
    if (this.isFail(r)) return r;
    if (r.status !== 200) return this.refused(r);
    const b = obj(r.body);
    clearCache(this.o.home);
    this.client.token = str(b["token"]);
    this.client.person = str(b["person"]);
    this.client.avatars = {};
    this.save();
    return this.sync();
  }

  private logoutLocal(): void {
    clearCache(this.o.home);
    delete this.client.token;
    delete this.client.person;
    this.client.avatars = {};
    this.client.bodies = {};
  }

  /** Signed out here: the service drops this machine's token and its avatars' (out of reach, it is dropped here all the same). */
  async logout(): Promise<GbResult> {
    if (this.client.token !== undefined) await this.call("POST", "/me/logout", {});
    this.logoutLocal();
    this.save();
    return { ok: true, view: this.view(undefined) };
  }

  /** A new person's first avatar, with the name they gave (architecture §3.2); `session` given, that session speaks for it after. */
  async firstAvatar(args: Record<string, unknown>): Promise<GbResult> {
    const r = await this.call("POST", "/avatars", { name: args["name"] });
    if (this.isFail(r)) return r;
    if (r.status !== 201) return this.refused(r);
    const avatar = str(obj(obj(r.body)["avatar"])["id"]), session = str(args["session"]);
    if (session !== undefined && avatar !== undefined) { this.client.bodies[session] = avatar; this.save(); }
    return this.sync();
  }

  // --- the account (architecture §3.1) ---

  /** The ways in and the devices signed in. */
  async account(): Promise<GbResult> {
    const methods = await this.call("GET", "/me/methods");
    if (this.isFail(methods)) return methods;
    if (methods.status !== 200) return this.refused(methods);
    const devices = await this.call("GET", "/me/devices");
    if (this.isFail(devices)) return devices;
    if (devices.status !== 200) return this.refused(devices);
    return { ok: true, account: { methods: obj(methods.body)["methods"] as GbAccount["methods"], devices: obj(devices.body)["devices"] as GbAccount["devices"] } };
  }

  /** One call about the account, then the account as it is after. */
  private async thenAccount(r: Answer | Fail): Promise<GbResult> {
    if (this.isFail(r)) return r;
    return r.status === 200 ? this.account() : this.refused(r);
  }

  /** A code sent to an email added as one more way in. */
  async methodStart(args: Record<string, unknown>): Promise<GbResult> {
    const r = await this.call("POST", "/me/methods", addressBody(args));
    if (this.isFail(r)) return r;
    return r.status === 200 ? { ok: true, text: this.sentText(args, obj(r.body)), info: obj(r.body) } : this.refused(r);
  }

  methodVerify(args: Record<string, unknown>): Promise<GbResult> { return this.call("POST", "/me/methods/verify", { ...addressBody(args), code: args["code"] }).then((r) => this.thenAccount(r)); }
  methodRemove(args: Record<string, unknown>): Promise<GbResult> { return this.call("POST", `/me/methods/${encodeURIComponent(str(args["id"]) ?? "")}/remove`, {}).then((r) => this.thenAccount(r)); }
  deviceRevoke(args: Record<string, unknown>): Promise<GbResult> { return this.call("POST", `/me/devices/${encodeURIComponent(str(args["id"]) ?? "")}/revoke`, {}).then((r) => this.thenAccount(r)); }
  devicesRevokeOthers(): Promise<GbResult> { return this.call("POST", "/me/devices/revoke-others", {}).then((r) => this.thenAccount(r)); }

  // --- chats ---

  private mirrorVenue(owner: string, id: string): { m: Mirror; v: MirrorVenue } | undefined {
    const m = readMirror(this.o.home);
    const v = m?.venues.find((x) => x.owner === owner && x.id === id);
    return m === undefined || v === undefined ? undefined : { m, v };
  }

  private chat(m: Mirror, v: MirrorVenue): GbChat {
    const c = chatOf(v, m);
    return { owner: v.owner, id: v.id, kind: v.kind, name: c.name, count: c.count, as: c.as, items: c.items, earlier: c.earlier, isOwner: v.owner === v.as, ...(v.rules !== undefined ? { rules: v.rules } : {}), ...(this.o.zoneMinutes !== undefined ? { zoneMinutes: this.o.zoneMinutes } : {}) };
  }

  /** One chat brought up to date and shown, its last line marked seen. */
  async open(args: Record<string, unknown>): Promise<GbResult> {
    const owner = str(args["owner"]) ?? "", id = str(args["id"]) ?? "";
    if (this.mirrorVenue(owner, id) === undefined) return this.fail("client.noVenue");
    const synced = await this.sync();
    if (!synced.ok) return synced;
    const at = this.mirrorVenue(owner, id);
    if (at === undefined) return this.fail("client.noVenue");
    const said = itemsOf(at.v).filter((i) => i.kind === "message");
    const lastId = said[said.length - 1]?.id;
    if (lastId !== undefined) { const seen = readSeen(this.o.home); seen[venueKey(owner, id)] = lastId; writeSeen(this.o.home, seen); }
    return { ok: true, chat: this.chat(at.m, at.v), view: this.view(at.m, synced.view?.offline) };
  }

  /** The person says something in a chat as their avatar there (`by: person`). */
  async say(args: Record<string, unknown>): Promise<GbResult> {
    const owner = str(args["owner"]) ?? "", id = str(args["id"]) ?? "";
    const at = this.mirrorVenue(owner, id);
    if (at === undefined) return this.fail("client.noVenue");
    const replyTo = str(args["replyTo"]);
    const r = await this.call("POST", `/venues/${owner}/${id}/messages`, { as: at.v.as, text: args["text"], id: `p-${randomBytes(5).toString("hex")}`, ...(replyTo !== undefined ? { replyTo } : {}) });
    if (this.isFail(r)) return r;
    if (r.status !== 201 && r.status !== 200) return this.refused(r);
    return this.open({ owner, id });
  }

  /** A group made as one of the person's avatars, or as a new one (`avatarName`, empty for a random name). */
  async group(args: Record<string, unknown>): Promise<GbResult> {
    const as = str(args["as"]);
    const body = { name: args["name"], ...(as !== undefined ? { as } : { avatar: str(args["avatarName"]) !== undefined ? { name: args["avatarName"] } : {} }) };
    const r = await this.call("POST", "/groups", body);
    if (this.isFail(r)) return r;
    if (r.status !== 201) return this.refused(r);
    const v = obj(obj(r.body)["venue"]);
    const synced = await this.sync();
    if (!synced.ok) return synced;
    return this.open({ owner: v["owner"], id: v["id"] });
  }

  // --- links ---

  private linkOf(v: MirrorVenue, link: Record<string, unknown>): GbLink {
    const code = str(link["code"]) ?? "";
    const days = Math.max(1, Math.ceil((Date.parse(str(link["expires"]) ?? this.o.now) - Date.parse(this.o.now)) / 86_400_000));
    return { code, url: `${this.origin}${str(link["path"]) ?? `/i/${code}`}`, line: invitePrompt(this.origin, code, v.name, this.lang), days, forward: link["forward"] !== false, approve: link["approve"] === true, isOwner: v.owner === v.as, group: v.name };
  }

  /** The group's link to hand out, and the line for someone's agent; `rotate`, a new one in its place. */
  async link(args: Record<string, unknown>, rotate = false): Promise<GbResult> {
    const owner = str(args["owner"]) ?? "", id = str(args["id"]) ?? "";
    const at = this.mirrorVenue(owner, id);
    if (at === undefined) return this.fail("client.noVenue");
    const r = rotate ? await this.call("POST", `/venues/${owner}/${id}/link`, { as: at.v.as }) : await this.call("GET", `/venues/${owner}/${id}/link?as=${at.v.as}`);
    if (this.isFail(r)) return r;
    if (r.status !== 200) return this.refused(r);
    return { ok: true, link: this.linkOf(at.v, obj(obj(r.body)["link"])) };
  }

  async linkRules(args: Record<string, unknown>): Promise<GbResult> {
    const owner = str(args["owner"]) ?? "", id = str(args["id"]) ?? "";
    const at = this.mirrorVenue(owner, id);
    if (at === undefined) return this.fail("client.noVenue");
    const change: Record<string, unknown> = { as: at.v.as };
    for (const k of ["forward", "approve"]) if (typeof args[k] === "boolean") change[k] = args[k];
    const r = await this.call("POST", `/venues/${owner}/${id}/link-rules`, change);
    if (this.isFail(r)) return r;
    if (r.status !== 200) return this.refused(r);
    at.v.rules = obj(r.body)["rules"] as MirrorVenue["rules"];
    writeMirror(this.o.home, at.m);
    return this.link({ owner, id });
  }

  // --- the person and their avatars ---

  private async thenSync(r: Answer | Fail, okStatus = 200): Promise<GbResult> {
    if (this.isFail(r)) return r;
    if (r.status !== okStatus) return this.refused(r);
    return this.sync();
  }

  rename(args: Record<string, unknown>): Promise<GbResult> { return this.call("POST", `/avatars/${str(args["avatar"]) ?? ""}/name`, { name: args["name"] }).then((r) => this.thenSync(r)); }
  mark(args: Record<string, unknown>): Promise<GbResult> { return this.call("POST", `/avatars/${str(args["avatar"]) ?? ""}/rules`, { mark: args["mark"] }).then((r) => this.thenSync(r)); }
  defaultName(args: Record<string, unknown>): Promise<GbResult> { return this.call("POST", "/me/default-name", { name: str(args["name"]) ?? null }).then((r) => this.thenSync(r)); }
  async language(args: Record<string, unknown>): Promise<GbResult> {
    const lang = args["lang"];
    if (this.client.token === undefined) {
      if (!isLang(lang)) return this.fail("lang.unknown");
      this.client.lang = lang; this.save();
      return { ok: true, view: this.view(readMirror(this.o.home)) };
    }
    return this.thenSync(await this.call("POST", "/me/lang", { lang }));
  }

  /** Which avatar this session speaks for (spec §4.1); null, none. */
  bind(args: Record<string, unknown>): GbResult {
    const session = str(args["session"]);
    if (session === undefined) return this.fail("body.none");
    const avatar = str(args["avatar"]);
    if (avatar === undefined) delete this.client.bodies[session];
    else this.client.bodies[session] = avatar;
    this.save();
    return { ok: true, view: this.view(readMirror(this.o.home)) };
  }

  note(args: Record<string, unknown>): GbResult {
    const url = str(args["url"]);
    if (url !== undefined && !this.client.notes.some((n) => n.url === url)) { this.client.notes = [...this.client.notes, { url, at: this.o.now }].slice(-5); this.save(); }
    return { ok: true, view: this.view(readMirror(this.o.home)) };
  }

  // --- 需要你 ---

  /** The person answers a card (spec §7.3): an option, or their own words; a borrow may stop asking for its asker or its chat. Then everything read again. */
  async answer(args: Record<string, unknown>): Promise<GbResult> {
    const body: Record<string, unknown> = { choice: args["choice"] };
    for (const k of ["text", "allowPerson", "allowVenue"]) if (args[k] !== undefined) body[k] = args[k];
    const r = await this.call("POST", `/needs/${str(args["avatar"]) ?? ""}/${str(args["need"]) ?? ""}`, body);
    if (this.isFail(r)) return r;
    if (r.status !== 200) return this.refused(r);
    return this.sync();
  }

  /** An avatar's or a chat's 需要你 muted or not (spec §7.3): kept on this machine. */
  mute(args: Record<string, unknown>): GbResult {
    const on = args["on"] !== false;
    const key = str(args["avatar"]) !== undefined ? "avatars" : "venues";
    const what = str(args["avatar"]) ?? str(args["venue"]);
    if (what === undefined) return this.fail("client.noVenue");
    const list = this.client.muted[key].filter((x) => x !== what);
    this.client.muted[key] = on ? [...list, what] : list;
    this.save();
    return { ok: true, view: this.view(readMirror(this.o.home)) };
  }

  /** What an avatar says while it waits for the person; empty, the language's own. */
  placeholder(args: Record<string, unknown>): Promise<GbResult> {
    const text = str(args["text"]);
    return this.call("POST", `/avatars/${str(args["avatar"]) ?? ""}/placeholder`, { text: text ?? null }).then((r) => this.thenSync(r));
  }

  // --- 被叫到 (architecture §6.3) ---

  /** The chat brought up to date, without marking it seen: a round reads what is there now. */
  private async current(owner: string, id: string): Promise<{ m: Mirror; v: MirrorVenue } | undefined> {
    if (this.mirrorVenue(owner, id) === undefined) return undefined;
    await this.sync();
    return this.mirrorVenue(owner, id);
  }

  private roundOut(r: Round): GbRound {
    return { avatar: r.avatar, owner: r.owner, id: r.id, group: r.group, replyTo: r.replyTo, hops: r.hops, prompt: roundPrompt(r.input), description: say("round.description", this.lang, { group: r.group }) };
  }

  /**
   * The person's answer to a call: 回 is a round now; 以后这个群自动回 sets
   * the chat to answer on its own, and a round now; 不回 is nothing. Each lets
   * the call go up to its last line, so the card leaves; a line that calls
   * the avatar after it makes a new one.
   */
  async wake(args: Record<string, unknown>): Promise<GbResult> {
    const avatar = str(args["avatar"]) ?? "", owner = str(args["owner"]) ?? "", id = str(args["id"]) ?? "", choice = str(args["choice"]);
    if (choice !== "reply" && choice !== "auto" && choice !== "no") return this.fail("call.choice");
    const at = await this.current(owner, id);
    const name = at?.m.avatars.find((a) => a.id === avatar)?.name;
    if (at === undefined || name === undefined || at.v.as !== avatar) return this.fail("client.noVenue");
    const key = callKey(avatar, owner, id);
    const since = this.client.dismissed[key];
    const call = callOf(at.v, { name, auto: false, ...(since !== undefined ? { since } : {}) });
    if (call === undefined) return this.fail("call.missing");
    if (choice === "auto") {
      const r = await this.call("POST", `/avatars/${avatar}/auto`, { venue: venueKey(owner, id), on: true });
      if (this.isFail(r)) return r;
      if (r.status !== 200) return this.refused(r);
    }
    this.client.dismissed[key] = call.last;
    this.save();
    const synced = choice === "auto" ? await this.sync() : { ok: true as const, view: this.view(at.m) };
    if (!synced.ok || choice === "no") return synced;
    return { ...synced, round: this.roundOut(roundFor(at.v, call, { name, why: choice === "auto" ? "auto" : "asked", mark: at.m.marks?.[avatar] ?? true })) };
  }

  /** A chat set to answer on its own, or taken back (撤 in 我的分身). */
  auto(args: Record<string, unknown>): Promise<GbResult> {
    return this.call("POST", `/avatars/${str(args["avatar"]) ?? ""}/auto`, { venue: str(args["venue"]) ?? "", on: args["on"] === true }).then((r) => this.thenSync(r));
  }

  /** The rounds this session runs on its own: the calls in chats set to answer on their own, for the avatar it speaks for; each let go as it is handed out. */
  async rounds(args: Record<string, unknown>): Promise<GbResult> {
    const session = str(args["session"]);
    const avatar = session === undefined ? undefined : this.client.bodies[session];
    const m = readMirror(this.o.home);
    if (avatar === undefined || m === undefined) return { ok: true, rounds: [] };
    const name = m.avatars.find((a) => a.id === avatar)?.name ?? avatar;
    const out: GbRound[] = [];
    for (const call of callsOf(m, { dismissed: this.client.dismissed, autos: m.autos ?? {} })) {
      if (call.avatar !== avatar || !call.auto) continue;
      const v = m.venues.find((x) => x.owner === call.owner && x.id === call.id);
      if (v === undefined) continue;
      this.client.dismissed[callKey(avatar, call.owner, call.id)] = call.last;
      out.push(this.roundOut(roundFor(v, call, { name, why: "auto", mark: m.marks?.[avatar] ?? true })));
    }
    if (out.length > 0) this.save();
    return { ok: true, rounds: out };
  }

  /** A round's answer: its words into the chat as the avatar, `by: agent`, replying to the line that called it with its hops; a card for the person when it asks one. */
  async roundDone(args: Record<string, unknown>): Promise<GbResult> {
    const avatar = str(args["avatar"]) ?? "", owner = str(args["owner"]) ?? "", id = str(args["id"]) ?? "", replyTo = str(args["replyTo"]);
    const hops = typeof args["hops"] === "number" ? args["hops"] : 0;
    const out = readRound(typeof args["text"] === "string" ? args["text"] : "", "reply");
    if (out.reply === undefined && out.ask === undefined) return { ok: true };
    const token = await this.avatarToken(avatar);
    if (this.isFail(token)) return token;
    if (out.reply !== undefined) {
      const r = await this.call("POST", `/venues/${owner}/${id}/messages`, { text: out.reply, id: `r-${randomBytes(5).toString("hex")}`, hops, ...(replyTo !== undefined ? { replyTo } : {}) }, token);
      if (this.isFail(r)) return r;
      if (r.status !== 201 && r.status !== 200) return this.refused(r);
    }
    if (out.ask !== undefined) {
      const asker = readMirror(this.o.home)?.venues.find((x) => x.owner === owner && x.id === id)?.blocks.find((b) => b.id === replyTo)?.value["speaker"];
      const from = typeof asker === "string" ? asker.replace(/^avatar:/, "") : undefined;
      const r = await this.call("POST", "/needs", { venue: venueKey(owner, id), ...out.ask, ...(replyTo !== undefined ? { message: replyTo } : {}), ...(from !== undefined && from !== avatar ? { from } : {}) }, token);
      if (this.isFail(r)) return r;
      if (r.status !== 201) return this.refused(r);
    }
    return this.sync();
  }

  // --- 任务 (spec §7.4, once called 借电脑) ---

  /** The repository on this machine an avatar's computer works in (spec §7.5): the top of the git repository the path is in; empty, none. */
  repo(args: Record<string, unknown>): GbResult {
    const avatar = str(args["avatar"]);
    if (avatar === undefined) return this.fail("avatar.missing");
    const path = typeof args["path"] === "string" ? args["path"].trim() : "";
    if (path === "") delete this.client.repos[avatar];
    else {
      if (!isAbsolute(path)) return this.fail("repo.notAbsolute");
      const top = gitTop(path);
      if (top === undefined) return this.fail("repo.notGit", { path });
      this.client.repos[avatar] = top;
    }
    this.save();
    return { ok: true, view: this.view(readMirror(this.o.home)) };
  }

  /** A job reported failed, and the person's 出错 card made by the relay; the words back here. */
  private async failWork(w: MirrorWork, code: string, params: Record<string, string>): Promise<Fail> {
    await this.call("POST", `/work/${w.avatar}/${w.id}`, { state: "failed", code, params });
    return this.fail(code, { ...params, avatar: w.avatarName, summary: w.summary });
  }

  /**
   * A waiting job taken by this session (spec §7.4): only for the avatar it
   * speaks for, only when the session is in the repository the person named
   * for that avatar — else the job fails and the person is told. Then a
   * worktree of that repository under the home, its own branch, and the
   * borrowed agent's first turn: the envelope.
   */
  async workTake(args: Record<string, unknown>): Promise<GbResult> {
    const session = str(args["session"]), avatar = str(args["avatar"]), id = str(args["work"]), root = str(args["root"]);
    if (session === undefined || avatar === undefined || this.client.bodies[session] !== avatar) return this.fail("body.none");
    const w = readMirror(this.o.home)?.work?.find((x) => x.id === id && x.avatar === avatar);
    if (w === undefined) return this.fail("work.missing");
    const repo = this.client.repos[avatar];
    if (repo === undefined) return this.failWork(w, "borrow.noRepo", {});
    const here = root === undefined ? undefined : gitTop(root);
    if (here !== repo) return this.failWork(w, "borrow.wrongRepo", { here: here ?? root ?? "", repo });
    const taken = await this.call("POST", `/work/${avatar}/${w.id}`, { state: "taken" });
    if (this.isFail(taken)) return taken;
    if (taken.status !== 200) return this.refused(taken);
    const worktree = join(this.o.home, "worktrees", `${avatar}-${w.id}`);
    const branch = `gemsbang/${avatar}-${w.id}`;
    if (!existsSync(worktree)) {
      mkdirSync(dirname(worktree), { recursive: true });
      const r = spawnSync("git", ["-C", repo, "worktree", "add", "-B", branch, worktree, "HEAD"], { encoding: "utf8", timeout: 60_000, windowsHide: true });
      if (r.status !== 0) return this.failWork(w, "borrow.failed", { reason: (r.stderr || r.error?.message || `git exited ${r.status}`).trim().slice(0, 300) });
    }
    let pkg: unknown;
    try { pkg = JSON.parse(readFileSync(join(worktree, "package.json"), "utf8")); } catch { pkg = undefined; }
    const commands = repoCommands(pkg);
    const prompt = borrowEnvelope({ avatar: w.avatarName, group: w.group ?? "", from: w.fromName ?? "?", words: w.words ?? "", summary: w.summary, worktree, commands, lang: this.lang });
    return { ok: true, work: { id: w.id, avatar, summary: w.summary, worktree, branch, commands, prompt } };
  }

  /** The borrowed agent's end (spec §7.4): its words into the chat as the avatar with the facts this host saw, or the job failed and the person told. */
  async workDone(args: Record<string, unknown>): Promise<GbResult> {
    const avatar = str(args["avatar"]) ?? "", id = str(args["work"]) ?? "";
    const text = [...(str(args["text"])?.trim() || say("borrow.doneEmpty", this.lang))].slice(0, 4000).join("");
    const body = args["ok"] === false
      ? { state: "failed", code: "borrow.failed", params: { reason: (str(args["reason"]) ?? "?").slice(0, 300) } }
      : { state: "done", text, facts: factsOf(args["facts"]) ?? [] };
    return this.thenSync(await this.call("POST", `/work/${avatar}/${id}`, body));
  }

  /** A queued job asked for now (排着 → 现在干). */
  workNow(args: Record<string, unknown>): Promise<GbResult> { return this.call("POST", `/work/${str(args["avatar"]) ?? ""}/${str(args["work"]) ?? ""}`, { state: "waiting" }).then((r) => this.thenSync(r)); }

  // --- joining ---

  private invite(args: Record<string, unknown>): { origin: string; code: string } | Fail {
    const p = parseInvite(str(args["url"]) ?? "");
    if (p === undefined) return this.fail("client.badLink");
    if (this.origin !== "" && p.origin !== this.origin) return this.fail("client.otherRelay", { host: new URL(p.origin).host });
    return p;
  }

  /** What the link's page would show this person: the group, the avatar that would go in, the names offered. */
  async linkInfo(args: Record<string, unknown>): Promise<GbResult> {
    const p = this.invite(args);
    if (this.isFail(p)) return p;
    if (this.origin === "") { this.client.relay = p.origin; this.save(); }
    const r = await this.call("GET", `/i/${p.code}`);
    if (this.isFail(r)) return r;
    if (r.status !== 200) return this.refused(r);
    const b = obj(r.body);
    const days = Math.max(1, Math.ceil((Date.parse(str(b["expires"]) ?? this.o.now) - Date.parse(this.o.now)) / 86_400_000));
    return { ok: true, info: { ...b, origin: p.origin, code: p.code, days } };
  }

  /** In by the link as the person (`as`, `name` or `new`); the chats read again; `session` given, that session speaks for the avatar after. */
  async join(args: Record<string, unknown>): Promise<GbResult> {
    const p = this.invite(args);
    if (this.isFail(p)) return p;
    if (this.client.token === undefined) return this.fail("client.notLoggedIn");
    const body: Record<string, unknown> = {};
    for (const k of ["as", "name", "new", "by"]) if (args[k] !== undefined) body[k] = args[k];
    const r = await this.call("POST", `/i/${p.code}/join`, body);
    if (this.isFail(r)) return r;
    if (r.status !== 200 && r.status !== 201) return this.refused(r);
    const joined = obj(r.body);
    const session = str(args["session"]), avatar = str(obj(joined["avatar"])["id"]);
    if (session !== undefined && avatar !== undefined) { this.client.bodies[session] = avatar; this.save(); }
    const synced = await this.sync();
    return synced.ok ? { ...synced, joined } : synced;
  }

  // --- the model's tools: the avatar this session speaks for ---

  private body(args: Record<string, unknown>): string | Fail {
    const session = str(args["session"]);
    const avatar = session === undefined ? undefined : this.client.bodies[session];
    return avatar ?? this.fail("body.none");
  }

  /** The avatar's own token, asked for once with the person's (spec §2.4: what an agent says is `by: agent`). */
  private async avatarToken(avatar: string): Promise<string | Fail> {
    const kept = this.client.avatars[avatar];
    if (kept !== undefined) return kept;
    if (this.client.token === undefined) return this.fail("client.notLoggedIn");
    const r = await this.call("POST", `/avatars/${avatar}/token`, {});
    if (this.isFail(r)) return r;
    if (r.status !== 201) return this.refused(r);
    const token = str(obj(r.body)["token"]);
    if (token === undefined) return this.fail("token.wrong");
    this.client.avatars[avatar] = token;
    this.save();
    return token;
  }

  private venueArg(args: Record<string, unknown>): { owner: string; id: string } | undefined {
    const m = /^([^/#\s]+)\/([^/#\s]+)$/.exec(str(args["venue"]) ?? "");
    return m === null ? undefined : { owner: m[1]!, id: m[2]! };
  }

  /** im_read: the venues of this session's avatar, or a venue's last lines. */
  async toolRead(args: Record<string, unknown>): Promise<GbResult> {
    const avatar = this.body(args);
    if (this.isFail(avatar)) return avatar;
    const token = await this.avatarToken(avatar);
    if (this.isFail(token)) return token;
    const name = readMirror(this.o.home)?.avatars.find((a) => a.id === avatar)?.name ?? avatar;
    const v = this.venueArg(args);
    if (v === undefined) {
      const r = await this.call("GET", "/venues", undefined, token);
      if (this.isFail(r)) return r;
      if (r.status !== 200) return this.refused(r);
      const lines = ((r.body as Record<string, unknown>[]) ?? []).map((x) => `${String(x["owner"])}/${String(x["id"])} · ${x["kind"] === "dm" ? say("panel.dm", this.lang) : ""}「${String(x["name"])}」`);
      return { ok: true, text: [say("tool.venues", this.lang, { name }), ...lines].join("\n") };
    }
    const r = await this.call("GET", `/venues/${v.owner}/${v.id}`, undefined, token);
    if (this.isFail(r)) return r;
    if (r.status !== 200) return r.status === 403 ? this.fail("body.notHere") : this.refused(r);
    const b = obj(r.body), venue = obj(b["venue"]);
    const mv: MirrorVenue = { owner: v.owner, id: v.id, kind: venue["kind"] === "dm" ? "dm" : "group", name: str(venue["name"]) ?? v.id, members: (venue["members"] ?? []) as MirrorVenue["members"], as: avatar, blocks: (b["blocks"] ?? []) as MirrorVenue["blocks"] };
    const limit = typeof args["limit"] === "number" && args["limit"] > 0 ? Math.min(100, Math.floor(args["limit"])) : 12;
    const said = itemsOf(mv).filter((i): i is Extract<ChatItem, { kind: "message" }> => i.kind === "message").slice(-limit);
    const lines = said.map((i) => `#${i.id} ${i.who}${i.mark ? `（${say("page.group.mark", this.lang)}）` : ""}${i.mine ? `（${say("panel.you", this.lang)}）` : ""}：${i.text}`);
    return { ok: true, text: [say("tool.recent", this.lang, { group: mv.name, count: said.length }), ...lines].join("\n") };
  }

  /** im_ask: a 需要你 card from this session's avatar to its person, about a chat it is in (spec §7.3). */
  async toolAsk(args: Record<string, unknown>): Promise<GbResult> {
    const avatar = this.body(args);
    if (this.isFail(avatar)) return avatar;
    const token = await this.avatarToken(avatar);
    if (this.isFail(token)) return token;
    const body: Record<string, unknown> = {};
    for (const k of ["venue", "kind", "summary", "checked", "draft", "options", "expires", "placeholder", "from"]) if (args[k] !== undefined) body[k] = args[k];
    if (typeof args["replyTo"] === "string") body["message"] = args["replyTo"];
    const r = await this.call("POST", "/needs", body, token);
    if (this.isFail(r)) return r;
    if (r.status === 403) return this.fail("body.notHere");
    if (r.status !== 201) return this.refused(r);
    const need = obj(obj(r.body)["need"]);
    const m = readMirror(this.o.home);
    const v = this.venueArg(args);
    const group = v === undefined ? "" : m?.venues.find((x) => x.owner === v.owner && x.id === v.id)?.name ?? v.id;
    const name = m?.avatars.find((a) => a.id === avatar)?.name ?? avatar;
    return { ok: true, text: say("tool.asked", this.lang, { kind: say(`need.kind.${String(need["kind"])}`, this.lang), name, group }), sent: String(need["id"] ?? "") };
  }

  /** im_say: a line in a venue as this session's avatar, `by: agent`. */
  async toolSay(args: Record<string, unknown>): Promise<GbResult> {
    const avatar = this.body(args);
    if (this.isFail(avatar)) return avatar;
    const v = this.venueArg(args);
    if (v === undefined) return this.fail("client.noVenue");
    const token = await this.avatarToken(avatar);
    if (this.isFail(token)) return token;
    const replyTo = str(args["replyTo"]);
    const r = await this.call("POST", `/venues/${v.owner}/${v.id}/messages`, { text: args["text"], id: `m-${randomBytes(5).toString("hex")}`, ...(replyTo !== undefined ? { replyTo } : {}) }, token);
    if (this.isFail(r)) return r;
    if (r.status === 403) return this.fail("body.notHere");
    if (r.status !== 201 && r.status !== 200) return this.refused(r);
    const m = readMirror(this.o.home);
    const group = m?.venues.find((x) => x.owner === v.owner && x.id === v.id)?.name ?? v.id;
    const name = m?.avatars.find((a) => a.id === avatar)?.name ?? avatar;
    return { ok: true, text: say("tool.said", this.lang, { group, name }), sent: String(obj(obj(r.body)["message"])["id"] ?? "") };
  }
}

/** The calls the bridge answers, by name. */
export const GB_CALLS = ["status", "wait", "setup", "login-start", "login-verify", "logout", "first-avatar", "account", "method-start", "method-verify", "method-remove", "device-revoke", "devices-revoke-others", "open", "say", "group", "link", "rotate", "link-rules", "rename", "mark", "default-name", "lang", "bind", "note", "link-info", "join", "answer", "mute", "placeholder", "wake", "auto", "rounds", "round-done", "repo", "work-take", "work-done", "work-now", "tool-read", "tool-say", "tool-ask"] as const;
export type GbCall = (typeof GB_CALLS)[number];

export async function runGb(call: string, args: Record<string, unknown>, o: GbOptions): Promise<GbResult> {
  const gb = new Gb(o);
  switch (call as GbCall) {
    case "status": return gb.sync();
    case "wait": return gb.wait(args);
    case "setup": return gb.setup(args);
    case "login-start": return gb.loginStart(args);
    case "login-verify": return gb.loginVerify(args);
    case "logout": return gb.logout();
    case "first-avatar": return gb.firstAvatar(args);
    case "account": return gb.account();
    case "method-start": return gb.methodStart(args);
    case "method-verify": return gb.methodVerify(args);
    case "method-remove": return gb.methodRemove(args);
    case "device-revoke": return gb.deviceRevoke(args);
    case "devices-revoke-others": return gb.devicesRevokeOthers();
    case "open": return gb.open(args);
    case "say": return gb.say(args);
    case "group": return gb.group(args);
    case "link": return gb.link(args);
    case "rotate": return gb.link(args, true);
    case "link-rules": return gb.linkRules(args);
    case "rename": return gb.rename(args);
    case "mark": return gb.mark(args);
    case "default-name": return gb.defaultName(args);
    case "lang": return gb.language(args);
    case "bind": return gb.bind(args);
    case "note": return gb.note(args);
    case "link-info": return gb.linkInfo(args);
    case "join": return gb.join(args);
    case "tool-read": return gb.toolRead(args);
    case "tool-say": return gb.toolSay(args);
    case "answer": return gb.answer(args);
    case "mute": return gb.mute(args);
    case "placeholder": return gb.placeholder(args);
    case "wake": return gb.wake(args);
    case "auto": return gb.auto(args);
    case "rounds": return gb.rounds(args);
    case "round-done": return gb.roundDone(args);
    case "repo": return gb.repo(args);
    case "work-take": return gb.workTake(args);
    case "work-done": return gb.workDone(args);
    case "work-now": return gb.workNow(args);
    case "tool-ask": return gb.toolAsk(args);
    default: return { ok: false, code: "client.unknownCall", params: { call }, reason: say("client.unknownCall", DEFAULT_LANG, { call }) };
  }
}
