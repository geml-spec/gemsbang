// A drawn tree (what `pane.drawn()` gives on the desktop surface: { type, props, children }) as HTML, so the pane can
// be looked at in a browser beside the canvas board it implements. An approximation of how Claude Code Desktop paints
// the engine's elements, not its painter: Box is a flex box (a row unless it says column, as in Ink), Text an inline
// run, Button a native button that draws only its words (its children's colours and weight dropped, `dimColor` kept;
// `plain` as words with a little room, else on a light grey), Input a field as wide as its words, Svg a picture.
// Calibrated against screenshots of the real pane (Claude Code Desktop, 2026-11-02, light): a cell 10 px each way, a
// line 20 px, a primary Button near black, a round border about 10 px round.
export const UNIT = 10;

const NAMED = { error: "#d1242f", warning: "#bf8700", success: "#1a7f37", suggestion: "#0969da", permission: "#8250df", text: "#1f2328", inactive: "#8c959f", subtle: "#8c959f" };
const color = (c) => (typeof c !== "string" ? undefined : NAMED[c] ?? c);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const px = (n) => (typeof n === "number" ? `${n * UNIT}px` : typeof n === "string" ? n : undefined);

function boxStyle(p) {
  const s = { display: p.display === "none" ? "none" : "flex", "flex-direction": p.flexDirection ?? "row", "flex-shrink": p.flexShrink ?? 1 };
  if (p.flexGrow !== undefined) s["flex-grow"] = p.flexGrow;
  if (p.flexWrap !== undefined) s["flex-wrap"] = p.flexWrap;
  if (p.alignItems !== undefined) s["align-items"] = p.alignItems;
  if (p.alignSelf !== undefined) s["align-self"] = p.alignSelf;
  if (p.justifyContent !== undefined) s["justify-content"] = p.justifyContent;
  for (const [k, css] of [["gap", "gap"], ["columnGap", "column-gap"], ["rowGap", "row-gap"], ["width", "width"], ["height", "height"], ["minWidth", "min-width"], ["minHeight", "min-height"]]) if (p[k] !== undefined) s[css] = px(p[k]);
  const sides = (name, css) => {
    const all = p[name], x = p[`${name}X`] ?? all, y = p[`${name}Y`] ?? all;
    for (const [side, v] of [["top", p[`${name}Top`] ?? y], ["bottom", p[`${name}Bottom`] ?? y], ["left", p[`${name}Left`] ?? x], ["right", p[`${name}Right`] ?? x]]) if (v !== undefined) s[`${css}-${side}`] = px(v);
  };
  sides("padding", "padding");
  sides("margin", "margin");
  if (typeof p.borderStyle === "string") {
    s.border = `1px ${p.borderStyle === "dashed" ? "dashed" : "solid"} ${p.borderDimColor ? "#e4e4e4" : color(p.borderColor) ?? "#e4e4e4"}`;
    s["border-radius"] = p.borderStyle === "round" ? "10px" : "0";
  }
  if (p.backgroundColor !== undefined) s.background = color(p.backgroundColor);
  if (p.overflow === "hidden") s.overflow = "hidden";
  if (p.position !== undefined) s.position = p.position;
  for (const k of ["top", "left", "right", "bottom"]) if (p[k] !== undefined) s[k] = px(p[k]);
  return s;
}

function textStyle(p) {
  const s = {};
  if (p.color !== undefined) s.color = color(p.color);
  if (p.backgroundColor !== undefined) s.background = color(p.backgroundColor);
  if (p.dimColor) { if (s.color === undefined) s.color = "#8f8f8f"; else s.opacity = "0.7"; }
  if (p.bold) s["font-weight"] = "600";
  if (p.italic) s["font-style"] = "italic";
  const lines = [p.underline && "underline", p.strikethrough && "line-through"].filter(Boolean);
  if (lines.length > 0) s["text-decoration"] = lines.join(" ");
  if (p.wrap === "truncate-end" || p.wrap === "truncate") Object.assign(s, { "white-space": "nowrap", overflow: "hidden", "text-overflow": "ellipsis", display: "block" });
  return s;
}

