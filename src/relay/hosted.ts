// The hosted agent's body (transport §6): no process while it idles; an
// item on its queue wakes the orchestrator, which runs one round through
// the runner — a command on the platform, a function in tests — in the
// agent's own workspace under the relay's root, with the prompt the
// desktop's daemon would have built, posts the answer as the agent, marks
// the item, and sleeps again. The owner pays a round from their wallet
// through the agent's own caps (先免费额度，再积分); a broke owner's item is
// answered with a system line. 搬家 is the relay's (moveHosted); the
// workspace's files are read here.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseAddress } from "../core/im/address.js";
import { scopeOfCard, type ToolKey, type VenueOfWork } from "../core/im/card.js";
import { expandEmbeds } from "../core/im/embed.js";
import { envelopeLine, withEnvelope } from "../core/im/envelope.js";
import { parseSpeaker, personBehind } from "../core/im/identity.js";
import { next, type QueueItem } from "../core/im/queue.js";
import { scopeFor, type ToolScope } from "../core/im/sender.js";
import { scopeGrantsFrom, type Relay } from "./relay.js";
import { readDoc } from "./store.js";

/** What a round gets: who it is, the item, the prompt as the daemon would build it, the scope the envelope names, the persistent workspace. */
export interface Round { person: string; agent: string; token: string; relayUrl: string; item: QueueItem; prompt: string; scope: ToolScope; workspace: string }
export type Runner = (round: Round) => Promise<{ ok: true; text: string } | { ok: false; error: string }>;
export interface OrchestratorOptions { relay: Relay; runner: Runner; relayUrl: string; credits?: number; log?: (line: string) => void }
/** What a round costs the owner (transport §6 计费), through the agent's 自动买 cap. */
export const ROUND_CREDITS = 1;

export class Orchestrator {
  private readonly relay: Relay;
  private readonly runner: Runner;
  private readonly relayUrl: string;
  private readonly credits: number;
  private readonly log: (line: string) => void;
  private readonly busy = new Set<string>();
  private off: (() => void) | undefined;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(o: OrchestratorOptions) {
    this.relay = o.relay;
    this.runner = o.runner;
    this.relayUrl = o.relayUrl;
    this.credits = o.credits ?? ROUND_CREDITS;
    this.log = o.log ?? (() => {});
  }

  /** Awake to the queues: an item appended to a hosted agent's queue starts its rounds, one wake after another. */
  start(): void {
    this.off = this.relay.onAppend(({ owner, doc, block }) => {
      const m = /^queues\/([^/]+)\.geml$/.exec(doc);
      if (m === null || /^(read|answered)-\d+$/.test(block.id)) return;
      this.chain = this.chain.then(() => this.wake(owner, m[1]!)).catch(() => undefined);
    });
  }

  stop(): void { this.off?.(); this.off = undefined; }

  /** Once every wake so far has run (tests wait on it). */
  idle(): Promise<void> { return this.chain.then(() => undefined); }

  /** Every hosted agent with something pending gets its rounds; how many ran. */
  async sweep(): Promise<number> {
    let n = 0;
    for (const h of this.relay.hostedAgents()) n += await this.wake(h.person, h.agent);
    return n;
  }

  /** The agent's rounds, one after another, until its queue is empty; a wake while it runs is a no-op (the running loop drains the queue). */
  async wake(person: string, agent: string): Promise<number> {
    const h = this.relay.hostedAgents().find((x) => x.person === person && x.agent === agent);
    if (h === undefined) return 0;
    const key = `${person}/${agent}`;
    if (this.busy.has(key)) return 0;
    this.busy.add(key);
    let n = 0;
    try { while (await this.round(h)) n++; } catch (e) { this.log(`${key}: ${e instanceof Error ? e.message : String(e)}`); } finally { this.busy.delete(key); }
    return n;
  }

  /** One round: the next pending item read and run, the answer posted, the item answered; the owner charged first. False when nothing is pending. */
  private async round(h: { person: string; agent: string; token: string }): Promise<boolean> {
    const by = this.relay.verify(h.token);
    if (by === undefined) return false;
    const q = this.relay.queueOf(by, h.person, h.agent);
    if (!q.ok) return false;
    const now = this.relay.now();
    const { item } = next(q.queue, now);
    if (item === undefined) return false;
    const target = targetOf(item);
    if (target === undefined) { this.relay.mark(by, h.person, h.agent, "answered", item.id); return true; }
    if (this.credits > 0) {
      const paid = this.relay.spend(by, { credits: this.credits, note: `托管一轮 · ${item.venueName}` });
      if (!paid.ok) {
        this.relay.mark(by, h.person, h.agent, "answered", item.id);
        this.relay.appendSystem(target.owner, target.venue, `${h.agent} 这一轮没跑：${paid.reason}`);
        return true;
      }
    }
    this.relay.mark(by, h.person, h.agent, "read", item.id);
    const scope = item.card !== undefined ? scopeOfCard({ tools: item.card.tools as ToolKey[], venueOfWork: item.card.venueOfWork as VenueOfWork, budget: item.card.credits !== undefined ? { credits: item.card.credits } : {} }) : this.scopeOf(h.person, item, now);
    const prompt = this.promptFor(by.speaker, item, q.pending.length - 1, scope);
    const workspace = join(this.relay.root, "_hosted", h.person, h.agent);
    mkdirSync(workspace, { recursive: true });
    let r: Awaited<ReturnType<Runner>>;
    try { r = await this.runner({ person: h.person, agent: h.agent, token: h.token, relayUrl: this.relayUrl, item, prompt, scope, workspace }); } catch (e) { r = { ok: false, error: e instanceof Error ? e.message : String(e) }; }
    if (!r.ok) {
      this.relay.mark(by, h.person, h.agent, "answered", item.id);
      this.relay.appendSystem(target.owner, target.venue, `${h.agent} 这一轮没跑成：${r.error}`);
      return true;
    }
    const id = `m-${String(Date.parse(now)).padStart(13, "0")}-${randomBytes(4).toString("hex")}`;
    const posted = this.relay.appendMessage(by, target.owner, target.venue, { id, kind: "chat", text: r.text, ...(target.replyTo !== undefined ? { replyTo: target.replyTo } : {}), handling: item.hops });
    if (posted.ok) this.relay.mark(by, h.person, h.agent, "answered", item.id, this.relay.address(target.owner, `venues/${target.venue}.geml`, id));
    else {
      this.relay.mark(by, h.person, h.agent, "answered", item.id);
      this.relay.appendSystem(target.owner, target.venue, `${h.agent} 的回答没贴上：${posted.reason}`);
    }
    return true;
  }

