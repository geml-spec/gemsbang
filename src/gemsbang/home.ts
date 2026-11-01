// The gemsbang client's home (transport §3): `~/.gemsbang/` holds what this
// machine keeps for its person — the relay and the relays they trust, the
// person's token and the tokens of the avatars an agent here plays, which
// session speaks for which avatar, the invitations not followed, a mirror of
// the chats as last read, and which line of each chat was last seen. Tokens
// are written for the owner alone; every write is atomic.
import { chmodSync, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { writeAtomic } from "../host-fs.js";
import type { Mirror } from "../core/avatar/inbox.js";
import { isLang, type Lang } from "../core/avatar/words.js";

export interface Client {
  /** The relay's origin, `https://host`; empty until the person gives one. */
  relay: string;
  /** Relay origins the person trusts an invitation from (spec §6.3); the relay above is always one. */
  trusted: string[];
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
}

export const CLIENT = "client.json", MIRROR = "mirror.json", SEEN = "seen.json";

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
  const token = str("token"), person = str("person");
  const muted = obj(c["muted"]);
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return {
    relay: str("relay") ?? "",
    trusted: Array.isArray(c["trusted"]) ? (c["trusted"] as unknown[]).filter((x): x is string => typeof x === "string") : [],
    ...(token !== undefined ? { token } : {}),
    ...(person !== undefined ? { person } : {}),
    ...(isLang(lang) ? { lang } : {}),
    avatars: strings(c["avatars"]),
    bodies: strings(c["bodies"]),
    notes,
    muted: { avatars: list(muted["avatars"]), venues: list(muted["venues"]) },
    repos: strings(c["repos"]),
  };
}

export const writeClient = (home: string, c: Client): void => writeJson(join(home, CLIENT), c, true);

export function readMirror(home: string): Mirror | undefined {
  const m = readJson(join(home, MIRROR));
  return typeof m === "object" && m !== null && Array.isArray((m as Mirror).venues) && Array.isArray((m as Mirror).avatars) ? (m as Mirror) : undefined;
}

export const writeMirror = (home: string, m: Mirror): void => writeJson(join(home, MIRROR), m);
export const readSeen = (home: string): Record<string, string> => strings(readJson(join(home, SEEN)));
export const writeSeen = (home: string, seen: Record<string, string>): void => writeJson(join(home, SEEN), seen);
