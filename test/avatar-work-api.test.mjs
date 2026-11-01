import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AvatarRelay } from "../dist/relay/avatars.js";
import { routeAvatars } from "../dist/relay/avatar-api.js";
import { groupPage } from "../dist/relay/avatar-pages.js";

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

test("jobs over HTTP: the person lists theirs at /work and their computer moves one at /work/<avatar>/<id>; an avatar's token may not; the group's page draws the facts under a line", () => {
  const w = world();
  const n = w.asks("修一下");
  ok(w.r.answerNeed(w.john.by, w.me.id, n.id, { choice: 0 }));
  const call = (method, path, o = {}) => { const res = routeAvatars({ method, path, query: {}, ...o }, w.r); return { status: res.status, body: JSON.parse(res.body) }; };
  const list = call("GET", "/work", { token: w.john.token });
  assert.deepEqual([list.status, list.body.map((x) => x.words)], [200, ["修一下"]]);
  const agent = ok(w.r.issueAvatar(w.john.by, w.me.id)).token;
  assert.equal(call("GET", "/work", { token: agent }).status, 403);
  const moved = call("POST", `/work/${w.me.id}/${list.body[0].id}`, { token: w.john.token, body: { state: "taken" } });
  assert.deepEqual([moved.status, moved.body.work.state], [200, "taken"]);
  assert.equal(call("POST", `/work/${w.me.id}/${list.body[0].id}`, { token: agent, body: { state: "done", text: "x" } }).status, 403);
  const page = groupPage("en");
  assert.match(page, /"page\.group\.facts":"Verified: \{facts\}"/);
  assert.match(page, /v\.facts\.map/);
});
