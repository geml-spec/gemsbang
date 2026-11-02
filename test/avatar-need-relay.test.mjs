import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AvatarRelay } from "../dist/relay/avatars.js";
import { readDoc } from "../dist/relay/store.js";
import { answerByFile, cardsByFile, fileAdapter } from "../dist/relay/push.js";

const BASE = Date.UTC(2026, 10, 1, 9, 0, 0);
/** A relay whose clock starts at 09:00 and moves a second per look; its texts are kept; `advance` moves the clock further. */
function relay(o = {}) {
  let offset = 0;
  const texts = [];
  const now = () => { const t = new Date(BASE + offset).toISOString().replace(/\.\d{3}Z$/, "Z"); offset += 1000; return t; };
  const r = new AvatarRelay({ root: mkdtempSync(join(tmpdir(), "gemsbang-relay-")), name: "relay.test", now, texter: (t) => { texts.push(t); }, ...o });
  r.texts = texts;
  r.advance = (ms) => { offset += ms; };
  return r;
}
const ok = (x) => { assert.equal(x.ok, true, x.reason); return x; };
const bad = (x, status, reason) => { assert.equal(x.ok, false); assert.equal(x.status, status, x.reason); if (reason !== undefined) assert.equal(x.reason, reason); return x; };
const codeIn = (t) => /(\d{6})/.exec(t.text)[1];
/** A person logged in by the number: their token's record and their id. */
function login(r, phone) {
  ok(r.startLogin({ phone }));
  const done = ok(r.finishLogin({ phone, code: codeIn(r.texts[r.texts.length - 1]) }));
  return { by: r.verify(done.token), person: done.person, token: done.token };
}

/** A parents' group: Wang's avatar owns it, the person John's avatar 「Lily 爸爸」 is in it; Wang said something. */
function world(o = {}) {
  const r = relay(o);
  const john = login(r, "13800138000");
  const wang = login(r, "13700137000");
  const lily = ok(r.growAvatar(john.by, { name: "Lily 爸爸" })).avatar;
  const teacher = ok(r.growAvatar(wang.by, { name: "王老师" })).avatar;
  const g = ok(r.createGroup(wang.by, { as: teacher.id, name: "三年二班家长" })).venue;
  ok(r.addMember(wang.by, g.owner, g.id, { as: teacher.id, avatar: lily.id }));
  ok(r.say(wang.by, g.owner, g.id, { as: teacher.id, text: "周五春游，谁能来当志愿者？", id: "m-1" }));
  const agent = r.verify(ok(r.issueAvatar(john.by, lily.id)).token);
  return { r, john, wang, lily, teacher, g, agent };
}
const ASK = (g, extra = {}) => ({ venue: `${g.owner}/${g.id}`, kind: "promise", summary: "王老师问周五能不能来当志愿者", checked: "你周五下午是空的", draft: "周五我可以去，几点在哪集合？", options: [{ label: "能去，问集合时间", text: "周五我可以去，几点在哪集合？" }, { label: "去不了", text: "这周五去不了，抱歉。" }], message: "m-1", ...extra });
const lines = (r, g, viewer) => ok(r.read(viewer, g.owner, `venues/${g.id}.geml`)).blocks.filter((b) => typeof b.value.text === "string").map((b) => [b.value.speaker, b.value.by, b.value.text, b.value.replyTo]);

test("an avatar asks its person (spec §7.3): its agent makes a card in the avatar's own list — the kind, the chat, what it checked, the words it would send; with `placeholder` it says the waiting line in the chat meanwhile; the person sees every avatar's cards with the avatar's and the chat's names; others see nothing", () => {
  const { r, john, wang, lily, teacher, g, agent } = world();
  const made = ok(r.ask(agent, ASK(g, { placeholder: true }))).need;
  assert.deepEqual([made.id, made.kind, made.state, made.expires, made.venue], ["need-1", "promise", "open", undefined, { owner: g.owner, id: g.id }], "no deadline of its own: it waits until the person answers");
  assert.deepEqual(lines(r, g, wang.by).at(-1), [`avatar:${lily.id}`, "agent", "我看一下，晚点回。", "m-1"], "the waiting line, said by its agent");
  const listed = r.needsOf(john.person);
  assert.deepEqual(listed.map((n) => [n.avatarName, n.group, n.summary, n.draft]), [["Lily 爸爸", "三年二班家长", "王老师问周五能不能来当志愿者", "周五我可以去，几点在哪集合？"]]);
  assert.deepEqual(r.needsOf(wang.person), []);
  bad(r.read(wang.by, lily.id, "needs.geml"), 403);
  bad(r.ask(agent, { ...ASK(g), kind: "gossip" }), 400, "需要你的事只有五种：promise、pay、stance、borrow、error");
  bad(r.ask(agent, { ...ASK(g), venue: undefined }), 400, "要说明是哪个场合的事");
  bad(r.ask(agent, { ...ASK(g), venue: `${teacher.id}/g-ffffffffff` }), 403, "不在这个群里");
  const err = ok(r.ask(john.by, { as: lily.id, kind: "error", summary: "这件事要在电脑上做，身体连不上" })).need;
  assert.deepEqual(err.options.map((o) => o.label), ["看原因", "重试"], "an error needs no chat, and has its two options");
});

