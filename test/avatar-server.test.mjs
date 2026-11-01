import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startAvatarRelay } from "../dist/relay/avatar-server.js";

async function serve() {
  const texts = [];
  const s = await startAvatarRelay({ root: mkdtempSync(join(tmpdir(), "gemsbang-server-")), name: "relay.test", texter: (t) => { texts.push(t); }, version: "9.9.9" });
  const call = async (method, path, o = {}) => {
    const headers = { accept: o.accept ?? "application/json", ...(o.languages ? { "accept-language": o.languages } : {}), ...(o.token ? { authorization: `Bearer ${o.token}` } : {}), ...(o.body !== undefined ? { "content-type": "application/json" } : {}) };
    const res = await fetch(`${s.url}${path}`, { method, headers, body: o.raw ?? (o.body !== undefined ? JSON.stringify(o.body) : undefined) });
    const type = res.headers.get("content-type") ?? "";
    return { status: res.status, type, body: type.startsWith("application/json") ? await res.json() : await res.text() };
  };
  const code = () => /(\d{6})/.exec(texts[texts.length - 1].text)[1];
  const login = async (phone, lang = "zh") => {
    assert.equal((await call("POST", `/login?lang=${lang}`, { body: { phone } })).status, 200);
    return (await call("POST", `/login/verify?lang=${lang}`, { body: { phone, code: code() } })).body.token;
  };
  return { s, call, code, login };
}

function socket(url, token) {
  return new Promise((done, failed) => {
    const ws = new WebSocket(`${url.replace("http", "ws")}/subscribe?token=${token}`);
    const inbox = [];
    ws.addEventListener("message", (e) => inbox.push(JSON.parse(e.data)));
    ws.addEventListener("open", () => done({ ws, inbox, send: (m) => ws.send(JSON.stringify(m)), next: (n) => new Promise((ok) => { const tick = () => (inbox.length >= n ? ok(inbox) : setTimeout(tick, 10)); tick(); }) }), { once: true });
    ws.addEventListener("error", () => failed(new Error("refused")), { once: true });
  });
}

test("a person joins from a WeChat link (spec §6.2): the browser gets the join page in its language; the page's calls log the person in, offer the names, let them in with the name they chose; the group's page is theirs, they talk on it, and the next forward carries who passed it on", async () => {
  const { s, call, login } = await serve();
  try {
    const john = await login("13800138000");
    const g = (await call("POST", "/groups", { token: john, body: { avatar: { name: "John" }, name: "三年二班家长" } })).body.venue;
    const link = (await call("GET", `/venues/${g.owner}/${g.id}/link?as=${g.owner}`, { token: john })).body.link;
    const page = await call("GET", link.path, { accept: "text/html,application/xhtml+xml", languages: "en-US,en;q=0.9" });
    assert.deepEqual([page.status, page.type], [200, "text/html; charset=utf-8"]);
    assert.match(page.body, /<html lang="en">/);
    assert.match(page.body, /"page.join.go":"Join"/);
    assert.equal(page.body.includes("三年二班家长"), false, "the page carries no data of the relay's: its script asks for it");
    assert.match((await call("GET", "/g/" + g.id, { accept: "text/html", languages: "ja" })).body, /<html lang="ja">/);
    assert.match((await call("GET", "/login?lang=zh", { accept: "text/html", languages: "en" })).body, /<title>登录 gemsbang<\/title>/);
    const anyone = (await call("GET", `/i/${link.code}?by=${g.owner}`, { languages: "en" })).body;
    assert.deepEqual([anyone.group.name, anyone.group.count, anyone.suggestions.map((x) => x.text)], ["三年二班家长", 1, ["__'s mom", "__'s dad"]]);
    const mei = await login("13900139000", "en");
    const theirs = (await call("GET", `/i/${link.code}`, { token: mei })).body;
    assert.deepEqual([theirs.you.avatars, theirs.you.pick], [[], { kind: "choose" }]);
    const joined = await call("POST", `/i/${link.code}/join`, { token: mei, body: { name: "Lily's mom", by: g.owner } });
    assert.deepEqual([joined.status, joined.body.avatar.name, joined.body.venue.id], [201, "Lily's mom", g.id]);
    const mine = (await call("GET", "/venues", { token: mei })).body;
    assert.deepEqual(mine.map((v) => [v.id, v.owner, v.as]), [[g.id, g.owner, joined.body.avatar.id]], "the group's page finds the group in the person's list");
    assert.equal((await call("POST", `/venues/${g.owner}/${g.id}/messages`, { token: mei, body: { as: joined.body.avatar.id, text: "Hello, I'm Lily's mom", id: "w-1" } })).status, 201);
    const seen = (await call("GET", `/venues/${g.owner}/${g.id}?as=${g.owner}`, { token: john })).body;
    const said = seen.blocks.find((b) => b.id === "w-1").value;
    assert.deepEqual([said.text, said.by, said.speaker], ["Hello, I'm Lily's mom", "person", `avatar:${joined.body.avatar.id}`]);
    const forward = (await call("GET", `/venues/${g.owner}/${g.id}/link?as=${joined.body.avatar.id}`, { token: mei })).body.link;
    assert.equal(forward.path, `/i/${link.code}?by=${joined.body.avatar.id}`);
    assert.deepEqual((await call("POST", "/login", { raw: "{nope", languages: "en" })).body, { error: "body.notJson", reason: "The body is not JSON" });
    assert.equal((await call("POST", "/login", { raw: "x".repeat(1_048_577), languages: "ja" })).body.reason, "本文が 1 MB を超えています");
  } finally {
    await s.close();
  }
});

