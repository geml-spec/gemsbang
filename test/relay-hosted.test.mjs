import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { route } from "../dist/relay/api.js";
import { commandRunner, Orchestrator, workspaceFiles } from "../dist/relay/hosted.js";
import { Relay } from "../dist/relay/relay.js";
import { startRelay } from "../dist/relay/server.js";

const BASE = Date.UTC(2026, 9, 31, 9, 0, 0);
function relay() {
  let offset = 0;
  const mails = [];
  const now = () => { const t = new Date(BASE + offset).toISOString().replace(/\.\d{3}Z$/, "Z"); offset += 1000; return t; };
  const r = new Relay({ root: mkdtempSync(join(tmpdir(), "gemworks-relay-")), name: "relay.test", version: "0.0.0", now, mailer: (m) => { mails.push(m); } });
  r.mails = mails;
  return r;
}
function call(r, line, { token, body } = {}) {
  const [method, path] = line.split(" ");
  const res = route({ method, path, query: {}, ...(token !== undefined ? { token } : {}), ...(body !== undefined ? { body } : {}) }, r);
  return { status: res.status, json: res.type.startsWith("application/json") ? JSON.parse(res.body) : undefined, text: res.body };
}

/** 赵 registers (and so gets the hosted helper, with the free 20); john (100 credits) has a group with 赵 and helper in it. */
function world() {
  const r = relay();
  const john = r.issuePerson("john");
  r.topUp("john", 100);
  r.startLogin({ email: "zhao@x.io" });
  const zhao = r.finishLogin({ email: "zhao@x.io", code: /验证码是 (\d{6})/.exec(r.mails[0].text)[1], name: "zhao" });
  assert.equal(zhao.ok, true, zhao.reason);
  const helper = r.hostedAgents()[0];
  r.createVenue(john.record, { id: "g-1", kind: "group", name: "开源周会", people: ["zhao"], agents: ["agent:helper@zhao"] });
  const rounds = [];
  const runner = async (round) => { rounds.push(round); return round.item.prompt.includes("炸") ? { ok: false, error: "boom" } : { ok: true, text: `答：${round.prompt.split("\n").at(-1)}` }; };
  return { r, john, zhao, helper, rounds, runner, zhaoBy: r.verify(zhao.token) };
}
const lastOf = (r, owner, venue) => r.venueOf(owner, venue).messages.at(-1);

test("a round (transport §6 睡醒): an item on the hosted agent's queue, one run through the runner with the daemon's prompt — the envelope with the sender's scope, the text — in the agent's workspace; the answer posted as the agent under the message, the item read and answered with the reply's address, the owner's wallet charged a round through the agent's cap; an empty queue runs nothing", async () => {
  const { r, john, zhao, helper, rounds, runner } = world();
  const orch = new Orchestrator({ relay: r, runner, relayUrl: "http://relay.test" });
  assert.equal(r.appendMessage(john.record, "john", "g-1", { id: "m-1", text: "@helper 这个项目怎么跑？" }).ok, true);
  assert.equal(await orch.sweep(), 1);
  assert.equal(rounds.length, 1);
  const [round] = rounds;
  assert.deepEqual([round.person, round.agent, round.token, round.relayUrl, round.item.id, round.scope], ["zhao", "helper", helper.token, "http://relay.test", "qi-g-1-m-1", { write: false, run: "none", budget: round.scope.budget }]);
  assert.match(round.prompt, /^\[来自 群「开源周会」 · john（成员） · 权限：[^\]]+ · 队列中还有 0 条\]\n@helper 这个项目怎么跑？$/);
  assert.equal(round.workspace, join(r.root, "_hosted", "zhao", "helper"));
  assert.equal(existsSync(round.workspace), true, "the persistent workspace");
  const reply = lastOf(r, "john", "g-1");
  assert.deepEqual([reply.speaker, reply.kind, reply.text, reply.replyTo, reply.hops], ["agent:helper@zhao", "chat", "答：@helper 这个项目怎么跑？", "m-1", 0]);
  const q = r.queueOf(r.verify(helper.token), "zhao", "helper");
  assert.deepEqual(q.queue.markers.map((m) => [m.kind, m.item, m.reply !== undefined]), [["read", "qi-g-1-m-1", false], ["answered", "qi-g-1-m-1", true]]);
  assert.deepEqual(q.pending, []);
  const spent = r.ledgerOf("zhao").at(-1);
  assert.deepEqual([spent.kind, spent.amount, spent.agent, spent.cap, spent.note, r.balance("zhao")], ["spend", 1, "helper", "auto", "托管一轮 · 开源周会", 19]);
  assert.equal(await orch.sweep(), 0, "nothing pending");
  void zhao;
});

