import { test } from "node:test";
import assert from "node:assert/strict";
import { AvatarRelay } from "../dist/relay/avatars.js";
import { routeAvatars } from "../dist/relay/avatar-api.js";
import { memoryStore } from "../dist/relay/doc-store.js";

const ok = (x) => { assert.equal(x.ok, true, x.reason); return x; };
const codeIn = (text) => text.match(/(\d{6})/)[1];

test("the relay on a store of its own (architecture §2.3): with no folder, everything — people, avatars, groups, lines, cards, links, tokens, the salt — lives in the store, and the HTTP routes answer the same", () => {
  const texts = [];
  const store = memoryStore();
  const r = new AvatarRelay({ store, name: "relay.test", texter: (t) => { texts.push(t); } });
  assert.equal(r.root, undefined);
  const login = (phone) => {
    ok(r.startLogin({ phone }));
    const done = ok(r.finishLogin({ phone, code: codeIn(texts.at(-1).text) }));
    return { by: r.verify(done.token), person: done.person, token: done.token };
  };
  const john = login("13800138000"), li = login("13900139000");
  const me = ok(r.growAvatar(john.by, { name: "John" })).avatar;
  const liA = ok(r.growAvatar(li.by, { name: "李四" })).avatar;
  const g = ok(r.createGroup(john.by, { as: me.id, name: "设置页改版" })).venue;
  ok(r.addMember(john.by, g.owner, g.id, { as: me.id, avatar: liA.id }));
  const line = ok(r.say(li.by, g.owner, g.id, { as: liA.id, text: "@John 周五前能给反馈吗？" })).message;
  const agent = r.verify(ok(r.issueAvatar(john.by, me.id)).token);
  ok(r.ask(agent, { venue: `${g.owner}/${g.id}`, kind: "promise", summary: "李四要周五前的反馈", message: line.id }));
  assert.deepEqual(r.needsOf(john.person).map((n) => [n.kind, n.group]), [["promise", "设置页改版"]]);
  const link = ok(r.linkFor(john.by, g.owner, g.id, { as: me.id })).link;
  assert.equal(ok(r.linkInfo(link.code, undefined)).group.name, "设置页改版");
  assert.deepEqual(store.list(g.owner, "venues"), [`venues/${g.id}.geml`]);
  assert.equal(store.read("_relay", "tokens.geml").blocks.length, 3, "two people's tokens and an avatar's");
  const res = routeAvatars({ method: "GET", path: `/venues/${g.owner}/${g.id}`, query: {}, base: "https://im.example", token: john.token }, r);
  assert.deepEqual([res.status, JSON.parse(res.body).blocks.filter((b) => typeof b.value.text === "string").map((b) => b.value.text)], [200, ["@John 周五前能给反馈吗？"]]);
  assert.equal(new AvatarRelay({ store, name: "relay.test", texter: () => undefined }).verify(john.token)?.speaker, `person:${john.person}`, "a second relay on the same store knows the same tokens");
  assert.throws(() => new AvatarRelay({ name: "nowhere" }), /a root or a store/);
});
