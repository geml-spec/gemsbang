// The local execution module's rules (§10.5): the risk file the host keeps
// for a channel, the three stages and what each needs to move up, the one
// decision the module makes per signal — a paper record, a question to the
// owner, an order within the file, or a skip with its reason — the
// settlement of what it followed, and the stop-loss. The host runs it, never
// the model; an agent may object to a signal, never widen the file. Pure.
import { FOLLOW_FRACTION, SIDE_WORDS, type Signal } from "./signal.js";

export type Stage = "paper" | "small" | "auto";
export const STAGE_WORDS: Readonly<Record<Stage, string>> = { paper: "纸面", small: "小仓", auto: "限额内自动" };
/** What a stage needs before the owner may move the channel up (§10.5 三阶段). */
export const PAPER_DAYS = 14;
export const SMALL_DAYS = 14;
export const HIT_RATE = 0.6;

export interface Risk {
  /** The markets allowed. */
  markets: string[];
  perOrder: number;
  perDay: number;
  maxPositions: number;
  /** How far over the signal's cap an order may still go. */
  maxSlippage: number;
  cooldownMinutes: number;
  minConfidence: number;
  /** An order above this asks first even in 限额内自动; 0 never asks. */
  askAbove: number;
  stop: { drawdown: number; losses: number };
  stage: Stage;
  stageSince: string;
  /** 全停: back on 纸面 and no more asks until the owner lifts it. */
  muted: boolean;
  /** The owner lets the agent read each thesis and object. */
  agentReads: boolean;
  /** The owner's own exchange connector: a command given the order on stdin. */
  connector?: string;
}
export const DEFAULT_RISK: Risk = { markets: [], perOrder: 0, perDay: 0, maxPositions: 0, maxSlippage: 0.02, cooldownMinutes: 60, minConfidence: 0.6, askAbove: 0, stop: { drawdown: 0.1, losses: 3 }, stage: "paper", stageSince: "", muted: false, agentReads: false };

const obj = (v: unknown): Record<string, unknown> | undefined => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const strings = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()) : undefined);
const pct = (f: number): string => `${Math.round(f * 1000) / 10}%`;

/** A risk file from a body, each field given replacing the current's, a bad one kept out; `connector: null` removes the connector. */
export function riskOf(v: unknown, current: Risk = DEFAULT_RISK): Risk {
  const o = obj(v) ?? {};
  const out: Risk = { ...current, markets: [...current.markets], stop: { ...current.stop } };
  const markets = strings(o["markets"]); if (markets !== undefined) out.markets = markets;
  for (const k of ["perOrder", "perDay", "maxPositions", "maxSlippage", "cooldownMinutes", "minConfidence", "askAbove"] as const) { const n = num(o[k]); if (n !== undefined && n >= 0) out[k] = n; }
  const stop = obj(o["stop"]);
  if (stop !== undefined) {
    const d = num(stop["drawdown"]); if (d !== undefined && d >= 0) out.stop.drawdown = d;
    const l = num(stop["losses"]); if (l !== undefined && l >= 0) out.stop.losses = l;
  }
  if (o["stage"] === "paper" || o["stage"] === "small" || o["stage"] === "auto") out.stage = o["stage"];
  const since = str(o["stageSince"]); if (since !== undefined) out.stageSince = since;
  if (typeof o["muted"] === "boolean") out.muted = o["muted"];
  if (typeof o["agentReads"] === "boolean") out.agentReads = o["agentReads"];
  if (o["connector"] === null) delete out.connector;
  else { const c = str(o["connector"]); if (c !== undefined && c.trim() !== "") out.connector = c.trim(); }
  return out;
}

/** What the module did with a signal: the record under the card. */
export interface ExecRecord {
  signal: string;
  at: string;
  kind: "paper" | "asked" | "followed" | "skipped" | "ordered" | "failed" | "stopped";
  note: string;
  market?: string;
  side?: "yes" | "no";
  entry?: number;
  amount?: number;
  expires?: string;
  order?: string;
  /** Settled at expiry against the entry. */
  outcome?: "win" | "loss";
}
/** A question to the owner not yet answered (§10.5 小仓: 每一笔都是询问卡). */
export interface PendingAsk { signal: string; at: string; market: string; side: "yes" | "no"; cap: number; price?: number; amount: number; expires: string; text: string }
export interface ExecState { records: ExecRecord[]; asks: PendingAsk[]; objections: Record<string, string>; stuck?: { why: string; at: string } }
export const EMPTY_EXEC: ExecState = { records: [], asks: [], objections: {} };