test("awake to the queue: with the orchestrator started, an append wakes the rounds on their own; a runner's error answers the item with a system line; a broke owner's item too; a second wake while the agent runs waits its turn", async () => {
  const { r, john, runner, rounds } = world();
  const orch = new Orchestrator({ relay: r, runner, relayUrl: "http://relay.test" });
  orch.start();
  r.appendMessage(john.record, "john", "g-1", { id: "m-1", text: "@helper 第一问" });
  r.appendMessage(john.record, "john", "g-1", { id: "m-2", text: "@helper 第二问" });
  await orch.idle();
  assert.deepEqual(rounds.map((x) => x.item.id), ["qi-g-1-m-1", "qi-g-1-m-2"]);
  assert.deepEqual(r.venueOf("john", "g-1").messages.map((m) => [m.speaker, m.replyTo]).slice(2), [["agent:helper@zhao", "m-1"], ["agent:helper@zhao", "m-2"]]);
  r.appendMessage(john.record, "john", "g-1", { id: "m-3", text: "@helper 炸一下" });
  await orch.idle();
  assert.deepEqual([lastOf(r, "john", "g-1").kind, lastOf(r, "john", "g-1").text], ["system", "helper 这一轮没跑成：boom"]);
  assert.equal(r.queueOf(r.verify(r.hostedAgents()[0].token), "zhao", "helper").pending.length, 0, "answered all the same");
  orch.stop();
  r.appendMessage(john.record, "john", "g-1", { id: "m-4", text: "@helper 停了以后" });
  await orch.idle();
  assert.equal(rounds.length, 3, "stopped: no round");
  const dear = new Orchestrator({ relay: r, runner, relayUrl: "http://relay.test", credits: 25 });
  assert.equal(await dear.sweep(), 1);
  assert.deepEqual([lastOf(r, "john", "g-1").kind, lastOf(r, "john", "g-1").text, rounds.length], ["system", "helper 这一轮没跑：积分不够：钱包 17", 3]);
});

test("the runner as a command: the prompt on stdin, the round in HOSTED_* variables, the workspace as its directory, the answer on stdout; a non-zero exit and the time limit are errors", async () => {
  const round = { person: "zhao", agent: "helper", token: "t", relayUrl: "http://relay.test", item: { id: "qi-1", prompt: "x" }, prompt: "[信封]\n问题", scope: { write: false, run: "none", budget: 5 }, workspace: mkdtempSync(join(tmpdir(), "gemworks-hosted-")) };
  const echo = commandRunner("node -e \"let s='';process.stdin.on('data',(c)=>{s+=c}).on('end',()=>{process.stdout.write('echo:'+s.split(String.fromCharCode(10)).pop()+'|'+process.env.HOSTED_AGENT+'|'+JSON.parse(process.env.HOSTED_SCOPE).budget+'|'+(require('fs').realpathSync(process.cwd())===require('fs').realpathSync(process.env.HOSTED_WORKSPACE)))})\"");
  assert.deepEqual(await echo(round), { ok: true, text: "echo:问题|helper|5|true" });
  assert.deepEqual(await commandRunner("node -e \"process.stderr.write('no model');process.exit(2)\"")(round), { ok: false, error: "runner exited 2: no model" });
  assert.deepEqual(await commandRunner("node -e \"setTimeout(()=>{},5000)\"", 1000)(round), { ok: false, error: "超时 1 秒" });
  assert.deepEqual(await commandRunner("node -e \"process.exit(0)\"")(round), { ok: true, text: "（这一轮没有回答）" });
});

