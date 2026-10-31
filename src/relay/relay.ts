// The relay (transport §2): documents on disk, stamped by token, one queue
// per agent, presence, the 「需要我」 inbox, grants. It runs no model, holds
// no money, sees no key, stores no package bytes (§2.1). Every write goes
// through the store under the document's lock; every read goes through
// access.ts, a block the viewer may not read answered as a stub. A venue
// message is delivered as core/im/delivery.ts says: the prompts it raises
// are appended to the agents' queues, the system messages it owes to the
// venue, and every appended block is handed to the listeners (server.ts
// pushes them to subscribers). What it says to a client is Chinese, as the
// core's words are.
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { parseAddress } from "../core/im/address.js";
import { renderDataBlock, type DataBlock } from "../core/im/chain.js";
import { deliver, type AgentInVenue, type Delivery, type DeliveryInput, type PromptTo } from "../core/im/delivery.js";
import type { Access, Embed, Stub } from "../core/im/embed.js";
import { agentLabel, formatSpeaker, parseSpeaker, personBehind, type Source, type Speaker } from "../core/im/identity.js";
import { draftFaults, KIND_WORDS, readMessages, stamp, type Ask, type Draft, type Message, type MessageKind } from "../core/im/message.js";
import type { RosterEntry } from "../core/im/mentions.js";
import { defaultActions, sortNeeds, WRITE_IN, type Need } from "../core/im/needs-me.js";
import { agentPresence, presenceText, type Presence } from "../core/im/presence.js";
import { agentBadge, byline, guestHeader, quotaOf, QUOTA_WORDS, rangeWords, readShare, sameDay, shareFaults, shareInput, summaryTag, useLine, type GuestQuota, type ShareCard } from "../core/im/share.js";
import { acceptance, acceptTag, briefLines, briefText, cardFaults, cardInput, deliverableFaults, DIRECTION_WORDS, EDITABLE, foldCard, heartbeatWords, isStale, MACHINE, moveFault, openSlots, progressLine, rolesOf, slotsOf, splitFault, STATE_WORDS, waitingOn, type Card, type CardState, type Role } from "../core/im/card.js";
import { balanceOf, capsOf, entryLine, foldLedger, FREE_CREDITS, GUEST_QUESTION_CREDITS, holdOf, PACKET_HOURS, PLATFORM, usedToday, walletLines, WALLET_WORDS, type CapKey, type Caps, type Entry, type EntryKind, type Used } from "../core/im/ledger.js";
import { CODE_RE, CODE_TTL_MS, CODES_PER_EMAIL, CODES_PER_IP_HOUR, codeMail, emailFault, HOSTED_AGENT, LOGIN_WORDS, nameFault, normalizeEmail, welcomeText } from "../core/im/login.js";
import { DIGEST_ACTIONS, digestFault, digestHead, digestNeedText, keywordsOf, MATCH_ACTIONS, matchNeedText, MATCHED_TEXT, MODE_WORDS, modeOf, nameCard, ownMatchNeedText, receptionText, sharedKeywords, type SocialMode } from "../core/im/social.js";
import { foldSignals, performanceOf, priceAt, signalFaults, signalInput, signalText, type Performance, type PricePoint, type Signal } from "../core/im/signal.js";
import { DISCLAIMER } from "../core/im/risk.js";
import { DEFAULT_DECLARATION, declarationLines, declarationOf, eligibilityWords, hoursOf, hoursString, hoursWords, waitingForSession, withinHours, type Declaration } from "../core/im/declare.js";
import { fileMailer, type Mailer } from "./mail.js";
import { enqueue, pending, readQueue, type ItemDraft, type Marker, type Queue, type QueueItem } from "../core/im/queue.js";
import { densityAllows, grantUntil, levelOf, type Grant, type Run } from "../core/im/sender.js";
import { ANNOUNCE_LIMIT, contextSegment, DEFAULT_POLICY, setAnnounce as announce, VENUE_WORDS, type ChannelPrice, type Policy, type PromptFrom, type Venue, type VenueKind } from "../core/im/venue.js";
import type { JsonValue } from "../core/schema.js";
import { accessFor, canRead, type BlockGrant, type World } from "./access.js";
import { appendBlock, appendSealed, BLOCK_ID, DOC, listDocs, listOwners, NAME, nextId, readDoc, RELAY_OWNER, sealed, type Doc } from "./store.js";
import { hashToken, issueToken, verifyToken, type TokenRecord } from "./tokens.js";

export type Federation = "open" | "closed";
export interface RelayOptions { root: string; name: string; federation?: Federation; version?: string; now?: () => string; freeCredits?: number; feePercent?: number; mailer?: Mailer }
export type Fail = { ok: false; status: number; reason: string };
export type Result<T> = ({ ok: true } & T) | Fail;
const fail = (status: number, reason: string): Fail => ({ ok: false, status, reason });

/** A block as a viewer sees it: its value, or a stub in its place. */
export interface Visible { id: string; value?: Record<string, JsonValue>; stub?: Stub }
export interface Pushed { owner: string; doc: string; block: DataBlock }
/** A venue document folded: the venue, its agents' speakers by shown name, its messages, the blocks. */
export interface VenueDoc { venue: Venue; agentSpeakers: Map<string, string>; messages: Message[]; doc: Doc }
export interface SessionPresence { speaker: string; session: string; host: string; login: string; presence: Presence; task?: string; at: string }
export type Issued = { token: string; record: TokenRecord };

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const obj = (v: unknown): Record<string, JsonValue> | undefined => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, JsonValue>) : undefined);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
/** Ids the relay writes itself: a client's message may not take one. */
const RESERVED = /^(venue|member|announce|decision|sys|read|answered|qi|grant|refuse|request|trust|session|token|revoke|person|agent|policy)(-|$)/;
/** A session silent this long is asleep, and its person is told 断了 (transport §3). */
const STALE_MS = 3 * 60_000;
/** A worker silent this long is 卡住 in its owner's inbox; this long again and the relay gives the card back (§8.2). */
const STUCK_AFTER_MS = 30 * 60_000;
const GIVE_BACK_AFTER_MS = 6 * 3_600_000;
/** The verbs a card's thread tells the worker to use (transport §4.1). */
const CARD_HOWTO = "记录用 im_card note，交付用 im_card deliver。";
const PROMPT_FROM: ReadonlySet<string> = new Set(["anyone", "allowlist", "nobody"]);
const PRESENCES: ReadonlySet<string> = new Set(["thinking", "tool", "waiting", "idle", "asleep"]);
const SOURCES: ReadonlySet<string> = new Set(["self", "drafted", "agent", "quoted"]);
const RUNS: ReadonlySet<string> = new Set(["workflow", "sandbox", "none"]);
const NOTHING: Delivery = { prompts: [], mentioned: [], notified: [], degraded: [], unresolved: [], system: [] };
const rand = (): string => randomBytes(4).toString("hex");
const ONE_HOUR_MS = 3_600_000;
/** The relay's own records for login (transport §7.1), under `_relay`: the codes (hashed, like tokens; the field is `code`, since `hash` is the chain's), the email→person map, the hosted agents' tokens. */
const LOGINS = "logins.geml", EMAILS = "emails.geml", HOSTED = "hosted.geml", PHONE = "phone.geml";

/** Embeds as a body lists them, each an address with an optional `rev` or `hash`; a fault when one is not. */
function embedsOf(v: unknown): Embed[] | string {
  const out: Embed[] = [];
  for (const e of Array.isArray(v) ? v : []) {
    const o = obj(e);
    const src = o === undefined ? undefined : str(o["src"]);
    if (src === undefined || parseAddress(src) === undefined) return "不是地址";
    const embed: Embed = { src };
    const rev = num(o!["rev"]); if (rev !== undefined) embed.rev = rev;
    const hash = str(o!["hash"]); if (hash !== undefined) embed.hash = hash;
    out.push(embed);
  }
  return out;
}

/** A venue's policy from what a body or a block says, the defaults for the rest. */
function policyOf(v: unknown): Policy {
  const o = obj(v) ?? {};
  const promptFrom = str(o["promptFrom"]);
  const density = obj(o["density"]) ?? {};
  return {
    promptFrom: promptFrom !== undefined && PROMPT_FROM.has(promptFrom) ? (promptFrom as PromptFrom) : DEFAULT_POLICY.promptFrom,
    allow: strings(o["allow"]),
    density: { venuePerMinute: num(density["venuePerMinute"]) ?? DEFAULT_POLICY.density.venuePerMinute, agentPerMinute: num(density["agentPerMinute"]) ?? DEFAULT_POLICY.density.agentPerMinute },
    draftFirst: o["draftFirst"] === true,
    hopLimit: num(o["hopLimit"]) ?? DEFAULT_POLICY.hopLimit,
  };
}

/** A speaker as a line names it: a person by id, an agent by name, a guest as 访客, the host as 宿主. */
export function shownName(speaker: string): string {
  const s = parseSpeaker(speaker);
  if (s === undefined) return speaker;
  switch (s.kind) {
    case "person": return s.id;
    case "agent": return s.name;
    case "guest": return `访客 ${s.id}`;
    case "host": return "宿主";
  }
}

const toMessage = (b: DataBlock): Message | undefined => readMessages(renderDataBlock(b.id, b.value)).messages[0];

/** The grants that widen a tool scope (core/im/sender.ts `scopeFor`) among a person's page's blocks. */
export function scopeGrantsFrom(blocks: readonly DataBlock[]): Grant[] {
  const out: Grant[] = [];
  for (const b of blocks) {
    if (!/^grant-\d+$/.test(b.id)) continue;
    const person = str(obj(b.value["to"])?.["person"]), widen = obj(b.value["widen"]);
    if (person === undefined || widen === undefined) continue;
    const g: Grant = { to: { person }, widen: widen as Grant["widen"], at: str(b.value["at"]) ?? "" };
    const until = str(b.value["until"]); if (until !== undefined) g.until = until;
    out.push(g);
  }
  return out;
}

export function foldVenue(owner: string, id: string, d: Doc, relay: string): VenueDoc | undefined {
  const meta = d.blocks.find((b) => b.id === "venue")?.value;
  if (meta === undefined) return undefined;
  const kind = str(meta["kind"]);
  if (kind === undefined || !(kind in VENUE_WORDS)) return undefined;
  const venue: Venue = { id, kind: kind as VenueKind, name: str(meta["name"]) ?? id, address: `https://${relay}/${owner}/venues/${id}.geml`, people: [], agents: [], policy: policyOf(meta["policy"]), decisions: [] };
  for (const k of ["host", "anchor", "parent"] as const) { const v = str(meta[k]); if (v !== undefined) venue[k] = v; }
  const card = str(meta["card"]); if (card !== undefined) venue.card = card;
  const publisher = str(meta["publisher"]); if (publisher !== undefined) venue.publisher = publisher;
  const price = obj(meta["price"]);
  if (price !== undefined) {
    const p: ChannelPrice = {};
    const month = num(price["month"]); if (month !== undefined) p.month = month;
    const signal = num(price["signal"]); if (signal !== undefined) p.signal = signal;
    venue.price = p;
  }
  const agentSpeakers = new Map<string, string>();
  const join = (speaker: string): void => {
    const s = parseSpeaker(speaker);
    if (s === undefined) return;
    if (s.kind === "person") { if (!venue.people.includes(s.id)) venue.people.push(s.id); }
    else if (s.kind === "guest") { if (!venue.people.includes(speaker)) venue.people.push(speaker); }
    else if (s.kind === "agent" && !agentSpeakers.has(s.name)) { agentSpeakers.set(s.name, speaker); venue.agents.push(s.name); }
  };
  for (const p of strings(meta["people"])) join(p.includes(":") ? p : `person:${p}`);
  for (const a of strings(meta["agents"])) join(a);
  for (const b of d.blocks) {
    if (/^member-\d+$/.test(b.id)) { const s = str(b.value["speaker"]); if (s !== undefined) join(s); }
    else if (/^announce-\d+$/.test(b.id)) { const text = str(b.value["text"]); if (text !== undefined) venue.announce = { text, version: num(b.value["version"]) ?? 1, at: str(b.value["at"]) ?? "", by: str(b.value["by"]) ?? "" }; }
    else if (/^decision-\d+$/.test(b.id)) { const m = str(b.value["message"]); if (m !== undefined && !venue.decisions.includes(m)) venue.decisions.push(m); }
    else if (/^leave-\d+$/.test(b.id)) { const s = parseSpeaker(str(b.value["speaker"]) ?? ""); if (s?.kind === "person") venue.people = venue.people.filter((p) => p !== s.id); }
  }
  return { venue, agentSpeakers, messages: readMessages(d.text).messages, doc: d };
}

/** What the guest page shows (transport §7.1): the card, its owner, the agent's presence, the quota today, the words rendered once, and — for a guest who has one — their DM and what they have left. */
export interface ShareView {
  owner: string;
  card: ShareCard;
  agent: { name: string; presence: Presence; presenceWord: string };
  quota: { perGuestPerDay: number; ownerLeftToday: number };
  lines: { byline: string; summaryTag?: string; range: string; use?: string; guestHeader: string; agentBadge: string };
  guest?: { speaker: string; left: number; venue?: string };
}

/** A guest's DM on a card: one per guest and card, `gd-<card>-<guest>` under the owner. */
export const guestVenueId = (card: string, guest: string): string => `gd-${card.replace(/^c-/, "")}-${guest.replace(/^guest:g-/, "")}`;

/** A state's word for a refusal. */
const STATE_WORDS_OF = (s: CardState): string => STATE_WORDS[s];
/** A month of subscription (§10.4). */
const MONTH_MS = 30 * 86_400_000;
/** A cap as the inbox names it. */
const CAP_WORDS: Readonly<Record<CapKey, string>> = { agent: "每天的总额", card: "每张卡", guest: "访客问答", auto: "自动买东西" };
/** What publishing a card holds (§9.1): the escrow, or the prize with a participation for every other slot. */
const rewardTotal = (card: Card): number => (card.reward.kind === "escrow" ? card.reward.credits : card.reward.kind === "prize" ? card.reward.credits + (card.reward.participation ?? 0) * (slotsOf(card) - 1) : 0);
const packetExpired = (at: string, now: string): boolean => Date.parse(at) + PACKET_HOURS * 3_600_000 <= Date.parse(now);
interface PacketDoc { from: string; venue: string; credits: number; shares: number; note: string; at: string; claims: { by: string; amount: number; at: string }[]; returned: boolean }
export interface PacketView { id: string; from: string; venue: string; credits: number; shares: number; note: string; at: string; claims: { by: string; amount: number }[]; left: number; returned: boolean; mine?: number }
export interface WalletView { balance: number; caps: Caps; used: Used; agents: string[]; lines: string[]; entries: Entry[]; recent: string[] }
/** A split's tree (§8.4), from a card down. */
export interface CardTree { owner: string; id: string; title: string; state: CardState; stateWord: string; by: string; children: CardTree[] }
/** The agent's page as the public sees it (§9.3). */
export interface AgentView { owner: string; name: string; label: string; presence: Presence; presenceWord: string; eligibility: string; declaration: Declaration; lines: string[]; numbers: { accepted: number; reviews: number; disputes: number }; mode: SocialMode; modeWord: string; latest?: string; performance?: Performance; askable: boolean }

export class Relay {
  readonly root: string;
  readonly name: string;
  readonly federation: Federation;
  readonly version: string;
  /** What a new person's wallet opens with, and the platform's cut of a settlement in percent (§9.1). */
  readonly freeCredits: number;
  readonly feePercent: number;
  /** Where a login code goes (transport §7.1); a file under the root unless the operator says. */
  private readonly mailer: Mailer;
  private readonly clock: () => string;
  private readonly sessions = new Map<string, SessionPresence>();
  private readonly listeners = new Set<(p: Pushed) => void>();

  constructor(o: RelayOptions) {
    this.root = o.root;
    this.name = o.name;
    this.federation = o.federation ?? "closed";
    this.version = o.version ?? "unknown";
    this.freeCredits = o.freeCredits ?? FREE_CREDITS;
    this.feePercent = o.feePercent ?? 0;
    this.mailer = o.mailer ?? fileMailer(o.root);
    this.clock = o.now ?? (() => new Date().toISOString().replace(/\.\d{3}Z$/, "Z"));
  }

