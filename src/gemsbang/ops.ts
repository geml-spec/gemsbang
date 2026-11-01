// What the gemsbang client does for the Claude Code plugin (transport §3, §4),
// one call at a time through the bridge: log the person in by phone, read
// every chat of every avatar again and keep it in the home, open a chat and
// say something in it as the person, make a group, hand out its link, change
// an avatar's name or marking, join by a link; and for the model's tools,
// read and say as the avatar this session speaks for, with that avatar's own
// token (so the relay stamps `by: agent`). A relay out of reach leaves the
// last mirror readable. Every refusal is a code, its parameters and its
// words in the person's language.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { borrowEnvelope, factsOf, repoCommands } from "../core/avatar/borrow.js";
import { badgesOf, chatOf, inboxOf, itemsOf, venueKey, type Badge, type ChatItem, type InboxRow, type Mirror, type MirrorVenue, type MirrorWork } from "../core/avatar/inbox.js";
import { invitePrompt, parseInvite, relayOrigin } from "../core/avatar/invite.js";
import { orderNeeds, type Need } from "../core/avatar/needs.js";
import { DEFAULT_LANG, isLang, say, type Lang } from "../core/avatar/words.js";
import { RelayClient, RelayDown, type Answer } from "../daemon/client.js";
import { readClient, readMirror, readSeen, writeClient, writeMirror, writeSeen, type Client } from "./home.js";

export interface GbOptions { home: string; now: string; zoneMinutes?: number; fetchImpl?: typeof fetch }
export type Fail = { ok: false; code: string; params?: Record<string, string | number>; reason: string };
/** A 需要你 card as the pane shows it: the avatar's badge, the chat's name, whether the person muted it; a borrow's, the repository it would work in. */
export type GbNeed = Need & { avatarName: string; group?: string; badge?: Badge; muted: boolean; repo?: string };
/** A job for this machine as the pane shows it (spec §7.4): the avatar's badge and the repository it works in. */
export type GbWork = MirrorWork & { badge?: Badge; repo?: string };
/** The pane's whole view: the relay, who is logged in, the avatars, 需要你, the inbox, what is wrong. */
export interface GbView {
  relay: string; trusted: string[]; loggedIn: boolean; lang: Lang; person?: string; defaultName?: string;
  avatars: (Badge & { venues: string[]; mark: boolean; muted: boolean; placeholder?: string; paused: boolean; away: boolean; week: number; repo?: string })[]; rows: InboxRow[]; unread: number;
  quota?: { free: boolean; daysLeft: number; repliesLeft: number; key: boolean };
  needs: GbNeed[]; muted: { avatars: string[]; venues: string[] };
  /** The jobs for this person's computers (spec §7.4); none from a bridge older than them. */
  work?: GbWork[];
  synced?: string; offline?: string; notes: { url: string; at: string }[]; bodies: Record<string, string>;
}
/** One chat for the pane; `zoneMinutes`, the machine's zone, for the times of its lines. */
export interface GbChat { owner: string; id: string; kind: "group" | "dm"; name: string; count: number; as: Badge | undefined; items: ChatItem[]; earlier: number; isOwner: boolean; rules?: { forward: boolean; approve: boolean }; zoneMinutes?: number; /** The members whose hosted body only receives (本人在时才回). */ away?: string[] }
export interface GbLink { code: string; url: string; line: string; days: number; forward: boolean; approve: boolean; isOwner: boolean; group: string }
/** A job taken by this machine: where the borrowed agent works, what it may run, its first turn. */
export interface GbTaken { id: string; avatar: string; summary: string; worktree: string; branch: string; commands: string[]; prompt: string }
export type GbResult = ({ ok: true; view?: GbView; chat?: GbChat; link?: GbLink; info?: Record<string, unknown>; joined?: Record<string, unknown>; text?: string; sent?: string; work?: GbTaken }) | Fail;

const obj = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
/** A path as the file system names it, links resolved, so two spellings of one folder compare equal. */
const samePath = (p: string): string => { try { return realpathSync(p); } catch { return resolve(p); } };
/** The top of the git repository a folder is in, or undefined. */
function gitTop(dir: string): string | undefined {
  const r = spawnSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8", timeout: 10_000, windowsHide: true });
  const top = r.status === 0 ? r.stdout.trim() : "";
  return top === "" ? undefined : samePath(top);
}

export class Gb {
  private client: Client;
  constructor(private readonly o: GbOptions) {
    this.client = readClient(o.home);
  }

  /** The person's language, as the relay last said it. */
  private get lang(): Lang { return this.client.lang ?? DEFAULT_LANG; }

  private fail(code: string, params?: Record<string, string | number>): Fail {
    return { ok: false, code, ...(params !== undefined ? { params } : {}), reason: say(code, this.lang, params) };
  }

  /** The relay's refusal as it gave it, its words already in the person's language. */
  private refused(a: Answer): Fail {
    const b = obj(a.body);
    const code = str(b["error"]) ?? "server.error";
    const params = obj(b["params"]) as Record<string, string | number>;
    return { ok: false, code, ...(b["params"] !== undefined ? { params } : {}), reason: str(b["reason"]) ?? say(code, this.lang, { detail: `HTTP ${a.status}` }) };
  }

