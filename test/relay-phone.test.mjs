import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { route } from "../dist/relay/api.js";
import { Relay } from "../dist/relay/relay.js";

const BASE = Date.UTC(2026, 9, 31, 9, 0, 0);
function relay() {
  let offset = 0;
  const now = () => { const t = new Date(BASE + offset).toISOString().replace(/\.\d{3}Z$/, "Z"); offset += 1000; return t; };
  const r = new Relay({ root: mkdtempSync(join(tmpdir(), "gemworks-relay-")), name: "relay.test", version: "0.0.0", now });
  r.advance = (ms) => { offset += ms; };
  return r;
}
function call(r, line, { token, body } = {}) {
  const [method, path] = line.split(" ");
  const res = route({ method, path, query: {}, ...(token !== undefined ? { token } : {}), ...(body !== undefined ? { body } : {}) }, r);
  return { status: res.status, json: res.type.startsWith("application/json") ? JSON.parse(res.body) : undefined, text: res.body };
}
const INPUT = { title: "给设置页加导出 PDF", goal: "设置页右上角一个按钮", context: { includes: [], excludes: [] }, accepts: [{ text: "单元测试通过", verify: { kind: "command", run: "npm test" } }, { text: "人点收", verify: { kind: "human" } }], direction: "outsource", venueOfWork: "worker-sandbox", tools: ["read", "edit", "test"], budget: { credits: 40 }, reward: { kind: "none" } };
const DELIVERABLE = { kind: "code", sha256: "7f3a", parts: [{ type: "repo", url: "u", branch: "deliver/t-42", commit: "a1b2c3" }], usage: "npm run build", madeBy: { turns: 63 }, evidence: [{ claim: "单元测试通过", source: "tool", command: "npm test", exit: 0, rev: 38 }], accepts: [{ criterion: 1, met: true, evidence: 1 }, { criterion: 2, met: null }], rights: { owner: "委托方", aiGenerated: true } };

/** John (agent 小评), 王五 (agent 小测, an API session, 接单模式 open), 李四; the group g-7 with everyone; john's own g-9 with a message 李四 cannot read. */
function world() {
  const r = relay();
  const john = r.issuePerson("john"), wangwu = r.issuePerson("wangwu"), lisi = r.issuePerson("lisi");
  const xiaoping = r.issueAgent(john.record, "xiaoping"), xiaoce = r.issueAgent(wangwu.record, "xiaoce");
  r.topUp("john", 100);
  r.createVenue(john.record, { id: "g-7", kind: "group", name: "前端周会", people: ["wangwu", "lisi"], agents: ["agent:xiaoping@john", "agent:xiaoce@wangwu"] });
  r.createVenue(john.record, { id: "g-9", kind: "group", name: "私房", agents: ["agent:xiaoping@john"] });
  r.appendMessage(john.record, "john", "g-9", { id: "m-9", text: "只给自己看的" });
  r.setPresence(xiaoce.record, { session: "cx-1", host: "claude-code", login: "api", presence: "idle" });
  r.declare(wangwu.record, { agent: "xiaoce", open: true });
  const phone = (person) => call(r, "POST /phone/bind", { body: { code: r.phoneCode(person.record).code } }).json.token;
  return { r, john, wangwu, lisi, xiaoping, xiaoce, phone };
}
const needOf = (r, person, kind) => r.inbox(person).find((n) => n.kind === kind);

test("binding (transport §7.2): a six-digit code for the person, ten minutes, spent on use; the bot gets an inbox-scope token of the person; a wrong, spent or stale code binds nothing", () => {
  const { r, john, xiaoping } = world();
  assert.equal(call(r, "POST /phone/code", { token: xiaoping.token }).status, 403);
  const made = call(r, "POST /phone/code", { token: john.token });
  assert.deepEqual([made.status, /^\d{6}$/.test(made.json.code), /^2026-10-31T09:10:\d\dZ$/.test(made.json.expires)], [201, true, true], "ten minutes from now");
  assert.equal(call(r, "POST /phone/bind", { body: { code: "000000" } }).json.error, "绑定码不对或过期了");
  assert.equal(call(r, "POST /phone/bind", { body: { code: "12" } }).json.error, "绑定码是六位数字");
  const bound = call(r, "POST /phone/bind", { body: { code: made.json.code } });
  assert.deepEqual([bound.status, bound.json.person, r.verify(bound.json.token).scope, r.verify(bound.json.token).speaker], [200, "john", "inbox", "person:john"]);
  assert.equal(call(r, "POST /phone/bind", { body: { code: made.json.code } }).status, 404, "spent");
  const stale = r.phoneCode(john.record).code;
  r.advance(11 * 60_000);
  assert.equal(call(r, "POST /phone/bind", { body: { code: stale } }).status, 404, "ten minutes passed");
  assert.deepEqual(call(r, "GET /inbox", { token: bound.json.token }).json, [], "the inbox is the token's to read");
  assert.equal(call(r, "POST /venues/john/g-7/messages", { token: bound.json.token, body: { id: "m-x", text: "hi" } }).status, 403, "and nothing else: no talking in a group");
});

