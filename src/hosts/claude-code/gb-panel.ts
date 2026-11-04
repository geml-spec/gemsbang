// gemsbang's pane in Claude Code (spec §7.1–§7.6, transport §4), as rows the
// hooks module draws, laid out as WeChat lays its own out (direction ①, the
// person's pick of 2026-11-03): 聊天 · 我 in a row at the foot of the inbox and
// of 我, pinned there (2026-11-04); the inbox is the chats alone — each with its
// picture, the avatar in it at the picture's corner, its name, time, last
// line and unread; the ones that need the person first, their last line
// after red words ([有人@我], [等你定], [任务]); a muted one in its place,
// a grey dot for its unread — and a way in when there is none. A chat is its
// lines as bubbles (the person's at the right, `分身` under an agent's), and
// what needs the person there — a call, a card, a task — one at a time in a
// bar above the box 「以 <分身> 说…」, which only they see; a group's head
// opens 群信息 (叫人, 静音, 自动回, the owner's 进群要我同意, every member).
// Then 叫人 (the link for a person with its QR code, the line for an agent, a
// new link), 我 (each avatar's card, its marking, a new name; the default
// name, the language, the account, the version), the account (the ways in,
// the devices signed in, signing out) and the sign-in (an email, its code, a
// name for a new person's first avatar; no server to fill in). The band says
// what needs the person first — the first card and its options — or that
// gemsbang cannot work or nobody is logged in; with nothing to say it stays,
// how many chats have something new. Pure and Node-free.
import { factsLine } from "../../core/avatar/borrow.js";
import { timeLabel, type Badge, type ChatItem, type InboxRow } from "../../core/avatar/inbox.js";
import { expiresIn } from "../../core/avatar/needs.js";
import { LANGS, say, type Lang } from "../../core/avatar/words.js";
import type { GbAccount, GbAllow, GbCalled, GbChat, GbLink, GbNeed, GbView, GbWork } from "../../gemsbang/ops.js";

export const GB_PANE_ID = "gemsbang-board";
export type GbPage = "inbox" | "chat" | "info" | "invite" | "avatars" | "account" | "new-group" | "join";

export type GbAction =
  | { op: "page"; page: GbPage }
  | { op: "open"; owner: string; id: string }
  | { op: "copy"; text: string }
  | { op: "rotate" }
  /** 叫人's 换一个链接: its warning and 换 · 算了 in place of the page (P4c), or folded again. */
  | { op: "rotate-ask"; open: boolean }
  /** 我 (P8): 界面语言's 换 opens the languages, one picked; a card's 任务 换 opens its field. */
  | { op: "lang-open"; open: boolean }
  | { op: "lang"; lang: string }
  | { op: "repo-open"; open: boolean }
  /** 账号与登录 (P10): 加一种登录方式 opens its field; 退出这台设备的登录 asks first (P10c). */
  | { op: "add-open"; open: boolean }
  | { op: "logout-ask"; open: boolean }
  | { op: "link-rules"; forward?: boolean; approve?: boolean }
  | { op: "mark"; avatar: string; mark: boolean }
  | { op: "bind"; avatar: string | null }
  | { op: "group-as"; as: string }
  /** The inbox's ＋: its two ways (建群, 用链接进群) shown under the bar, or folded again (P1b). */
  | { op: "plus" }
  /** 建群's 换: the person's avatars listed to pick another, or folded (P2c). */
  | { op: "choose"; open: boolean }
  /** A new avatar's name picked from a suggestion (建群, P2c). */
  | { op: "group-avatar"; name: string }
  /** 用链接进群 (P3): in as one of theirs, 换个身份, a new one to name, a name picked, a blank suggestion to fill, or not. */
  | { op: "join-as"; as: string }
  | { op: "join-switch" }
  | { op: "join-new" }
  | { op: "join-name"; name: string }
  | { op: "join-blank"; text: string | null }
  | { op: "join-cancel" }
  | { op: "logout" }
  | { op: "refresh" }
  | { op: "resend" }
  /** The sign-in's 换个邮箱; the account's: a way in taken off, a device signed out, all others, an email being added let go. */
  | { op: "change-address" }
  | { op: "method-remove"; id: string }
  | { op: "device-revoke"; id: string }
  | { op: "devices-revoke-others" }
  | { op: "add-cancel" }
  /** 需要你: an option pressed; a borrow carries whether to stop asking for its asker or its chat. */
  | { op: "answer"; avatar: string; need: string; choice: number; allowPerson?: boolean; allowVenue?: boolean }
  | { op: "allow"; need: string; person?: boolean; venue?: boolean }
  /** 自己写 on a card: its field opened (the card's key), or closed. */
  | { op: "write"; card: string | null }
  /** 改 on a card of 我的分身: its fields opened (the card's key), or closed. */
  | { op: "edit"; card: string | null }
  | { op: "mute"; avatar?: string; venue?: string; on: boolean }
  | { op: "work-now"; avatar: string; work: string }
  /** 被叫到 (architecture §6.3): 交给 agent 回. The person answering themself writes in the chat's box; not answering is leaving the bar be. */
  | { op: "wake"; avatar: string; owner: string; id: string; choice: "reply" | "auto" }
  /** 自动回 set or taken back: 群信息's switch, a two-person chat's head, 我 (S23). */
  | { op: "auto"; avatar: string; venue: string; on: boolean }
  /** A standing 以后不用问 taken back (撤 in 我, S23). */
  | { op: "allow-off"; avatar: string; allow: string }
  /** 退出群 (S19, P7): asked, or let go; the 群主's pick of who keeps it; out (with that pick). */
  | { op: "leave-ask"; open: boolean }
  | { op: "heir"; avatar: string }
  | { op: "leave"; heir?: string }
  /** 底子 (S27): an entry given to other avatars, 删; a waiting one 记下 or 不记. */
  | { op: "base-for"; item: string; for: string[] }
  | { op: "base-drop"; item: string }
  | { op: "base-keep"; item: string; keep: boolean };
