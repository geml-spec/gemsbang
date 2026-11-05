import { test } from "node:test";
import assert from "node:assert/strict";
import { AvatarRelay } from "../dist/relay/avatars.js";
import { memoryStore } from "../dist/relay/doc-store.js";
import { answerRequest } from "../dist/relay/avatar-shell.js";

/** A relay in memory, its mail kept; `ask` one request the way any shell would hand it over. */
function shell() {
  const mail = [];
  const relay = new AvatarRelay({ store: memoryStore(), name: "gemsbang.com", mailer: (m) => { mail.push(m); } });
  const ask = async (method, path, o = {}) => {
    const out = await answerRequest(relay, { method, url: new URL(path, "https://gemsbang.com"), base: "https://gemsbang.com", body: async () => (o.tooLarge ? undefined : o.raw !== undefined ? o.raw : o.body !== undefined ? JSON.stringify(o.body) : ""), ...(o.token ? { authorization: `Bearer ${o.token}` } : {}), ...(o.accept ? { accept: o.accept } : {}), ...(o.languages ? { languages: o.languages } : {}), ...(o.gone ? { gone: o.gone } : {}) });
    return { ...out, json: out.type.startsWith("application/json") ? JSON.parse(out.body) : undefined };
  };
  const signIn = async (email) => {
    await ask("POST", "/login", { body: { email } });
    return (await ask("POST", "/login/verify", { body: { email, code: /(\d{6})/.exec(mail[mail.length - 1].text)[1] } })).json.token;
  };
  return { relay, ask, signIn };
}

test("one core for every shell (architecture §2.4): a browser gets the page in its language, a script the JSON; a body too large or not JSON is refused in the asker's language; the token from the header", async () => {
  const { ask, signIn } = shell();
  const page = await ask("GET", "/login", { accept: "text/html", languages: "ja" });
  assert.deepEqual([page.status, page.type.startsWith("text/html"), /<html lang="ja">/.test(page.body)], [200, true, true]);
  assert.deepEqual((await ask("GET", "/")).json, { name: "gemsbang.com", kind: "gemsbang" });
  assert.deepEqual((await ask("POST", "/login", { tooLarge: true, languages: "en" })).json, { error: "body.tooLarge", reason: "The body is over 1 MB" });
  assert.equal((await ask("POST", "/login", { raw: "{nope", languages: "en" })).json.reason, "The body is not JSON");
  const token = await signIn("john@example.com");
  assert.equal((await ask("GET", "/me", { token })).json.scope, "person");
});

test("a wait on the box, in any shell (architecture §5.2): held while nothing is after `pts`, answered when something lands, or when the asker goes away", async () => {
  const { ask, signIn } = shell();
  const token = await signIn("john@example.com");
  await ask("POST", "/avatars", { token, body: { name: "John" } });
  const pts = (await ask("GET", "/updates/state", { token })).json.pts;
  let answered = false;
  const waiting = ask("GET", `/updates?pts=${pts}&timeout=20`, { token }).then((r) => { answered = true; return r; });
  await new Promise((done) => setTimeout(done, 50));
  assert.equal(answered, false, "held");
  await ask("POST", "/me/default-name", { token, body: { name: "老张" } });
  const got = (await waiting).json;
  assert.deepEqual(got.updates.map((u) => u.pts), [pts + 1]);
  let leave;
  const gone = new Promise((done) => { leave = done; });
  const left = ask("GET", `/updates?pts=${got.pts}&timeout=20`, { token, gone });
  leave();
  assert.deepEqual((await left).json.updates, [], "the asker went away: answered empty, nothing held");
});

test("an avatar's own link in a browser (S37): /u/<code> is the page that starts the two-person chat, in the browser's language; for a script, its facts as JSON", async () => {
  const { ask, signIn } = shell();
  const token = await signIn("john@example.com");
  const avatar = (await ask("POST", "/avatars", { token, body: { name: "John" } })).json.avatar.id;
  const code = (await ask("GET", `/avatars/${avatar}/link`, { token })).json.link.code;
  const page = await ask("GET", `/u/${code}`, { accept: "text/html", languages: "zh" });
  assert.deepEqual([page.status, page.type.startsWith("text/html"), page.body.includes('api("GET", "/u/" + code)'), page.body.includes("与「{name}」私聊")], [200, true, true, true]);
  assert.equal((await ask("GET", `/u/${code}`)).json.avatar.name, "John");
});