  /** The sender's scope for the turn (§7.2), from the owner's page's grants, as the daemon computes it. */
  private scopeOf(person: string, item: QueueItem, now: string): ToolScope {
    const sender = parseSpeaker(item.sender);
    const from = sender === undefined ? undefined : personBehind(sender);
    return scopeFor(item.level, { ...(from !== undefined ? { person: from } : {}), venue: item.venue, grants: scopeGrantsFrom(readDoc(this.relay.root, person, `people/${person}.geml`).blocks), now });
  }

  /** The prompt as the desktop's daemon would build it (transport §3): the envelope, the text, the context pack resolved by the agent's own permission. */
  private promptFor(viewer: string, item: QueueItem, queued: number, scope: ToolScope): string {
    const envelope = envelopeLine({ venueKind: item.venueKind, venueName: item.venueName, senderName: item.senderName, level: item.level, scope, queued });
    const { expanded } = expandEmbeds(item.context ?? [], viewer, this.relay.access());
    const context = expanded.map((x) => (x.text !== undefined ? `[${x.embed.src}]\n${x.text}` : `[${x.embed.src}：${x.stub !== undefined ? `看不到，来自 ${x.stub.from} 的私有范围` : x.fault ?? "找不到"}]`)).join("\n\n");
    return withEnvelope(envelope, context === "" ? item.prompt : `${item.prompt}\n\n${context}`);
  }
}

/** Where the answer goes: under the message that raised the item, or into the card's thread (daemon/deliver.ts has the same rule). */
function targetOf(item: QueueItem): { owner: string; venue: string; replyTo?: string } | undefined {
  const a = item.message === undefined ? undefined : parseAddress(item.message);
  if (a === undefined) return undefined;
  if (item.card !== undefined) return { owner: a.owner, venue: item.venue };
  const v = /^venues\/([^/]+)\.geml$/.exec(a.doc);
  return v === null || a.block === undefined ? undefined : { owner: a.owner, venue: v[1]!, replyTo: a.block };
}

/** The runner as a command (transport §6 起一个容器跑一轮): the prompt on stdin, the round in HOSTED_* variables, the workspace as its directory; its stdout is the answer; a non-zero exit or the time limit is the error. */
export function commandRunner(command: string, timeoutMs = 600_000): Runner {
  return (round) => new Promise((done) => {
    const win = process.platform === "win32";
    const child = spawn(win ? "cmd.exe" : "sh", win ? ["/d", "/s", "/c", command] : ["-c", command], { cwd: round.workspace, env: { ...process.env, HOSTED_PERSON: round.person, HOSTED_AGENT: round.agent, HOSTED_TOKEN: round.token, HOSTED_RELAY: round.relayUrl, HOSTED_WORKSPACE: round.workspace, HOSTED_ITEM: JSON.stringify(round.item), HOSTED_SCOPE: JSON.stringify(round.scope) }, stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "", finished = false;
    const finish = (r: Awaited<ReturnType<Runner>>): void => { if (finished) return; finished = true; clearTimeout(timer); done(r); };
    const timer = setTimeout(() => { child.kill("SIGKILL"); finish({ ok: false, error: `超时 ${Math.round(timeoutMs / 1000)} 秒` }); }, timeoutMs);
    child.stdout.on("data", (c: Buffer) => { out += c; });
    child.stderr.on("data", (c: Buffer) => { err += c; });
    child.on("error", (e) => finish({ ok: false, error: e.message }));
    child.on("exit", (code) => finish(code === 0 ? { ok: true, text: out.trim() === "" ? "（这一轮没有回答）" : out.trim() } : { ok: false, error: `runner exited ${code}: ${err.trim()}` }));
    child.stdin.end(round.prompt);
  });
}

/** How big a workspace file may be to travel with 搬家. */
const FILE_LIMIT = 65_536;

/** The workspace's files for 搬家 (transport §6 下载主页和 skill): every text file under it but the cache, with its content, paths with forward slashes. */
export function workspaceFiles(workspace: string): { path: string; text: string }[] {
  if (!existsSync(workspace)) return [];
  const out: { path: string; text: string }[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const path = rel === "" ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) { if (e.name !== "cache") walk(join(dir, e.name), path); continue; }
      if (!e.isFile() || statSync(join(dir, e.name)).size > FILE_LIMIT) continue;
      out.push({ path, text: readFileSync(join(dir, e.name), "utf8") });
    }
  };
  walk(workspace, "");
  return out;
}
