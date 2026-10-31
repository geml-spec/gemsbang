// The local execution module (§10.5): the host runs it, never the model.
// After every sync it reads each channel the person is in, the risk file
// the owner keeps for it under the home, and the state of what it did so
// far; for every new signal it makes the one decision risk.ts allows — a
// paper record, a question on the band, an order through the owner's own
// connector command — and any error or stop-loss drops the channel back to
// 纸面 with a 卡住 on the band. The agent may object to a signal, never widen
// the file.
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseAddress } from "../core/im/address.js";
import type { Need } from "../core/im/needs-me.js";
import { ASK_ACTIONS, askText, consecutiveLosses, decide, execLine, FOOTER, localRecord, riskOf, settleRecords, STAGE_WORDS, stageLines, stopHit, type ExecState, type Risk } from "../core/im/risk.js";
import { foldSignals, priceAt, type Performance, type PricePoint, type Signal } from "../core/im/signal.js";
import { priceWords } from "../core/im/venue.js";
import { foldVenue, type VenueDoc } from "../relay/relay.js";
import { writeAtomic } from "../host-fs.js";
import { say } from "./deliver.js";
import { readConfig, readMirror, type Config } from "./home.js";

export interface Order { signal: string; market: string; side: "yes" | "no"; price: number; amount: number; channel: string }
/** The owner's connector (§10.5 本机存的凭证): the risk file's command, given the order; the order's id back, or the error. */
export type Connector = (command: string, order: Order) => Promise<{ ok: true; id: string } | { ok: false; error: string }>;
/** What a run needs from outside: the relay's prices and the publisher's performance, and the connector. */
export interface ExecTools { prices: (market: string) => Promise<PricePoint[]>; performance: (owner: string, agent: string) => Promise<Performance | undefined>; connector: Connector }

const fileKey = (owner: string, id: string): string => `${owner}__${id}`;
export const riskPath = (home: string, owner: string, id: string): string => join(home, "risk", `${fileKey(owner, id)}.json`);
export const execPath = (home: string, owner: string, id: string): string => join(home, "exec", `${fileKey(owner, id)}.json`);
const readJson = (path: string): unknown => { if (!existsSync(path)) return undefined; try { return JSON.parse(readFileSync(path, "utf8")); } catch { return undefined; } };

export function readRisk(home: string, owner: string, id: string): Risk { return riskOf(readJson(riskPath(home, owner, id))); }
export function writeRisk(home: string, owner: string, id: string, risk: Risk): void { writeAtomic(riskPath(home, owner, id), `${JSON.stringify(risk, null, 2)}\n`); }
export function readExec(home: string, owner: string, id: string): ExecState {
  const v = readJson(execPath(home, owner, id)) as Partial<ExecState> | undefined;
  const stuck = v?.stuck;
  return { records: Array.isArray(v?.records) ? v.records : [], asks: Array.isArray(v?.asks) ? v.asks : [], objections: typeof v?.objections === "object" && v.objections !== null ? v.objections : {}, ...(typeof stuck === "object" && stuck !== null && typeof stuck.why === "string" ? { stuck: { why: stuck.why, at: typeof stuck.at === "string" ? stuck.at : "" } } : {}) };
}
export function writeExec(home: string, owner: string, id: string, s: ExecState): void { writeAtomic(execPath(home, owner, id), `${JSON.stringify(s)}\n`); }

