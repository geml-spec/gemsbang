import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AvatarRelay } from "../dist/relay/avatars.js";
import { AvatarHosted, avatarCommandRunner } from "../dist/relay/avatar-hosted.js";

const BASE = Date.UTC(2026, 10, 1, 9, 0, 0);
/** A relay whose clock starts at 09:00 and moves a second per look; its texts are kept; `advance` moves the clock further. */
function relay(o = {}) {
  let offset = 0;
  const texts = [];
  const now = () => { const t = new Date(BASE + offset).toISOString().replace(/\.\d{3}Z$/, "Z"); offset += 1000; return t; };
  const r = new AvatarRelay({ root: mkdtempSync(join(tmpdir(), "gemsbang-relay-")), name: "relay.test", now, texter: (t) => { texts.push(t); }, ...o });
  r.texts = texts;
  r.advance = (ms) => { offset += ms; };
  return r;
}
const ok = (x) => { assert.equal(x.ok, true, x.reason); return x; };
const bad = (x, status, reason) => { assert.equal(x.ok, false); assert.equal(x.status, status, x.reason); if (reason !== undefined) assert.equal(x.reason, reason); return x; };
const codeIn = (t) => /(\d{6})/.exec(t.text)[1];
/** A person logged in by the number: their token's record and their id. */
function login(r, phone) {
  ok(r.startLogin({ phone }));
  const done = ok(r.finishLogin({ phone, code: codeIn(r.texts[r.texts.length - 1]) }));
  return { by: r.verify(done.token), person: done.person, token: done.token };
}

/**
 * 三年二班家长: Wang's 王老师 owns it (paused: Wang answers himself), John's
 * 乐乐爸爸 and Li's 李四 are in it. A scripted runner answers each round with
 * what `answer` says and keeps every round.
 */
function world(o = {}) {
  const r = relay();
  const john = login(r, "13800138000");
  const wang = login(r, "13700137000");
  const li = login(r, "13900139000");
  const dad = ok(r.growAvatar(john.by, { name: "乐乐爸爸" })).avatar;
  const teacher = ok(r.growAvatar(wang.by, { name: "王老师" })).avatar;
  const liA = ok(r.growAvatar(li.by, { name: "李四" })).avatar;
  const g = ok(r.createGroup(wang.by, { as: teacher.id, name: "三年二班家长" })).venue;
  ok(r.addMember(wang.by, g.owner, g.id, { as: teacher.id, avatar: dad.id }));
  ok(r.addMember(wang.by, g.owner, g.id, { as: teacher.id, avatar: liA.id }));
  for (const [by, a] of [[wang.by, teacher.id], [li.by, liA.id]]) ok(r.setHosted(by, a, { paused: true }));
  const rounds = [];
  let answer = (round) => (round.kind === "reply" ? "好的，我看一下。" : "");
  const hosted = new AvatarHosted({ relay: r, runner: async (round) => { rounds.push(round); return answer(round); }, ...o });
  hosted.start();
  const as = (who, a) => async (text, extra = {}) => { ok(r.say(who.by, g.owner, g.id, { as: a.id, text, ...extra })); await hosted.idle(); };
  const lines = () => ok(r.read(wang.by, g.owner, `venues/${g.id}.geml`)).blocks.filter((b) => typeof b.value.text === "string").map((b) => [b.value.speaker === `avatar:${dad.id}` ? "dad" : b.value.speaker === `avatar:${liA.id}` ? "li" : "teacher", b.value.by, b.value.text, b.value.hops]);
  return { r, john, wang, li, dad, teacher, liA, g, hosted, rounds, teacherSays: as(wang, teacher), liSays: as(li, liA), lines, setAnswer: (f) => { answer = f; } };
}
const okText = (text) => ({ ok: true, text });

