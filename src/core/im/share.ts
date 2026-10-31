// The share card (§11, transport §7.1): a delivery package without an
// acceptance mapping (§8.6) plus a public-scope declaration, made by the
// owner from a session — the smallest spreading loop. This module is the
// record, the faults in what a client sends, the words the page and the
// board show, and the guest quota (§9.1's 访客问答上限 before the ledger
// exists). Pure: records in, records and words out.

/** 「怎么做出来的」: a milestone turn, an embed of that turn's record when given. */
export interface Replay { turn: number; label: string; src?: string }
/** 拿去用: the repository at a commit, the license, the AI statement. */
export interface UseTerms { repo?: string; commit?: string; license?: string; ai?: string }
export interface ShareInput {
  title: string;
  /** The one line (§11), and whether the agent drafted it (the owner edited it) or the owner typed it (rule 6). */
  summary: string;
  summarySource: "self" | "drafted";
  /** The agent that made it, by its shown name. */
  agent: string;
  turns?: number;
  /** A demo to play; a web build to open in the browser. */
  demo?: string;
  open?: string;
  replay: Replay[];
  /** The public range: what the agent may talk about; the rest it says it does not. */
  scope: string;
  /** Evidence lines the host observed. */
  evidence: string[];
  use: UseTerms;
}
/** The card as the relay stores it: public to every reader, dated, the id the relay drew. */
export interface ShareCard extends ShareInput { kind: "share"; id: string; public: true; at: string }

export const TITLE_LIMIT = 200;
export const SUMMARY_LIMIT = 1000;
export const SCOPE_LIMIT = 500;
export const REPLAY_LIMIT = 12;
const URL_RE = /^https?:\/\/\S+$/;

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const obj = (v: unknown): Record<string, unknown> | undefined => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()) : []);

/** The faults in what a client sent, as a person reads them; none means `shareInput` gives the record. */
export function shareFaults(v: unknown): string[] {
  const o = obj(v);
  if (o === undefined) return ["要一个 JSON 对象"];
  const out: string[] = [];
  const title = str(o["title"])?.trim() ?? "";
  if (title === "") out.push("缺标题");
  else if ([...title].length > TITLE_LIMIT) out.push(`标题最多 ${TITLE_LIMIT} 字`);
  if ((str(o["agent"])?.trim() ?? "") === "") out.push("缺 agent 的名字");
  const scope = str(o["scope"])?.trim() ?? "";
  if (scope === "") out.push("缺公开范围");
  else if ([...scope].length > SCOPE_LIMIT) out.push(`公开范围最多 ${SCOPE_LIMIT} 字`);
  if ([...(str(o["summary"]) ?? "")].length > SUMMARY_LIMIT) out.push(`一句话最多 ${SUMMARY_LIMIT} 字`);
  const source = o["summarySource"];
  if (source !== undefined && source !== "self" && source !== "drafted") out.push("一句话的来源是 self 或 drafted");
  const turns = o["turns"];
  if (turns !== undefined && !(Number.isInteger(turns) && (turns as number) >= 0)) out.push("轮数要是非负整数");
  for (const k of ["demo", "open"] as const) { const u = str(o[k]); if (o[k] !== undefined && (u === undefined || !URL_RE.test(u))) out.push(`${k} 要是 http(s) 地址`); }
  const replay = o["replay"];
  if (replay !== undefined) {
    if (!Array.isArray(replay)) out.push("回放要是数组");
    else if (replay.length > REPLAY_LIMIT) out.push(`回放最多 ${REPLAY_LIMIT} 个里程碑`);
    else for (const r of replay) {
      const e = obj(r);
      if (e === undefined || !Number.isInteger(e["turn"]) || (e["turn"] as number) < 1 || (str(e["label"])?.trim() ?? "") === "") { out.push("回放的每一项要有轮次（正整数）和标签"); break; }
    }
  }
  if (o["use"] !== undefined && obj(o["use"]) === undefined) out.push("拿去用要是对象");
  return out;
}