  private http(token?: string): RelayClient { return new RelayClient(this.client.relay, token, this.o.fetchImpl ?? fetch); }

  /** One call to the relay in the person's language; a network failure is `client.unreachable`. */
  private async call(method: string, path: string, body?: unknown, token = this.client.token): Promise<Answer | Fail> {
    if (this.client.relay === "") return this.fail("client.noRelay");
    try {
      return await this.http(token).call(method, `${path}${path.includes("?") ? "&" : "?"}lang=${this.lang}`, body);
    } catch (e) {
      return this.fail("client.unreachable", { detail: e instanceof RelayDown ? e.message.replace(/^连不上中继 [^：]*：/, "") : String(e) });
    }
  }

  private save(): void { writeClient(this.o.home, this.client); }
  private isFail = (x: unknown): x is Fail => (x as Fail).ok === false;

  // --- the view ---

  view(m: Mirror | undefined, offline?: string): GbView {
    const c = this.client;
    const seen = readSeen(this.o.home);
    const box = m === undefined ? { badges: [], rows: [], unread: 0 } : inboxOf(m, seen, this.o.now, { ...(this.o.zoneMinutes !== undefined ? { zoneMinutes: this.o.zoneMinutes } : {}) });
    const marks = m?.marks ?? {};
    const avatars = box.badges.map((b) => ({ ...b, venues: (m?.venues ?? []).filter((v) => v.as === b.id).map((v) => v.name), mark: marks[b.id] ?? true, muted: c.muted.avatars.includes(b.id), ...(m?.placeholders?.[b.id] !== undefined ? { placeholder: m.placeholders[b.id] } : {}), paused: m?.hosted?.[b.id]?.paused ?? false, away: m?.hosted?.[b.id]?.away ?? false, week: m?.hosted?.[b.id]?.week ?? 0 , ...(c.repos[b.id] !== undefined ? { repo: c.repos[b.id] } : {}) }));
    const needs = orderNeeds(m?.needs ?? []).map((n) => ({ ...n, ...(box.badges.find((b) => b.id === n.avatar) !== undefined ? { badge: box.badges.find((b) => b.id === n.avatar)! } : {}), muted: c.muted.avatars.includes(n.avatar) || (n.venue !== undefined && c.muted.venues.includes(venueKey(n.venue.owner, n.venue.id))) , ...(n.kind === "borrow" && c.repos[n.avatar] !== undefined ? { repo: c.repos[n.avatar] } : {}) }));
    const work = (m?.work ?? []).map((w) => ({ ...w, ...(box.badges.find((b) => b.id === w.avatar) !== undefined ? { badge: box.badges.find((b) => b.id === w.avatar)! } : {}), ...(c.repos[w.avatar] !== undefined ? { repo: c.repos[w.avatar] } : {}) }));
    return {
      relay: c.relay, trusted: [...new Set([...(c.relay !== "" ? [c.relay] : []), ...c.trusted])], loggedIn: c.token !== undefined, lang: this.lang,
      ...(c.person !== undefined ? { person: c.person } : {}), ...(m?.defaultName !== undefined ? { defaultName: m.defaultName } : {}),
      avatars, rows: box.rows, unread: box.unread, needs, muted: c.muted, work, ...(m?.quota !== undefined ? { quota: m.quota } : {}), ...(m !== undefined ? { synced: m.at } : {}), ...(offline !== undefined ? { offline } : {}), notes: c.notes, bodies: c.bodies,
    };
  }

