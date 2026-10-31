import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Daemon } from "../dist/daemon/sync.js";
import { enqueueOutbox, listOutbox, readInbox, readMirror, readState, reportSession, writeConfig } from "../dist/daemon/home.js";
import { startRelay } from "../dist/relay/server.js";

const tmp = (p) => mkdtempSync(join(tmpdir(), p));
/** A relay with John, 张三, John's agent 小评, a group of all three; a home set up for John. */
async function world(o = {}) {
  const s = await startRelay({ root: tmp("gemworks-relay-"), name: "relay.test" });
  const john = s.relay.issuePerson("john");
  const zhang = s.relay.issuePerson("zhangsan");
  const xiaoping = s.relay.issueAgent(john.record, "xiaoping");
  s.relay.createVenue(john.record, { id: "g-7", kind: "group", name: "前端周会", people: ["zhangsan"], agents: ["agent:xiaoping@john"] });
  const home = tmp("gemworks-im-");
  writeConfig(home, { relay: { url: s.url, name: "relay.test" }, person: "john", token: john.token, agents: { xiaoping: xiaoping.token } });
  const daemon = new Daemon({ home, ...o });
  return { s, john, zhang, xiaoping, home, daemon };
}
const until = (fn, ms = 3000) => new Promise((done, failed) => { const t0 = Date.now(); const tick = () => (fn() ? done() : Date.now() - t0 > ms ? failed(new Error("not in time")) : setTimeout(tick, 10)); tick(); });

test("syncOnce mirrors my page, the venues I am in across owners, my agents' queues and the inbox, and records the state", async () => {
  const { s, john, zhang, home, daemon } = await world();
  try {
    s.relay.createVenue(zhang.record, { id: "t-1", kind: "thread", name: "回复：看看", people: ["john"] });
    s.relay.appendMessage(zhang.record, "john", "g-7", { id: "m-1", text: "@xiaoping 跑一下" });
    s.relay.appendMessage(zhang.record, "john", "g-7", { id: "m-2", kind: "chat", text: "顺便" });
    const r = await daemon.syncOnce();
    assert.deepEqual(r, { connected: true, docs: 4, pushed: 0, failed: 0, left: 0, heartbeats: 0 });
    const venue = readMirror(home, "relay.test", "john", "venues/g-7.geml");
    assert.deepEqual(venue.blocks.map((b) => b.id), ["venue", "m-1", "m-2"]);
    assert.equal(venue.text, s.relay.renderVisible(s.relay.read("john", "venues/g-7.geml", "person:john").blocks), "the relay's text, whole");
    assert.deepEqual(readMirror(home, "relay.test", "zhangsan", "venues/t-1.geml").blocks.map((b) => b.id), ["venue"]);
    assert.deepEqual(readMirror(home, "relay.test", "john", "queues/xiaoping.geml").blocks.map((b) => b.id), ["qi-g-7-m-1"]);
    assert.deepEqual(readMirror(home, "relay.test", "john", "people/john.geml").blocks.map((b) => b.id), ["person"]);
    assert.deepEqual(readInbox(home, "relay.test", "john"), []);
    assert.deepEqual(readState(home), { connected: true, at: readState(home).at });
    s.relay.appendMessage(john.record, "john", "g-7", { id: "m-3", text: "再来" });
    assert.equal((await daemon.syncOnce()).docs, 4);
    assert.deepEqual(readMirror(home, "relay.test", "john", "venues/g-7.geml").blocks.map((b) => b.id), ["venue", "m-1", "m-2", "m-3"], "rewritten whole");
  } finally {
    await s.close();
  }
});

test("the outbox is pushed oldest first with the right token; a refusal goes to failed/ with the reason; a missing token fails the entry", async () => {
  const { s, home, daemon } = await world();
  try {
    enqueueOutbox(home, { kind: "message", as: "person", owner: "john", doc: "venues/g-7.geml", body: { id: "m-a", text: "@xiaoping 看看" }, at: "2026-10-31T09:00:00Z" });
    enqueueOutbox(home, { kind: "marker", as: "agent:xiaoping", owner: "john", doc: "queues/xiaoping.geml", body: { kind: "read", item: "qi-g-7-m-a" }, at: "2026-10-31T09:00:01Z" });
    enqueueOutbox(home, { kind: "message", as: "person", owner: "john", doc: "venues/g-7.geml", body: { id: "sys-9", text: "forged" }, at: "2026-10-31T09:00:02Z" });
    enqueueOutbox(home, { kind: "message", as: "agent:nobody", owner: "john", doc: "venues/g-7.geml", body: { id: "m-b", text: "x" }, at: "2026-10-31T09:00:03Z" });
    const r = await daemon.syncOnce();
    assert.deepEqual([r.pushed, r.failed, r.left], [2, 2, 0]);
    assert.deepEqual(listOutbox(home), []);
    const failed = readFileSync(join(home, "outbox", "failed", require_name(home, "sys-9")), "utf8");
    assert.match(failed, /"error":"消息 id 不合法"/);
    assert.match(readFileSync(join(home, "outbox", "failed", require_name(home, "m-b")), "utf8"), /"error":"没有 agent:nobody 的令牌"/);
    const vd = s.relay.venueOf("john", "g-7");
    assert.deepEqual(vd.messages.map((m) => [m.id, m.speaker]), [["m-a", "person:john"]]);
    assert.deepEqual(s.relay.queueOf({ speaker: "person:john", scope: "person" }, "john", "xiaoping").queue.markers.map((m) => m.kind), ["read"]);
    assert.deepEqual(readMirror(home, "relay.test", "john", "queues/xiaoping.geml").blocks.map((b) => b.id), ["qi-g-7-m-a", "read-1"], "the outbox went first, so this round's mirror carries what it pushed");
  } finally {
    await s.close();
  }
});
/** The failed entry's file name: the one whose body names the block. */
function require_name(home, blockId) {
  const dir = join(home, "outbox", "failed");
  for (const n of existsSync(dir) ? readdirSync(dir) : []) if (readFileSync(join(dir, n), "utf8").includes(`"id":"${blockId}"`)) return n;
  throw new Error(`no failed entry for ${blockId}`);
}

