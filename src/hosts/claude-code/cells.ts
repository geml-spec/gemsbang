// Terminal cells: how wide a string draws, and a string cut to fit. Pure and
// Node-free: the hooks module imports this file.

const WIDE: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f], [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xa000, 0xa4cf],
  [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe30, 0xfe4f], [0xff00, 0xff60], [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f], [0x1f900, 0x1f9ff], [0x20000, 0x3fffd],
];

/** Terminal cells a string takes: East Asian wide and fullwidth characters two; joiners, combining marks and variation selectors none. */
export function cellWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c === 0x200d || (c >= 0x300 && c <= 0x36f) || (c >= 0xfe00 && c <= 0xfe0f)) continue;
    width += WIDE.some(([a, b]) => c >= a && c <= b) ? 2 : 1;
  }
  return width;
}

/** At most `max` cells, ending in `…` when cut; never half of a wide character. */
export function truncate(text: string, max: number): string {
  if (cellWidth(text) <= max) return text;
  if (max <= 0) return "";
  let out = "";
  let width = 0;
  for (const ch of text) {
    const w = cellWidth(ch);
    if (width + w > max - 1) break;
    out += ch;
    width += w;
  }
  return `${out}…`;
}
