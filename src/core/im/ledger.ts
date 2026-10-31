// The ledger (§9.1): one kind of credit; a person's wallet, never an agent's;
// an append-only hash chain per person the relay alone writes, an entry per
// movement with the other side's named; a hold (a card's escrow, a gift, a
// packet) an account of its own; four caps the owner sets, the relay keeps
// and the wallet page shows with today's use. Pure: blocks in, entries,
// sums and lines out. v1 cashes nothing out.

export type EntryKind = "topup" | "gift" | "packet" | "tip" | "escrow" | "settle" | "refund" | "fee" | "spend" | "favor" | "subscribe";
export const KIND_WORDS: Readonly<Record<EntryKind, string>> = { topup: "充值", gift: "赠送", packet: "红包", tip: "打赏", escrow: "托管", settle: "结算", refund: "退款", fee: "平台抽成", spend: "消耗", favor: "人情", subscribe: "订阅" };
const KINDS = new Set<string>(Object.keys(KIND_WORDS));

/** What an agent's spend counts against (§9.1): its day, a card, the guests' questions, buying on its own. */
export type CapKey = "agent" | "card" | "guest" | "auto";
export interface Caps { agentPerDay: number; perCard: number; guestPerDay: number; autoBuy: number }
export const DEFAULT_CAPS: Caps = { agentPerDay: 30, perCard: 40, guestPerDay: 10, autoBuy: 5 };
/** What a new person's wallet opens with (transport §7.2: 先免费额度，再积分). */
export const FREE_CREDITS = 20;
/** What one guest question costs its owner (the inference, in the platform's one unit). */
export const GUEST_QUESTION_CREDITS = 1;
/** A red packet's shares return to the giver after this long (§9.1). */
export const PACKET_HOURS = 24;
/** An account the platform itself holds: top-ups come from it, spends go to it, the fee too. */
export const PLATFORM = "platform";
/** Why a guest's question is refused for the wallet's sake (the count quotas have their own words in share.ts). */
export const WALLET_WORDS = { ownerBroke: "作者的积分用完了" } as const;

export interface Entry {
  n: number;
  kind: EntryKind;
  from: string;
  to: string;
  amount: number;
  note: string;
  at: string;
  /** The same movement in the other party's ledger carries the same tx. */
  tx: string;
  /** A card's, a packet's or an arbitration's address. */
  ref?: string;
  /** The agent that spent or was tipped, by name. */
  agent?: string;
  cap?: CapKey;
  card?: string;
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const obj = (v: unknown): Record<string, unknown> | undefined => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);
const CAP_KEYS = new Set<string>(["agent", "card", "guest", "auto"]);

/** The hold account of a thing: `hold:<kind>/<id>`. */
export const holdOf = (kind: "card" | "gift" | "packet", id: string): string => `hold:${kind}/${id}`;

/** The caps from a body or a block: a non-negative integer each, else the default (zero is a cap: nothing allowed). */
export function capsOf(v: unknown): Caps {
  const o = obj(v) ?? {};
  const n = (k: keyof Caps): number => { const x = o[k]; return Number.isInteger(x) && (x as number) >= 0 ? (x as number) : DEFAULT_CAPS[k]; };
  return { agentPerDay: n("agentPerDay"), perCard: n("perCard"), guestPerDay: n("guestPerDay"), autoBuy: n("autoBuy") };
}

/** The ledger's entries in order: the `entry-N` blocks of a known kind. */
export function foldLedger(blocks: readonly { id: string; value: Record<string, unknown> }[]): Entry[] {
  const out: Entry[] = [];
  for (const b of blocks) {
    const m = /^entry-(\d+)$/.exec(b.id);
    const kind = str(b.value["kind"]);
    if (m === null || kind === undefined || !KINDS.has(kind)) continue;
    const amount = b.value["amount"];
    const e: Entry = { n: Number(m[1]), kind: kind as EntryKind, from: str(b.value["from"]) ?? "", to: str(b.value["to"]) ?? "", amount: typeof amount === "number" && Number.isFinite(amount) ? amount : 0, note: str(b.value["note"]) ?? "", at: str(b.value["at"]) ?? "", tx: str(b.value["tx"]) ?? "" };
    const ref = str(b.value["ref"]); if (ref !== undefined) e.ref = ref;
    const agent = str(b.value["agent"]); if (agent !== undefined) e.agent = agent;
    const cap = str(b.value["cap"]); if (cap !== undefined && CAP_KEYS.has(cap)) e.cap = cap as CapKey;
    const card = str(b.value["card"]); if (card !== undefined) e.card = card;
    out.push(e);
  }
  return out;
}

