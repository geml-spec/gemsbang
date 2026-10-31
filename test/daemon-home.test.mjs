import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { appendMirror, enqueueOutbox, failOutbox, homeDir, listDrafts, listOutbox, listSessions, mirrorPath, newBlockId, readConfig, readDraft, readInbox, readMirror, readState, removeDraft, removeOutbox, removeSession, reportSession, updateOutbox, writeConfig, writeDraft, writeInbox, writeMirror, writeState } from "../dist/daemon/home.js";
import { readDataBlocks, renderDataBlock } from "../dist/core/im/chain.js";

const home = () => mkdtempSync(join(tmpdir(), "gemworks-im-"));
const CONFIG = { relay: { url: "http://127.0.0.1:7700", name: "relay.test" }, person: "john", token: "gwx_p", agents: { xiaoping: "gwx_a" } };

test("the home directory: the override, the environment, the default", () => {
  assert.equal(homeDir("/x/y"), "/x/y");
  assert.equal(homeDir(undefined, { GEMWORKS_IM_HOME: "/from/env" }), "/from/env");
  assert.equal(homeDir(undefined, {}), join(homedir(), ".gemworks", "im"));
  assert.equal(homeDir(undefined, { GEMWORKS_IM_HOME: "" }), join(homedir(), ".gemworks", "im"), "an empty variable is no override");
});

test("the config is written and read back; a missing or malformed one is nothing", () => {
  const h = home();
  assert.equal(readConfig(h), undefined);
  writeConfig(h, CONFIG);
  assert.deepEqual(readConfig(h), CONFIG);
  assert.match(readFileSync(join(h, "connect.json"), "utf8"), /^\{\n  "relay"/, "pretty, for a person to read");
  writeFileSync(join(h, "connect.json"), "{not json");
  assert.equal(readConfig(h), undefined);
  writeFileSync(join(h, "connect.json"), JSON.stringify({ relay: { url: "x" } }));
  assert.equal(readConfig(h), undefined, "the person and the token are required");
  writeFileSync(join(h, "connect.json"), JSON.stringify({ relay: { url: "x", name: "n" }, person: "john", token: "t" }));
  assert.deepEqual(readConfig(h), { relay: { url: "x", name: "n" }, person: "john", token: "t", agents: {} }, "agents default to none");
});

test("mirrors: written whole, appended by block once, read as blocks; the path follows the address", () => {
  const h = home();
  assert.equal(mirrorPath(h, "relay.test:8443", "john", "venues/g-7.geml"), join(h, "relay.test_8443", "john", "venues", "g-7.geml"));
  assert.deepEqual(readMirror(h, "relay.test", "john", "venues/g-7.geml"), { blocks: [], text: "", exists: false });
  assert.equal(appendMirror(h, "relay.test", "john", "venues/g-7.geml", { id: "m-1", value: { id: "m-1", text: "hi" } }), "missing", "a document never mirrored must be fetched whole");
  writeMirror(h, "relay.test", "john", "venues/g-7.geml", renderDataBlock("venue", { id: "venue", kind: "group" }));
  assert.equal(appendMirror(h, "relay.test", "john", "venues/g-7.geml", { id: "m-1", value: { id: "m-1", text: "hi" } }), "appended");
  assert.equal(appendMirror(h, "relay.test", "john", "venues/g-7.geml", { id: "m-1", value: { id: "m-1", text: "again" } }), "present");
  assert.equal(appendMirror(h, "relay.test", "john", "venues/g-7.geml", { id: "turn-3", stub: { from: "john", note: "你看不到", action: "申请看" } }), "appended", "a stub is a stub block");
  const m = readMirror(h, "relay.test", "john", "venues/g-7.geml");
  assert.deepEqual(m.blocks.map((b) => [b.id, b.value.text ?? b.value.stub]), [["venue", undefined], ["m-1", "hi"], ["turn-3", true]]);
  assert.deepEqual(readDataBlocks(m.text).diagnostics, []);
  writeMirror(h, "relay.test", "john", "venues/g-7.geml", "");
  assert.deepEqual(readMirror(h, "relay.test", "john", "venues/g-7.geml"), { blocks: [], text: "", exists: true });
  assert.deepEqual(readInbox(h, "relay.test", "john"), []);
  writeInbox(h, "relay.test", "john", [{ kind: "decide", key: "k", text: "t", actions: ["a"], since: "s", level: 0 }]);
  assert.equal(readInbox(h, "relay.test", "john")[0].text, "t");
});

test("the outbox: entries in time order, tried, removed, or failed with the reason", () => {
  const h = home();
  assert.deepEqual(listOutbox(h), []);
  const a = enqueueOutbox(h, { kind: "message", as: "person", owner: "john", doc: "venues/g-7.geml", body: { id: "m-x", text: "hi" }, at: "2026-10-31T09:00:00Z" });
  const b = enqueueOutbox(h, { kind: "marker", as: "agent:xiaoping", owner: "john", doc: "queues/xiaoping.geml", body: { kind: "read", item: "qi-1" }, at: "2026-10-31T09:00:01Z" });
  assert.match(a.id, /^o-\d{13}-\d{6}-[0-9a-f]{8}$/);
  assert.ok(a.id < b.id);
  assert.deepEqual(listOutbox(h).map((e) => [e.id, e.kind, e.tries]), [[a.id, "message", 0], [b.id, "marker", 0]]);
  updateOutbox(h, { ...a, tries: 1 });
  assert.equal(listOutbox(h)[0].tries, 1);
  removeOutbox(h, a.id);
  failOutbox(h, b.id, "令牌无效");
  assert.deepEqual(listOutbox(h), []);
  assert.equal(JSON.parse(readFileSync(join(h, "outbox", "failed", `${b.id}.json`), "utf8")).error, "令牌无效");
  removeOutbox(h, "o-nothing");
  assert.match(newBlockId("2026-10-31T09:00:00Z"), /^m-1793\d{9}-[0-9a-f]{8}$/, "a message's id from its time and a random part");
});

test("drafts, session reports and the state", () => {
  const h = home();
  writeDraft(h, { id: "d-1", agent: "xiaoping", item: "qi-1", owner: "john", doc: "venues/g-7.geml", body: { id: "m-r", text: "回答" }, at: "2026-10-31T09:00:00Z", venueName: "前端周会", reply: "https://relay.test/john/venues/g-7.geml#m-r" });
  assert.deepEqual(listDrafts(h).map((d) => d.id), ["d-1"]);
  assert.equal(readDraft(h, "d-1").body.text, "回答");
  assert.equal(readDraft(h, "d-9"), undefined);
  removeDraft(h, "d-1");
  assert.deepEqual(listDrafts(h), []);
  reportSession(h, "xiaoping", "cc-1", { host: "claude-code", login: "subscription", presence: "idle", at: "2026-10-31T09:00:00Z" });
  reportSession(h, "xiaoping", "cc-2", { host: "claude-code", login: "api", presence: "tool", task: "#42", at: "2026-10-31T09:00:01Z" });
  assert.deepEqual(listSessions(h).map((s) => [s.agent, s.session, s.report.presence]), [["xiaoping", "cc-1", "idle"], ["xiaoping", "cc-2", "tool"]]);
  removeSession(h, "xiaoping", "cc-1");
  assert.equal(listSessions(h).length, 1);
  assert.equal(readState(h), undefined);
  writeState(h, { connected: false, at: "2026-10-31T09:00:00Z", error: "连不上" });
  assert.deepEqual(readState(h), { connected: false, at: "2026-10-31T09:00:00Z", error: "连不上" });
  assert.ok(existsSync(join(h, "state.json")));
});
