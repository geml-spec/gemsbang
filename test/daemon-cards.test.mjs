import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cardCall, CARD_ACTIONS } from "../dist/daemon/cards.js";
import { nextPrompt } from "../dist/daemon/deliver.js";
import { roomDir, writeConfig } from "../dist/daemon/home.js";
import { Daemon } from "../dist/daemon/sync.js";
import { startRelay } from "../dist/relay/server.js";

const tmp = (p) => mkdtempSync(join(tmpdir(), p));
const NOW = "2026-10-31T09:30:00Z";
const INPUT = { title: "给设置页加导出 PDF", goal: "设置页右上角一个按钮，把当前配置导出成 PDF", context: { includes: [], excludes: ["private"] }, accepts: [{ text: "单元测试通过", verify: { kind: "command", run: "npm test" } }, { text: "按钮位置和样式对", verify: { kind: "review", rubric: "ui-rubric" } }], direction: "outsource", venueOfWork: "worker-sandbox", tools: ["read", "edit", "test"], budget: { credits: 40 }, reward: { kind: "escrow", credits: 40 } };
const DELIVERABLE = { kind: "code", sha256: "7f3a", parts: [{ type: "repo", url: "u", branch: "deliver/t-42", commit: "a1b2c3" }], usage: "npm run build", evidence: [], accepts: [{ criterion: 1, met: true }, { criterion: 2, met: null }], rights: { owner: "委托方", aiGenerated: true } };

async function world() {
  const s = await startRelay({ root: tmp("gemworks-relay-"), name: "relay.test" });
  const john = s.relay.issuePerson("john"), wangwu = s.relay.issuePerson("wangwu");
  const xiaoping = s.relay.issueAgent(john.record, "xiaoping"), xiaoce = s.relay.issueAgent(wangwu.record, "xiaoce");
  s.relay.createVenue(john.record, { id: "g-7", kind: "group", name: "前端周会", people: ["wangwu"], agents: ["agent:xiaoping@john", "agent:xiaoce@wangwu"] });
  s.relay.setPresence(xiaoce.record, { session: "cx-1", host: "claude-code", login: "api", presence: "idle" });
  const homes = { john: tmp("gemworks-im-"), wangwu: tmp("gemworks-im-") };
  writeConfig(homes.john, { relay: { url: s.url, name: "relay.test" }, person: "john", token: john.token, agents: { xiaoping: xiaoping.token } });
  writeConfig(homes.wangwu, { relay: { url: s.url, name: "relay.test" }, person: "wangwu", token: wangwu.token, agents: { xiaoce: xiaoce.token } });
  return { s, homes };
}

