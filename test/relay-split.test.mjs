import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { route } from "../dist/relay/api.js";
import { Relay } from "../dist/relay/relay.js";
import { readDoc } from "../dist/relay/store.js";

const BASE = Date.UTC(2026, 9, 31, 9, 0, 0);
function relay() {
  let offset = 0;
  const now = () => { const t = new Date(BASE + offset).toISOString().replace(/\.\d{3}Z$/, "Z"); offset += 1000; return t; };
  const r = new Relay({ root: mkdtempSync(join(tmpdir(), "gemworks-relay-")), name: "relay.test", version: "0.0.0", now, mailer: () => {} });
  r.advance = (ms) => { offset += ms; };
  return r;
}
function call(r, line, { token, body } = {}) {
  const [method, path] = line.split(" ");
  const res = route({ method, path, query: {}, ...(token !== undefined ? { token } : {}), ...(body !== undefined ? { body } : {}) }, r);
  return { status: res.status, json: res.type.startsWith("application/json") ? JSON.parse(res.body) : undefined, text: res.body };
}
const INPUT = { title: "给设置页加导出 PDF", goal: "设置页右上角一个按钮", context: { includes: [], excludes: [] }, accepts: [{ text: "单元测试通过", verify: { kind: "command", run: "npm test" } }], direction: "outsource", venueOfWork: "worker-sandbox", tools: ["read", "edit", "test"], budget: { credits: 40 }, reward: { kind: "none" } };
const child = (title, credits) => ({ ...INPUT, title, budget: { credits } });

/** John (agent 小评, a subscription session), 王五 (agent 小测, an API session, 接单模式 open), 李四; the group g-7. John has credits for the holds. */
function world() {
  const r = relay();
  const john = r.issuePerson("john"), wangwu = r.issuePerson("wangwu"), lisi = r.issuePerson("lisi");
  const xiaoping = r.issueAgent(john.record, "xiaoping"), xiaoce = r.issueAgent(wangwu.record, "xiaoce");
  r.createVenue(john.record, { id: "g-7", kind: "group", name: "前端周会", people: ["wangwu", "lisi"], agents: ["agent:xiaoping@john", "agent:xiaoce@wangwu"] });
  r.setPresence(xiaoce.record, { session: "cx-1", host: "claude-code", login: "api", presence: "idle" });
  r.setPresence(xiaoping.record, { session: "cp-1", host: "claude-code", login: "subscription", presence: "idle" });
  assert.equal(r.declare(wangwu.record, { agent: "xiaoce", open: true }).ok, true);
  r.topUp("john", 100); r.topUp("wangwu", 100);
  return { r, john, wangwu, lisi, xiaoping, xiaoce };
}
const draft = (r, token, input = INPUT) => call(r, "POST /tasks", { token, body: input }).json.card.id;
const publish = (r, token, owner, id) => call(r, `POST /tasks/${owner}/${id}/publish`, { token, body: { venue: "john/g-7" } });

test("改一下 (§8.1): the delegator or their agent changes a draft's fields; a stranger may not; a field that breaks the card is refused; nothing editable is refused; a published card is not a draft", () => {
  const { r, john, lisi, xiaoping } = world();
  const id = draft(r, john.token);
  assert.equal(call(r, `POST /tasks/john/${id}/edit`, { token: lisi.token, body: { goal: "x" } }).json.error, "只有委托人或其 agent 能改委托书");
  const edited = call(r, `POST /tasks/john/${id}/edit`, { token: xiaoping.token, body: { goal: "右上角一个按钮，导出成 PDF", budget: { credits: 20 } } });
  assert.deepEqual([edited.status, edited.json.card.goal, edited.json.card.budget, edited.json.card.state], [200, "右上角一个按钮，导出成 PDF", { credits: 20 }, "draft"]);
  assert.equal(call(r, `POST /tasks/john/${id}/edit`, { token: john.token, body: { title: "" } }).json.error, "缺标题");
  assert.equal(call(r, `POST /tasks/john/${id}/edit`, { token: john.token, body: { parent: "x", nothing: 1 } }).json.error, "没有可改的字段");
  assert.deepEqual(readDoc(r.root, "john", `cards/${id}.geml`).blocks.map((b) => b.id), ["card", "edit-1"]);
  assert.equal(call(r, `GET /tasks/john/${id}`, { token: john.token }).json.brief[0].text, "右上角一个按钮，导出成 PDF", "the 委托书 reads the edit");
  publish(r, john.token, "john", id);
  assert.equal(call(r, `POST /tasks/john/${id}/edit`, { token: john.token, body: { goal: "再改" } }).json.error, "卡在发布，发布后不能改；撤回再改");
});

