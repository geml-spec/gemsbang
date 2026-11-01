// The push outlet (spec §7.3, transport §7.2): a 需要你 card goes out to every
// channel its person turned on, and an answer comes back from any of them as
// if pressed in the pane. A channel is an adapter that does two things —
// deliver a card, collect the answers — so web push, a text, Telegram or a
// WeChat service account each come later as one more. v1 has the file
// adapter: a card is a block in `_relay/push/out.geml`, and an answer is a
// block someone (a test, a bridge) appends to `_relay/push/in.geml`, read
// once.
import type { Need } from "../core/avatar/needs.js";
import type { Lang } from "../core/avatar/words.js";
import { appendBlock, nextId, readDoc, RELAY_OWNER, sealed } from "./store.js";

/** A card as it goes out: whose, which avatar and chat, in the person's language. */
export interface PushCard { person: string; avatar: string; avatarName: string; group?: string; lang: Lang; need: Need }
/** An answer as it comes back: whose card, and what they chose. */
export interface PushAnswer { person: string; avatar: string; need: string; choice: number | "own"; text?: string }
export interface PushAdapter {
  readonly id: string;
  deliver(card: PushCard): void | Promise<void>;
  /** The answers come in since the last collect, each once. */
  collect(): PushAnswer[] | Promise<PushAnswer[]>;
}

const OUT = "push/out.geml", IN = "push/in.geml";

/** The test channel: cards into a document, answers out of another. */
export function fileAdapter(root: string): PushAdapter {
  return {
    id: "file",
    deliver(card) {
      appendBlock(root, RELAY_OWNER, OUT, nextId("card"), (_d, prev, id) => sealed({ id, person: card.person, avatar: card.avatar, avatarName: card.avatarName, ...(card.group !== undefined ? { group: card.group } : {}), lang: card.lang, need: card.need as unknown as Record<string, never> }, prev));
    },
    collect() {
      const d = readDoc(root, RELAY_OWNER, IN);
      const taken = new Set(d.blocks.filter((b) => /^taken-\d+$/.test(b.id)).map((b) => b.value["answer"]));
      const out: PushAnswer[] = [];
      for (const b of d.blocks) {
        if (!/^answer-\d+$/.test(b.id) || taken.has(b.id)) continue;
        const v = b.value;
        const choice = v["choice"] === "own" ? "own" : typeof v["choice"] === "number" ? v["choice"] : undefined;
        if (typeof v["person"] === "string" && typeof v["avatar"] === "string" && typeof v["need"] === "string" && choice !== undefined) out.push({ person: v["person"], avatar: v["avatar"], need: v["need"], choice, ...(typeof v["text"] === "string" ? { text: v["text"] } : {}) });
        appendBlock(root, RELAY_OWNER, IN, nextId("taken"), (_d, prev, id) => sealed({ id, answer: b.id }, prev));
      }
      return out;
    },
  };
}

/** An answer as a phone would send it through the file channel (tests, and a bridge that has no relay API of its own). */
export function answerByFile(root: string, a: PushAnswer): void {
  appendBlock(root, RELAY_OWNER, IN, nextId("answer"), (_d, prev, id) => sealed({ id, person: a.person, avatar: a.avatar, need: a.need, choice: a.choice, ...(a.text !== undefined ? { text: a.text } : {}) }, prev));
}

/** The cards the file channel has sent, oldest first. */
export const cardsByFile = (root: string): Record<string, unknown>[] => readDoc(root, RELAY_OWNER, OUT).blocks.filter((b) => /^card-\d+$/.test(b.id)).map((b) => b.value);
