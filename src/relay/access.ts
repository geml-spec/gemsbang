// Who may read a block (§5.1, §7.3): the owner reads everything of theirs
// (their agents as them); a person's and an agent's home pages are public, as is a share card (§11);
// a venue's blocks are its members' (a member's agent reads as the member);
// an agent's queue is the agent's and its owner's; anything else — a session
// record, a journal, a card's private range — only by a grant naming that
// one block for that one person, until the grant runs out. An embed resolves
// by the same rule (core/im/embed.ts): content for a reader, a stub for
// anyone else, nothing for an address this relay does not hold.
import { parseAddress } from "../core/im/address.js";
import type { DataBlock } from "../core/im/chain.js";
import type { Access } from "../core/im/embed.js";
import { parseSpeaker, personBehind } from "../core/im/identity.js";
import { canonical } from "../core/snapshot.js";

export interface BlockGrant { person: string; block: string; until?: string }

/** What the rule needs to know, answered by the relay. */
export interface World {
  /** The venue's members as speakers, or undefined when the document is no venue. */
  membersOf(owner: string, doc: string): string[] | undefined;
  grantsOf(owner: string): BlockGrant[];
  /** Whether the whole document is public: a share card (§11). A world without it answers nothing. */
  publicDoc?(owner: string, doc: string): boolean;
  now: string;
}

/** A document's first segment: `venues`, `people`, `queues`…; the whole name when it has no folder. */
export const kindOf = (doc: string): string => (doc.includes("/") ? doc.slice(0, doc.indexOf("/")) : doc);

export function canRead(o: { relay: string; owner: string; doc: string; block?: string; viewer: string }, w: World): boolean {
  const v = parseSpeaker(o.viewer);
  if (v === undefined || v.kind === "host") return false;
  const person = personBehind(v);
  if (person === o.owner) return true;
  const kind = kindOf(o.doc);
  if (kind === "people" || kind === "agents" || kind === "signals") return true;
  if (w.publicDoc?.(o.owner, o.doc) === true) return true;
  const members = w.membersOf(o.owner, o.doc);
  if (members !== undefined) return members.includes(o.viewer) || (person !== undefined && members.includes(`person:${person}`));
  if (kind === "queues") return o.viewer === `agent:${o.doc.slice("queues/".length, -".geml".length)}@${o.owner}`;
  if (o.block === undefined || person === undefined) return false;
  const address = `https://${o.relay}/${o.owner}/${o.doc}#${o.block}`;
  return w.grantsOf(o.owner).some((g) => g.person === person && g.block === address && (g.until === undefined || g.until > w.now));
}

/** A block's text as an embed shows it: a message's or an announce's text, else its canonical JSON. */
export const textOf = (b: DataBlock): string => (typeof b.value["text"] === "string" ? b.value["text"] : canonical(b.value));

/** The embed resolver for a viewer on this relay: `find` reads one block of a document the relay holds. */
export function accessFor(relay: string, w: World, find: (owner: string, doc: string, block: string) => DataBlock | undefined): Access {
  return (e, viewer) => {
    const a = parseAddress(e.src);
    if (a === undefined || a.relay !== relay || a.block === undefined) return undefined;
    const b = find(a.owner, a.doc, a.block);
    if (b === undefined) return undefined;
    const session = typeof b.value["session"] === "string" ? b.value["session"] : undefined;
    const turn = typeof b.value["turn"] === "string" ? b.value["turn"] : undefined;
    const extra = { ...(session !== undefined ? { session } : {}), ...(turn !== undefined ? { turn } : {}) };
    if (!canRead({ relay, owner: a.owner, doc: a.doc, block: a.block, viewer }, w)) return { denied: true, owner: a.owner, ...extra };
    return { text: textOf(b), hash: typeof b.value["hash"] === "string" ? b.value["hash"] : "", owner: a.owner, ...extra };
  };
}
