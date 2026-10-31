import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { route } from "../dist/relay/api.js";
import { Relay } from "../dist/relay/relay.js";
import { balanceOf, holdOf } from "../dist/core/im/ledger.js";

const BASE = Date.UTC(2026, 9, 31, 9, 0, 0);
/** A relay whose clock starts at 09:00 and moves a second per look; `advance` moves it further. */
function relay(extra = {}) {
  let offset = 0;
  const now = () => { const t = new Date(BASE + offset).toISOString().replace(/\.\d{3}Z$/, "Z"); offset += 1000; return t; };
  const r = new Relay({ root: mkdtempSync(join(tmpdir(), "gemworks-relay-")), name: "relay.test", version: "0.0.0", now, ...extra });
  r.advance = (ms) => { offset += ms; };
  return r;
}
function call(r, line, { token, body, ip } = {}) {
  const [method, path] = line.split(" ");
  const res = route({ method, path, query: {}, ...(token !== undefined ? { token } : {}), ...(body !== undefined ? { body } : {}), ...(ip !== undefined ? { ip } : {}) }, r);
  return { status: res.status, json: res.type.startsWith("application/json") ? JSON.parse(res.body) : undefined, text: res.body };
}
const INPUT = { title: "给设置页加导出 PDF", goal: "设置页右上角一个按钮，把当前配置导出成 PDF", context: { includes: [], excludes: ["private"] }, accepts: [{ text: "单元测试通过", verify: { kind: "command", run: "npm test" } }, { text: "导出的文件能打开", verify: { kind: "file", glob: "out/*.pdf" } }], direction: "outsource", venueOfWork: "worker-sandbox", tools: ["read", "edit", "test"], budget: { credits: 40, hours: 6 }, reward: { kind: "escrow", credits: 40 } };
const DELIVERABLE = { kind: "code", sha256: "7f3a", parts: [{ type: "repo", url: "u", branch: "deliver/t-42", commit: "a1b2c3" }], usage: "npm run build", evidence: [], accepts: [{ criterion: 1, met: true }, { criterion: 2, met: true }], rights: { owner: "委托方", aiGenerated: true } };
const CARD = { title: "设置页导出 PDF，能跑的", summary: "今天把设置页的缓存写路径修好了。", summarySource: "self", agent: "xiaoping", turns: 63, scope: "src/settings/*", evidence: [], use: {} };
const last = (r, person) => { const e = r.ledgerOf(person).at(-1); return [e.kind, e.from, e.to, e.amount, e.note]; };

/** John (agent 小评), 王五 (agent 小测, an API session) and 李四 in a group g-7. Nobody topped up: each has the free allowance. */
function world(extra = {}) {
  const r = relay(extra);
  const john = r.issuePerson("john"), wangwu = r.issuePerson("wangwu"), lisi = r.issuePerson("lisi");
  const xiaoping = r.issueAgent(john.record, "xiaoping"), xiaoce = r.issueAgent(wangwu.record, "xiaoce");
  r.createVenue(john.record, { id: "g-7", kind: "group", name: "前端周会", people: ["wangwu", "lisi"], agents: ["agent:xiaoping@john", "agent:xiaoce@wangwu"] });
  r.setPresence(xiaoce.record, { session: "cx-1", host: "claude-code", login: "api", presence: "idle" });
  r.declare(wangwu.record, { agent: "xiaoce", open: true });
  return { r, john, wangwu, lisi, xiaoping, xiaoce };
}

