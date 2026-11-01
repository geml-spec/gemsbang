import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { answerByFile, cardsByFile, fileAdapter } from "../dist/relay/push.js";

test("the file channel (transport §7.2): a card delivered is a block of the out document; an answer appended to the in document is collected once", async () => {
  const root = mkdtempSync(join(tmpdir(), "gemsbang-push-"));
  const ch = fileAdapter(root);
  assert.equal(ch.id, "file");
  await ch.deliver({ person: "p-0000000001", avatar: "a-0000000001", avatarName: "Lily 爸爸", group: "三年二班家长", lang: "zh", need: { id: "need-1", kind: "promise", summary: "周五当志愿者？" } });
  assert.deepEqual(cardsByFile(root).map((c) => [c.avatarName, c.group, c.need.summary]), [["Lily 爸爸", "三年二班家长", "周五当志愿者？"]]);
  assert.deepEqual(await ch.collect(), []);
  answerByFile(root, { person: "p-0000000001", avatar: "a-0000000001", need: "need-1", choice: 0 });
  answerByFile(root, { person: "p-0000000001", avatar: "a-0000000001", need: "need-2", choice: "own", text: "我三点到" });
  assert.deepEqual(await ch.collect(), [{ person: "p-0000000001", avatar: "a-0000000001", need: "need-1", choice: 0 }, { person: "p-0000000001", avatar: "a-0000000001", need: "need-2", choice: "own", text: "我三点到" }]);
  assert.deepEqual(await ch.collect(), [], "each answer once");
});