export type Decision = { kind: "paper"; entry: number; note: string } | { kind: "ask"; price?: number; amount: number } | { kind: "order"; price: number; amount: number } | { kind: "skip"; reason: string };

const placed = (r: ExecRecord): boolean => r.kind === "ordered" || r.kind === "followed";

/** The one decision per signal (§10.5): 纸面 only records; the file's checks each a skip with its reason; 小仓 asks; 限额内自动 orders, asks above the line; no price, no order. */
export function decide(s: Signal, risk: Risk, state: ExecState, price: number | undefined, now: string): Decision {
  if (s.retracted !== undefined) return { kind: "skip", reason: "已撤回" };
  if (s.expires <= now) return { kind: "skip", reason: "已过期" };
  const objection = state.objections[s.id];
  if (objection !== undefined) return { kind: "skip", reason: `agent 反对：${objection}` };
  if (risk.stage === "paper") { const entry = price ?? s.priceCap; return { kind: "paper", entry, note: `若跟：${entry} 进，${pct(FOLLOW_FRACTION)}` }; }
  if (!risk.markets.includes(s.market)) return { kind: "skip", reason: "市场不在白名单" };
  if (s.confidence < risk.minConfidence) return { kind: "skip", reason: `信心 ${s.confidence} 低于 ${risk.minConfidence}` };
  const amount = risk.perOrder;
  if (amount <= 0) return { kind: "skip", reason: "单笔上限是 0" };
  const today = state.records.filter((r) => placed(r) && r.at.slice(0, 10) === now.slice(0, 10)).reduce((n, r) => n + (r.amount ?? 0), 0);
  if (today + amount > risk.perDay) return { kind: "skip", reason: `超当日上限 ${risk.perDay}` };
  const positions = state.records.filter((r) => placed(r) && r.expires !== undefined && r.expires > now).length;
  if (positions >= risk.maxPositions) return { kind: "skip", reason: `持仓已满 ${risk.maxPositions}` };
  const last = [...state.records].reverse().find(placed);
  if (last !== undefined && Date.parse(now) - Date.parse(last.at) < risk.cooldownMinutes * 60_000) return { kind: "skip", reason: `冷却中 ${risk.cooldownMinutes} 分钟` };
  if (price !== undefined && price > s.priceCap * (1 + risk.maxSlippage)) return { kind: "skip", reason: `价 ${price} 超上限 ${s.priceCap}` };
  const ask = price === undefined || risk.stage === "small" || (risk.askAbove > 0 && amount > risk.askAbove);
  if (ask) return risk.muted ? { kind: "skip", reason: "已全停，询问静音" } : { kind: "ask", ...(price !== undefined ? { price } : {}), amount };
  return { kind: "order", price: price!, amount };
}

/** Each placed record settled once its signal expired: a win when the price moved the signal's way. How many settled now. */
export function settleRecords(state: ExecState, price: (market: string, at: string) => number | undefined, now: string): number {
  let n = 0;
  for (const r of state.records) {
    if (!(placed(r) || r.kind === "paper") || r.outcome !== undefined || r.expires === undefined || r.expires > now || r.entry === undefined || r.market === undefined) continue;
    const exit = price(r.market, r.expires);
    if (exit === undefined) continue;
    r.outcome = (exit - r.entry) * (r.side === "no" ? -1 : 1) > 0 ? "win" : "loss";
    n++;
  }
  return n;
}

/** Losses in a row among the settled records, newest first. */
export function consecutiveLosses(state: ExecState): number {
  let n = 0;
  for (const r of [...state.records].reverse()) {
    if (!placed(r) || r.outcome === undefined) continue;
    if (r.outcome === "loss") n++; else break;
  }
  return n;
}

/** What following would have done, by the records settled so far (paper ones included): the evidence a stage needs. */
export function localRecord(state: ExecState): { hits: number; counted: number } {
  let hits = 0, counted = 0;
  for (const r of state.records) if (r.outcome !== undefined) { counted++; if (r.outcome === "win") hits++; }
  return { hits, counted };
}

