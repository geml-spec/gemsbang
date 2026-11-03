import { test } from "node:test";
import assert from "node:assert/strict";
import { gbBand, paneRows } from "../dist/hosts/claude-code/gb-panel.js";

const JOHN = { id: "a-0000000001", name: "John", color: "#2f6fb3", initial: "J", venues: ["设置页改版", "前端周会"], mark: true, muted: false, autos: [] };
const LILY = { id: "a-0000000002", name: "Lily 爸爸", color: "#b5543c", initial: "L", venues: ["三年二班家长"], mark: false, muted: false, autos: [] };
const NOW = "2026-11-02T12:00:00Z";
const CALL = (group, avatar, at, extra = {}) => ({ avatar: avatar.id, owner: avatar.id, id: `g-${group.length}00000000a`.slice(0, 12), kind: "group", group, lines: [{ id: "m-4", who: "李四", text: `@${avatar.name} 周五前能给稿子反馈吗？`, reason: "mention", at }], last: "m-4", at, auto: false, badge: avatar, muted: false, ...extra });
const NEED = (id, at, extra = {}) => ({ id, avatar: LILY.id, kind: "promise", summary: "王老师问周五能不能来当志愿者", options: [{ label: "能去", text: "周五我可以去" }, { label: "去不了" }], at, state: "open", avatarName: "Lily 爸爸", group: "三年二班家长", badge: LILY, muted: false, venue: { owner: "a-00000000c1", id: "g-000000000b" }, ...extra });
const VIEW = (extra = {}) => ({ relay: "https://im.example", trusted: [], loggedIn: true, lang: "zh", avatars: [JOHN, LILY], rows: [], unread: 0, needs: [], calls: [], muted: { avatars: [], venues: [] }, notes: [], bodies: {}, ...extra });
const STATE = (extra = {}) => ({ page: "inbox", chat: null, link: null, phone: null, groupAs: "new", session: "s-1", problem: null, zoneMinutes: 480, now: NOW, ...extra });
const ROW = (name, as, id, at, extra = {}) => ({ owner: as.id, id, kind: "group", name, as, last: { who: "李四", text: "hi" }, at, time: "", unread: 1, ...extra });
const CHAT = (call, extra = {}) => ({ owner: call.owner, id: call.id, kind: call.kind, name: call.group, count: 6, as: call.avatar === JOHN.id ? JOHN : LILY, earlier: 0, isOwner: true, items: [], ...extra });
const bar = (rows) => rows.filter((r) => r.kind === "need" || r.kind === "pending").map((r) => r.kind === "pending" ? `(${r.text})` : `${r.body.map((l) => l.map((x) => x.text).join("")).join("/")}|${r.options.map((o) => o.label).join("/")}${r.more !== undefined ? `|${r.more}` : ""}`);

test("被叫到 in the inbox (architecture §6.3, S11, S17, direction ①): no card there — the chat called comes first, its last line after [有人@我]; a two-person chat's call has no words, its unread says it; a chat that answers on its own asks nothing; a muted chat stays in its place, flagged still", () => {
  const front = CALL("前端周会", JOHN, "2026-11-02T11:40:00Z"), quiet = CALL("设置页改版", JOHN, "2026-11-02T06:11:00Z", { auto: true });
  const dm = CALL("王老师", LILY, "2026-11-02T11:00:00Z", { kind: "dm", id: "d-0000000001" });
  const rows = [ROW("小区业主群", LILY, "g-00000000xx", "2026-11-02T11:50:00Z"), ROW("设置页改版", JOHN, quiet.id, "2026-11-02T11:45:00Z"), ROW("前端周会", JOHN, front.id, "2026-11-02T11:40:00Z"), ROW("王老师", LILY, dm.id, "2026-11-02T11:00:00Z", { kind: "dm" })];
  const shown = (v) => paneRows(VIEW({ rows, ...v }), STATE()).filter((r) => r.kind === "chat").map((r) => `${r.row.name}${r.flag ?? ""}${r.muted ? "~" : ""}`);
  assert.deepEqual(shown({ calls: [front, quiet, dm] }), ["前端周会[有人@我]", "王老师", "小区业主群", "设置页改版"], "the called ones first, newest first among them; one answering on its own stays where it was");
  assert.equal(paneRows(VIEW({ rows, calls: [front] }), STATE()).some((r) => r.kind === "need"), false, "no card in the inbox");
  assert.deepEqual(shown({ calls: [front], muted: { avatars: [], venues: [`${JOHN.id}/${front.id}`] } }), ["小区业主群", "设置页改版", "前端周会[有人@我]~", "王老师"], "muted: in its place, the red words still there (S17)");
  assert.deepEqual(shown({ calls: [front], muted: { avatars: [JOHN.id], venues: [] } }).slice(1, 3), ["设置页改版~", "前端周会[有人@我]~"], "an avatar muted: all its chats");
});

