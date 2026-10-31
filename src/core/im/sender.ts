// Who may ask what of an agent (§7): a sender's level toward a target agent
// is the relation between the person behind the sender and the agent's owner
// (§7.1); the level picks a tool scope (§7.2) that only a recorded grant can
// widen (§7.3); an agent-to-agent chain of prompts stops after three hops and
// every venue caps how often agents speak (§7.4). The budgets are per turn,
// in credits (the platform's one unit, §15 item 16); the defaults stand until
// the owner sets theirs — §7.2 says only that a guest's is small. Pure.
import { personBehind, type Speaker } from "./identity.js";

export type Level = "owner" | "trusted" | "member" | "guest";
export const LEVEL_WORDS: Readonly<Record<Level, string>> = { owner: "主人", trusted: "信任", member: "成员", guest: "访客" };
/** Lower first: the queue's priority and the strictest reading of a scope. */
export const LEVEL_RANK: Readonly<Record<Level, number>> = { owner: 0, trusted: 1, member: 2, guest: 3 };

/** What a target agent's owner has said about people: who they are, whom they trust, who shares a venue with the agent. */
export interface Relations { owner: string; trusted: readonly string[]; members: readonly string[] }

/** The sender's level toward the target (§7.1): the person behind an agent is its owner; a guest and the host have nobody behind them. */
export function levelOf(sender: Speaker, r: Relations): Level {
  const p = personBehind(sender);
  if (p === undefined) return "guest";
  if (p === r.owner) return "owner";
  if (r.trusted.includes(p)) return "trusted";
  if (r.members.includes(p)) return "member";
  return "guest";
}

/** Where a run may happen: in the workflow as the owner's own calls do, in a sandbox, or not at all. */
export type Run = "workflow" | "sandbox" | "none";

/** What a level may do (§7.2). Reading and answering are always allowed. `budget` is credits per turn, null for the owner's own cap. */
export interface ToolScope { write: boolean; run: Run; budget: number | null }

/** The default per-turn budgets in credits, until the owner sets theirs. */
export const DEFAULT_BUDGETS: Readonly<Record<Exclude<Level, "owner">, number>> = { trusted: 100, member: 20, guest: 5 };

export const DEFAULT_SCOPES: Readonly<Record<Level, ToolScope>> = {
  owner: { write: true, run: "workflow", budget: null },
  trusted: { write: false, run: "sandbox", budget: DEFAULT_BUDGETS.trusted },
  member: { write: false, run: "none", budget: DEFAULT_BUDGETS.member },
  guest: { write: false, run: "none", budget: DEFAULT_BUDGETS.guest },
};

/** A recorded grant (§7.3): to one person or everyone in one venue, what it widens, since when, until when (none: for good). Every grant is human evidence. */
export interface Grant { to: { person?: string; venue?: string }; widen: Partial<ToolScope>; at: string; until?: string }

const RUN_RANK: Readonly<Record<Run, number>> = { none: 0, sandbox: 1, workflow: 2 };
const widerRun = (a: Run, b: Run): Run => (RUN_RANK[a] >= RUN_RANK[b] ? a : b);
const widerBudget = (a: number | null, b: number | null): number | null => (a === null || b === null ? null : Math.max(a, b));

/** When a grant 「允许此人」 runs out: seven days by default (§7.3), as an ISO time without milliseconds. */
export function grantUntil(at: string, days = 7): string {
  return new Date(Date.parse(at) + days * 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** The level's scope, widened by every grant that names this person or this venue and has not run out; a grant never narrows. */
export function scopeFor(level: Level, o: { person?: string; venue?: string; grants?: readonly Grant[]; budgets?: Partial<Record<Level, number>>; now: string }): ToolScope {
  const base = DEFAULT_SCOPES[level];
  const set = o.budgets?.[level];
  let scope: ToolScope = { ...base, budget: level === "owner" ? null : set ?? base.budget };
  for (const g of o.grants ?? []) {
    const named = (g.to.person !== undefined && g.to.person === o.person) || (g.to.venue !== undefined && g.to.venue === o.venue);
    if (!named || (g.until !== undefined && g.until <= o.now)) continue;
    scope = {
      write: scope.write || g.widen.write === true,
      run: g.widen.run === undefined ? scope.run : widerRun(scope.run, g.widen.run),
      budget: g.widen.budget === undefined ? scope.budget : widerBudget(scope.budget, g.widen.budget),
    };
  }
  return scope;
}

/** What a tool does, as the host classes it: reads, answers (speaks), runs a command, writes a file. */
export type ToolClass = "read" | "answer" | "run" | "write";
export type Decision = "allow" | "sandbox" | "refuse";

/** What the scope says to a call of that class; `sandbox` means the host runs it in the guest room, not the workspace (§7.5). */
export function decide(scope: ToolScope, cls: ToolClass): Decision {
  switch (cls) {
    case "read": case "answer": return "allow";
    case "write": return scope.write ? "allow" : "refuse";
    case "run": return scope.run === "workflow" ? "allow" : scope.run === "sandbox" ? "sandbox" : "refuse";
  }
}

/** The scope as the envelope writes it (§6.5). */
export function scopeWords(scope: ToolScope): string {
  if (scope.write && scope.run === "workflow") return "工作流允许的一切";
  if (scope.run !== "none") return "读、在沙箱里跑";
  return "只读";
}

export const HOP_LIMIT = 3;

/** The hops of a new prompt (§6.5): none when a person raised it; one more than the prompt the raising agent is handling. */
export const hopsOf = (handling: number | undefined): number => (handling === undefined ? 0 : handling + 1);

export const overHops = (hops: number, limit = HOP_LIMIT): boolean => hops > limit;

/** The system message when a prompt degrades to a plain message (§6.5). */
export const hopsSystemText = (agent: string, hops: number, limit: number): string =>
  `给 ${agent} 的指令是第 ${hops} 跳，超过上限 ${limit} 跳，按普通消息投递，没有进它的队列`;

/** A venue's caps on agents' messages per minute (§7.4): all agents together, and each agent. */
export interface Density { venuePerMinute: number; agentPerMinute: number }
export const DEFAULT_DENSITY: Density = { venuePerMinute: 30, agentPerMinute: 6 };

const MINUTE = 60_000;

/** Whether an agent may speak now, given the venue's recent messages. People's messages and anything older than a minute do not count. */
export function densityAllows(recent: readonly { speaker: string; at: string }[], agent: string, now: string, d: Density): { ok: true } | { ok: false; reason: string } {
  const t = Date.parse(now);
  const window = recent.filter((m) => m.speaker.startsWith("agent:") && t - Date.parse(m.at) >= 0 && t - Date.parse(m.at) < MINUTE);
  if (window.length >= d.venuePerMinute) return { ok: false, reason: `这个场所每分钟最多 ${d.venuePerMinute} 条 agent 消息，已满` };
  const own = window.filter((m) => m.speaker === agent).length;
  if (own >= d.agentPerMinute) return { ok: false, reason: `${agent.slice("agent:".length).replace(/@.*$/, "")} 每分钟最多 ${d.agentPerMinute} 条，已满` };
  return { ok: true };
}
