import { test } from "node:test";
import assert from "node:assert/strict";
import { FIXED_ROWS, lastLead, pinnedOf, rowsOf, scrolledTo } from "../dist/hosts/claude-code/pinned.js";

const rows = [{ kind: "text", key: "problem" }, { kind: "head", key: "head-inbox" }, { kind: "chat", key: "a" }, { kind: "chat", key: "b" }, { kind: "tabs", key: "tabs" }];
const chats = (n) => Array.from({ length: n }, () => ({ kind: "chat" }));

test("a page pinned at its foot (S11): what stands above the list — up to and with its head — kept at the top, 聊天 · 我 kept at the foot, the list between; a page without that row is not pinned", () => {
  const pin = pinnedOf(rows);
  assert.deepEqual([pin.top.map((r) => r.key), pin.list.map((r) => r.key), pin.foot.key], [["problem", "head-inbox"], ["a", "b"], "tabs"]);
  assert.equal(pinnedOf(rows.slice(0, -1)), undefined);
  assert.equal(pinnedOf([]), undefined);
});

test("how far the pinned list goes (S11): each item reckoned by its kind — a chat four rows, a card two a line — so the last items can always be reached; a list that fits never moves", () => {
  assert.deepEqual([rowsOf({ kind: "chat" }), rowsOf({ kind: "card", lines: [1, 2, 3], fields: [] }), rowsOf({ kind: "kv" })], [4, 9, 2]);
  const window = FIXED_ROWS + 5 * 4; // five chats fill it
  assert.equal(lastLead(chats(20), window), 15);
  assert.equal(lastLead(chats(3), window), 0, "a short list never moves");
  const me = [{ kind: "card", lines: [1, 2, 3, 4, 5, 6] }, { kind: "card", lines: [1, 2, 3, 4] }, { kind: "section" }, { kind: "kv" }, { kind: "kv" }, { kind: "kv" }, { kind: "kv" }];
  assert.equal(lastLead(me, FIXED_ROWS + 20), 1, "我: past the first card, the rest still fill a short window");
});

test("the wheel over the pinned list (S11): a tick moves its lead an item, crowded ticks or a page more; it stops at the top, and where the rest still fill the window", () => {
  const window = FIXED_ROWS + 5 * 4, list = chats(20);
  assert.deepEqual([scrolledTo(0, 1, list, window), scrolledTo(4, -1, list, window), scrolledTo(0, -1, list, window)], [1, 3, 0]);
  assert.equal(scrolledTo(0, 6, list, window), 2, "ticks crowded in flight: an item for each three rows");
  assert.equal(scrolledTo(14, 1000, list, window), 15, "End: as far as the rest still fill the window");
  assert.equal(scrolledTo(9, -1000, list, window), 0, "Home");
  assert.equal(scrolledTo(3, 0, list, window), 3);
});