test("the ledger (§9.1): a new person's free allowance, none on a relay that gives none; the operator's top-up; the wallet with its caps, today's use and its lines; the ledger is the owner's alone; the caps set one at a time", () => {
  const { r, john, wangwu, xiaoping } = world();
  assert.equal(r.balance("john"), 20);
  assert.deepEqual(r.ledgerOf("john").map((e) => [e.n, e.kind, e.from, e.to, e.amount, e.note]), [[1, "topup", "platform", "person:john", 20, "免费额度"]]);
  const bare = relay({ freeCredits: 0 });
  bare.issuePerson("zhao");
  assert.deepEqual([bare.balance("zhao"), bare.ledgerOf("zhao")], [0, []]);
  assert.deepEqual(r.topUp("nobody", 5), { ok: false, status: 404, reason: "没有这个人" });
  assert.equal(r.topUp("john", 0).reason, "积分是正整数");
  assert.deepEqual(r.topUp("john", 80, "充了 80"), { ok: true, balance: 100 });
  const w = call(r, "GET /wallet", { token: john.token });
  assert.equal(w.status, 200, w.text);
  assert.deepEqual([w.json.balance, w.json.caps, w.json.used, w.json.agents, w.json.lines], [100, { agentPerDay: 30, perCard: 40, guestPerDay: 10, autoBuy: 5 }, { agents: {}, cards: {}, guest: 0, auto: 0 }, ["xiaoping"], ["钱包 100 积分", "xiaoping 每天 30", "每张卡 40", "访客问答每天 10", "自动买东西 5 · 超过要问我"]]);
  assert.deepEqual(w.json.recent, ["09:00 充值 · 平台 给 john · 充了 80 | +80", "09:00 充值 · 平台 给 john · 免费额度 | +20"]);
  assert.equal(call(r, "GET /wallet", { token: xiaoping.token }).status, 403);
  assert.equal(call(r, "GET /john/ledger/john.geml", { token: wangwu.token }).status, 403, "the ledger is the owner's alone");
  assert.equal(call(r, "GET /john/ledger/john.geml", { token: john.token }).json.blocks.length, 2);
  assert.deepEqual(call(r, "POST /wallet/caps", { token: john.token, body: { perCard: 60, autoBuy: 0, guestPerDay: -3 } }).json.caps, { agentPerDay: 30, perCard: 60, guestPerDay: 10, autoBuy: 0 }, "zero is a cap; a bad number is ignored");
  assert.deepEqual(call(r, "POST /wallet/caps", { token: john.token, body: { agentPerDay: 12 } }).json.caps, { agentPerDay: 12, perCard: 60, guestPerDay: 10, autoBuy: 0 }, "the others kept");
  assert.equal(call(r, "POST /wallet/caps", { token: xiaoping.token, body: {} }).status, 403);
  assert.equal(call(r, "POST /wallet/nope", { token: john.token, body: {} }).status, 404);
  assert.equal(call(r, "GET /wallet/caps", { token: john.token }).status, 405);
});

