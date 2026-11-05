import { test } from "node:test";
import assert from "node:assert/strict";
import { BADGE_COLORS, badgesOf, chatOf, inboxOf, initialOf, itemsOf, timeLabel, unreadOf, whoSaid } from "../dist/core/avatar/inbox.js";

const JOHN = "a-0000000001", LILY = "a-0000000002", LI = "a-00000000b1", WANG = "a-00000000c1";
const msg = (id, speaker, text, at, extra = {}) => ({ id, value: { speaker: `avatar:${speaker}`, text, at, ...extra } });
const MIRROR = {
  at: "2026-11-01T12:00:00Z", relay: "https://im.example", person: "p-0000000001", lang: "zh",
  avatars: [{ id: JOHN, name: "John" }, { id: LILY, name: "Lily 爸爸" }],
  venues: [
    { owner: JOHN, id: "g-000000000a", kind: "group", name: "设置页改版", as: JOHN, members: [{ id: JOHN, name: "John" }, { id: LI, name: "李四" }], blocks: [
      { id: "venue", value: { kind: "group" } },
      { id: "member-1", value: { avatar: `avatar:${JOHN}`, at: "2026-11-01T05:00:00Z" } },
      { id: "member-2", value: { avatar: `avatar:${LI}`, at: "2026-11-01T05:01:00Z" } },
      msg("m-1", LI, "v4 稿子在这", "2026-11-01T06:02:00Z", { by: "agent" }),
      msg("m-2", JOHN, "收到", "2026-11-01T06:03:00Z", { by: "person" }),
      msg("m-3", LI, "@John Safari 里导出按钮没反应", "2026-11-01T06:05:00Z"),
    ] },
    { owner: WANG, id: "g-000000000b", kind: "group", name: "三年二班家长", as: LILY, members: [{ id: WANG, name: "王老师" }, { id: LILY, name: "Lily 爸爸" }], blocks: [
      msg("m-9", WANG, "周五春游要志愿者", "2026-11-01T11:20:00Z"),
      msg("m-10", LILY, "我看一下，晚点回。", "2026-11-01T11:31:00Z", { by: "agent" }),
    ] },
    { owner: JOHN, id: "d-000000000c", kind: "dm", name: "李四", as: JOHN, members: [{ id: JOHN, name: "John" }, { id: LI, name: "李四" }], blocks: [
      msg("m-1", LI, "周五前能给稿子反馈吗？", "2026-10-31T09:00:00Z"),
    ] },
  ],
};

test("avatars' badges (spec §7.1): a colour each in the order they grew, and the first letter of the name", () => {
  assert.equal(initialOf("lily"), "L");
  assert.equal(initialOf(" 乐乐妈妈"), "乐");
  assert.equal(initialOf(""), "?");
  const b = badgesOf(Array.from({ length: 7 }, (_, i) => ({ id: `a-00000000${String(i).padStart(2, "0")}`, name: `n${i}` })));
  assert.deepEqual(b.map((x) => x.color), [...BADGE_COLORS, BADGE_COLORS[0]], "six colours, then round again");
});

test("a chat's lines (spec §7.2): what was said and who came in, oldest first; the person's own lines; `身份` where an agent said it; who said the last line as the inbox names it", () => {
  const items = itemsOf(MIRROR.venues[0]);
  assert.deepEqual(items.map((i) => [i.kind, i.who]), [["joined", "John"], ["joined", "李四"], ["message", "李四"], ["message", "John"], ["message", "李四"]]);
  assert.deepEqual(items.slice(2).map((i) => [i.mark, i.mine]), [[true, false], [false, true], [false, false]]);
  const lily = itemsOf(MIRROR.venues[1]);
  assert.equal(whoSaid(lily[1], "zh"), "你的身份");
  assert.equal(whoSaid(items[3], "en"), "You");
  assert.equal(whoSaid(items[4], "zh"), "李四");
  assert.equal(unreadOf(items, undefined), 2, "nothing seen: every line of the others");
  assert.equal(unreadOf(items, "m-2"), 1);
  assert.equal(unreadOf(items, "m-3"), 0);
});

