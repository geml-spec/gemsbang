import { test } from "node:test";
import assert from "node:assert/strict";
import { fieldAction, gbBand, paneRows } from "../dist/hosts/claude-code/gb-panel.js";

const LILY = { id: "a-0000000002", name: "Lily 爸爸", color: "#b5543c", initial: "L", venues: ["三年二班家长"], mark: false, muted: false };
const NOW = "2026-11-01T09:00:00Z";
const need = (id, kind, extra = {}) => ({ id, avatar: LILY.id, kind, summary: `${kind} ${id}`, options: kind === "borrow" ? [{ label: "立即执行" }, { label: "稍后执行" }, { label: "拒绝" }] : [{ label: "能去", text: "周五我可以去" }, { label: "去不了", text: "去不了" }], at: NOW, state: "open", avatarName: "Lily 爸爸", group: "三年二班家长", badge: LILY, muted: false, venue: { owner: "a-00000000c1", id: "g-000000000b" }, ...extra });
const VIEW = (needs, extra = {}) => ({ relay: "https://im.example", trusted: [], loggedIn: true, lang: "zh", avatars: [LILY], rows: [], unread: 0, needs, muted: { avatars: [], venues: [] }, notes: [], bodies: {}, ...extra });
const STATE = (extra = {}) => ({ page: "inbox", chat: null, link: null, phone: null, groupAs: "new", session: "s-1", problem: null, now: NOW, ...extra });
/** 三年二班家长, where the cards are, and 前端周会, newer, where nothing waits. */
const ROWS = [
  { owner: "a-00000000c9", id: "g-00000000zz", kind: "group", name: "前端周会", as: LILY, last: { who: "王五", text: "hi" }, at: "2026-11-01T08:30:00Z", time: "16:30", unread: 0 },
  { owner: "a-00000000c1", id: "g-000000000b", kind: "group", name: "三年二班家长", as: LILY, last: { who: "王老师", text: "周五春游能来吗" }, at: "2026-11-01T08:00:00Z", time: "16:00", unread: 1 },
];
const CHAT = { owner: "a-00000000c1", id: "g-000000000b", kind: "group", name: "三年二班家长", count: 12, as: LILY, earlier: 0, isOwner: false, items: [] };

test("需要你 in its chat (spec §7.3, S11, S15, direction ①): no block in the inbox — the chat a card is about comes first, its last line after [待确认]; in the chat, the bar above the box, one at a time, the oldest first with 还有 N 项待处理: whose and what kind, how long it still waits when the matter has a deadline, what it checked, the words it would send, the options and 自定义回复; a card with no chat waits at the head of the inbox, a muted one not", () => {
  const inbox = paneRows(VIEW([need("need-1", "promise")], { rows: ROWS }), STATE());
  assert.deepEqual(inbox.filter((r) => r.kind === "chat").map((r) => [r.row.name, r.flag]), [["三年二班家长", "[待确认]"], ["前端周会", undefined]], "the chat it is about first, its words in red");
  assert.equal(inbox.some((r) => r.kind === "need" || r.kind === "section"), false, "no 需要你 block");
  const rows = paneRows(VIEW([need("need-1", "promise", { checked: "你周五下午是空的", draft: "周五我可以去", at: "2026-11-01T08:00:00Z" }), need("need-2", "pay", { expires: "2026-11-01T20:30:00Z" })]), STATE({ page: "chat", chat: CHAT }));
  assert.deepEqual(rows.slice(-2).map((r) => r.kind), ["need", "input"], "the bar, above the box");
  assert.equal(rows.filter((r) => r.kind === "need").length, 1, "one at a time");
  const bar = rows.at(-2);
  assert.deepEqual([bar.label, bar.more, bar.checked, bar.willSay, bar.quote, bar.options.map((o) => o.label), bar.own.target, bar.own.label, bar.own.writing, bar.tint, bar.body, bar.line], ["Lily 爸爸 · 承诺", "还有 1 项待处理", "依据：你周五下午是空的", "拟发送：「周五我可以去」", "拟发送：「周五我可以去」", ["能去", "去不了"], `${LILY.id}/need-1`, "自定义回复", false, "ask", [[{ text: "promise need-1你周五下午是空的" }]], undefined]);
  assert.equal(paneRows(VIEW([need("need-1", "promise")]), STATE({ page: "chat", chat: CHAT, writing: bar.key })).find((r) => r.kind === "need").own.writing, true, "自定义回复 opens its field");
  const pay = paneRows(VIEW([need("need-2", "pay", { expires: "2026-11-01T20:30:00Z" })]), STATE({ page: "chat", chat: CHAT })).find((r) => r.kind === "need");
  assert.deepEqual([pay.label, pay.expires, pay.more], ["Lily 爸爸 · 付款 · 11 小时后过期", "11 小时后过期", undefined], "a deadline of its own");
  assert.equal(paneRows(VIEW([need("need-1", "promise", { state: "expired" })]), STATE({ page: "chat", chat: CHAT })).some((r) => r.kind === "need"), false, "past its deadline it leaves the bar: its avatar said so in the chat");
  const loose = paneRows(VIEW([need("need-8", "error", { venue: undefined }), need("need-9", "error", { venue: undefined, muted: true })]), STATE());
  assert.deepEqual(loose.filter((r) => r.kind === "need").map((r) => r.summary), ["error need-8"], "no chat to stand in: at the head of the inbox");
});

