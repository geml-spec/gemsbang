// What a host shows of the IM, read from the daemon's home (plan C): the
// connection, the inbox, the venues with their unread, the drafts waiting,
// the agents' presence; one venue as a thread with every speaker drawn as
// rule 6 says and the sender's status line under the person's own calls
// (§6.5); and what the read tool answers (rule 3). Node-side (it reads
// files), no network: the daemon keeps the mirrors fresh.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseAddress } from "../core/im/address.js";
import { briefLines, DIRECTION_WORDS, foldCard, heartbeatWords, progressLine, rolesOf, STATE_WORDS, waitingOn, type Card, type CardState, type Direction, type Role } from "../core/im/card.js";
import { resolveEmbed, type Embed } from "../core/im/embed.js";
import { agentLabel, parseSpeaker, QUOTED_TAG, type Source } from "../core/im/identity.js";
import { KIND_WORDS, type Ask, type MessageKind } from "../core/im/message.js";
import { defaultActions, sortNeeds, type Need } from "../core/im/needs-me.js";
import { agentPresence, isAlive, type Presence } from "../core/im/presence.js";
import { readQueue, senderStatus, type Queue } from "../core/im/queue.js";
import { listRow, VENUE_WORDS, type VenueKind } from "../core/im/venue.js";
import { foldVenue, shownName, type VenueDoc } from "../relay/relay.js";
import { localAccess } from "./deliver.js";
import { listDrafts, listSessions, readConfig, readInbox, readMirror, readState, type Config } from "./home.js";

export interface VenueRow { owner: string; id: string; kind: VenueKind; kindWord: string; name: string; status: string; unread: number; last?: string }
export interface DraftRow { id: string; agent: string; venueName: string; text: string; at: string }

/** A task card as the board's 消息 page lists it (§8.1): the record, its words, the person's role on it and the buttons that role has now. */
export interface CardRow {
  owner: string;
  id: string;
  title: string;
  direction: Direction;
  directionWord: string;
  state: CardState;
  stateWord: string;
  progress: string;
  brief: { label: string; text: string }[];
  role: Role | "member";
  worker?: string;
  waitingOn?: string;
  heartbeat: string;
  versions: number;
  actions: string[];
  card: Card;
}
export interface ImStatus {
  configured: boolean;
  person?: string;
  relay?: string;
  agents: string[];
  connected?: boolean;
  at?: string;
  error?: string;
  needs: Need[];
  venues: VenueRow[];
  drafts: DraftRow[];
  cards: CardRow[];
  presence: Record<string, Presence>;
}

/** An embed under a message as the page shows it: its text, a 你看不到 line, or neither (not mirrored). */
export interface Part { src: string; text?: string; stub?: string }
export interface ThreadMessage {
  id: string;
  speaker: string;
  /** The speaker as rule 6 draws it: a person by id, an agent with 代 its owner, a guest as 访客, the host as 宿主. */
  label: string;
  kind: MessageKind;
  kindWord: string;
  text: string;
  at: string;
  source: Source;
  /** 起草 or 本人原话, when the source says so. */
  sourceTag?: string;
  replyTo?: string;
  ask?: Ask;
  parts: Part[];
  evidence: Part[];
  opinion?: string;
  /** The sender's status line (§6.5) under the person's own call to one of their agents. */
  status?: string;
  decision: boolean;
}
export interface Thread { owner: string; id: string; kind: VenueKind; kindWord: string; name: string; announce?: string; people: string[]; agents: string[]; draftFirst: boolean; messages: ThreadMessage[]; total: number }

const EMPTY: ImStatus = { configured: false, agents: [], needs: [], venues: [], drafts: [], cards: [], presence: {} };