test("a scripted agent joins from the .md (spec §6.3): it reads the instructions, its person's code (typed in the plugin's own box) gets it the avatar's token and a device token, it speaks as the avatar, marked; members hear it on their sockets as it lands, an outsider cannot follow the group", async () => {
  const { s, call, code, login } = await serve();
  try {
    const john = await login("13800138000");
    const g = (await call("POST", "/groups", { token: john, body: { avatar: { name: "John" }, name: "前端周会" } })).body.venue;
    const link = (await call("GET", `/venues/${g.owner}/${g.id}/link?as=${g.owner}`, { token: john })).body.link;
    const md = await call("GET", `/i/${link.code}.md`, { accept: "text/markdown, */*" });
    assert.equal(md.type, "text/markdown; charset=utf-8");
    const host = new URL(s.url).host;
    const join = new RegExp(`POST http://${host.replace(/[.]/g, "\\.")}/i/${link.code}/join`);
    assert.match(md.body, join, "the way in, at the address the agent read it from");
    const sub = await socket(s.url, john);
    sub.send({ subscribe: `${g.owner}/venues/${g.id}.geml` });
    await sub.next(1);
    assert.deepEqual(sub.inbox[0], { subscribed: `${g.owner}/venues/${g.id}.geml` });
    assert.equal((await call("POST", "/login", { body: { phone: "13900139000" } })).status, 200);
    const agent = await call("POST", `/i/${link.code}/join`, { body: { phone: "13900139000", code: code(), name: "李四" } });
    assert.equal(agent.status, 201);
    await sub.next(2);
    assert.equal(sub.inbox[1].block.id.startsWith("member-"), true, "the join landed on John's socket");
    assert.equal((await call("POST", `/venues/${g.owner}/${g.id}/messages`, { token: agent.body.token, body: { text: "我先看看" } })).status, 201);
    await sub.next(3);
    assert.deepEqual([sub.inbox[2].block.value.text, sub.inbox[2].block.value.by], ["我先看看", "agent"]);
    const outsider = await socket(s.url, await login("13700137000"));
    outsider.send({ subscribe: `${g.owner}/venues/${g.id}.geml` });
    outsider.send({ subscribe: `${g.owner}/avatar.geml` });
    await outsider.next(2);
    assert.deepEqual(outsider.inbox, [{ error: "doc.denied", subscribe: `${g.owner}/venues/${g.id}.geml` }, { subscribed: `${g.owner}/avatar.geml` }]);
    const own = await socket(s.url, agent.body.token);
    own.send({ subscribe: `${agent.body.avatar.id}/joined.geml` });
    own.send({ subscribe: `${agent.body.avatar.id}/requests.geml` });
    await own.next(2);
    assert.deepEqual(own.inbox.map((m) => m.subscribed), [`${agent.body.avatar.id}/joined.geml`, `${agent.body.avatar.id}/requests.geml`], "its own documents, made yet or not");
    await assert.rejects(socket(s.url, "gwx_nothing"), /refused/);
    for (const x of [sub, outsider, own]) x.ws.close();
  } finally {
    await s.close();
  }
});
