// Tokens (transport §2.4, §2.5): a person's, an agent's (issued by its
// owner, scoped to that agent), a guest's (made on the guest page), an
// inbox-only one (the phone bridge). The relay keeps only a sha256 of each,
// under its own owner `_relay`, one block per token and one per revocation;
// the token itself is shown once, to whoever asked for it. A request's
// speaker is its token's — a person's token speaks as `person:<id>`, an
// agent's as `agent:<name>@<owner>` — whatever the body claims. Kept on the
// relay's documents: its folder (`root`), or its store (doc-store.ts).
import { createHash, randomBytes } from "node:crypto";
import { appendSealed, fileStore, type DocStore } from "./doc-store.js";
import { RELAY_OWNER } from "./store.js";

/** gemsbang adds two (relay/avatars.ts): an avatar's, which speaks as `avatar:<id>`, and a device's, the agent a person attached on one machine, which speaks as the person but may only ask for an avatar's token. */
export type Scope = "person" | "agent" | "guest" | "inbox" | "avatar" | "device";
const SCOPES: ReadonlySet<string> = new Set(["person", "agent", "guest", "inbox", "avatar", "device"]);
export interface TokenRecord { id: string; speaker: string; scope: Scope; at: string; by: string }
const TOKENS = "tokens.geml";

export const hashToken = (token: string): string => "sha256:" + createHash("sha256").update(token, "utf8").digest("hex");
const rand = (): string => randomBytes(6).toString("hex");
const storeOf = (at: string | DocStore): DocStore => (typeof at === "string" ? fileStore(at) : at);

export function issueToken(at: string | DocStore, o: { speaker: string; scope: Scope; by: string; at: string }): { token: string; record: TokenRecord } {
  const token = `gwx_${randomBytes(24).toString("hex")}`;
  const id = `token-${rand()}`;
  appendSealed(storeOf(at), RELAY_OWNER, TOKENS, id, { token: hashToken(token), speaker: o.speaker, scope: o.scope, at: o.at, by: o.by });
  return { token, record: { id, speaker: o.speaker, scope: o.scope, at: o.at, by: o.by } };
}

/** The record a token stands for, or nothing: unknown, malformed, or revoked. */
export function verifyToken(at: string | DocStore, token: string): TokenRecord | undefined {
  if (!token.startsWith("gwx_")) return undefined;
  const h = hashToken(token);
  const d = storeOf(at).read(RELAY_OWNER, TOKENS);
  const revoked = new Set(d.blocks.filter((b) => b.id.startsWith("revoke-")).map((b) => b.value["token"]));
  for (const b of d.blocks) {
    if (!b.id.startsWith("token-") || b.value["token"] !== h || revoked.has(b.id)) continue;
    const { speaker, scope, at, by } = b.value;
    if (typeof speaker !== "string" || typeof scope !== "string" || !SCOPES.has(scope)) return undefined;
    return { id: b.id, speaker, scope: scope as Scope, at: typeof at === "string" ? at : "", by: typeof by === "string" ? by : "" };
  }
  return undefined;
}

/** Every token not revoked, oldest first. */
export function liveTokens(at: string | DocStore): TokenRecord[] {
  const d = storeOf(at).read(RELAY_OWNER, TOKENS);
  const revoked = new Set(d.blocks.filter((b) => b.id.startsWith("revoke-")).map((b) => b.value["token"]));
  const out: TokenRecord[] = [];
  for (const b of d.blocks) {
    const { speaker, scope, at: when, by } = b.value;
    if (!b.id.startsWith("token-") || revoked.has(b.id) || typeof speaker !== "string" || typeof scope !== "string" || !SCOPES.has(scope)) continue;
    out.push({ id: b.id, speaker, scope: scope as Scope, at: typeof when === "string" ? when : "", by: typeof by === "string" ? by : "" });
  }
  return out;
}

/** Revoke a token by its record's id; false when there is no such token, or it is revoked already. */
export function revokeToken(root: string | DocStore, id: string, at: string): boolean {
  const s = storeOf(root);
  const d = s.read(RELAY_OWNER, TOKENS);
  if (!d.blocks.some((b) => b.id === id) || d.blocks.some((b) => b.id.startsWith("revoke-") && b.value["token"] === id)) return false;
  appendSealed(s, RELAY_OWNER, TOKENS, `revoke-${rand()}`, { token: id, at });
  return true;
}
