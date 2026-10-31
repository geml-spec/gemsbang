// One queue per agent account (§6.5), kept by the relay, outliving any
// session: each item a prompt with its sender's level, its venue, its time,
// its expiry and its hops. Priority is 主人 > 信任 > 成员 > 访客, and every
// person before any agent; within a level first come first served. Items are
// delivered only between turns; an item read in and one answered are later
// marker blocks, outside the chain (the relay appends items, the daemon
// marks). An item past its expiry is dropped with a system message to its
// sender. Pure: records in, records and words out, text in and out as data
// blocks.
import type { JsonValue } from "../schema.js";
import { readDataBlocks, renderDataBlock, seal } from "./chain.js";
import type { Embed } from "./embed.js";
import { LEVEL_RANK, type Level } from "./sender.js";
import type { VenueKind } from "./venue.js";

export interface QueueItem {
  /** The client's id for the item (transport §2.5: idempotent appends). */
  id: string;
  /** Its place in the queue's chain, 1-based. */
  n: number;
  prompt: string;
  /** The sender as a speaker string, and as shown. */
  sender: string;
  senderName: string;
  level: Level;
  venue: string;
  venueKind: VenueKind;
  venueName: string;
  /** The message that raised it, by address. */
  message?: string;
  at: string;
  expires?: string;
  hops: number;
  /** A forwarded context pack (§6.6): embeds, resolved by the receiver's permission. */
  context?: Embed[];
  /** The task card this prompt works on (§8): its scope and limits replace the level's for the turn. */
  card?: { id: string; address: string; title: string; tools: string[]; venueOfWork: string; credits?: number };
  prev: string | null;
  hash: string;
}

export type ItemDraft = Omit<QueueItem, "n" | "prev" | "hash">;

/** The daemon's mark on an item: read in by the session, or answered (with the reply's address). */
export interface Marker { kind: "read" | "answered"; n: number; item: string; at: string; reply?: string }

export interface Queue { items: QueueItem[]; markers: Marker[] }
export const EMPTY_QUEUE: Queue = { items: [], markers: [] };

/** Priority (§6.5): lower first; a person's prompt by its level, an agent's behind every person's, whatever its owner's level. */
export function rankOf(item: Pick<QueueItem, "sender" | "level">): number {
  return item.sender.startsWith("agent:") ? 4 : LEVEL_RANK[item.level];
}

/** The object without its undefined fields, so canonical JSON never sees one. */
function defined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

export function enqueue(q: Queue, d: ItemDraft): { queue: Queue; item: QueueItem } {
  const last = q.items[q.items.length - 1];
  const item = seal(defined({ ...d, n: q.items.length + 1 }) as unknown as Record<string, JsonValue>, last === undefined ? null : last.hash) as unknown as QueueItem;
  return { queue: { items: [...q.items, item], markers: q.markers }, item };
}

const isExpired = (item: QueueItem, now: string): boolean => item.expires !== undefined && item.expires <= now;

export type ItemState = "queued" | "read" | "answered" | "expired";

export function stateOf(q: Queue, id: string, now: string): ItemState | undefined {
  const item = q.items.find((i) => i.id === id);
  if (item === undefined) return undefined;
  if (q.markers.some((m) => m.kind === "answered" && m.item === id)) return "answered";
  if (q.markers.some((m) => m.kind === "read" && m.item === id)) return "read";
  return isExpired(item, now) ? "expired" : "queued";
}

/** The items still waiting, in delivery order: by rank, then by arrival. */
export function pending(q: Queue, now: string): QueueItem[] {
  return q.items.filter((i) => stateOf(q, i.id, now) === "queued").sort((a, b) => rankOf(a) - rankOf(b) || a.n - b.n);
}

/** The item to deliver next, and the unmarked items that ran out meanwhile (each owed a system message, `expiredSystemText`). */
export function next(q: Queue, now: string): { item?: QueueItem; dropped: QueueItem[] } {
  const dropped = q.items.filter((i) => stateOf(q, i.id, now) === "expired");
  const item = pending(q, now)[0];
  return item === undefined ? { dropped } : { item, dropped };
}