export type GbField = "email" | "code" | "first-name" | "add-email" | "add-code" | "say" | "group" | "group-avatar" | "join" | "rename" | "default-name" | "need-own" | "repo" | "join-name" | "base-add" | "base-text";
/** A press: `primary` the one to press, `quiet` a secondary one drawn as dim words where the surface takes pictures (a chat's 静音), `danger` one in red that signs out or leaves. */
/** `disabled`: drawn grey, and pressing it does nothing (P7b's 退出 before anyone is picked). */
export interface GbPress { key: string; label: string; action: GbAction; primary?: boolean; quiet?: true; danger?: true; count?: number; disabled?: true }
export type Tone = "plain" | "dim" | "error" | "success";
export type GbRow =
  /**
   * A page's head; the inbox's carries 我 and ＋ at the right, as WeChat's. `back` goes up a page, and `backLabel` names
   * where to (‹ 收件箱), as WeChat, WhatsApp and Telegram all say more than an arrow.
   */
  | { kind: "head"; key: string; title: string; sub?: string; back?: GbAction; backLabel?: string; actions: GbPress[]; open?: GbAction }
  /** 群信息's members (P6), every one of them: a row each — a round initial, the name, who is the owner and which is you — and past MEMBER_ROWS the rest's names in one line (`rest`). */
  | { kind: "people"; key: string; items: { key: string; name: string; color?: string; note?: string }[]; rest?: string }
  /** Rows of a page's settings, a rule between (P6): one to go to (›), a switch (what it does in grey under it), or one in red that leaves. */
  | { kind: "menu"; key: string; items: { key: string; label: string; action: GbAction; go?: true; on?: boolean; danger?: true; hint?: string }[] }
  /**
   * Words to pass on (叫人, P4): what they are for, the words themselves to select, and a QR code of them where the
   * surface takes pictures; a copy press where it can copy (the terminal), never where it cannot (the desktop).
   */
  | { kind: "share"; key: string; label: string; text: string; copy: string; qr?: true }
  /** A sentence set off in a dashed box (P4: 选中后按 ⌘C…; P8b: 改了名字…); `pictures`, only where the surface takes pictures (nothing copies there). */
  | { kind: "tip"; key: string; text: string; pictures?: true }
  /** A grey line, and after it a press as a link (链接 7 天有效 · 换一个链接). */
  | { kind: "line"; key: string; text: string; press?: GbPress }
  /**
   * A chat in the inbox (WeChat's row): `flag` the red words before its last line while it needs the person ([有人@我],
   * [等你定], [任务]); `muted`, its unread a grey dot and a muted mark at the right.
   */
  | { kind: "chat"; key: string; row: InboxRow; action: GbAction; flag?: string; muted?: true }
  /**
   * A line said, as a bubble: the person's own at the right (`side`), with their avatar's badge; another's at the left, its
   * speaker named over it in a group (`name`); `tag` (分身) under it where an agent said it; the time, for a surface that
   * draws no stamps between the lines.
   */
  | { kind: "message"; key: string; item: Extract<ChatItem, { kind: "message" }>; side: "left" | "right"; name?: string; badge?: Badge; tag?: string; time: string; body: Span[] }
  /** Something that happened in a chat, centred where the surface takes pictures (GbChat): who came in and when, how many lines came before, a reply that went too far. */
  | { kind: "event"; key: string; text: string; time?: string; tone: Tone }
  /** Rows to go to or pick from, one under another (P1b's 建群 ›, P2c's John ✓): `mark` an arrow at the right, or a tick on the one picked. */
  | { kind: "list"; key: string; mark: "arrow" | "tick"; items: { key: string; label: string; badge?: Badge; person?: true; on?: boolean; action: GbAction }[] }
  /** A line around an avatar's pill (以 John 建 · 换, 用 John 进「前端周会」？): the words before and after it, then a press. */
  | { kind: "pick"; key: string; lead: string; badge: Badge; trail: string; press?: GbPress }
  /** Nothing here yet, centred, with the ways on (P1c: 还没有聊天 with 建群 and 用链接进群; P2d: 群里还只有你 with 叫人). */
  | { kind: "empty"; key: string; text: string; items: GbPress[] }
  /** A call handed to the agent, while it answers: its card folded to one dim line (agent 在回…) until the answer is in the chat. */
  | { kind: "pending"; key: string; text: string }
  | { kind: "text"; key: string; text: string; tone: Tone }
  | { kind: "section"; key: string; text: string; badge?: Badge; note?: string; press?: GbPress }
  /** Which avatars a 底子 entry is given to (P8c): 给：, a pill each — ✓ given, faded not — pressed to give or not; 删 at the right. */
  | { kind: "give"; key: string; lead: string; items: { key: string; badge: Badge; on: boolean; action?: GbAction }[]; press?: GbPress }
  /** A field; the chat's box (`compose`) holds 「以 <分身> 说…」 as its hint and says 发送 beside it, for a surface that takes pictures. */
  | { kind: "input"; key: string; field: GbField; placeholder: string; target?: string; label?: string; submitLabel?: string; value?: string; compose?: { as: Badge; placeholder: string; submitLabel: string } }
  | { kind: "select"; key: string; label: string; options: { value: string; label: string }[]; value: string }
  | { kind: "buttons"; key: string; items: GbPress[] }
  | { kind: "toggle"; key: string; label: string; on: boolean; action: GbAction }
  | { kind: "copy"; key: string; text: string; label: string }
  /**
   * What needs the person in a chat (spec §7.3, architecture §6.3), as the bar above its box that only they see: a call
   * (`line`: its words and 交给 agent 回 on one line), a card (whose and what kind, `expires` how long it still waits
   * when the matter has a deadline, what it is and what it checked, the words it would send set off as `quote`, a
   * borrow's switches, the options, 自己写 opening its field), a task queued or under way. `more`, 还有 N 件 when others
   * wait in the same chat; `label` in `tint`. A card with no chat stands so at the head of the inbox.
   */
  | { kind: "need"; key: string; badge?: Badge; head: string; expires: string; tone: Tone; summary: string; checked?: string; willSay?: string; toggles: { key: string; label: string; on: boolean; action: GbAction }[]; options: GbPress[]; own?: { target: string; placeholder: string; label: string; writing: boolean }; label: string; tint: Tint; body: Span[][]; quote?: string; hint?: string; line?: true; more?: string }
  /**
   * A card of 我的分身 (GbAvatars): an avatar's (its badge and name, its colour down the edge) or the settings' (no
   * name); 改 opens its fields; each line a label and a value, the presses after the value (换, 撤, …) or a choice.
   */
  | { kind: "card"; key: string; badge?: Badge; title?: string; tag?: string; edit?: GbPress; top?: GbRow; lines: CardLine[]; fields: GbRow[]; plain?: true }
  /** A label and its value on a page of settings (我's 默认名, 界面语言, 账号, 关于; 账号与登录's 邮箱): a grey note after the value, a press as a link, or › to go. */
  | { kind: "kv"; key: string; label: string; value: string; note?: string; tone?: Tone; press?: GbPress; go?: GbAction }
  /** One thing in a list of a page's (GbAccount): its name, a line under it, a press or a tag at its right; `rule`, a line above it. */
  | { kind: "item"; key: string; title: string; sub?: string; press?: GbPress; tag?: string; rule?: true }
  /**
   * 聊天 · 我 (S11, S22): the row at the foot of the inbox and of 我, as a phone's IM has it, pinned there where the
   * surface lets the pane keep its own window; each with its picture, the one on in blue, a red count (聊天 the unread,
   * 我 the 底子 entries that wait for the person's yes). Always the last row of its page.
   */
  | { kind: "tabs"; key: string; items: { key: string; label: string; icon: "chats" | "me"; on: boolean; count?: number; action: GbAction }[] };
/** A card's line: a label, a value (its tone), then presses, or a choice (the language). */
export interface CardLine { key: string; label: string; value: string; tone?: Tone; presses?: GbPress[]; choice?: { options: { value: string; label: string }[]; value: string } }
/** A card's kind as its label's colour: a call, a thing to nod to, gone wrong, expired. */
export type Tint = "call" | "ask" | "error" | "dim";
/** A run of a card's words; `mark` is the mention of the person's avatar, set off. */
export interface Span { text: string; mark?: true }

export const LANG_NAMES: Readonly<Record<Lang, string>> = { zh: "中文", en: "English", ja: "日本語" };

/** What the pane holds besides the view: the page, the chat and the link open, the email a sign-in code went to, the avatar a new group is made as; the account as last read and an email being added. */
export interface PaneState {
  page: GbPage; chat: GbChat | null; link: GbLink | null; address: string | null; groupAs: string; session: string; problem: string | null; zoneMinutes?: number; now: string;
  account?: GbAccount | null; adding?: string | null;
  /** A borrow's switches as set, the card whose 自己写 is open. */
  allow?: Record<string, { person?: boolean; venue?: boolean }>; writing?: string | null;
  /** The card of 我的分身 whose 改 is open. */
  editing?: string | null;
  /** The chats (owner/id) where this session's agent is answering a call handed to it. */
  replying?: readonly string[];
  /** The inbox's ＋ open; 建群's list of avatars open; the new avatar's name as picked or typed there. */
  plusOpen?: boolean; asOpen?: boolean; groupAvatar?: string | null;
  /** 用链接进群 once the link was read: what it says, and where the person is in it. */
  joining?: JoinView | null;
  /** 叫人's 换一个链接 asked, not yet answered (P4c); the page 叫人 goes back to; the keys that copy a selection (⌘C, Ctrl+C on Windows). */
  rotating?: boolean; inviteBack?: GbPage; copyKey?: string;
  /** 我's languages open, a card's 任务 field open; 账号与登录's 加一种登录方式 open, 退出这台设备的登录 asked (P10c); the version, for 关于. */
  langOpen?: boolean; repoOpen?: boolean; addOpen?: boolean; loggingOut?: boolean; version?: string | null;
  /** 退出群 asked (P7); the one the 群主 picked to keep it. */
  leaving?: boolean; heir?: string | null;
  /** Each avatar's standing 以后不用问 (S23), as last read when 我 opened. */
  allows?: Readonly<Record<string, readonly GbAllow[]>>;
}

/** A pasted link as 用链接进群 shows it (P3): the group, who owns it, the avatar the inviter knows; naming a new one, the suggestions and the blank being filled. */
export interface JoinView {
  url: string; group: string; count: number; owner?: string; pick: { kind: string; avatar?: string }; suggestions: { text: string; blank?: boolean }[];
  switching?: boolean; naming?: boolean; blank?: string | null;
}

const text = (key: string, s: string, tone: Tone = "dim"): GbRow => ({ kind: "text", key, text: s, tone });
const langRow = (lang: Lang): GbRow => ({ kind: "select", key: "lang", label: say("page.lang", lang), options: LANGS.map((l) => ({ value: l, label: LANG_NAMES[l] })), value: lang });

