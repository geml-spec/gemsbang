import { test } from "node:test";
import assert from "node:assert/strict";
import { fieldAction, gbBand, paneRows } from "../dist/hosts/claude-code/gb-panel.js";

const LILY = { id: "a-0000000002", name: "Lily 爸爸", color: "#b5543c", initial: "L", venues: ["三年二班家长"], mark: false, muted: false };
const NOW = "2026-11-01T09:00:00Z";
const need = (id, kind, extra = {}) => ({ id, avatar: LILY.id, kind, summary: `${kind} ${id}`, options: kind === "borrow" ? [{ label: "现在干" }, { label: "排着" }, { label: "不干" }] : [{ label: "能去", text: "周五我可以去" }, { label: "去不了", text: "去不了" }], at: NOW, state: "open", avatarName: "Lily 爸爸", group: "三年二班家长", badge: LILY, muted: false, venue: { owner: "a-00000000c1", id: "g-000000000b" }, ...extra });
const VIEW = (needs, extra = {}) => ({ relay: "https://im.example", trusted: [], loggedIn: true, lang: "zh", avatars: [LILY], rows: [], unread: 0, needs, muted: { avatars: [], venues: [] }, notes: [], bodies: {}, ...extra });
const STATE = (extra = {}) => ({ page: "inbox", filter: null, chat: null, link: null, phone: null, groupAs: "new", session: "s-1", problem: null, now: NOW, ...extra });
const kinds = (rows) => rows.map((r) => (r.kind === "need" ? `need:${r.summary}` : r.kind === "section" ? r.text : r.kind === "buttons" ? r.items.map((i) => `[${i.label}]`).join("") : r.kind === "fold" ? [r.more, r.muted].filter((i) => i !== undefined).map((i) => `[${i.label}]`).join("") : r.kind)).filter((x) => x.startsWith("need") || x.startsWith("需要你") || x.startsWith("["));

test("需要你 in the inbox (spec §7.1, §7.3): its count of open cards; two shown whole, more folded behind 还有 N 件; the muted counted apart; a card says whose, what kind, where, when it came (or how long it still waits, when the matter has a deadline), what it checked and the words it would send", () => {
  const two = paneRows(VIEW([need("need-1", "promise", { checked: "你周五下午是空的", draft: "周五我可以去" }), need("need-2", "pay", { expires: "2026-11-01T20:30:00Z" })]), STATE());
  assert.deepEqual(kinds(two), ["需要你 2", "need:promise need-1", "need:pay need-2"]);
  assert.equal(two[0].count, 2, "how many things wait, beside the name");
  const card = two.find((r) => r.kind === "need");
  assert.deepEqual([card.head, card.expires, card.checked, card.willSay, card.options.map((o) => o.label), card.own.target], ["Lily 爸爸 · 答应事情 · 来自「三年二班家长」", "09:00", "它查了什么：你周五下午是空的", "将要发出：「周五我可以去」", ["能去", "去不了"], `${LILY.id}/need-1`]);
  // As GbInbox draws it: the kind beside the pill, what it is with what it checked, the words set off, 自己写 a button that opens the field.
  assert.deepEqual([card.label, card.tint, card.body, card.quote, card.own.label, card.own.writing], ["答应事情", "ask", [[{ text: "promise need-1你周五下午是空的" }]], "将要发出：「周五我可以去」", "自己写", false]);
  assert.equal(paneRows(VIEW([need("need-1", "promise")]), STATE({ writing: card.key })).find((r) => r.kind === "need").own.writing, true);
  const many = [need("need-1", "promise"), need("need-2", "pay"), need("need-3", "stance"), need("need-4", "stance", { muted: true })];
  assert.equal(two.filter((r) => r.kind === "need")[1].expires, "11 小时后过期", "a deadline of its own");
  assert.deepEqual(kinds(paneRows(VIEW(many), STATE())), ["需要你 3", "need:promise need-1", "need:pay need-2", "[还有 1 件][静音的 1 件]"]);
  const fold = paneRows(VIEW(many), STATE()).find((r) => r.kind === "fold");
  assert.deepEqual([fold.more.lead, fold.more.badge.id, fold.more.first, fold.more.open, fold.more.action], ["还有 1 件：", LILY.id, "表态 · stance need-3 · 09:00", "展开", { op: "more", what: "needs" }], "the first folded, as GbInbox says it");
  assert.deepEqual(kinds(paneRows(VIEW(many), STATE({ needsOpen: true, mutedOpen: true }))), ["需要你 3", "need:promise need-1", "need:pay need-2", "need:stance need-3", "need:stance need-4"]);
});

