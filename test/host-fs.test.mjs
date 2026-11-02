import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync, utimesSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { withLock, writeAtomic } from "../dist/host-fs.js";

const made = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), "gemsbang-host-")); made.push(d); return d; };
after(() => { for (const d of made) try { rmSync(d, { recursive: true, force: true, maxRetries: 3 }); } catch { /* a scratch directory left behind is harmless */ } });

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

test("withLock runs the function under a lock file and removes it", () => {
  const d = tmp(); const p = join(d, "j.geml");
  const v = withLock(p, () => { assert.ok(existsSync(p + ".lock")); return 7; });
  assert.equal(v, 7);
  assert.ok(!existsSync(p + ".lock"));
});

test("withLock waits out a held lock and breaks a stale one", () => {
  const d = tmp(); const p = join(d, "j.geml");
  writeFileSync(p + ".lock", "999999");
  assert.throws(() => withLock(p, () => 1, { timeoutMs: 100, staleMs: 60_000 }), /is held/);
  const old = new Date(Date.now() - 120_000);
  utimesSync(p + ".lock", old, old);
  assert.equal(withLock(p, () => 2, { timeoutMs: 100, staleMs: 60_000 }), 2);
});

test("a held lock is reported with its holder, how long it has been held and what to do", () => {
  const d = tmp(); const p = join(d, "j.geml");
  writeFileSync(p + ".lock", "4242");
  assert.throws(
    () => withLock(p, () => 1, { timeoutMs: 50, staleMs: 60_000 }),
    (e) => /is held by another process/.test(e.message) && /pid 4242/.test(e.message) && /delete/.test(e.message) && e.message.includes(p + ".lock"),
  );
  assert.equal(readFileSync(p + ".lock", "utf8"), "4242", "a lock that is not stale is left alone");
});

test("withLock releases the lock when the function throws, and the error is the function's", () => {
  const d = tmp(); const p = join(d, "j.geml");
  assert.throws(() => withLock(p, () => { throw new RangeError("boom"); }), RangeError);
  assert.ok(!existsSync(p + ".lock"));
  assert.equal(withLock(p, () => "again"), "again");
});

test("withLock does not remove a lock that someone else holds now (ours was broken as stale while we ran)", () => {
  const d = tmp(); const p = join(d, "j.geml");
  withLock(p, () => { writeFileSync(p + ".lock", "31337 someone-else"); });
  assert.equal(readFileSync(p + ".lock", "utf8"), "31337 someone-else");
});

test("withLock makes the document's directory", () => {
  const d = tmp(); const p = join(d, "_relay", "boxes", "p-1.geml");
  withLock(p, () => { assert.ok(existsSync(p + ".lock")); });
  assert.ok(!existsSync(p + ".lock"));
});

test("withLock keeps another process out until it is released (one lock, two processes)", async () => {
  const d = tmp(); const p = join(d, "j.geml"); const mark = join(d, "mark");
  const hostFs = new URL("../dist/host-fs.js", import.meta.url).href;
  const script = join(d, "holder.mjs");
  writeFileSync(script, `
    import { withLock } from ${JSON.stringify(hostFs)};
    import { writeFileSync } from "node:fs";
    withLock(${JSON.stringify(p)}, () => {
      writeFileSync(${JSON.stringify(mark)}, "in");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400);
      writeFileSync(${JSON.stringify(mark)}, "done");
    });
  `);
  const child = spawn(process.execPath, [script], { stdio: "ignore" });
  const exited = new Promise((resolve) => child.on("exit", resolve));
  for (let i = 0; i < 400 && !existsSync(p + ".lock"); i++) sleep(25);
  assert.ok(existsSync(p + ".lock"), "the other process took the lock");
  const seen = withLock(p, () => readFileSync(mark, "utf8"), { timeoutMs: 10_000 });
  assert.equal(seen, "done", "we got the lock only after the holder finished");
  assert.equal(await exited, 0);
});

test("writeAtomic creates parents and replaces the file whole", () => {
  const d = tmp(); const p = join(d, "a", "b", "c.geml");
  writeAtomic(p, "one"); writeAtomic(p, "two");
  assert.equal(readFileSync(p, "utf8"), "two");
});

test("writeAtomic leaves the text exactly as given (CRLF and non-ASCII) and no temp file behind", () => {
  const d = tmp(); const p = join(d, "j.geml");
  const text = "=== meta\r\nname = \"登录\"\r\n===\r\n";
  writeAtomic(p, text);
  assert.equal(readFileSync(p, "utf8"), text);
  assert.deepEqual(readdirSync(d), ["j.geml"]);
});

test("writeAtomic's temp file has a name nobody else is writing: not the process id alone", () => {
  const d = tmp(); const p = join(d, "j.geml");
  // What another writer (a second relay in this process, a crashed run whose pid came round again) may have under the old, predictable name.
  const theirs = `${p}.${process.pid}.tmp`;
  writeFileSync(theirs, "someone else's half-written file");
  writeAtomic(p, "mine");
  assert.equal(readFileSync(p, "utf8"), "mine");
  assert.equal(readFileSync(theirs, "utf8"), "someone else's half-written file", "left alone, neither used nor removed");
  rmSync(theirs);
  mkdirSync(theirs);
  writeAtomic(p, "again");
  assert.equal(readFileSync(p, "utf8"), "again", "a directory with that name does not block the write either");
});

test("writeAtomic that cannot replace its target throws and leaves no temp file", () => {
  const d = tmp(); const p = join(d, "target");
  mkdirSync(p);
  assert.throws(() => writeAtomic(p, "x"));
  assert.deepEqual(readdirSync(d), ["target"]);
});
