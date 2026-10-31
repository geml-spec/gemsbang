import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { route } from "../dist/relay/api.js";
import { Relay } from "../dist/relay/relay.js";
import { readDoc } from "../dist/relay/store.js";
import { readQueue } from "../dist/core/im/queue.js";

const BASE = Date.UTC(2026, 9, 31, 9, 0, 0);
function relay() {
  let offset = 0;
  const now = () => { const t = new Date(BASE + offset).toISOString().replace(/\.\d{3}Z$/, "Z"); offset += 1000; return t; };
  return new Relay({ root: mkdtempSync(join(tmpdir(), "gemworks-relay-")), name: "relay.test", version: "0.0.0", now });
}
function call(r, line, { token, body, ip } = {}) {
  const [method, path] = line.split(" ");
  const res = route({ method, path, query: {}, ...(token !== undefined ? { token } : {}), ...(body !== undefined ? { body } : {}), ...(ip !== undefined ? { ip } : {}) }, r);
  return { status: res.status, json: res.type.startsWith("application/json") ? JSON.parse(res.body) : undefined, text: res.body };
}
const queueOf = (r, owner, agent) => readQueue(readDoc(r.root, owner, `queues/${agent}.geml`).text).queue;

/** John (agent 小评), 王五 (agent 小测), 李四; john's room r-1. */
function world() {
  const r = relay();
  const john = r.issuePerson("john"), wangwu = r.issuePerson("wangwu"), lisi = r.issuePerson("lisi");
  const xiaoping = r.issueAgent(john.record, "xiaoping"), xiaoce = r.issueAgent(wangwu.record, "xiaoce");
  assert.equal(r.createVenue(john.record, { id: "r-1", kind: "room", name: "前端茶水间" }).ok, true);
  return { r, john, wangwu, lisi, xiaoping, xiaoce };
}

