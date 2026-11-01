import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUNDLE } from "./helpers/repo.mjs";

const root = () => mkdtempSync(join(tmpdir(), "gemsbang-serve-"));
const run = (args) => { const r = spawnSync(process.execPath, [BUNDLE, ...args], { encoding: "utf8", timeout: 60_000 }); return { code: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "" }; };

test("gemworks relay serve: gemsbang's relay until it is stopped, saying where; the join page at /i/<code>; bad flags are usage errors", async () => {
  const dir = root();
  const child = spawn(process.execPath, [BUNDLE, "relay", "serve", "--root", dir, "--port", "0", "--name", "relay.test", "--public-url", "https://im.example"], { stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  const line = await new Promise((done, failed) => {
    child.stdout.on("data", (c) => { out += c; const m = /^gemsbang relay relay\.test listening on (http:\/\/127\.0\.0\.1:\d+) · documents under (.*)$/m.exec(out); if (m) done(m); });
    child.on("exit", (code) => failed(new Error(`exited ${code} before listening: ${out}`)));
    setTimeout(() => failed(new Error(`no listening line in time: ${out}`)), 20_000);
  });
  try {
    assert.equal(line[2], dir);
    const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
    assert.deepEqual(await (await fetch(`${line[1]}/`)).json(), { name: "relay.test", kind: "gemsbang", version });
    const page = await fetch(`${line[1]}/i/abcdefgh`, { headers: { accept: "text/html" } });
    assert.match(await page.text(), /^<!doctype html>/);
    const missing = await fetch(`${line[1]}/i/abcdefgh.md`, { headers: { "accept-language": "en" } });
    assert.deepEqual([missing.status, (await missing.json()).reason], [404, "No such link"]);
  } finally {
    const exited = new Promise((done) => child.on("exit", (code, signal) => done({ code, signal })));
    child.kill("SIGTERM");
    const end = await exited;
    assert.ok(end.code === 0 || end.signal === "SIGTERM", JSON.stringify(end));
  }
  assert.equal(run(["relay", "serve", "--port", "x", "--root", dir]).code, 2);
  assert.equal(run(["relay", "serve", "--public-url", "https://im.example/path", "--root", dir]).code, 2);
  assert.equal(run(["relay", "serve", "extra", "--root", dir]).code, 2);
  assert.match(run([]).err, /relay serve/, "the usage says it");
});

test("gemworks relay serve --hosted-command: the relay plays every avatar with that command, says so where it listens; the free quota's flags are whole numbers", async () => {
  const dir = root();
  const child = spawn(process.execPath, [BUNDLE, "relay", "serve", "--root", dir, "--port", "0", "--name", "relay.test", "--hosted-command", "cat", "--free-days", "3", "--free-replies", "10"], { stdio: ["ignore", "pipe", "pipe"] });
  const exited = new Promise((done) => child.on("exit", (code, signal) => done({ code, signal })));
  let out = "";
  try {
    const line = await new Promise((done, failed) => {
      child.stdout.on("data", (c) => { out += c; const m = /^gemsbang relay relay\.test listening on (http:\/\/127\.0\.0\.1:\d+) · documents under .* · hosted by "cat"$/m.exec(out); if (m) done(m); });
      child.on("exit", (code) => failed(new Error(`exited ${code} before listening: ${out}`)));
      setTimeout(() => failed(new Error(`no listening line in time: ${out}`)), 20_000);
    });
    assert.equal((await fetch(`${line[1]}/me/quota`)).status, 401);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    await exited;
  }
  assert.equal(run(["relay", "serve", "--free-days", "x", "--root", dir]).code, 2);
  assert.match(run(["relay", "serve", "--free-replies", "1.5", "--root", dir]).err, /--free-replies needs a whole number/);
});
