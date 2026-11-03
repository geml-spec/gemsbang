import { test } from "node:test";
import assert from "node:assert/strict";
import { barSvg, chatPicSvg, chipSvg, countSvg, linkSvg, pillSvg, textWidth } from "../dist/hosts/claude-code/gb-svg.js";

const JOHN = { name: "John", color: "#2563eb", initial: "J" };

test("the pictures (GbInbox): a pill grows with its name and keeps its colour, filled when its filter is on; a name is written as text, never as markup", () => {
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

test("the pictures: an ideograph is about twice a Latin letter; the chip on is dark with white words; a group's picture is its people, a person's their initial; a count past 99 says 99+; a bar is as tall as asked", () => {
  assert.ok(Math.abs(textWidth("设置", 12) - 24) < 0.01);
  assert.ok(textWidth("ab", 12) < textWidth("设置", 12) * 0.6);
  assert.match(chipSvg("全部", true).source, /fill="#1f1e1d".*fill="#fff"/);
  assert.match(chipSvg("全部", false).source, /stroke="#8a8986"/);
  assert.match(chatPicSvg("group", "前端周会").source, /<circle cx="9" cy="8" r="3.5"\/>/);
  assert.match(chatPicSvg("dm", "李四").source, />李<\/text>/);
  assert.equal(chatPicSvg("dm", "李四").source, chatPicSvg("dm", "李四").source, "a person keeps their colour");
  assert.match(countSvg(120).source, />99\+<\/text>/);
  assert.equal(countSvg(3, { small: true }).height, 14);
  assert.deepEqual([barSvg("#c2410c", 54, "Lily 爸爸").height, barSvg("#c2410c", 54, "Lily 爸爸").alt], [54, "Lily 爸爸"]);
  assert.match(linkSvg("我").source, /fill="#2a6fdb"/);
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
