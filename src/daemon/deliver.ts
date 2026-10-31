// Delivery and answers for a host, over the mirror and the outbox alone
// (transport §3 投递, §2.7; main §6.5, rule 8): the next queue item with the
// envelope the host writes above it (core/im/envelope.ts) and its context
// pack expanded within the budget from what is mirrored (rule 3, §5.1); the
// read-in and answered markers; the final answer sent back to the source
// venue as the agent, or held as a draft when the owner wants to see it
// first; what a person says from the 「消息」 page; a session's presence
// report. No network: the daemon pushes the outbox when it can, and a host
// without a daemon still reads the last mirror.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseAddress } from "../core/im/address.js";
import { readDataBlocks, renderDataBlock, seal, type DataBlock } from "../core/im/chain.js";
import { expandEmbeds, type Access, type Embed } from "../core/im/embed.js";
import { envelopeLine, withEnvelope } from "../core/im/envelope.js";
import { parseSpeaker, personBehind } from "../core/im/identity.js";
import type { Ask, MessageKind } from "../core/im/message.js";
import type { Presence } from "../core/im/presence.js";
import type { SignalInput } from "../core/im/signal.js";
import { appendText } from "../host-fs.js";
import { next, pending, readQueue, type Marker, type Queue, type QueueItem } from "../core/im/queue.js";
import { scopeFor, type ToolScope } from "../core/im/sender.js";
import { scopeLine } from "../core/im/share.js";
import { RECEPTION_PREFIX } from "../core/im/social.js";
import { toolWords, type ToolKey, WORK_WORDS, type VenueOfWork } from "../core/im/card.js";
import type { JsonValue } from "../core/schema.js";
import { textOf } from "../relay/access.js";
import { foldVenue, scopeGrantsFrom, type VenueDoc } from "../relay/relay.js";
import { enqueueOutbox, listDrafts, listOutbox, newBlockId, readConfig, readDraft, readMirror, removeDraft, reportSession, roomDir, writeDraft, type Config, type Draft, type OutboxEntry } from "./home.js";

export interface Delivered {
  item: QueueItem;
  envelope: string;
  /** The prompt as the model sees it: the envelope (a guest's with the public range under it), the text, the context pack. */
  text: string;
  scope: ToolScope;
  queued: number;
  draftFirst: boolean;
  /** Items that ran out meanwhile. */
  dropped: QueueItem[];
  /** A card's turn: the guest room made for it (§7.5). */
  room?: string;
}

