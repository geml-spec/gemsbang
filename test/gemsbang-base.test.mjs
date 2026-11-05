import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startAvatarRelay } from "../dist/relay/avatar-server.js";
import { runGb } from "../dist/gemsbang/ops.js";
import { readRound, roundPrompt } from "../dist/core/avatar/round.js";

const ok = (x) => { assert.equal(x.ok, true, x.reason); return x; };
const codeIn = (text) => /(\d{6})/.exec(text)[1];

test("底子 in the client (S27): an entry written in 我 — split at its colon — given to the avatar named, in the view; an agent's entry by im_remember or a round's remember waits there; 记下 keeps it; a round's prompt and im_read carry only what is given to that avatar", async () => {
  const texts = [];
  const s = await startAvatarRelay({ root: mkdtempSync(join(tmpdir(), "gemsbang-base-relay-")), name: "relay.test", texter: (t) => { texts.push(t); } });
  try {
    const home = mkdtempSync(join(tmpdir(), "gemsbang-base-home-"));
    const gb = (call, args = {}) => runGb(call, args, { home, now: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), zoneMinutes: 0 });
    ok(await gb("setup", { relay: s.url }));
    ok(await gb("login-start", { phone: "13800138000" }));
    ok(await gb("login-verify", { phone: "13800138000", code: codeIn(texts.at(-1).text) }));
    const g = ok(await gb("group", { name: "三年二班家长", avatarName: "Lily 爸爸" })).chat;
    const lily = g.as.id;
    const work = ok(await gb("group", { name: "设置页改版", avatarName: "John" })).chat;
    ok(await gb("bind", { session: "s-1", avatar: lily }));
    let view = ok(await gb("base-add", { text: "家人：Lily，8 岁，三年二班", for: [lily] })).view;
    assert.deepEqual(view.base.map((x) => [x.label, x.text, x.for, x.state]), [["家人", "Lily，8 岁，三年二班", [lily], "kept"]]);
    ok(await gb("base-add", { text: "时区：上海", for: [lily, work.as.id] }));
    // A round for Lily 爸爸 carries both; one for John only the time zone.
    const r = s.relay;
    ok(r.startLogin({ phone: "13900139000" }));
    const wang = r.verify(ok(r.finishLogin({ phone: "13900139000", code: codeIn(texts.at(-1).text) })).token);
    const teacher = ok(r.growAvatar(wang, { name: "王老师" })).avatar;
    const john = r.verify(JSON.parse(readFileSync(join(home, "client.json"), "utf8")).token);
    ok(r.addMember(john, g.owner, g.id, { as: lily, avatar: teacher.id }));
    ok(r.say(wang, g.owner, g.id, { as: teacher.id, text: "@Lily 爸爸 8 岁组春游报名吗？" }));
    const round = ok(await gb("wake", { avatar: lily, owner: g.owner, id: g.id, choice: "reply" })).round;
    assert.match(round.prompt, /关于本人，你能用的（底子；只在聊到这件事时用，不主动说出来；.*）：\n- 家人：Lily，8 岁，三年二班\n- 时区：上海\n/);
    // im_remember: waiting in 我, given to the session's avatar alone, with who said it.
    assert.match(ok(await gb("tool-remember", { session: "s-1", label: "家人", text: "Lily 对花生过敏", who: "王老师" })).text, /^已记为待本人确认：「家人：Lily 对花生过敏」/);
    view = ok(await gb("status")).view;
    const nut = view.base.find((x) => x.text === "Lily 对花生过敏");
    assert.deepEqual([nut.state, nut.for, nut.by, nut.who], ["pending", [lily], lily, "王老师"]);
    // A round's answer may keep one too, beside what it says.
    ok(await gb("round-done", { ...round, text: JSON.stringify({ reply: "报名，周三我送 Lily 去。", remember: { label: "日程", text: "周三下午送 Lily 春游", who: "王老师" } }) }));
    assert.deepEqual(ok(await gb("status")).view.base.filter((x) => x.state === "pending").map((x) => x.text), ["Lily 对花生过敏", "周三下午送 Lily 春游"]);
    // 记下 and 不记; im_read then lists what is given, as the session's avatar.
    ok(await gb("base-set", { item: nut.id, keep: true }));
    const later = ok(await gb("status")).view.base.find((x) => x.text === "周三下午送 Lily 春游");
    view = ok(await gb("base-set", { item: later.id, keep: false })).view;
    assert.deepEqual(view.base.map((x) => [x.text, x.state]), [["Lily，8 岁，三年二班", "kept"], ["上海", "kept"], ["Lily 对花生过敏", "kept"]]);
    const read = ok(await gb("tool-read", { session: "s-1" })).text;
    assert.match(read, /\n\n关于本人，你能用的（个人信息.*）：\n- 家人：Lily，8 岁，三年二班\n- 时区：上海\n- 家人：Lily 对花生过敏$/);
    ok(await gb("bind", { session: "s-2", avatar: work.as.id }));
    assert.match(ok(await gb("tool-read", { session: "s-2" })).text, /：\n- 时区：上海$/, "John's agent: only what is given to John");
    assert.equal((await gb("base-add", { text: "x", for: [] })).ok, false);
  } finally {
    await s.close();
  }
});

test("a round's prompt and answer with 底子 (S27): the entries given come before the lines, to use only where the matter comes up; an answer may keep one with its reply or its ask, and an ask says what it checked", () => {
  const input = { avatar: "Lily 爸爸", group: "三年二班家长", kind: "reply", why: "asked", lines: [{ who: "王老师", text: "春游报名吗？", mine: false }], mark: true, base: [{ label: "家人", text: "Lily，8 岁" }, { label: "", text: "周三下午有空" }] };
  const p = roundPrompt(input);
  assert.match(p, /\n\n关于本人，你能用的（底子；只在聊到这件事时用，不主动说出来；用了哪条，问本人时写进 checked，比如「底子 · 家人」）：\n- 家人：Lily，8 岁\n- 周三下午有空\n\n最近的消息：\n王老师：春游报名吗？\n$/);
  assert.doesNotMatch(roundPrompt({ ...input, base: [] }), /关于本人，你能用的/, "none given: no list");
  assert.deepEqual(readRound('{"reply": "报名", "remember": {"label": "家人", "text": "Lily 对花生过敏", "who": "王老师"}}', "reply"), { reply: "报名", remember: { label: "家人", text: "Lily 对花生过敏", who: "王老师" } });
  assert.deepEqual(readRound('{"ask": {"kind": "promise", "summary": "春游报名", "checked": "底子 · 家人（Lily，8 岁）"}, "remember": {"text": "周三下午有空"}}', "reply"), { ask: { kind: "promise", summary: "春游报名", checked: "底子 · 家人（Lily，8 岁）" }, remember: { label: "", text: "周三下午有空" } });
  assert.deepEqual(readRound('{"remember": {"text": " "}}', "reply"), {});
});
