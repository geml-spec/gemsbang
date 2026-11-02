// Where a login code goes (transport §7.1 /login): the operator's choice.
// By default a file under the relay's own folder, for whatever routes mail
// on that box; `gemsbang relay serve --mail-command` runs a command with the
// address and the subject in its environment and the text on stdin
// (sendmail -t, a curl to a provider). The relay never waits on it.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface Mail { to: string; subject: string; text: string }
export type Mailer = (m: Mail) => void | Promise<void>;

/** Each mail a file `<root>/_relay/mail/<stamp>-<rand>.txt`: the headers, a blank line, the text. */
export function fileMailer(root: string): Mailer {
  return (m) => {
    const dir = join(root, "_relay", "mail");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${Date.now()}-${randomBytes(3).toString("hex")}.txt`), `To: ${m.to}\nSubject: ${m.subject}\n\n${m.text}\n`);
  };
}

/** The command through the shell, MAIL_TO and MAIL_SUBJECT in its environment, the text on stdin; a non-zero exit rejects with its stderr. */
export function commandMailer(command: string): Mailer {
  return (m) => new Promise<void>((done, failed) => {
    const win = process.platform === "win32";
    const child = spawn(win ? "cmd.exe" : "sh", win ? ["/d", "/s", "/c", command] : ["-c", command], { env: { ...process.env, MAIL_TO: m.to, MAIL_SUBJECT: m.subject }, stdio: ["pipe", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (c: Buffer) => { err += c; });
    child.on("error", failed);
    child.on("exit", (code) => { if (code === 0) done(); else failed(new Error(`mail command exited ${code}: ${err.trim()}`)); });
    child.stdin.end(m.text);
  });
}
