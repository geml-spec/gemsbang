// Reading Claude Code's tool calls, and Node's version, without Node: the
// hooks module imports this file.

const RESERVED = new Set(["tool", "tool_use_id", "agentId", "requestMeta", "consent"]);

/** A tool call's own arguments: the event's input without the keys the engine reserves. */
export function toolArgs(e: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(e)) if (!RESERVED.has(k) && v !== undefined) out[k] = v;
  return out;
}

/** The major version in `node --version`'s output. */
export function nodeMajor(text: string): number | undefined {
  const m = text.trim().match(/^v?(\d+)\./);
  return m ? Number(m[1]) : undefined;
}
