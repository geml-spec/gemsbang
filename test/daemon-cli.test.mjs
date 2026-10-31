import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUNDLE } from "./helpers/repo.mjs";
import { startRelay } from "../dist/relay/server.js";
import { readMirror } from "../dist/daemon/home.js";

const tmp = (p) => mkdtempSync(join(tmpdir(), p));
/** The bundle run asynchronously: the relay serving the child lives in this process, whose loop a spawnSync would hold. */
const run = (args, env = {}) => new Promise((done) => {
  const child = spawn(process.execPath, [BUNDLE, ...args], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let out = "", err = "";
  child.stdout.on("data", (c) => { out += c; });
  child.stderr.on("data", (c) => { err += c; });
  const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
  child.on("exit", (code) => { clearTimeout(timer); done({ code: code ?? 1, out, err }); });
});

test("connect setup, agent, --once and status against a relay; --once and status say when the relay is gone", async () => {
  const s = await startRelay({ root: tmp("gemworks-relay-"), name: "relay.test" });
  const home = tmp("gemworks-im-");
  try {
    const john = s.relay.issuePerson("john");
    const xiaoping = s.relay.issueAgent(john.record, "xiaoping");
    s.relay.createVenue(john.record, { id: "g-7", kind: "group", name: "群" });
    assert.equal((await run(["connect", "status", "--home", home])).code, 1, "not set up");
    assert.equal((await run(["connect", "setup", "--relay", s.url, "--home", home])).code, 2, "the token is required");
    assert.equal((await run(["connect", "setup", "--relay", s.url, "--token", xiaoping.token, "--home", home])).code, 1, "an agent's token is not a person's");
    const setup = await run(["connect", "setup", "--relay", `${s.url}/`, "--token", john.token, "--home", home]);
    assert.equal(setup.code, 0, setup.err);
    assert.equal(setup.out.trim(), `connected person:john to relay.test (${s.url}) · home ${home}`);
    assert.deepEqual(JSON.parse(readFileSync(join(home, "connect.json"), "utf8")), { relay: { url: s.url, name: "relay.test" }, person: "john", token: john.token, agents: {} });
    assert.equal((await run(["connect", "agent", "xiaoping", "--token", xiaoping.token, "--home", home])).out.trim(), `agent xiaoping added · home ${home}`);
    assert.equal((await run(["connect", "agent", "--token", "x", "--home", home])).code, 2);
    const once = await run(["connect", "--once"], { GEMWORKS_IM_HOME: home });
    assert.equal(once.code, 0, once.err);
    assert.deepEqual(JSON.parse(once.out), { connected: true, docs: 4, pushed: 0, failed: 0, left: 0, heartbeats: 0, executed: 0 });
    assert.ok(readMirror(home, "relay.test", "john", "venues/g-7.geml").exists);
    const status = await run(["connect", "status", "--home", home]);
    assert.equal(status.code, 0);
    assert.match(status.out, /^john on relay\.test \(http:\/\/127\.0\.0\.1:\d+\) · agents xiaoping · connected at 2026-\S+ · outbox 0 · home /);
    assert.equal((await run(["connect", "nonsense", "--home", home])).code, 2);
    assert.equal((await run(["connect", "--once", "--port", "1", "--home", home])).code, 2);
    assert.match((await run([])).err, /\|relay\|connect>/);
  } finally {
    await s.close();
  }
  const gone = await run(["connect", "--once", "--home", home]);
  assert.equal(gone.code, 1);
  assert.match(JSON.parse(gone.out).error, /连不上中继/);
  const status = await run(["connect", "status", "--home", home]);
  assert.equal(status.code, 1);
  assert.match(status.out, /disconnected at .*连不上中继/);
});
