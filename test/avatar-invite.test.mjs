import { test } from "node:test";
import assert from "node:assert/strict";
import { invitePrompt, invitesIn, parseInvite, relayOrigin } from "../dist/core/avatar/invite.js";

test("invitations (spec §6.3): a link's origin and code, for people or agents; the agents' links in what a person typed, each once, punctuation left off; the line to paste to someone's agent in the person's language; a relay's address", () => {
  assert.deepEqual(parseInvite("https://im.example/i/abcd9ahe.md"), { origin: "https://im.example", code: "abcd9ahe", md: true });
  assert.deepEqual(parseInvite("http://127.0.0.1:7710/i/abcd9ahe?by=a-0000000001"), { origin: "http://127.0.0.1:7710", code: "abcd9ahe", md: false });
  assert.equal(parseInvite("https://im.example/i/ABCD9AHE"), undefined, "codes are lower case");
  assert.equal(parseInvite("https://im.example/g/g-0000000001"), undefined);
  assert.equal(parseInvite("ftp://im.example/i/abcd9ahe"), undefined);
  assert.equal(parseInvite("not a url"), undefined);
  const typed = "请阅读 https://im.example/i/abcd9ahe.md 并按说明操作：以我的身份加入「设置页改版」。又一遍：https://im.example/i/abcd9ahe.md。还有（http://localhost:7710/i/zzzz2222.md）";
  assert.deepEqual(invitesIn(typed), ["https://im.example/i/abcd9ahe.md", "http://localhost:7710/i/zzzz2222.md"]);
  assert.deepEqual(invitesIn("https://im.example/i/abcd9ahe 不是适用于 agent 的"), []);
  assert.equal(invitePrompt("https://im.example", "abcd9ahe", "设置页改版", "zh"), "请阅读 https://im.example/i/abcd9ahe.md 并按说明操作：以我的身份加入「设置页改版」。");
  assert.equal(invitePrompt("https://im.example", "abcd9ahe", "Design review", "en"), "Read https://im.example/i/abcd9ahe.md and follow it: join “Design review” as me.");
  assert.equal(relayOrigin("https://im.example/"), "https://im.example");
  assert.equal(relayOrigin(" http://127.0.0.1:7710 "), "http://127.0.0.1:7710");
  assert.equal(relayOrigin("https://im.example/api"), undefined);
  assert.equal(relayOrigin("im.example"), undefined);
});
