// The relay's and the client's writes to disk: an append under a lock, and a
// file replaced whole. Everything under core/ is pure.
import { randomBytes } from "node:crypto";
import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Append one block, writing the head first when the file is new.
 *
 * One `appendFileSync` either way: a document is written by blind append
 * (the writer never reads the file), so the only question is whether this is
 * the first block. `existsSync` answers it without opening anything.
 */
export function appendOrCreate(path: string, head: string, block: string): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, existsSync(path) ? block : head + block, "utf8");
}

const sleepMs = (ms: number): void => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

const codeOf = (e: unknown): string | undefined => (e as NodeJS.ErrnoException | undefined)?.code;

/**
 * What Windows answers while another process (an indexer, a virus scanner, an
 * editor) has a file open for a moment: the same call succeeds a moment later.
 * Elsewhere these codes are real permission errors and are never retried.
 */
const isBusy = (e: unknown): boolean => process.platform === "win32" && ["EPERM", "EACCES", "EBUSY"].includes(codeOf(e) ?? "");

/** Call `op`, trying again while the file is busy (about half a second in all); anything else, or the last failure, throws. */
function whileBusy<T>(op: () => T): T {
  for (let attempt = 0; ; attempt++) {
    try { return op(); } catch (e) {
      if (!isBusy(e) || attempt >= 10) throw e;
      sleepMs(10 * (attempt + 1));
    }
  }
}

/** Remove a file; one that is already gone is not an error. */
function removeFile(path: string): void {
  try { whileBusy(() => unlinkSync(path)); } catch (e) { if (codeOf(e) !== "ENOENT") throw e; }
}

/** Create the lock file, which must not exist, holding `token`. A half-made lock is removed. */
function createLock(lock: string, token: string): void {
  const fd = openSync(lock, "wx");
  try { writeSync(fd, token); } catch (e) {
    closeSync(fd);
    try { removeFile(lock); } catch { /* it ages into a stale lock */ }
    throw e;
  }
  closeSync(fd);
}

/** Take a stale lock away, unless it was replaced since it was judged stale. True when the lock is gone. */
function breakStale(lock: string, judgedAt: number): boolean {
  try {
    if (statSync(lock).mtimeMs !== judgedAt) return false;
    whileBusy(() => unlinkSync(lock));
    return true;
  } catch (e) { return codeOf(e) === "ENOENT"; }
}

/** Who holds a lock, as its file says: the pid it was written with. */
function holderOf(lock: string): string {
  try { return /^\d+/.exec(readFileSync(lock, "utf8"))?.[0] ?? "unknown"; } catch { return "unknown"; }
}

/** Remove our lock, unless someone broke it as stale and holds a new one. */
function release(lock: string, token: string): void {
  try { if (readFileSync(lock, "utf8") === token) removeFile(lock); } catch { /* gone, or a lock that ages into a stale one */ }
}

/**
 * Run `fn` holding `<path>.lock` (created with "wx"), so that processes
 * taking the same lock run one at a time. Waits up to `timeoutMs` for another
 * holder and then throws, naming the holder: a write is never silently
 * dropped. A lock older than `staleMs` is a crashed holder's and is broken —
 * a lock is only ever held for the length of one append, so `staleMs` must be
 * far longer than `fn` takes. The lock is removed however
 * `fn` ends. `fn` is synchronous: the lock is gone when it returns.
 */
export function withLock<T>(path: string, fn: () => T, o: { timeoutMs?: number; staleMs?: number } = {}): T {
  const lock = `${path}.lock`;
  const timeoutMs = o.timeoutMs ?? 5000, staleMs = o.staleMs ?? 30_000;
  const token = `${process.pid} ${randomBytes(6).toString("hex")}`;
  mkdirSync(dirname(path), { recursive: true });
  const start = Date.now();
  for (;;) {
    let busy: unknown;
    try {
      createLock(lock, token);
      break;
    } catch (e) {
      if (codeOf(e) !== "EEXIST" && !isBusy(e)) throw e;
      busy = e;
    }
    if (codeOf(busy) === "EEXIST") {
      let mtime: number;
      try { mtime = statSync(lock).mtimeMs; } catch (e) {
        if (codeOf(e) === "ENOENT") continue; // released between our attempt and our look
        mtime = Date.now();                   // cannot look (Windows, a delete in progress): treat as fresh and wait
      }
      if (Date.now() - mtime > staleMs && breakStale(lock, mtime)) continue;
      if (Date.now() - start > timeoutMs) {
        const age = Math.max(0, Math.round((Date.now() - mtime) / 1000));
        throw new Error(`gemsbang: ${lock} is held by another process (pid ${holderOf(lock)}, for ${age}s); gave up after ${timeoutMs} ms. If no gemsbang process is running, delete ${lock}.`);
      }
    } else if (Date.now() - start > timeoutMs) {
      throw new Error(`gemsbang: cannot take ${lock}: ${(busy as Error).message}`, { cause: busy });
    }
    sleepMs(25);
  }
  try { return fn(); } finally { release(lock, token); }
}

/**
 * Replace a file whole: write a sibling temp file, flush it, then rename it
 * over the target, so a reader (or a crash) sees the old text or the new text,
 * never half of one. On Windows the rename waits out a reader that has the
 * target open; a write that cannot be made throws.
 */
export function writeAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  // The process id alone is not a name nobody else is writing under: a second writer in this process, or a run that
  // died and whose id came round again, would share it.
  const tmp = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    const fd = openSync(tmp, "w");
    try {
      writeFileSync(fd, text, "utf8");
      try { fsyncSync(fd); } catch (e) { if (!["EINVAL", "ENOTSUP"].includes(codeOf(e) ?? "")) throw e; }
    } finally { closeSync(fd); }
    whileBusy(() => renameSync(tmp, path));
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* never made, or already gone */ }
    throw e;
  }
}
