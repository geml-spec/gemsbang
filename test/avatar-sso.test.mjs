import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { AvatarRelay, ssoHash } from "../dist/relay/avatars.js";
import { answerRequest } from "../dist/relay/avatar-shell.js";
import { authorizeUrl, identityOf } from "../dist/relay/sso.js";

const APPS = { google: { id: "g-id", secret: "g-secret" }, github: { id: "gh-id", secret: "gh-secret" }, facebook: { id: "fb-id", secret: "fb-secret" }, wechat: { id: "wx-id", secret: "wx-secret" } };
const ok = (x) => { assert.equal(x.ok, true, x.reason); return x; };
const bad = (x, status, code) => { assert.equal(x.ok, false); assert.deepEqual([x.status, x.code], [status, code], x.reason); return x; };
const reply = (v, status = 200) => ({ ok: status < 300, status, text: async () => JSON.stringify(v) });

/**
 * The four accounts as the adapters ask them, stood in: a code traded for a token, the token for who the person is.
 * `people` maps a code to what the account says: `me` its profile, `emails` GitHub's list, `openid` WeChat's.
 */
function accounts(people) {
  const asked = [];
  const fetch = async (url, init = {}) => {
    asked.push({ url, method: init.method ?? "GET", headers: init.headers ?? {}, body: init.body ?? "" });
    const u = new URL(url);
    const code = u.searchParams.get("code") ?? new URLSearchParams(init.body ?? "").get("code");
    if (/(token|access_token)$/.test(u.pathname) && code !== null) return people[code] === undefined ? reply({ error: "bad_code" }, 400) : reply({ access_token: `t-${code}`, ...(people[code].openid !== undefined ? { openid: people[code].openid } : {}) });
    const token = (init.headers?.authorization ?? "").replace(/^Bearer /, "") || u.searchParams.get("access_token") || "";
    const p = people[token.replace(/^t-/, "")];
    if (p === undefined) return reply({ message: "no" }, 401);
    return reply(u.pathname === "/user/emails" ? p.emails ?? [] : p.me);
  };
  return { fetch, asked };
}
function relay(people = {}, o = {}) {
  const { fetch, asked } = accounts(people);
  const r = new AvatarRelay({ root: mkdtempSync(join(tmpdir(), "gemsbang-sso-")), name: "relay.test", mailer: () => undefined, sso: APPS, fetch, ...o });
  return { r, asked };
}
const pair = () => { const secret = randomBytes(32).toString("hex"); return { secret, h: ssoHash(secret) }; };
/** Someone in by email, the code given back as for a test account. */
const byEmail = (r, email) => ok(r.finishLogin({ email, code: ok(r.startLogin({ email })).code }));

test("a sign-in through another account (S28): the link opens it for a hash; the account's yes says who; only the one with the secret takes the sign-in, once; an account not set up, a bad hash, a used one refused", () => {
  const { r } = relay({}, { sso: { github: APPS.github } });
  assert.deepEqual(r.providers(), ["github"], "only the accounts set up");
  const { secret, h } = pair();
  bad(r.ssoOpen("google", h), 404, "sso.unknown");
  bad(r.ssoOpen("github", "abc"), 400, "sso.bad");
  assert.equal(ok(r.ssoCheck({ secret })).state, "none");
  ok(r.ssoOpen("github", h));
  assert.deepEqual([r.ssoStateOf(h), ok(r.ssoCheck({ secret })).state, ok(r.ssoCheck({ secret })).kind], ["opened", "opened", "github"]);
  const done = ok(r.ssoDone(h, { kind: "github", sub: "583231", shown: "@octocat", emailVerified: false }));
  assert.deepEqual([done.new, done.added], [true, false]);
  const taken = ok(r.ssoCheck({ secret, device: "这台 Mac · Claude Code" }));
  assert.deepEqual([taken.state, taken.person, taken.new, typeof taken.token], ["done", done.person, true, "string"]);
  assert.equal(r.personOf(r.verify(taken.token)), done.person);
  assert.equal(ok(r.ssoCheck({ secret })).state, "none", "taken once");
  bad(r.ssoOpen("github", h), 410, "sso.gone");
  bad(r.ssoCheck({ secret: "short" }), 400, "sso.bad");
  const again = pair();
  ok(r.ssoOpen("github", again.h));
  assert.equal(ok(r.ssoDone(again.h, { kind: "github", sub: "583231", shown: "@octocat", emailVerified: false })).person, done.person, "the same account again: the same person");
  assert.deepEqual(r.methodsOf(done.person).map((m) => [m.kind, m.shown]), [["github", "@octocat"]], "and no second way in");
});