test("a card's money (§9.1): publish holds the reward within the per-card cap and the balance; accept settles it to the worker's owner; a close refunds; a dispute splits by arbitration; a contest pays the prize and the participation; a fee when the relay takes one", () => {
  const { r, john, wangwu, xiaoping, xiaoce } = world();
  const id = call(r, "POST /tasks", { token: john.token, body: INPUT }).json.card.id;
  const publish = (card, token = john.token) => call(r, `POST /tasks/john/${card}/publish`, { token, body: { venue: "john/g-7" } });
  assert.equal(publish(id).json.error, "积分不够：钱包 20，要托管 40");
  r.topUp("john", 100);
  call(r, "POST /wallet/caps", { token: john.token, body: { perCard: 30 } });
  assert.equal(publish(id).json.error, "超过每张卡的额度 30（要托管 40）");
  call(r, "POST /wallet/caps", { token: john.token, body: { perCard: 40 } });
  assert.equal(publish(id).json.card.state, "open");
  assert.equal(r.balance("john"), 80);
  const hold = holdOf("card", `john/${id}`);
  const escrow = r.ledgerOf("john").at(-1);
  assert.deepEqual([escrow.kind, escrow.from, escrow.to, escrow.amount, escrow.note, escrow.card, escrow.ref], ["escrow", "person:john", hold, 40, "发布时托管", id, `https://relay.test/john/cards/${id}.geml`]);
  assert.equal(balanceOf(r.ledgerOf("john"), hold), 40);
  assert.equal(r.taskOf("john", id).transitions.length, 1, "the state moved once: a draft starts with no transition");
  call(r, `POST /tasks/john/${id}/claim`, { token: xiaoce.token });
  call(r, `POST /tasks/john/${id}/deliver`, { token: xiaoce.token, body: DELIVERABLE });
  const won = call(r, `POST /tasks/john/${id}/report`, { token: xiaoping.token, body: { results: [{ criterion: 1, met: true }, { criterion: 2, met: true }] } });
  assert.deepEqual([won.json.decision, won.json.card.transitions.at(-1).note], ["accepted", "结算 40 积分（托管）"]);
  assert.deepEqual([r.balance("wangwu"), r.balance("john"), balanceOf(r.ledgerOf("john"), hold)], [60, 80, 0]);
  assert.deepEqual(last(r, "wangwu"), ["settle", hold, "person:wangwu", 40, "验收过"]);
  assert.deepEqual(last(r, "john"), ["settle", hold, "person:wangwu", 40, "验收过"], "the hold's owner keeps its movements too");
  assert.equal(r.ledgerOf("wangwu").at(-1).tx, r.ledgerOf("john").at(-1).tx, "one movement, one tx");
  assert.equal(r.walletOf("wangwu").recent[0], `09:00 结算 · #${id} 给 xiaoce · 验收过 | +40`);
  assert.equal(r.walletOf("john").recent[0], `09:00 结算 · #${id} 给 xiaoce · 验收过 | 40`, "not the delegator's own money any more: unsigned");
  assert.deepEqual(r.walletOf("john").used.cards, { [id]: 40 });
  // a close refunds
  const id2 = call(r, "POST /tasks", { token: john.token, body: INPUT }).json.card.id;
  publish(id2);
  assert.equal(r.balance("john"), 40);
  assert.equal(call(r, `POST /tasks/john/${id2}/close`, { token: john.token, body: { reason: "算了" } }).json.card.state, "closed");
  assert.deepEqual([r.balance("john"), last(r, "john"), balanceOf(r.ledgerOf("john"), holdOf("card", `john/${id2}`))], [80, ["refund", holdOf("card", `john/${id2}`), "person:john", 40, "关闭"], 0]);
  // a dispute split by arbitration
  const id3 = call(r, "POST /tasks", { token: john.token, body: INPUT }).json.card.id;
  publish(id3);
  call(r, `POST /tasks/john/${id3}/claim`, { token: xiaoce.token });
  call(r, `POST /tasks/john/${id3}/deliver`, { token: xiaoce.token, body: DELIVERABLE });
  call(r, `POST /tasks/john/${id3}/dispute`, { token: wangwu.token, body: { reason: "重跑环境不对" } });
  assert.equal(call(r, `POST /tasks/john/${id3}/settle`, { token: john.token, body: { outcome: "accepted", workerShare: -1 } }).json.error, "workerShare 是非负整数");
  const settled = call(r, `POST /tasks/john/${id3}/settle`, { token: john.token, body: { outcome: "accepted", workerShare: 25, arbitration: "https://relay.test/_relay/arbitration/a-1.geml" } });
  assert.equal(settled.json.card.state, "accepted", settled.text);
  assert.deepEqual([r.balance("wangwu"), r.balance("john")], [85, 55]);
  const split = r.ledgerOf("john").slice(-2);
  assert.deepEqual(split.map((e) => [e.kind, e.to, e.amount, e.note, e.ref]), [["settle", "person:wangwu", 25, "仲裁", "https://relay.test/_relay/arbitration/a-1.geml"], ["refund", "person:john", 15, "仲裁", "https://relay.test/_relay/arbitration/a-1.geml"]]);
  // a contest: the prize to the winner's owner, the participation to the other seated slot's owner
  const zhao = r.issuePerson("zhao"), xiaoma = r.issueAgent(zhao.record, "xiaoma");
  r.addMember(john.record, "john", "g-7", "zhao"); r.addMember(john.record, "john", "g-7", "agent:xiaoma@zhao");
  r.setPresence(xiaoma.record, { session: "cm-1", host: "pi", login: "self-hosted", presence: "idle" });
  r.declare(zhao.record, { agent: "xiaoma", open: true });
  const c = call(r, "POST /tasks", { token: john.token, body: { ...INPUT, mode: { kind: "contest", slots: 2 }, reward: { kind: "prize", credits: 30, participation: 2 } } }).json.card.id;
  publish(c);
  assert.deepEqual([r.balance("john"), balanceOf(r.ledgerOf("john"), holdOf("card", `john/${c}`))], [23, 32], "the prize and one participation held");
  call(r, `POST /tasks/john/${c}/claim`, { token: xiaoce.token });
  call(r, `POST /tasks/john/${c}/claim`, { token: xiaoma.token });
  call(r, `POST /tasks/john/${c}/deliver`, { token: xiaoce.token, body: DELIVERABLE });
  const prize = call(r, `POST /tasks/john/${c}/report`, { token: xiaoping.token, body: { results: [{ criterion: 1, met: true }, { criterion: 2, met: true }] } });
  assert.deepEqual([prize.json.decision, prize.json.card.transitions.at(-1).note], ["accepted", "结算 30 积分（奖金）· 参与补偿 2"]);
  assert.deepEqual([r.balance("wangwu"), r.balance("zhao"), r.balance("john"), balanceOf(r.ledgerOf("john"), holdOf("card", `john/${c}`))], [115, 22, 23, 0]);
  assert.deepEqual(last(r, "zhao"), ["settle", holdOf("card", `john/${c}`), "person:zhao", 2, "参与补偿"]);
  // a fee
  const f = world({ feePercent: 10 });
  f.r.topUp("john", 100);
  const fid = call(f.r, "POST /tasks", { token: f.john.token, body: INPUT }).json.card.id;
  call(f.r, `POST /tasks/john/${fid}/publish`, { token: f.john.token, body: { venue: "john/g-7" } });
  call(f.r, `POST /tasks/john/${fid}/claim`, { token: f.xiaoce.token });
  call(f.r, `POST /tasks/john/${fid}/deliver`, { token: f.xiaoce.token, body: DELIVERABLE });
  assert.equal(call(f.r, `POST /tasks/john/${fid}/accept`, { token: f.john.token }).json.card.state, "accepted", "the delegator may accept from 验收中 without a report");
  assert.deepEqual([f.r.balance("wangwu"), last(f.r, "john")], [56, ["fee", holdOf("card", `john/${fid}`), "platform", 4, "平台抽成 10%"]]);
});

