import { test } from "node:test";
import assert from "node:assert/strict";
import { IM_TOOLS, IM_TOOL_NAMES, imBand, callRule, imQuietLine, imHeaderLine, imTabRows, imToolOf, isImTool, scopeRefusal, toolClassOf, toolLine, unreadOf, venueKey } from "../dist/hosts/claude-code/im.js";
import { inputAction, TAB_IDS, tabs } from "../dist/hosts/claude-code/board.js";
import { DEFAULT_SETTINGS, SETTING_KEYS, settingsFrom, withSetting } from "../dist/hosts/claude-code/settings.js";
import { wordsFor } from "../dist/hosts/claude-code/text.js";
import { DEFAULT_SCOPES } from "../dist/core/im/sender.js";

const t = wordsFor("zh");
const ITEM = { id: "qi-gd-1-g-1", n: 1, prompt: "这个项目怎么跑？", sender: "guest:g-1", senderName: "访客 g-1", level: "guest", venue: "gd-1", venueKind: "guest-dm", venueName: "访客", at: "2026-10-31T09:00:00Z", hops: 0, prev: null, hash: "sha256:x" };
const STATUS = {
  configured: true, person: "john", relay: "relay.test", agents: ["xiaoping", "xiaoguan"], connected: true, at: "2026-10-31T09:00:00Z",
  needs: [
    { kind: "grant", key: "https://relay.test/john/people/john.geml#request-1", text: "lisi 申请看 https://relay.test/john/sessions/cc-1.geml#turn-3", actions: ["允许一次", "允许此人", "拒绝"], since: "2026-10-31T08:00:00Z", level: 0 },
    { kind: "decide", key: "https://relay.test/john/venues/g-7.geml#m-ask", text: "群「前端周会」· xiaoping 问：要不要合并？", actions: ["合", "不合", "自己写"], since: "2026-10-31T09:00:00Z", venue: "g-7", level: 0 },
  ],
  venues: [{ owner: "john", id: "g-7", kind: "group", kindWord: "群", name: "前端周会", status: "2 人 · 1 个 agent", unread: 3, last: "m-ask" }, { owner: "zhangsan", id: "t-1", kind: "thread", kindWord: "线程", name: "回复：看看", status: "没人在干", unread: 0 }],
  cards: [],
  drafts: [{ id: "d-1", agent: "xiaoping", venueName: "先看", text: "看过了，可以合", at: "2026-10-31T09:10:00Z" }],
  presence: { xiaoping: "tool", xiaoguan: "asleep" },
};
const THREAD = {
  owner: "john", id: "g-7", kind: "group", kindWord: "群", name: "前端周会", announce: "先跑测试再合", people: ["john", "zhangsan"], agents: ["xiaoping"], draftFirst: false, total: 60,
  messages: [
    { id: "m-1", speaker: "person:zhangsan", label: "zhangsan", kind: "chat", kindWord: "闲聊", text: "@xiaoping 跑一下测试", at: "2026-10-31T09:01:00Z", source: "self", parts: [{ src: "https://relay.test/john/sessions/cc-1.geml#turn-3", stub: "你看不到：来自 john 的私有范围 · 申请看" }], evidence: [], decision: true },
    { id: "m-2", speaker: "agent:xiaoping@john", label: "xiaoping · 代 john", kind: "report", kindWord: "汇报", text: "跑完了，三条过两条", at: "2026-10-31T09:05:00Z", source: "agent", parts: [], evidence: [{ src: "https://relay.test/john/journals/t-42.geml#rev-14", text: "npm test: 598 passed" }], opinion: "可以合", decision: false },
    { id: "m-3", speaker: "person:john", label: "john", kind: "chat", kindWord: "闲聊", text: "@xiaoping 再跑", at: "2026-10-31T09:06:00Z", source: "drafted", sourceTag: "起草", status: "xiaoping：已读入 ✓✓（09:07）", parts: [], evidence: [], decision: false },
    { id: "m-ask", speaker: "agent:xiaoping@john", label: "xiaoping · 代 john", kind: "ask", kindWord: "询问", text: "要不要合并？", at: "2026-10-31T09:08:00Z", source: "agent", ask: { question: "要不要合并？", options: ["合", "不合", "自己写"], who: "person:john" }, parts: [], evidence: [], decision: false },
    { id: "sys-1", speaker: "host", label: "宿主", kind: "system", kindWord: "系统", text: "person:john 改了群公告（第 1 版）", at: "2026-10-31T09:09:00Z", source: "self", parts: [], evidence: [], decision: false },
  ],
};

