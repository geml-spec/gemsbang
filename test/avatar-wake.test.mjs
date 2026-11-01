import { test } from "node:test";
import assert from "node:assert/strict";
import { batchDue, hopsAfter, MAX_HOPS, stoppedByHops, wakeReason } from "../dist/core/avatar/wake.js";

const SEAT = { avatar: "a-0000000001", name: "乐乐爸爸", kind: "group", owner: "a-00000000c1", said: new Set(["msg-3"]) };
const line = (text, extra = {}) => ({ id: "msg-9", speaker: "avatar:a-00000000b1", text, ...extra });

test("when a hosted avatar wakes (spec §7.7, §5 rule 7): an @ always; a two-person chat always; its name, a reply to it, the owner, a question to the people present; else nothing (the batch); never its own line; agents calling agents stop at three hops, and only then is the chat told", () => {
  assert.equal(wakeReason(line("@乐乐爸爸 周五能来吗"), SEAT), "mention");
  assert.equal(wakeReason(line("好的"), { ...SEAT, kind: "dm" }), "dm");
  assert.equal(wakeReason(line("收到", { replyTo: "msg-3" }), SEAT), "reply");
  assert.equal(wakeReason(line("乐乐爸爸上次说的那个"), SEAT), "name");
  assert.equal(wakeReason(line("下周一开家长会", { speaker: "avatar:a-00000000c1" }), SEAT), "owner");
  assert.equal(wakeReason(line("周五谁能来当志愿者？"), SEAT), "question");
  assert.equal(wakeReason(line("Can anyone help on Friday?"), SEAT), "question");
  assert.equal(wakeReason(line("今天天气不错"), SEAT), undefined);
  assert.equal(wakeReason(line("这是什么？"), SEAT), undefined, "a question to nobody present waits");
  assert.equal(wakeReason(line("@乐乐爸爸", { speaker: "avatar:a-0000000001" }), SEAT), undefined, "its own line");
  assert.equal(wakeReason(line("@乐乐爸爸 再说一遍", { by: "agent", hops: MAX_HOPS }), SEAT), undefined, "three hops: the agents stop");
  assert.equal(wakeReason(line("@乐乐爸爸 再说一遍", { by: "agent", hops: 2 }), SEAT), "mention");
  assert.equal(stoppedByHops(line("@乐乐爸爸 再说一遍", { by: "agent", hops: MAX_HOPS }), SEAT), true, "the chat is told");
  assert.equal(stoppedByHops(line("今天天气不错", { by: "agent", hops: MAX_HOPS }), SEAT), false, "it would not have woken anyway");
  assert.equal(stoppedByHops(line("@乐乐爸爸", { by: "agent", hops: 2 }), SEAT), false);
  assert.equal(hopsAfter(undefined), 0);
  assert.equal(hopsAfter(line("x", { by: "person" })), 0);
  assert.equal(hopsAfter(line("x", { by: "agent", hops: 1 })), 2);
  assert.equal(batchDue(19, "2026-11-01T09:00:00Z", "2026-11-01T09:29:00Z"), false);
  assert.equal(batchDue(20, "2026-11-01T09:00:00Z", "2026-11-01T09:01:00Z"), true);
  assert.equal(batchDue(3, "2026-11-01T09:00:00Z", "2026-11-01T09:30:00Z"), true);
  assert.equal(batchDue(0, undefined, "2026-11-01T10:00:00Z"), false);
});
