import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashToken, issueToken, revokeToken, verifyToken } from "../dist/relay/tokens.js";
import { readDoc } from "../dist/relay/store.js";

const root = () => mkdtempSync(join(tmpdir(), "gemworks-relay-"));
const AT = "2026-10-31T09:00:00Z";

test("a token issued verifies to its speaker and scope; the relay keeps only its hash", () => {
  const r = root();
  const p = issueToken(r, { speaker: "person:john", scope: "person", by: "cli", at: AT });
  const a = issueToken(r, { speaker: "agent:xiaoping@john", scope: "agent", by: "person:john", at: AT });
  assert.match(p.token, /^gwx_[0-9a-f]{48}$/);
  assert.notEqual(p.token, a.token);
  assert.deepEqual(verifyToken(r, p.token), { id: p.record.id, speaker: "person:john", scope: "person", at: AT, by: "cli" });
  assert.deepEqual(verifyToken(r, a.token), { id: a.record.id, speaker: "agent:xiaoping@john", scope: "agent", at: AT, by: "person:john" });
  const text = readFileSync(join(r, "_relay", "tokens.geml"), "utf8");
  assert.ok(!text.includes(p.token) && text.includes(hashToken(p.token)), "the token itself is nowhere on disk");
  assert.deepEqual(readDoc(r, "_relay", "tokens.geml").blocks.map((b) => b.id.replace(/-[0-9a-f]+$/, "")), ["token", "token"]);
});

test("what is no token verifies to nothing", () => {
  const r = root();
  issueToken(r, { speaker: "person:john", scope: "person", by: "cli", at: AT });
  for (const bad of ["", "gwx_", "gwx_" + "0".repeat(48), "person:john", "Bearer x"]) assert.equal(verifyToken(r, bad), undefined, bad);
  assert.equal(verifyToken(join(r, "elsewhere"), "gwx_" + "0".repeat(48)), undefined, "no tokens document at all");
});

test("a revoked token verifies to nothing from then on; revoking an unknown id does nothing", () => {
  const r = root();
  const p = issueToken(r, { speaker: "person:john", scope: "person", by: "cli", at: AT });
  assert.equal(revokeToken(r, p.record.id, AT), true);
  assert.equal(verifyToken(r, p.token), undefined);
  assert.equal(revokeToken(r, "token-nothere", AT), false);
  const q = issueToken(r, { speaker: "person:john", scope: "inbox", by: "person:john", at: AT });
  assert.equal(verifyToken(r, q.token)?.scope, "inbox", "a later token of the same person stands");
});
