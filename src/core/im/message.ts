// A message (§4, §6.3): one block in its venue's document, possibly carrying
// work. Its kind says what was said; delivery (delivery.ts) says how it
// reaches an agent — the two are separate (§6.1). The speaker, the time and
// the chain are the host's stamp (rule 1): whatever a draft claims about them
// is dropped. Attachments, evidence and the 「回到那一轮」 link are embeds,
// never copies (rule 10). Pure: drafts in, sealed messages out, text in and
// out as data blocks.
import type { JsonValue } from "../schema.js";
import { normalizeText, readDataBlocks, renderDataBlock, seal, type DataBlock } from "./chain.js";
import type { Embed } from "./embed.js";
import { formatSpeaker, parseSpeaker, sourceFaults, type Source, type Speaker } from "./identity.js";
import type { Mention } from "./mentions.js";

export type MessageKind = "chat" | "report" | "ask" | "signal" | "card" | "system";
export const KIND_WORDS: Readonly<Record<MessageKind, string>> = { chat: "闲聊", report: "汇报", ask: "询问", signal: "信号", card: "卡片", system: "系统" };

/** The option every ask ends in (§6.3): the person writes their own answer. */
export const WRITE_IN = "自己写";

/** An ask (§6.3): the question, its options (buttons), whom it asks, when it expires, what happens when nobody answers. */
export interface Ask { question: string; options: string[]; who: string; expires?: string; fallback?: string }

/** What a client submits; the host stamps the rest. */
export interface Draft {
  venue: string;
  kind: MessageKind;
  text: string;
  parts?: Embed[];
  /** A report's evidence (§6.3): embeds of facts the host observed, drawn as 「已核实」. */
  evidence?: Embed[];
  mentions?: Mention[];
  source?: Source;
  hops?: number;
  /** A report's opinion, drawn apart from its evidence with the 「意见」 tag. */
  opinion?: string;
  /** 「回到那一轮」: the session turn's local address, resolved only on the owner's machine (rule 4). */
  turn?: string;
  ask?: Ask;
  /** A card message's card (§6.3): the task card's or deliverable's address; the card is the thing, the message a pointer. */
  card?: string;
  /** The thread's anchor, when the message is in one (§6.7). */
  thread?: string;
  replyTo?: string;
}

/** The host's stamp: the block's id, the speaker the token names, the time, the chain, and the agent's session when there is one. */
export interface Stamp { id: string; speaker: Speaker; at: string; prev: string | null; session?: string }

export interface Message {
  id: string;
  venue: string;
  kind: MessageKind;
  text: string;
  speaker: string;
  session?: string;
  at: string;
  mentions: Mention[];
  parts: Embed[];
  evidence: Embed[];
  source: Source;
  hops: number;
  opinion?: string;
  turn?: string;
  ask?: Ask;
  card?: string;
  thread?: string;
  replyTo?: string;
  prev: string | null;
  hash: string;
}

/** Who may send a kind (§6.3): a report, an ask and a signal only an agent; a system message only the host; chat and card anyone but the host. */
export function kindAllowed(kind: MessageKind, speaker: Speaker): boolean {
  switch (kind) {
    case "report": case "ask": case "signal": return speaker.kind === "agent";
    case "system": return speaker.kind === "host";
    case "chat": case "card": return speaker.kind !== "host";
  }
}

/** Why a draft cannot be stamped, or nothing. */
export function draftFaults(d: Draft, speaker: Speaker): string[] {
  const out: string[] = [];
  if (!kindAllowed(d.kind, speaker)) out.push(`${KIND_WORDS[d.kind]}：${formatSpeaker(speaker)} 不能发这种消息`);
  if (d.kind === "ask" && (d.ask === undefined || d.ask.question.trim() === "" || d.ask.who.trim() === "")) out.push("询问：缺问题或问谁");
  if (d.kind === "card" && (d.card === undefined || d.card === "")) out.push("卡片：缺卡的地址");
  if ((d.kind === "chat" || d.kind === "report") && d.text.trim() === "" && !(d.parts !== undefined && d.parts.length > 0)) out.push("正文为空");
  if (d.turn !== undefined && speaker.kind !== "agent") out.push("只有 agent 的消息能链接回那一轮");
  if (d.source !== undefined) out.push(...sourceFaults(speaker, d.source));
  return out;
}

