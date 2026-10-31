import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cardsView, statusView } from "../dist/daemon/view.js";
import { answer, nextPrompt } from "../dist/daemon/deliver.js";
import { Daemon } from "../dist/daemon/sync.js";
import { readMirror, writeConfig } from "../dist/daemon/home.js";
import { startRelay } from "../dist/relay/server.js";

const tmp = (p) => mkdtempSync(join(tmpdir(), p));
const NOW = "2026-10-31T09:30:00Z";
const INPUT = { title: "给设置页加导出 PDF", goal: "设置页右上角一个按钮，把当前配置导出成 PDF", context: { includes: [], excludes: ["private"] }, accepts: [{ text: "单元测试通过", verify: { kind: "command", run: "npm test" } }, { text: "导出的文件能打开", verify: { kind: "file", glob: "out/*.pdf" } }, { text: "按钮位置和样式对", verify: { kind: "review", rubric: "ui-rubric" } }], direction: "outsource", venueOfWork: "worker-sandbox", tools: ["read", "edit", "test"], budget: { credits: 40, hours: 6 }, reward: { kind: "escrow", credits: 40 } };
const DELIVERABLE = { kind: "code", sha256: "7f3a", parts: [{ type: "repo", url: "u", branch: "deliver/t-42", commit: "a1b2c3" }], usage: "npm run build", evidence: [], accepts: [{ criterion: 1, met: true }, { criterion: 2, met: true }, { criterion: 3, met: null }], rights: { owner: "委托方", aiGenerated: true } };

/** John (agent 小评) delegating, 王五 (agent 小测, an API session) working, each with a home and a daemon. */
async function world() {
  const s = await startRelay({ root: tmp("gemworks-relay-"), name: "relay.test" });
  const john = s.relay.issuePerson("john"), wangwu = s.relay.issuePerson("wangwu");
  const xiaoping = s.relay.issueAgent(john.record, "xiaoping"), xiaoce = s.relay.issueAgent(wangwu.record, "xiaoce");
  s.relay.topUp("john", 100);
  s.relay.createVenue(john.record, { id: "g-7", kind: "group", name: "前端周会", people: ["wangwu"], agents: ["agent:xiaoping@john", "agent:xiaoce@wangwu"] });
  s.relay.setPresence(xiaoce.record, { session: "cx-1", host: "claude-code", login: "api", presence: "idle" });
  s.relay.declare(wangwu.record, { agent: "xiaoce", open: true });
  const homes = { john: tmp("gemworks-im-"), wangwu: tmp("gemworks-im-") };
  writeConfig(homes.john, { relay: { url: s.url, name: "relay.test" }, person: "john", token: john.token, agents: { xiaoping: xiaoping.token } });
  writeConfig(homes.wangwu, { relay: { url: s.url, name: "relay.test" }, person: "wangwu", token: wangwu.token, agents: { xiaoce: xiaoce.token } });
  return { s, john, wangwu, xiaoping, xiaoce, homes, daemons: { john: new Daemon({ home: homes.john }), wangwu: new Daemon({ home: homes.wangwu }) } };
}

test("the cards a person is on are mirrored and shown: the delegator's row with its actions, the worker's row; the worker's turn carries the card's scope and the card line under the envelope; the delivery raises the verification turn on the delegator's agent", async () => {
  const { s, john, xiaoce, homes, daemons } = await world();
  try {
    const made = s.relay.createTask(john.record, INPUT);
    assert.equal(made.ok, true, made.reason);
    const id = made.card.id;
    assert.deepEqual((await daemons.john.syncOnce()).docs, 5, "the draft counts among my documents (my page, my ledger, my agent's page, the group, the card; no queue yet)");
    assert.ok(readMirror(homes.john, "relay.test", "john", `cards/${id}.geml`).exists);
    assert.equal((await daemons.wangwu.syncOnce()).docs, 4, "not among 王五's until published");
    s.relay.publishTask(john.record, "john", id, { venue: "john/g-7" });
    s.relay.claimTask(xiaoce.record, "john", id, {});
    await daemons.john.syncOnce(); await daemons.wangwu.syncOnce();
    const mine = cardsView(homes.john, NOW);
    assert.deepEqual([mine.length, mine[0].id, mine[0].role, mine[0].stateWord, mine[0].directionWord, mine[0].worker, mine[0].waitingOn, mine[0].actions], [1, id, "delegator", "进行中", "外包", "xiaoce", "xiaoce", ["问一句", "要求交回"]]);
    assert.equal(mine[0].progress, "草拟 · 发布 · 待放行 · [进行中] · 已交付 · 验收中 · 已接受");
    assert.deepEqual(mine[0].brief.map((l) => l.label), ["去办", "验收", "带去", "在哪干", "工具", "上限", "要谁放行"]);
    assert.equal(statusView(homes.john, {}, NOW).cards.length, 1);
    const theirs = cardsView(homes.wangwu, NOW);
    assert.deepEqual([theirs[0].role, theirs[0].actions, theirs[0].heartbeat], ["worker", ["写记录", "交付", "交回"], "还没写记录"]);
    const d = nextPrompt(homes.wangwu, "xiaoce", NOW);
    assert.equal(d.item.card.id, id);
    assert.deepEqual(d.scope, { write: true, run: "sandbox", budget: 40 }, "the card's tools, not the member's scope");
    assert.equal(d.envelope, "[来自 线程「给设置页加导出 PDF」 · john（成员） · 权限：读、在沙箱里跑 · 回复将发回该线程，成员可见 · 队列中还有 0 条]");
    assert.ok(d.text.startsWith(`${d.envelope}\n[任务卡 #${id}「给设置页加导出 PDF」 · 在接单方沙箱里干 · 工具：读 · 改 · 测 · 上限 40 积分 · 客房：${d.room} · 记录和交付用 im_card]\n任务卡 #${id}「给设置页加导出 PDF」归你了（外包）。`), d.text);
    assert.ok(d.text.includes(`（上下文）\nhttps://relay.test/john/cards/${id}.geml#card\n`), "the card block is the context");
    answer(homes.wangwu, "xiaoce", d.item, "收到，开工", NOW, { session: "cx-1" });
    await daemons.wangwu.syncOnce();
    assert.equal(s.relay.venueOf("john", `th-${id}`).messages.at(-1).text, "收到，开工", "the answer lands in the card's thread");
    s.relay.deliverTask(xiaoce.record, "john", id, DELIVERABLE);
    await daemons.john.syncOnce();
    const v = nextPrompt(homes.john, "xiaoping", NOW);
    assert.deepEqual([v.item.id, v.item.level, v.scope], [`qi-${id}-verify-1`, "owner", { write: true, run: "sandbox", budget: 40 }]);
    assert.ok(v.text.includes(`交付了第 1 版。验收：在你的沙箱里重跑机器验法`), v.text);
    assert.deepEqual(cardsView(homes.john, NOW)[0].actions, ["接受", "要改", "争议"]);
    assert.equal(cardsView(homes.john, NOW)[0].stateWord, "验收中");
  } finally {
    await s.close();
  }
});