test("the six tools, how they are named, and the one line a call answers with", () => {
  assert.deepEqual(IM_TOOL_NAMES, ["im_say", "im_ask", "im_report", "im_read", "im_forward", "im_card"]);
  assert.deepEqual(IM_TOOLS.map((x) => x.name), IM_TOOL_NAMES);
  for (const x of IM_TOOLS) { assert.equal(x.inputSchema.type, "object"); assert.equal(x.inputSchema.additionalProperties, false); assert.ok(x.description.length > 20, x.name); }
  assert.deepEqual(IM_TOOLS.find((x) => x.name === "im_ask").inputSchema.required, ["venue", "question", "options", "who"]);
  assert.deepEqual(IM_TOOLS.find((x) => x.name === "im_card").inputSchema.required, ["action"]);
  assert.equal(isImTool("mcp__gemworks__im_say"), true);
  assert.equal(isImTool("mcp__gemworks__say"), false);
  assert.equal(imToolOf("mcp__gemworks__im_read"), "im_read");
  assert.equal(imToolOf("Bash"), undefined);
  assert.equal(toolLine("im_read", "群「前端周会」", "最近 12 条"), "im_read · 群「前端周会」· 最近 12 条");
  assert.equal(venueKey("john", "g-7"), "john/g-7");
});

test("the scope over a delivered turn: a guest's turn reads and answers, never writes or runs; a sandbox is refused for now; the owner's own turn passes", () => {
  const guest = { agent: "xiaoping", item: ITEM, scope: DEFAULT_SCOPES.guest, draftFirst: false, refused: 0 };
  assert.deepEqual([toolClassOf("Read"), toolClassOf("Grep"), toolClassOf("Edit"), toolClassOf("Write"), toolClassOf("NotebookEdit"), toolClassOf("Bash"), toolClassOf("mcp__gemworks__im_say")], ["read", "read", "write", "write", "write", "run", "read"]);
  assert.equal(scopeRefusal(guest, "Read"), undefined);
  assert.equal(scopeRefusal(guest, "mcp__gemworks__im_report"), undefined);
  assert.equal(scopeRefusal(guest, "Write"), "IM：这一轮来自 访客 g-1（访客），权限：只读；Write 不在范围内，没有执行。要更多权限，在回复里说明，由主人放行。");
  assert.equal(scopeRefusal(guest, "Bash"), "IM：这一轮来自 访客 g-1（访客），权限：只读；Bash 不在范围内，没有执行。要更多权限，在回复里说明，由主人放行。");
  const trusted = { ...guest, item: { ...ITEM, senderName: "李四", level: "trusted" }, scope: DEFAULT_SCOPES.trusted };
  assert.equal(scopeRefusal(trusted, "Bash"), "IM：这一轮来自 李四（信任），权限：读、在沙箱里跑；Bash 要在沙箱里跑，这一轮没有客房（只有任务卡的轮次有），没有执行。要更多权限，在回复里说明，由主人放行。");
  assert.equal(scopeRefusal(trusted, "Edit"), "IM：这一轮来自 李四（信任），权限：读、在沙箱里跑；Edit 不在范围内，没有执行。要更多权限，在回复里说明，由主人放行。");
  const owner = { ...guest, item: { ...ITEM, level: "owner" }, scope: DEFAULT_SCOPES.owner };
  assert.equal(scopeRefusal(owner, "Bash"), undefined);
  assert.equal(scopeRefusal(owner, "Write"), undefined);
});

