import { test } from "node:test";
import assert from "node:assert/strict";
import { VENUE_WORDS, DEFAULT_POLICY, ANNOUNCE_LIMIT, setAnnounce, markDecision, contextSegment, threadVenue, listRow } from "../dist/core/im/venue.js";

const T0 = "2026-10-30T09:00:00Z", T1 = "2026-10-30T10:00:00Z";
const g = { id: "g-7", kind: "group", name: "前端周会", address: "https://r/john/venues/g-7.geml", people: ["john", "zhangsan", "lisi"], agents: ["小评", "小测"], policy: DEFAULT_POLICY, decisions: [] };

test("the words and the default policy", () => {
  assert.deepEqual(VENUE_WORDS, { dm: "私信", "guest-dm": "访客私信", group: "群", thread: "线程", channel: "订阅频道", room: "房间" });
  assert.deepEqual(DEFAULT_POLICY, { promptFrom: "anyone", allow: [], density: { venuePerMinute: 30, agentPerMinute: 6 }, draftFirst: false, hopLimit: 3 });
  assert.equal(ANNOUNCE_LIMIT, 2000);
});

test("the announce has versions, a length limit and a system message per change (§6.8); the input venue is not changed", () => {
  const r1 = setAnnounce(g, "每周三评审", "john", T0);
  assert.deepEqual(r1.venue.announce, { text: "每周三评审", version: 1, at: T0, by: "john" });
  assert.equal(r1.system, "john 改了群公告（第 1 版）");
  const r2 = setAnnounce(r1.venue, "每周三评审，周五发版", "lisi", T1);
  assert.equal(r2.venue.announce.version, 2);
  assert.equal(r2.system, "lisi 改了群公告（第 2 版）");
  assert.deepEqual(setAnnounce(g, "长".repeat(2001), "john", T0), { fault: "群公告最多两千字（现在 2001 字）" });
  assert.equal(setAnnounce(g, "长".repeat(2000), "john", T0).fault, undefined);
  assert.equal(g.announce, undefined);
});

test("decisions append once; the context segment is the announce and the last five decisions as live embeds (rule 3, §6.8)", () => {
  let v = setAnnounce(g, "公告", "john", T0).venue;
  for (let i = 1; i <= 7; i++) v = markDecision(v, `https://r/john/venues/g-7.geml#m-${i}`);
  v = markDecision(v, "https://r/john/venues/g-7.geml#m-7");
  assert.equal(v.decisions.length, 7);
  assert.deepEqual(contextSegment(v), [{ src: "https://r/john/venues/g-7.geml#announce" }, ...[3, 4, 5, 6, 7].map((i) => ({ src: `https://r/john/venues/g-7.geml#m-${i}` }))]);
  assert.deepEqual(contextSegment(g), []);
  assert.equal(contextSegment(v, 2).length, 3);
  assert.deepEqual(contextSegment(markDecision(g, "https://r/john/venues/g-7.geml#m-1")), [{ src: "https://r/john/venues/g-7.geml#m-1" }]);
});

test("a thread shown in a group inherits its members and policy; an independent thread is the anchor owner's (§6.7)", () => {
  const t = threadVenue({ id: "t-m-3", anchor: "https://r/john/venues/g-7.geml#m-3", title: "回复：看看这个 PR", address: "https://r/john/venues/t-m-3.geml", shownIn: g, owner: "john" });
  assert.deepEqual(t, { id: "t-m-3", kind: "thread", name: "回复：看看这个 PR", address: "https://r/john/venues/t-m-3.geml", people: g.people, agents: g.agents, policy: g.policy, decisions: [], anchor: "https://r/john/venues/g-7.geml#m-3", parent: "g-7" });
  const alone = threadVenue({ id: "t-c1", anchor: "https://r/john/journals/t-42.geml#rev-3", title: "评论：rev-3", address: "https://r/john/venues/t-c1.geml", owner: "john" });
  assert.deepEqual(alone, { id: "t-c1", kind: "thread", name: "评论：rev-3", address: "https://r/john/venues/t-c1.geml", people: ["john"], agents: [], policy: DEFAULT_POLICY, decisions: [], anchor: "https://r/john/journals/t-42.geml#rev-3" });
});

test("the 「消息」 page's row per venue kind (§6.2)", () => {
  assert.deepEqual(listRow(g, { unread: 3 }), { kind: "群", name: "前端周会", status: "3 人 · 2 个 agent", unread: 3 });
  assert.deepEqual(listRow({ ...g, id: "v-1", kind: "guest-dm", name: "访客 a1b2", host: "小评" }, { unread: 0 }), { kind: "访客私信", name: "访客 a1b2", status: "小评 接待", unread: 0 });
  const t = threadVenue({ id: "t-1", anchor: "https://r/john/cards/t-57.geml#card", title: "#t-57 给设置页加导出 PDF", address: "https://r/john/venues/t-1.geml", shownIn: g, owner: "john" });
  assert.deepEqual(listRow(t, { unread: 1, working: { agent: "小测", card: "#t-57 待放行" } }), { kind: "线程", name: "#t-57 给设置页加导出 PDF", status: "小测 在干 · #t-57 待放行", unread: 1 });
  assert.equal(listRow(t, { unread: 0 }).status, "没人在干");
  assert.deepEqual(listRow({ ...g, id: "c-1", kind: "channel", name: "小评的信号" }, { unread: 2, stage: "纸面", today: 4 }), { kind: "订阅频道", name: "小评的信号", status: "纸面 · 今天 4 条", unread: 2 });
  assert.equal(listRow({ ...g, id: "d-1", kind: "dm", name: "小评" }, { unread: 0 }).status, "就是会话本身");
  assert.deepEqual(listRow({ ...g, id: "r-1", kind: "room", name: "前端茶水间" }, { unread: 4, mode: "小评 只潜水" }), { kind: "房间", name: "前端茶水间", status: "3 人 · 小评 只潜水", unread: 4 });
  assert.equal(listRow({ ...g, id: "r-1", kind: "room", name: "前端茶水间" }, { unread: 0 }).status, "3 人 · 自己的 agent 不在");
});