test("rooms (§7.4): listed for anyone, joined by a person with or without one of their agents; the mode on the agent's page, 只潜水 by default; a lurker is never prompted, 被问才答 by a leading @, 可以搭话 by a mention or a reply too; agents never prompt each other there", () => {
  const { r, john, wangwu, lisi, xiaoping, xiaoce } = world();
  assert.deepEqual(call(r, "GET /rooms", { token: lisi.token }).json, [{ owner: "john", id: "r-1", name: "前端茶水间", people: 1, agents: 0 }]);
  assert.equal(call(r, "POST /rooms/john/r-1/join", { token: xiaoce.token, body: {} }).status, 403, "a person joins; their agent rides along");
  assert.equal(call(r, "POST /rooms/john/nope/join", { token: lisi.token, body: {} }).status, 404);
  r.createVenue(john.record, { id: "g-7", kind: "group", name: "群" });
  assert.equal(call(r, "POST /rooms/john/g-7/join", { token: lisi.token, body: {} }).json.error, "不是公共房间");
  assert.deepEqual(call(r, "POST /rooms/john/r-1/join", { token: lisi.token, body: {} }).json.venue.people, ["john", "lisi"]);
  assert.equal(call(r, "POST /rooms/john/r-1/join", { token: wangwu.token, body: { agent: "xiaoping" } }).json.error, "要自己名下的 agent");
  const joined = call(r, "POST /rooms/john/r-1/join", { token: wangwu.token, body: { agent: "xiaoce" } });
  assert.deepEqual([joined.json.venue.people, joined.json.venue.agents], [["john", "lisi", "wangwu"], ["xiaoce"]]);
  assert.deepEqual(call(r, "POST /rooms/john/r-1/join", { token: john.token, body: { agent: "xiaoping" } }).json.venue.agents, ["xiaoce", "xiaoping"]);
  assert.deepEqual(call(r, "GET /rooms", { token: lisi.token }).json, [{ owner: "john", id: "r-1", name: "前端茶水间", people: 3, agents: 2 }]);
  assert.equal(r.socialModeOf("john", "xiaoping"), "lurk");
  assert.equal(call(r, "POST /agents/xiaoce/social", { token: john.token, body: { mode: "chat" } }).status, 404, "not his agent");
  assert.equal(call(r, "POST /agents/xiaoce/social", { token: wangwu.token, body: { mode: "loud" } }).json.error, "档位是 lurk、ask 或 chat");
  assert.deepEqual(call(r, "POST /agents/xiaoce/social", { token: wangwu.token, body: { mode: "chat" } }).json, { agent: "xiaoce", mode: "chat" });
  assert.equal(r.socialModeOf("wangwu", "xiaoce"), "chat");
  const lurk = r.appendMessage(lisi.record, "john", "r-1", { id: "m-1", text: "@xiaoping 看看这个" });
  assert.deepEqual([lurk.delivery.prompts, lurk.delivery.degraded], [[], [{ agent: "xiaoping", reason: "只潜水" }]]);
  assert.equal(readDoc(r.root, "john", "queues/xiaoping.geml").exists, false, "nothing reached the lurker");
  call(r, "POST /agents/xiaoping/social", { token: john.token, body: { mode: "ask" } });
  const asked = r.appendMessage(lisi.record, "john", "r-1", { id: "m-2", text: "@xiaoping 看看这个" });
  assert.deepEqual(asked.delivery.prompts, [{ agent: "xiaoping", level: "member", hops: 0 }]);
  assert.equal(queueOf(r, "john", "xiaoping").items.length, 1);
  const mentioned = r.appendMessage(lisi.record, "john", "r-1", { id: "m-3", text: "刚才 @xiaoce 说得对，@xiaoping 也是" });
  assert.deepEqual(mentioned.delivery.prompts, [{ agent: "xiaoce", level: "member", hops: 0, via: "提到" }], "可以搭话 takes a mention; 被问才答 does not");
  r.appendMessage(xiaoce.record, "john", "r-1", { id: "m-4", text: "谢谢" , handling: 0 });
  const replied = r.appendMessage(lisi.record, "john", "r-1", { id: "m-5", text: "不客气", replyTo: "m-4" });
  assert.deepEqual(replied.delivery.prompts, [{ agent: "xiaoce", level: "member", hops: 0, via: "回复" }]);
  const a2a = r.appendMessage(xiaoping.record, "john", "r-1", { id: "m-6", text: "@xiaoce 你看呢", handling: 0 });
  assert.deepEqual(a2a.delivery.degraded, [{ agent: "xiaoce", reason: "对方策略不收 agent 的指令，只当消息读到" }], "agents never prompt each other in a room");
  assert.equal(queueOf(r, "wangwu", "xiaoce").items.length, 2);
  assert.equal(call(r, "GET /john/venues/r-1.geml", { token: wangwu.token }).status, 200, "a member reads the room");
  const zhao = r.issuePerson("zhao");
  assert.equal(call(r, "GET /john/venues/r-1.geml", { token: zhao.token }).status, 403, "not before joining");
});

test("the social secretary (§11): every guest DM opens with the reception as a system message — the agent, the owner, the latest public thing (the newest digest, else the card's title)", () => {
  const { r, john, xiaoping } = world();
  const id = call(r, "POST /cards", { token: john.token, body: { title: "设置页导出 PDF，能跑的", summary: "一句话", agent: "xiaoping", scope: "src/settings/*", evidence: [] } }).json.card.id;
  const first = call(r, `POST /ask/${id}`, { body: { text: "这个项目怎么跑？" }, ip: "10.0.0.1" });
  assert.equal(first.status, 201, first.text);
  const dm = r.venueOf("john", first.json.venue);
  assert.deepEqual(dm.messages.map((m) => [m.kind, m.speaker]), [["system", "host"], ["chat", first.json.speaker]]);
  assert.equal(dm.messages[0].text, "接待：第一句自报家门——我是 xiaoping，代 john；john 现在不在；john 最近公开的一件事：设置页导出 PDF，能跑的；访客可以留言，或问公开范围内的。");
  assert.equal(queueOf(r, "john", "xiaoping").items.length, 1, "the system message prompts nobody");
  assert.equal(call(r, "POST /digests", { token: xiaoping.token, body: { text: "今天把设置页的缓存写路径修好了，顺手把导出 PDF 的按钮也挪到了右上角，明天接着做样式。" } }).status, 201);
  assert.equal(call(r, "POST /digests/answer", { token: john.token, body: { draft: "draft-1", publish: true } }).json.published, true);
  const second = call(r, `POST /ask/${id}`, { body: { text: "另一位访客" }, ip: "10.0.0.2" });
  assert.equal(r.venueOf("john", second.json.venue).messages[0].text, "接待：第一句自报家门——我是 xiaoping，代 john；john 现在不在；john 最近公开的一件事：今天把设置页的缓存写路径修好了，顺手把导出 PDF 的按钮也挪到了右上角，明天接…；访客可以留言，或问公开范围内的。");
});

