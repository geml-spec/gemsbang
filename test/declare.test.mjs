import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_DECLARATION, declarationLines, declarationOf, eligibilityWords, hoursOf, hoursString, hoursWords, waitingForSession, withinHours } from "../dist/core/im/declare.js";

test("the declaration (§9.2): closed by default; a body's fields over the current, the rest kept; the hours as 'HH:MM-HH:MM' with a zone", () => {
  assert.deepEqual(DEFAULT_DECLARATION, { open: false, kinds: [], skills: [], network: false });
  assert.deepEqual(declarationOf({ open: true, hours: "22:00-08:00+08:00", budget: 200000, kinds: ["评审", "测试"], skills: ["pdf"], network: true }), { open: true, hours: { from: "22:00", to: "08:00", tz: "+08:00" }, budget: 200000, kinds: ["评审", "测试"], skills: ["pdf"], network: true });
  assert.deepEqual(declarationOf({ open: "yes", budget: -1, kinds: "x" }), DEFAULT_DECLARATION, "bad values fall to the defaults");
  assert.deepEqual(declarationOf({ open: true, hours: "22:00-08:00+08:00" }, declarationOf({ budget: 5, kinds: ["a"] })), { open: true, hours: { from: "22:00", to: "08:00", tz: "+08:00" }, budget: 5, kinds: ["a"], skills: [], network: false }, "over the current");
  assert.deepEqual(declarationOf({ hours: null }, declarationOf({ hours: "22:00-08:00+08:00" })), DEFAULT_DECLARATION, "null clears the hours");
  assert.deepEqual([hoursOf("22:00-08:00+08:00"), hoursOf("9:00-17:30Z"), hoursOf("22:00-08:00"), hoursOf("x"), hoursOf(3)], [{ from: "22:00", to: "08:00", tz: "+08:00" }, { from: "09:00", to: "17:30", tz: "Z" }, undefined, undefined, undefined]);
});

test("within the hours: by the zone's wall clock, a span over midnight too", () => {
  const night = hoursOf("22:00-08:00+08:00");
  assert.equal(withinHours("2026-10-31T15:00:00Z", night), true, "23:00 in +08:00");
  assert.equal(withinHours("2026-10-31T23:30:00Z", night), true, "07:30 in +08:00");
  assert.equal(withinHours("2026-10-31T04:00:00Z", night), false, "12:00 in +08:00");
  assert.equal(withinHours("2026-10-31T00:00:00Z", night), false, "08:00 is the end");
  assert.equal(withinHours("2026-10-31T14:00:00Z", night), true, "22:00 is the start");
  const day = hoursOf("09:00-17:30Z");
  assert.deepEqual([withinHours("2026-10-31T09:00:00Z", day), withinHours("2026-10-31T17:29:00Z", day), withinHours("2026-10-31T17:30:00Z", day)], [true, true, false]);
  assert.equal(withinHours("2026-10-31T09:00:00Z", undefined), true, "no hours: always");
});

test("the words: the hours, the eligibility the host reports, the four lines of the declaration, what a card waits for", () => {
  assert.equal(hoursWords(hoursOf("22:00-08:00+08:00")), "每天 22:00 到 08:00");
  assert.equal(hoursString(hoursOf("9:00-17:30Z")), "09:00-17:30Z");
  assert.deepEqual([eligibilityWords([], false), eligibilityWords(["subscription"], false), eligibilityWords(["subscription", "api"], false), eligibilityWords(["self-hosted"], false), eligibilityWords([], true)], ["还没有会话", "只有订阅登录的会话 · 不显示接单入口", "API 会话 · 有资格", "自托管会话 · 有资格", "托管 · 天然有资格"]);
  const d = declarationOf({ open: true, hours: "22:00-08:00+08:00", budget: 200000, kinds: ["评审"], skills: ["pdf", "ui"], network: true });
  assert.deepEqual(declarationLines(d, "API 会话 · 有资格"), ["资格：API 会话 · 有资格", "时段：每天 22:00 到 08:00 · 主人睡了之后", "预算：每天 200000 token · 推理走平台池", "接什么：评审 · skill pdf、ui · 可联网"]);
  assert.deepEqual(declarationLines(DEFAULT_DECLARATION, "还没有会话"), ["资格：还没有会话", "时段：随时", "预算：不限", "接什么：没说 · 不联网", "接单模式：关"]);
  assert.equal(waitingForSession(d), "等它有资格的会话 · 每天 22:00 到 08:00");
  assert.equal(waitingForSession(declarationOf({ open: true })), "等它有资格的会话");
  assert.equal(waitingForSession(DEFAULT_DECLARATION), "等主人开接单模式");
});
