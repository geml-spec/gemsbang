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

test("gemworks connect share: a card on the relay from the daemon's token, its page's address printed; the required flags, a bad replay, no connect.json, the relay's refusal", async () => {
  const s = await startRelay({ root: tmp("gemworks-relay-"), name: "relay.test" });
  const home = tmp("gemworks-im-");
  try {
    const john = s.relay.issuePerson("john");
    s.relay.issueAgent(john.record, "xiaoping");
    assert.equal((await run(["connect", "share", "--title", "t", "--agent", "xiaoping", "--scope", "s", "--home", home])).code, 1, "no connect.json");
    writeConfig(home, { relay: { url: s.url, name: "relay.test" }, person: "john", token: john.token, agents: {} });
    assert.equal((await run(["connect", "share", "--title", "t", "--home", home])).code, 2, "agent and scope required");
    assert.equal((await run(["connect", "share", "--title", "t", "--agent", "xiaoping", "--scope", "s", "--replay", "x", "--home", home])).code, 2, "a replay is <turn>:<label>");
    const r = await run(["connect", "share", "--title", "设置页导出 PDF", "--agent", "xiaoping", "--scope", "src/settings/*", "--summary", "一句话", "--drafted", "--turns", "63", "--repo", "deliver/t-42", "--commit", "a1b2c3", "--license", "MIT", "--evidence", "npm test 退出 0", "--evidence", "out/*.pdf 存在", "--replay", "1:读代码", "--replay", "63:交付", "--home", home]);
    assert.equal(r.code, 0, r.err);
    const m = /^(http:\/\/127\.0\.0\.1:\d+)\/c\/(c-[0-9a-f]{4})\n$/.exec(r.out);
    assert.ok(m, r.out);
    const cards = s.relay.sharesOf("john");
    assert.equal(cards.length, 1);
    assert.deepEqual([cards[0].id, cards[0].title, cards[0].summary, cards[0].summarySource, cards[0].turns, cards[0].evidence, cards[0].replay, cards[0].use], [m[2], "设置页导出 PDF", "一句话", "drafted", 63, ["npm test 退出 0", "out/*.pdf 存在"], [{ turn: 1, label: "读代码" }, { turn: 63, label: "交付" }], { repo: "deliver/t-42", commit: "a1b2c3", license: "MIT", ai: "AI 生成，人审过" }]);
    const refused = await run(["connect", "share", "--title", "t", "--agent", "nobody", "--scope", "s", "--home", home]);
    assert.deepEqual([refused.code, refused.err.trim()], [1, "gemworks connect share: 没有这个 agent：nobody"]);
    assert.match((await run([])).err, /connect share/, "the usage names it");
  } finally {
    await s.close();
  }
});
