import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startAvatarRelay } from "../dist/relay/avatar-server.js";
import { runGb } from "../dist/gemsbang/ops.js";
import { readClient } from "../dist/gemsbang/home.js";

/** A relay on a free port, its texts kept; a client home per person; `gb` one call as the bridge makes it. */
async function world() {
  const texts = [];
  const s = await startAvatarRelay({ root: mkdtempSync(join(tmpdir(), "gemsbang-ops-relay-")), name: "relay.test", texter: (t) => { texts.push(t); } });
  const person = () => {
    const home = mkdtempSync(join(tmpdir(), "gemsbang-ops-home-"));
    const gb = (call, args = {}) => runGb(call, args, { home, now: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), zoneMinutes: 0 });
    return { home, gb };
  };
  const code = () => /验证码 (\d{6})|code (\d{6})|コード (\d{6})/.exec(texts[texts.length - 1].text).slice(1).find((x) => x !== undefined);
  const login = async (p, phone) => {
    const ok = (x) => { assert.equal(x.ok, true, x.reason); return x; };
    ok(await p.gb("setup", { relay: s.url }));
    ok(await p.gb("login-start", { phone }));
    return ok(await p.gb("login-verify", { phone, code: code() }));
  };
  return { s, texts, person, code, login };
}
const ok = (x) => { assert.equal(x.ok, true, x.reason); return x; };
const bad = (x, code) => { assert.equal(x.ok, false); assert.equal(x.code, code, x.reason); return x; };

test("the person in the pane (spec §6.2, §7.1, §7.2): a relay, a phone and a code; a group made as a new avatar, its link, a newcomer by the link, the inbox with both avatars marked; a chat opened is seen, a line said is the person's; no relay or a bad one is said so", async () => {
  const { s, person, login } = await world();
  try {
    const john = person();
    bad(await john.gb("login-start", { phone: "13800138000" }), "client.noRelay");
    bad(await john.gb("setup", { relay: "im.example/x" }), "client.badRelay");
    const first = await login(john, "13800138000");
    assert.deepEqual([first.view.loggedIn, first.view.relay, first.view.avatars, first.view.rows], [true, s.url, [], []]);
    const made = ok(await john.gb("group", { name: "设置页改版", avatarName: "John" }));
    assert.deepEqual([made.chat.name, made.chat.count, made.chat.as.name, made.chat.isOwner], ["设置页改版", 1, "John", true]);
    const link = ok(await john.gb("link", { owner: made.chat.owner, id: made.chat.id })).link;
    assert.match(link.url, new RegExp(`^${s.url}/i/[a-z0-9]{8}\\?by=a-`));
    assert.equal(link.line, `读 ${s.url}/i/${link.code}.md ，照着做：用我的身份进「设置页改版」。`);
    assert.deepEqual([link.days, link.forward, link.approve, link.isOwner], [7, true, false, true]);
    const li = person();
    await login(li, "13900139000");
    const info = ok(await li.gb("link-info", { url: link.url })).info;
    assert.deepEqual([info.group.name, info.you.pick.kind], ["设置页改版", "choose"]);
    const joined = ok(await li.gb("join", { url: link.url, name: "李四" }));
    assert.equal(joined.joined.avatar.name, "李四");
    assert.deepEqual(joined.view.rows.map((r) => [r.name, r.as.name]), [["设置页改版", "李四"]]);
    ok(await li.gb("say", { owner: made.chat.owner, id: made.chat.id, text: "我进来了" }));
    const box = ok(await john.gb("status")).view;
    assert.deepEqual(box.rows.map((r) => [r.name, r.last.who, r.last.text, r.unread]), [["设置页改版", "李四", "我进来了", 1]]);
    const opened = ok(await john.gb("open", { owner: made.chat.owner, id: made.chat.id }));
    assert.deepEqual(opened.chat.items.map((i) => i.kind === "joined" ? `+${i.who}` : `${i.who}:${i.text}`), ["+John", "+李四", "李四:我进来了"]);
    assert.equal(opened.view.rows[0].unread, 0, "opening it marked it seen");
    const said = ok(await john.gb("say", { owner: made.chat.owner, id: made.chat.id, text: "欢迎" }));
    const mine = said.chat.items.at(-1);
    assert.deepEqual([mine.text, mine.mine, mine.mark], ["欢迎", true, false], "the person's own line, unmarked");
    bad(await john.gb("open", { owner: "a-ffffffffff", id: "g-ffffffffff" }), "client.noVenue");
  } finally {
    await s.close();
  }
});

test("a group's link in the pane (spec §6.1): a member gets it unless the owner turned forwarding off; the owner swaps it, the old one stops; the approval on, a newcomer waits", async () => {
  const { s, person, login } = await world();
  try {
    const john = person();
    await login(john, "13800138000");
    const g = ok(await john.gb("group", { name: "前端周会", avatarName: "John" })).chat;
    const first = ok(await john.gb("link", { owner: g.owner, id: g.id })).link;
    const li = person();
    await login(li, "13900139000");
    ok(await li.gb("join", { url: first.url, name: "李四" }));
    assert.equal(ok(await li.gb("link", { owner: g.owner, id: g.id })).link.isOwner, false);
    const off = ok(await john.gb("link-rules", { owner: g.owner, id: g.id, forward: false })).link;
    assert.equal(off.forward, false);
    bad(await li.gb("link", { owner: g.owner, id: g.id }), "link.ownerOnly");
    const swapped = ok(await john.gb("rotate", { owner: g.owner, id: g.id })).link;
    assert.notEqual(swapped.code, first.code);
    const wang = person();
    await login(wang, "13700137000");
    bad(await wang.gb("join", { url: first.url, name: "王五" }), "link.gone");
    assert.equal(ok(await john.gb("link-rules", { owner: g.owner, id: g.id, approve: true })).link.approve, true);
    const waiting = ok(await wang.gb("join", { url: swapped.url, name: "王五" }));
    assert.equal(waiting.joined.pending, "request-1");
    assert.deepEqual(waiting.view.rows, [], "not in until the owner says yes");
  } finally {
    await s.close();
  }
});

