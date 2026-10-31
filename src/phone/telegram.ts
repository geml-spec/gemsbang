// Telegram as the bridge's transport (transport §7.2 先接 Telegram): long
// polling on getUpdates, a text with the message it replies to, a button as
// a callback query answered at once, a message with an inline keyboard.
// Only fetch; a fake one drives the tests.
import type { Button, Transport } from "./bridge.js";

interface Update { update_id: number; message?: { message_id: number; chat: { id: number | string }; text?: string; reply_to_message?: { message_id: number } }; callback_query?: { id: string; from: { id: number | string }; message?: { chat: { id: number | string }; message_id: number }; data?: string } }
type Handlers = Parameters<Transport["start"]>[0];

export class TelegramTransport implements Transport {
  private offset = 0;
  private stopped = true;
  private handlers: Handlers | undefined;
  private loop: Promise<void> = Promise.resolve();

  constructor(private readonly botToken: string, private readonly fetchImpl: typeof fetch = fetch, private readonly retryMs = 3000) {}

  private async call(method: string, body: Record<string, unknown>): Promise<unknown> {
    const r = await this.fetchImpl(`https://api.telegram.org/bot${this.botToken}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = (await r.json()) as { ok: boolean; result?: unknown; description?: string };
    if (!j.ok) throw new Error(j.description ?? `telegram ${method} failed`);
    return j.result;
  }

  start(h: Handlers): void {
    this.handlers = h;
    this.stopped = false;
    this.loop = this.poll();
  }

  stop(): void { this.stopped = true; }

  /** Once the polling loop has ended (tests wait on it). */
  idle(): Promise<void> { return this.loop; }

  private async poll(): Promise<void> {
    while (!this.stopped) {
      try {
        const updates = (await this.call("getUpdates", { offset: this.offset, timeout: 25 })) as Update[];
        for (const u of updates) { this.offset = u.update_id + 1; this.dispatch(u); }
      } catch {
        await new Promise((done) => setTimeout(done, this.retryMs));
      }
    }
  }

  private dispatch(u: Update): void {
    const h = this.handlers;
    if (h === undefined) return;
    if (u.message?.text !== undefined) void h.onText(String(u.message.chat.id), u.message.text, u.message.reply_to_message !== undefined ? String(u.message.reply_to_message.message_id) : undefined);
    if (u.callback_query !== undefined) {
      void h.onPress(String(u.callback_query.message?.chat.id ?? u.callback_query.from.id), u.callback_query.data ?? "");
      void this.call("answerCallbackQuery", { callback_query_id: u.callback_query.id }).catch(() => undefined);
    }
  }

  async send(chat: string, text: string, buttons?: Button[][]): Promise<string> {
    const r = (await this.call("sendMessage", { chat_id: chat, text, ...(buttons !== undefined ? { reply_markup: { inline_keyboard: buttons.map((row) => row.map((b) => ({ text: b.label, callback_data: b.data }))) } } : {}) })) as { message_id: number };
    return String(r.message_id);
  }
}
