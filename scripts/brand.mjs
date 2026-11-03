// The brand pictures the plugin draws, from the person's artwork in docs/brand/ (gemsbang-logo-light.png on white,
// gemsbang-logo-dark.png on near black): each one's ground taken out (colour to alpha, against the corner's colour),
// cut to what it draws, and made small — the lockup 44 px high, the mark (the bubble at its left) 48 px square, twice
// the size they are drawn at. Both themes go in one Svg each, the light one shown unless the system is dark. Writes
// src/hosts/claude-code/gb-brand.ts; run it again when the artwork changes. Node alone (zlib), on any system.
// Usage: node scripts/brand.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = join(ROOT, "src", "hosts", "claude-code", "gb-brand.ts");
const LOCKUP_H = 44, MARK = 48;
/** How far from the ground a pixel must be to be kept: the artwork's ground is not quite flat. */
const FLOOR = 0.07;

/** An 8-bit, non-interlaced RGB or RGBA PNG as RGBA floats 0..1. */
function decode(buf) {
  let i = 8, w = 0, h = 0, type = 0, idat = [];
  while (i < buf.length) {
    const n = buf.readUInt32BE(i), kind = buf.toString("latin1", i + 4, i + 8), data = buf.subarray(i + 8, i + 8 + n);
    if (kind === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); type = data[9]; if (data[8] !== 8 || data[12] !== 0 || (type !== 2 && type !== 6)) throw new Error("an 8-bit, non-interlaced RGB or RGBA PNG only"); }
    else if (kind === "IDAT") idat.push(data);
    i += 12 + n;
  }
  const bpp = type === 6 ? 4 : 3, stride = w * bpp, raw = inflateSync(Buffer.concat(idat)), px = new Float32Array(w * h * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = Uint8Array.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      line[x] = (line[x] + (f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? b : c) : 0)) & 255;
    }
    for (let x = 0; x < w; x++) for (let k = 0; k < 4; k++) px[(y * w + x) * 4 + k] = k < 3 || bpp === 4 ? line[x * bpp + k] / 255 : 1;
    prev = line;
  }
  return { w, h, px };
}

/** RGBA floats as an RGBA PNG. */
function encode({ w, h, px }) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w * 4; x++) raw[y * (w * 4 + 1) + 1 + x] = Math.round(Math.min(1, Math.max(0, px[y * w * 4 + x])) * 255);
  const chunk = (kind, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(kind, "latin1"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(b) { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return c ^ 0xffffffff; }

/**
 * The ground: white for a light picture; for a dark one the brightest colour on its edge, so the ground's grain lies
 * below it. Its distance is then read one way only (darker than white, brighter than the dark ground): grain on the
 * other side is ground too, where dividing by what is left of the scale would blow it up to a solid speck.
 */
function groundOf({ w, h, px }) {
  const edge = [];
  for (let x = 0; x < w; x++) edge.push((0 * w + x) * 4, ((h - 1) * w + x) * 4);
  for (let y = 0; y < h; y++) edge.push((y * w) * 4, (y * w + w - 1) * 4);
  const mean = edge.reduce((t, i) => t + px[i] + px[i + 1] + px[i + 2], 0) / (edge.length * 3);
  return mean > 0.5 ? { light: true, bg: [1, 1, 1] } : { light: false, bg: [0, 1, 2].map((k) => Math.max(...edge.map((i) => px[i + k]))) };
}

/** The ground taken out: each pixel's distance from it becomes its alpha, its colour what over it would look as it did. */
function groundOut({ w, h, px }, ground) {
  const out = new Float32Array(px.length), bg = ground.bg;
  for (let i = 0; i < w * h; i++) {
    let alpha = 0;
    for (let k = 0; k < 3; k++) {
      const c = px[i * 4 + k], b = bg[k];
      alpha = Math.max(alpha, ground.light ? Math.max(0, b - c) / b : Math.max(0, c - b) / (1 - b));
    }
    const kept = alpha <= FLOOR ? 0 : (alpha - FLOOR) / (1 - FLOOR);
    for (let k = 0; k < 3; k++) out[i * 4 + k] = alpha > 0 ? (px[i * 4 + k] - bg[k]) / alpha + bg[k] : 0;
    out[i * 4 + 3] = kept;
  }
  return { w, h, px: out };
}

const alphaAt = (img, x, y) => img.px[(y * img.w + x) * 4 + 3];

/** The part [x0, x1) × [y0, y1). */
function cut(img, x0, y0, x1, y1) {
  const w = x1 - x0, h = y1 - y0, px = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) px.set(img.px.subarray(((y + y0) * img.w + x0) * 4, ((y + y0) * img.w + x1) * 4), y * w * 4);
  return { w, h, px };
}

/** The smallest box holding what is drawn, columns from `from` on. */
function bounds(img, from = 0, to = img.w) {
  let x0 = to, x1 = from, y0 = img.h, y1 = 0;
  for (let y = 0; y < img.h; y++) for (let x = from; x < to; x++) if (alphaAt(img, x, y) > 0.1) { x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1); y0 = Math.min(y0, y); y1 = Math.max(y1, y + 1); }
  return { x0, y0, x1, y1 };
}

