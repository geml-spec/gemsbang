// The bridge between the Claude Code hooks module (no Node) and the bundled
// CLI (Node): one JSON request on the CLI's stdin — one call of the client by
// name, with its arguments — and one JSON answer line on its stdout, both
// shaped here. Node-free: the hooks module imports this file.
import type { GbResult } from "../../gemsbang/ops.js";

export const PROTOCOL_VERSION = 1;
/** How long one bridge call may take before the hooks module gives up on it. */
export const BRIDGE_TIMEOUT_MS = 15_000;
/** A call that may read every chat again, as the first status after a start does. */
export const SLOW_TIMEOUT_MS = 45_000;

/** One call of the client (src/gemsbang/ops.ts) by name. */
export interface BridgeRequest { v: 1; call: string; args?: Record<string, unknown> }

/** The call's result, whole (a refusal is the call's own); `ok: false` only when the bridge itself could not answer. */
export type BridgeResponse = { v: 1; ok: true; gb: GbResult } | { v: 1; ok: false; error: string };

export function encodeRequest(req: BridgeRequest): string {
  return `${JSON.stringify(req)}\n`;
}

/** The request the CLI read, or what is wrong with it. */
export function decodeRequest(text: string): BridgeRequest | { error: string } {
  let v: Record<string, unknown>;
  try {
    v = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { error: "the request is not JSON" };
  }
  if (v === null || typeof v !== "object" || Array.isArray(v)) return { error: "the request is not an object" };
  if (v["v"] !== PROTOCOL_VERSION) return { error: `protocol version ${String(v["v"])}; this CLI speaks ${PROTOCOL_VERSION}` };
  if (typeof v["call"] !== "string" || v["call"] === "") return { error: "call is required" };
  const args = v["args"];
  if (args !== undefined && (typeof args !== "object" || args === null || Array.isArray(args))) return { error: "args is an object" };
  return { v: 1, call: v["call"], ...(args !== undefined ? { args: args as Record<string, unknown> } : {}) };
}

/** The last line of the CLI's stdout that parses as an answer of this version. */
export function decodeResponse(stdout: string): BridgeResponse | undefined {
  const lines = stdout.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const v = JSON.parse(lines[i]!) as { v?: unknown; ok?: unknown };
      if (v !== null && typeof v === "object" && v.v === PROTOCOL_VERSION && typeof v.ok === "boolean") return v as BridgeResponse;
    } catch {
      // not this line
    }
  }
  return undefined;
}

/**
 * The line's words for a bridge whose stdout held no answer. stderr's error
 * line says what went wrong (`Error: …`, `TypeError: …`, else its first line);
 * a module or package Node could not find means the plugin's bundle was never
 * built, so the words lead with the build to run.
 */
export function unreadableText(exitCode: number, stderr: string, pluginRoot: string): string {
  const lines = stderr.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  const said = lines.find((l) => /^[A-Za-z]*Error\b[^:]*:/.test(l)) ?? lines[0] ?? "";
  if (/Cannot find (?:module|package)/.test(said)) return `gemsbang：没有构建 — 在 ${pluginRoot} 运行 npm run build（${said}）`;
  return `gemsbang：应答无法解析（退出码 ${exitCode}${said ? `：${said}` : ""}）`;
}
