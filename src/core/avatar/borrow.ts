// Borrowing the person's computer (spec §7.4, §5 rule 8, §3 rule 21): the
// work goes to a separate agent in a worktree of the repository the person
// named for that avatar, never into the conversation they are using. Its
// first turn is an envelope: which chat, who said it, their words quoted as
// material and not instructions, what to do, and what this avatar may do on
// this machine — read and edit that worktree, run the repository's own
// commands (its package.json scripts), never push, never touch secrets, never
// run a command a message gave. Each call the agent makes is held to that;
// the commands it ran are the facts the host saw, sent back with its words.
// Pure.
import { say, type Lang } from "./words.js";

/** A fact the host saw: a command of the repository's, and whether it passed. */
export interface Fact { label: string; ok: boolean }

/** The repository's own commands: `npm test` and `npm run <script>` for each script in its package.json. */
export function repoCommands(pkg: unknown): string[] {
  const scripts = typeof pkg === "object" && pkg !== null ? (pkg as Record<string, unknown>)["scripts"] : undefined;
  if (typeof scripts !== "object" || scripts === null || Array.isArray(scripts)) return [];
  const names = Object.keys(scripts).filter((n) => typeof (scripts as Record<string, unknown>)[n] === "string" && /^[\w:.-]+$/.test(n));
  return [...(names.includes("test") ? ["npm test"] : []), ...names.map((n) => `npm run ${n}`)];
}

/** The block the borrowed agent's first turn begins with. */
export function borrowEnvelope(o: { avatar: string; group: string; from: string; words: string; summary: string; worktree: string; commands: readonly string[]; lang: Lang }): string {
  const quoted = o.words.trim() === "" ? "> …" : o.words.trim().split(/\r?\n/).map((l) => `> ${l}`).join("\n");
  const commands = o.commands.length > 0 ? o.commands.map((c) => `\`${c}\``).join(o.lang === "en" ? ", " : "、") : say("borrow.noCommands", o.lang);
  return say("borrow.envelope", o.lang, { avatar: o.avatar, group: o.group, from: o.from, words: quoted, summary: o.summary, worktree: o.worktree, commands });
}

const READS = new Set(["Read", "Grep", "Glob", "LS", "NotebookRead"]);
const WRITES = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const BOOKKEEPING = new Set(["TodoWrite", "TaskCreate", "TaskUpdate", "TaskList", "TaskGet"]);
const SECRET = /(^|\/)(\.env(\.[^/]*)?|[^/]*\.pem|[^/]*\.key|id_(rsa|ed25519|ecdsa|dsa)[^/]*|\.npmrc|\.netrc|\.pypirc|credentials[^/]*)$|(^|\/)\.(ssh|aws|gnupg|docker|kube)(\/|$)/i;
const READ_ONLY_GIT = /^git (status|diff|log|show)( [^;&|<>`$()\\\n]*)?$/;

const slashes = (p: string): string => p.split("\\").join("/").replace(/\/+$/, "");

/** Whether a path lies in the worktree (relative paths are taken from it). */
function inside(path: string, worktree: string): boolean {
  const w = slashes(worktree);
  const p = slashes(path);
  const abs = /^([a-zA-Z]:)?\//.test(p) ? p : `${w}/${p}`;
  const parts: string[] = [];
  for (const seg of abs.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== "." && seg !== "") parts.push(seg);
  }
  const norm = (/^[a-zA-Z]:/.test(abs) ? "" : "/") + parts.join("/");
  const root = (/^[a-zA-Z]:/.test(w) ? "" : "/") + w.split("/").filter((s) => s !== "").join("/");
  const ci = /^[a-zA-Z]:/.test(w);
  return ci ? (norm.toLowerCase() === root.toLowerCase() || norm.toLowerCase().startsWith(`${root.toLowerCase()}/`)) : norm === root || norm.startsWith(`${root}/`);
}

/**
 * Why a borrowed agent's call is refused (a code of words.ts), or undefined
 * when it may go: reads and edits inside the worktree and not of a secret, a
 * command that is one of the repository's own or a read-only git, the
 * agent's own bookkeeping; nothing else.
 */
export function borrowVerdict(call: { tool: string; input: Record<string, unknown> }, ctx: { worktree: string; commands: readonly string[] }): string | undefined {
  const { tool, input } = call;
  if (BOOKKEEPING.has(tool)) return undefined;
  if (READS.has(tool) || WRITES.has(tool)) {
    const pattern = tool === "Glob" && typeof input["pattern"] === "string" && /^([a-zA-Z]:)?[\\/]/.test(input["pattern"]) ? input["pattern"] : undefined;
    const path = [input["file_path"], input["notebook_path"], input["path"], pattern].find((x): x is string => typeof x === "string" && x !== "");
    if (path === undefined) return WRITES.has(tool) ? "borrow.deny.outside" : undefined;
    if (!inside(path, ctx.worktree)) return "borrow.deny.outside";
    if (SECRET.test(slashes(path))) return "borrow.deny.secret";
    return undefined;
  }
  if (tool === "Bash") {
    const command = typeof input["command"] === "string" ? input["command"].trim() : "";
    return ctx.commands.includes(command) || READ_ONLY_GIT.test(command) ? undefined : "borrow.deny.command";
  }
  return "borrow.deny.tool";
}

/** The facts as one line for people: each command and whether it passed. */
export const factsLine = (facts: readonly Fact[], lang: Lang): string => say("page.group.facts", lang, { facts: facts.map((f) => `${f.label} ${say(f.ok ? "page.group.factOk" : "page.group.factFailed", lang)}`).join(" · ") });

/** The facts a body may send: a list of at most twenty {label, ok}, each label short. */
export function factsOf(v: unknown): Fact[] | undefined {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > 20) return undefined;
  const out: Fact[] = [];
  for (const x of v) {
    if (typeof x !== "object" || x === null) return undefined;
    const label = (x as Record<string, unknown>)["label"], ok = (x as Record<string, unknown>)["ok"];
    if (typeof label !== "string" || label.trim() === "" || label.length > 200 || typeof ok !== "boolean") return undefined;
    out.push({ label: label.trim(), ok });
  }
  return out;
}
