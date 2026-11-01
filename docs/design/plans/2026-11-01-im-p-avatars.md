# Gemsbang Plan P: Avatars Are the Accounts (the Relay's Core)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The relay learns gemsbang's accounts. A person logs in with a phone number and a texted code, and is kept only as a salted hash under the relay's own folder. Their avatars are the accounts everyone else sees; an avatar grows with the name the person gives, else a random one in the person's language (the default name is only ever a suggestion, plan Q's). A refusal is a code and its parameters, said in Chinese, English or Japanese. Avatars make groups, pull others in, open two-person talks and say things. Every line is stamped with the avatar and `by` (the person typing, or an agent holding the avatar's token), and others see `by` only when that avatar marks. Nobody can learn from the relay which person an avatar belongs to.

**Architecture:** A new class, `AvatarRelay` (`src/relay/avatars.ts`), beside the older `Relay` (`src/relay/relay.ts`). It reuses the store (`store.ts`: documents of sealed data blocks, appended under a lock), the chain (`core/im/chain.ts`) and the tokens (`tokens.ts`, which gains two scopes, `avatar` and `device`), and writes none of the older relay's documents. Five pure modules under `src/core/avatar/` hold the rules: who speaks (`who.ts`), the words in three languages (`words.ts`), an avatar's name (`names.ts`), phone numbers and codes (`phone.ts`), an avatar's rules (`rules.ts`). A texter (`src/relay/text.ts`) sends the code the way `mail.ts` sends mail: a file by default, a command when the operator says. The person lives under `_relay` (`people/<p-id>.geml`, the phone map, the avatar→person map, the salt); an avatar under its own id (`<a-id>/avatar.geml`, the public card; `rules.geml` and `joined.geml`, its own); a venue under the avatar that made it (`<a-id>/venues/<g-id|d-id>.geml`). This plan has no HTTP: plan Q serves it.

**Tech Stack:** TypeScript (`src/core/avatar`, `src/relay`), `node:test` over `dist/`.

**Before this plan:** gemsbang 0.5.0 on `main` (`38bb15e`). The spec is `docs/design/specs/2026-11-01-gemsbang-design.md`, revised the same day after a review from a senior IM product view (`docs/design/reviews/2026-11-01-gemsbang-pm-review.md`); the transport spec `docs/design/specs/2026-10-30-agent-im-transport-design.md` was rewritten for avatars and revised with it.

## The series

The spec is six plans, each leaving something that runs and is tested. The older relay, its cards, ledger, signals and guest pages stay in the tree and keep their tests, but nothing new serves them (spec §2, 先不做).

