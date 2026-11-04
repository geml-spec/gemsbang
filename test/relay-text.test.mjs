import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commandTexter, fileTexter } from "../dist/relay/text.js";
import { issueToken, verifyToken } from "../dist/relay/tokens.js";

test("the texters: the file texter writes each text under the relay's own folder; the command texter runs the command with the number in its environment and the text on stdin, and a failing command rejects", async () => {
  const root = mkdtempSync(join(tmpdir(), "gemsbang-text-"));
  fileTexter(root)({ to: "+8613800138000", text: "GemsBang 验证码 123456" });
  const dir = join(root, "_relay", "texts");
  const files = readdirSync(dir);
  assert.equal(files.length, 1);
  assert.equal(readFileSync(join(dir, files[0]), "utf8"), "To: +8613800138000\n\nGemsBang 验证码 123456\n");
  const script = join(root, "text.cjs"), out = join(root, "sent.txt");
  writeFileSync(script, 'const fs = require("node:fs"); let s = ""; process.stdin.on("data", (c) => { s += c; }).on("end", () => fs.writeFileSync(process.argv[2], process.env.TEXT_TO + "|" + s));');
  await commandTexter(`"${process.execPath}" "${script}" "${out}"`)({ to: "+8613800138000", text: "body" });
  assert.equal(readFileSync(out, "utf8"), "+8613800138000|body");
  await assert.rejects(commandTexter(`"${process.execPath}" -e "process.exit(3)"`)({ to: "x", text: "t" }), /exited 3/);
});

test("token scopes: an avatar's and a device's tokens are kept and verified like the others", () => {
  const root = mkdtempSync(join(tmpdir(), "gemsbang-tokens-"));
  const avatar = issueToken(root, { speaker: "avatar:a-0123456789", scope: "avatar", by: "person:p-0123456789", at: "2026-11-01T09:00:00Z" });
  const device = issueToken(root, { speaker: "person:p-0123456789", scope: "device", by: "person:p-0123456789", at: "2026-11-01T09:00:00Z" });
  assert.deepEqual([verifyToken(root, avatar.token).speaker, verifyToken(root, avatar.token).scope], ["avatar:a-0123456789", "avatar"]);
  assert.deepEqual([verifyToken(root, device.token).speaker, verifyToken(root, device.token).scope], ["person:p-0123456789", "device"]);
});
