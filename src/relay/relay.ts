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
import { parseAddress } from "../core/im/address.js";
import { renderDataBlock, type DataBlock } from "../core/im/chain.js";
import { deliver, type AgentInVenue, type Delivery, type DeliveryInput, type PromptTo } from "../core/im/delivery.js";
import type { Access, Embed, Stub } from "../core/im/embed.js";
import { formatSpeaker, parseSpeaker, personBehind, type Source, type Speaker } from "../core/im/identity.js";
import { draftFaults, KIND_WORDS, readMessages, stamp, type Ask, type Draft, type Message, type MessageKind } from "../core/im/message.js";
import type { RosterEntry } from "../core/im/mentions.js";
import { defaultActions, sortNeeds, type Need } from "../core/im/needs-me.js";
import { agentPresence, presenceText, type Presence } from "../core/im/presence.js";
import { agentBadge, byline, guestHeader, quotaOf, QUOTA_WORDS, rangeWords, readShare, sameDay, shareFaults, shareInput, summaryTag, useLine, type GuestQuota, type ShareCard } from "../core/im/share.js";
import { acceptance, acceptTag, briefLines, briefText, cardFaults, cardInput, deliverableFaults, DIRECTION_WORDS, foldCard, heartbeatWords, isStale, MACHINE, moveFault, openSlots, progressLine, rolesOf, STATE_WORDS, waitingOn, type Card, type CardState, type Role } from "../core/im/card.js";
import { enqueue, pending, readQueue, type ItemDraft, type Marker, type Queue, type QueueItem } from "../core/im/queue.js";
import { densityAllows, grantUntil, levelOf, type Grant, type Run } from "../core/im/sender.js";
import { ANNOUNCE_LIMIT, contextSegment, DEFAULT_POLICY, setAnnounce as announce, VENUE_WORDS, type Policy, type PromptFrom, type Venue, type VenueKind } from "../core/im/venue.js";
import type { JsonValue } from "../core/schema.js";
import { accessFor, canRead, type BlockGrant, type World } from "./access.js";
import { appendBlock, appendSealed, BLOCK_ID, DOC, listDocs, listOwners, NAME, nextId, readDoc, RELAY_OWNER, sealed, type Doc } from "./store.js";
import { issueToken, verifyToken, type TokenRecord } from "./tokens.js";

export type Federation = "open" | "closed";
export interface RelayOptions { root: string; name: string; federation?: Federation; version?: string; now?: () => string }
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

export class Relay {
  readonly root: string;
  readonly name: string;
  readonly federation: Federation;
  readonly version: string;
  private readonly clock: () => string;
  private readonly sessions = new Map<string, SessionPresence>();
  private readonly listeners = new Set<(p: Pushed) => void>();