  /** Every chat of every avatar read again and kept; out of reach, the last mirror with why. */
  async sync(): Promise<GbResult> {
    const last = readMirror(this.o.home);
    if (this.client.token === undefined) return { ok: true, view: this.view(undefined) };
    const me = await this.call("GET", "/me");
    if (this.isFail(me)) return me.code === "client.unreachable" ? { ok: true, view: this.view(last, me.reason) } : me;
    if (me.status === 401) { this.logoutLocal(); return { ok: true, view: this.view(undefined) }; }
    if (me.status !== 200) return this.refused(me);
    const meBody = obj(me.body);
    const lang = isLang(meBody["lang"]) ? meBody["lang"] : DEFAULT_LANG;
    if (this.client.lang !== lang) { this.client.lang = lang; this.save(); }
    const list = await this.call("GET", "/venues");
    if (this.isFail(list)) return { ok: true, view: this.view(last, list.reason) };
    if (list.status !== 200) return this.refused(list);
    const venues: MirrorVenue[] = [];
    for (const v of (list.body as Record<string, unknown>[]) ?? []) {
      const owner = str(v["owner"]), id = str(v["id"]), as = str(v["as"]);
      if (owner === undefined || id === undefined || as === undefined) continue;
      const one = await this.call("GET", `/venues/${owner}/${id}?as=${as}`);
      if (this.isFail(one)) return { ok: true, view: this.view(last, one.reason) };
      if (one.status !== 200) continue;
      const b = obj(one.body);
      const blocks = (Array.isArray(b["blocks"]) ? b["blocks"] : []) as MirrorVenue["blocks"];
      const venue = obj(b["venue"]);
      venues.push({ owner, id, kind: v["kind"] === "dm" ? "dm" : "group", name: str(venue["name"]) ?? str(v["name"]) ?? id, members: (Array.isArray(venue["members"]) ? venue["members"] : []) as MirrorVenue["members"], as, ...(b["rules"] !== undefined ? { rules: b["rules"] as MirrorVenue["rules"] } : {}), blocks: blocks.slice(-200) });
    }
    const avatars = (Array.isArray(meBody["avatars"]) ? meBody["avatars"] : []) as Mirror["avatars"];
    const marks: Record<string, boolean> = {};
    for (const a of avatars) {
      const rules = await this.call("GET", `/${a.id}/rules.geml`);
      const blocks = !this.isFail(rules) && rules.status === 200 ? ((obj(rules.body)["blocks"] ?? []) as { value: Record<string, unknown> }[]) : [];
      const latest = [...blocks].reverse().find((x) => typeof x.value["mark"] === "boolean");
      marks[a.id] = latest === undefined ? true : (latest.value["mark"] as boolean);
    }
    const defaultName = str(meBody["defaultName"]);
    const needs = await this.call("GET", "/needs");
    const open = !this.isFail(needs) && needs.status === 200 && Array.isArray(needs.body) ? (needs.body as Mirror["needs"]) : last?.needs ?? [];
    const placeholders: Record<string, string> = {};
    for (const a of avatars) {
      const t = await this.call("GET", `/${a.id}/templates.geml`);
      const blocks = !this.isFail(t) && t.status === 200 ? ((obj(t.body)["blocks"] ?? []) as { value: Record<string, unknown> }[]) : [];
      const latest = [...blocks].reverse().find((x) => "text" in x.value);
      if (typeof latest?.value["text"] === "string") placeholders[a.id] = latest.value["text"];
    }
    const hosted: NonNullable<Mirror["hosted"]> = {};
    const week = Date.parse(this.o.now) - 7 * 86_400_000;
    for (const a of avatars) {
      const h = await this.call("GET", `/${a.id}/hosted.geml`);
      const blocks = !this.isFail(h) && h.status === 200 ? ((obj(h.body)["blocks"] ?? []) as { id: string; value: Record<string, unknown> }[]) : [];
      let paused = false, away = false, n = 0;
      for (const b of blocks) {
        if (/^pause-\d+$/.test(b.id)) paused = b.value["paused"] === true;
        else if (/^status-\d+$/.test(b.id)) away = b.value["status"] === "receive-only";
        else if (/^round-\d+$/.test(b.id) && Date.parse(String(b.value["at"])) >= week) n++;
      }
      hosted[a.id] = { paused, away, week: n };
    }
    const jobs = await this.call("GET", "/work");
    const work = !this.isFail(jobs) && jobs.status === 200 && Array.isArray(jobs.body) ? (jobs.body as MirrorWork[]) : last?.work ?? [];
    const q = await this.call("GET", "/me/quota");
    const qb = !this.isFail(q) && q.status === 200 ? obj(q.body) : undefined;
    const quota = qb === undefined ? undefined : { free: qb["free"] === true, daysLeft: Number(qb["daysLeft"] ?? 0), repliesLeft: Number(qb["repliesLeft"] ?? 0), key: qb["key"] === true };
    const m: Mirror = { at: this.o.now, relay: this.client.relay, person: str(meBody["person"]) ?? "", lang, ...(defaultName !== undefined ? { defaultName } : {}), avatars, venues, marks, needs: open, placeholders, hosted, work, ...(quota !== undefined ? { quota } : {}) };
    writeMirror(this.o.home, m);
    return { ok: true, view: this.view(m) };
  }

  // --- the relay and the login ---

  setup(args: Record<string, unknown>): GbResult {
    const origin = relayOrigin(str(args["relay"]) ?? "");
    if (origin === undefined) return this.fail("client.badRelay");
    if (origin !== this.client.relay) this.logoutLocal();
    this.client.relay = origin;
    if (!this.client.trusted.includes(origin)) this.client.trusted.push(origin);
    this.save();
    return { ok: true, view: this.view(undefined) };
  }

  trust(args: Record<string, unknown>): GbResult {
    const origin = relayOrigin(str(args["origin"]) ?? "");
    if (origin === undefined) return this.fail("client.badRelay");
    if (!this.client.trusted.includes(origin)) this.client.trusted.push(origin);
    if (this.client.relay === "") this.client.relay = origin;
    this.save();
    return { ok: true, view: this.view(readMirror(this.o.home)) };
  }

  async loginStart(args: Record<string, unknown>): Promise<GbResult> {
    const r = await this.call("POST", "/login", { phone: args["phone"], lang: this.lang }, undefined);
    if (this.isFail(r)) return r;
    return r.status === 200 ? { ok: true, text: say("code.sent", this.lang), info: obj(r.body) } : this.refused(r);
  }

  async loginVerify(args: Record<string, unknown>): Promise<GbResult> {
    const r = await this.call("POST", "/login/verify", { phone: args["phone"], code: args["code"], lang: this.lang }, undefined);
    if (this.isFail(r)) return r;
    if (r.status !== 200) return this.refused(r);
    const b = obj(r.body);
    this.client.token = str(b["token"]);
    this.client.person = str(b["person"]);
    this.client.avatars = {};
    this.save();
    return this.sync();
  }

