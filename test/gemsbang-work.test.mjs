import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startAvatarRelay } from "../dist/relay/avatar-server.js";
import { runGb } from "../dist/gemsbang/ops.js";

const ok = (x) => { assert.equal(x.ok, true, x.reason); return x; };
const git = (dir, ...args) => { const r = spawnSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); return r.stdout; };
/** A git repository with a package.json of two scripts, committed. */
function repo() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "gemsbang-repo-")));
  git(dir, "init", "-q");
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "app", scripts: { test: "node --test", build: "tsc" } }));
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src", "settings.ts"), "export const cache = 1;\n");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "first");
  return dir;
}

test("任务 in the client (spec §7.4, §7.5; once called 借电脑): each avatar's repository on this machine; a borrow card shows it; 现在干 makes a job; a session in another repository does not take it and the person is told; in the named one, a worktree of its own and the envelope; done, the words and the facts back in the chat; 排着, then now", async () => {
  const texts = [];
  const s = await startAvatarRelay({ root: mkdtempSync(join(tmpdir(), "gemsbang-work-relay-")), name: "relay.test", texter: (t) => { texts.push(t); } });
  try {
    const home = mkdtempSync(join(tmpdir(), "gemsbang-work-home-"));
    const gb = (call, args = {}) => runGb(call, args, { home, now: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), zoneMinutes: 0 });
    ok(await gb("setup", { relay: s.url }));
    ok(await gb("login-start", { phone: "13800138000" }));
    ok(await gb("login-verify", { phone: "13800138000", code: /(\d{6})/.exec(texts.at(-1).text)[1] }));
    const g = ok(await gb("group", { name: "设置页改版", avatarName: "John" })).chat;
    const venue = `${g.owner}/${g.id}`;
    ok(await gb("bind", { session: "s-1", avatar: g.as.id }));
    const r = s.relay;
    ok(r.startLogin({ phone: "13900139000" }));
    const li = r.verify(ok(r.finishLogin({ phone: "13900139000", code: /(\d{6})/.exec(texts.at(-1).text)[1] })).token);
    const liA = ok(r.growAvatar(li, { name: "李四" })).avatar;
    const john = r.verify(JSON.parse(readFileSync(join(home, "client.json"), "utf8")).token);
    ok(r.addMember(john, g.owner, g.id, { as: g.as.id, avatar: liA.id }));
    const app = repo(), other = repo();
    assert.equal((await gb("repo", { avatar: g.as.id, path: "app" })).code, "repo.notAbsolute");
    const plain = mkdtempSync(join(tmpdir(), "gemsbang-plain-"));
    assert.equal((await gb("repo", { avatar: g.as.id, path: plain })).reason, `${plain} 不在一个 git 仓库里`);
    assert.equal(ok(await gb("repo", { avatar: g.as.id, path: join(app, "src") })).view.avatars[0].repo, app, "the top of the repository");
    const borrow = async (text, choice) => {
      const line = ok(r.say(li, g.owner, g.id, { as: liA.id, text })).message;
      ok(await gb("tool-ask", { session: "s-1", venue, kind: "borrow", summary: `改：${text}`, replyTo: line.id, from: liA.id }));
      const card = ok(await gb("status")).view.needs.find((n) => n.kind === "borrow");
      assert.equal(card.repo, app);
      return ok(await gb("answer", { avatar: card.avatar, need: card.id, choice })).view.work.at(-1);
    };
    const first = await borrow("设置页的缓存写错了", 0);
    assert.deepEqual([first.state, first.words, first.fromName, first.group, first.repo, first.badge.initial], ["waiting", "设置页的缓存写错了", "李四", "设置页改版", app, "J"]);
    assert.equal((await gb("work-take", { session: "s-2", avatar: g.as.id, work: first.id, root: app })).code, "body.none", "only the session that speaks for it");
    const wrong = await gb("work-take", { session: "s-1", avatar: g.as.id, work: first.id, root: join(other, "src") });
    assert.equal(wrong.reason, `这个会话在 ${other}，「John」指定的仓库是 ${app}，对不上，这件活没动：改：设置页的缓存写错了`);
    const after = ok(await gb("status")).view;
    assert.deepEqual([after.work[0].state, after.needs.map((n) => n.kind)], ["failed", ["error"]]);
    const second = await borrow("登录页也坏了", 0);
    const taken = ok(await gb("work-take", { session: "s-1", avatar: g.as.id, work: second.id, root: app })).work;
    assert.ok(existsSync(join(taken.worktree, "src", "settings.ts")), "a worktree of the repository");
    assert.match(git(app, "worktree", "list"), new RegExp(`gemsbang/${g.as.id}-${second.id}`));
    assert.deepEqual(taken.commands, ["npm test", "npm run test", "npm run build"]);
    assert.match(taken.prompt, /这个任务来自「设置页改版」，是 李四 派的。[\s\S]*> 登录页也坏了[\s\S]*`npm test`、`npm run test`、`npm run build`/);
    assert.equal((await gb("work-take", { session: "s-1", avatar: g.as.id, work: second.id, root: app })).code, "work.taken", "once");
    ok(await gb("work-done", { avatar: g.as.id, work: second.id, text: "登录页修好了。", facts: [{ label: "npm test", ok: true }] }));
    const last = ok(await gb("open", { owner: g.owner, id: g.id })).chat.items.at(-1);
    assert.deepEqual([last.text, last.mark, last.facts], ["登录页修好了。", true, [{ label: "npm test", ok: true }]]);
    const third = await borrow("首页也看看", 1);
    assert.equal(third.state, "queued");
    assert.equal(ok(await gb("work-now", { avatar: g.as.id, work: third.id })).view.work.at(-1).state, "waiting");
    assert.equal(ok(await gb("repo", { avatar: g.as.id, path: "" })).view.avatars[0].repo, undefined);
  } finally {
    await s.close();
  }
});
