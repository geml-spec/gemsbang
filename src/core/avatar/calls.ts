// 被叫到 (architecture §6.3): who called an avatar in a chat, and what is done
// about it. The wake rules (wake.ts) run on the person's client now, over the
// chats it mirrors: a line calls the avatar when it would have woken it —
// an @, a two-person chat, its name, a reply to it, the group's owner, a
// question to the people present. The lines that call it are those after its
// own last line and after the last one its person let go (不回); none, and
// there is nothing to ask. One chat has one call, however many lines: a new
// one joins it. By default the person is asked — 回, 以后这个群自动回, 不回 —
// and a chat they set to answer on its own is answered by a round at once.
// A round is the avatar's agent reading the chat's last lines and answering
// the last line that called it, its hops one more than that line's. Pure.
import { venueKey, type Mirror, type MirrorVenue } from "./inbox.js";
import type { RoundInput } from "./round.js";
import { hopsAfter, wakeReason, type Line, type WakeReason } from "./wake.js";

/** One line that called the avatar: who said what, and why it counts. */
export interface CallLine { id: string; who: string; text: string; reason: WakeReason; at: string }
/** A chat's call on one avatar: its lines, the last of them, whether the chat answers on its own. */
export interface Call { avatar: string; owner: string; id: string; kind: "group" | "dm"; group: string; lines: CallLine[]; last: string; at: string; auto: boolean }
/** What a round needs besides its prompt: where its answer goes, replying to which line, with how many hops. */
export interface Round { avatar: string; owner: string; id: string; group: string; input: RoundInput; replyTo: string; hops: number }

/** How many of the chat's last lines a round reads. */
export const ROUND_LINES = 20;

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const avatarOf = (speaker: string): string => speaker.replace(/^avatar:/, "");

/** The chat's lines, oldest first, as the wake rules read them, with when each was said. */
function linesOf(v: MirrorVenue): (Line & { at: string })[] {
  const out: (Line & { at: string })[] = [];
  for (const b of v.blocks) {
    const text = str(b.value["text"]), speaker = str(b.value["speaker"]);
    if (text === undefined || speaker === undefined) continue;
    const by = str(b.value["by"]), replyTo = str(b.value["replyTo"]), hops = b.value["hops"];
    out.push({ id: b.id, speaker, text, at: str(b.value["at"]) ?? "", ...(by !== undefined ? { by } : {}), ...(replyTo !== undefined ? { replyTo } : {}), ...(typeof hops === "number" ? { hops } : {}) });
  }
  return out;
}

/** The key a chat's let-go line is kept under, per avatar. */
export const callKey = (avatar: string, owner: string, id: string): string => `${avatar}|${venueKey(owner, id)}`;

/** The avatar's call in a chat: the lines that called it after its own last line and after `since`; undefined when none did. */
export function callOf(v: MirrorVenue, o: { name: string; since?: string; auto: boolean }): Call | undefined {
  const lines = linesOf(v);
  const mine = lines.filter((l) => avatarOf(l.speaker) === v.as);
  let from = 0;
  for (let i = 0; i < lines.length; i++) if (avatarOf(lines[i]!.speaker) === v.as || lines[i]!.id === o.since) from = i + 1;
  const seat = { avatar: v.as, name: o.name, kind: v.kind, owner: v.keeper ?? v.owner, said: new Set(mine.map((l) => l.id)) };
  const name = (a: string): string => v.members.find((m) => m.id === a)?.name ?? a;
  const called: CallLine[] = [];
  for (const l of lines.slice(from)) {
    const reason = wakeReason(l, seat);
    if (reason !== undefined) called.push({ id: l.id, who: name(avatarOf(l.speaker)), text: l.text, reason, at: l.at });
  }
  const last = called[called.length - 1];
  return last === undefined ? undefined : { avatar: v.as, owner: v.owner, id: v.id, kind: v.kind, group: v.name, lines: called, last: last.id, at: last.at, auto: o.auto };
}

/** Every chat's call on the person's avatars, newest first: `dismissed` holds the last line let go per avatar and chat, `autos` the chats each avatar answers on its own. */
export function callsOf(m: Mirror, o: { dismissed: Readonly<Record<string, string>>; autos: Readonly<Record<string, readonly string[]>> }): Call[] {
  const out: Call[] = [];
  for (const v of m.venues) {
    const name = m.avatars.find((a) => a.id === v.as)?.name;
    if (name === undefined) continue;
    const since = o.dismissed[callKey(v.as, v.owner, v.id)];
    const c = callOf(v, { name, auto: (o.autos[v.as] ?? []).includes(venueKey(v.owner, v.id)), ...(since !== undefined ? { since } : {}) });
    if (c !== undefined) out.push(c);
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

/** The round that answers a call: the chat's last lines with the avatar's own marked, why it woke, replying to the last line that called it. */
export function roundFor(v: MirrorVenue, call: Call, o: { name: string; why: "asked" | "auto"; mark: boolean; base?: readonly { label: string; text: string }[] }): Round {
  const lines = linesOf(v);
  const name = (a: string): string => v.members.find((m) => m.id === a)?.name ?? a;
  const answered = lines.find((l) => l.id === call.last);
  const reason = call.lines[call.lines.length - 1]!.reason;
  return {
    avatar: call.avatar, owner: call.owner, id: call.id, group: call.group, replyTo: call.last, hops: hopsAfter(answered),
    input: { avatar: o.name, group: call.group, kind: "reply", reason, why: o.why, mark: o.mark, lines: lines.slice(-ROUND_LINES).map((l) => ({ who: name(avatarOf(l.speaker)), text: l.text, mine: avatarOf(l.speaker) === v.as })), ...(o.base !== undefined && o.base.length > 0 ? { base: o.base } : {}) },
  };
}
