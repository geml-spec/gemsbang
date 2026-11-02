// Where the relay's documents live (architecture §2.3, §2.4): behind one
// interface, so the same relay runs on files (the Node shell, a company's own
// deployment, the tests), in memory, or on SQLite — a Durable Object's own
// (plan AA), or node:sqlite. A document is its data blocks in order, each
// sealed on the document's chain; an append is built from the document as it
// stands, under its lock where there are several writers, and a block whose
// id is already there is answered as it is (a client that sends again does
// not duplicate). A secret is made once and kept: the phone hashes' salt.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderDataBlock, type DataBlock } from "../core/chain.js";
import type { JsonValue } from "../core/json.js";
import { appendBlock, BLOCK_ID, docHead, lastHash, listDocs, readDoc, RELAY_OWNER, sealed, type Appended, type Doc } from "./store.js";

/** The whole value of a block, built from the document as it stands, the last block's hash and the id. */
export type Build = (d: Doc, prev: string | null, id: string) => Record<string, JsonValue>;

export interface DocStore {
  /** A document as it stands; one never written is there with no blocks. */
  read(owner: string, doc: string): Doc;
  /** One block appended, its id from `idOf`; a block of that id already there is answered as it is. */
  append(owner: string, doc: string, idOf: (d: Doc) => string, build: Build): Appended;
  /** The documents under `<owner>/<dir>/`, as doc paths, sorted. */
  list(owner: string, dir: string): string[];
  /** A secret made once by `make` and kept. */
  secret(name: string, make: () => string): string;
}

/** A block sealed on the document's chain under the id given. */
export const appendSealed = (s: DocStore, owner: string, doc: string, id: string, value: Record<string, JsonValue>): Appended =>
  s.append(owner, doc, () => id, (_d, prev) => sealed({ ...value, id }, prev));

/** Files under `root`, as the Node shell has always kept them: `<root>/<owner>/<doc>`, each append under the document's lock. */
export function fileStore(root: string): DocStore & { root: string } {
  return {
    root,
    read: (owner, doc) => readDoc(root, owner, doc),
    append: (owner, doc, idOf, build) => appendBlock(root, owner, doc, idOf, build),
    list: (owner, dir) => listDocs(root, owner, dir),
    secret: (name, make) => {
      const dir = join(root, RELAY_OWNER), path = join(dir, name);
      if (!existsSync(path)) {
        mkdirSync(dir, { recursive: true });
        try { writeFileSync(path, make(), { flag: "wx" }); } catch { /* another writer made it first */ }
      }
      return readFileSync(path, "utf8").trim();
    },
  };
}

/** The append the other stores share: the existing block answered as it is, else the value built on the chain and put. */
function appendTo(d: Doc, idOf: (d: Doc) => string, build: Build, put: (id: string, value: Record<string, JsonValue>) => void): Appended {
  const id = idOf(d);
  if (!BLOCK_ID.test(id)) throw new Error(`block id ${JSON.stringify(id)} is not one`);
  const existing = d.blocks.find((b) => b.id === id);
  if (existing !== undefined) return { block: existing, existed: true };
  const value = build(d, lastHash(d), id);
  put(id, value);
  return { block: { id, value }, existed: false };
}

const docOf = (owner: string, doc: string, blocks: DataBlock[]): Doc =>
  blocks.length === 0 ? { blocks: [], diagnostics: [], text: "", exists: false } : { blocks, diagnostics: [], text: docHead(owner, doc) + blocks.map((b) => renderDataBlock(b.id, b.value)).join(""), exists: true };

/** Is `doc` directly under `dir/`? */
const directlyUnder = (doc: string, dir: string): boolean => doc.startsWith(`${dir}/`) && !doc.slice(dir.length + 1).includes("/");

/** Everything in memory, gone when the process is: tests, and a relay that keeps nothing. */
export function memoryStore(): DocStore {
  const docs = new Map<string, DataBlock[]>();
  const secrets = new Map<string, string>();
  const key = (owner: string, doc: string): string => `${owner}\n${doc}`;
  const read = (owner: string, doc: string): Doc => docOf(owner, doc, [...(docs.get(key(owner, doc)) ?? [])]);
  return {
    read,
    append: (owner, doc, idOf, build) => appendTo(read(owner, doc), idOf, build, (id, value) => { docs.set(key(owner, doc), [...(docs.get(key(owner, doc)) ?? []), { id, value }]); }),
    list: (owner, dir) => [...docs.keys()].map((k) => k.split("\n")).filter(([o, d]) => o === owner && directlyUnder(d!, dir)).map(([, d]) => d!).sort(),
    secret: (name, make) => {
      if (!secrets.has(name)) secrets.set(name, make());
      return secrets.get(name)!;
    },
  };
}

/** The part of a SQL database a store needs: a Durable Object's `ctx.storage.sql` is one as it is, node:sqlite's `DatabaseSync` through `nodeSql`. */
export interface SqlLike { exec(query: string, ...bindings: (string | number | null)[]): { toArray(): Record<string, unknown>[] } }

/** node:sqlite's `DatabaseSync` as a `SqlLike`. */
export function nodeSql(db: { prepare(query: string): { all(...p: (string | number | null)[]): unknown[]; run(...p: (string | number | null)[]): unknown } }): SqlLike {
  return {
    exec: (query, ...bindings) => {
      const st = db.prepare(query);
      const rows = /^\s*select\b/i.test(query) ? (st.all(...bindings) as Record<string, unknown>[]) : (st.run(...bindings), []);
      return { toArray: () => rows };
    },
  };
}

/** SQLite: one row per block, in order per document, its value as JSON; one row per secret. A Durable Object runs one writer at a time, so no lock is taken. */
export function sqlStore(sql: SqlLike): DocStore {
  sql.exec("CREATE TABLE IF NOT EXISTS blocks (owner TEXT NOT NULL, doc TEXT NOT NULL, seq INTEGER NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (owner, doc, seq))");
  sql.exec("CREATE UNIQUE INDEX IF NOT EXISTS blocks_by_id ON blocks (owner, doc, id)");
  sql.exec("CREATE TABLE IF NOT EXISTS secrets (name TEXT PRIMARY KEY, value TEXT NOT NULL)");
  const read = (owner: string, doc: string): Doc =>
    docOf(owner, doc, sql.exec("SELECT id, value FROM blocks WHERE owner = ? AND doc = ? ORDER BY seq", owner, doc).toArray().map((r) => ({ id: String(r["id"]), value: JSON.parse(String(r["value"])) as Record<string, JsonValue> })));
  return {
    read,
    append: (owner, doc, idOf, build) => appendTo(read(owner, doc), idOf, build, (id, value) => {
      sql.exec("INSERT INTO blocks (owner, doc, seq, id, value) VALUES (?, ?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM blocks WHERE owner = ? AND doc = ?), ?, ?)", owner, doc, owner, doc, id, JSON.stringify(value));
    }),
    list: (owner, dir) => sql.exec("SELECT DISTINCT doc FROM blocks WHERE owner = ? AND substr(doc, 1, ?) = ?", owner, dir.length + 1, `${dir}/`).toArray().map((r) => String(r["doc"])).filter((d) => directlyUnder(d, dir)).sort(),
    secret: (name, make) => {
      const kept = sql.exec("SELECT value FROM secrets WHERE name = ?", name).toArray()[0];
      if (kept !== undefined) return String(kept["value"]);
      sql.exec("INSERT OR IGNORE INTO secrets (name, value) VALUES (?, ?)", name, make());
      return String(sql.exec("SELECT value FROM secrets WHERE name = ?", name).toArray()[0]!["value"]);
    },
  };
}
