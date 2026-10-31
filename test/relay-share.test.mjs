import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { route } from "../dist/relay/api.js";
import { Relay, guestVenueId } from "../dist/relay/relay.js";
import { readQueue } from "../dist/core/im/queue.js";
import { readDoc } from "../dist/relay/store.js";

const BASE = Date.UTC(2026, 9, 31, 9, 0, 0);
/** A relay whose clock starts at 09:00 and moves a second per look; `advance` moves it further. */
function relay() {
  let offset = 0;
  const now = () => { const t = new Date(BASE + offset).toISOString().replace(/\.\d{3}Z$/, "Z"); offset += 1000; return t; };
  const r = new Relay({ root: mkdtempSync(join(tmpdir(), "gemworks-relay-")), name: "relay.test", version: "0.0.0", now });
  r.advance = (ms) => { offset += ms; };
  return r;
}
function call(r, line, { token, body, ip } = {}) {
  const [method, rest] = line.split(" ");
  const [path, qs] = rest.split("?");
  const res = route({ method, path, query: Object.fromEntries(new URLSearchParams(qs ?? "")), ...(token !== undefined ? { token } : {}), ...(body !== undefined ? { body } : {}), ...(ip !== undefined ? { ip } : {}) }, r);
  return { status: res.status, json: res.type.startsWith("application/json") ? JSON.parse(res.body) : undefined, text: res.body };
}
const CARD = { title: "设置页导出 PDF，能跑的", summary: "今天把设置页的缓存写路径修好了。", summarySource: "drafted", agent: "xiaoping", turns: 63, scope: "src/settings/* 和这 63 轮的记录", evidence: ["npm test 退出 0 · 598 条"], use: { repo: "deliver/t-42", commit: "a1b2c3", license: "MIT" } };
function world() {
  const r = relay();
  const john = r.issuePerson("john");
  const lisi = r.issuePerson("lisi");
  const xiaoping = r.issueAgent(john.record, "xiaoping");
  return { r, john, lisi, xiaoping };
}

test("a share card: the owner's token, a real agent, the faults; the relay draws the id; the page's JSON needs no token; the card document is public; the list is the owner's", () => {
  const { r, john, lisi, xiaoping } = world();
  assert.equal(call(r, "POST /cards", { token: xiaoping.token, body: CARD }).status, 403);
  assert.deepEqual(call(r, "POST /cards", { token: john.token, body: { title: "x" } }), { status: 400, json: { error: "缺 agent 的名字；缺公开范围" }, text: '{"error":"缺 agent 的名字；缺公开范围"}' });
  assert.equal(call(r, "POST /cards", { token: john.token, body: { ...CARD, agent: "nobody" } }).json.error, "没有这个 agent：nobody");
  const made = call(r, "POST /cards", { token: john.token, body: CARD });
  assert.equal(made.status, 201, made.text);
  const id = made.json.card.id;
  assert.match(id, /^c-[0-9a-f]{4}$/);
  assert.equal(made.json.url, `/c/${id}`);
  assert.deepEqual([made.json.card.kind, made.json.card.public, made.json.card.title], ["share", true, "设置页导出 PDF，能跑的"]);
  assert.match(made.json.card.at, /^2026-10-31T09:00:\d\dZ$/);
  const page = call(r, `GET /c/${id}`);
  assert.equal(page.status, 200);
  assert.deepEqual([page.json.owner, page.json.card.id, page.json.agent, page.json.quota, page.json.guest], ["john", id, { name: "xiaoping", presence: "asleep", presenceWord: "睡着" }, { perGuestPerDay: 3, ownerLeftToday: 50 }, undefined]);
  assert.deepEqual(page.json.lines, { byline: "john 的作品 · xiaoping 做的 · 63 轮 · 2026-10-31 · 有凭据", summaryTag: "xiaoping 起草 · john 改过", range: "src/settings/* 和这 63 轮的记录 · 其余不在此，xiaoping 不会讲", use: "仓库 deliver/t-42 @ a1b2c3 · 许可：MIT", guestHeader: "你是访客，不用注册 · 今天还能问 3 句 · 这几句的 token john 请客", agentBadge: "xiaoping · 代 john · 只讲公开范围内的" });
  assert.equal(call(r, "GET /c/c-0000").status, 404);
  assert.equal(call(r, `POST /c/${id}`).status, 405);
  assert.equal(call(r, `GET /john/cards/${id}.geml`, { token: lisi.token }).json.blocks[0].value.title, "设置页导出 PDF，能跑的", "public to a person who is nobody to john");
  const guest = call(r, "POST /guests").json;
  assert.equal(call(r, `GET /john/cards/${id}.geml`, { token: guest.token }).json.blocks[0].value.kind, "share", "and to a guest");
  assert.equal(call(r, "GET /cards", { token: john.token }).json.map((c) => c.id).join(), id);
  assert.equal(call(r, "GET /cards", { token: xiaoping.token }).status, 403);
  assert.equal(call(r, "GET /cards", { token: lisi.token }).json.length, 0);
});

