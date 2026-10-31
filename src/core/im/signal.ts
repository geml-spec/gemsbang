// A signal (§10.1): fixed fields, data and never a prompt, @ nobody. The
// publisher's host seals it on its own chain first and the relay stamps it
// again on receipt (§10.2); a retraction stays on the chain. Performance is
// the platform's, by one fixed public rule over every signal, the retracted
// ones included, from a price series kept with hashes (§10.3). Pure: the
// record, its faults, the chain's fold, the price lookup, the rule, the words.

export type Side = "yes" | "no";
export const SIDE_WORDS: Readonly<Record<Side, string>> = { yes: "买是", no: "买否" };
export interface SizeHint { kind: "fraction-of-bankroll"; value: number }
export interface SignalInput { market: string; side: Side; sizeHint: SizeHint; priceCap: number; expires: string; confidence: number; thesis?: string }
export interface Signal extends SignalInput {
  id: string;
  /** The publisher's agent. */
  from: string;
  /** The publisher's stamp, and the relay's on receipt (§10.2). */
  at: string;
  received: string;
  /** The hash the publisher's host sealed it with, when it sent one. */
  hostHash?: string;
  /** The channel it went into, `<owner>/<id>`. */
  channel?: string;
  /** When it was retracted; it stays on the chain and counts (§10.2). */
  retracted?: string;
}

const obj = (v: unknown): Record<string, unknown> | undefined => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** Every field checked (§10.1); the thesis is optional. */
export function signalFaults(v: unknown): string[] {
  const o = obj(v) ?? {};
  const out: string[] = [];
  if ((str(o["market"]) ?? "").trim() === "") out.push("缺市场");
  if (o["side"] !== "yes" && o["side"] !== "no") out.push("方向是 yes 或 no");
  const hint = obj(o["sizeHint"]);
  const fraction = hint === undefined ? undefined : num(hint["value"]);
  if (hint?.["kind"] !== "fraction-of-bankroll" || fraction === undefined || fraction <= 0 || fraction > 1) out.push("仓位提示是 { kind: fraction-of-bankroll, value: 0 到 1 }");
  const cap = num(o["priceCap"]);
  if (cap === undefined || cap <= 0) out.push("价格上限是正数");
  const expires = str(o["expires"]);
  if (expires === undefined || Number.isNaN(Date.parse(expires))) out.push("过期时间要是 ISO 时间");
  const confidence = num(o["confidence"]);
  if (confidence === undefined || confidence < 0 || confidence > 1) out.push("信心是 0 到 1");
  if (o["thesis"] !== undefined && typeof o["thesis"] !== "string") out.push("论点引用是地址");
  return out;
}

/** The input normalized, or nothing when it has faults. */
export function signalInput(v: unknown): SignalInput | undefined {
  if (signalFaults(v).length > 0) return undefined;
  const o = obj(v)!;
  const hint = obj(o["sizeHint"])!;
  const s: SignalInput = { market: (o["market"] as string).trim(), side: o["side"] as Side, sizeHint: { kind: "fraction-of-bankroll", value: hint["value"] as number }, priceCap: o["priceCap"] as number, expires: o["expires"] as string, confidence: o["confidence"] as number };
  const thesis = str(o["thesis"]);
  if (thesis !== undefined && thesis !== "") s.thesis = thesis;
  return s;
}

/** The chain `signals/<agent>.geml` folded: a `signal-N` block a signal, a `retract-N` block the mark on one. */
export function foldSignals(blocks: readonly { id: string; value: Record<string, unknown> }[]): Signal[] {
  const out: Signal[] = [];
  for (const b of blocks) {
    if (/^signal-\d+$/.test(b.id)) {
      const input = signalInput(b.value);
      if (input === undefined) continue;
      const s: Signal = { ...input, id: b.id, from: str(b.value["from"]) ?? "", at: str(b.value["at"]) ?? "", received: str(b.value["received"]) ?? "" };
      const hostHash = str(b.value["hostHash"]); if (hostHash !== undefined) s.hostHash = hostHash;
      const channel = str(b.value["channel"]); if (channel !== undefined) s.channel = channel;
      out.push(s);
    } else if (/^retract-\d+$/.test(b.id)) {
      const target = out.find((s) => s.id === str(b.value["signal"]));
      if (target !== undefined && target.retracted === undefined) target.retracted = str(b.value["at"]) ?? "";
    }
  }
  return out;
}

