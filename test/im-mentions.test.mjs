import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMentions, resolveCalls, mentionCandidates, CALL_HINT, NOTIFY_HINT } from "../dist/core/im/mentions.js";

const roster = [{ name: "小评", kind: "agent" }, { name: "小测", kind: "agent" }, { name: "张三", kind: "person" }, { name: "空闲的", kind: "role" }, { name: "审稿人", kind: "role" }];
const none = { calls: [], mentions: [], notified: [], unknown: [] };

test("a leading @ calls the agent; an @ in the middle only mentions it (§6.4)", () => {
  assert.deepEqual(parseMentions("@小评 看看这个 PR", roster), { ...none, calls: ["小评"] });
  assert.deepEqual(parseMentions("这个 PR 让 @小评 看过了", roster), { ...none, mentions: ["小评"] });
  assert.deepEqual(parseMentions("@小评：看看", roster), { ...none, calls: ["小评"] });
});

test("a run of leading names is a broadcast, each called once; commas may separate them", () => {
  assert.deepEqual(parseMentions("@小评 @小测 跑一下测试", roster).calls, ["小评", "小测"]);
  assert.deepEqual(parseMentions("@小评，@小测：跑一下", roster).calls, ["小评", "小测"]);
  assert.deepEqual(parseMentions("@小评 @小评 两遍", roster).calls, ["小评"]);
  assert.deepEqual(parseMentions("@小评 然后 @小测 也看看", roster), { ...none, calls: ["小评"], mentions: ["小测"] });
});

test("people and 所有人 only notify, wherever they stand; a role at the start calls; a name nobody has is unknown", () => {
  assert.deepEqual(parseMentions("@张三 @小评 看看", roster), { ...none, calls: ["小评"], notified: ["张三"] });
  assert.deepEqual(parseMentions("@所有人 下午三点开会", roster), { ...none, notified: ["所有人"] });
  assert.deepEqual(parseMentions("@空闲的 跑一下测试", roster), { ...none, calls: ["空闲的"] });
  assert.deepEqual(parseMentions("@路人 你好", roster), { ...none, unknown: ["路人"] });
});

test("no @, an e-mail address, a lone @: nobody", () => {
  assert.deepEqual(parseMentions("今天没事", roster), none);
  assert.deepEqual(parseMentions("发到 john@example.com", roster), none);
  assert.deepEqual(parseMentions("@ 小评", roster), none);
});

test("roles resolve to one agent and the resolution is written back; an unresolved role is reported", () => {
  const resolve = (role) => (role === "空闲的" ? "小测" : undefined);
  assert.deepEqual(resolveCalls(["小评", "空闲的", "审稿人"], roster, resolve), {
    calls: [{ name: "小评", call: true }, { name: "空闲的", call: true, resolved: "小测" }],
    unresolved: ["审稿人"],
  });
});

test("the popover lists agents with presence and the hint, roles with how they resolve, people as notify-only", () => {
  const presence = { "小评": "空闲", "小测": "跑工具 40 秒" };
  const rows = mentionCandidates(roster, "小", (n) => presence[n], (r) => `解析成${r}`);
  assert.deepEqual(rows, [
    { name: "小评", kind: "agent", presence: "空闲", hint: CALL_HINT },
    { name: "小测", kind: "agent", presence: "跑工具 40 秒", hint: CALL_HINT },
  ]);
  assert.deepEqual(mentionCandidates(roster, "", () => undefined, (r) => `解析成${r}`).map((c) => c.hint), [CALL_HINT, CALL_HINT, NOTIFY_HINT, "解析成空闲的", "解析成审稿人"]);
  assert.equal(CALL_HINT, "在句首 = 叫它干活");
});
