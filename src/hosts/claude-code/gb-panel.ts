// gemsbang's pane in Claude Code (spec §7.1–§7.6, transport §4), as rows the
// hooks module draws: the total inbox first (a filter per avatar, its colour
// and initial; each chat with the avatar that is in it, its last line, its
// time, its unread; a way in when there is none), a chat (who you are there,
// what was said, `分身` by an agent's line, the box 「以 <分身> 说」, 叫人),
// 叫人 (the link for a person, the line for an agent, the owner's two
// switches and a new link), 我的分身 (each avatar's chats, its marking, a
// new name, whether this session speaks for it; the default name), the
// settings (the relay, the language, logging out) and the login (the relay,
// the phone, the code). 需要你 leads the inbox (two whole, more folded, the
// muted apart) and shows in its chat to the person alone; the band says only
// what needs the person — the first card and its options — or that gemsbang
// cannot work or nobody is logged in. Pure and Node-free.
import { factsLine } from "../../core/avatar/borrow.js";
import type { Badge, ChatItem, InboxRow } from "../../core/avatar/inbox.js";
import { expiresIn, foldNeeds } from "../../core/avatar/needs.js";
import { LANGS, say, type Lang } from "../../core/avatar/words.js";
import type { GbChat, GbLink, GbNeed, GbView, GbWork } from "../../gemsbang/ops.js";

export const GB_PANE_ID = "gemsbang-board";
export type GbPage = "inbox" | "chat" | "invite" | "avatars" | "settings" | "new-group";

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
  /** 需要你: an option pressed; a borrow carries whether to stop asking for its asker or its chat. */
  | { op: "answer"; avatar: string; need: string; choice: number; allowPerson?: boolean; allowVenue?: boolean }
  | { op: "allow"; need: string; person?: boolean; venue?: boolean }
  | { op: "more"; what: "needs" | "muted" }
  | { op: "mute"; avatar?: string; venue?: string; on: boolean }
  | { op: "pause"; avatar: string; paused: boolean }
  | { op: "work-now"; avatar: string; work: string }
  | { op: "key-remove" };
export type GbField = "relay" | "phone" | "code" | "say" | "group" | "group-avatar" | "join" | "rename" | "default-name" | "need-own" | "placeholder" | "api-key" | "repo";
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
  /** A 需要你 card (spec §7.3): whose and what kind and where, how long it waits, what it is, what it checked, the words it would send, a borrow's two switches, the options, 自己写. */
  | { kind: "need"; key: string; badge?: Badge; head: string; expires: string; tone: Tone; summary: string; checked?: string; willSay?: string; toggles: { key: string; label: string; on: boolean; action: GbAction }[]; options: GbPress[]; own?: { target: string; placeholder: string } };

export const LANG_NAMES: Readonly<Record<Lang, string>> = { zh: "中文", en: "English", ja: "日本語" };

/** What the pane holds besides the view: the page, the filter, the chat and the link open, what is typed for the login, the avatar a new group is made as. */
export interface PaneState {
  page: GbPage; filter: string | null; chat: GbChat | null; link: GbLink | null; phone: string | null; groupAs: string; session: string; problem: string | null; zoneMinutes?: number; now: string;
  /** 需要你 unfolded, the muted ones shown, a borrow's switches as set. */
  needsOpen?: boolean; mutedOpen?: boolean; allow?: Record<string, { person?: boolean; venue?: boolean }>;
}

const text = (key: string, s: string, tone: Tone = "dim"): GbRow => ({ kind: "text", key, text: s, tone });
const langRow = (lang: Lang): GbRow => ({ kind: "select", key: "lang", label: say("page.lang", lang), options: LANGS.map((l) => ({ value: l, label: LANG_NAMES[l] })), value: lang });