test("times in the list (spec §7.1): today's as HH:MM in the person's zone, yesterday, a weekday within the week, else month/day", () => {
  const now = "2026-11-01T12:00:00Z";
  assert.equal(timeLabel("2026-11-01T06:03:00Z", now, "zh", 480), "14:03");
  assert.equal(timeLabel("2026-10-31T09:00:00Z", now, "zh", 480), "昨天");
  assert.equal(timeLabel("2026-10-31T09:00:00Z", now, "en", 480), "Yesterday");
  assert.equal(timeLabel("2026-10-27T09:00:00Z", now, "zh", 480), "周二");
  assert.equal(timeLabel("2026-10-27T09:00:00Z", now, "ja", 480), "火曜");
  assert.equal(timeLabel("2026-10-01T09:00:00Z", now, "zh", 480), "10/1");
  assert.equal(timeLabel("2026-10-31T17:00:00Z", now, "zh", 480), "01:00", "past midnight in Shanghai is today there");
  assert.equal(timeLabel("not a time", now, "zh"), "");
});

test("the total inbox (spec §7.1): every chat of every avatar newest first, each with its avatar's badge, its last line and who said it, its time and its unread; only one avatar's when asked; the unread of all either way", () => {
  const box = inboxOf(MIRROR, { [`${JOHN}/g-000000000a`]: "m-2" }, "2026-11-01T12:00:00Z", { zoneMinutes: 480 });
  assert.deepEqual(box.rows.map((r) => [r.name, r.as.name, r.as.initial, r.last?.who, r.last?.text, r.time, r.unread]), [
    ["三年二班家长", "Lily 爸爸", "L", "你的身份", "我看一下，晚点回。", "19:31", 1],
    ["设置页改版", "John", "J", "李四", "@John Safari 里导出按钮没反应", "14:05", 1],
    ["李四", "John", "J", "李四", "周五前能给稿子反馈吗？", "昨天", 1],
  ]);
  assert.equal(box.unread, 3);
  assert.deepEqual(box.badges.map((b) => b.name), ["John", "Lily 爸爸"]);
  const lily = inboxOf(MIRROR, {}, "2026-11-01T12:00:00Z", { only: LILY });
  assert.deepEqual(lily.rows.map((r) => r.name), ["三年二班家长"]);
  assert.equal(lily.unread, 4, "the count is all of them, whatever the filter");
  const chat = chatOf(MIRROR.venues[0], MIRROR, 2);
  assert.deepEqual([chat.name, chat.count, chat.as.name, chat.items.map((i) => i.id), chat.earlier], ["设置页改版", 2, "John", ["m-2", "m-3"], 3]);
});

test("the avatar the person last spoke as (Q1, S21): their own newest line, else any of their avatars' newest, else their first; none without avatars", async () => {
  const { recentAvatar } = await import("../dist/core/avatar/inbox.js");
  const line = (id, speaker, by, at) => ({ id, value: { speaker: `avatar:${speaker}`, by, text: "x", at } });
  const m = (venues, avatars = [{ id: "a-1", name: "John" }, { id: "a-2", name: "Lily 爸爸" }]) => ({ at: "", relay: "", person: "p", lang: "zh", avatars, venues });
  const v = (blocks) => ({ owner: "o", id: "g", kind: "group", name: "g", members: [], as: "a-1", blocks });
  assert.equal(recentAvatar(m([v([line("m-1", "a-1", "person", "2026-11-01T01:00:00Z")]), v([line("m-2", "a-2", "person", "2026-11-01T02:00:00Z"), line("m-3", "a-1", "agent", "2026-11-01T03:00:00Z")])])), "a-2", "the person's own line counts before an agent's");
  assert.equal(recentAvatar(m([v([line("m-3", "a-2", "agent", "2026-11-01T03:00:00Z"), line("m-4", "b-9", "person", "2026-11-01T04:00:00Z")])])), "a-2", "no line of their own: any of theirs; someone else's never");
  assert.equal(recentAvatar(m([])), "a-1", "nothing said: the first");
  assert.equal(recentAvatar(m([], [])), undefined);
});

