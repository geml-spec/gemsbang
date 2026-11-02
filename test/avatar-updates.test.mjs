import { test } from "node:test";
import assert from "node:assert/strict";
import { BOX_KEEP_MS, differenceOf, GAP_WAIT_MS, receive, verdictOf, WAIT_MAX_S } from "../dist/core/avatar/updates.js";

const AT = "2026-11-02T09:00:00Z";
const U = (pts, at = AT, count = 1) => ({ pts, count, at, owner: "a-0000000001", doc: "venues/g-000000000a.geml", block: { id: `m-${pts}`, value: { text: String(pts) } } });

test("an update against the number reached (architecture §5.3): next in line is applied, at or below it was seen, beyond it leaves a gap; the times are named", () => {
  assert.deepEqual([verdictOf(4, U(5)), verdictOf(4, U(4)), verdictOf(4, U(3)), verdictOf(4, U(6)), verdictOf(4, U(6, AT, 2))], ["apply", "seen", "seen", "gap", "apply"]);
  assert.deepEqual([GAP_WAIT_MS, WAIT_MAX_S, BOX_KEEP_MS], [500, 25, 7 * 86_400_000]);
});

test("receiving (architecture §5.3): in order, applied; seen ones dropped; after a gap held, and applied once the gap fills", () => {
  const a = receive({ pts: 2, pending: [] }, [U(4), U(3), U(2), U(6)]);
  assert.deepEqual([a.apply.map((u) => u.pts), a.state.pts, a.state.pending.map((u) => u.pts), a.gap], [[3, 4], 4, [6], true]);
  const b = receive(a.state, [U(6), U(7)]);
  assert.deepEqual([b.apply, b.state.pending.map((u) => u.pts), b.gap], [[], [6, 7], true], "still a gap: the same one held once");
  const c = receive(b.state, [U(5)]);
  assert.deepEqual([c.apply.map((u) => u.pts), c.state, c.gap], [[5, 6, 7], { pts: 7, pending: [] }, false]);
});

test("a difference (architecture §5.2): the updates after the number asked, a page at a time with how far it reaches; the end said; too far behind once the week dropped them; an empty box or a client ahead, nothing", () => {
  const box = [1, 2, 3, 4, 5].map((n) => U(n));
  assert.deepEqual(differenceOf(box, 2, AT, 2), { updates: [U(3), U(4)], pts: 4, final: false, date: AT });
  assert.deepEqual(differenceOf(box, 4, AT), { updates: [U(5)], pts: 5, final: true, date: AT });
  assert.deepEqual(differenceOf(box, 5, AT), { updates: [], pts: 5, final: true, date: AT });
  const later = new Date(Date.parse(AT) + BOX_KEEP_MS + 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const aged = [...box, U(6, later)];
  assert.deepEqual(differenceOf(aged, 2, later), { tooLong: true, pts: 6, date: later });
  assert.deepEqual(differenceOf(aged, 5, later).updates.map((u) => u.pts), [6], "a client that saw what was dropped is not behind");
  assert.deepEqual(differenceOf([], 0, AT), { updates: [], pts: 0, final: true, date: AT });
  assert.deepEqual(differenceOf(box, 9, AT), { updates: [], pts: 5, final: true, date: AT }, "a client ahead of the box goes back to its end");
});
