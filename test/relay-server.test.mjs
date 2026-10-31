import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startRelay } from "../dist/relay/server.js";

const root = () => mkdtempSync(join(tmpdir(), "gemworks-relay-"));
const api = (url, token) => async (method, path, body) => {
  const res = await fetch(`${url}${path}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) }, ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}) });
  const text = await res.text();
  return { status: res.status, type: res.headers.get("content-type"), text, json: res.headers.get("content-type")?.startsWith("application/json") ? JSON.parse(text) : undefined };
};

test("the server: JSON in and out, the token from the header or the query, a body that is not JSON, one over the limit, text for a document", async () => {
  const s = await startRelay({ root: root(), name: "relay.test", version: "0.0.0" });
  try {
    const anon = api(s.url);
    assert.deepEqual((await anon("GET", "/")).json, { name: "relay.test", version: "0.0.0", federation: "closed" });
    const john = s.relay.issuePerson("john").token;
    const me = api(s.url, john);
    assert.equal((await me("GET", "/me")).json.speaker, "person:john");
    assert.equal((await anon("GET", `/me?token=${john}`)).json.speaker, "person:john");
    assert.equal((await anon("GET", "/me")).status, 401);
    assert.deepEqual(await me("POST", "/venues", "{not json"), { status: 400, type: "application/json; charset=utf-8", text: '{"error":"正文不是 JSON"}', json: { error: "正文不是 JSON" } });
    assert.equal((await me("POST", "/venues", { id: "g-7", kind: "group", name: "群", people: [] })).status, 201);
    assert.equal((await me("POST", "/john/venues/g-7.geml", { id: "m-1", text: "x".repeat(1_100_000) })).status, 413);
    assert.equal((await me("POST", "/john/venues/g-7.geml", { id: "m-1", text: "hello" })).status, 201);
    const text = await fetch(`${s.url}/john/venues/g-7.geml`, { headers: { authorization: `Bearer ${john}`, accept: "text/plain" } });
    assert.equal(text.headers.get("content-type"), "text/plain; charset=utf-8");
    assert.match(await text.text(), /^=== data \{#venue format=json\}\n[\s\S]*=== data \{#m-1 format=json\}\n/);
    assert.equal((await me("DELETE", "/john/venues/g-7.geml")).status, 405);
  } finally {
    await s.close();
  }
});

test("subscriptions: a member hears every block of a venue as it lands, a private block as a stub; an outsider is refused; a bad token gets no socket", async () => {
  const s = await startRelay({ root: root(), name: "relay.test" });
  try {
    const john = s.relay.issuePerson("john");
    const zhang = s.relay.issuePerson("zhangsan");
    const lisi = s.relay.issuePerson("lisi");
    s.relay.issueAgent(john.record, "xiaoping");
    s.relay.createVenue(john.record, { id: "g-7", kind: "group", name: "群", people: ["zhangsan"], agents: ["agent:xiaoping@john"] });
    const open = (token) => new Promise((done, failed) => {
      const ws = new WebSocket(`${s.url.replace("http", "ws")}/subscribe?token=${token}`);
      const inbox = [];
      ws.addEventListener("message", (e) => inbox.push(JSON.parse(e.data)));
      ws.addEventListener("open", () => done({ ws, inbox, send: (m) => ws.send(JSON.stringify(m)), next: (n) => new Promise((ok) => { const tick = () => (inbox.length >= n ? ok(inbox) : setTimeout(tick, 10)); tick(); }) }), { once: true });
      ws.addEventListener("error", () => failed(new Error("refused")), { once: true });
    });
    const z = await open(zhang.token);
    z.send({ subscribe: "john/venues/g-7.geml" });
    z.send({ subscribe: "john/sessions/cc-1.geml" });
    z.send({ ping: 7 });
    await z.next(3);
    assert.deepEqual(z.inbox, [{ subscribed: "john/venues/g-7.geml" }, { error: "无权或没有这份文档" }, { pong: 7 }]);
    const l = await open(lisi.token);
    l.send({ subscribe: "john/venues/g-7.geml" });
    l.ws.send("not json");
    await l.next(2);
    assert.deepEqual(l.inbox.map((m) => m.error), ["无权或没有这份文档", "JSON 不合法"]);
    s.relay.appendMessage(zhang.record, "john", "g-7", { id: "m-1", text: "@xiaoping 看" });
    await z.next(4);
    assert.deepEqual([z.inbox[3].doc, z.inbox[3].block.id, z.inbox[3].block.value.speaker], ["john/venues/g-7.geml", "m-1", "person:zhangsan"]);
    assert.equal(z.inbox.length, 4, "the queue item went to nobody here: zhangsan does not follow xiaoping's queue");
    const j = await open(john.token);
    j.send({ subscribe: "john/queues/xiaoping.geml" });
    await j.next(1);
    s.relay.appendMessage(zhang.record, "john", "g-7", { id: "m-2", text: "@xiaoping 再看" });
    await j.next(2);
    assert.equal(j.inbox[1].block.id, "qi-g-7-m-2");
    await new Promise((done) => setTimeout(done, 30));
    assert.equal(l.inbox.length, 2, "an outsider heard nothing");
    await assert.rejects(open("gwx_nothing"), /refused/);
    z.ws.close();
    l.ws.close();
    j.ws.close();
  } finally {
    await s.close();
  }
});
