// Who speaks (§4, rule 1, rule 6): a person, an agent account (always shown
// with its owner's badge), a guest, or the host itself (system messages).
// The host stamps the speaker; this module only spells it. A message's
// source is which of the four ways it came to be (rule 6): typed by the
// person, drafted by the agent and sent by the person, said by the agent
// within its scope, or the agent quoting its owner. Pure.

export type Speaker =
  | { kind: "person"; id: string }
  | { kind: "agent"; name: string; owner: string }
  | { kind: "guest"; id: string }
  | { kind: "host" };

/** Rule 6's four sources: 本人亲打, agent 起草本人发出, agent 在权限内自己说的, agent 转述主人的话. */
export type Source = "self" | "drafted" | "agent" | "quoted";

/** An id or a name as the relay spells it: letters, digits, `_`, `-`. */
export const NAME = /^[\p{L}\p{N}_-]+$/u;

export function parseSpeaker(text: string): Speaker | undefined {
  if (text === "host") return { kind: "host" };
  const m = /^(person|agent|guest):(.+)$/s.exec(text);
  if (!m) return undefined;
  const rest = m[2]!;
  if (m[1] === "agent") {
    const at = rest.indexOf("@");
    if (at <= 0 || at === rest.length - 1) return undefined;
    const name = rest.slice(0, at), owner = rest.slice(at + 1);
    if (!NAME.test(name) || !NAME.test(owner)) return undefined;
    return { kind: "agent", name, owner };
  }
  if (!NAME.test(rest)) return undefined;
  return m[1] === "person" ? { kind: "person", id: rest } : { kind: "guest", id: rest };
}

export function formatSpeaker(s: Speaker): string {
  switch (s.kind) {
    case "person": return `person:${s.id}`;
    case "agent": return `agent:${s.name}@${s.owner}`;
    case "guest": return `guest:${s.id}`;
    case "host": return "host";
  }
}

/** The person responsible: a person is themself, an agent is its owner; a guest and the host are nobody's. */
export function personBehind(s: Speaker): string | undefined {
  return s.kind === "person" ? s.id : s.kind === "agent" ? s.owner : undefined;
}

/** An agent's name as it is always drawn (rule 6): with its owner's badge. */
export const agentLabel = (agentName: string, ownerName: string): string => `${agentName} · 代 ${ownerName}`;

/** The name-line tag of a drafted message (rule 6): the agent that drafted it. */
export const draftedTag = (agentName: string): string => `${agentName}起草`;

/** The tag on an agent's quotation of its owner (rule 6). */
export const QUOTED_TAG = "本人原话";

/** Why a speaker cannot claim a source: a person (or guest) is self or drafted, an agent is agent or quoted; the host's messages have no source to check. */
export function sourceFaults(s: Speaker, source: Source): string[] {
  if (s.kind === "host") return [];
  if (s.kind === "agent") return source === "agent" || source === "quoted" ? [] : ["agent 的消息不能标为本人亲打"];
  return source === "self" || source === "drafted" ? [] : ["本人的消息不能标为 agent 发言"];
}