const OPTIONAL = ["opinion", "turn", "card", "thread", "replyTo"] as const;

function askOf(a: Ask): Ask {
  const out: Ask = { question: a.question, options: a.options.includes(WRITE_IN) ? [...a.options] : [...a.options, WRITE_IN], who: a.who };
  if (a.expires !== undefined) out.expires = a.expires;
  if (a.fallback !== undefined) out.fallback = a.fallback;
  return out;
}

/**
 * The message as the host stamps it (rule 1): id, speaker, time, session and
 * chain from the stamp, whatever the draft says; the text normalized (LF, no
 * trailing blanks); the source defaulting to the speaker's kind; an ask's
 * options always ending in 自己写. Only the fields a message has are copied,
 * so a draft cannot smuggle a key in.
 */
export function stamp(d: Draft, s: Stamp): Message {
  const m: Omit<Message, "prev" | "hash"> = {
    id: s.id, venue: d.venue, kind: d.kind, text: normalizeText(d.text),
    speaker: formatSpeaker(s.speaker), at: s.at,
    mentions: d.mentions ?? [], parts: d.parts ?? [], evidence: d.evidence ?? [],
    source: d.source ?? (s.speaker.kind === "agent" ? "agent" : "self"), hops: d.hops ?? 0,
  };
  if (s.session !== undefined) m.session = s.session;
  for (const k of OPTIONAL) { const v = d[k]; if (v !== undefined) m[k] = v; }
  if (d.ask !== undefined) m.ask = askOf(d.ask);
  return seal(m as unknown as Record<string, JsonValue>, s.prev) as unknown as Message;
}

export function renderMessageBlock(m: Message): string {
  return renderDataBlock(m.id, m as unknown as JsonValue);
}

const isObject = (v: unknown): v is Record<string, JsonValue> => typeof v === "object" && v !== null && !Array.isArray(v);
const arrayOf = (v: JsonValue | undefined): JsonValue[] => (Array.isArray(v) ? v : []);

function messageOf(b: DataBlock): Message | string {
  const v = b.value;
  const str = (k: string): string | undefined => (typeof v[k] === "string" ? (v[k] as string) : undefined);
  const kind = str("kind");
  if (kind === undefined || !(kind in KIND_WORDS)) return "kind missing or unknown";
  if (str("id") !== b.id) return "id does not match the block";
  const speaker = str("speaker");
  if (speaker === undefined || parseSpeaker(speaker) === undefined) return "speaker missing or malformed";
  const venue = str("venue"), text = str("text"), at = str("at"), hash = str("hash");
  if (venue === undefined || text === undefined || at === undefined || hash === undefined) return "missing fields";
  const m: Message = {
    id: b.id, venue, kind: kind as MessageKind, text, speaker, at, hash,
    prev: typeof v["prev"] === "string" ? v["prev"] : null,
    mentions: arrayOf(v["mentions"]) as unknown as Mention[], parts: arrayOf(v["parts"]) as unknown as Embed[], evidence: arrayOf(v["evidence"]) as unknown as Embed[],
    source: (str("source") ?? "self") as Source, hops: typeof v["hops"] === "number" ? v["hops"] : 0,
  };
  const session = str("session");
  if (session !== undefined) m.session = session;
  for (const k of OPTIONAL) { const s = str(k); if (s !== undefined) m[k] = s; }
  const ask = v["ask"];
  if (ask !== undefined) {
    if (!isObject(ask) || typeof ask["question"] !== "string" || typeof ask["who"] !== "string" || !Array.isArray(ask["options"])) return "ask malformed";
    m.ask = ask as unknown as Ask;
  }
  return m;
}

/** The document's messages in order; a block that is no message is a diagnostic and skipped. The chain is verified separately (chain.ts). */
export function readMessages(source: string): { messages: Message[]; diagnostics: string[] } {
  const { blocks, diagnostics } = readDataBlocks(source);
  const messages: Message[] = [];
  for (const b of blocks) {
    const m = messageOf(b);
    if (typeof m === "string") diagnostics.push(`#${b.id}: ${m}`);
    else messages.push(m);
  }
  return { messages, diagnostics };
}