test("the five kinds answered through the inbox token (transport §7.2 按下即回流): an ask replied to as the person; a request allowed once, for the person, or refused; an agent's ask for credits allowed; a digest sent; a match nodded; a card accepted or 看演示; a stuck card's reason read and the card given back by the worker's owner; the refusals", () => {
  const { r, john, wangwu, lisi, xiaoping, xiaoce, phone } = world();
  const token = phone(john);
  const answer = (key, action, text) => call(r, "POST /inbox/answer", { token, body: { key, action, ...(text !== undefined ? { text } : {}) } });
  // 定: an ask for john in the group
  r.appendMessage(xiaoping.record, "john", "g-7", { id: "m-ask", kind: "ask", text: "要不要合并？", ask: { question: "要不要合并？", options: ["合", "不合"], who: "person:john" } });
  const ask = needOf(r, "john", "decide");
  assert.deepEqual([ask.key, ask.actions], ["https://relay.test/john/venues/g-7.geml#m-ask", ["合", "不合", "自己写"]]);
  assert.deepEqual(answer(ask.key, "合").json, { said: "合" });
  const reply = r.venueOf("john", "g-7").messages.at(-1);
  assert.deepEqual([reply.speaker, reply.replyTo, reply.text, reply.source], ["person:john", "m-ask", "合", "self"]);
  assert.equal(needOf(r, "john", "decide"), undefined);
  r.appendMessage(xiaoping.record, "john", "g-7", { id: "m-ask2", kind: "ask", text: "再问", ask: { question: "再问", options: ["好"], who: "person:john" } });
  assert.equal(answer("https://relay.test/john/venues/g-7.geml#m-ask2", "自己写").json.error, "自己写：缺正文");
  assert.deepEqual(answer("https://relay.test/john/venues/g-7.geml#m-ask2", "自己写", "再想想").json, { said: "再想想" });
  assert.equal(r.venueOf("john", "g-7").messages.at(-1).text, "再想想");
  // 放行: 李四's requests for a block of john's
  const block = "https://relay.test/john/venues/g-9.geml#m-9";
  r.requestGrant(lisi.record, "john", block);
  let grant = needOf(r, "john", "grant");
  assert.deepEqual([grant.key, grant.actions], ["https://relay.test/john/people/john.geml#request-1", ["允许一次", "允许此人", "拒绝"]]);
  assert.equal(answer(grant.key, "允许一次").status, 200);
  assert.deepEqual(r.blockGrantsOf("john").map((g) => [g.person, g.block, g.until.startsWith("2026-10-31T10:0")]), [["lisi", block, true]], "an hour");
  assert.equal(needOf(r, "john", "grant"), undefined);
  r.requestGrant(lisi.record, "john", block);
  grant = needOf(r, "john", "grant");
  assert.equal(answer(grant.key, "拒绝").status, 200);
  assert.equal(needOf(r, "john", "grant"), undefined);
  r.requestGrant(lisi.record, "john", block);
  assert.equal(answer(needOf(r, "john", "grant").key, "允许此人").status, 200);
  assert.equal(r.blockGrantsOf("john").length, 2, "seven days more");
  // the agent's ask for credits
  r.askCredits(xiaoping.record, { credits: 5, cap: "auto" });
  const cap = needOf(r, "john", "grant");
  assert.equal(cap.key, "https://relay.test/john/people/john.geml#cap-ask-1");
  assert.equal(answer(cap.key, cap.actions[0]).status, 200);
  assert.equal(needOf(r, "john", "grant"), undefined);
  // the digest
  r.draftDigest(xiaoping.record, { text: "今天修好了缓存。" });
  const digest = needOf(r, "john", "decide");
  assert.equal(digest.key, "https://relay.test/john/digests/john.geml#draft-1");
  assert.equal(answer(digest.key, "发").status, 200);
  assert.deepEqual(r.digestsOf("john").map((d) => d.text), ["今天修好了缓存。"]);
  // the match
  r.proposeMatch(lisi.record, { person: "john" });
  const match = needOf(r, "john", "decide");
  assert.match(match.key, /\/lisi\/matches\//);
  assert.equal(answer(match.key, "亮名片").status, 200);
  assert.equal(needOf(r, "john", "decide"), undefined);
  // 验收: the card delivered and reported
  const id = call(r, "POST /tasks", { token: john.token, body: INPUT }).json.card.id;
  call(r, `POST /tasks/john/${id}/publish`, { token: john.token, body: { venue: "john/g-7" } });
  call(r, `POST /tasks/john/${id}/claim`, { token: xiaoce.token });
  assert.equal(call(r, `POST /tasks/john/${id}/deliver`, { token: xiaoce.token, body: DELIVERABLE }).status, 200);
  assert.equal(call(r, `POST /tasks/john/${id}/report`, { token: xiaoping.token, body: { results: [{ criterion: 1, met: true }, { criterion: 2, met: null }] } }).status, 200);
  const accept = needOf(r, "john", "accept");
  assert.deepEqual([accept.key, accept.actions], [`https://relay.test/john/cards/${id}.geml#report-1`, ["接受", "要改"]], "no escrow on this card: no settlement on the button");
  assert.deepEqual(answer(accept.key, "看演示").json, { said: `https://relay.test/john/cards/${id}.geml` });
  assert.equal(needOf(r, "john", "accept") !== undefined, true, "looking is not deciding");
  assert.equal(answer(accept.key, "接受").status, 200);
  assert.deepEqual([r.taskOf("john", id).state, needOf(r, "john", "accept")], ["accepted", undefined]);
  // 要改 on another card, with the words typed
  const id2 = call(r, "POST /tasks", { token: john.token, body: INPUT }).json.card.id;
  call(r, `POST /tasks/john/${id2}/publish`, { token: john.token, body: { venue: "john/g-7" } });
  call(r, `POST /tasks/john/${id2}/claim`, { token: xiaoce.token });
  call(r, `POST /tasks/john/${id2}/deliver`, { token: xiaoce.token, body: DELIVERABLE });
  call(r, `POST /tasks/john/${id2}/report`, { token: xiaoping.token, body: { results: [{ criterion: 1, met: true }, { criterion: 2, met: null }] } });
  assert.equal(answer(needOf(r, "john", "accept").key, "要改", "按钮偏左").status, 200);
  assert.deepEqual([r.taskOf("john", id2).state, r.taskOf("john", id2).comments.at(-1)?.text], ["changes", "按钮偏左"]);
  // 卡住: the worker's owner, from their phone
  const id3 = call(r, "POST /tasks", { token: john.token, body: INPUT }).json.card.id;
  call(r, `POST /tasks/john/${id3}/publish`, { token: john.token, body: { venue: "john/g-7" } });
  call(r, `POST /tasks/john/${id3}/claim`, { token: xiaoce.token });
  r.advance(31 * 60_000);
  const stuck = needOf(r, "wangwu", "stuck");
  assert.equal(stuck.key, `https://relay.test/john/cards/${id3}.geml#stuck-1`);
  const wToken = phone(wangwu);
  const w = (action) => call(r, "POST /inbox/answer", { token: wToken, body: { key: stuck.key, action } });
  assert.match(w("看原因").json.said, /^#t-[0-9a-f]{4} 31 分钟没写记录（xiaoce）$/, "the need's own words");
  assert.equal(w("接管").json.error, "卡上没有这个答复：接管（去桌面端）");
  assert.equal(w("交回").status, 200);
  assert.equal(r.taskOf("john", id3).state, "open");
  // the refusals
  assert.equal(call(r, "POST /inbox/answer", { token: xiaoping.token, body: { key: ask.key, action: "合" } }).json.error, "只有本人的令牌能答复");
  assert.equal(answer("x", "合").json.error, "不认识这件事：x");
  assert.equal(answer("https://relay.test/john/cards/nope.geml#report-1", "接受").status, 404);
  void wangwu; void lisi;
});

test("/tell (transport §7.2 回话): the owner's word into their DM with the agent, made when it is not there; the agent's queue gets it at the owner's level, first in line; only one's own agent, only words", () => {
  const { r, john, lisi, xiaoping, phone } = world();
  const token = phone(john);
  assert.equal(call(r, "POST /tell", { token, body: { agent: "nobody", text: "x" } }).json.error, "没有这个 agent");
  assert.equal(call(r, "POST /tell", { token, body: { agent: "xiaoping", text: " " } }).json.error, "缺正文");
  assert.equal(call(r, "POST /tell", { token: xiaoping.token, body: { agent: "xiaoping", text: "x" } }).json.error, "只有本人的令牌能说话");
  r.appendMessage(lisi.record, "john", "g-7", { id: "m-1", text: "@xiaoping 群里的先" });
  const told = call(r, "POST /tell", { token, body: { agent: "xiaoping", text: "看看 PR #12" } });
  assert.deepEqual([told.status, told.json], [201, { venue: "john/dm-xiaoping", agent: "xiaoping" }]);
  const dm = r.venueOf("john", "dm-xiaoping");
  assert.deepEqual([dm.venue.kind, dm.venue.agents, dm.messages.at(-1).speaker, dm.messages.at(-1).text], ["dm", ["xiaoping"], "person:john", "看看 PR #12"]);
  const pending = r.queueOf(xiaoping.record, "john", "xiaoping").pending;
  assert.deepEqual(pending.map((i) => [i.level, i.prompt, i.venueKind]), [["owner", "看看 PR #12", "dm"], ["member", "@xiaoping 群里的先", "group"]], "the owner's word first, before the group's");
  assert.equal(call(r, "POST /tell", { token, body: { agent: "xiaoping", text: "再一句" } }).status, 201, "the DM is reused");
  assert.equal(r.venueOf("john", "dm-xiaoping").messages.length, 2);
});
