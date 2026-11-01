import { test } from "node:test";
import assert from "node:assert/strict";
import { avatarSpeaker, formatWho, parseWho } from "../dist/core/avatar/who.js";

test("who (spec §4): an avatar and a person are a kind and an opaque id; anything else is no one", () => {
  assert.deepEqual(parseWho("avatar:a-0123456789"), { kind: "avatar", id: "a-0123456789" });
  assert.deepEqual(parseWho("person:p-abcdef0123"), { kind: "person", id: "p-abcdef0123" });
  assert.deepEqual(parseWho("host"), { kind: "host" });
  for (const bad of ["avatar:john", "agent:xiaoping@john", "person:john", "avatar:a-0123", ""]) assert.equal(parseWho(bad), undefined, bad);
  assert.equal(formatWho({ kind: "avatar", id: "a-0123456789" }), "avatar:a-0123456789");
  assert.equal(avatarSpeaker("a-0123456789"), "avatar:a-0123456789");
});
