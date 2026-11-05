import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "@geml/geml";
import { hashOf, seal, normalizeText, renderDataBlock, readDataBlocks, verifyChain } from "../dist/core/chain.js";

test("seal chains a block onto the previous hash; hashOf ignores key order and the hash itself", () => {
  const a = seal({ text: "一", at: "2026-10-30T09:00:00Z" }, null);
  assert.equal(a.prev, null);
  assert.match(a.hash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(hashOf({ at: "2026-10-30T09:00:00Z", text: "一", prev: null }), a.hash);
  assert.equal(hashOf(a), a.hash);
  const b = seal({ text: "二" }, a.hash);
  assert.equal(b.prev, a.hash);
  assert.notEqual(b.hash, a.hash);
});

test("normalizeText: CRLF becomes LF, trailing blanks and trailing newlines go, the rest stays", () => {
  assert.equal(normalizeText("a \r\nb\t\r\n\r\n"), "a\nb");
  assert.equal(normalizeText("中文\n"), "中文");
  assert.equal(normalizeText("  缩进保留\n  第二行"), "  缩进保留\n  第二行");
});

test("renderDataBlock and readDataBlocks round-trip as clean, LF-only GEML", () => {
  const a = seal({ text: "一" }, null), b = seal({ text: "二" }, a.hash);
  const text = renderDataBlock("m-1", a) + renderDataBlock("m-2", b);
  assert.deepEqual(parse(text).diagnostics, []);
  assert.ok(!text.includes("\r"));
  const { blocks, diagnostics } = readDataBlocks(text);
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(blocks, [{ id: "m-1", value: a }, { id: "m-2", value: b }]);
});

test("readDataBlocks skips blocks that are not data and reports a value that is not an object", () => {
  const text = '=== meta\ntitle = "x"\n===\n\n=== data {#n format=json}\n[1,2]\n===\n\n=== data {#ok format=json}\n{"a":1}\n===\n';
  const { blocks, diagnostics } = readDataBlocks(text);
  assert.deepEqual(blocks, [{ id: "ok", value: { a: 1 } }]);
  assert.deepEqual(diagnostics, ["#n: not a JSON object"]);
});

test("verifyChain: a tampered value, a broken prev, a missing hash", () => {
  const a = seal({ text: "一" }, null), b = seal({ text: "二" }, a.hash), c = seal({ text: "三" }, b.hash);
  assert.deepEqual(verifyChain([{ id: "a", value: a }, { id: "b", value: b }, { id: "c", value: c }]), []);
  assert.deepEqual(verifyChain([{ id: "a", value: a }, { id: "b", value: { ...b, text: "编辑" } }]), ["#b: hash does not match"]);
  assert.deepEqual(verifyChain([{ id: "a", value: a }, { id: "c", value: c }]), ["#c: prev does not name the block before it"]);
  assert.deepEqual(verifyChain([{ id: "a", value: { text: "一", prev: null } }]), ["#a: no hash"]);
  assert.deepEqual(verifyChain([]), []);
});
