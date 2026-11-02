import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startAvatarRelay } from "../dist/relay/avatar-server.js";

async function serve() {
  const mail = [];
  const s = await startAvatarRelay({ root: mkdtempSync(join(tmpdir(), "gemsbang-box-api-")), name: "relay.test", mailer: (m) => { mail.push(m); } });
  const call = async (method, path, o = {}) => {
    const res = await fetch(`${s.url}${path}`, { method, headers: { ...(o.token ? { authorization: `Bearer ${o.token}` } : {}), ...(o.body ? { "content-type": "application/json" } : {}) }, ...(o.body ? { body: JSON.stringify(o.body) } : {}) });
    return { status: res.status, body: await res.json() };
  };
  const person = async (email, name) => {
    await call("POST", "/login", { body: { email } });
    const token = (await call("POST", "/login/verify", { body: { email, code: /(\d{6})/.exec(mail[mail.length - 1].text)[1] } })).body.token;
    const avatar = (await call("POST", "/avatars", { token, body: { name } })).body.avatar;
    return { token, avatar };
  };
  return { s, call, person };
}

test("the box over HTTP (architecture §5.2): where it stands, the difference after a number, a refusal for a bad one; the agent's token has no box", async () => {
  const { s, call, person } = await serve();
  try {
    const john = await person("john@example.com", "John");
    const state = (await call("GET", "/updates/state", { token: john.token })).body;
    assert.equal(state.pts, 4);
    const d = (await call("GET", "/updates/difference?pts=2&limit=1", { token: john.token })).body;
    assert.deepEqual([d.updates.map((u) => u.pts), d.pts, d.final], [[3], 3, false]);
    assert.equal((await call("GET", "/updates/difference?pts=x", { token: john.token })).body.error, "updates.pts");
    const agent = (await call("POST", `/avatars/${john.avatar.id}/token`, { token: john.token })).body.token;
    assert.equal((await call("GET", "/updates/state", { token: agent })).status, 403);
    assert.equal((await call("GET", "/updates?pts=0", { token: john.token })).body.updates.length, 4, "no timeout, no wait");
  } finally { await s.close(); }
});

test("waiting for updates (architecture §5.2): held open while the box has nothing after the number, answered the moment a line lands; at the time asked, answered empty", async () => {
  const { s, call, person } = await serve();
  try {
    const john = await person("john@example.com", "John"), li = await person("li@example.com", "李四");
    const g = (await call("POST", "/groups", { token: john.token, body: { as: john.avatar.id, name: "设置页改版" } })).body.venue;
    const code = (await call("GET", `/venues/${g.owner}/${g.id}/link?as=${john.avatar.id}`, { token: john.token })).body.link.code;
    await call("POST", `/i/${code}/join`, { token: li.token, body: { as: li.avatar.id } });
    const pts = (await call("GET", "/updates/state", { token: john.token })).body.pts;
    const started = Date.now();
    const waiting = call("GET", `/updates?pts=${pts}&timeout=10`, { token: john.token });
    setTimeout(() => { void call("POST", `/venues/${g.owner}/${g.id}/messages`, { token: li.token, body: { as: li.avatar.id, text: "我进来了" } }); }, 300);
    const got = (await waiting).body;
    assert.ok(Date.now() - started < 5000, "answered when the line landed, not at the time asked");
    assert.deepEqual(got.updates.map((u) => [u.pts, u.block.value.text]), [[pts + 1, "我进来了"]]);
    const quiet = Date.now();
    const none = (await call("GET", `/updates?pts=${got.pts}&timeout=1`, { token: john.token })).body;
    assert.deepEqual([none.updates, none.pts, none.final], [[], got.pts, true]);
    assert.ok(Date.now() - quiet >= 900, "held for the time asked");
  } finally { await s.close(); }
});
