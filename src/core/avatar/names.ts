// What a new avatar is called (spec §6.5): the name the person gives when
// they join; skipped, a random one, a word and two digits from a list in the
// person's language, drawn from nothing of theirs, so that nobody can match
// two avatars by their names (§5 rule 4). A name is whatever the person
// types, within reason. Pure: the random source is given.
import { DEFAULT_LANG, type Fault, type Lang } from "./words.js";

export const NAME_WORDS: Readonly<Record<Lang, readonly string[]>> = {
  zh: ["云朵", "青柠", "橘子", "松果", "海盐", "晴天", "山茶", "小满", "鲸鱼", "麦穗", "竹叶", "萤火", "白鹭", "石榴", "雪松", "星河", "柚子", "灯塔", "晚风", "蒲公英"],
  en: ["Cloud", "Lime", "Orange", "Pine", "Salt", "Sunny", "Camellia", "Whale", "Wheat", "Bamboo", "Firefly", "Heron", "Cedar", "Comet", "Harbor", "Maple", "Pebble", "Breeze", "Willow", "Lantern"],
  ja: ["くも", "ライム", "みかん", "まつぼっくり", "しお", "はれ", "つばき", "くじら", "むぎ", "たけ", "ほたる", "しらさぎ", "ざくろ", "ゆず", "とうだい", "そよかぜ", "もみじ", "こいし", "やなぎ", "ちょうちん"],
};
export const NAME_MAX = 24;
/** The longest a group's name may be, in characters. */
export const GROUP_NAME_MAX = 40;
/** A group named by nobody is named by its members (S38, as WeChat's): 「John、李四、王五」, cut to the limit. */
export function groupNameOf(names: readonly string[], sep = "、"): string {
  return [...names.map((n) => n.trim()).filter((n) => n !== "").join(sep)].slice(0, GROUP_NAME_MAX).join("").trim();
}
const RESERVED: ReadonlySet<string> = new Set(["宿主", "系统", "host", "gemsbang"]);

/** A word and two digits, 「云朵 36」, in the language; `rand` gives a number in [0, 1). */
export function randomName(rand: () => number = Math.random, lang: Lang = DEFAULT_LANG): string {
  const words = NAME_WORDS[lang];
  const word = words[Math.floor(rand() * words.length) % words.length]!;
  return `${word} ${10 + (Math.floor(rand() * 90) % 90)}`;
}

/** Why the value cannot be a name: empty, too long, a control character, or the system's. */
export function nameFault(v: unknown): Fault | undefined {
  if (typeof v !== "string" || v.trim() === "") return { code: "name.empty" };
  const t = v.trim();
  if ([...t].length > NAME_MAX) return { code: "name.tooLong", params: { max: NAME_MAX } };
  if (/[\u0000-\u001f\u007f]/.test(t)) return { code: "name.control" };
  if (RESERVED.has(t.toLowerCase())) return { code: "name.reserved" };
  return undefined;
}
