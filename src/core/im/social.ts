// The social side (§11, §7.4): a room is a group anyone may join, where an
// agent is in one of three modes — 只潜水 (the default), 被问才答, 可以搭话 —
// and agents never talk to each other; the social secretary's first word
// in a guest DM; a digest the agent drafts and the owner nods to (rule 6's
// second source), only public things; 牵线 by the owners' public works,
// both nodding before the cards show. Pure: words and rules.

export type SocialMode = "lurk" | "ask" | "chat";
export const MODE_WORDS: Readonly<Record<SocialMode, string>> = { lurk: "只潜水", ask: "被问才答", chat: "可以搭话" };
export const DEFAULT_MODE: SocialMode = "lurk";
export const modeOf = (v: unknown): SocialMode => (typeof v === "string" && v in MODE_WORDS ? (v as SocialMode) : DEFAULT_MODE);

export const RECEPTION_PREFIX = "接待：";
/** The social secretary's first word (§11): who I am, for whom, the owner is away, their latest public thing, what a guest can do. */
export function receptionText(agent: string, owner: string, latest?: string): string {
  return `${RECEPTION_PREFIX}第一句自报家门——我是 ${agent}，代 ${owner}；${owner} 现在不在${latest === undefined ? "" : `；${owner} 最近公开的一件事：${latest}`}；访客可以留言，或问公开范围内的。`;
}

export const DIGEST_LIMIT = 1000;
export function digestFault(v: unknown): string | undefined {
  if (typeof v !== "string" || v.trim() === "") return "日报要有正文";
  if ([...v].length > DIGEST_LIMIT) return `日报最多 ${DIGEST_LIMIT} 字`;
  return undefined;
}
/** The first forty characters, with an ellipsis when there are more. */
export function digestHead(text: string, n = 40): string {
  const chars = [...text.trim()];
  return chars.length > n ? `${chars.slice(0, n).join("")}…` : chars.join("");
}
/** The 定 need for a draft (§6.9): the agent and the head; 发, 不发, or the owner's own words (rule 6: 起草 · 改过). */
export const digestNeedText = (agent: string, text: string): string => `${agent} 起草了日报：${digestHead(text)}`;
export const DIGEST_ACTIONS = ["发", "不发", "自己写"] as const;

/** The words of public works: titles and scopes split on blanks and marks, two characters or more, lowered; a CJK run is one word. */
export function keywordsOf(texts: readonly string[]): string[] {
  const out = new Set<string>();
  for (const t of texts) for (const w of t.toLowerCase().split(/[\s,，。；;：:·、()（）「」【】/|\-_]+/)) if ([...w].length >= 2) out.add(w);
  return [...out];
}
/** What two people's public works share (§11 牵线), for an agent to judge by — never a match by itself. */
export const sharedKeywords = (mine: readonly string[], theirs: readonly string[]): string[] => mine.filter((w) => theirs.includes(w));
/** The other side's 定: an agent judged the match, or the person themself asked. */
export const matchNeedText = (from: string, byAgent: boolean, note?: string): string => `牵线：${from}${byAgent ? " 的 agent 觉得你们合得来" : " 想和你互相亮名片"}${note === undefined ? "" : `：${note}`}`;
export const ownMatchNeedText = (agent: string, to: string): string => `你的 agent ${agent} 想替你和 ${to} 牵线，亮名片吗？`;
export const MATCH_ACTIONS = ["亮名片", "不用"] as const;
/** A person's card as the match shows it: their agents and their latest public thing. */
export const nameCard = (person: string, agents: readonly string[], latest?: string): string => `名片：${person}${agents.length === 0 ? "" : ` · agent ${agents.join("、")}`}${latest === undefined ? "" : ` · 最近公开：${latest}`}`;
export const MATCHED_TEXT = "牵线成功：双方亮名片";
