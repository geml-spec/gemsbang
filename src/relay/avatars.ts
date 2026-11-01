// gemsbang's relay (spec §4, §5; transport §2): people, the avatars that are
// their accounts, the groups and two-person talks the avatars are in, and
// what they say there. A person lives under `_relay` only: their phone as a
// salted hash, their default name, which avatars are theirs. No answer to a
// client ever names the person behind an avatar (§5 rule 4). An avatar's card
// (`<avatar>/avatar.geml`) is public; its rules and its list of venues are
// its own and its person's; a venue is its members'. Every message is
// stamped with the avatar that said it and `by`, the person typing or an
// agent holding the avatar's token; others see `by` only when that avatar
// marks (§5 rule 1). It shares the store, the chain and the tokens with the
// older Relay (relay.ts) and touches none of that one's documents. A refusal
// is a code and its parameters (§7.6), with its words in Chinese beside it
// for whoever has no language to ask in; words.ts says it in the others.
import { createHash, randomBytes, randomInt } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeText, type DataBlock } from "../core/im/chain.js";
import type { JsonValue } from "../core/schema.js";
import { factsOf } from "../core/avatar/borrow.js";
import { defaultOptions, expiryOf, isKind, needFault, wordsOf, type Need, type NeedKind, type NeedOption } from "../core/avatar/needs.js";
import { DEFAULT_LINK_RULES, expiresAt, linkPath, linkStatus, LINK_CODE, makeCode, mayHandOut, withLinkRules, type LinkRules } from "../core/avatar/links.js";
import { nameFault, randomName } from "../core/avatar/names.js";
import { suggestions, type Suggestion } from "../core/avatar/naming.js";
import { pickAvatar, type Pick } from "../core/avatar/pick.js";
import { CODE_MISSES, CODE_RE, CODE_TTL_MS, CODES_PER_IP_HOUR, CODES_PER_PHONE, codeText, hashPhone, normalizePhone, tailOf } from "../core/avatar/phone.js";
import { DEFAULT_RULES, withRules, type Rules } from "../core/avatar/rules.js";
import { AVATAR_ID, avatarSpeaker, parseWho, VENUE_ID, type By } from "../core/avatar/who.js";
import { DEFAULT_LANG, isLang, say, type Fault, type Lang } from "../core/avatar/words.js";
import { appendBlock, appendSealed, BLOCK_ID, DOC, nextId, readDoc, RELAY_OWNER, sealed } from "./store.js";
import type { PushAdapter } from "./push.js";
import { fileTexter, type Texter } from "./text.js";
import { hashToken, issueToken, verifyToken, type TokenRecord } from "./tokens.js";

export interface AvatarRelayOptions { root: string; name: string; now?: () => string; texter?: Texter; rand?: () => number; /** The push channels the relay offers (spec §7.3); none unless given. */ push?: PushAdapter[] }
/** A refusal: the status, the code and its parameters, and the code's words in Chinese. */
export type Fail = { ok: false; status: number; code: string; params?: Record<string, string | number>; reason: string };
export type Result<T> = ({ ok: true } & T) | Fail;
export type Issued = { token: string; record: TokenRecord };
/** An avatar as anyone sees it: its id and name; `away` while its hosted body only receives (spec §8.3: 本人在时才回). */
export interface AvatarCard { id: string; name: string; away?: true }
export type VenueKind = "group" | "dm";
export interface VenueView { owner: string; id: string; kind: VenueKind; name: string; members: AvatarCard[] }
/** A venue as one of the person's avatars is in it. */
export interface MyVenue extends VenueView { as: string }
export interface Visible { id: string; value: Record<string, JsonValue> }
export interface Pushed { owner: string; doc: string; block: DataBlock }
/** A group's link as a member hands it out (spec §6.1). */
export interface LinkView { code: string; expires: string; path: string; forward: boolean; approve: boolean }
/** What a link's page shows (spec §6.2): the group, a few of its members, its owner; to a person, which avatar would go in and the names offered. */
export interface LinkInfo { group: { id: string; name: string; count: number; members: AvatarCard[] }; owner: AvatarCard | undefined; expires: string; approve: boolean; suggestions: Suggestion[]; you?: { avatars: AvatarCard[]; pick: Pick } }
/** In through a link: the avatar that went in, or waits for the owner; an agent's join carries the avatar's token. */
export interface Joined { venue: VenueView; avatar: AvatarCard; already: boolean; pending?: string; token?: string }

const fail = (status: number, code: string, params?: Record<string, string | number>): Fail => ({ ok: false, status, code, ...(params !== undefined ? { params } : {}), reason: say(code, DEFAULT_LANG, params) });
const refuse = (status: number, f: Fault): Fail => fail(status, f.code, f.params);
const isFail = (x: object): x is Fail => (x as Fail).ok === false;
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const obj = (v: unknown): Record<string, unknown> | undefined => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);
const hex = (bytes: number): string => randomBytes(bytes).toString("hex");
const ONE_HOUR_MS = 3_600_000;
/** The relay's own records, under `_relay`: the phone→person map, the codes, the avatar→person map, the salt. */
const PHONES = "avatar-phones.geml", CODES = "avatar-codes.geml", OWNERS = "avatar-owners.geml", SALT = "avatar-salt.txt";
const peopleDoc = (person: string): string => `people/${person}.geml`;
const venueDoc = (venue: string): string => `venues/${venue}.geml`;
const VENUE_DOC = /^venues\/([gd]-[0-9a-f]{10})\.geml$/;
/** Ids the relay writes in a venue; a client's message may not take one. */
const RESERVED = /^(venue|member|msg|sys|link|request|answer)(-|$)/;
export const TEXT_MAX = 4000;
/** How long a job waits for the avatar's computer before the chat and the person are told (spec §7.4). */
export const BODY_WAIT_MS = 2 * 60_000;
const WORK_DOC = "work.geml";
/** Where a job of the person's computer stands (spec §7.4). */
export type WorkState = "waiting" | "queued" | "taken" | "done" | "failed";
const WORK_STATES: readonly WorkState[] = ["waiting", "queued", "taken", "done", "failed"];
const WORK_FAULTS = ["borrow.noRepo", "borrow.wrongRepo", "borrow.failed"];
/** A job for the avatar's computer, from a borrow card: what it is, where it came from, where it stands. */
export interface Work { id: string; avatar: string; need: string; summary: string; state: WorkState; at: string; since: string; told: boolean; venue?: { owner: string; id: string }; message?: string; from?: string; auto?: true }
export const GROUP_NAME_MAX = 40;

