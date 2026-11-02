// gemsbang's pane in Claude Code (spec §7.1–§7.6, transport §4), as rows the
// hooks module draws: the total inbox first (a filter per avatar, its colour
// and initial; each chat with the avatar that is in it, its last line, its
// time, its unread; a way in when there is none), a chat (who you are there,
// what was said, `分身` by an agent's line, the box 「以 <分身> 说」, 叫人),
// 叫人 (the link for a person, the line for an agent, the owner's two
// switches and a new link), 我的分身 (each avatar's chats, its marking, a
// new name, whether this session speaks for it; the default name), the
// settings (the language, the account, signing out), the account (the ways
// in, the devices signed in) and the sign-in (an email, its code, a name for
// a new person's first avatar; no server to fill in). 需要你 leads the inbox (two whole, more folded, the
// muted apart) and shows in its chat to the person alone; the band says only
// what needs the person — the first card and its options — or that gemsbang
// cannot work or nobody is logged in. Pure and Node-free.
import { factsLine } from "../../core/avatar/borrow.js";
import type { Badge, ChatItem, InboxRow } from "../../core/avatar/inbox.js";
import { expiresIn, foldNeeds } from "../../core/avatar/needs.js";
import { LANGS, say, type Lang } from "../../core/avatar/words.js";
import type { GbAccount, GbCalled, GbChat, GbLink, GbNeed, GbView, GbWork } from "../../gemsbang/ops.js";

export const GB_PANE_ID = "gemsbang-board";
export type GbPage = "inbox" | "chat" | "invite" | "avatars" | "settings" | "account" | "new-group";

export type GbAction =
  | { op: "page"; page: GbPage }
  | { op: "filter"; avatar: string | null }
  | { op: "open"; owner: string; id: string }
  | { op: "copy"; text: string }
  | { op: "rotate" }
  | { op: "link-rules"; forward?: boolean; approve?: boolean }
  | { op: "mark"; avatar: string; mark: boolean }
  | { op: "bind"; avatar: string | null }
  | { op: "group-as"; as: string }
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
  | { op: "more"; what: "needs" | "muted" }
  | { op: "mute"; avatar?: string; venue?: string; on: boolean }
  | { op: "work-now"; avatar: string; work: string }
  /** 被叫到 (architecture §6.3): 回, 以后这个群自动回, or 不回; and 自动回 taken back. */
  | { op: "wake"; avatar: string; owner: string; id: string; choice: "reply" | "auto" | "no" }
  | { op: "auto"; avatar: string; venue: string; on: boolean };
export type GbField = "email" | "code" | "first-name" | "add-email" | "add-code" | "say" | "group" | "group-avatar" | "join" | "rename" | "default-name" | "need-own" | "placeholder" | "repo";
export interface GbPress { key: string; label: string; action: GbAction; primary?: boolean }
export type Tone = "plain" | "dim" | "error" | "success";
export type GbRow =
  | { kind: "head"; key: string; title: string; sub?: string; back?: GbAction; actions: GbPress[] }
  | { kind: "chips"; key: string; items: { key: string; label: string; badge?: Badge; on: boolean; action: GbAction }[] }
  | { kind: "chat"; key: string; row: InboxRow; action: GbAction }
  /** A line said: who, `tag` (分身) where an agent said it, the time, the words; the person's own with their avatar's badge. */
  | { kind: "message"; key: string; item: Extract<ChatItem, { kind: "message" }>; badge?: Badge; tag?: string; time: string }
  | { kind: "text"; key: string; text: string; tone: Tone }
  | { kind: "section"; key: string; text: string; badge?: Badge; note?: string }
  | { kind: "input"; key: string; field: GbField; placeholder: string; target?: string; label?: string }
  | { kind: "select"; key: string; label: string; options: { value: string; label: string }[]; value: string }
  | { kind: "buttons"; key: string; items: GbPress[] }
  | { kind: "toggle"; key: string; label: string; on: boolean; action: GbAction }
  | { kind: "copy"; key: string; text: string; label: string }
  /** A 需要你 card (spec §7.3): whose and what kind and where, how long it still waits when the matter has a deadline (else when it came), what it is, what it checked, the words it would send, a borrow's two switches, the options, 自己写. */
  | { kind: "need"; key: string; badge?: Badge; head: string; expires: string; tone: Tone; summary: string; checked?: string; willSay?: string; toggles: { key: string; label: string; on: boolean; action: GbAction }[]; options: GbPress[]; own?: { target: string; placeholder: string } };

