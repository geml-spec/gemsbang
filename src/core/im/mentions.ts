// The two meanings of `@` (§6.4): `@名字` as the first word calls the agent —
// it gets a prompt; a run of names at the start is a broadcast, each called
// once. `@名字` in the middle of a sentence only mentions: no delivery, a
// 「被提到」 on the agent's board. `@` a person, and `@所有人`, only ever
// notify. A role address (`@空闲的`, `@审稿人`, `@#42的负责人`) resolves to one
// agent by the venue's policy, and the resolution is written back on the
// message. Pure: the roster and the resolver come from the caller.

export type RosterKind = "person" | "agent" | "role" | "everyone";
export interface RosterEntry { name: string; kind: RosterKind }

/** One `@` on a message as it is stored: the name, whether it called (first word) or only mentioned, and the agent a role resolved to. */
export interface Mention { name: string; call: boolean; resolved?: string }

export interface Mentions {
  /** Agents and roles at the start of the text, in order, each once. */
  calls: string[];
  /** Agents and roles anywhere else. */
  mentions: string[];
  /** People and 所有人, wherever they stand. */
  notified: string[];
  /** Names the roster does not have. */
  unknown: string[];
}

// A name runs to whitespace, another `@`, or punctuation; `@` counts only at the start or after whitespace or punctuation (not inside an e-mail address).
const NAME_CHAR = "[^\\s@,，。！？!?:：;；()（）]";
const TOKEN = new RegExp(`(?<![\\p{L}\\p{N}_.-])@(${NAME_CHAR}+)`, "gu");
const LEAD = new RegExp(`^(?:\\s*@${NAME_CHAR}+[\\s,，]*)+`, "u");

export function parseMentions(text: string, roster: readonly RosterEntry[]): Mentions {
  const kinds = new Map(roster.map((r) => [r.name, r.kind] as const));
  const lead = LEAD.exec(text)?.[0].length ?? 0;
  const out: Mentions = { calls: [], mentions: [], notified: [], unknown: [] };
  const once = (list: string[], name: string) => { if (!list.includes(name)) list.push(name); };
  for (const m of text.matchAll(TOKEN)) {
    const name = m[1]!, kind = kinds.get(name), atStart = (m.index ?? 0) < lead;
    if (name === "所有人" || kind === "everyone" || kind === "person") once(out.notified, name);
    else if (kind === "agent" || kind === "role") once(atStart ? out.calls : out.mentions, name);
    else once(out.unknown, name);
  }
  return out;
}

/** The agent a role address names right now, or undefined when nobody fits. */
export type RoleResolver = (role: string) => string | undefined;

/** The calls as mentions on the message: a role becomes the agent it resolved to (`resolved`); a role nobody fits is reported, not called. */
export function resolveCalls(calls: readonly string[], roster: readonly RosterEntry[], resolve: RoleResolver): { calls: Mention[]; unresolved: string[] } {
  const kinds = new Map(roster.map((r) => [r.name, r.kind] as const));
  const out: Mention[] = [], unresolved: string[] = [];
  for (const name of calls) {
    if (kinds.get(name) !== "role") { out.push({ name, call: true }); continue; }
    const to = resolve(name);
    if (to === undefined) unresolved.push(name);
    else out.push({ name, call: true, resolved: to });
  }
  return { calls: out, unresolved };
}

export const CALL_HINT = "在句首 = 叫它干活";
export const NOTIFY_HINT = "只是通知";

export interface Candidate { name: string; kind: RosterKind; presence?: string; hint: string }

/** The popover while typing `@` (§6.4): the roster entries whose name starts with the prefix, agents with their presence, roles with how they resolve. */
export function mentionCandidates(roster: readonly RosterEntry[], prefix: string, presenceOf: (name: string) => string | undefined, roleHint: (role: string) => string): Candidate[] {
  const out: Candidate[] = [];
  for (const r of roster) {
    if (!r.name.startsWith(prefix)) continue;
    const c: Candidate = { name: r.name, kind: r.kind, hint: r.kind === "agent" ? CALL_HINT : r.kind === "role" ? roleHint(r.name) : NOTIFY_HINT };
    const p = r.kind === "agent" ? presenceOf(r.name) : undefined;
    if (p !== undefined) c.presence = p;
    out.push(c);
  }
  return out;
}