test("the band's row: the first need in the band's order with its buttons (自己写 too: the hooks module opens the thread for it); nothing without needs or a connection", () => {
  assert.equal(imBand(null), undefined);
  assert.equal(imBand({ ...STATUS, configured: false }), undefined);
  assert.equal(imBand({ ...STATUS, needs: [] }), undefined);
  const row = imBand(STATUS);
  assert.deepEqual([row.verb, row.tone, row.text, row.more], ["定", "warning", "群「前端周会」· xiaoping 问：要不要合并？", 1]);
  assert.deepEqual(row.actions.map((a) => [a.key, a.label, a.primary, a.action]), [
    ["im-need-0", "合", true, { op: "im-need", key: "https://relay.test/john/venues/g-7.geml#m-ask", action: "合" }],
    ["im-need-1", "不合", undefined, { op: "im-need", key: "https://relay.test/john/venues/g-7.geml#m-ask", action: "不合" }],
    ["im-need-2", "自己写", undefined, { op: "im-need", key: "https://relay.test/john/venues/g-7.geml#m-ask", action: "自己写" }],
  ]);
  const off = imBand({ ...STATUS, needs: [{ kind: "offline", key: "offline:relay", text: "连不上中继 relay.test", actions: ["重试"], since: "2026-10-31T09:00:00Z", level: 0 }, ...STATUS.needs] });
  assert.deepEqual([off.verb, off.tone, off.text, off.more, off.actions[0].action], ["断了", "error", "连不上中继 relay.test", 2, { op: "im-need", key: "offline:relay", action: "重试" }]);
  assert.equal(imBand({ ...STATUS, needs: [STATUS.needs[0]] }).tone, "warning", "放行 is amber");
  assert.equal(unreadOf(STATUS), 3);
  assert.equal(unreadOf(null), 0);
  assert.equal(imHeaderLine(STATUS, "xiaoping", t), "xiaoping · 代 john · 跑工具 · 在线");
  assert.equal(imHeaderLine({ ...STATUS, connected: false }, "xiaoguan", t), "xiaoguan · 代 john · 睡着 · 断了");
  assert.equal(imHeaderLine(STATUS, undefined, t), "john · 没选 agent · 在线");
  assert.equal(imHeaderLine({ ...STATUS, configured: false }, "xiaoping", t), undefined);
});

