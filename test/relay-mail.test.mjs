import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commandMailer, fileMailer } from "../dist/relay/mail.js";

test("the mailers: the file mailer writes each mail under the relay's own folder; the command mailer runs a quoted command line with the address and the subject in its environment and the text on stdin, and a failing command rejects", async () => {
  const root = mkdtempSync(join(tmpdir(), "gemsbang-mail-"));
  fileMailer(root)({ to: "a@example.com", subject: "GemsBang 验证码", text: "123456" });
  const dir = join(root, "_relay", "mail");
  const files = readdirSync(dir);
  assert.equal(files.length, 1);
  assert.equal(readFileSync(join(dir, files[0]), "utf8"), "To: a@example.com\nSubject: GemsBang 验证码\n\n123456\n");
  const script = join(root, "mail.cjs"), out = join(root, "sent.txt");
  writeFileSync(script, 'const fs = require("node:fs"); let s = ""; process.stdin.on("data", (c) => { s += c; }).on("end", () => fs.writeFileSync(process.argv[2], process.env.MAIL_TO + "|" + process.env.MAIL_SUBJECT + "|" + s));');
  await commandMailer(`"${process.execPath}" "${script}" "${out}"`)({ to: "a@example.com", subject: "code", text: "body" });
  assert.equal(readFileSync(out, "utf8"), "a@example.com|code|body");
  await assert.rejects(commandMailer(`"${process.execPath}" -e "process.exit(3)"`)({ to: "x", subject: "s", text: "t" }), /exited 3/);
});
