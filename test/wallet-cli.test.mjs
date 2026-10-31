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
/** The bundle run asynchronously: the relay serving the child lives in this process, whose loop a spawnSync would hold. */
const run = (args, env = {}) => new Promise((done) => {
  const child = spawn(process.execPath, [BUNDLE, ...args], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let out = "", err = "";
  child.stdout.on("data", (c) => { out += c; });
  child.stderr.on("data", (c) => { err += c; });
  const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
  child.on("exit", (code) => { clearTimeout(timer); done({ code: code ?? 1, out, err }); });
});

test("gemworks relay topup and connect wallet (§9.1): the operator credits a wallet; a person sees it, sets the caps, tips, records a favour, sends a gift another claims, sends a red packet a member draws; the usage errors and the relay's refusals", async () => {
  const s = await startRelay({ root: tmp("gemworks-relay-"), name: "relay.test" });
  const homes = { john: tmp("gemworks-im-"), wangwu: tmp("gemworks-im-"), nobody: tmp("gemworks-im-") };
  try {
    const john = s.relay.issuePerson("john"), wangwu = s.relay.issuePerson("wangwu");
    const xiaoping = s.relay.issueAgent(john.record, "xiaoping");
    s.relay.createVenue(john.record, { id: "g-7", kind: "group", name: "前端周会", people: ["wangwu"], agents: ["agent:xiaoping@john"] });
    writeConfig(homes.john, { relay: { url: s.url, name: "relay.test" }, person: "john", token: john.token, agents: { xiaoping: xiaoping.token } });
    writeConfig(homes.wangwu, { relay: { url: s.url, name: "relay.test" }, person: "wangwu", token: wangwu.token, agents: {} });
    const J = ["--home", homes.john], W = ["--home", homes.wangwu];
    const topped = await run(["relay", "topup", "john", "80", "--note", "充了 80", "--root", s.relay.root]);
    assert.deepEqual([topped.code, topped.out], [0, "john 100\n"], topped.err);
    assert.equal((await run(["relay", "topup", "john", "x", "--root", s.relay.root])).code, 2);
    assert.equal((await run(["relay", "topup", "nobody", "5", "--root", s.relay.root])).code, 1);
    assert.equal((await run(["connect", "wallet", "--home", homes.nobody])).code, 1, "no connect.json");
    assert.equal((await run(["connect", "wallet", "nope", ...J])).code, 2);
    const shown = await run(["connect", "wallet", ...J]);
    assert.equal(shown.code, 0, shown.err);
    assert.deepEqual(shown.out.split("\n").slice(0, 5), ["钱包 100 积分", "xiaoping 每天 30", "每张卡 40", "访客问答每天 10", "自动买东西 5 · 超过要问我"]);
    assert.match(shown.out, /充值 · 平台 给 john · 充了 80 \| \+80\n/);
    const caps = await run(["connect", "wallet", "caps", "--per-card", "60", "--auto-buy", "0", ...J]);
    assert.deepEqual([caps.code, caps.out], [0, "每天 30 · 每张卡 60 · 访客问答每天 10 · 自动买东西 0\n"], caps.err);
    assert.equal((await run(["connect", "wallet", "caps", "--per-card", "x", ...J])).code, 2);
    const tipped = await run(["connect", "wallet", "tip", "xiaoping@john", "5", "--note", "那个缓存修得漂亮", ...W]);
    assert.deepEqual([tipped.code, tipped.out], [0, "打赏 5 给 xiaoping@john · 钱包 15\n"], tipped.err);
    assert.equal(s.relay.balance("john"), 105);
    assert.equal((await run(["connect", "wallet", "tip", "john", "999", ...W])).code, 1, "the relay's refusal");
    assert.equal((await run(["connect", "wallet", "tip", "john", ...W])).code, 2, "the credits are required");
    const favor = await run(["connect", "wallet", "favor", "john", "--note", "帮跑了一次，约 30 万 token", ...W]);
    assert.deepEqual([favor.code, favor.out], [0, "记了人情 · john 给 wangwu · 帮跑了一次，约 30 万 token\n"], favor.err);
    assert.equal((await run(["connect", "wallet", "favor", "john", ...W])).code, 2, "the line is required");
    const gift = await run(["connect", "wallet", "gift", "15", "--note", "拿去买个 skill", ...J]);
    assert.equal(gift.code, 0, gift.err);
    const url = /^(http:\/\/127\.0\.0\.1:\d+\/g\/(g-[0-9a-f]{8})) · 钱包 90\n$/.exec(gift.out);
    assert.ok(url, gift.out);
    const claimed = await run(["connect", "wallet", "claim", url[2], ...W]);
    assert.deepEqual([claimed.code, claimed.out], [0, "领了 15 · 钱包 30\n"], claimed.err);
    assert.equal((await run(["connect", "wallet", "claim", url[2], ...W])).code, 1, "once");
    const direct = await run(["connect", "wallet", "gift", "10", "--to", "wangwu", ...J]);
    assert.deepEqual([direct.code, direct.out], [0, "送了 10 给 wangwu · 钱包 80\n"], direct.err);
    const packet = await run(["connect", "wallet", "packet", "john/g-7", "9", "3", "--note", "发奖金啦", ...J]);
    assert.equal(packet.code, 0, packet.err);
    const pm = /^红包 (r-[0-9a-f]{8}) · 9 积分 · 3 份 · 钱包 71\n$/.exec(packet.out);
    assert.ok(pm, packet.out);
    const drew = await run(["connect", "wallet", "claim", pm[1], ...W]);
    assert.deepEqual([drew.code, drew.out], [0, "领了 3 · 还剩 2 份 · 钱包 43\n"], drew.err);
    assert.equal((await run(["connect", "wallet", "claim", "x-1", ...W])).code, 2, "a gift is g-…, a packet r-…");
    assert.equal((await run(["connect", "wallet", "packet", "john/g-7", "9", ...J])).code, 2);
    assert.match((await run([])).err, /connect wallet/);
    assert.match((await run([])).err, /relay topup/);
  } finally {
    await s.close();
  }
});