test("the page: a hint before the daemon is set up; the list with the needs, the drafts and the venues; a thread with its messages, parts, ask and box", () => {
  const base = { thread: null, replyTo: null, columns: 120, now: "2026-10-31T09:30:00Z", t };
  const clock = (tag) => tag.replace(/ · \d\d:\d\d · /, " · hh:mm · ");
  assert.deepEqual(imTabRows({ ...base, status: null }), [{ kind: "text", text: "正在读取消息…", tone: "dim" }]);
  assert.match(imTabRows({ ...base, status: { ...STATUS, configured: false } })[0].text, /gemworks connect setup/);
  const list = imTabRows({ ...base, status: STATUS });
  assert.deepEqual(list.map((r) => `${r.kind}:${r.key ?? r.text ?? ""}`), [
    "heading:im-head", "section:im-needs", "card:im-need-https://relay.test/john/venues/g-7.geml#m-ask", "card:im-need-https://relay.test/john/people/john.geml#request-1",
    "section:im-drafts", "card:im-draft-d-1", "input:im-draft-d-1",
    "section:im-venues", "entry:im-venue-john-g-7", "entry:im-venue-zhangsan-t-1",
  ]);
  assert.deepEqual([list[0].text, list[0].sub, list[0].action.action], ["消息", "john @ relay.test · 在线", { op: "im-refresh" }]);
  const grant = list[3];
  assert.deepEqual([grant.icon, grant.verb, grant.title, grant.actions.map((a) => [a.label, a.action.action])], ["ask", "放行", "lisi 申请看 https://relay.test/john/sessions/cc-1.geml#turn-3", [["允许一次", "允许一次"], ["允许此人", "允许此人"], ["拒绝", "拒绝"]]]);
  assert.deepEqual([list[5].verb, list[5].title, list[5].tag, list[5].detail, list[5].actions.map((a) => a.action)], ["草稿", "先看", "xiaoping", ["看过了，可以合"], [{ op: "im-draft", id: "d-1", send: true }, { op: "im-draft", id: "d-1", send: false }]]);
  assert.deepEqual([list[6].field, list[6].target, list[6].value], ["im-draft", "d-1", "看过了，可以合"]);
  assert.deepEqual([list[8].title, list[8].tag, list[8].detail, list[8].tone, list[8].action], ["群「前端周会」", "3 未读", "2 人 · 1 个 agent", "normal", { op: "im-open", owner: "john", id: "g-7" }]);
  assert.deepEqual([list[9].tag, list[9].tone], ["", "dim"]);
  const empty = imTabRows({ ...base, status: { ...STATUS, needs: [], drafts: [], venues: [], connected: false } });
  assert.deepEqual(empty.map((r) => r.kind), ["heading", "section", "text"]);
  assert.equal(empty[0].sub, "john @ relay.test · 断了");
  const thread = imTabRows({ ...base, status: STATUS, thread: THREAD });
  assert.deepEqual(thread.map((r) => `${r.kind}:${r.key ?? ""}`), [
    "heading:im-thread", "text:", "text:",
    "note:im-m-m-1", "text:",
    "note:im-m-m-2", "text:", "text:",
    "note:im-m-m-3",
    "note:im-m-m-ask", "buttons:",
    "note:im-m-sys-1",
    "input:im-say",
  ]);
  assert.deepEqual([thread[0].text, thread[0].sub, thread[0].action.action, thread[1].text, thread[2].text], ["群「前端周会」", "2 人 · 1 个 agent", { op: "im-close" }, "公告：先跑测试再合", "还有 55 条更早的"]);
  assert.deepEqual([thread[3].lines, clock(thread[3].tag), thread[3].action], [["@xiaoping 跑一下测试"], "zhangsan · hh:mm · 决策", { op: "im-reply", message: "m-1" }]);
  assert.equal(thread[4].text, "  ↳ https://relay.test/john/sessions/cc-1.geml#turn-3：你看不到：来自 john 的私有范围 · 申请看");
  assert.deepEqual([clock(thread[5].tag), thread[6].text, thread[7].text], ["xiaoping · 代 john · hh:mm · 汇报", "  ↳ https://relay.test/john/journals/t-42.geml#rev-14：npm test: 598 passed", "  意见：可以合"]);
  assert.equal(clock(thread[8].tag), "john · hh:mm · 起草 · xiaoping：已读入 ✓✓（09:07）");
  assert.deepEqual(thread[10].items.map((b) => [b.label, b.action]), [["合", { op: "im-say", text: "合", replyTo: "m-ask" }], ["不合", { op: "im-say", text: "不合", replyTo: "m-ask" }], ["自己写", { op: "im-reply", message: "m-ask" }]]);
  assert.deepEqual([thread[11].lines, clock(thread[11].tag)], [["（person:john 改了群公告（第 1 版））"], "宿主 · hh:mm · 系统"]);
  assert.deepEqual([thread[12].field, thread[12].target, thread[12].placeholder], ["im-say", "john/g-7", "以本人身份发到这里"]);
  const replying = imTabRows({ ...base, status: STATUS, thread: THREAD, replyTo: "m-ask" });
  assert.deepEqual([replying[12].placeholder, replying[9].action], ["回复 m-ask…", { op: "im-reply", message: null }]);
});

test("the tab comes first with its label; the fields; the setting that names the session's agent", () => {
  assert.deepEqual(TAB_IDS, ["messages", "sessions", "items", "journal", "flow", "tools"]);
  assert.equal(tabs(t)[0].label, "消息");
  assert.equal(tabs(wordsFor("en"))[0].label, "Messages");
  assert.deepEqual(inputAction("im-say", "  大家好 "), { op: "im-say", text: "大家好" });
  assert.equal(inputAction("im-say", "  "), undefined);
  assert.deepEqual(inputAction("im-draft", "改过的", "d-1"), { op: "im-draft", id: "d-1", send: true, text: "改过的" });
  assert.equal(inputAction("im-draft", "改过的"), undefined);
  assert.deepEqual(DEFAULT_SETTINGS.im, { agent: "" });
  assert.ok(SETTING_KEYS.includes("im.agent"));
  assert.equal(settingsFrom({ im: { agent: "xiaoping" } }).im.agent, "xiaoping");
  assert.equal(settingsFrom({ im: { agent: 7 } }).im.agent, "");
  assert.equal(withSetting(DEFAULT_SETTINGS, "im.agent", "xiaoguan").im.agent, "xiaoguan");
  assert.equal(withSetting(DEFAULT_SETTINGS, "im.agent", true).im.agent, "");
});