/** The login: the relay's address, then the phone, then the code (spec §6.2, transport §2.5). */
function loginRows(v: GbView, s: PaneState): GbRow[] {
  const l = v.lang;
  const rows: GbRow[] = [{ kind: "head", key: "head-login", title: say("page.login.title", l), actions: [] }];
  if (v.relay === "") {
    rows.push({ kind: "input", key: "relay", field: "relay", label: say("panel.relay", l), placeholder: say("panel.relayHint", l) });
  } else {
    rows.push(text("relay-set", say("panel.relaySet", l, { relay: v.relay })));
    if (s.phone === null) rows.push({ kind: "input", key: "phone", field: "phone", placeholder: say("page.phone", l) });
    else {
      rows.push(text("code-sent", `${s.phone} · ${say("code.sent", l)}`));
      rows.push({ kind: "input", key: "code", field: "code", placeholder: say("page.code", l) });
      rows.push({ kind: "buttons", key: "login-again", items: [{ key: "resend", label: say("page.sendCode", l), action: { op: "resend" } }] });
    }
    rows.push({ kind: "input", key: "relay-change", field: "relay", label: say("panel.relay", l), placeholder: v.relay });
  }
  rows.push(langRow(l));
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
    kind: "need", key: `need-${where}-${n.avatar}-${n.id}`, ...(n.badge !== undefined ? { badge: n.badge } : {}), head, expires: expiresIn(n.expires, s.now, l), tone: expired ? "dim" : n.kind === "error" ? "error" : "plain",
    summary: n.summary, ...(n.checked !== undefined ? { checked: say("need.checked", l, { text: n.checked }) } : {}), ...(n.draft !== undefined ? { willSay: say("need.willSay", l, { text: n.draft }) } : {}),
    // A borrow's card says where the work would happen and what may be done there (spec §7.4).
    ...(n.kind === "borrow" ? { willSay: `${n.repo !== undefined ? say("need.repo", l, { repo: n.repo }) : say("need.noRepo", l)}\n${say("need.borrowScope", l)}` } : {}),
    toggles, options, ...(!expired && n.kind !== "borrow" && n.kind !== "error" && n.request === undefined ? { own: { target: `${n.avatar}/${n.id}`, placeholder: say("need.ownHint", l) } } : {}),
  };
}

/** 需要你 at the top of the inbox (spec §7.1, §7.3): two whole, more folded behind 还有 N 件; the muted counted apart. */
function needRows(v: GbView, s: PaneState): GbRow[] {
  const l = v.lang;
  const loud = v.needs.filter((n) => !n.muted), quiet = v.needs.filter((n) => n.muted);
  if (v.needs.length === 0) return [];
  const rows: GbRow[] = [{ kind: "section", key: "needs", text: `${say("need.title", l)} ${loud.filter((n) => n.state === "open").length}` }];
  const fold = foldNeeds(loud, s.needsOpen === true);
  for (const n of fold.shown) rows.push(needRow(n, l, s, "inbox"));
  const more: GbPress[] = [];
  if (fold.folded > 0) more.push({ key: "needs-more", label: say("need.more", l, { count: fold.folded }), action: { op: "more", what: "needs" } });
  if (quiet.length > 0 && s.mutedOpen !== true) more.push({ key: "needs-muted", label: say("need.muted", l, { count: quiet.length }), action: { op: "more", what: "muted" } });
  if (more.length > 0) rows.push({ kind: "buttons", key: "needs-folded", items: more });
  if (s.mutedOpen === true) for (const n of quiet) rows.push(needRow(n, l, s, "inbox"));
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
  if (shown.length === 0) rows.push(text("empty", say("panel.empty", l)));
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
  for (const n of v.needs) if (n.venue !== undefined && n.venue.owner === c.owner && n.venue.id === c.id && n.state === "open") rows.push(needRow(n, l, s, "chat"));
  for (const name of c.away ?? []) rows.push(text(`away-${name}`, say("panel.away", l, { name })));
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
    rows.push(text(`hosted-${a.id}`, `${say("panel.hosted", l, { count: a.week })}${a.away ? ` · ${say("hosted.away", l)}` : ""}`));
    rows.push({ kind: "toggle", key: `pause-${a.id}`, label: say("panel.pause", l), on: a.paused, action: { op: "pause", avatar: a.id, paused: !a.paused } });
    rows.push({ kind: "toggle", key: `mute-${a.id}`, label: say("panel.mute", l), on: a.muted, action: { op: "mute", avatar: a.id, on: !a.muted } });
    rows.push({ kind: "input", key: `placeholder-${a.id}`, field: "placeholder", target: a.id, label: say("panel.placeholder", l), placeholder: a.placeholder ?? say("need.placeholder", l) });
    rows.push({ kind: "input", key: `rename-${a.id}`, field: "rename", target: a.id, placeholder: say("panel.rename", l) });
    rows.push(body === a.id
      ? { kind: "buttons", key: `body-${a.id}`, items: [{ key: `unbind-${a.id}`, label: `${say("panel.isBody", l)} · ${say("panel.unbody", l)}`, action: { op: "bind", avatar: null } }] }
      : { kind: "buttons", key: `body-${a.id}`, items: [{ key: `bind-${a.id}`, label: say("panel.body", l), action: { op: "bind", avatar: a.id } }] });
    rows.push(text(`repo-${a.id}`, a.repo !== undefined ? say("panel.repo", l, { repo: a.repo }) : say("panel.noRepo", l), a.repo !== undefined ? "plain" : "dim"));
    rows.push({ kind: "input", key: `repo-input-${a.id}`, field: "repo", target: a.id, placeholder: say("panel.repoInput", l) });
  }
  if (v.quota !== undefined) {
    rows.push(text("quota", v.quota.free ? say("panel.quota", l, { days: v.quota.daysLeft, replies: v.quota.repliesLeft }) : say("panel.quotaGone", l), v.quota.free || v.quota.key ? "dim" : "error"));
    rows.push(text("key", say(v.quota.key ? "panel.key" : "panel.noKey", l)));
    rows.push({ kind: "input", key: "api-key", field: "api-key", placeholder: say("panel.keyInput", l) });
    if (v.quota.key) rows.push({ kind: "buttons", key: "key-remove", items: [{ key: "key-remove", label: say("panel.keyRemove", l), action: { op: "key-remove" } }] });
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
    text("relay", say("panel.relaySet", l, { relay: v.relay })),
    { kind: "input", key: "relay", field: "relay", label: say("panel.relay", l), placeholder: v.relay },
    langRow(l),
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
  if (s.page === "chat" && s.chat !== null) return [...rows, ...chatRows(v, s, s.chat)];
  if (s.page === "invite" && s.chat !== null) return [...rows, ...inviteRows(v, s.chat, s.link)];
  if (s.page === "avatars") return [...rows, ...avatarRows(v, s)];
  if (s.page === "settings") return [...rows, ...settingsRows(v)];
  if (s.page === "new-group") return [...rows, ...newGroupRows(v, s)];
  return [...rows, ...inboxRows(v, s)];
}

