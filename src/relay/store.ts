// Documents on the relay's disk (transport §2.2): `<root>/<owner>/<doc>`,
// each a GEML document of data blocks (core/im/chain.ts) written by append
// under the document's lock, its head a meta block naming it. An append is
// built from the document as it stands — its blocks and the last block's
// hash — inside the lock, so a numbered block cannot collide with another
// writer's; a block whose id is already there is answered as it is and
// nothing is written (transport §2.5: a client that sends again does not
// duplicate). The relay's own records live under the owner `_relay`, which no
// person can be named.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { appendOrCreate, withLock } from "../host-fs.js";
import { readDataBlocks, renderDataBlock, seal, type DataBlock } from "../core/im/chain.js";
import type { JsonValue } from "../core/schema.js";

/** A document's path under its owner: `/`-separated names of letters, digits, `_` and `-`, ending in `.geml`. */
export const DOC = /^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.geml$/;
/** An owner, a venue or an agent as a client may name one: letters, digits, `_` and `-`, not beginning with `_` (the relay's own) or `.`, at most 64. */
export const NAME = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,63}$/u;
export const BLOCK_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/;
export const RELAY_OWNER = "_relay";

export const docPath = (root: string, owner: string, doc: string): string => join(root, owner, ...doc.split("/"));
export const docHead = (owner: string, doc: string): string => `=== meta\ntitle = "gemworks im ${owner}/${doc}"\n===\n\n`;

/** A document as read: its data blocks, the parse diagnostics, its text, whether it is there at all. */
export interface Doc { blocks: DataBlock[]; diagnostics: string[]; text: string; exists: boolean }

export function readDoc(root: string, owner: string, doc: string): Doc {
  const path = docPath(root, owner, doc);
  if (!existsSync(path)) return { blocks: [], diagnostics: [], text: "", exists: false };
  const text = readFileSync(path, "utf8");
  const { blocks, diagnostics } = readDataBlocks(text);
  return { blocks, diagnostics, text, exists: true };
}

export interface Appended { block: DataBlock; existed: boolean }

/** The hash of the document's last block, for the next one's `prev`; null when there is none or it has no hash. */
export function lastHash(d: Doc): string | null {
  const last = d.blocks[d.blocks.length - 1];
  return last !== undefined && typeof last.value["hash"] === "string" ? last.value["hash"] : null;
}

/**
 * Append one block, its id and its value built from the document as it
 * stands, under the document's lock. `idOf` names the block (a client's id,
 * or the next of a numbered kind, `nextId`); a block of that id already there
 * is answered as it is. `build` gets the document, the last block's hash and
 * the id, and returns the whole value.
 */
export function appendBlock(root: string, owner: string, doc: string, idOf: (d: Doc) => string, build: (d: Doc, prev: string | null, id: string) => Record<string, JsonValue>): Appended {
  const path = docPath(root, owner, doc);
  return withLock(path, () => {
    const d = readDoc(root, owner, doc);
    const id = idOf(d);
    if (!BLOCK_ID.test(id)) throw new Error(`block id ${JSON.stringify(id)} is not one`);
    const existing = d.blocks.find((b) => b.id === id);
    if (existing !== undefined) return { block: existing, existed: true };
    const value = build(d, lastHash(d), id);
    appendOrCreate(path, docHead(owner, doc), renderDataBlock(id, value));
    return { block: { id, value }, existed: false };
  });
}

/** The next id of a numbered kind, `<prefix>-<N>`: one past the blocks of exactly that kind. */
export function nextId(prefix: string): (d: Doc) => string {
  const own = new RegExp(`^${prefix}-\\d+$`);
  return (d) => `${prefix}-${d.blocks.filter((b) => own.test(b.id)).length + 1}`;
}

/** `seal` for a value typed as a record: the chain's two fields added, the record's type kept for the store. */
export const sealed = (value: Record<string, JsonValue>, prev: string | null): Record<string, JsonValue> => seal(value, prev) as Record<string, JsonValue>;

/** A block sealed on the document's chain (`prev` the last block's hash, `hash` over the rest, `id` inside), under the id given. */
export function appendSealed(root: string, owner: string, doc: string, id: string, value: Record<string, JsonValue>): Appended {
  return appendBlock(root, owner, doc, () => id, (_d, prev) => sealed({ ...value, id }, prev));
}

/** The documents under `<owner>/<dir>/`, as doc paths, sorted. */
export function listDocs(root: string, owner: string, dir: string): string[] {
  const at = join(root, owner, dir);
  if (!existsSync(at)) return [];
  return readdirSync(at).filter((n) => n.endsWith(".geml")).sort().map((n) => `${dir}/${n}`);
}

/** The owners with documents; the relay's own and hidden folders left out. */
export function listOwners(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith("_") && !e.name.startsWith(".")).map((e) => e.name).sort();
}
