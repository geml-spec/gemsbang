import { test } from "node:test";
import assert from "node:assert/strict";
import { CODE_RE, CODE_TTL_MS, CODES_PER_EMAIL, CODES_PER_IP_HOUR, codeMail, emailFault, HOSTED_AGENT, LOGIN_WORDS, nameFault, normalizeEmail, RESERVED_NAMES, welcomeText } from "../dist/core/im/login.js";

test("the email: trimmed and lowered; a fault for anything that is not one", () => {
  assert.equal(normalizeEmail("  Zhang@Example.COM "), "zhang@example.com");
  assert.equal(emailFault("zhang@example.com"), undefined);
  assert.equal(emailFault(" Zhang@Example.com "), undefined);
  for (const bad of ["", "zhang", "zhang@", "@x.io", "a b@x.io", 42, undefined]) assert.equal(emailFault(bad), "要一个邮箱地址", String(bad));
});

test("the name a first login takes: the relay's name rule, never one of the API's roads", () => {
  assert.equal(nameFault("zhangsan"), undefined);
  assert.equal(nameFault("张三_1"), undefined);
  assert.equal(nameFault(undefined), "新用户要取个名字");
  assert.equal(nameFault("  "), "新用户要取个名字");
  assert.equal(nameFault("bad name"), "名字不合法：字母、数字、_ 和 -，最多 64 个");
  assert.equal(nameFault("_relay"), "名字不合法：字母、数字、_ 和 -，最多 64 个");
  for (const r of ["wallet", "Login", "me", "c", "g", "r", "tasks", "platform"]) assert.equal(nameFault(r), "这个名字留给系统", r);
  assert.ok(RESERVED_NAMES.has("subscribe"));
});

test("the code: six digits, ten minutes, three an address in that time, ten a network address an hour; the mail; the words; the hosted agent's name and its first word", () => {
  assert.ok(CODE_RE.test("042311"));
  assert.ok(!CODE_RE.test("4231"));
  assert.deepEqual([CODE_TTL_MS, CODES_PER_EMAIL, CODES_PER_IP_HOUR], [600_000, 3, 10]);
  assert.deepEqual(codeMail("042311"), { subject: "Gemsbang 登录验证码", text: "你的验证码是 042311，10 分钟内有效。不是你在登录的话，不用管这封信。" });
  assert.deepEqual(LOGIN_WORDS, { sent: "验证码发到邮箱了，10 分钟内有效", wrong: "验证码不对或过期了", tooMany: "验证码发得太频繁，过十分钟再试", taken: "这个名字已经有人用了" });
  assert.equal(HOSTED_AGENT, "helper");
  assert.equal(welcomeText("zhangsan"), "你好 zhangsan，我是 helper，你的托管 agent，代你守在这里。想让我知道你的项目，就在电脑上运行 gemworks connect，把会话接过来；有人在你的分享卡上提问，我会按公开范围答，答不了的给你留言。");
});
