// Where messages happen (§6.2): a DM (the session itself), a guest DM (a
// guest and an agent, the owner a silent member), a group (people and agents,
// its own policy, an announce, a decision log, a bot density), a thread
// (anchored on a message or a thing, inheriting the group it shows in, or
// independent and the anchor owner's), a subscription channel (signals only), a room (open to join; an agent there only as its mode allows, §7.4).
// The announce and the decisions reach an agent as live embeds (rule 3).
// Pure: records in, records and words out; nothing here knows a file.
import type { Embed } from "./embed.js";
import { DEFAULT_DENSITY, type Density } from "./sender.js";

export type VenueKind = "dm" | "guest-dm" | "group" | "thread" | "channel" | "room";
export const VENUE_WORDS: Readonly<Record<VenueKind, string>> = { dm: "私信", "guest-dm": "访客私信", group: "群", thread: "线程", channel: "订阅频道", room: "房间" };

/** Whose `@` becomes a prompt for an agent here (rule 2): anyone's, only the listed people's and agents', or no other agent's. */
export type PromptFrom = "anyone" | "allowlist" | "nobody";

export interface Policy {
  promptFrom: PromptFrom;
  /** Speakers (`person:…`, `agent:…`) whose prompts are taken when `promptFrom` is `allowlist`. */
  allow: string[];
  density: Density;
  /** 「回群前先给我看」: an agent's reply becomes a draft card for its owner first (§6.5). */
  draftFirst: boolean;
  hopLimit: number;
}

export const DEFAULT_POLICY: Policy = { promptFrom: "anyone", allow: [], density: DEFAULT_DENSITY, draftFirst: false, hopLimit: 3 };

/** The group's pinned text (§6.8): versioned; every change is a system message. */
export interface Announce { text: string; version: number; at: string; by: string }

/** A channel's price (§10.4): by the month, by the signal, or both; neither is free. */
export interface ChannelPrice { month?: number; signal?: number }
export function priceWords(p: ChannelPrice | undefined): string {
  const parts = [...(p?.month !== undefined ? [`按月 ${p.month}`] : []), ...(p?.signal !== undefined ? [`按条 ${p.signal}`] : [])];
  return parts.length === 0 ? "免费" : parts.join(" · ");
}

export interface Venue {
  id: string;
  kind: VenueKind;
  name: string;
  /** The venue document's address on the relay, `https://<relay>/<owner>/venues/<id>.geml`. */
  address: string;
  /** Members: people by id, agents by their shown name. */
  people: string[];
  agents: string[];
  policy: Policy;
  announce?: Announce;
  /** The decision log (§6.8): addresses of the messages marked 决策, oldest first. */
  decisions: string[];
  /** A thread's anchor (§6.7) and the group it shows in; an independent thread has no parent. */
  anchor?: string;
  parent?: string;
  /** A guest DM's agent, by its shown name. */
  host?: string;
  /** A guest DM made from a share card (§11), by the card's id. */
  card?: string;
  /** A channel's price and its publisher: the owner's agent that signals (§10.4). */
  price?: ChannelPrice;
  publisher?: string;
}

export const ANNOUNCE_LIMIT = 2000;

/** The announce replaced (§6.8): one more version and the system message that says so; too long is a fault. The input is not changed. */
export function setAnnounce(v: Venue, text: string, by: string, at: string): { venue: Venue; system: string } | { fault: string } {
  const length = [...text].length;
  if (length > ANNOUNCE_LIMIT) return { fault: `群公告最多两千字（现在 ${length} 字）` };
  const version = (v.announce?.version ?? 0) + 1;
  return { venue: { ...v, announce: { text, version, at, by } }, system: `${by} 改了群公告（第 ${version} 版）` };
}

/** A message marked 决策 (§6.8): appended to the log once. */
export function markDecision(v: Venue, messageAddress: string): Venue {
  return v.decisions.includes(messageAddress) ? v : { ...v, decisions: [...v.decisions, messageAddress] };
}

/** What the host injects when an agent handles a prompt from this venue (rule 3, §6.8): the announce and the last few decisions, as live embeds. */
export function contextSegment(v: Venue, recent = 5): Embed[] {
  const out: Embed[] = [];
  if (v.announce !== undefined) out.push({ src: `${v.address}#announce` });
  for (const d of v.decisions.slice(-recent)) out.push({ src: d });
  return out;
}

/** A thread (§6.7): shown in a group, it is that group's; shown nowhere, it is the anchor owner's own venue under the default policy. */
export function threadVenue(o: { id: string; anchor: string; title: string; address: string; shownIn?: Venue; owner: string }): Venue {
  const base = { id: o.id, kind: "thread" as const, name: o.title, address: o.address, decisions: [], anchor: o.anchor };
  if (o.shownIn !== undefined) return { ...base, people: [...o.shownIn.people], agents: [...o.shownIn.agents], policy: o.shownIn.policy, parent: o.shownIn.id };
  return { ...base, people: [o.owner], agents: [], policy: DEFAULT_POLICY };
}

/** What the 「消息」 page knows about a venue right now, beyond the venue itself. */
export interface RowState {
  unread: number;
  /** A thread: which agent works in it and the card's state. */
  working?: { agent: string; card?: string };
  /** A channel: its stage and today's count. */
  stage?: string;
  today?: number;
  /** A room: which of my agents is in it and in which mode. */
  mode?: string;
}

/** One row of the venue list (§6.2): kind, name, one line of state, unread. */
export function listRow(v: Venue, s: RowState): { kind: string; name: string; status: string; unread: number } {
  let status: string;
  switch (v.kind) {
    case "group": status = `${v.people.length} 人 · ${v.agents.length} 个 agent`; break;
    case "guest-dm": status = `${v.host ?? "没有 agent"} 接待`; break;
    case "thread": status = s.working === undefined ? "没人在干" : `${s.working.agent} 在干${s.working.card === undefined ? "" : ` · ${s.working.card}`}`; break;
    case "channel": status = `${s.stage ?? ""} · 今天 ${s.today ?? 0} 条`; break;
    case "dm": status = "就是会话本身"; break;
    case "room": status = `${v.people.length} 人 · ${s.mode ?? "自己的 agent 不在"}`; break;
  }
  return { kind: VENUE_WORDS[v.kind], name: v.name, status, unread: s.unread };
}