test("the person answers (spec §7.3): an option's words go into the chat as the avatar, `by: person`, replying to the line the card came from; their own words likewise; once only; nobody else answers; the card leaves the list", () => {
  const { r, john, wang, lily, g, agent } = world();
  const first = ok(r.ask(agent, ASK(g))).need;
  bad(r.answerNeed(wang.by, lily.id, first.id, { choice: 0 }), 403, "这不是你的分身");
  bad(r.answerNeed(john.by, lily.id, first.id, { choice: 7 }), 400, "选一个选项，或自己写一句");
  bad(r.answerNeed(john.by, lily.id, first.id, { choice: "own", text: " " }), 400);
  const done = ok(r.answerNeed(john.by, lily.id, first.id, { choice: 0 }));
  assert.equal(done.need.state, "answered");
  assert.deepEqual(lines(r, g, wang.by).at(-1), [`avatar:${lily.id}`, "person", "周五我可以去，几点在哪集合？", "m-1"]);
  assert.equal(lines(r, g, wang.by).at(-1)[0], `avatar:${lily.id}`, "the avatar speaks; the person behind it is never named");
  bad(r.answerNeed(john.by, lily.id, first.id, { choice: 1 }), 409, "这件事已经答过了");
  const second = ok(r.ask(agent, ASK(g, { kind: "stance", summary: "要不要投票选春游地点", options: [{ label: "赞成" }] }))).need;
  ok(r.answerNeed(john.by, lily.id, second.id, { choice: "own", text: "我都行，听大家的" }));
  assert.equal(lines(r, g, wang.by).at(-1)[2], "我都行，听大家的");
  const third = ok(r.ask(agent, ASK(g, { kind: "stance", summary: "选一个", options: [{ label: "随便" }] }))).need;
  ok(r.answerNeed(john.by, lily.id, third.id, { choice: 0 }));
  assert.equal(lines(r, g, wang.by).at(-1)[2], "我都行，听大家的", "an option with no words sends nothing");
  bad(r.answerNeed(john.by, lily.id, "need-9", { choice: 0 }), 404, "没有这件事");
  assert.deepEqual(r.needsOf(john.person), []);
});

test("a deadline (spec §7.3; architecture §6.3): a card without one waits however long it takes; past the matter's own deadline the sweep marks it expired, the avatar says in the chat that the person must answer this themself, and an answer is refused; it stays listed a day as 已过期", () => {
  const { r, john, wang, lily, g, agent } = world();
  const waits = ok(r.ask(agent, ASK(g, { kind: "stance", summary: "要不要投票选春游地点", options: [{ label: "赞成" }] }))).need;
  const card = ok(r.ask(agent, ASK(g, { expires: new Date(Date.UTC(2026, 10, 1, 10, 0, 0)).toISOString() }))).need;
  assert.equal(r.sweep(), 0);
  r.advance(2 * 3_600_000);
  assert.equal(r.sweep(), 1);
  assert.equal(r.sweep(), 0, "once");
  assert.deepEqual(lines(r, g, wang.by).at(-1), [`avatar:${lily.id}`, "agent", "这件事要本人回，我先不替答。", "m-1"]);
  bad(r.answerNeed(john.by, lily.id, card.id, { choice: 0 }), 410, "这件事已经过期了");
  assert.deepEqual(r.needsOf(john.person).map((n) => [n.id, n.state]), [[waits.id, "open"], [card.id, "expired"]]);
  r.advance(30 * 86_400_000);
  assert.equal(r.sweep(), 0);
  assert.deepEqual(r.needsOf(john.person).map((n) => [n.id, n.state]), [[waits.id, "open"]], "a month on, the card with no deadline still waits");
});

test("the next deadline (architecture §2.3: a Durable Object sweeps by its alarm): the earliest among the cards still waiting with one; none with no deadline; past it swept, the next; an answered card, none", () => {
  const { r, john, lily, g, agent } = world();
  ok(r.ask(agent, ASK(g, { kind: "stance", summary: "要不要投票选春游地点", options: [{ label: "赞成" }] })));
  assert.equal(r.nextDeadline(), undefined, "a card with no deadline sets no alarm");
  ok(r.ask(agent, ASK(g, { expires: new Date(Date.UTC(2026, 10, 1, 10, 0, 0)).toISOString() })));
  const later = ok(r.ask(agent, ASK(g, { summary: "周日的事", expires: new Date(Date.UTC(2026, 10, 1, 14, 0, 0)).toISOString() }))).need;
  assert.equal(Date.parse(r.nextDeadline()), Date.UTC(2026, 10, 1, 10, 0, 0));
  r.advance(2 * 3_600_000);
  assert.equal(r.sweep(), 1);
  assert.equal(Date.parse(r.nextDeadline()), Date.UTC(2026, 10, 1, 14, 0, 0), "then the next");
  ok(r.answerNeed(john.by, lily.id, later.id, { choice: 0 }));
  assert.equal(r.nextDeadline(), undefined, "an answered card sets no alarm");
});

