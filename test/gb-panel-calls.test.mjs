import { test } from "node:test";
import assert from "node:assert/strict";
import { gbBand, paneRows } from "../dist/hosts/claude-code/gb-panel.js";

const JOHN = { id: "a-0000000001", name: "John", color: "#2f6fb3", initial: "J", venues: ["设置页改版", "前端周会"], mark: true, muted: false, autos: [] };
const LILY = { id: "a-0000000002", name: "Lily 爸爸", color: "#b5543c", initial: "L", venues: ["三年二班家长"], mark: false, muted: false, autos: [] };
const NOW = "2026-11-02T12:00:00Z";
const CALL = (group, avatar, at, extra = {}) => ({ avatar: avatar.id, owner: avatar.id, id: `g-${group.length}00000000a`.slice(0, 12), kind: "group", group, lines: [{ id: "m-4", who: "李四", text: `@${avatar.name} 周五前能给稿子反馈吗？`, reason: "mention", at }], last: "m-4", at, auto: false, badge: avatar, muted: false, ...extra });
const NEED = (id, at, extra = {}) => ({ id, avatar: LILY.id, kind: "promise", summary: "王老师问周五能不能来当志愿者", options: [{ label: "能去", text: "周五我可以去" }, { label: "去不了" }], at, state: "open", avatarName: "Lily 爸爸", group: "三年二班家长", badge: LILY, muted: false, venue: { owner: "a-00000000c1", id: "g-000000000b" }, ...extra });
const VIEW = (extra = {}) => ({ relay: "https://im.example", trusted: [], loggedIn: true, lang: "zh", avatars: [JOHN, LILY], rows: [], unread: 0, needs: [], calls: [], muted: { avatars: [], venues: [] }, notes: [], bodies: {}, ...extra });
const STATE = (extra = {}) => ({ page: "inbox", filter: null, chat: null, link: null, phone: null, groupAs: "new", session: "s-1", problem: null, zoneMinutes: 480, now: NOW, ...extra });
const cards = (rows) => rows.filter((r) => r.kind === "need" || r.kind === "section" || r.kind === "buttons").map((r) => r.kind === "need" ? `${r.head}|${r.expires}|${r.summary}|${r.options.map((o) => o.label).join("/")}` : r.kind === "section" ? r.text : r.items.map((i) => `[${i.label}]`).join(""));

test("被叫到 in the inbox (architecture §6.3): a card per chat — whose avatar, where, when, the lines that called it — with 回, 以后这个群自动回, 不回; with 需要你's cards, errors first, then the newest; two whole, more folded; a chat that answers on its own asks nothing", () => {
  const rows = paneRows(VIEW({ calls: [CALL("前端周会", JOHN, "2026-11-02T11:40:00Z"), CALL("设置页改版", JOHN, "2026-11-02T06:11:00Z", { auto: true })], needs: [NEED("need-1", "2026-11-02T11:31:00Z"), NEED("need-2", "2026-11-02T06:05:00Z", { kind: "error", summary: "这个会话在别的仓库" })] }), STATE());
  assert.deepEqual(cards(rows).slice(0, 4), [
    "需要你 3",
    "Lily 爸爸 · 出错 · 来自「三年二班家长」|14:05|这个会话在别的仓库|能去/去不了",
    "John · 被叫到 · 来自「前端周会」|19:40|李四：@John 周五前能给稿子反馈吗？|回/以后这个群自动回/不回",
    "[还有 1 件]",
  ]);
  const press = rows.find((r) => r.key.startsWith("call-inbox")).options.map((o) => o.action);
  assert.deepEqual(press, ["reply", "auto", "no"].map((choice) => ({ op: "wake", avatar: JOHN.id, owner: JOHN.id, id: "g-400000000a", choice })));
  const dm = paneRows(VIEW({ calls: [CALL("王老师", LILY, "2026-11-02T11:00:00Z", { kind: "dm", lines: [{ id: "m-1", who: "王老师", text: "a", reason: "dm", at: "" }, { id: "m-2", who: "王老师", text: "b", reason: "dm", at: "" }, { id: "m-3", who: "王老师", text: "c", reason: "dm", at: "" }, { id: "m-4", who: "王老师", text: "d", reason: "dm", at: "" }] })] }), STATE()).find((r) => r.kind === "need");
  assert.deepEqual([dm.summary, dm.options[1].label], ["还有 1 处更早的\n王老师：b\n王老师：c\n王老师：d", "以后这个私聊自动回"], "the last three lines; a two-person chat's own words");
  assert.deepEqual(cards(paneRows(VIEW({ calls: [CALL("前端周会", JOHN, "2026-11-02T11:40:00Z", { muted: true })] }), STATE())), ["需要你 0", "[静音的 1 件]", "[建群]"]);
});

test("被叫到 in its chat, on the band and in 我的分身 (architecture §6.3): the chat's card says only the person sees it and what 回 does; the band, with no card waiting, names the newest call with 回 and 不回; 我的分身 says it asks first and lists the chats that answer on their own, each with 撤", () => {
  const call = CALL("前端周会", JOHN, "2026-11-02T11:40:00Z");
  const chat = { owner: call.owner, id: call.id, kind: "group", name: "前端周会", count: 6, as: JOHN, earlier: 0, isOwner: true, items: [] };
  const row = paneRows(VIEW({ calls: [call] }), STATE({ page: "chat", chat })).find((r) => r.kind === "need");
  assert.deepEqual([row.head, row.checked.slice(0, 18)], ["只有你看得见 · 被叫到 · 分身还没回", "点「回」，它在后台读完这里的消息再回"]);
  const band = gbBand(VIEW({ calls: [call] }), null, NOW);
  assert.deepEqual([band.text, band.actions.map((a) => a.label), band.actions[0].action, band.more], ["被叫到 · 前端周会 · 李四：@John 周五前能给稿子反馈吗？", ["回", "不回"], { op: "wake", avatar: JOHN.id, owner: JOHN.id, id: call.id, choice: "reply" }, 0]);
  assert.equal(gbBand(VIEW({ calls: [call], needs: [NEED("need-1", "2026-11-02T11:31:00Z")] }), null, NOW).more, 1, "a card first; the call counted");
  const mine = paneRows(VIEW({ avatars: [{ ...JOHN, autos: [{ venue: "a-0000000001/g-000000000a", name: "设置页改版" }] }, LILY] }), STATE({ page: "avatars" }));
  assert.deepEqual(mine.filter((r) => r.key.startsWith("called-") || r.key.startsWith("auto-")).map((r) => r.kind === "buttons" ? r.items.map((i) => `[${i.label}]`).join("") : r.text), ["被叫到：先问你回不回", "自动回：设置页改版", "[撤「设置页改版」]", "被叫到：先问你回不回", "自动回：没有"]);
  assert.deepEqual(mine.find((r) => r.key === `auto-off-${JOHN.id}`).items[0].action, { op: "auto", avatar: JOHN.id, venue: "a-0000000001/g-000000000a", on: false });
});
