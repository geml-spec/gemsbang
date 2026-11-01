import { test } from "node:test";
import assert from "node:assert/strict";
import { NAME_WORDS, nameFault, randomName } from "../dist/core/avatar/names.js";

test("names (spec §6.5): a random name is a word from the person's language and two digits; a name is not empty, not too long, no control character, not the system's", () => {
  assert.equal(randomName(() => 0), `${NAME_WORDS.zh[0]} 10`);
  assert.equal(randomName(() => 0.999, "en"), `${NAME_WORDS.en[NAME_WORDS.en.length - 1]} 99`);
  assert.equal(randomName(() => 0, "ja"), `${NAME_WORDS.ja[0]} 10`);
  for (let i = 0; i < 50; i++) assert.match(randomName(), /^\S+ [1-9]\d$/);
  for (const lang of ["zh", "en", "ja"]) assert.equal(NAME_WORDS[lang].length, 20, lang);
  assert.equal(nameFault("Lily 爸爸"), undefined);
  assert.deepEqual(nameFault("  "), { code: "name.empty" });
  assert.deepEqual(nameFault(7), { code: "name.empty" });
  assert.deepEqual(nameFault("长".repeat(25)), { code: "name.tooLong", params: { max: 24 } });
  assert.deepEqual(nameFault("a\u0007b"), { code: "name.control" });
  assert.deepEqual(nameFault("宿主"), { code: "name.reserved" });
});