/** The band (transport §4): the first thing that needs the person, with its options and how many more; else nothing, unless gemsbang cannot work or nobody is logged in. */
export function gbBand(v: GbView | null, problem: string | null, now?: string): { text: string; tone: Tone; open: string; actions: GbPress[]; more: number } | undefined {
  const l = v?.lang ?? "zh";
  if (problem !== null) return { text: problem, tone: "error", open: say("panel.open", l), actions: [], more: 0 };
  if (v !== null && !v.loggedIn) return { text: say("panel.loginBand", l), tone: "dim", open: say("panel.open", l), actions: [], more: 0 };
  const loud = (v?.needs ?? []).filter((n) => !n.muted && n.state === "open" && (now === undefined || Date.parse(n.expires) > Date.parse(now)));
  const first = loud[0];
  if (first === undefined) return undefined;
  const actions = first.kind === "borrow" ? [] : first.options.slice(0, 3).map((o, i) => ({ key: `band-answer-${i}`, label: o.label, primary: i === 0, action: { op: "answer", avatar: first.avatar, need: first.id, choice: i } as GbAction }));
  return { text: `${say(`need.kind.${first.kind}`, l)} · ${first.summary}`, tone: first.kind === "error" ? "error" : "plain", open: say("panel.open", l), actions, more: loud.length - 1 };
}

/** What a field's Enter does: an action for the hooks module, or nothing for an empty field. */
export type FieldAction = { call: string; args: Record<string, unknown> } | { local: "phone"; phone: string } | { local: "group-avatar"; name: string } | { local: "join"; url: string };

export function fieldAction(field: GbField, typed: string, s: { chat: GbChat | null; phone: string | null; groupAs: string; groupAvatar?: string }, target?: string): FieldAction | undefined {
  const t = typed.trim();
  if (t === "" && field !== "default-name" && field !== "repo") return undefined;
  switch (field) {
    case "relay": return { call: "setup", args: { relay: t } };
    case "phone": return { local: "phone", phone: t };
    case "code": return s.phone === null ? undefined : { call: "login-verify", args: { phone: s.phone, code: t } };
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
    case "api-key": return { call: "key", args: { apiKey: t } };
    case "repo": return target === undefined ? undefined : { call: "repo", args: { avatar: target, path: t } };
    default: return undefined;
  }
}
