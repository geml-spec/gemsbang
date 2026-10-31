// How a stamped message reaches agents (§6.1: the kind says what was said,
// delivery says who gets a prompt). In a DM or a guest DM every message from
// the other party is a prompt, no `@` needed. In a group or a thread only a
// leading `@` is (§6.4); a reply in a thread is not a call. A person's `@` is
// always a prompt; an agent's only when the target's policy takes it, with
// one hop more than the prompt the agent is handling, and past the limit it
// degrades to a plain message with a system message saying so (rule 2,
// §6.5, §7.4). Pure: the queue items the caller then appends come out as
// drafts' essentials; the caller adds the venue words and the context pack.
import { parseSpeaker, personBehind, type Speaker } from "./identity.js";
import type { Message } from "./message.js";
import { parseMentions, resolveCalls, type RoleResolver, type RosterEntry } from "./mentions.js";
import { hopsOf, hopsSystemText, levelOf, overHops, type Level, type Relations } from "./sender.js";
import type { PromptFrom, Venue } from "./venue.js";

/** An agent present in the venue: its shown name, its speaker string, its owner's relations, and its own policy on whose `@` it takes (the venue's when none). */
export interface AgentInVenue { name: string; speaker: string; relations: Relations; policy?: { promptFrom: PromptFrom; allow: string[] } }

export interface DeliveryInput {
  venue: Venue;
  agents: AgentInVenue[];
  roster: RosterEntry[];
  resolve?: RoleResolver;
  /** When an agent speaks while handling a prompt: that prompt's hops. */
  handling?: number;
}

export interface PromptTo {
  agent: string;
  level: Level;
  hops: number;
  /** The role the call came through, when it did. */
  via?: string;
}

export interface Delivery {
  prompts: PromptTo[];
  /** Agents mentioned mid-sentence: a 「被提到」 on their board, no delivery. */
  mentioned: string[];
  /** People and 所有人 to notify. */
  notified: string[];
  /** Agents called but not prompted, and why. */
  degraded: { agent: string; reason: string }[];
  /** Roles nobody fits right now. */
  unresolved: string[];
  /** System messages the venue gets. */
  system: string[];
}

const NOTHING = (): Delivery => ({ prompts: [], mentioned: [], notified: [], degraded: [], unresolved: [], system: [] });

/** Whether the target takes an agent's `@` as a prompt (rule 2): its own policy, else the venue's; an allowlist names speakers, and naming a person names their agents. */
function takesAgentPrompt(speaker: Speaker & { kind: "agent" }, target: AgentInVenue, venue: Venue): boolean {
  const policy = target.policy ?? venue.policy;
  if (policy.promptFrom === "anyone") return true;
  if (policy.promptFrom === "nobody") return false;
  return policy.allow.includes(`agent:${speaker.name}@${speaker.owner}`) || policy.allow.includes(`person:${speaker.owner}`);
}

export function deliver(m: Message, d: DeliveryInput): Delivery {
  const out = NOTHING();
  const speaker = parseSpeaker(m.speaker);
  if (speaker === undefined || speaker.kind === "host" || m.kind === "system" || m.kind === "signal" || d.venue.kind === "channel") return out;
  const hops = speaker.kind === "agent" ? hopsOf(d.handling ?? 0) : 0;

  if (d.venue.kind === "dm" || d.venue.kind === "guest-dm") {
    const hostName = d.venue.host ?? d.venue.agents[0];
    const target = d.agents.find((a) => a.name === hostName);
    if (target === undefined || target.speaker === m.speaker) return out;
    // The owner cutting into a guest DM speaks to the guest, not to the agent (§6.2); in their own DM every word is a prompt.
    if (d.venue.kind === "guest-dm" && personBehind(speaker) === target.relations.owner) return out;
    out.prompts.push({ agent: target.name, level: levelOf(speaker, target.relations), hops });
    return out;
  }

  const parsed = parseMentions(m.text, d.roster);
  out.mentioned = parsed.mentions;
  out.notified = parsed.notified;
  const { calls, unresolved } = resolveCalls(parsed.calls, d.roster, d.resolve ?? (() => undefined));
  out.unresolved = unresolved;
  for (const call of calls) {
    const name = call.resolved ?? call.name;
    const target = d.agents.find((a) => a.name === name);
    if (target === undefined) { out.degraded.push({ agent: name, reason: "不在这个场所" }); continue; }
    if (target.speaker === m.speaker) continue;
    if (speaker.kind === "agent") {
      if (!takesAgentPrompt(speaker, target, d.venue)) { out.degraded.push({ agent: name, reason: "对方策略不收 agent 的指令，只当消息读到" }); continue; }
      const limit = d.venue.policy.hopLimit;
      if (overHops(hops, limit)) {
        out.degraded.push({ agent: name, reason: `超过 ${limit} 跳` });
        out.system.push(hopsSystemText(name, hops, limit));
        continue;
      }
    }
    const prompt: PromptTo = { agent: name, level: levelOf(speaker, target.relations), hops };
    if (call.resolved !== undefined) prompt.via = call.name;
    out.prompts.push(prompt);
  }
  return out;
}
