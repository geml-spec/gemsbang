// The total inbox (spec §7.1, §7.2): every chat of every avatar of the
// person, newest first, each marked with the avatar that is in it — a colour
// and an initial, so a glance tells them apart — its last line and who said
// it, its time and how many are unread; and one chat as the person sees it:
// who they are there, what was said, `分身` beside an agent's line. Built
// from the mirror the client keeps of the relay (gemsbang/home.ts). Pure:
// the time and the zone are given.
import type { BaseItem } from "./base.js";
import { factsOf, type Fact } from "./borrow.js";
import type { Need } from "./needs.js";
import { say, type Lang } from "./words.js";

/** Six colours that stay readable on light and dark, one per avatar in the order the person's avatars grew. */
export const BADGE_COLORS: readonly string[] = ["#2563eb", "#c2410c", "#3c8a5a", "#8a5ab5", "#a8761f", "#2f8a8a"];

export interface Card { id: string; name: string }
export interface Badge extends Card { color: string; initial: string }
export interface Block { id: string; value: Record<string, unknown> }
/** One chat as the client mirrors it: the venue, which of the person's avatars is in it (`as`), its link rules (groups), its latest blocks. */
/** `keeper`: its 群主 now, when not its maker (S19); `former`: who left, so their lines keep their names. */
export interface MirrorVenue { owner: string; id: string; kind: "group" | "dm"; name: string; members: Card[]; as: string; rules?: { forward: boolean; approve: boolean }; blocks: Block[]; keeper?: string; former?: Card[] }
/** What the client keeps of the relay for the person: themself, their avatars, every chat. */
export interface Mirror {
  at: string; relay: string; person: string; lang: Lang; defaultName?: string; avatars: Card[]; venues: MirrorVenue[];
  /** Per avatar, whether others see its agent's lines marked (its rules' `mark`). */
  marks?: Record<string, boolean>;
  /** What waits on the person (需要你, spec §7.3), as the relay listed it: each card with its avatar's name and its chat's. */
  needs?: (Need & { avatarName: string; group?: string })[];
  /** The person's jobs for their computer (spec §7.4), as the relay listed them. */
  work?: MirrorWork[];
  /** Per avatar, the chats it answers on its own (自动回, architecture §6.3), as `<owner>/<id>`. */
  autos?: Record<string, string[]>;
  /** The person's 底子 (S27), the entries waiting for their yes with it. */
  base?: BaseItem[];
}

/** A job for the person's computer: whose, from which chat, who asked and their words, where it stands. */
export interface MirrorWork {
  id: string; avatar: string; avatarName: string; need: string; summary: string; state: "waiting" | "queued" | "taken" | "done" | "failed"; at: string; since: string;
  venue?: { owner: string; id: string }; message?: string; group?: string; fromName?: string; words?: string; auto?: true;
}

export const venueKey = (owner: string, id: string): string => `${owner}/${id}`;

/**
 * The avatar the person last spoke as (Q1, S21): the newest line the person said themself in any chat, else the
 * newest line any of their avatars said, else their first avatar; undefined with none. A new group and a new
 * session take it unasked.
 */
export function recentAvatar(m: Mirror): string | undefined {
  const mine = new Set(m.avatars.map((a) => a.id));
  let person: { at: string; avatar: string } | undefined, any: { at: string; avatar: string } | undefined;
  for (const v of m.venues) for (const b of v.blocks) {
    const speaker = typeof b.value["speaker"] === "string" ? b.value["speaker"].replace(/^avatar:/, "") : undefined, at = typeof b.value["at"] === "string" ? b.value["at"] : "";
    if (speaker === undefined || !mine.has(speaker) || typeof b.value["text"] !== "string") continue;
    if (any === undefined || at > any.at) any = { at, avatar: speaker };
    if (b.value["by"] === "person" && (person === undefined || at > person.at)) person = { at, avatar: speaker };
  }
  return person?.avatar ?? any?.avatar ?? m.avatars[0]?.id;
}

/** The first character of a name, a letter upper-cased. */
export const initialOf = (name: string): string => ([...name.trim()][0] ?? "?").toUpperCase();

/** The person's avatars with their colours, in the order they grew. */
export const badgesOf = (avatars: readonly Card[]): Badge[] => avatars.map((a, i) => ({ ...a, color: BADGE_COLORS[i % BADGE_COLORS.length]!, initial: initialOf(a.name) }));

const avatarOf = (speaker: unknown): string => (typeof speaker === "string" ? speaker.replace(/^avatar:/, "") : "");
const isMessage = (b: Block): boolean => typeof b.value["text"] === "string" && typeof b.value["speaker"] === "string";

/** A line of a chat: something said, or someone come in. */
export type ChatItem =
  | { kind: "message"; id: string; avatar: string; who: string; text: string; at: string; mark: boolean; mine: boolean; replyTo?: string; facts?: Fact[] }
  | { kind: "joined"; id: string; avatar: string; who: string; at: string }
  /** Someone left (S19); `heir`, who took the group over when its 群主 left. */
  | { kind: "left"; id: string; avatar: string; who: string; at: string; heir?: string }
  | { kind: "note"; id: string; note: "hops"; at: string };

