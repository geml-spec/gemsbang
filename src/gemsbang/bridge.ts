// The Node side of the plugin's bridge (transport §4): one request, one call
// of the client by name at GEMSBANG_HOME (else ~/.gemsbang), to the service
// GEMSBANG_SERVICE names (else https://gemsbang.com), its result whole.
import type { BridgeRequest, BridgeResponse } from "../hosts/claude-code/protocol.js";
import { gbHome, gbService } from "./home.js";
import { runGb } from "./ops.js";

/** The request answered; a throw from the call becomes an error answer. */
export async function answer(req: BridgeRequest): Promise<BridgeResponse> {
  try {
    const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    const gb = await runGb(req.call, req.args ?? {}, { home: gbHome(), service: gbService(), now, zoneMinutes: -new Date().getTimezoneOffset() });
    return { v: 1, ok: true, gb };
  } catch (e) {
    return { v: 1, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
