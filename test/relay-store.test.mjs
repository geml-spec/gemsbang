import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendBlock, appendSealed, docPath, DOC, lastHash, listDocs, listOwners, NAME, nextId, readDoc } from "../dist/relay/store.js";
import { verifyChain } from "../dist/core/chain.js";

const root = () => mkdtempSync(join(tmpdir(), "gemsbang-relay-"));

test("appendSealed chains blocks in one document under a meta head; readDoc reads them back; the chain verifies", () => {
  const r = root();
  const a = appendSealed(r, "john", "venues/g-7.geml", "venue", { kind: "group", name: "前端周会" });
  const b = appendSealed(r, "john", "venues/g-7.geml", "member-1", { speaker: "person:zhangsan" });
  assert.equal(a.existed, false);
  assert.equal(a.block.value["prev"], null);
  assert.equal(b.block.value["prev"], a.block.value["hash"]);
  assert.equal(b.block.value["id"], "member-1", "the id is in the sealed value too");
  const d = readDoc(r, "john", "venues/g-7.geml");
  assert.equal(d.exists, true);
  assert.deepEqual(d.blocks.map((x) => x.id), ["venue", "member-1"]);
  assert.deepEqual(verifyChain(d.blocks), []);
  assert.match(d.text, /^=== meta\ntitle = "gemsbang john\/venues\/g-7.geml"\n===\n\n=== data \{#venue format=json\}/);
  assert.equal(docPath(r, "john", "venues/g-7.geml"), join(r, "john", "venues", "g-7.geml"));
  assert.equal(lastHash(d), b.block.value["hash"]);
  assert.deepEqual(readDoc(r, "john", "venues/none.geml"), { blocks: [], diagnostics: [], text: "", exists: false });
});

test("the same id again is answered as it stands and nothing is written", () => {
  const r = root();
  const a = appendSealed(r, "john", "people/john.geml", "person", { name: "John" });
  const size = statSync(docPath(r, "john", "people/john.geml")).size;
  const again = appendSealed(r, "john", "people/john.geml", "person", { name: "Someone else" });
  assert.equal(again.existed, true);
  assert.deepEqual(again.block, a.block);
  assert.equal(statSync(docPath(r, "john", "people/john.geml")).size, size);
});

test("appendBlock builds the id and the value inside the lock from the document as it stands; nextId numbers one kind only", () => {
  const r = root();
  for (let i = 0; i < 2; i++) appendBlock(r, "john", "queues/xiaoping.geml", nextId("read"), (d, prev, id) => ({ id, kind: "read", seen: d.blocks.length, prev }));
  appendBlock(r, "john", "queues/xiaoping.geml", nextId("answered"), (_d, _prev, id) => ({ id, kind: "answered" }));
  const third = appendBlock(r, "john", "queues/xiaoping.geml", nextId("read"), (d, prev, id) => ({ id, seen: d.blocks.length, prev }));
  assert.equal(third.block.id, "read-3");
  assert.equal(third.block.value["seen"], 3);
  assert.equal(third.block.value["prev"], null, "a value the builder does not seal carries what it was given: the last block has no hash");
  assert.deepEqual(readDoc(r, "john", "queues/xiaoping.geml").blocks.map((b) => b.id), ["read-1", "read-2", "answered-1", "read-3"]);
  assert.throws(() => appendBlock(r, "john", "x/y.geml", () => "bad id!", () => ({})), /block id "bad id!" is not one/);
});

test("listDocs lists an owner's documents of one kind; listOwners leaves the relay's own and hidden folders out", () => {
  const r = root();
  appendSealed(r, "john", "venues/b.geml", "venue", {});
  appendSealed(r, "john", "venues/a.geml", "venue", {});
  appendSealed(r, "john", "people/john.geml", "person", {});
  appendSealed(r, "_relay", "tokens.geml", "token-1", {});
  mkdirSync(join(r, ".hidden"));
  writeFileSync(join(r, "john", "venues", "notes.txt"), "x");
  assert.deepEqual(listDocs(r, "john", "venues"), ["venues/a.geml", "venues/b.geml"]);
  assert.deepEqual(listDocs(r, "john", "cards"), []);
  assert.deepEqual(listOwners(r), ["john"]);
  assert.deepEqual(listOwners(join(r, "nowhere")), []);
});

test("the names a client may use", () => {
  for (const ok of ["john", "张三", "a-b_c", "g7"]) assert.ok(NAME.test(ok), ok);
  for (const bad of ["_relay", ".x", "", "a/b", "a b", "x".repeat(65)]) assert.ok(!NAME.test(bad), bad);
  for (const ok of ["venues/g-7.geml", "people/john.geml", "a/b/c.geml"]) assert.ok(DOC.test(ok), ok);
  for (const bad of ["venues/g-7.md", "/venues/g.geml", "venues//g.geml", "venues/../g.geml", "g.geml/"]) assert.ok(!DOC.test(bad), bad);
});
