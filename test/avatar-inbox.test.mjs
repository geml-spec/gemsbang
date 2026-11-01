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

test("a chat's lines (spec §7.2): what was said and who came in, oldest first; the person's own lines; `分身` where an agent said it; who said the last line as the inbox names it", () => {
  const items = itemsOf(MIRROR.venues[0]);
  assert.deepEqual(items.map((i) => [i.kind, i.who]), [["joined", "John"], ["joined", "李四"], ["message", "李四"], ["message", "John"], ["message", "李四"]]);
  assert.deepEqual(items.slice(2).map((i) => [i.mark, i.mine]), [[true, false], [false, true], [false, false]]);
  const lily = itemsOf(MIRROR.venues[1]);
  assert.equal(whoSaid(lily[1], "zh"), "你的分身");
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
    ["三年二班家长", "Lily 爸爸", "L", "你的分身", "我看一下，晚点回。", "19:31", 1],
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