/** Every venue mirrored under the relay, across owners. */
function mirroredVenues(home: string, c: Config): { owner: string; vd: VenueDoc }[] {
  const relayDir = join(home, c.relay.name.replace(/:/g, "_"));
  if (!existsSync(relayDir)) return [];
  const out: { owner: string; vd: VenueDoc }[] = [];
  for (const owner of readdirSync(relayDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()) {
    const dir = join(relayDir, owner, "venues");
    if (!existsSync(dir)) continue;
    for (const n of readdirSync(dir).filter((f) => f.endsWith(".geml")).sort()) {
      const id = n.slice(0, -".geml".length);
      const m = readMirror(home, c.relay.name, owner, `venues/${id}.geml`);
      const vd = foldVenue(owner, id, { blocks: m.blocks, diagnostics: [], text: m.text, exists: true }, c.relay.name);
      if (vd !== undefined) out.push({ owner, vd });
    }
  }
  return out;
}

const presenceOf = (home: string, agent: string): Presence => agentPresence(listSessions(home).filter((s) => s.agent === agent).map((s) => ({ presence: s.report.presence })));

/** The page's and the band's data. `seen`: per venue (`owner/id`), the last message id the page showed; the unread are those after it. */
export function statusView(home: string, seen: Readonly<Record<string, string>> = {}, now: string = new Date().toISOString()): ImStatus {
  const c = readConfig(home);
  if (c === undefined) return { ...EMPTY, needs: [], venues: [], drafts: [], cards: [], presence: {}, agents: [] };
  const state = readState(home);
  const needs: Need[] = [...readInbox(home, c.relay.name, c.person)];
  if (state !== undefined && !state.connected) needs.push({ kind: "offline", key: "offline:relay", text: `连不上中继 ${c.relay.name}${state.error === undefined ? "" : `：${state.error}`}`, actions: defaultActions("offline", {}), since: state.at, level: 0 });
  const venues: (VenueRow & { at: string })[] = [];
  for (const { owner, vd } of mirroredVenues(home, c)) {
    const shown = vd.messages.filter((m) => m.kind !== "system");
    const mark = seen[`${owner}/${vd.venue.id}`];
    const at = mark === undefined ? -1 : shown.findIndex((m) => m.id === mark);
    const unread = at === -1 ? shown.length : shown.length - (at + 1);
    const row = listRow(vd.venue, { unread });
    const newest = shown[shown.length - 1];
    const r: VenueRow & { at: string } = { owner, id: vd.venue.id, kind: vd.venue.kind, kindWord: row.kind, name: vd.venue.name, status: row.status, unread, at: newest?.at ?? "" };
    if (newest !== undefined) r.last = newest.id;
    venues.push(r);
  }
  venues.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.name < b.name ? -1 : 1));
  const presence: Record<string, Presence> = {};
  for (const name of Object.keys(c.agents)) presence[name] = presenceOf(home, name);
  const drafts: DraftRow[] = listDrafts(home).map((d) => ({ id: d.id, agent: d.agent, venueName: d.venueName, text: typeof d.body["text"] === "string" ? d.body["text"] : "", at: d.at }));
  const out: ImStatus = { configured: true, person: c.person, relay: c.relay.name, agents: Object.keys(c.agents), needs: sortNeeds(needs), venues: venues.map(({ at: _at, ...v }) => v), drafts, cards: cardsView(home, now), presence };
  if (state !== undefined) { out.connected = state.connected; out.at = state.at; if (state.error !== undefined) out.error = state.error; }
  return out;
}

/** The buttons a role has on a card in its state (§8.1, §8.2); the host maps them to the verbs. */
function cardActions(role: CardRow["role"], state: CardState): string[] {
  if (role === "delegator") {
    switch (state) {
      case "draft": return ["发布", "算了"];
      case "open": return ["撤回"];
      case "awaiting-grant": return ["撤回"];
      case "in-progress": return ["问一句", "要求交回"];
      case "delivered": return ["争议"];
      case "verifying": return ["接受", "要改", "争议"];
      case "changes": return ["争议", "关闭"];
      case "dispute": return ["接受", "关闭"];
      default: return [];
    }
  }
  if (role === "worker") {
    switch (state) {
      case "open": return ["认领"];
      case "in-progress": return ["写记录", "交付", "交回"];
      case "delivered": case "verifying": return ["争议"];
      case "changes": return ["继续", "争议"];
      case "dispute": return ["关闭"];
      default: return [];
    }
  }
  if (role === "granter") return state === "awaiting-grant" ? ["放行"] : [];
  return state === "open" ? ["认领"] : [];
}

