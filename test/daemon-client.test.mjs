import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RelayClient, RelayDown, reasonOf } from "../dist/daemon/client.js";
import { startRelay } from "../dist/relay/server.js";

const root = () => mkdtempSync(join(tmpdir(), "gemworks-relay-"));

test("the client against a relay: the root, me, listings, a document as text, an append, a refusal with its reason", async () => {
  const s = await startRelay({ root: root(), name: "relay.test", version: "0.0.0" });
  try {
    const john = s.relay.issuePerson("john");
    const xiaoping = s.relay.issueAgent(john.record, "xiaoping");
    s.relay.createVenue(john.record, { id: "g-7", kind: "group", name: "前端周会", agents: ["agent:xiaoping@john"] });
    const anon = new RelayClient(s.url);
    assert.deepEqual(await anon.root(), { name: "relay.test", version: "0.0.0", federation: "closed" });
    const c = new RelayClient(s.url, john.token);
    assert.deepEqual(await c.me(), { speaker: "person:john", scope: "person", id: john.record.id });
    assert.deepEqual(await c.venues(), [{ owner: "john", id: "g-7", kind: "group", name: "前端周会" }]);
    assert.deepEqual(await c.agents(), ["xiaoping"]);
    assert.deepEqual(await c.inbox(), []);
    const appended = await c.append("john", "venues/g-7.geml", { id: "m-1", text: "@xiaoping 看" });
    assert.equal(appended.status, 201);
    assert.equal(appended.body.message.speaker, "person:john");
    const text = await c.readGeml("john", "venues/g-7.geml");
    assert.match(text, /^=== data \{#venue format=json\}\n[\s\S]*#m-1 format=json/);
    assert.equal(await c.readGeml("john", "venues/none.geml"), undefined);
    const a = new RelayClient(s.url, xiaoping.token);
    assert.equal((await a.presence({ session: "cc-1", presence: "idle" })).status, 200);
    const refused = await c.append("john", "venues/g-7.geml", { id: "sys-1", text: "x" });
    assert.equal(refused.status, 400);
    assert.equal(reasonOf(refused), "消息 id 不合法");
    assert.equal(reasonOf({ status: 502, body: "<html>" }), "HTTP 502");
    await assert.rejects(anon.me(), /HTTP 401|要令牌/);
    await assert.rejects(new RelayClient(s.url, "gwx_bad").venues(), /令牌无效/);
  } finally {
    await s.close();
  }
});

test("a relay that cannot be reached is RelayDown, from every call", async () => {
  const s = await startRelay({ root: root(), name: "relay.test" });
  const url = s.url;
  await s.close();
  const c = new RelayClient(url, "gwx_x");
  await assert.rejects(c.root(), RelayDown);
  await assert.rejects(c.append("john", "venues/g-7.geml", {}), (e) => e instanceof RelayDown && /连不上中继/.test(e.message));
  const stub = new RelayClient("http://relay", "t", async () => { throw new TypeError("fetch failed"); });
  await assert.rejects(stub.inbox(), RelayDown);
});

test("a subscription: the documents named on open, blocks as they land, the close reported", async () => {
  const s = await startRelay({ root: root(), name: "relay.test" });
  try {
    const john = s.relay.issuePerson("john");
    s.relay.createVenue(john.record, { id: "g-7", kind: "group", name: "群" });
    const c = new RelayClient(s.url, john.token);
    const got = [];
    let closed = null;
    const ws = c.subscribe(["john/venues/g-7.geml", "john/venues/none.geml"], { onBlock: (doc, block) => got.push([doc, block.id]), onClose: (why) => { closed = why; } });
    await new Promise((done) => { const tick = () => (ws.readyState === 1 ? done() : setTimeout(tick, 10)); tick(); });
    await new Promise((done) => setTimeout(done, 30));
    s.relay.appendMessage(john.record, "john", "g-7", { id: "m-1", text: "hi" });
    await new Promise((done) => { const tick = () => (got.length >= 1 ? done() : setTimeout(tick, 10)); tick(); });
    assert.deepEqual(got, [["john/venues/g-7.geml", "m-1"]]);
    ws.close();
    await new Promise((done) => { const tick = () => (closed !== null ? done() : setTimeout(tick, 10)); tick(); });
    assert.match(closed, /^closed/);
  } finally {
    await s.close();
  }
});