/** What the chat holds, oldest first; a name the members do not list is its id. */
export function itemsOf(v: MirrorVenue): ChatItem[] {
  const name = (avatar: string): string => v.members.find((m) => m.id === avatar)?.name ?? v.former?.find((m) => m.id === avatar)?.name ?? avatar;
  const out: ChatItem[] = [];
  for (const b of v.blocks) {
    const at = typeof b.value["at"] === "string" ? b.value["at"] : "";
    if (/^member-\d+$/.test(b.id)) { const a = avatarOf(b.value["avatar"]); out.push({ kind: "joined", id: b.id, avatar: a, who: name(a), at }); continue; }
    if (/^leave-\d+$/.test(b.id)) { const a = avatarOf(b.value["avatar"]), h = typeof b.value["heir"] === "string" ? avatarOf(b.value["heir"]) : undefined; out.push({ kind: "left", id: b.id, avatar: a, who: name(a), at, ...(h !== undefined ? { heir: name(h) } : {}) }); continue; }
    if (/^note-\d+$/.test(b.id) && b.value["note"] === "hops") { out.push({ kind: "note", id: b.id, note: "hops", at }); continue; }
    if (!isMessage(b)) continue;
    const a = avatarOf(b.value["speaker"]);
    const replyTo = typeof b.value["replyTo"] === "string" ? b.value["replyTo"] : undefined;
    const facts = factsOf(b.value["facts"]);
    out.push({ kind: "message", id: b.id, avatar: a, who: name(a), text: b.value["text"] as string, at, mark: b.value["by"] === "agent", mine: a === v.as, ...(replyTo !== undefined ? { replyTo } : {}), ...(facts !== undefined && facts.length > 0 ? { facts } : {}) });
  }
  return out;
}

/** How a chat's last line names who said it: 你, 你的分身, or the speaker's name. */
export function whoSaid(item: Extract<ChatItem, { kind: "message" }>, lang: Lang): string {
  if (!item.mine) return item.who;
  return item.mark ? say("panel.yourAvatar", lang) : say("panel.you", lang);
}

/** A time as a chat list shows it, in the person's zone (minutes east of UTC): today HH:MM, yesterday, a weekday within the week, else M/D. */
export function timeLabel(at: string, now: string, lang: Lang, zoneMinutes = 0): string {
  const t = Date.parse(at), n = Date.parse(now);
  if (Number.isNaN(t) || Number.isNaN(n)) return "";
  const local = (ms: number): Date => new Date(ms + zoneMinutes * 60_000);
  const lt = local(t), ln = local(n);
  const day = (d: Date): number => Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86_400_000);
  const ago = day(ln) - day(lt);
  if (ago <= 0) return `${String(lt.getUTCHours()).padStart(2, "0")}:${String(lt.getUTCMinutes()).padStart(2, "0")}`;
  if (ago === 1) return say("panel.yesterday", lang);
  if (ago < 7) return say("panel.weekdays", lang).split(",")[lt.getUTCDay()] ?? "";
  return `${lt.getUTCMonth() + 1}/${lt.getUTCDate()}`;
}

/** One chat in the inbox: the venue, its name (a two-person chat's is the other side's), the avatar that is in it, the last line, the time, the unread. */
export interface InboxRow { owner: string; id: string; kind: "group" | "dm"; name: string; as: Badge; last?: { who: string; text: string }; at: string; time: string; unread: number }

/** Messages after the one last seen, not the person's own; nothing seen yet, all of them. */
export function unreadOf(items: readonly ChatItem[], seen: string | undefined): number {
  const said = items.filter((i): i is Extract<ChatItem, { kind: "message" }> => i.kind === "message");
  const from = seen === undefined ? 0 : said.findIndex((i) => i.id === seen) + 1;
  return said.slice(from).filter((i) => !i.mine).length;
}

/** The inbox: every chat newest first, or only one avatar's (`only`); the avatars' badges for the row of filters; the unread in all. */
export function inboxOf(m: Mirror, seen: Readonly<Record<string, string>>, now: string, o: { only?: string; zoneMinutes?: number } = {}): { badges: Badge[]; rows: InboxRow[]; unread: number } {
  const badges = badgesOf(m.avatars);
  const rows: InboxRow[] = [];
  let unread = 0;
  for (const v of m.venues) {
    const as = badges.find((b) => b.id === v.as);
    if (as === undefined) continue;
    const items = itemsOf(v);
    const last = [...items].reverse().find((i): i is Extract<ChatItem, { kind: "message" }> => i.kind === "message");
    const at = last?.at ?? items[items.length - 1]?.at ?? "";
    const n = unreadOf(items, seen[venueKey(v.owner, v.id)]);
    unread += n;
    if (o.only !== undefined && o.only !== v.as) continue;
    rows.push({ owner: v.owner, id: v.id, kind: v.kind, name: v.name, as, ...(last !== undefined ? { last: { who: whoSaid(last, m.lang), text: last.text } } : {}), at, time: timeLabel(at, now, m.lang, o.zoneMinutes), unread: n });
  }
  rows.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return { badges, rows, unread };
}

/** One chat as the pane shows it: its name and size, who the person is there, its last `limit` lines and how many came before them. */
export function chatOf(v: MirrorVenue, m: Mirror, limit = 40): { name: string; count: number; as: Badge | undefined; items: ChatItem[]; earlier: number } {
  const items = itemsOf(v);
  return { name: v.name, count: v.members.length, as: badgesOf(m.avatars).find((b) => b.id === v.as), items: items.slice(-limit), earlier: Math.max(0, items.length - limit) };
}
