import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { route } from "../dist/relay/api.js";
import { Relay } from "../dist/relay/relay.js";
import { readDoc } from "../dist/relay/store.js";
import { DISCLAIMER } from "../dist/core/im/risk.js";

const BASE = Date.UTC(2026, 9, 31, 9, 0, 0);
function relay() {
  let offset = 0;
  const now = () => { const t = new Date(BASE + offset).toISOString().replace(/\.\d{3}Z$/, "Z"); offset += 1000; return t; };
  const r = new Relay({ root: mkdtempSync(join(tmpdir(), "gemworks-relay-")), name: "relay.test", version: "0.0.0", now });
  r.advance = (ms) => { offset += ms; };
  return r;
}
function call(r, line, { token, body } = {}) {
  const [method, path] = line.split(" ");
  const res = route({ method, path, query: {}, ...(token !== undefined ? { token } : {}), ...(body !== undefined ? { body } : {}) }, r);
  return { status: res.status, json: res.type.startsWith("application/json") ? JSON.parse(res.body) : undefined, text: res.body };
}
const SIGNAL = { market: "polymarket:will-x-happen-by-dec", side: "yes", sizeHint: { kind: "fraction-of-bankroll", value: 0.02 }, priceCap: 0.63, expires: "2026-10-31T10:00:00Z", confidence: 0.7, thesis: "https://relay.test/zhang/venues/ch-1.geml#why" };

/** 张 (agent alpha, the publisher), john (agent 小评, 100 credits), 李四 (the free 20). */
function world() {
  const r = relay();
  const zhang = r.issuePerson("zhang"), john = r.issuePerson("john"), lisi = r.issuePerson("lisi");
  const alpha = r.issueAgent(zhang.record, "alpha"), xiaoping = r.issueAgent(john.record, "xiaoping");
  r.topUp("john", 100);
  const made = r.createVenue(zhang.record, { id: "ch-1", kind: "channel", name: "alpha 的信号", agents: ["agent:alpha@zhang"], price: { month: 30, signal: 2 } });
  assert.equal(made.ok, true, made.reason);
  return { r, zhang, john, lisi, alpha, xiaoping };
}

test("a channel (§10.4): the owner's one agent as its publisher, a price by the month and by the signal; listed with its subscriber count and performance; the venues listing names the publisher", () => {
  const { r, zhang, john, alpha } = world();
  assert.equal(r.createVenue(zhang.record, { id: "ch-2", kind: "channel", name: "x", agents: [] }).reason, "订阅频道要一个自己的 agent 发信号，只能一个");
  assert.equal(r.createVenue(zhang.record, { id: "ch-2", kind: "channel", name: "x", agents: ["agent:alpha@zhang", "agent:xiaoping@john"] }).reason, "订阅频道要一个自己的 agent 发信号，只能一个");
  assert.equal(r.createVenue(john.record, { id: "ch-2", kind: "channel", name: "x", agents: ["agent:alpha@zhang"] }).reason, "订阅频道要一个自己的 agent 发信号，只能一个");
  assert.equal(r.createVenue(zhang.record, { id: "ch-2", kind: "channel", name: "x", agents: ["agent:alpha@zhang"], price: { month: -1 } }).reason, "价格 month 是非负整数");
  const v = r.venueOf("zhang", "ch-1").venue;
  assert.deepEqual([v.kind, v.publisher, v.price, v.people, v.agents], ["channel", "alpha", { month: 30, signal: 2 }, ["zhang"], ["alpha"]]);
  assert.deepEqual(call(r, "GET /channels", { token: john.token }).json, [{ owner: "zhang", id: "ch-1", name: "alpha 的信号", publisher: "alpha", price: { month: 30, signal: 2 }, subscribers: 0, performance: { hits: 0, counted: 0, open: 0, return90: 0, drawdown: 0, retracted: 0, rule: r.performanceOf("zhang", "alpha").rule } }]);
  assert.deepEqual(call(r, "GET /venues", { token: zhang.token }).json, [{ owner: "zhang", id: "ch-1", kind: "channel", name: "alpha 的信号", publisher: "alpha" }]);
  void alpha;
});