test("the hosted body (spec §7.7): an @ wakes the avatar and it answers in the chat as itself, `by: agent`, replying to the line, hops 0; the owner's line wakes it too; its person can pause it; every round is written down, paid from the free quota", async () => {
  const w = world();
  w.setAnswer((round) => okText(round.kind === "reply" ? "好的，我看一下。" : ""));
  await w.liSays("@乐乐爸爸 周五能来当志愿者吗？", { id: "m-1" });
  assert.equal(w.rounds.length, 1);
  assert.deepEqual([w.rounds[0].avatarName, w.rounds[0].group, w.rounds[0].kind, w.rounds[0].reason, w.rounds[0].apiKey], ["乐乐爸爸", "三年二班家长", "reply", "mention", undefined]);
  assert.match(w.rounds[0].prompt, /李四：@乐乐爸爸 周五能来当志愿者吗？/);
  assert.deepEqual(w.lines().at(-1), ["dad", "agent", "好的，我看一下。", 0]);
  const reply = ok(w.r.read(w.wang.by, w.g.owner, `venues/${w.g.id}.geml`)).blocks.at(-1);
  assert.equal(reply.value.replyTo, "m-1");
  await w.teacherSays("下周一开家长会");
  assert.deepEqual(w.rounds.map((x) => x.reason), ["mention", "owner"]);
  ok(w.r.setHosted(w.john.by, w.dad.id, { paused: true }));
  await w.liSays("@乐乐爸爸 在吗？");
  assert.equal(w.rounds.length, 2, "paused: it does not wake");
  assert.deepEqual(w.r.hostedOf(w.dad.id).rounds.map((x) => [x.kind, x.paid, x.replied]), [["reply", "free", true], ["reply", "free", true]]);
  assert.equal(w.r.hostedReplies(w.r.hostedPerson(w.dad.id)), 2);
  bad(w.r.setHosted(w.wang.by, w.dad.id, { paused: false }), 403);
  bad(w.r.setHosted(w.john.by, w.dad.id, { paused: "yes" }), 400, "paused 要是 true 或 false");
});

test("the batch (spec §7.7): ordinary lines gather; at twenty, one read round that replies to nobody but may bring the person a card; thirty minutes gather a smaller batch too", async () => {
  const w = world();
  w.setAnswer((round) => okText(round.kind === "read" ? JSON.stringify({ reply: "不该发出", ask: { kind: "promise", summary: "群里在找周五的志愿者", draft: "周五我可以去" } }) : "x"));
  for (let i = 0; i < 19; i++) await w.liSays(`第 ${i} 句`);
  assert.equal(w.rounds.length, 0);
  await w.liSays("第 19 句");
  assert.deepEqual(w.rounds.map((x) => x.kind), ["read"]);
  assert.equal(w.lines().filter((l) => l[0] === "dad").length, 0, "a read round says nothing");
  const cards = w.r.needsOf(w.r.hostedPerson(w.dad.id));
  assert.deepEqual(cards.map((n) => [n.kind, n.summary, n.draft, n.group]), [["promise", "群里在找周五的志愿者", "周五我可以去", "三年二班家长"]]);
  await w.liSays("还有一句");
  assert.equal(await w.hosted.tick(), 0);
  w.r.advance(31 * 60_000);
  assert.equal(await w.hosted.tick(), 1);
  assert.deepEqual(w.rounds.map((x) => x.kind), ["read", "read"]);
});

test("avatars calling avatars stop at three hops (spec §5 rule 7): in a two-person chat each answer wakes the other, the hops count up, and the fourth agent line wakes nobody — the chat is told so, once", async () => {
  const w = world();
  ok(w.r.setHosted(w.li.by, w.liA.id, { paused: false }));
  const dm = ok(w.r.openDm(w.john.by, { as: w.dad.id, with: w.liA.id })).venue;
  w.setAnswer(() => okText("收到"));
  ok(w.r.say(w.john.by, dm.owner, dm.id, { as: w.dad.id, text: "在吗" }));
  await w.hosted.idle();
  const said = ok(w.r.read(w.john.by, dm.owner, `venues/${dm.id}.geml`)).blocks.filter((b) => b.value.by === "agent").map((b) => [b.value.speaker === `avatar:${w.dad.id}` ? "dad" : "li", b.value.hops]);
  assert.deepEqual(said, [["li", 0], ["dad", 1], ["li", 2], ["dad", 3]]);
  const blocks = ok(w.r.read(w.john.by, dm.owner, `venues/${dm.id}.geml`)).blocks;
  assert.deepEqual(blocks.filter((b) => /^note-/.test(b.id)).map((b) => [b.value.note, b.value.message]), [["hops", blocks.filter((b) => b.value.by === "agent").at(-1).id]], "the chat is told once");
});

