// The daemon (transport §3): one per person, the one process that reaches
// the relay. `syncOnce` lists what the person follows, mirrors each document
// whole, pushes the outbox, posts the heartbeat and records whether the relay
// was reached; `run` repeats it with a subscription in between, pushed blocks
// appended to their mirrors as they land, and tries again with a backoff when
// the relay is gone. Nothing here throws out of `run`: a host reads the
// state file and says 断了. Hosts never call this module; they read the
// mirror and write the outbox (deliver.ts).
import type { Need } from "../core/im/needs-me.js";
import { RelayClient, RelayDown, reasonOf } from "./client.js";
import { appendMirror, failOutbox, listOutbox, listSessions, readConfig, removeOutbox, removeSession, updateOutbox, writeInbox, writeMirror, writeState, type Config } from "./home.js";

export interface SyncReport { connected: boolean; docs: number; pushed: number; failed: number; left: number; heartbeats: number; error?: string }
export interface Intervals { heartbeatMs: number; outboxMs: number; syncMs: number }
/** The heartbeat every 30 seconds (transport §3); the outbox every 5; the listing again every minute. */
export const DEFAULT_INTERVALS: Intervals = { heartbeatMs: 30_000, outboxMs: 5_000, syncMs: 60_000 };
export const DEFAULT_BACKOFF_MS: readonly number[] = [5_000, 15_000, 30_000, 60_000];
export interface DaemonOptions { home: string; now?: () => string; fetchImpl?: typeof fetch; log?: (line: string) => void; intervals?: Partial<Intervals>; backoffMs?: readonly number[] }

function splitKey(key: string): [string, string] {
  const i = key.indexOf("/");
  return i === -1 ? [key, ""] : [key.slice(0, i), key.slice(i + 1)];
}

export class Daemon {
  readonly home: string;
  private readonly now: () => string;
  private readonly fetchImpl: typeof fetch | undefined;
  private readonly log: (line: string) => void;
  private readonly intervals: Intervals;
  private readonly backoff: readonly number[];
  private ws: WebSocket | undefined;
  private followed: string[] = [];
  private stopped = false;
  private wake: (() => void) | undefined;

  constructor(o: DaemonOptions) {
    this.home = o.home;
    this.now = o.now ?? (() => new Date().toISOString().replace(/\.\d{3}Z$/, "Z"));
    this.fetchImpl = o.fetchImpl;
    this.log = o.log ?? (() => {});
    this.intervals = { ...DEFAULT_INTERVALS, ...o.intervals };
    this.backoff = o.backoffMs ?? DEFAULT_BACKOFF_MS;
  }

  config(): Config {
    const c = readConfig(this.home);
    if (c === undefined) throw new Error("没有 connect.json：先 gemworks connect setup");
    return c;
  }

  /** The client signing as the person, or as one of their agents (`agent:<name>`). */
  client(as: string, c: Config = this.config()): RelayClient {
    const token = as === "person" ? c.token : as.startsWith("agent:") ? c.agents[as.slice("agent:".length)] : undefined;
    if (token === undefined) throw new Error(`没有 ${as} 的令牌`);
    return new RelayClient(c.relay.url, token, this.fetchImpl);
  }

  /** What the person follows (decision 3): their page, the venues they are in, their agents' queues, the task cards they are on (§8). */
  async listFollowed(c: Config, client: RelayClient): Promise<string[]> {
    const venues = await client.venues();
    const agents = await client.agents();
    const tasks = await client.tasks();
    return [`${c.person}/people/${c.person}.geml`, ...venues.map((v) => `${v.owner}/venues/${v.id}.geml`), ...agents.map((a) => `${c.person}/queues/${a}.geml`), ...tasks.map((t) => `${t.owner}/cards/${t.id}.geml`)];
  }

  /** Every followed document mirrored whole, then the inbox; how many documents the relay had. The outbox is flushed first (`syncOnce`), so a round's mirrors carry what it just pushed. */
  async mirrorAll(c: Config, client: RelayClient, docs: readonly string[]): Promise<number> {
    let n = 0;
    for (const key of docs) {
      const [owner, doc] = splitKey(key);
      const text = await client.readGeml(owner, doc);
      if (text === undefined) continue;
      writeMirror(this.home, c.relay.name, owner, doc, text);
      n++;
    }
    writeInbox(this.home, c.relay.name, c.person, (await client.inbox()) as Need[]);
    return n;
  }

  /** The outbox pushed oldest first: a 2xx removes the entry, a 4xx fails it with the reason, a 5xx leaves it for next time. A relay down stops the flush where it is. */
  async flushOutbox(c: Config = this.config()): Promise<{ pushed: number; failed: number; left: number }> {
    let pushed = 0, failed = 0, left = 0;
    for (const e of listOutbox(this.home)) {
      let client: RelayClient;
      try { client = this.client(e.as, c); } catch (err) { failOutbox(this.home, e.id, err instanceof Error ? err.message : String(err)); failed++; continue; }
      const r = e.kind === "grant" ? await client.post("/grants", e.body) : e.kind === "refuse" ? await client.post("/grants/refuse", e.body) : await client.append(e.owner, e.doc, e.body);
      if (r.status >= 200 && r.status < 300) { removeOutbox(this.home, e.id); pushed++; }
      else if (r.status >= 400 && r.status < 500) { failOutbox(this.home, e.id, reasonOf(r)); failed++; this.log(`没发出去：${e.kind} → ${e.owner}/${e.doc}：${reasonOf(r)}`); }
      else { updateOutbox(this.home, { ...e, tries: e.tries + 1, error: reasonOf(r) }); left++; }
    }
    return { pushed, failed, left };
  }

