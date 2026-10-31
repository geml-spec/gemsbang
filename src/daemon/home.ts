// The daemon's home (transport §2.3, §3): `~/.gemworks/im/` holds the
// config with the tokens, a mirror of every followed document under
// `<relay>/<owner>/<doc>`, the outbox of writes not yet pushed, the drafts
// an owner has not sent, the hosts' session reports, and whether the relay
// was reached. Every host reads and writes only these files; the daemon is
// the one process that talks to the relay. Writes are atomic (a reader sees
// the old file or the new); an outbox entry is its own file, so nothing is
// locked.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { mirrorRelPath } from "../core/im/address.js";
import { readDataBlocks, renderDataBlock, type DataBlock } from "../core/im/chain.js";
import type { Stub } from "../core/im/embed.js";
import type { Need } from "../core/im/needs-me.js";
import type { Presence } from "../core/im/presence.js";
import type { JsonValue } from "../core/schema.js";
import { appendText, writeAtomic, writeNew } from "../host-fs.js";

export interface Config { relay: { url: string; name: string }; person: string; token: string; agents: Record<string, string> }
export const CONFIG = "connect.json";

/** The home: the override, else `GEMWORKS_IM_HOME`, else `~/.gemworks/im`. */
export function homeDir(override?: string, env: Record<string, string | undefined> = {}): string {
  if (override !== undefined && override !== "") return override;
  const fromEnv = env["GEMWORKS_IM_HOME"];
  return fromEnv !== undefined && fromEnv !== "" ? fromEnv : join(homedir(), ".gemworks", "im");
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const obj = (v: unknown): Record<string, unknown> | undefined => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);

function readJson(path: string): unknown {
  if (!existsSync(path)) return undefined;
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return undefined; }
}

export function readConfig(home: string): Config | undefined {
  const c = obj(readJson(join(home, CONFIG)));
  const relay = c === undefined ? undefined : obj(c["relay"]);
  const url = relay === undefined ? undefined : str(relay["url"]), name = relay === undefined ? undefined : str(relay["name"]);
  const person = c === undefined ? undefined : str(c["person"]), token = c === undefined ? undefined : str(c["token"]);
  if (c === undefined || url === undefined || name === undefined || person === undefined || token === undefined) return undefined;
  const agents: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj(c["agents"]) ?? {})) if (typeof v === "string") agents[k] = v;
  return { relay: { url, name }, person, token, agents };
}

export function writeConfig(home: string, c: Config): void {
  writeAtomic(join(home, CONFIG), `${JSON.stringify(c, null, 2)}\n`);
}

// --- mirrors ---

export const mirrorPath = (home: string, relayName: string, owner: string, doc: string): string => join(home, ...mirrorRelPath({ relay: relayName, owner, doc }).split("/"));

export interface Mirror { blocks: DataBlock[]; text: string; exists: boolean }

export function readMirror(home: string, relayName: string, owner: string, doc: string): Mirror {
  const path = mirrorPath(home, relayName, owner, doc);
  if (!existsSync(path)) return { blocks: [], text: "", exists: false };
  const text = readFileSync(path, "utf8");
  return { blocks: readDataBlocks(text).blocks, text, exists: true };
}

export function writeMirror(home: string, relayName: string, owner: string, doc: string, text: string): void {
  writeAtomic(mirrorPath(home, relayName, owner, doc), text);
}

/** A block as the relay pushes or renders it: its value, or a stub in its place. */
export interface Pushed { id: string; value?: Record<string, JsonValue>; stub?: Stub }

/** A pushed block appended to its mirror: `present` when it is there already, `missing` when the document was never mirrored (fetch it whole). */
export function appendMirror(home: string, relayName: string, owner: string, doc: string, block: Pushed): "appended" | "present" | "missing" {
  const m = readMirror(home, relayName, owner, doc);
  if (!m.exists) return "missing";
  if (m.blocks.some((b) => b.id === block.id)) return "present";
  const value = block.value !== undefined ? block.value : ({ stub: true, ...block.stub } as unknown as JsonValue);
  appendText(mirrorPath(home, relayName, owner, doc), renderDataBlock(block.id, value));
  return "appended";
}

const inboxPath = (home: string, relayName: string, me: string): string => join(home, relayName.replace(/:/g, "_"), me, "inbox.json");

export function readInbox(home: string, relayName: string, me: string): Need[] {
  const v = readJson(inboxPath(home, relayName, me));
  return Array.isArray(v) ? (v as Need[]) : [];
}

export function writeInbox(home: string, relayName: string, me: string, needs: readonly Need[]): void {
  writeAtomic(inboxPath(home, relayName, me), `${JSON.stringify(needs)}\n`);
}

// --- the outbox ---

export interface OutboxEntry {
  id: string;
  /** A message or a queue marker for a document; a grant or a refusal of a request (no document: the relay's grants endpoints). */
  kind: "message" | "marker" | "grant" | "refuse";
  /** Whose token signs it: `person`, or `agent:<name>`. */
  as: string;
  owner: string;
  doc: string;
  body: Record<string, JsonValue>;
  at: string;
  tries: number;
  error?: string;
}