/** Who a code says it comes from: the service's host. */
const hostOf = (origin: string): string => origin.replace(/^https?:\/\//, "");

/** The sign-in (architecture §3.2): an email, then its code — both typed here, never in the conversation; no server to fill in. */
function loginRows(v: GbView, s: PaneState): GbRow[] {
  const l = v.lang;
  if (s.address === null) {
    return [
      { kind: "head", key: "head-login", title: "Gemsbang", sub: say("signin.tagline", l), actions: [] },
      { kind: "input", key: "email", field: "email", label: say("signin.email", l), placeholder: say("signin.emailHint", l) },
      text("signin-note", say("signin.note", l)),
      text("signin-private", say("signin.private", l)),
      langRow(l),
    ];
  }
  return [
    { kind: "head", key: "head-code", title: say("signin.codeTitle", l), actions: [] },
    text("code-sent", say("code.sentTo", l, { to: s.address, from: hostOf(v.relay) }), "plain"),
    { kind: "input", key: "code", field: "code", label: say("page.code", l), placeholder: say("signin.codeHint", l) },
    { kind: "buttons", key: "login-again", items: [{ key: "resend", label: say("signin.resend", l), action: { op: "resend" } }, { key: "change-address", label: say("signin.other", l), action: { op: "change-address" } }] },
  ];
}

/** A new person's first avatar (architecture §3.2): the name everyone calls them; those who had one never see it. */
function firstNameRows(v: GbView): GbRow[] {
  const l = v.lang;
  return [
    { kind: "head", key: "head-first", title: "Gemsbang", actions: [] },
    { kind: "input", key: "first-name", field: "first-name", label: say("signin.nameTitle", l), placeholder: say("signin.name", l) },
    text("first-note", say("signin.nameNote", l)),
  ];
}

/** A time as the account shows it, MM-DD HH:MM in the person's zone. */
const dayTime = (at: string, zoneMinutes = 0): string => {
  const t = Date.parse(at);
  if (Number.isNaN(t)) return "";
  const d = new Date(t + zoneMinutes * 60_000), two = (n: number): string => String(n).padStart(2, "0");
  return `${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
};

/** 账号与登录 (architecture §3.1): the ways in, all the same person, the last one kept; adding an email; the devices signed in, the avatars their agents play, each signed out but this one. */
function accountRows(v: GbView, s: PaneState): GbRow[] {
  const l = v.lang;
  const rows: GbRow[] = [{ kind: "head", key: "head-account", title: say("account.title", l), back: { op: "page", page: "avatars" }, actions: [] }];
  const a = s.account ?? null;
  if (a === null) return [...rows, text("account-loading", say("account.loading", l))];
  // 退出这台设备的登录, asked first in place of the page (P10c, S26).
  if (s.loggingOut === true) return [...rows, text("logout-warn", say("account.logoutWarn", l), "plain"), { kind: "buttons", key: "logout", items: [
    { key: "logout-go", label: say("account.signOut", l), danger: true, action: { op: "logout" } },
    { key: "logout-no", label: say("account.logoutNo", l), action: { op: "logout-ask", open: false } },
  ] }];
  rows.push({ kind: "section", key: "methods", text: say("account.methods", l) });
  for (const m of a.methods) rows.push({ kind: "kv", key: `method-${m.id}`, label: say(`account.kind.${m.kind}`, l), value: m.shown, ...(a.methods.length > 1 ? { press: { key: `remove-${m.id}`, label: say("account.unbind", l), action: { op: "method-remove", id: m.id } } } : {}) });
  // 加一种登录方式 (P10b): its field in a card where it was; the code in the same place once it went.
  const adding = s.adding ?? null;
  if (adding !== null) {
    rows.push(text("add-sent", say("code.sentTo", l, { to: adding, from: hostOf(v.relay) }), "plain"));
    rows.push({ kind: "input", key: "add-code", field: "add-code", placeholder: say("signin.codeHint", l) });
    rows.push({ kind: "buttons", key: "add-cancel", items: [{ key: "add-cancel", label: say("signin.other", l), action: { op: "add-cancel" } }] });
  } else if (s.addOpen === true) rows.push({ kind: "card", key: "add", top: { kind: "input", key: "add-email", field: "add-email", placeholder: say("account.addHint", l), submitLabel: say("account.sendCode", l) }, lines: [], fields: [] });
  else rows.push({ kind: "line", key: "add", text: "", press: { key: "add-open", label: say("account.add", l), action: { op: "add-open", open: true } } });
  rows.push({ kind: "section", key: "devices", text: say("account.devices", l) });
  a.devices.forEach((d, i) => {
    const plays = d.avatars.length > 0 ? `${say("account.plays", l, { names: d.avatars.map((x) => `「${x.name}」`).join("") })} · ` : "";
    rows.push({
      kind: "item", key: `device-${d.id}`, title: d.name === "" ? say("account.unnamed", l) : d.name, sub: `${plays}${d.current ? say("account.now", l) : dayTime(d.at, s.zoneMinutes)}`,
      ...(d.current ? { tag: say("account.here", l) } : { press: { key: `revoke-${d.id}`, label: say("account.signOut", l), action: { op: "device-revoke", id: d.id } } }),
      ...(i > 0 ? { rule: true as const } : {}),
    });
  });
  if (a.devices.some((d) => !d.current)) rows.push({ kind: "line", key: "revoke-others", text: "", press: { key: "revoke-others", label: say("account.signOutOthers", l), action: { op: "devices-revoke-others" } } });
  rows.push({ kind: "buttons", key: "logout", items: [{ key: "logout-ask", label: say("account.logout", l), danger: true, action: { op: "logout-ask", open: true } }] });
  return rows;
}

/**
 * An open card as its chat's bar (S15, S16), or with no chat at the head of the inbox: whose and what kind, how long it
 * still waits when the matter has a deadline, what it is and what it checked, the words it would send, the options and
 * 自己写; a borrow's switches, the chat's only in a group (a two-person chat has no group to stop asking for). Past its
 * deadline a card leaves the bar: its avatar has said in the chat that the person answers it (S15).
 */
function needRow(n: GbNeed, l: Lang, s: PaneState, o: { dm?: boolean; more?: number } = {}): GbRow {
  const kind = say(`need.kind.${n.kind}`, l);
  const allow = s.allow?.[n.id] ?? {};
  const toggles = n.kind === "borrow" ? [
    { key: `allow-person-${n.id}`, label: say("need.borrow.person", l), on: allow.person === true, action: { op: "allow", need: n.id, person: allow.person !== true } as GbAction },
    ...(o.dm === true ? [] : [{ key: `allow-venue-${n.id}`, label: say("need.borrow.venue", l), on: allow.venue === true, action: { op: "allow", need: n.id, venue: allow.venue !== true } as GbAction }]),
  ] : [];
  const options: GbPress[] = n.options.map((o, i) => ({ key: `answer-${n.id}-${i}`, label: o.label, primary: i === 0, action: { op: "answer", avatar: n.avatar, need: n.id, choice: i, ...(n.kind === "borrow" && i === 0 && allow.person === true ? { allowPerson: true } : {}), ...(n.kind === "borrow" && i === 0 && allow.venue === true ? { allowVenue: true } : {}) } }));
  const key = `need-${n.avatar}-${n.id}`;
  const borrowScope = n.kind === "borrow" ? `${n.repo !== undefined ? say("need.repo", l, { repo: n.repo }) : say("need.noRepo", l)}\n${say("need.borrowScope", l)}` : undefined;
  // Whose and what kind (Lily 爸爸 · 答应事情), how long it still waits; in the bar's corner, 还有 N 件.
  const expires = n.expires !== undefined ? expiresIn(n.expires, s.now, l) : "";
  const label = [n.avatarName, kind, ...(expires !== "" ? [expires] : [])].join(" · ");
  return {
    kind: "need", key, label, tint: n.kind === "error" ? "error" : "ask",
    body: [[{ text: n.checked !== undefined ? say("need.withChecked", l, { summary: n.summary, checked: n.checked }) : n.summary }], ...(n.unplayed === true ? [[{ text: say("call.unplayed", l) }]] : [])],
    ...(n.badge !== undefined ? { badge: n.badge } : {}), head: label, expires, tone: n.kind === "error" ? "error" : "plain",
    summary: n.summary, ...(n.checked !== undefined ? { checked: say("need.checked", l, { text: n.checked }) } : {}),
    // A borrow's bar says where the work would happen and what may be done there (spec §7.4); another, the words it would send.
    ...(borrowScope !== undefined ? { willSay: borrowScope, quote: borrowScope } : n.draft !== undefined ? { willSay: say("need.willSay", l, { text: n.draft }), quote: say("need.willSay", l, { text: n.draft }) } : {}),
    toggles, options, ...(n.kind !== "borrow" && n.kind !== "error" && n.request === undefined ? { own: { target: `${n.avatar}/${n.id}`, placeholder: say("need.ownHint", l), label: say("need.own", l), writing: s.writing === key } } : {}),
    ...(o.more !== undefined && o.more > 0 ? { more: say("need.more", l, { count: o.more }) } : {}),
  };
}

/** A line's words with each mention of the person's avatar (`at`, as @John) set off. */
function mentionSpans(words: string, at: string): Span[] {
  if (at === "") return [{ text: words }];
  const out: Span[] = [];
  let rest = words;
  for (let i = rest.indexOf(at); i >= 0; i = rest.indexOf(at)) {
    if (i > 0) out.push({ text: rest.slice(0, i) });
    out.push({ text: at, mark: true });
    rest = rest.slice(i + at.length);
  }
  if (rest !== "" || out.length === 0) out.push({ text: rest });
  return out;
}

/**
 * A call on an avatar (architecture §6.3, S14) as its chat's bar, on one line: who called and how often (王五 @ 了你 2
 * 次) and the one step, 交给 agent 回; a round handed it that failed, why instead (B3); no session to play it, said (B1).
 */
function callRow(c: GbCalled, l: Lang, more = 0): GbRow {
  const who = [...new Set(c.lines.map((x) => x.who))].join(say("call.sep", l)), count = c.lines.length;
  const said = say(`${c.kind === "dm" ? "call.barDm" : "call.bar"}${count > 1 ? "N" : ""}`, l, { who, count });
  const failed = c.failed !== undefined ? say("call.failed", l, { why: say(`call.why.${c.failed}`, l) }) : undefined;
  return {
    kind: "need", key: `call-${c.avatar}-${c.owner}-${c.id}`, ...(c.badge !== undefined ? { badge: c.badge } : {}), head: failed ?? said, expires: "", tone: failed !== undefined ? "error" : "plain",
    label: "", tint: failed !== undefined ? "error" : "call", line: true,
    body: [[{ text: failed ?? said }], ...(c.unplayed === true ? [[{ text: say("call.unplayed", l) }]] : [])],
    summary: failed ?? said, toggles: [],
    options: [{ key: `wake-reply-${c.avatar}-${c.id}`, label: say("call.reply", l), primary: true, action: { op: "wake", avatar: c.avatar, owner: c.owner, id: c.id, choice: "reply" } }],
    ...(more > 0 ? { more: say("need.more", l, { count: more }) } : {}),
  };
}

/** A task the person took on in this chat (spec §7.4, S16), as its bar while it is queued (现在干) or under way. */
function workRow(w: GbWork, l: Lang, more = 0): GbRow {
  const said = `${say(`work.state.${w.state}`, l)} · ${w.summary}`;
  return {
    kind: "need", key: `work-${w.avatar}-${w.id}`, ...(w.badge !== undefined ? { badge: w.badge } : {}), head: said, expires: "", tone: w.state === "taken" ? "dim" : "plain",
    label: "", tint: "dim", line: true, body: [[{ text: said }]], summary: said, toggles: [],
    options: w.state === "queued" ? [{ key: `now-${w.avatar}-${w.id}`, label: say("work.now", l), primary: true, action: { op: "work-now", avatar: w.avatar, work: w.id } }] : [],
    ...(more > 0 ? { more: say("need.more", l, { count: more }) } : {}),
  };
}

/** Whether a chat is muted: itself, or the avatar in it (S17). */
const mutedChat = (v: GbView, owner: string, id: string, avatar: string): boolean => v.muted.venues.includes(`${owner}/${id}`) || v.muted.avatars.includes(avatar);

/**
 * What a chat waits on the person for (S11): the red words before its last line — a card ([等你定]), a task ([任务]), a
 * call in a group ([有人@我]) — and whether it waits at all: a two-person chat's call has no words, its unread says it, as
 * WeChat's does.
 */
function waitOf(v: GbView, r: InboxRow): { flag?: string; waits: boolean } {
  const l = v.lang;
  const needs = v.needs.filter((n) => n.state === "open" && n.venue?.owner === r.owner && n.venue.id === r.id);
  if (needs.some((n) => n.kind !== "borrow")) return { flag: say("panel.flag.ask", l), waits: true };
  if (needs.length > 0) return { flag: say("panel.flag.task", l), waits: true };
  const call = (v.calls ?? []).find((c) => c.owner === r.owner && c.id === r.id && c.avatar === r.as.id && !c.auto);
  if (call === undefined) return { waits: false };
  return call.kind === "group" ? { flag: say("panel.flag.call", l), waits: true } : { waits: true };
}

/** The inbox (spec §7.1, S11): WeChat's — the chats alone, the ones that need the person first. */
function inboxRows(v: GbView, s: PaneState): GbRow[] {
  const l = v.lang;
  // The head: the name, ＋ at the right; 我 is in the row at the foot.
  const rows: GbRow[] = [{ kind: "head", key: "head-inbox", title: "Gemsbang", ...(v.unread > 0 ? { sub: say("panel.unreadBand", l, { count: v.unread }) } : {}), actions: [
    { key: "plus", label: "＋", primary: true, action: { op: "plus" } },
  ] }];
  if (v.offline !== undefined) rows.push(text("offline", say("panel.offline", l, { detail: v.offline }), "error"));
  for (const n of v.notes) rows.push(text(`note-${n.url}`, say("panel.notFollowed", l, { url: n.url }), "error"));
  // ＋ (P1b, Q4): its two ways under the head, as WeChat's ＋ opens; pressed again, folded.
  if (s.plusOpen === true) rows.push({ kind: "list", key: "plus-ways", mark: "arrow", items: [
    { key: "go-new-group", label: say("panel.newGroup", l), action: { op: "page", page: "new-group" } },
    { key: "go-join", label: say("panel.joinLink", l), action: { op: "page", page: "join" } },
  ] });
  // A card with no chat to stand in waits at the head, as a chat's bar would.
  for (const n of v.needs) if (n.state === "open" && n.venue === undefined && !n.muted) rows.push(needRow(n, l, s));
  // No chat yet (P1c): the two ways ＋ holds, laid out in the middle; ＋ stays where it is.
  if (v.rows.length === 0) {
    rows.push({ kind: "empty", key: "empty", text: say("panel.empty", l), items: [
      { key: "empty-new-group", label: say("panel.newGroup", l), primary: true, action: { op: "page", page: "new-group" } },
      { key: "empty-join", label: say("panel.joinLink", l), action: { op: "page", page: "join" } },
    ] });
    return [...rows, tabsRow(v, "inbox")];
  }
  // The chats that need the person first, newest first among them; then the rest, the muted in their place (S17).
  const shown = v.rows.map((r) => ({ r, ...waitOf(v, r), muted: mutedChat(v, r.owner, r.id, r.as.id) }));
  for (const x of [...shown.filter((x) => x.waits && !x.muted), ...shown.filter((x) => !x.waits || x.muted)]) {
    rows.push({ kind: "chat", key: `chat-${x.r.owner}-${x.r.id}`, row: x.r, action: { op: "open", owner: x.r.owner, id: x.r.id }, ...(x.flag !== undefined ? { flag: x.flag } : {}), ...(x.muted ? { muted: true as const } : {}) });
  }
  return [...rows, tabsRow(v, "inbox")];
}

/** 聊天 · 我 at the foot (S11, S22): the one on in blue; 聊天 with the unread, 我 with the 底子 entries an agent left waiting (P9b′). */
function tabsRow(v: GbView, on: "inbox" | "avatars"): GbRow {
  const l = v.lang;
  return { kind: "tabs", key: "tabs", items: [
    { key: "tab-chats", label: say("panel.tab.chats", l), icon: "chats", on: on === "inbox", ...(v.unread > 0 ? { count: v.unread } : {}), action: { op: "page", page: "inbox" } },
    { key: "tab-me", label: say("panel.tab.me", l), icon: "me", on: on === "avatars", ...(baseWaiting(v) > 0 ? { count: baseWaiting(v) } : {}), action: { op: "page", page: "avatars" } },
  ] };
}

/** A time as the chat's lines carry it, HH:MM in the person's zone. */
const hhmm = (at: string, zoneMinutes = 0): string => {
  const t = Date.parse(at);
  if (Number.isNaN(t)) return "";
  const d = new Date(t + zoneMinutes * 60_000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};

/** How long a chat goes quiet before its next line gets a stamp over it, as WeChat's (S13). */
const STAMP_GAP_MS = 5 * 60_000;
/** A stamp between a chat's lines: today 16:20, else the day as the inbox says it with the time (昨天 16:20). */
function stampOf(at: string, now: string, l: Lang, zoneMinutes = 0): string {
  const time = hhmm(at, zoneMinutes), day = timeLabel(at, now, l, zoneMinutes);
  return day === time ? time : `${day} ${time}`;
}

/**
 * What needs the person in a chat (S14–S16): the calls, the cards and the tasks there, oldest first, the first as the
 * bar above its box with 还有 N 件; while the agent answers a call handed to it, a grey line before it (agent 在回…).
 */
function barRows(v: GbView, s: PaneState, c: GbChat): GbRow[] {
  const l = v.lang;
  const here = (x: { owner: string; id: string } | undefined): boolean => x !== undefined && x.owner === c.owner && x.id === c.id;
  const waiting: { at: string; row: (more: number) => GbRow }[] = [
    ...(v.calls ?? []).filter((k) => here(k) && k.avatar === c.as?.id && !k.auto).map((k) => ({ at: k.at, row: (more: number) => callRow(k, l, more) })),
    ...v.needs.filter((n) => n.state === "open" && here(n.venue)).map((n) => ({ at: n.at, row: (more: number) => needRow(n, l, s, { dm: c.kind === "dm", more }) })),
    ...(v.work ?? []).filter((w) => (w.state === "queued" || w.state === "taken") && here(w.venue)).map((w) => ({ at: w.at, row: (more: number) => workRow(w, l, more) })),
  ].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const rows: GbRow[] = [];
  if (s.replying?.includes(`${c.owner}/${c.id}`) === true) rows.push({ kind: "pending", key: "replying", text: say("call.replying", l) });
  const first = waiting[0];
  if (first !== undefined) rows.push(first.row(waiting.length - 1));
  return rows;
}

/** One chat (spec §7.2, S13): its head, its lines as bubbles with stamps between, the bar of what needs the person, the box. */
function chatRows(v: GbView, s: PaneState, c: GbChat): GbRow[] {
  const l = v.lang;
  const me = c.as?.name ?? "";
  const key = `${c.owner}/${c.id}`;
  const muted = v.muted.venues.includes(key);
  const auto = c.as !== undefined && (v.avatars.find((a) => a.id === c.as?.id)?.autos ?? []).some((x) => x.venue === key);
  // A group's head opens 群信息, where 叫人, 静音 and 自动回 are (P5, Q17); a two-person chat has no 群信息 yet, so 静音 and 自动回 stay on its head.
  const sub = `${say("page.join.count", l, { count: c.count })} · ${say("page.group.as", l, { name: me })}`;
  const rows: GbRow[] = [c.kind === "group"
    ? { kind: "head", key: "head-chat", title: c.name, sub, back: { op: "page", page: "inbox" }, actions: [], open: { op: "page", page: "info" } }
    : { kind: "head", key: "head-chat", title: c.name, sub, back: { op: "page", page: "inbox" }, actions: [
        { key: "mute-venue", label: say(muted ? "panel.unmute" : "panel.mute", l), action: { op: "mute", venue: key, on: !muted }, quiet: true },
        ...(c.as !== undefined ? [{ key: "auto-venue", label: say(auto ? "panel.dmAutoOff" : "panel.dmAuto", l), action: { op: "auto", avatar: c.as.id, venue: key, on: !auto } as GbAction, quiet: true as const }] : []),
      ] }];
  const zone = s.zoneMinutes ?? c.zoneMinutes;
  if (c.earlier > 0) rows.push({ kind: "event", key: "earlier", text: say("panel.earlier", l, { count: c.earlier }), tone: "dim" });
  // A group made a moment ago (P2d): only the person, and 叫人 first; a quiet chat with others, that nobody spoke.
  if (c.kind === "group" && c.count <= 1 && c.items.every((i) => i.kind !== "message")) rows.push({ kind: "empty", key: "alone", text: say("panel.alone", l), items: [{ key: "alone-invite", label: say("panel.invite", l), primary: true, action: { op: "page", page: "invite" } }] });
  else if (c.items.every((i) => i.kind !== "message")) rows.push(text("quiet", say("page.group.empty", l)));
  let last: string | undefined;
  for (const i of c.items) {
    if (i.kind === "joined") rows.push({ kind: "event", key: `joined-${i.id}`, text: say("page.group.joined", l, { name: i.who }), time: hhmm(i.at, zone), tone: "dim" });
    else if (i.kind === "note") rows.push({ kind: "event", key: `note-${i.id}`, text: say("page.group.hops", l), tone: "dim" });
    // Someone left, as who came in is said (S19, Q13①); the 群主 who left, with who took it over (P7c).
    else if (i.kind === "left") rows.push({ kind: "event", key: `left-${i.id}`, text: i.heir !== undefined ? say("page.group.leftHeir", l, { name: i.who, heir: i.heir }) : say("page.group.left", l, { name: i.who }), time: hhmm(i.at, zone), tone: "dim" });
    else {
      if (last === undefined || Date.parse(i.at) - Date.parse(last) >= STAMP_GAP_MS) rows.push({ kind: "event", key: `stamp-${i.id}`, text: stampOf(i.at, s.now, l, zone), tone: "dim" });
      last = i.at;
      rows.push({
        kind: "message", key: `msg-${i.id}`, item: i, side: i.mine ? "right" : "left", ...(c.kind === "group" && !i.mine ? { name: i.who } : {}),
        ...(i.mine && c.as !== undefined ? { badge: c.as } : {}), ...(i.mark ? { tag: say("page.group.mark", l) } : {}), time: hhmm(i.at, zone), body: mentionSpans(i.text, me === "" ? "" : `@${me}`),
      });
      // What the host saw when a borrowed computer did the work (spec §7.4).
      if (i.facts !== undefined) rows.push(text(`facts-${i.id}`, factsLine(i.facts, l), i.facts.every((f) => f.ok) ? "success" : "error"));
    }
  }
  rows.push(...barRows(v, s, c));
  rows.push({ kind: "input", key: "say", field: "say", placeholder: say("page.group.sayAs", l, { name: me }), ...(c.as !== undefined ? { compose: { as: c.as, placeholder: say("page.group.sayAs", l, { name: me }), submitLabel: say("page.group.send", l) } } : {}) });
  return rows;
}

/** How many of a group's members 群信息 gives a row each: some four elements a row, and the desktop draws no more than about 1,100; the rest are named in one line, so everyone can still be found. */
const MEMBER_ROWS = 200;

/**
 * 群信息 (P6, Q17): 叫人, 静音, 自动回 and the owner's 进群要我同意 first, then every member, the owner first, who you are — the
 * person picked ② on 2026-11-03, as WhatsApp and Telegram lay it out: what is pressed often above, the list below it.
 */
function infoRows(v: GbView, s: PaneState, c: GbChat): GbRow[] {
  const l = v.lang;
  const key = `${c.owner}/${c.id}`;
  const muted = v.muted.venues.includes(key);
  const auto = c.as !== undefined && (v.avatars.find((a) => a.id === c.as?.id)?.autos ?? []).some((x) => x.venue === key);
  const members = c.members ?? [];
  const keeper = c.keeper ?? c.owner;
  const others = members.filter((m) => m.id !== c.as?.id);
  // The 群主 leaving with others still in (P7b): a page of its own, who keeps it picked first.
  if (s.leaving === true && c.isOwner && others.length > 0) return leaveRows(v, s, c, others);
  const ordered = [...members.filter((m) => m.id === keeper), ...members.filter((m) => m.id !== keeper)];
  const note = (id: string): string => [...(id === c.as?.id ? [say("panel.info.you", l)] : []), ...(id === keeper ? [say("panel.info.owner", l)] : [])].join(" · ");
  const shown = ordered.slice(0, MEMBER_ROWS);
  return [
    { kind: "head", key: "head-info", title: say("panel.info.title", l, { group: c.name }), back: { op: "page", page: "chat" }, actions: [] },
    {
      kind: "menu", key: "info-menu", items: [
        { key: "info-invite", label: say("panel.invite", l), go: true, action: { op: "page", page: "invite" } },
        { key: "info-mute", label: say("panel.mute", l), on: muted, action: { op: "mute", venue: key, on: !muted } },
        // 自动回 beside 静音 (S14): moved here from the bar, which only says 交给 agent 回.
        ...(c.as !== undefined ? [{ key: "info-auto", label: say("panel.info.auto", l), hint: say("panel.info.autoHint", l, { name: c.as.name }), on: auto, action: { op: "auto", avatar: c.as.id, venue: key, on: !auto } as GbAction }] : []),
        ...(c.isOwner ? [{ key: "info-approve", label: say("panel.invite.approve", l), on: c.rules?.approve === true, action: { op: "link-rules", approve: c.rules?.approve !== true } as GbAction }] : []),
      ],
    },
    { kind: "section", key: "members", text: say("panel.info.members", l, { count: members.length }) },
    {
      kind: "people", key: "people",
      items: shown.map((m) => ({ key: `member-${m.id}`, name: m.name, ...(m.id === c.as?.id ? { color: c.as.color } : {}), ...(note(m.id) !== "" ? { note: note(m.id) } : {}) })),
      ...(ordered.length > shown.length ? { rest: ordered.slice(MEMBER_ROWS).map((m) => m.name).join(say("call.sep", l)) } : {}),
    },
    // 退出群 at the foot (P6 ②); asked, its confirmation in its place (P7a) — the last one told the group goes with them.
    ...(s.leaving === true
      ? [text("leave-ask", say(others.length === 0 ? "panel.leaveLast" : "panel.leaveAsk", l, { group: c.name }), "plain"), { kind: "buttons", key: "leave", items: [
          { key: "leave-go", label: say("panel.leaveGo", l), danger: true, action: { op: "leave" } },
          { key: "leave-no", label: say("panel.leaveNo", l), action: { op: "leave-ask", open: false } },
        ] } as GbRow]
      : [{ kind: "menu", key: "info-leave", items: [{ key: "leave-open", label: say("panel.leave", l), danger: true, action: { op: "leave-ask", open: true } }] } as GbRow]),
  ];
}

/** The 群主 leaving (P7b, Q13②): who keeps the group picked from the others, 交给某某，退出 only once one is, 算了. */
function leaveRows(v: GbView, s: PaneState, c: GbChat, others: readonly { id: string; name: string }[]): GbRow[] {
  const l = v.lang;
  const heir = others.find((m) => m.id === s.heir);
  return [
    { kind: "head", key: "head-leave", title: say("panel.leaveTitle", l, { group: c.name }), back: { op: "leave-ask", open: false }, actions: [] },
    text("leave-heir", say("panel.leaveHeir", l), "plain"),
    { kind: "list", key: "heirs", mark: "tick", items: others.map((m) => ({ key: `heir-${m.id}`, label: m.name, person: true as const, on: m.id === s.heir, action: { op: "heir", avatar: m.id } as GbAction })) },
    { kind: "buttons", key: "leave", items: [
      heir !== undefined
        ? { key: "leave-go", label: say("panel.leaveTo", l, { name: heir.name }), danger: true, action: { op: "leave", heir: heir.id } }
        : { key: "leave-go", label: say("panel.leaveGo", l), danger: true, disabled: true, action: { op: "leave-ask", open: true } },
      { key: "leave-no", label: say("panel.leaveNo", l), action: { op: "leave-ask", open: false } },
    ] },
  ];
}

/** 叫人 (spec §6.1, P4): the link for people with its QR code, the line for agents, how long the link works; the owner swaps it, asked first. */
function inviteRows(v: GbView, s: PaneState, c: GbChat, k: GbLink | null): GbRow[] {
  const l = v.lang;
  const rows: GbRow[] = [{ kind: "head", key: "head-invite", title: say("panel.invite.title", l, { group: c.name }), back: { op: "page", page: s.inviteBack ?? "chat" }, actions: [] }];
  if (k === null) return [...rows, text("link-wait", "…")];
  if (s.rotating === true && k.isOwner) return [...rows, text("rotate-warn", say("panel.invite.rotateWarn", l), "plain"), { kind: "buttons", key: "rotate", items: [
    { key: "rotate-go", label: say("panel.invite.rotateGo", l), primary: true, action: { op: "rotate" } },
    { key: "rotate-no", label: say("panel.invite.rotateNo", l), action: { op: "rotate-ask", open: false } },
  ] }];
  rows.push({ kind: "share", key: "share-link", label: say("panel.invite.forPeople", l), text: k.url, copy: say("panel.invite.copyLink", l), qr: true });
  rows.push({ kind: "share", key: "share-line", label: say("panel.invite.forAgents", l), text: k.line, copy: say("panel.invite.copyLine", l) });
  rows.push({ kind: "tip", key: "select", text: say("panel.invite.select", l, { key: s.copyKey ?? "⌘C" }), pictures: true });
  rows.push({ kind: "line", key: "valid", text: say("panel.invite.valid", l, { days: k.days }), ...(k.isOwner ? { press: { key: "rotate-ask", label: say("panel.invite.rotateLink", l), action: { op: "rotate-ask", open: true } } } : {}) });
  return rows;
}

/** The last part of a path, on any system: the repository a task works in, by its folder's name. */
const folderOf = (path: string): string => path.split(/[\\/]+/).filter((x) => x !== "").at(-1) ?? path;

/**
 * 我 (S22, P8): a card per avatar — where it is, who plays it, the chats that answer on their own, where a task works,
 * whether agent lines are marked, 静音 beside its name — and 改 opening one card in place (P8b: its name with 好了,
 * 任务 换, two switches), the others folded to a line; under the cards, the person's own: 默认名, 界面语言, 账号, 关于.
 * No 设置 page of its own.
 */
function avatarRows(v: GbView, s: PaneState): GbRow[] {
  const l = v.lang;
  // 底子's 改 (P8c): the page is 底子 alone until 好了, a page under 我, back to it; else 我 is reached from the row at its foot.
  if (s.editing === "base") return [{ kind: "head", key: "head-avatars", title: say("panel.avatars", l), back: { op: "edit", card: null }, actions: [] }, ...baseRows(v, s, true)];
  const rows: GbRow[] = [{ kind: "head", key: "head-avatars", title: say("panel.avatars", l), actions: [] }];
  // A session given none plays the avatar the person last spoke as (S21); another open session of this machine, said so; none, said so too (B1: its calls ask the person).
  const body = v.bodies[s.session] ?? v.recent;
  const played = new Set(v.played ?? []);
  const opened = typeof s.editing === "string" && s.editing.startsWith("avatar-") ? s.editing : null;
  for (const a of v.avatars) {
    const key = `avatar-${a.id}`;
    const tag = a.muted ? { tag: say("panel.mute", l) } : {};
    const edit: GbPress = { key: `edit-${a.id}`, label: say("panel.edit", l), action: { op: "edit", card: key } };
    const repo = a.repo !== undefined ? say("panel.repoAt", l, { repo: folderOf(a.repo) }) : undefined;
    if (opened === key) {
      rows.push({
        kind: "card", key, badge: a,
        top: { kind: "input", key: `rename-${a.id}`, field: "rename", target: a.id, placeholder: say("panel.rename", l), value: a.name, submitLabel: say("panel.done", l) },
        lines: [{ key: `repo-${a.id}`, label: say("need.kind.borrow", l), value: repo ?? say("panel.repoNone", l), ...(repo === undefined ? { tone: "dim" as Tone } : {}), presses: [{ key: `repo-open-${a.id}`, label: say("panel.switch", l), action: { op: "repo-open", open: s.repoOpen !== true } }] }],
        fields: [
          ...(s.repoOpen === true ? [{ kind: "input", key: `repo-input-${a.id}`, field: "repo", target: a.id, placeholder: say("panel.repoInput", l), ...(a.repo !== undefined ? { value: a.repo } : {}) } as GbRow] : []),
          { kind: "menu", key: `switches-${a.id}`, items: [
            { key: `mark-${a.id}`, label: say("panel.markSwitch", l), on: a.mark, action: { op: "mark", avatar: a.id, mark: !a.mark } },
            { key: `mute-${a.id}`, label: say("panel.muteSwitch", l), on: a.muted, action: { op: "mute", avatar: a.id, on: !a.muted } },
          ] },
          { kind: "tip", key: `rename-tip-${a.id}`, text: say("panel.renameTip", l) },
        ],
      });
      continue;
    }
    // One card open: the others folded to their name (P8b).
    if (opened !== null) { rows.push({ kind: "card", key, badge: a, title: a.name, ...tag, edit, lines: [], fields: [] }); continue; }
    const autos = a.autos ?? [];
    const lines: CardLine[] = [
      { key: `where-${a.id}`, label: say("panel.where", l), value: a.venues.length > 0 ? a.venues.join(" · ") : say("panel.nowhere", l) },
      body === a.id
        ? { key: `who-${a.id}`, label: say("panel.who", l), value: say("panel.plays.here", l) }
        : { key: `who-${a.id}`, label: say("panel.who", l), value: say(played.has(a.id) ? "panel.plays.other" : "panel.plays.none", l), tone: "dim" },
      // 自动回 (S23): each chat taken back with its own 撤; one alone, just 撤.
      { key: `auto-${a.id}`, label: say("panel.autoLabel", l), value: autos.length > 0 ? autos.map((x) => x.name).join(" · ") : say("panel.none", l), ...(autos.length === 0 ? { tone: "dim" as Tone } : {}), presses: autos.map((x) => ({ key: `auto-off-${a.id}-${x.venue}`, label: autos.length === 1 ? say("panel.revoke", l) : say("panel.autoOff", l, { name: x.name }), action: { op: "auto", avatar: a.id, venue: x.venue, on: false } as GbAction })) },
      // 任务 where the person named a repository; none, nothing to say until 改.
      ...(repo !== undefined ? [{ key: `repo-${a.id}`, label: say("need.kind.borrow", l), value: repo }] : []),
      // 不用问 (S23): whose tasks or which chat's go ahead unasked, each with its 撤; none, no line.
      ...allowLine(a.id, s.allows?.[a.id] ?? [], l),
      { key: `mark-line-${a.id}`, label: say("panel.mark", l), value: say(a.mark ? "panel.markOn" : "panel.markOff", l) },
    ];
    rows.push({ kind: "card", key, badge: a, title: a.name, ...tag, edit, lines, fields: [] });
  }
  rows.push(...baseRows(v, s, false), ...ownRows(v, s), tabsRow(v, "avatars"));
  return rows;
}

/** 我's 不用问 line (P8a): 张三的活（设置页改版）, 「设置页改版」里的活; one alone with 撤, several each with 撤 and who or which chat (撤「张三」). */
function allowLine(avatar: string, allows: readonly GbAllow[], l: Lang): CardLine[] {
  if (allows.length === 0) return [];
  const what = (x: GbAllow): string => (x.key.startsWith("person:")
    ? say(x.group !== undefined ? "panel.allowPerson" : "panel.allowPersonAny", l, { who: x.who ?? x.person ?? "", group: x.group ?? "" })
    : say("panel.allowVenue", l, { group: x.group ?? `${x.venue?.owner}/${x.venue?.id}` }));
  return [{
    key: `allows-${avatar}`, label: say("panel.noAsk", l), value: allows.map(what).join(" · "),
    presses: allows.map((x) => ({ key: `allow-off-${avatar}-${x.key}`, label: allows.length === 1 ? say("panel.revoke", l) : say("panel.autoOff", l, { name: x.key.startsWith("person:") ? x.who ?? x.person ?? "" : x.group ?? "" }), action: { op: "allow-off", avatar, allow: x.key } as GbAction })),
  }];
}

/** How many 底子 entries an agent left waiting for the person's yes. */
export const baseWaiting = (v: GbView): number => (v.base ?? []).filter((x) => x.state === "pending").length;

/**
 * 我's 底子 (S27): what the person keeps about themself, each entry with the avatars it is given to (P8a: 给 Lily 爸爸,
 * 给全部), 改 at the right; an agent's entries waiting with 记下 · 不记 (P9b′). Being changed (P8c): each entry's words
 * in a field, 给： its avatars as pills to press, 删; 加一条 at the foot, given to the avatar this session plays.
 */
function baseRows(v: GbView, s: PaneState, open: boolean): GbRow[] {
  const l = v.lang;
  const items = v.base ?? [];
  const badge = (id: string): Badge | undefined => v.avatars.find((a) => a.id === id);
  const given = (ids: readonly string[]): string => v.avatars.length > 1 && v.avatars.every((a) => ids.includes(a.id))
    ? say("panel.baseAll", l)
    : say("panel.baseFor", l, { names: ids.map((id) => badge(id)?.name ?? id).join(say("call.sep", l)) });
  const rows: GbRow[] = [{ kind: "section", key: "base", text: say("panel.base", l), press: { key: "edit-base", label: say(open ? "panel.done" : "panel.edit", l), action: { op: "edit", card: open ? null : "base" } } }];
  const kept = items.filter((x) => x.state === "kept"), waiting = items.filter((x) => x.state === "pending");
  if (!open) {
    for (const x of kept) rows.push({ kind: "kv", key: `base-${x.id}`, label: x.label, value: x.text, note: given(x.for) });
    if (kept.length === 0 && waiting.length === 0) rows.push(text("base-none", say("panel.none", l)));
  } else {
    for (const x of kept) {
      const pills = v.avatars.map((a) => {
        const on = x.for.includes(a.id), last = on && x.for.length === 1;
        // The last avatar it is given to stays: an entry given to none would be no one's.
        return { key: `base-for-${x.id}-${a.id}`, badge: a, on, ...(last ? {} : { action: { op: "base-for", item: x.id, for: on ? x.for.filter((y) => y !== a.id) : [...x.for, a.id] } as GbAction }) };
      });
      rows.push({
        kind: "card", key: `base-card-${x.id}`, plain: true, lines: [],
        top: { kind: "input", key: `base-text-${x.id}`, field: "base-text", target: x.id, placeholder: say("panel.baseAddHint", l), value: x.text, ...(x.label !== "" ? { label: x.label } : {}) },
        fields: [{ kind: "give", key: `base-give-${x.id}`, lead: say("panel.baseLead", l), items: pills, press: { key: `base-drop-${x.id}`, label: say("panel.baseDrop", l), action: { op: "base-drop", item: x.id } } }],
      });
    }
    rows.push({ kind: "input", key: "base-add", field: "base-add", placeholder: say("panel.baseAddHint", l), submitLabel: say("panel.baseAddGo", l) });
  }
  // An agent's entry waiting (P9b′): whose agent would keep it and who said it, what it would keep and for whom, 记下 · 不记.
  for (const x of waiting) {
    const by = badge(x.by);
    rows.push({
      kind: "card", key: `base-wait-${x.id}`, plain: true, ...(by !== undefined ? { badge: by } : {}), lines: [],
      top: text(`base-wants-${x.id}`, say(x.who !== undefined ? "panel.baseWants" : "panel.baseWantsAny", l, { avatar: by?.name ?? x.by, who: x.who ?? "" })),
      fields: [
        text(`base-what-${x.id}`, [x.label, x.text, given(x.for)].filter((w) => w !== "").join(" · "), "plain"),
        { kind: "buttons", key: `base-keep-${x.id}`, items: [
          { key: `base-yes-${x.id}`, label: say("panel.baseKeep", l), primary: true, action: { op: "base-keep", item: x.id, keep: true } },
          { key: `base-no-${x.id}`, label: say("panel.baseSkip", l), action: { op: "base-keep", item: x.id, keep: false } },
        ] },
      ],
    });
  }
  return rows;
}

/** Under 我's cards (P8a): the default name (改 opens it), the language (换 lists them), the account (›), and the version. */
function ownRows(v: GbView, s: PaneState): GbRow[] {
  const l = v.lang, naming = s.editing === "default-name";
  const rows: GbRow[] = [
    { kind: "kv", key: "default-name", label: say("panel.defaultName", l), value: v.defaultName ?? "", note: say("panel.defaultNameNote", l), press: { key: "edit-default-name", label: say("panel.edit", l), action: { op: "edit", card: naming ? null : "default-name" } } },
  ];
  if (naming) rows.push({ kind: "input", key: "default-name-input", field: "default-name", placeholder: say("panel.defaultNameHint", l), ...(v.defaultName !== undefined ? { value: v.defaultName } : {}), submitLabel: say("panel.done", l) });
  rows.push({ kind: "kv", key: "lang", label: say("panel.uiLang", l), value: LANG_NAMES[l], press: { key: "lang-open", label: say("panel.switch", l), action: { op: "lang-open", open: s.langOpen !== true } } });
  if (s.langOpen === true) rows.push({ kind: "list", key: "langs", mark: "tick", items: LANGS.map((x) => ({ key: `lang-${x}`, label: LANG_NAMES[x], on: x === l, action: { op: "lang", lang: x } as GbAction })) });
  rows.push({ kind: "kv", key: "account", label: say("panel.account", l), value: say("panel.accountWhat", l), go: { op: "page", page: "account" } });
  rows.push({ kind: "kv", key: "about", label: say("panel.about", l), value: s.version !== undefined && s.version !== null ? `gemsbang ${s.version}` : "gemsbang" });
  return rows;
}

/** The avatar a new group is made as (Q1): the one picked, else the one the person last spoke as, else their first. */
export const groupAsOf = (v: GbView, groupAs: string): string => (groupAs !== "" ? groupAs : v.recent ?? v.avatars[0]?.id ?? "new");

/** A line around an avatar's pill, from words with {name} in them (以 {name} 建). */
function pickRow(key: string, words: string, badge: Badge, press?: GbPress): GbRow {
  const [lead = "", trail = ""] = words.split("\u0000");
  return { kind: "pick", key, lead: lead.trim(), badge, trail: trail.trim(), ...(press !== undefined ? { press } : {}) };
}

/** 建群 (S4, P2): its name and 建; with two avatars or more, which makes it — the one last spoken as, 换 to pick another or a new one. */
function newGroupRows(v: GbView, s: PaneState): GbRow[] {
  const l = v.lang;
  const rows: GbRow[] = [{ kind: "head", key: "head-new", title: say("panel.newGroup", l), back: { op: "page", page: "inbox" }, backLabel: say("panel.inbox", l), actions: [] }];
  rows.push({ kind: "input", key: "group", field: "group", placeholder: say("panel.groupName", l), submitLabel: say("panel.make", l) });
  if (v.avatars.length < 2) return rows;
  const as = groupAsOf(v, s.groupAs);
  const chosen = v.avatars.find((a) => a.id === as);
  if (s.asOpen === true) {
    // 换 (P2c): theirs, the one picked ticked, and a new one last (Q2).
    rows.push({ kind: "list", key: "as-list", mark: "tick", items: [
      ...v.avatars.map((a) => ({ key: `as-${a.id}`, label: a.name, badge: a, on: a.id === as, action: { op: "group-as", as: a.id } as GbAction })),
      { key: "as-new", label: `${say("panel.newAvatar", l)}…`, on: as === "new", action: { op: "group-as", as: "new" } },
    ] });
  } else if (chosen !== undefined) rows.push(pickRow("as", say("panel.makeAs", l, { name: "\u0000" }), chosen, { key: "as-switch", label: say("panel.switch", l), action: { op: "choose", open: true } }));
  if (as === "new") {
    // A new one's name: the default name as a suggestion, picked by nobody (Q9), or one written.
    if (v.defaultName !== undefined) rows.push({ kind: "buttons", key: "as-suggest", items: [{ key: "as-default", label: v.defaultName, ...(s.groupAvatar === v.defaultName ? { primary: true } : {}), action: { op: "group-avatar", name: v.defaultName } }] });
    rows.push({ kind: "input", key: "group-avatar", field: "group-avatar", placeholder: say("page.name.own", l), ...(s.groupAvatar !== undefined && s.groupAvatar !== null ? { value: s.groupAvatar } : {}) });
  }
  return rows;
}

/** 用链接进群 (S9, P3): the link pasted; then the group, and in as the avatar the inviter knows — 好, 换个身份, 不要 — or one picked, or a new one named. */
function joinRows(v: GbView, s: PaneState): GbRow[] {
  const l = v.lang;
  const j = s.joining ?? null;
  const back: GbAction = j === null ? { op: "page", page: "inbox" } : { op: "join-cancel" };
  if (j === null) return [
    { kind: "head", key: "head-join", title: say("panel.joinLink", l), back, backLabel: say("panel.inbox", l), actions: [] },
    { kind: "input", key: "join", field: "join", placeholder: say("panel.pasteLink", l), submitLabel: say("panel.join.go", l) },
  ];
  if (j.naming === true) {
    // A new avatar's name (P3c): the default name first among the suggestions, none picked (Q9); a blank one fills in the box.
    const names = [...(v.defaultName !== undefined ? [v.defaultName] : []), ...j.suggestions.filter((x) => x.blank !== true && x.text !== v.defaultName).map((x) => x.text)];
    const blanks = j.suggestions.filter((x) => x.blank === true).map((x) => x.text);
    return [
      { kind: "head", key: "head-join-name", title: say("panel.join.nameTitle", l, { group: j.group }), back, backLabel: say("panel.inbox", l), actions: [] },
      { kind: "buttons", key: "join-names", items: [
        ...names.map((n, i) => ({ key: `join-name-${i}`, label: n, action: { op: "join-name", name: n } as GbAction })),
        ...blanks.map((b, i) => ({ key: `join-blank-${i}`, label: b, ...(j.blank === b ? { primary: true } : {}), action: { op: "join-blank", text: j.blank === b ? null : b } as GbAction })),
      ] },
      { kind: "input", key: "join-name", field: "join-name", placeholder: say(j.blank !== undefined && j.blank !== null ? "page.name.child" : "page.name.own", l), submitLabel: say("panel.join.enter", l) },
    ];
  }
  const rows: GbRow[] = [
    { kind: "head", key: "head-join", title: say("panel.joinLink", l), back, backLabel: say("panel.inbox", l), actions: [] },
    text("join-about", say("panel.join.about", l, { group: j.group, count: j.count, owner: j.owner ?? "" }), "plain"),
  ];
  const known = j.pick.kind === "known" && j.switching !== true ? v.avatars.find((a) => a.id === j.pick.avatar) : undefined;
  if (known !== undefined) {
    // The inviter knows one of theirs (S9): it by default, three presses the same size.
    rows.push(pickRow("join-as", say("panel.join.as", l, { name: "\u0000", group: j.group }), known));
    rows.push({ kind: "buttons", key: "join-known", items: [
      { key: "join-yes", label: say("ask.yes", l), primary: true, action: { op: "join-as", as: known.id } },
      { key: "join-switch", label: say("ask.switch", l), action: { op: "join-switch" } },
      { key: "join-no", label: say("ask.no", l), action: { op: "join-cancel" } },
    ] });
    return rows;
  }
  // No shared place (S9): theirs to pick, a new one last.
  rows.push({ kind: "section", key: "join-which", text: say("panel.join.which", l, { group: j.group }) });
  rows.push({ kind: "list", key: "join-list", mark: "arrow", items: [
    ...v.avatars.map((a) => ({ key: `join-as-${a.id}`, label: a.name, badge: a, action: { op: "join-as", as: a.id } as GbAction })),
    { key: "join-new", label: `${say("panel.newAvatar", l)}…`, action: { op: "join-new" } },
  ] });
  rows.push({ kind: "buttons", key: "join-cancel", items: [{ key: "join-no", label: say("ask.no", l), action: { op: "join-cancel" } }] });
  return rows;
}

/** The pane's rows for the page it is on; a chat or 叫人 with no chat open is the inbox. */
export function paneRows(v: GbView, s: PaneState): GbRow[] {
  const rows: GbRow[] = [];
  if (s.problem !== null) rows.push(text("problem", s.problem, "error"));
  if (!v.loggedIn) return [...rows, ...loginRows(v, s)];
  if (v.synced !== undefined && v.avatars.length === 0) return [...rows, ...firstNameRows(v)];
  if (s.page === "chat" && s.chat !== null) return [...rows, ...chatRows(v, s, s.chat)];
  if (s.page === "info" && s.chat !== null) return [...rows, ...infoRows(v, s, s.chat)];
  if (s.page === "invite" && s.chat !== null) return [...rows, ...inviteRows(v, s, s.chat, s.link)];
  if (s.page === "avatars") return [...rows, ...avatarRows(v, s)];
  if (s.page === "account") return [...rows, ...accountRows(v, s)];
  if (s.page === "new-group") return [...rows, ...newGroupRows(v, s)];
  if (s.page === "join") return [...rows, ...joinRows(v, s)];
  return [...rows, ...inboxRows(v, s)];
}

/** The band (transport §4): the first thing that needs the person, with its options and how many more; else, signed in, how many chats have something new; what stops gemsbang; nobody logged in, in the first session alone. */
export function gbBand(v: GbView | null, problem: string | null, now?: string, session?: string): { text: string; tone: Tone; open: string; actions: GbPress[]; more: number } | undefined {
  const l = v?.lang ?? "zh";
  if (problem !== null) return { text: problem, tone: "error", open: say("panel.open", l), actions: [], more: 0 };
  // Nobody signed in (Q14): said in the first session after the install alone; later, the pane says it when opened.
  if (v !== null && !v.loggedIn) return v.firstSession !== undefined && session !== undefined && v.firstSession !== session ? undefined : { text: say("panel.loginBand", l), tone: "dim", open: say("panel.open", l), actions: [], more: 0 };
  const loud = (v?.needs ?? []).filter((n) => !n.muted && n.state === "open" && (now === undefined || n.expires === undefined || Date.parse(n.expires) > Date.parse(now)));
  const calls = (v?.calls ?? []).filter((c) => !c.muted && !c.auto);
  const first = loud[0];
  if (first === undefined) {
    // No card waits: the newest call, with its one step, 交给 agent 回 (architecture §6.3).
    const c = calls[0];
    if (c === undefined) {
      // Nothing waits (S12, 2026-11-04, 本人): the line stays while signed in, a way into the pane; how many chats have
      // something new, the muted not counted (their unread is a grey dot, S17).
      if (v === null) return undefined;
      const fresh = v.rows.filter((r) => r.unread > 0 && !mutedChat(v, r.owner, r.id, r.as.id)).length;
      return { text: fresh > 0 ? say(fresh === 1 ? "band.unreadOne" : "band.unread", l, { count: fresh }) : "Gemsbang", tone: "dim", open: say("panel.open", l), actions: [], more: 0 };
    }
    const lastLine = c.lines[c.lines.length - 1]!;
    // B3: a round handed it failed: the line says so, as an error.
    const said = c.failed !== undefined ? say("call.failed", l, { why: say(`call.why.${c.failed}`, l) }) : say("call.line", l, { who: lastLine.who, text: lastLine.text });
    return { text: `${say("call.kind", l)} · ${c.group} · ${said}`, tone: c.failed !== undefined ? "error" : "plain", open: say("panel.open", l), actions: [{ key: "band-wake-reply", label: say("call.reply", l), primary: true, action: { op: "wake", avatar: c.avatar, owner: c.owner, id: c.id, choice: "reply" } }], more: calls.length - 1 };
  }
  const actions = first.kind === "borrow" ? [] : first.options.slice(0, 3).map((o, i) => ({ key: `band-answer-${i}`, label: o.label, primary: i === 0, action: { op: "answer", avatar: first.avatar, need: first.id, choice: i } as GbAction }));
  return { text: `${say(`need.kind.${first.kind}`, l)} · ${first.summary}`, tone: first.kind === "error" ? "error" : "plain", open: say("panel.open", l), actions, more: loud.length - 1 + calls.length };
}

/** What a field's Enter does: an action for the hooks module, or nothing for an empty field. */
export type FieldAction = { call: string; args: Record<string, unknown> } | { local: "email"; email: string } | { local: "add-email"; email: string } | { local: "group-avatar"; name: string } | { local: "join"; url: string } | { local: "join-name"; name: string };

export function fieldAction(field: GbField, typed: string, s: { chat: GbChat | null; address: string | null; adding?: string | null; groupAs: string; groupAvatar?: string; session?: string; blank?: string | null; baseFor?: string }, target?: string): FieldAction | undefined {
  const t = typed.trim();
  if (t === "" && field !== "default-name" && field !== "repo") return undefined;
  switch (field) {
    case "email": return { local: "email", email: t };
    case "code": return s.address === null ? undefined : { call: "login-verify", args: { email: s.address, code: t } };
    case "first-name": return { call: "first-avatar", args: { name: t, ...(s.session !== undefined && s.session !== "" ? { session: s.session } : {}) } };
    case "add-email": return { local: "add-email", email: t };
    case "add-code": return s.adding === undefined || s.adding === null ? undefined : { call: "method-verify", args: { email: s.adding, code: t } };
    case "say": return s.chat === null ? undefined : { call: "say", args: { owner: s.chat.owner, id: s.chat.id, text: typed } };
    // `groupAs` resolved by the caller (groupAsOf): one of theirs, or "new" with the name picked or typed.
    case "group": return { call: "group", args: { name: t, ...(s.groupAs !== "new" && s.groupAs !== "" ? { as: s.groupAs } : s.groupAvatar !== undefined && s.groupAvatar !== "" ? { avatarName: s.groupAvatar } : {}) } };
    case "group-avatar": return { local: "group-avatar", name: t };
    case "join": return { local: "join", url: t };
    // A blank suggestion (__ 爸爸) filled with what was typed; else the name as typed.
    case "join-name": return { local: "join-name", name: s.blank !== undefined && s.blank !== null ? s.blank.replace("__", t) : t };
    case "rename": return target === undefined ? undefined : { call: "rename", args: { avatar: target, name: t } };
    case "default-name": return { call: "default-name", args: { name: t } };
    case "need-own": {
      const m = /^([^/]+)\/([^/]+)$/.exec(target ?? "");
      return m === null ? undefined : { call: "answer", args: { avatar: m[1], need: m[2], choice: "own", text: typed } };
    }
    case "repo": return target === undefined ? undefined : { call: "repo", args: { avatar: target, path: t } };
    // 底子 (S27): a new entry given to the avatar this session plays; an entry's new words.
    case "base-add": return s.baseFor === undefined ? undefined : { call: "base-add", args: { text: t, for: [s.baseFor] } };
    case "base-text": return target === undefined ? undefined : { call: "base-set", args: { item: target, text: t } };
    default: return undefined;
  }
}
