// Who pays (spec §8.3, §3 rule 18): every hosted round is someone's. A
// newcomer has a free quota — seven days from their first login or fifty
// hosted replies, whichever ends first, shared by all their avatars; the
// operator may change both numbers. After it, the person's own way to pay
// (their own model API key first); with none, the hosted avatar only
// receives: messages still come in, 需要你 still reaches the person, but it
// answers nobody, and its name says 「本人在时才回」. A day before the quota
// ends the person is told once. Pure.

export const FREE_DAYS = 7;
export const FREE_REPLIES = 50;
export const WARN_MS = 86_400_000;
export const WARN_REPLIES = 5;

export interface Quota { free: boolean; endsAt: string; daysLeft: number; repliesLeft: number; warn: boolean }
export type Pay = "free" | "key" | "receive-only";

/** The quota at `now`: still free or not, when it ends, what is left, whether the warning is due. */
export function quotaOf(o: { firstLogin: string; used: number; now: string; days?: number; replies?: number }): Quota {
  const days = o.days ?? FREE_DAYS, replies = o.replies ?? FREE_REPLIES;
  const end = Date.parse(o.firstLogin) + days * 86_400_000, now = Date.parse(o.now);
  const msLeft = end - now, repliesLeft = Math.max(0, replies - o.used);
  const free = msLeft > 0 && repliesLeft > 0;
  return {
    free, endsAt: new Date(end).toISOString().replace(/\.\d{3}Z$/, "Z"), daysLeft: Math.max(0, Math.ceil(msLeft / 86_400_000)), repliesLeft,
    warn: free && (msLeft <= WARN_MS || repliesLeft <= WARN_REPLIES),
  };
}

/** How a round is paid: the free quota, the person's own key, or not at all. */
export const payFor = (q: Quota, hasKey: boolean): Pay => (q.free ? "free" : hasKey ? "key" : "receive-only");
