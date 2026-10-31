// Tokens (transport §2.4, §2.5): a person's, an agent's (issued by its
// owner, scoped to that agent), a guest's (made on the guest page), an
// inbox-only one (the phone bridge). The relay keeps only a sha256 of each,
// under its own owner `_relay`, one block per token and one per revocation;
// the token itself is shown once, to whoever asked for it. A request's
// speaker is its token's — a person's token speaks as `person:<id>`, an
// agent's as `agent:<name>@<owner>` — whatever the body claims.
import { createHash, randomBytes } from "node:crypto";
import { appendSealed, readDoc, RELAY_OWNER } from "./store.js";

export type Scope = "person" | "agent" | "guest" | "inbox";
const SCOPES: ReadonlySet<string> = new Set(["person", "agent", "guest", "inbox"]);
export interface TokenRecord { id: string; speaker: string; scope: Scope; at: string; by: string }
const TOKENS = "tokens.geml";

export const hashToken = (token: string): string => "sha256:" + createHash("sha256").update(token, "utf8").digest("hex");
const rand = (): string => randomBytes(6).toString("hex");

export function issueToken(root: string, o: { speaker: string; scope: Scope; by: string; at: string }): { token: string; record: TokenRecord } {
  const token = `gwx_${randomBytes(24).toString("hex")}`;
  const id = `token-${rand()}`;
  appendSealed(root, RELAY_OWNER, TOKENS, id, { token: hashToken(token), speaker: o.speaker, scope: o.scope, at: o.at, by: o.by });
  return { token, record: { id, speaker: o.speaker, scope: o.scope, at: o.at, by: o.by } };
}

/** The record a token stands for, or nothing: unknown, malformed, or revoked. */
export function verifyToken(root: string, token: string): TokenRecord | undefined {
  if (!token.startsWith("gwx_")) return undefined;
  const h = hashToken(token);
  const d = readDoc(root, RELAY_OWNER, TOKENS);
  const revoked = new Set(d.blocks.filter((b) => b.id.startsWith("revoke-")).map((b) => b.value["token"]));
  for (const b of d.blocks) {
    if (!b.id.startsWith("token-") || b.value["token"] !== h || revoked.has(b.id)) continue;
    const { speaker, scope, at, by } = b.value;
    if (typeof speaker !== "string" || typeof scope !== "string" || !SCOPES.has(scope)) return undefined;
    return { id: b.id, speaker, scope: scope as Scope, at: typeof at === "string" ? at : "", by: typeof by === "string" ? by : "" };
  }
  return undefined;
}

/** Revoke a token by its record's id; false when there is no such token. */
export function revokeToken(root: string, id: string, at: string): boolean {
  if (!readDoc(root, RELAY_OWNER, TOKENS).blocks.some((b) => b.id === id)) return false;
  appendSealed(root, RELAY_OWNER, TOKENS, `revoke-${rand()}`, { token: id, at });
  return true;
}
