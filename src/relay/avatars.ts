// gemsbang's relay (spec §4, §5; transport §2): people, the avatars that are
// their accounts, the groups and two-person talks the avatars are in, and
// what they say there. A person lives under `_relay` only: their ways in (an
// email, a phone number) as salted hashes, the devices they signed in on,
// their default name, which avatars are theirs. No answer to a
// client ever names the person behind an avatar (§5 rule 4). An avatar's card
// (`<avatar>/avatar.geml`) is public; its rules and its list of venues are
// its own and its person's; a venue is its members'. Every message is
// stamped with the avatar that said it and `by`, the person typing or an
// agent holding the avatar's token; others see `by` only when that avatar
// marks (§5 rule 1). It shares the store, the chain and the tokens with the
// older Relay (relay.ts) and touches none of that one's documents. A refusal
// is a code and its parameters (§7.6), with its words in Chinese beside it
// for whoever has no language to ask in; words.ts says it in the others.
// Everything appended that a person should know goes into their box too
// (architecture §5.1): a line in a chat of theirs as they may see it, their
// avatars' cards, jobs, rules and lists, a name changed, their own record.
import { createHash, randomBytes, randomInt } from "node:crypto";
import { normalizeText, type DataBlock } from "../core/chain.js";
import type { JsonValue } from "../core/json.js";
import { factsOf } from "../core/avatar/borrow.js";
import { BASE_MAX, BASE_PENDING_MAX, baseFault, baseFor, baseOf, type BaseItem } from "../core/avatar/base.js";
import { defaultOptions, isKind, needFault, wordsOf, type Allow, type Need, type NeedKind, type NeedOption } from "../core/avatar/needs.js";
import { DEFAULT_LINK_RULES, expiresAt, linkPath, linkStatus, LINK_CODE, makeCode, mayHandOut, withLinkRules, type LinkRules } from "../core/avatar/links.js";
import { nameFault, randomName } from "../core/avatar/names.js";
import { suggestions, type Suggestion } from "../core/avatar/naming.js";
import { pickAvatar, type Pick } from "../core/avatar/pick.js";
import { DIFFERENCE_LIMIT, differenceOf, type Difference, type Update } from "../core/avatar/updates.js";
import { addressFault, addressOf, codeMail, hashAddress, isSsoKind, keyOf, maskAddress, normalizeEmail, SSO_KINDS, type Address, type AddressKind, type SsoKind } from "../core/avatar/address.js";
import { CODE_MISSES, CODE_RE, CODE_TTL_MS, CODES_PER_IP_HOUR, CODES_PER_PHONE, codeText, tailOf } from "../core/avatar/phone.js";
import { DEFAULT_RULES, withRules, type Rules } from "../core/avatar/rules.js";
import { AVATAR_ID, avatarSpeaker, parseWho, VENUE_ID, type By } from "../core/avatar/who.js";
import { DEFAULT_LANG, isLang, say, type Fault, type Lang } from "../core/avatar/words.js";
import { BLOCK_ID, DOC, nextId, RELAY_OWNER, sealed } from "./store.js";
import { appendSealed, fileStore, type DocStore } from "./doc-store.js";
import type { PushAdapter } from "./push.js";
import { fileMailer, type Mailer } from "./mail.js";
import { fileTexter, type Texter } from "./text.js";
import type { Fetcher, Identity, SsoApp, SsoApps } from "./sso.js";
import { hashToken, issueToken, liveTokens, revokeToken, verifyToken, type TokenRecord } from "./tokens.js";

/** Where its documents live: a folder (`root`, files as the Node shell keeps them) or a store (doc-store.ts: memory, SQLite). */
export interface AvatarRelayOptions { root?: string; store?: DocStore; name: string; /** Where the pages are, for the links in reminders; `https://<name>` unless given. */ origin?: string; now?: () => string; texter?: Texter; /** Where an email's code goes, and the address it says it comes from (the relay's name unless given). */ mailer?: Mailer; mailFrom?: string; /** The emails whose code comes back in the answer and is not mailed: test accounts such as Smith's (Q21, 2026-11-04); none unless given. */ showCodeTo?: readonly string[]; /** The calling codes (`+63`) a number may be texted at; unless given, any (a relay on files writes the texts down). */ textTo?: readonly string[]; /** The other accounts a person may sign in with (S28): the operator's app for each; none unless given. */ sso?: SsoApps; /** How the shell asks those accounts; `fetch` unless given. */ fetch?: Fetcher; rand?: () => number; /** The push channels the relay offers (spec §7.3); none unless given. */ push?: PushAdapter[] }
/** A refusal: the status, the code and its parameters, and the code's words in Chinese. */
export type Fail = { ok: false; status: number; code: string; params?: Record<string, string | number>; reason: string };
export type Result<T> = ({ ok: true } & T) | Fail;
export type Issued = { token: string; record: TokenRecord };
/** An avatar as anyone sees it: its id and name. */
export interface AvatarCard { id: string; name: string }
export type VenueKind = "group" | "dm";
/** `owner` is where the group is kept, and who made it; `keeper` is its 群主 now (the maker, until they hand it on, S19); `former`, who left, so their lines keep their names. */
export interface VenueView { owner: string; id: string; kind: VenueKind; name: string; members: AvatarCard[]; keeper: string; former: AvatarCard[] }
/** A venue as one of the person's avatars is in it. */
/** `last`: its newest line, for the web's 我的群 (S8, P12b). */
export interface MyVenue extends VenueView { as: string; last?: { who: string; text: string; at: string } }
export interface Visible { id: string; value: Record<string, JsonValue> }
export interface Pushed { owner: string; doc: string; block: DataBlock }
/** A group's link as a member hands it out (spec §6.1). */
export interface LinkView { code: string; expires: string; path: string; forward: boolean; approve: boolean }
/** What a link's page shows (spec §6.2): the group, a few of its members, its owner; to a person, which avatar would go in and the names offered. */
export interface LinkInfo { group: { id: string; name: string; count: number; members: AvatarCard[] }; owner: AvatarCard | undefined; expires: string; approve: boolean; suggestions: Suggestion[]; you?: { avatars: AvatarCard[]; pick: Pick } }
/** A way in as its person sees it (architecture §3.1): its key in the login index, its kind, the address masked, when it was added. */
export interface Method { id: string; kind: AddressKind; shown: string; at: string }
/** Where the person is signed in: the sign-in's token id, the name the device gave, when, whether it is the one asking, the avatars the agents it attached play. */
export interface Device { id: string; name: string; at: string; current: boolean; avatars: AvatarCard[] }
/** In through a link: the avatar that went in, or waits for the owner; an agent's join carries the avatar's token. */
export interface Joined { venue: VenueView; avatar: AvatarCard; already: boolean; pending?: string; token?: string }

const fail = (status: number, code: string, params?: Record<string, string | number>): Fail => ({ ok: false, status, code, ...(params !== undefined ? { params } : {}), reason: say(code, DEFAULT_LANG, params) });
const refuse = (status: number, f: Fault): Fail => fail(status, f.code, f.params);
const isFail = (x: object): x is Fail => (x as Fail).ok === false;
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const obj = (v: unknown): Record<string, unknown> | undefined => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);
const hex = (bytes: number): string => randomBytes(bytes).toString("hex");
const ONE_HOUR_MS = 3_600_000;
/** The relay's own records, under `_relay`: the login index (each address's binds and unbinds), the phone→person map from before it, the codes, the avatar→person map, the salt. */
/** A sign-in through another account (S28): how long its browser has, from the link opened to the account's yes. */
export const SSO_TTL_MS = 10 * 60_000;
/** The hash of the secret a client keeps for one sign-in through another account: what the browser's link carries. */
export const SSO_HASH = /^[0-9a-f]{64}$/;
/** Where a sign-in through another account stands for the client waiting on it. */
export type SsoState = "none" | "waiting" | "opened" | "done" | "added" | "failed";
const SSO = "avatar-sso.geml";
/** The hash the browser's link carries for a client's secret. */
export const ssoHash = (secret: string): string => createHash("sha256").update(secret, "utf8").digest("hex");
const LOGINS = "avatar-logins.geml", PHONES = "avatar-phones.geml", CODES = "avatar-codes.geml", OWNERS = "avatar-owners.geml", SALT = "avatar-salt.txt";
/** The name a device gives itself, at most this long. */
const DEVICE_NAME_MAX = 60;
const peopleDoc = (person: string): string => `people/${person}.geml`;
const PEOPLE_DOC = /^people\/(p-[0-9a-f]{10})\.geml$/;
/** A person's box (architecture §5.1), under `_relay`: one block `u-<pts>` per update. */
const boxDoc = (person: string): string => `boxes/${person}.geml`;
const num = (v: unknown): number => (typeof v === "number" ? v : 0);
const lastPts = (d: { blocks: readonly DataBlock[] }): number => num(d.blocks[d.blocks.length - 1]?.value["pts"]);
const venueDoc = (venue: string): string => `venues/${venue}.geml`;
const VENUE_DOC = /^venues\/([gd]-[0-9a-f]{10})\.geml$/;
/** Ids the relay writes in a venue; a client's message may not take one. */
const RESERVED = /^(venue|member|msg|sys|link|request|answer|leave|owner)(-|$)/;
/** A web person is mailed about a chat at most once in this long (Q8: 同一个群几个小时最多一封). */
const REMIND_GAP_MS = 3 * 3_600_000;
const remindsDoc = (person: string): string => `reminds/${person}.geml`;
/** Where a person's email is kept for reminders: the service's alone, never in a box. */
const reachDoc = (person: string): string => `reaches/${person}.geml`;
export const TEXT_MAX = 4000;
const WORK_DOC = "work.geml";
/** Where a job of the person's computer stands (spec §7.4). */
export type WorkState = "waiting" | "queued" | "taken" | "done" | "failed";
const WORK_STATES: readonly WorkState[] = ["waiting", "queued", "taken", "done", "failed"];
const WORK_FAULTS = ["borrow.noRepo", "borrow.wrongRepo", "borrow.failed"];
/** A job for the avatar's computer, from a borrow card: what it is, where it came from, where it stands. */
export interface Work { id: string; avatar: string; need: string; summary: string; state: WorkState; at: string; since: string; venue?: { owner: string; id: string }; message?: string; from?: string; auto?: true }
export const GROUP_NAME_MAX = 40;

export class AvatarRelay {
  /** The folder of a relay on files; none on another store. */
  readonly root: string | undefined;
  /** The relay's documents: every append also goes into the boxes of the people it concerns. */
  readonly store: DocStore;
  private readonly base: DocStore;
  private readonly boxWaiters = new Map<string, Set<() => void>>();
  readonly name: string;
  private readonly clock: () => string;
  private readonly texter: Texter;
  private readonly mailer: Mailer;
  private readonly mailFrom: string;
  private readonly showCodeTo: ReadonlySet<string>;
  private readonly textTo: readonly string[] | undefined;
  private readonly ssoApps: SsoApps;
  private readonly ssoWaiters = new Map<string, Set<() => void>>();
  /** How the shell asks the other accounts a person signs in with. */
  readonly fetch: Fetcher;
  private origin: string;
  private readonly originGiven: boolean;
  private readonly rand: () => number;
  private readonly listeners = new Set<(p: Pushed) => void>();
  private readonly push: PushAdapter[];

  constructor(o: AvatarRelayOptions) {
    if (o.store === undefined && o.root === undefined) throw new Error("a relay needs a root or a store");
    this.root = o.root;
    const base = o.store ?? fileStore(o.root!);
    this.base = base;
    this.store = {
      read: (owner, doc) => base.read(owner, doc),
      list: (owner, dir) => base.list(owner, dir),
      secret: (name, make) => base.secret(name, make),
      remove: (owner, doc) => base.remove(owner, doc),
      append: (owner, doc, idOf, build) => { const a = base.append(owner, doc, idOf, build); if (!a.existed) this.route(owner, doc, a.block); return a; },
    };
    this.name = o.name;
    // On files, a text the operator has no route for is a file; elsewhere it goes nowhere until they give one.
    this.texter = o.texter ?? (o.root !== undefined ? fileTexter(o.root) : () => undefined);
    this.mailer = o.mailer ?? (o.root !== undefined ? fileMailer(o.root) : () => undefined);
    this.mailFrom = o.mailFrom ?? o.name;
    this.showCodeTo = new Set((o.showCodeTo ?? []).map(normalizeEmail).filter((e): e is string => e !== undefined));
    this.textTo = o.textTo;
    this.ssoApps = o.sso ?? {};
    this.fetch = o.fetch ?? ((url, init) => fetch(url, init));
    this.origin = (o.origin ?? `https://${o.name}`).replace(/\/+$/, "");
    this.originGiven = o.origin !== undefined;
    this.rand = o.rand ?? Math.random;
    this.clock = o.now ?? (() => new Date().toISOString().replace(/\.\d{3}Z$/, "Z"));
    this.push = o.push ?? [];
  }

