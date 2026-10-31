import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readDataBlocks } from "../dist/core/im/chain.js";
import { riskOf } from "../dist/core/im/risk.js";
import { answerExecNeed, commandConnector, execNeeds, objectToSignal, readExec, readRisk, runExec, writeExec, writeRisk } from "../dist/daemon/exec.js";
import { publishSignal, retractSignal } from "../dist/daemon/deliver.js";
import { listOutbox, readConfig, writeConfig } from "../dist/daemon/home.js";
import { Daemon } from "../dist/daemon/sync.js";
import { statusView, threadView } from "../dist/daemon/view.js";
import { startRelay } from "../dist/relay/server.js";

const tmp = (p) => mkdtempSync(join(tmpdir(), p));
const T0 = Date.now();
const iso = (ms) => new Date(T0 + ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const NOW = iso(0);
const MARKET = "polymarket:will-x-happen-by-dec";
const SIGNAL = { market: MARKET, side: "yes", sizeHint: { kind: "fraction-of-bankroll", value: 0.02 }, priceCap: 0.63, expires: iso(3_600_000), confidence: 0.7, thesis: "https://relay.test/zhang/venues/ch-1.geml#why", channel: "zhang/ch-1" };

/** 张 publishes through alpha into ch-1 (30 a month, 2 a signal); john (agent 小评, 100 credits) subscribes by the month; the price sits at 0.6 since an hour ago. */
async function world() {
  const s = await startRelay({ root: tmp("gemworks-relay-"), name: "relay.test" });
  const zhang = s.relay.issuePerson("zhang"), john = s.relay.issuePerson("john");
  const alpha = s.relay.issueAgent(zhang.record, "alpha"), xiaoping = s.relay.issueAgent(john.record, "xiaoping");
  s.relay.topUp("john", 100);
  s.relay.createVenue(zhang.record, { id: "ch-1", kind: "channel", name: "alpha 的信号", agents: ["agent:alpha@zhang"], price: { month: 30, signal: 2 } });
  s.relay.subscribe(john.record, "zhang", "ch-1", { month: true });
  s.relay.setPrice(MARKET, 0.6, iso(-3_600_000));
  const homes = { zhang: tmp("gemworks-im-"), john: tmp("gemworks-im-") };
  writeConfig(homes.zhang, { relay: { url: s.url, name: "relay.test" }, person: "zhang", token: zhang.token, agents: { alpha: alpha.token } });
  writeConfig(homes.john, { relay: { url: s.url, name: "relay.test" }, person: "john", token: john.token, agents: { xiaoping: xiaoping.token } });
  const orders = [];
  const connector = async (command, order) => { orders.push({ command, order }); return command === "fail" ? { ok: false, error: "connector exited 1: no creds" } : { ok: true, id: `ord-${orders.length}` }; };
  const tools = { prices: async (m) => s.relay.pricesOf(m), performance: async (o, a) => s.relay.performanceOf(o, a), connector };
  const daemons = { zhang: new Daemon({ home: homes.zhang }), john: new Daemon({ home: homes.john, connector }) };
  const publish = async (extra = {}) => { const r = publishSignal(homes.zhang, "alpha", { ...SIGNAL, ...extra }, NOW); await daemons.zhang.flushOutbox(); await daemons.john.syncOnce(); return r; };
  return { s, zhang, john, alpha, xiaoping, homes, daemons, orders, tools, connector, publish };
}

test("the publisher's host seals the signal on its own chain first (§10.2), then the outbox carries it with that stamp and hash; a retraction goes the same way; the subscriber's daemon follows the chain and runs the module: 纸面 records what following would have been; the page shows the price, the stage card, the signal card with the module's line, the footer; the row says the stage and today's count", async () => {
  const { s, homes, daemons } = await world();
  try {
    const made = publishSignal(homes.zhang, "alpha", SIGNAL, NOW);
    const chain = readDataBlocks(readFileSync(join(homes.zhang, "signals", "alpha.geml"), "utf8")).blocks;
    assert.deepEqual([chain.length, chain[0].id, chain[0].value.market, chain[0].value.from, chain[0].value.at, typeof chain[0].value.hash, chain[0].value.prev], [1, made.id, MARKET, "agent:alpha@zhang", NOW, "string", null]);
    assert.equal(made.hash, chain[0].value.hash);
    assert.deepEqual(listOutbox(homes.zhang).map((e) => [e.kind, e.as, e.body.hostHash, e.body.at, e.body.channel]), [["signal", "agent:alpha", made.hash, NOW, "zhang/ch-1"]]);
    assert.deepEqual(await daemons.zhang.flushOutbox(), { pushed: 1, failed: 0, left: 0 });
    const onRelay = s.relay.signalsOf("zhang", "alpha");
    assert.deepEqual([onRelay.length, onRelay[0].id, onRelay[0].hostHash, onRelay[0].at], [1, "signal-1", made.hash, NOW]);
    publishSignal(homes.zhang, "alpha", SIGNAL, iso(1000));
    assert.equal(readDataBlocks(readFileSync(join(homes.zhang, "signals", "alpha.geml"), "utf8")).blocks[1].value.prev, made.hash, "the host's chain links");
    retractSignal(homes.zhang, "alpha", "signal-1", iso(2000));
    assert.deepEqual(listOutbox(homes.zhang).map((e) => e.kind), ["signal", "retract"]);
    await daemons.zhang.flushOutbox();
    assert.equal(s.relay.signalsOf("zhang", "alpha")[0].retracted !== undefined, true);
    // the subscriber
    const r = await daemons.john.syncOnce();
    assert.deepEqual([r.connected, r.executed], [true, 2]);
    assert.equal(existsSync(join(homes.john, "relay.test", "zhang", "signals", "alpha.geml")), true, "the publisher's chain is followed");
    const state = readExec(homes.john, "zhang", "ch-1");
    assert.deepEqual(state.records.map((x) => [x.signal, x.kind, x.entry, x.note]), [["signal-1", "skipped", undefined, "已撤回"], ["signal-2", "paper", 0.6, "若跟：0.6 进，2%"]]);
    assert.equal((await daemons.john.syncOnce()).executed, 0, "nothing new");
    const row = statusView(homes.john, {}, NOW).venues.find((v) => v.id === "ch-1");
    assert.deepEqual([row.kindWord, row.status, row.unread], ["订阅频道", "纸面 · 今天 2 条", 2]);
    const th = threadView(homes.john, "zhang", "ch-1", 50, NOW);
    assert.deepEqual(th.channel, { price: "按月 30 · 按条 2", stage: ["阶段：纸面 · 第 1 天 · 命中 —", "升级：还要 14 天，且命中 ≥ 60%（现在没有结算的信号），主人批准"], footer: "平台不托管资金、不经手密钥 · 订阅时已展示免责条款 · 发布方看不到你跟没跟" });
    assert.deepEqual(th.messages.map((m) => [m.kind, m.signal?.length]), [["signal", 4], ["signal", 4], ["system", undefined]]);
    assert.deepEqual([th.messages[0].signal[0].endsWith("· 已撤回"), th.messages[0].signal[3], th.messages[1].signal[3]], [true, "跳过 · 已撤回", "纸面 · 记为『若跟：0.6 进，2%』· 没下单"]);
    assert.equal(th.messages[1].signal[1], `市场 ${MARKET} · 买是 · 价 ≤0.63 · 仓位 2% · 过期 ${SIGNAL.expires.slice(5, 10)} ${SIGNAL.expires.slice(11, 16)} · 信心 0.7`);
    // settled once the price at expiry is known: the stage card's evidence
    s.relay.setPrice(MARKET, 0.7, SIGNAL.expires);
    await runExec(homes.john, iso(2 * 3_600_000), { prices: async (m) => s.relay.pricesOf(m), performance: async () => undefined, connector: async () => ({ ok: false, error: "never" }) });
    assert.equal(readExec(homes.john, "zhang", "ch-1").records[1].outcome, "win");
    assert.equal(threadView(homes.john, "zhang", "ch-1", 50, iso(2 * 3_600_000)).channel.stage[0], "阶段：纸面 · 第 1 天 · 命中 100%");
  } finally {
    await s.close();
  }
});

test("小仓 (§10.5): every order is an ask on the band — 跟 places it through the connector and records it, 跳过 records that, 全停 drops the channel to 纸面 and mutes the asks with a 卡住 that 知道了 clears; an expired ask is dropped", async () => {
  const { s, homes, orders, connector, publish, tools } = await world();
  try {
    writeRisk(homes.john, "zhang", "ch-1", riskOf({ stage: "small", stageSince: iso(-20 * 86_400_000), markets: [MARKET], perOrder: 5, perDay: 20, maxPositions: 3, cooldownMinutes: 0, connector: "node order.mjs" }));
    await publish();
    const state = readExec(homes.john, "zhang", "ch-1");
    assert.deepEqual(state.asks.map((a) => [a.signal, a.price, a.amount, a.market, a.side, a.cap]), [["signal-1", 0.6, 5, MARKET, "yes", 0.63]]);
    const needs = execNeeds(homes.john, readConfig(homes.john), NOW);
    assert.deepEqual(needs.map((n) => [n.kind, n.key, n.text, n.actions, n.venue]), [["decide", "exec:zhang/ch-1/signal-1", `频道「alpha 的信号」· 跟 signal-1？过期 ${SIGNAL.expires.slice(11, 16)} · 买是 · 价 0.6 · 金额 5 · 在风控之内 · agent：未参与`, ["跟", "跳过", "全停"], "ch-1"]]);
    assert.equal(statusView(homes.john, {}, NOW).needs.some((n) => n.key === "exec:zhang/ch-1/signal-1"), true, "on the band");
    assert.equal(threadView(homes.john, "zhang", "ch-1", 50, NOW).messages[0].signal[3], "已问主人 · 等定");
    assert.deepEqual(await answerExecNeed(homes.john, "exec:zhang/ch-1/signal-1", "跟", NOW, connector), { ok: true });
    assert.deepEqual(orders, [{ command: "node order.mjs", order: { signal: "signal-1", market: MARKET, side: "yes", price: 0.6, amount: 5, channel: "zhang/ch-1" } }]);
    assert.deepEqual(readExec(homes.john, "zhang", "ch-1").records.map((x) => [x.signal, x.kind, x.note, x.order, x.amount]), [["signal-1", "followed", "单 ord-1 · 0.6 × 5", "ord-1", 5]]);
    assert.deepEqual(execNeeds(homes.john, readConfig(homes.john), NOW), []);
    assert.deepEqual(await answerExecNeed(homes.john, "exec:zhang/ch-1/signal-1", "跟", NOW, connector), { ok: false, reason: "这条询问已经过了" });
    await publish();
    assert.deepEqual(await answerExecNeed(homes.john, "exec:zhang/ch-1/signal-2", "跳过", NOW, connector), { ok: true });
    assert.deepEqual(readExec(homes.john, "zhang", "ch-1").records.at(-1).note, "主人跳过");
    await publish();
    assert.deepEqual(await answerExecNeed(homes.john, "exec:zhang/ch-1/signal-3", "全停", NOW, connector), { ok: true });
    const risk = readRisk(homes.john, "zhang", "ch-1");
    assert.deepEqual([risk.stage, risk.muted, risk.stageSince], ["paper", true, NOW]);
    const after = readExec(homes.john, "zhang", "ch-1");
    assert.deepEqual([after.asks, after.stuck, after.records.at(-1).kind], [[], { why: "主人全停", at: NOW }, "stopped"]);
    const stuck = execNeeds(homes.john, readConfig(homes.john), NOW);
    assert.deepEqual(stuck.map((n) => [n.kind, n.key, n.text, n.actions]), [["stuck", "exec-stuck:zhang/ch-1", "频道「alpha 的信号」本机执行退回纸面：主人全停", ["知道了"]]]);
    assert.deepEqual(await answerExecNeed(homes.john, "exec-stuck:zhang/ch-1", "知道了", NOW, connector), { ok: true });
    assert.deepEqual(execNeeds(homes.john, readConfig(homes.john), NOW), []);
    await publish({ expires: iso(60_000) });
    assert.equal(readExec(homes.john, "zhang", "ch-1").records.at(-1).kind, "paper", "back on 纸面, no ask");
    writeRisk(homes.john, "zhang", "ch-1", riskOf({ ...readRisk(homes.john, "zhang", "ch-1"), stage: "small", muted: false }));
    await publish({ expires: iso(120_000) });
    assert.equal(readExec(homes.john, "zhang", "ch-1").asks.length, 1);
    await runExec(homes.john, iso(200_000), tools);
    assert.deepEqual([readExec(homes.john, "zhang", "ch-1").asks.length, readExec(homes.john, "zhang", "ch-1").records.at(-1).note], [0, "过期没定"]);
  } finally {
    await s.close();
  }
});

test("限额内自动 (§10.5): an order within the file goes through the connector on its own; any error drops the channel to 纸面 with a 卡住, and the next signal in the same run is only recorded; the stop-loss by losses in a row does the same", async () => {
  const { s, homes, orders, publish, tools } = await world();
  try {
    writeRisk(homes.john, "zhang", "ch-1", riskOf({ stage: "auto", stageSince: iso(-40 * 86_400_000), markets: [MARKET], perOrder: 5, perDay: 20, maxPositions: 3, cooldownMinutes: 0, connector: "node order.mjs" }));
    await publish();
    assert.deepEqual(readExec(homes.john, "zhang", "ch-1").records.map((x) => [x.kind, x.note]), [["ordered", "单 ord-1 · 0.6 × 5"]]);
    assert.equal(orders.length, 1);
    writeRisk(homes.john, "zhang", "ch-1", riskOf({ ...readRisk(homes.john, "zhang", "ch-1"), connector: "fail" }));
    publishSignal(homes.zhang, "alpha", SIGNAL, NOW);
    await publish();
    const state = readExec(homes.john, "zhang", "ch-1");
    assert.deepEqual(state.records.slice(1).map((x) => [x.signal, x.kind, x.note]), [["signal-2", "failed", "connector exited 1: no creds"], ["", "stopped", "下单失败：connector exited 1: no creds"], ["signal-3", "paper", "若跟：0.6 进，2%"]]);
    assert.deepEqual([readRisk(homes.john, "zhang", "ch-1").stage, state.stuck.why], ["paper", "下单失败：connector exited 1: no creds"]);
    assert.equal(threadView(homes.john, "zhang", "ch-1", 50, NOW).messages[1].signal[3], "下单失败 · connector exited 1: no creds");
    // the stop-loss
    writeRisk(homes.john, "zhang", "ch-1", riskOf({ ...readRisk(homes.john, "zhang", "ch-1"), stage: "small", stageSince: NOW, stop: { drawdown: 0, losses: 2 } }));
    writeExec(homes.john, "zhang", "ch-1", { records: [1, 2].map((i) => ({ signal: `old-${i}`, at: iso(-i * 3_600_000), kind: "followed", note: "", market: MARKET, side: "yes", entry: 0.6, amount: 5, expires: iso(-60_000), outcome: "loss" })), asks: [], objections: {} });
    await runExec(homes.john, NOW, tools);
    assert.deepEqual([readRisk(homes.john, "zhang", "ch-1").stage, readExec(homes.john, "zhang", "ch-1").stuck.why], ["paper", "连亏 2 次"]);
  } finally {
    await s.close();
  }
});

test("the agent reads the thesis when the owner lets it (§10.5): the line into the owner's DM with the agent when that DM is mirrored; its objection skips the signal and shows on a pending ask; the connector as a command: the order on stdin and in the environment, the id on stdout, a non-zero exit the error", async () => {
  const { s, john, homes, daemons, publish } = await world();
  try {
    s.relay.createVenue(john.record, { id: "dm-xiaoping", kind: "dm", name: "xiaoping", agents: ["agent:xiaoping@john"] });
    writeRisk(homes.john, "zhang", "ch-1", riskOf({ stage: "small", stageSince: iso(-20 * 86_400_000), markets: [MARKET], perOrder: 5, perDay: 20, maxPositions: 3, cooldownMinutes: 0, agentReads: true, connector: "x" }));
    await daemons.john.syncOnce();
    await publish();
    const out = listOutbox(homes.john);
    assert.deepEqual([out.length, out[0].kind, out[0].as, out[0].doc, out[0].body.text], [1, "message", "person", "venues/dm-xiaoping.geml", `读一下信号 signal-1 的论点 ${SIGNAL.thesis}：要是反对，用 im_signal skip 说一句理由；不反对就不用回。`]);
    assert.match(execNeeds(homes.john, readConfig(homes.john), NOW)[0].text, /agent：读了论点，没反对$/);
    assert.deepEqual(objectToSignal(homes.john, "signal-1", "数据过时", NOW), { ok: true, channel: "zhang/ch-1" });
    assert.match(execNeeds(homes.john, readConfig(homes.john), NOW)[0].text, /agent：反对：数据过时$/);
    assert.deepEqual(objectToSignal(homes.john, "signal-9", "x", NOW), { ok: false, reason: "没有这条信号：signal-9" });
    await publish();
    assert.equal(readExec(homes.john, "zhang", "ch-1").asks.length, 2, "the next signal asks again; the objection was to one signal");
    const order = { signal: "signal-1", market: MARKET, side: "yes", price: 0.6, amount: 5, channel: "zhang/ch-1" };
    assert.deepEqual(await commandConnector("node -e \"let s='';process.stdin.on('data',(c)=>{s+=c}).on('end',()=>{const o=JSON.parse(s);process.stdout.write('ord-'+o.signal+'-'+process.env.ORDER_AMOUNT)})\"", order), { ok: true, id: "ord-signal-1-5" });
    const failed = await commandConnector("node -e \"process.stderr.write('no creds');process.exit(3)\"", order);
    assert.deepEqual(failed, { ok: false, error: "connector exited 3: no creds" });
  } finally {
    await s.close();
  }
});