test("a two-person chat begun from a link (S37): one line says how, to each of the two in their own words, and no one 加入了群聊; until anyone speaks it is the chat list's last line, with no speaker", () => {
  const begun = (as, name, other) => ({ owner: LI, id: "d-000000000d", kind: "dm", name, as, members: [{ id: LI, name: "李四" }, { id: JOHN, name: "John" }], blocks: [
    { id: "venue", value: { kind: "dm", by: `avatar:${other}`, at: "2026-11-01T07:00:00Z", via: "link" } },
    { id: "member-1", value: { avatar: `avatar:${JOHN}`, at: "2026-11-01T07:00:00Z" } },
    { id: "member-2", value: { avatar: `avatar:${LI}`, at: "2026-11-01T07:00:00Z" } },
  ] });
  const owner = begun(JOHN, "李四", LI), joiner = begun(JOHN, "李四", JOHN);
  assert.deepEqual(itemsOf(owner).map((i) => [i.kind, i.who, i.mine]), [["began", "李四", false]], "John's link, 李四 opened it");
  assert.deepEqual(itemsOf(joiner).map((i) => [i.kind, i.mine]), [["began", true]], "John opened 李四's link");
  const row = (v) => inboxOf({ ...MIRROR, venues: [v] }, {}, "2026-11-01T12:00:00Z", { zoneMinutes: 480 }).rows[0].last;
  assert.deepEqual(row(owner), { who: "", text: "李四 通过你的邀请链接发起了私聊" });
  assert.deepEqual(row(joiner), { who: "", text: "你通过邀请链接与 李四 发起了私聊" });
  const said = { ...owner, blocks: [...owner.blocks, msg("m-1", LI, "你好", "2026-11-01T07:01:00Z")] };
  assert.deepEqual(row(said), { who: "李四", text: "你好" }, "once someone speaks, the last line is theirs");
  const plain = MIRROR.venues[2];
  assert.equal(itemsOf({ ...plain, blocks: [{ id: "venue", value: { kind: "dm", by: `avatar:${JOHN}`, at: "2026-10-31T08:00:00Z" } }, { id: "member-1", value: { avatar: `avatar:${JOHN}`, at: "2026-10-31T08:00:00Z" } }, ...plain.blocks] }).some((i) => i.kind !== "message"), false, "a chat opened from 联系人 says nothing of how");
});

test("members brought in by another (S38): a run of them by the same one is one item, who came in by themself stays 加入了群聊; until anyone speaks the chat list's last line says it, with no speaker", () => {
  const v = { owner: JOHN, id: "g-000000000e", kind: "group", name: "John、Lily 爸爸、王五", as: LILY, members: [{ id: JOHN, name: "John" }, { id: LILY, name: "Lily 爸爸" }, { id: WANG, name: "王五" }, { id: LI, name: "李四" }], blocks: [
    { id: "venue", value: { kind: "group", by: `avatar:${JOHN}` } },
    { id: "member-1", value: { avatar: `avatar:${JOHN}`, by: `avatar:${JOHN}`, at: "2026-11-01T07:00:00Z" } },
    { id: "member-2", value: { avatar: `avatar:${LILY}`, by: `avatar:${JOHN}`, via: "invite", at: "2026-11-01T07:00:01Z" } },
    { id: "member-3", value: { avatar: `avatar:${WANG}`, by: `avatar:${JOHN}`, via: "invite", at: "2026-11-01T07:00:02Z" } },
  ] };
  assert.deepEqual(itemsOf(v).map((i) => [i.kind, i.kind === "invited" ? i.names : i.who]), [["joined", "John"], ["invited", ["Lily 爸爸", "王五"]]]);
  const row = (venue) => inboxOf({ ...MIRROR, venues: [venue] }, {}, "2026-11-01T12:00:00Z", { zoneMinutes: 480 }).rows[0].last;
  assert.deepEqual(row(v), { who: "", text: "John 邀请你、王五加入了群聊" }, "to the one brought in");
  assert.deepEqual(row({ ...v, as: JOHN }), { who: "", text: "你邀请Lily 爸爸、王五加入了群聊" }, "to John");
  const later = { ...v, blocks: [...v.blocks, msg("m-1", JOHN, "大家好", "2026-11-01T07:01:00Z"), { id: "member-4", value: { avatar: `avatar:${LI}`, by: `avatar:${LI}`, at: "2026-11-01T07:02:00Z" } }] };
  assert.deepEqual(itemsOf(later).map((i) => i.kind), ["joined", "invited", "message", "joined"], "by a link: 加入了群聊, as before");
  const letIn = { ...v, blocks: [...v.blocks, { id: "member-4", value: { avatar: `avatar:${LI}`, by: `avatar:${JOHN}`, at: "2026-11-01T07:02:00Z" } }] };
  assert.equal(itemsOf(letIn).at(-1).kind, "joined", "let in by the 群主 on a request: 加入了群聊, not 邀请");
});
