import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AvatarRelay } from "../dist/relay/avatars.js";

const BASE = Date.UTC(2026, 10, 1, 9, 0, 0);
function relay() {
  let offset = 0;
  const texts = [];
  const now = () => { const t = new Date(BASE + offset).toISOString().replace(/\.\d{3}Z$/, "Z"); offset += 1000; return t; };
  const r = new AvatarRelay({ root: mkdtempSync(join(tmpdir(), "gemsbang-work-")), name: "relay.test", now, texter: (t) => { texts.push(t); } });
  r.texts = texts;
  r.advance = (ms) => { offset += ms; };
  return r;
}
const ok = (x) => { assert.equal(x.ok, true, x.reason); return x; };
const bad = (x, status, reason) => { assert.equal(x.ok, false); assert.equal(x.status, status, x.reason); if (reason !== undefined) assert.equal(x.reason, reason); return x; };
function login(r, phone) {
  ok(r.startLogin({ phone }));
  const done = ok(r.finishLogin({ phone, code: /(\d{6})/.exec(r.texts.at(-1).text)[1] }));
  return { by: r.verify(done.token), person: done.person, token: done.token };
}

/** 设置页改版: John's avatar John and Li's 李四; 李四 asks for something to be fixed, and John's avatar brings a borrow card. */
function world() {
  const r = relay();
  const john = login(r, "13800138000");
  const li = login(r, "13900139000");
  const me = ok(r.growAvatar(john.by, { name: "John" })).avatar;
  const liA = ok(r.growAvatar(li.by, { name: "李四" })).avatar;
  const g = ok(r.createGroup(john.by, { as: me.id, name: "设置页改版" })).venue;
  ok(r.addMember(john.by, g.owner, g.id, { as: me.id, avatar: liA.id }));
  const venue = `${g.owner}/${g.id}`;
  const agent = r.verify(ok(r.issueAvatar(john.by, me.id)).token);
  const asks = (text) => {
    const line = ok(r.say(li.by, g.owner, g.id, { as: liA.id, text })).message;
    return ok(r.ask(agent, { venue, kind: "borrow", summary: "修设置页缓存的写路径", message: line.id, from: liA.id })).need;
  };
  const lines = () => ok(r.read(john.by, g.owner, `venues/${g.id}.geml`)).blocks.filter((b) => typeof b.value.text === "string");
  return { r, john, li, me, liA, g, venue, asks, lines };
}

test("a borrow card answered (spec §7.4): 立即执行 is a job waiting for the computer, with the chat, who asked and their words; 排着 queues it; 不干 is nothing", () => {
  const w = world();
  const n1 = w.asks("设置页的缓存写错了，帮忙修一下");
  ok(w.r.answerNeed(w.john.by, w.me.id, n1.id, { choice: 0 }));
  const [job] = w.r.worksOf(w.john.person);
  assert.deepEqual([job.state, job.summary, job.group, job.fromName, job.words, job.avatarName, job.auto], ["waiting", "修设置页缓存的写路径", "设置页改版", "李四", "设置页的缓存写错了，帮忙修一下", "John", undefined]);
  const n2 = w.asks("还有登录页");
  ok(w.r.answerNeed(w.john.by, w.me.id, n2.id, { choice: 1 }));
  const n3 = w.asks("顺便把首页也改了");
  ok(w.r.answerNeed(w.john.by, w.me.id, n3.id, { choice: 2 }));
  assert.deepEqual(w.r.worksOf(w.john.person).map((x) => [x.words, x.state]), [["设置页的缓存写错了，帮忙修一下", "waiting"], ["还有登录页", "queued"]]);
  assert.deepEqual(w.r.worksOf(w.li.person), [], "only the person's own");
});

test("以后无需确认 (spec §7.4, §3 rule 21): after 此人的任务不再确认, the next borrow from that asker waits on nobody — the card is answered by the relay, marked, and the job starts", () => {
  const w = world();
  const n1 = w.asks("修一下缓存");
  ok(w.r.answerNeed(w.john.by, w.me.id, n1.id, { choice: 0, allowPerson: true }));
  const n2 = w.asks("再跑一遍测试");
  assert.equal(n2.state, "answered");
  assert.deepEqual(w.r.needsOf(w.john.person), [], "no card waits");
  assert.deepEqual(w.r.worksOf(w.john.person).map((x) => [x.words, x.state, x.auto]), [["修一下缓存", "waiting", undefined], ["再跑一遍测试", "waiting", true]]);
});