export const LANG_NAMES: Readonly<Record<Lang, string>> = { zh: "中文", en: "English", ja: "日本語" };

/** What the pane holds besides the view: the page, the filter, the chat and the link open, the email a sign-in code went to, the avatar a new group is made as; the account as last read and an email being added. */
export interface PaneState {
  page: GbPage; filter: string | null; chat: GbChat | null; link: GbLink | null; address: string | null; groupAs: string; session: string; problem: string | null; zoneMinutes?: number; now: string;
  account?: GbAccount | null; adding?: string | null;
  /** 需要你 unfolded, the muted ones shown, a borrow's switches as set. */
  needsOpen?: boolean; mutedOpen?: boolean; allow?: Record<string, { person?: boolean; venue?: boolean }>;
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
  const rows: GbRow[] = [{ kind: "head", key: "head-account", title: say("account.title", l), sub: say("account.sub", l), back: { op: "page", page: "settings" }, actions: [] }];
  const a = s.account ?? null;
  if (a === null) return [...rows, text("account-loading", say("account.loading", l))];
  rows.push({ kind: "section", key: "methods", text: say("account.methods", l) });
  for (const m of a.methods) {
    rows.push(text(`method-${m.id}`, `${say(`account.kind.${m.kind}`, l)} · ${m.shown}`, "plain"));
    if (a.methods.length > 1) rows.push({ kind: "buttons", key: `method-remove-${m.id}`, items: [{ key: `remove-${m.id}`, label: say("account.unbind", l), action: { op: "method-remove", id: m.id } }] });
  }
  if (a.methods.length === 1) rows.push(text("method-last", say("account.lastOne", l)));
  rows.push({ kind: "section", key: "add", text: say("account.add", l) });
  const adding = s.adding ?? null;
  if (adding === null) rows.push({ kind: "input", key: "add-email", field: "add-email", label: say("account.kind.email", l), placeholder: say("signin.emailHint", l) });
  else {
    rows.push(text("add-sent", say("code.sentTo", l, { to: adding, from: hostOf(v.relay) }), "plain"));
    rows.push({ kind: "input", key: "add-code", field: "add-code", label: say("page.code", l), placeholder: say("signin.codeHint", l) });
    rows.push({ kind: "buttons", key: "add-cancel", items: [{ key: "add-cancel", label: say("signin.other", l), action: { op: "add-cancel" } }] });
  }
  rows.push(text("add-later", say("account.later", l)));
  rows.push(text("add-same", say("account.same", l)));
  rows.push({ kind: "section", key: "devices", text: say("account.devices", l) });
  for (const d of a.devices) {
    const plays = d.avatars.length > 0 ? ` · ${say("account.plays", l, { names: d.avatars.map((x) => `「${x.name}」`).join("") })}` : "";
    rows.push(text(`device-${d.id}`, `${d.name === "" ? say("account.unnamed", l) : d.name}${plays} · ${d.current ? say("account.here", l) : dayTime(d.at, s.zoneMinutes)}`, d.current ? "plain" : "dim"));
    if (!d.current) rows.push({ kind: "buttons", key: `device-revoke-${d.id}`, items: [{ key: `revoke-${d.id}`, label: say("account.signOut", l), action: { op: "device-revoke", id: d.id } }] });
  }
  if (a.devices.some((d) => !d.current)) rows.push({ kind: "buttons", key: "revoke-others", items: [{ key: "revoke-others", label: say("account.signOutOthers", l), action: { op: "devices-revoke-others" } }] });
  return rows;
}

