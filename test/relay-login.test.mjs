import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { route } from "../dist/relay/api.js";
import { Relay } from "../dist/relay/relay.js";
import { readDoc } from "../dist/relay/store.js";
import { commandMailer } from "../dist/relay/mail.js";

const BASE = Date.UTC(2026, 9, 31, 9, 0, 0);
function relay(extra = {}) {
  let offset = 0;
  const now = () => { const t = new Date(BASE + offset).toISOString().replace(/\.\d{3}Z$/, "Z"); offset += 1000; return t; };
  const r = new Relay({ root: mkdtempSync(join(tmpdir(), "gemworks-relay-")), name: "relay.test", version: "0.0.0", now, ...extra });
  r.advance = (ms) => { offset += ms; };
  return r;
}
function call(r, line, { token, body, ip } = {}) {
  const [method, path] = line.split(" ");
  const res = route({ method, path, query: {}, ...(token !== undefined ? { token } : {}), ...(body !== undefined ? { body } : {}), ...(ip !== undefined ? { ip } : {}) }, r);
  return { status: res.status, json: res.type.startsWith("application/json") ? JSON.parse(res.body) : undefined, text: res.body };
}
const codeIn = (mail) => /验证码是 (\d{6})/.exec(mail.text)[1];

test("login (transport §7.1): a code mailed to the address, six digits, ten minutes, once; the wrong one, a short one, a stale one; three an address in ten minutes, ten a network an hour; the first login names the person, writes their page, the hosted agent with its token kept for the platform, and the DM with the welcome; the next login needs no name; the roads", () => {
  const mails = [];
  const r = relay({ mailer: (m) => { mails.push(m); } });
  assert.equal(call(r, "POST /login", { body: { email: "nope" } }).json.error, "要一个邮箱地址");
  const started = call(r, "POST /login", { body: { email: " Zhang@Example.com " }, ip: "10.0.0.1" });
  assert.deepEqual([started.status, started.json], [200, { sent: true, known: false }]);
  assert.deepEqual([mails.length, mails[0].to, mails[0].subject], [1, "zhang@example.com", "Gemsbang 登录验证码"]);
  assert.match(mails[0].text, /^你的验证码是 \d{6}，10 分钟内有效。/);
  const code = codeIn(mails[0]);
  assert.equal(call(r, "POST /login/verify", { body: { email: "zhang@example.com", code: "12" } }).json.error, "验证码是六位数字");
  assert.equal(call(r, "POST /login/verify", { body: { email: "zhang@example.com", code: code === "000000" ? "000001" : "000000" } }).json.error, "验证码不对或过期了");
  assert.equal(call(r, "POST /login/verify", { body: { email: "other@example.com", code } }).json.error, "验证码不对或过期了", "another address");
  assert.equal(call(r, "POST /login/verify", { body: { email: "zhang@example.com", code } }).json.error, "新用户要取个名字");
  assert.equal(call(r, "POST /login/verify", { body: { email: "zhang@example.com", code, name: "wallet" } }).json.error, "这个名字留给系统");
  assert.equal(call(r, "POST /login/verify", { body: { email: "zhang@example.com", code, name: "bad name" } }).json.error, "名字不合法：字母、数字、_ 和 -，最多 64 个");
  r.issuePerson("taken");
  assert.equal(call(r, "POST /login/verify", { body: { email: "zhang@example.com", code, name: "taken" } }).json.error, "这个名字已经有人用了");
  const done = call(r, "POST /login/verify", { body: { email: "ZHANG@example.com", code, name: "zhangsan" } });
  assert.equal(done.status, 200, done.text);
  assert.deepEqual([done.json.person, done.json.new, done.json.agent, done.json.venue], ["zhangsan", true, "helper", "dm-helper"]);
  assert.match(done.json.token, /^gwx_/);
  assert.equal(call(r, "GET /me", { token: done.json.token }).json.speaker, "person:zhangsan");
  assert.equal(call(r, "POST /login/verify", { body: { email: "zhang@example.com", code } }).json.error, "验证码不对或过期了", "a code is good once");
  assert.ok(readDoc(r.root, "zhangsan", "people/zhangsan.geml").exists);
  assert.ok(readDoc(r.root, "zhangsan", "agents/helper.geml").exists);
  assert.deepEqual(r.agentsOf("zhangsan"), ["helper"]);
  const dm = r.venueOf("zhangsan", "dm-helper");
  assert.deepEqual([dm.venue.kind, dm.venue.name, dm.venue.people, dm.venue.agents, dm.messages.length, dm.messages[0].speaker, dm.messages[0].id], ["dm", "helper", ["zhangsan"], ["helper"], 1, "agent:helper@zhangsan", "m-welcome"]);
  assert.match(dm.messages[0].text, /^你好 zhangsan，我是 helper，你的托管 agent/);
  assert.deepEqual(r.hostedAgents().map((h) => [h.person, h.agent, h.token.startsWith("gwx_")]), [["zhangsan", "helper", true]]);
  assert.equal(r.verify(r.hostedAgents()[0].token).speaker, "agent:helper@zhangsan");
  assert.equal(r.balance("zhangsan"), 20, "the free allowance");
  assert.equal(call(r, "GET /zhangsan/venues/dm-helper.geml", { token: done.json.token }).json.blocks.length, 2, "the person reads their DM");
  // the next login: the person is known, no name wanted, a fresh token
  const again = call(r, "POST /login", { body: { email: "zhang@example.com" }, ip: "10.0.0.1" });
  assert.deepEqual(again.json, { sent: true, known: true });
  const back = call(r, "POST /login/verify", { body: { email: "zhang@example.com", code: codeIn(mails[1]) } });
  assert.deepEqual([back.status, back.json.person, back.json.new, back.json.agent], [200, "zhangsan", false, undefined]);
  assert.notEqual(back.json.token, done.json.token);
  assert.equal(call(r, "GET /me", { token: back.json.token }).json.speaker, "person:zhangsan");
  assert.deepEqual(r.agentsOf("zhangsan"), ["helper"], "no second hosted agent");
  // the limits
  assert.equal(call(r, "POST /login", { body: { email: "zhang@example.com" }, ip: "10.0.0.1" }).status, 200);
  assert.equal(call(r, "POST /login", { body: { email: "zhang@example.com" }, ip: "10.0.0.1" }).json.error, "验证码发得太频繁，过十分钟再试");
  assert.equal(mails.length, 3);
  r.advance(11 * 60_000);
  assert.equal(call(r, "POST /login", { body: { email: "zhang@example.com" }, ip: "10.0.0.1" }).status, 200, "ten minutes on, another");
  assert.equal(call(r, "POST /login/verify", { body: { email: "zhang@example.com", code: codeIn(mails[2]) } }).json.error, "验证码不对或过期了", "the old one is stale");
  assert.equal(call(r, "POST /login/verify", { body: { email: "zhang@example.com", code: codeIn(mails[3]) } }).status, 200);
  for (let i = 0; i < 10; i++) assert.equal(call(r, "POST /login", { body: { email: `p${i}@x.io` }, ip: "10.0.0.2" }).status, 200);
  assert.equal(call(r, "POST /login", { body: { email: "p11@x.io" }, ip: "10.0.0.2" }).json.error, "验证码发得太频繁，过十分钟再试", "ten a network address an hour");
  assert.equal(call(r, "POST /login", { body: { email: "p11@x.io" }, ip: "10.0.0.3" }).status, 200);
  assert.equal(call(r, "GET /login").status, 405);
  assert.equal(call(r, "POST /login/nope", { body: {} }).status, 404);
});

