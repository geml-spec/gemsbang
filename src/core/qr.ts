// A QR code (ISO/IEC 18004, model 2) for 叫人's link (P4, Q5): the bytes in
// byte mode, error correction M, the smallest version from 1 to 10 they fit,
// the mask with the lowest penalty. The way of it follows Project Nayuki's
// QR Code generator (MIT). Pure: the dark modules, row by row, no quiet zone.

/** Error-correction codewords per block, and the blocks, at level M, by version (index 0 unused). */
const ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
/** Level M's two format bits. */
const LEVEL_M = 0;
const MAX_VERSION = 10;

const bit = (x: number, i: number): boolean => ((x >>> i) & 1) !== 0;

/** How many modules of a version carry data and error correction. */
function rawModules(ver: number): number {
  let n = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const align = Math.floor(ver / 7) + 2;
    n -= (25 * align - 10) * align - 55;
    if (ver >= 7) n -= 36;
  }
  return n;
}
const dataCodewords = (ver: number): number => Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[ver]! * BLOCKS[ver]!;

/** Multiplication in GF(2^8) modulo x^8 + x^4 + x^3 + x^2 + 1. */
function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = ((z << 1) ^ ((z >>> 7) * 0x11d)) & 0xff;
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function rsDivisor(degree: number): number[] {
  const out = new Array<number>(degree).fill(0);
  out[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < out.length; j++) {
      out[j] = gfMul(out[j]!, root);
      if (j + 1 < out.length) out[j]! ^= out[j + 1]!;
    }
    root = gfMul(root, 0x02);
  }
  return out;
}

function rsRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const out = new Array<number>(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ out.shift()!;
    out.push(0);
    divisor.forEach((coef, i) => { out[i]! ^= gfMul(coef, factor); });
  }
  return out;
}

/** The data codewords split into blocks, each with its error correction, interleaved. */
function withEcc(data: readonly number[], ver: number): number[] {
  const blocks = BLOCKS[ver]!, eccLen = ECC_PER_BLOCK[ver]!;
  const raw = Math.floor(rawModules(ver) / 8);
  const shorts = blocks - (raw % blocks), shortLen = Math.floor(raw / blocks);
  const divisor = rsDivisor(eccLen);
  const all: number[][] = [];
  for (let i = 0, k = 0; i < blocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < shorts ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, divisor);
    if (i < shorts) dat.push(0);
    all.push([...dat, ...ecc]);
  }
  const out: number[] = [];
  for (let i = 0; i < all[0]!.length; i++) {
    all.forEach((b, j) => { if (i !== shortLen - eccLen || j >= shorts) out.push(b[i]!); });
  }
  return out;
}

/** The data codewords for these bytes in byte mode at this version: mode, count, bytes, terminator, padding. */
function codewords(bytes: Uint8Array, ver: number): number[] {
  const bits: number[] = [];
  const put = (v: number, n: number): void => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
  put(0b0100, 4);
  put(bytes.length, ver <= 9 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  const capacity = dataCodewords(ver) * 8;
  put(0, Math.min(4, capacity - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) put(pad, 8);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  return out;
}

const fits = (n: number, ver: number): boolean => 4 + (ver <= 9 ? 8 : 16) + 8 * n <= dataCodewords(ver) * 8;

function alignmentPositions(ver: number, size: number): number[] {
  if (ver === 1) return [];
  const align = Math.floor(ver / 7) + 2;
  const step = Math.floor((ver * 8 + align * 3 + 5) / (align * 4 - 4)) * 2;
  const out = [6];
  for (let pos = size - 7; out.length < align; pos -= step) out.splice(1, 0, pos);
  return out;
}

/** The fifteen format bits of level M with this mask, BCH-protected. */
function formatBits(mask: number): number {
  const data = (LEVEL_M << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

const MASKS: readonly ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** The spec's penalty: runs of five or more, 2×2 blocks, finder-like runs, and the balance of dark and light. */
function penalty(m: boolean[][]): number {
  const size = m.length;
  let score = 0;
  const lines: boolean[][] = [];
  for (let i = 0; i < size; i++) { lines.push(m[i]!); lines.push(m.map((row) => row[i]!)); }
  const finder = [true, false, true, true, true, false, true];
  for (const line of lines) {
    for (let i = 0; i < size;) {
      let j = i;
      while (j < size && line[j] === line[i]) j++;
      if (j - i >= 5) score += 3 + (j - i - 5);
      i = j;
    }
    // 1:1:3:1:1 with four light modules on either side (outside the symbol is light).
    for (let i = 0; i + 7 <= size; i++) {
      if (!finder.every((d, k) => line[i + k] === d)) continue;
      const light = (a: number, b: number): boolean => { for (let k = a; k < b; k++) if (k >= 0 && k < size && line[k] === true) return false; return true; };
      if (light(i - 4, i)) score += 40;
      if (light(i + 7, i + 11)) score += 40;
    }
  }
  for (let y = 0; y + 1 < size; y++) for (let x = 0; x + 1 < size; x++) {
    const c = m[y]![x];
    if (m[y]![x + 1] === c && m[y + 1]![x] === c && m[y + 1]![x + 1] === c) score += 3;
  }
  const dark = m.reduce((n, row) => n + row.filter(Boolean).length, 0), total = size * size;
  score += Math.max(0, Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  return score;
}

/** The QR code of a text (UTF-8): its dark modules, `true` dark, row by row; undefined past version 10 (213 bytes). */
export function qrModules(text: string): boolean[][] | undefined {
  const bytes = new TextEncoder().encode(text);
  let ver = 1;
  while (ver <= MAX_VERSION && !fits(bytes.length, ver)) ver++;
  if (ver > MAX_VERSION) return undefined;
  const size = ver * 4 + 17;
  const dark: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const fixed: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (x: number, y: number, d: boolean): void => { dark[y]![x] = d; fixed[y]![x] = true; };

  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]] as const) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
      if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
    }
  }
  const pos = alignmentPositions(ver, size), last = pos.length - 1;
  pos.forEach((px, i) => pos.forEach((py, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(px + dx, py + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));
  const drawFormat = (mask: number): void => {
    const f = formatBits(mask);
    for (let i = 0; i <= 5; i++) set(8, i, bit(f, i));
    set(8, 7, bit(f, 6)); set(8, 8, bit(f, 7)); set(7, 8, bit(f, 8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(f, i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(f, i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(f, i));
    set(8, size - 8, true);
  };
  drawFormat(0);
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const v = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) { const a = size - 11 + (i % 3), b = Math.floor(i / 3); set(a, b, bit(v, i)); set(b, a, bit(v, i)); }
  }

  const data = withEcc(codewords(bytes, ver), ver);
  let k = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, upward = ((right + 1) & 2) === 0, y = upward ? size - 1 - vert : vert;
      if (!fixed[y]![x] && k < data.length * 8) { dark[y]![x] = bit(data[k >>> 3]!, 7 - (k & 7)); k++; }
    }
  }

  let best: boolean[][] | undefined, bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    drawFormat(mask);
    const m = dark.map((row, y) => row.map((d, x) => (fixed[y]![x] ? d : d !== MASKS[mask]!(x, y))));
    const score = penalty(m);
    if (score < bestScore) { best = m; bestScore = score; }
  }
  return best;
}
