import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultOptions, expiresIn, foldNeeds, NEED_KINDS, needFault, orderNeeds, wordsOf } from "../dist/core/avatar/needs.js";

const NOW = "2026-11-01T09:00:00Z";

test("the five kinds (spec §7.3): promise, pay, stance, borrow, error; a borrow's, an error's and money's options when the asker gives none, in the person's language; an ask's faults", () => {
  assert.deepEqual(NEED_KINDS, ["promise", "pay", "stance", "borrow", "error"]);
  assert.deepEqual(defaultOptions("borrow", "zh").map((o) => o.label), ["现在干", "排着", "不干"]);
  assert.deepEqual(defaultOptions("error", "en").map((o) => o.label), ["Why", "Retry"]);
  assert.deepEqual(defaultOptions("pay", "ja").map((o) => o.label), ["払う", "払わない"]);
  assert.deepEqual(defaultOptions("promise", "zh"), [], "a promise's options are the asker's, else only 自己写");
  assert.equal(needFault({ kind: "promise", summary: "王老师问周五能不能来当志愿者", options: [{ label: "能去", text: "周五我可以去" }] }, NOW), undefined);
  assert.deepEqual(needFault({ kind: "gossip", summary: "x" }, NOW), { code: "need.kind" });
  assert.deepEqual(needFault({ kind: "stance", summary: " " }, NOW), { code: "need.summary", params: { max: 400 } });
  assert.deepEqual(needFault({ kind: "stance", summary: "x", options: [] }, NOW), { code: "need.options", params: { max: 24 } });
  assert.deepEqual(needFault({ kind: "stance", summary: "x", options: [{ label: "一".repeat(25) }] }, NOW).code, "need.options");
  assert.deepEqual(needFault({ kind: "stance", summary: "x", options: [1, 2] }, NOW).code, "need.options");
  assert.deepEqual(needFault({ kind: "pay", summary: "x", draft: 3 }, NOW), { code: "need.draft", params: { max: 4000 } });
  assert.deepEqual(needFault({ kind: "pay", summary: "x", expires: "2026-11-01T08:00:00Z" }, NOW), { code: "need.expires" });
  assert.deepEqual(needFault({ kind: "pay", summary: "x", expires: "2026-11-09T09:00:00Z" }, NOW), { code: "need.expires" });
  assert.equal(needFault({ kind: "pay", summary: "x", expires: "2026-11-01T10:00:00Z" }, NOW), undefined);
});

test("order and folding (spec §7.1, §7.3; architecture §6.3): no clock of its own; errors first, then the newest, the expired last; two whole, more folded; the words an answer sends", () => {
  const n = (id, kind, at, state = "open") => ({ id, kind, at, state });
  assert.deepEqual(orderNeeds([n("a", "promise", "2026-11-01T08:00:00Z"), n("b", "error", "2026-11-01T07:00:00Z"), n("c", "pay", "2026-11-01T08:30:00Z"), n("d", "stance", "2026-11-01T08:45:00Z", "expired")]).map((x) => x.id), ["b", "c", "a", "d"]);
  assert.deepEqual(foldNeeds([1, 2]), { shown: [1, 2], folded: 0 });
  assert.deepEqual(foldNeeds([1, 2, 3, 4]), { shown: [1, 2], folded: 2 });
  assert.deepEqual(foldNeeds([1, 2, 3], true), { shown: [1, 2, 3], folded: 0 });
  assert.equal(expiresIn("2026-11-01T20:30:00Z", NOW, "zh"), "11 小时后过期");
  assert.equal(expiresIn("2026-11-01T09:22:10Z", NOW, "en"), "expires in 23 min");
  assert.equal(expiresIn("2026-11-01T09:00:00Z", NOW, "ja"), "期限切れ");
  const need = { options: [{ label: "能去", text: "周五我可以去，几点集合？" }, { label: "去不了", text: "这周五去不了，抱歉" }, { label: "现在干" }] };
  assert.equal(wordsOf(need, 0), "周五我可以去，几点集合？");
  assert.equal(wordsOf(need, 2), undefined, "an option that sends nothing");
  assert.equal(wordsOf(need, "own", "我下午三点到"), "我下午三点到");
  assert.equal(wordsOf(need, "own", "  "), undefined);
});