test("digests (§11): the agent drafts, the owner's 定 stands in the inbox; 发 as drafted, 发 with the owner's words (起草 · 改过), or 不发; the published ones on the public page and at /digests/<person>; the drafts are the owner's alone", () => {
  const { r, john, lisi, xiaoping } = world();
  assert.equal(call(r, "POST /digests", { token: john.token, body: { text: "x" } }).json.error, "日报由 agent 起草");
  assert.equal(call(r, "POST /digests", { token: xiaoping.token, body: { text: " " } }).json.error, "日报要有正文");
  assert.deepEqual(call(r, "POST /digests", { token: xiaoping.token, body: { text: "今天把缓存修好了。" } }).json, { id: "draft-1" });
  assert.deepEqual(r.inbox("john").map((n) => [n.kind, n.key, n.text, n.actions]), [["decide", "https://relay.test/john/digests/john.geml#draft-1", "xiaoping 起草了日报：今天把缓存修好了。", ["发", "不发", "自己写"]]]);
  assert.equal(call(r, "POST /digests/answer", { token: xiaoping.token, body: { draft: "draft-1", publish: true } }).status, 403);
  assert.equal(call(r, "POST /digests/answer", { token: john.token, body: { draft: "draft-9", publish: true } }).status, 404);
  assert.deepEqual(call(r, "POST /digests/answer", { token: john.token, body: { draft: "draft-1", publish: true } }).json, { published: true, id: "digest-1" });
  assert.deepEqual(r.inbox("john"), []);
  assert.equal(call(r, "POST /digests/answer", { token: john.token, body: { draft: "draft-1", publish: false } }).json.error, "已经定过了");
  const listed = call(r, "GET /digests/john", { token: lisi.token });
  assert.deepEqual(listed.json.map((d) => [d.id, d.text, d.agent, d.source]), [["digest-1", "今天把缓存修好了。", "xiaoping", "drafted"]]);
  assert.ok(call(r, "GET /john/people/john.geml", { token: lisi.token }).json.blocks.some((b) => b.id === "digest-1" && b.value.text === "今天把缓存修好了。"), "public, on the page");
  assert.equal(call(r, "GET /john/digests/john.geml", { token: lisi.token }).status, 403, "the drafts are the owner's alone");
  call(r, "POST /digests", { token: xiaoping.token, body: { text: "第二天。" } });
  assert.deepEqual(call(r, "POST /digests/answer", { token: john.token, body: { draft: "draft-2", publish: true, text: "第二天，改过的。" } }).json, { published: true, id: "digest-2" });
  call(r, "POST /digests", { token: xiaoping.token, body: { text: "第三天。" } });
  assert.deepEqual(call(r, "POST /digests/answer", { token: john.token, body: { draft: "draft-3", publish: false } }).json, { published: false });
  assert.deepEqual(call(r, "GET /digests/john", { token: john.token }).json.map((d) => [d.id, d.text, d.source]), [["digest-2", "第二天，改过的。", "edited"], ["digest-1", "今天把缓存修好了。", "drafted"]], "newest first; the dropped one nowhere");
  assert.deepEqual(r.inbox("john"), []);
  assert.deepEqual(call(r, "GET /digests/nobody", { token: john.token }).json, []);
  assert.equal(call(r, "GET /digests", { token: john.token }).status, 405);
});

