import { test } from "node:test";
import assert from "node:assert/strict";
import { cardFaults, cardInput, foldCard, moveFault, rolesOf, briefLines, briefText, progress, progressLine, cardLine, acceptTag, rerunNote, waitingOn, acceptance, openSlots, splitFault, scopeOfCard, isStale, heartbeatWords, toolWords, STATE_WORDS, MAIN_PATH } from "../dist/core/im/card.js";

const INPUT = {
  title: "给设置页加导出 PDF", goal: "设置页右上角一个按钮，把当前配置导出成 PDF",
  context: { includes: ["https://relay.test/john/journals/t-42.geml#rev-3", "https://relay.test/john/venues/g-7.geml#decision-17"], excludes: ["private"] },
  accepts: [{ text: "单元测试通过", verify: { kind: "command", run: "npm test" } }, { text: "导出的文件能打开", verify: { kind: "file", glob: "out/*.pdf" } }, { text: "按钮位置和样式对", verify: { kind: "review", rubric: "ui-rubric" } }],
  direction: "outsource", venueOfWork: "worker-sandbox", tools: ["read", "edit", "test"], network: false,
  budget: { credits: 40, hours: 6 }, mode: { kind: "single" }, reward: { kind: "escrow", credits: 40 },
};
const CARD = { id: "t-42", by: "person:john", at: "2026-10-31T09:00:00Z" };
const block = (id, value) => ({ id, value });

test("faults: what a card must say; a contest only over machine checks; the modes and rewards", () => {
  assert.deepEqual(cardFaults(INPUT), []);
  assert.deepEqual(cardFaults(3), ["要一个 JSON 对象"]);
  assert.deepEqual(cardFaults({}), ["缺标题", "缺目标（去办什么）", "方向是 outsource 或 dispatch", "执行场地是 worker-sandbox 或 resource-sandbox", "验收标准至少一条"]);
  assert.deepEqual(cardFaults({ ...INPUT, accepts: [{ text: "", verify: { kind: "command" } }, { text: "x", verify: { kind: "nope" } }, { text: "y", verify: { kind: "file" } }, { text: "z", verify: { kind: "review" } }] }), ["第 1 条验收标准没有文字", "第 1 条命令验法要有 run", "第 2 条验法不合法", "第 3 条文件验法要有 glob", "第 4 条审读验法要有 rubric"]);
  assert.deepEqual(cardFaults({ ...INPUT, mode: { kind: "contest", slots: 3 } }), ["竞赛只对验收标准全是机器验法的卡开放"]);
  assert.deepEqual(cardFaults({ ...INPUT, mode: { kind: "contest", slots: 1 } }), ["竞赛至少两个槽", "竞赛只对验收标准全是机器验法的卡开放"]);
  assert.deepEqual(cardFaults({ ...INPUT, mode: { kind: "x" }, reward: { kind: "escrow" }, budget: { credits: -1 }, worker: "john", grantFrom: "a b", tools: "read" }), ["模式是 single、contest 或 splittable", "托管要有积分数", "积分要是非负数", "接单方要写成 agent:<名>@<主人>", "放行人的名字不合法", "工具要是数组"]);
});

