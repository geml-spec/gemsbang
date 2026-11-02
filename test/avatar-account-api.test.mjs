import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AvatarRelay } from "../dist/relay/avatars.js";
import { routeAvatars } from "../dist/relay/avatar-api.js";

function setup() {
  const mail = [];
  const relay = new AvatarRelay({ root: mkdtempSync(join(tmpdir(), "gemsbang-account-api-")), name: "relay.test", mailFrom: "gemsbang.com", mailer: (m) => { mail.push(m); } });
  const call = (method, path, o = {}) => {
    const [p, q = ""] = path.split("?");
    const res = routeAvatars({ method, path: p, query: Object.fromEntries(new URLSearchParams(q)), base: "https://gemsbang.com", ...o }, relay);
    return { status: res.status, body: JSON.parse(res.body) };
  };
  const code = () => /(\d{6})/.exec(mail[mail.length - 1].text)[1];
  const signIn = (email, device) => {
    assert.equal(call("POST", "/login", { body: { email } }).status, 200);
    return call("POST", "/login/verify", { body: { email, code: code(), device } }).body;
  };
  return { relay, mail, call, code, signIn };
}

test("signing in by email over HTTP (architecture §3.2): where the code went and who sent it; a new person names their first avatar, once", () => {
  const { call, signIn } = setup();
  assert.deepEqual(call("POST", "/login", { body: { email: "john@example.com" } }).body, { sent: true, known: false, to: "j***@example.com", from: "gemsbang.com" });
  assert.equal(call("POST", "/login", { body: { email: "nope" }, languages: "en" }).body.reason, "That is not an email address");
  const john = signIn("lily@example.com", "这台 Mac · Claude Code");
  assert.equal(john.new, true);
  const first = call("POST", "/avatars", { token: john.token, body: { name: "John" } });
  assert.deepEqual([first.status, first.body.avatar.name], [201, "John"]);
  assert.deepEqual(call("POST", "/avatars", { token: john.token, body: { name: "Lily 爸爸" } }).body.error, "avatar.notFirst");
  assert.deepEqual(call("GET", "/me", { token: john.token }).body.avatars.map((a) => a.name), ["John"]);
});

test("the account over HTTP (architecture §3.1): ways in listed, one added with a code, one taken off but never the last; devices listed and signed out; signing out here", () => {
  const { call, code, signIn } = setup();
  const mac = signIn("john@example.com", "这台 Mac · Claude Code");
  const web = signIn("john@example.com", "网页 · Safari");
  const t = mac.token;
  assert.deepEqual(call("GET", "/me/methods", { token: t }).body.methods.map((m) => m.shown), ["j***@example.com"]);
  assert.equal(call("POST", "/me/methods", { token: t, body: { email: "john@work.example" } }).body.to, "j***@work.example");
  const added = call("POST", "/me/methods/verify", { token: t, body: { email: "john@work.example", code: code() } }).body.methods;
  assert.equal(added.length, 2);
  assert.equal(call("POST", `/me/methods/${added[0].id}/remove`, { token: t }).body.methods.length, 1);
  assert.equal(call("POST", `/me/methods/${added[1].id}/remove`, { token: t }).body.error, "login.last");
  const devices = call("GET", "/me/devices", { token: t }).body.devices;
  assert.deepEqual(devices.map((d) => [d.name, d.current]), [["这台 Mac · Claude Code", true], ["网页 · Safari", false]]);
  assert.equal(call("POST", `/me/devices/${devices[1].id}/revoke`, { token: t }).status, 200);
  assert.equal(call("GET", "/me", { token: web.token }).status, 401, "signed out there");
  assert.equal(call("POST", "/me/devices/revoke-others", { token: t }).body.revoked, 0);
  assert.equal(call("POST", "/me/logout", { token: t }).body.revoked, 1);
  assert.equal(call("GET", "/me", { token: t }).status, 401);
});
