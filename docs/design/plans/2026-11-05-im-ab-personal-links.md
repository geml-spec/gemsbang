# Gemsbang Plan AB: a personal invitation link per avatar

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Someone can be invited before any group exists (S37–S39, Q24 ①, 2026-11-05). Each avatar has its own invitation link, `https://gemsbang.com/u/<code>`. Opening it starts a two-person chat with that avatar, and the two become each other's contacts. 发起群聊 picks members from 联系人. 通过链接加入 moves to the second place and also takes a personal link.

**Architecture:** A personal link is a group link without the group.
- Its code is the same eight letters (`links.ts`), lives seven days, and is reset the same way.
- Its doc says which avatar it opens, not which venue: `_relay/links/<code>.geml` has a `link` block `{avatar, by, at, expires}`; `_relay/links/<avatar>.geml` holds the `code-N` blocks, the last one current.
- `linkOf` and `goodLink` stay group-only: a block without `venue` is no group link, so `/i/` never takes a `/u/` code, nor the other way round.
- The two-person chat is made by one function shared with `openDm` (`makeDm`). `POST /dms` keeps its shared-group rule; a personal link is the other way to a chat, and it skips that rule.
- Joining mirrors `joinByLink` and `joinWithCode`: the joiner's avatar is picked, or one grows; a device-scope token gets an avatar token; with no token, an email and its code sign in first.

**Done in 0.5.45** (2026-11-05), not yet deployed. Two things differ from the text below: a member brought in by `addMember` carries `via: "invite"` on its `member-N` block, and only those read as 「…邀请…加入了群聊」 (one let in on a request is still 加入了群聊); and 创建（N 人） is a button under the name field, the field keeping what is typed through `onInput`.

**Before this plan:** gemsbang 0.5.44 on `main` (ab99ad5). The words follow `docs/design/stories/2026-11-05-gemsbang-terms.md`; the sketch is `preview/out/pull-sheet.html` (方向 ①).

**Decided 2026-11-05 (「都选 (a)」): Q25 (a) and Q26 (a).** What each choice meant:
- **Q25**: does a chat started from my link need my yes first?
  - (a): Task 3 opens it at once.
  - (b): Task 3 files a request to the avatar's person instead, with an `askFor` card of kind promise, as an approval-on group does (`avatars.ts:1285-1295`), and `settleRequest` learns a request for a pair.
- **Q26**: do the contacts picked in 发起群聊 need their yes first?
  - (a): Task 9 adds them with `addMember`, which already asks nobody.
  - (b): Task 9 sends each an invitation card and adds them on their yes, which needs a relay request per member.

---

### Task 1: The path and the codes (pure)

**Files:** `src/core/avatar/links.ts`, `src/core/avatar/invite.ts`; test `test/avatar-links.test.mjs`, `test/avatar-invite.test.mjs`.

- [x] `personLinkPath(code, {by?})` gives `/u/<code>`.
- [x] `parseInvite` takes `/u/<code>[.md]` too and says which kind it is: `{origin, code, md, kind: "group" | "person"}`.
- [x] `invitesIn` finds both kinds of `.md` link in what a person typed.
- [x] `personInvitePrompt(origin, code, name, lang)` gives the line for an agent, from a new word code `panel.invite.dmLine`: 「请阅读 {url} 并按说明操作：以我的身份与 {name} 私聊。」, in all three languages with the same blanks.
- [x] Tests: both kinds parse; a group code under `/u/` is still a well-formed code (the relay decides); every blank is filled.

### Task 2: The relay keeps one link per avatar

**Files:** `src/relay/avatars.ts`; test `test/avatar-person-link.test.mjs`.

- [x] Write `personLinkFor(by, avatar)`.
  - The caller is the avatar's person, or the avatar's own token (`acting`).
  - It reuses the current code until it expires; otherwise it calls `newPersonLink`.
  - `newPersonLink` writes the link block with `appendSealed` and draws again when the code exists.
- [x] Write `rotatePersonLink(by, avatar)`: always a new code, and the old one stops at once.
- [x] Write `goodPersonLink(code)`.
  - `link.missing` 404 when there is no doc, it names no avatar, or the avatar is gone.
  - `link.gone` 410 when the code was replaced or has expired.