  private logoutLocal(): void {
    delete this.client.token;
    delete this.client.person;
    this.client.avatars = {};
    this.client.bodies = {};
  }

  logout(): GbResult {
    this.logoutLocal();
    this.save();
    return { ok: true, view: this.view(undefined) };
  }

  // --- chats ---

  private mirrorVenue(owner: string, id: string): { m: Mirror; v: MirrorVenue } | undefined {
    const m = readMirror(this.o.home);
    const v = m?.venues.find((x) => x.owner === owner && x.id === id);
    return m === undefined || v === undefined ? undefined : { m, v };
  }

  private chat(m: Mirror, v: MirrorVenue): GbChat {
    const c = chatOf(v, m);
    const away = v.members.filter((x) => (x as { away?: boolean }).away === true && x.id !== v.as).map((x) => x.name);
    return { owner: v.owner, id: v.id, kind: v.kind, name: c.name, count: c.count, as: c.as, items: c.items, earlier: c.earlier, isOwner: v.owner === v.as, ...(v.rules !== undefined ? { rules: v.rules } : {}), ...(this.o.zoneMinutes !== undefined ? { zoneMinutes: this.o.zoneMinutes } : {}), ...(away.length > 0 ? { away } : {}) };
  }

  /** One chat read again, kept in the mirror, its last line marked seen. */
  async open(args: Record<string, unknown>): Promise<GbResult> {
    const owner = str(args["owner"]) ?? "", id = str(args["id"]) ?? "";
    const at = this.mirrorVenue(owner, id);
    if (at === undefined) return this.fail("client.noVenue");
    const r = await this.call("GET", `/venues/${owner}/${id}?as=${at.v.as}`);
    if (!this.isFail(r) && r.status === 200) {
      const b = obj(r.body);
      at.v.blocks = ((Array.isArray(b["blocks"]) ? b["blocks"] : []) as MirrorVenue["blocks"]).slice(-200);
      const venue = obj(b["venue"]);
      if (Array.isArray(venue["members"])) at.v.members = venue["members"] as MirrorVenue["members"];
      if (b["rules"] !== undefined) at.v.rules = b["rules"] as MirrorVenue["rules"];
      writeMirror(this.o.home, at.m);
    }
    const said = itemsOf(at.v).filter((i) => i.kind === "message");
    const lastId = said[said.length - 1]?.id;
    if (lastId !== undefined) { const seen = readSeen(this.o.home); seen[venueKey(owner, id)] = lastId; writeSeen(this.o.home, seen); }
    return { ok: true, chat: this.chat(at.m, at.v), view: this.view(at.m, this.isFail(r) ? r.reason : undefined) };
  }

  /** The person says something in a chat as their avatar there (`by: person`). */
  async say(args: Record<string, unknown>): Promise<GbResult> {
    const owner = str(args["owner"]) ?? "", id = str(args["id"]) ?? "";
    const at = this.mirrorVenue(owner, id);
    if (at === undefined) return this.fail("client.noVenue");
    const replyTo = str(args["replyTo"]);
    const r = await this.call("POST", `/venues/${owner}/${id}/messages`, { as: at.v.as, text: args["text"], id: `p-${randomBytes(5).toString("hex")}`, ...(replyTo !== undefined ? { replyTo } : {}) });
    if (this.isFail(r)) return r;
    if (r.status !== 201 && r.status !== 200) return this.refused(r);
    return this.open({ owner, id });
  }

  /** A group made as one of the person's avatars, or as a new one (`avatarName`, empty for a random name). */
  async group(args: Record<string, unknown>): Promise<GbResult> {
    const as = str(args["as"]);
    const body = { name: args["name"], ...(as !== undefined ? { as } : { avatar: str(args["avatarName"]) !== undefined ? { name: args["avatarName"] } : {} }) };
    const r = await this.call("POST", "/groups", body);
    if (this.isFail(r)) return r;
    if (r.status !== 201) return this.refused(r);
    const v = obj(obj(r.body)["venue"]);
    const synced = await this.sync();
    if (!synced.ok) return synced;
    return this.open({ owner: v["owner"], id: v["id"] });
  }

  // --- links ---

  private linkOf(v: MirrorVenue, link: Record<string, unknown>): GbLink {
    const code = str(link["code"]) ?? "";
    const days = Math.max(1, Math.ceil((Date.parse(str(link["expires"]) ?? this.o.now) - Date.parse(this.o.now)) / 86_400_000));
    return { code, url: `${this.client.relay}${str(link["path"]) ?? `/i/${code}`}`, line: invitePrompt(this.client.relay, code, v.name, this.lang), days, forward: link["forward"] !== false, approve: link["approve"] === true, isOwner: v.owner === v.as, group: v.name };
  }

