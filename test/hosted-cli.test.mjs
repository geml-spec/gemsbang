import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

test("gemworks connect adopt (transport §6 搬家): the hosted agent's token into connect.json and its workspace's files under the home; once only; the usage errors; relay --hosted-credits must be a number", async () => {
  const mails = [];
  const root = tmp("gemworks-relay-");
  const s = await startRelay({ root, name: "relay.test", mailer: (m) => { mails.push(m); } });
  const home = tmp("gemworks-im-");
  try {
    s.relay.startLogin({ email: "zhao@x.io" });
    const zhao = s.relay.finishLogin({ email: "zhao@x.io", code: /验证码是 (\d{6})/.exec(mails[0].text)[1], name: "zhao" });
    assert.equal(zhao.ok, true, zhao.reason);
    const helper = s.relay.hostedAgents()[0];
    mkdirSync(join(root, "_hosted", "zhao", "helper", "skills"), { recursive: true });
    writeFileSync(join(root, "_hosted", "zhao", "helper", "HOME.md"), "# helper\n", "utf8");
    writeFileSync(join(root, "_hosted", "zhao", "helper", "skills", "pdf.md"), "pdf\n", "utf8");
    writeConfig(home, { relay: { url: s.url, name: "relay.test" }, person: "zhao", token: zhao.token, agents: {} });
    assert.equal((await run(["connect", "adopt", "--home", home])).code, 2);
    const adopted = await run(["connect", "adopt", "helper", "--home", home]);
    assert.deepEqual([adopted.code, adopted.out], [0, `helper 搬来了 · 令牌已记入 connect.json · 2 个文件在 ${join(home, "hosted", "helper")}\n`], adopted.err);
    assert.deepEqual(JSON.parse(readFileSync(join(home, "connect.json"), "utf8")).agents, { helper: helper.token });
    assert.deepEqual([readFileSync(join(home, "hosted", "helper", "HOME.md"), "utf8"), readFileSync(join(home, "hosted", "helper", "skills", "pdf.md"), "utf8")], ["# helper\n", "pdf\n"]);
    assert.equal(s.relay.hostedAgents().length, 0);
    const again = await run(["connect", "adopt", "helper", "--home", home]);
    assert.deepEqual([again.code, again.err.trim()], [1, "gemworks connect adopt: 没有这个托管 agent"]);
    assert.equal((await run(["relay", "--hosted-credits", "x", "--root", root])).code, 2, "a number");
    const usage = (await run([])).err;
    for (const w of ["connect adopt", "--hosted-command"]) assert.match(usage, new RegExp(w));
  } finally {
    await s.close();
  }
});