- [x] Each join through the link adds `use-N: {at}`.
- [x] Tests:
  - seven days, then a new code;
  - a reset stops the old code;
  - someone else's avatar is refused;
  - `goodLink` refuses a personal code and `goodPersonLink` refuses a group code.

### Task 3: Joining through a personal link

**Files:** `src/relay/avatars.ts`; test `test/avatar-person-link.test.mjs`.

- [x] Factor `makeDm(first, second, by)` out of `openDm`, from `:1018-1026`, so both use it. Add a `via: "link"` field on the second `member-N`, so the chat can say how it began.
- [x] Write `personLinkInfo(code, viewer)`: `{avatar: card, expires, you?: {avatars, pick}}`.
  - The default pick is the avatar the viewer last spoke as (`recentAvatar`).
  - It is "in" when a chat with that avatar already exists for one of theirs.
- [x] Write `joinByPersonLink(by, code, body)`.
  - The joiner's avatar is picked as `joinByLink` picks it: `as`, else a new name, else the default.
  - Joining your own avatar is refused.
  - Under Q25 (a), `makeDm` runs at once.
  - It answers `Joined {venue, avatar, already}`, with an avatar token for a device-scope token.
- [x] Write `joinWithPersonCode(code, body)`: the no-token path, which runs `checkCode`, then a device token, then `joinByPersonLink`.
- [x] Tests:
  - a person with a token gets a chat;
  - a second join returns the same chat with `already`;
  - an agent with an email and its code gets in;
  - your own avatar is refused;
  - the two show in each other's `contactsOf`.

### Task 4: The routes, the page and the agent's instructions

**Files:**
- `src/relay/avatar-api.ts`
- `src/relay/avatar-shell.ts`
- `src/relay/avatar-pages.ts`
- `src/core/avatar/words.ts`

**Tests:**
- `test/avatar-api.test.mjs`
- `test/avatar-server.test.mjs`
- `test/relay-shell.test.mjs`
- `test/avatar-lang.test.mjs`

- [x] The routes:
  - `GET /u/<code>`: the info.
  - `GET /u/<code>.md`: the instructions as `md.dm`.
  - `POST /u/<code>/join`: with a token, or with an email and its code.
  - All three sit before the token gate, beside `/i/`.
- [x] `GET` and `POST /avatars/<id>/link`: the avatar's link, and a reset.
- [x] `md.dm`, in three languages: who the chat is with, how many days the link lasts, how to sign in with an email, and the join call. It has the same number of steps as `md.join`, and `avatar-lang` checks it the same way.
- [x] `PAGES` gets `/u/<code>` → `personPage`. The page is `JOIN_JS` for a person: it uses `loginBox`, picks or names the visitor's avatar, then sends them to `/g/<d-id>`.
- [x] On the web:
  - `MINE_JS` lists two-person chats too.
  - `GROUP_JS` draws no 分享群聊 or 退出群聊 for a two-person chat.
- [x] Reminders mail a web person for any line in a two-person chat, not only for an @, with the same three-hour gap.
- [x] Tests:
  - page or JSON by `Accept`;
  - the web flow on a real server ends in `/g/d-…`;
  - an agent reads the `.md` and joins with a code;
  - the Worker's `.md` names gemsbang.com.

### Task 5: The client

**Files:** `src/gemsbang/ops.ts`; test `test/gemsbang-person-link.test.mjs`.

- [x] New calls in `GB_CALLS` and `runGb`:
  - `my-link {as}`: `GET /avatars/<as>/link`.
  - `my-rotate {as}`: the `POST` version.
  - They answer `link: GbLink` with `kind: "person"`, the name, `url`, `line` and `days`.
- [x] `link-info` and `join` follow the kind of link they were given: `/u/…` reads `personLinkInfo` and joins a chat.
- [x] `join` answers with the chat opened.
- [x] Tests on a real relay:
  - the link is the same until it is reset;
  - another person joins through it, and both clients see the chat and the contact.

### Task 6: 邀请 in the pane (sketch ①a, ①b, ①e)

**Files:**
- `src/hosts/claude-code/gb-panel.ts`
- `hooks/register.tsx`
- `src/core/avatar/words.ts`
- `types/index.d.ts`