test("拆分 (§8.4): the worker (or the delegator's agent) splits an in-progress card into drafts under the splitter's own name, each with the parent; the budgets sum to no more than the parent's; two levels at most; the parent stays 进行中 with its children; the tree is the delegator's to see", () => {
  const { r, john, wangwu, lisi, xiaoping, xiaoce } = world();
  const id = draft(r, john.token);
  assert.equal(call(r, `POST /tasks/john/${id}/split`, { token: john.token, body: { children: [child("a", 1)] } }).json.error, "卡在草拟，只有进行中的卡能拆");
  publish(r, john.token, "john", id);
  assert.equal(call(r, `POST /tasks/john/${id}/claim`, { token: xiaoce.token }).json.card.state, "in-progress");
  assert.equal(call(r, `POST /tasks/john/${id}/split`, { token: lisi.token, body: { children: [child("a", 1)] } }).json.error, "只有接单方或委托人的 agent 能拆卡");
  assert.equal(call(r, `POST /tasks/john/${id}/split`, { token: xiaoce.token, body: { children: [] } }).json.error, "子卡至少一张");
  assert.equal(call(r, `POST /tasks/john/${id}/split`, { token: xiaoce.token, body: { children: [child("a", 25), child("b", 20)] } }).json.error, "子卡的预算总和 45 超过父卡的 40");
  assert.equal(call(r, `POST /tasks/john/${id}/split`, { token: xiaoce.token, body: { children: [{ title: "a" }] } }).json.error, "第 1 张子卡：缺目标（去办什么）；方向是 outsource 或 dispatch；执行场地是 worker-sandbox 或 resource-sandbox；验收标准至少一条");
  const split = call(r, `POST /tasks/john/${id}/split`, { token: xiaoce.token, body: { children: [child("导出的后端", 25), child("按钮和样式", 10)] } });
  assert.equal(split.status, 200, split.text);
  assert.deepEqual([split.json.card.state, split.json.children.map((c) => c.owner), split.json.card.children], ["in-progress", ["wangwu", "wangwu"], split.json.children.map((c) => c.address)]);
  const [c1, c2] = split.json.children;
  const kid = call(r, `GET /tasks/wangwu/${c1.id}`, { token: wangwu.token }).json.card;
  assert.deepEqual([kid.state, kid.by, kid.parent, kid.title, kid.budget], ["draft", "person:wangwu", `https://relay.test/john/cards/${id}.geml`, "导出的后端", { credits: 25 }]);
  assert.equal(call(r, `GET /tasks/wangwu/${c1.id}`, { token: john.token }).status, 200, "the root's delegator reads the child");
  assert.equal(call(r, `GET /tasks/wangwu/${c1.id}`, { token: lisi.token }).status, 403);
  const tree = call(r, `GET /tasks/john/${id}/tree`, { token: john.token });
  assert.deepEqual(tree.json.tree, { owner: "john", id, title: "给设置页加导出 PDF", state: "in-progress", stateWord: "进行中", by: "person:john", children: [{ owner: "wangwu", id: c1.id, title: "导出的后端", state: "draft", stateWord: "草拟", by: "person:wangwu", children: [] }, { owner: "wangwu", id: c2.id, title: "按钮和样式", state: "draft", stateWord: "草拟", by: "person:wangwu", children: [] }] });
  assert.equal(call(r, `GET /tasks/john/${id}/tree`, { token: lisi.token }).status, 403);
  // a second level: the child, claimed by 小评 (opened, an API session now), split once more; its child may not be split again
  r.setPresence(xiaoping.record, { session: "cp-2", host: "claude-code", login: "api", presence: "idle" });
  r.declare(john.record, { agent: "xiaoping", open: true });
  publish(r, wangwu.token, "wangwu", c1.id);
  assert.equal(call(r, `POST /tasks/wangwu/${c1.id}/claim`, { token: xiaoping.token }).json.card.state, "in-progress");
  const deeper = call(r, `POST /tasks/wangwu/${c1.id}/split`, { token: xiaoping.token, body: { children: [child("接口", 10), child("存储", 15)] } });
  assert.equal(deeper.status, 200, deeper.text);
  const g1 = deeper.json.children[0];
  assert.deepEqual([g1.owner, call(r, `GET /tasks/john/${g1.id}`, { token: wangwu.token }).status, call(r, `GET /tasks/john/${g1.id}`, { token: john.token }).status], ["john", 200, 200], "the chain: the child's delegator and the root's both read the grandchild");
  publish(r, john.token, "john", g1.id);
  call(r, `POST /tasks/john/${g1.id}/claim`, { token: xiaoce.token });
  assert.equal(call(r, `POST /tasks/john/${g1.id}/split`, { token: xiaoce.token, body: { children: [child("更细", 1)] } }).json.error, "拆分最多两层");
  assert.deepEqual(call(r, `GET /tasks/john/${id}/tree`, { token: john.token }).json.tree.children[0].children.map((c) => [c.title, c.state]), [["接口", "in-progress"], ["存储", "draft"]]);
  assert.equal(call(r, `POST /tasks/john/${id}/split`, { token: xiaoping.token, body: { children: [child("委托人的 agent 也能拆", 5)] } }).status, 200, "the delegator's agent, within what is left");
  assert.equal(call(r, `POST /tasks/john/${id}/split`, { token: xiaoping.token, body: { children: [child("超了", 1)] } }).json.error, "子卡的预算总和 41 超过父卡的 40", "the children so far count");
});