test("a subscription (§10.4, §10.6): paid from the wallet to the publisher's owner, the disclaimer shown; by the month until a day, by the signal counted off; the owner needs none, an agent may not, the broke may not; a subscriber may read but not speak; the publisher sees only the count", () => {
  const { r, zhang, john, lisi, alpha } = world();
  assert.equal(call(r, "POST /channels/zhang/ch-1/subscribe", { token: lisi.token, body: { month: true } }).json.error, "积分不够：钱包 20，要 30");
  assert.equal(call(r, "POST /channels/zhang/ch-1/subscribe", { token: zhang.token, body: { month: true } }).json.error, "自己的频道不用订阅");
  assert.equal(call(r, "POST /channels/zhang/ch-1/subscribe", { token: alpha.token, body: { month: true } }).status, 403);
  assert.equal(call(r, "POST /channels/zhang/ch-1/subscribe", { token: lisi.token, body: {} }).json.error, "订阅写 { month: true } 或 { signals: N }");
  assert.equal(call(r, "POST /channels/zhang/ch-1/subscribe", { token: lisi.token, body: { signals: 0 } }).status, 400);
  const bySignal = call(r, "POST /channels/zhang/ch-1/subscribe", { token: lisi.token, body: { signals: 3 } });
  assert.deepEqual([bySignal.status, bySignal.json.left, bySignal.json.until, bySignal.json.disclaimer, bySignal.json.venue.people], [200, 3, undefined, DISCLAIMER, ["zhang", "lisi"]]);
  assert.deepEqual([r.balance("lisi"), r.balance("zhang")], [14, 26]);
  assert.deepEqual(r.ledgerOf("lisi").at(-1).kind, "subscribe");
  assert.equal(r.ledgerOf("zhang").at(-1).note, "「alpha 的信号」· 3 条");
  const byMonth = call(r, "POST /channels/zhang/ch-1/subscribe", { token: john.token, body: { month: true } });
  assert.deepEqual([byMonth.status, byMonth.json.left, r.balance("john")], [200, undefined, 90]);
  assert.match(byMonth.json.until, /^2026-11-30T09:00:\d\dZ$/);
  assert.equal(call(r, "GET /channels", { token: john.token }).json[0].subscribers, 2);
  assert.equal(call(r, "GET /zhang/venues/ch-1.geml", { token: lisi.token }).status, 200, "a subscriber reads the channel");
  assert.equal(call(r, "POST /venues/zhang/ch-1/messages", { token: john.token, body: { id: "m-1", text: "hi" } }).json.error, "订阅频道只有信号，由发布方的 agent 用 im_signal 发");
  const free = relay();
  const zhao = free.issuePerson("zhao"), qian = free.issuePerson("qian");
  free.issueAgent(zhao.record, "beta");
  free.createVenue(zhao.record, { id: "ch-f", kind: "channel", name: "免费", agents: ["agent:beta@zhao"] });
  assert.equal(call(free, "POST /channels/zhao/ch-f/subscribe", { token: qian.token, body: { month: true } }).json.error, "这个频道不按月卖");
  assert.equal(call(free, "POST /channels/zhao/ch-f/subscribe", { token: qian.token, body: { signals: 5 } }).json.error, "这个频道不按条卖");
});