/** The channels the person subscribes to, from the mirrors; their own (where they publish) are not theirs to follow. */
export function channelsOf(home: string, c: Config): { owner: string; vd: VenueDoc }[] {
  const relayDir = join(home, c.relay.name.replace(/:/g, "_"));
  if (!existsSync(relayDir)) return [];
  const out: { owner: string; vd: VenueDoc }[] = [];
  for (const owner of readdirSync(relayDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()) {
    const dir = join(relayDir, owner, "venues");
    if (!existsSync(dir)) continue;
    for (const n of readdirSync(dir).filter((f) => f.endsWith(".geml")).sort()) {
      const id = n.slice(0, -".geml".length);
      const m = readMirror(home, c.relay.name, owner, `venues/${id}.geml`);
      const vd = foldVenue(owner, id, { blocks: m.blocks, diagnostics: [], text: m.text, exists: true }, c.relay.name);
      if (vd?.venue.kind === "channel" && owner !== c.person) out.push({ owner, vd });
    }
  }
  return out;
}

/** The channel's signals from the publisher's mirrored chain, by the messages' pointers, in the channel's order. */
export function signalsIn(home: string, c: Config, owner: string, vd: VenueDoc): Signal[] {
  if (vd.venue.publisher === undefined) return [];
  const byId = new Map(foldSignals(readMirror(home, c.relay.name, owner, `signals/${vd.venue.publisher}.geml`).blocks).map((s) => [s.id, s]));
  const out: Signal[] = [];
  for (const m of vd.messages) {
    if (m.kind !== "signal" || m.signal === undefined) continue;
    const id = parseAddress(m.signal)?.block;
    const s = id === undefined ? undefined : byId.get(id);
    if (s !== undefined) out.push(s);
  }
  return out;
}

/** The channel dropped to 纸面 (§10.5 任何出错或触发止损条件): the file rewritten, the asks cleared, the reason kept for the 卡住. */
function dropToPaper(home: string, owner: string, id: string, risk: Risk, state: ExecState, why: string, now: string, extra: Partial<Risk> = {}): Risk {
  const next: Risk = { ...risk, ...extra, stage: "paper", stageSince: now };
  writeRisk(home, owner, id, next);
  state.stuck = { why, at: now };
  state.asks = [];
  state.records.push({ signal: "", at: now, kind: "stopped", note: why });
  return next;
}

async function place(risk: Risk, connector: Connector, order: Order): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (risk.connector === undefined) return { ok: false, error: "风控文件没写 connector（下单命令）" };
  try { return await connector(risk.connector, order); } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}

/** The owner lets the agent read the thesis (§10.5): a line into their DM with their first agent, when that DM is mirrored; the agent objects with `im_signal skip`. */
function askAgent(home: string, c: Config, s: Signal, now: string): void {
  const agent = Object.keys(c.agents)[0];
  if (agent === undefined || !readMirror(home, c.relay.name, c.person, `venues/dm-${agent}.geml`).exists) return;
  say(home, { as: "person", owner: c.person, venue: `dm-${agent}`, text: `读一下信号 ${s.id} 的论点${s.thesis !== undefined ? ` ${s.thesis}` : ""}：要是反对，用 im_signal skip 说一句理由；不反对就不用回。` }, now);
}

/** One run over every channel (§10.5): the records settled against the prices, the stop-loss checked, each new signal decided and acted on, an expired ask dropped. How many signals were decided. */
export async function runExec(home: string, now: string, tools: ExecTools): Promise<number> {
  const c = readConfig(home);
  if (c === undefined) return 0;
  let decided = 0;
  const prices = new Map<string, PricePoint[]>();
  const fetchPrices = async (market: string): Promise<void> => { if (!prices.has(market)) { let p: PricePoint[] = []; try { p = await tools.prices(market); } catch { /* unpriced this round */ } prices.set(market, p); } };
  for (const { owner, vd } of channelsOf(home, c)) {
    const id = vd.venue.id, channel = `${owner}/${id}`;
    let risk = readRisk(home, owner, id);
    const state = readExec(home, owner, id);
    const signals = signalsIn(home, c, owner, vd);
    for (const m of new Set([...signals.map((s) => s.market), ...state.records.map((r) => r.market).filter((m): m is string => m !== undefined)])) await fetchPrices(m);
    settleRecords(state, (market, at) => priceAt(prices.get(market) ?? [], at), now);
    for (const a of state.asks.filter((a) => a.expires <= now)) state.records.push({ signal: a.signal, at: now, kind: "skipped", note: "过期没定" });
    state.asks = state.asks.filter((a) => a.expires > now);
    if (risk.stage !== "paper") {
      let perf: Performance | undefined;
      try { perf = vd.venue.publisher === undefined ? undefined : await tools.performance(owner, vd.venue.publisher); } catch { perf = undefined; }
      const stop = stopHit(risk, { ...(perf !== undefined ? { drawdown: perf.drawdown } : {}), losses: consecutiveLosses(state) });
      if (stop !== undefined) risk = dropToPaper(home, owner, id, risk, state, stop, now);
    }
    const handled = new Set([...state.records.map((r) => r.signal), ...state.asks.map((a) => a.signal)]);
    for (const s of signals) {
      if (handled.has(s.id)) continue;
      handled.add(s.id);
      const points = prices.get(s.market) ?? [];
      const price = points[points.length - 1]?.price;
      const d = decide(s, risk, state, price, now);
      decided++;
      if (d.kind === "paper") state.records.push({ signal: s.id, at: now, kind: "paper", note: d.note, market: s.market, side: s.side, entry: d.entry, expires: s.expires });
      else if (d.kind === "skip") state.records.push({ signal: s.id, at: now, kind: "skipped", note: d.reason });
      else if (d.kind === "ask") {
        state.asks.push({ signal: s.id, at: now, market: s.market, side: s.side, cap: s.priceCap, ...(d.price !== undefined ? { price: d.price } : {}), amount: d.amount, expires: s.expires, text: askText(s, d, state.objections[s.id], risk.agentReads) });
        if (risk.agentReads) askAgent(home, c, s, now);
      } else {
        const placed = await place(risk, tools.connector, { signal: s.id, market: s.market, side: s.side, price: d.price, amount: d.amount, channel });
        if (placed.ok) state.records.push({ signal: s.id, at: now, kind: "ordered", note: `单 ${placed.id} · ${d.price} × ${d.amount}`, market: s.market, side: s.side, entry: d.price, amount: d.amount, expires: s.expires, order: placed.id });
        else { state.records.push({ signal: s.id, at: now, kind: "failed", note: placed.error }); risk = dropToPaper(home, owner, id, risk, state, `下单失败：${placed.error}`, now); }
      }
    }
    writeExec(home, owner, id, state);
  }
  return decided;
}

