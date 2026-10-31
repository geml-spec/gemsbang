import { test } from "node:test";
import assert from "node:assert/strict";
import { venueLabel, replyWords, envelopeLine, withEnvelope } from "../dist/core/im/envelope.js";
import { DEFAULT_SCOPES } from "../dist/core/im/sender.js";

test("the envelope line is the spec's example, word for word (§6.5, transport §3)", () => {
  assert.equal(
    envelopeLine({ venueKind: "group", venueName: "前端周会", senderName: "张三", level: "member", scope: DEFAULT_SCOPES.member, queued: 2 }),
    "[来自 群「前端周会」 · 张三（成员） · 权限：只读 · 回复将发回该群，成员可见 · 队列中还有 2 条]",
  );
});

test("each venue kind has its label and its reply words; draft-first says so", () => {
  assert.equal(venueLabel("group", "前端周会"), "群「前端周会」");
  assert.equal(venueLabel("thread", "回复：看看这个 PR"), "线程「回复：看看这个 PR」");
  assert.equal(venueLabel("channel", "小评的信号"), "订阅频道「小评的信号」");
  assert.equal(venueLabel("dm", "小评"), "私信");
  assert.equal(venueLabel("guest-dm", "访客 a1b2"), "访客私信");
  assert.equal(replyWords("group", false), "回复将发回该群，成员可见");
  assert.equal(replyWords("thread", false), "回复将发回该线程，成员可见");
  assert.equal(replyWords("guest-dm", false), "回复将发给访客");
  assert.equal(replyWords("dm", false), "回复在私信里");
  assert.equal(replyWords("channel", false), "回复不会发出");
  assert.equal(replyWords("group", true), "回复先给主人过目，再发回该群");
  assert.equal(replyWords("guest-dm", true), "回复先给主人过目，再发给访客");
  assert.equal(replyWords("dm", true), "回复在私信里");
});

test("the other levels and scopes read right", () => {
  assert.equal(
    envelopeLine({ venueKind: "guest-dm", venueName: "访客 a1b2", senderName: "访客 a1b2", level: "guest", scope: DEFAULT_SCOPES.guest, queued: 0, draftFirst: true }),
    "[来自 访客私信 · 访客 a1b2（访客） · 权限：只读 · 回复先给主人过目，再发给访客 · 队列中还有 0 条]",
  );
  assert.equal(
    envelopeLine({ venueKind: "thread", venueName: "回复：看看这个 PR", senderName: "李四", level: "trusted", scope: DEFAULT_SCOPES.trusted, queued: 1 }),
    "[来自 线程「回复：看看这个 PR」 · 李四（信任） · 权限：读、在沙箱里跑 · 回复将发回该线程，成员可见 · 队列中还有 1 条]",
  );
  assert.equal(
    envelopeLine({ venueKind: "dm", venueName: "小评", senderName: "John", level: "owner", scope: DEFAULT_SCOPES.owner, queued: 0 }),
    "[来自 私信 · John（主人） · 权限：工作流允许的一切 · 回复在私信里 · 队列中还有 0 条]",
  );
});

test("withEnvelope puts the line above the text, nothing else", () => {
  assert.equal(withEnvelope("[来自 x]", "正文\n第二行"), "[来自 x]\n正文\n第二行");
});
