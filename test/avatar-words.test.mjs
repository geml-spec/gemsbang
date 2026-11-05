import { test } from "node:test";
import assert from "node:assert/strict";
import { CODES, DEFAULT_LANG, isLang, LANGS, say, sayFault } from "../dist/core/avatar/words.js";

test("words (spec §7.6): every code speaks Chinese, English and Japanese with the same blanks; a blank is filled from the parameters; a code with no words is itself", () => {
  assert.deepEqual(LANGS, ["zh", "en", "ja"]);
  assert.equal(DEFAULT_LANG, "zh");
  for (const code of CODES) {
    const blanks = (lang) => (say(code, lang).match(/\{\w+\}/g) ?? []).sort().join(",");
    for (const lang of LANGS) assert.notEqual(say(code, lang), code, `${code} in ${lang}`);
    assert.equal(blanks("en"), blanks("zh"), `${code}: en has the same blanks`);
    assert.equal(blanks("ja"), blanks("zh"), `${code}: ja has the same blanks`);
  }
  assert.equal(say("name.tooLong", "zh", { max: 24 }), "名称最多 24 字");
  assert.equal(say("name.tooLong", "en", { max: 24 }), "A name has at most 24 characters");
  assert.equal(say("name.tooLong", "ja", { max: 24 }), "名前は24文字までです");
  assert.equal(say("code.text", "en", { code: "123456" }), "GemsBang code 123456, valid for 10 minutes. If you did not ask for it, ignore this.");
  assert.equal(say("name.tooLong"), "名称最多 {max} 字", "a blank with nothing to fill stays");
  assert.equal(say("no.such.code", "en"), "no.such.code");
  assert.equal(sayFault({ code: "rules.unknown", params: { key: "alone" } }, "en"), "There is no rule called alone");
  assert.equal(isLang("ja"), true);
  assert.equal(isLang("fr"), false);
});