/** A press on the band (§10.5): 跟 places the order through the connector and records it, 跳过 records that, 全停 drops the channel to 纸面 and mutes the asks; on a 卡住, 知道了 clears it. */
export async function answerExecNeed(home: string, key: string, action: string, now: string, connector: Connector): Promise<{ ok: true } | { ok: false; reason: string }> {
  const stuck = /^exec-stuck:([^/]+)\/([^/]+)$/.exec(key);
  if (stuck !== null) {
    const s = readExec(home, stuck[1]!, stuck[2]!);
    delete s.stuck;
    writeExec(home, stuck[1]!, stuck[2]!, s);
    return { ok: true };
  }
  const m = /^exec:([^/]+)\/([^/]+)\/(.+)$/.exec(key);
  if (m === null) return { ok: false, reason: `不认识这件事：${key}` };
  const owner = m[1]!, id = m[2]!, signal = m[3]!;
  const state = readExec(home, owner, id);
  const ask = state.asks.find((a) => a.signal === signal);
  if (ask === undefined) return { ok: false, reason: "这条询问已经过了" };
  const risk = readRisk(home, owner, id);
  state.asks = state.asks.filter((a) => a.signal !== signal);
  if (action === "全停") dropToPaper(home, owner, id, risk, state, "主人全停", now, { muted: true });
  else if (action === "跟") {
    const price = ask.price ?? ask.cap;
    const placed = await place(risk, connector, { signal, market: ask.market, side: ask.side, price, amount: ask.amount, channel: `${owner}/${id}` });
    if (placed.ok) state.records.push({ signal, at: now, kind: "followed", note: `单 ${placed.id} · ${price} × ${ask.amount}`, market: ask.market, side: ask.side, entry: price, amount: ask.amount, expires: ask.expires, order: placed.id });
    else { state.records.push({ signal, at: now, kind: "failed", note: placed.error }); dropToPaper(home, owner, id, risk, state, `下单失败：${placed.error}`, now); }
  } else if (action === "跳过") state.records.push({ signal, at: now, kind: "skipped", note: "主人跳过" });
  else return { ok: false, reason: `没有这个答复：${action}` };
  writeExec(home, owner, id, state);
  return { ok: true };
}