/** An account's balance as these entries saw it: what came to it less what left it; a favour moves nothing. */
export function balanceOf(entries: readonly Entry[], account: string): number {
  let n = 0;
  for (const e of entries) {
    if (e.kind === "favor") continue;
    if (e.to === account) n += e.amount;
    if (e.from === account) n -= e.amount;
  }
  return n;
}

export interface Used { agents: Record<string, number>; cards: Record<string, number>; guest: number; auto: number }
const sameDay = (a: string, b: string): boolean => a.slice(0, 10) === b.slice(0, 10);

/** Today's use against each cap: what each agent spent, what each card took (its escrow and its spends), the guests' questions, the buying. */
export function usedToday(entries: readonly Entry[], now: string): Used {
  const out: Used = { agents: {}, cards: {}, guest: 0, auto: 0 };
  for (const e of entries) {
    if (!sameDay(e.at, now)) continue;
    if (e.kind === "spend") {
      if (e.agent !== undefined) out.agents[e.agent] = (out.agents[e.agent] ?? 0) + e.amount;
      if (e.cap === "guest") out.guest += e.amount;
      if (e.cap === "auto") out.auto += e.amount;
    }
    if ((e.kind === "spend" || e.kind === "escrow") && e.card !== undefined) out.cards[e.card] = (out.cards[e.card] ?? 0) + e.amount;
  }
  return out;
}

/** An account as a line names it: a person by id, an agent by name, the platform, a card's hold by the card, a gift's or a packet's by what it is. */
export function accountName(account: string): string {
  if (account === PLATFORM) return "平台";
  if (account.startsWith("person:")) return account.slice("person:".length);
  if (account.startsWith("agent:")) return account.slice("agent:".length).replace(/@.*$/, "");
  const hold = /^hold:(card|gift|packet)\/(?:[^/]+\/)?([^/]+)$/.exec(account);
  if (hold !== null) return hold[1] === "card" ? `#${hold[2]}` : hold[1] === "gift" ? "礼物" : "红包";
  return account;
}

/** One ledger line (§9.1): time, kind · who to whom · the note, the amount signed from `me`'s side; a favour says 不转积分. An agent named on the entry stands for its side: the one that spent, or the one tipped or paid. */
export function entryLine(e: Entry, me: string, clock: (at: string) => string): string {
  const from = e.kind === "spend" && e.agent !== undefined ? e.agent : accountName(e.from);
  const to = e.kind !== "spend" && e.agent !== undefined ? e.agent : accountName(e.to);
  const amount = e.kind === "favor" ? "不转积分" : e.to === me ? `+${e.amount}` : e.from === me ? `−${e.amount}` : String(e.amount);
  return `${clock(e.at)} ${KIND_WORDS[e.kind]} · ${from} 给 ${to} · ${e.note} | ${amount}`;
}

export interface WalletSummary { balance: number; caps: Caps; used: Used; agents: readonly string[] }

/** The wallet page's head (§9.1): the balance, then the four caps, each with today's use when any. */
export function walletLines(w: WalletSummary): string[] {
  const used = (n: number): string => (n > 0 ? ` · 已用 ${n}` : "");
  return [
    `钱包 ${w.balance} 积分`,
    ...w.agents.map((a) => `${a} 每天 ${w.caps.agentPerDay}${used(w.used.agents[a] ?? 0)}`),
    `每张卡 ${w.caps.perCard}`,
    `访客问答每天 ${w.caps.guestPerDay}${used(w.used.guest)}`,
    `自动买东西 ${w.caps.autoBuy}${used(w.used.auto)} · 超过要问我`,
  ];
}