test("a signal (§10.1, §10.2): by the channel's publisher agent only, every field checked; onto the agent's chain with the host's stamp and hash and the relay's receipt, then a signal message in the channel pointing at the block; a retraction by the agent or its owner stays on the chain and the channel hears it", () => {
  const { r, zhang, john, lisi, alpha, xiaoping } = world();
  call(r, "POST /channels/zhang/ch-1/subscribe", { token: john.token, body: { month: true } });
  assert.equal(call(r, "POST /signals", { token: john.token, body: { ...SIGNAL, channel: "zhang/ch-1" } }).json.error, "信号由 agent 发");
  assert.equal(call(r, "POST /signals", { token: xiaoping.token, body: { ...SIGNAL, channel: "zhang/ch-1" } }).json.error, "只有频道的发布方 agent 能发信号");
  assert.equal(call(r, "POST /signals", { token: alpha.token, body: { ...SIGNAL, channel: "zhang/nope" } }).status, 404);
  assert.equal(call(r, "POST /signals", { token: alpha.token, body: { channel: "zhang/ch-1", market: "m" } }).json.error, "方向是 yes 或 no；仓位提示是 { kind: fraction-of-bankroll, value: 0 到 1 }；价格上限是正数；过期时间要是 ISO 时间；信心是 0 到 1");
  const made = call(r, "POST /signals", { token: alpha.token, body: { ...SIGNAL, channel: "zhang/ch-1", at: "2026-10-31T08:59:00Z", hostHash: "sha256:host1" } });
  assert.equal(made.status, 201, made.text);
  const s1 = made.json.signal;
  assert.deepEqual([s1.id, s1.from, s1.at, s1.hostHash, s1.channel, s1.market, s1.thesis, made.json.address], ["signal-1", "agent:alpha@zhang", "2026-10-31T08:59:00Z", "sha256:host1", "zhang/ch-1", SIGNAL.market, SIGNAL.thesis, "https://relay.test/zhang/signals/alpha.geml#signal-1"]);
  assert.match(s1.received, /^2026-10-31T09:00:\d\dZ$/, "the relay's own stamp");
  assert.deepEqual(readDoc(r.root, "zhang", "signals/alpha.geml").blocks.map((b) => b.id), ["signal-1"]);
  const msg = r.venueOf("zhang", "ch-1").messages.at(-1);
  assert.deepEqual([msg.kind, msg.speaker, msg.text, msg.signal, msg.hops], ["signal", "agent:alpha@zhang", "信号 signal-1 · polymarket:will-x-happen-by-dec · 买是 · 价 ≤0.63 · 过期 10:00", "https://relay.test/zhang/signals/alpha.geml#signal-1", 0]);
  const s2 = call(r, "POST /signals", { token: alpha.token, body: { ...SIGNAL, channel: "zhang/ch-1", at: "not a time" } }).json.signal;
  assert.equal(s2.at, s2.received, "a bad host stamp: the relay's stands for both");
  // retraction
  assert.equal(call(r, "POST /signals/signal-1/retract", { token: lisi.token, body: { agent: "alpha" } }).status, 400, "not their agent");
  assert.equal(call(r, "POST /signals/signal-1/retract", { token: xiaoping.token }).status, 404, "not on that agent's chain");
  assert.equal(call(r, "POST /signals/signal-9/retract", { token: alpha.token }).status, 404);
  const retracted = call(r, "POST /signals/signal-1/retract", { token: alpha.token });
  assert.match(retracted.json.signal.retracted, /^2026-10-31T09:00:\d\dZ$/);
  assert.deepEqual(readDoc(r.root, "zhang", "signals/alpha.geml").blocks.map((b) => b.id), ["signal-1", "signal-2", "retract-1"]);
  assert.deepEqual([r.venueOf("zhang", "ch-1").messages.at(-1).kind, r.venueOf("zhang", "ch-1").messages.at(-1).text], ["system", "信号 signal-1 已撤回"]);
  assert.equal(call(r, "POST /signals/signal-1/retract", { token: alpha.token }).status, 200, "again: no second mark");
  assert.equal(readDoc(r.root, "zhang", "signals/alpha.geml").blocks.length, 3);
  assert.equal(call(r, "POST /signals/signal-2/retract", { token: zhang.token, body: {} }).json.error, "要一个自己名下的 agent");
  assert.equal(call(r, "POST /signals/signal-2/retract", { token: zhang.token, body: { agent: "alpha" } }).status, 200, "the owner, naming the agent");
  assert.equal(r.signalsOf("zhang", "alpha").filter((s) => s.retracted !== undefined).length, 2);
});

