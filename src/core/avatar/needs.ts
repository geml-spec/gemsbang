// 需要你 (spec §7.3): what an avatar brings to its person, and nothing else —
// five kinds: a promise asked of them (答应事情, a newcomer at a group they
// let in by hand among them), money (花钱), taking a side (表态), a task sent
// to them that needs their computer (任务), something gone wrong (出错). A
// card says which avatar, which kind, from which chat, what it checked, the
// words it would send, the options — each a short form of those words. IM is
// asynchronous (architecture §6.3): a card waits until the person answers it,
// unless the matter has a deadline of its own, which the asker gives as its
// expiry. Errors come first, then the newest; the expired last; two are shown
// whole, more fold. Pure.
import { say, type Lang } from "./words.js";

export const NEED_KINDS = ["promise", "pay", "stance", "borrow", "error"] as const;
export type NeedKind = (typeof NEED_KINDS)[number];
export const NEED_MAX_MS = 7 * 86_400_000;
export const SUMMARY_MAX = 400, OPTION_MAX = 24, DRAFT_MAX = 4000;

/** An option: its short label, and the words it sends when it is the answer (a borrow's or an error's send none). */
export interface NeedOption { label: string; text?: string }
export type NeedState = "open" | "answered" | "expired";
export interface Need {
  id: string; avatar: string; kind: NeedKind; summary: string; options: NeedOption[]; at: string; state: NeedState;
  /** The matter's own deadline, when it has one; without it the card waits until it is answered. */
  expires?: string;
  venue?: { owner: string; id: string }; message?: string; checked?: string; draft?: string;
  /** A newcomer waiting at a group of the owner's (spec §6.1): the answer lets them in or not. */
  request?: string;
  /** The avatar whose words started it (a borrow's asker, spec §7.4). */
  from?: string;
  answer?: { choice: number | "own"; text?: string; at: string };
}

export const isKind = (v: unknown): v is NeedKind => typeof v === "string" && (NEED_KINDS as readonly string[]).includes(v);

/** The options a kind has when the asker gives none: a borrow's three, an error's two, money's two. */
export function defaultOptions(kind: NeedKind, lang: Lang): NeedOption[] {
  if (kind === "borrow") return [{ label: say("need.borrow.now", lang) }, { label: say("need.borrow.queue", lang) }, { label: say("need.borrow.no", lang) }];
  if (kind === "error") return [{ label: say("need.error.why", lang) }, { label: say("need.error.retry", lang) }];
  if (kind === "pay") return [{ label: say("need.pay.yes", lang) }, { label: say("need.pay.no", lang) }];
  return [];
}

const obj = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** What is wrong with an ask, as a code and its parameters; undefined when nothing is. */
export function needFault(body: unknown, now: string): { code: string; params?: Record<string, string | number> } | undefined {
  const o = obj(body);
  if (!isKind(o["kind"])) return { code: "need.kind" };
  const summary = o["summary"];
  if (typeof summary !== "string" || summary.trim() === "" || [...summary].length > SUMMARY_MAX) return { code: "need.summary", params: { max: SUMMARY_MAX } };
  if (o["options"] !== undefined) {
    const opts = o["options"];
    if (!Array.isArray(opts) || opts.length < 1 || opts.length > 4 || !opts.every((x) => typeof obj(x)["label"] === "string" && (obj(x)["label"] as string).trim() !== "" && [...(obj(x)["label"] as string)].length <= OPTION_MAX && (obj(x)["text"] === undefined || typeof obj(x)["text"] === "string"))) return { code: "need.options", params: { max: OPTION_MAX } };
  }
  if (o["draft"] !== undefined && (typeof o["draft"] !== "string" || [...(o["draft"] as string)].length > DRAFT_MAX)) return { code: "need.draft", params: { max: DRAFT_MAX } };
  if (o["expires"] !== undefined) {
    const t = typeof o["expires"] === "string" ? Date.parse(o["expires"] as string) : NaN, n = Date.parse(now);
    if (Number.isNaN(t) || t <= n || t - n > NEED_MAX_MS) return { code: "need.expires" };
  }
  return undefined;
}

/** Errors first, then the newest; the expired after the open. */
export function orderNeeds<T extends Pick<Need, "kind" | "at" | "state">>(needs: readonly T[]): T[] {
  const rank = (n: T): number => (n.state === "expired" ? 2 : n.kind === "error" ? 0 : 1);
  return [...needs].sort((a, b) => rank(a) - rank(b) || (a.at > b.at ? -1 : a.at < b.at ? 1 : 0));
}

/** Two shown whole; more, the rest counted (spec §7.1). */
export function foldNeeds<T>(needs: readonly T[], open = false): { shown: T[]; folded: number } {
  if (open || needs.length <= 2) return { shown: [...needs], folded: 0 };
  return { shown: needs.slice(0, 2), folded: needs.length - 2 };
}

/** How long a card still waits, in words: hours, minutes, or 已过期. */
export function expiresIn(expires: string, now: string, lang: Lang): string {
  const left = Date.parse(expires) - Date.parse(now);
  if (Number.isNaN(left) || left <= 0) return say("need.expired", lang);
  if (left >= 3_600_000) return say("need.hours", lang, { count: Math.floor(left / 3_600_000) });
  return say("need.minutes", lang, { count: Math.max(1, Math.ceil(left / 60_000)) });
}

/** The words an answer sends: the person's own, or the option's; none for an option that sends none. */
export function wordsOf(need: Pick<Need, "options" | "draft">, choice: number | "own", text?: string): string | undefined {
  if (choice === "own") return text !== undefined && text.trim() !== "" ? text : undefined;
  const o = need.options[choice];
  return o?.text;
}