| Plan | What it builds | What runs after it |
|---|---|---|
| **P (this one)** · avatars are the accounts | `AvatarRelay`: phone login, people kept private, avatars, rules, avatar and device tokens, groups, two-person talk, messages stamped with the avatar and `by`, reading by membership | The relay's core, exercised by tests |
| Q · a group, one link | Links (make, rotate, expire, forwarding on or off, the owner's approval on or off); `/i/<code>` for people with the naming step, `/i/<code>.md` for agents, `/g/<group id>` for every member, `/login`; an agent's join with the person's agreement (a code, or a question in its own conversation); the second group's default avatar; refusals said in the request's language; `gemworks relay serve` serves the avatar relay | A person joins from a WeChat link, names themself and talks on the web; a scripted agent joins from the `.md` |
| R · the Claude Code side panel | The daemon mirrors every avatar's venues; bridge ops; the panel's total inbox, a group seen as one avatar, 叫人, 我的分身, the language; `im_join` only for the relay's own domain and only when the person pasted it, the code typed in the plugin's own box; the 0.5.0 消息 · 任务 · 钱包 pages go | gemsbang in Claude Code |
| S · 需要你, and the push outlet | The five kinds (答应事情, 花钱, 表态, 借电脑, 出错), the card with the words it would send, expiry, folding, order and muting; placeholder lines as templates; `im_ask` with a kind; answers from the panel and the web; the relay's push outlet with its adapter interface and a test adapter | Avatars ask their person, and the answer comes back |
| T · hosted agents, and who pays | A hosted agent per avatar; when it wakes (an `@`, then cheap rules, then batched reading); the newcomer's free quota (7 days or 50 replies); the person's way to pay (their own API key first); receive-only after that, and 「本人在时才回」 in the group | Avatars answer for people who are away |
| U · borrowing Claude Code | The 借电脑 card first; on a yes, a separate agent in a worktree of the repository the person named; the envelope marking the asker's words as material; only the repository's own commands; results back with what the host saw; an offline body an error only when work waits | An avatar fixes code on its person's machine, with the person's yes |

## What the spec decided, and what this plan does about each

- **The account is the avatar (§3.1, §4).** Speakers are `avatar:<a-…>`; there is no agent account and no owner badge. A person is `person:<p-…>` and appears only in tokens and in the relay's own records.
- **Nobody learns whose an avatar is (§5 rule 4).** The avatar→person map is under `_relay`, which the read path refuses (it only reads `a-…` owners). A card holds a name and nothing else; ids are random, so two avatars of one person share nothing a stranger can see.
- **Who said it is recorded, whether it shows is the avatar's (§5 rule 1, §8.1).** Every message has `by`. Reading a venue drops `by` from the lines of an avatar whose rules say `mark: false`, except for that avatar and its person. The record on disk keeps it.
- **Phone first, and only a hash (§6.2, transport §2.5).** Six digits, ten minutes, once; three to a number in ten minutes, ten to a network in an hour. The number is stored as `sha256(salt:number)` with a salt the relay makes once; a mainland number may omit +86.
- **A new avatar's name (§6.5, §3 rule 19).** The name the person gives (plan Q asks for it as the last step of joining); else a random word and two digits from the list of the person's language. The default name is kept, but only ever offered as a suggestion: using it unasked would make two avatars of one person share a name (the review's third point).
- **Languages (§7.6).** A person has a language: the one they logged in with (`lang` on the login), or the one they chose. The code is texted in the language asked in. Every refusal is a code with parameters and its Chinese words; `words.ts` says each code in Chinese, English and Japanese with the same blanks.
- **The first login has no avatar (§6.2).** An avatar grows with the first venue; plan Q grows it when a link is used. Here `growAvatar` is called directly.
- **Two-person talk starts from a shared group (§6.6).** One per pair, under the smaller id, named after the other side.
- **Not in this plan:** links and joining (Q), 需要你 (S), hosted agents and paying (T), borrowing a computer (U), revealing 「这也是我」 (R, with 我的分身).

## File structure

| File | Responsibility |
|---|---|
| `src/core/avatar/who.ts` (new) | Speakers: `avatar:<id>`, `person:<id>`, `host`; the id patterns; `By`. |
| `src/core/avatar/words.ts` (new) | `Lang`, `Fault`, `say`, `sayFault`: every code in three languages. |
| `src/core/avatar/names.ts` (new) | `randomName` (per language), `nameFault`. |
| `src/core/avatar/phone.ts` (new) | `normalizePhone`, `hashPhone`, the code's limits and words. |
| `src/core/avatar/rules.ts` (new) | `Rules`, `DEFAULT_RULES`, `withRules`. |
| `src/relay/text.ts` (new) | `fileTexter`, `commandTexter`. |
| `src/relay/tokens.ts` | Two more scopes: `avatar`, `device`. |
| `src/relay/avatars.ts` (new) | `AvatarRelay`: login, the person and their language, avatars, rules, tokens, venues, reading, pushes. |
| `test/avatar-*.test.mjs`, `test/relay-text.test.mjs` (new) | One file per task. |

---

### Task 1: Who speaks: an avatar, a person, the host

**Files:**
- Create: `src/core/avatar/who.ts`
- Test: `test/avatar-who.test.mjs`

- [ ] **Step 1: Write the failing test**

**Create `test/avatar-who.test.mjs`:**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { avatarSpeaker, formatWho, parseWho } from "../dist/core/avatar/who.js";

test("who (spec §4): an avatar and a person are a kind and an opaque id; anything else is no one", () => {
  assert.deepEqual(parseWho("avatar:a-0123456789"), { kind: "avatar", id: "a-0123456789" });
  assert.deepEqual(parseWho("person:p-abcdef0123"), { kind: "person", id: "p-abcdef0123" });
  assert.deepEqual(parseWho("host"), { kind: "host" });
  for (const bad of ["avatar:john", "agent:xiaoping@john", "person:john", "avatar:a-0123", ""]) assert.equal(parseWho(bad), undefined, bad);
  assert.equal(formatWho({ kind: "avatar", id: "a-0123456789" }), "avatar:a-0123456789");
  assert.equal(avatarSpeaker("a-0123456789"), "avatar:a-0123456789");
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run build && node --test test/avatar-who.test.mjs`

Expected: the build passes; the test file cannot load its module (`ERR_MODULE_NOT_FOUND`), so `ℹ fail 1`.

- [ ] **Step 3: Write the code**

**Create `src/core/avatar/who.ts`:**

```ts
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
```

- [ ] **Step 4: Run it to see it pass**

Run: `npm run build && node --test test/avatar-who.test.mjs`

Expected: `ℹ pass 1`, `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add test/avatar-who.test.mjs src/core/avatar/who.ts
git commit -m "gemsbang P1: who speaks — an avatar, a person, the host"
```


### Task 2: Words: codes in Chinese, English and Japanese

**Files:**
- Create: `src/core/avatar/words.ts`
- Test: `test/avatar-words.test.mjs`

- [ ] **Step 1: Write the failing test**

**Create `test/avatar-words.test.mjs`:**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { CODES, DEFAULT_LANG, isLang, LANGS, say, sayFault } from "../dist/core/avatar/words.js";

test("words (spec §7.6): every code speaks Chinese, English and Japanese with the same blanks; a blank is filled from the parameters; a code with no words is itself", () => {
  assert.deepEqual(LANGS, ["zh", "en", "ja"]);
  assert.equal(DEFAULT_LANG, "zh");
  for (const code of CODES) {
    const blanks = (lang) => (say(code, lang).match(/\{\w+\}/g) ?? []).sort().join(",");
    for (const lang of LANGS) assert.notEqual(say(code, lang), code, `${code} in ${lang}`);
    assert.equal(blanks("en"), blanks("zh"), `${code}: en has the same blanks`);
    assert.equal(blanks("ja"), blanks("zh"), `${code}: ja has the same blanks`);
  }
  assert.equal(say("name.tooLong", "zh", { max: 24 }), "名字最多 24 个字");
  assert.equal(say("name.tooLong", "en", { max: 24 }), "A name has at most 24 characters");
  assert.equal(say("name.tooLong", "ja", { max: 24 }), "名前は24文字までです");
  assert.equal(say("code.text", "en", { code: "123456" }), "Gemsbang code 123456, valid for 10 minutes. If you did not ask for it, ignore this.");
  assert.equal(say("name.tooLong"), "名字最多 {max} 个字", "a blank with nothing to fill stays");
  assert.equal(say("no.such.code", "en"), "no.such.code");
  assert.equal(sayFault({ code: "rules.unknown", params: { key: "alone" } }, "en"), "There is no rule called alone");
  assert.equal(isLang("ja"), true);
  assert.equal(isLang("fr"), false);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run build && node --test test/avatar-words.test.mjs`

Expected: the build passes; the test file cannot load its module (`ERR_MODULE_NOT_FOUND`), so `ℹ fail 1`.

- [ ] **Step 3: Write the code**

**Create `src/core/avatar/words.ts`:**

```ts
// What gemsbang says, in the person's language (spec §7.6): the relay never
// says a sentence of its own, only a code and its parameters; whoever shows
// it to a person turns it into words here. Three languages first: Chinese,
// English, Japanese. A code with no words is shown as itself. Pure.

export type Lang = "zh" | "en" | "ja";
export const LANGS: readonly Lang[] = ["zh", "en", "ja"];
export const DEFAULT_LANG: Lang = "zh";
export const isLang = (v: unknown): v is Lang => typeof v === "string" && (LANGS as readonly string[]).includes(v);

/** A refusal or a system line as the relay gives it: a code, and what fills its blanks. */
export interface Fault { code: string; params?: Record<string, string | number> }

const WORDS: Readonly<Record<string, Readonly<Record<Lang, string>>>> = {
  "phone.required": { zh: "要一个手机号", en: "Enter a phone number", ja: "電話番号を入力してください" },
  "code.short": { zh: "验证码是六位数字", en: "The code is six digits", ja: "認証コードは6桁の数字です" },
  "code.wrong": { zh: "验证码不对或过期了", en: "That code is wrong or has expired", ja: "認証コードが違うか、期限切れです" },
  "code.tooMany": { zh: "验证码发得太频繁，过十分钟再试", en: "Too many codes; try again in ten minutes", ja: "コードの送信が多すぎます。10分後にもう一度どうぞ" },
  "code.sent": { zh: "验证码发到手机了，10 分钟内有效", en: "The code is on its way; it works for 10 minutes", ja: "認証コードを送りました。10分間有効です" },
  "code.text": { zh: "Gemsbang 验证码 {code}，10 分钟内有效。不是你在登录的话，不用管。", en: "Gemsbang code {code}, valid for 10 minutes. If you did not ask for it, ignore this.", ja: "Gemsbang 認証コード {code}（10分間有効）。心当たりがなければ無視してください。" },
  "lang.unknown": { zh: "不支持这种语言", en: "That language is not supported", ja: "その言語には対応していません" },
  "person.only": { zh: "只有本人能这么做", en: "Only the person can do this", ja: "本人だけができる操作です" },
  "name.empty": { zh: "名字不能是空的", en: "The name cannot be empty", ja: "名前を入力してください" },
  "name.tooLong": { zh: "名字最多 {max} 个字", en: "A name has at most {max} characters", ja: "名前は{max}文字までです" },
  "name.control": { zh: "名字里不能有控制字符", en: "A name cannot hold control characters", ja: "名前に制御文字は使えません" },
  "name.reserved": { zh: "这个名字留给系统", en: "That name is reserved", ja: "その名前は使えません" },
  "avatar.notYours": { zh: "这不是你的分身", en: "That avatar is not yours", ja: "それはあなたの分身ではありません" },
  "avatar.missing": { zh: "没有这个分身", en: "No such avatar", ja: "その分身は見つかりません" },
  "rules.notObject": { zh: "规矩要是一个对象", en: "Rules must be an object", ja: "ルールはオブジェクトで指定してください" },
  "rules.mark": { zh: "mark 要是 true 或 false", en: "mark must be true or false", ja: "mark は true か false です" },
  "rules.borrow": { zh: "borrow 只能是 {allowed}", en: "borrow may only be {allowed}", ja: "borrow に使えるのは {allowed} だけです" },
  "rules.unknown": { zh: "没有 {key} 这条规矩", en: "There is no rule called {key}", ja: "{key} というルールはありません" },
  "token.wrong": { zh: "令牌不对", en: "That token is not right", ja: "トークンが正しくありません" },
  "token.ownAvatar": { zh: "这个令牌只能代它自己的分身", en: "This token speaks only for its own avatar", ja: "このトークンは自分の分身としてだけ話せます" },
  "token.mute": { zh: "这个令牌不能说话", en: "This token cannot speak", ja: "このトークンでは話せません" },
  "as.required": { zh: "要说明以哪个分身", en: "Say which avatar you speak as", ja: "どの分身として話すか指定してください" },
  "group.name": { zh: "群要有个名字", en: "A group needs a name", ja: "グループには名前が必要です" },
  "group.nameTooLong": { zh: "群名最多 {max} 个字", en: "A group name has at most {max} characters", ja: "グループ名は{max}文字までです" },
  "group.missing": { zh: "没有这个群", en: "No such group", ja: "そのグループは見つかりません" },
  "group.ownerOnly": { zh: "只有群主能拉人", en: "Only the group's owner can add people", ja: "メンバーを追加できるのはグループのオーナーだけです" },
  "dm.noAdd": { zh: "两个人的私聊不能加人", en: "A two-person chat cannot take more people", ja: "1対1のチャットには追加できません" },
  "dm.sharedGroup": { zh: "要先在同一个群里", en: "You need to share a group first", ja: "先に同じグループにいる必要があります" },
  "venue.notMember": { zh: "不在这个群里", en: "Not in this group", ja: "このグループのメンバーではありません" },
  "message.empty": { zh: "说点什么", en: "Say something", ja: "何か入力してください" },
  "message.tooLong": { zh: "一条最多 {max} 个字", en: "A message has at most {max} characters", ja: "1件は{max}文字までです" },
  "message.badId": { zh: "消息 id 不合法", en: "That message id is not allowed", ja: "そのメッセージ ID は使えません" },
  "message.badReply": { zh: "回复的那条不在这个群里", en: "The message replied to is not in this group", ja: "返信先のメッセージがこのグループにありません" },
  "doc.missing": { zh: "没有这份文档", en: "No such document", ja: "その文書は見つかりません" },
  "doc.denied": { zh: "无权读这份文档", en: "You may not read this document", ja: "この文書を読む権限がありません" },
};

/** The codes there are words for. */
export const CODES: readonly string[] = Object.keys(WORDS);

/** The code's words in the language, each `{name}` filled from the parameters; a code with no words is itself. */
export function say(code: string, lang: Lang = DEFAULT_LANG, params: Record<string, string | number> = {}): string {
  const words = WORDS[code]?.[lang];
  if (words === undefined) return code;
  return words.replace(/\{(\w+)\}/g, (all, name: string) => (name in params ? String(params[name]) : all));
}

/** A fault's words in the language. */
export const sayFault = (f: Fault, lang: Lang = DEFAULT_LANG): string => say(f.code, lang, f.params);
```

- [ ] **Step 4: Run it to see it pass**

Run: `npm run build && node --test test/avatar-words.test.mjs`

Expected: `ℹ pass 1`, `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add test/avatar-words.test.mjs src/core/avatar/words.ts
git commit -m "gemsbang P2: words — a code and its parameters, said in Chinese, English or Japanese"
```


### Task 3: Names: the name given, else a random one in the person's language

**Files:**
- Create: `src/core/avatar/names.ts`
- Test: `test/avatar-names.test.mjs`

- [ ] **Step 1: Write the failing test**

**Create `test/avatar-names.test.mjs`:**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { NAME_WORDS, nameFault, randomName } from "../dist/core/avatar/names.js";

test("names (spec §6.5): a random name is a word from the person's language and two digits; a name is not empty, not too long, no control character, not the system's", () => {
  assert.equal(randomName(() => 0), `${NAME_WORDS.zh[0]} 10`);
  assert.equal(randomName(() => 0.999, "en"), `${NAME_WORDS.en[NAME_WORDS.en.length - 1]} 99`);
  assert.equal(randomName(() => 0, "ja"), `${NAME_WORDS.ja[0]} 10`);
  for (let i = 0; i < 50; i++) assert.match(randomName(), /^\S+ [1-9]\d$/);
  for (const lang of ["zh", "en", "ja"]) assert.equal(NAME_WORDS[lang].length, 20, lang);
  assert.equal(nameFault("Lily 爸爸"), undefined);
  assert.deepEqual(nameFault("  "), { code: "name.empty" });
  assert.deepEqual(nameFault(7), { code: "name.empty" });
  assert.deepEqual(nameFault("长".repeat(25)), { code: "name.tooLong", params: { max: 24 } });
  assert.deepEqual(nameFault("a\u0007b"), { code: "name.control" });
  assert.deepEqual(nameFault("宿主"), { code: "name.reserved" });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run build && node --test test/avatar-names.test.mjs`

Expected: the build passes; the test file cannot load its module (`ERR_MODULE_NOT_FOUND`), so `ℹ fail 1`.

- [ ] **Step 3: Write the code**

**Create `src/core/avatar/names.ts`:**

```ts
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
```

- [ ] **Step 4: Run it to see it pass**

Run: `npm run build && node --test test/avatar-names.test.mjs`

Expected: `ℹ pass 1`, `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add test/avatar-names.test.mjs src/core/avatar/names.ts
git commit -m "gemsbang P3: an avatar's name — a random word and two digits in the person's language"
```


### Task 4: Phone: the number, its salted hash, the code's rules and text

**Files:**
- Create: `src/core/avatar/phone.ts`
- Test: `test/avatar-phone.test.mjs`

- [ ] **Step 1: Write the failing test**

**Create `test/avatar-phone.test.mjs`:**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { codeText, hashPhone, normalizePhone, phoneFault, tailOf } from "../dist/core/avatar/phone.js";

test("phone (spec §6.2): a mainland number gets +86, an international one keeps its +, separators drop; the hash needs the salt and never shows the digits; the code's text speaks the language asked in", () => {
  assert.equal(normalizePhone("138 0013 8000"), "+8613800138000");
  assert.equal(normalizePhone("+1 (415) 555-0100"), "+14155550100");
  for (const bad of ["12345", "0800-123", "abc", 13800138000]) assert.equal(normalizePhone(bad), undefined, String(bad));
  assert.deepEqual(phoneFault("hello"), { code: "phone.required" });
  assert.equal(phoneFault("13800138000"), undefined);
  const h = hashPhone("+8613800138000", "salt-a");
  assert.match(h, /^sha256:[0-9a-f]{64}$/);
  assert.equal(h, hashPhone("+8613800138000", "salt-a"));
  assert.notEqual(h, hashPhone("+8613800138000", "salt-b"));
  assert.ok(!h.includes("13800138000"));
  assert.equal(tailOf("+8613800138000"), "8000");
  assert.equal(codeText("123456"), "Gemsbang 验证码 123456，10 分钟内有效。不是你在登录的话，不用管。");
  assert.match(codeText("123456", "ja"), /^Gemsbang 認証コード 123456/);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run build && node --test test/avatar-phone.test.mjs`

Expected: the build passes; the test file cannot load its module (`ERR_MODULE_NOT_FOUND`), so `ℹ fail 1`.

- [ ] **Step 3: Write the code**

**Create `src/core/avatar/phone.ts`:**

```ts
// Logging in by phone (spec §6.2, transport §2.5): a person is their phone
// number, which the relay keeps only as a salted hash; a six-digit code
// texted to it is the proof, good for ten minutes, three to a number in ten
// minutes and ten to a network in an hour. A mainland number may come
// without its country code. Pure: the rules (the words are words.ts's); the relay keeps
// the codes and sends the text.
import { createHash } from "node:crypto";
import { DEFAULT_LANG, say, type Fault, type Lang } from "./words.js";

export const CODE_RE = /^\d{6}$/;
export const CODE_TTL_MS = 10 * 60_000;
export const CODES_PER_PHONE = 3;
export const CODES_PER_IP_HOUR = 10;

/** The number in E.164, spaces, dashes, dots and brackets dropped; an 11-digit mainland number starting with 1 gets +86; undefined when it is no number. */
export function normalizePhone(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.replace(/[\s\-().]/g, "");
  if (/^1\d{10}$/.test(t)) return `+86${t}`;
  if (/^\+\d{7,15}$/.test(t)) return t;
  return undefined;
}

export const phoneFault = (v: unknown): Fault | undefined => (normalizePhone(v) === undefined ? { code: "phone.required" } : undefined);

/** The number as the relay keeps it: a hash with the relay's salt, never the digits. */
export const hashPhone = (phone: string, salt: string): string => "sha256:" + createHash("sha256").update(`${salt}:${phone}`, "utf8").digest("hex");

/** The last four digits, to say where the code went. */
export const tailOf = (phone: string): string => phone.slice(-4);

/** The text that carries the code, in the language the person asked in. */
export const codeText = (code: string, lang: Lang = DEFAULT_LANG): string => say("code.text", lang, { code });
```

- [ ] **Step 4: Run it to see it pass**

Run: `npm run build && node --test test/avatar-phone.test.mjs`

Expected: `ℹ pass 1`, `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add test/avatar-phone.test.mjs src/core/avatar/phone.ts
git commit -m "gemsbang P4: logging in by phone — the number, a salted hash, the code's rules"
```


### Task 5: Rules: marking and what a borrowed computer may do

**Files:**
- Create: `src/core/avatar/rules.ts`
- Test: `test/avatar-rules.test.mjs`

- [ ] **Step 1: Write the failing test**

**Create `test/avatar-rules.test.mjs`:**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_RULES, withRules } from "../dist/core/avatar/rules.js";

test("rules (spec §8.1): marking on and read, edit, test by default; a change names only what it changes; anything else is refused", () => {
  assert.deepEqual(DEFAULT_RULES, { mark: true, borrow: ["read", "edit", "test"] });
  assert.deepEqual(withRules(DEFAULT_RULES, { mark: false }), { mark: false, borrow: ["read", "edit", "test"] });
  assert.deepEqual(withRules(DEFAULT_RULES, { borrow: ["test", "read", "push"] }), { mark: true, borrow: ["read", "test", "push"] });
  assert.deepEqual(withRules(DEFAULT_RULES, { mark: "no" }), { code: "rules.mark" });
  assert.deepEqual(withRules(DEFAULT_RULES, { borrow: ["delete"] }), { code: "rules.borrow", params: { allowed: "read, edit, test, push, secrets" } });
  assert.deepEqual(withRules(DEFAULT_RULES, { alone: "all" }), { code: "rules.unknown", params: { key: "alone" } });
  assert.deepEqual(withRules(DEFAULT_RULES, []), { code: "rules.notObject" });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run build && node --test test/avatar-rules.test.mjs`

Expected: the build passes; the test file cannot load its module (`ERR_MODULE_NOT_FOUND`), so `ℹ fail 1`.

- [ ] **Step 3: Write the code**

**Create `src/core/avatar/rules.ts`:**

```ts
// An avatar's rules (spec §8.1): whether others see that an agent said a
// line (`mark`), and what it may do on a computer it borrows (`borrow`).
// Only the person changes them; a change names only what it changes. Pure.
import type { Fault } from "./words.js";

export interface Rules { mark: boolean; borrow: string[] }

/** What a borrowed computer may be used for: read, edit, run the tests; push and secrets only when the person says. */
export const BORROWS: readonly string[] = ["read", "edit", "test", "push", "secrets"];
export const DEFAULT_RULES: Rules = { mark: true, borrow: ["read", "edit", "test"] };

/** The rules with a change laid over them, or why the change is not one. */
export function withRules(base: Rules, change: unknown): Rules | Fault {
  if (typeof change !== "object" || change === null || Array.isArray(change)) return { code: "rules.notObject" };
  const c = change as Record<string, unknown>;
  const out: Rules = { mark: base.mark, borrow: [...base.borrow] };
  for (const key of Object.keys(c)) {
    if (key === "mark") {
      if (typeof c["mark"] !== "boolean") return { code: "rules.mark" };
      out.mark = c["mark"];
    } else if (key === "borrow") {
      const b = c["borrow"];
      if (!Array.isArray(b) || !b.every((x) => typeof x === "string" && BORROWS.includes(x))) return { code: "rules.borrow", params: { allowed: BORROWS.join(", ") } };
      out.borrow = BORROWS.filter((x) => (b as string[]).includes(x));
    } else return { code: "rules.unknown", params: { key } };
  }
  return out;
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npm run build && node --test test/avatar-rules.test.mjs`

Expected: `ℹ pass 1`, `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add test/avatar-rules.test.mjs src/core/avatar/rules.ts
git commit -m "gemsbang P5: an avatar's rules — marking, and what a borrowed computer may do"
```


### Task 6: The texter, and two more token scopes

**Files:**
- Create: `src/relay/text.ts`
- Modify: `src/relay/tokens.ts` (the `Scope` type and its set)
- Test: `test/relay-text.test.mjs`

- [ ] **Step 1: Write the failing test**

**Create `test/relay-text.test.mjs`:**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commandTexter, fileTexter } from "../dist/relay/text.js";
import { issueToken, verifyToken } from "../dist/relay/tokens.js";

test("the texters: the file texter writes each text under the relay's own folder; the command texter runs the command with the number in its environment and the text on stdin, and a failing command rejects", async () => {
  const root = mkdtempSync(join(tmpdir(), "gemsbang-text-"));
  fileTexter(root)({ to: "+8613800138000", text: "Gemsbang 验证码 123456" });
  const dir = join(root, "_relay", "texts");
  const files = readdirSync(dir);
  assert.equal(files.length, 1);
  assert.equal(readFileSync(join(dir, files[0]), "utf8"), "To: +8613800138000\n\nGemsbang 验证码 123456\n");
  const script = join(root, "text.cjs"), out = join(root, "sent.txt");
  writeFileSync(script, 'const fs = require("node:fs"); let s = ""; process.stdin.on("data", (c) => { s += c; }).on("end", () => fs.writeFileSync(process.argv[2], process.env.TEXT_TO + "|" + s));');
  await commandTexter(`"${process.execPath}" "${script}" "${out}"`)({ to: "+8613800138000", text: "body" });
  assert.equal(readFileSync(out, "utf8"), "+8613800138000|body");
  await assert.rejects(commandTexter(`"${process.execPath}" -e "process.exit(3)"`)({ to: "x", text: "t" }), /exited 3/);
});

test("token scopes: an avatar's and a device's tokens are kept and verified like the others", () => {
  const root = mkdtempSync(join(tmpdir(), "gemsbang-tokens-"));
  const avatar = issueToken(root, { speaker: "avatar:a-0123456789", scope: "avatar", by: "person:p-0123456789", at: "2026-11-01T09:00:00Z" });
  const device = issueToken(root, { speaker: "person:p-0123456789", scope: "device", by: "person:p-0123456789", at: "2026-11-01T09:00:00Z" });
  assert.deepEqual([verifyToken(root, avatar.token).speaker, verifyToken(root, avatar.token).scope], ["avatar:a-0123456789", "avatar"]);
  assert.deepEqual([verifyToken(root, device.token).speaker, verifyToken(root, device.token).scope], ["person:p-0123456789", "device"]);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run build && node --test test/relay-text.test.mjs`

Expected: the build passes; the test file cannot load its module (`ERR_MODULE_NOT_FOUND`), so `ℹ fail 1`.

- [ ] **Step 3: Write the code**

**Create `src/relay/text.ts`:**

```ts
// Where a login code goes (spec §6.2): the operator's choice, as for mail.
// By default a file under the relay's own folder; `gemworks relay
// --text-command` runs a command with the number in its environment and the
// text on stdin (a curl to a provider). The relay never waits on it.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface Text { to: string; text: string }
export type Texter = (t: Text) => void | Promise<void>;

/** Each text a file `<root>/_relay/texts/<stamp>-<rand>.txt`: the number, a blank line, the text. */
export function fileTexter(root: string): Texter {
  return (t) => {
    const dir = join(root, "_relay", "texts");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${Date.now()}-${randomBytes(3).toString("hex")}.txt`), `To: ${t.to}\n\n${t.text}\n`);
  };
}

/** The command through the shell, TEXT_TO in its environment, the text on stdin; a non-zero exit rejects with its stderr. */
export function commandTexter(command: string): Texter {
  return (t) => new Promise<void>((done, failed) => {
    const win = process.platform === "win32";
    const child = spawn(win ? "cmd.exe" : "sh", win ? ["/d", "/s", "/c", command] : ["-c", command], { env: { ...process.env, TEXT_TO: t.to }, stdio: ["pipe", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (c: Buffer) => { err += c; });
    child.on("error", failed);
    child.on("exit", (code) => { if (code === 0) done(); else failed(new Error(`text command exited ${code}: ${err.trim()}`)); });
    child.stdin.end(t.text);
  });
}
```

**In `src/relay/tokens.ts`, replace:**

```ts
export type Scope = "person" | "agent" | "guest" | "inbox";
const SCOPES: ReadonlySet<string> = new Set(["person", "agent", "guest", "inbox"]);
```

**with:**

```ts
/** gemsbang adds two (relay/avatars.ts): an avatar's, which speaks as `avatar:<id>`, and a device's, the agent a person attached on one machine, which speaks as the person but may only ask for an avatar's token. */
export type Scope = "person" | "agent" | "guest" | "inbox" | "avatar" | "device";
const SCOPES: ReadonlySet<string> = new Set(["person", "agent", "guest", "inbox", "avatar", "device"]);
```

- [ ] **Step 4: Run it to see it pass**

Run: `npm run build && node --test test/relay-text.test.mjs`

Expected: `ℹ pass 2`, `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add test/relay-text.test.mjs src/relay/text.ts src/relay/tokens.ts
git commit -m "gemsbang P6: the texter for login codes; avatar and device token scopes"
```


### Task 7: The relay: logging in by phone

**Files:**
- Create: `src/relay/avatars.ts` (the header, the types, the class with its login)
- Test: `test/avatar-login.test.mjs`

- [ ] **Step 1: Write the failing test**

**Create `test/avatar-login.test.mjs`:**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AvatarRelay } from "../dist/relay/avatars.js";

const BASE = Date.UTC(2026, 10, 1, 9, 0, 0);
/** A relay whose clock starts at 09:00 and moves a second per look; its texts are kept; `advance` moves the clock further. */
function relay(o = {}) {
  let offset = 0;
  const texts = [];
  const now = () => { const t = new Date(BASE + offset).toISOString().replace(/\.\d{3}Z$/, "Z"); offset += 1000; return t; };
  const r = new AvatarRelay({ root: mkdtempSync(join(tmpdir(), "gemsbang-relay-")), name: "relay.test", now, texter: (t) => { texts.push(t); }, ...o });
  r.texts = texts;
  r.advance = (ms) => { offset += ms; };
  return r;
}
const ok = (x) => { assert.equal(x.ok, true, x.reason); return x; };
const bad = (x, status, reason) => { assert.equal(x.ok, false); assert.equal(x.status, status, x.reason); if (reason !== undefined) assert.equal(x.reason, reason); return x; };
const codeIn = (t) => /(\d{6})/.exec(t.text)[1];
/** Every file under the root, as text. */
function allText(dir) {
  let out = "";
  for (const n of readdirSync(dir)) { const p = join(dir, n); out += statSync(p).isDirectory() ? allText(p) : readFileSync(p, "utf8"); }
  return out;
}

test("login (spec §6.2): a code texted to the number, six digits, ten minutes, once; the wrong one, a short one, another number's; three to a number in ten minutes, ten to a network in an hour; the first login is a new person; the code is texted in the language asked in; a refusal carries its code; the number is kept only as a salted hash", () => {
  const r = relay();
  assert.equal(bad(r.startLogin({ phone: "hello" }), 400, "要一个手机号").code, "phone.required");
  const started = ok(r.startLogin({ phone: "138 0013 8000" }, "10.0.0.1"));
  assert.deepEqual([started.known, started.tail], [false, "8000"]);
  assert.equal(r.texts[0].to, "+8613800138000");
  assert.match(r.texts[0].text, /^Gemsbang 验证码 \d{6}，10 分钟内有效。/);
  const code = codeIn(r.texts[0]);
  assert.equal(bad(r.finishLogin({ phone: "13800138000", code: "12" }), 400, "验证码是六位数字").code, "code.short");
  bad(r.finishLogin({ phone: "13800138000", code: code === "000000" ? "000001" : "000000" }), 401, "验证码不对或过期了");
  bad(r.finishLogin({ phone: "13900139000", code }), 401, "验证码不对或过期了");
  const done = ok(r.finishLogin({ phone: "+86 138-0013-8000", code }));
  assert.match(done.person, /^p-[0-9a-f]{10}$/);
  assert.equal(done.new, true);
  assert.deepEqual([r.verify(done.token).speaker, r.verify(done.token).scope], [`person:${done.person}`, "person"]);
  bad(r.finishLogin({ phone: "13800138000", code }), 401, "验证码不对或过期了");
  ok(r.startLogin({ phone: "13800138000" }));
  assert.equal(r.startLogin({ phone: "13800138000" }).ok, true);
  bad(r.startLogin({ phone: "13800138000" }), 429, "验证码发得太频繁，过十分钟再试");
  r.advance(10 * 60_000);
  const again = ok(r.startLogin({ phone: "13800138000" }));
  assert.equal(again.known, true);
  const second = ok(r.finishLogin({ phone: "13800138000", code: codeIn(r.texts[r.texts.length - 1]) }));
  assert.deepEqual([second.person, second.new], [done.person, false]);
  ok(r.startLogin({ phone: "13700137000" }));
  const stale = codeIn(r.texts[r.texts.length - 1]);
  r.advance(10 * 60_000);
  bad(r.finishLogin({ phone: "13700137000", code: stale }), 401, "验证码不对或过期了");
  const net = relay();
  for (let i = 0; i < 10; i++) ok(net.startLogin({ phone: `+1415555${String(1000 + i)}` }, "10.9.9.9"));
  bad(net.startLogin({ phone: "+14155552000" }, "10.9.9.9"), 429);
  ok(net.startLogin({ phone: "+14155552000" }, "10.9.9.8"));
  ok(r.startLogin({ phone: "+14155550100", lang: "en" }));
  assert.match(r.texts[r.texts.length - 1].text, /^Gemsbang code \d{6}, valid for 10 minutes\./);
  const disk = allText(r.root);
  assert.ok(!disk.includes("13800138000") && !disk.includes("8613700137000"), "no number on disk in the clear");
});

test("a relay given no texter writes the code to a file under its own folder", () => {
  const r = new AvatarRelay({ root: mkdtempSync(join(tmpdir(), "gemsbang-relay-")), name: "relay.test" });
  ok(r.startLogin({ phone: "13800138000" }));
  const files = readdirSync(join(r.root, "_relay", "texts"));
  assert.equal(files.length, 1);
  assert.match(readFileSync(join(r.root, "_relay", "texts", files[0]), "utf8"), /^To: \+8613800138000\n\nGemsbang 验证码 \d{6}，10 分钟内有效。/);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run build && node --test test/avatar-login.test.mjs`

Expected: the build passes; the test file cannot load its module (`ERR_MODULE_NOT_FOUND`), so `ℹ fail 1`.

- [ ] **Step 3: Write the code**

**Create `src/relay/avatars.ts`:**

```ts
// gemsbang's relay (spec §4, §5; transport §2): people, the avatars that are
// their accounts, the groups and two-person talks the avatars are in, and
// what they say there. A person lives under `_relay` only: their phone as a
// salted hash, their default name, which avatars are theirs. No answer to a
// client ever names the person behind an avatar (§5 rule 4). An avatar's card
// (`<avatar>/avatar.geml`) is public; its rules and its list of venues are
// its own and its person's; a venue is its members'. Every message is
// stamped with the avatar that said it and `by`, the person typing or an
// agent holding the avatar's token; others see `by` only when that avatar
// marks (§5 rule 1). It shares the store, the chain and the tokens with the
// older Relay (relay.ts) and touches none of that one's documents. A refusal
// is a code and its parameters (§7.6), with its words in Chinese beside it
// for whoever has no language to ask in; words.ts says it in the others.
import { createHash, randomBytes, randomInt } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeText, type DataBlock } from "../core/im/chain.js";
import type { JsonValue } from "../core/schema.js";
import { nameFault, randomName } from "../core/avatar/names.js";
import { CODE_RE, CODE_TTL_MS, CODES_PER_IP_HOUR, CODES_PER_PHONE, codeText, hashPhone, normalizePhone, tailOf } from "../core/avatar/phone.js";
import { DEFAULT_RULES, withRules, type Rules } from "../core/avatar/rules.js";
import { AVATAR_ID, avatarSpeaker, parseWho, VENUE_ID, type By } from "../core/avatar/who.js";
import { DEFAULT_LANG, isLang, say, type Fault, type Lang } from "../core/avatar/words.js";
import { appendBlock, appendSealed, BLOCK_ID, DOC, nextId, readDoc, RELAY_OWNER, sealed } from "./store.js";
import { fileTexter, type Texter } from "./text.js";
import { hashToken, issueToken, verifyToken, type TokenRecord } from "./tokens.js";

export interface AvatarRelayOptions { root: string; name: string; now?: () => string; texter?: Texter; rand?: () => number }
/** A refusal: the status, the code and its parameters, and the code's words in Chinese. */
export type Fail = { ok: false; status: number; code: string; params?: Record<string, string | number>; reason: string };
export type Result<T> = ({ ok: true } & T) | Fail;
export type Issued = { token: string; record: TokenRecord };
export interface AvatarCard { id: string; name: string }
export type VenueKind = "group" | "dm";
export interface VenueView { owner: string; id: string; kind: VenueKind; name: string; members: AvatarCard[] }
/** A venue as one of the person's avatars is in it. */
export interface MyVenue extends VenueView { as: string }
export interface Visible { id: string; value: Record<string, JsonValue> }
export interface Pushed { owner: string; doc: string; block: DataBlock }

const fail = (status: number, code: string, params?: Record<string, string | number>): Fail => ({ ok: false, status, code, ...(params !== undefined ? { params } : {}), reason: say(code, DEFAULT_LANG, params) });
const refuse = (status: number, f: Fault): Fail => fail(status, f.code, f.params);
const isFail = (x: object): x is Fail => (x as Fail).ok === false;
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const obj = (v: unknown): Record<string, unknown> | undefined => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);
const hex = (bytes: number): string => randomBytes(bytes).toString("hex");
const ONE_HOUR_MS = 3_600_000;
/** The relay's own records, under `_relay`: the phone→person map, the codes, the avatar→person map, the salt. */
const PHONES = "avatar-phones.geml", CODES = "avatar-codes.geml", OWNERS = "avatar-owners.geml", SALT = "avatar-salt.txt";
const peopleDoc = (person: string): string => `people/${person}.geml`;
const venueDoc = (venue: string): string => `venues/${venue}.geml`;
const VENUE_DOC = /^venues\/([gd]-[0-9a-f]{10})\.geml$/;
/** Ids the relay writes in a venue; a client's message may not take one. */
const RESERVED = /^(venue|member|msg|sys)(-|$)/;
export const TEXT_MAX = 4000;
export const GROUP_NAME_MAX = 40;

export class AvatarRelay {
  readonly root: string;
  readonly name: string;
  private readonly clock: () => string;
  private readonly texter: Texter;
  private readonly rand: () => number;
  private readonly listeners = new Set<(p: Pushed) => void>();

  constructor(o: AvatarRelayOptions) {
    this.root = o.root;
    this.name = o.name;
    this.texter = o.texter ?? fileTexter(o.root);
    this.rand = o.rand ?? Math.random;
    this.clock = o.now ?? (() => new Date().toISOString().replace(/\.\d{3}Z$/, "Z"));
  }

  now(): string { return this.clock(); }
  /** Hear of every block appended; the function given back stops it. */
  onAppend(fn: (p: Pushed) => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private emit(owner: string, doc: string, block: DataBlock): void { for (const fn of this.listeners) fn({ owner, doc, block }); }
  verify(token: string): TokenRecord | undefined { return verifyToken(this.root, token); }

  /** The salt of the phone hashes, made once: a hash of a phone number without it could be undone by trying every number. */
  private salt(): string {
    const dir = join(this.root, RELAY_OWNER), path = join(dir, SALT);
    if (!existsSync(path)) {
      mkdirSync(dir, { recursive: true });
      try { writeFileSync(path, hex(16), { flag: "wx" }); } catch { /* another writer made it first */ }
    }
    return readFileSync(path, "utf8").trim();
  }

  // --- login (spec §6.2) ---

  /** A code texted to the number, in the language asked in: three to a number in ten minutes, ten to a network in an hour; whether the number is known, and its last four digits. */
  startLogin(body: unknown, ip?: string): Result<{ sent: true; known: boolean; tail: string }> {
    const phone = normalizePhone(obj(body)?.["phone"]);
    const asked = obj(body)?.["lang"];
    const lang: Lang = isLang(asked) ? asked : DEFAULT_LANG;
    if (phone === undefined) return fail(400, "phone.required");
    const h = hashPhone(phone, this.salt());
    const now = this.now(), t = Date.parse(now);
    const age = (b: DataBlock): number => t - Date.parse(str(b.value["at"]) ?? "");
    const recent = readDoc(this.root, RELAY_OWNER, CODES).blocks.filter((b) => /^code-\d+$/.test(b.id) && age(b) < ONE_HOUR_MS);
    if (recent.filter((b) => b.value["phone"] === h && age(b) < CODE_TTL_MS).length >= CODES_PER_PHONE) return fail(429, "code.tooMany");
    if (ip !== undefined && recent.filter((b) => b.value["ip"] === ip).length >= CODES_PER_IP_HOUR) return fail(429, "code.tooMany");
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    appendBlock(this.root, RELAY_OWNER, CODES, nextId("code"), (_d, prev, id) => sealed({ id, phone: h, code: hashToken(`${h}:${code}`), at: now, ...(ip !== undefined ? { ip } : {}) }, prev));
    try { void Promise.resolve(this.texter({ to: phone, text: codeText(code, lang) })).catch(() => { /* the operator's route failed; the next code tries again */ }); } catch { /* the same */ }
    return { ok: true, sent: true, known: this.personByPhone(h) !== undefined, tail: tailOf(phone) };
  }

  private personByPhone(h: string): string | undefined {
    const b = readDoc(this.root, RELAY_OWNER, PHONES).blocks.find((x) => x.id === `phone-${h.slice(7, 31)}`);
    return b === undefined ? undefined : str(b.value["person"]);
  }

  /** The code checked: a person's token; a number seen for the first time becomes a person in the language they logged in with, with no avatar yet (one grows with the first venue, §6.2). */
  finishLogin(body: unknown): Result<{ token: string; person: string; new: boolean }> {
    const o = obj(body) ?? {};
    const phone = normalizePhone(o["phone"]);
    if (phone === undefined) return fail(400, "phone.required");
    const code = str(o["code"]);
    if (code === undefined || !CODE_RE.test(code)) return fail(400, "code.short");
    const h = hashPhone(phone, this.salt()), now = this.now(), t = Date.parse(now);
    const d = readDoc(this.root, RELAY_OWNER, CODES);
    const used = new Set(d.blocks.filter((b) => /^used-\d+$/.test(b.id)).map((b) => b.value["code"]));
    const want = hashToken(`${h}:${code}`);
    const hit = d.blocks.find((b) => /^code-\d+$/.test(b.id) && b.value["phone"] === h && b.value["code"] === want && !used.has(b.id) && t - Date.parse(str(b.value["at"]) ?? "") < CODE_TTL_MS);
    if (hit === undefined) return fail(401, "code.wrong");
    appendBlock(this.root, RELAY_OWNER, CODES, nextId("used"), (_d, prev, id) => sealed({ id, code: hit.id, at: now }, prev));
    const candidate = `p-${hex(5)}`;
    const mapped = appendSealed(this.root, RELAY_OWNER, PHONES, `phone-${h.slice(7, 31)}`, { phone: h, person: candidate, at: now });
    const person = str(mapped.block.value["person"]) ?? candidate;
    const asked = o["lang"];
    if (!mapped.existed) appendSealed(this.root, RELAY_OWNER, peopleDoc(person), "person", { phone: h, lang: isLang(asked) ? asked : DEFAULT_LANG, at: now });
    const { token } = issueToken(this.root, { speaker: `person:${person}`, scope: "person", by: "login", at: now });
    return { ok: true, token, person, new: !mapped.existed };
  }
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npm run build && node --test test/avatar-login.test.mjs`

Expected: `ℹ pass 2`, `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add test/avatar-login.test.mjs src/relay/avatars.ts
git commit -m "gemsbang P7: the avatar relay logs a person in by phone, in their language"
```


### Task 8: The relay: the person, the avatars, their rules and tokens

**Files:**
- Modify: `src/relay/avatars.ts` (sections the person, avatars, tokens)
- Test: `test/avatar-accounts.test.mjs`

- [ ] **Step 1: Write the failing test**

**Create `test/avatar-accounts.test.mjs`:**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AvatarRelay } from "../dist/relay/avatars.js";

const BASE = Date.UTC(2026, 10, 1, 9, 0, 0);
/** A relay whose clock starts at 09:00 and moves a second per look; its texts are kept; `advance` moves the clock further. */
function relay(o = {}) {
  let offset = 0;
  const texts = [];
  const now = () => { const t = new Date(BASE + offset).toISOString().replace(/\.\d{3}Z$/, "Z"); offset += 1000; return t; };
  const r = new AvatarRelay({ root: mkdtempSync(join(tmpdir(), "gemsbang-relay-")), name: "relay.test", now, texter: (t) => { texts.push(t); }, ...o });
  r.texts = texts;
  r.advance = (ms) => { offset += ms; };
  return r;
}
const ok = (x) => { assert.equal(x.ok, true, x.reason); return x; };
const bad = (x, status, reason) => { assert.equal(x.ok, false); assert.equal(x.status, status, x.reason); if (reason !== undefined) assert.equal(x.reason, reason); return x; };
const codeIn = (t) => /(\d{6})/.exec(t.text)[1];
/** A person logged in by the number: their token's record and their id. */
function login(r, phone) {
  ok(r.startLogin({ phone }));
  const done = ok(r.finishLogin({ phone, code: codeIn(r.texts[r.texts.length - 1]) }));
  return { by: r.verify(done.token), person: done.person, token: done.token };
}

test("avatars (spec §6.4, §6.5): one grows with the name given, else a random one in the person's language (the one they logged in with, or chose), never the default name unasked; a rename changes that card alone; only the person does either; a new person has none", () => {
  const r = relay({ rand: () => 0 });
  const john = login(r, "13800138000");
  assert.deepEqual(r.avatarsOf(john.person), [], "a new person has no avatar yet");
  const first = ok(r.growAvatar(john.by, {})).avatar;
  assert.match(first.id, /^a-[0-9a-f]{10}$/);
  assert.equal(first.name, "云朵 10");
  ok(r.setDefaultName(john.by, { name: " John " }));
  assert.equal(r.defaultNameOf(john.person), "John");
  const work = ok(r.growAvatar(john.by, {})).avatar;
  assert.equal(work.name, "云朵 10", "the default name is a suggestion, never used unasked");
  ok(r.rename(john.by, work.id, { name: "John" }));
  const lily = ok(r.growAvatar(john.by, { name: "Lily 爸爸" })).avatar;
  assert.equal(bad(r.growAvatar(john.by, { name: "" }), 400, "名字不能是空的").code, "name.empty");
  assert.deepEqual(bad(r.growAvatar(john.by, { name: "长".repeat(25) }), 400, "名字最多 24 个字").params, { max: 24 });
  ok(r.setDefaultName(john.by, { name: null }));
  assert.equal(r.defaultNameOf(john.person), undefined);
  assert.deepEqual(r.avatarsOf(john.person).map((a) => a.name), ["云朵 10", "John", "Lily 爸爸"]);
  ok(r.startLogin({ phone: "+14155550100", lang: "en" }));
  const en = ok(r.finishLogin({ phone: "+14155550100", code: codeIn(r.texts[r.texts.length - 1]), lang: "en" }));
  assert.equal(r.languageOf(en.person), "en", "a person keeps the language they logged in with");
  assert.equal(r.languageOf(john.person), "zh");
  ok(r.setLanguage(john.by, { lang: "en" }));
  assert.equal(ok(r.growAvatar(john.by, {})).avatar.name, "Cloud 10", "a random name in the person's language");
  assert.equal(bad(r.setLanguage(john.by, { lang: "fr" }), 400, "不支持这种语言").code, "lang.unknown");
  ok(r.rename(john.by, first.id, { name: "陈太太" }));
  assert.deepEqual(r.avatarsOf(john.person).map((a) => a.name), ["陈太太", "John", "Lily 爸爸", "Cloud 10"]);
  const zhang = login(r, "13900139000");
  bad(r.rename(zhang.by, first.id, { name: "x" }), 403, "这不是你的分身");
  const lilyToken = r.verify(ok(r.issueAvatar(john.by, lily.id)).token);
  bad(r.growAvatar(lilyToken, {}), 403, "只有本人能这么做");
  bad(r.rename(lilyToken, lily.id, { name: "x" }), 403);
});

test("tokens: an avatar's token is issued by its person and speaks as the avatar, by an agent; a device's token cannot grow an avatar or issue another device; another person cannot issue one for an avatar not theirs", () => {
  const r = relay();
  const john = login(r, "13800138000");
  const zhang = login(r, "13900139000");
  const a = ok(r.growAvatar(john.by, { name: "John" })).avatar;
  const issued = ok(r.issueAvatar(john.by, a.id));
  assert.deepEqual([issued.record.speaker, issued.record.scope], [`avatar:${a.id}`, "avatar"]);
  bad(r.issueAvatar(zhang.by, a.id), 403, "这不是你的分身");
  const device = ok(r.issueDevice(john.by));
  assert.deepEqual([device.record.speaker, device.record.scope], [`person:${john.person}`, "device"]);
  bad(r.issueDevice(device.record), 403);
  bad(r.growAvatar(device.record, {}), 403);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run build && node --test test/avatar-accounts.test.mjs`

Expected: the build passes; both tests throw `TypeError` (`r.avatarsOf is not a function`, `r.growAvatar is not a function`), so `ℹ fail 2`.

- [ ] **Step 3: Write the code**

**Insert into `src/relay/avatars.ts`, before the class's closing brace (the file's last line), one blank line after the method above it:**

```ts
  // --- the person ---

  /** The person a person's token stands for; undefined for any other token. */
  personOf(by: TokenRecord): string | undefined {
    if (by.scope !== "person" && by.scope !== "device") return undefined;
    const w = parseWho(by.speaker);
    return w?.kind === "person" ? w.id : undefined;
  }

  private onlyPerson(by: TokenRecord): string | Fail {
    const person = by.scope === "person" ? this.personOf(by) : undefined;
    return person ?? fail(403, "person.only");
  }

  /** The person's language (spec §7.6): the latest chosen, else the one they first logged in with. */
  languageOf(person: string): Lang {
    let lang: Lang = DEFAULT_LANG;
    for (const b of readDoc(this.root, RELAY_OWNER, peopleDoc(person)).blocks) {
      const v = b.value["lang"];
      if ((b.id === "person" || /^lang-\d+$/.test(b.id)) && isLang(v)) lang = v;
    }
    return lang;
  }

  setLanguage(by: TokenRecord, body: unknown): Result<{ lang: Lang }> {
    const person = this.onlyPerson(by);
    if (typeof person !== "string") return person;
    const lang = obj(body)?.["lang"];
    if (!isLang(lang)) return fail(400, "lang.unknown");
    appendBlock(this.root, RELAY_OWNER, peopleDoc(person), nextId("lang"), (_d, prev, id) => sealed({ id, lang, at: this.now() }, prev));
    return { ok: true, lang };
  }

  /** The person's default name (spec §6.5), the latest set; null clears it. It is only ever offered as a suggestion. */
  defaultNameOf(person: string): string | undefined {
    let name: string | undefined;
    for (const b of readDoc(this.root, RELAY_OWNER, peopleDoc(person)).blocks) if (/^default-\d+$/.test(b.id)) name = str(b.value["name"]);
    return name;
  }

  setDefaultName(by: TokenRecord, body: unknown): Result<{ name?: string }> {
    const person = this.onlyPerson(by);
    if (typeof person !== "string") return person;
    const v = obj(body)?.["name"];
    if (v !== null) { const f = nameFault(v); if (f !== undefined) return refuse(400, f); }
    const name = v === null ? null : (v as string).trim();
    appendBlock(this.root, RELAY_OWNER, peopleDoc(person), nextId("default"), (_d, prev, id) => sealed({ id, name, at: this.now() }, prev));
    return name === null ? { ok: true } : { ok: true, name };
  }

  // --- avatars ---

  /** The avatar's public card: its id and its latest name. */
  card(avatar: string): AvatarCard | undefined {
    if (!AVATAR_ID.test(avatar)) return undefined;
    let name: string | undefined;
    for (const b of readDoc(this.root, avatar, "avatar.geml").blocks) if (b.id === "avatar" || /^name-\d+$/.test(b.id)) name = str(b.value["name"]) ?? name;
    return name === undefined ? undefined : { id: avatar, name };
  }

  /** The person's avatars, oldest first. */
  avatarsOf(person: string): AvatarCard[] {
    const out: AvatarCard[] = [];
    for (const b of readDoc(this.root, RELAY_OWNER, peopleDoc(person)).blocks) {
      if (!/^avatar-\d+$/.test(b.id)) continue;
      const c = this.card(str(b.value["avatar"]) ?? "");
      if (c !== undefined) out.push(c);
    }
    return out;
  }

  /** The person behind an avatar: the relay's own lookup, never answered to a client (§5 rule 4). */
  private ownerOf(avatar: string): string | undefined {
    const b = readDoc(this.root, RELAY_OWNER, OWNERS).blocks.find((x) => x.id === `owner-${avatar}`);
    return b === undefined ? undefined : str(b.value["person"]);
  }

  /** A new avatar of the person (spec §6.4, §6.5): the name given when they joined, else a random one in their language; the default name is never used unasked. */
  growAvatar(by: TokenRecord, body: unknown): Result<{ avatar: AvatarCard }> {
    const person = this.onlyPerson(by);
    if (typeof person !== "string") return person;
    const given = obj(body)?.["name"];
    if (given !== undefined) { const f = nameFault(given); if (f !== undefined) return refuse(400, f); }
    const name = typeof given === "string" ? given.trim() : randomName(this.rand, this.languageOf(person));
    const avatar = `a-${hex(5)}`, now = this.now();
    appendSealed(this.root, RELAY_OWNER, OWNERS, `owner-${avatar}`, { person, at: now });
    appendBlock(this.root, RELAY_OWNER, peopleDoc(person), nextId("avatar"), (_d, prev, id) => sealed({ id, avatar, at: now }, prev));
    const made = appendSealed(this.root, avatar, "avatar.geml", "avatar", { name, at: now });
    this.emit(avatar, "avatar.geml", made.block);
    return { ok: true, avatar: { id: avatar, name } };
  }

  private onlyOwner(by: TokenRecord, avatar: string): Fail | undefined {
    const person = this.onlyPerson(by);
    if (typeof person !== "string") return person;
    return this.ownerOf(avatar) === person ? undefined : fail(403, "avatar.notYours");
  }

  /** A new name for one of the person's avatars; only that avatar's card changes. */
  rename(by: TokenRecord, avatar: string, body: unknown): Result<{ avatar: AvatarCard }> {
    const refused = this.onlyOwner(by, avatar);
    if (refused !== undefined) return refused;
    const v = obj(body)?.["name"];
    const f = nameFault(v);
    if (f !== undefined) return refuse(400, f);
    const name = (v as string).trim();
    const a = appendBlock(this.root, avatar, "avatar.geml", nextId("name"), (_d, prev, id) => sealed({ id, name, at: this.now() }, prev));
    this.emit(avatar, "avatar.geml", a.block);
    return { ok: true, avatar: { id: avatar, name } };
  }

  /** The avatar's rules (spec §8.1): the defaults, then each change in turn. */
  rulesOf(avatar: string): Rules {
    let rules = DEFAULT_RULES;
    for (const b of readDoc(this.root, avatar, "rules.geml").blocks) {
      if (!/^rules-\d+$/.test(b.id)) continue;
      const next = withRules(rules, { mark: b.value["mark"], borrow: b.value["borrow"] });
      if (!("code" in next)) rules = next;
    }
    return rules;
  }

  setRules(by: TokenRecord, avatar: string, body: unknown): Result<{ rules: Rules }> {
    const refused = this.onlyOwner(by, avatar);
    if (refused !== undefined) return refused;
    const next = withRules(this.rulesOf(avatar), body);
    if ("code" in next) return refuse(400, next);
    appendBlock(this.root, avatar, "rules.geml", nextId("rules"), (_d, prev, id) => sealed({ id, mark: next.mark, borrow: next.borrow, at: this.now() }, prev));
    return { ok: true, rules: next };
  }

  // --- tokens ---

  /** One of the person's avatars' token, for an agent that plays it (the hosted one, or one attached on a machine): it speaks as the avatar, `by` an agent. */
  issueAvatar(by: TokenRecord, avatar: string): Result<Issued> {
    const refused = this.onlyOwner(by, avatar);
    if (refused !== undefined) return refused;
    return { ok: true, ...issueToken(this.root, { speaker: avatarSpeaker(avatar), scope: "avatar", by: by.speaker, at: this.now() }) };
  }

  /** A device's token: the agent the person attached on one machine, which may only ask for an avatar's token once the person agrees (spec §6.3). */
  issueDevice(by: TokenRecord): Result<Issued> {
    const person = this.onlyPerson(by);
    if (typeof person !== "string") return person;
    return { ok: true, ...issueToken(this.root, { speaker: by.speaker, scope: "device", by: by.speaker, at: this.now() }) };
  }

  /** The avatar a token acts as and how: an avatar's token is that avatar's agent; a person's token names one of the person's avatars in `as`. */
  private acting(by: TokenRecord, as: unknown): { avatar: string; by: By } | Fail {
    if (by.scope === "avatar") {
      const w = parseWho(by.speaker);
      if (w?.kind !== "avatar") return fail(403, "token.wrong");
      if (as !== undefined && as !== w.id) return fail(403, "token.ownAvatar");
      return { avatar: w.id, by: "agent" };
    }
    if (by.scope === "person") {
      if (typeof as !== "string" || !AVATAR_ID.test(as)) return fail(400, "as.required");
      const person = this.personOf(by);
      if (person === undefined || this.ownerOf(as) !== person) return fail(403, "avatar.notYours");
      return { avatar: as, by: "person" };
    }
    return fail(403, "token.mute");
  }

  /** The avatars a token reads for: a person's are all theirs, an avatar's is itself; a device's reads nothing. */
  private mine(by: TokenRecord): string[] {
    const w = parseWho(by.speaker);
    if (by.scope === "avatar") return w?.kind === "avatar" ? [w.id] : [];
    if (by.scope !== "person" || w?.kind !== "person") return [];
    return this.avatarsOf(w.id).map((a) => a.id);
  }
```

- [ ] **Step 4: Run it to see it pass**

Run: `npm run build && node --test test/avatar-accounts.test.mjs`

Expected: `ℹ pass 2`, `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add test/avatar-accounts.test.mjs src/relay/avatars.ts
git commit -m "gemsbang P8: avatars grow, get renamed, carry rules and tokens; nobody learns whose they are"
```


### Task 9: The relay: groups, two-person talk, messages, reading

**Files:**
- Modify: `src/relay/avatars.ts` (sections venues, reading)
- Test: `test/avatar-venues.test.mjs`

- [ ] **Step 1: Write the failing test**

**Create `test/avatar-venues.test.mjs`:**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AvatarRelay } from "../dist/relay/avatars.js";
import { readDoc } from "../dist/relay/store.js";
import { verifyChain } from "../dist/core/im/chain.js";

const BASE = Date.UTC(2026, 10, 1, 9, 0, 0);
/** A relay whose clock starts at 09:00 and moves a second per look; its texts are kept; `advance` moves the clock further. */
function relay(o = {}) {
  let offset = 0;
  const texts = [];
  const now = () => { const t = new Date(BASE + offset).toISOString().replace(/\.\d{3}Z$/, "Z"); offset += 1000; return t; };
  const r = new AvatarRelay({ root: mkdtempSync(join(tmpdir(), "gemsbang-relay-")), name: "relay.test", now, texter: (t) => { texts.push(t); }, ...o });
  r.texts = texts;
  r.advance = (ms) => { offset += ms; };
  return r;
}
const ok = (x) => { assert.equal(x.ok, true, x.reason); return x; };
const bad = (x, status, reason) => { assert.equal(x.ok, false); assert.equal(x.status, status, x.reason); if (reason !== undefined) assert.equal(x.reason, reason); return x; };
const codeIn = (t) => /(\d{6})/.exec(t.text)[1];
/** A person logged in by the number: their token's record and their id. */
function login(r, phone) {
  ok(r.startLogin({ phone }));
  const done = ok(r.finishLogin({ phone, code: codeIn(r.texts[r.texts.length - 1]) }));
  return { by: r.verify(done.token), person: done.person, token: done.token };
}

test("groups (spec §6, §7.2): made by an avatar, its owner; the owner pulls avatars in; only members say and read; a message carries the avatar and `by`, chained; a client's id makes a resend a no-op; the relay's ids, an empty or long text, a reply to nothing are refused; the person sees every venue of every avatar with the one in it", () => {
  const r = relay();
  const john = login(r, "13800138000");
  const li = login(r, "13900139000");
  const wang = login(r, "13700137000");
  const johnWork = ok(r.growAvatar(john.by, { name: "John" })).avatar;
  const lily = ok(r.growAvatar(john.by, { name: "Lily 爸爸" })).avatar;
  const liA = ok(r.growAvatar(li.by, { name: "李四" })).avatar;
  const wangA = ok(r.growAvatar(wang.by, { name: "王五" })).avatar;
  bad(r.createGroup(john.by, { name: "x" }), 400, "要说明以哪个分身");
  bad(r.createGroup(john.by, { as: liA.id, name: "x" }), 403, "这不是你的分身");
  bad(r.createGroup(john.by, { as: johnWork.id, name: " " }), 400, "群要有个名字");
  const g = ok(r.createGroup(john.by, { as: johnWork.id, name: "设置页改版" })).venue;
  assert.match(g.id, /^g-[0-9a-f]{10}$/);
  assert.deepEqual([g.owner, g.kind, g.name, g.members.map((m) => m.name)], [johnWork.id, "group", "设置页改版", ["John"]]);
  bad(r.addMember(li.by, g.owner, g.id, { as: liA.id, avatar: liA.id }), 403, "只有群主能拉人");
  ok(r.addMember(john.by, g.owner, g.id, { as: johnWork.id, avatar: liA.id }));
  const liToken = r.verify(ok(r.issueAvatar(li.by, liA.id)).token);
  const said = ok(r.say(john.by, g.owner, g.id, { as: johnWork.id, text: "稿子在这\r\n周五前要定  ", id: "m-1" }));
  assert.deepEqual([said.message.speaker, said.message.by, said.message.text, said.existed], [`avatar:${johnWork.id}`, "person", "稿子在这\n周五前要定", false]);
  assert.equal(ok(r.say(john.by, g.owner, g.id, { as: johnWork.id, text: "again", id: "m-1" })).existed, true);
  const agent = ok(r.say(liToken, g.owner, g.id, { text: "收到，周五前给反馈", replyTo: "m-1" }));
  assert.deepEqual([agent.message.id, agent.message.speaker, agent.message.by, agent.message.replyTo], ["msg-1", `avatar:${liA.id}`, "agent", "m-1"]);
  bad(r.say(wang.by, g.owner, g.id, { as: wangA.id, text: "hi" }), 403, "不在这个群里");
  bad(r.read(wang.by, g.owner, `venues/${g.id}.geml`), 403);
  bad(r.say(john.by, g.owner, g.id, { as: johnWork.id, text: "x", id: "member-9" }), 400, "消息 id 不合法");
  bad(r.say(john.by, g.owner, g.id, { as: johnWork.id, text: "  " }), 400, "说点什么");
  bad(r.say(john.by, g.owner, g.id, { as: johnWork.id, text: "长".repeat(4001) }), 400, "一条最多 4000 个字");
  bad(r.say(john.by, g.owner, g.id, { as: johnWork.id, text: "x", replyTo: "m-404" }), 400, "回复的那条不在这个群里");
  const d = readDoc(r.root, g.owner, `venues/${g.id}.geml`);
  assert.deepEqual(d.blocks.map((b) => b.id), ["venue", "member-1", "member-2", "m-1", "msg-1"]);
  assert.deepEqual(verifyChain(d.blocks), []);
  const read = ok(r.read(li.by, g.owner, `venues/${g.id}.geml`));
  assert.equal(read.blocks.find((b) => b.id === "msg-1").value.by, "agent");
  ok(r.createGroup(john.by, { as: lily.id, name: "三年二班家长" }));
  assert.deepEqual(r.venuesOf(john.person).map((v) => [v.name, v.as]), [["设置页改版", johnWork.id], ["三年二班家长", lily.id]]);
  assert.deepEqual(r.venuesOf(li.person).map((v) => [v.name, v.as]), [["设置页改版", liA.id]]);
  bad(r.read(li.by, lily.id, "joined.geml"), 403);
  assert.deepEqual(ok(r.read(john.by, lily.id, "joined.geml")).blocks.map((b) => b.id), ["join-1"]);
});

test("marking (spec §5 rule 1, §8.1): every message records `by`; when the avatar does not mark, the others in the venue see no `by` on its lines, while its own person still does; only the person changes the rule", () => {
  const r = relay();
  const john = login(r, "13800138000");
  const wang = login(r, "13700137000");
  const lily = ok(r.growAvatar(john.by, { name: "Lily 爸爸" })).avatar;
  const teacher = ok(r.growAvatar(wang.by, { name: "王老师" })).avatar;
  const g = ok(r.createGroup(wang.by, { as: teacher.id, name: "三年二班家长" })).venue;
  ok(r.addMember(wang.by, g.owner, g.id, { as: teacher.id, avatar: lily.id }));
  const lilyAgent = r.verify(ok(r.issueAvatar(john.by, lily.id)).token);
  ok(r.say(lilyAgent, g.owner, g.id, { text: "我帮 John 记下了", id: "m-a" }));
  ok(r.say(john.by, g.owner, g.id, { as: lily.id, text: "周五我可以去", id: "m-p" }));
  const seen = (by) => Object.fromEntries(ok(r.read(by, g.owner, `venues/${g.id}.geml`)).blocks.filter((b) => b.id.startsWith("m-")).map((b) => [b.id, b.value.by]));
  assert.deepEqual(seen(wang.by), { "m-a": "agent", "m-p": "person" });
  bad(r.setRules(wang.by, lily.id, { mark: false }), 403, "这不是你的分身");
  bad(r.setRules(john.by, lily.id, { mark: "no" }), 400, "mark 要是 true 或 false");
  assert.deepEqual(ok(r.setRules(john.by, lily.id, { mark: false })).rules, { mark: false, borrow: ["read", "edit", "test"] });
  assert.deepEqual(seen(wang.by), { "m-a": undefined, "m-p": undefined });
  assert.deepEqual(seen(john.by), { "m-a": "agent", "m-p": "person" });
  assert.deepEqual(seen(lilyAgent), { "m-a": "agent", "m-p": "person" });
  assert.equal(readDoc(r.root, g.owner, `venues/${g.id}.geml`).blocks.find((b) => b.id === "m-a").value.by, "agent", "the record keeps it");
  assert.deepEqual(ok(r.read(john.by, lily.id, "rules.geml")).blocks.map((b) => b.value.mark), [false]);
  bad(r.read(wang.by, lily.id, "rules.geml"), 403);
});

test("two-person talk (spec §6.6): opened from a group the two share, one per pair whoever opens it, named after the other side; not with a stranger", () => {
  const r = relay();
  const john = login(r, "13800138000");
  const li = login(r, "13900139000");
  const wang = login(r, "13700137000");
  const j = ok(r.growAvatar(john.by, { name: "John" })).avatar;
  const l = ok(r.growAvatar(li.by, { name: "李四" })).avatar;
  const w = ok(r.growAvatar(wang.by, { name: "王五" })).avatar;
  const g = ok(r.createGroup(john.by, { as: j.id, name: "设置页改版" })).venue;
  ok(r.addMember(john.by, g.owner, g.id, { as: j.id, avatar: l.id }));
  bad(r.openDm(john.by, { as: j.id, with: w.id }), 403, "要先在同一个群里");
  bad(r.openDm(john.by, { as: j.id, with: j.id }), 404);
  const dm = ok(r.openDm(john.by, { as: j.id, with: l.id })).venue;
  assert.match(dm.id, /^d-[0-9a-f]{10}$/);
  assert.deepEqual([dm.kind, dm.name, dm.members.map((m) => m.name).sort()], ["dm", "李四", ["John", "李四"].sort()]);
  const back = ok(r.openDm(li.by, { as: l.id, with: j.id })).venue;
  assert.deepEqual([back.owner, back.id, back.name], [dm.owner, dm.id, "John"]);
  ok(r.say(li.by, dm.owner, dm.id, { as: l.id, text: "周五前能给反馈吗？" }));
  assert.deepEqual(r.venuesOf(john.person).map((v) => [v.kind, v.name]), [["group", "设置页改版"], ["dm", "李四"]]);
  bad(r.addMember(john.by, dm.owner, dm.id, { as: j.id, avatar: w.id }), 400, "两个人的私聊不能加人");
});

test("pushes: every block the relay appends is heard, once; a resend is not", () => {
  const r = relay();
  const heard = [];
  const stop = r.onAppend((p) => heard.push(`${p.doc}#${p.block.id}`));
  const john = login(r, "13800138000");
  const j = ok(r.growAvatar(john.by, { name: "John" })).avatar;
  const g = ok(r.createGroup(john.by, { as: j.id, name: "x" })).venue;
  ok(r.say(john.by, g.owner, g.id, { as: j.id, text: "hi", id: "m-1" }));
  ok(r.say(john.by, g.owner, g.id, { as: j.id, text: "hi", id: "m-1" }));
  stop();
  ok(r.say(john.by, g.owner, g.id, { as: j.id, text: "after" }));
  assert.deepEqual(heard, ["avatar.geml#avatar", `venues/${g.id}.geml#venue`, `venues/${g.id}.geml#member-1`, "joined.geml#join-1", `venues/${g.id}.geml#m-1`]);
});

test("reading an avatar's card: anyone may, and it names no person; the relay's own records are never read", () => {
  const r = relay();
  const john = login(r, "13800138000");
  const zhang = login(r, "13900139000");
  const lily = ok(r.growAvatar(john.by, { name: "Lily 爸爸" })).avatar;
  ok(r.rename(john.by, lily.id, { name: "Lily 的爸爸" }));
  const card = ok(r.read(zhang.by, lily.id, "avatar.geml"));
  assert.deepEqual(card.blocks.map((b) => [b.id, b.value.name]), [["avatar", "Lily 爸爸"], ["name-1", "Lily 的爸爸"]]);
  assert.ok(!JSON.stringify(card.blocks).includes(john.person), "the card names no person");
  bad(r.read(zhang.by, "_relay", "avatar-owners.geml"), 404);
  bad(r.read(zhang.by, lily.id, "nothing.geml"), 404);
});

test("a device's token says nothing and reads no venue: it may only ask for an avatar's token (plan Q)", () => {
  const r = relay();
  const john = login(r, "13800138000");
  const a = ok(r.growAvatar(john.by, { name: "John" })).avatar;
  const device = ok(r.issueDevice(john.by)).record;
  const g = ok(r.createGroup(john.by, { as: a.id, name: "设置页改版" })).venue;
  bad(r.say(device, g.owner, g.id, { text: "hi" }), 403, "这个令牌不能说话");
  bad(r.read(device, g.owner, `venues/${g.id}.geml`), 403);
  bad(r.createGroup(device, { as: a.id, name: "x" }), 403, "这个令牌不能说话");
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run build && node --test test/avatar-venues.test.mjs`

Expected: the build passes; all six tests throw `TypeError` (`r.createGroup is not a function`, `r.read is not a function`), so `ℹ fail 6`.

- [ ] **Step 3: Write the code**

**Insert into `src/relay/avatars.ts`, before the class's closing brace (the file's last line), one blank line after the method above it:**

```ts
  // --- venues ---

  private venueState(owner: string, venue: string): { kind: VenueKind; name: string; members: string[] } | undefined {
    if (!AVATAR_ID.test(owner) || !VENUE_ID.test(venue)) return undefined;
    const d = readDoc(this.root, owner, venueDoc(venue));
    const meta = d.blocks.find((b) => b.id === "venue")?.value;
    const kind = str(meta?.["kind"]);
    if (meta === undefined || (kind !== "group" && kind !== "dm")) return undefined;
    const members: string[] = [];
    for (const b of d.blocks) {
      if (!/^member-\d+$/.test(b.id)) continue;
      const w = parseWho(str(b.value["avatar"]) ?? "");
      if (w?.kind === "avatar" && !members.includes(w.id)) members.push(w.id);
    }
    return { kind, name: str(meta["name"]) ?? "", members };
  }

  /** The venue with its members' cards; a two-person talk is named after the other side, as the viewer's avatar sees it. */
  venueView(owner: string, venue: string, as?: string): VenueView | undefined {
    const s = this.venueState(owner, venue);
    if (s === undefined) return undefined;
    const members = s.members.map((m) => this.card(m)).filter((c): c is AvatarCard => c !== undefined);
    const name = s.kind === "dm" ? (members.find((m) => m.id !== as)?.name ?? s.name) : s.name;
    return { owner, id: venue, kind: s.kind, name, members };
  }

  /** The avatar into the venue: a member block in the venue, a join block in the avatar's own list of venues. */
  private join(owner: string, venue: string, avatar: string, by: string): void {
    const now = this.now();
    const m = appendBlock(this.root, owner, venueDoc(venue), nextId("member"), (_d, prev, id) => sealed({ id, avatar: avatarSpeaker(avatar), by, at: now }, prev));
    this.emit(owner, venueDoc(venue), m.block);
    const j = appendBlock(this.root, avatar, "joined.geml", nextId("join"), (_d, prev, id) => sealed({ id, owner, venue, at: now }, prev));
    this.emit(avatar, "joined.geml", j.block);
  }

  /** The venues the avatar is in, from its own list. */
  joinedOf(avatar: string): { owner: string; venue: string }[] {
    const out: { owner: string; venue: string }[] = [];
    for (const b of readDoc(this.root, avatar, "joined.geml").blocks) {
      const owner = str(b.value["owner"]), venue = str(b.value["venue"]);
      if (owner !== undefined && venue !== undefined && !out.some((x) => x.owner === owner && x.venue === venue)) out.push({ owner, venue });
    }
    return out.filter((x) => this.venueState(x.owner, x.venue)?.members.includes(avatar) === true);
  }

  /** A group under the avatar that makes it (spec §7.1), the avatar its first member and its owner (群主). */
  createGroup(by: TokenRecord, body: unknown): Result<{ venue: VenueView }> {
    const o = obj(body) ?? {};
    const a = this.acting(by, o["as"]);
    if (isFail(a)) return a;
    const name = str(o["name"])?.trim();
    if (name === undefined || name === "") return fail(400, "group.name");
    if ([...name].length > GROUP_NAME_MAX) return fail(400, "group.nameTooLong", { max: GROUP_NAME_MAX });
    const venue = `g-${hex(5)}`;
    const made = appendSealed(this.root, a.avatar, venueDoc(venue), "venue", { kind: "group", name, by: avatarSpeaker(a.avatar), at: this.now() });
    this.emit(a.avatar, venueDoc(venue), made.block);
    this.join(a.avatar, venue, a.avatar, avatarSpeaker(a.avatar));
    return { ok: true, venue: this.venueView(a.avatar, venue)! };
  }

  /** Another avatar into a group, by its owner; links (plan Q) are how everyone else comes in. */
  addMember(by: TokenRecord, owner: string, venue: string, body: unknown): Result<{ venue: VenueView }> {
    const s = this.venueState(owner, venue);
    if (s === undefined) return fail(404, "group.missing");
    if (s.kind !== "group") return fail(400, "dm.noAdd");
    const a = this.acting(by, obj(body)?.["as"]);
    if (isFail(a)) return a;
    if (a.avatar !== owner) return fail(403, "group.ownerOnly");
    const who = str(obj(body)?.["avatar"]);
    if (who === undefined || this.card(who) === undefined) return fail(404, "avatar.missing");
    if (!s.members.includes(who)) this.join(owner, venue, who, avatarSpeaker(a.avatar));
    return { ok: true, venue: this.venueView(owner, venue)! };
  }

  /** The two-person talk between the acting avatar and another it shares a group with (spec §6.6): one per pair, under the smaller id. */
  openDm(by: TokenRecord, body: unknown): Result<{ venue: VenueView }> {
    const o = obj(body) ?? {};
    const a = this.acting(by, o["as"]);
    if (isFail(a)) return a;
    const other = str(o["with"]);
    if (other === undefined || other === a.avatar || this.card(other) === undefined) return fail(404, "avatar.missing");
    const shared = this.joinedOf(a.avatar).some((v) => this.venueState(v.owner, v.venue)?.kind === "group" && this.venueState(v.owner, v.venue)?.members.includes(other) === true);
    if (!shared) return fail(403, "dm.sharedGroup");
    const [first, second] = [a.avatar, other].sort() as [string, string];
    const venue = `d-${createHash("sha256").update(`${first}:${second}`, "utf8").digest("hex").slice(0, 10)}`;
    const made = appendSealed(this.root, first, venueDoc(venue), "venue", { kind: "dm", by: avatarSpeaker(a.avatar), at: this.now() });
    if (!made.existed) {
      this.emit(first, venueDoc(venue), made.block);
      this.join(first, venue, first, avatarSpeaker(a.avatar));
      this.join(first, venue, second, avatarSpeaker(a.avatar));
    }
    return { ok: true, venue: this.venueView(first, venue, a.avatar)! };
  }

  /** A message in a venue the acting avatar is in (spec §7.2): stamped with the avatar and `by`; a client's id makes a resend a no-op. */
  say(by: TokenRecord, owner: string, venue: string, body: unknown): Result<{ message: Record<string, JsonValue>; existed: boolean }> {
    const o = obj(body) ?? {};
    const a = this.acting(by, o["as"]);
    if (isFail(a)) return a;
    const s = this.venueState(owner, venue);
    if (s === undefined) return fail(404, "group.missing");
    if (!s.members.includes(a.avatar)) return fail(403, "venue.notMember");
    const text = str(o["text"]);
    if (text === undefined || text.trim() === "") return fail(400, "message.empty");
    if ([...text].length > TEXT_MAX) return fail(400, "message.tooLong", { max: TEXT_MAX });
    const own = str(o["id"]);
    if (own !== undefined && (!BLOCK_ID.test(own) || RESERVED.test(own))) return fail(400, "message.badId");
    const doc = venueDoc(venue);
    const replyTo = str(o["replyTo"]);
    if (replyTo !== undefined && !readDoc(this.root, owner, doc).blocks.some((b) => b.id === replyTo)) return fail(400, "message.badReply");
    const now = this.now();
    const made = appendBlock(this.root, owner, doc, own !== undefined ? () => own : nextId("msg"), (_d, prev, id) => sealed({ id, speaker: avatarSpeaker(a.avatar), by: a.by, text: normalizeText(text), at: now, ...(replyTo !== undefined ? { replyTo } : {}) }, prev));
    if (!made.existed) this.emit(owner, doc, made.block);
    return { ok: true, message: made.block.value, existed: made.existed };
  }

  /** Every venue of every avatar of the person, each with the avatar that is in it. */
  venuesOf(person: string): MyVenue[] {
    const out: MyVenue[] = [];
    for (const a of this.avatarsOf(person)) {
      for (const v of this.joinedOf(a.id)) {
        const view = this.venueView(v.owner, v.venue, a.id);
        if (view !== undefined) out.push({ ...view, as: a.id });
      }
    }
    return out;
  }

  // --- reading ---

  /** A document as the token may see it: an avatar's card is anyone's; a venue is its members', a message's `by` left out where its avatar does not mark (§5 rule 1); anything else under an avatar is that avatar's and its person's. */
  read(by: TokenRecord, owner: string, doc: string): Result<{ blocks: Visible[] }> {
    if (!AVATAR_ID.test(owner) || !DOC.test(doc)) return fail(404, "doc.missing");
    const d = readDoc(this.root, owner, doc);
    if (!d.exists) return fail(404, "doc.missing");
    if (doc === "avatar.geml") return { ok: true, blocks: d.blocks.map((b) => ({ id: b.id, value: b.value })) };
    const mine = this.mine(by);
    const v = VENUE_DOC.exec(doc);
    if (v !== null) {
      const s = this.venueState(owner, v[1]!);
      if (s === undefined || !mine.some((m) => s.members.includes(m))) return fail(403, "doc.denied");
      const marks = new Map<string, boolean>();
      const marked = (avatar: string): boolean => { if (!marks.has(avatar)) marks.set(avatar, this.rulesOf(avatar).mark); return marks.get(avatar)!; };
      return { ok: true, blocks: d.blocks.map((b) => this.shown(b, mine, marked)) };
    }
    if (mine.includes(owner)) return { ok: true, blocks: d.blocks.map((b) => ({ id: b.id, value: b.value })) };
    return fail(403, "doc.denied");
  }

  /** A venue block as a member sees it: a message's `by` left out unless the viewer is the avatar that said it, or that avatar marks. */
  private shown(b: DataBlock, mine: readonly string[], marked: (avatar: string) => boolean): Visible {
    const w = parseWho(str(b.value["speaker"]) ?? "");
    if (w?.kind !== "avatar" || !("by" in b.value) || mine.includes(w.id) || marked(w.id)) return { id: b.id, value: b.value };
    const { by: _by, ...rest } = b.value;
    return { id: b.id, value: rest };
  }
```

- [ ] **Step 4: Run it to see it pass**

Run: `npm run build && node --test test/avatar-venues.test.mjs`

Expected: `ℹ pass 6`, `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add test/avatar-venues.test.mjs src/relay/avatars.ts
git commit -m "gemsbang P9: groups and two-person talk, messages stamped with the avatar and by, marking"
```


### Task 10: The version and the four gates

**Files:**
- Modify: `package.json`, `package-lock.json`, `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json` (by the script)

- [ ] **Step 1: Bump the patch version**

```bash
node scripts/bump.mjs 0.5.1
```

- [ ] **Step 2: Run the four gates**

Run each as its own command and note the result:

```bash
npm run build
claude plugin validate .
claude plugin test .
node --test --test-concurrency=2 test/*.test.mjs
```

Expected: build passes; validate passes (the root `CLAUDE.md` warning it has always shown is not new); the plugin suite is unchanged by this plan and passes as on `main`; the node suite passes, with 17 more tests than before this plan.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json .claude-plugin/plugin.json .codex-plugin/plugin.json
git commit -m "gemsbang 0.5.1: the avatar relay's core (plan P)"
```

