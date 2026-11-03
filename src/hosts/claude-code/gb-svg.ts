// The pictures the pane draws where the surface takes `Svg` (the desktop, VS Code, the phone): an avatar's pill, a
// chat's picture in the inbox with the avatar at its corner and its unread (WeChat's row), the red words before a
// chat's last line, the muted mark, a count, a card's colour bar. A desktop Button holds words only and draws them in its own colour and weight, so
// whatever must keep a colour is a picture here, sized in CSS pixels. Text is measured by estimate (an ideograph
// 1em, a Latin letter about half), which the pills' padding absorbs. Pure and Node-free.

/** One picture for an `Svg` element. */
export interface Pic { source: string; width: number; height: number; alt: string }
/** What a pill shows of an avatar. */
export interface PillOf { name: string; color: string; initial: string }

const FONT = "-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans','Helvetica Neue','Microsoft YaHei',sans-serif";
const xml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const n2 = (x: number): string => String(Math.round(x * 100) / 100);
const svg = (w: number, h: number, body: string): string => `<svg xmlns="http://www.w3.org/2000/svg" width="${n2(w)}" height="${n2(h)}" viewBox="0 0 ${n2(w)} ${n2(h)}">${body}</svg>`;
const text = (x: number, y: number, size: number, fill: string, s: string, o: { bold?: boolean; anchor?: "middle" } = {}): string =>
  `<text x="${n2(x)}" y="${n2(y)}" font-family="${FONT}" font-size="${n2(size)}"${o.bold === true ? ' font-weight="600"' : ""}${o.anchor !== undefined ? ` text-anchor="${o.anchor}"` : ""} dominant-baseline="central" fill="${fill}">${xml(s)}</text>`;

/** A wide character: an ideograph, a kana, a hangul syllable, a full-width sign, an emoji. */
const isWide = (c: number): boolean =>
  (c >= 0x2e80 && c <= 0x9fff) || (c >= 0xac00 && c <= 0xd7af) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6) || c >= 0x1f000;

/** About how many pixels wide `s` is drawn at `size` pixels in the system font. */
export function textWidth(s: string, size: number, bold = false): number {
  let em = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    em += isWide(c) ? 1 : ch === " " ? 0.28 : /[A-Z]/.test(ch) ? 0.66 : /[0-9]/.test(ch) ? 0.58 : "il.,:;'|!".includes(ch) ? 0.27 : /[a-z]/.test(ch) ? 0.54 : 0.5;
  }
  return em * size * (bold ? 1.06 : 1);
}

/**
 * An avatar's pill (GbInbox's): a round initial in its colour, its name in its colour, a rim of its colour; `small` a
 * little smaller, `filled` for the one picked in a list (the colour behind, the words white).
 */
export function pillSvg(b: PillOf, o: { small?: boolean; filled?: boolean; tick?: boolean; faded?: boolean } = {}): Pic {
  const k = o.small === true ? 10.5 / 11 : 1;
  const label = o.tick === true ? `${b.name} ✓` : b.name;
  const size = 11 * k, dot = 14 * k, h = dot + 4, name = textWidth(label, size, true);
  const w = 1 + 2 + dot + 4 + name + 6 + 1;
  const fg = o.filled === true ? "#fff" : b.color;
  const body = [
    `<rect x="0.5" y="0.5" width="${n2(w - 1)}" height="${n2(h - 1)}" rx="${n2((h - 1) / 2)}" fill="${o.filled === true ? b.color : "none"}" stroke="${b.color}"/>`,
    `<circle cx="${n2(3 + dot / 2)}" cy="${n2(h / 2)}" r="${n2(dot / 2)}" fill="${o.filled === true ? "#fff" : b.color}"/>`,
    text(3 + dot / 2, h / 2, 9 * k, o.filled === true ? b.color : "#fff", b.initial, { bold: true, anchor: "middle" }),
    text(3 + dot + 4, h / 2, size, fg, label, { bold: true }),
  ].join("");
  // 底子's 给 (P8c): the avatars it is not given to, faded.
  return { source: svg(w, h, o.faded === true ? `<g opacity="0.4">${body}</g>` : body), width: Math.ceil(w), height: h, alt: label };
}

/** Words that open a page, as the canvas's links are drawn (我的分身): blue and underlined. */
export function linkSvg(label: string): Pic {
  const size = 12, h = 20, w = textWidth(label, size) + 2;
  return { source: svg(w, h, `${text(1, h / 2, size, "#2a6fdb", label)}<rect x="1" y="${n2(h / 2 + size * 0.62)}" width="${n2(w - 2)}" height="1" fill="#2a6fdb"/>`), width: Math.ceil(w), height: h, alt: label };
}

