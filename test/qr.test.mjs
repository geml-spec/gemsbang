import { test } from "node:test";
import assert from "node:assert/strict";
import { qrModules } from "../dist/core/qr.js";
import { qrSvg } from "../dist/hosts/claude-code/gb-svg.js";

// 叫人's link as a QR code (P4, Q5). This one was read back by macOS's own QR reader (CoreImage) when it was made,
// as were codes of versions 4, 6, 7 and 10 and of a line in Chinese; it stays as it was read.
const K7PQM3 = [
  "#######.#..#####..#.#.#######",
  "#.....#..#.#...#.##.#.#.....#",
  "#.###.#.#....#...#.##.#.###.#",
  "#.###.#..#.##..#####..#.###.#",
  "#.###.#..#.##..##.#...#.###.#",
  "#.....#.#.#####.##..#.#.....#",
  "#######.#.#.#.#.#.#.#.#######",
  "...........###....###........",
  "#.#...##.#####.##.#.#..#..#.#",
  ".##.##...#......#.##..##...##",
  "#....##....#.##.#..#.##..##.#",
  "###..#.#.#.#..###.#.#.#..#...",
  "#..#.###.....##.....#.#.....#",
  ".#.#...#...####...###.##...##",
  "......##..##...#.###.##.#...#",
  ".#.#.#...#.#.#.....###.##....",
  "#####.#.#....#.##...#.##....#",
  ".##.....#..##...#.###.##..###",
  "###.#.###..####.####....##..#",
  "...##..#.#.##.###.##..##.....",
  "###..##...#..##....#######.#.",
  "........###.###..#..#...###.#",
  "#######.##.....#.#..#.#.#...#",
  "#.....#....#.#....###...#..#.",
  "#.###.#...####.##.########...",
  "#.###.#.....##..#.#.##..####.",
  "#.###.#.#..#.##.#.#..#..#..##",
  "#.....#....###.##.#.##.###...",
  "#######.#..#.#..#####...##..#"
];

const shown = (m) => m.map((r) => r.map((d) => (d ? "#" : ".")).join(""));
/** The fifteen format bits read from beside the top-left finder, unmasked: level and mask, and whether their BCH check holds. */
function format(m) {
  let f = 0;
  const at = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
  at.forEach(([x, y], i) => { if (m[y][x]) f |= 1 << i; });
  f ^= 0x5412;
  let rem = f >>> 10;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return { level: f >>> 13, mask: (f >>> 10) & 7, holds: (((f >>> 10) << 10) | rem) === f };
}

test("a QR code (P4): 叫人's link as macOS read it; the smallest version that holds the bytes, its finders, timing and dark module where the standard puts them, the format bits level M and checked; text in Chinese as UTF-8; past 213 bytes, none", () => {
  const m = qrModules("https://gemsbang.com/i/k7pqm3");
  assert.deepEqual(shown(m), K7PQM3);
  for (const [text, size] of [["https://gemsbang.com/i/abcd9ahe?by=a-0000000001", 33], ["请阅读 https://gemsbang.com/i/k7pqm3.md 并按说明操作：以我的身份加入「周末爬山」。", 41], ["x".repeat(120), 45], ["y".repeat(213), 57]]) {
    const q = qrModules(text);
    assert.equal(q.length, size, text);
    const finder = ["#######", "#.....#", "#.###.#", "#.###.#", "#.###.#", "#.....#", "#######"];
    for (const [x, y] of [[0, 0], [size - 7, 0], [0, size - 7]]) assert.deepEqual(shown(q).slice(y, y + 7).map((r) => r.slice(x, x + 7)), finder);
    assert.equal(shown(q)[6].slice(8, size - 8), "#.".repeat(size).slice(0, size - 16), "the timing row");
    assert.equal(q[size - 8][8], true, "the dark module");
    const f = format(q);
    assert.deepEqual([f.level, f.holds], [0, true], "level M, its check holding");
  }
  assert.equal(qrModules("z".repeat(214)), undefined);
  const pic = qrSvg(m, 84, "邀请链接");
  assert.deepEqual([pic.width, pic.height, pic.alt], [84, 84, "邀请链接"]);
  assert.match(pic.source, /viewBox="0 0 37 37"/, "four modules of quiet zone on each side");
  assert.match(pic.source, /<rect width="37" height="37" fill="#fff"\/>/, "white behind it, on a dark ground too");
});