/** The record from a body `shareFaults` passed: trimmed, defaults filled, nothing else kept. */
export function shareInput(v: unknown): ShareInput | undefined {
  if (shareFaults(v).length > 0) return undefined;
  const o = obj(v)!;
  const use = obj(o["use"]) ?? {};
  const input: ShareInput = { title: str(o["title"])!.trim(), summary: (str(o["summary"]) ?? "").trim(), summarySource: o["summarySource"] === "drafted" ? "drafted" : "self", agent: str(o["agent"])!.trim(), replay: [], scope: str(o["scope"])!.trim(), evidence: strings(o["evidence"]), use: {} };
  if (o["turns"] !== undefined) input.turns = o["turns"] as number;
  for (const k of ["demo", "open"] as const) { const u = str(o[k]); if (u !== undefined) input[k] = u; }
  for (const r of Array.isArray(o["replay"]) ? o["replay"] : []) {
    const e = obj(r)!;
    const item: Replay = { turn: e["turn"] as number, label: str(e["label"])!.trim() };
    const src = str(e["src"]); if (src !== undefined) item.src = src;
    input.replay.push(item);
  }
  for (const k of ["repo", "commit", "license", "ai"] as const) { const s = str(use[k])?.trim(); if (s !== undefined && s !== "") input.use[k] = s; }
  return input;
}

/** A stored card block read back under the document's id (the block's own `id` is the block's); undefined when it is no share card. */
export function readShare(v: unknown, id: string): ShareCard | undefined {
  const o = obj(v);
  if (o === undefined || o["kind"] !== "share" || o["public"] !== true) return undefined;
  const at = str(o["at"]);
  const input = shareInput(o);
  return at === undefined || input === undefined ? undefined : { kind: "share", id, public: true, at, ...input };
}

/** 「John 的作品 · xiaoping 做的 · 63 轮 · 2026-10-30 · 有凭据」 */
export function byline(c: ShareCard, owner: string): string {
  return [`${owner} 的作品`, `${c.agent} 做的`, ...(c.turns !== undefined ? [`${c.turns} 轮`] : []), c.at.slice(0, 10), ...(c.evidence.length > 0 ? ["有凭据"] : [])].join(" · ");
}
/** The tag under the one line (rule 6): the agent drafted it and the owner edited it; nothing when the owner typed it. */
export const summaryTag = (c: ShareCard, owner: string): string | undefined => (c.summarySource === "drafted" ? `${c.agent} 起草 · ${owner} 改过` : undefined);
/** The public range as the card states it, with what the agent does about the rest. */
export const rangeWords = (c: ShareCard): string => `${c.scope} · 其余不在此，${c.agent} 不会讲`;
/** 拿去用 in one line: the repository at its commit, the license, the AI statement; nothing when the card says none of it. */
export function useLine(c: ShareCard): string | undefined {
  const parts = [...(c.use.repo !== undefined ? [`仓库 ${c.use.repo}${c.use.commit !== undefined ? ` @ ${c.use.commit}` : ""}`] : []), ...(c.use.license !== undefined ? [`许可：${c.use.license}`] : []), ...(c.use.ai !== undefined ? [c.use.ai] : [])];
  return parts.length === 0 ? undefined : parts.join(" · ");
}
/** The right column's header: 「你是访客，不用注册 · 今天还能问 3 句 · 这几句的 token John 请客」 */
export const guestHeader = (left: number, owner: string): string => `你是访客，不用注册 · 今天还能问 ${left} 句 · 这几句的 token ${owner} 请客`;
/** The badge under the agent's answer on the page: 「xiaoping · 代 John · 只讲公开范围内的」 */
export const agentBadge = (agent: string, owner: string): string => `${agent} · 代 ${owner} · 只讲公开范围内的`;
/** The line the daemon writes under a guest's envelope (§11): the public range, and what to do outside it. */
export const scopeLine = (scope: string): string => `[公开范围：${scope}；不在范围内的明说不讲，请访客给主人留言]`;

/** The owner's guest quota (§9.1): questions a day across all guests, a guest's a day, a network address's a day. */
export interface GuestQuota { perDay: number; perGuestPerDay: number; perIpPerDay: number }
export const DEFAULT_GUEST_QUOTA: GuestQuota = { perDay: 50, perGuestPerDay: 3, perIpPerDay: 20 };
/** A quota from a body or a block: each a positive integer, else the default. */
export function quotaOf(v: unknown): GuestQuota {
  const o = obj(v) ?? {};
  const n = (k: keyof GuestQuota): number => { const x = o[k]; return Number.isInteger(x) && (x as number) > 0 ? (x as number) : DEFAULT_GUEST_QUOTA[k]; };
  return { perDay: n("perDay"), perGuestPerDay: n("perGuestPerDay"), perIpPerDay: n("perIpPerDay") };
}
/** Why a question is refused when a quota is used up. */
export const QUOTA_WORDS = { owner: "作者今天的访客额度用完了，明天再来", guest: "你今天的几句问完了，明天再来", ip: "这个网络今天问得太多了，明天再来" } as const;
/** Whether two instants fall on the same UTC day. */
export const sameDay = (a: string, b: string): boolean => a.slice(0, 10) === b.slice(0, 10);