/** The stop-loss (§10.5): the drawdown past the file's line, or that many losses in a row; a zero turns the check off. The caller drops the channel to 纸面. */
export function stopHit(risk: Risk, o: { drawdown?: number; losses: number }): string | undefined {
  if (o.drawdown !== undefined && risk.stop.drawdown > 0 && o.drawdown >= risk.stop.drawdown) return `回撤 ${pct(o.drawdown)} 到了止损线 ${pct(risk.stop.drawdown)}`;
  if (risk.stop.losses > 0 && o.losses >= risk.stop.losses) return `连亏 ${o.losses} 次`;
  return undefined;
}

export const stageDays = (risk: Risk, now: string): number => (risk.stageSince === "" ? 0 : Math.max(0, Math.floor((Date.parse(now) - Date.parse(risk.stageSince)) / 86_400_000)));

/** Whether the owner may move the channel up (§10.5): 纸面 needs its days and the hit rate, 小仓 its days; the approval is theirs. */
export function canAdvance(risk: Risk, perf: { hits: number; counted: number } | undefined, now: string): { ok: true; to: Stage } | { ok: false; why: string } {
  const days = stageDays(risk, now);
  if (risk.stage === "paper") {
    const need: string[] = [];
    if (days < PAPER_DAYS) need.push(`还要 ${PAPER_DAYS - days} 天`);
    const rate = perf === undefined || perf.counted === 0 ? undefined : perf.hits / perf.counted;
    if (rate === undefined || rate < HIT_RATE) need.push(`命中 ≥ ${pct(HIT_RATE)}（现在${rate === undefined ? "没有结算的信号" : ` ${pct(rate)}`}）`);
    return need.length === 0 ? { ok: true, to: "small" } : { ok: false, why: need.join("，且") };
  }
  if (risk.stage === "small") return days < SMALL_DAYS ? { ok: false, why: `还要 ${SMALL_DAYS - days} 天` } : { ok: true, to: "auto" };
  return { ok: false, why: "已是最高阶段" };
}

/** The stage card (§10.5): which stage and its day, the hit rate so far, what is still missing. */
export function stageLines(risk: Risk, perf: { hits: number; counted: number } | undefined, now: string): string[] {
  const rate = perf === undefined || perf.counted === 0 ? "命中 —" : `命中 ${pct(perf.hits / perf.counted)}`;
  const head = `阶段：${STAGE_WORDS[risk.stage]} · 第 ${stageDays(risk, now) + 1} 天 · ${rate}${risk.muted ? " · 询问已静音" : ""}`;
  if (risk.stage === "auto") return [head, `限额：单笔 ≤ ${risk.perOrder} · 当日 ≤ ${risk.perDay} · 最多 ${risk.maxPositions} 仓`];
  const up = canAdvance(risk, perf, now);
  return [head, up.ok ? `可升级到${STAGE_WORDS[up.to]}：主人批准` : `升级：${up.why}，主人批准`];
}

export const ASK_ACTIONS = ["跟", "跳过", "全停"] as const;

/** The ask card of 小仓 (§10.5): the signal, its expiry, side, price, amount, that it is within the file, and whether the agent read the thesis. */
export function askText(s: Signal, d: { price?: number; amount: number }, objection: string | undefined, agentReads: boolean): string {
  const agent = !agentReads ? "未参与" : objection === undefined ? "读了论点，没反对" : `反对：${objection}`;
  return `跟 ${s.id}？过期 ${s.expires.slice(11, 16)} · ${SIDE_WORDS[s.side]} · 价 ${d.price ?? `≤${s.priceCap}（还没有报价）`} · 金额 ${d.amount} · 在风控之内 · agent：${agent}`;
}

/** The line under the signal card: what the local module did (§10.4). */
export function execLine(r: ExecRecord | undefined): string {
  if (r === undefined) return "本机：还没处理";
  switch (r.kind) {
    case "paper": return `纸面 · 记为『${r.note}』· 没下单`;
    case "asked": return "已问主人 · 等定";
    case "followed": return `跟了 · ${r.note}`;
    case "ordered": return `自动下单 · ${r.note}`;
    case "skipped": return `跳过 · ${r.note}`;
    case "failed": return `下单失败 · ${r.note}`;
    case "stopped": return `全停 · ${r.note}`;
  }
}

export const FOOTER = "平台不托管资金、不经手密钥 · 订阅时已展示免责条款 · 发布方看不到你跟没跟";
export const DISCLAIMER = "免责条款：信号只是发布方 agent 的意见，不是投资建议；平台不托管资金、不经手密钥，跟不跟、跟多少由你本机的风控文件决定，盈亏自负；有些地区卖信号受监管，订阅前请按当地规定核实。";
