import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startAvatarRelay } from "../dist/relay/avatar-server.js";
import { deviceName, runGb } from "../dist/gemsbang/ops.js";
import { gbService, readClient } from "../dist/gemsbang/home.js";

/** A service on a free port, its mail kept; a client home per machine, signing in to that service with no relay named. */
async function world(more = {}) {
  const mail = [];
  const s = await startAvatarRelay({ root: mkdtempSync(join(tmpdir(), "gemsbang-account-relay-")), name: "relay.test", mailFrom: "gemsbang.com", mailer: (m) => { mail.push(m); }, ...more });
  const machine = (device) => {
    const home = mkdtempSync(join(tmpdir(), "gemsbang-account-home-"));
    const gb = (call, args = {}) => runGb(call, args, { home, now: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), service: s.url, ...(device !== undefined ? { device } : {}) });
    return { home, gb };
  };
  const code = () => /(\d{6})/.exec(mail[mail.length - 1].text)[1];
  return { s, mail, machine, code };
}
const ok = (x) => { assert.equal(x.ok, true, x.reason); return x; };
const bad = (x, code) => { assert.equal(x.ok, false); assert.equal(x.code, code, x.reason); return x; };

test("the service is built in (architecture §3.2): GEMSBANG_SERVICE for a developer's, else gemsbang.com; a machine names itself by its system", () => {
  assert.deepEqual([gbService({}), gbService({ GEMSBANG_SERVICE: "http://127.0.0.1:7710/" })], ["https://gemsbang.com", "http://127.0.0.1:7710"]);
  assert.deepEqual([deviceName("darwin"), deviceName("win32"), deviceName("linux")], ["Mac · Claude Code", "Windows · Claude Code", "Linux · Claude Code"]);
});

test("signing in on a machine (architecture §3.2): an email and its code, no server to fill in; a new person names their first avatar and this session plays it", async () => {
  const { s, machine, code } = await world();
  try {
    const mac = machine("这台 Mac · Claude Code");
    const before = ok(await mac.gb("status")).view;
    assert.deepEqual([before.loggedIn, before.relay], [false, s.url]);
    bad(await mac.gb("login-start", { email: "john" }), "email.bad");
    const sent = ok(await mac.gb("login-start", { email: "John@example.com" }));
    assert.equal(sent.text, "验证码已发送至 j***@example.com，发件人 gemsbang.com，10 分钟内有效");
    const inside = ok(await mac.gb("login-verify", { email: "John@example.com", code: code() })).view;
    assert.deepEqual([inside.loggedIn, inside.avatars], [true, []]);
    const named = ok(await mac.gb("first-avatar", { name: "John", session: "s-1" })).view;
    assert.deepEqual([named.avatars.map((a) => a.name), named.bodies["s-1"]], [["John"], named.avatars[0].id]);
    bad(await mac.gb("first-avatar", { name: "Lily 爸爸" }), "avatar.notFirst");
    assert.equal(readClient(mac.home).relay, "", "the service is not written down as a relay");
  } finally { await s.close(); }
});

test("the beta before mail (2026-11-04): an email the service gives the code back for is signed in by login-start itself, and one more way in added by method-start; any other gets its code by mail", async () => {
  const { s, mail, machine } = await world({ showCodeTo: ["john@example.com", "john@work.example"] });
  try {
    const mac = machine();
    const inside = ok(await mac.gb("login-start", { email: "John@example.com" })).view;
    assert.deepEqual([inside.loggedIn, mail.length], [true, 0]);
    assert.equal(ok(await mac.gb("method-start", { email: "john@work.example" })).account.methods.length, 2);
    const lily = machine();
    assert.match(ok(await lily.gb("login-start", { email: "lily@example.com" })).text, /^验证码已发送至 l\*\*\*@example\.com/);
    assert.equal(ok(await lily.gb("status")).view.loggedIn, false);
  } finally { await s.close(); }
});

