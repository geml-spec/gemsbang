// Where a login code goes (spec §6.2): the operator's choice, as for mail.
// By default a file under the relay's own folder; `gemsbang relay serve
// --text-command` runs a command with the number in its environment and the
// text on stdin (a curl to a provider). The relay never waits on it.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface Text { to: string; text: string }
export type Texter = (t: Text) => void | Promise<void>;

/** Each text a file `<root>/_relay/texts/<stamp>-<rand>.txt`: the number, a blank line, the text. */
export function fileTexter(root: string): Texter {
  return (t) => {
    const dir = join(root, "_relay", "texts");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${Date.now()}-${randomBytes(3).toString("hex")}.txt`), `To: ${t.to}\n\n${t.text}\n`);
  };
}

/** The command through the shell, TEXT_TO in its environment, the text on stdin; a non-zero exit rejects with its stderr. */
export function commandTexter(command: string): Texter {
  return (t) => new Promise<void>((done, failed) => {
    const win = process.platform === "win32";
    const child = spawn(win ? "cmd.exe" : "sh", win ? ["/d", "/s", "/c", command] : ["-c", command], { env: { ...process.env, TEXT_TO: t.to }, stdio: ["pipe", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (c: Buffer) => { err += c; });
    child.on("error", failed);
    child.on("exit", (code) => { if (code === 0) done(); else failed(new Error(`text command exited ${code}: ${err.trim()}`)); });
    child.stdin.end(t.text);
  });
}