test("the record: numbered criteria, defaults, tool words either way; folded from blocks with its transitions, slots, notes, versions, reports and comments", () => {
  const input = cardInput({ title: " t ", goal: "g", direction: "dispatch", venueOfWork: "resource-sandbox", accepts: [{ text: "人点收", verify: { kind: "human" } }], tools: ["读", "评论", "comment", "nope"], extra: 1 });
  assert.deepEqual(input, { title: "t", goal: "g", context: { includes: [], excludes: [] }, accepts: [{ n: 1, text: "人点收", verify: { kind: "human" } }], direction: "dispatch", venueOfWork: "resource-sandbox", tools: ["read", "comment"], network: false, budget: {}, mode: { kind: "single" }, reward: { kind: "none" } });
  assert.deepEqual(toolWords(["read", "edit", "test", "run", "comment", "view", "deploy"]), "读 · 改 · 测 · 跑 · 评论 · 看图 · 部署");
  const blocks = [
    block("card", { kind: "task", ...INPUT, accepts: INPUT.accepts.map((a, i) => ({ n: i + 1, ...a })), by: "person:john", at: "2026-10-31T09:00:00Z" }),
    block("state-1", { to: "open", by: "person:john", at: "2026-10-31T09:01:00Z", venue: "john/g-7", thread: "th-t-42" }),
    block("claim-1", { agent: "agent:xiaoce@wangwu", by: "person:wangwu", at: "2026-10-31T09:02:00Z" }),
    block("state-2", { to: "in-progress", by: "person:wangwu", at: "2026-10-31T09:02:00Z", slot: 1 }),
    block("note-1", { by: "agent:xiaoce@wangwu", at: "2026-10-31T09:10:00Z", text: "凭据 · npm test 退出 1 · 2 条失败", evidence: [{ src: "https://relay.test/wangwu/journals/t-42.geml#rev-3" }] }),
    block("deliverable-1", { version: 1, by: "agent:xiaoce@wangwu", at: "2026-10-31T10:00:00Z", sha256: "7f3a", kind: "code", parts: [{ type: "repo", url: "u", branch: "deliver/t-42", commit: "a1b2c3" }], usage: "npm run build", madeBy: { turns: 63 }, evidence: [{ claim: "单元测试通过", source: "tool", command: "npm test", exit: 0, rev: 38 }], accepts: [{ criterion: 1, met: true, evidence: 1 }, { criterion: 2, met: true }, { criterion: 3, met: null, note: "等委托方审读" }], rights: { owner: "委托方", aiGenerated: true }, halfDone: false }),
    block("state-3", { to: "delivered", by: "agent:xiaoce@wangwu", at: "2026-10-31T10:00:00Z", slot: 1 }),
    block("state-4", { to: "verifying", by: "host", at: "2026-10-31T10:00:00Z" }),
    block("report-1", { version: 1, by: "agent:xiaoping@john", at: "2026-10-31T10:20:00Z", results: [{ criterion: 1, met: true, note: "重跑 · 退出 0 · 598 条" }, { criterion: 2, met: true }, { criterion: 3, met: null, note: "样式对，位置偏左 8px" }] }),
    block("comment-1", { by: "agent:xiaoping@john", at: "2026-10-31T10:21:00Z", version: 1, anchor: "export.ts:22", text: "字体加载失败时没有回退" }),
  ];
  const card = foldCard("t-42", blocks);
  assert.deepEqual([card.id, card.kind, card.by, card.state, card.venue, card.thread, card.title, card.accepts.length], ["t-42", "task", "person:john", "verifying", "john/g-7", "th-t-42", "给设置页加导出 PDF", 3]);
  assert.deepEqual(card.transitions.map((t) => t.to), ["open", "in-progress", "delivered", "verifying"]);
  assert.deepEqual(card.slots, [{ n: 1, agent: "agent:xiaoce@wangwu", by: "person:wangwu", at: "2026-10-31T09:02:00Z", state: "delivered" }]);
  assert.deepEqual([card.notes.length, card.notes[0].text, card.versions.length, card.versions[0].version, card.reports.length, card.comments[0].anchor], [1, "凭据 · npm test 退出 1 · 2 条失败", 1, 1, 1, "export.ts:22"]);
  assert.equal(foldCard("t-1", [block("card", { kind: "share" })]), undefined);
  assert.equal(foldCard("t-1", []), undefined);
});