test("cardCall: every verb through the relay with the person's or an agent's token, one line back; the refusals are reasons, not throws; the room is made when the worker's item is delivered", async () => {
  const { s, homes } = await world();
  try {
    assert.deepEqual(CARD_ACTIONS, ["new", "publish", "claim", "grant", "note", "giveback", "deliver", "report", "accept", "changes", "resume", "dispute", "settle", "close", "show", "list"]);
    assert.deepEqual(await cardCall(tmp("gemworks-im-"), { action: "list" }), { ok: false, reason: "没有 connect.json：先 gemworks connect setup" });
    assert.deepEqual(await cardCall(homes.john, { action: "show" }), { ok: false, reason: "要卡的 owner/id" });
    assert.deepEqual(await cardCall(homes.john, { action: "show", owner: "john", id: "t-0000" }), { ok: false, reason: "没有这张卡" });
    assert.deepEqual(await cardCall(homes.john, { action: "claim", owner: "john", id: "t-0000", as: "nobody" }), { ok: false, reason: "没有 nobody 的令牌" });
    const made = await cardCall(homes.john, { action: "new", body: INPUT });
    assert.equal(made.ok, true, made.reason);
    const id = made.answer.card.id;
    assert.deepEqual([made.answer.card.state, made.answer.address, made.answer.line], ["draft", `https://relay.test/john/cards/${id}.geml`, "起草 · 给设置页加导出 PDF"]);
    assert.deepEqual((await cardCall(homes.john, { action: "list" })).answer.line, `john/${id} · 给设置页加导出 PDF · 草拟 · 委托人`);
    const bad = await cardCall(homes.john, { action: "new", body: { title: "x" } });
    assert.equal(bad.ok, false);
    assert.match(bad.reason, /^缺目标/);
    const published = await cardCall(homes.john, { action: "publish", owner: "john", id, body: { venue: "john/g-7" } });
    assert.deepEqual([published.answer.before, published.answer.card.state, published.answer.line], ["draft", "open", "草拟 → 发布"]);
    assert.deepEqual((await cardCall(homes.wangwu, { action: "claim", owner: "john", id })).ok, false, "a person's token needs the agent's name; as the agent it is a claim");
    const claimed = await cardCall(homes.wangwu, { action: "claim", owner: "john", id, as: "xiaoce" });
    assert.deepEqual([claimed.ok, claimed.answer.line], [true, "发布 → 进行中 · xiaoce"]);
    assert.equal((await cardCall(homes.wangwu, { action: "note", owner: "john", id, as: "xiaoce", body: { text: "跑完了" } })).answer.line, "记了一笔");
    const daemon = new Daemon({ home: homes.wangwu });
    await daemon.syncOnce();
    const d = nextPrompt(homes.wangwu, "xiaoce", NOW);
    assert.equal(d.room, roomDir(homes.wangwu, id));
    assert.ok(existsSync(join(d.room, "CARD.md")) && existsSync(join(d.room, "context", "1.md")), "the room holds the 委托书 and the context pack");
    assert.match(readFileSync(join(d.room, "CARD.md"), "utf8"), /^# 任务卡 #t-[0-9a-f]{4}「给设置页加导出 PDF」\n\n任务卡 #t-[0-9a-f]{4}「给设置页加导出 PDF」归你了（外包）。\n去办：/);
    assert.match(readFileSync(join(d.room, "context", "1.md"), "utf8"), /^https:\/\/relay\.test\/john\/cards\/t-[0-9a-f]{4}\.geml#card\n\n/);
    assert.ok(d.text.includes(` · 客房：${d.room} · 记录和交付用 im_card]\n`), d.text);
    const delivered = await cardCall(homes.wangwu, { action: "deliver", owner: "john", id, as: "xiaoce", body: DELIVERABLE });
    assert.equal(delivered.answer.line, "进行中 → 验收中 · john");
    const reported = await cardCall(homes.john, { action: "report", owner: "john", id, body: { results: [{ criterion: 1, met: true }, { criterion: 2, met: null }] } });
    assert.deepEqual([reported.answer.decision, reported.answer.line], ["inbox", "验收报告 · 等主人验收"]);
    assert.equal((await cardCall(homes.john, { action: "accept", owner: "john", id })).answer.line, "验收中 → 已接受");
    assert.deepEqual(await cardCall(homes.john, { action: "accept", owner: "john", id }), { ok: false, reason: "卡不能从已接受直接到已接受" });
    const shown = await cardCall(homes.john, { action: "show", owner: "john", id });
    assert.equal(shown.answer.line.split("\n")[0], `#${id} 给设置页加导出 PDF · 外包 · 草拟 · 发布 · 待放行 · 进行中 · 已交付 · 验收中 · [已接受]`);
    assert.ok(shown.answer.line.includes("\n去办：设置页右上角一个按钮，把当前配置导出成 PDF\n"), shown.answer.line);
    await s.close();
    const down = await cardCall(homes.john, { action: "list" });
    assert.equal(down.ok, false);
    assert.match(down.reason, /^连不上中继/);
  } finally {
    await s.close().catch(() => undefined);
  }
});