test("the mailers: by default a file under the relay's own folder; the command mailer runs the command with the address and subject in its environment and the text on stdin, and a failing command rejects", async () => {
  const r = relay();
  assert.equal(r.startLogin({ email: "a@b.co" }).ok, true);
  const dir = join(r.root, "_relay", "mail");
  const files = readdirSync(dir);
  assert.equal(files.length, 1);
  assert.match(readFileSync(join(dir, files[0]), "utf8"), /^To: a@b\.co\nSubject: Gemsbang 登录验证码\n\n你的验证码是 \d{6}，10 分钟内有效。/);
  const script = join(r.root, "mail.cjs"), out = join(r.root, "sent.txt");
  writeFileSync(script, 'const fs = require("node:fs"); let s = ""; process.stdin.on("data", (c) => { s += c; }).on("end", () => fs.writeFileSync(process.argv[2], process.env.MAIL_TO + "|" + process.env.MAIL_SUBJECT + "|" + s));');
  await commandMailer(`"${process.execPath}" "${script}" "${out}"`)({ to: "x@y.z", subject: "S", text: "body" });
  assert.equal(readFileSync(out, "utf8"), "x@y.z|S|body");
  await assert.rejects(commandMailer(`"${process.execPath}" -e "process.exit(3)"`)({ to: "x", subject: "s", text: "t" }), /exited 3/);
});