test("the computer moves a job on (spec §7.4): takes it once; done, its words go into the chat as the avatar, `by: agent`, replying to the asker's line, with the facts its host saw; failed, the person gets an 出错 card; only the person's own", () => {
  const w = world();
  const n = w.asks("设置页的缓存写错了");
  ok(w.r.answerNeed(w.john.by, w.me.id, n.id, { choice: 0 }));
  const job = w.r.worksOf(w.john.person)[0];
  bad(w.r.setWork(w.li.by, w.me.id, job.id, { state: "taken" }), 403);
  bad(w.r.setWork(w.john.by, w.me.id, job.id, { state: "done", text: "x" }), 409, "该任务已由其他设备执行或已结束");
  assert.equal(ok(w.r.setWork(w.john.by, w.me.id, job.id, { state: "taken" })).work.state, "taken");
  bad(w.r.setWork(w.john.by, w.me.id, job.id, { state: "taken" }), 409);
  bad(w.r.setWork(w.john.by, w.me.id, job.id, { state: "done", text: " " }), 400, "干完要写一段给群里的话");
  bad(w.r.setWork(w.john.by, w.me.id, job.id, { state: "done", text: "x", facts: [{ label: "npm test" }] }), 400, "facts 要是 [{label, ok}] 的列表，最多 20 条");
  bad(w.r.setWork(w.john.by, w.me.id, job.id, { state: "gone" }), 400, "state 只能是 taken、waiting、done 或 failed");
  ok(w.r.setWork(w.john.by, w.me.id, job.id, { state: "done", text: "缓存的写路径修好了，测试都过了。", facts: [{ label: "npm test", ok: true }] }));
  const said = w.lines().at(-1);
  assert.deepEqual([said.value.speaker, said.value.by, said.value.text, said.value.replyTo, said.value.facts], [`avatar:${w.me.id}`, "agent", "缓存的写路径修好了，测试都过了。", job.message, [{ label: "npm test", ok: true }]]);
  assert.equal(w.r.worksOf(w.john.person)[0].state, "done");
  const n2 = w.asks("登录页也坏了");
  ok(w.r.answerNeed(w.john.by, w.me.id, n2.id, { choice: 1 }));
  const queued = w.r.worksOf(w.john.person)[1];
  assert.equal(ok(w.r.setWork(w.john.by, w.me.id, queued.id, { state: "waiting" })).work.state, "waiting", "排着, then 立即执行");
  bad(w.r.setWork(w.john.by, w.me.id, queued.id, { state: "failed", code: "boom" }), 400);
  ok(w.r.setWork(w.john.by, w.me.id, queued.id, { state: "failed", code: "borrow.wrongRepo", params: { here: "/work/other", repo: "/work/app", avatar: "x" } }));
  const card = w.r.needsOf(w.john.person).at(-1);
  assert.deepEqual([card.kind, card.summary, card.options.map((o) => o.label), card.venue.id], ["error", "本会话位于 /work/other，与「John」指定的工作仓库 /work/app 不一致，任务未执行：修设置页缓存的写路径", ["查看原因", "重试"], w.g.id]);
  bad(w.r.setWork(w.john.by, w.me.id, "work-99", { state: "taken" }), 404, "未找到该任务");
});

test("a job waits for the computer however long it takes (spec §7.4; architecture §6.3): nothing is said in the chat and nothing is an error while it waits; the computer takes it when it comes", () => {
  const w = world();
  const n = w.asks("设置页的缓存写错了");
  ok(w.r.answerNeed(w.john.by, w.me.id, n.id, { choice: 0 }));
  const q = w.asks("登录页也看看");
  ok(w.r.answerNeed(w.john.by, w.me.id, q.id, { choice: 1 }));
  w.r.advance(3 * 86_400_000);
  assert.equal(w.r.sweep(), 0);
  assert.equal(w.lines().filter((b) => b.value.speaker === `avatar:${w.me.id}`).length, 0, "no line in the chat");
  assert.deepEqual(w.r.needsOf(w.john.person), [], "no 出错 card");
  assert.deepEqual(w.r.worksOf(w.john.person).map((x) => x.state), ["waiting", "queued"]);
  const job = w.r.worksOf(w.john.person)[0];
  assert.equal(ok(w.r.setWork(w.john.by, w.me.id, job.id, { state: "taken" })).work.state, "taken", "three days on, the computer takes it");
});