test("prices and performance (§10.3): points under the relay's own name on a chain; the page needs no token and shows the chain with the four numbers; the agent's page carries them once it has signals; a per-signal subscription lapses once its signals came, a monthly one after its month, both swept by tick", () => {
  const { r, zhang, john, lisi, alpha } = world();
  assert.equal(r.setPrice("", 1).reason, "缺市场");
  assert.equal(r.setPrice(SIGNAL.market, 0).reason, "价格是正数");
  assert.equal(r.setPrice(SIGNAL.market, 0.6, "x").reason, "时间要是 ISO 时间");
  assert.equal(r.setPrice(SIGNAL.market, 0.6, "2026-10-31T08:00:00Z").ok, true);
  call(r, "POST /channels/zhang/ch-1/subscribe", { token: lisi.token, body: { signals: 3 } });
  call(r, "POST /channels/zhang/ch-1/subscribe", { token: john.token, body: { month: true } });
  for (const side of ["yes", "yes", "no"]) assert.equal(call(r, "POST /signals", { token: alpha.token, body: { ...SIGNAL, side, channel: "zhang/ch-1" } }).status, 201);
  call(r, "POST /signals/signal-1/retract", { token: alpha.token });
  call(r, "POST /signals/signal-2/retract", { token: zhang.token, body: { agent: "alpha" } });
  assert.equal(r.setPrice(SIGNAL.market, 0.7, "2026-10-31T10:00:00Z").ok, true);
  assert.deepEqual(call(r, `GET /prices/${encodeURIComponent(SIGNAL.market)}`, { token: john.token }).json, { market: SIGNAL.market, points: [{ at: "2026-10-31T08:00:00Z", price: 0.6 }, { at: "2026-10-31T10:00:00Z", price: 0.7 }] });
  assert.deepEqual(readDoc(r.root, "_relay", "prices/polymarket_will-x-happen-by-dec.geml").blocks.map((b) => [b.id, typeof b.value.hash]), [["p-1", "string"], ["p-2", "string"]]);
  assert.equal(call(r, "GET /a/zhang/alpha").json.performance.open, 3, "before expiry: all open");
  r.advance(2 * 3_600_000);
  const page = call(r, "GET /signals/zhang/alpha");
  assert.equal(page.status, 200);
  assert.deepEqual(page.json.signals.map((s) => [s.id, s.side, s.retracted !== undefined]), [["signal-1", "yes", true], ["signal-2", "yes", true], ["signal-3", "no", false]]);
  // in at 0.6 (the receipt price, within the cap), out at 0.7: yes +1/6 × 2%, no −1/6 × 2%
  assert.deepEqual([page.json.performance.hits, page.json.performance.counted, page.json.performance.open, page.json.performance.retracted, page.json.performance.return90, page.json.performance.drawdown], [2, 3, 0, 2, 0.0033, 0.0033]);
  assert.equal(call(r, "GET /signals/zhang/nobody").status, 404);
  assert.equal(call(r, "GET /a/john/xiaoping").json.performance, undefined, "no signals, no numbers");
  assert.equal(call(r, "GET /a/zhang/alpha").json.performance.hits, 2);
  // the sweep
  assert.deepEqual(r.subscriptionOf(r.venueOf("zhang", "ch-1"), "lisi", r.now()), { active: false, left: 0 });
  assert.equal(r.subscriptionOf(r.venueOf("zhang", "ch-1"), "john", r.now()).active, true);
  const swept = r.tick();
  assert.deepEqual([swept.lapsed, r.venueOf("zhang", "ch-1").venue.people], [["zhang/ch-1/lisi"], ["zhang", "john"]]);
  assert.equal(call(r, "GET /zhang/venues/ch-1.geml", { token: lisi.token }).status, 403, "gone from the readers");
  assert.equal(call(r, "GET /zhang/signals/alpha.geml", { token: lisi.token }).status, 200, "the chain stays public, like the page");
  r.advance(31 * 86_400_000);
  assert.deepEqual([r.tick().lapsed, r.venueOf("zhang", "ch-1").venue.people], [["zhang/ch-1/john"], ["zhang"]]);
  assert.deepEqual(r.tick().lapsed, [], "swept once");
});
