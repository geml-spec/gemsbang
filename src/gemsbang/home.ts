// The gemsbang client's home (transport §3): `~/.gemsbang/` holds what this
// machine keeps for its person — a developer's relay in place of the service, the
// person's token and the tokens of the avatars an agent here plays, which
// session speaks for which avatar, the invitations not followed, the cache
// of the chats (architecture §6.1: `cache/state.json` with the number the
// person's box was read to, and `cache/venues/<owner>-<id>.json`, one chat
// each, its lines by id), and which line of each chat was last seen. Tokens
// are written for the owner alone; every write is atomic.
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { writeAtomic } from "../host-fs.js";
import { venueKey, type Mirror, type MirrorVenue } from "../core/avatar/inbox.js";
import { isLang, type Lang } from "../core/avatar/words.js";

export interface Client {
  /** A relay's origin, `https://host`, a developer named in place of the service; empty for the service. */
  relay: string;
  token?: string;
  person?: string;
  lang?: Lang;
  /** Avatar id → the token an agent on this machine speaks for it with (by "agent"). */
  avatars: Record<string, string>;
  /** Session id → the avatar that session speaks for (spec §4.1: the attached body). */
  bodies: Record<string, string>;
  /** Invitations an agent was shown but not by its person (spec §6.3): the pane says so. */
  notes: { url: string; at: string }[];
  /** 需要你 muted by avatar or by chat (spec §7.3): listed, never on the line above the prompt. */
  muted: { avatars: string[]; venues: string[] };
  /** Avatar id → the repository on this machine its computer works in (spec §7.5); this machine's alone. */
  repos: Record<string, string>;
  /** Avatar and chat (calls.ts's `callKey`) → the last line that called it the person let go or answered (architecture §6.3); this machine's alone. */
  dismissed: Record<string, string>;
  /** Session id → when it last came for its rounds: a session seen within LIVE_MS is open (B1: an avatar no open session plays asks the person). */
  seen?: Record<string, string>;
  /** The first session that came here after the install (Q14): the line above the prompt says nobody is signed in there alone. */
  firstSession?: string;
  /** Avatar and chat (calls.ts's `callKey`) → the line the last round handed it answered, and why that round failed (B3): the call is the person's again. */
  failed?: Record<string, { last: string; why: string }>;
  /** The secret of the sign-in through another account the pane offers now (S28), and of one being added in 账号 (S32): only its hash leaves this machine. */
  sso?: string;
  ssoAdd?: string;
}

export const CLIENT = "client.json", CACHE = "cache", SEEN = "seen.json";
/** The single file the chats were kept in before the cache; read no more, removed when the cache is cleared. */
const OLD_MIRROR = "mirror.json";
const STATE = "state.json", VENUES = "venues";
const venueFile = (key: string): string => `${key.replace("/", "-")}.json`;

/** The service a person signs in to (architecture §3.2: no server to fill in): `GEMSBANG_SERVICE` for a developer's, else gemsbang.com. */
export const gbService = (env: Record<string, string | undefined> = process.env): string => {
  const given = env["GEMSBANG_SERVICE"];
  return given !== undefined && given !== "" ? given.replace(/\/+$/, "") : "https://gemsbang.com";
};

/** The home: `GEMSBANG_HOME`, else `~/.gemsbang`. */
export const gbHome = (env: Record<string, string | undefined> = process.env): string => {
  const given = env["GEMSBANG_HOME"];
  return given !== undefined && given !== "" ? given : join(homedir(), ".gemsbang");
};

const obj = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const strings = (v: unknown): Record<string, string> => Object.fromEntries(Object.entries(obj(v)).filter((e): e is [string, string] => typeof e[1] === "string"));

function readJson(path: string): unknown {
  if (!existsSync(path)) return undefined;
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return undefined; }
}

function writeJson(path: string, value: unknown, secret = false): void {
  writeAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
  if (secret) { try { chmodSync(path, 0o600); } catch { /* a file system with no modes */ } }
}

