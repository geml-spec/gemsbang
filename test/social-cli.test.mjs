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

test("gemworks connect room, mode, digest, match (§11, §7.4): a room made, listed and joined with an agent; the agent's mode; a digest drafted as the agent and the published ones listed; 牵线 proposed and the suggestions; the usage errors", async () => {
  const s = await startRelay({ root: tmp("gemworks-relay-"), name: "relay.test" });
  const homes = { john: tmp("gemworks-im-"), wangwu: tmp("gemworks-im-"), nobody: tmp("gemworks-im-") };
  try {
    const john = s.relay.issuePerson("john"), wangwu = s.relay.issuePerson("wangwu");
    const xiaoping = s.relay.issueAgent(john.record, "xiaoping"), xiaoce = s.relay.issueAgent(wangwu.record, "xiaoce");
    writeConfig(homes.john, { relay: { url: s.url, name: "relay.test" }, person: "john", token: john.token, agents: { xiaoping: xiaoping.token } });
    writeConfig(homes.wangwu, { relay: { url: s.url, name: "relay.test" }, person: "wangwu", token: wangwu.token, agents: { xiaoce: xiaoce.token } });
    const J = ["--home", homes.john], W = ["--home", homes.wangwu];
    assert.equal((await run(["connect", "room", "list", "--home", homes.nobody])).code, 1, "no connect.json");
    assert.equal((await run(["connect", "room", "nope", ...J])).code, 2);
    const made = await run(["connect", "room", "new", "r-1", "--name", "前端茶水间", ...J]);
    assert.deepEqual([made.code, made.out], [0, "房间 john/r-1\n"], made.err);
    const listed = await run(["connect", "room", "list", ...W]);
    assert.deepEqual([listed.code, listed.out], [0, "john/r-1 · 前端茶水间 · 1 人 · 0 个 agent\n"], listed.err);
    const joined = await run(["connect", "room", "join", "john/r-1", "--agent", "xiaoce", ...W]);
    assert.deepEqual([joined.code, joined.out], [0, "进了房间「前端茶水间」 · xiaoce 跟着\n"], joined.err);
    assert.equal((await run(["connect", "room", "join", "r-1", ...W])).code, 2, "owner/id");
    assert.equal((await run(["connect", "room", "join", "john/r-1", "--agent", "xiaoping", ...W])).code, 1, "not his agent");
    const mode = await run(["connect", "mode", "xiaoce", "chat", ...W]);
    assert.deepEqual([mode.code, mode.out], [0, "xiaoce 可以搭话\n"], mode.err);
    assert.equal((await run(["connect", "mode", "xiaoce", "loud", ...W])).code, 1);
    assert.equal((await run(["connect", "mode", "xiaoce", ...W])).code, 2);
    assert.equal(s.relay.socialModeOf("wangwu", "xiaoce"), "chat");
    const drafted = await run(["connect", "digest", "--as", "xiaoping", "--text", "今天修好了缓存", ...J]);
    assert.deepEqual([drafted.code, drafted.out], [0, "draft-1 · 等 john 定\n"], drafted.err);
    assert.equal((await run(["connect", "digest", "--as", "nobody", "--text", "x", ...J])).code, 1, "no such agent token");
    assert.equal((await run(["connect", "digest", "--text", "x", ...J])).code, 2);
    assert.equal(s.relay.answerDigest(john.record, { draft: "draft-1", publish: true }).ok, true);
    const digests = await run(["connect", "digest", "list", "john", ...W]);
    assert.equal(digests.code, 0, digests.err);
    assert.match(digests.out, /^\d{4}-\d\d-\d\d xiaoping：今天修好了缓存\n$/);
    assert.equal((await run(["connect", "digest", "list", ...J])).out, digests.out, "mine by default");
    const proposed = await run(["connect", "match", "wangwu", "--note", "都在做 PDF", ...J]);
    assert.equal(proposed.code, 0, proposed.err);
    assert.match(proposed.out, /^m-[0-9a-f]{8} · 等 wangwu 点头\n$/);
    assert.deepEqual(s.relay.inbox("wangwu").map((n) => n.text), ["牵线：john 想和你互相亮名片：都在做 PDF"]);
    const byAgent = await run(["connect", "match", "john", "--as", "xiaoce", ...W]);
    assert.match(byAgent.out, /^m-[0-9a-f]{8} · 等 john 点头，也等你\n$/, byAgent.err);
    assert.equal((await run(["connect", "match", ...J])).code, 2);
    const suggest = await run(["connect", "match", "suggest", ...J]);
    assert.deepEqual([suggest.code, suggest.out], [0, "没有公开作品相近的人\n"], suggest.err);
    const usage = (await run([])).err;
    for (const w of ["connect room", "connect mode", "connect digest", "connect match"]) assert.match(usage, new RegExp(w));
  } finally {
    await s.close();
  }
});
