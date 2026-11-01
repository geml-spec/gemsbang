// Who speaks in gemsbang (spec §4, §5 rule 1): an avatar is the account
// everyone sees; a person is the one behind it, seen by nobody but themself
// and the relay; the host says the system's lines. A message records which
// avatar said it and `by`, whether the person typed it or an agent sent it;
// whether others see `by` is the avatar's rule (rules.ts). Pure.

export const AVATAR_ID = /^a-[0-9a-f]{10}$/;
export const PERSON_ID = /^p-[0-9a-f]{10}$/;
/** A group (`g-`) or a two-person talk (`d-`). */
export const VENUE_ID = /^[gd]-[0-9a-f]{10}$/;

export type Who = { kind: "avatar"; id: string } | { kind: "person"; id: string } | { kind: "host" };
export type By = "person" | "agent";

export function parseWho(text: string): Who | undefined {
  if (text === "host") return { kind: "host" };
  const m = /^(avatar|person):(.+)$/.exec(text);
  if (m === null) return undefined;
  const id = m[2]!;
  if (m[1] === "avatar") return AVATAR_ID.test(id) ? { kind: "avatar", id } : undefined;
  return PERSON_ID.test(id) ? { kind: "person", id } : undefined;
}

export const formatWho = (w: Who): string => (w.kind === "host" ? "host" : `${w.kind}:${w.id}`);
export const avatarSpeaker = (id: string): string => `avatar:${id}`;
