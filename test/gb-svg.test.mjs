import { test } from "node:test";
import assert from "node:assert/strict";
import { barSvg, chatPicSvg, chatRowPicSvg, countSvg, flagSvg, linkSvg, mutedSvg, pillSvg, textWidth } from "../dist/hosts/claude-code/gb-svg.js";

const JOHN = { name: "John", color: "#2563eb", initial: "J" };

test("the pictures (GbInbox): a pill grows with its name and keeps its colour, filled when picked; a name is written as text, never as markup", () => {
  const short = pillSvg(JOHN), long = pillSvg({ ...JOHN, name: "John 在公司的身份" });
  assert.ok(long.width > short.width + 40, `${long.width} vs ${short.width}`);
  assert.equal(short.height, 18);
  assert.match(short.source, /stroke="#2563eb"/);
  assert.match(pillSvg(JOHN, { filled: true }).source, /fill="#2563eb" stroke="#2563eb"/);
  assert.ok(pillSvg(JOHN, { small: true }).width < short.width, "a chat row's pill is a little smaller");
  const odd = pillSvg({ ...JOHN, name: `<b>"&'` });
  assert.ok(odd.source.includes("&lt;b&gt;&quot;&amp;&apos;") && !odd.source.includes("<b>"), odd.source);
  assert.equal(odd.alt, `<b>"&'`, "the alt is the name itself: the element carries it as data");
});

test("the pictures: an ideograph is about twice a Latin letter; a group's picture is its people, a person's their initial; a count past 99 says 99+; a bar is as tall as asked", () => {
  assert.ok(Math.abs(textWidth("设置", 12) - 24) < 0.01);
  assert.ok(textWidth("ab", 12) < textWidth("设置", 12) * 0.6);
  assert.match(chatPicSvg("group", "前端周会").source, /<circle cx="9" cy="8" r="3.5"\/>/);
  assert.match(chatPicSvg("dm", "李四").source, />李<\/text>/);
  assert.equal(chatPicSvg("dm", "李四").source, chatPicSvg("dm", "李四").source, "a person keeps their colour");
  assert.match(countSvg(120).source, />99\+<\/text>/);
  assert.equal(countSvg(3, { small: true }).height, 14);
  assert.deepEqual([barSvg("#c2410c", 54, "Lily 爸爸").height, barSvg("#c2410c", 54, "Lily 爸爸").alt], [54, "Lily 爸爸"]);
  assert.match(linkSvg("我").source, /fill="#2a6fdb"/);
});

test("an inbox row's picture (S11, S17, S20, direction ①): the chat's own, the avatar in it at the lower right in its colour, the unread in red at the upper right — a grey dot instead when muted, nothing when all is read; the red words and the muted mark", () => {
  const read = chatRowPicSvg("group", "前端周会", JOHN, 0, false), two = chatRowPicSvg("group", "前端周会", JOHN, 2, false), quiet = chatRowPicSvg("group", "前端周会", JOHN, 2, true);
  assert.match(read.source, /<circle cx="9" cy="8" r="3.5"\/>/, "the group's people");
  assert.match(read.source, /fill="#2563eb"[^>]*\/>.*>J<\/text>/, "the avatar at the corner");
  assert.doesNotMatch(read.source, /#ef3b3f/);
  assert.match(two.source, /fill="#ef3b3f".*>2<\/text>/);
  assert.match(chatRowPicSvg("dm", "李四", JOHN, 120, false).source, />99\+<\/text>/);
  assert.ok(!quiet.source.includes("#ef3b3f") && quiet.source.includes('r="5" fill="#8a8986"'), "muted: a grey dot");
  assert.deepEqual([read.alt, read.width, read.height], ["前端周会 · John", 46, 46]);
  assert.match(flagSvg("[有人@我]").source, /fill="#e5484d">\[有人@我\]<\/text>/);
  assert.equal(mutedSvg("前端周会").alt, "前端周会");
});

test("the brand (docs/brand/, made small by scripts/brand.mjs): the wordmark and its bubble each carry the light and the dark picture, the dark one shown where the system is dark, within what the engine takes of an Svg", async () => {
  const { LOCKUP, MARK } = await import("../dist/hosts/claude-code/gb-brand.js");
  for (const [name, p] of [["lockup", LOCKUP], ["mark", MARK]]) {
    assert.equal((p.source.match(/<image class="[ld]"/g) ?? []).length, 2, name);
    assert.match(p.source, /@media \(prefers-color-scheme: dark\)\{\.l\{display:none\}\.d\{display:inline\}\}/, name);
    assert.ok(p.source.length < 131072, `${name}: ${p.source.length} characters`);
  }
  assert.equal(LOCKUP.height, 44);
  assert.ok(LOCKUP.width > 4 * LOCKUP.height, "a wordmark, wide");
  assert.deepEqual([MARK.width, MARK.height], [48, 48]);
});