test("a borrow's bar (spec §7.4, S16) has its three options and two switches — the group's only in a group — no 自定义回复; 立即执行 carries the switches set; 静音 is in 群信息", () => {
  const b = paneRows(VIEW([need("need-1", "borrow")]), STATE({ page: "chat", chat: CHAT, allow: { "need-1": { person: true } } })).find((r) => r.kind === "need");
  assert.deepEqual(b.toggles.map((t) => [t.label, t.on]), [["此人的任务不再确认", true], ["此群的任务不再确认", false]]);
  assert.deepEqual(b.options[0].action, { op: "answer", avatar: LILY.id, need: "need-1", choice: 0, allowPerson: true });
  assert.deepEqual(b.options[1].action, { op: "answer", avatar: LILY.id, need: "need-1", choice: 1 });
  assert.equal(b.own, undefined);
  const dm = paneRows(VIEW([need("need-1", "borrow")]), STATE({ page: "chat", chat: { ...CHAT, kind: "dm" } })).find((r) => r.kind === "need");
  assert.deepEqual(dm.toggles.map((t) => t.label), ["此人的任务不再确认"], "a two-person chat has no group to stop asking for");
  assert.equal(paneRows(VIEW([need("need-1", "borrow")], { rows: ROWS }), STATE()).find((r) => r.kind === "chat").flag, "[任务]");
  const rows = paneRows(VIEW([need("need-1", "promise")]), STATE({ page: "chat", chat: CHAT }));
  assert.deepEqual(rows[0].open, { op: "page", page: "info" }, "静音 is in 群信息 now (Q17)");
  const info = paneRows(VIEW([], { muted: { avatars: [], venues: ["a-00000000c1/g-000000000b"] } }), STATE({ page: "info", chat: CHAT })).find((r) => r.kind === "menu");
  assert.deepEqual(info.items.find((i) => i.key === "info-mute"), { key: "info-mute", label: "消息免打扰", on: true, action: { op: "mute", venue: "a-00000000c1/g-000000000b", on: false } });
});

test("the band (transport §4, S12): the first card not muted and still waiting, its options as presses (none for a borrow: it opens the pane), how many more; when nothing waits, the name and how many chats have something new, the muted not counted; 自定义回复 and the waiting line's template from their fields", () => {
  const band = gbBand(VIEW([need("need-1", "error", { options: [{ label: "查看原因" }, { label: "重试" }], summary: "身体连不上" }), need("need-2", "promise"), need("need-3", "pay", { muted: true })]), null, NOW);
  assert.deepEqual([band.text, band.tone, band.actions.map((a) => a.label), band.more], ["异常 · 身体连不上", "error", ["查看原因", "重试"], 1]);
  assert.deepEqual(band.actions[1].action, { op: "answer", avatar: LILY.id, need: "need-1", choice: 1 });
  assert.deepEqual(gbBand(VIEW([need("need-1", "borrow")]), null, NOW).actions, []);
  assert.equal(gbBand(VIEW([need("need-1", "promise", { expires: "2026-11-01T08:59:00Z" })]), null, NOW).text, "GemsBang", "past its time: no longer on the line");
  assert.deepEqual(gbBand(VIEW([]), null, NOW), { text: "GemsBang", tone: "dim", open: "打开", actions: [], more: 0 });
  const two = [...ROWS, { ...ROWS[0], id: "g-00000000yy", name: "读书会", unread: 4 }];
  assert.deepEqual([gbBand(VIEW([], { rows: two }), null, NOW).text, gbBand(VIEW([], { rows: ROWS }), null, NOW).text], ["GemsBang · 2 个聊天有新消息", "GemsBang · 1 个聊天有新消息"]);
  assert.equal(gbBand(VIEW([], { rows: ROWS, lang: "en" }), null, NOW).text, "GemsBang · new messages in 1 chat");
  assert.equal(gbBand(VIEW([], { rows: ROWS, muted: { avatars: [], venues: ["a-00000000c1/g-000000000b"] } }), null, NOW).text, "GemsBang", "a muted chat's unread is a grey dot: not counted");
  assert.equal(gbBand(null, null, NOW), undefined, "nothing read yet: no line");
  const s = { chat: null, phone: null, groupAs: "new" };
  assert.deepEqual(fieldAction("need-own", "我三点到", s, `${LILY.id}/need-1`), { call: "answer", args: { avatar: LILY.id, need: "need-1", choice: "own", text: "我三点到" } });
  assert.equal(fieldAction("placeholder", "收到，稍后回", s, LILY.id), undefined, "no waiting line to set");
});

test("nobody signed in (Q14): the line above the prompt says so in the first session after the install alone; later sessions have no line, the pane says it when opened; a view from an older bridge, which kept no first session, still says it", () => {
  const out = VIEW([], { loggedIn: false, firstSession: "s-1" });
  assert.deepEqual([gbBand(out, null, NOW, "s-1").text, gbBand(out, null, NOW, "s-2")], ["GemsBang 未登录", undefined]);
  assert.equal(gbBand(VIEW([], { loggedIn: false }), null, NOW, "s-2").text, "GemsBang 未登录");
  assert.equal(gbBand(out, "GemsBang：暂时没应答", NOW, "s-2").tone, "error", "a problem is said everywhere");
});