  /** The group's link to hand out, and the line for someone's agent; `rotate`, a new one in its place. */
  async link(args: Record<string, unknown>, rotate = false): Promise<GbResult> {
    const owner = str(args["owner"]) ?? "", id = str(args["id"]) ?? "";
    const at = this.mirrorVenue(owner, id);
    if (at === undefined) return this.fail("client.noVenue");
    const r = rotate ? await this.call("POST", `/venues/${owner}/${id}/link`, { as: at.v.as }) : await this.call("GET", `/venues/${owner}/${id}/link?as=${at.v.as}`);
    if (this.isFail(r)) return r;
    if (r.status !== 200) return this.refused(r);
    return { ok: true, link: this.linkOf(at.v, obj(obj(r.body)["link"])) };
  }

  async linkRules(args: Record<string, unknown>): Promise<GbResult> {
    const owner = str(args["owner"]) ?? "", id = str(args["id"]) ?? "";
    const at = this.mirrorVenue(owner, id);
    if (at === undefined) return this.fail("client.noVenue");
    const change: Record<string, unknown> = { as: at.v.as };
    for (const k of ["forward", "approve"]) if (typeof args[k] === "boolean") change[k] = args[k];
    const r = await this.call("POST", `/venues/${owner}/${id}/link-rules`, change);
    if (this.isFail(r)) return r;
    if (r.status !== 200) return this.refused(r);
    at.v.rules = obj(r.body)["rules"] as MirrorVenue["rules"];
    writeMirror(this.o.home, at.m);
    return this.link({ owner, id });
  }

  // --- the person and their avatars ---

  private async thenSync(r: Answer | Fail, okStatus = 200): Promise<GbResult> {
    if (this.isFail(r)) return r;
    if (r.status !== okStatus) return this.refused(r);
    return this.sync();
  }

  rename(args: Record<string, unknown>): Promise<GbResult> { return this.call("POST", `/avatars/${str(args["avatar"]) ?? ""}/name`, { name: args["name"] }).then((r) => this.thenSync(r)); }
  mark(args: Record<string, unknown>): Promise<GbResult> { return this.call("POST", `/avatars/${str(args["avatar"]) ?? ""}/rules`, { mark: args["mark"] }).then((r) => this.thenSync(r)); }
  defaultName(args: Record<string, unknown>): Promise<GbResult> { return this.call("POST", "/me/default-name", { name: str(args["name"]) ?? null }).then((r) => this.thenSync(r)); }
  async language(args: Record<string, unknown>): Promise<GbResult> {
    const lang = args["lang"];
    if (this.client.token === undefined) {
      if (!isLang(lang)) return this.fail("lang.unknown");
      this.client.lang = lang; this.save();
      return { ok: true, view: this.view(readMirror(this.o.home)) };
    }
    return this.thenSync(await this.call("POST", "/me/lang", { lang }));
  }

  /** Which avatar this session speaks for (spec §4.1); null, none. */
  bind(args: Record<string, unknown>): GbResult {
    const session = str(args["session"]);
    if (session === undefined) return this.fail("body.none");
    const avatar = str(args["avatar"]);
    if (avatar === undefined) delete this.client.bodies[session];
    else this.client.bodies[session] = avatar;
    this.save();
    return { ok: true, view: this.view(readMirror(this.o.home)) };
  }

  note(args: Record<string, unknown>): GbResult {
    const url = str(args["url"]);
    if (url !== undefined && !this.client.notes.some((n) => n.url === url)) { this.client.notes = [...this.client.notes, { url, at: this.o.now }].slice(-5); this.save(); }
    return { ok: true, view: this.view(readMirror(this.o.home)) };
  }

  // --- 需要你 ---

  /** The person answers a card (spec §7.3): an option, or their own words; a borrow may stop asking for its asker or its chat. Then everything read again. */
  async answer(args: Record<string, unknown>): Promise<GbResult> {
    const body: Record<string, unknown> = { choice: args["choice"] };
    for (const k of ["text", "allowPerson", "allowVenue"]) if (args[k] !== undefined) body[k] = args[k];
    const r = await this.call("POST", `/needs/${str(args["avatar"]) ?? ""}/${str(args["need"]) ?? ""}`, body);
    if (this.isFail(r)) return r;
    if (r.status !== 200) return this.refused(r);
    return this.sync();
  }

  /** An avatar's or a chat's 需要你 muted or not (spec §7.3): kept on this machine. */
  mute(args: Record<string, unknown>): GbResult {
    const on = args["on"] !== false;
    const key = str(args["avatar"]) !== undefined ? "avatars" : "venues";
    const what = str(args["avatar"]) ?? str(args["venue"]);
    if (what === undefined) return this.fail("client.noVenue");
    const list = this.client.muted[key].filter((x) => x !== what);
    this.client.muted[key] = on ? [...list, what] : list;
    this.save();
    return { ok: true, view: this.view(readMirror(this.o.home)) };
  }

  /** What an avatar says while it waits for the person; empty, the language's own. */
  placeholder(args: Record<string, unknown>): Promise<GbResult> {
    const text = str(args["text"]);
    return this.call("POST", `/avatars/${str(args["avatar"]) ?? ""}/placeholder`, { text: text ?? null }).then((r) => this.thenSync(r));
  }

  // --- the hosted body and who pays ---

  /** 暂停自动回复 for one avatar, or not (spec §7.5). */
  pause(args: Record<string, unknown>): Promise<GbResult> { return this.call("POST", `/avatars/${str(args["avatar"]) ?? ""}/hosted`, { paused: args["paused"] === true }).then((r) => this.thenSync(r)); }