/** The agent's objection to one signal (§10.5 读论点后决定跳过某条): kept with the channel's state, shown on a pending ask, the signal skipped if not yet decided. */
export function objectToSignal(home: string, signal: string, reason: string, now: string): { ok: true; channel: string } | { ok: false; reason: string } {
  const c = readConfig(home);
  if (c === undefined) return { ok: false, reason: "没有 connect.json：先 gemworks connect setup" };
  for (const { owner, vd } of channelsOf(home, c)) {
    const s = signalsIn(home, c, owner, vd).find((x) => x.id === signal);
    if (s === undefined) continue;
    const state = readExec(home, owner, vd.venue.id);
    state.objections[signal] = reason;
    const risk = readRisk(home, owner, vd.venue.id);
    for (const a of state.asks) if (a.signal === signal) a.text = askText(s, { ...(a.price !== undefined ? { price: a.price } : {}), amount: a.amount }, reason, risk.agentReads);
    writeExec(home, owner, vd.venue.id, state);
    void now;
    return { ok: true, channel: `${owner}/${vd.venue.id}` };
  }
  return { ok: false, reason: `没有这条信号：${signal}` };
}

/** The module's needs on the band (§10.5, §6.9): a 定 per open ask, a 卡住 while the channel sits on 纸面 after an error or a stop. */
export function execNeeds(home: string, c: Config, now: string): Need[] {
  const out: Need[] = [];
  for (const { owner, vd } of channelsOf(home, c)) {
    const s = readExec(home, owner, vd.venue.id);
    for (const a of s.asks) if (a.expires > now) out.push({ kind: "decide", key: `exec:${owner}/${vd.venue.id}/${a.signal}`, text: `频道「${vd.venue.name}」· ${a.text}`, actions: [...ASK_ACTIONS], since: a.at, venue: vd.venue.id, level: 0 });
    if (s.stuck !== undefined) out.push({ kind: "stuck", key: `exec-stuck:${owner}/${vd.venue.id}`, text: `频道「${vd.venue.name}」本机执行退回纸面：${s.stuck.why}`, actions: ["知道了"], since: s.stuck.at, venue: vd.venue.id, level: 0 });
  }
  return out;
}

/** What the page shows for a channel (§10.4): the price in the head, the stage card, the module's line under each signal, today's count, the footer. */
export interface ChannelView { price: string; stageWord: string; stage: string[]; footer: string; today: number; exec: Record<string, string> }
export function channelView(home: string, c: Config, owner: string, vd: VenueDoc, now: string): ChannelView {
  const risk = readRisk(home, owner, vd.venue.id);
  const s = readExec(home, owner, vd.venue.id);
  const exec: Record<string, string> = {};
  for (const sig of signalsIn(home, c, owner, vd)) {
    const record = [...s.records].reverse().find((r) => r.signal === sig.id);
    exec[sig.id] = execLine(record ?? (s.asks.some((a) => a.signal === sig.id) ? { signal: sig.id, at: "", kind: "asked", note: "" } : undefined));
  }
  return { price: priceWords(vd.venue.price), stageWord: STAGE_WORDS[risk.stage], stage: stageLines(risk, localRecord(s), now), footer: FOOTER, today: vd.messages.filter((m) => m.kind === "signal" && m.at.slice(0, 10) === now.slice(0, 10)).length, exec };
}

/** The connector as a command (§10.5): the order as JSON on stdin and in ORDER_* variables; its stdout is the order's id; a non-zero exit is the error. */
export function commandConnector(command: string, order: Order): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  return new Promise((done) => {
    const win = process.platform === "win32";
    const child = spawn(win ? "cmd.exe" : "sh", win ? ["/d", "/s", "/c", command] : ["-c", command], { env: { ...process.env, ORDER_SIGNAL: order.signal, ORDER_MARKET: order.market, ORDER_SIDE: order.side, ORDER_PRICE: String(order.price), ORDER_AMOUNT: String(order.amount), ORDER_CHANNEL: order.channel }, stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", (c: Buffer) => { out += c; });
    child.stderr.on("data", (c: Buffer) => { err += c; });
    child.on("error", (e) => done({ ok: false, error: e.message }));
    child.on("exit", (code) => done(code === 0 ? { ok: true, id: out.trim() === "" ? "?" : out.trim() } : { ok: false, error: `connector exited ${code}: ${err.trim()}` }));
    child.stdin.end(`${JSON.stringify(order)}\n`);
  });
}