test("a task card (spec §7.4's card, once called 借电脑): its three options send no words; 现在干 with 这个人以后不用问 or 这个群以后不用问 lets the next one through without asking", () => {
  const { r, john, wang, lily, teacher, g, agent } = world();
  const card = ok(r.ask(agent, { venue: `${g.owner}/${g.id}`, kind: "borrow", summary: "王老师要你在 settings-app 里看导出按钮", from: teacher.id })).need;
  assert.deepEqual(card.options.map((o) => o.label), ["现在干", "排着", "不干"]);
  assert.equal(r.borrowAllowed(lily.id, teacher.id, { owner: g.owner, id: g.id }), false);
  const before = lines(r, g, wang.by).length;
  ok(r.answerNeed(john.by, lily.id, card.id, { choice: 0, allowPerson: true }));
  assert.equal(lines(r, g, wang.by).length, before, "nothing said in the chat");
  assert.equal(r.borrowAllowed(lily.id, teacher.id, undefined), true, "that person, anywhere");
  assert.equal(r.borrowAllowed(lily.id, "a-ffffffffff", { owner: g.owner, id: g.id }), false);
  const next = ok(r.ask(agent, { venue: `${g.owner}/${g.id}`, kind: "borrow", summary: "再看一下", from: "a-ffffffffff" })).need;
  ok(r.answerNeed(john.by, lily.id, next.id, { choice: 0, allowVenue: true }));
  assert.equal(r.borrowAllowed(lily.id, "a-ffffffffff", { owner: g.owner, id: g.id }), true, "this chat, whoever asks");
});

test("a newcomer at the owner's door (spec §6.1): with the approval on, a request is the owner's 答应事情 card in their language; 同意 lets them in, and answering the request itself closes the card", () => {
  const { r, wang, teacher, g } = world();
  ok(r.setLinkRules(wang.by, g.owner, g.id, { as: teacher.id, approve: true }));
  const code = ok(r.linkFor(wang.by, g.owner, g.id, { as: teacher.id })).link.code;
  const mei = login(r, "13900139000");
  ok(r.joinByLink(mei.by, code, { name: "乐乐 妈妈" }));
  const cards = r.needsOf(wang.person);
  assert.deepEqual(cards.map((n) => [n.kind, n.summary, n.options.map((o) => o.label), n.request]), [["promise", "「乐乐 妈妈」想进「三年二班家长」", ["同意", "不同意"], "request-1"]]);
  ok(r.answerNeed(wang.by, teacher.id, cards[0].id, { choice: 0 }));
  assert.deepEqual(r.venueView(g.owner, g.id).members.map((m) => m.name), ["王老师", "Lily 爸爸", "乐乐 妈妈"]);
  const zhou = login(r, "13600136000");
  ok(r.joinByLink(zhou.by, code, { name: "周" }));
  assert.equal(r.needsOf(wang.person).length, 1);
  ok(r.answerRequest(wang.by, g.owner, "request-2", { as: teacher.id, yes: false }));
  assert.deepEqual(r.needsOf(wang.person), [], "the request answered on its own route: its card is gone");
});

test("the push outlet (spec §7.3): a card goes out on every channel its person turned on, an unknown channel is refused; an answer back on the channel is the person's press; the waiting line is the person's own template where they set one", async () => {
  const root = mkdtempSync(join(tmpdir(), "gemsbang-needs-push-"));
  const { r, john, wang, lily, g, agent } = world({ root, push: [fileAdapter(root)] });
  bad(r.setPush(john.by, { channel: "pigeon" }), 404, "没有这个推送通道：pigeon");
  ok(r.ask(agent, ASK(g)));
  assert.deepEqual(cardsByFile(root), [], "no channel on, nothing pushed");
  assert.deepEqual(ok(r.setPush(john.by, { channel: "file" })).channels, ["file"]);
  const card = ok(r.ask(agent, ASK(g, { kind: "pay", summary: "春游车费 30 元", options: [{ label: "付", text: "车费我转了" }] }))).need;
  assert.deepEqual(cardsByFile(root).map((c) => [c.avatarName, c.group, c.need.summary]), [["Lily 爸爸", "三年二班家长", "春游车费 30 元"]]);
  answerByFile(root, { person: john.person, avatar: lily.id, need: card.id, choice: 0 });
  answerByFile(root, { person: wang.person, avatar: lily.id, need: "need-1", choice: 0 });
  assert.equal(await r.collectPush(), 1, "only the person's own answer counts");
  assert.equal(lines(r, g, wang.by).at(-1)[2], "车费我转了");
  ok(r.setPlaceholder(john.by, lily.id, { text: "收到，稍后回复您" }));
  ok(r.ask(agent, ASK(g, { placeholder: true })));
  assert.equal(lines(r, g, wang.by).at(-1)[2], "收到，稍后回复您");
  bad(r.setPlaceholder(wang.by, lily.id, { text: "x" }), 403);
});
