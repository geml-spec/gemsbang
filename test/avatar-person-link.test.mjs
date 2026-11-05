import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AvatarRelay } from "../dist/relay/avatars.js";
import { routeAvatars } from "../dist/relay/avatar-api.js";
import { readDoc } from "../dist/relay/store.js";
import { contactsOf } from "../dist/core/avatar/contacts.js";
import { invitesIn, parseInvite, personInvitePrompt } from "../dist/core/avatar/invite.js";
import { say } from "../dist/core/avatar/words.js";

const BASE = Date.UTC(2026, 10, 5, 9, 0, 0);
function relay(o = {}) {
  let offset = 0;
  const texts = [], mails = [];
  const now = () => { const t = new Date(BASE + offset).toISOString().replace(/\.\d{3}Z$/, "Z"); offset += 1000; return t; };
  const r = new AvatarRelay({ root: mkdtempSync(join(tmpdir(), "gemsbang-relay-")), name: "relay.test", now, texter: (t) => { texts.push(t); }, mailer: (m) => { mails.push(m); }, ...o });
  r.texts = texts; r.mails = mails;
  r.advance = (ms) => { offset += ms; };
  return r;
}
const ok = (x) => { assert.equal(x.ok, true, x.reason); return x; };
const bad = (x, status, code) => { assert.equal(x.ok, false); assert.equal(x.status, status, x.reason); if (code !== undefined) assert.equal(x.code, code); return x; };
const codeIn = (t) => t.text.match(/(\d{6})/)[1];
function login(r, phone) {
  ok(r.startLogin({ phone }));
  const done = ok(r.finishLogin({ phone, code: codeIn(r.texts.at(-1)) }));
  return { by: r.verify(done.token), person: done.person, token: done.token };
}

test("an avatar's own link (S37): /u/<code> beside a group's /i/<code>; both parsed with their kind; the line for an agent names the avatar", () => {
  assert.deepEqual(parseInvite("https://gemsbang.com/u/k7pqm3ab.md"), { origin: "https://gemsbang.com", code: "k7pqm3ab", md: true, kind: "person" });
  assert.equal(parseInvite("https://gemsbang.com/i/k7pqm3ab").kind, "group");
  assert.equal(parseInvite("https://gemsbang.com/x/k7pqm3ab"), undefined);
  assert.deepEqual(invitesIn("读 https://gemsbang.com/u/k7pqm3ab.md 和 https://gemsbang.com/i/abcd9ahe.md"), ["https://gemsbang.com/u/k7pqm3ab.md", "https://gemsbang.com/i/abcd9ahe.md"]);
  assert.equal(personInvitePrompt("https://gemsbang.com", "k7pqm3ab", "John", "zh"), "请阅读 https://gemsbang.com/u/k7pqm3ab.md 并按说明操作：以我的身份与 John 私聊。");
});

test("the link kept per avatar (S37): its person or its own agent gets the current one, the same for seven days, then a new one; a reset stops the old one at once; someone else's avatar is refused; a group's code is not an avatar's, nor the other way round", () => {
  const r = relay();
  const john = login(r, "13800138000");
  const johnA = ok(r.growAvatar(john.by, { name: "John" })).avatar;
  const first = ok(r.personLinkFor(john.by, johnA.id)).link;
  assert.equal(first.path, `/u/${first.code}`);
  assert.equal(ok(r.personLinkFor(john.by, johnA.id)).link.code, first.code, "the same until it runs out");
  const agent = r.verify(ok(r.issueAvatar(john.by, johnA.id)).token);
  assert.equal(ok(r.personLinkFor(agent, johnA.id)).link.code, first.code, "its own agent hands out the same one");
  const mei = login(r, "13900139000");
  bad(r.personLinkFor(mei.by, johnA.id), 403, "avatar.notYours");
  r.advance(8 * 24 * 3_600_000);
  const later = ok(r.personLinkFor(john.by, johnA.id)).link;
  assert.notEqual(later.code, first.code, "past its seven days: a new one");
  const reset = ok(r.rotatePersonLink(john.by, johnA.id)).link;
  bad(r.personLinkInfo(later.code, undefined), 410, "link.gone");
  ok(r.personLinkInfo(reset.code, undefined));
  const g = ok(r.createGroup(john.by, { as: johnA.id, name: "设置页改版" })).venue;
  const groupCode = ok(r.linkFor(john.by, g.owner, g.id, { as: johnA.id })).link.code;
  bad(r.personLinkInfo(groupCode, undefined), 404, "link.missing");
  bad(r.linkInfo(reset.code, undefined), 404, "link.missing");
});