  now(): string { return this.clock(); }
  /** Hear of every block appended; the function given back stops it. */
  onAppend(fn: (p: Pushed) => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private emit(owner: string, doc: string, block: DataBlock): void { for (const fn of this.listeners) fn({ owner, doc, block }); }
  verify(token: string): TokenRecord | undefined { return verifyToken(this.root, token); }
  address(owner: string, doc: string, block?: string): string { return `https://${this.name}/${owner}/${doc}${block === undefined ? "" : `#${block}`}`; }

  // --- identities ---

  /** A person's token, their home page written if it was not. */
  issuePerson(id: string): Result<Issued> {
    if (!NAME.test(id)) return fail(400, "名字不合法");
    const made = appendSealed(this.root, id, `people/${id}.geml`, "person", { name: id, at: this.now() });
    if (!made.existed && this.freeCredits > 0) this.transfer({ kind: "topup", from: PLATFORM, to: `person:${id}`, amount: this.freeCredits, note: "免费额度" });
    return { ok: true, ...issueToken(this.root, { speaker: `person:${id}`, scope: "person", by: "cli", at: this.now() }) };
  }

  /** An agent's token, issued by its owner; the agent's home page written with its policy on whose `@` it takes. */
  issueAgent(by: TokenRecord, name: string, policy?: unknown): Result<Issued> {
    const s = parseSpeaker(by.speaker);
    if (by.scope !== "person" || s?.kind !== "person") return fail(403, "只有本人的令牌能签发 agent 的令牌");
    if (!NAME.test(name)) return fail(400, "agent 名字不合法");
    const value: Record<string, JsonValue> = { name, owner: s.id, at: this.now() };
    const p = obj(policy);
    if (p !== undefined) {
      const promptFrom = str(p["promptFrom"]);
      if (promptFrom === undefined || !PROMPT_FROM.has(promptFrom)) return fail(400, "策略不合法");
      value["policy"] = { promptFrom, allow: strings(p["allow"]) };
    }
    const doc = `agents/${name}.geml`;
    const a = appendSealed(this.root, s.id, doc, "agent", value);
    if (!a.existed) this.emit(s.id, doc, a.block);
    return { ok: true, ...issueToken(this.root, { speaker: `agent:${name}@${s.id}`, scope: "agent", by: by.speaker, at: this.now() }) };
  }

  issueGuest(): Result<Issued> {
    return { ok: true, ...issueToken(this.root, { speaker: `guest:g-${rand()}`, scope: "guest", by: "guest", at: this.now() }) };
  }

  /** An inbox-only token of the person (the phone bridge). */
  issueInbox(by: TokenRecord): Result<Issued> {
    if (by.scope !== "person") return fail(403, "只有本人的令牌能签发收件箱令牌");
    return { ok: true, ...issueToken(this.root, { speaker: by.speaker, scope: "inbox", by: by.speaker, at: this.now() }) };
  }

  // --- the world the reading rule asks about ---

  world(): World {
    return {
      membersOf: (owner, doc) => {
        const v = /^venues\/([^/]+)\.geml$/.exec(doc);
        if (v !== null) { const vd = this.venueOf(owner, v[1]!); return vd === undefined ? undefined : this.venueMembers(vd); }
        const c = /^cards\/([^/]+)\.geml$/.exec(doc);
        if (c !== null) { const card = this.taskOf(owner, c[1]!); return card === undefined ? undefined : this.readersOf(card); }
        return undefined;
      },
      grantsOf: (owner) => this.blockGrantsOf(owner),
      publicDoc: (owner, doc) => { const m = /^cards\/([^/]+)\.geml$/.exec(doc); return m !== null && this.readShareDoc(owner, m[1]!) !== undefined; },
      now: this.now(),
    };
  }

  /** One block of a document; `announce` is the latest `announce-N`. */
  find(owner: string, doc: string, block: string): DataBlock | undefined {
    const d = readDoc(this.root, owner, doc);
    if (block === "announce") { const all = d.blocks.filter((b) => /^announce-\d+$/.test(b.id)); return all[all.length - 1]; }
    return d.blocks.find((b) => b.id === block);
  }

  access(): Access { return accessFor(this.name, this.world(), (o, d, b) => this.find(o, d, b)); }

  // --- reading ---

  stubOf(owner: string, b: DataBlock): Stub {
    const stub: Stub = { from: owner, note: "你看不到", action: "申请看" };
    const session = str(b.value["session"]); if (session !== undefined) stub.session = session;
    const turn = str(b.value["turn"]); if (turn !== undefined) stub.turn = turn;
    return stub;
  }

  visible(owner: string, doc: string, b: DataBlock, viewer: string, w: World = this.world()): Visible {
    return canRead({ relay: this.name, owner, doc, block: b.id, viewer }, w) ? { id: b.id, value: b.value } : { id: b.id, stub: this.stubOf(owner, b) };
  }

  /** The document, or one block of it, as the viewer may see it (§5.1): a stub for each block they may not read; nothing at all when they may read none of it. */
  read(owner: string, doc: string, viewer: string, block?: string): Result<{ blocks: Visible[] }> {
    if (!NAME.test(owner) || !DOC.test(doc)) return fail(404, "没有这份文档");
    const d = readDoc(this.root, owner, doc);
    if (!d.exists) return fail(404, "没有这份文档");
    const w = this.world();
    const wanted = block === undefined ? d.blocks : [this.find(owner, doc, block)].filter((b): b is DataBlock => b !== undefined);
    if (block !== undefined && wanted.length === 0) return fail(404, "没有这个块");
    const blocks = wanted.map((b) => this.visible(owner, doc, b, viewer, w));
    if (blocks.length > 0 && blocks.every((b) => b.stub !== undefined) && !canRead({ relay: this.name, owner, doc, viewer }, w)) return fail(403, "无权读这份文档");
    return { ok: true, blocks };
  }

  /** Whether the viewer may follow the document as a whole (a subscription). */
  mayFollow(owner: string, doc: string, viewer: string): boolean {
    return NAME.test(owner) && DOC.test(doc) && canRead({ relay: this.name, owner, doc, viewer }, this.world());
  }

  /** The blocks as a GEML document: a stub as a data block that says so. */
  renderVisible(blocks: readonly Visible[]): string {
    return blocks.map((b) => renderDataBlock(b.id, (b.value !== undefined ? b.value : { stub: true, ...b.stub }) as unknown as JsonValue)).join("");
  }

  // --- venues ---

  venueOf(owner: string, id: string): VenueDoc | undefined {
    if (!NAME.test(owner) || !NAME.test(id)) return undefined;
    const d = readDoc(this.root, owner, `venues/${id}.geml`);
    return d.exists ? foldVenue(owner, id, d, this.name) : undefined;
  }

  /** Whether the speaker is in the venue: a person by id, a guest as `guest:<id>` among the people, an agent as itself, the host always. */
  isMember(vd: VenueDoc, s: Speaker): boolean {
    switch (s.kind) {
      case "person": return vd.venue.people.includes(s.id);
      case "guest": return vd.venue.people.includes(`guest:${s.id}`);
      case "agent": return vd.agentSpeakers.get(s.name) === formatSpeaker(s);
      case "host": return true;
    }
  }

  private ownerOnly(by: TokenRecord, owner: string): Fail | undefined {
    return by.scope === "person" && by.speaker === `person:${owner}` ? undefined : fail(403, "只有场所的主人能这么做");
  }

  /** A venue made by a person, under their name (§6.2). */
  createVenue(by: TokenRecord, body: unknown): Result<{ venue: Venue }> {
    const s = parseSpeaker(by.speaker);
    if (by.scope !== "person" || s?.kind !== "person") return fail(403, "只有本人的令牌能建场所");
    return this.createVenueAs(s.id, body);
  }

  /** A venue under the person's name, themself first among its people (§6.2); an `announce` given is its first version, written without a system message; `card` names the share card a guest DM came from (§11). */
  private createVenueAs(person: string, body: unknown): Result<{ venue: Venue }> {
    const b = obj(body);
    if (b === undefined) return fail(400, "要一个 JSON 对象");
    const id = str(b["id"]), kind = str(b["kind"]);
    if (id === undefined || !NAME.test(id)) return fail(400, "场所 id 不合法");
    if (kind === undefined || !(kind in VENUE_WORDS)) return fail(400, "场所种类不合法");
    const people = strings(b["people"]), agents = strings(b["agents"]);
    for (const p of people) if (!(NAME.test(p) || parseSpeaker(p)?.kind === "guest")) return fail(400, `成员 ${p} 不合法`);
    for (const a of agents) if (parseSpeaker(a)?.kind !== "agent") return fail(400, `agent ${a} 不合法`);
    if (!people.includes(person)) people.unshift(person);
    const first = str(b["announce"]);
    if (first !== undefined && [...first].length > ANNOUNCE_LIMIT) return fail(400, `群公告最多两千字（现在 ${[...first].length} 字）`);
    const value: Record<string, JsonValue> = { kind, name: str(b["name"]) ?? id, people, agents, policy: policyOf(b["policy"]) as unknown as JsonValue, at: this.now() };
    const host = kind === "guest-dm" && agents[0] !== undefined ? parseSpeaker(agents[0]) : undefined;
    if (host?.kind === "agent") value["host"] = host.name;
    if (kind === "channel") {
      const publisher = agents[0] === undefined ? undefined : parseSpeaker(agents[0]);
      if (agents.length !== 1 || publisher?.kind !== "agent" || publisher.owner !== person || !this.agentsOf(person).includes(publisher.name)) return fail(400, "订阅频道要一个自己的 agent 发信号，只能一个");
      value["publisher"] = publisher.name;
      const price = obj(b["price"]) ?? {};
      const p: Record<string, JsonValue> = {};
      for (const k of ["month", "signal"] as const) { const n = price[k]; if (n !== undefined) { if (typeof n !== "number" || !Number.isInteger(n) || n < 0) return fail(400, `价格 ${k} 是非负整数`); p[k] = n; } }
      value["price"] = p;
    }
    for (const k of ["anchor", "parent", "card"] as const) { const v = str(b[k]); if (v !== undefined) value[k] = v; }
    const doc = `venues/${id}.geml`;
    if (readDoc(this.root, person, doc).exists) return fail(409, "场所已存在");
    const a = appendSealed(this.root, person, doc, "venue", value);
    this.emit(person, doc, a.block);
    if (first !== undefined) {
      const an = appendBlock(this.root, person, doc, nextId("announce"), (_d, prev, bid) => sealed({ id: bid, text: first, version: 1, at: this.now(), by: `person:${person}` }, prev));
      this.emit(person, doc, an.block);
    }
    return { ok: true, venue: this.venueOf(person, id)!.venue };
  }

  addMember(by: TokenRecord, owner: string, id: string, speaker: string): Result<{ venue: Venue }> {
    const denied = this.ownerOnly(by, owner);
    if (denied !== undefined) return denied;
    const vd = this.venueOf(owner, id);
    if (vd === undefined) return fail(404, "没有这个场所");
    const s = parseSpeaker(speaker);
    if (s === undefined || s.kind === "host") return fail(400, "成员不合法");
    if (s.kind === "agent" && vd.agentSpeakers.has(s.name) && vd.agentSpeakers.get(s.name) !== speaker) return fail(409, `已有一个叫 ${s.name} 的 agent`);
    if (this.isMember(vd, s)) return { ok: true, venue: vd.venue };
    const doc = `venues/${id}.geml`;
    const a = appendBlock(this.root, owner, doc, nextId("member"), (_d, prev, bid) => sealed({ id: bid, speaker, at: this.now(), by: by.speaker }, prev));
    this.emit(owner, doc, a.block);
    return { ok: true, venue: this.venueOf(owner, id)!.venue };
  }

  /** The announce replaced (§6.8): one more version, and a system message in the venue. */
  setAnnounce(by: TokenRecord, owner: string, id: string, text: string): Result<{ venue: Venue; system: Message }> {
    const denied = this.ownerOnly(by, owner);
    if (denied !== undefined) return denied;
    const vd = this.venueOf(owner, id);
    if (vd === undefined) return fail(404, "没有这个场所");
    const r = announce(vd.venue, text, by.speaker, this.now());
    if ("fault" in r) return fail(400, r.fault);
    const doc = `venues/${id}.geml`;
    const next = r.venue.announce!;
    const a = appendBlock(this.root, owner, doc, nextId("announce"), (_d, prev, bid) => sealed({ id: bid, text: next.text, version: next.version, at: next.at, by: next.by }, prev));
    this.emit(owner, doc, a.block);
    const system = this.appendSystem(owner, id, r.system);
    return { ok: true, venue: this.venueOf(owner, id)!.venue, system };
  }

  /** A message marked 决策 by any member (§6.8), once. */
  markDecision(by: TokenRecord, owner: string, id: string, messageId: string): Result<{ venue: Venue }> {
    const vd = this.venueOf(owner, id);
    if (vd === undefined) return fail(404, "没有这个场所");
    const s = parseSpeaker(by.speaker);
    if (s === undefined || by.scope === "inbox" || !this.isMember(vd, s)) return fail(403, "不是这个场所的成员");
    if (!vd.messages.some((m) => m.id === messageId)) return fail(404, "没有这条消息");
    const doc = `venues/${id}.geml`;
    const address = this.address(owner, doc, messageId);
    if (vd.venue.decisions.includes(address)) return { ok: true, venue: vd.venue };
    const a = appendBlock(this.root, owner, doc, nextId("decision"), (_d, prev, bid) => sealed({ id: bid, message: address, at: this.now(), by: by.speaker }, prev));
    this.emit(owner, doc, a.block);
    return { ok: true, venue: this.venueOf(owner, id)!.venue };
  }

  /** A system message from the host (§6.3), `sys-N`. */
  appendSystem(owner: string, id: string, text: string): Message {
    const doc = `venues/${id}.geml`;
    const a = appendBlock(this.root, owner, doc, nextId("sys"), (_d, prev, bid) => stamp({ venue: id, kind: "system", text }, { id: bid, speaker: { kind: "host" }, at: this.now(), prev }) as unknown as Record<string, JsonValue>);
    this.emit(owner, doc, a.block);
    return toMessage(a.block)!;
  }

  /**
   * A member's message, stamped by their token (rule 1) and delivered (§6.5):
   * the prompts it raises go on the agents' queues, the system messages it
   * owes into the venue. The same id again answers the message that is there.
   */
  appendMessage(by: TokenRecord, owner: string, id: string, body: unknown): Result<{ message: Message; existed: boolean; delivery: Delivery }> {
    const vd = this.venueOf(owner, id);
    if (vd === undefined) return fail(404, "没有这个场所");
    const s = parseSpeaker(by.speaker);
    if (s === undefined) return fail(401, "令牌无效");
    if (by.scope === "inbox") return fail(403, "收件箱令牌不能发言");
    if (!this.isMember(vd, s)) return fail(403, "不是这个场所的成员");
    if (vd.venue.kind === "channel") return fail(403, "订阅频道只有信号，由发布方的 agent 用 im_signal 发");
    const b = obj(body);
    if (b === undefined) return fail(400, "要一个 JSON 对象");
    const mid = str(b["id"]);
    if (mid === undefined || !BLOCK_ID.test(mid) || RESERVED.test(mid)) return fail(400, "消息 id 不合法");
    const kind = str(b["kind"]) ?? "chat";
    if (!(kind in KIND_WORDS)) return fail(400, "消息种类不合法");
    const parts = embedsOf(b["parts"]), evidence = embedsOf(b["evidence"]);
    if (typeof parts === "string") return fail(400, `parts：${parts}`);
    if (typeof evidence === "string") return fail(400, `evidence：${evidence}`);
    if (this.federation === "closed") {
      const foreign = [...parts, ...evidence].find((e) => parseAddress(e.src)?.relay !== this.name);
      if (foreign !== undefined) return fail(400, `引用了别的中继：${foreign.src}（联邦开关关着）`);
    }
    const draft: Draft = { venue: id, kind: kind as MessageKind, text: str(b["text"]) ?? "", parts, evidence };
    const source = str(b["source"]);
    if (source !== undefined) { if (!SOURCES.has(source)) return fail(400, "来源不合法"); draft.source = source as Source; }
    for (const k of ["opinion", "turn", "card", "thread", "replyTo"] as const) { const v = str(b[k]); if (v !== undefined) draft[k] = v; }
    const ask = obj(b["ask"]);
    if (ask !== undefined) {
      const a: Ask = { question: str(ask["question"]) ?? "", options: strings(ask["options"]), who: str(ask["who"]) ?? "" };
      const expires = str(ask["expires"]); if (expires !== undefined) a.expires = expires;
      const fallback = str(ask["fallback"]); if (fallback !== undefined) a.fallback = fallback;
      draft.ask = a;
    }
    const faults = draftFaults(draft, s);
    if (faults.length > 0) return fail(400, faults.join("；"));
    if (s.kind === "agent") {
      const d = densityAllows(vd.messages.slice(-200).map((m) => ({ speaker: m.speaker, at: m.at })), by.speaker, this.now(), vd.venue.policy.density);
      if (!d.ok) return fail(429, d.reason);
    }
    const session = s.kind === "agent" ? str(b["session"]) : undefined;
    const handling = s.kind === "agent" ? num(b["handling"]) : undefined;
    const expires = str(b["expires"]);
    const doc = `venues/${id}.geml`;
    const a = appendBlock(this.root, owner, doc, () => mid, (_d, prev, bid) => stamp(draft, { id: bid, speaker: s, at: this.now(), prev, ...(session !== undefined ? { session } : {}) }) as unknown as Record<string, JsonValue>);
    const message = toMessage(a.block);
    if (message === undefined) return fail(409, "这个 id 已被别的块占用");
    if (a.existed) return { ok: true, message, existed: true, delivery: NOTHING };
    this.emit(owner, doc, a.block);
    const replied = draft.replyTo === undefined ? undefined : vd.messages.find((x) => x.id === draft.replyTo)?.speaker;
    const delivery = deliver(message, this.deliveryInput(vd, handling, replied));
    for (const p of delivery.prompts) this.enqueueFor(vd, message, p, expires);
    for (const text of delivery.system) this.appendSystem(owner, id, text);
    return { ok: true, message, existed: false, delivery };
  }

  /** The agent's own policy on whose `@` it takes, from its home page; none means the venue's. */
  private agentPolicy(owner: string, name: string): { promptFrom: PromptFrom; allow: string[] } | undefined {
    const p = obj(readDoc(this.root, owner, `agents/${name}.geml`).blocks.find((b) => b.id === "agent")?.value["policy"]);
    const promptFrom = p === undefined ? undefined : str(p["promptFrom"]);
    return promptFrom !== undefined && PROMPT_FROM.has(promptFrom) ? { promptFrom: promptFrom as PromptFrom, allow: strings(p!["allow"]) } : undefined;
  }

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

  /** One prompt onto the agent's queue (§6.5), with the venue's context pack (rule 3) and the message's own parts. */
  private enqueueFor(vd: VenueDoc, m: Message, p: PromptTo, expires: string | undefined): void {
    const speaker = vd.agentSpeakers.get(p.agent);
    const a = speaker === undefined ? undefined : parseSpeaker(speaker);
    if (a === undefined || a.kind !== "agent") return;
    const doc = `queues/${a.name}.geml`;
    const id = `qi-${vd.venue.id}-${m.id}`;
    const r = appendBlock(this.root, a.owner, doc, () => id, (d) => {
      const { queue } = readQueue(d.text);
      const draft: ItemDraft = { id, prompt: m.text, sender: m.speaker, senderName: shownName(m.speaker), level: p.level, venue: vd.venue.id, venueKind: vd.venue.kind, venueName: vd.venue.name, message: `${vd.venue.address}#${m.id}`, at: m.at, hops: p.hops, context: [...contextSegment(vd.venue), ...m.parts] };
      if (expires !== undefined) draft.expires = expires;
      return enqueue(queue, draft).item as unknown as Record<string, JsonValue>;
    });
    if (!r.existed) this.emit(a.owner, doc, r.block);
  }

  // --- task cards (§8) ---

  /** A venue's members as speakers: people as `person:<id>` (a guest as it stands), agents by their speakers. */
  private venueMembers(vd: VenueDoc): string[] {
    return [...vd.venue.people.map((p) => (p.includes(":") ? p : `person:${p}`)), ...vd.agentSpeakers.values()];
  }

  /** Who may read a task card: the delegator, the granter, the worker named and every worker on a slot (each with its owner), and the members of the venue it was published in. */
  private readersOf(card: Card): string[] {
    const out = new Set<string>([card.by]);
    // The parent chain (§8.4 整棵树对委托人可见): each parent's delegator and granter, up to the root.
    let up = card.parent, hops = 0;
    while (up !== undefined && hops < 8) {
      const parent = this.cardAt(up);
      if (parent === undefined) break;
      out.add(parent.card.by);
      if (parent.card.grantFrom !== undefined) out.add(`person:${parent.card.grantFrom}`);
      up = parent.card.parent; hops++;
    }
    if (card.grantFrom !== undefined) out.add(`person:${card.grantFrom}`);
    for (const a of [...(card.worker !== undefined ? [card.worker] : []), ...card.slots.map((s) => s.agent)]) {
      out.add(a);
      const owner = personBehind(parseSpeaker(a) ?? { kind: "host" });
      if (owner !== undefined) out.add(`person:${owner}`);
    }
    if (card.venue !== undefined) {
      const [vo, vi] = card.venue.split("/");
      const vd = vo === undefined || vi === undefined ? undefined : this.venueOf(vo, vi);
      if (vd !== undefined) for (const m of this.venueMembers(vd)) out.add(m);
    }
    return [...out];
  }

  private cardAddress(owner: string, id: string): string { return this.address(owner, `cards/${id}.geml`); }

  /** The task card `cards/<id>.geml` folded; undefined for no document or a share card. */
  taskOf(owner: string, id: string): Card | undefined {
    if (!NAME.test(owner) || !NAME.test(id)) return undefined;
    const d = readDoc(this.root, owner, `cards/${id}.geml`);
    return d.exists ? foldCard(id, d.blocks) : undefined;
  }

  /** The caller as the card's rules see them: their person (an agent's owner for an agent token), their agent, never the host. */
  private actorOf(by: TokenRecord): { person?: string; agent?: string } {
    const s = parseSpeaker(by.speaker);
    if (s?.kind === "person") return { person: s.id };
    if (s?.kind === "agent") return { person: s.owner, agent: by.speaker };
    return {};
  }

  /** A transition appended, the card folded again; a fault from the table is 403 for the role and 409 for the state. */
  private moveTask(owner: string, card: Card, to: CardState, by: TokenRecord | "host", extra: Record<string, JsonValue> = {}): Result<{ card: Card }> {
    const actor = by === "host" ? { host: true } : this.actorOf(by);
    const fault = moveFault(card, to, actor);
    if (fault !== undefined) return fail(fault.startsWith("只有") ? 403 : 409, fault);
    const doc = `cards/${card.id}.geml`;
    const a = appendBlock(this.root, owner, doc, nextId("state"), (_d, prev, bid) => sealed({ id: bid, to, by: by === "host" ? "host" : by.speaker, at: this.now(), ...extra }, prev));
    this.emit(owner, doc, a.block);
    return { ok: true, card: this.taskOf(owner, card.id)! };
  }

  /** A card the delegator drafts (§8.1), under their name, its id drawn here. */
  createTask(by: TokenRecord, body: unknown): Result<{ card: Card; address: string }> {
    const s = parseSpeaker(by.speaker);
    if (by.scope !== "person" || s?.kind !== "person") return fail(403, "只有本人的令牌能起草任务卡");
    const faults = cardFaults(body);
    if (faults.length > 0) return fail(400, faults.join("；"));
    const input = cardInput(body)!;
    for (let tries = 0; tries < 16; tries++) {
      const id = `t-${randomBytes(2).toString("hex")}`;
      const doc = `cards/${id}.geml`;
      if (readDoc(this.root, s.id, doc).exists) continue;
      const a = appendSealed(this.root, s.id, doc, "card", { kind: "task", ...input, by: by.speaker, at: this.now() } as unknown as Record<string, JsonValue>);
      this.emit(s.id, doc, a.block);
      return { ok: true, card: this.taskOf(s.id, id)!, address: this.cardAddress(s.id, id) };
    }
    return fail(500, "卡号都被占了");
  }

  /** A card by its address, with its owner; nothing for an address off this relay or not a card. */
  private cardAt(address: string): { owner: string; card: Card } | undefined {
    const a = parseAddress(address);
    const m = a === undefined || a.relay !== this.name ? null : /^cards\/([^/]+)\.geml$/.exec(a.doc);
    const card = a === undefined || m === null ? undefined : this.taskOf(a.owner, m[1]!);
    return card === undefined ? undefined : { owner: a!.owner, card };
  }

  /** 改一下 (§8.1): the delegator or their agent changes a draft's fields — an edit block the fold lays over the head. */
  editTask(by: TokenRecord, owner: string, id: string, body: unknown): Result<{ card: Card }> {
    const card = this.taskOf(owner, id);
    if (card === undefined) return fail(404, "没有这张卡");
    if (!rolesOf(card, this.actorOf(by)).has("delegator")) return fail(403, "只有委托人或其 agent 能改委托书");
    if (card.state !== "draft") return fail(409, `卡在${STATE_WORDS_OF(card.state)}，发布后不能改；撤回再改`);
    const fields = Object.fromEntries(Object.entries(obj(body) ?? {}).filter(([k]) => EDITABLE.has(k)));
    if (Object.keys(fields).length === 0) return fail(400, "没有可改的字段");
    const faults = cardFaults({ ...card, ...fields });
    if (faults.length > 0) return fail(400, faults.join("；"));
    const doc = `cards/${id}.geml`;
    const a = appendBlock(this.root, owner, doc, nextId("edit"), (_d, prev, bid) => sealed({ id: bid, ...(fields as Record<string, JsonValue>), by: by.speaker, at: this.now() }, prev));
    this.emit(owner, doc, a.block);
    return { ok: true, card: this.taskOf(owner, id)! };
  }

  /** How many parents a card has above it (§8.4: two levels at most). */
  private depthOf(card: Card): number {
    let n = 0, up = card.parent;
    while (up !== undefined && n < 8) {
      const parent = this.cardAt(up);
      if (parent === undefined) break;
      n++; up = parent.card.parent;
    }
    return n;
  }

  /** 拆分 (§8.4): the worker (or its owner) or the delegator's agent splits an in-progress card into drafts under the splitter's own name, each with the parent; the children so far and the new ones sum to no more than the parent's budget; two levels at most; the parent stays 进行中 and lists them. */
  splitTask(by: TokenRecord, owner: string, id: string, body: unknown): Result<{ card: Card; children: { owner: string; id: string; address: string }[] }> {
    const card = this.taskOf(owner, id);
    if (card === undefined) return fail(404, "没有这张卡");
    if (card.state !== "in-progress") return fail(409, `卡在${STATE_WORDS_OF(card.state)}，只有进行中的卡能拆`);
    const roles = rolesOf(card, this.actorOf(by));
    if (!roles.has("worker") && !roles.has("delegator")) return fail(403, "只有接单方或委托人的 agent 能拆卡");
    const splitter = this.actorOf(by).person;
    if (splitter === undefined) return fail(403, "拆卡的要有主人");
    const raw = Array.isArray(obj(body)?.["children"]) ? (obj(body)!["children"] as unknown[]) : [];
    if (raw.length === 0) return fail(400, "子卡至少一张");
    const parentAddress = this.cardAddress(owner, id);
    const inputs = raw.map((c) => ({ ...(obj(c) ?? {}), parent: parentAddress }));
    const faults = inputs.flatMap((c, i) => { const f = cardFaults(c); return f.length > 0 ? [`第 ${i + 1} 张子卡：${f.join("；")}`] : []; });
    if (faults.length > 0) return fail(400, faults.join("；"));
    const children = inputs.map((c) => cardInput(c)!);
    const sofar = card.children.map((addr) => this.cardAt(addr)?.card).filter((c): c is Card => c !== undefined);
    const fault = splitFault(card, [...sofar, ...children], this.depthOf(card));
    if (fault !== undefined) return fail(409, fault);
    const made: { owner: string; id: string; address: string }[] = [];
    for (const input of children) {
      for (let tries = 0; tries < 16; tries++) {
        const cid = `t-${randomBytes(2).toString("hex")}`;
        const doc = `cards/${cid}.geml`;
        if (readDoc(this.root, splitter, doc).exists) continue;
        const a = appendSealed(this.root, splitter, doc, "card", { kind: "task", ...input, by: `person:${splitter}`, at: this.now() } as unknown as Record<string, JsonValue>);
        this.emit(splitter, doc, a.block);
        made.push({ owner: splitter, id: cid, address: this.cardAddress(splitter, cid) });
        break;
      }
    }
    if (made.length !== children.length) return fail(500, "卡号都被占了");
    const doc = `cards/${id}.geml`;
    const a = appendBlock(this.root, owner, doc, nextId("split"), (_d, prev, bid) => sealed({ id: bid, by: by.speaker, children: made.map((m) => m.address), at: this.now() }, prev));
    this.emit(owner, doc, a.block);
    return { ok: true, card: this.taskOf(owner, id)!, children: made };
  }

  /** The tree from a card down (§8.4 整棵树对委托人可见): for the root's delegator, worker or granter, by their own token or their agent's — not for the venue's other members, who could not read the children. */
  treeOf(owner: string, id: string, viewer: string): Result<{ tree: CardTree }> {
    const card = this.taskOf(owner, id);
    if (card === undefined) return fail(404, "没有这张卡");
    const v = parseSpeaker(viewer);
    const actor = v?.kind === "person" ? { person: v.id } : v?.kind === "agent" ? { person: v.owner, agent: viewer } : {};
    if (rolesOf(card, actor).size === 0) return fail(403, "只有委托人和接单方能看整棵树");
    const fold = (o: string, c: Card, depth: number): CardTree => ({ owner: o, id: c.id, title: c.title, state: c.state, stateWord: STATE_WORDS[c.state], by: c.by, children: depth > 8 ? [] : c.children.map((addr) => this.cardAt(addr)).filter((x): x is { owner: string; card: Card } => x !== undefined).map((x) => fold(x.owner, x.card, depth + 1)) });
    return { ok: true, tree: fold(owner, card, 0) };
  }

  /** The agent's declaration of 接单 (§9.2): the last `declare-N` block on its page, the defaults when none. */
  declarationOf(owner: string, name: string): Declaration {
    const all = readDoc(this.root, owner, `agents/${name}.geml`).blocks.filter((b) => /^declare-\d+$/.test(b.id));
    return all.length === 0 ? DEFAULT_DECLARATION : declarationOf(all[all.length - 1]!.value);
  }

  /** The owner writes the declaration (§9.2): the fields given over the current, the whole kept as one block. */
  declare(by: TokenRecord, body: unknown): Result<{ agent: string; declaration: Declaration; lines: string[] }> {
    const s = parseSpeaker(by.speaker);
    if (by.scope !== "person" || s?.kind !== "person") return fail(403, "只有主人写接单声明");
    const b = obj(body) ?? {};
    const agent = str(b["agent"]) ?? "";
    if (!NAME.test(agent) || !readDoc(this.root, s.id, `agents/${agent}.geml`).exists) return fail(404, "没有这个 agent");
    if (b["hours"] !== undefined && b["hours"] !== null && hoursOf(b["hours"]) === undefined) return fail(400, "时段写成 22:00-08:00+08:00");
    const d = declarationOf(b, this.declarationOf(s.id, agent));
    const doc = `agents/${agent}.geml`;
    const value: Record<string, JsonValue> = { open: d.open, hours: d.hours === undefined ? null : hoursString(d.hours), budget: d.budget ?? null, kinds: d.kinds, skills: d.skills, network: d.network };
    const a = appendBlock(this.root, s.id, doc, nextId("declare"), (_d, prev, bid) => sealed({ id: bid, ...value, at: this.now() }, prev));
    this.emit(s.id, doc, a.block);
    return { ok: true, agent, declaration: d, lines: declarationLines(d, this.eligibilityOf(s.id, agent)) };
  }

  private isHosted(owner: string, name: string): boolean { return this.hostedAgents().some((h) => h.person === owner && h.agent === name); }
  private isEligible(owner: string, name: string): boolean { return this.isHosted(owner, name) || this.sessionsOf(`agent:${name}@${owner}`).some((r) => r.login !== "" && r.login !== "subscription"); }
  /** The eligibility the host reports (§9.2), as words. */
  eligibilityOf(owner: string, name: string): string { return eligibilityWords(this.sessionsOf(`agent:${name}@${owner}`).map((r) => r.login), this.isHosted(owner, name)); }

  /** For a card published to a named agent and not yet claimed (§9.2): what it waits for; nothing when the agent could claim it now. */
  private sessionWait(worker: string): string | undefined {
    const a = parseSpeaker(worker);
    if (a?.kind !== "agent") return undefined;
    const d = this.declarationOf(a.owner, a.name);
    return !d.open || !this.isEligible(a.owner, a.name) || !withinHours(this.now(), d.hours) ? waitingForSession(d) : undefined;
  }

  /** The agent's page as the public sees it (§9.3 像公众号): 代 whom, the presence, the declaration's lines, three numbers, its mode, the latest public thing; 请它评 only while 接单模式 is open. */
  agentView(owner: string, name: string): Result<AgentView> {
    if (!NAME.test(owner) || !NAME.test(name) || !readDoc(this.root, owner, `agents/${name}.geml`).exists) return fail(404, "没有这个 agent");
    const speaker = `agent:${name}@${owner}`;
    const presence = this.presenceOf(speaker).presence;
    const d = this.declarationOf(owner, name);
    let accepted = 0, disputes = 0;
    for (const { card } of this.allTasks()) {
      if (!card.slots.some((s) => s.agent === speaker)) continue;
      if (card.slots.some((s) => s.agent === speaker && s.state === "accepted")) accepted++;
      if (card.transitions.some((t) => t.to === "dispute")) disputes++;
    }
    const mode = this.socialModeOf(owner, name);
    const latest = this.latestPublic(owner) ?? this.sharesOf(owner)[0]?.title;
    const eligibility = this.eligibilityOf(owner, name);
    const signals = this.signalsOf(owner, name);
    return { ok: true, owner, name, label: agentLabel(name, owner), presence, presenceWord: presenceText(presence, {}), eligibility, declaration: d, lines: declarationLines(d, eligibility), numbers: { accepted, reviews: 0, disputes }, mode, modeWord: MODE_WORDS[mode], ...(latest !== undefined ? { latest } : {}), askable: d.open, ...(signals.length > 0 ? { performance: this.performanceOf(owner, name) } : {}) };
  }

  /** 发布 (§8.2): into a venue the delegator is in; a thread anchored on the card, a 卡片 message in the venue; 派出 claims the delegator's own agent at once. */
  publishTask(by: TokenRecord, owner: string, id: string, body: unknown): Result<{ card: Card }> {
    const card = this.taskOf(owner, id);
    if (card === undefined) return fail(404, "没有这张卡");
    const key = str(obj(body)?.["venue"]) ?? "";
    const [vo, vi] = key.split("/");
    const vd = vo === undefined || vi === undefined ? undefined : this.venueOf(vo, vi);
    if (vd === undefined) return fail(404, "没有这个场所");
    const fault = moveFault(card, "open", this.actorOf(by));
    if (fault !== undefined) return fail(403, fault);
    const s = parseSpeaker(by.speaker)!;
    if (!this.isMember(vd, s)) return fail(403, "委托人不在这个场所里");
    const held = rewardTotal(card);
    if (held > 0) {
      const caps = this.capsOf(owner);
      if (held > caps.perCard) return fail(403, `超过每张卡的额度 ${caps.perCard}（要托管 ${held}）`);
      const balance = this.balance(owner);
      if (balance < held) return fail(403, `积分不够：钱包 ${balance}，要托管 ${held}`);
    }
    const thread = `th-${id}`;
    if (this.venueOf(owner, thread) === undefined) {
      const made = this.createVenueAs(owner, { id: thread, kind: "thread", name: card.title, people: [], agents: [], anchor: `${this.cardAddress(owner, id)}#card`, parent: key });
      if (!made.ok) return made;
    }
    const moved = this.moveTask(owner, card, "open", by, { venue: key, thread });
    if (!moved.ok) return moved;
    if (held > 0) this.transfer({ kind: "escrow", from: `person:${owner}`, to: holdOf("card", `${owner}/${id}`), amount: held, note: "发布时托管", ref: this.cardAddress(owner, id), card: id });
    this.appendMessage(by, vo!, vi!, { id: `m-${id}`, kind: "card", card: this.cardAddress(owner, id), text: `任务卡 #${id} ${card.title}` });
    if (card.direction === "dispatch" && card.worker !== undefined) return this.seat(owner, moved.card, card.worker, by.speaker);
    return moved;
  }

  /** A worker seated on a slot: the claim block, the state after it (待放行 when a grant is wanted, else 进行中 with the start prompt), the worker and its owner in the thread. */
  private seat(owner: string, card: Card, agent: string, by: string): Result<{ card: Card }> {
    const doc = `cards/${card.id}.geml`;
    const a = appendBlock(this.root, owner, doc, nextId("claim"), (_d, prev, bid) => sealed({ id: bid, agent, by, at: this.now() }, prev));
    this.emit(owner, doc, a.block);
    const slot = Number(a.block.id.slice("claim-".length));
    const s = parseSpeaker(agent);
    if (card.thread !== undefined && s?.kind === "agent") { this.joinVenue(owner, card.thread, agent); this.joinVenue(owner, card.thread, `person:${s.owner}`); }
    const to: CardState = card.grantFrom !== undefined ? "awaiting-grant" : "in-progress";
    const moved = this.moveTask(owner, this.taskOf(owner, card.id)!, to, "host", { slot });
    if (!moved.ok) return moved;
    if (to === "in-progress") this.promptWorker(owner, moved.card, slot);
    return moved;
  }

  /** 认领 (§8.2): the lock, or a slot of a contest; only the worker named when one is; an agent with an API or self-hosted session (§9.2, §15 item 17). */
  claimTask(by: TokenRecord, owner: string, id: string, body: unknown): Result<{ card: Card }> {
    const card = this.taskOf(owner, id);
    if (card === undefined) return fail(404, "没有这张卡");
    const s = parseSpeaker(by.speaker);
    let agent: string;
    if (s?.kind === "agent" && by.scope === "agent") agent = by.speaker;
    else if (s?.kind === "person" && by.scope === "person") {
      const name = str(obj(body)?.["agent"]);
      if (name === undefined || !readDoc(this.root, s.id, `agents/${name}.geml`).exists) return fail(400, "要一个自己名下的 agent");
      agent = `agent:${name}@${s.id}`;
    } else return fail(403, "要 agent 的令牌，或本人的令牌加 agent 的名字");
    if (card.mode.kind === "contest" && openSlots(card) === 0) return fail(409, "没有空槽了");
    if (!(card.mode.kind === "contest" && card.state === "in-progress")) {
      const fault = moveFault(card, card.grantFrom !== undefined ? "awaiting-grant" : "in-progress", { ...this.actorOf(by), host: true });
      if (fault !== undefined) return fail(409, fault);
    }
    if (card.worker !== undefined && card.worker !== agent) return fail(403, `这张卡派给了 ${shownName(card.worker)}`);
    const name = shownName(agent);
    const who = parseSpeaker(agent) as Extract<Speaker, { kind: "agent" }>;
    if (!this.isEligible(who.owner, who.name)) return fail(403, `订阅登录的会话不接单（${name} 还没有 API 或自托管的会话）`);
    const decl = this.declarationOf(who.owner, who.name);
    if (!decl.open) return fail(403, `${name} 没开接单模式`);
    if (!withinHours(this.now(), decl.hours)) return fail(403, `${name} 只在${hoursWords(decl.hours)}接单`);
    if (card.mode.kind === "contest" && card.state === "in-progress") {
      const doc = `cards/${id}.geml`;
      const a = appendBlock(this.root, owner, doc, nextId("claim"), (_d, prev, bid) => sealed({ id: bid, agent, by: by.speaker, at: this.now() }, prev));
      this.emit(owner, doc, a.block);
      const slot = Number(a.block.id.slice("claim-".length));
      const st = appendBlock(this.root, owner, doc, nextId("state"), (_d, prev, bid) => sealed({ id: bid, to: "in-progress", by: "host", at: this.now(), slot }, prev));
      this.emit(owner, doc, st.block);
      if (card.thread !== undefined && s !== undefined) { this.joinVenue(owner, card.thread, agent); this.joinVenue(owner, card.thread, `person:${personBehind(parseSpeaker(agent)!) ?? ""}`); }
      const after = this.taskOf(owner, id)!;
      this.promptWorker(owner, after, slot);
      return { ok: true, card: after };
    }
    return this.seat(owner, card, agent, by.speaker);
  }

  private joinVenue(owner: string, id: string, speaker: string): void {
    const vd = this.venueOf(owner, id);
    const s = parseSpeaker(speaker);
    if (vd === undefined || s === undefined || s.kind === "host" || this.isMember(vd, s)) return;
    const doc = `venues/${id}.geml`;
    const a = appendBlock(this.root, owner, doc, nextId("member"), (_d, prev, bid) => sealed({ id: bid, speaker, at: this.now(), by: "host" }, prev));
    this.emit(owner, doc, a.block);
  }

  /** A prompt onto an agent's queue about a card: the delegator as its sender, the card's thread as its venue, the card's scope on it. */
  private promptCard(owner: string, card: Card, agent: string, kind: string, n: number, prompt: string, context: Embed[]): void {
    const a = parseSpeaker(agent);
    if (a?.kind !== "agent") return;
    const thread = card.thread === undefined ? undefined : this.venueOf(owner, card.thread);
    const level = levelOf(parseSpeaker(card.by) ?? { kind: "host" }, { owner: a.owner, trusted: this.trustedOf(a.owner), members: thread?.venue.people ?? [] });
    const doc = `queues/${a.name}.geml`;
    const id = `qi-${card.id}-${kind}-${n}`;
    const r = appendBlock(this.root, a.owner, doc, () => id, (d) => {
      const { queue } = readQueue(d.text);
      const draft: ItemDraft = { id, prompt, sender: card.by, senderName: shownName(card.by), level, venue: card.thread ?? card.id, venueKind: "thread", venueName: card.title, message: this.cardAddress(owner, card.id), at: this.now(), hops: 0, context, card: { id: card.id, address: this.cardAddress(owner, card.id), title: card.title, tools: card.tools, venueOfWork: card.venueOfWork, ...(card.budget.credits !== undefined ? { credits: card.budget.credits } : {}) } };
      if (card.budget.deadline !== undefined) draft.expires = card.budget.deadline;
      return enqueue(queue, draft).item as unknown as Record<string, JsonValue>;
    });
    if (!r.existed) this.emit(a.owner, doc, r.block);
  }

  /** The start prompt (§8.1, §8.4 接力): the card is the worker's, the 委托书, the half-done version to go on from when there is one. */
  private promptWorker(owner: string, card: Card, slot: number): void {
    const agent = card.slots.find((s) => s.n === slot)?.agent;
    if (agent === undefined) return;
    const half = [...card.versions].reverse().find((v) => v.halfDone);
    const address = this.cardAddress(owner, card.id);
    const text = `任务卡 #${card.id}「${card.title}」归你了（${DIRECTION_WORDS[card.direction]}）。\n${briefText(card)}\n${half === undefined ? "" : `接力：从第 ${half.version} 版（半成品）和记录接着干。\n`}${CARD_HOWTO}`;
    const context: Embed[] = [{ src: `${address}#card` }, ...(half === undefined ? [] : [{ src: `${address}#deliverable-${half.version}` }]), ...card.context.includes.map((src) => ({ src }))];
    this.promptCard(owner, card, agent, "start", card.transitions.length, text, context);
  }

  /** 放行 (§8.2): the granter opens their thing; the card goes on. */
  grantTask(by: TokenRecord, owner: string, id: string): Result<{ card: Card }> {
    const card = this.taskOf(owner, id);
    if (card === undefined) return fail(404, "没有这张卡");
    const slot = card.slots.find((s) => s.state === "claimed")?.n;
    const moved = this.moveTask(owner, card, "in-progress", by, slot === undefined ? {} : { slot });
    if (moved.ok && slot !== undefined) this.promptWorker(owner, moved.card, slot);
    return moved;
  }

  private workerOnly(card: Card, by: TokenRecord, what: string): Fail | undefined {
    return rolesOf(card, this.actorOf(by)).has("worker") ? undefined : fail(403, `只有接单方能${what}`);
  }

  /** 记录 (§8.1): a note with evidence, hung on the card; the heartbeat. */
  noteTask(by: TokenRecord, owner: string, id: string, body: unknown): Result<{ card: Card }> {
    const card = this.taskOf(owner, id);
    if (card === undefined) return fail(404, "没有这张卡");
    const denied = this.workerOnly(card, by, "写记录");
    if (denied !== undefined) return denied;
    if (card.state !== "in-progress") return fail(409, `卡在${STATE_WORDS_OF(card.state)}，不是进行中`);
    const b = obj(body) ?? {};
    const text = (str(b["text"]) ?? "").trim();
    if (text === "") return fail(400, "记录为空");
    const evidence = embedsOf(b["evidence"]);
    if (typeof evidence === "string") return fail(400, `evidence：${evidence}`);
    const doc = `cards/${id}.geml`;
    const a = appendBlock(this.root, owner, doc, nextId("note"), (_d, prev, bid) => sealed({ id: bid, by: by.speaker, at: this.now(), text, evidence: evidence as unknown as JsonValue }, prev));
    this.emit(owner, doc, a.block);
    return { ok: true, card: this.taskOf(owner, id)! };
  }

  /** A deliverable version appended (§8.6): numbered after the last, stamped by the worker. */
  private appendVersion(owner: string, card: Card, by: string, body: Record<string, unknown>, halfDone: boolean): number {
    const version = card.versions.length + 1;
    const prevVersion = card.versions[card.versions.length - 1]?.version;
    const doc = `cards/${card.id}.geml`;
    const a = appendBlock(this.root, owner, doc, nextId("deliverable"), (_d, prev) => sealed({ ...(body as Record<string, JsonValue>), version, ...(prevVersion !== undefined ? { prevVersion } : {}), by, at: this.now(), halfDone } as Record<string, JsonValue>, prev));
    this.emit(owner, doc, a.block);
    return version;
  }

  /** 交回 (§8.2, §8.4 接力): by the worker, or the delegator asking; a half-done version may come with it; the card is open again. */
  giveBackTask(by: TokenRecord, owner: string, id: string, body: unknown): Result<{ card: Card }> {
    const card = this.taskOf(owner, id);
    if (card === undefined) return fail(404, "没有这张卡");
    const b = obj(body) ?? {};
    const working = card.slots.find((s) => s.state === "working");
    const deliverable = obj(b["deliverable"]);
    if (deliverable !== undefined) {
      const faults = deliverableFaults(deliverable);
      if (faults.length > 0) return fail(400, faults.join("；"));
      const fault = moveFault(card, "open", this.actorOf(by));
      if (fault !== undefined) return fail(403, fault);
      this.appendVersion(owner, card, working?.agent ?? by.speaker, deliverable, true);
    }
    const note = str(b["note"]);
    return this.moveTask(owner, this.taskOf(owner, id)!, "open", by, { ...(note !== undefined ? { note } : {}), ...(working !== undefined ? { slot: working.n } : {}) });
  }

  /** 交付 (§8.6): the version on the card, 已交付 then 验收中 at once, the verification prompt to the delegator's agent. */
  deliverTask(by: TokenRecord, owner: string, id: string, body: unknown): Result<{ card: Card }> {
    const card = this.taskOf(owner, id);
    if (card === undefined) return fail(404, "没有这张卡");
    const fault = moveFault(card, "delivered", this.actorOf(by));
    if (fault !== undefined) return fail(fault.startsWith("只有") ? 403 : 409, fault);
    const faults = deliverableFaults(body);
    if (faults.length > 0) return fail(400, faults.join("；"));
    const mine = card.slots.find((s) => s.state === "working" && (s.agent === by.speaker || personBehind(parseSpeaker(s.agent) ?? { kind: "host" }) === this.actorOf(by).person));
    const version = this.appendVersion(owner, card, mine?.agent ?? by.speaker, obj(body)!, false);
    const delivered = this.moveTask(owner, this.taskOf(owner, id)!, "delivered", by, mine === undefined ? {} : { slot: mine.n });
    if (!delivered.ok) return delivered;
    const verifying = this.moveTask(owner, delivered.card, "verifying", "host");
    if (!verifying.ok) return verifying;
    const delegator = personBehind(parseSpeaker(card.by) ?? { kind: "host" });
    const verifier = delegator === undefined ? undefined : this.agentsOf(delegator)[0];
    if (delegator !== undefined && verifier !== undefined) {
      const machine = card.accepts.filter((c) => MACHINE.includes(c.verify.kind)).map((c) => `${c.n} ${acceptTag(c)}`);
      const review = card.accepts.filter((c) => c.verify.kind === "review").map((c) => `${c.n} ${acceptTag(c)}`);
      const parts = [...(machine.length > 0 ? [`在你的沙箱里重跑机器验法（${machine.join("；")}）`] : []), ...(review.length > 0 ? [`审读 ${review.join("；")}`] : [])];
      const text = `任务卡 #${id}「${card.title}」交付了第 ${version} 版。验收：${parts.length > 0 ? parts.join("，") : "等人勾"}，然后用 im_card report 贴验收报告。`;
      const address = this.cardAddress(owner, id);
      this.promptCard(owner, verifying.card, `agent:${verifier}@${delegator}`, "verify", version, text, [{ src: `${address}#deliverable-${version}` }, { src: `${address}#card` }]);
    }
    return verifying;
  }

  /** The settlement a state note records at 已接受 (§8.2); the ledger moves in `settle`. */
  private settlementNote(card: Card): string {
    switch (card.reward.kind) {
      case "none": return "无报酬";
      case "tip": return "打赏自愿";
      case "escrow": return `结算 ${card.reward.credits} 积分（托管）`;
      case "prize": return `结算 ${card.reward.credits} 积分（奖金）${card.reward.participation === undefined ? "" : `· 参与补偿 ${card.reward.participation}`}`;
    }
  }

  private acceptedSlot(card: Card): number | undefined { return [...card.slots].reverse().find((s) => s.state === "delivered")?.n; }

  /** The hold paid out (§9.1) once the card has ended: the worker's owner gets the reward (an arbitration's share instead) less the platform's cut, each other seated slot's owner the participation of a prize, the delegator what is left. */
  private settle(owner: string, card: Card, o: { worker?: string; workerShare?: number; ref?: string; why?: string } = {}): void {
    const hold = holdOf("card", `${owner}/${card.id}`);
    const left = (): number => balanceOf(this.ledgerOf(owner), hold);
    if (left() <= 0) return;
    const ref = o.ref ?? this.cardAddress(owner, card.id);
    const worker = o.worker ?? [...card.slots].reverse().find((s) => s.state === "accepted")?.agent;
    const ownerOf = (agent: string): string | undefined => personBehind(parseSpeaker(agent) ?? { kind: "host" });
    const reward = card.reward.kind === "escrow" || card.reward.kind === "prize" ? card.reward.credits : 0;
    const share = Math.min(left(), o.workerShare ?? reward);
    const to = worker === undefined ? undefined : ownerOf(worker);
    if (to !== undefined && share > 0) {
      const fee = Math.floor((share * this.feePercent) / 100);
      this.transfer({ kind: "settle", from: hold, to: `person:${to}`, amount: share - fee, note: o.workerShare === undefined ? "验收过" : "仲裁", ref, agent: shownName(worker!), card: card.id });
      if (fee > 0) this.transfer({ kind: "fee", from: hold, to: PLATFORM, amount: fee, note: `平台抽成 ${this.feePercent}%`, ref, card: card.id });
    }
    if (card.reward.kind === "prize" && card.reward.participation !== undefined && o.workerShare === undefined) {
      for (const s of card.slots) {
        const p = ownerOf(s.agent);
        if (s.agent === worker || p === undefined || left() < card.reward.participation) continue;
        this.transfer({ kind: "settle", from: hold, to: `person:${p}`, amount: card.reward.participation, note: "参与补偿", ref, agent: shownName(s.agent), card: card.id });
      }
    }
    const rest = left();
    if (rest > 0) this.transfer({ kind: "refund", from: hold, to: `person:${owner}`, amount: rest, note: o.why ?? "结余退回", ref, card: card.id });
  }

  /** 验收报告 (§8.3): by the delegator or their agent, against the latest version; comments anchored on the package; then the rule decides: 已接受, 要改 (the worker prompted), or the delegator's 验收 inbox entry. */
  reportTask(by: TokenRecord, owner: string, id: string, body: unknown): Result<{ card: Card; decision: "accepted" | "changes" | "inbox" }> {
    const card = this.taskOf(owner, id);
    if (card === undefined) return fail(404, "没有这张卡");
    if (!rolesOf(card, this.actorOf(by)).has("delegator")) return fail(403, "只有委托人或其 agent 能写验收报告");
    if (card.state !== "verifying") return fail(409, `卡在${STATE_WORDS_OF(card.state)}，不是验收中`);
    const b = obj(body) ?? {};
    const version = card.versions[card.versions.length - 1]?.version ?? 0;
    const results = (Array.isArray(b["results"]) ? b["results"] : []).map(obj).filter((r): r is Record<string, JsonValue> => r !== undefined && typeof r["criterion"] === "number").map((r) => ({ criterion: r["criterion"] as number, met: r["met"] === true ? true : r["met"] === false ? false : null, ...(str(r["note"]) !== undefined ? { note: r["note"] as string } : {}) }));
    const doc = `cards/${id}.geml`;
    const rep = appendBlock(this.root, owner, doc, nextId("report"), (_d, prev, bid) => sealed({ id: bid, version, by: by.speaker, at: this.now(), results: results as unknown as JsonValue }, prev));
    this.emit(owner, doc, rep.block);
    const comments = (Array.isArray(b["comments"]) ? b["comments"] : []).map(obj).filter((c): c is Record<string, JsonValue> => c !== undefined && (str(c["text"]) ?? "") !== "");
    for (const c of comments) {
      const a = appendBlock(this.root, owner, doc, nextId("comment"), (_d, prev, bid) => sealed({ id: bid, by: by.speaker, at: this.now(), version, anchor: str(c["anchor"]) ?? "", text: c["text"] as string }, prev));
      this.emit(owner, doc, a.block);
    }
    const decision = acceptance(card, { version, by: by.speaker, at: this.now(), results }, { autoAccept: true });
    const now = this.taskOf(owner, id)!;
    if (decision === "accepted") {
      const slot = this.acceptedSlot(now);
      const moved = this.moveTask(owner, now, "accepted", "host", { note: this.settlementNote(now), ...(slot !== undefined ? { slot } : {}) });
      if (moved.ok) this.settle(owner, moved.card);
      return moved.ok ? { ok: true, card: moved.card, decision } : moved;
    }
    if (decision === "changes") {
      const moved = this.moveTask(owner, now, "changes", "host");
      if (!moved.ok) return moved;
      const worker = [...moved.card.slots].reverse().find((s) => s.state === "delivered")?.agent;
      if (worker !== undefined) {
        const lines = comments.length > 0 ? comments.map((c) => `${str(c["anchor"]) ?? ""}：${c["text"] as string}`) : results.filter((r) => r.met === false).map((r) => `第 ${r.criterion} 条没过${r.note === undefined ? "" : `：${r.note}`}`);
        const address = this.cardAddress(owner, id);
        this.promptCard(owner, moved.card, worker, "changes", moved.card.transitions.length, `任务卡 #${id}「${card.title}」第 ${version} 版要改：\n${lines.join("\n")}\n改好后用 im_card deliver 再交一版。`, [{ src: `${address}#report-${rep.block.id.slice("report-".length)}` }, { src: `${address}#deliverable-${version}` }]);
      }
      return { ok: true, card: moved.card, decision };
    }
    return { ok: true, card: now, decision };
  }

  /** 接受 by the delegator (§8.2), from 验收中 or a dispute. */
  acceptTask(by: TokenRecord, owner: string, id: string): Result<{ card: Card }> {
    const card = this.taskOf(owner, id);
    if (card === undefined) return fail(404, "没有这张卡");
    const slot = this.acceptedSlot(card);
    const moved = this.moveTask(owner, card, "accepted", by, { note: this.settlementNote(card), ...(slot !== undefined ? { slot } : {}) });
    if (moved.ok) this.settle(owner, moved.card);
    return moved;
  }

  /** 要改 by the delegator themself (§8.2): comments anchored on the package, the worker prompted. */
  changesTask(by: TokenRecord, owner: string, id: string, body: unknown): Result<{ card: Card }> {
    const card = this.taskOf(owner, id);
    if (card === undefined) return fail(404, "没有这张卡");
    const moved = this.moveTask(owner, card, "changes", by);
    if (!moved.ok) return moved;
    const version = card.versions[card.versions.length - 1]?.version ?? 0;
    const doc = `cards/${id}.geml`;
    const comments = (Array.isArray(obj(body)?.["comments"]) ? (obj(body)!["comments"] as unknown[]) : []).map(obj).filter((c): c is Record<string, JsonValue> => c !== undefined && (str(c["text"]) ?? "") !== "");
    for (const c of comments) {
      const a = appendBlock(this.root, owner, doc, nextId("comment"), (_d, prev, bid) => sealed({ id: bid, by: by.speaker, at: this.now(), version, anchor: str(c["anchor"]) ?? "", text: c["text"] as string }, prev));
      this.emit(owner, doc, a.block);
    }
    const after = this.taskOf(owner, id)!;
    const worker = [...after.slots].reverse().find((s) => s.state === "delivered")?.agent;
    if (worker !== undefined) this.promptCard(owner, after, worker, "changes", after.transitions.length, `任务卡 #${id}「${card.title}」第 ${version} 版要改：\n${comments.map((c) => `${str(c["anchor"]) ?? ""}：${c["text"] as string}`).join("\n")}\n改好后用 im_card deliver 再交一版。`, [{ src: `${this.cardAddress(owner, id)}#deliverable-${version}` }]);
    return { ok: true, card: after };
  }

  /** The worker takes the changes up (§8.2 要改回到进行中). */
  resumeTask(by: TokenRecord, owner: string, id: string): Result<{ card: Card }> {
    const card = this.taskOf(owner, id);
    if (card === undefined) return fail(404, "没有这张卡");
    const slot = [...card.slots].reverse().find((s) => s.state === "delivered")?.n;
    return this.moveTask(owner, card, "in-progress", by, slot === undefined ? {} : { slot });
  }

  /** 争议 (§8.2): either side's owner, with why (两位主人谈: an agent does not raise one); out of it only 已接受 or 关闭. */
  disputeTask(by: TokenRecord, owner: string, id: string, body: unknown): Result<{ card: Card }> {
    const card = this.taskOf(owner, id);
    if (card === undefined) return fail(404, "没有这张卡");
    if (by.scope !== "person") return fail(403, "争议由主人提出，不是 agent");
    const reason = str(obj(body)?.["reason"]);
    return this.moveTask(owner, card, "dispute", by, reason === undefined ? {} : { note: reason });
  }

  /** The dispute settled by the delegator (§8.2, §9.1): 已接受 pays the worker, 关闭 refunds; `workerShare` with an `arbitration` reference splits the hold the arbiter's way. */
  settleTask(by: TokenRecord, owner: string, id: string, body: unknown): Result<{ card: Card }> {
    const card = this.taskOf(owner, id);
    if (card === undefined) return fail(404, "没有这张卡");
    const b = obj(body) ?? {};
    const outcome = str(b["outcome"]);
    if (outcome !== "accepted" && outcome !== "closed") return fail(400, "结果是 accepted 或 closed");
    const workerShare = b["workerShare"] === undefined ? undefined : num(b["workerShare"]);
    if (b["workerShare"] !== undefined && (workerShare === undefined || !Number.isInteger(workerShare) || workerShare < 0)) return fail(400, "workerShare 是非负整数");
    const arbitration = str(b["arbitration"]);
    const slot = this.acceptedSlot(card);
    const worker = card.slots.find((s) => s.n === slot)?.agent;
    const moved = this.moveTask(owner, card, outcome, by, outcome === "accepted" ? { note: this.settlementNote(card), ...(slot !== undefined ? { slot } : {}) } : {});
    if (!moved.ok) return moved;
    this.settle(owner, moved.card, { ...(worker !== undefined ? { worker } : {}), ...(arbitration !== undefined ? { ref: arbitration } : {}), ...(outcome === "closed" ? { workerShare: workerShare ?? 0, why: arbitration === undefined ? "争议关闭" : "仲裁" } : workerShare !== undefined ? { workerShare, why: "仲裁" } : {}) });
    return moved;
  }

  closeTask(by: TokenRecord, owner: string, id: string, body: unknown): Result<{ card: Card }> {
    const card = this.taskOf(owner, id);
    if (card === undefined) return fail(404, "没有这张卡");
    const reason = str(obj(body)?.["reason"]);
    const moved = this.moveTask(owner, card, "closed", by, reason === undefined ? {} : { note: reason });
    if (moved.ok) this.settle(owner, moved.card, { workerShare: 0, why: "关闭" });
    return moved;
  }

  /** The card as a reader sees it: the record, its address, the 委托书, the progress line, whom it waits on, the heartbeat. */
  taskView(owner: string, id: string, viewer: string): Result<{ card: Card; address: string; brief: { label: string; text: string }[]; progress: string; waitingOn?: string; heartbeat: string }> {
    const card = this.taskOf(owner, id);
    if (card === undefined) return fail(404, "没有这张卡");
    if (!canRead({ relay: this.name, owner, doc: `cards/${id}.geml`, viewer }, this.world())) return fail(403, "无权看这张卡");
    const w = (card.state === "open" && card.worker !== undefined ? this.sessionWait(card.worker) : undefined) ?? waitingOn(card);
    return { ok: true, card, address: this.cardAddress(owner, id), brief: briefLines(card), progress: progressLine(card), ...(w !== undefined ? { waitingOn: w } : {}), heartbeat: heartbeatWords(card, this.now()) };
  }

  /** Every task card on the relay, with its owner. */
  private allTasks(): { owner: string; card: Card }[] {
    const out: { owner: string; card: Card }[] = [];
    for (const owner of listOwners(this.root)) for (const d of listDocs(this.root, owner, "cards")) {
      const card = this.taskOf(owner, d.slice("cards/".length, -".geml".length));
      if (card !== undefined) out.push({ owner, card });
    }
    return out;
  }

  /** The cards a person is on, and as what: the delegator, a worker's owner, the granter. */
  tasksOf(person: string): { owner: string; id: string; title: string; state: CardState; direction: string; role: Role }[] {
    const out: { owner: string; id: string; title: string; state: CardState; direction: string; role: Role }[] = [];
    for (const { owner, card } of this.allTasks()) {
      const roles = rolesOf({ ...card, slots: card.slots.map((s) => ({ ...s, state: "working" as const })) }, { person });
      const role = roles.has("delegator") ? "delegator" : roles.has("worker") ? "worker" : roles.has("granter") ? "granter" : undefined;
      if (role !== undefined) out.push({ owner, id: card.id, title: card.title, state: card.state, direction: card.direction, role });
    }
    return out;
  }

  /** The minute's sweep (§8.2): a card silent past the limit is given back by the relay, its slot returned. */
  tick(now: string = this.now()): { returned: string[]; packets: string[]; lapsed: string[] } {
    const returned: string[] = [];
    for (const { owner, card } of this.allTasks()) {
      if (!isStale(card, now, GIVE_BACK_AFTER_MS)) continue;
      const slot = card.slots.find((s) => s.state === "working")?.n;
      const moved = this.moveTask(owner, card, "open", "host", { note: "超时自动交回", ...(slot !== undefined ? { slot } : {}) });
      if (moved.ok) returned.push(card.id);
    }
    const packets: string[] = [];
    for (const owner of listOwners(this.root)) for (const d of listDocs(this.root, owner, "packets")) {
      const id = d.slice("packets/".length, -".geml".length);
      const p = this.packetDoc(owner, id);
      if (p === undefined || p.returned || !packetExpired(p.at, now)) continue;
      this.returnPacket(owner, id);
      packets.push(id);
    }
    // Lapsed subscribers leave their channels (§10.4): a month over, or the signals bought all received.
    const lapsed: string[] = [];
    for (const owner of listOwners(this.root)) for (const d of listDocs(this.root, owner, "venues")) {
      const vd = this.venueOf(owner, d.slice("venues/".length, -".geml".length));
      if (vd?.venue.kind !== "channel") continue;
      for (const p of vd.venue.people) {
        if (p === owner || p.includes(":") || this.subscriptionOf(vd, p, now).active) continue;
        const a = appendBlock(this.root, owner, d, nextId("leave"), (_x, prev, bid) => sealed({ id: bid, speaker: `person:${p}`, at: now, why: "订阅到期" }, prev));
        this.emit(owner, d, a.block);
        lapsed.push(`${owner}/${vd.venue.id}/${p}`);
      }
    }
    return { returned, packets, lapsed };
  }

  /** The card needs of a person (§6.9): 验收 for the delegator once the report is in, 卡住 for a silent worker's owner, 放行 for the granter of a card 待放行. */
  private cardNeeds(person: string, now: string): Need[] {
    const out: Need[] = [];
    for (const { owner, card } of this.allTasks()) {
      const address = this.cardAddress(owner, card.id);
      const delegator = personBehind(parseSpeaker(card.by) ?? { kind: "host" });
      if (delegator === person && card.state === "verifying") {
        const version = card.versions[card.versions.length - 1]?.version;
        const report = [...card.reports].reverse().find((r) => r.version === version);
        if (version !== undefined && report !== undefined) {
          const n = card.reports.indexOf(report) + 1;
          const machine = card.accepts.filter((c) => MACHINE.includes(c.verify.kind));
          const passed = machine.filter((c) => report.results.find((r) => r.criterion === c.n)?.met === true).length;
          const waiting = card.accepts.filter((c) => !MACHINE.includes(c.verify.kind)).map((c) => c.n);
          const settle = card.reward.kind === "escrow" || card.reward.kind === "prize" ? card.reward.credits : undefined;
          out.push({ kind: "accept", key: `${address}#report-${n}`, text: `#${card.id} 第 ${version} 版 · 机器验法 ${passed}/${machine.length} 过${waiting.length > 0 ? ` · 第 ${waiting.join("、")} 条等你` : ""}`, actions: defaultActions("accept", settle === undefined ? {} : { settle }), since: report.at, venue: card.thread ?? card.id, level: 0 });
        }
      }
      if (card.state === "in-progress" && isStale(card, now, STUCK_AFTER_MS)) {
        for (const s of card.slots) {
          if (s.state !== "working" || personBehind(parseSpeaker(s.agent) ?? { kind: "host" }) !== person) continue;
          const last = card.notes[card.notes.length - 1]?.at ?? card.transitions[card.transitions.length - 1]?.at ?? card.at;
          out.push({ kind: "stuck", key: `${address}#stuck-${s.n}`, text: `#${card.id} ${Math.floor((Date.parse(now) - Date.parse(last)) / 60_000)} 分钟没写记录（${shownName(s.agent)}）`, actions: defaultActions("stuck", {}), since: last, venue: card.thread ?? card.id, level: 0 });
        }
      }
      if (card.state === "awaiting-grant" && card.grantFrom === person) {
        const claim = [...card.slots].reverse().find((s) => s.state === "claimed");
        if (claim !== undefined) out.push({ kind: "grant", key: `${address}#claim-${claim.n}`, text: `${shownName(claim.agent)} 接了 #${card.id}「${card.title}」，等你放开自己的${card.direction === "dispatch" ? "实物" : "输入"}`, actions: defaultActions("grant", {}), since: claim.at, venue: card.thread ?? card.id, level: 0 });
      }
    }
    return out;
  }

  // --- share cards and guests (§11, transport §7.1) ---

  /** The card block of `cards/<id>.geml`, when it is a share card. */
  private readShareDoc(owner: string, id: string): ShareCard | undefined {
    if (!NAME.test(owner) || !NAME.test(id)) return undefined;
    return readShare(readDoc(this.root, owner, `cards/${id}.geml`).blocks.find((b) => b.id === "card")?.value, id);
  }

  /** Whose a card is: ids are the relay's (`/c/<卡>` names no owner), so the owners are scanned. */
  private shareOwner(id: string): string | undefined {
    return NAME.test(id) ? listOwners(this.root).find((o) => o !== RELAY_OWNER && this.readShareDoc(o, id) !== undefined) : undefined;
  }

  /** A share card under the owner's name (§11): a delivery package without an acceptance mapping plus the public range; the agent must be theirs; the id is drawn here. */
  createShare(by: TokenRecord, body: unknown): Result<{ card: ShareCard; url: string }> {
    const s = parseSpeaker(by.speaker);
    if (by.scope !== "person" || s?.kind !== "person") return fail(403, "只有本人的令牌能发分享卡");
    const faults = shareFaults(body);
    if (faults.length > 0) return fail(400, faults.join("；"));
    const input = shareInput(body)!;
    if (!readDoc(this.root, s.id, `agents/${input.agent}.geml`).exists) return fail(400, `没有这个 agent：${input.agent}`);
    for (let tries = 0; tries < 16; tries++) {
      const id = `c-${randomBytes(2).toString("hex")}`;
      if (this.shareOwner(id) !== undefined) continue;
      const doc = `cards/${id}.geml`;
      const a = appendSealed(this.root, s.id, doc, "card", { kind: "share", public: true, at: this.now(), ...input } as unknown as Record<string, JsonValue>);
      this.emit(s.id, doc, a.block);
      return { ok: true, card: this.readShareDoc(s.id, id)!, url: `/c/${id}` };
    }
    return fail(500, "卡号都被占了");
  }

  /** A person's share cards, newest first. */
  sharesOf(person: string): ShareCard[] {
    return listDocs(this.root, person, "cards").map((d) => this.readShareDoc(person, d.slice("cards/".length, -".geml".length))).filter((c): c is ShareCard => c !== undefined).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  }

  /** The owner's guest quota (§9.1): the last `quota-N` block on their page, else the defaults. */
  guestQuotaOf(owner: string): GuestQuota {
    const all = readDoc(this.root, owner, this.personDoc(owner)).blocks.filter((b) => /^quota-\d+$/.test(b.id));
    return quotaOf(all[all.length - 1]?.value);
  }

  setGuestQuota(by: TokenRecord, body: unknown): Result<{ quota: GuestQuota }> {
    const s = parseSpeaker(by.speaker);
    if (by.scope !== "person" || s?.kind !== "person") return fail(403, "只有本人能设访客额度");
    const quota = quotaOf(body);
    const doc = this.personDoc(s.id);
    const a = appendBlock(this.root, s.id, doc, nextId("quota"), (_d, prev, bid) => sealed({ id: bid, ...quota, at: this.now() }, prev));
    this.emit(s.id, doc, a.block);
    return { ok: true, quota };
  }

  /** The guests' questions today in the owner's guest DMs: all guests', or one guest's. */
  guestQuestionsToday(owner: string, now: string, guest?: string): number {
    let n = 0;
    for (const vd of this.venuesOf(owner)) {
      if (vd.venue.kind !== "guest-dm") continue;
      for (const m of vd.messages) if (m.speaker.startsWith("guest:") && (guest === undefined || m.speaker === guest) && sameDay(m.at, now)) n++;
    }
    return n;
  }

  /** What the page shows (transport §7.1); `guest` is the viewer's speaker when they sent a guest token. */
  shareOf(id: string, guest?: string): Result<ShareView> {
    const owner = this.shareOwner(id);
    const card = owner === undefined ? undefined : this.readShareDoc(owner, id);
    if (owner === undefined || card === undefined) return fail(404, "没有这张卡");
    const now = this.now();
    const quota = this.guestQuotaOf(owner);
    const presence = this.presenceOf(`agent:${card.agent}@${owner}`).presence;
    const ownerLeft = Math.max(0, quota.perDay - this.guestQuestionsToday(owner, now));
    const left = guest === undefined ? quota.perGuestPerDay : Math.max(0, Math.min(ownerLeft, quota.perGuestPerDay - this.guestQuestionsToday(owner, now, guest)));
    const tag = summaryTag(card, owner), use = useLine(card);
    const view: ShareView = {
      owner, card, agent: { name: card.agent, presence, presenceWord: presenceText(presence, {}) },
      quota: { perGuestPerDay: quota.perGuestPerDay, ownerLeftToday: ownerLeft },
      lines: { byline: byline(card, owner), ...(tag !== undefined ? { summaryTag: tag } : {}), range: rangeWords(card), ...(use !== undefined ? { use } : {}), guestHeader: guestHeader(left, owner), agentBadge: agentBadge(card.agent, owner) },
    };
    if (guest !== undefined) {
      const venue = guestVenueId(id, guest);
      view.guest = { speaker: guest, left, ...(this.venueOf(owner, venue) !== undefined ? { venue } : {}) };
    }
    return { ok: true, ...view };
  }

  /** A guest's question on a card (transport §7.1): a guest identity when none was sent, their guest DM with the card's agent at the first word (the public range its announce), the question appended as the guest and delivered at guest level — within the network address's, the owner's and the guest's quota for the day. A question sent again under its id is answered again, not counted again. */
  askAsGuest(by: TokenRecord | undefined, cardId: string, body: unknown, ip?: string): Result<{ token?: string; speaker: string; venue: string; message: Message; left: number }> {
    const owner = this.shareOwner(cardId);
    const card = owner === undefined ? undefined : this.readShareDoc(owner, cardId);
    if (owner === undefined || card === undefined) return fail(404, "没有这张卡");
    if (by !== undefined && by.scope !== "guest") return fail(403, "这条路只给访客；成员请在场所里说");
    const b = obj(body);
    if (b === undefined) return fail(400, "要一个 JSON 对象");
    const text = (str(b["text"]) ?? "").trim();
    if (text === "") return fail(400, "正文为空");
    const now = this.now();
    const quota = this.guestQuotaOf(owner);
    if (ip !== undefined && this.ipToday(ip, now) >= quota.perIpPerDay) return fail(429, QUOTA_WORDS.ip);
    if (this.guestQuestionsToday(owner, now) >= quota.perDay) return fail(429, QUOTA_WORDS.owner);
    const issued = by === undefined ? issueToken(this.root, { speaker: `guest:g-${rand()}`, scope: "guest", by: "guest", at: now }) : undefined;
    const guest = issued?.record ?? by!;
    const venueId = guestVenueId(cardId, guest.speaker);
    const used = this.guestQuestionsToday(owner, now, guest.speaker);
    const mid = str(b["id"]);
    const existing = mid === undefined ? undefined : this.venueOf(owner, venueId)?.messages.find((m) => m.id === mid);
    if (existing !== undefined) return { ok: true, speaker: guest.speaker, venue: venueId, message: existing, left: Math.max(0, quota.perGuestPerDay - used) };
    if (used >= quota.perGuestPerDay) return fail(429, QUOTA_WORDS.guest);
    if (this.balance(owner) < GUEST_QUESTION_CREDITS) return fail(429, WALLET_WORDS.ownerBroke);
    if (this.room(owner, card.agent, "guest", now) < GUEST_QUESTION_CREDITS) return fail(429, QUOTA_WORDS.owner);
    if (this.venueOf(owner, venueId) === undefined) {
      const made = this.createVenueAs(owner, { id: venueId, kind: "guest-dm", name: shownName(guest.speaker), people: [guest.speaker], agents: [`agent:${card.agent}@${owner}`], announce: card.scope, card: cardId });
      if (!made.ok) return made;
      this.appendSystem(owner, venueId, receptionText(card.agent, owner, this.latestPublic(owner) ?? card.title));
    }
    const r = this.appendMessage(guest, owner, venueId, { id: mid ?? `m-${rand()}`, text });
    if (!r.ok) return r;
    this.transfer({ kind: "spend", from: `person:${owner}`, to: PLATFORM, amount: GUEST_QUESTION_CREDITS, note: "访客问答", agent: card.agent, cap: "guest" });
    if (ip !== undefined) this.ipBump(ip, now);
    return { ok: true, ...(issued !== undefined ? { token: issued.token } : {}), speaker: guest.speaker, venue: venueId, message: r.message, left: Math.max(0, quota.perGuestPerDay - used - 1) };
  }

  /** Questions by network address today, in memory: a relay restarted forgets them, which errs on the guests' side. */
  private readonly ips = new Map<string, { day: string; n: number }>();
  private ipToday(ip: string, now: string): number { const e = this.ips.get(ip); return e !== undefined && sameDay(e.day, now) ? e.n : 0; }
  private ipBump(ip: string, now: string): void { this.ips.set(ip, { day: now.slice(0, 10), n: this.ipToday(ip, now) + 1 }); }

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

  // --- signals and channels (§10) ---

  /** Every channel on the relay (§10.4): its publisher, its price, how many subscribe (the publisher sees no more than that), its performance. */
  listChannels(): { owner: string; id: string; name: string; publisher: string; price: ChannelPrice; subscribers: number; performance: Performance }[] {
    const out: { owner: string; id: string; name: string; publisher: string; price: ChannelPrice; subscribers: number; performance: Performance }[] = [];
    for (const owner of listOwners(this.root)) for (const d of listDocs(this.root, owner, "venues")) {
      const vd = this.venueOf(owner, d.slice("venues/".length, -".geml".length));
      if (vd?.venue.kind !== "channel" || vd.venue.publisher === undefined) continue;
      out.push({ owner, id: vd.venue.id, name: vd.venue.name, publisher: vd.venue.publisher, price: vd.venue.price ?? {}, subscribers: vd.venue.people.filter((p) => p !== owner).length, performance: this.performanceOf(owner, vd.venue.publisher) });
    }
    return out;
  }

  /** A person's standing in a channel (§10.4): their latest subscription — by the month until a day, or by so many signals, the ones received since counted off. */
  subscriptionOf(vd: VenueDoc, person: string, now: string): { active: boolean; until?: string; left?: number } {
    const subs = vd.doc.blocks.filter((b) => /^sub-\d+$/.test(b.id) && str(b.value["person"]) === person);
    const last = subs[subs.length - 1];
    if (last === undefined) return { active: false };
    const until = str(last.value["until"]);
    if (until !== undefined) return { active: until > now, until };
    const at = str(last.value["at"]) ?? "";
    const left = Math.max(0, (num(last.value["count"]) ?? 0) - vd.messages.filter((m) => m.kind === "signal" && m.at > at).length);
    return { active: left > 0, left };
  }

  /** A subscription (§10.4 一种商品): by the month or by so many signals, paid from the wallet to the publisher's owner, the disclaimer shown at that moment (§10.6); the person joins the channel and reads it until it lapses. */
  subscribe(by: TokenRecord, owner: string, id: string, body: unknown): Result<{ venue: Venue; disclaimer: string; until?: string; left?: number }> {
    const s = parseSpeaker(by.speaker);
    if (by.scope !== "person" || s?.kind !== "person") return fail(403, "本人订阅");
    const vd = this.venueOf(owner, id);
    if (vd?.venue.kind !== "channel") return fail(404, "没有这个订阅频道");
    if (s.id === owner) return fail(400, "自己的频道不用订阅");
    const b = obj(body) ?? {};
    const price = vd.venue.price ?? {};
    const count = num(b["signals"]);
    let cost: number, note: string, value: Record<string, JsonValue>;
    if (b["month"] === true) {
      if (price.month === undefined) return fail(400, "这个频道不按月卖");
      cost = price.month; note = "一个月";
      value = { person: s.id, kind: "month", until: new Date(Date.parse(this.now()) + MONTH_MS).toISOString().replace(/\.\d{3}Z$/, "Z") };
    } else if (count !== undefined && Number.isInteger(count) && count > 0) {
      if (price.signal === undefined) return fail(400, "这个频道不按条卖");
      cost = price.signal * count; note = `${count} 条`;
      value = { person: s.id, kind: "signals", count };
    } else return fail(400, "订阅写 { month: true } 或 { signals: N }");
    const balance = this.balance(s.id);
    if (balance < cost) return fail(403, `积分不够：钱包 ${balance}，要 ${cost}`);
    if (cost > 0) this.transfer({ kind: "subscribe", from: by.speaker, to: `person:${owner}`, amount: cost, note: `「${vd.venue.name}」· ${note}`, ref: vd.venue.address });
    const doc = `venues/${id}.geml`;
    const a = appendBlock(this.root, owner, doc, nextId("sub"), (_d, prev, bid) => sealed({ id: bid, ...value, at: this.now() }, prev));
    this.emit(owner, doc, a.block);
    this.joinVenue(owner, id, by.speaker);
    const after = this.venueOf(owner, id)!;
    const sub = this.subscriptionOf(after, s.id, this.now());
    return { ok: true, venue: after.venue, disclaimer: DISCLAIMER, ...(sub.until !== undefined ? { until: sub.until } : {}), ...(sub.left !== undefined ? { left: sub.left } : {}) };
  }

  /** The agent's chain `signals/<agent>.geml` folded (§10.2). */
  signalsOf(owner: string, agent: string): Signal[] {
    return NAME.test(owner) && NAME.test(agent) ? foldSignals(readDoc(this.root, owner, `signals/${agent}.geml`).blocks) : [];
  }

  /** A signal published (§10.1, §10.2): by the channel's publisher agent, every field checked; onto the agent's chain with the host's stamp and hash when it sent them and the relay's receipt, then a signal message in the channel pointing at the block — data, never a prompt. */
  publishSignal(by: TokenRecord, body: unknown): Result<{ signal: Signal; address: string }> {
    const s = parseSpeaker(by.speaker);
    if (by.scope !== "agent" || s?.kind !== "agent") return fail(403, "信号由 agent 发");
    const b = obj(body) ?? {};
    const target = /^([^/\s]+)\/([^/\s]+)$/.exec(str(b["channel"]) ?? "");
    const vd = target === null ? undefined : this.venueOf(target[1]!, target[2]!);
    if (target === null || vd?.venue.kind !== "channel") return fail(404, "没有这个订阅频道");
    if (target[1] !== s.owner || vd.venue.publisher !== s.name) return fail(403, "只有频道的发布方 agent 能发信号");
    const faults = signalFaults(b);
    if (faults.length > 0) return fail(400, faults.join("；"));
    const input = signalInput(b)!;
    const now = this.now();
    const at = str(b["at"]), hostHash = str(b["hostHash"]);
    const chain = `signals/${s.name}.geml`;
    const a = appendBlock(this.root, s.owner, chain, nextId("signal"), (_d, prev, bid) => sealed({ id: bid, ...(input as unknown as Record<string, JsonValue>), from: by.speaker, at: at !== undefined && !Number.isNaN(Date.parse(at)) ? at : now, received: now, ...(hostHash !== undefined ? { hostHash } : {}), channel: `${target[1]}/${target[2]}` }, prev));
    this.emit(s.owner, chain, a.block);
    const address = this.address(s.owner, chain, a.block.id);
    const signal = this.signalsOf(s.owner, s.name).find((x) => x.id === a.block.id)!;
    const doc = `venues/${vd.venue.id}.geml`;
    const m = appendBlock(this.root, target[1]!, doc, nextId("sig"), (_d, prev, bid) => stamp({ venue: vd.venue.id, kind: "signal", text: signalText(signal), signal: address }, { id: bid, speaker: s, at: now, prev }) as unknown as Record<string, JsonValue>);
    this.emit(target[1]!, doc, m.block);
    return { ok: true, signal, address };
  }

  /** A retraction (§10.2): by the publisher agent, or its owner naming it; the mark stays on the chain and the signal counts; the channel hears it as a system message. */
  retractSignal(by: TokenRecord, id: string, body: unknown): Result<{ signal: Signal }> {
    const s = parseSpeaker(by.speaker);
    let owner: string, agent: string;
    if (s?.kind === "agent" && by.scope === "agent") { owner = s.owner; agent = s.name; }
    else if (s?.kind === "person" && by.scope === "person") {
      const name = str(obj(body)?.["agent"]);
      if (name === undefined || !this.agentsOf(s.id).includes(name)) return fail(400, "要一个自己名下的 agent");
      owner = s.id; agent = name;
    } else return fail(403, "要 agent 的令牌，或本人的令牌加 agent 的名字");
    const chain = `signals/${agent}.geml`;
    const signal = this.signalsOf(owner, agent).find((x) => x.id === id);
    if (signal === undefined) return fail(404, "没有这条信号");
    if (signal.retracted !== undefined) return { ok: true, signal };
    const a = appendBlock(this.root, owner, chain, nextId("retract"), (_d, prev, bid) => sealed({ id: bid, signal: id, at: this.now(), by: by.speaker }, prev));
    this.emit(owner, chain, a.block);
    const ch = signal.channel === undefined ? null : /^([^/]+)\/([^/]+)$/.exec(signal.channel);
    if (ch !== null) this.appendSystem(ch[1]!, ch[2]!, `信号 ${id} 已撤回`);
    return { ok: true, signal: this.signalsOf(owner, agent).find((x) => x.id === id)! };
  }

  /** The chain and the four numbers, public (§10.3: no page shows the claim without the rule). */
  signalPage(owner: string, agent: string): Result<{ signals: Signal[]; performance: Performance }> {
    if (!NAME.test(owner) || !NAME.test(agent) || !readDoc(this.root, owner, `agents/${agent}.geml`).exists) return fail(404, "没有这个 agent");
    return { ok: true, signals: this.signalsOf(owner, agent), performance: this.performanceOf(owner, agent) };
  }

  performanceOf(owner: string, agent: string): Performance { return performanceOf(this.signalsOf(owner, agent), (m, at) => this.priceAt(m, at), this.now()); }

  private priceDoc(market: string): string { return `prices/${market.replace(/[^A-Za-z0-9_-]+/g, "_")}.geml`; }

  /** A price point from a public source (§10.3), on a hash chain under the relay's own name. */
  setPrice(market: string, price: number, at: string = this.now()): Result<{ market: string; price: number; at: string }> {
    if (market.trim() === "") return fail(400, "缺市场");
    if (!Number.isFinite(price) || price <= 0) return fail(400, "价格是正数");
    if (Number.isNaN(Date.parse(at))) return fail(400, "时间要是 ISO 时间");
    const doc = this.priceDoc(market);
    const a = appendBlock(this.root, RELAY_OWNER, doc, nextId("p"), (_d, prev, bid) => sealed({ id: bid, market, price, at }, prev));
    this.emit(RELAY_OWNER, doc, a.block);
    return { ok: true, market, price, at };
  }

  pricesOf(market: string): PricePoint[] {
    return readDoc(this.root, RELAY_OWNER, this.priceDoc(market)).blocks.filter((b) => /^p-\d+$/.test(b.id) && str(b.value["market"]) === market).map((b) => ({ at: str(b.value["at"]) ?? "", price: num(b.value["price"]) ?? 0 })).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  }

  priceAt(market: string, at: string): number | undefined { return priceAt(this.pricesOf(market), at); }

  // --- the phone bridge (transport §7.2) ---

  /** A one-time code for the bot (绑定): six digits, ten minutes, its hash kept under the relay's own name. */
  phoneCode(by: TokenRecord): Result<{ code: string; expires: string }> {
    const s = parseSpeaker(by.speaker);
    if (by.scope !== "person" || s?.kind !== "person") return fail(403, "只有本人能生成绑定码");
    const code = String(100_000 + (randomBytes(4).readUInt32BE(0) % 900_000));
    const at = this.now();
    appendSealed(this.root, RELAY_OWNER, PHONE, `code-${rand()}`, { person: s.id, code: hashToken(code), at });
    return { ok: true, code, expires: new Date(Date.parse(at) + CODE_TTL_MS).toISOString().replace(/\.\d{3}Z$/, "Z") };
  }

  /** The bot binds with the code: an inbox-scope token of the person — the inbox's reads and answers, a word to one's own agent, nothing more — and the code is spent. */
  phoneBind(body: unknown): Result<{ token: string; person: string }> {
    const code = (str(obj(body)?.["code"]) ?? "").trim();
    if (!/^\d{6}$/.test(code)) return fail(400, "绑定码是六位数字");
    const d = readDoc(this.root, RELAY_OWNER, PHONE);
    const spent = new Set(d.blocks.filter((b) => b.id.startsWith("bound-")).map((b) => str(b.value["code"])));
    const now = this.now();
    const hit = [...d.blocks].reverse().find((b) => b.id.startsWith("code-") && !spent.has(b.id) && str(b.value["code"]) === hashToken(code) && Date.parse(str(b.value["at"]) ?? "") + CODE_TTL_MS > Date.parse(now));
    if (hit === undefined) return fail(404, "绑定码不对或过期了");
    const person = str(hit.value["person"]) ?? "";
    const issued = issueToken(this.root, { speaker: `person:${person}`, scope: "inbox", by: `phone:${hit.id}`, at: now });
    appendSealed(this.root, RELAY_OWNER, PHONE, `bound-${rand()}`, { code: hit.id, person, at: now });
    return { ok: true, token: issued.token, person };
  }

  /** An inbox-scope token acting as the person (transport §7.2 只限收件箱动作的本人令牌), for the answers below and nothing else. */
  private asPerson(by: TokenRecord): TokenRecord | undefined {
    const s = parseSpeaker(by.speaker);
    return (by.scope === "person" || by.scope === "inbox") && s?.kind === "person" ? { ...by, scope: "person" } : undefined;
  }

  /** A need answered by its key (§6.9), as the band and the phone do it: an ask's reply into its venue; 放行 on a request or an agent's ask for credits; 定 on a digest or a match; 验收 on a card (接受, 要改 with the words, 看演示 is the card's address back); on a 卡住, 看原因 is words back and 交回 gives the card back. The answer is the person's own (human 来源). */
  answerNeed(by: TokenRecord, key: string, action: string, text?: string): Result<{ said?: string }> {
    const me = this.asPerson(by);
    if (me === undefined) return fail(403, "只有本人的令牌能答复");
    const a = parseAddress(key);
    if (a === undefined || a.block === undefined || a.relay !== this.name) return fail(400, `不认识这件事：${key}`);
    const words = (text ?? "").trim();
    const venue = /^venues\/([^/]+)\.geml$/.exec(a.doc);
    if (venue !== null) {
      const reply = action === WRITE_IN ? words : action;
      if (reply === "") return fail(400, "自己写：缺正文");
      const r = this.appendMessage(me, a.owner, venue[1]!, { id: `m-${String(Date.parse(this.now())).padStart(13, "0")}-${rand()}`, text: reply, replyTo: a.block });
      return r.ok ? { ok: true, said: reply } : r;
    }
    if (/^digests\/[^/]+\.geml$/.test(a.doc)) {
      if (action === WRITE_IN && words === "") return fail(400, "自己写：缺正文");
      const r = this.answerDigest(me, { draft: a.block, publish: action !== "不发", ...(action === WRITE_IN ? { text: words } : {}) });
      return r.ok ? { ok: true } : r;
    }
    if (/^matches\/[^/]+\.geml$/.test(a.doc)) {
      const r = this.answerMatch(me, a.owner, a.doc.slice("matches/".length, -".geml".length), { yes: action === "亮名片" });
      return r.ok ? { ok: true } : r;
    }
    if (/^people\/[^/]+\.geml$/.test(a.doc)) {
      if (a.block.startsWith("cap-ask-")) { const r = this.allowCredits(me, { ask: a.block, allowed: action !== "不行" }); return r.ok ? { ok: true } : r; }
      const request = readDoc(this.root, a.owner, a.doc).blocks.find((b) => b.id === a.block);
      const from = str(request?.value["from"]), block = str(request?.value["block"]);
      if (from === undefined || block === undefined) return fail(404, "没有这个申请");
      if (action === "拒绝") { const r = this.refuse(me, a.block); return r.ok ? { ok: true } : r; }
      if (action !== "允许一次" && action !== "允许此人") return fail(400, `放行没有这个答复：${action}`);
      const r = this.grant(me, { request: a.block, person: from.replace(/^person:/, "").replace(/^agent:[^@]+@/, ""), block, ...(action === "允许一次" ? { once: true } : {}) });
      return r.ok ? { ok: true } : r;
    }
    const card = /^cards\/([^/]+)\.geml$/.exec(a.doc);
    if (card !== null) {
      const c = this.taskOf(a.owner, card[1]!);
      if (c === undefined) return fail(404, "没有这张卡");
      if (a.block.startsWith("report-")) {
        if (action.startsWith("接受")) { const r = this.acceptTask(me, a.owner, c.id); return r.ok ? { ok: true } : r; }
        if (action === "要改") { const r = this.changesTask(me, a.owner, c.id, { comments: words === "" ? [] : [{ anchor: "", text: words }] }); return r.ok ? { ok: true } : r; }
        if (action === "看演示") return { ok: true, said: this.cardAddress(a.owner, c.id) };
      }
      if (a.block.startsWith("stuck-")) {
        if (action === "看原因") return { ok: true, said: this.inbox(me.speaker.slice("person:".length)).find((n) => n.key === key)?.text ?? `#${c.id} ${heartbeatWords(c, this.now())}` };
        if (action === "交回") { const r = this.giveBackTask(me, a.owner, c.id, { note: words === "" ? "手机上交回" : words }); return r.ok ? { ok: true } : r; }
      }
      return fail(400, `卡上没有这个答复：${action}（去桌面端）`);
    }
    return fail(400, `不认识这件事：${key}`);
  }

  /** /tell (transport §7.2): the owner's word into their DM with the agent — made when it is not there — which the DM's delivery turns into an owner-level prompt, first in line. */
  tell(by: TokenRecord, body: unknown): Result<{ venue: string; agent: string }> {
    const me = this.asPerson(by);
    if (me === undefined) return fail(403, "只有本人的令牌能说话");
    const person = me.speaker.slice("person:".length);
    const b = obj(body) ?? {};
    const agent = str(b["agent"]) ?? "", text = (str(b["text"]) ?? "").trim();
    if (!NAME.test(agent) || !this.agentsOf(person).includes(agent)) return fail(404, "没有这个 agent");
    if (text === "") return fail(400, "缺正文");
    const id = `dm-${agent}`;
    if (this.venueOf(person, id) === undefined) {
      const made = this.createVenueAs(person, { id, kind: "dm", name: agent, agents: [`agent:${agent}@${person}`] });
      if (!made.ok) return made;
    }
    const r = this.appendMessage(me, person, id, { id: `m-${String(Date.parse(this.now())).padStart(13, "0")}-${rand()}`, text });
    return r.ok ? { ok: true, venue: `${person}/${id}`, agent } : r;
  }

  // --- login and registration (transport §2.5, §7.1 /login) ---

  /** The person an email belongs to, if any. */
  private personOfEmail(email: string): string | undefined {
    const b = readDoc(this.root, RELAY_OWNER, EMAILS).blocks.find((x) => x.id.startsWith("email-") && x.value["email"] === email);
    return b === undefined ? undefined : str(b.value["person"]);
  }

  /** A code to the address (§7.1): six digits, ten minutes, three an address in that time, ten a network address an hour; the mail through the operator's mailer, never waited on. `known` says whether a name will be wanted. */
  startLogin(body: unknown, ip?: string): Result<{ sent: true; known: boolean }> {
    const b = obj(body) ?? {};
    const fault = emailFault(b["email"]);
    if (fault !== undefined) return fail(400, fault);
    const email = normalizeEmail(b["email"] as string);
    const now = this.now(), t = Date.parse(now);
    const age = (x: DataBlock): number => t - Date.parse(str(x.value["at"]) ?? "");
    const recent = readDoc(this.root, RELAY_OWNER, LOGINS).blocks.filter((x) => x.id.startsWith("login-") && age(x) < ONE_HOUR_MS);
    if (recent.filter((x) => x.value["email"] === email && age(x) < CODE_TTL_MS).length >= CODES_PER_EMAIL) return fail(429, LOGIN_WORDS.tooMany);
    if (ip !== undefined && recent.filter((x) => x.value["ip"] === ip).length >= CODES_PER_IP_HOUR) return fail(429, LOGIN_WORDS.tooMany);
    const code = String(100_000 + (randomBytes(4).readUInt32BE(0) % 900_000));
    appendSealed(this.root, RELAY_OWNER, LOGINS, `login-${rand()}`, { email, code: hashToken(code), at: now, ...(ip !== undefined ? { ip } : {}) });
    const m = codeMail(code);
    try { void Promise.resolve(this.mailer({ to: email, subject: m.subject, text: m.text })).catch(() => { /* the operator's route failed; the next code tries again */ }); } catch { /* the same */ }
    return { ok: true, sent: true, known: this.personOfEmail(email) !== undefined };
  }

  /** The code checked (§7.1): a person's token for the email's person; a first login names them, writes their page, gives them the hosted agent (transport §6) whose first word waits in their DM, and keeps the agent's token for the platform's runner. */
  finishLogin(body: unknown): Result<{ token: string; person: string; new: boolean; agent?: string; venue?: string }> {
    const b = obj(body) ?? {};
    const fault = emailFault(b["email"]);
    if (fault !== undefined) return fail(400, fault);
    const email = normalizeEmail(b["email"] as string), code = str(b["code"]) ?? "";
    if (!CODE_RE.test(code)) return fail(400, "验证码是六位数字");
    const now = this.now(), t = Date.parse(now);
    const d = readDoc(this.root, RELAY_OWNER, LOGINS);
    const used = new Set(d.blocks.filter((x) => x.id.startsWith("used-")).map((x) => str(x.value["login"])));
    const h = hashToken(code);
    const login = [...d.blocks].reverse().find((x) => x.id.startsWith("login-") && x.value["email"] === email && x.value["code"] === h && !used.has(x.id) && t - Date.parse(str(x.value["at"]) ?? "") < CODE_TTL_MS);
    if (login === undefined) return fail(401, LOGIN_WORDS.wrong);
    const known = this.personOfEmail(email);
    if (known !== undefined) {
      appendSealed(this.root, RELAY_OWNER, LOGINS, `used-${rand()}`, { login: login.id, at: now });
      return { ok: true, token: issueToken(this.root, { speaker: `person:${known}`, scope: "person", by: "login", at: now }).token, person: known, new: false };
    }
    const nf = nameFault(b["name"]);
    if (nf !== undefined) return fail(400, nf);
    const name = b["name"] as string;
    if (this.hasPage(name)) return fail(409, LOGIN_WORDS.taken);
    appendSealed(this.root, RELAY_OWNER, LOGINS, `used-${rand()}`, { login: login.id, at: now });
    const person = this.issuePerson(name);
    if (!person.ok) return person;
    appendSealed(this.root, RELAY_OWNER, EMAILS, `email-${rand()}`, { email, person: name, at: now });
    const agent = this.issueAgent(person.record, HOSTED_AGENT);
    if (!agent.ok) return agent;
    appendSealed(this.root, RELAY_OWNER, HOSTED, `hosted-${rand()}`, { person: name, agent: HOSTED_AGENT, token: agent.token, at: now });
    const venue = `dm-${HOSTED_AGENT}`;
    const made = this.createVenueAs(name, { id: venue, kind: "dm", name: HOSTED_AGENT, people: [], agents: [agent.record.speaker] });
    if (!made.ok) return made;
    this.appendMessage(agent.record, name, venue, { id: "m-welcome", text: welcomeText(name) });
    return { ok: true, token: person.token, person: name, new: true, agent: HOSTED_AGENT, venue };
  }

  /** The hosted agents with the tokens the platform's runner (plan L) drives them with: kept in the clear under the relay's own owner, which no person can read. */
  /** The agents the platform runs (transport §6), the moved ones left out. */
  hostedAgents(): { person: string; agent: string; token: string }[] {
    const blocks = readDoc(this.root, RELAY_OWNER, HOSTED).blocks;
    const moved = new Set(blocks.filter((x) => x.id.startsWith("moved-")).map((x) => `${str(x.value["person"]) ?? ""}/${str(x.value["agent"]) ?? ""}`));
    return blocks.filter((x) => x.id.startsWith("hosted-")).map((x) => ({ person: str(x.value["person"]) ?? "", agent: str(x.value["agent"]) ?? "", token: str(x.value["token"]) ?? "" })).filter((h) => !moved.has(`${h.person}/${h.agent}`));
  }

  /** A person's hosted agents, as the listing shows them. */
  hostedOf(person: string): { agent: string }[] { return this.hostedAgents().filter((h) => h.person === person).map((h) => ({ agent: h.agent })); }

  /** 搬家 (transport §6): the owner takes the hosted agent's token and workspace to their desktop; the account stays, the queue on the relay goes on, the rounds here stop. */
  moveHosted(by: TokenRecord, agent: string): Result<{ token: string; workspace: string }> {
    const s = parseSpeaker(by.speaker);
    if (by.scope !== "person" || s?.kind !== "person") return fail(403, "只有主人能搬");
    const h = this.hostedAgents().find((x) => x.person === s.id && x.agent === agent);
    if (h === undefined) return fail(404, "没有这个托管 agent");
    appendSealed(this.root, RELAY_OWNER, HOSTED, `moved-${rand()}`, { person: s.id, agent, at: this.now() });
    return { ok: true, token: h.token, workspace: join(this.root, "_hosted", s.id, agent) };
  }

  // --- the ledger and the wallet (§9.1) ---

  private ledgerDoc(person: string): string { return `ledger/${person}.geml`; }

  /** A person's ledger as entries; none for a person without one. */
  ledgerOf(person: string): Entry[] { return NAME.test(person) ? foldLedger(readDoc(this.root, person, this.ledgerDoc(person)).blocks) : []; }

  /** What a person has: what their ledger says came in, less what went out. */
  balance(person: string): number { return balanceOf(this.ledgerOf(person), `person:${person}`); }

  /** The owner's caps (§9.1): the last `caps-N` block on their page, else the defaults. */
  capsOf(owner: string): Caps {
    const all = readDoc(this.root, owner, this.personDoc(owner)).blocks.filter((b) => /^caps-\d+$/.test(b.id));
    return capsOf(all[all.length - 1]?.value);
  }

  /** One movement: an entry in the ledger of each party that is a person, and of the owner of each hold (a hold's balance is read there), all sharing a tx. */
  private transfer(m: { kind: EntryKind; from: string; to: string; amount: number; note: string; ref?: string; agent?: string; cap?: CapKey; card?: string }): string {
    const tx = rand(), at = this.now();
    const value: Record<string, JsonValue> = { kind: m.kind, from: m.from, to: m.to, amount: m.amount, note: m.note, at, tx };
    if (m.ref !== undefined) value["ref"] = m.ref;
    if (m.agent !== undefined) value["agent"] = m.agent;
    if (m.cap !== undefined) value["cap"] = m.cap;
    if (m.card !== undefined) value["card"] = m.card;
    const ledgers = new Set<string>();
    for (const account of [m.from, m.to]) {
      if (account.startsWith("person:")) ledgers.add(account.slice("person:".length));
      const hold = /^hold:[a-z]+\/([^/]+)\//.exec(account);
      if (hold !== null) ledgers.add(hold[1]!);
    }
    for (const person of ledgers) {
      const doc = this.ledgerDoc(person);
      const a = appendBlock(this.root, person, doc, nextId("entry"), (_d, prev, bid) => sealed({ id: bid, ...value }, prev));
      this.emit(person, doc, a.block);
    }
    return tx;
  }

  /** Today's allowances for an agent against a cap: the asks the owner said yes to today. */
  private allowancesToday(owner: string, agent: string, cap: CapKey, now: string): number {
    const pd = readDoc(this.root, owner, this.personDoc(owner)).blocks;
    const asks = new Map(pd.filter((b) => /^cap-ask-\d+$/.test(b.id)).map((b) => [b.id, b.value] as const));
    let n = 0;
    for (const b of pd) {
      if (!/^cap-allow-\d+$/.test(b.id) || b.value["allowed"] !== true || !sameDay(str(b.value["at"]) ?? "", now)) continue;
      const ask = asks.get(str(b.value["ask"]) ?? "");
      if (ask !== undefined && str(ask["agent"]) === agent && str(ask["cap"]) === cap) n += num(ask["credits"]) ?? 0;
    }
    return n;
  }

  /** How much more the agent may spend against a cap today (§9.1): the cap plus today's allowances, less today's use; the agent's own day bounds the guest and auto caps too. */
  room(owner: string, agent: string, cap: CapKey, now: string = this.now(), card?: string): number {
    const caps = this.capsOf(owner), used = usedToday(this.ledgerOf(owner), now);
    const day = caps.agentPerDay + this.allowancesToday(owner, agent, "agent", now) - (used.agents[agent] ?? 0);
    switch (cap) {
      case "agent": return day;
      case "guest": return Math.min(day, caps.guestPerDay + this.allowancesToday(owner, agent, "guest", now) - used.guest);
      case "auto": return Math.min(day, caps.autoBuy + this.allowancesToday(owner, agent, "auto", now) - used.auto);
      case "card": return card === undefined ? caps.perCard : caps.perCard + this.allowancesToday(owner, agent, "card", now) - (used.cards[card] ?? 0);
    }
  }

  /** The wallet page (§9.1): the balance, the caps with today's use as lines, the last entries as lines (newest first, UTC hh:mm; the daemon redraws them in local time). */
  walletOf(person: string): WalletView {
    const entries = this.ledgerOf(person), now = this.now();
    const caps = this.capsOf(person), used = usedToday(entries, now), agents = this.agentsOf(person);
    const balance = balanceOf(entries, `person:${person}`);
    const recent = entries.slice(-20).reverse();
    return { balance, caps, used, agents, lines: walletLines({ balance, caps, used, agents }), entries: recent, recent: recent.map((e) => entryLine(e, `person:${person}`, (at) => at.slice(11, 16))) };
  }

  /** The operator's top-up (§9.1: credits are backed by what the platform bought): from the platform to a person with a page. */
  topUp(person: string, credits: number, note = "充值"): Result<{ balance: number }> {
    if (!NAME.test(person) || !readDoc(this.root, person, this.personDoc(person)).exists) return fail(404, "没有这个人");
    if (!Number.isInteger(credits) || credits <= 0) return fail(400, "积分是正整数");
    this.transfer({ kind: "topup", from: PLATFORM, to: `person:${person}`, amount: credits, note });
    return { ok: true, balance: this.balance(person) };
  }

  /** The owner sets a cap or several (§9.1): the ones given, the rest kept. */
  setCaps(by: TokenRecord, body: unknown): Result<{ caps: Caps }> {
    const s = parseSpeaker(by.speaker);
    if (by.scope !== "person" || s?.kind !== "person") return fail(403, "只有本人能设上限");
    const given = Object.fromEntries(Object.entries(obj(body) ?? {}).filter(([, v]) => Number.isInteger(v) && (v as number) >= 0));
    const caps = capsOf({ ...this.capsOf(s.id), ...given });
    const doc = this.personDoc(s.id);
    const a = appendBlock(this.root, s.id, doc, nextId("caps"), (_d, prev, bid) => sealed({ id: bid, ...caps, at: this.now() }, prev));
    this.emit(s.id, doc, a.block);
    return { ok: true, caps };
  }

  /** An agent's spend from its owner's wallet (§9.1): within the auto-buy cap, the card's and its own day; over any, refused — the ask is its next move. */
  spend(by: TokenRecord, body: unknown): Result<{ balance: number; left: number }> {
    const s = parseSpeaker(by.speaker);
    if (by.scope !== "agent" || s?.kind !== "agent") return fail(403, "只有 agent 的令牌能记消耗（主人不花自己的上限）");
    const b = obj(body) ?? {};
    const credits = num(b["credits"]), note = (str(b["note"]) ?? "").trim(), card = str(b["card"]);
    if (credits === undefined || !Number.isInteger(credits) || credits <= 0) return fail(400, "积分是正整数");
    if (note === "") return fail(400, "要一句说明（买了什么）");
    const now = this.now();
    const balance = this.balance(s.owner);
    if (balance < credits) return fail(403, `积分不够：钱包 ${balance}`);
    const room = Math.min(this.room(s.owner, s.name, "auto", now), ...(card !== undefined ? [this.room(s.owner, s.name, "card", now, card)] : []));
    if (room < credits) return fail(403, `超过上限（今天还能花 ${Math.max(0, room)}）· 用 ask 向主人要放行`);
    this.transfer({ kind: "spend", from: `person:${s.owner}`, to: PLATFORM, amount: credits, note, agent: s.name, cap: "auto", ...(card !== undefined ? { card } : {}) });
    return { ok: true, balance: this.balance(s.owner), left: room - credits };
  }

  /** The agent's ask for more (§9.1): a block on the owner's page, a 放行 in their inbox. */
  askCredits(by: TokenRecord, body: unknown): Result<{ id: string }> {
    const s = parseSpeaker(by.speaker);
    if (by.scope !== "agent" || s?.kind !== "agent") return fail(403, "只有 agent 问主人要");
    const b = obj(body) ?? {};
    const credits = num(b["credits"]), cap = str(b["cap"]) ?? "auto", note = str(b["note"]);
    if (credits === undefined || !Number.isInteger(credits) || credits <= 0) return fail(400, "积分是正整数");
    if (!(cap in CAP_WORDS)) return fail(400, "cap 是 agent、card、guest 或 auto");
    const doc = this.personDoc(s.owner);
    const a = appendBlock(this.root, s.owner, doc, nextId("cap-ask"), (_d, prev, bid) => sealed({ id: bid, agent: s.name, credits, cap, at: this.now(), ...(note !== undefined ? { note } : {}) }, prev));
    this.emit(s.owner, doc, a.block);
    return { ok: true, id: a.block.id };
  }

  /** The owner's answer: today the agent may spend that much more against that cap, or not. */
  allowCredits(by: TokenRecord, body: unknown): Result<{ id: string; allowed: boolean }> {
    const s = parseSpeaker(by.speaker);
    if (by.scope !== "person" || s?.kind !== "person") return fail(403, "只有本人能放行");
    const b = obj(body) ?? {};
    const ask = str(b["ask"]) ?? "", allowed = b["allowed"] === true;
    const doc = this.personDoc(s.id);
    const pd = readDoc(this.root, s.id, doc).blocks;
    if (!/^cap-ask-\d+$/.test(ask) || !pd.some((x) => x.id === ask)) return fail(404, "没有这个申请");
    if (pd.some((x) => /^cap-allow-\d+$/.test(x.id) && x.value["ask"] === ask)) return fail(409, "已经答过了");
    const a = appendBlock(this.root, s.id, doc, nextId("cap-allow"), (_d, prev, bid) => sealed({ id: bid, ask, allowed, at: this.now() }, prev));
    this.emit(s.id, doc, a.block);
    return { ok: true, id: a.block.id, allowed };
  }

  /** The person behind a `to`: a person's id, an agent's owner (the agent kept for the line), or a bare id. */
  private payee(to: string | undefined): { person: string; agent?: string } | undefined {
    if (to === undefined) return undefined;
    const s = parseSpeaker(to);
    if (s?.kind === "person") return { person: s.id };
    if (s?.kind === "agent") return { person: s.owner, agent: s.name };
    return s === undefined && NAME.test(to) ? { person: to } : undefined;
  }
  private hasPage(person: string): boolean { return readDoc(this.root, person, this.personDoc(person)).exists; }

  /** A tip (§9.1): to a person, or to an agent — it lands in the owner's wallet, the agent named; a line may ride along. */
  tip(by: TokenRecord, body: unknown): Result<{ balance: number }> {
    const s = parseSpeaker(by.speaker);
    if (by.scope !== "person" || s?.kind !== "person") return fail(403, "只有本人能打赏");
    const b = obj(body) ?? {};
    const to = this.payee(str(b["to"])), credits = num(b["credits"]), note = (str(b["note"]) ?? "").trim();
    if (to === undefined || !this.hasPage(to.person)) return fail(404, "打赏给谁？要一个人或一个 agent");
    if (to.person === s.id) return fail(400, "不能打赏自己");
    if (credits === undefined || !Number.isInteger(credits) || credits <= 0) return fail(400, "积分是正整数");
    const balance = this.balance(s.id);
    if (balance < credits) return fail(403, `积分不够：钱包 ${balance}`);
    this.transfer({ kind: "tip", from: by.speaker, to: `person:${to.person}`, amount: credits, note: note === "" ? "" : `「${note}」`, ...(to.agent !== undefined ? { agent: to.agent } : {}) });
    return { ok: true, balance: this.balance(s.id) };
  }

  /** A favour (§9.1): a line both sides keep, no credits moved; `from` names who helped me, `to` whom I helped. */
  favor(by: TokenRecord, body: unknown): Result<Record<never, never>> {
    const s = parseSpeaker(by.speaker);
    if (by.scope !== "person" || s?.kind !== "person") return fail(403, "只有本人记人情");
    const b = obj(body) ?? {};
    const gave = str(b["to"]) !== undefined;
    const other = this.payee(str(b["to"]) ?? str(b["from"])), note = (str(b["note"]) ?? "").trim();
    if (other === undefined || !this.hasPage(other.person)) return fail(404, "记给谁？");
    if (note === "") return fail(400, "人情要一句话");
    this.transfer({ kind: "favor", from: gave ? by.speaker : `person:${other.person}`, to: gave ? `person:${other.person}` : by.speaker, amount: 0, note });
    return { ok: true };
  }

  /** A gift (§9.1): to a person with an account at once; to no one named, held for whoever claims it at `/g/<id>` (登录即注册 is the page's). */
  gift(by: TokenRecord, body: unknown): Result<{ id?: string; url?: string; balance: number }> {
    const s = parseSpeaker(by.speaker);
    if (by.scope !== "person" || s?.kind !== "person") return fail(403, "只有本人能送");
    const b = obj(body) ?? {};
    const credits = num(b["credits"]), note = (str(b["note"]) ?? "").trim(), toName = str(b["to"]);
    if (credits === undefined || !Number.isInteger(credits) || credits <= 0) return fail(400, "积分是正整数");
    const balance = this.balance(s.id);
    if (balance < credits) return fail(403, `积分不够：钱包 ${balance}`);
    if (toName !== undefined) {
      const to = this.payee(toName);
      if (to === undefined || !this.hasPage(to.person)) return fail(404, `没有这个人：${toName}（没账号的，不写 to，发领取链接）`);
      if (to.person === s.id) return fail(400, "不能送给自己");
      this.transfer({ kind: "gift", from: by.speaker, to: `person:${to.person}`, amount: credits, note });
      return { ok: true, balance: this.balance(s.id) };
    }
    const id = `g-${rand()}`;
    const doc = `gifts/${id}.geml`;
    const a = appendSealed(this.root, s.id, doc, "gift", { from: by.speaker, credits, note, at: this.now() });
    this.emit(s.id, doc, a.block);
    this.transfer({ kind: "gift", from: by.speaker, to: holdOf("gift", `${s.id}/${id}`), amount: credits, note: note === "" ? "礼物" : note, ref: this.address(s.id, doc) });
    return { ok: true, id, url: `/g/${id}`, balance: this.balance(s.id) };
  }

  private giftOwner(id: string): string | undefined { return NAME.test(id) ? listOwners(this.root).find((o) => readDoc(this.root, o, `gifts/${id}.geml`).exists) : undefined; }

  /** What the claim page shows (transport §7.1 `/g/<礼物>`): who gives how much with what line, and who took it. */
  giftOf(id: string): Result<{ id: string; from: string; credits: number; note: string; claimed?: string }> {
    const owner = this.giftOwner(id);
    if (owner === undefined) return fail(404, "没有这份礼物");
    const d = readDoc(this.root, owner, `gifts/${id}.geml`);
    const g = d.blocks.find((b) => b.id === "gift")?.value ?? {};
    const by = str(d.blocks.find((b) => b.id === "claim")?.value["by"]);
    return { ok: true, id, from: shownName(str(g["from"]) ?? ""), credits: num(g["credits"]) ?? 0, note: str(g["note"]) ?? "", ...(by !== undefined ? { claimed: shownName(by) } : {}) };
  }

  /** The gift claimed by a person (登录即注册 happens before this call): the hold's credits to them, once. */
  claimGift(by: TokenRecord, id: string): Result<{ credits: number; balance: number }> {
    const s = parseSpeaker(by.speaker);
    if (by.scope !== "person" || s?.kind !== "person") return fail(403, "领礼物要登录");
    const owner = this.giftOwner(id);
    if (owner === undefined) return fail(404, "没有这份礼物");
    if (owner === s.id) return fail(400, "不能领自己的礼物");
    const doc = `gifts/${id}.geml`;
    const hold = holdOf("gift", `${owner}/${id}`);
    const credits = balanceOf(this.ledgerOf(owner), hold);
    const a = appendBlock(this.root, owner, doc, () => "claim", (_d, prev, bid) => sealed({ id: bid, by: by.speaker, at: this.now() }, prev));
    if (a.existed) return fail(409, `已经被 ${shownName(str(a.block.value["by"]) ?? "")} 领了`);
    this.emit(owner, doc, a.block);
    this.transfer({ kind: "gift", from: hold, to: by.speaker, amount: credits, note: `领了 ${owner} 的礼物`, ref: this.address(owner, doc) });
    return { ok: true, credits, balance: this.balance(s.id) };
  }

  /** A red packet into a venue (§9.1): the whole held, a 卡片 message in the venue, the shares drawn by members, what is left after a day returned. */
  packet(by: TokenRecord, body: unknown): Result<{ id: string; message: Message; balance: number }> {
    const s = parseSpeaker(by.speaker);
    if (by.scope !== "person" || s?.kind !== "person") return fail(403, "只有本人能发红包");
    const b = obj(body) ?? {};
    const key = str(b["venue"]) ?? "", credits = num(b["credits"]), shares = num(b["shares"]), note = (str(b["note"]) ?? "").trim();
    const [vo, vi] = key.split("/");
    const vd = vo === undefined || vi === undefined ? undefined : this.venueOf(vo, vi);
    if (vd === undefined) return fail(404, "没有这个场所");
    if (!this.isMember(vd, s)) return fail(403, "不在这个场所里");
    if (credits === undefined || !Number.isInteger(credits) || credits <= 0) return fail(400, "积分是正整数");
    if (shares === undefined || !Number.isInteger(shares) || shares <= 0 || shares > credits) return fail(400, "份数是 1 到积分数之间的整数");
    const balance = this.balance(s.id);
    if (balance < credits) return fail(403, `积分不够：钱包 ${balance}`);
    const id = `r-${rand()}`;
    const doc = `packets/${id}.geml`;
    const a = appendSealed(this.root, s.id, doc, "packet", { from: by.speaker, venue: key, credits, shares, note, at: this.now() });
    this.emit(s.id, doc, a.block);
    this.transfer({ kind: "packet", from: by.speaker, to: holdOf("packet", `${s.id}/${id}`), amount: credits, note: `红包 ${credits} 积分 · ${shares} 份`, ref: this.address(s.id, doc) });
    const m = this.appendMessage(by, vo!, vi!, { id: `m-${id}`, kind: "card", card: this.address(s.id, doc), text: `红包 · ${credits} 积分 · ${shares} 份${note === "" ? "" : ` · ${note}`}` });
    if (!m.ok) return m;
    return { ok: true, id, message: m.message, balance: this.balance(s.id) };
  }

  private packetOwner(id: string): string | undefined { return NAME.test(id) ? listOwners(this.root).find((o) => readDoc(this.root, o, `packets/${id}.geml`).exists) : undefined; }

  private packetDoc(owner: string, id: string): PacketDoc | undefined {
    const d = readDoc(this.root, owner, `packets/${id}.geml`);
    const p = d.blocks.find((b) => b.id === "packet")?.value;
    if (!d.exists || p === undefined) return undefined;
    const claims = d.blocks.filter((b) => /^claim-\d+$/.test(b.id)).map((b) => ({ by: str(b.value["by"]) ?? "", amount: num(b.value["amount"]) ?? 0, at: str(b.value["at"]) ?? "" }));
    return { from: str(p["from"]) ?? "", venue: str(p["venue"]) ?? "", credits: num(p["credits"]) ?? 0, shares: num(p["shares"]) ?? 0, note: str(p["note"]) ?? "", at: str(p["at"]) ?? "", claims, returned: d.blocks.some((b) => b.id === "returned") };
  }

  /** The packet as a member sees it (transport §7.1 `/r/<红包>`): the total, the shares, who took what, what one took, whether it went back. */
  packetOf(id: string, viewer: string): Result<PacketView> {
    const owner = this.packetOwner(id);
    const p = owner === undefined ? undefined : this.packetDoc(owner, id);
    if (owner === undefined || p === undefined) return fail(404, "没有这个红包");
    const v = parseSpeaker(viewer);
    const [vo, vi] = p.venue.split("/");
    const vd = vo === undefined || vi === undefined ? undefined : this.venueOf(vo, vi);
    if (v === undefined || vd === undefined || !this.isMember(vd, v)) return fail(403, "不在这个场所里");
    const returned = p.returned || packetExpired(p.at, this.now());
    const mine = p.claims.find((c) => c.by === viewer)?.amount;
    return { ok: true, id, from: shownName(p.from), venue: p.venue, credits: p.credits, shares: p.shares, note: p.note, at: p.at, claims: p.claims.map((c) => ({ by: shownName(c.by), amount: c.amount })), left: returned ? 0 : p.shares - p.claims.length, returned, ...(mine !== undefined ? { mine } : {}) };
  }

  /** A share of the packet to a member (§9.1): an equal part, the last one the remainder; once each; never the giver's; nothing after a day. */
  claimPacket(by: TokenRecord, id: string): Result<{ amount: number; left: number; balance: number }> {
    const s = parseSpeaker(by.speaker);
    if (by.scope !== "person" || s?.kind !== "person") return fail(403, "领红包要本人的令牌");
    const owner = this.packetOwner(id);
    const p = owner === undefined ? undefined : this.packetDoc(owner, id);
    if (owner === undefined || p === undefined) return fail(404, "没有这个红包");
    const [vo, vi] = p.venue.split("/");
    const vd = vo === undefined || vi === undefined ? undefined : this.venueOf(vo, vi);
    if (vd === undefined || !this.isMember(vd, s)) return fail(403, "不在这个场所里");
    if (p.from === by.speaker) return fail(400, "自己的红包不能领");
    const now = this.now();
    if (p.returned || packetExpired(p.at, now)) return fail(410, "红包过了 24 小时，没领完的退回了");
    if (p.claims.some((c) => c.by === by.speaker)) return fail(409, "领过了");
    if (p.claims.length >= p.shares) return fail(409, "领完了");
    const each = Math.floor(p.credits / p.shares);
    const k = p.claims.length + 1;
    const amount = k < p.shares ? each : p.credits - each * (p.shares - 1);
    const doc = `packets/${id}.geml`;
    const a = appendBlock(this.root, owner, doc, nextId("claim"), (_d, prev, bid) => sealed({ id: bid, by: by.speaker, amount, at: now }, prev));
    this.emit(owner, doc, a.block);
    this.transfer({ kind: "packet", from: holdOf("packet", `${owner}/${id}`), to: by.speaker, amount, note: `领了 ${owner} 的红包 · 第 ${k} 份`, ref: this.address(owner, doc) });
    return { ok: true, amount, left: p.shares - k, balance: this.balance(s.id) };
  }

  /** The packet's rest back to the giver after a day (§9.1), once. */
  private returnPacket(owner: string, id: string): void {
    const doc = `packets/${id}.geml`;
    const a = appendBlock(this.root, owner, doc, () => "returned", (_d, prev, bid) => sealed({ id: bid, at: this.now() }, prev));
    if (a.existed) return;
    this.emit(owner, doc, a.block);
    const hold = holdOf("packet", `${owner}/${id}`);
    const rest = balanceOf(this.ledgerOf(owner), hold);
    if (rest > 0) this.transfer({ kind: "refund", from: hold, to: `person:${owner}`, amount: rest, note: "红包 24 小时没领完，退回", ref: this.address(owner, doc) });
  }

  // --- queues ---

  private queueAccess(by: TokenRecord, owner: string, agent: string): Fail | undefined {
    return by.speaker === `person:${owner}` || by.speaker === `agent:${agent}@${owner}` ? undefined : fail(403, "只有这个 agent 和它的主人能看队列");
  }

  queueOf(by: TokenRecord, owner: string, agent: string): Result<{ queue: Queue; pending: QueueItem[] }> {
    const denied = this.queueAccess(by, owner, agent);
    if (denied !== undefined) return denied;
    if (!NAME.test(owner) || !NAME.test(agent)) return fail(404, "没有这个 agent");
    const { queue } = readQueue(readDoc(this.root, owner, `queues/${agent}.geml`).text);
    return { ok: true, queue, pending: pending(queue, this.now()) };
  }

  /** The daemon's mark on an item: read in, or answered with the reply's address. */
  mark(by: TokenRecord, owner: string, agent: string, kind: string, item: string, reply?: string): Result<{ marker: Marker }> {
    const denied = this.queueAccess(by, owner, agent);
    if (denied !== undefined) return denied;
    if (kind !== "read" && kind !== "answered") return fail(400, "标记只有 read 和 answered");
    const doc = `queues/${agent}.geml`;
    if (!readQueue(readDoc(this.root, owner, doc).text).queue.items.some((i) => i.id === item)) return fail(404, "队列里没有这一条");
    const a = appendBlock(this.root, owner, doc, nextId(kind), () => ({ kind, item, at: this.now(), ...(reply !== undefined ? { reply } : {}) }));
    this.emit(owner, doc, a.block);
    const marker: Marker = { kind, n: Number(a.block.id.slice(kind.length + 1)), item, at: str(a.block.value["at"]) ?? "" };
    if (reply !== undefined) marker.reply = reply;
    return { ok: true, marker };
  }

  // --- presence ---

  /** A session's presence from its agent's token (transport §3); the session is registered on the agent's page the first time it reports. */
  setPresence(by: TokenRecord, body: unknown): Result<{ presence: Presence }> {
    const s = parseSpeaker(by.speaker);
    if (by.scope !== "agent" || s?.kind !== "agent") return fail(403, "只有 agent 的令牌能报在场");
    const b = obj(body) ?? {};
    const session = str(b["session"]), presence = str(b["presence"]);
    if (session === undefined || !NAME.test(session)) return fail(400, "缺会话 id");
    if (presence === undefined || !PRESENCES.has(presence)) return fail(400, "在场状态不合法");
    const key = `${by.speaker}/${session}`;
    const known = this.sessions.get(key);
    const rec: SessionPresence = { speaker: by.speaker, session, host: str(b["host"]) ?? known?.host ?? "", login: str(b["login"]) ?? known?.login ?? "", presence: presence as Presence, at: this.now() };
    const task = str(b["task"]); if (task !== undefined) rec.task = task;
    this.sessions.set(key, rec);
    if (known === undefined) {
      const doc = `agents/${s.name}.geml`;
      const a = appendBlock(this.root, s.owner, doc, nextId("session"), (_d, prev, bid) => sealed({ id: bid, session, host: rec.host, login: rec.login, at: rec.at }, prev));
      this.emit(s.owner, doc, a.block);
    }
    return { ok: true, presence: rec.presence };
  }

  sessionsOf(speaker: string): SessionPresence[] { return [...this.sessions.values()].filter((r) => r.speaker === speaker); }

  /** The agent's presence (§6.10): its most active session, one silent for three minutes counted asleep. */
  presenceOf(speaker: string): { presence: Presence; at?: string; sessions: SessionPresence[] } {
    const now = Date.parse(this.now());
    const sessions = this.sessionsOf(speaker);
    const presence = agentPresence(sessions.map((r) => ({ presence: now - Date.parse(r.at) > STALE_MS ? "asleep" : r.presence })));
    const at = sessions.map((r) => r.at).sort().pop();
    return { presence, ...(at !== undefined ? { at } : {}), sessions };
  }

  // --- trust, requests, grants ---

  private personDoc(id: string): string { return `people/${id}.geml`; }

  trust(by: TokenRecord, person: string): Result<Record<never, never>> {
    if (by.scope !== "person") return fail(403, "只有本人能标信任");
    if (!NAME.test(person)) return fail(400, "名字不合法");
    const me = by.speaker.slice("person:".length);
    if (this.trustedOf(me).includes(person)) return { ok: true };
    const doc = this.personDoc(me);
    const a = appendBlock(this.root, me, doc, nextId("trust"), (_d, prev, bid) => sealed({ id: bid, person, at: this.now() }, prev));
    this.emit(me, doc, a.block);
    return { ok: true };
  }

  trustedOf(owner: string): string[] {
    return readDoc(this.root, owner, this.personDoc(owner)).blocks.filter((b) => /^trust-\d+$/.test(b.id)).map((b) => str(b.value["person"])).filter((p): p is string => p !== undefined);
  }

  /** Someone asks to see one block of the owner's (§7.3): a request on the owner's page, a 放行 in their inbox. */
  requestGrant(by: TokenRecord, owner: string, block: string, reason?: string): Result<{ id: string }> {
    if (by.scope === "inbox") return fail(403, "收件箱令牌不能申请");
    if (!NAME.test(owner)) return fail(404, "没有这个人");
    const a = parseAddress(block);
    if (a === undefined || a.relay !== this.name || a.owner !== owner || a.block === undefined) return fail(400, "要一个这个中继上、这个主人名下、带块的地址");
    if (!readDoc(this.root, owner, this.personDoc(owner)).exists) return fail(404, "没有这个人");
    const doc = this.personDoc(owner);
    const r = appendBlock(this.root, owner, doc, nextId("request"), (_d, prev, bid) => sealed({ id: bid, from: by.speaker, block, at: this.now(), ...(reason !== undefined ? { reason } : {}) }, prev));
    this.emit(owner, doc, r.block);
    return { ok: true, id: r.block.id };
  }

  /**
   * A grant by the owner (§7.3): one block for one person (允许一次: an hour;
   * 允许此人: seven days unless `until` says otherwise), or a scope widened
   * for them (`widen`: write, run, budget). Every grant is a record.
   */
  grant(by: TokenRecord, body: unknown): Result<{ id: string }> {
    if (by.scope !== "person") return fail(403, "只有本人能放行");
    const me = by.speaker.slice("person:".length);
    const b = obj(body) ?? {};
    const person = str(b["person"]);
    if (person === undefined || !NAME.test(person)) return fail(400, "放给谁？");
    const block = str(b["block"]), widen = obj(b["widen"]);
    if (block === undefined && widen === undefined) return fail(400, "要放一个块，或放宽范围");
    const at = this.now();
    const value: Record<string, JsonValue> = { to: { person }, at };
    if (block !== undefined) {
      const a = parseAddress(block);
      if (a === undefined || a.relay !== this.name || a.owner !== me || a.block === undefined) return fail(403, "只能放自己名下的块");
      value["block"] = block;
    }
    if (widen !== undefined) {
      const w: Record<string, JsonValue> = {};
      if (widen["write"] === true) w["write"] = true;
      const run = str(widen["run"]); if (run !== undefined) { if (!RUNS.has(run)) return fail(400, "run 不合法"); w["run"] = run as Run; }
      const budget = num(widen["budget"]); if (budget !== undefined) w["budget"] = budget;
      value["widen"] = w;
    }
    const until = str(b["until"]);
    value["until"] = until !== undefined ? until : b["once"] === true ? new Date(Date.parse(at) + ONE_HOUR_MS).toISOString().replace(/\.\d{3}Z$/, "Z") : grantUntil(at);
    const request = str(b["request"]); if (request !== undefined) value["request"] = request;
    const doc = this.personDoc(me);
    const g = appendBlock(this.root, me, doc, nextId("grant"), (_d, prev, bid) => sealed({ id: bid, ...value }, prev));
    this.emit(me, doc, g.block);
    return { ok: true, id: g.block.id };
  }

  refuse(by: TokenRecord, request: string): Result<Record<never, never>> {
    if (by.scope !== "person") return fail(403, "只有本人能拒绝");
    const me = by.speaker.slice("person:".length);
    const doc = this.personDoc(me);
    if (!readDoc(this.root, me, doc).blocks.some((b) => b.id === request)) return fail(404, "没有这个申请");
    const r = appendBlock(this.root, me, doc, nextId("refuse"), (_d, prev, bid) => sealed({ id: bid, request, at: this.now() }, prev));
    this.emit(me, doc, r.block);
    return { ok: true };
  }

  private grantBlocks(owner: string): DataBlock[] {
    return readDoc(this.root, owner, this.personDoc(owner)).blocks.filter((b) => /^grant-\d+$/.test(b.id));
  }

  blockGrantsOf(owner: string): BlockGrant[] {
    const out: BlockGrant[] = [];
    for (const b of this.grantBlocks(owner)) {
      const person = str(obj(b.value["to"])?.["person"]), block = str(b.value["block"]);
      if (person === undefined || block === undefined) continue;
      const g: BlockGrant = { person, block };
      const until = str(b.value["until"]); if (until !== undefined) g.until = until;
      out.push(g);
    }
    return out;
  }

  /** The grants that widen a tool scope (core/im/sender.ts `scopeFor`), for the owner's daemon. */
  scopeGrantsOf(owner: string): Grant[] { return scopeGrantsFrom(this.grantBlocks(owner)); }

  // --- the inbox ---

  /** Every venue the person is in, across owners. */
  venuesOf(person: string): VenueDoc[] {
    const out: VenueDoc[] = [];
    for (const owner of listOwners(this.root)) for (const doc of listDocs(this.root, owner, "venues")) {
      const vd = this.venueOf(owner, doc.slice("venues/".length, -".geml".length));
      if (vd !== undefined && vd.venue.people.includes(person)) out.push(vd);
    }
    return out;
  }

  /** The person's agents by name, from their pages. */
  agentsOf(person: string): string[] {
    return listDocs(this.root, person, "agents").map((d) => d.slice("agents/".length, -".geml".length));
  }

  /** The person's 「需要我」 (§6.9), computed: 定, 放行, 断了 here; 验收 and 卡住 come from the cards and the daemon. */
  inbox(person: string): Need[] {
    const out: Need[] = [];
    const me = `person:${person}`;
    const now = this.now();
    for (const vd of this.venuesOf(person)) {
      for (const m of vd.messages) {
        if (m.kind !== "ask" || m.ask === undefined || (m.ask.who !== me && m.ask.who !== person)) continue;
        if (m.ask.expires !== undefined && m.ask.expires <= now) continue;
        if (vd.messages.some((r) => r.replyTo === m.id && r.speaker === me)) continue;
        out.push({ kind: "decide", key: `${vd.venue.address}#${m.id}`, text: `${VENUE_WORDS[vd.venue.kind]}「${vd.venue.name}」· ${shownName(m.speaker)} 问：${m.ask.question}`, actions: defaultActions("decide", { options: m.ask.options }), since: m.at, venue: vd.venue.id, level: 0 });
      }
    }
    const pd = readDoc(this.root, person, this.personDoc(person));
    const answered = new Set(pd.blocks.filter((b) => /^(grant|refuse)-\d+$/.test(b.id)).map((b) => str(b.value["request"])));
    for (const b of pd.blocks) {
      if (!/^request-\d+$/.test(b.id) || answered.has(b.id)) continue;
      const from = str(b.value["from"]) ?? "", block = str(b.value["block"]) ?? "", reason = str(b.value["reason"]);
      out.push({ kind: "grant", key: this.address(person, this.personDoc(person), b.id), text: `${shownName(from)} 申请看 ${block}${reason === undefined ? "" : `：${reason}`}`, actions: defaultActions("grant", {}), since: str(b.value["at"]) ?? "", level: 0 });
    }
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
    const allowed = new Set(pd.blocks.filter((b) => /^cap-allow-\d+$/.test(b.id)).map((b) => str(b.value["ask"])));
    for (const b of pd.blocks) {
      if (!/^cap-ask-\d+$/.test(b.id) || allowed.has(b.id)) continue;
      const agent = str(b.value["agent"]) ?? "", credits = num(b.value["credits"]) ?? 0, cap = str(b.value["cap"]) ?? "auto", note = str(b.value["note"]);
      out.push({ kind: "grant", key: this.address(person, this.personDoc(person), b.id), text: `${agent} 想再花 ${credits} 积分（${CAP_WORDS[cap as CapKey] ?? cap}）${note === undefined ? "" : `：${note}`}`, actions: [`今天再 ${credits}`, "不行"], since: str(b.value["at"]) ?? "", level: 0 });
    }
    out.push(...this.cardNeeds(person, now));
    const t = Date.parse(now);
    for (const r of this.sessions.values()) {
      const a = parseSpeaker(r.speaker);
      if (a?.kind !== "agent" || a.owner !== person || r.presence === "asleep") continue;
      const age = t - Date.parse(r.at);
      if (age > STALE_MS) out.push({ kind: "offline", key: `offline:${r.speaker}/${r.session}`, text: `你电脑上的守护进程 ${Math.floor(age / 60_000)} 分钟没心跳（${a.name} · ${r.session}）`, actions: defaultActions("offline", {}), since: r.at, level: 0 });
    }
    return sortNeeds(out);
  }
}