test("the call rule in a card's turn (§7.5): reads pass; writes only in the room, a run started there; a card without 改 refuses writes; a trusted turn without a room still refuses a run; the owner's own turn is not confined", () => {
  const item = { ...ITEM, card: { id: "t-42", address: "https://relay.test/john/cards/t-42.geml", title: "导出 PDF", tools: ["read", "edit", "test"], venueOfWork: "worker-sandbox", credits: 40 } };
  const turn = { agent: "xiaoce", item, scope: { write: true, run: "sandbox", budget: 40 }, draftFirst: false, refused: 0, room: "/h/im/rooms/t-42" };
  assert.equal(callRule(turn, "Read", { file_path: "/work/app/x.ts" }), undefined);
  assert.equal(callRule(turn, "mcp__gemworks__im_card", { action: "note" }), undefined);
  assert.equal(callRule(turn, "Write", { file_path: "/h/im/rooms/t-42/src/x.ts" }), undefined);
  assert.deepEqual(callRule(turn, "Write", { file_path: "/work/app/x.ts" }), { deny: "IM：这一轮是任务卡 #t-42 的客房，只能写到 /h/im/rooms/t-42 里；Write 写的是 /work/app/x.ts，没有执行。" });
  assert.deepEqual(callRule(turn, "Edit", { file_path: "/h/im/rooms/t-42-other/x.ts" }), { deny: "IM：这一轮是任务卡 #t-42 的客房，只能写到 /h/im/rooms/t-42 里；Edit 写的是 /h/im/rooms/t-42-other/x.ts，没有执行。" }, "a sibling that shares the prefix is outside");
  assert.equal(callRule({ ...turn, room: "C:\\h\\im\\rooms\\t-42" }, "Edit", { file_path: "C:\\h\\im\\rooms\\t-42\\x.ts" }), undefined, "a Windows path");
  assert.deepEqual(callRule(turn, "Bash", { command: "npm test" }), { cwd: "/h/im/rooms/t-42" });
  const readOnly = { ...turn, scope: { write: false, run: "none", budget: 5 }, item: { ...item, card: { ...item.card, tools: ["read"] } } };
  assert.deepEqual(callRule(readOnly, "Write", { file_path: "/h/im/rooms/t-42/x.ts" }), { deny: "IM：这一轮来自 访客 g-1（访客），权限：只读；Write 不在范围内，没有执行。要更多权限，在回复里说明，由主人放行。" });
  assert.deepEqual(callRule(readOnly, "Bash", {}), { deny: "IM：这一轮来自 访客 g-1（访客），权限：只读；Bash 不在范围内，没有执行。要更多权限，在回复里说明，由主人放行。" });
  const trusted = { agent: "xiaoping", item: { ...ITEM, senderName: "李四", level: "trusted" }, scope: { write: false, run: "sandbox", budget: 100 }, draftFirst: false, refused: 0 };
  assert.deepEqual(callRule(trusted, "Bash", {}), { deny: "IM：这一轮来自 李四（信任），权限：读、在沙箱里跑；Bash 要在沙箱里跑，这一轮没有客房（只有任务卡的轮次有），没有执行。要更多权限，在回复里说明，由主人放行。" });
  assert.equal(callRule(trusted, "Read", {}), undefined);
  const owner = { ...turn, scope: { write: true, run: "workflow", budget: null } };
  assert.equal(callRule(owner, "Bash", {}), undefined, "the owner's own card turn runs anywhere");
  assert.equal(callRule(owner, "Write", { file_path: "/work/app/x.ts" }), undefined);
});

