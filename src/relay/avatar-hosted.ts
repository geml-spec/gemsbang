// The hosted bodies (spec §4.1, §7.7, §8.3; transport §6): the platform's
// orchestrator plays every avatar its person has not paused. A line in a
// chat is weighed for each other member: one that wakes an avatar (wake.ts)
// runs a round now; the rest gather in its batch, read once twenty lines or
// thirty minutes have come, answering nobody. Before a round the person is
// asked to pay: the free quota (quota.ts), else their own model API key, kept
// here by the orchestrator and never by the relay; neither, the avatar only
// receives and its name says 「本人在时才回」. A day before the quota ends the
// person gets one 花钱 card. A round runs through the runner — a command on
// the platform, a function in tests — in the avatar's own workspace; its
// answer is a reply (`by: agent`, with its hops) and maybe a card for the
// person (round.ts). Every round is written down in the avatar's hosted.geml.
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "../host-fs.js";
import { payFor, quotaOf, type Quota } from "../core/avatar/quota.js";
import { readRound, roundPrompt } from "../core/avatar/round.js";
import { batchDue, hopsAfter, stoppedByHops, wakeReason, type WakeReason } from "../core/avatar/wake.js";
import { say } from "../core/avatar/words.js";
import type { AvatarRelay } from "./avatars.js";

/** What a round gets: whose and where, why, the prompt, the person's own key when they pay with it, the avatar's workspace. */
export interface HostedRound { avatar: string; avatarName: string; group: string; kind: "reply" | "read"; reason?: WakeReason; prompt: string; apiKey?: string; workspace: string }
export type HostedRunner = (r: HostedRound) => Promise<{ ok: true; text: string } | { ok: false; error: string }>;
export interface AvatarHostedOptions { relay: AvatarRelay; runner: HostedRunner; days?: number; replies?: number; log?: (line: string) => void }

const VENUE_DOC = /^venues\/([gd]-[0-9a-f]{10})\.geml$/;
const KEYS = "keys.json";

export class AvatarHosted {
  private readonly relay: AvatarRelay;
  private readonly runner: HostedRunner;
  private readonly days: number | undefined;
  private readonly replies: number | undefined;
  private readonly log: (line: string) => void;
  /** Per avatar and chat, the lines gathered for its batch. */
  private readonly batches = new Map<string, { owner: string; venue: string; avatar: string; lines: { id: string; at: string }[] }>();
  private off: (() => void) | undefined;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(o: AvatarHostedOptions) {
    this.relay = o.relay;
    this.runner = o.runner;
    this.days = o.days;
    this.replies = o.replies;
    this.log = o.log ?? (() => {});
  }

  private get home(): string { return join(this.relay.root, "_hosted"); }

  /** Awake to every chat: each line landed is weighed, one after another. */
  start(): void {
    this.off = this.relay.onAppend(({ owner, doc, block }) => {
      const m = VENUE_DOC.exec(doc);
      if (m === null || typeof block.value["text"] !== "string" || typeof block.value["speaker"] !== "string") return;
      this.chain = this.chain.then(() => this.consider(owner, m[1]!, block.id)).catch((e: unknown) => this.log(String(e)));
    });
  }

  stop(): void { this.off?.(); this.off = undefined; }

  /** Once everything weighed has run, the lines its own rounds said included (tests wait on it). */
  async idle(): Promise<void> {
    let seen: Promise<unknown>;
    do { seen = this.chain; await seen; } while (seen !== this.chain);
  }

  // --- the person's own key ---

  private keys(): Record<string, string> {
    const path = join(this.home, KEYS);
    if (!existsSync(path)) return {};
    try { return JSON.parse(readFileSync(path, "utf8")) as Record<string, string>; } catch { return {}; }
  }

