import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AvatarRelay } from "../dist/relay/avatars.js";
import { routeAvatars } from "../dist/relay/avatar-api.js";
import { groupPage } from "../dist/relay/avatar-pages.js";
import { cardsByFile, fileAdapter } from "../dist/relay/push.js";

test("需要你 over HTTP (spec §7.3): an avatar's token asks; the person lists every card and answers one, the words landing in the chat; the avatar's token lists its own open cards; the push channels on /me; no waiting line to set; the group's page carries the cards' words", () => {
  const root = mkdtempSync(join(tmpdir(), "gemsbang-needs-api-"));
  const texts = [];
  const relay = new AvatarRelay({ root, name: "relay.test", texter: (t) => { texts.push(t); }, push: [fileAdapter(root)] });
  const call = (method, path, o = {}) => {
    const res = routeAvatars({ method, path, query: {}, ...o }, relay);
    return { status: res.status, body: JSON.parse(res.body) };
  };
  const login = (phone) => {
    call("POST", "/login", { body: { phone } });
    return call("POST", "/login/verify", { body: { phone, code: /(\d{6})/.exec(texts.at(-1).text)[1] } }).body.token;
  };
  const john = login("13800138000");
  const g = call("POST", "/groups", { token: john, body: { avatar: { name: "Lily 爸爸" }, name: "三年二班家长" } }).body.venue;
  const lily = g.owner;
  const agent = call("POST", `/avatars/${lily}/token`, { token: john }).body.token;
  assert.deepEqual(call("POST", "/me/push", { token: john, body: { channel: "file" } }).body, { channels: ["file"], offered: ["file"] });
  assert.deepEqual(call("GET", "/me", { token: john }).body.push, ["file"]);
  const asked = call("POST", "/needs", { token: agent, body: { venue: `${g.owner}/${g.id}`, kind: "pay", summary: "春游车费 30 元", draft: "车费我转了", options: [{ label: "付款", text: "车费我转了" }, { label: "不付款" }] } });
  assert.equal(asked.status, 201);
  assert.equal(cardsByFile(root).length, 1);
  assert.deepEqual(call("GET", "/needs", { token: agent }).body.map((n) => n.summary), ["春游车费 30 元"]);
  const mine = call("GET", "/needs", { token: john }).body;
  assert.deepEqual(mine.map((n) => [n.avatarName, n.group, n.kind]), [["Lily 爸爸", "三年二班家长", "pay"]]);
  const answered = call("POST", `/needs/${lily}/${mine[0].id}`, { token: john, body: { choice: 0 } });
  assert.deepEqual([answered.status, answered.body.need.state, typeof answered.body.sent], [200, "answered", "string"]);
  assert.equal(call("POST", `/needs/${lily}/${mine[0].id}`, { token: john, body: { choice: 0 } }).body.reason, "该事项已处理");
  assert.deepEqual(call("GET", "/needs", { token: john }).body, []);
  assert.equal(call("POST", `/avatars/${lily}/placeholder`, { token: john, body: { text: "我看一下" } }).status, 404, "no waiting line to set");
  assert.equal(call("POST", "/needs", { token: john, body: { kind: "pay", summary: "x" } }).body.error, "as.required");
  const page = groupPage("en");
  assert.match(page, /"need.onlyYou":"Only you see this"/);
  assert.match(page, /"need.kind.borrow":"Task"/);
});