  /** Every session the hosts reported, posted with this moment's heartbeat; one that said asleep, or that the relay refused, is retired after. */
  async heartbeat(c: Config = this.config()): Promise<number> {
    let n = 0;
    for (const s of listSessions(this.home)) {
      let client: RelayClient;
      try { client = this.client(`agent:${s.agent}`, c); } catch { continue; }
      const body: Record<string, unknown> = { session: s.session, host: s.report.host, login: s.report.login, presence: s.report.presence };
      if (s.report.task !== undefined) body["task"] = s.report.task;
      const r = await client.presence(body);
      if (r.status === 200) n++;
      if (s.report.presence === "asleep" || r.status === 400 || r.status === 403) removeSession(this.home, s.agent, s.session);
    }
    return n;
  }

  async syncOnce(): Promise<SyncReport> {
    const at = this.now();
    try {
      const c = this.config();
      const client = this.client("person", c);
      const flushed = await this.flushOutbox(c);
      this.followed = await this.listFollowed(c, client);
      const docs = await this.mirrorAll(c, client, this.followed);
      const heartbeats = await this.heartbeat(c);
      writeState(this.home, { connected: true, at });
      return { connected: true, docs, ...flushed, heartbeats };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      writeState(this.home, { connected: false, at, error });
      return { connected: false, docs: 0, pushed: 0, failed: 0, left: listOutbox(this.home).length, heartbeats: 0, error };
    }
  }

  /** Follow the listed documents live: a pushed block goes onto its mirror; a document never mirrored is fetched whole. Resolves once open. */
  connect(): Promise<void> {
    const c = this.config();
    const client = this.client("person", c);
    return new Promise((done, failed) => {
      let open = false;
      this.ws = client.subscribe(this.followed, {
        onOpen: () => { open = true; done(); },
        onBlock: (key, block) => {
          const [owner, doc] = splitKey(key);
          if (appendMirror(this.home, c.relay.name, owner, doc, block) === "missing") {
            void client.readGeml(owner, doc).then((text) => { if (text !== undefined) writeMirror(this.home, c.relay.name, owner, doc, text); }).catch(() => { /* the next sync fetches it */ });
          }
        },
        onClose: (why) => {
          this.ws = undefined;
          this.log(`订阅断了：${why}`);
          if (!open) failed(new RelayDown(why));
          this.wakeUp();
        },
      });
    });
  }

  disconnect(): void {
    const ws = this.ws;
    this.ws = undefined;
    if (ws !== undefined) { try { ws.close(); } catch { /* already closed */ } }
  }

  get connected(): boolean { return this.ws !== undefined; }

  private wakeUp(): void { const w = this.wake; this.wake = undefined; w?.(); }

  private sleep(ms: number): Promise<void> {
    return new Promise((done) => {
      const t = setTimeout(() => { this.wake = undefined; done(); }, ms);
      this.wake = () => { clearTimeout(t); done(); };
    });
  }

  stop(): void { this.stopped = true; this.disconnect(); this.wakeUp(); }

  /** The daemon's life: sync, follow, keep the heartbeat and the outbox going and the listing fresh; after a failure try again with a backoff; until `stop`. */
  async run(): Promise<void> {
    let attempt = 0;
    while (!this.stopped) {
      const r = await this.syncOnce();
      if (!r.connected) {
        this.log(`断了：${r.error ?? ""}`);
        await this.sleep(this.backoff[Math.min(attempt++, this.backoff.length - 1)] ?? 60_000);
        continue;
      }
      attempt = 0;
      try { await this.connect(); } catch (e) {
        this.log(`订阅失败：${e instanceof Error ? e.message : String(e)}`);
        await this.sleep(this.backoff[0] ?? 5_000);
        continue;
      }
      await this.whileConnected();
      this.disconnect();
    }
    this.disconnect();
  }

  /** Between a subscription's open and its close: the heartbeat, the outbox and the full sync on their intervals; a changed listing ends it so the next round subscribes anew. */
  private whileConnected(): Promise<void> {
    const guard = async (fn: () => Promise<unknown>): Promise<void> => {
      try { await fn(); } catch (e) { this.log(`断了：${e instanceof Error ? e.message : String(e)}`); this.disconnect(); this.wakeUp(); }
    };
    const resync = async (): Promise<void> => {
      const before = this.followed.join("\n");
      const r = await this.syncOnce();
      if (!r.connected) throw new Error(r.error ?? "sync");
      if (this.followed.join("\n") !== before) { this.disconnect(); this.wakeUp(); }
    };
    const timers = [
      setInterval(() => void guard(() => this.heartbeat()), this.intervals.heartbeatMs),
      setInterval(() => void guard(() => this.flushOutbox()), this.intervals.outboxMs),
      setInterval(() => void guard(resync), this.intervals.syncMs),
    ];
    return new Promise((done) => {
      this.wake = () => { for (const t of timers) clearInterval(t); this.wake = undefined; done(); };
      if (this.ws === undefined || this.stopped) this.wakeUp();
    });
  }
}