**Tests:** `test/gb-panel.test.mjs`, `tests/hooks.test.ts`.

- [x] The empty chat list and the empty 联系人: 「暂无聊天。邀请联系人开始聊天」, a primary 邀请, and the link 「已有邀请链接？粘贴加入」.
- [x] ＋ lists 邀请, 发起群聊 and 通过链接加入, in that order.
- [x] A new page, `invite-me`:
  - 以 John 邀请 · 更换, when the person has several avatars; it defaults to the last one spoken as (Q1).
  - The link as words to select, with its QR code.
  - The 智能体邀请语.
  - 链接 7 天内有效 · 重置链接, with the reset asked first, as for a group.
  - The page reuses `inviteRows`' rows; the head's ‹ goes back where it came from.
- [x] State: `inviteAs`, and `linkAtom` holding a person link. The 邀请 press runs `my-link`.
- [x] Tests:
  - the empty page's words and presses;
  - the ＋ order;
  - the page's rows for one avatar and for two;
  - a reset asked first.

### Task 7: 通过链接加入 takes a personal link (S39)

**Files:** `src/hosts/claude-code/gb-panel.ts`, `hooks/register.tsx`; test `tests/hooks.test.ts`.

- [x] A pasted `/u/` link reads its info: 「与 John 私聊？」, with the joiner's avatar asked as for a group (确定 · 切换身份 · 取消). Joining opens the chat.
- [x] `im_join` takes a `/u/…md` the person pasted: the same dialog, then this session speaks for the avatar in that chat. Its description and its answer (`tool.joined`) name a chat, not a group.
- [x] Tests: a pasted link opens the chat; a link that was not pasted is still not followed.

### Task 8: How the chat began

**Files:**
- `src/core/avatar/inbox.ts`
- `src/hosts/claude-code/gb-panel.ts`
- `src/core/avatar/words.ts`

**Tests:** `test/gb-panel.test.mjs`, `test/avatar-inbox.test.mjs`.

- [x] A `member-N` with `via: "link"` is a `joined` item that says 「李四 通过你的邀请链接发起了私聊」 to the link's owner, and 「你通过邀请链接与 John 发起了私聊」 to the joiner.
- [x] Until anyone has spoken, the chat list's last line is that sentence.

### Task 9: 发起群聊 from 联系人 (S38)

**Files:**
- `src/hosts/claude-code/gb-panel.ts`
- `hooks/register.tsx`
- `src/gemsbang/ops.ts`

**Tests:** `test/gb-panel.test.mjs`, `test/gemsbang-ops.test.mjs`, `tests/hooks.test.ts`.

- [x] The new-group page:
  - the line 以 John 发起 · 更换;
  - the contacts this avatar knows, each with a box to tick;
  - 群聊名称 (选填), whose hint is the names joined (「John、李四、王五」);
  - 创建（N 人）.
- [x] `group` takes `members: [id]`. Under Q26 (a), it calls `POST /venues/…/members` for each member after the group is made. A blank name is the names joined, cut to the relay's limit.
- [x] The group's first line is 「John 邀请李四、王五加入了群聊」.
- [x] With nobody ticked, it is today's empty group, with 邀请成员 first.
- [x] Tests:
  - the ticks;
  - the default name;
  - the members in the group on a real relay;
  - nobody ticked.

### Task 10: The canvas and the stories

**Files:** `docs/design/ui/2026-10-30-agent-im-ui/project/` (a GbInvite board, GbInbox's empty pane, GbContacts' empty pane, canvas.json, README) and `docs/design/stories/2026-11-02-gemsbang-user-stories.md` (S37–S39: what is now done).

- [x] Draw the boards from the sketch as the pane draws them; draw the pane with `node scripts/preview-pane.mjs` beside them.

### Task 11: The gates

- [x] Bump to 0.5.45 (`node scripts/bump.mjs 0.5.45`).
- [x] Run each gate as its own command:
  - `npm run build`
  - `claude plugin validate .`
  - `claude plugin test .`
  - `node --test --test-concurrency=2 test/*.test.mjs`
- [x] Sync, then check the installed copy.
- [ ] The relay changes reach gemsbang.com only when the person says to deploy.
