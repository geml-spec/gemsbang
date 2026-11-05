import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { answer } from "../dist/gemsbang/bridge.js";
import { startAvatarRelay } from "../dist/relay/avatar-server.js";

test("the bridge (transport §4): one client call by name at GEMSBANG_HOME, to the service GEMSBANG_SERVICE names, its result whole — a refusal is the call's, said in its words", async () => {
  process.env["GEMSBANG_HOME"] = mkdtempSync(join(tmpdir(), "gemsbang-bridge-"));
  const s = await startAvatarRelay({ root: mkdtempSync(join(tmpdir(), "gemsbang-bridge-relay-")), name: "relay.test", texter: () => undefined });
  process.env["GEMSBANG_SERVICE"] = s.url;
  try {
    const first = await answer({ v: 1, call: "status" });
    assert.deepEqual([first.ok, first.gb.ok, first.gb.view.loggedIn, first.gb.view.relay], [true, true, false, s.url], "no server to fill in");
    const refused = await answer({ v: 1, call: "login-start", args: { email: "john" } });
    assert.deepEqual([refused.ok, refused.gb.ok, refused.gb.code, refused.gb.reason], [true, false, "email.bad", "邮箱格式不正确"]);
    const sent = await answer({ v: 1, call: "login-start", args: { phone: "13800138000" } });
    assert.deepEqual([sent.gb.ok, sent.gb.info.tail], [true, "8000"]);
  } finally {
    delete process.env["GEMSBANG_HOME"];
    delete process.env["GEMSBANG_SERVICE"];
    await s.close();
  }
});
