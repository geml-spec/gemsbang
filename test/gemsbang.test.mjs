import { test } from "node:test";
import assert from "node:assert/strict";
import { agentLine, gemsbangAboutRows, gemsbangBand, gemsbangRows, gemsbangSettingsRows, gemsbangTabs, GEMSBANG_MARK_SVG } from "../dist/hosts/claude-code/gemsbang.js";
import { DEFAULT_SETTINGS } from "../dist/hosts/claude-code/settings.js";
import { wordsFor, ZH } from "../dist/hosts/claude-code/text.js";
import { hhmm } from "../dist/hosts/claude-code/time.js";

// The gemsbang plugin's pure parts (plan O): the band's one line, the pane's tabs and rows, the dialogs.
const t = ZH;
const grant = { kind: "grant", key: "https://relay.test/john/people/john.geml#request-1", text: "李四的 agent 请小评评它的设计稿 · 访客", actions: ["允许一次", "允许此人", "拒绝"], since: "2026-11-01T08:00:00Z", level: 0 };
const decide = { kind: "decide", key: "https://relay.test/john/venues/g-7.geml#m-ask", text: "小评问：按哪版准则评？", actions: ["v3", "v2", "自己写"], since: "2026-11-01T09:00:00Z", venue: "g-7", level: 0 };
const card = (state, extra = {}) => ({ owner: "john", id: "t-57", title: "评审", direction: "outsource", directionWord: "外包", state, stateWord: state === "open" ? "待放行" : "进行中", progress: "p", brief: [], role: "delegator", heartbeat: "—", versions: 0, actions: [], card: {}, waitingOn: "李四", ...extra });
const im = (extra = {}) => ({ configured: true, person: "john", relay: "relay.test", agents: ["xiaoping", "xiaoguan"], connected: true, at: "2026-11-01T05:09:00Z", needs: [], venues: [{ owner: "john", id: "g-7", kind: "group", kindWord: "群", name: "前端周会", status: "2 人 · 1 个 agent", unread: 3 }], drafts: [], cards: [], presence: { xiaoping: "idle" }, ...extra });
const kinds = (rows) => rows.map((r) => `${r.kind}:${r.text ?? r.title ?? r.key ?? ""}`);

test("the tabs: 消息 counts what waits on the person (needs and drafts), 任务 the cards on their way, 钱包 none", () => {
  const draft = { id: "d-1", agent: "xiaoping", venueName: "群「先看」", text: "要改就直接改", at: "2026-11-01T09:00:00Z" };
  assert.deepEqual(gemsbangTabs(im({ needs: [grant, decide], drafts: [draft], cards: [card("open"), card("accepted", { id: "t-1" })] }), t).map((x) => x.label), ["消息 3", "任务 1", "钱包"]);
  assert.deepEqual(gemsbangTabs(null, t).map((x) => x.label), ["消息", "任务", "钱包"]);
  assert.deepEqual(gemsbangTabs(im(), wordsFor("en")).map((x) => x.label), ["Messages", "Tasks", "Wallet"]);
});

