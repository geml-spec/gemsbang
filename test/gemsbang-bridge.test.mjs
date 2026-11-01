import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { answerRequest, handleRequest } from "../dist/bridge.js";
import { decodeRequest } from "../dist/hosts/claude-code/protocol.js";
import { startAvatarRelay } from "../dist/relay/avatar-server.js";

test("the bridge's gb op (transport §4): one client call by name at GEMSBANG_HOME, its result whole — a refusal is the call's, said in its words; a gb with no call, or args that are not an object, does not decode; the synchronous path points to handleRequest", async () => {
  process.env["GEMSBANG_HOME"] = mkdtempSync(join(tmpdir(), "gemsbang-bridge-"));
  const s = await startAvatarRelay({ root: mkdtempSync(join(tmpdir(), "gemsbang-bridge-relay-")), name: "relay.test", texter: () => undefined });
  try {
    const root = mkdtempSync(join(tmpdir(), "gemsbang-bridge-root-"));
    const req = (call, args) => decodeRequest(JSON.stringify({ v: 1, root, bare: true, op: "gb", call, ...(args !== undefined ? { args } : {}) }));
    assert.equal(req("status").op, "gb");
    assert.match(decodeRequest(JSON.stringify({ v: 1, root, op: "gb" })).error, /op gb: missing or mistyped fields/);
    assert.match(decodeRequest(JSON.stringify({ v: 1, root, op: "gb", call: "setup", args: ["x"] })).error, /op gb/);
    const first = await handleRequest(req("status"));
    assert.deepEqual([first.ok, first.gb.ok, first.gb.view.loggedIn, first.gb.view.relay], [true, true, false, ""]);
    const refused = await handleRequest(req("login-start", { phone: "13800138000" }));
    assert.deepEqual([refused.ok, refused.gb.ok, refused.gb.code, refused.gb.reason], [true, false, "client.noRelay", "先填中继地址"]);
    const set = await handleRequest(req("setup", { relay: s.url }));
    assert.equal(set.gb.view.relay, s.url);
    const sent = await handleRequest(req("login-start", { phone: "13800138000" }));
    assert.deepEqual([sent.gb.ok, sent.gb.info.tail], [true, "8000"]);
    const sync = answerRequest(req("status"));
    assert.deepEqual([sync.ok, sync.error], [false, "gemworks: gemsbang 的调用走 handleRequest"]);
  } finally {
    delete process.env["GEMSBANG_HOME"];
    await s.close();
  }
});