  now(): string { return this.clock(); }
  /** Hear of every block appended; the function given back stops it. */
  onAppend(fn: (p: Pushed) => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private emit(owner: string, doc: string, block: DataBlock): void { for (const fn of this.listeners) fn({ owner, doc, block }); }
  verify(token: string): TokenRecord | undefined { return verifyToken(this.store, token); }

  /** The salt of the phone hashes, made once: a hash of a phone number without it could be undone by trying every number. */
  private salt(): string { return this.store.secret(SALT, () => hex(16)); }

  // --- login (spec §6.2; architecture §3) ---

  /** A code sent to the address — mailed to an email, texted to a number — in the language asked in: three to an address in ten minutes, ten to a network in an hour; whether the address is someone's way in, where the code went (masked) and who it comes from; an email the operator listed, its code itself, and no mail. */
  startLogin(body: unknown, ip?: string): Result<{ sent: true; known: boolean; to: string; from: string; tail?: string; code?: string }> {
    const sent = this.sendCode(obj(body) ?? {}, ip);
    if (isFail(sent)) return sent;
    return { ok: true, sent: true, known: this.personByKey(sent.key) !== undefined, to: maskAddress(sent.a), from: this.mailFrom, ...(sent.a.kind === "phone" ? { tail: tailOf(sent.a.value) } : {}), ...(sent.shown !== undefined ? { code: sent.shown } : {}) };
  }

  /** A code made and sent to the body's address, unless `before` refuses its key or the address or the network asked too often; to an email the operator listed, given back instead (`shown`). */
  private sendCode(o: Record<string, unknown>, ip?: string, before?: (key: string) => Fail | undefined): { a: Address; key: string; shown?: string } | Fail {
    const a = addressOf(o);
    if (a === undefined) return refuse(400, addressFault(o)!);
    const asked = o["lang"];
    const lang: Lang = isLang(asked) ? asked : DEFAULT_LANG;
    // A number is texted only in the countries the operator opened (S29).
    if (a.kind === "phone" && this.textTo !== undefined && !this.textTo.some((p) => a.value.startsWith(p))) return fail(400, "phone.country");
    const h = hashAddress(a, this.salt()), key = keyOf(a.kind, h);
    const refused = before?.(key);
    if (refused !== undefined) return refused;
    const now = this.now(), t = Date.parse(now);
    const age = (b: DataBlock): number => t - Date.parse(str(b.value["at"]) ?? "");
    const recent = this.store.read(RELAY_OWNER, CODES).blocks.filter((b) => /^code-\d+$/.test(b.id) && age(b) < ONE_HOUR_MS);
    if (recent.filter((b) => b.value["addr"] === h && age(b) < CODE_TTL_MS).length >= CODES_PER_PHONE) return fail(429, "code.tooMany");
    if (ip !== undefined && recent.filter((b) => b.value["ip"] === ip).length >= CODES_PER_IP_HOUR) return fail(429, "code.tooMany");
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    this.store.append(RELAY_OWNER, CODES, nextId("code"), (_d, prev, id) => sealed({ id, addr: h, code: hashToken(`${h}:${code}`), at: now, ...(ip !== undefined ? { ip } : {}) }, prev));
    if (a.kind === "email" && this.showCodeTo.has(a.value)) return { a, key, shown: code };
    try {
      const sending = a.kind === "email" ? this.mailer({ to: a.value, ...codeMail(code, lang) }) : this.texter({ to: a.value, text: codeText(code, lang) });
      void Promise.resolve(sending).catch(() => { /* the operator's route failed; the next code tries again */ });
    } catch { /* the same */ }
    return { a, key };
  }

  /** The code checked and spent for the body's address: the address and its key. */
  private spendCode(o: Record<string, unknown>): { a: Address; key: string } | Fail {
    const a = addressOf(o);
    if (a === undefined) return refuse(400, addressFault(o)!);
    const code = str(o["code"]);
    if (code === undefined || !CODE_RE.test(code)) return fail(400, "code.short");
    const h = hashAddress(a, this.salt()), now = this.now(), t = Date.parse(now);
    const d = this.store.read(RELAY_OWNER, CODES);
    const recent = (b: DataBlock): boolean => t - Date.parse(str(b.value["at"]) ?? "") < CODE_TTL_MS;
    // Six digits are a million guesses: five wrong ones stop the address's codes for ten minutes.
    const misses = d.blocks.filter((b) => /^miss-\d+$/.test(b.id) && b.value["addr"] === h && recent(b)).length;
    if (misses >= CODE_MISSES) return fail(429, "code.locked");
    const used = new Set(d.blocks.filter((b) => /^used-\d+$/.test(b.id)).map((b) => b.value["code"]));
    const want = hashToken(`${h}:${code}`);
    const hit = d.blocks.find((b) => /^code-\d+$/.test(b.id) && b.value["addr"] === h && b.value["code"] === want && !used.has(b.id) && recent(b));
    if (hit === undefined) {
      this.store.append(RELAY_OWNER, CODES, nextId("miss"), (_d, prev, id) => sealed({ id, addr: h, at: now }, prev));
      return misses + 1 >= CODE_MISSES ? fail(429, "code.locked") : fail(401, "code.wrong");
    }
    this.store.append(RELAY_OWNER, CODES, nextId("used"), (_d, prev, id) => sealed({ id, code: hit.id, at: now }, prev));
    return { a, key: keyOf(a.kind, h) };
  }

  /** The person an address's key is a way in to: its last bind in the login index, unless unbound after; a number from before the index, the old map's. */
  private personByKey(key: string): string | undefined {
    let person: string | undefined, seen = false;
    for (const b of this.store.read(RELAY_OWNER, LOGINS).blocks) {
      if (b.value["key"] !== key) continue;
      seen = true;
      person = /^bind-\d+$/.test(b.id) ? str(b.value["person"]) : undefined;
    }
    if (seen || !key.startsWith("phone-")) return person;
    const old = this.store.read(RELAY_OWNER, PHONES).blocks.find((x) => x.id === key);
    return old === undefined ? undefined : str(old.value["person"]);
  }

  /** The address made one of the person's ways in: in the login index, and on the person, masked (another account, as it shows itself). */
  private bind(person: string, a: Address, key: string, shown = maskAddress(a)): void {
    const now = this.now();
    this.store.append(RELAY_OWNER, LOGINS, nextId("bind"), (_d, prev, id) => sealed({ id, key, person, at: now }, prev));
    this.store.append(RELAY_OWNER, peopleDoc(person), nextId("bind"), (_d, prev, id) => sealed({ id, key, kind: a.kind, shown, at: now }, prev));
  }

  /** Someone new, in the language they signed in with, with no avatar yet. */
  private newPerson(lang: unknown): string {
    const person = `p-${hex(5)}`;
    appendSealed(this.store, RELAY_OWNER, peopleDoc(person), "person", { lang: isLang(lang) ? lang : DEFAULT_LANG, at: this.now() });
    return person;
  }

  /** The code checked: a person's token, named for the device that asked; an address seen for the first time becomes a person in the language they signed in with, with no avatar yet (one grows with the first venue, §6.2, or the name they give first). */
  finishLogin(body: unknown): Result<{ token: string; person: string; new: boolean }> {
    const p = this.checkCode(body);
    if (isFail(p)) return p;
    const { token, record } = issueToken(this.store, { speaker: `person:${p.person}`, scope: "person", by: "login", at: this.now() });
    this.nameDevice(p.person, record.id, obj(body)?.["device"]);
    return { ok: true, token, person: p.person, new: p.new };
  }

  /** The code checked and spent: the person the address is a way in to, made the first time it is seen. */
  private checkCode(body: unknown): { person: string; new: boolean } | Fail {
    const o = obj(body) ?? {};
    const s = this.spendCode(o);
    if (isFail(s)) return s;
    const known = this.personByKey(s.key);
    if (known !== undefined) { this.keepReach(known, s.a, s.key); return { person: known, new: false }; }
    const person = this.newPerson(o["lang"]);
    this.bind(person, s.a, s.key);
    this.keepReach(person, s.a, s.key);
    return { person, new: true };
  }

  /** Where the pages are once a shell knows it (the Node shell's own address), unless the operator named it. */
  useOrigin(url: string): void { if (!this.originGiven) this.origin = url.replace(/\/+$/, ""); }

  /**
   * The address a person signed in with by email, kept for them by the service alone (`reaches/<id>.geml`, never sent
   * to a box): where a reminder goes (Q8). A number stays a hash; nothing is texted.
   */
  private keepReach(person: string, a: Address, key: string): void {
    if (a.kind !== "email" || this.reachesOf(person).get(key) === a.value) return;
    this.store.append(RELAY_OWNER, reachDoc(person), nextId("reach"), (_d, prev, id) => sealed({ id, key, mail: a.value, at: this.now() }, prev));
  }

  private reachesOf(person: string): Map<string, string> {
    const out = new Map<string, string>();
    for (const b of this.store.read(RELAY_OWNER, reachDoc(person)).blocks) if (/^reach-\d+$/.test(b.id) && typeof b.value["key"] === "string" && typeof b.value["mail"] === "string") out.set(b.value["key"], b.value["mail"]);
    return out;
  }

  /** The email a reminder goes to: the newest of the person's ways in that is still theirs; none, nothing is sent. */
  private reachOf(person: string): string | undefined {
    const reaches = this.reachesOf(person);
    return this.methodsOf(person).filter((m) => reaches.has(m.id)).sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0)).map((m) => reaches.get(m.id)!).at(0);
  }

  /** Whether the person is signed in on a computer with the plugin (its device named `… · Claude Code`): the pane tells them, so no mail does. */
  private onComputer(person: string): boolean {
    const live = new Set(liveTokens(this.store).filter((t) => t.by === "login" && t.speaker === `person:${person}`).map((t) => t.id));
    return this.store.read(RELAY_OWNER, peopleDoc(person)).blocks.some((b) => /^device-\d+$/.test(b.id) && live.has(str(b.value["token"]) ?? "") && /Claude Code$/.test(str(b.value["name"]) ?? ""));
  }

  /**
   * A line that calls someone on the web (S8, Q8): an @ of their avatar's name, or a reply to their line, in a group
   * of theirs; they have no pane, so a mail — at most one a chat in REMIND_GAP_MS — with the line and the group's page.
   */
  private remind(owner: string, venue: string, line: Record<string, JsonValue>): void {
    const s = this.venueState(owner, venue);
    if (s === undefined || s.kind !== "group") return;
    const text = str(line["text"]) ?? "", speaker = parseWho(str(line["speaker"]) ?? "");
    const from = speaker?.kind === "avatar" ? speaker.id : undefined;
    const replyTo = str(line["replyTo"]);
    const answered = replyTo === undefined ? undefined : parseWho(str(this.store.read(owner, venueDoc(venue)).blocks.find((b) => b.id === replyTo)?.value["speaker"]) ?? "");
    const who = from !== undefined ? this.card(from)?.name ?? "" : "";
    for (const m of s.members) {
      if (m === from) continue;
      const name = this.card(m)?.name;
      const mention = name !== undefined && text.includes(`@${name}`), reply = answered?.kind === "avatar" && answered.id === m;
      if (!mention && !reply) continue;
      const person = this.ownerOf(m);
      if (person === undefined || this.ownerOf(from ?? "") === person || this.onComputer(person)) continue;
      const to = this.reachOf(person);
      if (to === undefined) continue;
      const key = `${owner}/${venue}`, now = this.now();
      const last = this.store.read(RELAY_OWNER, remindsDoc(person)).blocks.filter((b) => b.value["venue"] === key).at(-1);
      if (last !== undefined && Date.parse(now) - Date.parse(str(last.value["at"]) ?? "") < REMIND_GAP_MS) continue;
      this.store.append(RELAY_OWNER, remindsDoc(person), nextId("remind"), (_d, prev, id) => sealed({ id, venue: key, at: now }, prev));
      const lang = this.languageOf(person);
      const subject = say(mention ? "remind.mention" : "remind.reply", lang, { group: s.name, who });
      try {
        const sending = this.mailer({ to, subject, text: say("remind.text", lang, { line: text, url: `${this.origin}/g/${venue}` }) });
        void Promise.resolve(sending).catch(() => { /* the operator's route failed; the pages still show it */ });
      } catch { /* the same */ }
    }
  }

  /** The name a device gave itself at sign-in, kept with its token's id; control characters dropped, at most sixty characters, none when empty. */
  private nameDevice(person: string, token: string, given: unknown): void {
    const name = typeof given === "string" ? [...given.replace(/[\u0000-\u001f\u007f]/g, "").trim()].slice(0, DEVICE_NAME_MAX).join("") : "";
    if (name !== "") this.store.append(RELAY_OWNER, peopleDoc(person), nextId("device"), (_d, prev, id) => sealed({ id, token, name, at: this.now() }, prev));
  }

  // --- signing in through another account (S28–S32) ---
  //
  // The client keeps a secret and gives the browser only its hash: the link opens the account (`ssoOpen`), the
  // account's yes says who the person is (`ssoDone`), and only the one holding the secret takes the sign-in that
  // came of it (`ssoCheck`). Someone who sees the link cannot sign in with it; the hash is good for one sign-in.

  /** The accounts the operator set up, in the order the sign-in page lists them. */
  providers(): SsoKind[] { return SSO_KINDS.filter((k) => this.ssoApps[k] !== undefined); }
  /** The operator's app for an account; none when it is not set up. */
  ssoApp(kind: string): SsoApp | undefined { return isSsoKind(kind) ? this.ssoApps[kind] : undefined; }

  /** Hear when the sign-in a hash names moves on; the function given back stops it. */
  onSso(h: string, fn: () => void): () => void {
    const set = this.ssoWaiters.get(h) ?? new Set<() => void>();
    set.add(fn);
    this.ssoWaiters.set(h, set);
    return () => { set.delete(fn); if (set.size === 0) this.ssoWaiters.delete(h); };
  }
  private ssoMoved(h: string): void { for (const fn of [...(this.ssoWaiters.get(h) ?? [])]) fn(); }

  /** The sign-in a hash names, within its ten minutes: who it adds a way in for, the account opened, how it ended, whether that was taken. */
  private ssoOf(h: string): { person?: string; kind?: SsoKind; done?: { person?: string; new?: boolean; added?: boolean; fail?: string }; taken: boolean } | undefined {
    const t = Date.parse(this.now());
    let out: { person?: string; kind?: SsoKind; done?: { person?: string; new?: boolean; added?: boolean; fail?: string }; taken: boolean } | undefined;
    for (const b of this.store.read(RELAY_OWNER, SSO).blocks) {
      if (b.value["h"] !== h) continue;
      if (/^sso-\d+$/.test(b.id)) {
        out = t - Date.parse(str(b.value["at"]) ?? "") < SSO_TTL_MS ? { ...(str(b.value["person"]) !== undefined ? { person: str(b.value["person"])! } : {}), taken: false } : undefined;
      } else if (out !== undefined && /^ssoopen-\d+$/.test(b.id) && isSsoKind(b.value["kind"])) out.kind = b.value["kind"];
      else if (out !== undefined && /^ssodone-\d+$/.test(b.id)) out.done = { ...(str(b.value["person"]) !== undefined ? { person: str(b.value["person"])! } : {}), ...(b.value["new"] === true ? { new: true } : {}), ...(b.value["added"] === true ? { added: true } : {}), ...(str(b.value["fail"]) !== undefined ? { fail: str(b.value["fail"])! } : {}) };
      else if (out !== undefined && /^ssotaken-\d+$/.test(b.id)) out.taken = true;
    }
    return out;
  }

  /** Where a sign-in stands, for a wait on it: the shell holds a check while this stays what the client last saw. */
  ssoStateOf(h: string): SsoState {
    const r = this.ssoOf(h);
    if (r === undefined || r.taken) return "none";
    if (r.done !== undefined) return r.done.fail !== undefined ? "failed" : r.done.added === true ? "added" : "done";
    return r.kind !== undefined ? "opened" : "waiting";
  }

  /** 加一种登录方式 (S32): a hash the person's own client holds, so the account its link opens becomes one more of their ways in. */
  ssoAdd(by: TokenRecord, body: unknown): Result<{ waiting: true }> {
    const person = this.onlyPerson(by);
    if (typeof person !== "string") return person;
    const h = str(obj(body)?.["h"]);
    if (h === undefined || !SSO_HASH.test(h)) return fail(400, "sso.bad");
    if (this.ssoOf(h) !== undefined) return fail(409, "sso.gone");
    this.store.append(RELAY_OWNER, SSO, nextId("sso"), (_d, prev, id) => sealed({ id, h, person, at: this.now() }, prev));
    return { ok: true, waiting: true };
  }

  /** The browser opened the link: the account it asks, written down for the waiting client; a hash already used is refused. */
  ssoOpen(kind: string, h: string): Result<{ kind: SsoKind }> {
    if (!isSsoKind(kind) || this.ssoApps[kind] === undefined) return fail(404, "sso.unknown");
    if (!SSO_HASH.test(h)) return fail(400, "sso.bad");
    const was = this.ssoOf(h);
    if (was?.done !== undefined || was?.taken === true) return fail(410, "sso.gone");
    const now = this.now();
    if (was === undefined) this.store.append(RELAY_OWNER, SSO, nextId("sso"), (_d, prev, id) => sealed({ id, h, at: now }, prev));
    this.store.append(RELAY_OWNER, SSO, nextId("ssoopen"), (_d, prev, id) => sealed({ id, h, kind, at: now }, prev));
    this.ssoMoved(h);
    return { ok: true, kind };
  }

  /**
   * The account said yes, and who the person is there. A way in already bound is that person; else, for 加一种, the
   * person who asked (unless the account is someone else's); else an address the account checked that is already
   * someone's way in is that person (Q19 (a), 2026-11-04), the account bound to them; else someone new.
   */
  ssoDone(h: string, who: Identity): Result<{ person: string; new: boolean; added: boolean }> {
    const r = this.ssoOf(h);
    if (r === undefined || r.done !== undefined || r.taken || r.kind !== who.kind) return fail(410, "sso.gone");
    const a: Address = { kind: who.kind, value: who.sub };
    const key = keyOf(a.kind, hashAddress(a, this.salt()));
    const known = this.personByKey(key);
    const end = (x: { person?: string; new?: boolean; added?: boolean; fail?: string }): void => {
      const now = this.now();
      this.store.append(RELAY_OWNER, SSO, nextId("ssodone"), (_d, prev, id) => sealed({ id, h, ...x, at: now } as Record<string, JsonValue>, prev));
      this.ssoMoved(h);
    };
    if (r.person !== undefined) {
      if (known !== undefined && known !== r.person) { end({ fail: "login.taken" }); return fail(409, "login.taken"); }
      if (known === undefined) this.bind(r.person, a, key, who.shown);
      end({ person: r.person, added: true });
      return { ok: true, person: r.person, new: false, added: true };
    }
    let person = known, fresh = false;
    if (person === undefined && who.emailVerified && who.email !== undefined) {
      const e: Address = { kind: "email", value: who.email };
      person = this.personByKey(keyOf("email", hashAddress(e, this.salt())));
    }
    if (person === undefined) { person = this.newPerson(undefined); fresh = true; }
    if (known === undefined) this.bind(person, a, key, who.shown);
    end({ person, ...(fresh ? { new: true } : {}) });
    return { ok: true, person, new: fresh, added: false };
  }

  /** The account refused, or asking it failed: the waiting client is told why. */
  ssoFail(h: string, code: string): void {
    const r = this.ssoOf(h);
    if (r === undefined || r.done !== undefined) return;
    const now = this.now();
    this.store.append(RELAY_OWNER, SSO, nextId("ssodone"), (_d, prev, id) => sealed({ id, h, fail: code, at: now }, prev));
    this.ssoMoved(h);
  }

  /** The client with the secret asks where its sign-in stands; once it ended, it takes it — a person's token, named for the device — once. */
  ssoCheck(body: unknown): Result<{ state: SsoState; kind?: SsoKind; token?: string; person?: string; new?: boolean; fail?: string }> {
    const o = obj(body) ?? {};
    const secret = str(o["secret"]);
    if (secret === undefined || secret.length < 32) return fail(400, "sso.bad");
    const h = ssoHash(secret);
    const r = this.ssoOf(h);
    if (r === undefined || r.taken) return { ok: true, state: "none" };
    if (r.done === undefined) return { ok: true, state: r.kind !== undefined ? "opened" : "waiting", ...(r.kind !== undefined ? { kind: r.kind } : {}) };
    const now = this.now();
    this.store.append(RELAY_OWNER, SSO, nextId("ssotaken"), (_d, prev, id) => sealed({ id, h, at: now }, prev));
    const kind = r.kind !== undefined ? { kind: r.kind } : {};
    if (r.done.fail !== undefined) return { ok: true, state: "failed", fail: r.done.fail, ...kind };
    if (r.done.added === true) return { ok: true, state: "added", ...kind };
    const person = r.done.person!;
    const { token, record } = issueToken(this.store, { speaker: `person:${person}`, scope: "person", by: "login", at: now });
    this.nameDevice(person, record.id, o["device"]);
    return { ok: true, state: "done", token, person, new: r.done.new === true, ...kind };
  }

  // --- the account (architecture §3.1) ---

  /** The person's ways in, oldest first; a number from before the login index, if it is still theirs. */
  methodsOf(person: string): Method[] {
    const out = new Map<string, Method>();
    for (const b of this.store.read(RELAY_OWNER, peopleDoc(person)).blocks) {
      const key = str(b.value["key"]), kind = b.value["kind"];
      if (b.id === "person" && typeof b.value["phone"] === "string") {
        const old = keyOf("phone", b.value["phone"]);
        if (this.personByKey(old) === person) out.set(old, { id: old, kind: "phone", shown: "••••", at: str(b.value["at"]) ?? "" });
      } else if (/^bind-\d+$/.test(b.id) && key !== undefined && (kind === "email" || kind === "phone" || isSsoKind(kind))) out.set(key, { id: key, kind, shown: str(b.value["shown"]) ?? "", at: str(b.value["at"]) ?? "" });
      else if (/^unbind-\d+$/.test(b.id) && key !== undefined) out.delete(key);
    }
    return [...out.values()];
  }

  methods(by: TokenRecord): Result<{ methods: Method[] }> {
    const person = this.onlyPerson(by);
    return typeof person === "string" ? { ok: true, methods: this.methodsOf(person) } : person;
  }

  /** A code sent to an address the person adds as one more way in; an address that is already someone else's is refused before any code. */
  startMethod(by: TokenRecord, body: unknown, ip?: string): Result<{ sent: true; to: string; from: string; code?: string }> {
    const person = this.onlyPerson(by);
    if (typeof person !== "string") return person;
    const sent = this.sendCode({ lang: this.languageOf(person), ...(obj(body) ?? {}) }, ip, (key) => { const owner = this.personByKey(key); return owner !== undefined && owner !== person ? fail(409, "login.taken") : undefined; });
    if (isFail(sent)) return sent;
    return { ok: true, sent: true, to: maskAddress(sent.a), from: this.mailFrom, ...(sent.shown !== undefined ? { code: sent.shown } : {}) };
  }

  /** The code checked: the address is one more of the person's ways in; already theirs, it stays as it was; someone else's, refused. */
  addMethod(by: TokenRecord, body: unknown): Result<{ methods: Method[] }> {
    const person = this.onlyPerson(by);
    if (typeof person !== "string") return person;
    const s = this.spendCode(obj(body) ?? {});
    if (isFail(s)) return s;
    const owner = this.personByKey(s.key);
    if (owner !== undefined && owner !== person) return fail(409, "login.taken");
    if (owner === undefined) this.bind(person, s.a, s.key);
    this.keepReach(person, s.a, s.key);
    return { ok: true, methods: this.methodsOf(person) };
  }

  /** One way in taken off; the last one stays, so the person can always get back in. */
  removeMethod(by: TokenRecord, key: string): Result<{ methods: Method[] }> {
    const person = this.onlyPerson(by);
    if (typeof person !== "string") return person;
    const methods = this.methodsOf(person);
    if (!methods.some((m) => m.id === key)) return fail(404, "login.missing");
    if (methods.length <= 1) return fail(409, "login.last");
    const now = this.now();
    this.store.append(RELAY_OWNER, LOGINS, nextId("unbind"), (_d, prev, id) => sealed({ id, key, person, at: now }, prev));
    this.store.append(RELAY_OWNER, peopleDoc(person), nextId("unbind"), (_d, prev, id) => sealed({ id, key, at: now }, prev));
    return { ok: true, methods: this.methodsOf(person) };
  }

  /** The tokens issued under one, and under those, every one not revoked. */
  private under(live: readonly TokenRecord[], id: string): TokenRecord[] {
    return live.filter((t) => t.by === id).flatMap((t) => [t, ...this.under(live, t.id)]);
  }

  /** Where the person is signed in: the one asking first, then the newest; each with the name it gave and the avatars the agents it attached play. */
  devicesOf(by: TokenRecord): Result<{ devices: Device[] }> {
    const person = this.onlyPerson(by);
    if (typeof person !== "string") return person;
    const live = liveTokens(this.store);
    const names = new Map<string, string>();
    for (const b of this.store.read(RELAY_OWNER, peopleDoc(person)).blocks) if (/^device-\d+$/.test(b.id)) names.set(str(b.value["token"]) ?? "", str(b.value["name"]) ?? "");
    const devices = live.filter((t) => t.by === "login" && t.speaker === `person:${person}`).map((t): Device => {
      const played = new Set<string>();
      for (const x of this.under(live, t.id)) { const w = parseWho(x.speaker); if (x.scope === "avatar" && w?.kind === "avatar") played.add(w.id); }
      return { id: t.id, name: names.get(t.id) ?? "", at: t.at, current: t.id === by.id, avatars: [...played].map((a) => this.card(a)).filter((c): c is AvatarCard => c !== undefined) };
    });
    devices.sort((a, b) => (a.current !== b.current ? (a.current ? -1 : 1) : a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    return { ok: true, devices };
  }

  /** Each sign-in's token and every token under it revoked; how many. */
  private signOut(ids: readonly string[]): number {
    const live = liveTokens(this.store), now = this.now();
    let n = 0;
    for (const id of ids) for (const t of [id, ...this.under(live, id).map((x) => x.id)]) if (revokeToken(this.store, t, now)) n++;
    return n;
  }

  /** Signed out on one device of the person's: its sign-in and the avatars' tokens its agents held. */
  revokeDevice(by: TokenRecord, id: string): Result<{ revoked: number }> {
    const person = this.onlyPerson(by);
    if (typeof person !== "string") return person;
    if (!liveTokens(this.store).some((t) => t.id === id && t.by === "login" && t.speaker === `person:${person}`)) return fail(404, "device.missing");
    return { ok: true, revoked: this.signOut([id]) };
  }

  /** Signed out everywhere but on the device asking. */
  revokeOthers(by: TokenRecord): Result<{ revoked: number }> {
    const person = this.onlyPerson(by);
    if (typeof person !== "string") return person;
    return { ok: true, revoked: this.signOut(liveTokens(this.store).filter((t) => t.by === "login" && t.speaker === `person:${person}` && t.id !== by.id).map((t) => t.id)) };
  }

  /** Signed out on the device asking: its own token and every one under it. */
  logout(by: TokenRecord): Result<{ revoked: number }> {
    if (this.personOf(by) === undefined) return fail(403, "person.only");
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

  // --- the person ---

  /** The person a person's token stands for; undefined for any other token. */
  personOf(by: TokenRecord): string | undefined {
    if (by.scope !== "person" && by.scope !== "device") return undefined;
    const w = parseWho(by.speaker);
    return w?.kind === "person" ? w.id : undefined;
  }

  private onlyPerson(by: TokenRecord): string | Fail {
    const person = by.scope === "person" ? this.personOf(by) : undefined;
    return person ?? fail(403, "person.only");
  }

  /** The person's language (spec §7.6): the latest chosen, else the one they first logged in with. */
  languageOf(person: string): Lang {
    let lang: Lang = DEFAULT_LANG;
    for (const b of this.store.read(RELAY_OWNER, peopleDoc(person)).blocks) {
      const v = b.value["lang"];
      if ((b.id === "person" || /^lang-\d+$/.test(b.id)) && isLang(v)) lang = v;
    }
    return lang;
  }

  setLanguage(by: TokenRecord, body: unknown): Result<{ lang: Lang }> {
    const person = this.onlyPerson(by);
    if (typeof person !== "string") return person;
    const lang = obj(body)?.["lang"];
    if (!isLang(lang)) return fail(400, "lang.unknown");
    this.store.append(RELAY_OWNER, peopleDoc(person), nextId("lang"), (_d, prev, id) => sealed({ id, lang, at: this.now() }, prev));
    return { ok: true, lang };
  }

  /** The person's default name (spec §6.5), the latest set; null clears it. It is only ever offered as a suggestion. */
  defaultNameOf(person: string): string | undefined {
    let name: string | undefined;
    for (const b of this.store.read(RELAY_OWNER, peopleDoc(person)).blocks) if (/^default-\d+$/.test(b.id)) name = str(b.value["name"]);
    return name;
  }

  setDefaultName(by: TokenRecord, body: unknown): Result<{ name?: string }> {
    const person = this.onlyPerson(by);
    if (typeof person !== "string") return person;
    const v = obj(body)?.["name"];
    if (v !== null) { const f = nameFault(v); if (f !== undefined) return refuse(400, f); }
    const name = v === null ? null : (v as string).trim();
    this.store.append(RELAY_OWNER, peopleDoc(person), nextId("default"), (_d, prev, id) => sealed({ id, name, at: this.now() }, prev));
    return name === null ? { ok: true } : { ok: true, name };
  }

  // --- 底子 (S27, design §8.2) ---
  // Kept with the person, beside their language and default name: the person
  // and the service read it, nobody else. An avatar's agent reads only the kept
  // entries given to that avatar, and may leave one waiting for the person's yes.

  /** The person's 底子 as it stands, the waiting entries with it. */
  baseOfPerson(person: string): BaseItem[] { return baseOf(this.store.read(RELAY_OWNER, peopleDoc(person)).blocks); }

  /** What the token may read: the person, everything; an avatar's agent, the kept entries given to that avatar. */
  baseFor(by: TokenRecord): Result<{ base: BaseItem[] }> {
    if (by.scope === "person") { const person = this.onlyPerson(by); return typeof person === "string" ? { ok: true, base: this.baseOfPerson(person) } : person; }
    const a = this.acting(by, undefined);
    if (isFail(a)) return a;
    const person = this.ownerOf(a.avatar);
    return { ok: true, base: person === undefined ? [] : baseFor(this.baseOfPerson(person), a.avatar) };
  }

  /**
   * An entry made: by the person, kept, given to the avatars they name (their own only); by an avatar's agent, waiting
   * for the person's yes, given to that avatar alone, with who said it.
   */
  addBase(by: TokenRecord, body: unknown): Result<{ item: BaseItem }> {
    const o = obj(body) ?? {};
    const f = baseFault(o["label"], o["text"]);
    if (f !== undefined) return fail(400, f.code, f.params);
    let person: string, given: string[], state: "kept" | "pending", maker: string, who: string | undefined;
    if (by.scope === "person") {
      const p = this.onlyPerson(by);
      if (typeof p !== "string") return p;
      const mine = new Set(this.avatarsOf(p).map((x) => x.id));
      given = Array.isArray(o["for"]) ? [...new Set((o["for"] as unknown[]).filter((x): x is string => typeof x === "string"))] : [];
      if (given.length === 0 || !given.every((x) => mine.has(x))) return fail(400, "base.for");
      person = p; state = "kept"; maker = "person";
    } else {
      const a = this.acting(by, undefined);
      if (isFail(a)) return a;
      const p = this.ownerOf(a.avatar);
      if (p === undefined) return fail(403, "avatar.notYours");
      if (this.baseOfPerson(p).filter((x) => x.state === "pending").length >= BASE_PENDING_MAX) return fail(429, "base.waiting", { max: BASE_PENDING_MAX });
      person = p; given = [a.avatar]; state = "pending"; maker = a.avatar; who = str(o["who"])?.trim().slice(0, 40);
    }
    if (this.baseOfPerson(person).length >= BASE_MAX) return fail(409, "base.full", { max: BASE_MAX });
    const label = (str(o["label"]) ?? "").trim(), text = (o["text"] as string).trim();
    const made = this.store.append(RELAY_OWNER, peopleDoc(person), nextId("base"), (_d, prev, id) => sealed({ id, label, text, for: given, state, by: maker, ...(who !== undefined && who !== "" ? { who } : {}), at: this.now() }, prev));
    return { ok: true, item: baseOf([made.block]).at(0)! };
  }

  /** The person changes an entry: new words, other avatars of theirs, 删 (`drop`); a waiting one 记下 (`keep: true`) or 不记 (`keep: false`). */
  setBase(by: TokenRecord, item: string, body: unknown): Result<{ base: BaseItem[] }> {
    const person = this.onlyPerson(by);
    if (typeof person !== "string") return person;
    const it = this.baseOfPerson(person).find((x) => x.id === item);
    if (it === undefined) return fail(404, "base.missing");
    const o = obj(body) ?? {};
    const change: Record<string, JsonValue> = {};
    if (o["text"] !== undefined || o["label"] !== undefined) {
      const f = baseFault(o["label"] ?? it.label, o["text"] ?? it.text);
      if (f !== undefined) return fail(400, f.code, f.params);
      if (typeof o["text"] === "string") change["text"] = o["text"].trim();
      if (typeof o["label"] === "string") change["label"] = o["label"].trim();
    }
    if (o["for"] !== undefined) {
      const mine = new Set(this.avatarsOf(person).map((x) => x.id));
      const given = Array.isArray(o["for"]) ? [...new Set((o["for"] as unknown[]).filter((x): x is string => typeof x === "string"))] : [];
      if (given.length === 0 || !given.every((x) => mine.has(x))) return fail(400, "base.for");
      change["for"] = given;
    }
    if (o["drop"] === true) change["drop"] = true;
    if (typeof o["keep"] === "boolean") { if (it.state !== "pending") return fail(409, "base.kept"); change["keep"] = o["keep"]; }
    if (Object.keys(change).length === 0) return fail(400, "base.change");
    this.store.append(RELAY_OWNER, peopleDoc(person), nextId("baseset"), (_d, prev, id) => sealed({ id, item, ...change, at: this.now() }, prev));
    return { ok: true, base: this.baseOfPerson(person) };
  }

  // --- avatars ---

  /** The avatar's public card: its id and its latest name. */
  card(avatar: string): AvatarCard | undefined {
    if (!AVATAR_ID.test(avatar)) return undefined;
    let name: string | undefined;
    for (const b of this.store.read(avatar, "avatar.geml").blocks) if (b.id === "avatar" || /^name-\d+$/.test(b.id)) name = str(b.value["name"]) ?? name;
    if (name === undefined) return undefined;
    return { id: avatar, name };
  }

  /** The person's avatars, oldest first. */
  avatarsOf(person: string): AvatarCard[] {
    const out: AvatarCard[] = [];
    for (const b of this.store.read(RELAY_OWNER, peopleDoc(person)).blocks) {
      if (!/^avatar-\d+$/.test(b.id)) continue;
      const c = this.card(str(b.value["avatar"]) ?? "");
      if (c !== undefined) out.push(c);
    }
    return out;
  }

  /** The person behind an avatar: the relay's own lookup, never answered to a client (§5 rule 4). */
  private ownerOf(avatar: string): string | undefined {
    const b = this.store.read(RELAY_OWNER, OWNERS).blocks.find((x) => x.id === `owner-${avatar}`);
    return b === undefined ? undefined : str(b.value["person"]);
  }

  /** A new avatar of the person (spec §6.4, §6.5): the name given when they joined, else a random one in their language; the default name is never used unasked. */
  growAvatar(by: TokenRecord, body: unknown): Result<{ avatar: AvatarCard }> {
    const person = this.onlyPerson(by);
    if (typeof person !== "string") return person;
    return this.grow(person, obj(body)?.["name"]);
  }

  /** The person's first avatar, with the name they gave when they first signed in (architecture §3.2); after it, avatars grow by joining or making a group (spec §6.4). */
  firstAvatar(by: TokenRecord, body: unknown): Result<{ avatar: AvatarCard }> {
    const person = this.onlyPerson(by);
    if (typeof person !== "string") return person;
    if (this.avatarsOf(person).length > 0) return fail(409, "avatar.notFirst");
    return this.grow(person, obj(body)?.["name"] ?? "");
  }

  private grow(person: string, given: unknown): Result<{ avatar: AvatarCard }> {
    if (given !== undefined) { const f = nameFault(given); if (f !== undefined) return refuse(400, f); }
    const name = typeof given === "string" ? given.trim() : randomName(this.rand, this.languageOf(person));
    const avatar = `a-${hex(5)}`, now = this.now();
    appendSealed(this.store, RELAY_OWNER, OWNERS, `owner-${avatar}`, { person, at: now });
    this.store.append(RELAY_OWNER, peopleDoc(person), nextId("avatar"), (_d, prev, id) => sealed({ id, avatar, at: now }, prev));
    const made = appendSealed(this.store, avatar, "avatar.geml", "avatar", { name, at: now });
    this.emit(avatar, "avatar.geml", made.block);
    return { ok: true, avatar: { id: avatar, name } };
  }

  private onlyOwner(by: TokenRecord, avatar: string): Fail | undefined {
    const person = this.onlyPerson(by);
    if (typeof person !== "string") return person;
    return this.ownerOf(avatar) === person ? undefined : fail(403, "avatar.notYours");
  }

  /** A new name for one of the person's avatars; only that avatar's card changes. */
  rename(by: TokenRecord, avatar: string, body: unknown): Result<{ avatar: AvatarCard }> {
    const refused = this.onlyOwner(by, avatar);
    if (refused !== undefined) return refused;
    const v = obj(body)?.["name"];
    const f = nameFault(v);
    if (f !== undefined) return refuse(400, f);
    const name = (v as string).trim();
    const a = this.store.append(avatar, "avatar.geml", nextId("name"), (_d, prev, id) => sealed({ id, name, at: this.now() }, prev));
    this.emit(avatar, "avatar.geml", a.block);
    return { ok: true, avatar: { id: avatar, name } };
  }

  /** The avatar's rules (spec §8.1): the defaults, then each change in turn. */
  rulesOf(avatar: string): Rules {
    let rules = DEFAULT_RULES;
    for (const b of this.store.read(avatar, "rules.geml").blocks) {
      if (!/^rules-\d+$/.test(b.id)) continue;
      const next = withRules(rules, { mark: b.value["mark"], borrow: b.value["borrow"] });
      if (!("code" in next)) rules = next;
    }
    return rules;
  }

  setRules(by: TokenRecord, avatar: string, body: unknown): Result<{ rules: Rules }> {
    const refused = this.onlyOwner(by, avatar);
    if (refused !== undefined) return refused;
    const next = withRules(this.rulesOf(avatar), body);
    if ("code" in next) return refuse(400, next);
    this.store.append(avatar, "rules.geml", nextId("rules"), (_d, prev, id) => sealed({ id, mark: next.mark, borrow: next.borrow, at: this.now() }, prev));
    return { ok: true, rules: next };
  }

  // --- tokens ---

  /** One of the person's avatars' token, for an agent that plays it on one of the person's machines: it speaks as the avatar, `by` an agent. */
  issueAvatar(by: TokenRecord, avatar: string): Result<Issued> {
    const refused = this.onlyOwner(by, avatar);
    if (refused !== undefined) return refused;
    return { ok: true, ...issueToken(this.store, { speaker: avatarSpeaker(avatar), scope: "avatar", by: by.id, at: this.now() }) };
  }

  /** A device's token: the agent the person attached on one machine, which may only ask for an avatar's token once the person agrees (spec §6.3). */
  issueDevice(by: TokenRecord): Result<Issued> {
    const person = this.onlyPerson(by);
    if (typeof person !== "string") return person;
    return { ok: true, ...issueToken(this.store, { speaker: by.speaker, scope: "device", by: by.id, at: this.now() }) };
  }

  /** The avatar a token acts as and how: an avatar's token is that avatar's agent; a person's token names one of the person's avatars in `as`. */
  private acting(by: TokenRecord, as: unknown): { avatar: string; by: By } | Fail {
    if (by.scope === "avatar") {
      const w = parseWho(by.speaker);
      if (w?.kind !== "avatar") return fail(403, "token.wrong");
      if (as !== undefined && as !== w.id) return fail(403, "token.ownAvatar");
      return { avatar: w.id, by: "agent" };
    }
    if (by.scope === "person") {
      if (typeof as !== "string" || !AVATAR_ID.test(as)) return fail(400, "as.required");
      const person = this.personOf(by);
      if (person === undefined || this.ownerOf(as) !== person) return fail(403, "avatar.notYours");
      return { avatar: as, by: "person" };
    }
    return fail(403, "token.mute");
  }

  /** The avatars a token reads for: a person's are all theirs, an avatar's is itself; a device's reads nothing. */
  private mine(by: TokenRecord): string[] {
    const w = parseWho(by.speaker);
    if (by.scope === "avatar") return w?.kind === "avatar" ? [w.id] : [];
    if (by.scope !== "person" || w?.kind !== "person") return [];
    return this.avatarsOf(w.id).map((a) => a.id);
  }

  // --- venues ---

  /** A venue as its blocks say, in order: who is in (in by `member-N`, out by `leave-N`) and its 群主 (the maker, then each `owner-N`). */
  private venueState(owner: string, venue: string): { kind: VenueKind; name: string; members: string[]; keeper: string; former: string[] } | undefined {
    if (!AVATAR_ID.test(owner) || !VENUE_ID.test(venue)) return undefined;
    const d = this.store.read(owner, venueDoc(venue));
    const meta = d.blocks.find((b) => b.id === "venue")?.value;
    const kind = str(meta?.["kind"]);
    if (meta === undefined || (kind !== "group" && kind !== "dm")) return undefined;
    const members: string[] = [];
    let keeper = owner;
    for (const b of d.blocks) {
      const w = parseWho(str(b.value["avatar"]) ?? "");
      if (w?.kind !== "avatar") continue;
      if (/^member-\d+$/.test(b.id) && !members.includes(w.id)) members.push(w.id);
      else if (/^leave-\d+$/.test(b.id)) { const i = members.indexOf(w.id); if (i >= 0) members.splice(i, 1); }
      else if (/^owner-\d+$/.test(b.id)) keeper = w.id;
    }
    const former = d.blocks.filter((b) => /^leave-\d+$/.test(b.id)).map((b) => parseWho(str(b.value["avatar"]) ?? "")).filter((w) => w?.kind === "avatar").map((w) => w!.id).filter((x, i, all) => !members.includes(x) && all.indexOf(x) === i);
    return { kind, name: str(meta["name"]) ?? "", members, keeper, former };
  }

  /** The venue with its members' cards; a two-person talk is named after the other side, as the viewer's avatar sees it. */
  venueView(owner: string, venue: string, as?: string): VenueView | undefined {
    const s = this.venueState(owner, venue);
    if (s === undefined) return undefined;
    const members = s.members.map((m) => this.card(m)).filter((c): c is AvatarCard => c !== undefined);
    const name = s.kind === "dm" ? (members.find((m) => m.id !== as)?.name ?? s.name) : s.name;
    const former = s.former.map((m) => this.card(m)).filter((c): c is AvatarCard => c !== undefined);
    return { owner, id: venue, kind: s.kind, name, members, keeper: s.keeper, former };
  }

  /** The avatar into the venue: a member block in the venue, a join block in the avatar's own list of venues. */
  private join(owner: string, venue: string, avatar: string, by: string): void {
    const now = this.now();
    const m = this.store.append(owner, venueDoc(venue), nextId("member"), (_d, prev, id) => sealed({ id, avatar: avatarSpeaker(avatar), by, at: now }, prev));
    this.emit(owner, venueDoc(venue), m.block);
    const j = this.store.append(avatar, "joined.geml", nextId("join"), (_d, prev, id) => sealed({ id, owner, venue, at: now }, prev));
    this.emit(avatar, "joined.geml", j.block);
  }

  /** The venues the avatar is in, from its own list. */
  joinedOf(avatar: string): { owner: string; venue: string }[] {
    const out: { owner: string; venue: string }[] = [];
    for (const b of this.store.read(avatar, "joined.geml").blocks) {
      const owner = str(b.value["owner"]), venue = str(b.value["venue"]);
      if (owner !== undefined && venue !== undefined && !out.some((x) => x.owner === owner && x.venue === venue)) out.push({ owner, venue });
    }
    return out.filter((x) => this.venueState(x.owner, x.venue)?.members.includes(avatar) === true);
  }

  /** A group under the avatar that makes it (spec §7.1), the avatar its first member and its owner (群主). A person may make it as a new avatar, `avatar: {name}` (no name, a random one): that is how a first avatar grows for someone who came in by no link (§6.4). */
  createGroup(by: TokenRecord, body: unknown): Result<{ venue: VenueView }> {
    const o = obj(body) ?? {};
    const name = str(o["name"])?.trim();
    if (name === undefined || name === "") return fail(400, "group.name");
    if ([...name].length > GROUP_NAME_MAX) return fail(400, "group.nameTooLong", { max: GROUP_NAME_MAX });
    let as = o["as"];
    const fresh = obj(o["avatar"]);
    const person = by.scope === "person" ? this.personOf(by) : undefined;
    if (as === undefined && fresh !== undefined && person !== undefined) {
      const grown = this.grow(person, fresh["name"]);
      if (isFail(grown)) return grown;
      as = grown.avatar.id;
    }
    const a = this.acting(by, as);
    if (isFail(a)) return a;
    const venue = `g-${hex(5)}`;
    const made = appendSealed(this.store, a.avatar, venueDoc(venue), "venue", { kind: "group", name, by: avatarSpeaker(a.avatar), at: this.now() });
    this.emit(a.avatar, venueDoc(venue), made.block);
    this.join(a.avatar, venue, a.avatar, avatarSpeaker(a.avatar));
    return { ok: true, venue: this.venueView(a.avatar, venue)! };
  }

  /** Another avatar into a group, by its owner; links (plan Q) are how everyone else comes in. */
  addMember(by: TokenRecord, owner: string, venue: string, body: unknown): Result<{ venue: VenueView }> {
    const s = this.venueState(owner, venue);
    if (s === undefined) return fail(404, "group.missing");
    if (s.kind !== "group") return fail(400, "dm.noAdd");
    const a = this.acting(by, obj(body)?.["as"]);
    if (isFail(a)) return a;
    if (a.avatar !== s.keeper) return fail(403, "group.ownerOnly");
    const who = str(obj(body)?.["avatar"]);
    if (who === undefined || this.card(who) === undefined) return fail(404, "avatar.missing");
    if (!s.members.includes(who)) this.join(owner, venue, who, avatarSpeaker(a.avatar));
    return { ok: true, venue: this.venueView(owner, venue)! };
  }

  /** The two-person talk between the acting avatar and another it shares a group with (spec §6.6): one per pair, under the smaller id. */
  openDm(by: TokenRecord, body: unknown): Result<{ venue: VenueView }> {
    const o = obj(body) ?? {};
    const a = this.acting(by, o["as"]);
    if (isFail(a)) return a;
    const other = str(o["with"]);
    if (other === undefined || other === a.avatar || this.card(other) === undefined) return fail(404, "avatar.missing");
    const shared = this.joinedOf(a.avatar).some((v) => this.venueState(v.owner, v.venue)?.kind === "group" && this.venueState(v.owner, v.venue)?.members.includes(other) === true);
    if (!shared) return fail(403, "dm.sharedGroup");
    const [first, second] = [a.avatar, other].sort() as [string, string];
    const venue = `d-${createHash("sha256").update(`${first}:${second}`, "utf8").digest("hex").slice(0, 10)}`;
    const made = appendSealed(this.store, first, venueDoc(venue), "venue", { kind: "dm", by: avatarSpeaker(a.avatar), at: this.now() });
    if (!made.existed) {
      this.emit(first, venueDoc(venue), made.block);
      this.join(first, venue, first, avatarSpeaker(a.avatar));
      this.join(first, venue, second, avatarSpeaker(a.avatar));
    }
    return { ok: true, venue: this.venueView(first, venue, a.avatar)! };
  }

  /** A message in a venue the acting avatar is in (spec §7.2): stamped with the avatar and `by`; a client's id makes a resend a no-op. */
  say(by: TokenRecord, owner: string, venue: string, body: unknown): Result<{ message: Record<string, JsonValue>; existed: boolean }> {
    const o = obj(body) ?? {};
    const a = this.acting(by, o["as"]);
    if (isFail(a)) return a;
    const s = this.venueState(owner, venue);
    if (s === undefined) return fail(404, "group.missing");
    if (!s.members.includes(a.avatar)) return fail(403, "venue.notMember");
    const text = str(o["text"]);
    if (text === undefined || text.trim() === "") return fail(400, "message.empty");
    if ([...text].length > TEXT_MAX) return fail(400, "message.tooLong", { max: TEXT_MAX });
    const own = str(o["id"]);
    if (own !== undefined && (!BLOCK_ID.test(own) || RESERVED.test(own))) return fail(400, "message.badId");
    const doc = venueDoc(venue);
    const replyTo = str(o["replyTo"]);
    if (replyTo !== undefined && !this.store.read(owner, doc).blocks.some((b) => b.id === replyTo)) return fail(400, "message.badReply");
    // Avatars calling avatars (§5 rule 7): an agent's line carries its hops, one more than the agent's line it answers.
    const hops = o["hops"];
    if (hops !== undefined && (a.by !== "agent" || typeof hops !== "number" || !Number.isInteger(hops) || hops < 0 || hops > 9)) return fail(400, "message.hops");
    const now = this.now();
    const made = this.store.append(owner, doc, own !== undefined ? () => own : nextId("msg"), (_d, prev, id) => sealed({ id, speaker: avatarSpeaker(a.avatar), by: a.by, text: normalizeText(text), at: now, ...(replyTo !== undefined ? { replyTo } : {}), ...(typeof hops === "number" ? { hops } : {}) }, prev));
    if (!made.existed) { this.emit(owner, doc, made.block); this.remind(owner, venue, made.block.value); }
    return { ok: true, message: made.block.value, existed: made.existed };
  }

  /** Every venue of every avatar of the person, each with the avatar that is in it. */
  venuesOf(person: string): MyVenue[] {
    const out: MyVenue[] = [];
    for (const a of this.avatarsOf(person)) {
      for (const v of this.joinedOf(a.id)) {
        const view = this.venueView(v.owner, v.venue, a.id);
        if (view === undefined) continue;
        const line = this.store.read(v.owner, venueDoc(v.venue)).blocks.filter((b) => typeof b.value["text"] === "string" && typeof b.value["speaker"] === "string").at(-1);
        const said = line === undefined ? undefined : parseWho(str(line.value["speaker"]) ?? "");
        const who = said?.kind === "avatar" ? ([...view.members, ...view.former].find((m) => m.id === said.id)?.name ?? said.id) : "";
        out.push({ ...view, as: a.id, ...(line !== undefined ? { last: { who, text: str(line.value["text"]) ?? "", at: str(line.value["at"]) ?? "" } } : {}) });
      }
    }
    return out;
  }

  // --- reading ---

  /** A document as the token may see it: an avatar's card is anyone's; a venue is its members', a message's `by` left out where its avatar does not mark (§5 rule 1); anything else under an avatar is that avatar's and its person's. */
  read(by: TokenRecord, owner: string, doc: string): Result<{ blocks: Visible[] }> {
    if (!AVATAR_ID.test(owner) || !DOC.test(doc)) return fail(404, "doc.missing");
    const d = this.store.read(owner, doc);
    if (!d.exists) return fail(404, "doc.missing");
    if (doc === "avatar.geml") return { ok: true, blocks: d.blocks.map((b) => ({ id: b.id, value: b.value })) };
    const mine = this.mine(by);
    const v = VENUE_DOC.exec(doc);
    if (v !== null) {
      const s = this.venueState(owner, v[1]!);
      if (s === undefined || !mine.some((m) => s.members.includes(m))) return fail(403, "doc.denied");
      const marks = new Map<string, boolean>();
      const marked = (avatar: string): boolean => { if (!marks.has(avatar)) marks.set(avatar, this.rulesOf(avatar).mark); return marks.get(avatar)!; };
      return { ok: true, blocks: d.blocks.map((b) => this.shown(b, mine, marked)) };
    }
    if (mine.includes(owner)) return { ok: true, blocks: d.blocks.map((b) => ({ id: b.id, value: b.value })) };
    return fail(403, "doc.denied");
  }

  /** A venue block as a member sees it: a message's `by` left out unless the viewer is the avatar that said it, or that avatar marks. */
  private shown(b: DataBlock, mine: readonly string[], marked: (avatar: string) => boolean): Visible {
    const w = parseWho(str(b.value["speaker"]) ?? "");
    if (w?.kind !== "avatar" || !("by" in b.value) || mine.includes(w.id) || marked(w.id)) return { id: b.id, value: b.value };
    const { by: _by, ...rest } = b.value;
    return { id: b.id, value: rest };
  }

  // --- links and joining (spec §6) ---

  /** The group's link rules (spec §6.1): the defaults, then each change the owner made. */
  linkRulesOf(owner: string, venue: string): LinkRules {
    let rules = DEFAULT_LINK_RULES;
    for (const b of this.store.read(owner, venueDoc(venue)).blocks) {
      if (!/^link-rules-\d+$/.test(b.id)) continue;
      rules = withLinkRules(rules, { forward: b.value["forward"], approve: b.value["approve"] }) ?? rules;
    }
    return rules;
  }

  /** The group's current code: the last one made for it, kept under the relay's own `links/`. */
  private currentCode(venue: string): string | undefined {
    const codes = this.store.read(RELAY_OWNER, `links/${venue}.geml`).blocks.filter((b) => /^code-\d+$/.test(b.id));
    return str(codes[codes.length - 1]?.value["code"]);
  }

  private linkOf(code: string): { code: string; owner: string; venue: string; expires: string } | undefined {
    if (!LINK_CODE.test(code)) return undefined;
    const v = this.store.read(RELAY_OWNER, `links/${code}.geml`).blocks.find((b) => b.id === "link")?.value;
    const owner = str(v?.["owner"]), venue = str(v?.["venue"]), expires = str(v?.["expires"]);
    return owner === undefined || venue === undefined || expires === undefined ? undefined : { code, owner, venue, expires };
  }

  /** A new code for the group, made current; the one before it stops (spec §6.1). */
  private newLink(owner: string, venue: string, by: string): { code: string; expires: string } {
    const now = this.now(), expires = expiresAt(now);
    for (;;) {
      const code = makeCode(randomBytes(8));
      if (appendSealed(this.store, RELAY_OWNER, `links/${code}.geml`, "link", { owner, venue, by, at: now, expires }).existed) continue;
      this.store.append(RELAY_OWNER, `links/${venue}.geml`, nextId("code"), (_d, prev, id) => sealed({ id, code, at: now }, prev));
      return { code, expires };
    }
  }

  /** A group the acting avatar is in, as its owner or a member. */
  private inGroup(by: TokenRecord, owner: string, venue: string, as: unknown): { avatar: string; isOwner: boolean } | Fail {
    const s = this.venueState(owner, venue);
    if (s === undefined) return fail(404, "group.missing");
    if (s.kind !== "group") return fail(400, "link.dm");
    const a = this.acting(by, as);
    if (isFail(a)) return a;
    if (!s.members.includes(a.avatar)) return fail(403, "venue.notMember");
    return { avatar: a.avatar, isOwner: a.avatar === s.keeper };
  }

  /**
   * Out of a group (S19): a member leaves, and the group says so; its 群主 first names who keeps it, and the group says
   * that too; the last one in, and the group is gone with its chat — its links name nothing any more. The avatar's own
   * list loses it, and its 自动回 there goes with it.
   */
  leaveVenue(by: TokenRecord, owner: string, venue: string, body: unknown): Result<{ left: true; gone?: true }> {
    const s = this.venueState(owner, venue);
    if (s === undefined) return fail(404, "group.missing");
    if (s.kind !== "group") return fail(400, "dm.noLeave");
    const o = obj(body) ?? {};
    const a = this.acting(by, o["as"]);
    if (isFail(a)) return a;
    if (!s.members.includes(a.avatar)) return fail(403, "venue.notMember");
    const others = s.members.filter((m) => m !== a.avatar), key = `${owner}/${venue}`, now = this.now();
    const heir = a.avatar === s.keeper && others.length > 0 ? str(o["heir"]) : undefined;
    if (a.avatar === s.keeper && others.length > 0 && (heir === undefined || !others.includes(heir))) return fail(400, "leave.heir");
    if (others.length === 0) this.store.remove(owner, venueDoc(venue));
    else {
      if (heir !== undefined) {
        const k = this.store.append(owner, venueDoc(venue), nextId("owner"), (_d, prev, id) => sealed({ id, avatar: avatarSpeaker(heir), by: avatarSpeaker(a.avatar), at: now }, prev));
        this.emit(owner, venueDoc(venue), k.block);
      }
      const l = this.store.append(owner, venueDoc(venue), nextId("leave"), (_d, prev, id) => sealed({ id, avatar: avatarSpeaker(a.avatar), ...(heir !== undefined ? { heir: avatarSpeaker(heir) } : {}), at: now }, prev));
      this.emit(owner, venueDoc(venue), l.block);
    }
    if (this.autoOf(a.avatar).includes(key)) this.store.append(a.avatar, "auto.geml", nextId("auto"), (_d, prev, id) => sealed({ id, venue: key, on: false, at: now }, prev));
    const j = this.store.append(a.avatar, "joined.geml", nextId("left"), (_d, prev, id) => sealed({ id, owner, venue, left: true, at: now }, prev));
    this.emit(a.avatar, "joined.geml", j.block);
    return others.length === 0 ? { ok: true, left: true, gone: true } : { ok: true, left: true };
  }

  private linkView(code: string, expires: string, rules: LinkRules, by: string): LinkView {
    return { code, expires, path: linkPath(code, { by }), forward: rules.forward, approve: rules.approve };
  }

  /** The group's link for a member to hand out (spec §6.1): its current one, or a new one when there is none or it is past its day; the owner always, the others while forwarding is on. */
  linkFor(by: TokenRecord, owner: string, venue: string, body: unknown): Result<{ link: LinkView }> {
    const g = this.inGroup(by, owner, venue, obj(body)?.["as"]);
    if (isFail(g)) return g;
    const rules = this.linkRulesOf(owner, venue);
    if (!mayHandOut(rules, g.isOwner)) return fail(403, "link.ownerOnly");
    const current = this.linkOf(this.currentCode(venue) ?? "");
    const link = current !== undefined && linkStatus(current, current.code, this.now()) === "ok" ? current : this.newLink(owner, venue, avatarSpeaker(g.avatar));
    return { ok: true, link: this.linkView(link.code, link.expires, rules, g.avatar) };
  }

  /** A new link in place of the current one, by the owner (spec §6.1). */
  rotateLink(by: TokenRecord, owner: string, venue: string, body: unknown): Result<{ link: LinkView }> {
    const g = this.inGroup(by, owner, venue, obj(body)?.["as"]);
    if (isFail(g)) return g;
    if (!g.isOwner) return fail(403, "link.ownerRules");
    const link = this.newLink(owner, venue, avatarSpeaker(g.avatar));
    return { ok: true, link: this.linkView(link.code, link.expires, this.linkRulesOf(owner, venue), g.avatar) };
  }

  /** Forwarding on or off, the owner's approval on or off, by the owner (spec §6.1). */
  setLinkRules(by: TokenRecord, owner: string, venue: string, body: unknown): Result<{ rules: LinkRules }> {
    const g = this.inGroup(by, owner, venue, obj(body)?.["as"]);
    if (isFail(g)) return g;
    if (!g.isOwner) return fail(403, "link.ownerRules");
    const next = withLinkRules(this.linkRulesOf(owner, venue), body);
    if (next === undefined) return fail(400, "link.rules");
    const made = this.store.append(owner, venueDoc(venue), nextId("link-rules"), (_d, prev, id) => sealed({ id, forward: next.forward, approve: next.approve, by: avatarSpeaker(g.avatar), at: this.now() }, prev));
    this.emit(owner, venueDoc(venue), made.block);
    return { ok: true, rules: next };
  }

  /** The link, good: its group's owner and id; missing or stopped, the refusal (spec §7.1 of the transport: a stopped link only says so). */
  private goodLink(code: string): { code: string; owner: string; venue: string; expires: string } | Fail {
    const link = this.linkOf(code);
    if (link === undefined || this.venueState(link.owner, link.venue) === undefined) return fail(404, "link.missing");
    return linkStatus(link, this.currentCode(link.venue), this.now()) === "ok" ? link : fail(410, "link.gone");
  }

  /** The person's avatars with the groups each is in, for picking one (pick.ts). */
  private placed(person: string): { id: string; groups: { venue: string; members: string[] }[] }[] {
    return this.avatarsOf(person).map((a) => ({
      id: a.id,
      groups: this.joinedOf(a.id).map((v) => ({ venue: v.venue, members: this.venueState(v.owner, v.venue)?.members ?? [] })),
    }));
  }

  /** Who brought the newcomer: the member named in the link (`?by=`), else the group's owner. */
  private inviterOf(owner: string, venue: string, by: unknown): string {
    return typeof by === "string" && this.venueState(owner, venue)?.members.includes(by) === true ? by : owner;
  }

  /** What the link's page shows (spec §6.2 step 1): anyone sees the group's name, how many are in it, a few of them, its owner and until when; a person logged in also sees which of their avatars would go in, and every viewer the names offered (§6.5), in their language. */
  linkInfo(code: string, viewer: TokenRecord | undefined, q: { by?: string; call?: string; lang?: Lang } = {}): Result<LinkInfo> {
    const link = this.goodLink(code);
    if (isFail(link)) return link;
    const view = this.venueView(link.owner, link.venue)!;
    const person = viewer === undefined ? undefined : this.personOf(viewer);
    const lang = person !== undefined ? this.languageOf(person) : (q.lang ?? DEFAULT_LANG);
    const call = q.call !== undefined && nameFault(q.call) === undefined ? q.call.trim() : undefined;
    const defaultName = person === undefined ? undefined : this.defaultNameOf(person);
    const info: LinkInfo = {
      group: { id: view.id, name: view.name, count: view.members.length, members: view.members.slice(0, 5) },
      owner: this.card(link.owner),
      expires: link.expires,
      approve: this.linkRulesOf(link.owner, link.venue).approve,
      suggestions: suggestions({ group: view.name, lang, ...(call !== undefined ? { call } : {}), ...(defaultName !== undefined ? { defaultName } : {}) }),
    };
    if (person !== undefined) info.you = { avatars: this.avatarsOf(person), pick: pickAvatar(this.placed(person), link.venue, this.inviterOf(link.owner, link.venue, q.by)) };
    return { ok: true, ...info };
  }

  /**
   * In through a link (spec §6.2, §6.3), with the person's yes: their own
   * token, or the device token of the agent they attached on a machine. The
   * avatar is the one named in `as`; else a new one with the `name` given
   * (`new: true` and no name, a random one); else the one the inviter knows
   * (§6.4), else a new one with a random name. An avatar already in the group is answered as it is. With the
   * owner's approval on, the avatar waits in the owner's requests. A
   * device's answer carries the avatar's token, for the agent that is now
   * its body.
   */
  joinByLink(by: TokenRecord, code: string, body: unknown): Result<Joined> {
    const person = this.personOf(by);
    if (person === undefined) return fail(403, "join.needsPerson");
    const link = this.goodLink(code);
    if (isFail(link)) return link;
    const o = obj(body) ?? {};
    const pick = pickAvatar(this.placed(person), link.venue, this.inviterOf(link.owner, link.venue, o["by"]));
    let avatar: string;
    if (pick.kind === "in") avatar = pick.avatar;
    else if (o["as"] !== undefined) {
      const as = str(o["as"]);
      if (as === undefined || this.ownerOf(as) !== person) return fail(403, "avatar.notYours");
      avatar = as;
    } else if (o["name"] !== undefined || o["new"] === true || pick.kind === "choose") {
      const grown = this.grow(person, o["name"]);
      if (isFail(grown)) return grown;
      avatar = grown.avatar.id;
    } else avatar = pick.avatar;
    const card = this.card(avatar)!;
    const token = by.scope === "device" ? issueToken(this.store, { speaker: avatarSpeaker(avatar), scope: "avatar", by: by.id, at: this.now() }).token : undefined;
    const done = (x: Partial<Joined>): Result<Joined> => ({ ok: true, venue: this.venueView(link.owner, link.venue, avatar)!, avatar: card, already: false, ...x, ...(token !== undefined ? { token } : {}) });
    if (pick.kind === "in") return done({ already: true });
    if (this.linkRulesOf(link.owner, link.venue).approve) {
      // To the group's 群主 now, who may not be its maker (S19); the request names where the group is kept.
      const keeper = this.venueState(link.owner, link.venue)?.keeper ?? link.owner;
      const asked = this.requestsOf(keeper).find((r) => r.venue === link.venue && r.avatar.id === avatar);
      if (asked !== undefined) return done({ pending: asked.id });
      const made = this.store.append(keeper, "requests.geml", nextId("request"), (_d, prev, id) => sealed({ id, owner: link.owner, venue: link.venue, avatar: avatarSpeaker(avatar), link: code, at: this.now() }, prev));
      this.emit(keeper, "requests.geml", made.block);
      // The owner's 答应事情 (spec §6.1, §7.3): the newcomer at the door, in the owner's person's language.
      const lang = this.languageOf(this.ownerOf(keeper) ?? "");
      this.askFor(keeper, { kind: "promise", summary: say("need.join.summary", lang, { name: card.name, group: this.venueState(link.owner, link.venue)?.name ?? "" }), options: [{ label: say("need.join.yes", lang) }, { label: say("need.join.no", lang) }], venue: { owner: link.owner, id: link.venue }, request: made.block.id });
      return done({ pending: made.block.id });
    }
    this.join(link.owner, link.venue, avatar, avatarSpeaker(avatar));
    this.store.append(RELAY_OWNER, `links/${code}.geml`, nextId("use"), (_d, prev, id) => sealed({ id, at: this.now() }, prev));
    return done({});
  }

  /** The agent's way in for a person with no token on that machine (spec §6.3, transport §2.5): the address and the code the person typed into the plugin's own box; answered with the avatar's token and a device token for the agent, never the person's. */
  joinWithCode(code: string, body: unknown): Result<Joined & { device: string }> {
    const link = this.goodLink(code);
    if (isFail(link)) return link;
    const p = this.checkCode(body);
    if (isFail(p)) return p;
    const device = issueToken(this.store, { speaker: `person:${p.person}`, scope: "device", by: "login", at: this.now() });
    this.nameDevice(p.person, device.record.id, obj(body)?.["device"]);
    const { phone: _p, email: _e, code: _c, lang: _l, device: _d, ...rest } = obj(body) ?? {};
    const joined = this.joinByLink(device.record, code, rest);
    return isFail(joined) ? joined : { ...joined, device: device.token };
  }

  /** The requests waiting for the group's owner to let someone in (spec §6.1), oldest first. */
  requestsOf(owner: string): { id: string; venue: string; avatar: AvatarCard; at: string }[] {
    const d = this.store.read(owner, "requests.geml");
    const answered = new Set(d.blocks.filter((b) => /^answer-\d+$/.test(b.id)).map((b) => b.value["request"]));
    const out: { id: string; venue: string; avatar: AvatarCard; at: string }[] = [];
    for (const b of d.blocks) {
      if (!/^request-\d+$/.test(b.id) || answered.has(b.id)) continue;
      const w = parseWho(str(b.value["avatar"]) ?? ""), venue = str(b.value["venue"]);
      const card = w?.kind === "avatar" ? this.card(w.id) : undefined;
      if (card !== undefined && venue !== undefined) out.push({ id: b.id, venue, avatar: card, at: str(b.value["at"]) ?? "" });
    }
    return out;
  }

  /** The owner lets the newcomer in, or not (spec §6.1); a yes puts the avatar in the group. */
  answerRequest(by: TokenRecord, owner: string, request: string, body: unknown): Result<{ joined: boolean }> {
    const o = obj(body) ?? {};
    const a = this.acting(by, o["as"]);
    if (isFail(a)) return a;
    if (a.avatar !== owner) return fail(403, "link.ownerRules");
    const yes = o["yes"];
    if (typeof yes !== "boolean") return fail(400, "request.yes");
    return this.settleRequest(owner, request, yes);
  }

  /** The owner's answer to a newcomer, however it came (the request's own route, or its 需要你 card). */
  private settleRequest(owner: string, request: string, yes: boolean): Result<{ joined: boolean }> {
    const d = this.store.read(owner, "requests.geml");
    const asked = d.blocks.find((b) => b.id === request && /^request-\d+$/.test(b.id));
    if (asked === undefined) return fail(404, "request.missing");
    if (d.blocks.some((b) => /^answer-\d+$/.test(b.id) && b.value["request"] === request)) return fail(409, "request.answered");
    const made = this.store.append(owner, "requests.geml", nextId("answer"), (_d, prev, id) => sealed({ id, request, yes, by: avatarSpeaker(owner), at: this.now() }, prev));
    this.emit(owner, "requests.geml", made.block);
    const w = parseWho(str(asked.value["avatar"]) ?? ""), venue = str(asked.value["venue"]), kept = str(asked.value["owner"]) ?? owner;
    if (yes && w?.kind === "avatar" && venue !== undefined && this.venueState(kept, venue)?.members.includes(w.id) === false) this.join(kept, venue, w.id, avatarSpeaker(owner));
    return { ok: true, joined: yes };
  }

  /** Whether the token may follow a document as it grows (the server's subscriptions): an avatar's card anyone; a venue its members, once it is there; anything else under an avatar that avatar and its person, made yet or not. */
  mayFollow(by: TokenRecord, owner: string, doc: string): boolean {
    if (!AVATAR_ID.test(owner) || !DOC.test(doc)) return false;
    if (doc === "avatar.geml") return true;
    const v = VENUE_DOC.exec(doc);
    if (v !== null) return this.read(by, owner, doc).ok;
    return this.mine(by).includes(owner);
  }

  // --- 需要你 (spec §7.3) ---

  /** One of the avatar's cards as it stands: open, answered, or past its deadline when it has one. */
  private needOf(avatar: string, b: DataBlock, answers: Map<string, DataBlock>, expired: ReadonlySet<string>, settled: ReadonlySet<string>): Need {
    const v = b.value;
    const venue = obj(v["venue"]);
    const answer = answers.get(b.id);
    const request = str(v["request"]);
    const expires = str(v["expires"]);
    const state = answer !== undefined || (request !== undefined && settled.has(request)) ? "answered" : expired.has(b.id) || (expires !== undefined && Date.parse(expires) <= Date.parse(this.now())) ? "expired" : "open";
    return {
      id: b.id, avatar, kind: isKind(v["kind"]) ? v["kind"] : "error", summary: str(v["summary"]) ?? "", options: (Array.isArray(v["options"]) ? v["options"] : []) as unknown as NeedOption[], ...(expires !== undefined ? { expires } : {}), at: str(v["at"]) ?? "", state,
      ...(venue !== undefined && typeof venue["owner"] === "string" && typeof venue["id"] === "string" ? { venue: { owner: venue["owner"], id: venue["id"] } } : {}),
      ...(str(v["message"]) !== undefined ? { message: str(v["message"])! } : {}),
      ...(str(v["checked"]) !== undefined ? { checked: str(v["checked"])! } : {}),
      ...(str(v["draft"]) !== undefined ? { draft: str(v["draft"])! } : {}),
      ...(request !== undefined ? { request } : {}),
      ...(str(v["from"]) !== undefined ? { from: str(v["from"])! } : {}),
      ...(answer !== undefined ? { answer: { choice: answer.value["choice"] === "own" ? "own" : Number(answer.value["choice"]), ...(str(answer.value["text"]) !== undefined ? { text: str(answer.value["text"])! } : {}), at: str(answer.value["at"]) ?? "" } } : {}),
    };
  }

  /** The avatar's cards, oldest first, each with its state. */
  needsOfAvatar(avatar: string): Need[] {
    const d = this.store.read(avatar, "needs.geml");
    const answers = new Map(d.blocks.filter((b) => /^answer-\d+$/.test(b.id)).map((b) => [str(b.value["need"]) ?? "", b] as const));
    const expired = new Set(d.blocks.filter((b) => /^expired-\d+$/.test(b.id)).map((b) => str(b.value["need"]) ?? ""));
    const settled = new Set(this.store.read(avatar, "requests.geml").blocks.filter((b) => /^answer-\d+$/.test(b.id)).map((b) => str(b.value["request"]) ?? ""));
    return d.blocks.filter((b) => /^need-\d+$/.test(b.id)).map((b) => this.needOf(avatar, b, answers, expired, settled));
  }

  /** What still waits on the person, for every avatar of theirs: the open cards, and an expired one for a day after (the pane marks it 已过期). */
  needsOf(person: string): (Need & { avatarName: string; group?: string })[] {
    const day = Date.parse(this.now()) - 86_400_000;
    const out: (Need & { avatarName: string; group?: string })[] = [];
    for (const a of this.avatarsOf(person)) {
      for (const n of this.needsOfAvatar(a.id)) {
        if (n.state === "answered" || (n.state === "expired" && Date.parse(n.expires ?? n.at) < day)) continue;
        const group = n.venue === undefined ? undefined : this.venueView(n.venue.owner, n.venue.id, a.id)?.name;
        out.push({ ...n, avatarName: a.name, ...(group !== undefined ? { group } : {}) });
      }
    }
    return out;
  }

  /** A card made: in the avatar's own `needs.geml`, in the relay's list of those with a deadline, out to the person's push channels. Nothing is said in the chat until the person answers (the waiting line is gone). */
  private askFor(avatar: string, n: { kind: NeedKind; summary: string; options: NeedOption[]; venue?: { owner: string; id: string }; message?: string; checked?: string; draft?: string; expires?: string; request?: string; from?: string }): Need {
    const now = this.now();
    const expires = n.expires;
    const made = this.store.append(avatar, "needs.geml", nextId("need"), (_d, prev, id) => sealed({
      id, kind: n.kind, summary: n.summary.trim(), options: n.options.map((o) => ({ label: o.label.trim(), ...(o.text !== undefined ? { text: o.text } : {}) })), ...(expires !== undefined ? { expires } : {}), at: now,
      ...(n.venue !== undefined ? { venue: n.venue } : {}), ...(n.message !== undefined ? { message: n.message } : {}), ...(n.checked !== undefined ? { checked: n.checked } : {}),
      ...(n.draft !== undefined ? { draft: n.draft } : {}), ...(n.request !== undefined ? { request: n.request } : {}), ...(n.from !== undefined ? { from: n.from } : {}),
    }, prev));
    this.emit(avatar, "needs.geml", made.block);
    // Only a card whose matter has a deadline is the sweep's; the rest wait until the person answers (architecture §6.3).
    if (expires !== undefined) this.store.append(RELAY_OWNER, "needs-open.geml", nextId("open"), (_d, prev, id) => sealed({ id, avatar, need: made.block.id, expires }, prev));
    if (n.kind === "borrow" && this.borrowAllowed(avatar, n.from, n.venue)) {
      // 以后不用问 was pressed for this asker or this chat (spec §7.4): nothing waits on the person; the card is answered by the relay, marked, and the job starts.
      const auto = this.store.append(avatar, "needs.geml", nextId("answer"), (_d, prev, bid) => sealed({ id: bid, need: made.block.id, choice: 0, by: "relay", auto: true, at: now }, prev));
      this.emit(avatar, "needs.geml", auto.block);
      this.closeOpen(avatar, made.block.id);
      const answered = this.needsOfAvatar(avatar).find((x) => x.id === made.block.id)!;
      this.startWork(avatar, answered, "waiting", true);
      return answered;
    }
    const need = this.needsOfAvatar(avatar).find((x) => x.id === made.block.id)!;
    const person = this.ownerOf(avatar);
    if (person !== undefined) {
      const card = { person, avatar, avatarName: this.card(avatar)?.name ?? avatar, lang: this.languageOf(person), need, ...(n.venue !== undefined ? { group: this.venueState(n.venue.owner, n.venue.id)?.name ?? "" } : {}) };
      for (const p of this.push.filter((x) => this.pushOf(person).includes(x.id))) {
        try { void Promise.resolve(p.deliver(card)).catch(() => { /* the channel's own trouble: the pane still shows the card */ }); } catch { /* the same */ }
      }
    }
    return need;
  }

  /** A line in a chat as the avatar, stamped `by`: the relay's own say, for answers and the expired line. */
  private sayAs(avatar: string, venue: { owner: string; id: string }, text: string, by: By, replyTo?: string, extra: Record<string, JsonValue> = {}): string | undefined {
    if (this.venueState(venue.owner, venue.id)?.members.includes(avatar) !== true) return undefined;
    const doc = venueDoc(venue.id);
    const reply = replyTo !== undefined && this.store.read(venue.owner, doc).blocks.some((b) => b.id === replyTo) ? replyTo : undefined;
    const made = this.store.append(venue.owner, doc, nextId("msg"), (_d, prev, id) => sealed({ id, speaker: avatarSpeaker(avatar), by, text: normalizeText(text), at: this.now(), ...(reply !== undefined ? { replyTo: reply } : {}), ...extra }, prev));
    this.emit(venue.owner, doc, made.block);
    this.remind(venue.owner, venue.id, made.block.value);
    return made.block.id;
  }

  /** An avatar's agent, or its person, asks the person (spec §7.3): one of the five kinds, about a chat it is in, with the words it would send and the options. */
  ask(by: TokenRecord, body: unknown): Result<{ need: Need }> {
    const o = obj(body) ?? {};
    const a = this.acting(by, o["as"]);
    if (isFail(a)) return a;
    const f = needFault(o, this.now());
    if (f !== undefined) return fail(400, f.code, f.params);
    const kind = o["kind"] as NeedKind;
    const m = /^([^/\s]+)\/([^/\s]+)$/.exec(str(o["venue"]) ?? "");
    const venue = m === null ? undefined : { owner: m[1]!, id: m[2]! };
    if (venue === undefined && kind !== "error") return fail(400, "need.noVenue");
    if (venue !== undefined && this.venueState(venue.owner, venue.id)?.members.includes(a.avatar) !== true) return fail(403, "venue.notMember");
    const person = this.ownerOf(a.avatar);
    const options = o["options"] !== undefined ? (o["options"] as NeedOption[]) : defaultOptions(kind, person === undefined ? DEFAULT_LANG : this.languageOf(person));
    const from = str(o["from"]);
    return { ok: true, need: this.askFor(a.avatar, {
      kind, summary: o["summary"] as string, options,
      ...(venue !== undefined ? { venue } : {}), ...(str(o["message"]) !== undefined ? { message: str(o["message"])! } : {}), ...(str(o["checked"]) !== undefined ? { checked: str(o["checked"])! } : {}),
      ...(str(o["draft"]) !== undefined ? { draft: str(o["draft"])! } : {}), ...(str(o["expires"]) !== undefined ? { expires: str(o["expires"])! } : {}), ...(from !== undefined && AVATAR_ID.test(from) ? { from } : {}),
    }) };
  }

  /** The person answers one of their avatars' cards (spec §7.3): once, and before its deadline when it has one. */
  answerNeed(by: TokenRecord, avatar: string, id: string, body: unknown): Result<{ need: Need; sent?: string }> {
    const refused = this.onlyOwner(by, avatar);
    if (refused !== undefined) return refused;
    return this.answerAs(avatar, id, body);
  }

  /**
   * An answer as the person's: words chosen (an option's, or their own) go
   * into the chat as the avatar, `by: person`, replying to the line the card
   * came from; a newcomer's card lets them in or not; a borrow's may stop
   * asking for the one who asked (`allowPerson`) or that chat (`allowVenue`).
   */
  private answerAs(avatar: string, id: string, body: unknown): Result<{ need: Need; sent?: string }> {
    const need = this.needsOfAvatar(avatar).find((n) => n.id === id);
    if (need === undefined) return fail(404, "need.missing");
    if (need.state === "answered") return fail(409, "need.answered");
    if (need.state === "expired") return fail(410, "need.gone");
    const o = obj(body) ?? {};
    const choice = o["choice"] === "own" ? "own" : typeof o["choice"] === "number" && Number.isInteger(o["choice"]) && o["choice"] >= 0 && o["choice"] < need.options.length ? o["choice"] : undefined;
    const text = str(o["text"]);
    if (choice === undefined || (choice === "own" && (text === undefined || text.trim() === ""))) return fail(400, "need.choice");
    if (text !== undefined && [...text].length > TEXT_MAX) return fail(400, "message.tooLong", { max: TEXT_MAX });
    const allowPerson = need.kind === "borrow" && o["allowPerson"] === true, allowVenue = need.kind === "borrow" && o["allowVenue"] === true;
    const made = this.store.append(avatar, "needs.geml", nextId("answer"), (_d, prev, bid) => sealed({ id: bid, need: id, choice, ...(text !== undefined ? { text } : {}), ...(allowPerson ? { allowPerson: true } : {}), ...(allowVenue ? { allowVenue: true } : {}), by: "person", at: this.now() }, prev));
    this.emit(avatar, "needs.geml", made.block);
    this.closeOpen(avatar, id);
    if (need.kind === "borrow" && (choice === 0 || choice === 1)) this.startWork(avatar, need, choice === 0 ? "waiting" : "queued", false);
    if (need.request !== undefined) {
      const r = this.settleRequest(avatar, need.request, choice === 0);
      if (isFail(r) && r.code !== "request.answered") return r;
      return { ok: true, need: { ...need, state: "answered" } };
    }
    const words = wordsOf(need, choice, text);
    const sent = words !== undefined && need.venue !== undefined ? this.sayAs(avatar, need.venue, words, "person", need.message) : undefined;
    return { ok: true, need: { ...need, state: "answered" }, ...(sent !== undefined ? { sent } : {}) };
  }

  private closeOpen(avatar: string, need: string): void {
    this.store.append(RELAY_OWNER, "needs-open.geml", nextId("closed"), (_d, prev, id) => sealed({ id, avatar, need }, prev));
  }

  /**
   * The standing 以后不用问 of an avatar's tasks (spec §7.4, S23): for the one who asked (`person`, with the chat it was
   * asked in), or for a chat (`venue`). In order: a later yes gives it, a later 撤 (a `revoke-N` block beside the
   * cards, never sent to the person's box: nothing there changes) takes it back.
   */
  allowsOf(avatar: string): Allow[] {
    const d = this.store.read(avatar, "needs.geml");
    const needs = new Map(d.blocks.filter((b) => /^need-\d+$/.test(b.id)).map((b) => [b.id, b.value] as const));
    const on = new Map<string, Allow>();
    for (const b of d.blocks) {
      if (/^revoke-\d+$/.test(b.id)) { on.delete(str(b.value["allow"]) ?? ""); continue; }
      if (!/^answer-\d+$/.test(b.id)) continue;
      const n = needs.get(str(b.value["need"]) ?? "");
      if (n === undefined || n["kind"] !== "borrow") continue;
      const nv = obj(n["venue"]), owner = str(nv?.["owner"]), id = str(nv?.["id"]), from = str(n["from"]);
      const venue = owner !== undefined && id !== undefined ? { owner, id } : undefined;
      if (b.value["allowPerson"] === true && from !== undefined) on.set(`person:${from}`, { key: `person:${from}`, person: from, ...(venue !== undefined ? { venue } : {}) });
      if (b.value["allowVenue"] === true && venue !== undefined) on.set(`venue:${venue.owner}/${venue.id}`, { key: `venue:${venue.owner}/${venue.id}`, venue });
    }
    return [...on.values()];
  }

  /** 撤 on one of them (S23): the next task it covered asks the person again. */
  revokeAllow(by: TokenRecord, avatar: string, body: unknown): Result<{ allows: Allow[] }> {
    const refused = this.onlyOwner(by, avatar);
    if (refused !== undefined) return refused;
    const key = str(obj(body)?.["allow"]);
    if (key === undefined || !this.allowsOf(avatar).some((x) => x.key === key)) return fail(404, "allow.missing");
    this.store.append(avatar, "needs.geml", nextId("revoke"), (_d, prev, id) => sealed({ id, allow: key, by: "person", at: this.now() }, prev));
    return { ok: true, allows: this.allowsOf(avatar) };
  }

  /** The standing 以后不用问 of an avatar, for its person alone. */
  allowsFor(by: TokenRecord, avatar: string): Result<{ allows: Allow[] }> {
    const refused = this.onlyOwner(by, avatar);
    return refused ?? { ok: true, allows: this.allowsOf(avatar) };
  }

  /** Whether a borrow may go ahead without asking (spec §7.4): the person said so, and did not take it back, for the avatar that asked, or for that chat. */
  borrowAllowed(avatar: string, from: string | undefined, venue: { owner: string; id: string } | undefined): boolean {
    return this.allowsOf(avatar).some((x) => (x.key.startsWith("person:") ? from !== undefined && x.person === from : venue !== undefined && x.venue?.owner === venue.owner && x.venue.id === venue.id));
  }

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
    const d = this.store.read(RELAY_OWNER, "needs-open.geml");
    const closed = new Set(d.blocks.filter((b) => /^closed-\d+$/.test(b.id)).map((b) => `${str(b.value["avatar"])}/${str(b.value["need"])}`));
    const now = Date.parse(this.now());
    let n = 0;
    for (const b of d.blocks) {
      if (!/^open-\d+$/.test(b.id)) continue;
      const avatar = str(b.value["avatar"]) ?? "", need = str(b.value["need"]) ?? "";
      if (closed.has(`${avatar}/${need}`) || Date.parse(str(b.value["expires"]) ?? "") > now) continue;
      const card = this.needsOfAvatar(avatar).find((x) => x.id === need);
      this.closeOpen(avatar, need);
      if (card === undefined || card.state === "answered") continue;
      const made = this.store.append(avatar, "needs.geml", nextId("expired"), (_d, prev, id) => sealed({ id, need, at: this.now() }, prev));
      this.emit(avatar, "needs.geml", made.block);
      if (card.venue !== undefined && card.request === undefined) this.sayAs(avatar, card.venue, say("need.expiredLine", this.languageOf(this.ownerOf(avatar) ?? "")), "agent", card.message);
      n++;
    }
    return n;
  }

  /** Answers back from the push channels (spec §7.3), each taken as the person's own press. */
  async collectPush(): Promise<number> {
    let n = 0;
    for (const p of this.push) {
      let answers: Awaited<ReturnType<PushAdapter["collect"]>> = [];
      try { answers = await p.collect(); } catch { continue; }
      for (const a of answers) {
        if (this.ownerOf(a.avatar) !== a.person || !this.pushOf(a.person).includes(p.id)) continue;
        if (this.answerAs(a.avatar, a.need, { choice: a.choice, ...(a.text !== undefined ? { text: a.text } : {}) }).ok) n++;
      }
    }
    return n;
  }

  /** The push channels the person turned on, of those the relay offers. */
  pushOf(person: string): string[] {
    const on = new Set<string>();
    for (const b of this.store.read(RELAY_OWNER, peopleDoc(person)).blocks) {
      if (!/^push-\d+$/.test(b.id)) continue;
      const c = str(b.value["channel"]) ?? "";
      if (b.value["on"] === true) on.add(c); else on.delete(c);
    }
    return [...on].filter((c) => this.push.some((p) => p.id === c));
  }

  /** A channel on or off for the person (spec §7.3, 「有事时提醒我」). */
  setPush(by: TokenRecord, body: unknown): Result<{ channels: string[]; offered: string[] }> {
    const person = this.onlyPerson(by);
    if (typeof person !== "string") return person;
    const o = obj(body) ?? {};
    const channel = str(o["channel"]) ?? "";
    if (!this.push.some((p) => p.id === channel)) return fail(404, "push.unknown", { channel });
    this.store.append(RELAY_OWNER, peopleDoc(person), nextId("push"), (_d, prev, id) => sealed({ id, channel, on: o["on"] !== false, at: this.now() }, prev));
    return { ok: true, channels: this.pushOf(person), offered: this.push.map((p) => p.id) };
  }

  // --- 自动回 (architecture §6.3) ---
  // The chats where the avatar answers on its own when it is called, as its
  // person set them; kept with the avatar, so every computer of theirs knows.
  // Off by default: elsewhere the person is asked first. The five kinds come
  // to the person either way.

  /** The chats, as `<owner>/<id>`, where the avatar answers on its own. */
  autoOf(avatar: string): string[] {
    const on = new Map<string, boolean>();
    for (const b of this.store.read(avatar, "auto.geml").blocks) if (/^auto-\d+$/.test(b.id) && typeof b.value["venue"] === "string") on.set(b.value["venue"], b.value["on"] === true);
    return [...on].filter(([, v]) => v).map(([k]) => k);
  }

  /** A chat set to answer on its own, or not, by the person (以后这个群自动回; 撤 in 我的分身). */
  setAuto(by: TokenRecord, avatar: string, body: unknown): Result<{ auto: string[] }> {
    const refused = this.onlyOwner(by, avatar);
    if (refused !== undefined) return refused;
    const o = obj(body) ?? {};
    const m = /^([^/\s]+)\/([^/\s]+)$/.exec(str(o["venue"]) ?? "");
    const on = o["on"];
    if (m === null || typeof on !== "boolean") return fail(400, "auto.body");
    if (on && this.venueState(m[1]!, m[2]!)?.members.includes(avatar) !== true) return fail(403, "venue.notMember");
    this.store.append(avatar, "auto.geml", nextId("auto"), (_d, prev, id) => sealed({ id, venue: `${m[1]}/${m[2]}`, on, at: this.now() }, prev));
    return { ok: true, auto: this.autoOf(avatar) };
  }

  // --- 任务 (spec §7.4; architecture §6.3, once called 借电脑) ---
  // A task card answered 现在干 — or let through by an earlier 以后不用问 —
  // is a job waiting for the avatar's computer: a Claude Code session the
  // person bound to the avatar, in the repository they named. 排着 keeps it
  // until they say now. The body takes it, does it in a worktree and reports:
  // its words go into the chat as the avatar with the facts its host saw, or
  // it failed and the person gets an 出错 card. IM is asynchronous: a job waits
  // for the computer as long as it takes — nothing is said in the chat and
  // nothing is an error while it waits. Jobs live in the avatar's own
  // `work.geml`.

  private startWork(avatar: string, need: Need, state: "waiting" | "queued", auto: boolean): string {
    const made = this.store.append(avatar, WORK_DOC, nextId("work"), (_d, prev, id) => sealed({
      id, need: need.id, summary: need.summary, state, at: this.now(),
      ...(need.venue !== undefined ? { venue: need.venue } : {}), ...(need.message !== undefined ? { message: need.message } : {}),
      ...(need.from !== undefined ? { from: need.from } : {}), ...(auto ? { auto: true } : {}),
    }, prev));
    this.emit(avatar, WORK_DOC, made.block);
    return made.block.id;
  }

  /** The avatar's jobs, oldest first, each as it stands. */
  worksOfAvatar(avatar: string): Work[] {
    const out = new Map<string, Work>();
    for (const b of this.store.read(avatar, WORK_DOC).blocks) {
      const v = b.value;
      if (/^work-\d+$/.test(b.id)) {
        const venue = obj(v["venue"]);
        out.set(b.id, {
          id: b.id, avatar, need: str(v["need"]) ?? "", summary: str(v["summary"]) ?? "", state: v["state"] === "queued" ? "queued" : "waiting", at: str(v["at"]) ?? "", since: str(v["at"]) ?? "",
          ...(venue !== undefined && typeof venue["owner"] === "string" && typeof venue["id"] === "string" ? { venue: { owner: venue["owner"], id: venue["id"] } } : {}),
          ...(str(v["message"]) !== undefined ? { message: str(v["message"])! } : {}), ...(str(v["from"]) !== undefined ? { from: str(v["from"])! } : {}), ...(v["auto"] === true ? { auto: true as const } : {}),
        });
        continue;
      }
      const w = out.get(str(v["work"]) ?? "");
      if (w === undefined) continue;
      if (/^state-\d+$/.test(b.id) && (WORK_STATES as readonly unknown[]).includes(v["state"])) { w.state = v["state"] as WorkState; w.since = str(v["at"]) ?? w.since; }
    }
    return [...out.values()];
  }

  /** The person's jobs as their client lists them: the open ones and those ended within a day, each with its chat's name, who asked and their words. */
  worksOf(person: string): (Work & { avatarName: string; group?: string; fromName?: string; words?: string })[] {
    const day = Date.parse(this.now()) - 86_400_000;
    const out: (Work & { avatarName: string; group?: string; fromName?: string; words?: string })[] = [];
    for (const a of this.avatarsOf(person)) {
      for (const w of this.worksOfAvatar(a.id)) {
        if ((w.state === "done" || w.state === "failed") && Date.parse(w.since) < day) continue;
        const view = w.venue === undefined ? undefined : this.venueView(w.venue.owner, w.venue.id, a.id);
        const line = w.venue !== undefined && w.message !== undefined ? this.store.read(w.venue.owner, venueDoc(w.venue.id)).blocks.find((b) => b.id === w.message) : undefined;
        const asker = w.from ?? str(line?.value["speaker"])?.replace(/^avatar:/, "");
        const fromName = asker === undefined ? undefined : view?.members.find((m) => m.id === asker)?.name;
        const words = str(line?.value["text"]);
        out.push({ ...w, avatarName: a.name, ...(view !== undefined ? { group: view.name } : {}), ...(fromName !== undefined ? { fromName } : {}), ...(words !== undefined ? { words } : {}) });
      }
    }
    return out;
  }

  /** The person's computer moves a job on (spec §7.4): takes it, asks for a queued one now, reports it done with the facts its host saw, or failed and why. */
  setWork(by: TokenRecord, avatar: string, id: string, body: unknown): Result<{ work: Work }> {
    const refused = this.onlyOwner(by, avatar);
    if (refused !== undefined) return refused;
    const w = this.worksOfAvatar(avatar).find((x) => x.id === id);
    if (w === undefined) return fail(404, "work.missing");
    const o = obj(body) ?? {};
    const state = o["state"];
    if (state !== "taken" && state !== "waiting" && state !== "done" && state !== "failed") return fail(400, "work.state");
    const from: Record<string, readonly WorkState[]> = { taken: ["waiting", "queued"], waiting: ["queued"], done: ["taken"], failed: ["waiting", "queued", "taken"] };
    if (!from[state]!.includes(w.state)) return fail(409, "work.taken");
    const person = this.ownerOf(avatar);
    const lang = this.languageOf(person ?? "");
    const name = this.card(avatar)?.name ?? avatar;
    if (state === "done") {
      const text = str(o["text"]);
      if (text === undefined || text.trim() === "") return fail(400, "work.text");
      if ([...text].length > TEXT_MAX) return fail(400, "message.tooLong", { max: TEXT_MAX });
      const facts = factsOf(o["facts"]);
      if (facts === undefined) return fail(400, "work.facts");
      this.markWork(avatar, id, "done");
      if (w.venue !== undefined) this.sayAs(avatar, w.venue, text, "agent", w.message, facts.length > 0 ? { facts: facts.map((f) => ({ label: f.label, ok: f.ok })) } : {});
    } else if (state === "failed") {
      const code = str(o["code"]);
      if (code === undefined || !WORK_FAULTS.includes(code)) return fail(400, "work.fault");
      const params: Record<string, string> = {};
      for (const [k, v] of Object.entries(obj(o["params"]) ?? {})) if (typeof v === "string" && k !== "avatar" && k !== "summary") params[k] = v.slice(0, 400);
      this.markWork(avatar, id, "failed");
      this.askFor(avatar, { kind: "error", summary: say(code, lang, { ...params, avatar: name, summary: w.summary }), options: defaultOptions("error", lang), ...(w.venue !== undefined ? { venue: w.venue } : {}), ...(w.message !== undefined ? { message: w.message } : {}) });
    } else this.markWork(avatar, id, state);
    return { ok: true, work: this.worksOfAvatar(avatar).find((x) => x.id === id)! };
  }

  private markWork(avatar: string, work: string, state: WorkState): void {
    const made = this.store.append(avatar, WORK_DOC, nextId("state"), (_d, prev, id) => sealed({ id, work, state, at: this.now() }, prev));
    this.emit(avatar, WORK_DOC, made.block);
  }
}