test("被叫到 in its chat, on the band and in 我 (architecture §6.3, S14): the bar above the box on one line — who called and how often, the one step 交给 agent 回 (自动回 is 群信息's now) — and once handed to the agent a grey line, agent 在回…, while it answers; the band, with no card waiting, names the newest call with 交给 agent 回; 我 lists the chats that answer on their own, each with 撤", () => {
  const call = CALL("前端周会", JOHN, "2026-11-02T11:40:00Z");
  const rows = paneRows(VIEW({ calls: [call] }), STATE({ page: "chat", chat: CHAT(call) }));
  assert.deepEqual(bar(rows), ["李四 @ 了你|交给 agent 回"]);
  const it = rows.find((r) => r.kind === "need");
  assert.deepEqual([it.line, it.tint, it.options[0].action, rows.at(-1).kind], [true, "call", { op: "wake", avatar: JOHN.id, owner: JOHN.id, id: call.id, choice: "reply" }, "input"]);
  const twice = { ...call, lines: [...call.lines, { id: "m-5", who: "张三", text: "@John 在吗", reason: "mention", at: "2026-11-02T11:41:00Z" }, { id: "m-6", who: "李四", text: "@John ?", reason: "mention", at: "2026-11-02T11:42:00Z" }] };
  assert.deepEqual(bar(paneRows(VIEW({ calls: [twice] }), STATE({ page: "chat", chat: CHAT(call) }))), ["李四、张三 @ 了你 3 次|交给 agent 回"], "called again: one bar");
  const dm = CALL("王老师", LILY, "2026-11-02T11:00:00Z", { kind: "dm" });
  assert.deepEqual(bar(paneRows(VIEW({ calls: [dm] }), STATE({ page: "chat", chat: CHAT(dm) }))), ["李四 找你|交给 agent 回"]);
  const both = paneRows(VIEW({ calls: [call], needs: [NEED("need-1", "2026-11-02T11:31:00Z", { avatar: JOHN.id, venue: { owner: call.owner, id: call.id } })] }), STATE({ page: "chat", chat: CHAT(call) }));
  assert.deepEqual(bar(both), ["王老师问周五能不能来当志愿者|能去/去不了|还有 1 件"], "the oldest first, the rest counted");
  const handed = paneRows(VIEW({ calls: [] }), STATE({ page: "chat", chat: CHAT(call), replying: [`${call.owner}/${call.id}`] }));
  assert.deepEqual(bar(handed), ["(agent 在回…)"], "handed to the agent: one grey line while it answers");
  assert.deepEqual(bar(paneRows(VIEW({ calls: [] }), STATE({ page: "chat", chat: CHAT(call), replying: ["a-0000000009/g-000000009a"] }))), [], "another chat's answer is not this one's");
  const band = gbBand(VIEW({ calls: [call] }), null, NOW);
  assert.deepEqual([band.text, band.actions.map((a) => a.label), band.actions[0].action, band.more], ["被叫到 · 前端周会 · 李四：@John 周五前能给稿子反馈吗？", ["交给 agent 回"], { op: "wake", avatar: JOHN.id, owner: JOHN.id, id: call.id, choice: "reply" }, 0]);
  assert.equal(gbBand(VIEW({ calls: [call], needs: [NEED("need-1", "2026-11-02T11:31:00Z")] }), null, NOW).more, 1, "a card first; the call counted");
  const mine = paneRows(VIEW({ avatars: [{ ...JOHN, autos: [{ venue: "a-0000000001/g-000000000a", name: "设置页改版" }] }, LILY] }), STATE({ page: "avatars" }));
  const lines = mine.filter((r) => r.kind === "card" && r.badge !== undefined).flatMap((r) => r.lines).filter((x) => x.key.startsWith("called-") || x.key.startsWith("auto-"));
  assert.deepEqual(lines.map((x) => `${x.label}：${x.value}${(x.presses ?? []).map((p) => `[${p.label}]`).join("")}`), ["自动回：设置页改版[撤]", "自动回：没有"], "no 被叫到 line: asking first is what a call is; one chat alone, just 撤 (P8a)");
  const two = paneRows(VIEW({ avatars: [{ ...JOHN, autos: [{ venue: "a-0000000001/g-000000000a", name: "设置页改版" }, { venue: "a-0000000001/g-000000000b", name: "前端周会" }] }, LILY] }), STATE({ page: "avatars" }));
  assert.deepEqual(two[1].lines.find((x) => x.key.startsWith("auto-")).presses.map((p) => p.label), ["撤「设置页改版」", "撤「前端周会」"], "two, each named");
  assert.deepEqual(lines[0].presses[0].action, { op: "auto", avatar: JOHN.id, venue: "a-0000000001/g-000000000a", on: false });
});