  /** The person's own model API key for the hosted rounds, or none (null): it goes to the relay's orchestrator and is not kept here (spec §8.3). */
  key(args: Record<string, unknown>): Promise<GbResult> { return this.call("POST", "/me/payment", { apiKey: str(args["apiKey"]) ?? null }).then((r) => this.thenSync(r)); }

  // --- 借电脑 (spec §7.4) ---

  /** The repository on this machine an avatar's computer works in (spec §7.5): the top of the git repository the path is in; empty, none. */
  repo(args: Record<string, unknown>): GbResult {
    const avatar = str(args["avatar"]);
    if (avatar === undefined) return this.fail("avatar.missing");
    const path = typeof args["path"] === "string" ? args["path"].trim() : "";
    if (path === "") delete this.client.repos[avatar];
    else {
      if (!isAbsolute(path)) return this.fail("repo.notAbsolute");
      const top = gitTop(path);
      if (top === undefined) return this.fail("repo.notGit", { path });
      this.client.repos[avatar] = top;
    }
    this.save();
    return { ok: true, view: this.view(readMirror(this.o.home)) };
  }

  /** A job reported failed, and the person's 出错 card made by the relay; the words back here. */
  private async failWork(w: MirrorWork, code: string, params: Record<string, string>): Promise<Fail> {
    await this.call("POST", `/work/${w.avatar}/${w.id}`, { state: "failed", code, params });
    return this.fail(code, { ...params, avatar: w.avatarName, summary: w.summary });
  }

  /**
   * A waiting job taken by this session (spec §7.4): only for the avatar it
   * speaks for, only when the session is in the repository the person named
   * for that avatar — else the job fails and the person is told. Then a
   * worktree of that repository under the home, its own branch, and the
   * borrowed agent's first turn: the envelope.
   */
  async workTake(args: Record<string, unknown>): Promise<GbResult> {
    const session = str(args["session"]), avatar = str(args["avatar"]), id = str(args["work"]), root = str(args["root"]);
    if (session === undefined || avatar === undefined || this.client.bodies[session] !== avatar) return this.fail("body.none");
    const w = readMirror(this.o.home)?.work?.find((x) => x.id === id && x.avatar === avatar);
    if (w === undefined) return this.fail("work.missing");
    const repo = this.client.repos[avatar];
    if (repo === undefined) return this.failWork(w, "borrow.noRepo", {});
    const here = root === undefined ? undefined : gitTop(root);
    if (here !== repo) return this.failWork(w, "borrow.wrongRepo", { here: here ?? root ?? "", repo });
    const taken = await this.call("POST", `/work/${avatar}/${w.id}`, { state: "taken" });
    if (this.isFail(taken)) return taken;
    if (taken.status !== 200) return this.refused(taken);
    const worktree = join(this.o.home, "worktrees", `${avatar}-${w.id}`);
    const branch = `gemsbang/${avatar}-${w.id}`;
    if (!existsSync(worktree)) {
      mkdirSync(dirname(worktree), { recursive: true });
      const r = spawnSync("git", ["-C", repo, "worktree", "add", "-B", branch, worktree, "HEAD"], { encoding: "utf8", timeout: 60_000, windowsHide: true });
      if (r.status !== 0) return this.failWork(w, "borrow.failed", { reason: (r.stderr || r.error?.message || `git exited ${r.status}`).trim().slice(0, 300) });
    }
    let pkg: unknown;
    try { pkg = JSON.parse(readFileSync(join(worktree, "package.json"), "utf8")); } catch { pkg = undefined; }
    const commands = repoCommands(pkg);
    const prompt = borrowEnvelope({ avatar: w.avatarName, group: w.group ?? "", from: w.fromName ?? "?", words: w.words ?? "", summary: w.summary, worktree, commands, lang: this.lang });
    return { ok: true, work: { id: w.id, avatar, summary: w.summary, worktree, branch, commands, prompt } };
  }

  /** The borrowed agent's end (spec §7.4): its words into the chat as the avatar with the facts this host saw, or the job failed and the person told. */
  async workDone(args: Record<string, unknown>): Promise<GbResult> {
    const avatar = str(args["avatar"]) ?? "", id = str(args["work"]) ?? "";
    const text = [...(str(args["text"])?.trim() || say("borrow.doneEmpty", this.lang))].slice(0, 4000).join("");
    const body = args["ok"] === false
      ? { state: "failed", code: "borrow.failed", params: { reason: (str(args["reason"]) ?? "?").slice(0, 300) } }
      : { state: "done", text, facts: factsOf(args["facts"]) ?? [] };
    return this.thenSync(await this.call("POST", `/work/${avatar}/${id}`, body));
  }

  /** A queued job asked for now (排着 → 现在干). */
  workNow(args: Record<string, unknown>): Promise<GbResult> { return this.call("POST", `/work/${str(args["avatar"]) ?? ""}/${str(args["work"]) ?? ""}`, { state: "waiting" }).then((r) => this.thenSync(r)); }

  // --- joining ---

