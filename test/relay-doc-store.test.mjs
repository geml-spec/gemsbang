import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendSealed, fileStore, memoryStore, nodeSql, sqlStore } from "../dist/relay/doc-store.js";
import { AvatarRelay } from "../dist/relay/avatars.js";
import { nextId, sealed } from "../dist/relay/store.js";

/** What every store does the same (architecture §2.3): documents of sealed blocks in order, an id already there answered as it is, the documents under a folder, one removed whole, a secret made once. */
function contract(s) {
  assert.deepEqual(s.read("a-0000000001", "venues/g-000000000a.geml"), { blocks: [], diagnostics: [], text: "", exists: false });
  const one = s.append("a-0000000001", "venues/g-000000000a.geml", nextId("msg"), (_d, prev, id) => sealed({ id, text: "你好", at: "2026-11-02T09:00:00Z" }, prev));
  const two = s.append("a-0000000001", "venues/g-000000000a.geml", nextId("msg"), (_d, prev, id) => sealed({ id, text: "在吗", at: "2026-11-02T09:01:00Z" }, prev));
  assert.deepEqual([one.existed, one.block.id, one.block.value.prev, two.block.id, two.block.value.prev], [false, "msg-1", null, "msg-2", one.block.value.hash], "sealed on the document's chain");
  const again = s.append("a-0000000001", "venues/g-000000000a.geml", () => "msg-1", () => ({ text: "changed" }));
  assert.deepEqual([again.existed, again.block.value.text], [true, "你好"], "an id already there is answered as it is");
  const d = s.read("a-0000000001", "venues/g-000000000a.geml");
  assert.deepEqual([d.exists, d.blocks.map((b) => [b.id, b.value.text]), d.text.startsWith("=== meta")], [true, [["msg-1", "你好"], ["msg-2", "在吗"]], true]);
  appendSealed(s, "a-0000000001", "venues/d-000000000b.geml", "member-1", { avatar: "a-0000000002" });
  appendSealed(s, "a-0000000001", "venues/old/x.geml", "member-1", { avatar: "a-0000000003" });
  appendSealed(s, "a-0000000009", "venues/g-000000000c.geml", "member-1", { avatar: "a-0000000009" });
  assert.deepEqual(s.list("a-0000000001", "venues"), ["venues/d-000000000b.geml", "venues/g-000000000a.geml"], "directly under the folder, this owner's");
  assert.deepEqual(s.list("a-0000000001", "needs"), []);
  s.remove("a-0000000001", "venues/d-000000000b.geml");
  assert.deepEqual([s.read("a-0000000001", "venues/d-000000000b.geml").exists, s.list("a-0000000001", "venues")], [false, ["venues/g-000000000a.geml"]], "removed whole (S19: the last one left)");
  s.remove("a-0000000001", "venues/never.geml");
  let made = 0;
  const make = () => { made++; return `salt-${made}`; };
  assert.deepEqual([s.secret("avatar-salt.txt", make), s.secret("avatar-salt.txt", make), made], ["salt-1", "salt-1", 1], "made once");
  assert.throws(() => s.append("a-0000000001", "x.geml", () => "bad id!", () => ({})), /is not one/);
}

test("the documents on files (architecture §2.3): as the Node shell has always kept them", () => {
  contract(fileStore(mkdtempSync(join(tmpdir(), "gemsbang-store-"))));
});

test("the documents in memory (architecture §2.3): the same, kept nowhere", () => {
  contract(memoryStore());
});

/** node:sqlite where this Node has it (22.13 and later), else the test says why it skipped. */
const sqlite = await import("node:sqlite").catch(() => undefined);

test("the documents on SQLite (architecture §2.3; a Durable Object's own in plan AA): the same, one row per block; a relay on it keeps its people and tokens across restarts", { skip: sqlite === undefined && "no node:sqlite in this Node" }, () => {
  contract(sqlStore(nodeSql(new sqlite.DatabaseSync(":memory:"))));
  const db = new sqlite.DatabaseSync(":memory:");
  const texts = [];
  const first = new AvatarRelay({ store: sqlStore(nodeSql(db)), name: "relay.test", texter: (t) => { texts.push(t); } });
  assert.equal(first.startLogin({ phone: "13800138000" }).ok, true);
  const done = first.finishLogin({ phone: "13800138000", code: texts.at(-1).text.match(/(\d{6})/)[1] });
  const again = new AvatarRelay({ store: sqlStore(nodeSql(db)), name: "relay.test", texter: () => undefined });
  assert.equal(again.verify(done.token)?.speaker, `person:${done.person}`, "the same database, a new relay: the token still holds");
  assert.equal(again.avatarsOf(done.person).length, 0);
});