const rand = (): string => randomBytes(4).toString("hex");
const stampOf = (at: string): string => String(Date.parse(at)).padStart(13, "0");
/** Entries made in one process in the same millisecond keep their order. */
let seq = 0;
const nextSeq = (): string => String(++seq).padStart(6, "0");

/** A message's block id, chosen before the push so a resend repeats it (transport §2.5). */
export const newBlockId = (at: string): string => `m-${stampOf(at)}-${rand()}`;

const outboxDir = (home: string): string => join(home, "outbox");

export function enqueueOutbox(home: string, e: Omit<OutboxEntry, "id" | "tries">): OutboxEntry {
  const entry: OutboxEntry = { ...e, id: `o-${stampOf(e.at)}-${nextSeq()}-${rand()}`, tries: 0 };
  writeNew(join(outboxDir(home), `${entry.id}.json`), `${JSON.stringify(entry)}\n`);
  return entry;
}

export function listOutbox(home: string): OutboxEntry[] {
  const dir = outboxDir(home);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => n.startsWith("o-") && n.endsWith(".json")).sort().map((n) => readJson(join(dir, n))).filter((e): e is OutboxEntry => obj(e) !== undefined);
}

export function updateOutbox(home: string, e: OutboxEntry): void {
  writeAtomic(join(outboxDir(home), `${e.id}.json`), `${JSON.stringify(e)}\n`);
}

export function removeOutbox(home: string, id: string): void {
  try { unlinkSync(join(outboxDir(home), `${id}.json`)); } catch { /* already gone */ }
}

/** An entry the relay refused: kept under `failed/` with the reason, never pushed again. */
export function failOutbox(home: string, id: string, error: string): void {
  const from = join(outboxDir(home), `${id}.json`);
  const e = readJson(from) as OutboxEntry | undefined;
  if (e === undefined) return;
  mkdirSync(join(outboxDir(home), "failed"), { recursive: true });
  writeAtomic(join(outboxDir(home), "failed", `${id}.json`), `${JSON.stringify({ ...e, error })}\n`);
  removeOutbox(home, id);
}

// --- drafts ---

/** An answer the owner sees before it goes (§6.5 回群前先给我看): what the outbox entry will be, and the address the answered marker will name. */
export interface Draft { id: string; agent: string; item: string; owner: string; doc: string; body: Record<string, JsonValue>; at: string; venueName: string; reply: string }

const draftsDir = (home: string): string => join(home, "drafts");

export function writeDraft(home: string, d: Draft): void { writeAtomic(join(draftsDir(home), `${d.id}.json`), `${JSON.stringify(d)}\n`); }
export function readDraft(home: string, id: string): Draft | undefined { const d = readJson(join(draftsDir(home), `${id}.json`)); return obj(d) === undefined ? undefined : (d as Draft); }
export function listDrafts(home: string): Draft[] {
  const dir = draftsDir(home);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => n.endsWith(".json")).sort().map((n) => readJson(join(dir, n))).filter((d): d is Draft => obj(d) !== undefined);
}
export function removeDraft(home: string, id: string): void { try { unlinkSync(join(draftsDir(home), `${id}.json`)); } catch { /* gone */ } }

// --- session reports ---

export interface SessionReport { host: string; login: string; presence: Presence; task?: string; at: string }

const sessionsDir = (home: string): string => join(home, "sessions");
/** The guest room of a card (§7.5): a directory of the home where a card's turn reads and writes, its 委托书 and context pack written there when the item is delivered. */
export const roomDir = (home: string, cardId: string): string => join(home, "rooms", cardId);

export function reportSession(home: string, agent: string, session: string, r: SessionReport): void {
  writeAtomic(join(sessionsDir(home), agent, `${session}.json`), `${JSON.stringify(r)}\n`);
}

export function listSessions(home: string): { agent: string; session: string; report: SessionReport }[] {
  const dir = sessionsDir(home);
  if (!existsSync(dir)) return [];
  const out: { agent: string; session: string; report: SessionReport }[] = [];
  for (const agent of readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()) {
    for (const n of readdirSync(join(dir, agent)).filter((f) => f.endsWith(".json")).sort()) {
      const report = readJson(join(dir, agent, n));
      if (obj(report) !== undefined) out.push({ agent, session: n.slice(0, -".json".length), report: report as SessionReport });
    }
  }
  return out;
}

export function removeSession(home: string, agent: string, session: string): void {
  try { unlinkSync(join(sessionsDir(home), agent, `${session}.json`)); } catch { /* gone */ }
}

// --- the state ---

/** Whether the relay was reached the last time the daemon tried, and when; the band's 断了 reads it. */
export interface State { connected: boolean; at: string; error?: string }

export function readState(home: string): State | undefined {
  const s = obj(readJson(join(home, "state.json")));
  return s !== undefined && typeof s["connected"] === "boolean" && typeof s["at"] === "string" ? (s as unknown as State) : undefined;
}

export function writeState(home: string, s: State): void {
  mkdirSync(dirname(join(home, "state.json")), { recursive: true });
  writeAtomic(join(home, "state.json"), `${JSON.stringify(s)}\n`);
}

/** Moves a file aside (a draft sent, a report retired); nothing when it is not there. */
export function moveFile(from: string, to: string): boolean {
  if (!existsSync(from)) return false;
  mkdirSync(dirname(to), { recursive: true });
  renameSync(from, to);
  return true;
}