/** One card's row: in the inbox it says whose and where; in its chat, that only the person sees it and the avatar waits. */
function needRow(n: GbNeed, l: Lang, s: PaneState, where: "inbox" | "chat"): GbRow {
  const kind = say(`need.kind.${n.kind}`, l);
  const head = where === "chat" ? `${say("need.onlyYou", l)} · ${kind} · ${say("need.waiting", l)}` : say("need.from", l, { avatar: n.avatarName, kind, group: n.group ?? "" });
  const allow = s.allow?.[n.id] ?? {};
  const expired = n.state === "expired";
  const toggles = n.kind === "borrow" && !expired ? [
    { key: `allow-person-${n.id}`, label: say("need.borrow.person", l), on: allow.person === true, action: { op: "allow", need: n.id, person: allow.person !== true } as GbAction },
    { key: `allow-venue-${n.id}`, label: say("need.borrow.venue", l), on: allow.venue === true, action: { op: "allow", need: n.id, venue: allow.venue !== true } as GbAction },
  ] : [];
  const options: GbPress[] = expired ? [] : n.options.map((o, i) => ({ key: `answer-${n.id}-${i}`, label: o.label, primary: i === 0, action: { op: "answer", avatar: n.avatar, need: n.id, choice: i, ...(n.kind === "borrow" && i === 0 && allow.person === true ? { allowPerson: true } : {}), ...(n.kind === "borrow" && i === 0 && allow.venue === true ? { allowVenue: true } : {}) } }));
  return {
    kind: "need", key: `need-${where}-${n.avatar}-${n.id}`, ...(n.badge !== undefined ? { badge: n.badge } : {}), head, expires: n.expires !== undefined ? expiresIn(n.expires, s.now, l) : hhmm(n.at, s.zoneMinutes), tone: expired ? "dim" : n.kind === "error" ? "error" : "plain",
    summary: n.summary, ...(n.checked !== undefined ? { checked: say("need.checked", l, { text: n.checked }) } : {}), ...(n.draft !== undefined ? { willSay: say("need.willSay", l, { text: n.draft }) } : {}),
    // A borrow's card says where the work would happen and what may be done there (spec §7.4).
    ...(n.kind === "borrow" ? { willSay: `${n.repo !== undefined ? say("need.repo", l, { repo: n.repo }) : say("need.noRepo", l)}\n${say("need.borrowScope", l)}` } : {}),
    toggles, options, ...(!expired && n.kind !== "borrow" && n.kind !== "error" && n.request === undefined ? { own: { target: `${n.avatar}/${n.id}`, placeholder: say("need.ownHint", l) } } : {}),
  };
}

/** A call on an avatar (architecture §6.3), drawn as a card: who called it and where, the lines, and 回, 以后这个群自动回, 不回; in its chat, that only the person sees it. */
function callRow(c: GbCalled, l: Lang, s: PaneState, where: "inbox" | "chat"): GbRow {
  const head = where === "chat" ? say("call.onlyYou", l) : say("call.from", l, { avatar: c.badge?.name ?? "", group: c.group });
  const shown = c.lines.slice(-3).map((x) => say("call.line", l, { who: x.who, text: x.text }));
  const press = (choice: "reply" | "auto" | "no"): GbAction => ({ op: "wake", avatar: c.avatar, owner: c.owner, id: c.id, choice });
  return {
    kind: "need", key: `call-${where}-${c.avatar}-${c.owner}-${c.id}`, ...(c.badge !== undefined ? { badge: c.badge } : {}), head, expires: hhmm(c.at, s.zoneMinutes), tone: "plain",
    summary: [...(c.lines.length > 3 ? [say("call.more", l, { count: c.lines.length - 3 })] : []), ...shown].join("\n"),
    ...(where === "chat" ? { checked: say("call.hint", l) } : {}),
    toggles: [],
    options: [
      { key: `wake-reply-${c.avatar}-${c.id}`, label: say("call.reply", l), primary: true, action: press("reply") },
      { key: `wake-auto-${c.avatar}-${c.id}`, label: say(c.kind === "dm" ? "call.autoDm" : "call.auto", l), action: press("auto") },
      { key: `wake-no-${c.avatar}-${c.id}`, label: say("call.no", l), action: press("no") },
    ],
  };
}