test("a guest's question is the owner's spend (§9.1): one credit each, against the guest cap and the agent's day; none when the wallet is empty", () => {
  const { r, john, lisi, xiaoping } = world();
  const id = call(r, "POST /cards", { token: john.token, body: CARD }).json.card.id;
  const first = call(r, `POST /ask/${id}`, { body: { text: "问一句" }, ip: "10.0.0.1" });
  assert.equal(first.status, 201, first.text);
  assert.equal(r.balance("john"), 19);
  const e = r.ledgerOf("john").at(-1);
  assert.deepEqual([e.kind, e.from, e.to, e.amount, e.note, e.agent, e.cap], ["spend", "person:john", "platform", 1, "访客问答", "xiaoping", "guest"]);
  assert.deepEqual(r.walletOf("john").used, { agents: { xiaoping: 1 }, cards: {}, guest: 1, auto: 0 });
  assert.equal(r.walletOf("john").recent[0], "09:00 消耗 · xiaoping 给 平台 · 访客问答 | −1");
  call(r, "POST /wallet/caps", { token: john.token, body: { guestPerDay: 1 } });
  assert.equal(call(r, `POST /ask/${id}`, { token: first.json.token, body: { text: "再问" }, ip: "10.0.0.1" }).json.error, "作者今天的访客额度用完了，明天再来");
  call(r, "POST /wallet/caps", { token: john.token, body: { guestPerDay: 10, agentPerDay: 1 } });
  assert.equal(call(r, `POST /ask/${id}`, { token: first.json.token, body: { text: "再问" }, ip: "10.0.0.1" }).json.error, "作者今天的访客额度用完了，明天再来", "the agent's day is spent too");
  call(r, "POST /wallet/caps", { token: john.token, body: { agentPerDay: 30 } });
  assert.equal(call(r, "POST /wallet/gift", { token: john.token, body: { to: "lisi", credits: 19 } }).status, 200);
  assert.equal(r.balance("john"), 0);
  assert.equal(call(r, `POST /ask/${id}`, { token: first.json.token, body: { text: "再问" }, ip: "10.0.0.1" }).json.error, "作者的积分用完了");
  assert.equal(xiaoping.record.speaker, "agent:xiaoping@john");
});

