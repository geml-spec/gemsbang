import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startAvatarRelay } from "../dist/relay/avatar-server.js";
import { runGb } from "../dist/gemsbang/ops.js";

/** A service whose clock can jump; machines that sign in to it by email, each counting the paths it asks for. */
async function world() {
  const mail = [];
  let offset = 0;
  const now = () => new Date(Date.now() + offset).toISOString().replace(/\.\d{3}Z$/, "Z");
  const s = await startAvatarRelay({ root: mkdtempSync(join(tmpdir(), "gemsbang-sync-relay-")), name: "relay.test", now, mailer: (m) => { mail.push(m); } });
  const machine = () => {
    const home = mkdtempSync(join(tmpdir(), "gemsbang-sync-home-")), asked = [];
    const fetchImpl = (url, init) => { asked.push(`${init?.method ?? "GET"} ${new URL(url).pathname}`); return fetch(url, init); };
    const gb = (call, args = {}) => runGb(call, args, { home, now: now(), service: s.url, fetchImpl });
    return { home, gb, asked };
  };
  const ok = (x) => { assert.equal(x.ok, true, x.reason); return x; };
  const signIn = async (email, name) => {
    const m = machine();
    ok(await m.gb("login-start", { email }));
    ok(await m.gb("login-verify", { email, code: /(\d{6})/.exec(mail[mail.length - 1].text)[1] }));
    ok(await m.gb("first-avatar", { name }));
    return m;
  };
  return { s, machine, signIn, ok, jump: (ms) => { offset += ms; } };
}

test("the cache (architecture §6.1): the number the box was read to and each chat in a file of its own, its lines by id; signing out leaves nothing", async () => {
  const { s, signIn, ok } = await world();
  try {
    const john = await signIn("john@example.com", "John");
    const g = ok(await john.gb("group", { name: "设置页改版", as: ok(await john.gb("status")).view.avatars[0].id })).chat;
    const state = JSON.parse(readFileSync(join(john.home, "cache", "state.json"), "utf8"));
    assert.equal(typeof state.pts, "number");
    assert.deepEqual(state.venues, [`${g.owner}/${g.id}`]);
    assert.deepEqual(readdirSync(join(john.home, "cache", "venues")), [`${g.owner}-${g.id}.json`]);
    assert.equal(existsSync(join(john.home, "mirror.json")), false);
    ok(await john.gb("logout"));
    assert.equal(existsSync(join(john.home, "cache")), false);
  } finally { await s.close(); }
});

test("catching up (architecture §5.3): a line said elsewhere arrives with one difference — no chat read again; someone new in a chat, that chat read again; a wait answers the moment a line lands", async () => {
  const { s, signIn, ok } = await world();
  try {
    const john = await signIn("john@example.com", "John"), li = await signIn("li@example.com", "李四"), wang = await signIn("wang@example.com", "王五");
    const g = ok(await john.gb("group", { name: "设置页改版", as: ok(await john.gb("status")).view.avatars[0].id })).chat;
    const link = ok(await john.gb("link", { owner: g.owner, id: g.id })).link;
    ok(await li.gb("join", { url: link.url, as: ok(await li.gb("status")).view.avatars[0].id }));
    ok(await john.gb("status"));
    ok(await li.gb("say", { owner: g.owner, id: g.id, text: "Safari 里导出按钮没反应" }));
    john.asked.length = 0;
    const box = ok(await john.gb("status")).view;
    assert.deepEqual(box.rows.map((r) => [r.name, r.last.text, r.unread]), [["设置页改版", "Safari 里导出按钮没反应", 1]]);
    assert.deepEqual(john.asked, ["GET /updates/difference"], "one call, nothing read again");
    ok(await wang.gb("join", { url: link.url, as: ok(await wang.gb("status")).view.avatars[0].id }));
    john.asked.length = 0;
    const opened = ok(await john.gb("open", { owner: g.owner, id: g.id })).chat;
    assert.equal(opened.count, 3);
    assert.deepEqual(john.asked, ["GET /updates/difference", `GET /venues/${g.owner}/${g.id}`], "the chat with someone new read again");
    const started = Date.now();
    const waiting = john.gb("wait", { timeout: 10 });
    setTimeout(() => { void li.gb("say", { owner: g.owner, id: g.id, text: "我先看看" }); }, 300);
    const waited = ok(await waiting).view;
    assert.ok(Date.now() - started < 5000, "back when the line landed");
    assert.equal(waited.rows[0].last.text, "我先看看");
  } finally { await s.close(); }
});

test("too far behind (architecture §5.1): a machine back after more than a week reads everything again; out of reach, the cache as it was, with why", async () => {
  const { s, signIn, ok, jump } = await world();
  try {
    const john = await signIn("john@example.com", "John"), li = await signIn("li@example.com", "李四");
    const g = ok(await john.gb("group", { name: "设置页改版", as: ok(await john.gb("status")).view.avatars[0].id })).chat;
    const link = ok(await john.gb("link", { owner: g.owner, id: g.id })).link;
    ok(await li.gb("join", { url: link.url, as: ok(await li.gb("status")).view.avatars[0].id }));
    ok(await john.gb("status"));
    jump(8 * 86_400_000);
    ok(await li.gb("say", { owner: g.owner, id: g.id, text: "还在吗" }));
    jump(8 * 86_400_000);
    ok(await li.gb("say", { owner: g.owner, id: g.id, text: "周五见" }));
    john.asked.length = 0;
    const back = ok(await john.gb("status")).view;
    assert.deepEqual(john.asked.slice(0, 2), ["GET /updates/difference", "GET /updates/state"], "told it is too far behind, it starts over");
    assert.equal(back.rows[0].last.text, "周五见");
    await s.close();
    const out = ok(await john.gb("status")).view;
    assert.deepEqual([out.rows[0].last.text, typeof out.offline], ["周五见", "string"]);
  } finally { await s.close(); }
});
