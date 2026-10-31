// An address on the relay (transport spec §2.3): `https://<relay>/<owner>/
// <doc>.geml#<block>`. An embed's `src=` is one; the daemon mirrors the
// document it names under `~/.gemworks/im/<relay>/<owner>/<doc>`. The relay's
// host stays in the address, so an embed across relays needs no other format.
// Pure: text in, parts out.

export interface Address {
  /** The relay's host, with its port when it has one: `relay.example`, `relay.example:8443`. */
  relay: string;
  owner: string;
  /** The document's path under the owner, `.geml` included: `venues/g-7.geml`. */
  doc: string;
  /** The block's id, without its `#`. */
  block?: string;
}

const SEGMENT = "[^/\\s#?]+";
const ADDRESS = new RegExp(`^https://(${SEGMENT})/(${SEGMENT})/((?:${SEGMENT}/)*${SEGMENT}\\.geml)(?:#([^\\s#]+))?$`);

/** The parts of an address, or undefined when the text is not one: another scheme, no owner, a document that is not `.geml`, a `.` or `..` segment, two `#`. */
export function parseAddress(text: string): Address | undefined {
  const m = ADDRESS.exec(text.trim());
  if (!m) return undefined;
  const relay = m[1]!, owner = m[2]!, doc = m[3]!, block = m[4];
  if ([owner, ...doc.split("/")].some((s) => s === "." || s === "..")) return undefined;
  const a: Address = { relay, owner, doc };
  if (block !== undefined) a.block = block;
  return a;
}

export function formatAddress(a: Address): string {
  return `https://${a.relay}/${a.owner}/${a.doc}${a.block === undefined ? "" : `#${a.block}`}`;
}

/**
 * Where the mirror keeps the document, relative to `~/.gemworks/im/`, with
 * `/` separators: the relay's host (a `:port` becomes `_port`, since a
 * Windows file name cannot hold a colon), then the owner, then the document.
 */
export function mirrorRelPath(a: Address): string {
  return `${a.relay.replace(/:/g, "_")}/${a.owner}/${a.doc}`;
}

export function sameDocument(a: Address, b: Address): boolean {
  return a.relay === b.relay && a.owner === b.owner && a.doc === b.doc;
}
