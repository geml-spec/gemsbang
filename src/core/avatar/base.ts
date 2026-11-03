// 底子 (S27, design §8.2): what the person keeps about themself — 家人, 时区,
// 偏好 — once, each entry given to some of their avatars. Kept with the person
// (`people/<id>.geml`, the person's and the service's alone) as blocks: an
// entry made (`base-N`: what it is, its words, which avatars it is given to,
// kept or, when an agent wrote it, waiting for the person's yes) and each
// change to one after (`baseset-N`: new words, other avatars, dropped, kept).
// An avatar only ever reads the kept entries given to it, and says one only
// where the matter comes up (hard rule 10). Pure.

/** One entry: `label` what it is about (家人; may be empty), `text` the words, `for` the avatars it is given to; `by` the person, or the avatar whose agent wrote it, with who said it (`who`), waiting (`pending`) until the person says 记下. */
export interface BaseItem { id: string; label: string; text: string; for: string[]; state: "kept" | "pending"; by: string; who?: string; at: string }

export const BASE_LABEL_MAX = 20;
export const BASE_TEXT_MAX = 200;
/** How many entries a person keeps, and how many an agent may leave waiting at once. */
export const BASE_MAX = 100;
export const BASE_PENDING_MAX = 20;

interface Block { id: string; value: Record<string, unknown> }
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** The entries as they stand, oldest first: each made, then changed, kept or dropped in order. */
export function baseOf(blocks: readonly Block[]): BaseItem[] {
  const items = new Map<string, BaseItem>();
  for (const b of blocks) {
    if (/^base-\d+$/.test(b.id)) {
      const text = str(b.value["text"]);
      if (text === undefined) continue;
      const who = str(b.value["who"]);
      items.set(b.id, { id: b.id, label: str(b.value["label"]) ?? "", text, for: strings(b.value["for"]), state: b.value["state"] === "pending" ? "pending" : "kept", by: str(b.value["by"]) ?? "person", ...(who !== undefined ? { who } : {}), at: str(b.value["at"]) ?? "" });
      continue;
    }
    if (!/^baseset-\d+$/.test(b.id)) continue;
    const id = str(b.value["item"]) ?? "", it = items.get(id);
    if (it === undefined) continue;
    if (b.value["drop"] === true || b.value["keep"] === false) { items.delete(id); continue; }
    items.set(id, {
      ...it,
      ...(str(b.value["text"]) !== undefined ? { text: str(b.value["text"])! } : {}),
      ...(str(b.value["label"]) !== undefined ? { label: str(b.value["label"])! } : {}),
      ...(Array.isArray(b.value["for"]) ? { for: strings(b.value["for"]) } : {}),
      ...(b.value["keep"] === true ? { state: "kept" as const } : {}),
    });
  }
  return [...items.values()];
}

/** What one avatar may use: the kept entries given to it. */
export const baseFor = (items: readonly BaseItem[], avatar: string): BaseItem[] => items.filter((x) => x.state === "kept" && x.for.includes(avatar));

/** A line typed as 「家人：Lily，8 岁」: what it is about before the first colon (full-width or not), the words after; none, all words. */
export function splitBaseLine(typed: string): { label: string; text: string } {
  const t = typed.trim();
  const m = /^([^:：]{1,20})[:：]\s*(.+)$/s.exec(t);
  return m !== null ? { label: m[1]!.trim(), text: m[2]!.trim() } : { label: "", text: t };
}

/** What is wrong with an entry's words, or undefined. */
export function baseFault(label: unknown, text: unknown): { code: string; params?: Record<string, number> } | undefined {
  if (typeof text !== "string" || text.trim() === "") return { code: "base.text" };
  if ([...text].length > BASE_TEXT_MAX) return { code: "base.tooLong", params: { max: BASE_TEXT_MAX } };
  if (label !== undefined && (typeof label !== "string" || [...label].length > BASE_LABEL_MAX)) return { code: "base.label", params: { max: BASE_LABEL_MAX } };
  return undefined;
}
