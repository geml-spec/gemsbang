import { test } from "node:test";
import assert from "node:assert/strict";
import { shareFaults, shareInput, readShare, byline, summaryTag, rangeWords, useLine, guestHeader, agentBadge, scopeLine, quotaOf, sameDay, DEFAULT_GUEST_QUOTA, QUOTA_WORDS } from "../dist/core/im/share.js";

const BODY = { title: " 设置页导出 PDF，能跑的 ", summary: "今天把设置页的缓存写路径修好了，顺手补了导出 PDF。", summarySource: "drafted", agent: "xiaoping", turns: 63, demo: "https://x.test/demo.mp4", open: "https://x.test/app/", replay: [{ turn: 1, label: "读代码" }, { turn: 14, label: "计划", src: "https://relay.test/john/journals/t-42.geml#rev-3" }], scope: "src/settings/* 和这 63 轮的记录", evidence: ["npm test 退出 0 · 598 条", "out/*.pdf 存在"], use: { repo: "deliver/t-42", commit: "a1b2c3", license: "MIT", ai: "AI 生成，人审过" } };

test("faults: what a card must have, and the limits", () => {
  assert.deepEqual(shareFaults(BODY), []);
  assert.deepEqual(shareFaults("x"), ["要一个 JSON 对象"]);
  assert.deepEqual(shareFaults({}), ["缺标题", "缺 agent 的名字", "缺公开范围"]);
  assert.deepEqual(shareFaults({ ...BODY, title: "x".repeat(201) }), ["标题最多 200 字"]);
  assert.deepEqual(shareFaults({ ...BODY, scope: "x".repeat(501), summary: "y".repeat(1001), summarySource: "nope", turns: -1, demo: "ftp://x", replay: [{ turn: 0, label: "" }], use: 3 }), ["公开范围最多 500 字", "一句话最多 1000 字", "一句话的来源是 self 或 drafted", "轮数要是非负整数", "demo 要是 http(s) 地址", "回放的每一项要有轮次（正整数）和标签", "拿去用要是对象"]);
  assert.deepEqual(shareFaults({ ...BODY, replay: "x" }), ["回放要是数组"]);
  assert.deepEqual(shareFaults({ ...BODY, replay: Array.from({ length: 13 }, (_, i) => ({ turn: i + 1, label: "x" })) }), ["回放最多 12 个里程碑"]);
});

test("the record: trimmed, defaults filled, nothing else kept; read back from a block by the document's id", () => {
  assert.deepEqual(shareInput(BODY), { title: "设置页导出 PDF，能跑的", summary: "今天把设置页的缓存写路径修好了，顺手补了导出 PDF。", summarySource: "drafted", agent: "xiaoping", turns: 63, demo: "https://x.test/demo.mp4", open: "https://x.test/app/", replay: [{ turn: 1, label: "读代码" }, { turn: 14, label: "计划", src: "https://relay.test/john/journals/t-42.geml#rev-3" }], scope: "src/settings/* 和这 63 轮的记录", evidence: ["npm test 退出 0 · 598 条", "out/*.pdf 存在"], use: { repo: "deliver/t-42", commit: "a1b2c3", license: "MIT", ai: "AI 生成，人审过" } });
  assert.deepEqual(shareInput({ title: "t", agent: "a", scope: "s", extra: 1 }), { title: "t", summary: "", summarySource: "self", agent: "a", replay: [], scope: "s", evidence: [], use: {} });
  assert.equal(shareInput({}), undefined);
  const card = readShare({ kind: "share", public: true, at: "2026-10-30T09:00:00Z", ...BODY, id: "card" }, "c-7f3a");
  assert.deepEqual([card.kind, card.id, card.public, card.at, card.title], ["share", "c-7f3a", true, "2026-10-30T09:00:00Z", "设置页导出 PDF，能跑的"]);
  assert.equal(readShare({ kind: "task", public: true, at: "x", ...BODY }, "c-1"), undefined);
  assert.equal(readShare({ kind: "share", public: false, at: "x", ...BODY }, "c-1"), undefined);
  assert.equal(readShare({ kind: "share", public: true, ...BODY }, "c-1"), undefined, "no time, no card");
});

test("the words the page and the board show, as the mockup has them", () => {
  const card = readShare({ kind: "share", public: true, at: "2026-10-30T09:00:00Z", ...BODY }, "c-7f3a");
  assert.equal(byline(card, "John"), "John 的作品 · xiaoping 做的 · 63 轮 · 2026-10-30 · 有凭据");
  assert.equal(byline({ ...card, turns: undefined, evidence: [] }, "John"), "John 的作品 · xiaoping 做的 · 2026-10-30");
  assert.equal(summaryTag(card, "John"), "xiaoping 起草 · John 改过");
  assert.equal(summaryTag({ ...card, summarySource: "self" }, "John"), undefined);
  assert.equal(rangeWords(card), "src/settings/* 和这 63 轮的记录 · 其余不在此，xiaoping 不会讲");
  assert.equal(useLine(card), "仓库 deliver/t-42 @ a1b2c3 · 许可：MIT · AI 生成，人审过");
  assert.equal(useLine({ ...card, use: {} }), undefined);
  assert.equal(useLine({ ...card, use: { repo: "r" } }), "仓库 r");
  assert.equal(guestHeader(3, "John"), "你是访客，不用注册 · 今天还能问 3 句 · 这几句的 token John 请客");
  assert.equal(agentBadge("xiaoping", "John"), "xiaoping · 代 John · 只讲公开范围内的");
  assert.equal(scopeLine("src/settings/*"), "[公开范围：src/settings/*；不在范围内的明说不讲，请访客给主人留言]");
});

test("the guest quota: defaults, a body's positive integers, the day", () => {
  assert.deepEqual(DEFAULT_GUEST_QUOTA, { perDay: 50, perGuestPerDay: 3, perIpPerDay: 20 });
  assert.deepEqual(quotaOf(undefined), DEFAULT_GUEST_QUOTA);
  assert.deepEqual(quotaOf({ perDay: 1, perGuestPerDay: 0, perIpPerDay: "x" }), { perDay: 1, perGuestPerDay: 3, perIpPerDay: 20 });
  assert.equal(sameDay("2026-10-31T23:59:59Z", "2026-10-31T00:00:00Z"), true);
  assert.equal(sameDay("2026-10-31T23:59:59Z", "2026-11-01T00:00:00Z"), false);
  assert.deepEqual(Object.keys(QUOTA_WORDS), ["owner", "guest", "ip"]);
});