export function readClient(home: string): Client {
  const c = obj(readJson(join(home, CLIENT)));
  const str = (k: string): string | undefined => (typeof c[k] === "string" && c[k] !== "" ? (c[k] as string) : undefined);
  const lang = c["lang"];
  const notes = Array.isArray(c["notes"]) ? (c["notes"] as unknown[]).map(obj).filter((n) => typeof n["url"] === "string" && typeof n["at"] === "string").map((n) => ({ url: n["url"] as string, at: n["at"] as string })) : [];
  const token = str("token"), person = str("person"), firstSession = str("firstSession"), sso = str("sso"), ssoAdd = str("ssoAdd");
  const muted = obj(c["muted"]);
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return {
    relay: str("relay") ?? "",
    ...(token !== undefined ? { token } : {}),
    ...(person !== undefined ? { person } : {}),
    ...(firstSession !== undefined ? { firstSession } : {}),
    ...(sso !== undefined ? { sso } : {}),
    ...(ssoAdd !== undefined ? { ssoAdd } : {}),
    ...(isLang(lang) ? { lang } : {}),
    avatars: strings(c["avatars"]),
    bodies: strings(c["bodies"]),
    seen: strings(c["seen"]),
    failed: Object.fromEntries(Object.entries(obj(c["failed"])).map(([k, v]) => [k, obj(v)] as const).filter((e) => typeof e[1]["last"] === "string" && typeof e[1]["why"] === "string").map(([k, v]) => [k, { last: v["last"] as string, why: v["why"] as string }])),
    notes,
    muted: { avatars: list(muted["avatars"]), venues: list(muted["venues"]) },
    repos: strings(c["repos"]),
    dismissed: strings(c["dismissed"]),
  };
}

export const writeClient = (home: string, c: Client): void => writeJson(join(home, CLIENT), c, true);

/** The cache: the number the box was read to (none: read everything again), and the mirror with every chat. */
export interface Cache { pts?: number; mirror: Mirror }

export function readCache(home: string): Cache | undefined {
  const s = obj(readJson(join(home, CACHE, STATE)));
  if (!Array.isArray(s["venues"]) || !Array.isArray(s["avatars"])) return undefined;
  const { pts, venues: keys, ...rest } = s;
  const venues: MirrorVenue[] = [];
  for (const k of keys as unknown[]) {
    if (typeof k !== "string") continue;
    const v = readJson(join(home, CACHE, VENUES, venueFile(k))) as MirrorVenue | undefined;
    if (typeof v === "object" && v !== null && Array.isArray(v.blocks)) venues.push(v);
  }
  return { ...(typeof pts === "number" ? { pts } : {}), mirror: { ...(rest as unknown as Omit<Mirror, "venues">), venues } };
}

/** The cache written: the state, and the chats named in `only` (every chat when not given); a chat no longer there, its file removed. */
export function writeCache(home: string, c: Cache, only?: Iterable<string>): void {
  const { venues, ...rest } = c.mirror;
  const keys = venues.map((v) => venueKey(v.owner, v.id));
  const dir = join(home, CACHE, VENUES);
  mkdirSync(dir, { recursive: true });
  const write = new Set(only ?? keys);
  for (const v of venues) if (write.has(venueKey(v.owner, v.id))) writeJson(join(dir, venueFile(venueKey(v.owner, v.id))), v);
  const files = new Set(keys.map(venueFile));
  for (const f of readdirSync(dir)) if (!files.has(f)) rmSync(join(dir, f), { force: true });
  writeJson(join(home, CACHE, STATE), { ...rest, venues: keys, ...(c.pts !== undefined ? { pts: c.pts } : {}) });
}

/** Nothing kept of anyone's chats: on signing out, or in as someone. */
export function clearCache(home: string): void {
  rmSync(join(home, CACHE), { recursive: true, force: true });
  rmSync(join(home, OLD_MIRROR), { force: true });
}

export const readMirror = (home: string): Mirror | undefined => readCache(home)?.mirror;

/** The mirror written as it stands, the number its box was read to kept. */
export function writeMirror(home: string, m: Mirror, only?: Iterable<string>): void {
  const pts = obj(readJson(join(home, CACHE, STATE)))["pts"];
  writeCache(home, { ...(typeof pts === "number" ? { pts } : {}), mirror: m }, only);
}
export const readSeen = (home: string): Record<string, string> => strings(readJson(join(home, SEEN)));
export const writeSeen = (home: string, seen: Record<string, string>): void => writeJson(join(home, SEEN), seen);
