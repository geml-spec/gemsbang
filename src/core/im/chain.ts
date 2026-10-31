// Every IM document is a GEML document of `=== data {#id format=json}`
// blocks, one canonical JSON line each, chained the way the journal's
// revisions are (transport spec §2.2): a block's `hash` is the sha256 of its
// canonical JSON without `hash`, `prev` is the hash of the block before it in
// the same document, the first block's `prev` is null. Canonical JSON is one
// line with sorted keys, so CRLF on disk cannot change a hash; prose inside a
// block is normalized before it is sealed. Pure: text in, blocks and faults
// out; the hosts read and write the files.
import { createHash } from "node:crypto";
import { parse } from "@geml/geml";
import { canonical } from "../snapshot.js";
import type { JsonValue } from "../schema.js";

export interface Chained { prev: string | null; hash: string }

/** The sha256 of the value's canonical JSON, `hash` left out. */
export function hashOf(value: Record<string, JsonValue>): string {
  const { hash: _hash, ...rest } = value;
  return "sha256:" + createHash("sha256").update(canonical(rest), "utf8").digest("hex");
}

/** The value as a block on the chain: `prev` set, `hash` computed over everything else. */
export function seal<T extends Record<string, JsonValue>>(value: T, prev: string | null): T & Chained {
  const withPrev = { ...value, prev };
  return { ...withPrev, hash: hashOf(withPrev) };
}

/** Prose as it is sealed: LF line ends, no trailing blanks on a line, no trailing newlines. */
export function normalizeText(text: string): string {
  return text.replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/[ \t]+$/, "")).join("\n").replace(/\n+$/, "");
}

export function renderDataBlock(id: string, value: JsonValue): string {
  return `=== data {#${id} format=json}\n${canonical(value)}\n===\n\n`;
}

export interface DataBlock { id: string; value: Record<string, JsonValue> }

const isObject = (v: unknown): v is Record<string, JsonValue> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The document's data blocks with ids, in order; a parse error or a value that is not an object is a diagnostic. */
export function readDataBlocks(source: string): { blocks: DataBlock[]; diagnostics: string[] } {
  const doc = parse(source);
  const diagnostics = doc.diagnostics.filter((d) => d.severity === "error").map((d) => `line ${d.line}: ${d.message}`);
  const blocks: DataBlock[] = [];
  for (const b of doc.children) {
    if (b.kind !== "block" || b.type !== "data" || b.id === undefined) continue;
    if (!isObject(b.value)) { diagnostics.push(`#${b.id}: not a JSON object`); continue; }
    blocks.push({ id: b.id, value: b.value });
  }
  return { blocks, diagnostics };
}

/** The chain's faults, in order: a block without a hash, a hash that does not match its block, a prev that does not name the block before it. */
export function verifyChain(blocks: readonly DataBlock[]): string[] {
  const out: string[] = [];
  let last: string | null = null;
  for (const b of blocks) {
    const v = b.value;
    const hash = v["hash"];
    if (typeof hash !== "string") { out.push(`#${b.id}: no hash`); last = null; continue; }
    if (hashOf(v) !== hash) out.push(`#${b.id}: hash does not match`);
    if ((v["prev"] ?? null) !== last) out.push(`#${b.id}: prev does not name the block before it`);
    last = hash;
  }
  return out;
}
