// A group's link (spec §6.1): one current code per group, good for seven
// days; the owner can swap it, and the old one stops at once. Members may
// pass it on unless the owner turned that off; the owner may also ask to let
// each newcomer in by hand. A link is said as `/i/<code>`, for a person's
// browser, and `/i/<code>.md`, for an agent; the one who passed it on may
// ride along as `?by=<avatar>`, and the name they call the newcomer as
// `?call=`. An avatar has a link of its own too (S37), the same code and the
// same seven days, said as `/u/<code>`: whoever opens it starts a two-person
// chat with that avatar. Pure: the random bytes and the time are given.

export const LINK_TTL_MS = 7 * 24 * 3_600_000;
/** Letters and digits nobody misreads: no 0/o, 1/l/i. */
export const LINK_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export const LINK_CODE = /^[a-hj-km-np-z2-9]{8}$/;

/** What a group's owner set about its link: whether members may pass it on, whether the owner lets each newcomer in. */
export interface LinkRules { forward: boolean; approve: boolean }
export const DEFAULT_LINK_RULES: LinkRules = { forward: true, approve: false };

/** Eight letters of the alphabet from eight random bytes. */
export function makeCode(bytes: Uint8Array): string {
  if (bytes.length < 8) throw new Error("a link's code needs eight random bytes");
  let out = "";
  for (let i = 0; i < 8; i++) out += LINK_ALPHABET[bytes[i]! % LINK_ALPHABET.length];
  return out;
}

/** When a link made at `made` stops. */
export const expiresAt = (made: string): string => new Date(Date.parse(made) + LINK_TTL_MS).toISOString().replace(/\.\d{3}Z$/, "Z");

export type LinkStatus = "ok" | "expired" | "replaced";

/** A link as it stands at `now`: swapped for another, past its day, or good. */
export function linkStatus(link: { code: string; expires: string }, current: string | undefined, now: string): LinkStatus {
  if (current !== link.code) return "replaced";
  return Date.parse(now) >= Date.parse(link.expires) ? "expired" : "ok";
}

/** Whether this member may hand the link out: the owner always, the others while forwarding is on. */
export const mayHandOut = (rules: LinkRules, isOwner: boolean): boolean => isOwner || rules.forward;

/** The rules with a change laid over them; undefined when the change is not two booleans at most. */
export function withLinkRules(base: LinkRules, change: unknown): LinkRules | undefined {
  if (typeof change !== "object" || change === null || Array.isArray(change)) return undefined;
  const out: LinkRules = { ...base };
  for (const [key, v] of Object.entries(change as Record<string, unknown>)) {
    if (key === "as") continue;
    if ((key !== "forward" && key !== "approve") || typeof v !== "boolean") return undefined;
    out[key] = v;
  }
  return out;
}

/** The page's path for a person, with who passed it on and what they call the newcomer. */
export function linkPath(code: string, o: { by?: string; call?: string } = {}): string {
  const q = new URLSearchParams();
  if (o.by !== undefined) q.set("by", o.by);
  if (o.call !== undefined && o.call.trim() !== "") q.set("call", o.call.trim());
  const s = q.toString();
  return `/i/${code}${s === "" ? "" : `?${s}`}`;
}

/** An avatar's own link (S37), for a person's browser. */
export const personLinkPath = (code: string): string => `/u/${code}`;
