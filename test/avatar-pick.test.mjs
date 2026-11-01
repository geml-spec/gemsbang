import { test } from "node:test";
import assert from "node:assert/strict";
import { pickAvatar } from "../dist/core/avatar/pick.js";

test("which avatar joins a second group (spec §6.4): the one already in it; else the one the inviter knows; else no default, the person chooses", () => {
  const work = { id: "a-0000000001", groups: [{ venue: "g-000000000a", members: ["a-0000000001", "a-00000000z1"] }] };
  const family = { id: "a-0000000002", groups: [{ venue: "g-000000000b", members: ["a-0000000002", "a-00000000z2"] }] };
  assert.deepEqual(pickAvatar([work, family], "g-000000000c", "a-00000000z2"), { kind: "known", avatar: "a-0000000002" });
  assert.deepEqual(pickAvatar([work, family], "g-000000000c", "a-00000000z1"), { kind: "known", avatar: "a-0000000001" });
  assert.deepEqual(pickAvatar([work, family], "g-000000000c", "a-00000000z9"), { kind: "choose" }, "no shared group: no default");
  assert.deepEqual(pickAvatar([work, family], "g-000000000c", undefined), { kind: "choose" });
  assert.deepEqual(pickAvatar([work, family], "g-000000000a", "a-00000000z2"), { kind: "in", avatar: "a-0000000001" }, "already there: that one, nothing asked");
  assert.deepEqual(pickAvatar([], "g-000000000c", "a-00000000z2"), { kind: "choose" });
  assert.deepEqual(pickAvatar([work], "g-000000000c", "a-0000000001"), { kind: "choose" }, "the inviter is not an avatar of the person's that knows itself");
});