/** The item's 1-based place among the waiting, or undefined when it is not waiting. */
export function positionOf(q: Queue, id: string, now: string): number | undefined {
  const i = pending(q, now).findIndex((item) => item.id === id);
  return i === -1 ? undefined : i + 1;
}

function mark(q: Queue, m: Omit<Marker, "n">): Queue {
  return { items: q.items, markers: [...q.markers, defined({ ...m, n: q.markers.length + 1 })] };
}

export const markRead = (q: Queue, id: string, at: string): Queue => mark(q, { kind: "read", item: id, at });

export function markAnswered(q: Queue, id: string, at: string, reply?: string): Queue {
  return mark(q, reply === undefined ? { kind: "answered", item: id, at } : { kind: "answered", item: id, at, reply });
}

/** The system message a sender gets when their prompt ran out undelivered (§6.5). */
export const expiredSystemText = (item: QueueItem): string => `过期未投递：${item.venueName} 里 ${item.at} 给它的那条过了 ${item.expires ?? ""}，已丢弃`;

/** The line under a message that only mentioned an agent (§6.5). */
export const MENTION_STATUS = "提及 · 没投递";

/** What the agent is up to, for the sender's line: whether any session of it is alive, and what it is doing (presence words). */
export interface AgentNow { alive: boolean; doing?: string }

/** The sender's status line under their message (§6.5): queued with the place and what the agent does, read in, answered, offline with the expiry, or expired. */
export function senderStatus(q: Queue, id: string, now: string, agent: AgentNow): string | undefined {
  const state = stateOf(q, id, now);
  const item = q.items.find((i) => i.id === id);
  if (state === undefined || item === undefined) return undefined;
  switch (state) {
    case "answered": return "已回应";
    case "read": return `已读入 ✓✓（${q.markers.find((m) => m.kind === "read" && m.item === id)?.at ?? ""}）`;
    case "expired": return "过期，没投递";
    case "queued": {
      if (!agent.alive) return `离线，已留言${item.expires === undefined ? "" : ` · 过期 ${item.expires}`}`;
      const ahead = (positionOf(q, id, now) ?? 1) - 1;
      return `点名 · 排队中（前面 ${ahead} 条${agent.doing === undefined ? "" : ` · ${agent.doing}`}）`;
    }
  }
}

/** The queue as its document: the items in chain order, then the markers (`read-N`, `answered-N`). */
export function renderQueue(q: Queue): string {
  let out = "";
  for (const i of q.items) out += renderDataBlock(i.id, i as unknown as JsonValue);
  for (const m of q.markers) out += renderDataBlock(`${m.kind}-${m.n}`, { kind: m.kind, item: m.item, at: m.at, ...(m.reply === undefined ? {} : { reply: m.reply }) });
  return out;
}

/** The queue read back: items by `n`, markers by their block number; a block that is neither is a diagnostic. */
export function readQueue(source: string): { queue: Queue; diagnostics: string[] } {
  const { blocks, diagnostics } = readDataBlocks(source);
  const items: QueueItem[] = [], markers: Marker[] = [];
  for (const b of blocks) {
    const v = b.value;
    const marker = /^(read|answered)-([1-9]\d*)$/.exec(b.id);
    if (marker && (v["kind"] === "read" || v["kind"] === "answered") && typeof v["item"] === "string" && typeof v["at"] === "string") {
      const m: Marker = { kind: v["kind"], n: Number(marker[2]), item: v["item"], at: v["at"] };
      if (typeof v["reply"] === "string") m.reply = v["reply"];
      markers.push(m);
    } else if (typeof v["prompt"] === "string" && typeof v["n"] === "number" && v["id"] === b.id && typeof v["hash"] === "string") {
      items.push(v as unknown as QueueItem);
    } else diagnostics.push(`#${b.id}: neither an item nor a marker`);
  }
  items.sort((a, b) => a.n - b.n);
  markers.sort((a, b) => a.n - b.n);
  return { queue: { items, markers }, diagnostics };
}
