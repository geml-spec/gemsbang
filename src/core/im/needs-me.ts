// The 「需要我」 inbox (§6.9): one per person, made only of five kinds of
// thing — 定 (an ask for me or my role), 验收 (a deliverable or a card stage
// waiting on me), 放行 (a request for more than its sender may have), 卡住
// (my agent blocked, erring, refused again, or silent), 断了 (the desktop
// cannot reach the relay, or the daemon's heartbeat stopped). A new item
// notifies once, on the band, and to the phone bridge after the person has
// been away long enough; after that only an escalation notifies again. Mutes
// are by item, by venue, by kind. Everything else is silent and only on the
// board (rule 9). Pure: records in, rows and words out.

export type NeedKind = "offline" | "decide" | "accept" | "grant" | "stuck";

/** The order on the band and the board (§6.9): 断了 first, then 定, 验收, 放行, 卡住. */
export const NEED_ORDER: readonly NeedKind[] = ["offline", "decide", "accept", "grant", "stuck"];
export const NEED_VERBS: Readonly<Record<NeedKind, string>> = { offline: "断了", decide: "定", accept: "验收", grant: "放行", stuck: "卡住" };

/** The verb's colour on the band (§6.9): 放行 and 定 amber, 验收 green, 卡住 and 断了 red. */
export type Tone = "amber" | "green" | "red";
export const NEED_TONES: Readonly<Record<NeedKind, Tone>> = { decide: "amber", grant: "amber", accept: "green", stuck: "red", offline: "red" };

export interface Need {
  kind: NeedKind;
  /** Stable across renders: the thing it is about — an ask's message, a card, a grant request, an agent's session. */
  key: string;
  /** One sentence. */
  text: string;
  /** Button labels, in order; `defaultActions` gives each kind's. */
  actions: string[];
  since: string;
  venue?: string;
  /** How far it has escalated: 0 when new. A rise notifies again; nothing else does. */
  level: number;
}

export const WRITE_IN = "自己写";

/** Each kind's buttons (§6.9; the phone's extra 看演示 and the host's suggested fix from transport §7.2). */
export function defaultActions(kind: NeedKind, o: { options?: readonly string[]; settle?: number; suggestion?: string; phone?: boolean }): string[] {
  switch (kind) {
    case "decide": { const opts = (o.options ?? []).filter((x) => x !== WRITE_IN); return [...opts, WRITE_IN]; }
    case "accept": return [o.settle === undefined ? "接受" : `接受 · 结算 ${o.settle}`, "要改", ...(o.phone === true ? ["看演示"] : [])];
    case "grant": return ["允许一次", "允许此人", "拒绝"];
    case "stuck": return ["看原因", ...(o.suggestion === undefined ? [] : [o.suggestion]), "接管", "交回"];
    case "offline": return ["重试"];
  }
}

/** The items in the band's order: by kind, then oldest first; the input is left as it is. */
export function sortNeeds(items: readonly Need[]): Need[] {
  return [...items].sort((a, b) => NEED_ORDER.indexOf(a.kind) - NEED_ORDER.indexOf(b.kind) || (a.since < b.since ? -1 : a.since > b.since ? 1 : 0));
}

/** A mute (§6.9): by item, by venue, by kind, or by kind within a venue — every named field must match. */
export interface Mute { key?: string; venue?: string; kind?: NeedKind }

export function isMuted(n: Need, mutes: readonly Mute[]): boolean {
  return mutes.some((m) => (m.key === undefined || m.key === n.key) && (m.venue === undefined || m.venue === n.venue) && (m.kind === undefined || m.kind === n.kind));
}

/** What the person was last told about an item: its escalation then. */
export interface Seen { key: string; level: number }

/**
 * Which items to notify now (§6.9): one never told, or one escalated since
 * it was last told, unless muted. On the band whenever the person is here;
 * to the phone bridge only once they have been away longer than the
 * threshold.
 */
export function notifyNow(items: readonly Need[], seen: readonly Seen[], mutes: readonly Mute[], o: { awayMs: number; pushAfterMs: number }): { band: Need[]; phone: Need[] } {
  const told = new Map(seen.map((s) => [s.key, s.level] as const));
  const band = sortNeeds(items).filter((n) => !isMuted(n, mutes) && (told.get(n.key) ?? -1) < n.level);
  return { band, phone: o.awayMs > o.pushAfterMs ? band : [] };
}

/** One line on the band (§6.9): the verb and its colour, the sentence, the buttons, and how many more wait. */
export interface BandRow { verb: string; tone: Tone; text: string; actions: string[]; more: number }

export function bandRow(items: readonly Need[], mutes: readonly Mute[] = []): BandRow | undefined {
  const live = sortNeeds(items).filter((n) => !isMuted(n, mutes));
  const first = live[0];
  if (first === undefined) return undefined;
  return { verb: NEED_VERBS[first.kind], tone: NEED_TONES[first.kind], text: first.text, actions: first.actions, more: live.length - 1 };
}

/** The band when nothing needs the person (§6.9): the current card's state and whom it waits on, and whether the group has new messages that did not name them. */
export function quietLine(o: { card?: { id: string; state: string; waitingOn?: string }; unaddressed?: number }): string {
  const parts: string[] = [];
  if (o.card !== undefined) parts.push(`${o.card.id} ${o.card.state}${o.card.waitingOn === undefined ? "" : ` · 等${o.card.waitingOn}`}`);
  if (o.unaddressed !== undefined && o.unaddressed > 0) parts.push(`群里有 ${o.unaddressed} 条新消息，没点名你`);
  return parts.length === 0 ? "没有需要你的事" : parts.join(" · ");
}