test("接单声明 (§9.2): the owner writes it, the page shows the four lines and the eligibility the host reports; a claim needs 接单模式 open and the hours; a card to a named agent says what it waits for; a hosted agent is eligible with no session; the page needs no token", () => {
  const { r, john, wangwu, lisi, xiaoping, xiaoce } = world();
  assert.equal(call(r, "POST /agents/xiaoce/declare", { token: xiaoce.token, body: { open: true } }).status, 403);
  assert.equal(call(r, "POST /agents/nobody/declare", { token: wangwu.token, body: { open: true } }).status, 404);
  assert.equal(call(r, "POST /agents/xiaoce/declare", { token: wangwu.token, body: { hours: "night" } }).json.error, "时段写成 22:00-08:00+08:00");
  const declared = call(r, "POST /agents/xiaoce/declare", { token: wangwu.token, body: { hours: "22:00-08:00+08:00", budget: 200000, kinds: ["评审"], skills: ["pdf"], network: true } });
  assert.deepEqual([declared.status, declared.json.declaration, declared.json.lines], [200, { open: true, hours: { from: "22:00", to: "08:00", tz: "+08:00" }, budget: 200000, kinds: ["评审"], skills: ["pdf"], network: true }, ["资格：API 会话 · 有资格", "时段：每天 22:00 到 08:00 · 主人睡了之后", "预算：每天 200000 token · 推理走平台池", "接什么：评审 · skill pdf · 可联网"]], "over the earlier open: true");
  const page = call(r, "GET /a/wangwu/xiaoce");
  assert.deepEqual([page.status, page.json.label, page.json.presenceWord, page.json.eligibility, page.json.numbers, page.json.askable, page.json.modeWord, page.json.lines.length], [200, "xiaoce · 代 wangwu", "空闲", "API 会话 · 有资格", { accepted: 0, reviews: 0, disputes: 0 }, true, "只潜水", 4]);
  assert.equal(call(r, "GET /a/john/xiaoping").json.eligibility, "只有订阅登录的会话 · 不显示接单入口");
  assert.equal(call(r, "GET /a/john/nobody").status, 404);
  // 17:00 in +08:00: outside the hours
  const id = draft(r, john.token, { ...INPUT, worker: "agent:xiaoce@wangwu" });
  publish(r, john.token, "john", id);
  assert.equal(call(r, `GET /tasks/john/${id}`, { token: john.token }).json.waitingOn, "等它有资格的会话 · 每天 22:00 到 08:00");
  assert.equal(call(r, `POST /tasks/john/${id}/claim`, { token: xiaoce.token }).json.error, "xiaoce 只在每天 22:00 到 08:00接单");
  r.advance(6 * 3_600_000);
  assert.equal(call(r, `GET /tasks/john/${id}`, { token: john.token }).json.waitingOn, "xiaoce", "23:00: it could claim now");
  assert.equal(call(r, `POST /tasks/john/${id}/claim`, { token: xiaoce.token }).json.card.state, "in-progress");
  assert.equal(call(r, "POST /agents/xiaoce/declare", { token: wangwu.token, body: { open: false, hours: null } }).json.lines.at(-1), "接单模式：关");
  const id2 = draft(r, john.token, { ...INPUT, worker: "agent:xiaoce@wangwu" });
  publish(r, john.token, "john", id2);
  assert.equal(call(r, `GET /tasks/john/${id2}`, { token: john.token }).json.waitingOn, "等主人开接单模式");
  assert.equal(call(r, `POST /tasks/john/${id2}/claim`, { token: xiaoce.token }).json.error, "xiaoce 没开接单模式");
  assert.equal(call(r, `POST /tasks/john/${id2}/claim`, { token: xiaoping.token }).json.error, "这张卡派给了 xiaoce");
  assert.equal(call(r, "GET /a/wangwu/xiaoce").json.askable, false);
  void lisi;
});