/** The task cards mirrored under the relay, as rows: the person's role on each from its slots and its delegator. */
export function cardsView(home: string, now: string = new Date().toISOString()): CardRow[] {
  const c = readConfig(home);
  if (c === undefined) return [];
  const relayDir = join(home, c.relay.name.replace(/:/g, "_"));
  if (!existsSync(relayDir)) return [];
  const out: CardRow[] = [];
  for (const owner of readdirSync(relayDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()) {
    const dir = join(relayDir, owner, "cards");
    if (!existsSync(dir)) continue;
    for (const n of readdirSync(dir).filter((f) => f.endsWith(".geml")).sort()) {
      const id = n.slice(0, -".geml".length);
      const card = foldCard(id, readMirror(home, c.relay.name, owner, `cards/${id}.geml`).blocks);
      if (card === undefined) continue;
      const roles = rolesOf({ ...card, slots: card.slots.map((s) => ({ ...s, state: "working" as const })) }, { person: c.person });
      const role: CardRow["role"] = roles.has("delegator") ? "delegator" : roles.has("worker") ? "worker" : roles.has("granter") ? "granter" : "member";
      const working = card.slots.find((s) => s.state === "working" || s.state === "claimed" || s.state === "delivered");
      const w = waitingOn(card);
      const row: CardRow = { owner, id, title: card.title, direction: card.direction, directionWord: DIRECTION_WORDS[card.direction], state: card.state, stateWord: STATE_WORDS[card.state], progress: progressLine(card), brief: briefLines(card), role, heartbeat: heartbeatWords(card, now), versions: card.versions.length, actions: cardActions(role, card.state), card };
      if (working !== undefined) row.worker = shownName(working.agent);
      if (w !== undefined) row.waitingOn = w;
      out.push(row);
    }
  }
  return out.sort((a, b) => (a.card.at < b.card.at ? 1 : a.card.at > b.card.at ? -1 : 0));
}

/** One venue as the page shows it: the last `limit` messages, each speaker drawn as rule 6 says. */
export function threadView(home: string, owner: string, id: string, limit = 50, now?: string): Thread | undefined {
  const c = readConfig(home);
  if (c === undefined) return undefined;
  const m = readMirror(home, c.relay.name, owner, `venues/${id}.geml`);
  if (!m.exists) return undefined;
  const vd = foldVenue(owner, id, { blocks: m.blocks, diagnostics: [], text: m.text, exists: true }, c.relay.name);
  if (vd === undefined) return undefined;
  const access = localAccess(home, c);
  const part = (e: Embed): Part => {
    const r = resolveEmbed(e, `person:${c.person}`, access);
    const p: Part = { src: e.src };
    if (r.text !== undefined) p.text = r.text;
    else if (r.stub !== undefined) p.stub = `你看不到：来自 ${r.stub.from} 的私有范围 · ${r.stub.action}`;
    return p;
  };
  const queues = new Map<string, Queue>();
  for (const a of Object.keys(c.agents)) queues.set(a, readQueue(readMirror(home, c.relay.name, c.person, `queues/${a}.geml`).text).queue);
  const me = `person:${c.person}`;
  const messages: ThreadMessage[] = vd.messages.slice(-limit).map((msg) => {
    const s = parseSpeaker(msg.speaker);
    const t: ThreadMessage = {
      id: msg.id, speaker: msg.speaker, label: s?.kind === "agent" ? agentLabel(s.name, s.owner) : shownName(msg.speaker), kind: msg.kind, kindWord: KIND_WORDS[msg.kind],
      text: msg.text, at: msg.at, source: msg.source, parts: msg.parts.map(part), evidence: msg.evidence.map(part), decision: vd.venue.decisions.includes(`${vd.venue.address}#${msg.id}`),
    };
    if (msg.source === "drafted") t.sourceTag = "起草";
    if (msg.source === "quoted") t.sourceTag = QUOTED_TAG;
    if (msg.replyTo !== undefined) t.replyTo = msg.replyTo;
    if (msg.ask !== undefined) t.ask = msg.ask;
    if (msg.opinion !== undefined) t.opinion = msg.opinion;
    if (msg.speaker === me && now !== undefined) {
      for (const [a, q] of queues) {
        const line = senderStatus(q, `qi-${id}-${msg.id}`, now, { alive: isAlive(presenceOf(home, a)), doing: presenceWord(presenceOf(home, a)) });
        if (line !== undefined) { t.status = `${a}：${line}`; break; }
      }
    }
    return t;
  });
  const th: Thread = { owner, id, kind: vd.venue.kind, kindWord: VENUE_WORDS[vd.venue.kind], name: vd.venue.name, people: vd.venue.people, agents: vd.venue.agents, draftFirst: vd.venue.policy.draftFirst, messages, total: vd.messages.length };
  if (vd.venue.announce !== undefined) th.announce = vd.venue.announce.text;
  return th;
}

const PRESENCE_WORDS: Readonly<Record<Presence, string>> = { thinking: "思考", tool: "跑工具", waiting: "等主人", idle: "空闲", asleep: "睡着" };
const presenceWord = (p: Presence): string | undefined => (p === "asleep" ? undefined : PRESENCE_WORDS[p]);

const lineOf = (m: ThreadMessage): string => `[${m.at.slice(11, 16)}] ${m.label}（${m.kindWord}）：${m.text.split("\n").join(" ")}`;
const partLine = (p: Part): string => `  ↳ ${p.src}：${p.text !== undefined ? p.text.split("\n").join(" ") : p.stub !== undefined ? p.stub : "没镜像到本机"}`;

/** What `im_read` answers (rule 3's read tool): a venue's last lines, or one block by its address. */
export function readForTool(home: string, o: { owner?: string; venue?: string; src?: string; limit?: number }): string {
  if (o.src !== undefined) {
    const c = readConfig(home);
    if (c === undefined) return "没有 connect.json：先 gemworks connect setup";
    if (parseAddress(o.src) === undefined) return `不是地址：${o.src}`;
    const r = resolveEmbed({ src: o.src }, `person:${c.person}`, localAccess(home, c));
    if (r.text !== undefined) return r.text;
    if (r.stub !== undefined) return `你看不到：来自 ${r.stub.from} 的私有范围 · ${r.stub.action}`;
    return `没镜像到本机：${o.src}（让主人在看板上看，或等守护进程同步）`;
  }
  if (o.owner === undefined || o.venue === undefined) return "要一个场所（owner/id），或一个块的地址（src）";
  const th = threadView(home, o.owner, o.venue, o.limit ?? 12);
  if (th === undefined) return `没有这个场所的镜像：${o.owner}/${o.venue}`;
  const lines = [`${th.kindWord}「${th.name}」· 最近 ${th.messages.length} 条（共 ${th.total} 条）`];
  for (const m of th.messages) { lines.push(lineOf(m)); for (const p of [...m.evidence, ...m.parts]) lines.push(partLine(p)); }
  return lines.join("\n");
}
