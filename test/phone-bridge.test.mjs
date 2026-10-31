import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Bridge, FIRST_LINE, tellReply } from "../dist/phone/bridge.js";
import { startRelay } from "../dist/relay/server.js";

const tmp = (p) => mkdtempSync(join(tmpdir(), p));

/** A transport the test drives: what the bot sent, and the texts and presses it hands the bridge. */
class Scripted {
  constructor() { this.sent = []; this.n = 0; this.h = undefined; this.stopped = false; }
  start(h) { this.h = h; }
  stop() { this.stopped = true; }
  async send(chat, text, buttons) { this.n++; this.sent.push({ chat, text, ...(buttons !== undefined ? { buttons } : {}) }); return `msg-${this.n}`; }
  text(chat, text, replyTo) { return this.h.onText(chat, text, replyTo); }
  press(chat, data) { return this.h.onPress(chat, data); }
}

async function world() {
  const s = await startRelay({ root: tmp("gemworks-relay-"), name: "relay.test" });
  const john = s.relay.issuePerson("john");
  const xiaoping = s.relay.issueAgent(john.record, "xiaoping");
  s.relay.createVenue(john.record, { id: "g-7", kind: "group", name: "前端周会", agents: ["agent:xiaoping@john"] });
  const home = tmp("gemworks-phone-");
  const transport = new Scripted();
  const bridge = new Bridge({ relayUrl: s.url, home, transport, pollMs: 3_600_000 });
  bridge.start();
  return { s, john, xiaoping, home, transport, bridge };
}

test("the bot (transport §7.2): bound with the code, the fixed first line; the inbox mirrored as cards with buttons, each once; a press answers through the relay as the person; a typed reply to a card is 自己写; /tell goes to the agent's queue and the bot says so; anything else gets the one help line; an unbound chat is told to bind", async () => {
  const { s, john, xiaoping, home, transport, bridge } = await world();
  try {
    await transport.text("42", "你好");
    assert.deepEqual(transport.sent.at(-1), { chat: "42", text: "先绑定：在桌面端或网页生成一次性码，然后发 /bind <码>" });
    await transport.text("42", "/bind 000000");
    assert.deepEqual(transport.sent.at(-1), { chat: "42", text: "绑定失败：绑定码不对或过期了" });
    await transport.text("42", `/bind ${s.relay.phoneCode(john.record).code}`);
    assert.deepEqual(transport.sent.at(-1), { chat: "42", text: `已绑定 john\n${FIRST_LINE}` });
    assert.equal(FIRST_LINE, "只镜像需要你的事 · 群里的话不在这里");
    const file = JSON.parse(readFileSync(join(home, "phone", "42.json"), "utf8"));
    assert.deepEqual([file.person, s.relay.verify(file.token).scope, file.seen, file.cards, file.n], ["john", "inbox", [], {}, 0]);
    s.relay.appendMessage(xiaoping.record, "john", "g-7", { id: "m-ask", kind: "ask", text: "要不要合并？", ask: { question: "要不要合并？", options: ["合", "不合"], who: "person:john" } });
    assert.equal(await bridge.mirror(), 1);
    assert.deepEqual(transport.sent.at(-1), { chat: "42", text: "[定] 群「前端周会」· xiaoping 问：要不要合并？", buttons: [[{ label: "合", data: "1:0" }, { label: "不合", data: "1:1" }, { label: "自己写", data: "1:2" }]] });
    assert.equal(await bridge.mirror(), 0, "shown once");
    await transport.press("42", "1:0");
    assert.deepEqual(transport.sent.at(-1), { chat: "42", text: "已答：合" });
    const reply = s.relay.venueOf("john", "g-7").messages.at(-1);
    assert.deepEqual([reply.speaker, reply.replyTo, reply.text], ["person:john", "m-ask", "合"]);
    await transport.press("42", "1:1");
    assert.deepEqual(transport.sent.at(-1), { chat: "42", text: "已答：不合" }, "a second press is another word of the person's");
    s.relay.appendMessage(xiaoping.record, "john", "g-7", { id: "m-ask2", kind: "ask", text: "再问", ask: { question: "再问", options: ["好"], who: "person:john" } });
    assert.equal(await bridge.mirror(), 1);
    const card = transport.sent.length;
    assert.equal(transport.sent.at(-1).buttons[0][0].data, "2:0");
    await transport.text("42", "再想想", `msg-${card}`);
    assert.deepEqual(transport.sent.at(-1), { chat: "42", text: "已答：自己写\n再想想" });
    assert.equal(s.relay.venueOf("john", "g-7").messages.at(-1).text, "再想想");
    await transport.text("42", "/tell xiaoping 看看 PR #12");
    assert.deepEqual(transport.sent.at(-1), { chat: "42", text: tellReply("xiaoping", "john") });
    assert.equal(tellReply("xiaoping", "john"), "已进 xiaoping 的队列，主人等级，排第一。它会在群里转述你这句，标『john 原话』");
    assert.equal(s.relay.venueOf("john", "dm-xiaoping").messages.at(-1).text, "看看 PR #12");
    await transport.text("42", "/tell nobody 嗯");
    assert.deepEqual(transport.sent.at(-1), { chat: "42", text: "没进队列：没有这个 agent" });
    await transport.text("42", "随便说一句");
    assert.deepEqual(transport.sent.at(-1), { chat: "42", text: "只认 /tell <agent> <文字>，和对一张卡的回复" });
    await transport.press("42", "9:9");
    assert.equal(transport.sent.length, card + 4, "a press on nothing says nothing");
    bridge.stop();
    assert.equal(transport.stopped, true);
    assert.equal(existsSync(join(home, "phone", "42.json")), true);
  } finally {
    await s.close();
  }
});

test("the mirror is per chat and survives a restart: a second bot chat bound to another person sees only that person's inbox; a new bridge over the same home remembers the bindings and what was shown", async () => {
  const { s, john, xiaoping, home, transport, bridge } = await world();
  try {
    const lisi = s.relay.issuePerson("lisi");
    s.relay.createVenue(lisi.record, { id: "g-l", kind: "group", name: "李四的群", people: ["john"], agents: ["agent:xiaoping@john"] });
    await transport.text("42", `/bind ${s.relay.phoneCode(john.record).code}`);
    await transport.text("77", `/bind ${s.relay.phoneCode(lisi.record).code}`);
    s.relay.appendMessage(xiaoping.record, "lisi", "g-l", { id: "m-a", kind: "ask", text: "问李四", ask: { question: "问李四", options: ["好"], who: "person:lisi" } });
    s.relay.appendMessage(xiaoping.record, "john", "g-7", { id: "m-b", kind: "ask", text: "问 john", ask: { question: "问 john", options: ["好"], who: "person:john" } });
    assert.equal(await bridge.mirror(), 2);
    assert.deepEqual(transport.sent.slice(-2).map((m) => [m.chat, m.text]).sort(), [["42", "[定] 群「前端周会」· xiaoping 问：问 john"], ["77", "[定] 群「李四的群」· xiaoping 问：问李四"]]);
    bridge.stop();
    const again = new Bridge({ relayUrl: s.url, home, transport: new Scripted(), pollMs: 3_600_000 });
    assert.deepEqual(again.bindings().sort(), ["42", "77"]);
    assert.equal(await again.mirror(), 0, "nothing new, nothing shown twice");
  } finally {
    await s.close();
  }
});
