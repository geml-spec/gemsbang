import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAddress, formatAddress, mirrorRelPath, sameDocument } from "../dist/core/im/address.js";
import { isPinned, resolveEmbed, expandEmbeds } from "../dist/core/im/embed.js";

test("parseAddress reads relay, owner, document and block; formatAddress gives the text back", () => {
  const a = parseAddress("https://relay.example/john/journals/t-42.geml#rev-14");
  assert.deepEqual(a, { relay: "relay.example", owner: "john", doc: "journals/t-42.geml", block: "rev-14" });
  assert.equal(formatAddress(a), "https://relay.example/john/journals/t-42.geml#rev-14");
  assert.deepEqual(parseAddress("https://relay.example:8443/john/venues/g-7.geml"), { relay: "relay.example:8443", owner: "john", doc: "venues/g-7.geml" });
  assert.equal(formatAddress({ relay: "r", owner: "o", doc: "d.geml" }), "https://r/o/d.geml");
});

test("parseAddress refuses what is not an address", () => {
  for (const bad of ["http://relay.example/john/d.geml", "https://relay.example/john/d.md", "https://relay.example/d.geml", "https://relay.example/john/../x/d.geml", "https://relay.example/john/d.geml#a#b", "relay.example/john/d.geml", ""]) {
    assert.equal(parseAddress(bad), undefined, bad);
  }
});

test("mirrorRelPath keeps the relay's host as a folder, a port with an underscore, with / separators", () => {
  assert.equal(mirrorRelPath(parseAddress("https://relay.example/john/venues/g-7.geml#m-1")), "relay.example/john/venues/g-7.geml");
  assert.equal(mirrorRelPath(parseAddress("https://relay.example:8443/john/d.geml")), "relay.example_8443/john/d.geml");
});

test("sameDocument ignores the block", () => {
  const a = parseAddress("https://r/o/d.geml#x"), b = parseAddress("https://r/o/d.geml#y"), c = parseAddress("https://r/o/e.geml#x");
  assert.equal(sameDocument(a, b), true);
  assert.equal(sameDocument(a, c), false);
});

test("an embed is pinned by rev or hash, live otherwise", () => {
  assert.equal(isPinned({ src: "https://r/o/d.geml#m-1" }), false);
  assert.equal(isPinned({ src: "https://r/o/j.geml#rev-14", rev: 14 }), true);
  assert.equal(isPinned({ src: "https://r/o/d.geml#m-1", hash: "sha256:ab" }), true);
});

const store = {
  "https://r/john/venues/g-7.geml#m-1": { text: "测试跑完了", hash: "sha256:aaaa", owner: "john", readers: ["john", "zhangsan"] },
  "https://r/john/sessions/cc-7f3a.geml#turn-12": { text: "（会话记录）", hash: "sha256:bbbb", owner: "john", readers: ["john"], session: "cc-7f3a", turn: "12" },
};
const access = (e, viewer) => {
  const row = store[e.src];
  if (!row) return undefined;
  if (!row.readers.includes(viewer)) return { denied: true, owner: row.owner, session: row.session, turn: row.turn };
  return { text: row.text, hash: row.hash, owner: row.owner };
};

test("resolveEmbed: the content for a reader, a stub for anyone else, a fault for a missing block", () => {
  const e = { src: "https://r/john/venues/g-7.geml#m-1" };
  assert.deepEqual(resolveEmbed(e, "zhangsan", access), { embed: e, text: "测试跑完了" });
  const s = resolveEmbed({ src: "https://r/john/sessions/cc-7f3a.geml#turn-12" }, "zhangsan", access);
  assert.deepEqual(s.stub, { from: "john", session: "cc-7f3a", turn: "12", note: "你看不到", action: "申请看" });
  assert.equal(s.text, undefined);
  assert.equal(resolveEmbed({ src: "https://r/john/venues/g-7.geml#m-9" }, "john", access).fault, "找不到");
  assert.equal(resolveEmbed({ src: "not an address" }, "john", access).fault, "不是地址");
});

test("a pinned embed whose hash no longer matches is a fault, not content", () => {
  const ok = resolveEmbed({ src: "https://r/john/venues/g-7.geml#m-1", hash: "sha256:aaaa" }, "john", access);
  assert.equal(ok.text, "测试跑完了");
  const moved = resolveEmbed({ src: "https://r/john/venues/g-7.geml#m-1", hash: "sha256:9999" }, "john", access);
  assert.equal(moved.text, undefined);
  assert.equal(moved.fault, "钉住的块已变：哈希不符");
});

test("expandEmbeds stops at the byte budget and leaves the rest as addresses", () => {
  const parts = [{ src: "https://r/john/venues/g-7.geml#m-1" }, { src: "https://r/john/sessions/cc-7f3a.geml#turn-12" }, { src: "https://r/john/venues/g-7.geml#m-1" }];
  const all = expandEmbeds(parts, "john", access, 16384);
  assert.equal(all.expanded.length, 3);
  assert.deepEqual(all.left, []);
  const tight = expandEmbeds(parts, "john", access, 20); // 测试跑完了 is 15 bytes; the next one does not fit
  assert.equal(tight.expanded.length, 1);
  assert.deepEqual(tight.left, parts.slice(1));
  const stubbed = expandEmbeds(parts, "zhangsan", access, 16384);
  assert.equal(stubbed.expanded[1].stub.note, "你看不到");
});
