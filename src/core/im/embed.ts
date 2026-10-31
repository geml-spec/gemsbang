// Reference, never copy (rule 10, §5.1): everything exists in one place as an
// addressed GEML block, and wherever else it appears it is an embed. Two
// resolutions — live (follows the source) and pinned (`rev` or `hash` names
// one revision); by permission — a reader gets the content, anyone else a
// stub that says whose private range it is and nothing of the content; within
// a budget — the host expands what fits (16 KB by default) and leaves the
// rest as addresses for the agent's read tool. Pure: the caller brings the
// access function; nothing here reads a file or a socket.
import { parseAddress } from "./address.js";

export interface Embed {
  src: string;
  /** A journal revision, when the embed is pinned to one. */
  rev?: number;
  /** The block's hash, when the embed is pinned to it. */
  hash?: string;
}

export const isPinned = (e: Embed): boolean => e.rev !== undefined || e.hash !== undefined;

/** What the viewer sees in place of a block they may not read: whose private range, which session and turn, and the one action. */
export interface Stub { from: string; session?: string; turn?: string; note: "你看不到"; action: "申请看" }

export interface Resolved {
  embed: Embed;
  text?: string;
  stub?: Stub;
  /** Why there is neither text nor stub: 不是地址, 找不到, or a pinned block that changed. */
  fault?: string;
}

/** What the caller knows about one block for one viewer: its text and its own hash when the viewer may read it, a denial otherwise, nothing when it does not exist. */
export type Access = (e: Embed, viewer: string) =>
  | { text: string; hash: string; owner: string; session?: string; turn?: string }
  | { denied: true; owner: string; session?: string; turn?: string }
  | undefined;

export const DEFAULT_BUDGET = 16384;

export function resolveEmbed(e: Embed, viewer: string, access: Access): Resolved {
  if (parseAddress(e.src) === undefined) return { embed: e, fault: "不是地址" };
  const got = access(e, viewer);
  if (got === undefined) return { embed: e, fault: "找不到" };
  if ("denied" in got) {
    const stub: Stub = { from: got.owner, note: "你看不到", action: "申请看" };
    if (got.session !== undefined) stub.session = got.session;
    if (got.turn !== undefined) stub.turn = got.turn;
    return { embed: e, stub };
  }
  if (e.hash !== undefined && e.hash !== got.hash) return { embed: e, fault: "钉住的块已变：哈希不符" };
  return { embed: e, text: got.text };
}

const bytes = (s: string): number => new TextEncoder().encode(s).length;

/**
 * The embeds expanded in order until the budget (UTF-8 bytes of text) would
 * be exceeded; the first that does not fit and every one after it are left
 * as addresses. A stub or a fault costs nothing and is always expanded.
 */
export function expandEmbeds(parts: readonly Embed[], viewer: string, access: Access, budget = DEFAULT_BUDGET): { expanded: Resolved[]; left: Embed[] } {
  const expanded: Resolved[] = [];
  let used = 0;
  for (let i = 0; i < parts.length; i++) {
    const r = resolveEmbed(parts[i]!, viewer, access);
    const cost = r.text === undefined ? 0 : bytes(r.text);
    if (used + cost > budget) return { expanded, left: parts.slice(i) };
    used += cost;
    expanded.push(r);
  }
  return { expanded, left: [] };
}