test("a guest asks: the first word makes a guest identity and the guest DM with the card's agent, the public range its announce; the question is delivered at guest level; the token keeps the DM; the quota per guest, per owner and per network address; the page's JSON for a guest shows their DM and what is left", () => {
  const { r, john, lisi } = world();
  const id = call(r, "POST /cards", { token: john.token, body: CARD }).json.card.id;
  assert.equal(call(r, `POST /ask/${id}`, { body: { text: "  " } }).json.error, "正文为空");
  assert.equal(call(r, "POST /ask/c-0000", { body: { text: "x" } }).status, 404);
  assert.equal(call(r, `POST /ask/${id}`, { token: lisi.token, body: { text: "x" } }).status, 403, "a person's token takes the venues' road");
  assert.equal(call(r, `POST /ask/${id}`, { token: "gwx_bad", body: { text: "x" } }).status, 401);
  const first = call(r, `POST /ask/${id}`, { body: { text: "缓存键为什么不用 URL 直接当键？" }, ip: "10.0.0.1" });
  assert.equal(first.status, 201, first.text);
  assert.match(first.json.token, /^gwx_/);
  assert.match(first.json.speaker, /^guest:g-[0-9a-f]{8}$/);
  const gid = first.json.speaker.slice("guest:".length);
  assert.equal(first.json.venue, guestVenueId(id, first.json.speaker));
  assert.equal(first.json.venue, `gd-${id.slice(2)}-${gid.slice(2)}`);
  assert.deepEqual([first.json.message.speaker, first.json.message.text, first.json.left], [first.json.speaker, "缓存键为什么不用 URL 直接当键？", 2]);
  const vd = r.venueOf("john", first.json.venue);
  assert.deepEqual([vd.venue.kind, vd.venue.name, vd.venue.people, vd.venue.agents, vd.venue.host, vd.venue.card, vd.venue.announce.text, vd.venue.announce.version], ["guest-dm", `访客 ${gid}`, ["john", first.json.speaker], ["xiaoping"], "xiaoping", id, CARD.scope, 1]);
  assert.equal(vd.messages.length, 1, "no system message for a first announce");
  const q = readQueue(readDoc(r.root, "john", "queues/xiaoping.geml").text).queue;
  assert.deepEqual([q.items.length, q.items[0].level, q.items[0].venueKind, q.items[0].senderName, q.items[0].prompt], [1, "guest", "guest-dm", `访客 ${gid}`, "缓存键为什么不用 URL 直接当键？"]);
  assert.deepEqual(q.items[0].context, [{ src: `https://relay.test/john/venues/${first.json.venue}.geml#announce` }], "the public range rides as the venue's announce");
  const second = call(r, `POST /ask/${id}`, { token: first.json.token, body: { text: "你们生产环境用的是哪家对象存储？" }, ip: "10.0.0.1" });
  assert.deepEqual([second.status, second.json.token, second.json.venue, second.json.left], [201, undefined, first.json.venue, 1], "the same guest: no new token, the same DM, one fewer left");
  assert.equal(call(r, `GET /john/venues/${first.json.venue}.geml`, { token: first.json.token }).json.blocks.filter((b) => b.value?.text !== undefined && b.value?.speaker !== undefined).length, 2, "the DM is the guest's to read");
  assert.equal(call(r, `GET /john/venues/${first.json.venue}.geml`, { token: lisi.token }).status, 403, "another person is no member");
  const view = call(r, `GET /c/${id}`, { token: first.json.token }).json;
  assert.deepEqual(view.guest, { speaker: first.json.speaker, left: 1, venue: first.json.venue });
  assert.equal(view.lines.guestHeader, "你是访客，不用注册 · 今天还能问 1 句 · 这几句的 token john 请客");
  assert.equal(call(r, `POST /ask/${id}`, { token: first.json.token, body: { text: "再问", id: "m-same" }, ip: "10.0.0.1" }).json.left, 0);
  assert.equal(call(r, `POST /ask/${id}`, { token: first.json.token, body: { text: "再问", id: "m-same" }, ip: "10.0.0.1" }).json.left, 0, "the same id again: not counted twice");
  assert.deepEqual(call(r, `POST /ask/${id}`, { token: first.json.token, body: { text: "第四句" }, ip: "10.0.0.1" }), { status: 429, json: { error: "你今天的几句问完了，明天再来" }, text: '{"error":"你今天的几句问完了，明天再来"}' });
  assert.equal(call(r, "POST /quota", { token: john.token, body: { perDay: 3 } }).json.quota.perDay, 3, "the owner's quota, on their page");
  assert.equal(call(r, "POST /quota", { token: first.json.token, body: { perDay: 999 } }).status, 403);
  assert.equal(call(r, `POST /ask/${id}`, { body: { text: "新来的" }, ip: "10.0.0.2" }).json.error, "作者今天的访客额度用完了，明天再来");
  assert.equal(call(r, `GET /c/${id}`).json.quota.ownerLeftToday, 0);
  r.advance(24 * 3_600_000);
  assert.equal(call(r, `POST /ask/${id}`, { token: first.json.token, body: { text: "第二天" }, ip: "10.0.0.1" }).status, 201, "tomorrow the counts start over");
  assert.equal(call(r, "POST /quota", { token: john.token, body: { perDay: 100, perIpPerDay: 1 } }).status, 200);
  assert.equal(call(r, `POST /ask/${id}`, { body: { text: "同一网络的另一位" }, ip: "10.0.0.1" }).json.error, "这个网络今天问得太多了，明天再来");
  assert.equal(call(r, `POST /ask/${id}`, { body: { text: "别的网络" }, ip: "10.0.0.9" }).status, 201);
  assert.equal(r.venuesOf("john").filter((v) => v.venue.kind === "guest-dm").length, 2, "the owner sees both guest DMs among their venues");
});
