import { test } from "node:test";
import assert from "node:assert/strict";
import worker, { OBJECT_NAME, RelayObject } from "../dist/relay/worker.js";
import { nodeSql } from "../dist/relay/doc-store.js";

/** node:sqlite where this Node has it (22.13 and later), else the tests say why they skipped. */
const sqlite = await import("node:sqlite").catch(() => undefined);
const skip = sqlite === undefined && "no node:sqlite in this Node";

/** The beta as Cloudflare runs it, with the runtime's parts stood in: the object's SQLite on node:sqlite, its alarm, the mail binding, the namespace that hands every request to the one object. */
function cloud() {
  let alarm = null, offset = 0;
  const sent = [], named = [];
  const state = { storage: { sql: nodeSql(new sqlite.DatabaseSync(":memory:")), setAlarm: async (t) => { alarm = t; }, getAlarm: async () => alarm, deleteAlarm: async () => { alarm = null; } } };
  const env = { NAME: "gemsbang.com", MAIL_FROM: "noreply@gemsbang.com", VERSION: "9.9.9", EMAIL: { send: async (m) => { sent.push(m); return { messageId: "m-1" }; } }, RELAY: { idFromName: (n) => { named.push(n); return n; }, get: () => object } };
  const object = new RelayObject(state, env, { now: () => new Date(Date.now() + offset).toISOString().replace(/\.\d{3}Z$/, "Z") });
  const call = async (method, path, o = {}) => {
    const res = await worker.fetch(new Request(`https://gemsbang.com${path}`, { method, headers: { ...(o.token ? { authorization: `Bearer ${o.token}` } : {}), ...(o.accept ? { accept: o.accept } : {}), ...(o.body ? { "content-type": "application/json" } : {}) }, ...(o.body ? { body: JSON.stringify(o.body) } : {}) }), env);
    const type = res.headers.get("content-type") ?? "", text = await res.text();
    return { status: res.status, type, body: type.startsWith("application/json") ? JSON.parse(text) : text };
  };
  const signIn = async (email, name) => {
    await call("POST", "/login", { body: { email } });
    const token = (await call("POST", "/login/verify", { body: { email, code: /(\d{6})/.exec(sent[sent.length - 1].text)[1] } })).body.token;
    const avatar = (await call("POST", "/avatars", { token, body: { name } })).body.avatar;
    return { token, avatar };
  };
  return { object, sent, named, call, signIn, alarm: () => alarm, jump: (ms) => { offset += ms; } };
}

test("the Worker (architecture §2.3): every request to the one object; a sign-in code mailed through the binding from gemsbang.com, handed over before the answer; the pages for a browser; an agent's instructions naming gemsbang.com", { skip }, async () => {
  const { sent, named, call, signIn } = cloud();
  assert.deepEqual((await call("GET", "/")).body, { name: "gemsbang.com", kind: "gemsbang", version: "9.9.9" });
  assert.deepEqual([...new Set(named)], [OBJECT_NAME]);
  assert.deepEqual((await call("POST", "/login", { body: { email: "John@Example.com" } })).body, { sent: true, known: false, to: "j***@example.com", from: "gemsbang.com" });
  assert.deepEqual([sent[0].to, sent[0].from, /^Gemsbang 验证码 \d{6}$/.test(sent[0].subject)], ["john@example.com", { email: "noreply@gemsbang.com", name: "Gemsbang" }, true]);
  const john = await signIn("john@example.com", "John");
  assert.equal((await call("GET", "/me", { token: john.token })).body.avatars[0].name, "John");
  const page = await call("GET", "/login", { accept: "text/html" });
  assert.deepEqual([page.status, page.type.startsWith("text/html")], [200, true]);
  const g = (await call("POST", "/groups", { token: john.token, body: { as: john.avatar.id, name: "设置页改版" } })).body.venue;
  const code = (await call("GET", `/venues/${g.owner}/${g.id}/link?as=${john.avatar.id}`, { token: john.token })).body.link.code;
  const md = await call("GET", `/i/${code}.md`);
  assert.match(md.body, /https:\/\/gemsbang\.com\/i\/[a-z0-9]+\/join/);
});

test("the box inside the object (architecture §5.2): a wait is held there and answered the moment a line lands", { skip }, async () => {
  const { call, signIn } = cloud();
  const john = await signIn("john@example.com", "John");
  const pts = (await call("GET", "/updates/state", { token: john.token })).body.pts;
  const waiting = call("GET", `/updates?pts=${pts}&timeout=20`, { token: john.token });
  setTimeout(() => { void call("POST", "/me/default-name", { token: john.token, body: { name: "老张" } }); }, 50);
  assert.deepEqual((await waiting).body.updates.map((u) => u.pts), [pts + 1]);
});

test("deadlines as the object's alarm (architecture §2.3): a card with a deadline sets it; when it rings, the card is expired and the alarm moves on, or goes", { skip }, async () => {
  const { object, call, signIn, alarm, jump } = cloud();
  const john = await signIn("john@example.com", "John");
  const g = (await call("POST", "/groups", { token: john.token, body: { as: john.avatar.id, name: "设置页改版" } })).body.venue;
  const agent = (await call("POST", `/avatars/${john.avatar.id}/token`, { token: john.token })).body.token;
  assert.equal(alarm(), null);
  const expires = new Date(Date.now() + 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const asked = await call("POST", "/needs", { token: agent, body: { venue: `${g.owner}/${g.id}`, kind: "promise", summary: "周五前给稿子反馈", options: [{ label: "好" }], expires } });
  assert.equal(asked.status, 201, JSON.stringify(asked.body));
  assert.equal(alarm(), Date.parse(expires));
  jump(2 * 3_600_000);
  await object.alarm();
  assert.equal(alarm(), null, "nothing else waits with a deadline");
  assert.deepEqual((await call("GET", "/needs", { token: john.token })).body.map((n) => n.state), ["expired"]);
});