/** The columns of the first thing drawn from the left: up to the first run of `gap` empty columns. */
function firstShape(img, gap = 6) {
  const empty = (x) => { for (let y = 0; y < img.h; y++) if (alphaAt(img, x, y) > 0.1) return false; return true; };
  let x = 0;
  while (x < img.w && empty(x)) x++;
  const from = x;
  for (let run = 0; x < img.w; x++) { run = empty(x) ? run + 1 : 0; if (run >= gap) return { from, to: x - gap + 1 }; }
  return { from, to: img.w };
}

/** Made `w` × `h` by averaging each target pixel's area, the colours weighted by their alpha. */
function resize(img, w, h) {
  const px = new Float32Array(w * h * 4), sx = img.w / w, sy = img.h / h;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    for (let v = Math.floor(y * sy); v < Math.min(img.h, Math.ceil((y + 1) * sy)); v++) for (let u = Math.floor(x * sx); u < Math.min(img.w, Math.ceil((x + 1) * sx)); u++) {
      const i = (v * img.w + u) * 4, al = img.px[i + 3];
      r += img.px[i] * al; g += img.px[i + 1] * al; b += img.px[i + 2] * al; a += al; n++;
    }
    const o = (y * w + x) * 4;
    if (a > 0) { px[o] = r / a; px[o + 1] = g / a; px[o + 2] = b / a; }
    px[o + 3] = n > 0 ? a / n : 0;
  }
  return { w, h, px };
}

/** A square canvas `size` around `img`, centred. */
function square(img) {
  const s = Math.max(img.w, img.h), px = new Float32Array(s * s * 4), dx = Math.floor((s - img.w) / 2), dy = Math.floor((s - img.h) / 2);
  for (let y = 0; y < img.h; y++) px.set(img.px.subarray(y * img.w * 4, (y + 1) * img.w * 4), ((y + dy) * s + dx) * 4);
  return { w: s, h: s, px };
}

function pictures(file) {
  const img = decode(readFileSync(join(ROOT, "docs", "brand", file)));
  const clear = groundOut(img, groundOf(img));
  const all = bounds(clear), lockup = cut(clear, all.x0, all.y0, all.x1, all.y1);
  const shape = firstShape(lockup), box = bounds(lockup, shape.from, shape.to);
  const mark = square(cut(lockup, box.x0, box.y0, box.x1, box.y1));
  const lw = Math.round((lockup.w * LOCKUP_H) / lockup.h);
  return { lockup: encode(resize(lockup, lw, LOCKUP_H)), lockupWidth: lw, mark: encode(resize(mark, MARK, MARK)) };
}

/** One Svg with both themes' pictures: the light one, or the dark one where the system is dark. */
function themed(light, dark, w, h) {
  const img = (cls, png) => `<image class="${cls}" width="${w}" height="${h}" href="data:image/png;base64,${png.toString("base64")}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><style>.d{display:none}@media (prefers-color-scheme: dark){.l{display:none}.d{display:inline}}</style>${img("l", light)}${img("d", dark)}</svg>`;
}

const light = pictures("gemsbang-logo-light.png"), dark = pictures("gemsbang-logo-dark.png");
const lw = Math.max(light.lockupWidth, dark.lockupWidth);
const lockup = themed(light.lockup, dark.lockup, lw, LOCKUP_H), mark = themed(light.mark, dark.mark, MARK, MARK);
writeFileSync(OUT, [
  "// Generated by scripts/brand.mjs from docs/brand/gemsbang-logo-{light,dark}.png; run it again when the artwork changes.",
  "// The person's wordmark and its bubble, each in one Svg with the light and the dark picture. Pure and Node-free.",
  "",
  `/** The wordmark (Gems'Bang), ${lw} × ${LOCKUP_H} as made: drawn at half that. */`,
  `export const LOCKUP = { source: ${JSON.stringify(lockup)}, width: ${lw}, height: ${LOCKUP_H} } as const;`,
  "",
  `/** The bubble at the wordmark's left, ${MARK} × ${MARK} as made: the mark wherever the words do not fit. */`,
  `export const MARK = { source: ${JSON.stringify(mark)}, width: ${MARK}, height: ${MARK} } as const;`,
  "",
].join("\n"));
console.log(`wrote ${OUT}: lockup ${lw}×${LOCKUP_H} (${lockup.length} chars), mark ${MARK}×${MARK} (${mark.length} chars)`);