  /** The person's model API key, or none (null): kept for the owner alone, never in the relay's documents (transport §2.1). */
  setKey(person: string, key: string | null): void {
    const keys = this.keys();
    if (key === null) delete keys[person]; else keys[person] = key;
    mkdirSync(this.home, { recursive: true });
    writeAtomic(join(this.home, KEYS), `${JSON.stringify(keys)}\n`);
    try { chmodSync(join(this.home, KEYS), 0o600); } catch { /* a file system with no modes */ }
  }

  hasKey(person: string): boolean { return this.keys()[person] !== undefined; }

  /** The person's quota now, and whether they pay with their own key. */
  quota(person: string): Quota & { key: boolean } {
    const q = quotaOf({ firstLogin: this.relay.firstLoginOf(person), used: this.relay.hostedReplies(person), now: this.relay.now(), ...(this.days !== undefined ? { days: this.days } : {}), ...(this.replies !== undefined ? { replies: this.replies } : {}) });
    return { ...q, key: this.hasKey(person) };
  }

  // --- waking ---

  /** One line weighed for every other member of its chat: a wake now, or one more for the batch; the chat told once when the hops alone kept one asleep. */
  async consider(owner: string, venue: string, id: string): Promise<number> {
    const view = this.relay.venueView(owner, venue);
    if (view === undefined) return 0;
    let n = 0, stopped = false;
    for (const m of view.members) {
      const lines = this.relay.hostedLines(m.id, owner, venue, 40);
      const line = lines.find((l) => l.id === id);
      if (line === undefined || line.mine || this.relay.hostedOf(m.id).paused) continue;
      const seat = { avatar: m.id, name: m.name, kind: view.kind, owner, said: new Set(lines.filter((l) => l.mine).map((l) => l.id)) };
      const reason = wakeReason(line, seat);
      if (stoppedByHops(line, seat)) stopped = true;
      if (reason !== undefined) { if (await this.round(m.id, owner, venue, "reply", reason, line)) n++; continue; }
      const key = `${m.id}/${owner}/${venue}`;
      const batch = this.batches.get(key) ?? { owner, venue, avatar: m.id, lines: [] };
      batch.lines.push({ id, at: this.relay.now() });
      this.batches.set(key, batch);
      if (batchDue(batch.lines.length, batch.lines[0]?.at, this.relay.now())) { this.batches.delete(key); if (await this.round(m.id, owner, venue, "read")) n++; }
    }
    if (stopped) this.relay.hopsNote(owner, venue, id);
    return n;
  }

  /** The batches thirty minutes old, read (the server's sweep). */
  async tick(): Promise<number> {
    let n = 0;
    for (const [key, b] of [...this.batches]) {
      if (!batchDue(b.lines.length, b.lines[0]?.at, this.relay.now())) continue;
      this.batches.delete(key);
      if (await this.round(b.avatar, b.owner, b.venue, "read")) n++;
    }
    return n;
  }

