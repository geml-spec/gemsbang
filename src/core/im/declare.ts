// The declaration of 接单 on an agent's page (§9.2): whether the owner
// opened 接单模式, the hours (a wall-clock span in a zone, over midnight if
// it must), the day's token budget, what it takes; and the eligibility the
// host reports — an API or self-hosted session may claim, a subscription one
// never, a hosted agent always. Pure: the record, the rule, the words.

export interface Hours { from: string; to: string; tz: string }
export interface Declaration { open: boolean; hours?: Hours; budget?: number; kinds: string[]; skills: string[]; network: boolean }
export const DEFAULT_DECLARATION: Declaration = { open: false, kinds: [], skills: [], network: false };

const obj = (v: unknown): Record<string, unknown> | undefined => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);
const strings = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()) : undefined);
const HOURS = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})(Z|[+-]\d{2}:\d{2})$/;
const pad = (n: string): string => n.padStart(2, "0");

/** 'HH:MM-HH:MM' followed by a zone (`Z` or `±HH:MM`); undefined for anything else. */
export function hoursOf(v: unknown): Hours | undefined {
  const m = typeof v === "string" ? HOURS.exec(v.trim()) : null;
  if (m === null) return undefined;
  const [, fh, fm, th, tm, tz] = m;
  if (Number(fh) > 23 || Number(th) > 23 || Number(fm) > 59 || Number(tm) > 59) return undefined;
  return { from: `${pad(fh!)}:${fm}`, to: `${pad(th!)}:${tm}`, tz: tz! };
}

/** A declaration from a body, each field given replacing the current's, a bad one falling to the default; `hours: null` clears the hours. */
export function declarationOf(v: unknown, current: Declaration = DEFAULT_DECLARATION): Declaration {
  const o = obj(v) ?? {};
  const out: Declaration = { ...current, kinds: [...current.kinds], skills: [...current.skills] };
  if (typeof o["open"] === "boolean") out.open = o["open"];
  if (o["hours"] === null) delete out.hours;
  else if (o["hours"] !== undefined) { const h = hoursOf(o["hours"]); if (h !== undefined) out.hours = h; else delete out.hours; }
  if (o["budget"] === null) delete out.budget;
  else if (o["budget"] !== undefined) { const b = o["budget"]; if (typeof b === "number" && Number.isInteger(b) && b >= 0) out.budget = b; else delete out.budget; }
  const kinds = strings(o["kinds"]); if (o["kinds"] !== undefined) out.kinds = kinds ?? [];
  const skills = strings(o["skills"]); if (o["skills"] !== undefined) out.skills = skills ?? [];
  if (typeof o["network"] === "boolean") out.network = o["network"];
  return out;
}

const minutesOf = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const offsetOf = (tz: string): number => (tz === "Z" ? 0 : (tz.startsWith("-") ? -1 : 1) * (Number(tz.slice(1, 3)) * 60 + Number(tz.slice(4, 6))));

/** Whether the instant falls in the hours by the zone's wall clock; the start counts, the end does not; a span over midnight wraps. No hours: always. */
export function withinHours(now: string, hours: Hours | undefined): boolean {
  if (hours === undefined) return true;
  const t = Date.parse(now);
  if (Number.isNaN(t)) return false;
  const wall = (((t / 60_000 + offsetOf(hours.tz)) % 1440) + 1440) % 1440;
  const from = minutesOf(hours.from), to = minutesOf(hours.to);
  return from <= to ? wall >= from && wall < to : wall >= from || wall < to;
}

export const hoursWords = (h: Hours | undefined): string => (h === undefined ? "随时" : `每天 ${h.from} 到 ${h.to}`);
/** The hours as a body writes them, for a record that `declarationOf` reads back. */
export const hoursString = (h: Hours): string => `${h.from}-${h.to}${h.tz}`;

/** What the host's sessions say (§9.2): a hosted agent is always eligible; else the best login among its sessions. */
export function eligibilityWords(logins: readonly string[], hosted: boolean): string {
  if (hosted) return "托管 · 天然有资格";
  if (logins.includes("api")) return "API 会话 · 有资格";
  if (logins.includes("self-hosted")) return "自托管会话 · 有资格";
  if (logins.length > 0) return "只有订阅登录的会话 · 不显示接单入口";
  return "还没有会话";
}

/** The four lines on the agent's page (§9.2), and a fifth when 接单模式 is off. */
export function declarationLines(d: Declaration, eligibility: string): string[] {
  const what = [...(d.kinds.length > 0 ? [d.kinds.join("、")] : []), ...(d.skills.length > 0 ? [`skill ${d.skills.join("、")}`] : [])];
  return [
    `资格：${eligibility}`,
    `时段：${hoursWords(d.hours)}${d.hours !== undefined ? " · 主人睡了之后" : ""}`,
    `预算：${d.budget === undefined ? "不限" : `每天 ${d.budget} token · 推理走平台池`}`,
    `接什么：${what.length > 0 ? what.join(" · ") : "没说"} · ${d.network ? "可联网" : "不联网"}`,
    ...(d.open ? [] : ["接单模式：关"]),
  ];
}

/** What a card published to a named agent waits for (§9.2): the owner's 接单模式, or an eligible session in the hours. */
export const waitingForSession = (d: Declaration): string => (d.open ? `等它有资格的会话${d.hours === undefined ? "" : ` · ${hoursWords(d.hours)}`}` : "等主人开接单模式");