test("the band: the plugin's own problem first; nothing before the first read; not connected says so; a need leads with its buttons and how many more; else the agent, its presence and where things stand", () => {
  assert.deepEqual(gemsbangBand(im(), "xiaoping", "gemsbang：找不到 node", t), { verb: "", title: "gemsbang：找不到 node", tone: "error", note: "", actions: [], more: 0 });
  assert.equal(gemsbangBand(null, undefined, null, t), undefined);
  assert.deepEqual(gemsbangBand({ ...im(), configured: false }, undefined, null, t), { verb: "", title: "还没连上中继", tone: "dim", note: "看板里有连法", actions: [], more: 0 });
  const need = gemsbangBand(im({ needs: [grant, decide] }), "xiaoping", null, t);
  assert.deepEqual([need.verb, need.title, need.more, need.actions.map((a) => a.label)], ["定", decide.text, 1, ["v3", "v2", "自己写"]], "the band's order: a question before a request");
  assert.deepEqual(need.actions[0].action, { op: "im-need", key: decide.key, action: "v3" });
  const quiet = gemsbangBand(im({ cards: [card("open")] }), "xiaoping", null, t);
  assert.deepEqual([quiet.verb, quiet.title, quiet.tone, quiet.actions], ["xiaoping", "空闲 · #t-57 待放行 · 等李四 · 群里有 3 条新消息，没点名你", "dim", []]);
  assert.equal(gemsbangBand(im({ venues: [] }), "xiaoping", null, t).title, "空闲");
  assert.deepEqual([gemsbangBand(im({ venues: [] }), undefined, null, t).verb, gemsbangBand(im({ venues: [] }), undefined, null, t).title], ["", "没选 agent"]);
  const offline = gemsbangBand(im({ connected: false, needs: [{ kind: "offline", key: "offline:relay", text: "连不上中继 relay.test", actions: ["重试"], since: "2026-11-01T09:00:00Z", level: 0 }] }), "xiaoping", null, t);
  assert.deepEqual([offline.verb, offline.title, offline.tone], ["断了", "连不上中继 relay.test", "error"]);
});

test("the agent's line: its name, 代 whom, its presence and the wallet's balance, and whether the relay is reached", () => {
  assert.deepEqual(agentLine(im({ wallet: { balance: 86, caps: {}, used: {}, lines: [], recent: [] } }), "xiaoping", t), { name: "xiaoping", line: "代 john · 空闲 · 钱包 86", link: "在线", tone: "success" });
  assert.deepEqual(agentLine(im({ connected: false }), "xiaoguan", t), { name: "xiaoguan", line: "代 john · 睡着", link: "断了", tone: "error" });
  assert.equal(agentLine(null, "xiaoping", t), undefined);
  assert.equal(agentLine(im(), undefined, t).name, "没选 agent");
});

test("the pages: 消息 holds 需要我, 回群前先给你看 and 场所 with 刷新, or the open thread; 任务 the cards and the brief; 钱包 the wallet; nothing read yet, and not connected, say so", () => {
  const draft = { id: "d-1", agent: "xiaoping", venueName: "群「先看」", text: "要改就直接改", at: "2026-11-01T09:00:00Z" };
  const msgs = gemsbangRows({ tab: "messages", status: im({ needs: [grant], drafts: [draft] }), thread: null, replyTo: null, columns: 80, t });
  assert.deepEqual(msgs.filter((r) => r.kind === "section").map((r) => [r.text, r.count]), [["需要我", 1], ["回群前先给你看", 1], ["场所", 1]]);
  assert.deepEqual(msgs.find((r) => r.key === "im-venues").actions.map((a) => a.action), [{ op: "im-refresh" }]);
  assert.deepEqual(msgs.find((r) => r.kind === "entry").action, { op: "im-open", owner: "john", id: "g-7" });
  const thread = { owner: "john", id: "g-7", kind: "group", kindWord: "群", name: "前端周会", people: ["john", "zhangsan"], agents: ["xiaoping"], draftFirst: false, total: 1, messages: [] };
  const opened = gemsbangRows({ tab: "messages", status: im(), thread, replyTo: null, columns: 80, t });
  assert.deepEqual([opened[0].kind, opened[0].text, opened.at(-1).field], ["heading", "群「前端周会」", "im-say"]);
  const tasks = gemsbangRows({ tab: "tasks", status: im({ cards: [card("open", { actions: ["算了"] })] }), thread: null, replyTo: null, columns: 80, t });
  assert.deepEqual(kinds(tasks).map((k) => k.split(":")[0]), ["section", "card", "input", "input"]);
  assert.equal(tasks.at(-1).field, "im-brief");
  assert.deepEqual(kinds(gemsbangRows({ tab: "tasks", status: im({ agents: [] }), thread: null, replyTo: null, columns: 80, t })), ["text:还没有任务卡：一句话起草委托书，agent 起草成卡给你过目，你点发布才发。"]);
  assert.deepEqual(kinds(gemsbangRows({ tab: "wallet", status: im({ wallet: { balance: 86, caps: {}, used: {}, lines: ["余额 86"], recent: ["+20 收到"] } }), thread: null, replyTo: null, columns: 80, t })), ["section:钱包", "text:余额 86", "text:+20 收到"]);
  assert.match(gemsbangRows({ tab: "wallet", status: im(), thread: null, replyTo: null, columns: 80, t })[0].text, /^钱包还没同步过来/);
  assert.deepEqual(kinds(gemsbangRows({ tab: "messages", status: null, thread: null, replyTo: null, columns: 80, t })), ["text:正在读取消息…"]);
  const setup = gemsbangRows({ tab: "tasks", status: { ...im(), configured: false }, thread: null, replyTo: null, columns: 80, t });
  assert.deepEqual([setup[0].text, setup[2].text, setup.at(-1).items[0].action], ["还没连上中继", "gemworks connect setup --relay <url> --token <token>\ngemworks connect", { op: "im-refresh" }]);
});