test("自动回 (S14, direction ①): a switch in 群信息 beside 静音, what it does said under it; on a two-person chat's head, beside 静音", () => {
  const call = CALL("前端周会", JOHN, "2026-11-02T11:40:00Z");
  const venue = `${call.owner}/${call.id}`;
  const menu = (avatars) => paneRows(VIEW({ avatars }), STATE({ page: "info", chat: CHAT(call) })).find((r) => r.kind === "menu").items.find((i) => i.key === "info-auto");
  assert.deepEqual(menu([JOHN, LILY]), { key: "info-auto", label: "自动回", hint: "有人叫到 John，交给 agent 回，不再问你；五种事照样问你", on: false, action: { op: "auto", avatar: JOHN.id, venue, on: true } });
  assert.deepEqual([menu([{ ...JOHN, autos: [{ venue, name: "前端周会" }] }, LILY]).on, menu([{ ...JOHN, autos: [{ venue, name: "前端周会" }] }, LILY]).action.on], [true, false]);
  const dm = CALL("王老师", LILY, "2026-11-02T11:00:00Z", { kind: "dm" });
  const head = paneRows(VIEW(), STATE({ page: "chat", chat: CHAT(dm) }))[0];
  assert.deepEqual(head.actions.map((a) => [a.label, a.action]), [["静音", { op: "mute", venue: `${dm.owner}/${dm.id}`, on: true }], ["自动回", { op: "auto", avatar: LILY.id, venue: `${dm.owner}/${dm.id}`, on: true }]]);
});

test("an avatar no open session plays (B1 of the 2026-11-03 review): a chat set to answer on its own asks the person as any call does, and says why; a task's bar says so too", () => {
  const call = CALL("设置页改版", LILY, "2026-11-02T11:40:00Z", { unplayed: true });
  assert.deepEqual(bar(paneRows(VIEW({ calls: [call] }), STATE({ page: "chat", chat: CHAT(call) }))), ["李四 @ 了你/现在没有会话在演它|交给 agent 回"]);
  assert.equal(gbBand(VIEW({ calls: [call] }), null, NOW).actions[0].label, "交给 agent 回", "on the band too");
  const task = NEED("need-9", "2026-11-02T11:31:00Z", { kind: "borrow", summary: "张三派了个任务", options: [{ label: "现在干" }, { label: "排着" }, { label: "不干" }], unplayed: true, venue: { owner: call.owner, id: call.id } });
  assert.deepEqual(paneRows(VIEW({ needs: [task] }), STATE({ page: "chat", chat: CHAT(call) })).find((r) => r.kind === "need").body.at(-1), [{ text: "现在没有会话在演它" }]);
});

test("a call whose round failed (B3 of the 2026-11-03 review): its bar is back with why, in red, the one step offered again; the band says it as an error", () => {
  const call = CALL("设置页改版", JOHN, "2026-11-02T11:40:00Z", { failed: "aborted" });
  const rows = paneRows(VIEW({ calls: [call] }), STATE({ page: "chat", chat: CHAT(call) }));
  assert.deepEqual([bar(rows), rows.find((r) => r.kind === "need").tone], [["agent 没回成：被停下了|交给 agent 回"], "error"]);
  const band = gbBand(VIEW({ calls: [CALL("设置页改版", JOHN, "2026-11-02T11:40:00Z", { failed: "notSent" })] }), null, NOW);
  assert.deepEqual([band.text, band.tone, band.actions.map((a) => a.label)], ["被叫到 · 设置页改版 · agent 没回成：话没发出去", "error", ["交给 agent 回"]]);
  assert.equal(gbBand(VIEW({ calls: [CALL("设置页改版", JOHN, "2026-11-02T11:40:00Z")] }), null, NOW).tone, "plain");
});
