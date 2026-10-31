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
const DELIVERABLE = { kind: "code", sha256: "7f3a", parts: [{ type: "repo", url: "u", branch: "deliver/t-42", commit: "a1b2c3" }], usage: "npm run build", evidence: [], accepts: [{ criterion: 1, met: true }, { criterion: 2, met: true }, { criterion: 3, met: null }], rights: { owner: "委托方", aiGenerated: true } };

test("gemworks connect card: a card drafted, published, claimed, noted, delivered, reported and accepted from two homes; list and show; the usage errors and the relay's refusal", async () => {
  const s = await startRelay({ root: tmp("gemworks-relay-"), name: "relay.test" });
  const homes = { john: tmp("gemworks-im-"), wangwu: tmp("gemworks-im-"), nobody: tmp("gemworks-im-") };
  try {
    const john = s.relay.issuePerson("john"), wangwu = s.relay.issuePerson("wangwu");
    const xiaoping = s.relay.issueAgent(john.record, "xiaoping"), xiaoce = s.relay.issueAgent(wangwu.record, "xiaoce");
    s.relay.topUp("john", 100);
    s.relay.createVenue(john.record, { id: "g-7", kind: "group", name: "前端周会", people: ["wangwu"], agents: ["agent:xiaoping@john", "agent:xiaoce@wangwu"] });
    s.relay.setPresence(xiaoce.record, { session: "cx-1", host: "claude-code", login: "api", presence: "idle" });
    s.relay.declare(wangwu.record, { agent: "xiaoce", open: true });
    writeConfig(homes.john, { relay: { url: s.url, name: "relay.test" }, person: "john", token: john.token, agents: { xiaoping: xiaoping.token } });
    writeConfig(homes.wangwu, { relay: { url: s.url, name: "relay.test" }, person: "wangwu", token: wangwu.token, agents: { xiaoce: xiaoce.token } });
    const J = ["--home", homes.john], W = ["--home", homes.wangwu];
    assert.equal((await run(["connect", "card", "list", "--home", homes.nobody])).code, 1, "no connect.json");
    assert.equal((await run(["connect", "card", "nope", ...J])).code, 2, "no such verb");
    assert.equal((await run(["connect", "card", "new", "--title", "t", ...J])).code, 2, "the goal, the direction and the place are required");
    assert.equal((await run(["connect", "card", "new", "--title", "t", "--goal", "g", "--direction", "outsource", "--where", "worker-sandbox", "--accept", "x", ...J])).code, 2, "an accept is kind|param|text");
    const made = await run(["connect", "card", "new", "--title", "给设置页加导出 PDF", "--goal", "设置页右上角一个按钮", "--direction", "outsource", "--where", "worker-sandbox", "--accept", "命令|npm test|单元测试通过", "--accept", "文件|out/*.pdf|导出的文件能打开", "--accept", "审读|ui-rubric|按钮位置和样式对", "--exclude", "private", "--tools", "read,edit,test", "--credits", "40", "--hours", "6", "--reward", "escrow:40", ...J]);
    assert.equal(made.code, 0, made.err);
    const m = /^john\/(t-[0-9a-f]{4}) https:\/\/relay\.test\/john\/cards\/t-[0-9a-f]{4}\.geml\n$/.exec(made.out);
    assert.ok(m, made.out);
    const id = m[1];
    assert.equal((await run(["connect", "card", "publish", `john/${id}`, ...J])).code, 2, "a venue is required");
    assert.equal((await run(["connect", "card", "publish", `john/${id}`, "--venue", "john/g-7", ...J])).out, `#${id} 发布\n`);
    assert.equal((await run(["connect", "card", "claim", `john/${id}`, ...W])).code, 1, "the relay wants an agent's name with a person's token");
    assert.equal((await run(["connect", "card", "claim", `john/${id}`, "--agent", "xiaoce", ...W])).out, `#${id} 进行中 · 等 xiaoce\n`);
    assert.equal((await run(["connect", "card", "note", `john/${id}`, "--text", "跑完了", "--evidence", "https://relay.test/wangwu/journals/t-42.geml#rev-3", ...W])).out, `#${id} 进行中 · 等 xiaoce\n`);
    assert.equal((await run(["connect", "card", "deliver", `john/${id}`, "--deliverable", JSON.stringify(DELIVERABLE), ...W])).out, `#${id} 验收中 · 等 john\n`);
    assert.equal((await run(["connect", "card", "report", `john/${id}`, "--result", "1:met:重跑 · 退出 0", "--result", "2:met", "--result", "3:wait", ...J])).out, `#${id} 验收中 · 等 john · 等你验收\n`);
    assert.equal((await run(["connect", "card", "accept", `john/${id}`, ...J])).out, `#${id} 已接受\n`);
    const refused = await run(["connect", "card", "accept", `john/${id}`, ...J]);
    assert.deepEqual([refused.code, refused.err.trim()], [1, "gemworks connect card accept: 卡不能从已接受直接到已接受"]);
    assert.equal((await run(["connect", "card", "list", ...J])).out, `john/${id} · 给设置页加导出 PDF · 已接受 · 委托人\n`);
    assert.equal((await run(["connect", "card", "list", ...W])).out, `john/${id} · 给设置页加导出 PDF · 已接受 · 接单方\n`);
    const shown = await run(["connect", "card", "show", `john/${id}`, ...J]);
    assert.equal(shown.out.split("\n")[0], `#${id} 给设置页加导出 PDF · 外包 · 草拟 · 发布 · 待放行 · 进行中 · 已交付 · 验收中 · [已接受]`);
    assert.ok(shown.out.includes("去办：设置页右上角一个按钮\n验收：1 单元测试通过 · 命令 · npm test；2 导出的文件能打开 · 文件 · out/*.pdf；3 按钮位置和样式对 · 审读 · ui-rubric\n"), shown.out);
    assert.match((await run([])).err, /connect card/, "the usage names it");
  } finally {
    await s.close();
  }
});
