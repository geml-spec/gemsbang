import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUNDLE } from "./helpers/repo.mjs";
import { startRelay } from "../dist/relay/server.js";
import { writeConfig } from "../dist/daemon/home.js";

const tmp = (p) => mkdtempSync(join(tmpdir(), p));
const run = (args, env = {}) => new Promise((done) => {
  const child = spawn(process.execPath, [BUNDLE, ...args], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let out = "", err = "";
  child.stdout.on("data", (c) => { out += c; });
  child.stderr.on("data", (c) => { err += c; });
  const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
  child.on("exit", (code) => { clearTimeout(timer); done({ code: code ?? 1, out, err }); });
});

test("gemworks connect phone-code prints a code the bot binds with; gemworks phone wants a relay and a bot token; the usage names both", async () => {
  const s = await startRelay({ root: tmp("gemworks-relay-"), name: "relay.test" });
  const home = tmp("gemworks-im-");
  try {
    const john = s.relay.issuePerson("john");
    writeConfig(home, { relay: { url: s.url, name: "relay.test" }, person: "john", token: john.token, agents: {} });
    const made = await run(["connect", "phone-code", "--home", home]);
    assert.equal(made.code, 0, made.err);
    const m = /^绑定码 (\d{6}) · 十分钟内在 bot 里发 \/bind \1\n$/.exec(made.out);
    assert.ok(m !== null, made.out);
    assert.deepEqual(s.relay.phoneBind({ code: m[1] }).person, "john");
    assert.equal((await run(["connect", "phone-code", "x", "--home", home])).code, 2);
    assert.equal((await run(["phone", "--relay", s.url])).code, 2, "the bot token is required");
    assert.equal((await run(["phone", "--telegram-token", "t"])).code, 2, "the relay is required");
    assert.equal((await run(["phone", "--relay", s.url, "--telegram-token", "t", "--poll", "x"])).code, 2, "--poll is seconds");
    const usage = (await run([])).err;
    for (const w of ["connect phone-code", "phone --relay"]) assert.match(usage, new RegExp(w));
  } finally {
    await s.close();
  }
});
