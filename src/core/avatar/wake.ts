// When an avatar is called (spec §7.7, §5 rule 7; run on the person's client,
// architecture §6.3): an @ of its name always
// wakes it; a two-person chat is always to it; else a few rules that cost no
// model call — its name said, a reply to something it said, a line from the
// group's owner, a question put to the people present — and everything else
// waits in a batch read once twenty lines or thirty minutes have gathered,
// read and not answered unless it finds something that needs its person.
// Its own lines never wake it, and avatars calling avatars stop at three
// hops: past them the line is an ordinary one, and the chat is told once.
// Pure.

export type WakeReason = "dm" | "mention" | "name" | "reply" | "owner" | "question";
export const BATCH_LINES = 20;
export const BATCH_MS = 30 * 60_000;
export const MAX_HOPS = 3;

export interface Line { id: string; speaker: string; text: string; by?: string; replyTo?: string; hops?: number }
export interface Seat { avatar: string; name: string; kind: "group" | "dm"; owner: string; said: ReadonlySet<string> }

const avatarOf = (speaker: string): string => speaker.replace(/^avatar:/, "");
const QUESTION = /[?？]\s*$/;
const TO_ALL = /大家|各位|谁|有人|有没有|能不能|哪位|anyone|anybody|everyone|who\b|you all|can someone|皆さん|誰|どなた/i;

/** Why this line wakes the seated avatar, or undefined when it waits for the batch (or for nothing: its own, or past the hops). */
export function wakeReason(line: Line, seat: Seat): WakeReason | undefined {
  if (avatarOf(line.speaker) === seat.avatar) return undefined;
  if (line.by === "agent" && (line.hops ?? 0) >= MAX_HOPS) return undefined;
  if (seat.kind === "dm") return "dm";
  const name = seat.name.trim();
  if (name !== "" && line.text.includes(`@${name}`)) return "mention";
  if (line.replyTo !== undefined && seat.said.has(line.replyTo)) return "reply";
  if (name.length >= 2 && line.text.includes(name)) return "name";
  if (avatarOf(line.speaker) === seat.owner) return "owner";
  if (QUESTION.test(line.text) && TO_ALL.test(line.text)) return "question";
  return undefined;
}

/** Whether the hops alone kept this line from waking the avatar (the chat is then told, §5 rule 7). */
export const stoppedByHops = (line: Line, seat: Seat): boolean => line.by === "agent" && (line.hops ?? 0) >= MAX_HOPS && wakeReason({ ...line, hops: 0 }, seat) !== undefined;

/** Whether a batch is due: twenty lines, or the oldest thirty minutes old. */
export function batchDue(count: number, oldest: string | undefined, now: string): boolean {
  if (count >= BATCH_LINES) return true;
  return oldest !== undefined && count > 0 && Date.parse(now) - Date.parse(oldest) >= BATCH_MS;
}

/** The hops a reply carries: one more than an agent's line it answers, none after a person's. */
export const hopsAfter = (answered: Line | undefined): number => (answered !== undefined && answered.by === "agent" ? (answered.hops ?? 0) + 1 : 0);