test("who may move a card where (§8.2): the table, the roles, the faults", () => {
  const draft = foldCard("t-1", [block("card", { kind: "task", ...INPUT, accepts: [{ n: 1, ...INPUT.accepts[0] }], by: "person:john", at: "2026-10-31T09:00:00Z" })]);
  assert.deepEqual([...rolesOf(draft, { person: "john" })], ["delegator"]);
  assert.deepEqual([...rolesOf(draft, { person: "lisi" })], []);
  assert.deepEqual([...rolesOf(draft, { host: true })], ["host"]);
  assert.equal(moveFault(draft, "open", { person: "john" }), undefined);
  assert.equal(moveFault(draft, "open", { person: "lisi" }), "只有委托人能把卡从草拟移到发布");
  assert.equal(moveFault(draft, "in-progress", { person: "john" }), "卡不能从草拟直接到进行中");
  const working = foldCard("t-1", [...[draft].map(() => block("card", { kind: "task", ...INPUT, accepts: [{ n: 1, ...INPUT.accepts[0] }], by: "person:john", at: "2026-10-31T09:00:00Z", grantFrom: "wangwu" })), block("state-1", { to: "open", by: "person:john", at: "t" }), block("claim-1", { agent: "agent:xiaoce@wangwu", by: "person:wangwu", at: "t" }), block("state-2", { to: "awaiting-grant", by: "person:wangwu", at: "t", slot: 1 })]);
  assert.deepEqual([...rolesOf(working, { person: "wangwu" })], ["worker", "granter"]);
  assert.deepEqual([...rolesOf(working, { agent: "agent:xiaoce@wangwu" })], ["worker"]);
  assert.equal(moveFault(working, "in-progress", { person: "wangwu" }), undefined, "the granter opens the thing");
  assert.equal(moveFault(working, "in-progress", { person: "john" }), "只有放行人能把卡从待放行移到进行中");
  assert.equal(moveFault(working, "delivered", { agent: "agent:xiaoce@wangwu" }), "卡不能从待放行直接到已交付");
  assert.equal(waitingOn(working), "wangwu");
});

test("the words: the seven lines of the 委托书, the progress bar with a branch, the tool line, the tags, the heartbeat", () => {
  const card = foldCard("t-57", [block("card", { kind: "task", title: "评审李四的设置页设计稿", goal: "读 settings-v3 的画板，按 John 的评审准则 v3 出意见，标在稿子上", context: { includes: ["评审准则 v3", "上次给王五评稿的两条决策"], excludes: ["你的私有项目", "这个群以外的任何对话"] }, accepts: [{ n: 1, text: "意见覆盖准则的 6 条", verify: { kind: "review", rubric: "准则 v3" } }, { n: 2, text: "每条意见锚在画板上", verify: { kind: "file", glob: "*.fig" } }, { n: 3, text: "李四点收", verify: { kind: "human" } }], direction: "dispatch", grantFrom: "lisi", worker: "agent:xiaoping@john", venueOfWork: "resource-sandbox", tools: ["read", "view", "comment"], network: false, budget: { credits: 20, hours: 2, hops: 1 }, mode: { kind: "single" }, reward: { kind: "none" }, by: "person:john", at: "2026-10-31T09:00:00Z" })]);
  assert.deepEqual(briefLines(card), [
    { label: "去办", text: "读 settings-v3 的画板，按 John 的评审准则 v3 出意见，标在稿子上" },
    { label: "验收", text: "1 意见覆盖准则的 6 条 · 审读 · 准则 v3；2 每条意见锚在画板上 · 文件 · *.fig；3 李四点收 · 人勾" },
    { label: "带去", text: "评审准则 v3 · 上次给王五评稿的两条决策 · 排除：你的私有项目、这个群以外的任何对话" },
    { label: "在哪干", text: "资源方沙箱 · 只读、跑、评 · 产出只有 patch、PR、评论" },
    { label: "工具", text: "读 · 看图 · 评论" },
    { label: "上限", text: "20 积分 · 2 小时 · 跳数 1" },
    { label: "要谁放行", text: "lisi 放开自己的实物" },
  ]);
  assert.equal(briefText(card).split("\n")[0], "去办：读 settings-v3 的画板，按 John 的评审准则 v3 出意见，标在稿子上");
  assert.deepEqual(progress(card), { path: MAIN_PATH.map((s) => ({ state: s, word: STATE_WORDS[s], current: s === "draft" })) });
  assert.equal(progressLine(card), "[草拟] · 发布 · 待放行 · 进行中 · 已交付 · 验收中 · 已接受");
  const changes = foldCard("t-57", [block("card", { kind: "task", ...INPUT, accepts: [{ n: 1, ...INPUT.accepts[0] }], by: "person:john", at: "t" }), block("state-1", { to: "open", by: "person:john", at: "t" }), block("claim-1", { agent: "agent:xiaoce@wangwu", by: "person:wangwu", at: "t" }), block("state-2", { to: "in-progress", by: "person:wangwu", at: "t", slot: 1 }), block("state-3", { to: "delivered", by: "agent:xiaoce@wangwu", at: "t", slot: 1 }), block("state-4", { to: "verifying", by: "host", at: "t" }), block("state-5", { to: "changes", by: "person:john", at: "t" })]);
  assert.deepEqual(progress(changes).branch, { state: "changes", word: "要改", beside: "verifying" });
  assert.equal(progressLine(changes), "草拟 · 发布 · 待放行 · 进行中 · 已交付 · [验收中] · 已接受 （要改）");
  assert.equal(cardLine(changes, "verifying"), "#t-57 · 验收中 → 要改");
  assert.equal(cardLine(working("awaiting-grant"), "open", "lisi"), "#t-57 · 发布 → 待放行 · lisi");
  assert.equal(acceptTag(card.accepts[0]), "审读 · 准则 v3");
  assert.equal(acceptTag({ n: 1, text: "", verify: { kind: "command", run: "npm test" } }), "命令 · npm test");
  assert.equal(acceptTag({ n: 1, text: "", verify: { kind: "repo", pr: "#12" } }), "仓库 · #12");
  assert.equal(rerunNote(foldCard("t-42", [block("card", { kind: "task", ...INPUT, accepts: INPUT.accepts.map((a, i) => ({ n: i + 1, ...a })), by: "person:john", at: "t" })])), "第 1、2 条由委托人的 agent 在沙箱里重跑；第 3 条审读完进「验收」等人勾");
  assert.equal(rerunNote(card), "第 1 条审读完进「验收」等人勾；第 2 条由委托人的 agent 在沙箱里重跑；第 3 条等人勾");
  assert.equal(isStale(changes, "2026-10-31T09:00:00Z", 1800_000), false, "not in progress");
  const busy = foldCard("t-1", [block("card", { kind: "task", ...INPUT, accepts: [{ n: 1, ...INPUT.accepts[0] }], by: "person:john", at: "2026-10-31T09:00:00Z" }), block("state-1", { to: "open", by: "person:john", at: "2026-10-31T09:00:00Z" }), block("claim-1", { agent: "agent:xiaoce@wangwu", by: "person:wangwu", at: "2026-10-31T09:00:00Z" }), block("state-2", { to: "in-progress", by: "person:wangwu", at: "2026-10-31T09:00:00Z", slot: 1 }), block("note-1", { by: "agent:xiaoce@wangwu", at: "2026-10-31T09:27:00Z", text: "x", evidence: [] })]);
  assert.deepEqual([isStale(busy, "2026-10-31T09:30:00Z", 1800_000), isStale(busy, "2026-10-31T09:58:00Z", 1800_000), heartbeatWords(busy, "2026-10-31T09:30:00Z"), heartbeatWords(card, "2026-10-31T09:30:00Z")], [false, true, "3 分钟前写了记录", "还没写记录"]);
  function working(state) { return foldCard("t-57", [block("card", { kind: "task", ...INPUT, accepts: [{ n: 1, ...INPUT.accepts[0] }], grantFrom: "lisi", by: "person:john", at: "t" }), block("state-1", { to: "open", by: "person:john", at: "t" }), block("state-2", { to: state, by: "person:john", at: "t" })]); }
});

