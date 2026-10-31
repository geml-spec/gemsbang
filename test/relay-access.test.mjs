import { test } from "node:test";
import assert from "node:assert/strict";
import { accessFor, canRead, kindOf, textOf } from "../dist/relay/access.js";

const NOW = "2026-10-31T09:00:00Z";
const world = {
  membersOf: (owner, doc) => (owner === "john" && doc === "venues/g-7.geml" ? ["person:john", "person:zhangsan", "agent:xiaoping@john", "guest:g-1"] : undefined),
  grantsOf: (owner) => (owner === "john" ? [{ person: "lisi", block: "https://r/john/sessions/cc-7f3a.geml#turn-12", until: "2026-11-07T09:00:00Z" }, { person: "wangwu", block: "https://r/john/sessions/cc-7f3a.geml#turn-12", until: "2026-10-30T00:00:00Z" }] : []),
  now: NOW,
};
const read = (doc, viewer, block) => canRead({ relay: "r", owner: "john", doc, viewer, ...(block === undefined ? {} : { block }) }, world);

test("the owner reads everything of theirs; home pages are public; a venue is its members'; a queue is its agent's", () => {
  assert.equal(read("sessions/cc-7f3a.geml", "person:john", "turn-12"), true);
  assert.equal(read("sessions/cc-7f3a.geml", "agent:xiaoping@john", "turn-12"), true, "the owner's agent reads as the owner");
  assert.equal(read("people/john.geml", "person:anyone"), true);
  assert.equal(read("agents/xiaoping.geml", "guest:g-9"), true);
  assert.equal(read("venues/g-7.geml", "person:zhangsan", "m-1"), true);
  assert.equal(read("venues/g-7.geml", "agent:xiaoce@zhangsan", "m-1"), true, "a member's agent reads the venue");
  assert.equal(read("venues/g-7.geml", "guest:g-1"), true);
  assert.equal(read("venues/g-7.geml", "person:lisi"), false);
  assert.equal(read("queues/xiaoping.geml", "agent:xiaoping@john"), true);
  assert.equal(read("queues/xiaoping.geml", "agent:other@john"), true, "the owner's other agent reads as the owner");
  assert.equal(read("queues/xiaoping.geml", "agent:xiaoce@zhangsan"), false);
  assert.equal(read("queues/xiaoping.geml", "person:zhangsan"), false);
  assert.equal(read("venues/g-7.geml", "host"), false);
  assert.equal(read("venues/g-7.geml", "nobody"), false);
});

test("a private block is read by a grant naming it for that person, until it runs out", () => {
  assert.equal(read("sessions/cc-7f3a.geml", "person:lisi", "turn-12"), true);
  assert.equal(read("sessions/cc-7f3a.geml", "agent:x@lisi", "turn-12"), true, "the grant covers the person's agents");
  assert.equal(read("sessions/cc-7f3a.geml", "person:lisi", "turn-13"), false, "one block, not the session");
  assert.equal(read("sessions/cc-7f3a.geml", "person:lisi"), false, "the document as a whole is not granted");
  assert.equal(read("sessions/cc-7f3a.geml", "person:wangwu", "turn-12"), false, "run out");
  assert.equal(read("sessions/cc-7f3a.geml", "guest:g-1", "turn-12"), false);
});

test("accessFor resolves an embed on this relay by the same rule: text for a reader, a stub for anyone else, nothing for what is not here", () => {
  const blocks = { "john/sessions/cc-7f3a.geml#turn-12": { id: "turn-12", value: { id: "turn-12", text: "（会话记录）", session: "cc-7f3a", turn: "12", hash: "sha256:bbbb" } }, "john/venues/g-7.geml#m-1": { id: "m-1", value: { id: "m-1", text: "测试跑完了", hash: "sha256:aaaa" } } };
  const access = accessFor("r", world, (owner, doc, block) => blocks[`${owner}/${doc}#${block}`]);
  assert.deepEqual(access({ src: "https://r/john/venues/g-7.geml#m-1" }, "person:zhangsan"), { text: "测试跑完了", hash: "sha256:aaaa", owner: "john" });
  assert.deepEqual(access({ src: "https://r/john/sessions/cc-7f3a.geml#turn-12" }, "person:zhangsan"), { denied: true, owner: "john", session: "cc-7f3a", turn: "12" });
  assert.deepEqual(access({ src: "https://r/john/sessions/cc-7f3a.geml#turn-12" }, "person:lisi"), { text: "（会话记录）", hash: "sha256:bbbb", owner: "john", session: "cc-7f3a", turn: "12" });
  assert.equal(access({ src: "https://r/john/venues/g-7.geml#m-9" }, "person:john"), undefined);
  assert.equal(access({ src: "https://elsewhere/john/venues/g-7.geml#m-1" }, "person:john"), undefined, "another relay: v1 is one relay");
  assert.equal(access({ src: "https://r/john/venues/g-7.geml" }, "person:john"), undefined, "no block named");
});

test("textOf and kindOf", () => {
  assert.equal(textOf({ id: "m", value: { text: "hi", x: 1 } }), "hi");
  assert.equal(textOf({ id: "m", value: { b: 1, a: [2] } }), '{"a":[2],"b":1}');
  assert.equal(kindOf("venues/g-7.geml"), "venues");
  assert.equal(kindOf("tokens.geml"), "tokens.geml");
});