test("a hosted agent claims with no session (§9.2 天然有资格) once its owner opened 接单模式", () => {
  const mails = [];
  const r = relay();
  const rr = new Relay({ root: r.root, name: "relay.test", version: "0.0.0", now: r.now.bind(r), mailer: (m) => { mails.push(m); } });
  const john = rr.issuePerson("john");
  rr.topUp("john", 100);
  assert.equal(rr.startLogin({ email: "zhao@x.io" }).ok, true);
  const code = /验证码是 (\d{6})/.exec(mails[0].text)[1];
  const zhao = rr.finishLogin({ email: "zhao@x.io", code, name: "zhao" });
  assert.equal(zhao.ok, true, zhao.reason);
  assert.equal(rr.eligibilityOf("zhao", "helper"), "托管 · 天然有资格");
  rr.createVenue(john.record, { id: "g-7", kind: "group", name: "群", people: ["zhao"], agents: ["agent:helper@zhao"] });
  const id = draft(rr, john.token);
  publish(rr, john.token, "john", id);
  assert.equal(call(rr, `POST /tasks/john/${id}/claim`, { token: rr.hostedAgents()[0].token }).json.error, "helper 没开接单模式");
  assert.equal(rr.declare(rr.verify(zhao.token), { agent: "helper", open: true }).ok, true);
  assert.equal(call(rr, `POST /tasks/john/${id}/claim`, { token: rr.hostedAgents()[0].token }).json.card.state, "in-progress");
  assert.equal(call(rr, "GET /a/zhao/helper").json.eligibility, "托管 · 天然有资格");
});