  /** One round, paid first: the free quota, else the person's key, else none — the avatar only receives. True when it ran. */
  async round(avatar: string, owner: string, venue: string, kind: "reply" | "read", reason?: WakeReason, line?: { id: string; speaker: string; by?: string; hops?: number }): Promise<boolean> {
    const person = this.relay.hostedPerson(avatar);
    const view = this.relay.venueView(owner, venue, avatar);
    const me = view?.members.find((x) => x.id === avatar);
    if (person === undefined || view === undefined || me === undefined) return false;
    const q = this.quota(person);
    const pay = payFor(q, q.key);
    if (pay === "receive-only") { this.relay.setHostedStatus(avatar, "receive-only"); return false; }
    this.relay.setHostedStatus(avatar, "on");
    if (q.warn && !q.key) this.warnOnce(person, avatar, q);
    const lines = this.relay.hostedLines(avatar, owner, venue, 20);
    const prompt = roundPrompt({ avatar: me.name, group: view.name, kind, ...(reason !== undefined ? { reason } : {}), lines: lines.map((l) => ({ who: l.who, text: l.text, mine: l.mine })), mark: true });
    const workspace = join(this.home, avatar);
    mkdirSync(workspace, { recursive: true });
    const key = pay === "key" ? this.keys()[person] : undefined;
    let r: Awaited<ReturnType<HostedRunner>>;
    try { r = await this.runner({ avatar, avatarName: me.name, group: view.name, kind, ...(reason !== undefined ? { reason } : {}), prompt, ...(key !== undefined ? { apiKey: key } : {}), workspace }); } catch (e) { r = { ok: false, error: e instanceof Error ? e.message : String(e) }; }
    if (!r.ok) {
      this.log(`${avatar}: ${r.error}`);
      this.relay.recordRound(avatar, { venue, ...(line !== undefined ? { message: line.id } : {}), kind, paid: pay, replied: false, asked: false, ok: false });
      return true;
    }
    const out = readRound(r.text, kind);
    const replied = out.reply !== undefined && this.relay.hostedSay(avatar, owner, venue, out.reply, line?.id, hopsAfter(line === undefined ? undefined : { id: line.id, speaker: line.speaker, text: "", ...(line.by !== undefined ? { by: line.by } : {}), ...(line.hops !== undefined ? { hops: line.hops } : {}) })) !== undefined;
    const asked = out.ask !== undefined && this.relay.hostedAsk(avatar, out.ask, { owner, id: venue, ...(line !== undefined ? { message: line.id, from: line.speaker.replace(/^avatar:/, "") } : {}) }) !== undefined;
    this.relay.recordRound(avatar, { venue, ...(line !== undefined ? { message: line.id } : {}), kind, paid: pay, replied, asked, ok: true });
    return true;
  }

  /** The day-before 花钱 card (spec §8.3), once per person. */
  private warnOnce(person: string, avatar: string, q: Quota): void {
    const path = join(this.home, "warned.json");
    let warned: string[] = [];
    try { warned = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as string[]) : []; } catch { warned = []; }
    if (warned.includes(person)) return;
    const lang = this.relay.languageOf(person);
    this.relay.hostedAsk(avatar, { kind: "pay", summary: say("hosted.quotaLow", lang, { days: q.daysLeft, replies: q.repliesLeft }), options: [{ label: say("hosted.addKey", lang) }, { label: say("hosted.later", lang) }] });
    mkdirSync(this.home, { recursive: true });
    writeAtomic(path, `${JSON.stringify([...warned, person])}\n`);
  }
}

/** The runner as a command (transport §6 起一个容器跑一轮): the prompt on stdin, the round in HOSTED_* variables (the person's key as HOSTED_API_KEY when they pay with it), the workspace as its directory; its stdout is the answer. */
export function avatarCommandRunner(command: string, timeoutMs = 600_000): HostedRunner {
  return (round) => new Promise((done) => {
    const win = process.platform === "win32";
    const env: Record<string, string | undefined> = { ...process.env, HOSTED_AVATAR: round.avatar, HOSTED_NAME: round.avatarName, HOSTED_GROUP: round.group, HOSTED_KIND: round.kind, HOSTED_WORKSPACE: round.workspace };
    if (round.apiKey !== undefined) env["HOSTED_API_KEY"] = round.apiKey;
    const child = spawn(win ? "cmd.exe" : "sh", win ? ["/d", "/s", "/c", command] : ["-c", command], { cwd: round.workspace, env, stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "", finished = false;
    const finish = (r: Awaited<ReturnType<HostedRunner>>): void => { if (finished) return; finished = true; clearTimeout(timer); done(r); };
    const timer = setTimeout(() => { child.kill("SIGKILL"); finish({ ok: false, error: `timed out after ${Math.round(timeoutMs / 1000)} s` }); }, timeoutMs);
    child.stdout.on("data", (c: Buffer) => { out += c; });
    child.stderr.on("data", (c: Buffer) => { err += c; });
    child.on("error", (e) => finish({ ok: false, error: e.message }));
    child.on("exit", (code) => finish(code === 0 ? { ok: true, text: out } : { ok: false, error: `runner exited ${code}: ${err.trim()}` }));
    child.stdin.end(round.prompt);
  });
}