function requireConfig(home: string): Config {
  const c = readConfig(home);
  if (c === undefined) throw new Error("没有 connect.json：先 gemworks connect setup");
  return c;
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/** The agent's mirrored queue, the outbox's unpushed markers for it counted as markers (an item read in while offline is not delivered twice), and a draft held for an item counted as its answer. */
function queueOf(home: string, c: Config, agent: string): Queue {
  const { queue } = readQueue(readMirror(home, c.relay.name, c.person, `queues/${agent}.geml`).text);
  const doc = `queues/${agent}.geml`;
  const markers: Marker[] = [...queue.markers];
  for (const d of listDrafts(home)) if (d.agent === agent) markers.push({ kind: "answered", n: markers.length + 1, item: d.item, at: d.at });
  for (const e of listOutbox(home)) {
    if (e.kind !== "marker" || e.owner !== c.person || e.doc !== doc) continue;
    const kind = e.body["kind"], item = e.body["item"];
    if ((kind !== "read" && kind !== "answered") || typeof item !== "string") continue;
    const m: Marker = { kind, n: markers.length + 1, item, at: e.at };
    const reply = str(e.body["reply"]); if (reply !== undefined) m.reply = reply;
    markers.push(m);
  }
  return { items: queue.items, markers };
}

/** The venue an item came from, as mirrored. */
function venueOfItem(home: string, c: Config, item: QueueItem): VenueDoc | undefined {
  const owner = item.message === undefined ? undefined : parseAddress(item.message)?.owner;
  if (owner === undefined) return undefined;
  const m = readMirror(home, c.relay.name, owner, `venues/${item.venue}.geml`);
  return m.exists ? foldVenue(owner, item.venue, { blocks: m.blocks, diagnostics: [], text: m.text, exists: true }, c.relay.name) : undefined;
}

/** Embeds resolved from the mirror: a mirrored block is its text, a mirrored stub a denial, anything else unknown. */
export function localAccess(home: string, c: Config): Access {
  return (e) => {
    const a = parseAddress(e.src);
    if (a === undefined || a.relay !== c.relay.name || a.block === undefined) return undefined;
    const m = readMirror(home, c.relay.name, a.owner, a.doc);
    let block: DataBlock | undefined;
    if (a.block === "announce") { const all = m.blocks.filter((b) => /^announce-\d+$/.test(b.id)); block = all[all.length - 1]; }
    else block = m.blocks.find((b) => b.id === a.block);
    if (block === undefined) return undefined;
    const session = str(block.value["session"]), turn = str(block.value["turn"]);
    const extra = { ...(session !== undefined ? { session } : {}), ...(turn !== undefined ? { turn } : {}) };
    if (block.value["stub"] === true) return { denied: true, owner: a.owner, ...extra };
    return { text: textOf(block), hash: str(block.value["hash"]) ?? "", owner: a.owner, ...extra };
  };
}

/** The context pack as the model reads it: each embed's address, then its text, a 你看不到 line, or that it was not expanded. Empty for no embeds. */
export function contextText(home: string, agent: string, embeds: readonly Embed[]): string {
  if (embeds.length === 0) return "";
  const c = requireConfig(home);
  const { expanded, left } = expandEmbeds(embeds, `agent:${agent}@${c.person}`, localAccess(home, c));
  const parts: string[] = [];
  for (const r of expanded) {
    if (r.text !== undefined) parts.push(`${r.embed.src}\n${r.text}`);
    else if (r.stub !== undefined) parts.push(`${r.embed.src}\n你看不到：来自 ${r.stub.from} 的私有范围${r.stub.session === undefined ? "" : ` · 会话 ${r.stub.session}`}${r.stub.turn === undefined ? "" : ` · 第 ${r.stub.turn} 轮`} · ${r.stub.action}`);
    else parts.push(`${r.embed.src}\n（没展开，用读取工具按需取）`);
  }
  for (const e of left) parts.push(`${e.src}\n（没展开，用读取工具按需取）`);
  return `（上下文）\n${parts.join("\n\n")}`;
}

/** The scope a card gives the turn (§7.2, §7.5, core/im/card.ts `scopeOfCard` over the item's copy): writes where the tools say 改 or 部署, a sandbox run where they say 测 or 跑 or the sandbox is the resource owner's, the budget the card's credits. */
function scopeOfCardRef(ref: NonNullable<QueueItem["card"]>): ToolScope {
  const tools = ref.tools;
  const write = tools.includes("edit") || tools.includes("deploy");
  const run = ref.venueOfWork === "resource-sandbox" || tools.includes("test") || tools.includes("run") ? "sandbox" : "none";
  return { write, run, budget: ref.credits ?? null };
}

/** The line under the envelope for a card's turn (§8.1): the card, where the work happens, the tools, the limit, the verbs. */
function cardPromptLine(ref: NonNullable<QueueItem["card"]>, room: string): string {
  const where = (ref.venueOfWork in WORK_WORDS ? WORK_WORDS[ref.venueOfWork as VenueOfWork] : ref.venueOfWork);
  const tools = toolWords(ref.tools.filter((t): t is ToolKey => t in WORK_TOOLS));
  return `[任务卡 #${ref.id}「${ref.title}」 · 在${where}里干 · 工具：${tools} · 上限 ${ref.credits === undefined ? "无" : `${ref.credits} 积分`} · 客房：${room} · 记录和交付用 im_card]`;
}
const WORK_TOOLS: Readonly<Record<ToolKey, true>> = { read: true, edit: true, test: true, run: true, comment: true, view: true, deploy: true };
/** The guest room (§7.5) for a card's turn: the 委托书 as CARD.md, the context pack's texts under context/, made or refreshed as the item is delivered; the model works there. */
function prepareRoom(home: string, c: Config, agent: string, item: QueueItem, card: NonNullable<QueueItem["card"]>): string {
  const room = roomDir(home, card.id);
  mkdirSync(join(room, "context"), { recursive: true });
  writeFileSync(join(room, "CARD.md"), `# 任务卡 #${card.id}「${card.title}」\n\n${item.prompt}\n`, "utf8");
  const { expanded } = expandEmbeds(item.context ?? [], `agent:${agent}@${c.person}`, localAccess(home, c));
  expanded.forEach((r, i) => { if (r.text !== undefined) writeFileSync(join(room, "context", `${i + 1}.md`), `${r.embed.src}\n\n${r.text}\n`, "utf8"); });
  return room;
}
/** The next item for the agent's session (§6.5), with its envelope and its context; nothing when none waits. */
export function nextPrompt(home: string, agent: string, now: string): Delivered | undefined {
  const c = requireConfig(home);
  const q = queueOf(home, c, agent);
  const { item, dropped } = next(q, now);
  if (item === undefined) return undefined;
  const queued = pending(q, now).length - 1;
  const sender = parseSpeaker(item.sender);
  const person = sender === undefined ? undefined : personBehind(sender);
  const page = readMirror(home, c.relay.name, c.person, `people/${c.person}.geml`);
  const scope = item.card !== undefined ? scopeOfCardRef(item.card) : scopeFor(item.level, { ...(person !== undefined ? { person } : {}), venue: item.venue, grants: scopeGrantsFrom(page.blocks), now });
  const vd = venueOfItem(home, c, item);
  const draftFirst = vd?.venue.policy.draftFirst === true;
  const envelope = envelopeLine({ venueKind: item.venueKind, venueName: item.venueName, senderName: item.senderName, level: item.level, scope, queued, draftFirst });
  // A guest's question (§11): the card's public range, the guest DM's announce, stands under the envelope — what the agent may talk about comes from the host, not from the text.
  const room = item.card === undefined ? undefined : prepareRoom(home, c, agent, item, item.card);
  // The social secretary's first word (§11): the reception the relay wrote into the DM stands under a first question's range line, and no later one's.
  const reception = item.venueKind === "guest-dm" && vd !== undefined && vd.messages.filter((x) => x.speaker.startsWith("guest:")).length <= 1 ? vd.messages.find((x) => x.kind === "system" && x.text.startsWith(RECEPTION_PREFIX))?.text : undefined;
  const head = item.card !== undefined ? `${envelope}\n${cardPromptLine(item.card, room ?? "")}` : item.venueKind === "guest-dm" && vd?.venue.announce !== undefined ? `${envelope}\n${scopeLine(vd.venue.announce.text)}${reception === undefined ? "" : `\n[${reception}]`}` : envelope;
  const context = contextText(home, agent, item.context ?? []);
  return { item, envelope, text: withEnvelope(head, context === "" ? item.prompt : `${item.prompt}\n\n${context}`), scope, queued, draftFirst, dropped, ...(room !== undefined ? { room } : {}) };
}

/** The session took the item in (§6.5 已读入). */
export function markRead(home: string, agent: string, item: QueueItem, now: string): OutboxEntry {
  const c = requireConfig(home);
  return enqueueOutbox(home, { kind: "marker", as: `agent:${agent}`, owner: c.person, doc: `queues/${agent}.geml`, body: { kind: "read", item: item.id }, at: now });
}

export interface AnswerOptions { kind?: Extract<MessageKind, "chat" | "report">; evidence?: Embed[]; parts?: Embed[]; opinion?: string; turn?: string; session?: string }

/** The reply as a message body for the source venue: the agent's, answering the item's message, with the hops it was handling. */
function replyBody(item: QueueItem, text: string, now: string, o: AnswerOptions): { owner: string; doc: string; body: Record<string, JsonValue>; address: string } {
  const a = item.message === undefined ? undefined : parseAddress(item.message);
  if (a === undefined) throw new Error("这一条没有来源消息的地址");
  // A card's turn (§8) answers into the card's thread, not under a message: the item's venue is the thread, under the card's owner.
  const target = item.card !== undefined ? { owner: a.owner, doc: `venues/${item.venue}.geml` } : a.block === undefined ? undefined : { owner: a.owner, doc: a.doc, replyTo: a.block };
  if (target === undefined) throw new Error("这一条没有来源消息的地址");
  const body: Record<string, JsonValue> = { id: newBlockId(now), kind: o.kind ?? "chat", text, ...(target.replyTo !== undefined ? { replyTo: target.replyTo } : {}), handling: item.hops };
  if (o.evidence !== undefined) body["evidence"] = o.evidence as unknown as JsonValue;
  if (o.parts !== undefined) body["parts"] = o.parts as unknown as JsonValue;
  if (o.opinion !== undefined) body["opinion"] = o.opinion;
  if (o.turn !== undefined) body["turn"] = o.turn;
  if (o.session !== undefined) body["session"] = o.session;
  return { owner: target.owner, doc: target.doc, body, address: `https://${a.relay}/${target.owner}/${target.doc}#${String(body["id"])}` };
}

function answered(home: string, c: Config, agent: string, item: string, now: string, reply?: string): OutboxEntry {
  return enqueueOutbox(home, { kind: "marker", as: `agent:${agent}`, owner: c.person, doc: `queues/${agent}.geml`, body: { kind: "answered", item, ...(reply !== undefined ? { reply } : {}) }, at: now });
}

/**
 * The session's final answer (§6.5): sent back to the source venue as the
 * agent, with the answered marker — or, where the venue has 回群前先给我看,
 * held as a draft for the owner, the item counting as answered meanwhile.
 */
export function answer(home: string, agent: string, item: QueueItem, text: string, now: string, o: AnswerOptions = {}): { sent: string } | { draft: string } {
  const c = requireConfig(home);
  const r = replyBody(item, text, now, o);
  if (venueOfItem(home, c, item)?.venue.policy.draftFirst === true) {
    const draft: Draft = { id: `d-${String(r.body["id"]).slice(2)}`, agent, item: item.id, owner: r.owner, doc: r.doc, body: r.body, at: now, venueName: item.venueName, reply: r.address };
    writeDraft(home, draft);
    return { draft: draft.id };
  }
  enqueueOutbox(home, { kind: "message", as: `agent:${agent}`, owner: r.owner, doc: r.doc, body: r.body, at: now });
  answered(home, c, agent, item.id, now, r.address);
  return { sent: r.address };
}

/** 就这么发: the draft goes to the outbox with its answered marker. */
export function sendDraft(home: string, id: string, now: string): { sent: string } | undefined {
  const c = requireConfig(home);
  const d = readDraft(home, id);
  if (d === undefined) return undefined;
  enqueueOutbox(home, { kind: "message", as: `agent:${d.agent}`, owner: d.owner, doc: d.doc, body: d.body, at: now });
  answered(home, c, d.agent, d.item, now, d.reply);
  removeDraft(home, id);
  return { sent: d.reply };
}

/** 不发: the draft is dropped and the item marked answered with no reply, so it is not delivered again. */
export function dropDraft(home: string, id: string, now: string): boolean {
  const c = requireConfig(home);
  const d = readDraft(home, id);
  if (d === undefined) return false;
  answered(home, c, d.agent, d.item, now);
  removeDraft(home, id);
  return true;
}

/** What a person says from the 「消息」 page, or an agent through its tools: a message for the venue, pushed when the daemon can. */
export function say(home: string, o: { as: string; owner: string; venue: string; text: string; kind?: MessageKind; parts?: Embed[]; evidence?: Embed[]; ask?: Ask; opinion?: string; turn?: string; session?: string; replyTo?: string }, now: string): OutboxEntry {
  const body: Record<string, JsonValue> = { id: newBlockId(now), kind: o.kind ?? "chat", text: o.text };
  if (o.parts !== undefined) body["parts"] = o.parts as unknown as JsonValue;
  if (o.evidence !== undefined) body["evidence"] = o.evidence as unknown as JsonValue;
  if (o.ask !== undefined) body["ask"] = o.ask as unknown as JsonValue;
  if (o.opinion !== undefined) body["opinion"] = o.opinion;
  if (o.turn !== undefined) body["turn"] = o.turn;
  if (o.session !== undefined) body["session"] = o.session;
  if (o.replyTo !== undefined) body["replyTo"] = o.replyTo;
  return enqueueOutbox(home, { kind: "message", as: o.as, owner: o.owner, doc: `venues/${o.venue}.geml`, body, at: now });
}

/** A 放行 answered (§7.3): 允许一次 (an hour), 允许此人 (seven days) or 拒绝, as the person, through the outbox. */
export function answerGrant(home: string, o: { request: string; person: string; block: string; action: "allow-once" | "allow-person" | "refuse" }, now: string): OutboxEntry {
  const c = requireConfig(home);
  if (o.action === "refuse") return enqueueOutbox(home, { kind: "refuse", as: "person", owner: c.person, doc: "", body: { request: o.request }, at: now });
  return enqueueOutbox(home, { kind: "grant", as: "person", owner: c.person, doc: "", body: { person: o.person, block: o.block, request: o.request, ...(o.action === "allow-once" ? { once: true } : {}) }, at: now });
}

/** An agent's ask for credits answered (§9.1): today's allowance, or not, as the person, through the outbox. */
export function answerAllow(home: string, o: { ask: string; allowed: boolean }, now: string): OutboxEntry {
  const c = requireConfig(home);
  return enqueueOutbox(home, { kind: "allow", as: "person", owner: c.person, doc: "", body: { ask: o.ask, allowed: o.allowed }, at: now });
}

/** A digest's 定 (§11, rule 6): 发 as drafted, 发 with the owner's own words, or 不发, as the person, through the outbox. */
export function answerDigest(home: string, o: { draft: string; publish: boolean; text?: string }, now: string): OutboxEntry {
  const c = requireConfig(home);
  return enqueueOutbox(home, { kind: "digest", as: "person", owner: c.person, doc: "", body: { draft: o.draft, publish: o.publish, ...(o.text !== undefined ? { text: o.text } : {}) }, at: now });
}

/** A match's nod (§11 牵线), as the person, through the outbox; `owner` and `id` name the proposer's record. */
export function answerMatch(home: string, o: { owner: string; id: string; yes: boolean }, now: string): OutboxEntry {
  const c = requireConfig(home);
  return enqueueOutbox(home, { kind: "match", as: "person", owner: o.owner, doc: o.id, body: { yes: o.yes }, at: now });
}

/** A signal from this host's agent (§10.2 发布即双重盖戳): sealed onto the host's own chain under the home first — `<home>/signals/<agent>.geml`, each block hashed over the last — then to the relay through the outbox with that stamp and hash. */
export function publishSignal(home: string, agent: string, input: SignalInput & { channel: string }, now: string): { id: string; hash: string } {
  const c = requireConfig(home);
  const path = join(home, "signals", `${agent}.geml`);
  const blocks = existsSync(path) ? readDataBlocks(readFileSync(path, "utf8")).blocks : [];
  const last = blocks[blocks.length - 1];
  const prev = typeof last?.value["hash"] === "string" ? last.value["hash"] : null;
  const id = newBlockId(now).replace(/^m-/, "s-");
  const block = seal({ id, ...(input as unknown as Record<string, JsonValue>), from: `agent:${agent}@${c.person}`, at: now }, prev);
  if (!existsSync(path)) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, `=== meta\ntitle = "gemworks im signals ${agent}"\n===\n\n`, "utf8"); }
  appendText(path, renderDataBlock(id, block as unknown as JsonValue));
  enqueueOutbox(home, { kind: "signal", as: `agent:${agent}`, owner: c.person, doc: "", body: { ...(input as unknown as Record<string, JsonValue>), at: now, hostHash: block.hash }, at: now });
  return { id, hash: block.hash };
}

/** A retraction (§10.2), as the agent, through the outbox; the relay marks its chain. */
export function retractSignal(home: string, agent: string, id: string, now: string): OutboxEntry {
  const c = requireConfig(home);
  return enqueueOutbox(home, { kind: "retract", as: `agent:${agent}`, owner: c.person, doc: id, body: {}, at: now });
}

/** A session's presence as the host sees it (transport §3 会话登记); the daemon posts it with the heartbeat. */
export function reportPresence(home: string, agent: string, session: string, r: { host: string; login: string; presence: Presence; task?: string }, now: string): void {
  reportSession(home, agent, session, { ...r, at: now });
}