/** What the person is asked about: calls in chats that do not answer on their own, and 需要你's cards — errors first, then the newest, the expired last. */
type Asked = { call: GbCalled } | { need: GbNeed };
function askedOf(needs: readonly GbNeed[], calls: readonly GbCalled[]): Asked[] {
  const rank = (a: Asked): number => ("need" in a ? (a.need.state === "expired" ? 2 : a.need.kind === "error" ? 0 : 1) : 1);
  const at = (a: Asked): string => ("need" in a ? a.need.at : a.call.at);
  return [...needs.map((need) => ({ need })), ...calls.filter((c) => !c.auto).map((call) => ({ call }))].sort((a, b) => rank(a) - rank(b) || (at(a) > at(b) ? -1 : at(a) < at(b) ? 1 : 0));
}

/** 需要你 at the top of the inbox (spec §7.1, §7.3; architecture §6.3): the calls and the cards, two whole, more folded behind 还有 N 件; the muted counted apart. */
function needRows(v: GbView, s: PaneState): GbRow[] {
  const l = v.lang;
  const all = askedOf(v.needs, v.calls ?? []); // a view from a bridge older than the calls has none
  const muted = (a: Asked): boolean => ("need" in a ? a.need.muted : a.call.muted);
  const loud = all.filter((a) => !muted(a)), quiet = all.filter(muted);
  if (all.length === 0) return [];
  const row = (a: Asked): GbRow => ("need" in a ? needRow(a.need, l, s, "inbox") : callRow(a.call, l, s, "inbox"));
  const rows: GbRow[] = [{ kind: "section", key: "needs", text: `${say("need.title", l)} ${loud.filter((a) => !("need" in a) || a.need.state === "open").length}` }];
  const fold = foldNeeds(loud, s.needsOpen === true);
  for (const a of fold.shown) rows.push(row(a));
  const more: GbPress[] = [];
  if (fold.folded > 0) more.push({ key: "needs-more", label: say("need.more", l, { count: fold.folded }), action: { op: "more", what: "needs" } });
  if (quiet.length > 0 && s.mutedOpen !== true) more.push({ key: "needs-muted", label: say("need.muted", l, { count: quiet.length }), action: { op: "more", what: "muted" } });
  if (more.length > 0) rows.push({ kind: "buttons", key: "needs-folded", items: more });
  if (s.mutedOpen === true) for (const a of quiet) rows.push(row(a));
  return rows;
}

/** The jobs for this person's computers (spec §7.4): whose, where they stand, from which chat; a queued one can start now. */
function workRows(v: GbView): GbRow[] {
  const l = v.lang;
  const work: GbWork[] = v.work ?? []; // a view from a bridge older than the jobs has none
  if (work.length === 0) return [];
  const open = work.filter((w) => w.state === "waiting" || w.state === "queued" || w.state === "taken").length;
  const rows: GbRow[] = [{ kind: "section", key: "work", text: `${say("panel.work", l)} ${open}` }];
  for (const w of work) {
    const where = w.group !== undefined ? `「${w.group}」：` : "";
    rows.push(text(`work-${w.avatar}-${w.id}`, `${w.avatarName} · ${say(`work.state.${w.state}`, l)}${w.auto === true ? ` · ${say("work.auto", l)}` : ""} · ${where}${w.summary}`, w.state === "failed" ? "error" : w.state === "done" ? "dim" : "plain"));
    if (w.state === "queued") rows.push({ kind: "buttons", key: `work-now-${w.avatar}-${w.id}`, items: [{ key: `now-${w.avatar}-${w.id}`, label: say("work.now", l), primary: true, action: { op: "work-now", avatar: w.avatar, work: w.id } }] });
  }
  return rows;
}

