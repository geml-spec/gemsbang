import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AvatarRelay } from "../dist/relay/avatars.js";
import { langOf, routeAvatars } from "../dist/relay/avatar-api.js";

function setup() {
  const texts = [];
  const relay = new AvatarRelay({ root: mkdtempSync(join(tmpdir(), "gemsbang-api-")), name: "relay.test", texter: (t) => { texts.push(t); } });
  const call = (method, path, o = {}) => {
    const [p, q = ""] = path.split("?");
    const res = routeAvatars({ method, path: p, query: Object.fromEntries(new URLSearchParams(q)), base: "https://im.example", version: "9.9.9", ...o }, relay);
    return { status: res.status, type: res.type, body: res.type.startsWith("application/json") ? JSON.parse(res.body) : res.body };
  };
  const login = (phone, lang) => {
    assert.equal(call("POST", "/login", { body: { phone, ...(lang ? { lang } : {}) } }).status, 200);
    const code = /(\d{6})/.exec(texts[texts.length - 1].text)[1];
    return call("POST", "/login/verify", { body: { phone, code, ...(lang ? { lang } : {}) } }).body.token;
  };
  return { relay, texts, call, login, lastCode: () => /(\d{6})/.exec(texts[texts.length - 1].text)[1] };
}

test("the relay's HTTP answers (transport §2.5, spec §7.6): a refusal is a code, its parameters and its words in the request's language — the query's, the body's, the person's, the browser's, else Chinese; no token, a bad one, a wrong method, no such path each say so", () => {
  const { call, login } = setup();
  assert.deepEqual(call("GET", "/").body, { name: "relay.test", kind: "gemsbang", version: "9.9.9" });
  assert.deepEqual(call("POST", "/login", { body: { phone: "x" }, languages: "en-GB,en;q=0.8" }).body, { error: "phone.required", reason: "Enter a phone number" });
  assert.equal(call("POST", "/login?lang=ja", { body: { phone: "x" }, languages: "en" }).body.reason, "電話番号を入力してください");
  assert.equal(call("POST", "/login", { body: { phone: "x", lang: "en" } }).body.reason, "Enter a phone number");
  assert.deepEqual(call("POST", "/groups", { body: {} }).body, { error: "token.required", reason: "要令牌" });
  assert.equal(call("POST", "/groups", { token: "gb_nothing", languages: "ja" }).body.reason, "トークンが無効です");
  const john = login("13800138000", "en");
  assert.deepEqual(call("POST", "/groups", { token: john, body: { name: "x" }, languages: "zh" }).body, { error: "as.required", reason: "Say which avatar you speak as" }, "the person's own language wins over the browser's");
  assert.equal(call("DELETE", "/me", { token: john }).body.error, "method.wrong");
  assert.equal(call("GET", "/nowhere", { token: john }).status, 404);
  assert.deepEqual(call("POST", "/groups", { token: john, body: { as: "a-0000000000", name: "x" } }).body.params, undefined);
  assert.deepEqual(call("POST", "/me/default-name", { token: john, body: { name: "长".repeat(30) } }).body, { error: "name.tooLong", params: { max: 24 }, reason: "A name has at most 24 characters" });
  assert.equal(langOf({ query: {}, languages: "fr" }), "zh");
});