test("the settings: whose words this session speaks (the chosen one, else the first), the relay with its last sync and what waits, 重连, the phone's code, the language, 完成", () => {
  const rows = gemsbangSettingsRows({ status: im({ outbox: 2 }), settings: { ...DEFAULT_SETTINGS, im: { agent: "xiaoguan" } }, locale: "zh_CN.UTF-8", phoneCode: "482913", columns: 100, t });
  assert.deepEqual(rows.filter((r) => r.kind === "section").map((r) => r.text), ["本会话代谁说话", "中继", "手机", "语言"]);
  assert.deepEqual(rows.filter((r) => r.kind === "button").map((r) => [r.label, r.primary === true, r.action]), [["( ) xiaoping · 空闲", false, { op: "setting", key: "im.agent", value: "xiaoping" }], ["(•) xiaoguan · 睡着", true, { op: "setting", key: "im.agent", value: "xiaoguan" }]]);
  assert.ok(rows.some((r) => r.kind === "text" && r.text === `relay.test · john · ${hhmm("2026-11-01T05:09:00Z")} 同步过 · 待发 2`));
  const presses = rows.filter((r) => r.kind === "buttons").flatMap((r) => r.items);
  assert.deepEqual(presses.map((b) => b.key), ["im-sync", "im-phone-code", "lang-system", "lang-zh", "lang-en", "lang-ja", "settings-done"]);
  assert.equal(presses.find((b) => b.key === "lang-system").primary, true);
  assert.deepEqual(presses.at(-1).action, { op: "dialog", dialog: null });
  assert.ok(rows.some((r) => r.kind === "text" && r.text === "绑定码 482913 · 十分钟内在 bot 里发 /bind 482913"));
  const first = gemsbangSettingsRows({ status: im({ connected: false, error: "ECONNREFUSED" }), settings: DEFAULT_SETTINGS, locale: undefined, phoneCode: null, columns: 100, t });
  assert.equal(first.find((r) => r.key === "im-agent-xiaoping").primary, true, "none chosen: the first");
  assert.ok(first.some((r) => r.kind === "text" && r.tone === "error" && r.text.includes("连不上")));
  assert.ok(first.some((r) => r.kind === "text" && r.text === "ECONNREFUSED"));
  const none = gemsbangSettingsRows({ status: { ...im(), configured: false }, settings: DEFAULT_SETTINGS, locale: undefined, phoneCode: null, columns: 100, t });
  assert.deepEqual(none.filter((r) => r.kind === "buttons").flatMap((r) => r.items).map((b) => b.key), ["lang-system", "lang-zh", "lang-en", "lang-ja", "settings-done"], "no relay: no 重连 and no code");
});

test("the about dialog: the mark, what it is, its version, beside gemworks, the licence, the repository", () => {
  const rows = gemsbangAboutRows("0.5.0", t);
  assert.deepEqual([rows[0].kind, rows[0].svg, rows.at(-1).href], ["image", GEMSBANG_MARK_SVG, "https://github.com/geml-spec/gemsbang"]);
  assert.ok(rows.some((r) => r.kind === "text" && r.text === "插件 gemsbang 0.5.0"));
  assert.match(GEMSBANG_MARK_SVG, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
});
