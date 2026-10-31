// The envelope (§6.5, transport §3): the one line the host writes above a
// prompt it delivers, so what the model knows about the sender's identity,
// its permissions and where the reply goes comes from the host, never from
// the text. The same function serves the relay, the daemon and every host.
// Pure.
import { LEVEL_WORDS, scopeWords, type Level, type ToolScope } from "./sender.js";
import { VENUE_WORDS, type VenueKind } from "./venue.js";

export interface EnvelopeInput {
  venueKind: VenueKind;
  venueName: string;
  senderName: string;
  level: Level;
  scope: ToolScope;
  /** How many items wait behind this one. */
  queued: number;
  /** The venue or the agent has 「回群前先给我看」 on (§6.5). */
  draftFirst?: boolean;
}

/** The venue as the envelope names it: a group, thread or channel by name; a DM or guest DM by kind alone. */
export function venueLabel(kind: VenueKind, name: string): string {
  return kind === "dm" || kind === "guest-dm" ? VENUE_WORDS[kind] : `${VENUE_WORDS[kind]}「${name}」`;
}

/** Where the final answer goes (§6.5), and whether the owner sees it first. */
export function replyWords(kind: VenueKind, draftFirst: boolean): string {
  switch (kind) {
    case "group": return draftFirst ? "回复先给主人过目，再发回该群" : "回复将发回该群，成员可见";
    case "thread": return draftFirst ? "回复先给主人过目，再发回该线程" : "回复将发回该线程，成员可见";
    case "guest-dm": return draftFirst ? "回复先给主人过目，再发给访客" : "回复将发给访客";
    case "dm": return "回复在私信里";
    case "channel": return "回复不会发出";
    case "room": return draftFirst ? "回复先给主人过目，再发回该房间" : "回复将发回该房间，成员可见";
  }
}

export function envelopeLine(e: EnvelopeInput): string {
  const parts = [
    `来自 ${venueLabel(e.venueKind, e.venueName)}`,
    `${e.senderName}（${LEVEL_WORDS[e.level]}）`,
    `权限：${scopeWords(e.scope)}`,
    replyWords(e.venueKind, e.draftFirst === true),
    `队列中还有 ${e.queued} 条`,
  ];
  return `[${parts.join(" · ")}]`;
}

/** The prompt as the model sees it: the envelope, a line break, the text. */
export const withEnvelope = (line: string, text: string): string => `${line}\n${text}`;
