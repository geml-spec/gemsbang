import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUNDLE } from "./helpers/repo.mjs";
import { Relay } from "../dist/relay/relay.js";

const root = () => mkdtempSync(join(tmpdir(), "gemworks-relay-"));
const run = (args, cwd) => { const r = spawnSync(process.execPath, [BUNDLE, ...args], { cwd, encoding: "utf8", timeout: 60_000 }); return { code: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "" }; };

test("gemworks relay token <person> issues a token the relay verifies; a bad name or a missing one is an error", () => {
  const dir = root();
  const r = run(["relay", "token", "john", "--root", dir]);
  assert.equal(r.code, 0, r.err);
  const token = r.out.trim();
  assert.match(token, /^gwx_[0-9a-f]{48}$/);
  assert.equal(new Relay({ root: dir, name: "x" }).verify(token)?.speaker, "person:john");
  assert.equal(run(["relay", "token", "_relay", "--root", dir]).code, 1);
  assert.equal(run(["relay", "token", "--root", dir]).code, 2);
  assert.equal(run(["relay", "token", "john", "--port", "1", "--root", dir]).code, 2, "token takes no port");
  assert.match(run([]).err, /\|relay\|/, "the usage line names it");
});

test("gemworks relay serves until it is stopped, saying where", async () => {
  const dir = root();
  const child = spawn(process.execPath, [BUNDLE, "relay", "--root", dir, "--port", "0", "--name", "relay.test", "--federation", "open"], { stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  const line = await new Promise((done, failed) => {
    child.stdout.on("data", (c) => { out += c; const m = /^relay relay\.test listening on (http:\/\/127\.0\.0\.1:\d+) · documents under (.*)$/m.exec(out); if (m) done(m); });
    child.on("exit", (code) => failed(new Error(`exited ${code} before listening: ${out}`)));
    setTimeout(() => failed(new Error(`no listening line in time: ${out}`)), 20_000);
  });
  assert.equal(line[2], dir);
  const res = await fetch(`${line[1]}/`);
  assert.deepEqual(await res.json(), { name: "relay.test", version: JSON.parse((await import("node:fs")).readFileSync(new URL("../package.json", import.meta.url), "utf8")).version, federation: "open" });
  const exited = new Promise((done) => child.on("exit", (code, signal) => done({ code, signal })));
  child.kill("SIGTERM");
  const end = await exited;
  assert.ok(end.code === 0 || end.signal === "SIGTERM", JSON.stringify(end));
  assert.equal(run(["relay", "--federation", "sometimes", "--root", dir]).code, 2);
  assert.equal(run(["relay", "--port", "x", "--root", dir]).code, 2);
});