/** The total inbox (spec §7.1). */
function inboxRows(v: GbView, s: PaneState): GbRow[] {
  const l = v.lang;
  const rows: GbRow[] = [{ kind: "head", key: "head-inbox", title: "Gemsbang", ...(v.unread > 0 ? { sub: say("panel.unreadBand", l, { count: v.unread }) } : {}), actions: [
    { key: "go-avatars", label: say("panel.avatars", l), action: { op: "page", page: "avatars" } },
    { key: "go-settings", label: say("panel.settings", l), action: { op: "page", page: "settings" } },
  ] }];
  if (v.offline !== undefined) rows.push(text("offline", say("panel.offline", l, { detail: v.offline }), "error"));
  for (const n of v.notes) rows.push(text(`note-${n.url}`, say("panel.notFollowed", l, { url: n.url }), "error"));
  rows.push(...needRows(v, s));
  rows.push(...workRows(v));
  if (v.avatars.length > 1) {
    rows.push({ kind: "chips", key: "filters", items: [
      { key: "filter-all", label: say("panel.all", l), on: s.filter === null, action: { op: "filter", avatar: null } },
      ...v.avatars.map((a) => ({ key: `filter-${a.id}`, label: a.name, badge: a, on: s.filter === a.id, action: { op: "filter", avatar: a.id } as GbAction })),
    ] });
  }
  const shown = s.filter === null ? v.rows : v.rows.filter((r) => r.as.id === s.filter);
  if (shown.length === 0) {
    // Just signed in: who this computer's Claude Code plays now, and the two ways to a first chat.
    const mine = v.avatars.find((a) => a.id === v.bodies[s.session]);
    if (mine !== undefined && v.rows.length === 0) rows.push(text("attached", say("panel.attached", l, { name: mine.name }), "plain"));
    rows.push(text("empty", say("panel.empty", l)));
  }
  else {
    rows.push({ kind: "section", key: "chats", text: say("panel.chats", l) });
    for (const r of shown) rows.push({ kind: "chat", key: `chat-${r.owner}-${r.id}`, row: r, action: { op: "open", owner: r.owner, id: r.id } });
  }
  rows.push({ kind: "input", key: "join", field: "join", placeholder: say("panel.pasteLink", l) });
  rows.push({ kind: "buttons", key: "new", items: [{ key: "new-group", label: say("panel.newGroup", l), action: { op: "page", page: "new-group" } }] });
  return rows;
}

