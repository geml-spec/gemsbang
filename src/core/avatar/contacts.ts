// 联系人 (S34, Q22 (a)): the avatars of others the person's avatars met — in a
// group they are both in, or in a two-person chat they had — with no friend
// to add. One row per pair: their avatar, and which of the person's knows it,
// since a two-person chat is one per pair (relay `openDm`); the groups the two
// share, the chat they have. Sorted as a phone's contacts are, by the letter a
// name starts with (a Chinese name by its pinyin), A to Z and then the rest.
// Built from the mirror the client keeps (gemsbang/home.ts). Pure.
import { badgesOf, type Badge, type Mirror } from "./inbox.js";

/** A chat the two share, with how many are in it. */
export interface SharedGroup { owner: string; id: string; name: string; count: number }
/** One of the people the person knows: their avatar (`id`, `name`), the person's avatar that knows it (`as`), the groups the two share, their two-person chat. */
export interface Contact { id: string; name: string; as: Badge; letter: string; groups: SharedGroup[]; dm?: { owner: string; id: string } }

const COLLATOR = new Intl.Collator("zh-CN");
/** The first character of each pinyin letter as the collator orders them: a Han character from one on starts with that letter. */
const PINYIN_FIRSTS = ["阿", "八", "嚓", "哒", "妸", "发", "旮", "哈", "讥", "咔", "垃", "妈", "拏", "噢", "妑", "七", "呥", "仨", "他", "哇", "夕", "丫", "帀"];
const PINYIN_LETTERS = "ABCDEFGHJKLMNOPQRSTWXYZ";
/** Where a name with no letter to file it under goes: last, as a phone's contacts have it. */
export const OTHER_LETTER = "#";

/** The letter a name is filed under: a Latin letter as it is, a Han character by its pinyin, anything else `#`. */
export function letterOf(name: string): string {
  const first = [...name.trim()][0] ?? "";
  if (/^[a-z]$/i.test(first)) return first.toUpperCase();
  if (!/\p{Script=Han}/u.test(first)) return OTHER_LETTER;
  let at = -1;
  for (let i = 0; i < PINYIN_FIRSTS.length; i++) if (COLLATOR.compare(first, PINYIN_FIRSTS[i]!) >= 0) at = i;
  return at < 0 ? OTHER_LETTER : PINYIN_LETTERS[at]!;
}

/** Everyone the person's avatars know, by letter and then by name; none of the person's own avatars. */
export function contactsOf(m: Mirror): Contact[] {
  const badges = badgesOf(m.avatars);
  const mine = new Set(m.avatars.map((a) => a.id));
  const known = new Map<string, Contact>();
  for (const v of m.venues) {
    const as = badges.find((b) => b.id === v.as);
    if (as === undefined) continue;
    for (const x of v.members) {
      if (mine.has(x.id)) continue;
      const key = `${x.id} ${as.id}`;
      const c = known.get(key) ?? { id: x.id, name: x.name, as, letter: letterOf(x.name), groups: [] };
      if (v.kind === "dm") c.dm = { owner: v.owner, id: v.id };
      else c.groups.push({ owner: v.owner, id: v.id, name: v.name, count: v.members.length });
      known.set(key, c);
    }
  }
  const rank = (l: string): string => (l === OTHER_LETTER ? "~" : l);
  return [...known.values()].sort((a, b) => (rank(a.letter) < rank(b.letter) ? -1 : rank(a.letter) > rank(b.letter) ? 1 : COLLATOR.compare(a.name, b.name) || COLLATOR.compare(a.as.name, b.as.name)));
}