  private invite(args: Record<string, unknown>): { origin: string; code: string } | Fail {
    const p = parseInvite(str(args["url"]) ?? "");
    if (p === undefined) return this.fail("client.badLink");
    if (this.client.relay !== "" && p.origin !== this.client.relay) return this.fail("client.otherRelay", { host: new URL(p.origin).host });
    return p;
  }

  /** What the link's page would show this person: the group, the avatar that would go in, the names offered. */
  async linkInfo(args: Record<string, unknown>): Promise<GbResult> {
    const p = this.invite(args);
    if (this.isFail(p)) return p;
    if (this.client.relay === "") { this.client.relay = p.origin; this.save(); }
    const r = await this.call("GET", `/i/${p.code}`);
    if (this.isFail(r)) return r;
    if (r.status !== 200) return this.refused(r);
    const b = obj(r.body);
    const days = Math.max(1, Math.ceil((Date.parse(str(b["expires"]) ?? this.o.now) - Date.parse(this.o.now)) / 86_400_000));
    return { ok: true, info: { ...b, origin: p.origin, code: p.code, days } };
  }

  /** In by the link as the person (`as`, `name` or `new`); the chats read again; `session` given, that session speaks for the avatar after. */
  async join(args: Record<string, unknown>): Promise<GbResult> {
    const p = this.invite(args);
    if (this.isFail(p)) return p;
    if (this.client.token === undefined) return this.fail("client.notLoggedIn");
    const body: Record<string, unknown> = {};
    for (const k of ["as", "name", "new", "by"]) if (args[k] !== undefined) body[k] = args[k];
    const r = await this.call("POST", `/i/${p.code}/join`, body);
    if (this.isFail(r)) return r;
    if (r.status !== 200 && r.status !== 201) return this.refused(r);
    const joined = obj(r.body);
    const session = str(args["session"]), avatar = str(obj(joined["avatar"])["id"]);
    if (session !== undefined && avatar !== undefined) { this.client.bodies[session] = avatar; this.save(); }
    const synced = await this.sync();
    return synced.ok ? { ...synced, joined } : synced;
  }

  // --- the model's tools: the avatar this session speaks for ---

  private body(args: Record<string, unknown>): string | Fail {
    const session = str(args["session"]);
    const avatar = session === undefined ? undefined : this.client.bodies[session];
    return avatar ?? this.fail("body.none");
  }

  /** The avatar's own token, asked for once with the person's (spec §2.4: what an agent says is `by: agent`). */
  private async avatarToken(avatar: string): Promise<string | Fail> {
    const kept = this.client.avatars[avatar];
    if (kept !== undefined) return kept;
    if (this.client.token === undefined) return this.fail("client.notLoggedIn");
    const r = await this.call("POST", `/avatars/${avatar}/token`, {});
    if (this.isFail(r)) return r;
    if (r.status !== 201) return this.refused(r);
    const token = str(obj(r.body)["token"]);
    if (token === undefined) return this.fail("token.wrong");
    this.client.avatars[avatar] = token;
    this.save();
    return token;
  }

