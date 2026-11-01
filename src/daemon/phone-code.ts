// A one-time code to bind the phone's bot with (transport §7.2): asked of the
// relay with the person's token; it holds for ten minutes, and the bot's /bind
// takes it once. The CLI's `connect phone-code` and the plugin's 生成绑定码.
import { RelayClient, reasonOf } from "./client.js";
import { readConfig } from "./home.js";

export async function phoneCode(home: string, fetchImpl?: typeof fetch): Promise<{ ok: true; code: string } | { ok: false; reason: string }> {
  const c = readConfig(home);
  if (c === undefined) return { ok: false, reason: "没有 connect.json：先 gemworks connect setup" };
  try {
    const r = await new RelayClient(c.relay.url, c.token, fetchImpl).post("/phone/code", {});
    return r.status === 201 ? { ok: true, code: (r.body as { code: string }).code } : { ok: false, reason: reasonOf(r) };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