test("a borrow's card (spec §7.4) has its three options and two switches, no 自己写; 现在干 carries the switches set; an expired card has no options and says 已过期; in its chat a card says only the person sees it and the agent waits", () => {
  const b = paneRows(VIEW([need("need-1", "borrow")]), STATE({ allow: { "need-1": { person: true } } })).find((r) => r.kind === "need");
  assert.deepEqual(b.toggles.map((t) => [t.label, t.on]), [["这个人以后不用问", true], ["这个群以后不用问", false]]);
  assert.deepEqual(b.options[0].action, { op: "answer", avatar: LILY.id, need: "need-1", choice: 0, allowPerson: true });
  assert.deepEqual(b.options[1].action, { op: "answer", avatar: LILY.id, need: "need-1", choice: 1 });
  assert.equal(b.own, undefined);
  const e = paneRows(VIEW([need("need-1", "promise", { state: "expired", expires: "2026-11-01T08:00:00Z" })]), STATE()).find((r) => r.kind === "need");
  assert.deepEqual([e.expires, e.options, e.own, e.tone], ["已过期", [], undefined, "dim"]);
  const chat = { owner: "a-00000000c1", id: "g-000000000b", kind: "group", name: "三年二班家长", count: 12, as: LILY, earlier: 0, isOwner: false, items: [] };
  const rows = paneRows(VIEW([need("need-1", "promise")]), STATE({ page: "chat", chat }));
  assert.equal(rows.find((r) => r.kind === "need").head, "只有你看得见 · 答应事情 · agent 在等你");
  assert.deepEqual(rows[0].open, { op: "page", page: "info" }, "静音 is in 群信息 now (Q17)");
  const info = paneRows(VIEW([], { muted: { avatars: [], venues: ["a-00000000c1/g-000000000b"] } }), STATE({ page: "info", chat })).find((r) => r.kind === "menu");
  assert.deepEqual(info.items.find((i) => i.key === "info-mute"), { key: "info-mute", label: "静音", on: true, action: { op: "mute", venue: "a-00000000c1/g-000000000b", on: false } });
});

test("the band (transport §4): the first card not muted and still waiting, its options as presses (none for a borrow: it opens the pane), how many more; nothing when nothing waits; 自己写 and the waiting line's template from their fields", () => {
  const band = gbBand(VIEW([need("need-1", "error", { options: [{ label: "看原因" }, { label: "重试" }], summary: "身体连不上" }), need("need-2", "promise"), need("need-3", "pay", { muted: true })]), null, NOW);
  assert.deepEqual([band.text, band.tone, band.actions.map((a) => a.label), band.more], ["出错 · 身体连不上", "error", ["看原因", "重试"], 1]);
  assert.deepEqual(band.actions[1].action, { op: "answer", avatar: LILY.id, need: "need-1", choice: 1 });
  assert.deepEqual(gbBand(VIEW([need("need-1", "borrow")]), null, NOW).actions, []);
  assert.equal(gbBand(VIEW([need("need-1", "promise", { expires: "2026-11-01T08:59:00Z" })]), null, NOW), undefined, "past its time: no longer on the line");
  assert.equal(gbBand(VIEW([]), null, NOW), undefined);
  const s = { chat: null, phone: null, groupAs: "new" };
  assert.deepEqual(fieldAction("need-own", "我三点到", s, `${LILY.id}/need-1`), { call: "answer", args: { avatar: LILY.id, need: "need-1", choice: "own", text: "我三点到" } });
  assert.equal(fieldAction("placeholder", "收到，稍后回", s, LILY.id), undefined, "no waiting line to set");
});

test("nobody signed in (Q14): the line above the prompt says so in the first session after the install alone; later sessions have no line, the pane says it when opened; a view from an older bridge, which kept no first session, still says it", () => {
  const out = VIEW([], { loggedIn: false, firstSession: "s-1" });
  assert.deepEqual([gbBand(out, null, NOW, "s-1").text, gbBand(out, null, NOW, "s-2")], ["gemsbang 还没登录", undefined]);
  assert.equal(gbBand(VIEW([], { loggedIn: false }), null, NOW, "s-2").text, "gemsbang 还没登录");
  assert.equal(gbBand(out, "gemsbang：暂时没应答", NOW, "s-2").tone, "error", "a problem is said everywhere");
});