export class AvatarRelay {
  readonly root: string;
  readonly name: string;
  private readonly clock: () => string;
  private readonly texter: Texter;
  private readonly rand: () => number;
  private readonly listeners = new Set<(p: Pushed) => void>();
  private readonly push: PushAdapter[];

  constructor(o: AvatarRelayOptions) {
    this.root = o.root;
    this.name = o.name;
    this.texter = o.texter ?? fileTexter(o.root);
    this.rand = o.rand ?? Math.random;
    this.clock = o.now ?? (() => new Date().toISOString().replace(/\.\d{3}Z$/, "Z"));
    this.push = o.push ?? [];
  }

  now(): string { return this.clock(); }
  /** Hear of every block appended; the function given back stops it. */
  onAppend(fn: (p: Pushed) => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
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

  // --- login (spec §6.2) ---

  /** A code texted to the number, in the language asked in: three to a number in ten minutes, ten to a network in an hour; whether the number is known, and its last four digits. */
  startLogin(body: unknown, ip?: string): Result<{ sent: true; known: boolean; tail: string }> {
    const phone = normalizePhone(obj(body)?.["phone"]);
    const asked = obj(body)?.["lang"];
    const lang: Lang = isLang(asked) ? asked : DEFAULT_LANG;
    if (phone === undefined) return fail(400, "phone.required");
    const h = hashPhone(phone, this.salt());
    const now = this.now(), t = Date.parse(now);
    const age = (b: DataBlock): number => t - Date.parse(str(b.value["at"]) ?? "");
    const recent = readDoc(this.root, RELAY_OWNER, CODES).blocks.filter((b) => /^code-\d+$/.test(b.id) && age(b) < ONE_HOUR_MS);
    if (recent.filter((b) => b.value["phone"] === h && age(b) < CODE_TTL_MS).length >= CODES_PER_PHONE) return fail(429, "code.tooMany");
    if (ip !== undefined && recent.filter((b) => b.value["ip"] === ip).length >= CODES_PER_IP_HOUR) return fail(429, "code.tooMany");
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    appendBlock(this.root, RELAY_OWNER, CODES, nextId("code"), (_d, prev, id) => sealed({ id, phone: h, code: hashToken(`${h}:${code}`), at: now, ...(ip !== undefined ? { ip } : {}) }, prev));
    try { void Promise.resolve(this.texter({ to: phone, text: codeText(code, lang) })).catch(() => { /* the operator's route failed; the next code tries again */ }); } catch { /* the same */ }
    return { ok: true, sent: true, known: this.personByPhone(h) !== undefined, tail: tailOf(phone) };
  }

  private personByPhone(h: string): string | undefined {
    const b = readDoc(this.root, RELAY_OWNER, PHONES).blocks.find((x) => x.id === `phone-${h.slice(7, 31)}`);
    return b === undefined ? undefined : str(b.value["person"]);
  }

  /** The code checked: a person's token; a number seen for the first time becomes a person in the language they logged in with, with no avatar yet (one grows with the first venue, §6.2). */
  finishLogin(body: unknown): Result<{ token: string; person: string; new: boolean }> {
    const p = this.checkCode(body);
    if (isFail(p)) return p;
    const { token } = issueToken(this.root, { speaker: `person:${p.person}`, scope: "person", by: "login", at: this.now() });
    return { ok: true, token, person: p.person, new: p.new };
  }

  /** The code checked and spent: the person the number is, made the first time it is seen. */
  private checkCode(body: unknown): { person: string; new: boolean } | Fail {
    const o = obj(body) ?? {};
    const phone = normalizePhone(o["phone"]);
    if (phone === undefined) return fail(400, "phone.required");
    const code = str(o["code"]);
    if (code === undefined || !CODE_RE.test(code)) return fail(400, "code.short");
    const h = hashPhone(phone, this.salt()), now = this.now(), t = Date.parse(now);
    const d = readDoc(this.root, RELAY_OWNER, CODES);
    const recent = (b: DataBlock): boolean => t - Date.parse(str(b.value["at"]) ?? "") < CODE_TTL_MS;
    // Six digits are a million guesses: five wrong ones stop the number's codes for ten minutes.
    const misses = d.blocks.filter((b) => /^miss-\d+$/.test(b.id) && b.value["phone"] === h && recent(b)).length;
    if (misses >= CODE_MISSES) return fail(429, "code.locked");
    const used = new Set(d.blocks.filter((b) => /^used-\d+$/.test(b.id)).map((b) => b.value["code"]));
    const want = hashToken(`${h}:${code}`);
    const hit = d.blocks.find((b) => /^code-\d+$/.test(b.id) && b.value["phone"] === h && b.value["code"] === want && !used.has(b.id) && recent(b));
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
    for (const b of readDoc(this.root, RELAY_OWNER, peopleDoc(person)).blocks) {
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
    appendBlock(this.root, RELAY_OWNER, peopleDoc(person), nextId("lang"), (_d, prev, id) => sealed({ id, lang, at: this.now() }, prev));
    return { ok: true, lang };
  }

  /** The person's default name (spec §6.5), the latest set; null clears it. It is only ever offered as a suggestion. */
  defaultNameOf(person: string): string | undefined {
    let name: string | undefined;
    for (const b of readDoc(this.root, RELAY_OWNER, peopleDoc(person)).blocks) if (/^default-\d+$/.test(b.id)) name = str(b.value["name"]);
    return name;
  }

  setDefaultName(by: TokenRecord, body: unknown): Result<{ name?: string }> {
    const person = this.onlyPerson(by);
    if (typeof person !== "string") return person;
    const v = obj(body)?.["name"];
    if (v !== null) { const f = nameFault(v); if (f !== undefined) return refuse(400, f); }
    const name = v === null ? null : (v as string).trim();
    appendBlock(this.root, RELAY_OWNER, peopleDoc(person), nextId("default"), (_d, prev, id) => sealed({ id, name, at: this.now() }, prev));
    return name === null ? { ok: true } : { ok: true, name };
  }

  // --- avatars ---

  /** The avatar's public card: its id and its latest name. */
  card(avatar: string): AvatarCard | undefined {
    if (!AVATAR_ID.test(avatar)) return undefined;
    let name: string | undefined;
    for (const b of readDoc(this.root, avatar, "avatar.geml").blocks) if (b.id === "avatar" || /^name-\d+$/.test(b.id)) name = str(b.value["name"]) ?? name;
    if (name === undefined) return undefined;
    return this.hostedOf(avatar).status === "receive-only" ? { id: avatar, name, away: true } : { id: avatar, name };
  }

  /** The person's avatars, oldest first. */
  avatarsOf(person: string): AvatarCard[] {
    const out: AvatarCard[] = [];
    for (const b of readDoc(this.root, RELAY_OWNER, peopleDoc(person)).blocks) {
      if (!/^avatar-\d+$/.test(b.id)) continue;
      const c = this.card(str(b.value["avatar"]) ?? "");
      if (c !== undefined) out.push(c);
    }
    return out;
  }

  /** The person behind an avatar: the relay's own lookup, never answered to a client (§5 rule 4). */
  private ownerOf(avatar: string): string | undefined {
    const b = readDoc(this.root, RELAY_OWNER, OWNERS).blocks.find((x) => x.id === `owner-${avatar}`);
    return b === undefined ? undefined : str(b.value["person"]);
  }

  /** A new avatar of the person (spec §6.4, §6.5): the name given when they joined, else a random one in their language; the default name is never used unasked. */
  growAvatar(by: TokenRecord, body: unknown): Result<{ avatar: AvatarCard }> {
    const person = this.onlyPerson(by);
    if (typeof person !== "string") return person;
    return this.grow(person, obj(body)?.["name"]);
  }

  private grow(person: string, given: unknown): Result<{ avatar: AvatarCard }> {
    if (given !== undefined) { const f = nameFault(given); if (f !== undefined) return refuse(400, f); }
    const name = typeof given === "string" ? given.trim() : randomName(this.rand, this.languageOf(person));
    const avatar = `a-${hex(5)}`, now = this.now();
    appendSealed(this.root, RELAY_OWNER, OWNERS, `owner-${avatar}`, { person, at: now });
    appendBlock(this.root, RELAY_OWNER, peopleDoc(person), nextId("avatar"), (_d, prev, id) => sealed({ id, avatar, at: now }, prev));
    const made = appendSealed(this.root, avatar, "avatar.geml", "avatar", { name, at: now });
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
    const a = appendBlock(this.root, avatar, "avatar.geml", nextId("name"), (_d, prev, id) => sealed({ id, name, at: this.now() }, prev));
    this.emit(avatar, "avatar.geml", a.block);
    return { ok: true, avatar: { id: avatar, name } };
  }

  /** The avatar's rules (spec §8.1): the defaults, then each change in turn. */
  rulesOf(avatar: string): Rules {
    let rules = DEFAULT_RULES;
    for (const b of readDoc(this.root, avatar, "rules.geml").blocks) {
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
    appendBlock(this.root, avatar, "rules.geml", nextId("rules"), (_d, prev, id) => sealed({ id, mark: next.mark, borrow: next.borrow, at: this.now() }, prev));
    return { ok: true, rules: next };
  }

  // --- tokens ---

  /** One of the person's avatars' token, for an agent that plays it (the hosted one, or one attached on a machine): it speaks as the avatar, `by` an agent. */
  issueAvatar(by: TokenRecord, avatar: string): Result<Issued> {
    const refused = this.onlyOwner(by, avatar);
    if (refused !== undefined) return refused;
    return { ok: true, ...issueToken(this.root, { speaker: avatarSpeaker(avatar), scope: "avatar", by: by.speaker, at: this.now() }) };
  }

  /** A device's token: the agent the person attached on one machine, which may only ask for an avatar's token once the person agrees (spec §6.3). */
  issueDevice(by: TokenRecord): Result<Issued> {
    const person = this.onlyPerson(by);
    if (typeof person !== "string") return person;
    return { ok: true, ...issueToken(this.root, { speaker: by.speaker, scope: "device", by: by.speaker, at: this.now() }) };
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

  private venueState(owner: string, venue: string): { kind: VenueKind; name: string; members: string[] } | undefined {
    if (!AVATAR_ID.test(owner) || !VENUE_ID.test(venue)) return undefined;
    const d = readDoc(this.root, owner, venueDoc(venue));
    const meta = d.blocks.find((b) => b.id === "venue")?.value;
    const kind = str(meta?.["kind"]);
    if (meta === undefined || (kind !== "group" && kind !== "dm")) return undefined;
    const members: string[] = [];
    for (const b of d.blocks) {
      if (!/^member-\d+$/.test(b.id)) continue;
      const w = parseWho(str(b.value["avatar"]) ?? "");
      if (w?.kind === "avatar" && !members.includes(w.id)) members.push(w.id);
    }
    return { kind, name: str(meta["name"]) ?? "", members };
  }

  /** The venue with its members' cards; a two-person talk is named after the other side, as the viewer's avatar sees it. */
  venueView(owner: string, venue: string, as?: string): VenueView | undefined {
    const s = this.venueState(owner, venue);
    if (s === undefined) return undefined;
    const members = s.members.map((m) => this.card(m)).filter((c): c is AvatarCard => c !== undefined);
    const name = s.kind === "dm" ? (members.find((m) => m.id !== as)?.name ?? s.name) : s.name;
    return { owner, id: venue, kind: s.kind, name, members };
  }

  /** The avatar into the venue: a member block in the venue, a join block in the avatar's own list of venues. */
  private join(owner: string, venue: string, avatar: string, by: string): void {
    const now = this.now();
    const m = appendBlock(this.root, owner, venueDoc(venue), nextId("member"), (_d, prev, id) => sealed({ id, avatar: avatarSpeaker(avatar), by, at: now }, prev));
    this.emit(owner, venueDoc(venue), m.block);
    const j = appendBlock(this.root, avatar, "joined.geml", nextId("join"), (_d, prev, id) => sealed({ id, owner, venue, at: now }, prev));
    this.emit(avatar, "joined.geml", j.block);
  }

  /** The venues the avatar is in, from its own list. */
  joinedOf(avatar: string): { owner: string; venue: string }[] {
    const out: { owner: string; venue: string }[] = [];
    for (const b of readDoc(this.root, avatar, "joined.geml").blocks) {
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
    const made = appendSealed(this.root, a.avatar, venueDoc(venue), "venue", { kind: "group", name, by: avatarSpeaker(a.avatar), at: this.now() });
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
    if (a.avatar !== owner) return fail(403, "group.ownerOnly");
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
    const made = appendSealed(this.root, first, venueDoc(venue), "venue", { kind: "dm", by: avatarSpeaker(a.avatar), at: this.now() });
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
    if (replyTo !== undefined && !readDoc(this.root, owner, doc).blocks.some((b) => b.id === replyTo)) return fail(400, "message.badReply");
    const now = this.now();
    const made = appendBlock(this.root, owner, doc, own !== undefined ? () => own : nextId("msg"), (_d, prev, id) => sealed({ id, speaker: avatarSpeaker(a.avatar), by: a.by, text: normalizeText(text), at: now, ...(replyTo !== undefined ? { replyTo } : {}) }, prev));
    if (!made.existed) this.emit(owner, doc, made.block);
    return { ok: true, message: made.block.value, existed: made.existed };
  }

  /** Every venue of every avatar of the person, each with the avatar that is in it. */
  venuesOf(person: string): MyVenue[] {
    const out: MyVenue[] = [];
    for (const a of this.avatarsOf(person)) {
      for (const v of this.joinedOf(a.id)) {
        const view = this.venueView(v.owner, v.venue, a.id);
        if (view !== undefined) out.push({ ...view, as: a.id });
      }
    }
    return out;
  }

  // --- reading ---

  /** A document as the token may see it: an avatar's card is anyone's; a venue is its members', a message's `by` left out where its avatar does not mark (§5 rule 1); anything else under an avatar is that avatar's and its person's. */
  read(by: TokenRecord, owner: string, doc: string): Result<{ blocks: Visible[] }> {
    if (!AVATAR_ID.test(owner) || !DOC.test(doc)) return fail(404, "doc.missing");
    const d = readDoc(this.root, owner, doc);
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
    for (const b of readDoc(this.root, owner, venueDoc(venue)).blocks) {
      if (!/^link-rules-\d+$/.test(b.id)) continue;
      rules = withLinkRules(rules, { forward: b.value["forward"], approve: b.value["approve"] }) ?? rules;
    }
    return rules;
  }

  /** The group's current code: the last one made for it, kept under the relay's own `links/`. */
  private currentCode(venue: string): string | undefined {
    const codes = readDoc(this.root, RELAY_OWNER, `links/${venue}.geml`).blocks.filter((b) => /^code-\d+$/.test(b.id));
    return str(codes[codes.length - 1]?.value["code"]);
  }

  private linkOf(code: string): { code: string; owner: string; venue: string; expires: string } | undefined {
    if (!LINK_CODE.test(code)) return undefined;
    const v = readDoc(this.root, RELAY_OWNER, `links/${code}.geml`).blocks.find((b) => b.id === "link")?.value;
    const owner = str(v?.["owner"]), venue = str(v?.["venue"]), expires = str(v?.["expires"]);
    return owner === undefined || venue === undefined || expires === undefined ? undefined : { code, owner, venue, expires };
  }

  /** A new code for the group, made current; the one before it stops (spec §6.1). */
  private newLink(owner: string, venue: string, by: string): { code: string; expires: string } {
    const now = this.now(), expires = expiresAt(now);
    for (;;) {
      const code = makeCode(randomBytes(8));
      if (appendSealed(this.root, RELAY_OWNER, `links/${code}.geml`, "link", { owner, venue, by, at: now, expires }).existed) continue;
      appendBlock(this.root, RELAY_OWNER, `links/${venue}.geml`, nextId("code"), (_d, prev, id) => sealed({ id, code, at: now }, prev));
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
    return { avatar: a.avatar, isOwner: a.avatar === owner };
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
    const made = appendBlock(this.root, owner, venueDoc(venue), nextId("link-rules"), (_d, prev, id) => sealed({ id, forward: next.forward, approve: next.approve, by: avatarSpeaker(g.avatar), at: this.now() }, prev));
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
    const token = by.scope === "device" ? issueToken(this.root, { speaker: avatarSpeaker(avatar), scope: "avatar", by: by.id, at: this.now() }).token : undefined;
    const done = (x: Partial<Joined>): Result<Joined> => ({ ok: true, venue: this.venueView(link.owner, link.venue, avatar)!, avatar: card, already: false, ...x, ...(token !== undefined ? { token } : {}) });
    if (pick.kind === "in") return done({ already: true });
    if (this.linkRulesOf(link.owner, link.venue).approve) {
      const asked = this.requestsOf(link.owner).find((r) => r.venue === link.venue && r.avatar.id === avatar);
      if (asked !== undefined) return done({ pending: asked.id });
      const made = appendBlock(this.root, link.owner, "requests.geml", nextId("request"), (_d, prev, id) => sealed({ id, venue: link.venue, avatar: avatarSpeaker(avatar), link: code, at: this.now() }, prev));
      this.emit(link.owner, "requests.geml", made.block);
      // The owner's 答应事情 (spec §6.1, §7.3): the newcomer at the door, in the owner's person's language.
      const lang = this.languageOf(this.ownerOf(link.owner) ?? "");
      this.askFor(link.owner, { kind: "promise", summary: say("need.join.summary", lang, { name: card.name, group: this.venueState(link.owner, link.venue)?.name ?? "" }), options: [{ label: say("need.join.yes", lang) }, { label: say("need.join.no", lang) }], venue: { owner: link.owner, id: link.venue }, request: made.block.id });
      return done({ pending: made.block.id });
    }
    this.join(link.owner, link.venue, avatar, avatarSpeaker(avatar));
    appendBlock(this.root, RELAY_OWNER, `links/${code}.geml`, nextId("use"), (_d, prev, id) => sealed({ id, at: this.now() }, prev));
    return done({});
  }

  /** The agent's way in for a person with no token on that machine (spec §6.3, transport §2.5): the number and the code the person typed into the plugin's own box; answered with the avatar's token and a device token for the agent, never the person's. */
  joinWithCode(code: string, body: unknown): Result<Joined & { device: string }> {
    const link = this.goodLink(code);
    if (isFail(link)) return link;
    const p = this.checkCode(body);
    if (isFail(p)) return p;
    const device = issueToken(this.root, { speaker: `person:${p.person}`, scope: "device", by: "login", at: this.now() });
    const { phone: _p, code: _c, lang: _l, ...rest } = obj(body) ?? {};
    const joined = this.joinByLink(device.record, code, rest);
    return isFail(joined) ? joined : { ...joined, device: device.token };
  }

  /** The requests waiting for the group's owner to let someone in (spec §6.1), oldest first. */
  requestsOf(owner: string): { id: string; venue: string; avatar: AvatarCard; at: string }[] {
    const d = readDoc(this.root, owner, "requests.geml");
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
    const d = readDoc(this.root, owner, "requests.geml");
    const asked = d.blocks.find((b) => b.id === request && /^request-\d+$/.test(b.id));
    if (asked === undefined) return fail(404, "request.missing");
    if (d.blocks.some((b) => /^answer-\d+$/.test(b.id) && b.value["request"] === request)) return fail(409, "request.answered");
    const made = appendBlock(this.root, owner, "requests.geml", nextId("answer"), (_d, prev, id) => sealed({ id, request, yes, by: avatarSpeaker(owner), at: this.now() }, prev));
    this.emit(owner, "requests.geml", made.block);
    const w = parseWho(str(asked.value["avatar"]) ?? ""), venue = str(asked.value["venue"]);
    if (yes && w?.kind === "avatar" && venue !== undefined && this.venueState(owner, venue)?.members.includes(w.id) === false) this.join(owner, venue, w.id, avatarSpeaker(owner));
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

  /** One of the avatar's cards as it stands: open, answered, or past its time. */
  private needOf(avatar: string, b: DataBlock, answers: Map<string, DataBlock>, expired: ReadonlySet<string>, settled: ReadonlySet<string>): Need {
    const v = b.value;
    const venue = obj(v["venue"]);
    const answer = answers.get(b.id);
    const request = str(v["request"]);
    const expires = str(v["expires"]) ?? "";
    const state = answer !== undefined || (request !== undefined && settled.has(request)) ? "answered" : expired.has(b.id) || Date.parse(expires) <= Date.parse(this.now()) ? "expired" : "open";
    return {
      id: b.id, avatar, kind: isKind(v["kind"]) ? v["kind"] : "error", summary: str(v["summary"]) ?? "", options: (Array.isArray(v["options"]) ? v["options"] : []) as unknown as NeedOption[], expires, at: str(v["at"]) ?? "", state,
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
    const d = readDoc(this.root, avatar, "needs.geml");
    const answers = new Map(d.blocks.filter((b) => /^answer-\d+$/.test(b.id)).map((b) => [str(b.value["need"]) ?? "", b] as const));
    const expired = new Set(d.blocks.filter((b) => /^expired-\d+$/.test(b.id)).map((b) => str(b.value["need"]) ?? ""));
    const settled = new Set(readDoc(this.root, avatar, "requests.geml").blocks.filter((b) => /^answer-\d+$/.test(b.id)).map((b) => str(b.value["request"]) ?? ""));
    return d.blocks.filter((b) => /^need-\d+$/.test(b.id)).map((b) => this.needOf(avatar, b, answers, expired, settled));
  }

  /** What still waits on the person, for every avatar of theirs: the open cards, and an expired one for a day after (the pane marks it 已过期). */
  needsOf(person: string): (Need & { avatarName: string; group?: string })[] {
    const day = Date.parse(this.now()) - 86_400_000;
    const out: (Need & { avatarName: string; group?: string })[] = [];
    for (const a of this.avatarsOf(person)) {
      for (const n of this.needsOfAvatar(a.id)) {
        if (n.state === "answered" || (n.state === "expired" && Date.parse(n.expires) < day)) continue;
        const group = n.venue === undefined ? undefined : this.venueView(n.venue.owner, n.venue.id, a.id)?.name;
        out.push({ ...n, avatarName: a.name, ...(group !== undefined ? { group } : {}) });
      }
    }
    return out;
  }

  /** A card made: in the avatar's own `needs.geml`, in the relay's list of open ones, out to the person's push channels; with `placeholder`, the avatar's waiting line in the chat. */
  private askFor(avatar: string, n: { kind: NeedKind; summary: string; options: NeedOption[]; venue?: { owner: string; id: string }; message?: string; checked?: string; draft?: string; expires?: string; request?: string; from?: string; placeholder?: boolean }): Need {
    const now = this.now();
    const expires = expiryOf(now, n.expires);
    const made = appendBlock(this.root, avatar, "needs.geml", nextId("need"), (_d, prev, id) => sealed({
      id, kind: n.kind, summary: n.summary.trim(), options: n.options.map((o) => ({ label: o.label.trim(), ...(o.text !== undefined ? { text: o.text } : {}) })), expires, at: now,
      ...(n.venue !== undefined ? { venue: n.venue } : {}), ...(n.message !== undefined ? { message: n.message } : {}), ...(n.checked !== undefined ? { checked: n.checked } : {}),
      ...(n.draft !== undefined ? { draft: n.draft } : {}), ...(n.request !== undefined ? { request: n.request } : {}), ...(n.from !== undefined ? { from: n.from } : {}),
    }, prev));
    this.emit(avatar, "needs.geml", made.block);
    appendBlock(this.root, RELAY_OWNER, "needs-open.geml", nextId("open"), (_d, prev, id) => sealed({ id, avatar, need: made.block.id, expires }, prev));
    if (n.kind === "borrow" && this.borrowAllowed(avatar, n.from, n.venue)) {
      // 以后不用问 was pressed for this asker or this chat (spec §7.4): nothing waits on the person; the card is answered by the relay, marked, and the job starts.
      const auto = appendBlock(this.root, avatar, "needs.geml", nextId("answer"), (_d, prev, bid) => sealed({ id: bid, need: made.block.id, choice: 0, by: "relay", auto: true, at: now }, prev));
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
    if (n.placeholder === true && n.venue !== undefined) this.sayAs(avatar, n.venue, this.placeholderOf(avatar), "agent", n.message);
    return need;
  }

  /** A line in a chat as the avatar, stamped `by`: the relay's own say, for answers, placeholders and the expired line. */
  private sayAs(avatar: string, venue: { owner: string; id: string }, text: string, by: By, replyTo?: string, extra: Record<string, JsonValue> = {}): string | undefined {
    if (this.venueState(venue.owner, venue.id)?.members.includes(avatar) !== true) return undefined;
    const doc = venueDoc(venue.id);
    const reply = replyTo !== undefined && readDoc(this.root, venue.owner, doc).blocks.some((b) => b.id === replyTo) ? replyTo : undefined;
    const made = appendBlock(this.root, venue.owner, doc, nextId("msg"), (_d, prev, id) => sealed({ id, speaker: avatarSpeaker(avatar), by, text: normalizeText(text), at: this.now(), ...(reply !== undefined ? { replyTo: reply } : {}), ...extra }, prev));
    this.emit(venue.owner, doc, made.block);
    return made.block.id;
  }

  /** An avatar's agent, or its person, asks the person (spec §7.3): one of the five kinds, about a chat it is in, with the words it would send and the options; `placeholder` says the waiting line in the chat meanwhile. */
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
      ...(o["placeholder"] === true ? { placeholder: true } : {}),
    }) };
  }

  /** The person answers one of their avatars' cards (spec §7.3): once, before it expires. */
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
    const made = appendBlock(this.root, avatar, "needs.geml", nextId("answer"), (_d, prev, bid) => sealed({ id: bid, need: id, choice, ...(text !== undefined ? { text } : {}), ...(allowPerson ? { allowPerson: true } : {}), ...(allowVenue ? { allowVenue: true } : {}), by: "person", at: this.now() }, prev));
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
    appendBlock(this.root, RELAY_OWNER, "needs-open.geml", nextId("closed"), (_d, prev, id) => sealed({ id, avatar, need }, prev));
  }

  /** Whether a borrow may go ahead without asking (spec §7.4): the person said so for the avatar that asked, or for that chat. */
  borrowAllowed(avatar: string, from: string | undefined, venue: { owner: string; id: string } | undefined): boolean {
    const d = readDoc(this.root, avatar, "needs.geml");
    const needs = new Map(d.blocks.filter((b) => /^need-\d+$/.test(b.id)).map((b) => [b.id, b.value] as const));
    return d.blocks.some((b) => {
      if (!/^answer-\d+$/.test(b.id)) return false;
      const n = needs.get(str(b.value["need"]) ?? "");
      if (n === undefined || n["kind"] !== "borrow") return false;
      const nv = obj(n["venue"]);
      if (b.value["allowPerson"] === true && from !== undefined && n["from"] === from) return true;
      return b.value["allowVenue"] === true && venue !== undefined && nv?.["owner"] === venue.owner && nv?.["id"] === venue.id;
    });
  }

  /** The cards past their time, marked expired; in its chat, the avatar says that the person must answer this themself (spec §7.3). The server's minute. */
  sweep(): number {
    const d = readDoc(this.root, RELAY_OWNER, "needs-open.geml");
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
      const made = appendBlock(this.root, avatar, "needs.geml", nextId("expired"), (_d, prev, id) => sealed({ id, need, at: this.now() }, prev));
      this.emit(avatar, "needs.geml", made.block);
      if (card.venue !== undefined && card.request === undefined) this.sayAs(avatar, card.venue, say("need.expiredLine", this.languageOf(this.ownerOf(avatar) ?? "")), "agent", card.message);
      n++;
    }
    return n + this.sweepWork();
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
    for (const b of readDoc(this.root, RELAY_OWNER, peopleDoc(person)).blocks) {
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
    appendBlock(this.root, RELAY_OWNER, peopleDoc(person), nextId("push"), (_d, prev, id) => sealed({ id, channel, on: o["on"] !== false, at: this.now() }, prev));
    return { ok: true, channels: this.pushOf(person), offered: this.push.map((p) => p.id) };
  }

  /** What the avatar says while its person decides (spec §7.3): the person's own template, else the words of their language. */
  placeholderOf(avatar: string): string {
    let text: string | undefined;
    for (const b of readDoc(this.root, avatar, "templates.geml").blocks) if (/^placeholder-\d+$/.test(b.id)) text = str(b.value["text"]);
    return text ?? say("need.placeholder", this.languageOf(this.ownerOf(avatar) ?? ""));
  }

  setPlaceholder(by: TokenRecord, avatar: string, body: unknown): Result<{ text: string }> {
    const refused = this.onlyOwner(by, avatar);
    if (refused !== undefined) return refused;
    const v = obj(body)?.["text"];
    if (v !== null && (typeof v !== "string" || v.trim() === "" || [...v].length > 200)) return fail(400, "message.empty");
    appendBlock(this.root, avatar, "templates.geml", nextId("placeholder"), (_d, prev, id) => sealed({ id, text: v === null ? null : (v as string).trim(), at: this.now() }, prev));
    return { ok: true, text: this.placeholderOf(avatar) };
  }

  // --- the hosted body (spec §4.1, §7.7, §8.3; transport §6) ---
  // The platform's orchestrator (avatar-hosted.ts) plays every avatar whose
  // person has not paused it; what it does is kept in the avatar's own
  // `hosted.geml`: the pauses, whether it only receives, each round. The
  // methods marked "the platform's" are for the orchestrator alone: no route
  // answers them, since they name the person behind an avatar.

  /** The avatar's hosted body: paused by its person or not, playing or only receiving, its rounds (newest last). */
  hostedOf(avatar: string): { paused: boolean; status: "on" | "receive-only"; rounds: { at: string; kind: string; paid: string; replied: boolean; asked: boolean; ok: boolean }[] } {
    let paused = false, status: "on" | "receive-only" = "on";
    const rounds: { at: string; kind: string; paid: string; replied: boolean; asked: boolean; ok: boolean }[] = [];
    for (const b of readDoc(this.root, avatar, "hosted.geml").blocks) {
      if (/^pause-\d+$/.test(b.id)) paused = b.value["paused"] === true;
      else if (/^status-\d+$/.test(b.id)) status = b.value["status"] === "receive-only" ? "receive-only" : "on";
      else if (/^round-\d+$/.test(b.id)) rounds.push({ at: str(b.value["at"]) ?? "", kind: str(b.value["kind"]) ?? "", paid: str(b.value["paid"]) ?? "", replied: b.value["replied"] === true, asked: b.value["asked"] === true, ok: b.value["ok"] !== false });
    }
    return { paused, status, rounds };
  }

  /** 暂停自动回复 (spec §7.5), by the person. */
  setHosted(by: TokenRecord, avatar: string, body: unknown): Result<{ paused: boolean }> {
    const refused = this.onlyOwner(by, avatar);
    if (refused !== undefined) return refused;
    const paused = obj(body)?.["paused"];
    if (typeof paused !== "boolean") return fail(400, "hosted.paused");
    appendBlock(this.root, avatar, "hosted.geml", nextId("pause"), (_d, prev, id) => sealed({ id, paused, at: this.now() }, prev));
    return { ok: true, paused };
  }

  /** The platform's: the person behind an avatar, for whom its rounds are paid. */
  hostedPerson(avatar: string): string | undefined { return this.ownerOf(avatar); }

  /** The platform's: when the person first logged in (their free quota counts from it). */
  firstLoginOf(person: string): string {
    return str(readDoc(this.root, RELAY_OWNER, peopleDoc(person)).blocks.find((b) => b.id === "person")?.value["at"]) ?? this.now();
  }

  /** The platform's: the hosted replies the free quota paid for, across all the person's avatars. */
  hostedReplies(person: string): number {
    return this.avatarsOf(person).reduce((n, a) => n + this.hostedOf(a.id).rounds.filter((r) => r.replied && r.paid === "free").length, 0);
  }

  /** The platform's: whether the body plays or only receives; a change only is written. */
  setHostedStatus(avatar: string, status: "on" | "receive-only"): void {
    if (this.hostedOf(avatar).status === status) return;
    appendBlock(this.root, avatar, "hosted.geml", nextId("status"), (_d, prev, id) => sealed({ id, status, at: this.now() }, prev));
  }

  /** The platform's: one round, as it was paid and what it did. */
  recordRound(avatar: string, r: { venue: string; message?: string; kind: "reply" | "read"; paid: "free" | "key"; replied: boolean; asked: boolean; ok: boolean }): void {
    appendBlock(this.root, avatar, "hosted.geml", nextId("round"), (_d, prev, id) => sealed({ id, ...r, ...(r.message === undefined ? {} : { message: r.message }), at: this.now() }, prev));
  }

  /** The platform's: the chat's latest lines as the avatar's body reads them (others' `by` where they mark), with what the wake rules need. */
  hostedLines(avatar: string, owner: string, venue: string, n = 20): { id: string; speaker: string; who: string; text: string; by?: string; replyTo?: string; hops?: number; mine: boolean }[] {
    const view = this.venueView(owner, venue, avatar);
    if (view === undefined || !view.members.some((m) => m.id === avatar)) return [];
    const name = (a: string): string => view.members.find((m) => m.id === a)?.name ?? a;
    return readDoc(this.root, owner, venueDoc(venue)).blocks.filter((b) => typeof b.value["text"] === "string" && typeof b.value["speaker"] === "string").slice(-n).map((b) => {
      const a = (str(b.value["speaker"]) ?? "").replace(/^avatar:/, "");
      return { id: b.id, speaker: str(b.value["speaker"])!, who: name(a), text: str(b.value["text"])!, ...(str(b.value["by"]) !== undefined ? { by: str(b.value["by"])! } : {}), ...(str(b.value["replyTo"]) !== undefined ? { replyTo: str(b.value["replyTo"])! } : {}), ...(typeof b.value["hops"] === "number" ? { hops: b.value["hops"] } : {}), mine: a === avatar };
    });
  }

  /** The platform's: the body's reply in the chat, `by: agent`, with the hops it carries (§5 rule 7). */
  hostedSay(avatar: string, owner: string, venue: string, text: string, replyTo: string | undefined, hops: number): string | undefined {
    if (this.venueState(owner, venue)?.members.includes(avatar) !== true || text.trim() === "") return undefined;
    const doc = venueDoc(venue);
    const made = appendBlock(this.root, owner, doc, nextId("msg"), (_d, prev, id) => sealed({ id, speaker: avatarSpeaker(avatar), by: "agent", text: normalizeText(text.slice(0, TEXT_MAX)), at: this.now(), ...(replyTo !== undefined ? { replyTo } : {}), hops }, prev));
    this.emit(owner, doc, made.block);
    return made.block.id;
  }

  /** The platform's: the line in the chat that says the avatars stopped calling each other (§5 rule 7), drawn in each reader's language. */
  hopsNote(owner: string, venue: string, message: string): void {
    const doc = venueDoc(venue);
    const made = appendBlock(this.root, owner, doc, nextId("note"), (_d, prev, id) => sealed({ id, note: "hops", message, at: this.now() }, prev));
    this.emit(owner, doc, made.block);
  }

  /** The platform's: a card the body brings its person, about a chat or not. */
  hostedAsk(avatar: string, ask: { kind: NeedKind; summary: string; draft?: string; options?: NeedOption[] }, at?: { owner: string; id: string; message?: string; from?: string }): Need | undefined {
    if (at !== undefined && this.venueState(at.owner, at.id)?.members.includes(avatar) !== true) return undefined;
    if (ask.kind !== "error" && ask.kind !== "pay" && at === undefined) return undefined;
    const person = this.ownerOf(avatar);
    const options = ask.options ?? defaultOptions(ask.kind, person === undefined ? DEFAULT_LANG : this.languageOf(person));
    return this.askFor(avatar, { kind: ask.kind, summary: ask.summary.slice(0, 400), options, ...(ask.draft !== undefined ? { draft: ask.draft } : {}), ...(at !== undefined ? { venue: { owner: at.owner, id: at.id }, ...(at.message !== undefined ? { message: at.message } : {}), ...(at.from !== undefined ? { from: at.from } : {}) } : {}) });
  }

  // --- 借电脑 (spec §7.4) ---
  // A borrow card answered 现在干 — or let through by an earlier 以后不用问 —
  // is a job waiting for the avatar's computer: a Claude Code session the
  // person bound to the avatar, in the repository they named. 排着 keeps it
  // until they say now. The body takes it, does it in a worktree and reports:
  // its words go into the chat as the avatar with the facts its host saw, or
  // it failed and the person gets an 出错 card. A job left waiting two minutes
  // means the computer is not online: the avatar says in the chat that it will
  // come back to it, once, and the person gets an 出错 card; with no job
  // waiting, a computer offline is only a state. Jobs live in the avatar's own
  // `work.geml`; the relay's `work-open.geml` lists the open ones for the sweep.

  private startWork(avatar: string, need: Need, state: "waiting" | "queued", auto: boolean): string {
    const made = appendBlock(this.root, avatar, WORK_DOC, nextId("work"), (_d, prev, id) => sealed({
      id, need: need.id, summary: need.summary, state, at: this.now(),
      ...(need.venue !== undefined ? { venue: need.venue } : {}), ...(need.message !== undefined ? { message: need.message } : {}),
      ...(need.from !== undefined ? { from: need.from } : {}), ...(auto ? { auto: true } : {}),
    }, prev));
    this.emit(avatar, WORK_DOC, made.block);
    appendBlock(this.root, RELAY_OWNER, "work-open.geml", nextId("open"), (_d, prev, id) => sealed({ id, avatar, work: made.block.id }, prev));
    return made.block.id;
  }

  private closeWork(avatar: string, work: string): void {
    appendBlock(this.root, RELAY_OWNER, "work-open.geml", nextId("closed"), (_d, prev, id) => sealed({ id, avatar, work }, prev));
  }

  /** The avatar's jobs, oldest first, each as it stands. */
  worksOfAvatar(avatar: string): Work[] {
    const out = new Map<string, Work>();
    for (const b of readDoc(this.root, avatar, WORK_DOC).blocks) {
      const v = b.value;
      if (/^work-\d+$/.test(b.id)) {
        const venue = obj(v["venue"]);
        out.set(b.id, {
          id: b.id, avatar, need: str(v["need"]) ?? "", summary: str(v["summary"]) ?? "", state: v["state"] === "queued" ? "queued" : "waiting", at: str(v["at"]) ?? "", since: str(v["at"]) ?? "", told: false,
          ...(venue !== undefined && typeof venue["owner"] === "string" && typeof venue["id"] === "string" ? { venue: { owner: venue["owner"], id: venue["id"] } } : {}),
          ...(str(v["message"]) !== undefined ? { message: str(v["message"])! } : {}), ...(str(v["from"]) !== undefined ? { from: str(v["from"])! } : {}), ...(v["auto"] === true ? { auto: true as const } : {}),
        });
        continue;
      }
      const w = out.get(str(v["work"]) ?? "");
      if (w === undefined) continue;
      if (/^state-\d+$/.test(b.id) && (WORK_STATES as readonly unknown[]).includes(v["state"])) { w.state = v["state"] as WorkState; w.since = str(v["at"]) ?? w.since; }
      else if (/^told-\d+$/.test(b.id)) w.told = true;
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
        const line = w.venue !== undefined && w.message !== undefined ? readDoc(this.root, w.venue.owner, venueDoc(w.venue.id)).blocks.find((b) => b.id === w.message) : undefined;
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
      this.closeWork(avatar, id);
    } else if (state === "failed") {
      const code = str(o["code"]);
      if (code === undefined || !WORK_FAULTS.includes(code)) return fail(400, "work.fault");
      const params: Record<string, string> = {};
      for (const [k, v] of Object.entries(obj(o["params"]) ?? {})) if (typeof v === "string" && k !== "avatar" && k !== "summary") params[k] = v.slice(0, 400);
      this.markWork(avatar, id, "failed");
      this.askFor(avatar, { kind: "error", summary: say(code, lang, { ...params, avatar: name, summary: w.summary }), options: defaultOptions("error", lang), ...(w.venue !== undefined ? { venue: w.venue } : {}), ...(w.message !== undefined ? { message: w.message } : {}) });
      this.closeWork(avatar, id);
    } else this.markWork(avatar, id, state);
    return { ok: true, work: this.worksOfAvatar(avatar).find((x) => x.id === id)! };
  }

  private markWork(avatar: string, work: string, state: WorkState): void {
    const made = appendBlock(this.root, avatar, WORK_DOC, nextId("state"), (_d, prev, id) => sealed({ id, work, state, at: this.now() }, prev));
    this.emit(avatar, WORK_DOC, made.block);
  }

  /** The jobs left waiting for a computer two minutes: the avatar says in the chat it will come back to it, once, and the person gets an 出错 card. */
  private sweepWork(): number {
    const d = readDoc(this.root, RELAY_OWNER, "work-open.geml");
    const closed = new Set(d.blocks.filter((b) => /^closed-\d+$/.test(b.id)).map((b) => `${str(b.value["avatar"])}/${str(b.value["work"])}`));
    const now = Date.parse(this.now());
    let n = 0;
    for (const b of d.blocks) {
      if (!/^open-\d+$/.test(b.id)) continue;
      const avatar = str(b.value["avatar"]) ?? "", id = str(b.value["work"]) ?? "";
      if (closed.has(`${avatar}/${id}`)) continue;
      const w = this.worksOfAvatar(avatar).find((x) => x.id === id);
      if (w === undefined || w.state !== "waiting" || w.told || now - Date.parse(w.since) < BODY_WAIT_MS) continue;
      const lang = this.languageOf(this.ownerOf(avatar) ?? "");
      const told = appendBlock(this.root, avatar, WORK_DOC, nextId("told"), (_d, prev, bid) => sealed({ id: bid, work: id, at: this.now() }, prev));
      this.emit(avatar, WORK_DOC, told.block);
      if (w.venue !== undefined) this.sayAs(avatar, w.venue, say("borrow.later", lang), "agent", w.message);
      this.askFor(avatar, { kind: "error", summary: say("borrow.offline", lang, { avatar: this.card(avatar)?.name ?? avatar, summary: w.summary }), options: defaultOptions("error", lang), ...(w.venue !== undefined ? { venue: w.venue } : {}), ...(w.message !== undefined ? { message: w.message } : {}) });
      n++;
    }
    return n;
  }
}