/** The colours a person is drawn in, by their name: the canvas's 李四 green and 张三 amber first. */
const PEOPLE = ["#2f7d6d", "#d9a441", "#4b6b8f", "#8a5ab5", "#a8761f", "#2f8a8a"];
export const peopleColor = (name: string): string => {
  let h = 0;
  for (const ch of name) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return PEOPLE[h % PEOPLE.length]!;
};
const firstOf = (name: string): string => ([...name.trim()][0] ?? "?").toUpperCase();

/** Someone's round picture in a chat (GbChat's, 28 px): their initial, white on their colour. */
export function personSvg(name: string, color: string = peopleColor(name), size = 28): Pic {
  const r = size / 2;
  return { source: svg(size, size, `<circle cx="${r}" cy="${r}" r="${r}" fill="${color}"/>${text(r, r, size * 0.4, "#fff", firstOf(name), { bold: true, anchor: "middle" })}`), width: size, height: size, alt: name };
}

/** A small tag beside a name (分身: an agent said it): slate words on pale blue. */
export function tagSvg(label: string): Pic {
  const size = 10.5, h = 16, w = 4 + textWidth(label, size) + 4;
  return { source: svg(w, h, `<rect width="${n2(w)}" height="${h}" rx="4" fill="#4b6b8f" fill-opacity="0.13"/>${text(4, h / 2, size, "#4b6b8f", label)}`), width: Math.ceil(w), height: h, alt: label };
}

/** A chat's round picture, as the markup inside an `svg`: a group's people on grey, a person's initial on their colour. */
function chatPicBody(kind: "group" | "dm", name: string, size: number): string {
  const r = size / 2;
  if (kind === "group") {
    const s = size / 2, x = (size - s) / 2, k = s / 24;
    const icon = `<g transform="translate(${n2(x)} ${n2(x)}) scale(${n2(k)})" fill="none" stroke="#8a8986" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><circle cx="17" cy="9" r="2.5"/><path d="M3 19c0-3.3 2.7-5 6-5s6 1.7 6 5M15 19c0-2 1-3.5 3-4"/></g>`;
    return `<circle cx="${r}" cy="${r}" r="${r}" fill="#8a8986" fill-opacity="0.2"/>${icon}`;
  }
  return `<circle cx="${r}" cy="${r}" r="${r}" fill="${peopleColor(name)}"/>${text(r, r, size * 0.42, "#fff", firstOf(name), { bold: true, anchor: "middle" })}`;
}

/** A chat's round picture: a group's people on grey, a person's initial on their colour. */
export function chatPicSvg(kind: "group" | "dm", name: string, size = 36): Pic {
  return { source: svg(size, size, chatPicBody(kind, name, size)), width: size, height: size, alt: name };
}

/**
 * A chat's picture in the inbox (WeChat's row, S11, S20): its round picture; at its lower right the avatar in the chat,
 * a round initial in its colour; at its upper right the unread in red, or for a muted chat a grey dot (S17). The marks
 * sit in a white ring, so they stand off the picture under them.
 */
export function chatRowPicSvg(kind: "group" | "dm", name: string, as: PillOf, unread: number, muted: boolean): Pic {
  const size = 36, w = 46, h = 46, x = 2, y = 6, r = 8;
  const corner = `<circle cx="${x + size - 3}" cy="${y + size - 3}" r="${r}" fill="${as.color}" stroke="#fff" stroke-width="1.5"/>${text(x + size - 3, y + size - 3, 9, "#fff", as.initial, { bold: true, anchor: "middle" })}`;
  let count = "";
  if (unread > 0 && muted) count = `<circle cx="${x + size - 4}" cy="${y + 3}" r="5" fill="#8a8986" stroke="#fff" stroke-width="1.5"/>`;
  else if (unread > 0) {
    const label = unread > 99 ? "99+" : String(unread), ch = 16, cw = Math.max(ch, textWidth(label, 10.5, true) + 10);
    count = `<rect x="${n2(w - cw - 0.75)}" y="0.75" width="${n2(cw)}" height="${ch}" rx="${ch / 2}" fill="#ef3b3f" stroke="#fff" stroke-width="1.5"/>${text(w - 0.75 - cw / 2, 0.75 + ch / 2, 10.5, "#fff", label, { bold: true, anchor: "middle" })}`;
  }
  return { source: svg(w, h, `<g transform="translate(${x} ${y})">${chatPicBody(kind, name, size)}</g>${corner}${count}`), width: w, height: h, alt: `${name} · ${as.name}` };
}