test("the heartbeat posts every session the hosts reported; one that said asleep is retired after", async () => {
  const { s, home, daemon } = await world();
  try {
    reportSession(home, "xiaoping", "cc-1", { host: "claude-code", login: "subscription", presence: "tool", task: "#42", at: "2026-10-31T09:00:00Z" });
    reportSession(home, "xiaoping", "cc-2", { host: "claude-code", login: "api", presence: "asleep", at: "2026-10-31T09:00:00Z" });
    reportSession(home, "ghost", "cc-3", { host: "pi", login: "api", presence: "idle", at: "2026-10-31T09:00:00Z" });
    assert.equal(await daemon.heartbeat(), 2);
    const p = s.relay.presenceOf("agent:xiaoping@john");
    assert.deepEqual([p.presence, p.sessions.map((x) => [x.session, x.presence, x.task])], ["tool", [["cc-1", "tool", "#42"], ["cc-2", "asleep", undefined]]]);
    assert.equal(await daemon.heartbeat(), 1, "cc-2 retired, ghost has no token");
  } finally {
    await s.close();
  }
});

test("a relay that cannot be reached: syncOnce says so, the state says so, the outbox waits, nothing throws", async () => {
  const { s, home, daemon } = await world();
  await s.close();
  enqueueOutbox(home, { kind: "message", as: "person", owner: "john", doc: "venues/g-7.geml", body: { id: "m-a", text: "x" }, at: "2026-10-31T09:00:00Z" });
  const r = await daemon.syncOnce();
  assert.equal(r.connected, false);
  assert.match(r.error, /连不上中继/);
  assert.equal(r.left, 1);
  assert.equal(readState(home).connected, false);
  assert.equal(listOutbox(home).length, 1);
  const none = new Daemon({ home: tmp("gemworks-im-") });
  assert.match((await none.syncOnce()).error, /没有 connect.json/);
});

test("run: follows live, pushes the outbox on its interval, syncs again on its interval (a new venue appears), reconnects, stops", async () => {
  const { s, john, zhang, home, daemon } = await world({ intervals: { heartbeatMs: 50, outboxMs: 50, syncMs: 150 }, backoffMs: [50] });
  try {
    const running = daemon.run();
    await until(() => daemon.connected);
    s.relay.appendMessage(zhang.record, "john", "g-7", { id: "m-1", text: "@xiaoping 看" });
    await until(() => readMirror(home, "relay.test", "john", "venues/g-7.geml").blocks.some((b) => b.id === "m-1"));
    await until(() => readMirror(home, "relay.test", "john", "queues/xiaoping.geml").blocks.some((b) => b.id === "qi-g-7-m-1"), 3000);
    enqueueOutbox(home, { kind: "message", as: "person", owner: "john", doc: "venues/g-7.geml", body: { id: "m-2", text: "回" }, at: "2026-10-31T09:00:00Z" });
    await until(() => s.relay.venueOf("john", "g-7").messages.some((m) => m.id === "m-2"));
    await until(() => readMirror(home, "relay.test", "john", "venues/g-7.geml").blocks.some((b) => b.id === "m-2"), 3000);
    reportSession(home, "xiaoping", "cc-1", { host: "claude-code", login: "api", presence: "idle", at: "2026-10-31T09:00:00Z" });
    await until(() => s.relay.presenceOf("agent:xiaoping@john").presence === "idle");
    s.relay.createVenue(zhang.record, { id: "g-9", kind: "group", name: "新群", people: ["john"] });
    await until(() => readMirror(home, "relay.test", "zhangsan", "venues/g-9.geml").exists, 3000);
    s.relay.appendMessage(zhang.record, "zhangsan", "g-9", { id: "n-1", text: "新群里" });
    await until(() => readMirror(home, "relay.test", "zhangsan", "venues/g-9.geml").blocks.some((b) => b.id === "n-1"), 3000);
    daemon.stop();
    await running;
    assert.equal(daemon.connected, false);
  } finally {
    await s.close();
  }
});