test("in through an avatar's link (S37, Q25 (a)): a person with a token is in a two-person chat with it at once, no group shared; again, the same chat; the two are each other's contacts; one's own link is refused; with no token, an email and its code first", () => {
  const r = relay();
  const john = login(r, "13800138000");
  const johnA = ok(r.growAvatar(john.by, { name: "John" })).avatar;
  const code = ok(r.personLinkFor(john.by, johnA.id)).link.code;
  const mei = login(r, "13900139000");
  const meiA = ok(r.growAvatar(mei.by, { name: "Mei" })).avatar;
  const info = ok(r.personLinkInfo(code, mei.by));
  assert.deepEqual([info.avatar.name, info.you.pick], ["John", { kind: "known", avatar: meiA.id }], "her only avatar talks");
  const joined = ok(r.joinByPersonLink(mei.by, code, {}));
  assert.deepEqual([joined.venue.kind, joined.venue.name, joined.avatar.id, joined.already], ["dm", "John", meiA.id, false]);
  assert.deepEqual(ok(r.personLinkInfo(code, mei.by)).you.pick, { kind: "in", avatar: meiA.id });
  const again = ok(r.joinByPersonLink(mei.by, code, {}));
  assert.deepEqual([again.venue.id, again.already], [joined.venue.id, true], "one chat per pair");
  const venue = readDoc(r.root, joined.venue.owner, `venues/${joined.venue.id}.geml`).blocks.find((b) => b.id === "venue").value;
  assert.deepEqual([venue.kind, venue.via], ["dm", "link"], "the chat says it began from the link");
  const mirror = (person) => ({ at: "", relay: "", person, lang: "zh", avatars: r.avatarsOf(person), venues: r.venuesOf(person).map((v) => ({ ...v, blocks: [] })) });
  assert.deepEqual(contactsOf(mirror(john.person)).map((c) => [c.name, c.dm?.id]), [["Mei", joined.venue.id]]);
  assert.deepEqual(contactsOf(mirror(mei.person)).map((c) => [c.name, c.dm?.id]), [["John", joined.venue.id]]);
  bad(r.joinByPersonLink(john.by, code, {}), 400, "link.self");
  ok(r.startLogin({ email: "zhou@example.com" }));
  const mailed = r.mails.at(-1).text.match(/(\d{6})/)[1];
  const viaCode = ok(r.joinWithPersonCode(code, { email: "zhou@example.com", code: mailed, name: "周", device: "Mac · Claude Code" }));
  assert.deepEqual([viaCode.venue.kind, viaCode.avatar.name, typeof viaCode.token, typeof viaCode.device], ["dm", "周", "string", "string"], "the agent's way: the avatar's token and the device's");
  assert.equal(readDoc(r.root, "_relay", `links/${code}.geml`).blocks.filter((b) => b.id.startsWith("use-")).length, 2, "two chats began from it");
});

test("the routes (S37): /u/<code> answers its facts and, as .md, the agent's instructions; /u/<code>/join with a token or with a code; /avatars/<id>/link hands out and resets; a web person gets a mail for a line in the chat", () => {
  const r = relay();
  const call = (method, path, o = {}) => { const [p, q] = path.split("?"); const x = routeAvatars({ method, path: p, query: Object.fromEntries(new URLSearchParams(q ?? "")), body: o.body, token: o.token, base: "https://gemsbang.test", languages: "zh" }, r); return x.type?.startsWith("application/json") ? { ...x, body: JSON.parse(x.body) } : x; };
  const john = login(r, "13800138000");
  const johnA = ok(r.growAvatar(john.by, { name: "John" })).avatar;
  const link = call("GET", `/avatars/${johnA.id}/link`, { token: john.token });
  assert.equal(link.status, 200, link.body.reason);
  const code = link.body.link.code;
  const md = call("GET", `/u/${code}.md`);
  assert.equal(md.status, 200);
  assert.match(md.body, /^# 与 GemsBang 的「John」私聊/);
  assert.equal(md.body.includes(`https://gemsbang.test/u/${code}/join`), true);
  for (const lang of ["zh", "en", "ja"]) {
    const text = say("md.dm", lang, { name: "John", days: 7, relay: "https://im.example", join: "https://im.example/u/abcd9abp/join" });
    assert.equal((text.match(/^\d\. /gm) ?? []).length, 4, `${lang}: four steps, as for a group`);
    assert.equal(text.includes("{"), text.includes('{"'), `${lang}: every blank filled`);
  }
  ok(r.startLogin({ email: "mei@example.com" }));
  const mailed = r.mails.at(-1).text.match(/(\d{6})/)[1];
  const web = call("POST", `/u/${code}/join`, { body: { email: "mei@example.com", code: mailed, name: "Mei", device: "网页 · Safari" } });
  assert.equal(web.status, 201, web.body.reason);
  const dm = web.body.venue;
  assert.equal(call("POST", `/avatars/${johnA.id}/link`, { token: john.token }).body.link.code === code, false, "reset: a new code");
  assert.equal(call("GET", `/u/${code}`).status, 410);
  const before = r.mails.length;
  ok(r.say(john.by, dm.owner, dm.id, { as: johnA.id, text: "你好，周五有空吗？", id: "p-1" }));
  assert.equal(r.mails.length, before + 1, "a web person hears of a line in the two-person chat");
  assert.match(r.mails.at(-1).subject, /John 给你发了私聊消息/);
});
