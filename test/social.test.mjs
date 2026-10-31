import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MODE, DIGEST_ACTIONS, DIGEST_LIMIT, digestFault, digestHead, digestNeedText, keywordsOf, MATCH_ACTIONS, MATCHED_TEXT, matchNeedText, MODE_WORDS, modeOf, nameCard, ownMatchNeedText, RECEPTION_PREFIX, receptionText, sharedKeywords } from "../dist/core/im/social.js";

test("the three modes (§7.4): 只潜水 by default; a word for each; anything else is the default", () => {
  assert.deepEqual(MODE_WORDS, { lurk: "只潜水", ask: "被问才答", chat: "可以搭话" });
  assert.equal(DEFAULT_MODE, "lurk");
  assert.deepEqual(["lurk", "ask", "chat", "nope", undefined, 3].map(modeOf), ["lurk", "ask", "chat", "lurk", "lurk", "lurk"]);
});

test("the social secretary's first word (§11): who I am, for whom, the owner is away, their latest public thing when there is one, what a guest can do", () => {
  assert.equal(receptionText("xiaoping", "john", "设置页导出 PDF"), "接待：第一句自报家门——我是 xiaoping，代 john；john 现在不在；john 最近公开的一件事：设置页导出 PDF；访客可以留言，或问公开范围内的。");
  assert.equal(receptionText("xiaoping", "john"), "接待：第一句自报家门——我是 xiaoping，代 john；john 现在不在；访客可以留言，或问公开范围内的。");
  assert.ok(receptionText("a", "b").startsWith(RECEPTION_PREFIX));
});

test("a digest (§11): a body of at most a thousand characters; its head for the need; the owner's three answers", () => {
  assert.equal(digestFault("今天把缓存修好了。"), undefined);
  assert.equal(digestFault("  "), "日报要有正文");
  assert.equal(digestFault(7), "日报要有正文");
  assert.equal(digestFault("字".repeat(DIGEST_LIMIT + 1)), "日报最多 1000 字");
  assert.equal(digestHead("今天把设置页的缓存写路径修好了，顺手把导出 PDF 的按钮也挪到了右上角，明天接着做样式。"), "今天把设置页的缓存写路径修好了，顺手把导出 PDF 的按钮也挪到了右上角，明天接…");
  assert.equal(digestHead(" 短的 "), "短的");
  assert.equal(digestNeedText("xiaoping", "今天把缓存修好了。"), "xiaoping 起草了日报：今天把缓存修好了。");
  assert.deepEqual(DIGEST_ACTIONS, ["发", "不发", "自己写"]);
});

test("牵线 (§11): the words of public works, two characters or more, lowered, marks and blanks dropped; what two people share; the need's words; the name card", () => {
  assert.deepEqual(keywordsOf(["设置页导出 PDF，能跑的", "src/settings/* 和这 63 轮的记录"]), ["设置页导出", "pdf", "能跑的", "src", "settings", "和这", "63", "轮的记录"]);
  assert.deepEqual(sharedKeywords(["pdf", "设置页导出", "react"], ["react", "pdf", "vue"]), ["pdf", "react"]);
  assert.equal(matchNeedText("john", true), "牵线：john 的 agent 觉得你们合得来");
  assert.equal(matchNeedText("lisi", false, "都在做 PDF 导出"), "牵线：lisi 想和你互相亮名片：都在做 PDF 导出");
  assert.equal(ownMatchNeedText("xiaoping", "lisi"), "你的 agent xiaoping 想替你和 lisi 牵线，亮名片吗？");
  assert.deepEqual(MATCH_ACTIONS, ["亮名片", "不用"]);
  assert.equal(nameCard("john", ["xiaoping", "helper"], "设置页导出 PDF"), "名片：john · agent xiaoping、helper · 最近公开：设置页导出 PDF");
  assert.equal(nameCard("lisi", []), "名片：lisi");
  assert.equal(MATCHED_TEXT, "牵线成功：双方亮名片");
});
