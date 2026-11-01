import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { gbHome, readClient, readMirror, readSeen, writeClient, writeMirror, writeSeen } from "../dist/gemsbang/home.js";

test("the client's home (transport §3): GEMSBANG_HOME or ~/.gemsbang; a missing or broken client.json reads as nothing set; tokens are the owner's alone; the mirror and the seen marks round-trip", () => {
  assert.equal(gbHome({ GEMSBANG_HOME: "/x/gb" }), "/x/gb");
  assert.equal(gbHome({}), join(homedir(), ".gemsbang"));
  const home = mkdtempSync(join(tmpdir(), "gemsbang-home-"));
  assert.deepEqual(readClient(home), { relay: "", trusted: [], avatars: {}, bodies: {}, notes: [], muted: { avatars: [], venues: [] }, repos: {} });
  writeFileSync(join(home, "client.json"), "{ not json");
  assert.deepEqual(readClient(home).avatars, {});
  writeClient(home, { relay: "https://im.example", trusted: ["https://im.example"], token: "gwx_t", person: "p-0000000001", lang: "en", avatars: { "a-0000000001": "gwx_a", bad: 3 }, bodies: { s1: "a-0000000001" }, notes: [{ url: "u", at: "t" }, { url: 1 }] });
  const c = readClient(home);
  assert.deepEqual([c.relay, c.token, c.person, c.lang, c.avatars, c.bodies, c.notes], ["https://im.example", "gwx_t", "p-0000000001", "en", { "a-0000000001": "gwx_a" }, { s1: "a-0000000001" }, [{ url: "u", at: "t" }]]);
  if (process.platform !== "win32") assert.equal(statSync(join(home, "client.json")).mode & 0o777, 0o600);
  assert.equal(readMirror(home), undefined);
  writeMirror(home, { at: "t", relay: "r", person: "p", lang: "zh", avatars: [], venues: [] });
  assert.deepEqual(readMirror(home).venues, []);
  writeSeen(home, { "a/g": "m-1" });
  assert.deepEqual(readSeen(home), { "a/g": "m-1" });
});