test("through another account from a machine (S28, S32): nobody signed in, the view carries a link per account the service set up, its hash from a secret kept here; the browser opening it and the account's yes sign this machine in on the next wait; 加一种 adds GitHub to the account the same way; 取消 makes a new secret", async () => {
  const people = { c1: { id: 77, login: "smith" }, c2: { id: 78, login: "john" } };
  const reply = (v, status = 200) => ({ ok: status < 300, status, text: async () => JSON.stringify(v) });
  const accounts = async (url, init = {}) => {
    const u = new URL(url), code = new URLSearchParams(init.body ?? "").get("code");
    if (u.pathname.endsWith("access_token")) return reply({ access_token: `t-${code}` });
    const me = people[(init.headers?.authorization ?? "").replace(/^Bearer t-/, "")];
    return me === undefined ? reply({}, 401) : reply(u.pathname === "/user/emails" ? [] : me);
  };
  const { s, machine, code } = await world({ sso: { github: { id: "gh-id", secret: "gh-secret" } }, fetch: accounts });
  try {
    const mac = machine("这台 Mac · Claude Code");
    const before = ok(await mac.gb("status")).view;
    assert.deepEqual([before.loggedIn, before.signIn.map((l) => l.kind)], [false, ["github"]]);
    const link = new URL(before.signIn[0].url);
    assert.deepEqual([link.origin, link.pathname, link.searchParams.get("h").length, link.searchParams.get("lang")], [s.url, "/login/sso/github", 64, "zh"]);
    assert.equal(ok(await mac.gb("status")).view.signIn[0].url, link.href, "the same secret until it is used");
    assert.equal(readClient(mac.home).sso.length, 64, "the secret stays on this machine");
    assert.equal((await mac.gb("sso-wait", { seen: "none", timeout: 0 })).sso.state, "none", "not opened yet");
    const go = await (await fetch(link, { headers: { accept: "text/html" } })).text();
    assert.match(go, /正在打开 GitHub…/);
    assert.deepEqual((await mac.gb("sso-wait", { seen: "none", timeout: 0 })).sso, { state: "opened", kind: "github" }, "the pane learns the browser opened it");
    const h = link.searchParams.get("h");
    const waiting = mac.gb("sso-wait", { seen: "opened", timeout: 5 });
    assert.match(await (await fetch(`${s.url}/login/callback/github?code=c1&state=${h}`)).text(), /登录成功/);
    const inside = ok(await waiting);
    assert.deepEqual([inside.sso.state, inside.view.loggedIn, inside.view.avatars], ["done", true, []]);
    assert.equal(readClient(mac.home).sso, undefined, "the secret goes once used");
    const added = ok(await mac.gb("sso-add"));
    assert.deepEqual(added.links.map((l) => l.kind), ["github"]);
    const addLink = new URL(added.links[0].url);
    await fetch(addLink, { headers: { accept: "text/html" } });
    assert.match(await (await fetch(`${s.url}/login/callback/github?code=c2&state=${addLink.searchParams.get("h")}`)).text(), /已添加/);
    const account = ok(await mac.gb("sso-wait", { add: true, seen: "opened", timeout: 0 }));
    assert.deepEqual([account.sso.state, account.account.methods.map((m) => [m.kind, m.shown])], ["added", [["github", "@smith"], ["github", "@john"]]]);
    const lily = machine();
    const first = ok(await lily.gb("status")).view.signIn[0].url;
    ok(await lily.gb("sso-cancel"));
    assert.notEqual(ok(await lily.gb("status")).view.signIn[0].url, first, "取消: a new secret");
    void code;
  } finally { await s.close(); }
});

test("the account from a machine (architecture §3.1): ways in added and taken off, never the last; devices listed, another signed out; signing out here drops this machine's token at the service", async () => {
  const { s, machine, code } = await world();
  try {
    const mac = machine("这台 Mac · Claude Code"), web = machine("网页 · Safari");
    for (const m of [mac, web]) { ok(await m.gb("login-start", { email: "john@example.com" })); ok(await m.gb("login-verify", { email: "john@example.com", code: code() })); }
    let account = ok(await mac.gb("account")).account;
    assert.deepEqual([account.methods.map((m) => m.shown), account.devices.map((d) => [d.name, d.current])], [["j***@example.com"], [["这台 Mac · Claude Code", true], ["网页 · Safari", false]]]);
    assert.match(ok(await mac.gb("method-start", { email: "john@work.example" })).text, /j\*\*\*@work\.example/);
    account = ok(await mac.gb("method-verify", { email: "john@work.example", code: code() })).account;
    assert.equal(account.methods.length, 2);
    account = ok(await mac.gb("method-remove", { id: account.methods[0].id })).account;
    assert.deepEqual(account.methods.map((m) => m.shown), ["j***@work.example"]);
    bad(await mac.gb("method-remove", { id: account.methods[0].id }), "login.last");
    account = ok(await mac.gb("device-revoke", { id: account.devices[1].id })).account;
    assert.equal(account.devices.length, 1);
    assert.equal(ok(await web.gb("status")).view.loggedIn, false, "signed out there, it finds out on its next look");
    ok(await mac.gb("devices-revoke-others"));
    const token = readClient(mac.home).token;
    assert.equal(ok(await mac.gb("logout")).view.loggedIn, false);
    assert.equal(s.relay.verify(token), undefined);
  } finally { await s.close(); }
});