const css = (s) => Object.entries(s).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => `${k}:${v}`).join(";");

/** What a tree says, its styles left out. */
function words(node) { return typeof node === "string" ? node : (node.children ?? []).map(words).join(""); }

function kids(node, inText) { return (node.children ?? []).map((c) => draw(c, inText)).join(""); }

export function draw(node, inText = false) {
  if (typeof node === "string") return esc(node);
  if (node === null || typeof node !== "object") return "";
  const p = node.props ?? {};
  switch (node.type) {
    case "Box": return `<div class="box" style="${css(boxStyle(p))}">${kids(node, false)}</div>`;
    case "Text": return `<span class="text${inText ? "" : " run"}" style="${css(textStyle(p))}">${kids(node, true)}</span>`;
    case "Button": {
      // The desktop draws a Button's words alone: what its Text children say, not how.
      const inner = (node.children ?? []).length > 0 ? esc(words(node)) : esc(p.label ?? "");
      const kind = p.plain ? "plain" : p.variant === "primary" ? "primary" : "normal";
      return `<button class="btn ${kind}${p.dimColor ? " dim" : ""}" title="${esc(p.key ?? "")}">${inner}</button>`;
    }
    case "Input": return `<label class="field">${p.label !== undefined ? `<span class="label">${esc(p.label)}</span>` : ""}<input placeholder="${esc(p.placeholder ?? "")}" value="${esc(p.value ?? "")}"></label>`;
    case "Select": return `<label class="field">${p.label !== undefined ? `<span class="label">${esc(p.label)}</span>` : ""}<select>${(p.options ?? []).map((o) => `<option${o.value === p.value ? " selected" : ""}>${esc(o.label)}</option>`).join("")}</select></label>`;
    case "Svg": return `<img class="svg" alt="${esc(p.alt ?? "")}" width="${p.width ?? 16}" height="${p.height ?? 16}" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(p.source ?? "")}">`;
    case "Link": return `<a href="#">${kids(node, true) || esc(p.url ?? "")}</a>`;
    case "Markdown": return `<div class="md">${esc(p.text ?? "")}</div>`;
    case "Code": return `<pre class="code">${esc(p.source ?? "")}</pre>`;
    default: return `<div class="unknown">${esc(node.type)}${kids(node, false)}</div>`;
  }
}

const STYLE = `
*{box-sizing:border-box}
body{margin:0;font:13px/20px -apple-system,BlinkMacSystemFont,"PingFang SC","Segoe UI",sans-serif;color:#2b2b2b;background:#fff}
.pane{width:440px;border:1px solid #e4e4e4;border-radius:10px;overflow:hidden;background:#fff}
.pane-title{padding:8px 16px;border-bottom:1px solid #e4e4e4;color:#9a9a9a;background:#fff}
.pane-body{padding:16px 15px;display:flex;flex-direction:column}
.run{display:block;min-width:0}
.box>.text{min-width:0}
.btn{font:inherit;line-height:20px;cursor:pointer;border-radius:6px;padding:2px 11px;border:0;background:#f4f4f4;color:#383838;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;flex-shrink:1;min-width:0}
.btn.primary{background:#191919;color:#fff}
.btn.plain{background:none;padding:0 6px;color:#2b2b2b}
.btn.dim{color:#8f8f8f}
.field{display:flex;flex-direction:column;gap:2px;align-self:flex-start}
.field input,.field select{font:inherit;height:26px;padding:0 8px;border:1px solid #eeeeee;border-radius:6px;width:176px}
.label{color:#59636e;font-size:12px}
.svg{flex:none}
.md{white-space:pre-wrap}
.unknown{outline:1px dashed red}
`;

/** One scene's page: the pane frame with its title, the tree drawn inside. */
export function page(tree, title = "Gemsbang") {
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${STYLE}</style></head><body><div class="pane"><div class="pane-title">${esc(title)}</div><div class="pane-body">${draw(tree)}</div></div></body></html>\n`;
}
