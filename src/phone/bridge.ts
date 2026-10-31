// The phone bridge (transport §7.2): a bot on the person's phone that
// mirrors the inbox's five kinds of need as small cards with buttons — a
// press, or a typed reply to a card, flows back through the relay as the
// person's own answer — and takes /tell to one's own agent. It binds with a
// one-time code from the desktop, holds an inbox-scope token only, and
// mirrors nothing else: no group talk, no bot-to-bot, no files. The
// transport (Telegram first, 飞书 next) is a small interface; a scripted one
// drives the tests.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NEED_VERBS, type Need } from "../core/im/needs-me.js";
import { RelayClient, reasonOf } from "../daemon/client.js";
import { writeAtomic } from "../host-fs.js";

export interface Button { label: string; data: string }
/** What a bot platform must do: hand over texts (with the id of the message they reply to, when any) and button presses, each with its chat; send a message with rows of buttons and give back its id. */
export interface Transport {
  start(h: { onText: (chat: string, text: string, replyTo?: string) => void | Promise<void>; onPress: (chat: string, data: string) => void | Promise<void> }): void;
  stop(): void;
  send(chat: string, text: string, buttons?: Button[][]): Promise<string>;
}
/** One chat's binding: whose inbox, the token, what was shown (by key), the cards by their number (for the buttons' data), the last number. */
export interface Binding { person: string; token: string; seen: string[]; cards: Record<string, { key: string; actions: string[]; message: string }>; n: number }

export const FIRST_LINE = "只镜像需要你的事 · 群里的话不在这里";
export const BIND_FIRST = "先绑定：在桌面端或网页生成一次性码，然后发 /bind <码>";
export const HELP_LINE = "只认 /tell <agent> <文字>，和对一张卡的回复";
/** The bot's word after /tell (transport §7.2). */
export const tellReply = (agent: string, person: string): string => `已进 ${agent} 的队列，主人等级，排第一。它会在群里转述你这句，标『${person} 原话』`;
const SEEN_LIMIT = 500;

export interface BridgeOptions { relayUrl: string; home: string; transport: Transport; pollMs?: number; log?: (line: string) => void; fetchImpl?: typeof fetch }

export class Bridge {
  private readonly relayUrl: string;
  private readonly home: string;
  private readonly transport: Transport;
  private readonly pollMs: number;
  private readonly log: (line: string) => void;
  private readonly fetchImpl: typeof fetch | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(o: BridgeOptions) {
    this.relayUrl = o.relayUrl;
    this.home = o.home;
    this.transport = o.transport;
    this.pollMs = o.pollMs ?? 15_000;
    this.log = o.log ?? (() => {});
    this.fetchImpl = o.fetchImpl;
  }

  start(): void {
    this.transport.start({ onText: (chat, text, replyTo) => this.onText(chat, text, replyTo), onPress: (chat, data) => this.onPress(chat, data) });
    this.timer = setInterval(() => { void this.mirror().catch((e: unknown) => this.log(e instanceof Error ? e.message : String(e))); }, this.pollMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    this.transport.stop();
  }

  /** The chats bound, by id. */
  bindings(): string[] {
    const dir = join(this.home, "phone");
    return existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith(".json")).map((n) => n.slice(0, -".json".length)).sort() : [];
  }

  private path(chat: string): string { return join(this.home, "phone", `${chat.replace(/[^A-Za-z0-9_-]/g, "_")}.json`); }
  private read(chat: string): Binding | undefined {
    const p = this.path(chat);
    if (!existsSync(p)) return undefined;
    try { return JSON.parse(readFileSync(p, "utf8")) as Binding; } catch { return undefined; }
  }
  private write(chat: string, b: Binding): void { writeAtomic(this.path(chat), `${JSON.stringify(b)}\n`); }
  private client(token?: string): RelayClient { return new RelayClient(this.relayUrl, token, this.fetchImpl); }