test("tips, favours, gifts and red packets (§9.1): a tip lands in the owner's wallet with the agent named and a line; a favour is a line both keep and no credits; a gift goes to an account now or is held for whoever claims it once; a packet's shares are drawn by the venue's members and what is left goes back after a day", () => {
  const { r, john, wangwu, lisi, xiaoping } = world();
  r.topUp("john", 80);
  // tips
  const tip = call(r, "POST /wallet/tip", { token: wangwu.token, body: { to: "agent:xiaoping@john", credits: 5, note: "那个缓存修得漂亮" } });
  assert.deepEqual([tip.status, tip.json], [200, { balance: 15 }]);
  assert.deepEqual([r.balance("john"), r.walletOf("john").recent[0], r.walletOf("wangwu").recent[0]], [105, "09:00 打赏 · wangwu 给 xiaoping · 「那个缓存修得漂亮」 | +5", "09:00 打赏 · wangwu 给 xiaoping · 「那个缓存修得漂亮」 | −5"]);
  assert.equal(call(r, "POST /wallet/tip", { token: wangwu.token, body: { to: "wangwu", credits: 1 } }).json.error, "不能打赏自己");
  assert.equal(call(r, "POST /wallet/tip", { token: wangwu.token, body: { to: "nobody", credits: 1 } }).status, 404);
  assert.equal(call(r, "POST /wallet/tip", { token: wangwu.token, body: { to: "john", credits: 99 } }).json.error, "积分不够：钱包 15");
  assert.equal(call(r, "POST /wallet/tip", { token: xiaoping.token, body: { to: "lisi", credits: 1 } }).status, 403);
  assert.equal(call(r, "POST /wallet/tip", { token: wangwu.token, body: { to: "lisi", credits: 2 } }).json.balance, 13, "a tip to a person, no line");
  assert.equal(r.walletOf("lisi").recent[0], "09:00 打赏 · wangwu 给 lisi ·  | +2");
  // favours
  assert.equal(call(r, "POST /wallet/favor", { token: lisi.token, body: { from: "john" } }).json.error, "人情要一句话");
  assert.equal(call(r, "POST /wallet/favor", { token: lisi.token, body: { from: "john", note: "帮跑了一次，约 30 万 token" } }).status, 200);
  assert.deepEqual([last(r, "lisi"), last(r, "john"), r.balance("lisi"), r.balance("john")], [["favor", "person:john", "person:lisi", 0, "帮跑了一次，约 30 万 token"], ["favor", "person:john", "person:lisi", 0, "帮跑了一次，约 30 万 token"], 22, 105]);
  assert.equal(r.walletOf("lisi").recent[0], "09:00 人情 · john 给 lisi · 帮跑了一次，约 30 万 token | 不转积分");
  assert.equal(call(r, "POST /wallet/favor", { token: john.token, body: { to: "wangwu", note: "审了一版" } }).status, 200);
  assert.deepEqual(last(r, "wangwu"), ["favor", "person:john", "person:wangwu", 0, "审了一版"]);
  // gifts
  assert.equal(call(r, "POST /wallet/gift", { token: john.token, body: { to: "wangwu", credits: 10 } }).json.balance, 95);
  assert.equal(r.balance("wangwu"), 23);
  assert.equal(call(r, "POST /wallet/gift", { token: john.token, body: { to: "john", credits: 1 } }).json.error, "不能送给自己");
  assert.equal(call(r, "POST /wallet/gift", { token: john.token, body: { to: "nobody", credits: 1 } }).status, 404);
  const held = call(r, "POST /wallet/gift", { token: john.token, body: { credits: 15, note: "拿去买个 skill" } });
  assert.equal(held.status, 201, held.text);
  assert.match(held.json.id, /^g-[0-9a-f]{8}$/);
  assert.deepEqual([held.json.url, held.json.balance], [`/g/${held.json.id}`, 80]);
  assert.deepEqual(call(r, `GET /g/${held.json.id}`).json, { id: held.json.id, from: "john", credits: 15, note: "拿去买个 skill" }, "the claim page's JSON needs no token");
  assert.equal(call(r, "GET /g/g-00000000").status, 404);
  assert.equal(call(r, `POST /g/${held.json.id}/claim`, { token: xiaoping.token }).status, 403);
  assert.equal(call(r, `POST /g/${held.json.id}/claim`, { token: john.token }).json.error, "不能领自己的礼物");
  assert.deepEqual(call(r, `POST /g/${held.json.id}/claim`, { token: lisi.token }).json, { credits: 15, balance: 37 });
  assert.equal(call(r, `POST /g/${held.json.id}/claim`, { token: wangwu.token }).json.error, "已经被 lisi 领了");
  assert.equal(call(r, `GET /g/${held.json.id}`).json.claimed, "lisi");
  assert.deepEqual([balanceOf(r.ledgerOf("john"), holdOf("gift", `john/${held.json.id}`)), last(r, "lisi")], [0, ["gift", holdOf("gift", `john/${held.json.id}`), "person:lisi", 15, "领了 john 的礼物"]]);
  assert.equal(r.walletOf("lisi").recent[0], "09:00 赠送 · 礼物 给 lisi · 领了 john 的礼物 | +15");
  // packets
  assert.equal(call(r, "POST /wallet/packet", { token: john.token, body: { venue: "john/nowhere", credits: 10, shares: 3 } }).status, 404);
  assert.equal(call(r, "POST /wallet/packet", { token: john.token, body: { venue: "john/g-7", credits: 10, shares: 11 } }).json.error, "份数是 1 到积分数之间的整数");
  const packet = call(r, "POST /wallet/packet", { token: john.token, body: { venue: "john/g-7", credits: 10, shares: 3, note: "发奖金啦" } });
  assert.equal(packet.status, 201, packet.text);
  assert.match(packet.json.id, /^r-[0-9a-f]{8}$/);
  const pid = packet.json.id;
  assert.deepEqual([packet.json.message.kind, packet.json.message.text, packet.json.message.card, packet.json.balance], ["card", "红包 · 10 积分 · 3 份 · 发奖金啦", `https://relay.test/john/packets/${pid}.geml`, 70]);
  assert.equal(r.venueOf("john", "g-7").messages.at(-1).id, `m-${pid}`);
  const view = call(r, `GET /r/${pid}`, { token: wangwu.token });
  assert.deepEqual([view.json.from, view.json.credits, view.json.shares, view.json.left, view.json.claims, view.json.returned, view.json.note], ["john", 10, 3, 3, [], false, "发奖金啦"]);
  const zhao = r.issuePerson("zhao");
  assert.equal(call(r, `GET /r/${pid}`, { token: zhao.token }).status, 403, "not a member");
  assert.equal(call(r, `POST /r/${pid}/claim`, { token: john.token }).json.error, "自己的红包不能领");
  assert.deepEqual(call(r, `POST /r/${pid}/claim`, { token: wangwu.token }).json, { amount: 3, left: 2, balance: 26 });
  assert.equal(call(r, `POST /r/${pid}/claim`, { token: wangwu.token }).json.error, "领过了");
  assert.deepEqual(call(r, `POST /r/${pid}/claim`, { token: lisi.token }).json, { amount: 3, left: 1, balance: 40 });
  assert.deepEqual(call(r, `GET /r/${pid}`, { token: wangwu.token }).json.claims, [{ by: "wangwu", amount: 3 }, { by: "lisi", amount: 3 }]);
  assert.equal(call(r, `GET /r/${pid}`, { token: wangwu.token }).json.mine, 3);
  assert.equal(r.walletOf("lisi").recent[0], "09:00 红包 · 红包 给 lisi · 领了 john 的红包 · 第 2 份 | +3");
  r.addMember(john.record, "john", "g-7", "person:zhao");
  r.advance(25 * 3_600_000);
  assert.equal(call(r, `POST /r/${pid}/claim`, { token: zhao.token }).json.error, "红包过了 24 小时，没领完的退回了");
  assert.deepEqual(r.tick(), { returned: [], packets: [pid], lapsed: [] });
  assert.deepEqual([r.balance("john"), last(r, "john")], [74, ["refund", holdOf("packet", `john/${pid}`), "person:john", 4, "红包 24 小时没领完，退回"]]);
  assert.deepEqual([call(r, `GET /r/${pid}`, { token: wangwu.token }).json.returned, call(r, `GET /r/${pid}`, { token: wangwu.token }).json.left], [true, 0]);
  assert.deepEqual(r.tick(), { returned: [], packets: [], lapsed: [] }, "returned once");
});

