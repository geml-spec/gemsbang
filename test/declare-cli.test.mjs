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
const CHILD = JSON.stringify({ title: "导出的后端", goal: "后端", context: { includes: [], excludes: [] }, accepts: [{ text: "人点收", verify: { kind: "human" } }], direction: "outsource", venueOfWork: "worker-sandbox", budget: { credits: 10 } });

test("gemworks connect declare, profile, card edit|split|tree (plan K): the declaration written and read on the page; a draft edited; a card split and its tree printed; the usage errors", async () => {
  const s = await startRelay({ root: tmp("gemworks-relay-"), name: "relay.test" });
  const homes = { john: tmp("gemworks-im-"), wangwu: tmp("gemworks-im-") };
  try {
    const john = s.relay.issuePerson("john"), wangwu = s.relay.issuePerson("wangwu");
    const xiaoping = s.relay.issueAgent(john.record, "xiaoping"), xiaoce = s.relay.issueAgent(wangwu.record, "xiaoce");
    s.relay.createVenue(john.record, { id: "g-7", kind: "group", name: "前端周会", people: ["wangwu"], agents: ["agent:xiaoping@john", "agent:xiaoce@wangwu"] });
    s.relay.setPresence(xiaoce.record, { session: "cx-1", host: "claude-code", login: "api", presence: "idle" });
    s.relay.topUp("john", 100);
    writeConfig(homes.john, { relay: { url: s.url, name: "relay.test" }, person: "john", token: john.token, agents: { xiaoping: xiaoping.token } });
    writeConfig(homes.wangwu, { relay: { url: s.url, name: "relay.test" }, person: "wangwu", token: wangwu.token, agents: { xiaoce: xiaoce.token } });
    const J = ["--home", homes.john], W = ["--home", homes.wangwu];
    const declared = await run(["connect", "declare", "xiaoce", "--open", "--hours", "22:00-08:00+08:00", "--budget", "200000", "--kinds", "评审,测试", "--skills", "pdf", "--network", ...W]);
    assert.deepEqual([declared.code, declared.out], [0, "资格：API 会话 · 有资格\n时段：每天 22:00 到 08:00 · 主人睡了之后\n预算：每天 200000 token · 推理走平台池\n接什么：评审、测试 · skill pdf · 可联网\n"], declared.err);
    assert.equal((await run(["connect", "declare", "xiaoce", "--hours", "night", ...W])).code, 1);
    assert.equal((await run(["connect", "declare", ...W])).code, 2);
    const always = await run(["connect", "declare", "xiaoce", "--no-hours", ...W]);
    assert.equal(always.out.split("\n")[1], "时段：随时", always.err);
    const profile = await run(["connect", "profile", "xiaoce@wangwu", ...J]);
    assert.equal(profile.code, 0, profile.err);
    assert.deepEqual(profile.out.split("\n").slice(0, 2), ["xiaoce · 代 wangwu · 空闲 · 只潜水", "已接受 0 · 评价 0 · 争议 0 · 可以请它评"]);
    assert.equal((await run(["connect", "profile", "xiaoce", ...J])).code, 2, "name@owner");
    assert.equal((await run(["connect", "profile", "nobody@wangwu", ...J])).code, 1);
    const made = await run(["connect", "card", "new", "--title", "给设置页加导出 PDF", "--goal", "一个按钮", "--direction", "outsource", "--where", "worker-sandbox", "--accept", "人勾||人点收", "--credits", "40", ...J]);
    assert.equal(made.code, 0, made.err);
    const id = /^john\/(t-[0-9a-f]{4}) /.exec(made.out)[1];
    const edited = await run(["connect", "card", "edit", `john/${id}`, "--goal", "右上角一个按钮", "--credits", "30", ...J]);
    assert.deepEqual([edited.code, edited.out], [0, `#${id} 草拟\n`], edited.err);
    assert.deepEqual([s.relay.taskOf("john", id).goal, s.relay.taskOf("john", id).budget], ["右上角一个按钮", { credits: 30 }]);
    assert.equal((await run(["connect", "card", "edit", `john/${id}`, ...J])).code, 2, "nothing to change");
    assert.equal((await run(["connect", "card", "publish", `john/${id}`, "--venue", "john/g-7", ...J])).code, 0);
    assert.equal((await run(["connect", "card", "claim", `john/${id}`, "--agent", "xiaoce", ...W])).code, 0);
    const split = await run(["connect", "card", "split", `john/${id}`, "--child", CHILD, "--child", CHILD.replace("导出的后端", "按钮"), ...W]);
    assert.equal(split.code, 0, split.err);
    assert.match(split.out, /^#t-[0-9a-f]{4} 进行中 · 等 xiaoce\nwangwu\/t-[0-9a-f]{4}\nwangwu\/t-[0-9a-f]{4}\n$/);
    assert.equal((await run(["connect", "card", "split", `john/${id}`, "--child", "{nope", ...W])).code, 2);
    assert.equal((await run(["connect", "card", "split", `john/${id}`, ...W])).code, 2);
    const tree = await run(["connect", "card", "tree", `john/${id}`, ...J]);
    assert.equal(tree.code, 0, tree.err);
    assert.match(tree.out, /^#t-[0-9a-f]{4} 给设置页加导出 PDF · 进行中\n  #t-[0-9a-f]{4} 导出的后端 · 草拟\n  #t-[0-9a-f]{4} 按钮 · 草拟\n$/);
    const usage = (await run([])).err;
    for (const w of ["connect declare", "connect profile", "edit, split, tree"]) assert.match(usage, new RegExp(w));
  } finally {
    await s.close();
  }
});