test("who pays (spec §8.3): past the free replies the avatar only receives — no round, and its name says 本人在时才回 to everyone; the person's own key runs it again, the key going to the runner and never into the relay's documents; a day before the end, one 花钱 card", async () => {
  const w = world({ replies: 2 });
  w.setAnswer(() => okText("好"));
  await w.liSays("@乐乐爸爸 一");
  await w.liSays("@乐乐爸爸 二");
  await w.liSays("@乐乐爸爸 三");
  assert.equal(w.rounds.length, 2);
  assert.deepEqual(w.r.venueView(w.g.owner, w.g.id).members.find((m) => m.id === w.dad.id), { id: w.dad.id, name: "乐乐爸爸", away: true });
  const person = w.r.hostedPerson(w.dad.id);
  assert.deepEqual([w.hosted.quota(person).free, w.hosted.quota(person).key], [false, false]);
  w.hosted.setKey(person, "sk-test-123");
  await w.liSays("@乐乐爸爸 四");
  assert.deepEqual([w.rounds.length, w.rounds.at(-1).apiKey], [3, "sk-test-123"]);
  assert.equal(w.r.card(w.dad.id).away, undefined, "playing again");
  assert.deepEqual(w.r.hostedOf(w.dad.id).rounds.at(-1).paid, "key");
  const { readdirSync, readFileSync } = await import("node:fs");
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === "_hosted" ? [] : walk(join(d, e.name))) : [join(d, e.name)]));
  assert.equal(walk(w.r.root).some((f) => readFileSync(f, "utf8").includes("sk-test-123")), false, "the key is the orchestrator's alone");
  w.hosted.setKey(person, null);
  assert.equal(w.hosted.hasKey(person), false);
  const soon = world({ days: 1 });
  soon.setAnswer(() => okText("好"));
  await soon.liSays("@乐乐爸爸 一");
  await soon.liSays("@乐乐爸爸 二");
  const cards = soon.r.needsOf(soon.r.hostedPerson(soon.dad.id));
  assert.deepEqual(cards.map((n) => [n.kind, n.options.map((o) => o.label)]), [["pay", ["接上 API key", "先这样"]]], "once");
  assert.match(cards[0].summary, /^免费额度快用完了（还剩 1 天、\d+ 次）/);
});

test("a round that fails says nothing and is written down; the command runner gets the prompt on stdin and the round in HOSTED_*, the key only when there is one, in the avatar's workspace", async () => {
  const w = world();
  w.setAnswer(() => ({ ok: false, error: "no model" }));
  await w.liSays("@乐乐爸爸 在吗");
  assert.equal(w.lines().filter((l) => l[0] === "dad").length, 0);
  assert.deepEqual(w.r.hostedOf(w.dad.id).rounds.map((x) => [x.ok, x.replied]), [[false, false]]);
  const round = { avatar: "a-0000000001", avatarName: "乐乐爸爸", group: "三年二班家长", kind: "reply", reason: "mention", prompt: "第一行\n最后一行", workspace: mkdtempSync(join(tmpdir(), "gemsbang-ws-")) };
  const echo = avatarCommandRunner("node -e \"let s='';process.stdin.on('data',(c)=>{s+=c}).on('end',()=>{process.stdout.write(s.split(String.fromCharCode(10)).pop()+'|'+process.env.HOSTED_NAME+'|'+process.env.HOSTED_KIND+'|'+(process.env.HOSTED_API_KEY||'none')+'|'+(require('fs').realpathSync(process.cwd())===require('fs').realpathSync(process.env.HOSTED_WORKSPACE)))})\"");
  assert.deepEqual(await echo(round), { ok: true, text: "最后一行|乐乐爸爸|reply|none|true" });
  assert.deepEqual(await echo({ ...round, apiKey: "sk-1" }), { ok: true, text: "最后一行|乐乐爸爸|reply|sk-1|true" });
  assert.deepEqual(await avatarCommandRunner("node -e \"process.stderr.write('no model');process.exit(2)\"")(round), { ok: false, error: "runner exited 2: no model" });
  assert.deepEqual(await avatarCommandRunner("node -e \"setTimeout(()=>{},5000)\"", 1000)(round), { ok: false, error: "timed out after 1 s" });
});
