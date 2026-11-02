// Each person's box (architecture §5, as Telegram keeps it): everything the
// person should know — a line in one of their chats, a card, a job, a chat
// joined, a name changed — is one update in their box, numbered: `pts` is the
// box's number after it, `count` how many numbers it takes. The client keeps
// the number it has reached; an update whose `pts` is that number plus its
// `count` is applied, one below or at it was seen already, one beyond it
// leaves a gap: what comes after waits, half a second for the missing ones to
// arrive, then the client asks for the difference. The client writes the
// number it reached before it answers, never later. The box keeps a week; a
// client further behind is told so and reads everything again. Pure: the
// rules and their named times, the same on the relay and the client.
import type { JsonValue } from "../schema.js";

/** A gap waits this long for its missing updates before the client asks for the difference. */
export const GAP_WAIT_MS = 500;
/** A wait for updates lasts at most this long, in seconds. */
export const WAIT_MAX_S = 25;
/** A difference gives at most this many updates; the rest from its last number on. */
export const DIFFERENCE_LIMIT = 100;
/** The box keeps updates this long. */
export const BOX_KEEP_MS = 7 * 86_400_000;

/** One update: its number and how many numbers it takes, when, and the block appended to which document (as the person may see it). */
export interface Update { pts: number; count: number; at: string; owner: string; doc: string; block: { id: string; value: Record<string, JsonValue> } }
/** What a difference answers: the updates after the number asked, the number they reach, whether that is the box's end; or that the asker is too far behind. */
export type Difference = { updates: Update[]; pts: number; final: boolean; date: string } | { tooLong: true; pts: number; date: string };

export type Verdict = "apply" | "seen" | "gap";

/** Where an update stands against the number reached: next in line, seen already, or beyond a gap. */
export const verdictOf = (reached: number, u: Pick<Update, "pts" | "count">): Verdict =>
  reached + u.count === u.pts ? "apply" : reached + u.count > u.pts ? "seen" : "gap";

/** What the client holds while it syncs: the number reached, and the updates waiting beyond a gap. */
export interface SyncState { pts: number; pending: Update[] }

/** Updates arrived, with those already waiting: applied in order while they follow on, the seen dropped, the rest held; `gap` while any is held. */
export function receive(s: SyncState, arrived: readonly Update[]): { state: SyncState; apply: Update[]; gap: boolean } {
  const all = [...s.pending, ...arrived].sort((a, b) => a.pts - b.pts);
  const apply: Update[] = [], held: Update[] = [];
  let pts = s.pts;
  for (const u of all) {
    const v = verdictOf(pts, u);
    if (v === "apply" && held.length === 0) { apply.push(u); pts = u.pts; }
    else if (v === "gap" || held.length > 0) { if (v !== "seen" && !held.some((h) => h.pts === u.pts)) held.push(u); }
  }
  return { state: { pts, pending: held }, apply, gap: held.length > 0 };
}

/** The updates of a box after `pts`, at most `limit`, as kept on `now`: how far they reach and whether that is the box's end; too far behind when updates after `pts` are no longer kept. */
export function differenceOf(box: readonly Update[], pts: number, now: string, limit = DIFFERENCE_LIMIT): Difference {
  const last = box[box.length - 1]?.pts ?? 0;
  const cut = Date.parse(now) - BOX_KEEP_MS;
  const kept = box.filter((u) => Date.parse(u.at) >= cut);
  // The number just before the oldest update kept: a client behind it missed what was dropped.
  const first = kept[0] !== undefined ? kept[0].pts - kept[0].count : last;
  if (pts < first) return { tooLong: true, pts: last, date: now };
  const after = kept.filter((u) => u.pts > pts).slice(0, Math.max(1, limit));
  const reached = after[after.length - 1]?.pts ?? Math.min(pts, last);
  return { updates: after, pts: reached, final: reached >= last, date: now };
}
