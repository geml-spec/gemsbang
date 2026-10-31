import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startRelay } from "../dist/relay/server.js";
import { HTML_TYPE, sharePage } from "../dist/relay/page.js";

const CARD = { title: "设置页导出 PDF，能跑的", summary: "一句话", agent: "xiaoping", scope: "src/settings/*", evidence: ["npm test 退出 0"] };

test("the page: a browser asking for HTML gets the one static page; a script asking for JSON gets the card; the guest's road works over the socket, the network address counted", async () => {
  const s = await startRelay({ root: mkdtempSync(join(tmpdir(), "gemworks-relay-")), name: "relay.test" });
  try {
    const john = s.relay.issuePerson("john");
    s.relay.issueAgent(john.record, "xiaoping");
    const made = s.relay.createShare(john.record, CARD);
    assert.equal(made.ok, true, made.reason);
    const id = made.card.id;
    const html = await fetch(`${s.url}/c/${id}`, { headers: { accept: "text/html,application/xhtml+xml" } });
    assert.equal(html.headers.get("content-type"), HTML_TYPE);
    const text = await html.text();
    assert.equal(text, sharePage());
    for (const word of ["问作者的 agent", "不用注册就能看、能问", "想要一个知道你自己项目的 agent？", "注册，先给你一个托管的", "打赏要登录", "怎么做出来的 · 回放", "公开范围", "拿去用", "/ask/", '"/c/"', "还没上线"]) assert.ok(text.includes(word), word);
    assert.ok(!text.includes("innerHTML"), "the page builds nodes, never markup from data");
    assert.equal((await fetch(`${s.url}/c/nothing`, { headers: { accept: "text/html" } })).status, 200, "the page itself says when there is no such card");
    const json = await fetch(`${s.url}/c/${id}`, { headers: { accept: "application/json" } });
    assert.equal(json.headers.get("content-type"), "application/json; charset=utf-8");
    assert.equal((await json.json()).card.title, "设置页导出 PDF，能跑的");
    assert.equal((await fetch(`${s.url}/c/nothing`)).status, 404, "no accept: JSON");
    const ask = await fetch(`${s.url}/ask/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "这个项目怎么跑？" }) });
    assert.equal(ask.status, 201);
    const a = await ask.json();
    assert.match(a.token, /^gwx_/);
    const thread = await fetch(`${s.url}/john/venues/${a.venue}.geml`, { headers: { authorization: `Bearer ${a.token}` } });
    assert.equal((await thread.json()).blocks.filter((b) => b.value?.text === "这个项目怎么跑？").length, 1);
    assert.equal(s.relay.setGuestQuota(john.record, { perIpPerDay: 1 }).ok, true);
    const again = await fetch(`${s.url}/ask/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "再来一位" }) });
    assert.deepEqual([again.status, (await again.json()).error], [429, "这个网络今天问得太多了，明天再来"], "the loopback address counted");
  } finally {
    await s.close();
  }
});