test("acceptance (§8.3): a machine check failed is 要改; all machine and all passed is 已接受 when the policy says so; anything waiting on a person is the inbox", () => {
  const card = foldCard("t-42", [block("card", { kind: "task", ...INPUT, accepts: INPUT.accepts.map((a, i) => ({ n: i + 1, ...a })), by: "person:john", at: "t" })]);
  const report = (results) => ({ version: 1, by: "agent:xiaoping@john", at: "t", results });
  assert.equal(acceptance(card, report([{ criterion: 1, met: true }, { criterion: 2, met: false }, { criterion: 3, met: null }]), { autoAccept: true }), "changes");
  assert.equal(acceptance(card, report([{ criterion: 1, met: true }, { criterion: 2, met: true }, { criterion: 3, met: null }]), { autoAccept: true }), "inbox", "a review waits for the person");
  const machine = foldCard("t-43", [block("card", { kind: "task", ...INPUT, accepts: INPUT.accepts.slice(0, 2).map((a, i) => ({ n: i + 1, ...a })), by: "person:john", at: "t" })]);
  assert.equal(acceptance(machine, report([{ criterion: 1, met: true }, { criterion: 2, met: true }]), { autoAccept: true }), "accepted");
  assert.equal(acceptance(machine, report([{ criterion: 1, met: true }, { criterion: 2, met: true }]), { autoAccept: false }), "inbox");
  assert.equal(acceptance(machine, report([{ criterion: 1, met: true }]), { autoAccept: true }), "inbox", "a check not rerun is not passed");
});

