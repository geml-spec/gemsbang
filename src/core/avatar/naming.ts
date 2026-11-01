// The names offered as the last step of joining (spec §6.5): by the
// occasion, the group's name read for a parents' group or a work group; the
// name the one who passed the link on calls the newcomer, first; the
// person's default name, never picked for them, with a line that their
// avatars may then share a name. A parents' suggestion has a blank for the
// child's name. Skipping all of them gives a random name (names.ts). Pure.
import type { Lang } from "./words.js";

export type Occasion = "parents" | "work" | "other";
export interface Suggestion { text: string; kind: "call" | "parent" | "default"; blank?: boolean }

const PARENTS = /家长|班级|[一二三四五六七八九十\d]+[)）]?\s*班|幼儿园|小学|学校|parent|pta|class\s*\d|保護者|クラス|[一二三四五六\d]年[一二三四五六七八九十\d]*組/i;
const WORK = /周会|例会|项目|团队|小组|部门|公司|同事|team|project|standup|weekly|sprint|squad|チーム|プロジェクト|定例|部署/i;

export function occasionOf(group: string): Occasion {
  if (PARENTS.test(group)) return "parents";
  if (WORK.test(group)) return "work";
  return "other";
}

/** A parent's names with a blank for the child, `__` where the child's name goes. */
const PARENT_NAMES: Readonly<Record<Lang, readonly string[]>> = {
  zh: ["__ 妈妈", "__ 爸爸"],
  en: ["__'s mom", "__'s dad"],
  ja: ["__ママ", "__パパ"],
};
export const BLANK = "__";

/** The names to offer, in order: what the inviter calls you, a parent's names, your default name. None is picked. */
export function suggestions(o: { group: string; lang: Lang; call?: string; defaultName?: string }): Suggestion[] {
  const out: Suggestion[] = [];
  const add = (s: Suggestion): void => { if (s.text.trim() !== "" && !out.some((x) => x.text === s.text)) out.push(s); };
  if (o.call !== undefined) add({ text: o.call.trim(), kind: "call" });
  if (occasionOf(o.group) === "parents") for (const text of PARENT_NAMES[o.lang]) add({ text, kind: "parent", blank: true });
  if (o.defaultName !== undefined) add({ text: o.defaultName, kind: "default" });
  return out;
}

/** A suggestion with its blank filled; the blank left when the child's name is empty. */
export const fillBlank = (text: string, child: string): string => (child.trim() === "" ? text : text.replace(BLANK, child.trim()));