  private venueArg(args: Record<string, unknown>): { owner: string; id: string } | undefined {
    const m = /^([^/#\s]+)\/([^/#\s]+)$/.exec(str(args["venue"]) ?? "");
    return m === null ? undefined : { owner: m[1]!, id: m[2]! };
  }

  /** im_read: the venues of this session's avatar, or a venue's last lines. */
  async toolRead(args: Record<string, unknown>): Promise<GbResult> {
    const avatar = this.body(args);
    if (this.isFail(avatar)) return avatar;
    const token = await this.avatarToken(avatar);
    if (this.isFail(token)) return token;
    const name = readMirror(this.o.home)?.avatars.find((a) => a.id === avatar)?.name ?? avatar;
    const v = this.venueArg(args);
    if (v === undefined) {
      const r = await this.call("GET", "/venues", undefined, token);
      if (this.isFail(r)) return r;
      if (r.status !== 200) return this.refused(r);
      const lines = ((r.body as Record<string, unknown>[]) ?? []).map((x) => `${String(x["owner"])}/${String(x["id"])} · ${x["kind"] === "dm" ? say("panel.dm", this.lang) : ""}「${String(x["name"])}」`);
      return { ok: true, text: [say("tool.venues", this.lang, { name }), ...lines].join("\n") };
    }
    const r = await this.call("GET", `/venues/${v.owner}/${v.id}`, undefined, token);
    if (this.isFail(r)) return r;
    if (r.status !== 200) return r.status === 403 ? this.fail("body.notHere") : this.refused(r);
    const b = obj(r.body), venue = obj(b["venue"]);
    const mv: MirrorVenue = { owner: v.owner, id: v.id, kind: venue["kind"] === "dm" ? "dm" : "group", name: str(venue["name"]) ?? v.id, members: (venue["members"] ?? []) as MirrorVenue["members"], as: avatar, blocks: (b["blocks"] ?? []) as MirrorVenue["blocks"] };
    const limit = typeof args["limit"] === "number" && args["limit"] > 0 ? Math.min(100, Math.floor(args["limit"])) : 12;
    const said = itemsOf(mv).filter((i): i is Extract<ChatItem, { kind: "message" }> => i.kind === "message").slice(-limit);
    const lines = said.map((i) => `#${i.id} ${i.who}${i.mark ? `（${say("page.group.mark", this.lang)}）` : ""}${i.mine ? `（${say("panel.you", this.lang)}）` : ""}：${i.text}`);
    return { ok: true, text: [say("tool.recent", this.lang, { group: mv.name, count: said.length }), ...lines].join("\n") };
  }

  /** im_ask: a 需要你 card from this session's avatar to its person, about a chat it is in (spec §7.3). */
  async toolAsk(args: Record<string, unknown>): Promise<GbResult> {
    const avatar = this.body(args);
    if (this.isFail(avatar)) return avatar;
    const token = await this.avatarToken(avatar);
    if (this.isFail(token)) return token;
    const body: Record<string, unknown> = {};
    for (const k of ["venue", "kind", "summary", "checked", "draft", "options", "expires", "placeholder", "from"]) if (args[k] !== undefined) body[k] = args[k];
    if (typeof args["replyTo"] === "string") body["message"] = args["replyTo"];
    const r = await this.call("POST", "/needs", body, token);
    if (this.isFail(r)) return r;
    if (r.status === 403) return this.fail("body.notHere");
    if (r.status !== 201) return this.refused(r);
    const need = obj(obj(r.body)["need"]);
    const m = readMirror(this.o.home);
    const v = this.venueArg(args);
    const group = v === undefined ? "" : m?.venues.find((x) => x.owner === v.owner && x.id === v.id)?.name ?? v.id;
    const name = m?.avatars.find((a) => a.id === avatar)?.name ?? avatar;
    return { ok: true, text: say("tool.asked", this.lang, { kind: say(`need.kind.${String(need["kind"])}`, this.lang), name, group }), sent: String(need["id"] ?? "") };
  }

  /** im_say: a line in a venue as this session's avatar, `by: agent`. */
  async toolSay(args: Record<string, unknown>): Promise<GbResult> {
    const avatar = this.body(args);
    if (this.isFail(avatar)) return avatar;
    const v = this.venueArg(args);
    if (v === undefined) return this.fail("client.noVenue");
    const token = await this.avatarToken(avatar);
    if (this.isFail(token)) return token;
    const replyTo = str(args["replyTo"]);
    const r = await this.call("POST", `/venues/${v.owner}/${v.id}/messages`, { text: args["text"], id: `m-${randomBytes(5).toString("hex")}`, ...(replyTo !== undefined ? { replyTo } : {}) }, token);
    if (this.isFail(r)) return r;
    if (r.status === 403) return this.fail("body.notHere");
    if (r.status !== 201 && r.status !== 200) return this.refused(r);
    const m = readMirror(this.o.home);
    const group = m?.venues.find((x) => x.owner === v.owner && x.id === v.id)?.name ?? v.id;
    const name = m?.avatars.find((a) => a.id === avatar)?.name ?? avatar;
    return { ok: true, text: say("tool.said", this.lang, { group, name }), sent: String(obj(obj(r.body)["message"])["id"] ?? "") };
  }
}

/** The calls the bridge answers, by name. */
export const GB_CALLS = ["status", "setup", "trust", "login-start", "login-verify", "logout", "open", "say", "group", "link", "rotate", "link-rules", "rename", "mark", "default-name", "lang", "bind", "note", "link-info", "join", "answer", "mute", "placeholder", "pause", "key", "repo", "work-take", "work-done", "work-now", "tool-read", "tool-say", "tool-ask"] as const;
export type GbCall = (typeof GB_CALLS)[number];

export async function runGb(call: string, args: Record<string, unknown>, o: GbOptions): Promise<GbResult> {
  const gb = new Gb(o);
  switch (call as GbCall) {
    case "status": return gb.sync();
    case "setup": return gb.setup(args);
    case "trust": return gb.trust(args);
    case "login-start": return gb.loginStart(args);
    case "login-verify": return gb.loginVerify(args);
    case "logout": return gb.logout();
    case "open": return gb.open(args);
    case "say": return gb.say(args);
    case "group": return gb.group(args);
    case "link": return gb.link(args);
    case "rotate": return gb.link(args, true);
    case "link-rules": return gb.linkRules(args);
    case "rename": return gb.rename(args);
    case "mark": return gb.mark(args);
    case "default-name": return gb.defaultName(args);
    case "lang": return gb.language(args);
    case "bind": return gb.bind(args);
    case "note": return gb.note(args);
    case "link-info": return gb.linkInfo(args);
    case "join": return gb.join(args);
    case "tool-read": return gb.toolRead(args);
    case "tool-say": return gb.toolSay(args);
    case "answer": return gb.answer(args);
    case "mute": return gb.mute(args);
    case "placeholder": return gb.placeholder(args);
    case "pause": return gb.pause(args);
    case "repo": return gb.repo(args);
    case "work-take": return gb.workTake(args);
    case "work-done": return gb.workDone(args);
    case "work-now": return gb.workNow(args);
    case "key": return gb.key(args);
    case "tool-ask": return gb.toolAsk(args);
    default: return { ok: false, code: "client.unknownCall", params: { call }, reason: say("client.unknownCall", DEFAULT_LANG, { call }) };
  }
}