/** A time as the chat's lines carry it, HH:MM in the person's zone. */
const hhmm = (at: string, zoneMinutes = 0): string => {
  const t = Date.parse(at);
  if (Number.isNaN(t)) return "";
  const d = new Date(t + zoneMinutes * 60_000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};

/** One chat (spec §7.2). */
function chatRows(v: GbView, s: PaneState, c: GbChat): GbRow[] {
  const l = v.lang;
  const me = c.as?.name ?? "";
  const key = `${c.owner}/${c.id}`;
  const muted = v.muted.venues.includes(key);
  const rows: GbRow[] = [{ kind: "head", key: "head-chat", title: c.name, sub: `${say("page.join.count", l, { count: c.count })} · ${say("page.group.as", l, { name: me })}`, back: { op: "page", page: "inbox" }, actions: [
    ...(c.kind === "group" ? [{ key: "go-invite", label: say("panel.invite", l), action: { op: "page", page: "invite" } as GbAction }] : []),
    { key: "mute-venue", label: say(muted ? "panel.unmute" : "panel.mute", l), action: { op: "mute", venue: key, on: !muted } },
  ] }];
  for (const k of v.calls ?? []) if (k.owner === c.owner && k.id === c.id && k.avatar === c.as?.id && !k.auto) rows.push(callRow(k, l, s, "chat"));
  for (const n of v.needs) if (n.venue !== undefined && n.venue.owner === c.owner && n.venue.id === c.id && n.state === "open") rows.push(needRow(n, l, s, "chat"));
  if (c.earlier > 0) rows.push(text("earlier", say("panel.earlier", l, { count: c.earlier })));
  if (c.items.every((i) => i.kind !== "message")) rows.push(text("quiet", say("page.group.empty", l)));
  for (const i of c.items) {
    if (i.kind === "joined") rows.push(text(`joined-${i.id}`, say("page.group.joined", l, { name: i.who })));
    else if (i.kind === "note") rows.push(text(`note-${i.id}`, say("page.group.hops", l), "dim"));
    else {
      rows.push({ kind: "message", key: `msg-${i.id}`, item: i, ...(i.mine && c.as !== undefined ? { badge: c.as } : {}), ...(i.mark ? { tag: say("page.group.mark", l) } : {}), time: hhmm(i.at, s.zoneMinutes ?? c.zoneMinutes) });
      // What the host saw when a borrowed computer did the work (spec §7.4).
      if (i.facts !== undefined) rows.push(text(`facts-${i.id}`, factsLine(i.facts, l), i.facts.every((f) => f.ok) ? "success" : "error"));
    }
  }
  rows.push({ kind: "input", key: "say", field: "say", placeholder: say("page.group.say", l, { name: me }) });
  return rows;
}

/** 叫人 (spec §6.1): the link for people, the line for agents, the owner's switches. */
function inviteRows(v: GbView, c: GbChat, k: GbLink | null): GbRow[] {
  const l = v.lang;
  const rows: GbRow[] = [{ kind: "head", key: "head-invite", title: say("panel.invite.title", l, { group: c.name }), sub: `${say("page.join.count", l, { count: c.count })} · ${say("page.group.as", l, { name: c.as?.name ?? "" })}`, back: { op: "page", page: "chat" }, actions: [] }];
  if (k === null) return [...rows, text("link-wait", "…")];
  rows.push({ kind: "section", key: "people", text: say("panel.invite.people", l) }, text("people-hint", say("panel.invite.peopleHint", l)), { kind: "copy", key: "copy-link", text: k.url, label: say("panel.invite.copyLink", l) });
  rows.push({ kind: "section", key: "agents", text: say("panel.invite.agents", l) }, text("agents-hint", say("panel.invite.agentsHint", l)), { kind: "copy", key: "copy-line", text: k.line, label: say("panel.invite.copyLine", l) });
  if (k.isOwner) {
    rows.push({ kind: "toggle", key: "forward", label: say("panel.invite.forward", l), on: k.forward, action: { op: "link-rules", forward: !k.forward } });
    rows.push({ kind: "toggle", key: "approve", label: say("panel.invite.approve", l), on: k.approve, action: { op: "link-rules", approve: !k.approve } });
    rows.push(text("owner", say("panel.invite.owner", l, { days: k.days })));
    rows.push({ kind: "buttons", key: "rotate", items: [{ key: "rotate", label: say("panel.invite.rotate", l), action: { op: "rotate" } }] });
  } else rows.push(text("days", say("panel.invite.days", l, { days: k.days })));
  return rows;
}

/** 我的分身 (spec §7.5). */
function avatarRows(v: GbView, s: PaneState): GbRow[] {
  const l = v.lang;
  const rows: GbRow[] = [{ kind: "head", key: "head-avatars", title: say("panel.avatars", l), sub: say("panel.avatarsHint", l), back: { op: "page", page: "inbox" }, actions: [] }];
  const body = v.bodies[s.session];
  for (const a of v.avatars) {
    rows.push({ kind: "section", key: `avatar-${a.id}`, text: a.name, badge: a });
    rows.push(text(`where-${a.id}`, `${say("panel.where", l)}：${a.venues.length > 0 ? a.venues.join(" · ") : say("panel.nowhere", l)}`));
    rows.push({ kind: "toggle", key: `mark-${a.id}`, label: `${say("panel.mark", l)}：${say(a.mark ? "panel.markOn" : "panel.markOff", l)}`, on: a.mark, action: { op: "mark", avatar: a.id, mark: !a.mark } });
    // 被叫到 and 自动回 (architecture §6.3): asked first, except in the chats set to answer on their own.
    const autos = a.autos ?? [];
    rows.push(text(`called-${a.id}`, say("panel.called", l), "plain"));
    rows.push(text(`auto-${a.id}`, autos.length === 0 ? say("panel.autoNone", l) : say("panel.auto", l, { venues: autos.map((x) => x.name).join(" · ") }), autos.length === 0 ? "dim" : "plain"));
    if (autos.length > 0) rows.push({ kind: "buttons", key: `auto-off-${a.id}`, items: autos.map((x) => ({ key: `auto-off-${a.id}-${x.venue}`, label: say("panel.autoOff", l, { name: x.name }), action: { op: "auto", avatar: a.id, venue: x.venue, on: false } as GbAction })) });
    rows.push({ kind: "toggle", key: `mute-${a.id}`, label: say("panel.mute", l), on: a.muted, action: { op: "mute", avatar: a.id, on: !a.muted } });
    rows.push({ kind: "input", key: `placeholder-${a.id}`, field: "placeholder", target: a.id, label: say("panel.placeholder", l), placeholder: a.placeholder ?? say("need.placeholder", l) });
    rows.push({ kind: "input", key: `rename-${a.id}`, field: "rename", target: a.id, placeholder: say("panel.rename", l) });
    rows.push(body === a.id
      ? { kind: "buttons", key: `body-${a.id}`, items: [{ key: `unbind-${a.id}`, label: `${say("panel.isBody", l)} · ${say("panel.unbody", l)}`, action: { op: "bind", avatar: null } }] }
      : { kind: "buttons", key: `body-${a.id}`, items: [{ key: `bind-${a.id}`, label: say("panel.body", l), action: { op: "bind", avatar: a.id } }] });
    rows.push(text(`repo-${a.id}`, a.repo !== undefined ? say("panel.repo", l, { repo: a.repo }) : say("panel.noRepo", l), a.repo !== undefined ? "plain" : "dim"));
    rows.push({ kind: "input", key: `repo-input-${a.id}`, field: "repo", target: a.id, placeholder: say("panel.repoInput", l) });
  }
  rows.push({ kind: "section", key: "default-name", text: say("panel.defaultName", l), ...(v.defaultName !== undefined ? { note: v.defaultName } : {}) });
  rows.push({ kind: "input", key: "default-name-input", field: "default-name", placeholder: say("panel.defaultNameHint", l) });
  rows.push(langRow(l));
  return rows;
}

function settingsRows(v: GbView): GbRow[] {
  const l = v.lang;
  return [
    { kind: "head", key: "head-settings", title: say("panel.settings", l), back: { op: "page", page: "inbox" }, actions: [] },
    langRow(l),
    { kind: "buttons", key: "account", items: [{ key: "go-account", label: say("account.title", l), action: { op: "page", page: "account" } }] },
    { kind: "buttons", key: "logout", items: [{ key: "logout", label: say("panel.logout", l), action: { op: "logout" } }] },
  ];
}

/** 建群 (spec §7.1): which avatar makes it — one of theirs, or a new one with the name typed (none, a random one) — and its name. */
function newGroupRows(v: GbView, s: PaneState): GbRow[] {
  const l = v.lang;
  const rows: GbRow[] = [{ kind: "head", key: "head-new", title: say("panel.newGroup", l), back: { op: "page", page: "inbox" }, actions: [] }];
  rows.push({ kind: "section", key: "as", text: say("panel.groupAs", l) });
  rows.push({ kind: "chips", key: "as-chips", items: [
    ...v.avatars.map((a) => ({ key: `as-${a.id}`, label: a.name, badge: a, on: s.groupAs === a.id, action: { op: "group-as", as: a.id } as GbAction })),
    { key: "as-new", label: say("panel.newAvatar", l), on: s.groupAs === "new", action: { op: "group-as", as: "new" } },
  ] });
  if (s.groupAs === "new") rows.push({ kind: "input", key: "group-avatar", field: "group-avatar", placeholder: say("page.name.own", l) });
  rows.push({ kind: "input", key: "group", field: "group", placeholder: say("panel.groupName", l) });
  return rows;
}

/** The pane's rows for the page it is on; a chat or 叫人 with no chat open is the inbox. */
export function paneRows(v: GbView, s: PaneState): GbRow[] {
  const rows: GbRow[] = [];
  if (s.problem !== null) rows.push(text("problem", s.problem, "error"));
  if (!v.loggedIn) return [...rows, ...loginRows(v, s)];
  if (v.synced !== undefined && v.avatars.length === 0) return [...rows, ...firstNameRows(v)];
  if (s.page === "chat" && s.chat !== null) return [...rows, ...chatRows(v, s, s.chat)];
  if (s.page === "invite" && s.chat !== null) return [...rows, ...inviteRows(v, s.chat, s.link)];
  if (s.page === "avatars") return [...rows, ...avatarRows(v, s)];
  if (s.page === "settings") return [...rows, ...settingsRows(v)];
  if (s.page === "account") return [...rows, ...accountRows(v, s)];
  if (s.page === "new-group") return [...rows, ...newGroupRows(v, s)];
  return [...rows, ...inboxRows(v, s)];
}

/** The band (transport §4): the first thing that needs the person, with its options and how many more; else nothing, unless gemsbang cannot work or nobody is logged in. */
export function gbBand(v: GbView | null, problem: string | null, now?: string): { text: string; tone: Tone; open: string; actions: GbPress[]; more: number } | undefined {
  const l = v?.lang ?? "zh";
  if (problem !== null) return { text: problem, tone: "error", open: say("panel.open", l), actions: [], more: 0 };
  if (v !== null && !v.loggedIn) return { text: say("panel.loginBand", l), tone: "dim", open: say("panel.open", l), actions: [], more: 0 };
  const loud = (v?.needs ?? []).filter((n) => !n.muted && n.state === "open" && (now === undefined || n.expires === undefined || Date.parse(n.expires) > Date.parse(now)));
  const calls = (v?.calls ?? []).filter((c) => !c.muted && !c.auto);
  const first = loud[0];
  if (first === undefined) {
    // No card waits: the newest call, with 回 and 不回 (architecture §6.3).
    const c = calls[0];
    if (c === undefined) return undefined;
    const lastLine = c.lines[c.lines.length - 1]!;
    const press = (choice: "reply" | "no"): GbAction => ({ op: "wake", avatar: c.avatar, owner: c.owner, id: c.id, choice });
    return { text: `${say("call.kind", l)} · ${c.group} · ${say("call.line", l, { who: lastLine.who, text: lastLine.text })}`, tone: "plain", open: say("panel.open", l), actions: [{ key: "band-wake-reply", label: say("call.reply", l), primary: true, action: press("reply") }, { key: "band-wake-no", label: say("call.no", l), action: press("no") }], more: calls.length - 1 };
  }
  const actions = first.kind === "borrow" ? [] : first.options.slice(0, 3).map((o, i) => ({ key: `band-answer-${i}`, label: o.label, primary: i === 0, action: { op: "answer", avatar: first.avatar, need: first.id, choice: i } as GbAction }));
  return { text: `${say(`need.kind.${first.kind}`, l)} · ${first.summary}`, tone: first.kind === "error" ? "error" : "plain", open: say("panel.open", l), actions, more: loud.length - 1 + calls.length };
}

/** What a field's Enter does: an action for the hooks module, or nothing for an empty field. */
export type FieldAction = { call: string; args: Record<string, unknown> } | { local: "email"; email: string } | { local: "add-email"; email: string } | { local: "group-avatar"; name: string } | { local: "join"; url: string };

export function fieldAction(field: GbField, typed: string, s: { chat: GbChat | null; address: string | null; adding?: string | null; groupAs: string; groupAvatar?: string; session?: string }, target?: string): FieldAction | undefined {
  const t = typed.trim();
  if (t === "" && field !== "default-name" && field !== "repo") return undefined;
  switch (field) {
    case "email": return { local: "email", email: t };
    case "code": return s.address === null ? undefined : { call: "login-verify", args: { email: s.address, code: t } };
    case "first-name": return { call: "first-avatar", args: { name: t, ...(s.session !== undefined && s.session !== "" ? { session: s.session } : {}) } };
    case "add-email": return { local: "add-email", email: t };
    case "add-code": return s.adding === undefined || s.adding === null ? undefined : { call: "method-verify", args: { email: s.adding, code: t } };
    case "say": return s.chat === null ? undefined : { call: "say", args: { owner: s.chat.owner, id: s.chat.id, text: typed } };
    case "group": return { call: "group", args: { name: t, ...(s.groupAs !== "new" ? { as: s.groupAs } : s.groupAvatar !== undefined && s.groupAvatar !== "" ? { avatarName: s.groupAvatar } : {}) } };
    case "group-avatar": return { local: "group-avatar", name: t };
    case "join": return { local: "join", url: t };
    case "rename": return target === undefined ? undefined : { call: "rename", args: { avatar: target, name: t } };
    case "default-name": return { call: "default-name", args: { name: t } };
    case "need-own": {
      const m = /^([^/]+)\/([^/]+)$/.exec(target ?? "");
      return m === null ? undefined : { call: "answer", args: { avatar: m[1], need: m[2], choice: "own", text: typed } };
    }
    case "placeholder": return target === undefined ? undefined : { call: "placeholder", args: { avatar: target, text: t } };
    case "repo": return target === undefined ? undefined : { call: "repo", args: { avatar: target, path: t } };
    default: return undefined;
  }
}