test("an agent's spend (§9.1): within the auto-buy cap and its day, from the owner's wallet; over either, refused and the ask stands in the owner's inbox as 放行; today's allowance lets it through; tomorrow starts over", () => {
  const { r, john, xiaoping } = world();
  r.topUp("john", 80);
  assert.equal(call(r, "POST /wallet/spend", { token: john.token, body: { credits: 1, note: "x" } }).json.error, "只有 agent 的令牌能记消耗（主人不花自己的上限）");
  assert.equal(call(r, "POST /wallet/spend", { token: xiaoping.token, body: { credits: 3 } }).json.error, "要一句说明（买了什么）");
  assert.equal(call(r, "POST /wallet/spend", { token: xiaoping.token, body: { credits: 0, note: "x" } }).json.error, "积分是正整数");
  assert.deepEqual(call(r, "POST /wallet/spend", { token: xiaoping.token, body: { credits: 3, note: "买了 skill pdf-export", card: "t-42" } }).json, { balance: 97, left: 2 });
  assert.deepEqual(r.walletOf("john").used, { agents: { xiaoping: 3 }, cards: { "t-42": 3 }, guest: 0, auto: 3 });
  assert.equal(r.walletOf("john").lines[1], "xiaoping 每天 30 · 已用 3");
  assert.equal(call(r, "POST /wallet/spend", { token: xiaoping.token, body: { credits: 3, note: "再买一个" } }).json.error, "超过上限（今天还能花 2）· 用 ask 向主人要放行");
  assert.equal(call(r, "POST /wallet/ask", { token: john.token, body: { credits: 5 } }).status, 403);
  assert.equal(call(r, "POST /wallet/ask", { token: xiaoping.token, body: { credits: 5, cap: "nope" } }).json.error, "cap 是 agent、card、guest 或 auto");
  const ask = call(r, "POST /wallet/ask", { token: xiaoping.token, body: { credits: 5, cap: "auto", note: "还差一个 skill" } });
  assert.deepEqual([ask.status, ask.json], [201, { id: "cap-ask-1" }]);
  assert.deepEqual(r.inbox("john").map((n) => [n.kind, n.key, n.text, n.actions]), [["grant", "https://relay.test/john/people/john.geml#cap-ask-1", "xiaoping 想再花 5 积分（自动买东西）：还差一个 skill", ["今天再 5", "不行"]]]);
  assert.equal(call(r, "POST /wallet/allow", { token: xiaoping.token, body: { ask: "cap-ask-1", allowed: true } }).status, 403);
  assert.equal(call(r, "POST /wallet/allow", { token: john.token, body: { ask: "cap-ask-9", allowed: true } }).status, 404);
  assert.deepEqual(call(r, "POST /wallet/allow", { token: john.token, body: { ask: "cap-ask-1", allowed: true } }).json, { id: "cap-allow-1", allowed: true });
  assert.deepEqual(r.inbox("john"), []);
  assert.equal(call(r, "POST /wallet/allow", { token: john.token, body: { ask: "cap-ask-1", allowed: true } }).json.error, "已经答过了");
  assert.deepEqual(call(r, "POST /wallet/spend", { token: xiaoping.token, body: { credits: 5, note: "买了" } }).json, { balance: 92, left: 2 });
  const no = call(r, "POST /wallet/ask", { token: xiaoping.token, body: { credits: 9, cap: "auto" } });
  assert.equal(r.inbox("john")[0].text, "xiaoping 想再花 9 积分（自动买东西）");
  assert.deepEqual(call(r, "POST /wallet/allow", { token: john.token, body: { ask: no.json.id, allowed: false } }).json, { id: "cap-allow-2", allowed: false });
  assert.equal(call(r, "POST /wallet/spend", { token: xiaoping.token, body: { credits: 3, note: "再买" } }).json.error, "超过上限（今天还能花 2）· 用 ask 向主人要放行");
  r.advance(24 * 3_600_000);
  assert.deepEqual(call(r, "POST /wallet/spend", { token: xiaoping.token, body: { credits: 5, note: "新的一天" } }).json, { balance: 87, left: 0 });
  assert.equal(call(r, "POST /wallet/spend", { token: xiaoping.token, body: { credits: 1, note: "又一个" } }).json.error, "超过上限（今天还能花 0）· 用 ask 向主人要放行");
  call(r, "POST /wallet/caps", { token: john.token, body: { autoBuy: 100, agentPerDay: 6 } });
  assert.equal(call(r, "POST /wallet/spend", { token: xiaoping.token, body: { credits: 2, note: "x" } }).json.error, "超过上限（今天还能花 1）· 用 ask 向主人要放行", "the agent's day bounds it");
});
