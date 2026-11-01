import { test } from "node:test";
import assert from "node:assert/strict";
import { fillBlank, occasionOf, suggestions } from "../dist/core/avatar/naming.js";

test("names offered on joining (spec §6.5): a parents' group offers a parent's names with a blank for the child, in the person's language; what the inviter calls you comes first; the default name is offered, never picked; nothing is offered twice", () => {
  assert.equal(occasionOf("三年二班家长"), "parents");
  assert.equal(occasionOf("小一(3)班"), "parents");
  assert.equal(occasionOf("Class 4 parents"), "parents");
  assert.equal(occasionOf("3年2組 保護者"), "parents");
  assert.equal(occasionOf("前端周会"), "work");
  assert.equal(occasionOf("Platform team"), "work");
  assert.equal(occasionOf("周末爬山"), "other");
  assert.deepEqual(suggestions({ group: "三年二班家长", lang: "zh" }), [{ text: "__ 妈妈", kind: "parent", blank: true }, { text: "__ 爸爸", kind: "parent", blank: true }]);
  assert.deepEqual(suggestions({ group: "Class 4 parents", lang: "en" }).map((s) => s.text), ["__'s mom", "__'s dad"]);
  assert.deepEqual(suggestions({ group: "3年2組 保護者", lang: "ja" }).map((s) => s.text), ["__ママ", "__パパ"]);
  assert.deepEqual(suggestions({ group: "前端周会", lang: "zh", call: " 小李 ", defaultName: "李四" }), [{ text: "小李", kind: "call" }, { text: "李四", kind: "default" }]);
  assert.deepEqual(suggestions({ group: "周末爬山", lang: "zh" }), [], "nothing to offer: the person writes one or skips");
  assert.deepEqual(suggestions({ group: "周会", lang: "zh", call: "李四", defaultName: "李四" }).map((s) => s.kind), ["call"], "the same name once");
  assert.equal(fillBlank("__ 妈妈", " 乐乐 "), "乐乐 妈妈");
  assert.equal(fillBlank("__'s mom", "Lily"), "Lily's mom");
  assert.equal(fillBlank("__ 妈妈", " "), "__ 妈妈");
});
