import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUNDLE, gitRepo, hook } from "./helpers/repo.mjs";
import { decodeRequest } from "../dist/hosts/claude-code/protocol.js";
import { startRelay } from "../dist/relay/server.js";
import { writeConfig } from "../dist/daemon/home.js";

// The bridge as the gemsbang plugin asks it (plan O): bare requests that open
// no workspace, 重连 as one round of the daemon's sync, and a phone's code.
const tmp = (p) => mkdtempSync(join(tmpdir(), p));
const askProcess = (root, req, env) => new Promise((done, failed) => {
  const child = spawn(process.execPath, [BUNDLE, "hook"], { cwd: root, env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
  let out = "", err = "";
  child.stdout.on("data", (c) => { out += c; });
  child.stderr.on("data", (c) => { err += c; });
  const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
  child.on("exit", (code) => { clearTimeout(timer); const lines = out.trim().split("\n"); if (code !== 0 || lines.length !== 1) failed(new Error(`hook exit ${code}: ${out}${err}`)); else done(JSON.parse(lines[0])); });
  child.stdin.end(JSON.stringify({ v: 1, root, ...req }));
});
async function world() {
  const s = await startRelay({ root: tmp("gemsbang-relay-"), name: "relay.test" });
  const john = s.relay.issuePerson("john");
  const zhang = s.relay.issuePerson("zhangsan");
  const xiaoping = s.relay.issueAgent(john.record, "xiaoping");
  s.relay.createVenue(john.record, { id: "g-7", kind: "group", name: "前端周会", people: ["zhangsan"], agents: ["agent:xiaoping@john"] });
  const home = tmp("gemsbang-im-");
  writeConfig(home, { relay: { url: s.url, name: "relay.test" }, person: "john", token: john.token, agents: { xiaoping: xiaoping.token } });
  const root = gitRepo();
  const env = { GEMWORKS_IM_HOME: home, GEMWORKS_GH: "gh-definitely-not-installed" };
  return { s, john, zhang, home, root, env, ask: (req) => hook(root, req, env), askP: (req) => askProcess(root, req, env) };
}

test("a bare request opens no workspace: its shell holds no status, no policy and no problem, only the CLI's locale and versions; bare is a boolean", () => {
  const root = gitRepo();
  const env = { GEMWORKS_IM_HOME: tmp("gemsbang-im-"), GEMWORKS_GH: "gh-definitely-not-installed" };
  const bare = hook(root, { op: "im-status", bare: true }, env);
  assert.equal(bare.ok, true);
  assert.deepEqual([bare.shell.status, bare.shell.policy, bare.shell.contextKey, bare.shell.problem, bare.shell.suggest], [null, null, null, undefined, undefined]);
  assert.match(bare.shell.versions.gemworks, /^\d+\.\d+\.\d+/);
  const full = hook(root, { op: "im-status" }, env);
  assert.equal(full.shell.problem?.quiet, true, "the same request opened as before says the project has no workflow");
  assert.deepEqual(decodeRequest(JSON.stringify({ v: 1, root, op: "im-status", bare: "yes" })), { error: "bare is a boolean" });
  assert.equal(decodeRequest(JSON.stringify({ v: 1, root, op: "im-status", bare: true })).bare, true);
});

test("im-sync (重连): one round of the daemon's sync — the mirrors and the outbox — answers the IM after it; a relay out of reach is the error and leaves 断了 for the band; no home, no sync", async () => {
  const { s, zhang, ask, askP, root } = await world();
  let open = true;
  try {
    s.relay.appendMessage(zhang.record, "john", "g-7", { id: "m-1", text: "@xiaoping 在吗" });
    assert.deepEqual(ask({ op: "im-status", bare: true }).im.venues, [], "nothing mirrored yet");
    const first = await askP({ op: "im-sync", bare: true });
    assert.equal(first.ok, true, first.error);
    assert.match(first.text, /^同步过：\d+ 份文档$/);
    assert.deepEqual([first.im.connected, first.im.venues.map((v) => [v.id, v.unread])], [true, [["g-7", 1]]]);
    assert.equal(ask({ op: "im-say", owner: "john", venue: "g-7", text: "在", bare: true }).ok, true);
    assert.equal(ask({ op: "im-status", bare: true }).im.outbox, 1, "待发 1");
    const pushed = await askP({ op: "im-sync", bare: true });
    assert.match(pushed.text, /，推出 1 条$/);
    assert.equal(pushed.im.outbox, undefined, "nothing waits");
    await s.close();
    open = false;
    const down = await askP({ op: "im-sync", bare: true });
    assert.deepEqual([down.ok, /^gemworks: 连不上中继：/.test(down.error)], [false, true]);
    const after = ask({ op: "im-status", bare: true }).im;
    assert.deepEqual([after.connected, after.needs[0]?.kind], [false, "offline"]);
    assert.match(ask({ op: "im-sync" }).error, /handleRequest/, "the synchronous path says where the op goes");
    const none = await askProcess(root, { op: "im-sync", bare: true }, { GEMWORKS_IM_HOME: tmp("gemsbang-im-"), GEMWORKS_GH: "gh-definitely-not-installed" });
    assert.deepEqual([none.ok, none.error], [false, "gemworks: 没有 connect.json：先 gemworks connect setup"]);
  } finally {
    if (open) await s.close();
  }
});

test("im-phone-code: a code from the relay the bot's /bind takes once; no home says so", async () => {
  const { s, askP, ask, root } = await world();
  try {
    const r = await askP({ op: "im-phone-code", bare: true });
    assert.equal(r.ok, true, r.error);
    assert.match(r.phoneCode, /^\d{6}$/);
    assert.equal(s.relay.phoneBind({ code: r.phoneCode }).person, "john");
    assert.match(ask({ op: "im-phone-code" }).error, /handleRequest/);
    const none = await askProcess(root, { op: "im-phone-code", bare: true }, { GEMWORKS_IM_HOME: tmp("gemsbang-im-"), GEMWORKS_GH: "gh-definitely-not-installed" });
    assert.deepEqual([none.ok, none.error], [false, "gemworks: 没有 connect.json：先 gemworks connect setup"]);
  } finally {
    await s.close();
  }
});