test("搬家 (transport §6): the owner takes the token and the workspace's files (the cache left behind); the account stays, the queue goes on, the agent is hosted no more — no round, no 天然资格; the listing says which agents are hosted", () => {
  const { r, john, zhao, helper } = world();
  const workspace = join(r.root, "_hosted", "zhao", "helper");
  mkdirSync(join(workspace, "cache"), { recursive: true });
  mkdirSync(join(workspace, "skills"), { recursive: true });
  writeFileSync(join(workspace, "HOME.md"), "# helper\n", "utf8");
  writeFileSync(join(workspace, "skills", "pdf.md"), "pdf\n", "utf8");
  writeFileSync(join(workspace, "cache", "big.bin"), "x".repeat(10), "utf8");
  assert.deepEqual(workspaceFiles(workspace), [{ path: "HOME.md", text: "# helper\n" }, { path: "skills/pdf.md", text: "pdf\n" }]);
  assert.deepEqual(workspaceFiles(join(r.root, "_hosted", "nobody", "x")), []);
  assert.deepEqual(call(r, "GET /hosted", { token: zhao.token }).json, [{ agent: "helper" }]);
  assert.equal(call(r, "POST /hosted/helper/move", { token: john.token }).status, 404);
  assert.equal(call(r, "POST /hosted/helper/move", { token: helper.token }).status, 403);
  const moved = call(r, "POST /hosted/helper/move", { token: zhao.token });
  assert.deepEqual([moved.status, moved.json.token, moved.json.files], [200, helper.token, [{ path: "HOME.md", text: "# helper\n" }, { path: "skills/pdf.md", text: "pdf\n" }]]);
  assert.deepEqual([r.hostedAgents(), call(r, "GET /hosted", { token: zhao.token }).json, r.eligibilityOf("zhao", "helper")], [[], [], "还没有会话"]);
  assert.equal(call(r, "POST /hosted/helper/move", { token: zhao.token }).status, 404, "moved once");
  r.appendMessage(john.record, "john", "g-1", { id: "m-1", text: "@helper 还在吗" });
  assert.equal(r.verify(helper.token) !== undefined, true, "the token still works on the desktop");
  assert.equal(r.queueOf(r.verify(helper.token), "zhao", "helper").pending.length, 1, "the queue goes on");
});

test("the server runs the orchestrator when told: a round through the relay's own append, stopped with the server", async () => {
  const mails = [];
  const rounds = [];
  const s = await startRelay({ root: mkdtempSync(join(tmpdir(), "gemworks-relay-")), name: "relay.test", mailer: (m) => { mails.push(m); }, hosted: { runner: async (round) => { rounds.push(round); return { ok: true, text: "在" }; } } });
  try {
    assert.ok(s.hosted !== undefined, "the orchestrator on the server");
    const john = s.relay.issuePerson("john");
    s.relay.startLogin({ email: "zhao@x.io" });
    const zhao = s.relay.finishLogin({ email: "zhao@x.io", code: /验证码是 (\d{6})/.exec(mails[0].text)[1], name: "zhao" });
    assert.equal(zhao.ok, true, zhao.reason);
    s.relay.createVenue(john.record, { id: "g-1", kind: "group", name: "群", people: ["zhao"], agents: ["agent:helper@zhao"] });
    s.relay.appendMessage(john.record, "john", "g-1", { id: "m-1", text: "@helper 在吗" });
    await s.hosted.idle();
    assert.deepEqual([rounds.length, rounds[0].relayUrl, s.relay.venueOf("john", "g-1").messages.at(-1).text], [1, s.url, "在"]);
  } finally {
    await s.close();
  }
});
