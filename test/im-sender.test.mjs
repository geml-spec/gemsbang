import { test } from "node:test";
import assert from "node:assert/strict";
import { levelOf, LEVEL_WORDS, LEVEL_RANK, DEFAULT_SCOPES, DEFAULT_BUDGETS, scopeFor, decide, scopeWords, grantUntil, HOP_LIMIT, hopsOf, overHops, hopsSystemText, DEFAULT_DENSITY, densityAllows } from "../dist/core/im/sender.js";

const rel = { owner: "john", trusted: ["lisi"], members: ["zhangsan", "lisi"] };

test("a sender's level toward a target agent (§7.1); an agent takes its owner's level", () => {
  assert.equal(levelOf({ kind: "person", id: "john" }, rel), "owner");
  assert.equal(levelOf({ kind: "person", id: "lisi" }, rel), "trusted");
  assert.equal(levelOf({ kind: "person", id: "zhangsan" }, rel), "member");
  assert.equal(levelOf({ kind: "person", id: "wangwu" }, rel), "guest");
  assert.equal(levelOf({ kind: "agent", name: "xiaoce", owner: "zhangsan" }, rel), "member");
  assert.equal(levelOf({ kind: "agent", name: "xiaoping", owner: "john" }, rel), "owner");
  assert.equal(levelOf({ kind: "guest", id: "a1" }, rel), "guest");
  assert.equal(levelOf({ kind: "host" }, rel), "guest");
  assert.deepEqual(LEVEL_WORDS, { owner: "主人", trusted: "信任", member: "成员", guest: "访客" });
  assert.deepEqual(LEVEL_RANK, { owner: 0, trusted: 1, member: 2, guest: 3 });
});

test("the default scope matrix (§7.2), what each scope decides, and its words", () => {
  assert.deepEqual(DEFAULT_SCOPES.owner, { write: true, run: "workflow", budget: null });
  assert.deepEqual(DEFAULT_SCOPES.trusted, { write: false, run: "sandbox", budget: DEFAULT_BUDGETS.trusted });
  assert.deepEqual(DEFAULT_SCOPES.member, { write: false, run: "none", budget: DEFAULT_BUDGETS.member });
  assert.deepEqual(DEFAULT_SCOPES.guest, { write: false, run: "none", budget: DEFAULT_BUDGETS.guest });
  assert.ok(DEFAULT_BUDGETS.guest < DEFAULT_BUDGETS.member && DEFAULT_BUDGETS.member < DEFAULT_BUDGETS.trusted);
  for (const level of ["owner", "trusted", "member", "guest"]) {
    assert.equal(decide(DEFAULT_SCOPES[level], "read"), "allow", level);
    assert.equal(decide(DEFAULT_SCOPES[level], "answer"), "allow", level);
  }
  assert.equal(decide(DEFAULT_SCOPES.owner, "write"), "allow");
  assert.equal(decide(DEFAULT_SCOPES.owner, "run"), "allow");
  assert.equal(decide(DEFAULT_SCOPES.trusted, "write"), "refuse");
  assert.equal(decide(DEFAULT_SCOPES.trusted, "run"), "sandbox");
  assert.equal(decide(DEFAULT_SCOPES.member, "run"), "refuse");
  assert.equal(decide(DEFAULT_SCOPES.guest, "write"), "refuse");
  assert.equal(scopeWords(DEFAULT_SCOPES.owner), "工作流允许的一切");
  assert.equal(scopeWords(DEFAULT_SCOPES.trusted), "读、在沙箱里跑");
  assert.equal(scopeWords(DEFAULT_SCOPES.member), "只读");
  assert.equal(scopeWords(DEFAULT_SCOPES.guest), "只读");
});

test("scopeFor: a grant to this person or this venue widens, never narrows, and expires (§7.3)", () => {
  const now = "2026-10-30T10:00:00Z";
  const grants = [
    { to: { person: "zhangsan" }, widen: { run: "sandbox" }, at: "2026-10-29T10:00:00Z", until: "2026-11-05T10:00:00Z" },
    { to: { venue: "g-7" }, widen: { budget: 50 }, at: now },
    { to: { person: "lisi" }, widen: { write: true }, at: "2026-10-01T00:00:00Z", until: "2026-10-08T00:00:00Z" },
    { to: { person: "wangwu" }, widen: { run: "none", budget: 0 }, at: now },
  ];
  assert.deepEqual(scopeFor("member", { person: "zhangsan", venue: "g-9", grants, now }), { write: false, run: "sandbox", budget: DEFAULT_BUDGETS.member });
  assert.deepEqual(scopeFor("member", { person: "wangwu", venue: "g-7", grants, now }), { write: false, run: "none", budget: 50 }, "a venue grant applies to everyone there; a grant cannot narrow");
  assert.deepEqual(scopeFor("trusted", { person: "lisi", venue: "g-7", grants, now }), { write: false, run: "sandbox", budget: Math.max(DEFAULT_BUDGETS.trusted, 50) }, "an expired grant counts for nothing");
  assert.deepEqual(scopeFor("owner", { person: "john", venue: "g-7", grants, now }), { write: true, run: "workflow", budget: null });
  assert.deepEqual(scopeFor("guest", { budgets: { guest: 2 }, now }), { write: false, run: "none", budget: 2 });
  assert.equal(grantUntil("2026-10-30T10:00:00Z"), "2026-11-06T10:00:00Z");
  assert.equal(grantUntil("2026-10-30T10:00:00Z", 1), "2026-10-31T10:00:00Z");
});

test("hops (§7.4): a person's prompt is hop 0, an agent handling hop n raises hop n+1, above the limit it degrades", () => {
  assert.equal(HOP_LIMIT, 3);
  assert.equal(hopsOf(undefined), 0);
  assert.equal(hopsOf(0), 1);
  assert.equal(hopsOf(2), 3);
  assert.equal(overHops(3), false);
  assert.equal(overHops(4), true);
  assert.equal(overHops(2, 1), true);
  assert.equal(hopsSystemText("小评", 4, 3), "给 小评 的指令是第 4 跳，超过上限 3 跳，按普通消息投递，没有进它的队列");
});

test("bot density (§7.4): the venue's and the agent's per-minute caps; people and old messages do not count", () => {
  const at = (s) => `2026-10-30T10:00:${String(s).padStart(2, "0")}Z`;
  const six = [...Array(6)].map((_, i) => ({ speaker: "agent:xiaoping@john", at: at(i) }));
  const recent = [...six, { speaker: "person:john", at: at(7) }];
  assert.deepEqual(DEFAULT_DENSITY, { venuePerMinute: 30, agentPerMinute: 6 });
  assert.deepEqual(densityAllows(recent, "agent:xiaoping@john", at(30), DEFAULT_DENSITY), { ok: false, reason: "xiaoping 每分钟最多 6 条，已满" });
  assert.deepEqual(densityAllows(recent, "agent:xiaoce@zhangsan", at(30), DEFAULT_DENSITY), { ok: true });
  assert.deepEqual(densityAllows(recent, "agent:xiaoping@john", "2026-10-30T10:02:00Z", DEFAULT_DENSITY), { ok: true });
  const crowd = [...Array(30)].map((_, i) => ({ speaker: `agent:a${i}@p${i}`, at: at(10) }));
  assert.deepEqual(densityAllows(crowd, "agent:xiaoping@john", at(30), DEFAULT_DENSITY), { ok: false, reason: "这个场所每分钟最多 30 条 agent 消息，已满" });
  assert.deepEqual(densityAllows(crowd, "agent:xiaoping@john", at(30), { venuePerMinute: 31, agentPerMinute: 6 }), { ok: true });
});