test("a person over HTTP (spec §6, §7): login, an avatar, a group, its link; the link's facts for anyone, the agent's instructions in Markdown with the way in, a person joining with a name, an agent joining with the code; the group's page data with `by` left out where an avatar does not mark; the owner's requests", () => {
  const { call, login, lastCode } = setup();
  const john = login("13800138000");
  const me = call("GET", "/me", { token: john }).body;
  assert.deepEqual([me.scope, me.lang, me.avatars], ["person", "zh", []]);
  assert.equal(call("POST", "/avatars", { token: john, body: { name: "" } }).status, 400, "a first avatar needs a name");
  assert.equal(call("POST", "/devices", { token: john }).status, 201);
  assert.equal(call("POST", "/groups", { token: john, body: { as: "a-0000000000", name: "前端周会" } }).status, 403, "the avatar must be the person's");
  const g = call("POST", "/groups", { token: john, body: { avatar: { name: "John" }, name: "前端周会" } });
  assert.equal(g.status, 201);
  const relayAvatar = g.body.venue.owner;
  assert.deepEqual(call("GET", "/me", { token: john }).body.avatars, [{ id: relayAvatar, name: "John" }], "the group's maker grew with it");
  const venue = g.body.venue;
  assert.deepEqual(call("GET", "/venues", { token: john }).body.map((v) => [v.id, v.as]), [[venue.id, relayAvatar]]);
  const link = call("GET", `/venues/${venue.owner}/${venue.id}/link?as=${relayAvatar}`, { token: john }).body.link;
  assert.equal(link.path, `/i/${link.code}?by=${relayAvatar}`);
  const info = call("GET", `/i/${link.code}?call=${encodeURIComponent("小李")}`, { languages: "en" });
  assert.deepEqual([info.status, info.body.group.name, info.body.suggestions[0].text, info.body.you], [200, "前端周会", "小李", undefined]);
  const md = call("GET", `/i/${link.code}.md`, { languages: "en" });
  assert.equal(md.type, "text/markdown; charset=utf-8");
  assert.match(md.body, /^# Join the gemsbang group “前端周会”/);
  assert.equal(md.body.includes(`POST https://im.example/i/${link.code}/join`), true);
  assert.match(md.body, /owner is “John”; this link works for 7 more days/);
  assert.equal(call("GET", "/i/abcdefgh.md").status, 404);
  const li = login("13900139000");
  const joined = call("POST", `/i/${link.code}/join`, { token: li, body: { name: "李四" } });
  assert.deepEqual([joined.status, joined.body.avatar.name, joined.body.already], [201, "李四", false]);
  assert.equal(call("POST", `/i/${link.code}/join`, { token: li, body: {} }).status, 200, "already in");
  assert.equal(call("POST", `/i/${link.code}/join`, { token: "gb_nothing", body: {} }).body.error, "token.invalid");
  call("POST", "/login", { body: { phone: "13700137000" } });
  const agent = call("POST", `/i/${link.code}/join`, { body: { phone: "13700137000", code: lastCode(), name: "王五" } });
  assert.deepEqual([agent.status, agent.body.avatar.name, typeof agent.body.token, typeof agent.body.device], [201, "王五", "string", "string"]);
  const wangA = agent.body.avatar.id;
  assert.equal(call("POST", `/avatars/${wangA}/rules`, { token: agent.body.token, body: { mark: false } }).status, 403, "an avatar's token does not change its rules: only the person does");
  assert.equal(call("POST", `/venues/${venue.owner}/${venue.id}/messages`, { token: agent.body.token, body: { text: "我先看看", id: "m-1" } }).status, 201);
  assert.equal(call("POST", `/venues/${venue.owner}/${venue.id}/messages`, { token: agent.body.token, body: { text: "我先看看", id: "m-1" } }).status, 200, "a resend is a no-op");
  const page = call("GET", `/venues/${venue.owner}/${venue.id}?as=${relayAvatar}`, { token: john }).body;
  assert.deepEqual([page.venue.name, page.rules, page.blocks.find((b) => b.id === "m-1").value.by], ["前端周会", { forward: true, approve: false }, "agent"], "王五 marks by default");
  assert.deepEqual(call("GET", "/venues", { token: agent.body.token }).body.map((v) => [v.id, v.as]), [[venue.id, wangA]]);
  assert.equal(call("GET", `/venues/${venue.owner}/${venue.id}`, { token: login("13600136000") }).body.error, "doc.denied");
  assert.equal(call("POST", `/venues/${venue.owner}/${venue.id}/link-rules`, { token: john, body: { as: relayAvatar, approve: true } }).status, 200);
  const zhao = login("13500135000");
  assert.equal(call("POST", `/i/${link.code}/join`, { token: zhao, body: { name: "赵六" } }).body.pending, "request-1");
  assert.deepEqual(call("GET", `/requests/${venue.owner}`, { token: john }).body.map((q) => q.avatar.name), ["赵六"]);
  assert.equal(call("GET", `/requests/${venue.owner}`, { token: li }).status, 403);
  assert.equal(call("POST", `/requests/${venue.owner}/request-1`, { token: john, body: { as: relayAvatar, yes: true } }).body.joined, true);
  assert.equal(call("GET", `/${venue.owner}/avatar.geml`, { token: zhao }).body.blocks[0].value.name, "John");
  const rotated = call("POST", `/venues/${venue.owner}/${venue.id}/link`, { token: john, body: { as: relayAvatar } }).body.link;
  assert.notEqual(rotated.code, link.code);
  assert.deepEqual(call("GET", `/i/${link.code}`, { languages: "ja" }).body, { error: "link.gone", reason: "このリンクは無効になりました。送ってくれた人に新しいリンクをもらってください" });
});
