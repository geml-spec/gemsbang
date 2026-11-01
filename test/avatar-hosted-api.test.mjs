import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AvatarRelay } from "../dist/relay/avatars.js";
import { AvatarHosted } from "../dist/relay/avatar-hosted.js";
import { routeAvatars } from "../dist/relay/avatar-api.js";
import { groupPage } from "../dist/relay/avatar-pages.js";

test("who pays over HTTP (spec §8.3): the person's quota and their own key at /me/quota and /me/payment, answered by the orchestrator, the key never echoed; a relay that hosts nobody says so; an avatar's token may not; 暂停自动回复 at /avatars/<a>/hosted; the group's page says where the avatars stopped calling each other", () => {
  const root = mkdtempSync(join(tmpdir(), "gemsbang-pay-api-"));
  const texts = [];
  const relay = new AvatarRelay({ root, name: "relay.test", texter: (t) => { texts.push(t); } });
  const hosted = new AvatarHosted({ relay, runner: async () => ({ ok: true, text: "" }) });
  const call = (method, path, o = {}, h = hosted) => {
    const res = routeAvatars({ method, path, query: {}, ...o }, relay, h ?? undefined);
    return { status: res.status, body: JSON.parse(res.body) };
  };
  call("POST", "/login", { body: { phone: "13800138000" } });
  const john = call("POST", "/login/verify", { body: { phone: "13800138000", code: /(\d{6})/.exec(texts.at(-1).text)[1] } }).body.token;
  const g = call("POST", "/groups", { token: john, body: { avatar: { name: "乐乐爸爸" }, name: "三年二班家长" } }).body.venue;
  const quota = call("GET", "/me/quota", { token: john }).body;
  assert.deepEqual([quota.free, quota.daysLeft, quota.repliesLeft, quota.key], [true, 7, 50, false]);
  const set = call("POST", "/me/payment", { token: john, body: { apiKey: "  sk-test-9  " } });
  assert.deepEqual([set.status, set.body.key, JSON.stringify(set.body).includes("sk-test-9")], [200, true, false]);
  assert.equal(hosted.hasKey(call("GET", "/me", { token: john }).body.person), true);
  assert.equal(call("POST", "/me/payment", { token: john, body: { apiKey: null } }).body.key, false);
  assert.deepEqual(Object.values(call("POST", "/me/payment", { token: john, body: { apiKey: "" } })), [400, { error: "hosted.key", reason: "apiKey 要是一串字，或 null 移除" }]);
  assert.deepEqual(Object.values(call("GET", "/me/quota", { token: john }, null)), [404, { error: "hosted.noOrchestrator", reason: "这个中继没有托管 agent" }]);
  const agent = call("POST", `/avatars/${g.owner}/token`, { token: john }).body.token;
  assert.equal(call("GET", "/me/quota", { token: agent }).status, 403);
  assert.deepEqual(call("POST", `/avatars/${g.owner}/hosted`, { token: john, body: { paused: true } }).body, { paused: true });
  assert.equal(relay.hostedOf(g.owner).paused, true);
  const page = groupPage("en");
  assert.match(page, /"page\.group\.hops":"The avatars have called each other three times; it stops here until a person picks it up"/);
  assert.match(page, /note-\\d\+\$/, "the group's page draws the line where the avatars stopped");
});