test("the cards on the page (§8.1): a section with a card row per card, its buttons as presses, a line of words for the buttons that take one; the band's quiet line (§6.9)", () => {
  const t = (s, ...a) => a.reduce((x, v, i) => x.replace(`{${i}}`, String(v)), s);
  const base = { thread: null, replyTo: null, columns: 120, now: "2026-10-31T09:30:00Z", t };
  const CARD_ROW = { owner: "john", id: "t-57", title: "评审李四的设置页设计稿", direction: "dispatch", directionWord: "派出", state: "awaiting-grant", stateWord: "待放行", progress: "草拟 · 发布 · [待放行] · 进行中 · 已交付 · 验收中 · 已接受", brief: [{ label: "去办", text: "读画板出意见" }, { label: "验收", text: "1 李四点收 · 人勾" }], role: "delegator", worker: "xiaoping", waitingOn: "lisi", heartbeat: "还没写记录", versions: 0, actions: ["撤回"], card: { thread: "th-t-57" } };
  const rows = imTabRows({ ...base, status: { ...STATUS, cards: [CARD_ROW] } });
  const section = rows.find((r) => r.kind === "section" && r.key === "im-cards");
  assert.deepEqual([section.text, section.count], ["任务卡", 1]);
  const card = rows.find((r) => r.key === "im-card-john/t-57");
  assert.deepEqual([card.kind, card.icon, card.verb, card.title, card.tag, card.detail, card.actions.map((a) => [a.label, a.primary, a.action])], ["card", "ask", "待放行", "#t-57 评审李四的设置页设计稿", "派出 · 等 lisi · xiaoping", ["草拟 · 发布 · [待放行] · 进行中 · 已交付 · 验收中 · 已接受", "去办：读画板出意见", "验收：1 李四点收 · 人勾", "心跳：还没写记录"], [["撤回", true, { op: "im-card", action: "close", owner: "john", id: "t-57" }]]]);
  const words = rows.find((r) => r.kind === "input" && r.field === "im-card");
  assert.deepEqual([words.key, words.target], ["im-card-words-john/t-57", "john/t-57"], "撤回 takes a line of words first");
  assert.ok(rows.findIndex((r) => r.key === "im-cards") < rows.findIndex((r) => r.key === "im-venues"), "the cards stand before the venues");
  const working = imTabRows({ ...base, status: { ...STATUS, cards: [{ ...CARD_ROW, state: "in-progress", stateWord: "进行中", actions: ["问一句", "要求交回"], versions: 2 }] } });
  const row = working.find((r) => r.key === "im-card-john/t-57");
  assert.deepEqual(row.actions.map((a) => a.action), [{ op: "im-open", owner: "john", id: "th-t-57" }, { op: "im-card", action: "giveback", owner: "john", id: "t-57" }]);
  assert.equal(row.detail.at(-1), "第 2 版");
  const accepted = imTabRows({ ...base, status: { ...STATUS, cards: [{ ...CARD_ROW, state: "accepted", stateWord: "已接受", actions: [] }] } });
  assert.deepEqual([accepted.find((r) => r.key === "im-card-john/t-57").icon, accepted.some((r) => r.kind === "input" && r.field === "im-card")], ["done", false]);
  assert.deepEqual(inputAction("im-card", " 字体没回退 ", "john/t-57"), { op: "im-card-words", card: "john/t-57", text: "字体没回退" });
  assert.equal(inputAction("im-card", "x"), undefined);
  assert.equal(imQuietLine(null), undefined);
  assert.equal(imQuietLine({ ...STATUS, configured: false }), undefined);
  assert.equal(imQuietLine({ ...STATUS, cards: [], venues: [] }), "没有需要你的事");
  assert.equal(imQuietLine({ ...STATUS, cards: [CARD_ROW], venues: [{ owner: "john", id: "g-7", kind: "group", kindWord: "群", name: "前端周会", status: "", unread: 3 }, { owner: "john", id: "gd-1", kind: "guest-dm", kindWord: "访客私信", name: "访客", status: "", unread: 2 }] }), "#t-57 待放行 · 等lisi · 群里有 3 条新消息，没点名你");
  assert.equal(imQuietLine({ ...STATUS, cards: [{ ...CARD_ROW, state: "accepted", stateWord: "已接受" }], venues: [] }), "没有需要你的事", "a card at its end is nowhere to be");
});