test("the same email (Q19 (a), 2026-11-04): an address the account checked that is already someone's way in is that person, the account one more way in; one it did not check, and Facebook's, are someone new", () => {
  const { r } = relay({}, { showCodeTo: ["john@gmail.com"] });
  const john = byEmail(r, "john@gmail.com");
  const g = pair();
  ok(r.ssoOpen("google", g.h));
  const joined = ok(r.ssoDone(g.h, { kind: "google", sub: "1001", shown: "j***@gmail.com", email: "john@gmail.com", emailVerified: true }));
  assert.deepEqual([joined.person, joined.new], [john.person, false]);
  assert.deepEqual(r.methodsOf(john.person).map((m) => m.kind), ["email", "google"]);
  for (const kind of ["github", "facebook"]) {
    const p = pair();
    ok(r.ssoOpen(kind, p.h));
    const other = ok(r.ssoDone(p.h, { kind, sub: `${kind}-7`, shown: "John", email: "john@gmail.com", emailVerified: false }));
    assert.deepEqual([other.person === john.person, other.new], [false, true], `${kind}: not checked, not joined`);
  }
});

test("添加登录方式 (S32): the person's client registers its hash first; the account its link opens is one more of their ways in, shown as it shows itself; an account that is someone else's is refused, and the client is told", () => {
  const { r } = relay({}, { showCodeTo: ["john@example.com", "lily@example.com"] });
  const john = byEmail(r, "john@example.com"), lily = byEmail(r, "lily@example.com");
  const add = pair();
  ok(r.ssoAdd(r.verify(john.token), { h: add.h }));
  bad(r.ssoAdd(r.verify(john.token), { h: add.h }), 409, "sso.gone");
  ok(r.ssoOpen("github", add.h));
  assert.deepEqual(ok(r.ssoDone(add.h, { kind: "github", sub: "42", shown: "@john", emailVerified: false })), { ok: true, person: john.person, new: false, added: true });
  assert.equal(ok(r.ssoCheck({ secret: add.secret })).state, "added");
  assert.deepEqual(r.methodsOf(john.person).map((m) => [m.kind, m.shown]), [["email", "j***@example.com"], ["github", "@john"]]);
  const steal = pair();
  ok(r.ssoAdd(r.verify(lily.token), { h: steal.h }));
  ok(r.ssoOpen("github", steal.h));
  bad(r.ssoDone(steal.h, { kind: "github", sub: "42", shown: "@john", emailVerified: false }), 409, "login.taken");
  assert.deepEqual([ok(r.ssoCheck({ secret: steal.secret })).state, ok(r.ssoCheck({ secret: steal.secret })).state], ["failed", "none"]);
  assert.deepEqual(r.methodsOf(lily.person).map((m) => m.kind), ["email"]);
});