test("牵线 (§11): proposed by a person (their own nod given) or by their agent (their own 定 too); the other side's 定; 不用 ends it; both 亮名片 and a small group opens under the proposer with both people, their agents and the two cards; what two people's public works share", () => {
  const { r, john, wangwu, lisi, xiaoping } = world();
  assert.equal(call(r, "POST /match", { token: lisi.token, body: { person: "lisi" } }).json.error, "不能跟自己牵线");
  assert.equal(call(r, "POST /match", { token: lisi.token, body: { person: "nobody" } }).status, 404);
  const m1 = call(r, "POST /match", { token: lisi.token, body: { person: "john", note: "都在做 PDF" } });
  assert.equal(m1.status, 201, m1.text);
  assert.match(m1.json.id, /^m-[0-9a-f]{8}$/);
  assert.equal(call(r, "POST /match", { token: lisi.token, body: { person: "john" } }).json.error, "已经提过了，等对方点头");
  assert.deepEqual(r.inbox("lisi"), [], "the proposer's own nod is given");
  assert.deepEqual(r.inbox("john").map((n) => [n.kind, n.key, n.text, n.actions]), [["decide", `https://relay.test/lisi/matches/${m1.json.id}.geml#match`, "牵线：lisi 想和你互相亮名片：都在做 PDF", ["亮名片", "不用"]]]);
  assert.equal(call(r, `POST /match/lisi/${m1.json.id}/answer`, { token: wangwu.token, body: { yes: true } }).json.error, "不是你的牵线");
  assert.deepEqual(call(r, `POST /match/lisi/${m1.json.id}/answer`, { token: john.token, body: { yes: false } }).json, { matched: false });
  assert.deepEqual(r.inbox("john"), []);
  assert.equal(call(r, `POST /match/lisi/${m1.json.id}/answer`, { token: john.token, body: { yes: true } }).json.error, "已经答过了");
  assert.equal(call(r, "POST /match/lisi/m-00000000/answer", { token: john.token, body: { yes: true } }).status, 404);
  // by an agent: its owner nods too
  const m2 = call(r, "POST /match", { token: xiaoping.token, body: { person: "wangwu" } });
  assert.equal(m2.status, 201, m2.text);
  assert.deepEqual(r.inbox("john").map((n) => [n.kind, n.text]), [["decide", "你的 agent xiaoping 想替你和 wangwu 牵线，亮名片吗？"]]);
  assert.deepEqual(r.inbox("wangwu").map((n) => [n.kind, n.text]), [["decide", "牵线：john 的 agent 觉得你们合得来"]]);
  assert.deepEqual(call(r, `POST /match/john/${m2.json.id}/answer`, { token: wangwu.token, body: { yes: true } }).json, { matched: false }, "one nod");
  assert.deepEqual(r.inbox("wangwu"), []);
  const done = call(r, `POST /match/john/${m2.json.id}/answer`, { token: john.token, body: { yes: true } });
  assert.deepEqual(done.json, { matched: true, venue: `john/mt-${m2.json.id.slice(2)}` });
  const vd = r.venueOf("john", `mt-${m2.json.id.slice(2)}`);
  assert.deepEqual([vd.venue.kind, vd.venue.name, vd.venue.people, vd.venue.agents], ["group", "牵线：john · wangwu", ["john", "wangwu"], ["xiaoping", "xiaoce"]]);
  assert.deepEqual(vd.messages.map((m) => [m.kind, m.text]), [["system", "牵线成功：双方亮名片"], ["system", "名片：john · agent xiaoping"], ["system", "名片：wangwu · agent xiaoce"]]);
  assert.equal(call(r, `POST /match/john/${m2.json.id}/answer`, { token: john.token, body: { yes: true } }).json.error, "已经答过了");
  assert.deepEqual([r.inbox("john"), r.inbox("wangwu")], [[], []]);
  // suggestions
  call(r, "POST /cards", { token: john.token, body: { title: "设置页导出 PDF，能跑的", summary: "", agent: "xiaoping", scope: "src/settings/*", evidence: [] } });
  r.issueAgent(lisi.record, "xiaoli");
  call(r, "POST /cards", { token: lisi.token, body: { title: "导出 PDF 的另一种做法", summary: "", agent: "xiaoli", scope: "src/export/*", evidence: [] } });
  assert.deepEqual(call(r, "GET /match/suggest", { token: john.token }).json, [{ person: "lisi", shared: ["pdf", "src"] }]);
  assert.deepEqual(call(r, "GET /match/suggest", { token: xiaoping.token }).json, [{ person: "lisi", shared: ["pdf", "src"] }], "an agent asks for its owner");
  assert.deepEqual(call(r, "GET /match/suggest", { token: wangwu.token }).json, []);
  assert.equal(call(r, "GET /match", { token: john.token }).status, 405);
});
