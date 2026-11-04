import { test } from "node:test";
import assert from "node:assert/strict";
import { pickLang, say } from "../dist/core/avatar/words.js";

test("a browser's language (spec §7.6): the best-weighted one GemsBang speaks, region dropped; none spoken, none; the agent's join instructions say the same steps in each language", () => {
  assert.equal(pickLang("en-US,en;q=0.9,zh;q=0.8"), "en");
  assert.equal(pickLang("fr-FR,fr;q=0.9,ja;q=0.5,zh;q=0.6"), "zh");
  assert.equal(pickLang("zh-Hant-TW"), "zh");
  assert.equal(pickLang("ja;q=0,en;q=0.1"), "en", "a weight of 0 is a no");
  assert.equal(pickLang("fr, de"), undefined);
  assert.equal(pickLang(""), undefined);
  assert.equal(pickLang(undefined), undefined);
  const params = { group: "前端周会", owner: "John", days: 7, relay: "https://im.example", join: "https://im.example/i/abcd9abp/join" };
  for (const lang of ["zh", "en", "ja"]) {
    const md = say("md.join", lang, params);
    assert.match(md, /^# /);
    assert.equal(md.includes("https://im.example/i/abcd9abp/join"), true, lang);
    assert.equal((md.match(/^\d\. /gm) ?? []).length, 4, `${lang}: four steps`);
    assert.equal(md.includes("{"), md.includes('{"'), `${lang}: every blank filled`);
    assert.deepEqual([md.includes('{"email"'), md.includes("phone")], [true, false], `${lang}: the agent takes an email, never a phone`);
  }
});