test("the walks (§8.4): contest slots, the split's depth and budget, the card's scope for a turn", () => {
  const contest = foldCard("t-9", [block("card", { kind: "task", ...INPUT, accepts: INPUT.accepts.slice(0, 2).map((a, i) => ({ n: i + 1, ...a })), mode: { kind: "contest", slots: 3 }, by: "person:john", at: "t" }), block("state-1", { to: "open", by: "person:john", at: "t" }), block("claim-1", { agent: "agent:a@x", by: "person:x", at: "t" }), block("state-2", { to: "in-progress", by: "person:x", at: "t", slot: 1 }), block("claim-2", { agent: "agent:b@y", by: "person:y", at: "t" }), block("state-3", { to: "in-progress", by: "person:y", at: "t", slot: 2 })]);
  assert.deepEqual([openSlots(contest), contest.slots.map((s) => s.state)], [1, ["working", "working"]]);
  const single = foldCard("t-1", [block("card", { kind: "task", ...INPUT, accepts: [{ n: 1, ...INPUT.accepts[0] }], by: "person:john", at: "t" })]);
  assert.equal(openSlots(single), 1);
  assert.equal(splitFault(single, [{ budget: { credits: 20 } }, { budget: { credits: 20 } }], 1), undefined);
  assert.equal(splitFault(single, [{ budget: { credits: 30 } }, { budget: { credits: 20 } }], 1), "子卡的预算总和 50 超过父卡的 40");
  assert.equal(splitFault(single, [{ budget: {} }], 2), "拆分最多两层");
  assert.deepEqual(scopeOfCard(single), { write: true, run: "sandbox", budget: 40 });
  assert.deepEqual(scopeOfCard({ ...single, tools: ["read", "comment"], venueOfWork: "resource-sandbox", budget: {} }), { write: false, run: "sandbox", budget: null });
  assert.deepEqual(scopeOfCard({ ...single, tools: ["read"], venueOfWork: "worker-sandbox", budget: { credits: 5 } }), { write: false, run: "none", budget: 5 });
});

test("the verbs edit, split and tree (§8.1, §8.4): a draft's fields changed by edit blocks, the last word winning; a split's children on the parent; an edit that breaks the card is left out", async () => {
  const { CARD_ACTIONS, EDITABLE, foldCard } = await import("../dist/core/im/card.js");
  assert.deepEqual(CARD_ACTIONS.slice(-5), ["edit", "split", "tree", "show", "list"]);
  assert.ok(EDITABLE.has("goal") && EDITABLE.has("budget") && !EDITABLE.has("parent"));
  const head = { id: "card", value: { kind: "task", title: "给设置页加导出 PDF", goal: "一个按钮", accepts: [{ text: "人点收", verify: { kind: "human" } }], direction: "outsource", venueOfWork: "worker-sandbox", budget: { credits: 40 }, by: "person:john", at: "2026-10-31T09:00:00Z" } };
  const edited = foldCard("t-1", [head, { id: "edit-1", value: { goal: "右上角一个按钮", budget: { credits: 20 }, by: "person:john", at: "2026-10-31T09:01:00Z" } }, { id: "edit-2", value: { title: "", by: "person:john", at: "2026-10-31T09:02:00Z" } }, { id: "edit-3", value: { tools: ["read", "edit"], by: "agent:xiaoping@john", at: "2026-10-31T09:03:00Z" } }]);
  assert.deepEqual([edited.goal, edited.budget, edited.title, edited.tools, edited.state, edited.children], ["右上角一个按钮", { credits: 20 }, "给设置页加导出 PDF", ["read", "edit"], "draft", []]);
  const split = foldCard("t-1", [head, { id: "split-1", value: { by: "agent:xiaoce@wangwu", children: ["https://relay.test/wangwu/cards/t-2.geml", "https://relay.test/wangwu/cards/t-3.geml"], at: "2026-10-31T09:04:00Z" } }]);
  assert.deepEqual(split.children, ["https://relay.test/wangwu/cards/t-2.geml", "https://relay.test/wangwu/cards/t-3.geml"]);
});