test("the four accounts (S28, S30): where each sends the browser, with the app, the way back and the hash as its state; what each reads back — Google's checked email, GitHub's login and primary address, Facebook never trusted for joining, WeChat's unionid", async () => {
  const back = "https://gemsbang.com/login/callback/x";
  const urls = Object.fromEntries(["google", "github", "facebook", "wechat"].map((k) => [k, new URL(authorizeUrl(k, APPS[k], "h".repeat(64), back))]));
  assert.deepEqual([urls.google.host, urls.google.searchParams.get("scope"), urls.google.searchParams.get("state").length], ["accounts.google.com", "openid email profile", 64]);
  assert.deepEqual([urls.github.host, urls.github.searchParams.get("client_id"), urls.github.searchParams.get("redirect_uri")], ["github.com", "gh-id", back]);
  assert.equal(urls.facebook.searchParams.get("scope"), "email,public_profile");
  assert.deepEqual([urls.wechat.host, urls.wechat.searchParams.get("appid"), urls.wechat.hash], ["open.weixin.qq.com", "wx-id", "#wechat_redirect"]);
  const { fetch, asked } = accounts({
    g1: { me: { sub: "1001", email: "John@Gmail.com", email_verified: true, name: "John" } },
    gh1: { me: { id: 583231, login: "octocat" }, emails: [{ email: "o@work.example", primary: false, verified: true }, { email: "octo@example.com", primary: true, verified: true }] },
    fb1: { me: { id: "fb-9", name: "John Smith", email: "john@example.com" } },
    wx1: { openid: "o-1", me: { nickname: "小熊", unionid: "u-1" } },
  });
  assert.deepEqual(await identityOf("google", APPS.google, "g1", back, fetch), { kind: "google", sub: "1001", shown: "j***@gmail.com", email: "john@gmail.com", emailVerified: true });
  assert.deepEqual(await identityOf("github", APPS.github, "gh1", back, fetch), { kind: "github", sub: "583231", shown: "@octocat", email: "octo@example.com", emailVerified: true });
  assert.deepEqual(await identityOf("facebook", APPS.facebook, "fb1", back, fetch), { kind: "facebook", sub: "fb-9", shown: "John Smith", email: "john@example.com", emailVerified: false });
  assert.deepEqual(await identityOf("wechat", APPS.wechat, "wx1", back, fetch), { kind: "wechat", sub: "u-1", shown: "小熊", emailVerified: false });
  const tokenAsk = asked.find((a) => a.url === "https://oauth2.googleapis.com/token");
  assert.deepEqual([tokenAsk.method, new URLSearchParams(tokenAsk.body).get("client_secret")], ["POST", "g-secret"], "the secret goes only in the server's own request");
  await assert.rejects(identityOf("github", APPS.github, "nope", back, fetch), /sso\.failed/);
});

test("the browser's side (S28, sketch ③): /login/sso/<account> sends it on with the hash as the state; the account's answer at /login/callback names the person and says 登录成功; a refusal says why; a check on the sign-in is held until it moves", async () => {
  const { r } = relay({ c1: { me: { id: 77, login: "smith" }, emails: [] } });
  const call = (method, path, body) => answerRequest(r, { method, url: new URL(`https://gemsbang.com${path}`), base: "https://gemsbang.com", accept: "text/html", body: async () => (body === undefined ? "" : JSON.stringify(body)) });
  const { secret, h } = pair();
  const go = await call("GET", `/login/sso/github?h=${h}&lang=zh`);
  assert.equal(go.type.startsWith("text/html"), true);
  const to = new URL(go.body.match(/content="0;url=([^"]+)"/)[1].replace(/&amp;/g, "&"));
  assert.deepEqual([to.host, to.searchParams.get("state"), to.searchParams.get("redirect_uri")], ["github.com", h, "https://gemsbang.com/login/callback/github"]);
  assert.match(go.body, /正在打开 GitHub…/);
  // The pane's check, held while it stands where the client last saw it.
  const held = call("POST", "/login/sso/check", { secret, seen: "opened", timeout: 5 });
  const back = await call("GET", `/login/callback/github?code=c1&state=${h}`);
  assert.match(back.body, /<h1>登录成功<\/h1>/);
  const checked = JSON.parse((await held).body);
  assert.deepEqual([checked.state, typeof checked.token, checked.new], ["done", "string", true]);
  const no = pair();
  await call("GET", `/login/sso/github?h=${no.h}`);
  assert.match((await call("GET", `/login/callback/github?error=access_denied&state=${no.h}`)).body, /登录失败：未获得授权/);
  assert.equal(JSON.parse((await call("POST", "/login/sso/check", { secret: no.secret })).body).fail, "sso.denied");
  assert.match((await call("GET", `/login/sso/github?h=${h}`)).body, /登录链接已使用或已过期/);
  assert.deepEqual(JSON.parse((await answerRequest(r, { method: "GET", url: new URL("https://gemsbang.com/login/providers"), base: "https://gemsbang.com", body: async () => "" })).body), { providers: ["google", "github", "facebook", "wechat"] });
});

test("numbers by country (S29): a relay told which calling codes it may text sends to those alone; one told none texts nobody", () => {
  const texts = [];
  const { r } = relay({}, { textTo: ["+63", "+1"], texter: (t) => { texts.push(t); } });
  ok(r.startLogin({ phone: "+63 917 123 4567" }));
  bad(r.startLogin({ phone: "+8613800138000" }), 400, "phone.country");
  assert.deepEqual(texts.map((t) => t.to), ["+639171234567"]);
  bad(relay({}, { textTo: [] }).r.startLogin({ phone: "+14155550100" }), 400, "phone.country");
});
