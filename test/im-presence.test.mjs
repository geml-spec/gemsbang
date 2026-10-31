import { test } from "node:test";
import assert from "node:assert/strict";
import { PRESENCE_WORDS, agentPresence, isAlive, presenceText, receiptLine } from "../dist/core/im/presence.js";

test("an agent's presence is its most active session's; no session is asleep (§6.10)", () => {
  assert.deepEqual(PRESENCE_WORDS, { thinking: "思考", tool: "跑工具", waiting: "等你", idle: "空闲", asleep: "睡着" });
  assert.equal(agentPresence([{ presence: "idle" }, { presence: "tool" }, { presence: "asleep" }]), "tool");
  assert.equal(agentPresence([{ presence: "waiting" }, { presence: "thinking" }]), "thinking");
  assert.equal(agentPresence([{ presence: "asleep" }]), "asleep");
  assert.equal(agentPresence([]), "asleep");
  assert.equal(isAlive("asleep"), false);
  assert.equal(isAlive("idle"), true);
});

test("the public status text uses only what the venue may see: the task where it is visible, 忙 elsewhere (§6.10)", () => {
  assert.equal(presenceText("tool", { toolSeconds: 40 }), "跑工具 40 秒");
  assert.equal(presenceText("tool", {}), "跑工具");
  assert.equal(presenceText("tool", { toolSeconds: 40, task: "#42", taskVisibleHere: true }), "正在做 #42 · 跑工具 40 秒");
  assert.equal(presenceText("tool", { toolSeconds: 40, task: "#42", taskVisibleHere: false }), "忙");
  assert.equal(presenceText("thinking", { task: "#42", taskVisibleHere: true }), "正在做 #42");
  assert.equal(presenceText("thinking", { task: "#42" }), "忙");
  assert.equal(presenceText("thinking", {}), "思考");
  assert.equal(presenceText("waiting", {}), "等主人");
  assert.equal(presenceText("idle", {}), "空闲");
  assert.equal(presenceText("asleep", { task: "#42", taskVisibleHere: true }), "睡着");
});

test("receipts under a person's message (§6.10)", () => {
  assert.equal(receiptLine({ delivered: true, readBy: ["张三", "李四"] }), "已读 · 张三、李四");
  assert.equal(receiptLine({ delivered: true, readBy: [] }), "送达");
  assert.equal(receiptLine({ delivered: false, readBy: [] }), "发送中");
});
