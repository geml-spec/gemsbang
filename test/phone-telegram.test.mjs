import { test } from "node:test";
import assert from "node:assert/strict";
import { TelegramTransport } from "../dist/phone/telegram.js";

test("the Telegram transport: long polling with the offset moved past each update; a text with the message it replies to, a button press answered to the API; a message sent with its inline keyboard; stopped, the loop ends", async () => {
  const calls = [];
  let updates = [
    { update_id: 7, message: { message_id: 3, chat: { id: 42 }, text: "/tell xiaoping hi", reply_to_message: { message_id: 2 } } },
    { update_id: 8, callback_query: { id: "cq-1", from: { id: 42 }, message: { chat: { id: 42 }, message_id: 5 }, data: "1:0" } },
    { update_id: 9, message: { message_id: 6, chat: { id: 42 }, text: "plain" } },
  ];
  let t;
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ method: url.split("/").pop(), body });
    if (url.endsWith("/getUpdates")) {
      const u = updates;
      updates = [];
      if (u.length === 0) t.stop();
      return { json: async () => ({ ok: true, result: u }) };
    }
    if (url.endsWith("/sendMessage")) return { json: async () => ({ ok: true, result: { message_id: 9 } }) };
    return { json: async () => ({ ok: true, result: true }) };
  };
  t = new TelegramTransport("123:abc", fetchImpl);
  const got = [];
  t.start({ onText: (chat, text, replyTo) => { got.push(["text", chat, text, replyTo]); }, onPress: (chat, data) => { got.push(["press", chat, data]); } });
  await t.idle();
  assert.deepEqual(got, [["text", "42", "/tell xiaoping hi", "2"], ["press", "42", "1:0"], ["text", "42", "plain", undefined]]);
  assert.deepEqual(calls.filter((c) => c.method === "getUpdates").map((c) => c.body), [{ offset: 0, timeout: 25 }, { offset: 10, timeout: 25 }]);
  assert.deepEqual(calls.find((c) => c.method === "answerCallbackQuery").body, { callback_query_id: "cq-1" });
  assert.equal(calls[0].body.offset, 0);
  assert.equal(await t.send("42", "你好", [[{ label: "合", data: "1:0" }, { label: "不合", data: "1:1" }]]), "9");
  assert.deepEqual(calls.at(-1), { method: "sendMessage", body: { chat_id: "42", text: "你好", reply_markup: { inline_keyboard: [[{ text: "合", callback_data: "1:0" }, { text: "不合", callback_data: "1:1" }]] } } });
  await t.send("42", "无按钮");
  assert.deepEqual(calls.at(-1).body, { chat_id: "42", text: "无按钮" });
  const url = calls.length;
  void url;
});

test("a Telegram error is thrown with its description; the loop waits and goes on after a failed poll", async () => {
  let polls = 0;
  let t;
  const fetchImpl = async (url) => {
    if (url.endsWith("/getUpdates")) { polls++; if (polls === 1) throw new Error("network"); t.stop(); return { json: async () => ({ ok: true, result: [] }) }; }
    return { json: async () => ({ ok: false, description: "Bad Request: chat not found" }) };
  };
  t = new TelegramTransport("123:abc", fetchImpl, 10);
  t.start({ onText: () => {}, onPress: () => {} });
  await t.idle();
  assert.equal(polls, 2, "the failed poll is retried after the wait");
  await assert.rejects(t.send("1", "x"), /Bad Request: chat not found/);
});