test("my avatars (spec §7.5) and the language (§7.6): rename one, turn its marking off, set the default name, change the language; the relay's refusals come back in it", async () => {
  const { s, person, login } = await world();
  try {
    const john = person();
    await login(john, "13800138000");
    const g = ok(await john.gb("group", { name: "家长群", avatarName: "Lily 爸爸" })).chat;
    const a = g.as.id;
    const renamed = ok(await john.gb("rename", { avatar: a, name: "乐乐爸爸" })).view;
    assert.deepEqual(renamed.avatars.map((x) => [x.name, x.venues, x.mark]), [["乐乐爸爸", ["家长群"], true]]);
    assert.equal(ok(await john.gb("mark", { avatar: a, mark: false })).view.avatars[0].mark, false);
    assert.equal(ok(await john.gb("default-name", { name: "老张" })).view.defaultName, "老张");
    assert.equal(ok(await john.gb("lang", { lang: "en" })).view.lang, "en");
    assert.equal(bad(await john.gb("rename", { avatar: a, name: " " }), "name.empty").reason, "The name cannot be empty");
    assert.equal(bad(await john.gb("join", { url: "https://elsewhere.example/i/abcd9ahe" }), "client.otherRelay").reason, "This link is not from GemsBang (elsewhere.example); not followed");
  } finally {
    await s.close();
  }
});

test("the model's tools (spec §4.1, transport §2.4): a session speaks for the avatar it joined as, with that avatar's own token, so its lines are `by: agent`; it reads only that avatar's chats; with no avatar it is told how to get one", async () => {
  const { s, person, login } = await world();
  try {
    const john = person();
    await login(john, "13800138000");
    const work = ok(await john.gb("group", { name: "设置页改版", avatarName: "John" })).chat;
    const family = ok(await john.gb("group", { name: "家长群", avatarName: "Lily 爸爸" })).chat;
    const link = ok(await john.gb("link", { owner: work.owner, id: work.id })).link;
    const li = person();
    await login(li, "13900139000");
    bad(await li.gb("tool-read", { session: "s-1" }), "body.none");
    ok(await li.gb("join", { url: link.url, name: "李四", session: "s-1" }));
    assert.match(ok(await li.gb("tool-read", { session: "s-1" })).text, new RegExp(`^「李四」在的场合：\\n${work.owner}/${work.id} · 「设置页改版」$`));
    const sent = ok(await li.gb("tool-say", { session: "s-1", venue: `${work.owner}/${work.id}`, text: "我先看看" }));
    assert.equal(sent.text, "已发到「设置页改版」，以「李四」");
    assert.match(ok(await li.gb("tool-read", { session: "s-1", venue: `${work.owner}/${work.id}`, limit: 5 })).text, /「设置页改版」最近 1 条：\n#m-[0-9a-f]{10} 李四（身份）（你）：我先看看/);
    const seen = ok(await john.gb("open", { owner: work.owner, id: work.id })).chat.items.at(-1);
    assert.deepEqual([seen.who, seen.mark], ["李四", true], "John sees the agent's line marked");
    bad(await li.gb("tool-say", { session: "s-1", venue: `${family.owner}/${family.id}`, text: "hi" }), "body.notHere");
    bad(await li.gb("tool-read", { session: "s-1", venue: `${family.owner}/${family.id}` }), "body.notHere");
    assert.equal(Object.keys(readClient(li.home).avatars).length, 1, "the avatar's token was asked for once and kept");
    ok(await li.gb("bind", { session: "s-1" }));
    assert.equal(ok(await li.gb("tool-say", { session: "s-1", venue: `${work.owner}/${work.id}`, text: "x" })).text, "已发到「设置页改版」，以「李四」", "a session given none plays the avatar last spoken as (S21)");
  } finally {
    await s.close();
  }
});

test("out of reach (transport §2.7): the last mirror stays readable and says why; logging out forgets the tokens; an invitation not followed is kept for the pane; an unknown call is refused", async () => {
  const { s, person, login } = await world();
  const john = person();
  await login(john, "13800138000");
  ok(await john.gb("group", { name: "设置页改版", avatarName: "John" }));
  ok(await john.gb("note", { url: "https://evil.example/i/abcd9ahe.md" }));
  await s.close();
  const offline = ok(await john.gb("status")).view;
  assert.deepEqual(offline.rows.map((r) => r.name), ["设置页改版"]);
  assert.match(offline.offline, /^连不上 GemsBang：/);
  assert.deepEqual(offline.notes.map((n) => n.url), ["https://evil.example/i/abcd9ahe.md"]);
  const out = ok(await john.gb("logout")).view;
  assert.deepEqual([out.loggedIn, out.relay], [false, s.url]);
  assert.equal(readClient(john.home).token, undefined);
  bad(await john.gb("fly"), "client.unknownCall");
});