/** The red words before a chat's last line while it needs the person (S11: [有人@我], [等你定], [任务]). */
export function flagSvg(label: string): Pic {
  const size = 12, h = 18, w = textWidth(label, size) + 2;
  return { source: svg(w, h, text(1, h / 2, size, "#e5484d", label)), width: Math.ceil(w), height: h, alt: label };
}

/** A muted chat's mark at the right of its row (S17): a struck bell, grey. */
export function mutedSvg(alt: string): Pic {
  const s = 14;
  return { source: svg(s, s, `<g fill="none" stroke="#8a8986" stroke-width="1.3" stroke-linecap="round"><path d="M7 2.2a3.3 3.3 0 0 0-3.3 3.3v2.4L2.6 10h8.8L10.3 7.9V5.5A3.3 3.3 0 0 0 7 2.2zM5.6 11.6a1.4 1.4 0 0 0 2.8 0"/><path d="M2 2l10 10"/></g>`), width: s, height: s, alt };
}

/** A red count: a chat's unread (16 high), or 需要你 beside the name (`small`, 14 high); past 99, 99+. */
export function countSvg(n: number, o: { small?: boolean } = {}): Pic {
  const label = n > 99 ? "99+" : String(n), size = o.small === true ? 10 : 10.5, h = o.small === true ? 14 : 16;
  const w = Math.max(h, textWidth(label, size, true) + (o.small === true ? 10 : 12));
  return { source: svg(w, h, `<rect width="${n2(w)}" height="${h}" rx="${h / 2}" fill="#ef3b3f"/>${text(w / 2, h / 2, size, "#fff", label, { bold: true, anchor: "middle" })}`), width: Math.ceil(w), height: h, alt: label };
}

/** A colour bar `height` high, named for whose it is: a chat row's edge (as tall as the row), or a card's (tall, and cut by its box). */
export function barSvg(color: string, height: number, alt: string, width = 4): Pic {
  return { source: svg(width, height, `<rect width="${width}" height="${height}" fill="${color}"/>`), width, height, alt };
}

/** A rule one pixel high in the grey at 30% (GbInbox's #e6e4de on white): wider than any slot, so drawn with no width it spans the slot it is in. */
export const RULE_SVG = svg(4000, 1, `<rect width="4000" height="1" fill="#8a8986" fill-opacity="0.3"/>`);

/** A QR code (叫人's link, P4): black modules on white with a four-module quiet zone, `px` wide; white on a dark ground too, or a phone cannot read it. */
export function qrSvg(modules: readonly (readonly boolean[])[], px: number, alt: string): Pic {
  const n = modules.length + 8;
  let d = "";
  modules.forEach((row, y) => row.forEach((dark, x) => { if (dark) d += `M${x + 4} ${y + 4}h1v1h-1z`; }));
  return { source: `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`, width: px, height: px, alt };
}

/** A switch (群信息's 静音, 进群要我同意): blue with the knob at the right when on, grey with it at the left when off. */
export function switchSvg(on: boolean, label: string): Pic {
  const w = 28, h = 16, r = h / 2, k = 6;
  return { source: svg(w, h, `<rect width="${w}" height="${h}" rx="${r}" fill="${on ? "#2a6fdb" : "#8a8986"}"${on ? "" : ' fill-opacity="0.35"'}/><circle cx="${on ? w - r : r}" cy="${r}" r="${k}" fill="#fff"/>`), width: w, height: h, alt: label };
}

/** A press that signs out or leaves (退出这台设备的登录, 退出): red words in a red rim, nothing behind, so it reads on a light and a dark ground. */
export function dangerSvg(label: string, o: { grey?: boolean } = {}): Pic {
  const size = 13, h = 28, w = 12 + textWidth(label, size) + 12, c = o.grey === true ? "#8a8986" : "#d1242f";
  return { source: svg(w, h, `<rect x="0.5" y="0.5" width="${n2(w - 1)}" height="${h - 1}" rx="7" fill="none" stroke="${c}" stroke-opacity="0.55"/>${text(12, h / 2, size, c, label)}`), width: Math.ceil(w), height: h, alt: label };
}
