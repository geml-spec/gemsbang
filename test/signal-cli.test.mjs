import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUNDLE } from "./helpers/repo.mjs";
import { startRelay } from "../dist/relay/server.js";
import { writeConfig } from "../dist/daemon/home.js";

const tmp = (p) => mkdtempSync(join(tmpdir(), p));
const run = (args, env = {}) => new Promise((done) => {
  const child = spawn(process.execPath, [BUNDLE, ...args], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let out = "", err = "";
  child.stdout.on("data", (c) => { out += c; });
  child.stderr.on("data", (c) => { err += c; });
  const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
  child.on("exit", (code) => { clearTimeout(timer); done({ code: code ?? 1, out, err }); });
});
const MARKET = "polymarket:will-x-happen-by-dec";
const EXPIRES = new Date(Date.now() + 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z");

test("gemworks connect channel|signal|risk and relay price (plan L): a channel made, listed and subscribed with the disclaimer; a signal sealed on the host's chain and pushed, listed with the four numbers, retracted; a price set on the relay; the risk file written and shown, an upgrade refused without its evidence; the usage errors", async () => {
  const root = tmp("gemworks-relay-");
  const s = await startRelay({ root, name: "relay.test" });
  const homes = { zhang: tmp("gemworks-im-"), john: tmp("gemworks-im-") };
  try {
    const zhang = s.relay.issuePerson("zhang"), john = s.relay.issuePerson("john");
    const alpha = s.relay.issueAgent(zhang.record, "alpha"), xiaoping = s.relay.issueAgent(john.record, "xiaoping");
    s.relay.topUp("john", 100);
    writeConfig(homes.zhang, { relay: { url: s.url, name: "relay.test" }, person: "zhang", token: zhang.token, agents: { alpha: alpha.token } });
    writeConfig(homes.john, { relay: { url: s.url, name: "relay.test" }, person: "john", token: john.token, agents: { xiaoping: xiaoping.token } });
    const Z = ["--home", homes.zhang], J = ["--home", homes.john];
    const made = await run(["connect", "channel", "new", "ch-1", "--name", "alpha 的信号", "--agent", "alpha", "--month", "30", "--signal", "2", ...Z]);
    assert.deepEqual([made.code, made.out], [0, "zhang/ch-1 · 按月 30 · 按条 2\n"], made.err);
    assert.equal((await run(["connect", "channel", "new", "ch-2", "--name", "x", ...Z])).code, 2, "--agent is required");
    const listed = await run(["connect", "channel", "list", ...J]);
    assert.deepEqual([listed.code, listed.out], [0, "zhang/ch-1 · alpha 的信号 · alpha · 按月 30 · 按条 2 · 0 订阅 · 命中 0/0 · 90 天收益 0% · 最大回撤 0% · 已撤回 0（仍计入）\n"], listed.err);
    const sub = await run(["connect", "channel", "subscribe", "zhang/ch-1", "--month", ...J]);
    assert.equal(sub.code, 0, sub.err);
    assert.match(sub.out, /^免责条款：[\s\S]*\n已订阅「alpha 的信号」· 到 20\d\d-\d\d-\d\dT/);
    assert.equal((await run(["connect", "channel", "subscribe", "zhang/ch-1", ...J])).code, 2, "--month or --signals");
    assert.equal(s.relay.balance("john"), 90);
    const published = await run(["connect", "signal", "publish", "--as", "alpha", "--channel", "zhang/ch-1", "--market", MARKET, "--side", "yes", "--cap", "0.63", "--expires", EXPIRES, "--confidence", "0.7", "--thesis", "https://relay.test/zhang/venues/ch-1.geml#why", ...Z]);
    assert.equal(published.code, 0, published.err);
    assert.match(published.out, /^信号 s-\S+ 已封在本机链上 · 已推送 1 条\n$/);
    const onRelay = s.relay.signalsOf("zhang", "alpha");
    assert.deepEqual([onRelay.length, onRelay[0].market, onRelay[0].side, onRelay[0].priceCap, onRelay[0].confidence, typeof onRelay[0].hostHash, onRelay[0].thesis], [1, MARKET, "yes", 0.63, 0.7, "string", "https://relay.test/zhang/venues/ch-1.geml#why"]);
    assert.equal((await run(["connect", "signal", "publish", "--as", "alpha", "--channel", "zhang/ch-1", "--market", MARKET, "--side", "up", "--cap", "0.63", "--expires", EXPIRES, "--confidence", "0.7", ...Z])).code, 1, "a fault");
    assert.equal((await run(["connect", "signal", "publish", "--channel", "zhang/ch-1", ...Z])).code, 2, "--as and the fields");
    const price = await run(["relay", "price", MARKET, "0.6", "--at", "2026-10-31T08:00:00Z", "--root", root]);
    assert.deepEqual([price.code, price.out], [0, `${MARKET} 0.6 @ 2026-10-31T08:00:00Z\n`], price.err);
    assert.equal((await run(["relay", "price", MARKET, "x", "--root", root])).code, 2);
    const list = await run(["connect", "signal", "list", "alpha@zhang", ...J]);
    assert.equal(list.code, 0, list.err);
    assert.match(list.out, /^命中 0\/0 · 90 天收益 0% · 最大回撤 0% · 已撤回 0（仍计入）\n信号 signal-1 · polymarket:will-x-happen-by-dec · 买是 · 价 ≤0.63 · 过期 \d\d:\d\d\n$/);
    assert.equal((await run(["connect", "signal", "list", "alpha", ...J])).code, 2, "agent@owner");
    const retracted = await run(["connect", "signal", "retract", "signal-1", "--as", "alpha", ...Z]);
    assert.deepEqual([retracted.code, retracted.out], [0, "撤回 signal-1 · 已推送 1 条\n"], retracted.err);
    assert.equal(s.relay.signalsOf("zhang", "alpha")[0].retracted !== undefined, true);
    // the risk file
    assert.equal((await run(["connect", "risk", "zhang/ch-1", "--stage", "small", ...J])).code, 1, "no evidence yet");
    const risk = await run(["connect", "risk", "zhang/ch-1", "--markets", `${MARKET},other`, "--per-order", "5", "--per-day", "20", "--max-positions", "3", "--min-confidence", "0.5", "--stop-losses", "2", "--connector", "node order.mjs", "--agent-reads", ...J]);
    assert.equal(risk.code, 0, risk.err);
    assert.match(risk.out, /^阶段：纸面 · 第 1 天 · 命中 —\n升级：还要 14 天，且命中 ≥ 60%（现在没有结算的信号），主人批准\n$/);
    assert.equal((await run(["connect", "risk", "zhang/ch-1", "--stage", "big", ...J])).code, 2);
    assert.equal((await run(["connect", "risk", ...J])).code, 2);
    const once = await run(["connect", "--once", ...J]);
    assert.equal(once.code, 0, once.err);
    const shown = await run(["connect", "risk", "zhang/ch-1", "show", ...J]);
    assert.equal(shown.code, 0, shown.err);
    assert.match(shown.out, /^阶段：纸面 · 第 1 天 · 命中 —\n升级：[^\n]+\n市场：polymarket:will-x-happen-by-dec、other · 单笔 5 · 当日 20 · 最多 3 仓 · 滑点 2% · 冷却 60 分钟 · 信心 ≥ 0.5 · 止损 回撤 10% \/ 连亏 2 · agent 读论点 · connector node order.mjs\n\d\d:\d\d signal-1 跳过 · 已撤回\n$/);
    assert.equal((await run(["connect", "risk", "zhang/ch-1", "--stage", "paper", ...J])).code, 0, "down or same is always allowed");
    const usage = (await run([])).err;
    for (const w of ["connect channel", "connect signal", "connect risk", "relay price"]) assert.match(usage, new RegExp(w));
  } finally {
    await s.close();
  }
});