  constructor(o: RelayOptions) {
    this.root = o.root;
    this.name = o.name;
    this.federation = o.federation ?? "closed";
    this.version = o.version ?? "unknown";
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
    appendSealed(this.root, id, `people/${id}.geml`, "person", { name: id, at: this.now() });
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
  private appendSystem(owner: string, id: string, text: string): Message {
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
    const delivery = deliver(message, this.deliveryInput(vd, handling));
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

  private deliveryInput(vd: VenueDoc, handling: number | undefined): DeliveryInput {
    const agents: AgentInVenue[] = [...vd.agentSpeakers].map(([name, speaker]) => {
      const a = parseSpeaker(speaker) as Extract<Speaker, { kind: "agent" }>;
      const policy = this.agentPolicy(a.owner, a.name);
      return { name, speaker, relations: { owner: a.owner, trusted: this.trustedOf(a.owner), members: vd.venue.people }, ...(policy !== undefined ? { policy } : {}) };
    });
    const roster: RosterEntry[] = [
      ...vd.venue.people.filter((p) => !p.includes(":")).map((name): RosterEntry => ({ name, kind: "person" })),
      ...vd.venue.agents.map((name): RosterEntry => ({ name, kind: "agent" })),
      { name: "所有人", kind: "everyone" },
    ];
    return { venue: vd.venue, agents, roster, ...(handling !== undefined ? { handling } : {}) };
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
    const thread = `th-${id}`;
    if (this.venueOf(owner, thread) === undefined) {
      const made = this.createVenueAs(owner, { id: thread, kind: "thread", name: card.title, people: [], agents: [], anchor: `${this.cardAddress(owner, id)}#card`, parent: key });
      if (!made.ok) return made;
    }
    const moved = this.moveTask(owner, card, "open", by, { venue: key, thread });
    if (!moved.ok) return moved;
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
    if (!this.sessionsOf(agent).some((r) => r.login !== "" && r.login !== "subscription")) return fail(403, `订阅登录的会话不接单（${name} 还没有 API 或自托管的会话）`);
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

  /** The settlement a state note records at 已接受 (§8.2; the ledger is ⑤). */
  private settlementNote(card: Card): string {
    switch (card.reward.kind) {
      case "none": return "无报酬";
      case "tip": return "打赏自愿";
      case "escrow": return `结算 ${card.reward.credits} 积分（托管；账本在 ⑤）`;
      case "prize": return `结算 ${card.reward.credits} 积分（奖金；账本在 ⑤）${card.reward.participation === undefined ? "" : `· 参与补偿 ${card.reward.participation}`}`;
    }
  }

  private acceptedSlot(card: Card): number | undefined { return [...card.slots].reverse().find((s) => s.state === "delivered")?.n; }

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
    return this.moveTask(owner, card, "accepted", by, { note: this.settlementNote(card), ...(slot !== undefined ? { slot } : {}) });
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

  settleTask(by: TokenRecord, owner: string, id: string, body: unknown): Result<{ card: Card }> {
    const card = this.taskOf(owner, id);
    if (card === undefined) return fail(404, "没有这张卡");
    const outcome = str(obj(body)?.["outcome"]);
    if (outcome !== "accepted" && outcome !== "closed") return fail(400, "结果是 accepted 或 closed");
    const slot = this.acceptedSlot(card);
    return this.moveTask(owner, card, outcome, by, outcome === "accepted" ? { note: this.settlementNote(card), ...(slot !== undefined ? { slot } : {}) } : {});
  }

  closeTask(by: TokenRecord, owner: string, id: string, body: unknown): Result<{ card: Card }> {
    const card = this.taskOf(owner, id);
    if (card === undefined) return fail(404, "没有这张卡");
    const reason = str(obj(body)?.["reason"]);
    return this.moveTask(owner, card, "closed", by, reason === undefined ? {} : { note: reason });
  }

  /** The card as a reader sees it: the record, its address, the 委托书, the progress line, whom it waits on, the heartbeat. */
  taskView(owner: string, id: string, viewer: string): Result<{ card: Card; address: string; brief: { label: string; text: string }[]; progress: string; waitingOn?: string; heartbeat: string }> {
    const card = this.taskOf(owner, id);
    if (card === undefined) return fail(404, "没有这张卡");
    if (!canRead({ relay: this.name, owner, doc: `cards/${id}.geml`, viewer }, this.world())) return fail(403, "无权看这张卡");
    const w = waitingOn(card);
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
  tick(now: string = this.now()): { returned: string[] } {
    const returned: string[] = [];
    for (const { owner, card } of this.allTasks()) {
      if (!isStale(card, now, GIVE_BACK_AFTER_MS)) continue;
      const slot = card.slots.find((s) => s.state === "working")?.n;
      const moved = this.moveTask(owner, card, "open", "host", { note: "超时自动交回", ...(slot !== undefined ? { slot } : {}) });
      if (moved.ok) returned.push(card.id);
    }
    return { returned };
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
    if (this.venueOf(owner, venueId) === undefined) {
      const made = this.createVenueAs(owner, { id: venueId, kind: "guest-dm", name: shownName(guest.speaker), people: [guest.speaker], agents: [`agent:${card.agent}@${owner}`], announce: card.scope, card: cardId });
      if (!made.ok) return made;
    }
    const r = this.appendMessage(guest, owner, venueId, { id: mid ?? `m-${rand()}`, text });
    if (!r.ok) return r;
    if (ip !== undefined) this.ipBump(ip, now);
    return { ok: true, ...(issued !== undefined ? { token: issued.token } : {}), speaker: guest.speaker, venue: venueId, message: r.message, left: Math.max(0, quota.perGuestPerDay - used - 1) };
  }

  /** Questions by network address today, in memory: a relay restarted forgets them, which errs on the guests' side. */
  private readonly ips = new Map<string, { day: string; n: number }>();
  private ipToday(ip: string, now: string): number { const e = this.ips.get(ip); return e !== undefined && sameDay(e.day, now) ? e.n : 0; }
  private ipBump(ip: string, now: string): void { this.ips.set(ip, { day: now.slice(0, 10), n: this.ipToday(ip, now) + 1 }); }

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