  /** A text from the phone: /bind with the code, /tell to an agent, a reply to a card (自己写), or the one help line. */
  async onText(chat: string, text: string, replyTo?: string): Promise<void> {
    const bind = /^\/(?:start|bind)\s+(\d{6})\s*$/.exec(text.trim());
    if (bind !== null) {
      let r: { status: number; body: unknown };
      try { r = await this.client().post("/phone/bind", { code: bind[1] }); } catch (e) { await this.transport.send(chat, `绑定失败：${e instanceof Error ? e.message : String(e)}`); return; }
      if (r.status !== 200) { await this.transport.send(chat, `绑定失败：${reasonOf(r)}`); return; }
      const { token, person } = r.body as { token: string; person: string };
      this.write(chat, { person, token, seen: [], cards: {}, n: 0 });
      await this.transport.send(chat, `已绑定 ${person}\n${FIRST_LINE}`);
      await this.mirror(chat);
      return;
    }
    const b = this.read(chat);
    if (b === undefined) { await this.transport.send(chat, BIND_FIRST); return; }
    const tell = /^\/tell\s+(\S+)\s+([\s\S]+)$/.exec(text.trim());
    if (tell !== null) {
      let r: { status: number; body: unknown };
      try { r = await this.client(b.token).post("/tell", { agent: tell[1], text: tell[2]!.trim() }); } catch (e) { await this.transport.send(chat, `没进队列：${e instanceof Error ? e.message : String(e)}`); return; }
      await this.transport.send(chat, r.status === 201 ? tellReply(tell[1]!, b.person) : `没进队列：${reasonOf(r)}`);
      return;
    }
    if (replyTo !== undefined) {
      const card = Object.values(b.cards).find((c) => c.message === replyTo);
      if (card !== undefined) { await this.answer(chat, b, card.key, "自己写", text.trim()); return; }
    }
    await this.transport.send(chat, HELP_LINE);
  }

  /** A button pressed: the card's action, by the data `<card>:<i>`. A press on nothing says nothing. */
  async onPress(chat: string, data: string): Promise<void> {
    const m = /^(\d+):(\d+)$/.exec(data);
    const b = this.read(chat);
    if (m === null || b === undefined) return;
    const card = b.cards[m[1]!];
    const action = card?.actions[Number(m[2])];
    if (card === undefined || action === undefined) return;
    await this.answer(chat, b, card.key, action);
  }

  /** The answer through the relay as the person (transport §7.2 回流为 human 来源的证据), and the bot's word on it. */
  private async answer(chat: string, b: Binding, key: string, action: string, text?: string): Promise<void> {
    let r: { status: number; body: unknown };
    try { r = await this.client(b.token).post("/inbox/answer", { key, action, ...(text !== undefined ? { text } : {}) }); } catch (e) { await this.transport.send(chat, `没答上：${e instanceof Error ? e.message : String(e)}`); return; }
    if (r.status !== 200) { await this.transport.send(chat, `没答上：${reasonOf(r)}`); return; }
    const said = (r.body as { said?: string }).said;
    await this.transport.send(chat, `已答：${action}${said !== undefined && said !== action ? `\n${said}` : ""}`);
  }

  /** The inbox mirrored (transport §7.2 镜像): every need not shown yet becomes a card with its buttons; how many went out. */
  async mirror(only?: string): Promise<number> {
    let n = 0;
    for (const chat of this.bindings()) {
      if (only !== undefined && chat !== only) continue;
      const b = this.read(chat);
      if (b === undefined) continue;
      let needs: Need[];
      try { const r = await this.client(b.token).get("/inbox"); if (r.status !== 200) continue; needs = r.body as Need[]; } catch { continue; }
      for (const need of needs) {
        if (b.seen.includes(need.key)) continue;
        b.n++;
        const id = String(b.n);
        const buttons = need.actions.map((label, i) => ({ label, data: `${id}:${i}` }));
        const message = await this.transport.send(chat, `[${NEED_VERBS[need.kind]}] ${need.text}`, buttons.length > 0 ? [buttons] : undefined);
        b.cards[id] = { key: need.key, actions: need.actions, message };
        b.seen.push(need.key);
        n++;
      }
      if (b.seen.length > SEEN_LIMIT) b.seen = b.seen.slice(-SEEN_LIMIT);
      this.write(chat, b);
    }
    return n;
  }
}