const hhmm = (at: string): string => at.slice(11, 16);
const hhmmss = (at: string): string => at.slice(11, 19);
const mmdd = (at: string): string => `${at.slice(5, 10)} ${hhmm(at)}`;
const pct = (f: number): string => `${Math.round(f * 1000) / 10}%`;
const signedPct = (f: number): string => (f < 0 ? `−${pct(-f)}` : f > 0 ? `+${pct(f)}` : "0%");

/** The message's text in the channel: the signal in one line. */
export const signalText = (s: Pick<Signal, "id" | "market" | "side" | "priceCap" | "expires">): string => `信号 ${s.id} · ${s.market} · ${SIDE_WORDS[s.side]} · 价 ≤${s.priceCap} · 过期 ${hhmm(s.expires)}`;

/** The signal card (§10.4): the kind and id with both stamps, the fields, the thesis, and what the local module did with it. */
export function signalLines(s: Signal, exec?: string): string[] {
  return [
    `信号 ${s.id} · 发布 ${hhmmss(s.at)} · 中继收到 ${hhmmss(s.received)}${s.retracted !== undefined ? " · 已撤回" : ""}`,
    `市场 ${s.market} · ${SIDE_WORDS[s.side]} · 价 ≤${s.priceCap} · 仓位 ${pct(s.sizeHint.value)} · 过期 ${mmdd(s.expires)} · 信心 ${s.confidence}`,
    ...(s.thesis !== undefined ? [`论点 ${s.thesis}`] : []),
    ...(exec !== undefined ? [exec] : []),
  ];
}

export interface PricePoint { at: string; price: number }

/** The last price at or before the moment; nothing before the first point. The points are in time order. */
export function priceAt(points: readonly PricePoint[], at: string): number | undefined {
  let found: number | undefined;
  for (const p of points) { if (p.at <= at) found = p.price; else break; }
  return found;
}

/** The fixed public rule (§10.3): in at the receipt price when it is within the cap, with this fraction; out at expiry at that price. */
export const FOLLOW_FRACTION = 0.02;
export const PERFORMANCE_DAYS = 90;
export const RULE_WORDS = `固定规则：中继收到时价格在上限内就以 ${pct(FOLLOW_FRACTION)} 仓位进，到期按当时价出；撤回的仍计入；价格来自公开源并存哈希`;

export interface Performance { hits: number; counted: number; open: number; return90: number; drawdown: number; retracted: number; rule: string }

const round4 = (n: number): number => Math.round(n * 10000) / 10000;

/** Every signal by the rule, in the order the relay received them: the hits, the return of the last 90 days, the deepest drawdown of the running return; a retracted one counts; an unentered, unpriced or still-open one does not. */
export function performanceOf(signals: readonly Signal[], price: (market: string, at: string) => number | undefined, now: string): Performance {
  let hits = 0, counted = 0, open = 0, retracted = 0, return90 = 0, equity = 0, peak = 0, drawdown = 0;
  const since = new Date(Date.parse(now) - PERFORMANCE_DAYS * 86_400_000).toISOString();
  for (const s of [...signals].sort((a, b) => (a.received < b.received ? -1 : a.received > b.received ? 1 : 0))) {
    if (s.retracted !== undefined) retracted++;
    const entry = price(s.market, s.received);
    if (entry === undefined || entry > s.priceCap) continue;
    if (s.expires > now) { open++; continue; }
    const exit = price(s.market, s.expires);
    if (exit === undefined) continue;
    counted++;
    const r = FOLLOW_FRACTION * ((exit - entry) / entry) * (s.side === "yes" ? 1 : -1);
    if (r > 0) hits++;
    if (s.received >= since) return90 += r;
    equity += r;
    peak = Math.max(peak, equity);
    drawdown = Math.max(drawdown, peak - equity);
  }
  return { hits, counted, open, return90: round4(return90), drawdown: round4(drawdown), retracted, rule: RULE_WORDS };
}

/** The four numbers of the performance page (§10.4). */
export const performanceLine = (p: Performance): string => `命中 ${p.hits}/${p.counted} · 90 天收益 ${signedPct(p.return90)} · 最大回撤 ${pct(p.drawdown)} · 已撤回 ${p.retracted}（仍计入）`;
