import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUNDLE } from "./helpers/repo.mjs";

const root = () => mkdtempSync(join(tmpdir(), "gemworks-relay-"));
const run = (args) => { const r = spawnSync(process.execPath, [BUNDLE, ...args], { encoding: "utf8", timeout: 60_000 }); return { code: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "" }; };
/** The relay served by the bundle until the test is done: its URL, and a stop. */
function serve(args) {
  const child = spawn(process.execPath, [BUNDLE, "relay", "--port", "0", "--name", "relay.test", ...args], { stdio: ["ignore", "pipe", "pipe"] });
  let out = "", err = "";
  child.stderr.on("data", (c) => { err += c; });
  const exited = new Promise((done) => child.on("exit", (code) => done(code)));
  const url = new Promise((done, failed) => {
    child.stdout.on("data", (c) => { out += c; const m = /listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(out); if (m) done(m[1]); });
    void exited.then((code) => failed(new Error(`exited ${code} before listening: ${out}${err}`)));
    setTimeout(() => failed(new Error(`no listening line in time: ${out}${err}`)), 20_000).unref();
  });
  // A stop after the process already left (a refused flag) must not wait for an exit that came and went.
  return { url, stop: () => { child.kill("SIGTERM"); return exited; } };
}
const post = (url, path, body) => fetch(`${url}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json().then((json) => ({ status: r.status, json })));
const until = (fn, ms = 10_000) => new Promise((done, failed) => { const t0 = Date.now(); const tick = () => { const v = fn(); if (v) done(v); else if (Date.now() - t0 > ms) failed(new Error("timed out")); else setTimeout(tick, 50); }; tick(); });

test("gemworks relay: a login code lands in a file under the root by default, and with --mail-command in whatever the command does; the code registers a person whose token the relay takes", async () => {
  const dir = root();
  const s = serve(["--root", dir]);
  try {
    const url = await s.url;
    assert.deepEqual(await post(url, "/login", { email: "zhang@example.com" }), { status: 200, json: { sent: true, known: false } });
    const mailDir = join(dir, "_relay", "mail");
    const file = await until(() => (existsSync(mailDir) && readdirSync(mailDir)[0]) || null);
    const code = /验证码是 (\d{6})/.exec(readFileSync(join(mailDir, file), "utf8"))[1];
    const done = await post(url, "/login/verify", { email: "zhang@example.com", code, name: "zhangsan" });
    assert.deepEqual([done.status, done.json.person, done.json.new, done.json.agent], [200, "zhangsan", true, "helper"]);
    const me = await fetch(`${url}/me`, { headers: { authorization: `Bearer ${done.json.token}` } });
    assert.equal((await me.json()).speaker, "person:zhangsan");
    const html = await fetch(`${url}/login`, { headers: { accept: "text/html" } });
    assert.match(await html.text(), /登录即注册/);
  } finally {
    await s.stop();
  }
  const dir2 = root(), script = join(dir2, "mail.cjs"), sent = join(dir2, "sent.txt");
  writeFileSync(script, 'const fs = require("node:fs"); let s = ""; process.stdin.on("data", (c) => { s += c; }).on("end", () => fs.writeFileSync(process.argv[2], process.env.MAIL_TO + "\\n" + s));');
  const s2 = serve(["--root", dir2, "--mail-command", `"${process.execPath}" "${script}" "${sent}"`]);
  try {
    const url = await s2.url;
    assert.equal((await post(url, "/login", { email: "li@example.com" })).status, 200);
    const text = await until(() => (existsSync(sent) ? readFileSync(sent, "utf8") : null));
    assert.match(text, /^li@example\.com\n你的验证码是 \d{6}，10 分钟内有效/);
    assert.ok(!existsSync(join(dir2, "_relay", "mail")), "the command took it; no file");
  } finally {
    await s2.stop();
  }
  assert.match(run([]).err, /--mail-command/);
});
