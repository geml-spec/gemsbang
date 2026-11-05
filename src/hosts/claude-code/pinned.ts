// A page with its head kept at the top and a row kept at its foot (聊天 · 联系人 · 我, S11) while its list scrolls between,
// as a phone's IM has it. The engine scrolls a pane's tree as a whole, so such a page is drawn one window tall, the
// list cut to what fits, and the hooks module takes the wheel and the keys over the list (`ui.scroll`), moving which
// of its items leads it. How far it may go is reckoned from each item's rows, on the generous side: a list that
// stops a little past its end leaves some blank under it, one that stops short hides its last items. Pure and
// Node-free.

/** The rows the head and the row at the foot are reckoned to take together, on the generous side. */
export const FIXED_ROWS = 8;

/** What the reckoning reads of a row: its kind, and how many lines, fields, items or lines of words it holds. */
export interface Reckoned { kind: string; lines?: readonly unknown[]; fields?: readonly unknown[]; items?: readonly unknown[]; body?: readonly unknown[] }

/** The rows an item of the list is reckoned at: a chat's row four (its picture), someone in 联系人 the same, a card two for each of its lines, a bar its words and its presses. */
export function rowsOf(r: Reckoned): number {
  switch (r.kind) {
    case "chat": case "contact": return 4;
    case "card": return 3 + 2 * ((r.lines?.length ?? 0) + (r.fields?.length ?? 0));
    case "need": return 6 + 2 * (r.body?.length ?? 0);
    case "list": case "people": case "menu": return 2 + 2 * (r.items?.length ?? 0);
    case "empty": return 6;
    default: return 2;
  }
}

/** A page's rows split for pinning: up to and with its head at the top, the list, the row at its foot; none for a page without one. */
export function pinnedOf<R extends { kind: string }>(rows: readonly R[]): { top: R[]; list: R[]; foot: R } | undefined {
  const foot = rows.at(-1);
  if (foot === undefined || foot.kind !== "tabs") return undefined;
  const head = rows.findIndex((r) => r.kind === "head");
  return { top: rows.slice(0, head + 1), list: rows.slice(head + 1, -1), foot };
}

/** The last item that may lead the list: the last after which the rest still fill the window; none past the first for a list that fits. */
export function lastLead(list: readonly Reckoned[], bodyRows: number): number {
  const window = Math.max(1, bodyRows - FIXED_ROWS);
  let rest = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    rest += rowsOf(list[i]!);
    if (rest >= window) return i;
  }
  return 0;
}

/** The item that leads the list once the wheel or the keys move it `by` rows: a tick an item, more as ticks crowd, a page key several; within the list. */
export function scrolledTo(lead: number, by: number, list: readonly Reckoned[], bodyRows: number): number {
  const step = by === 0 ? 0 : Math.sign(by) * Math.max(1, Math.round(Math.abs(by) / 3));
  return Math.min(lastLead(list, bodyRows), Math.max(0, lead + step));
}
