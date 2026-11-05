// Draw the pane as Claude Code Desktop would and put it beside the canvas board it implements, to look at before
// saying a screen is done (`claude plugin test` checks trees, never paint). It copies the plugin into a temporary
// folder with preview/pane.preview.tsx as its one test, runs `claude plugin test` there, and writes each scene to
// preview/out/<scene>.html and the pairs to preview/out/index.html. Build first.
// With --live, one scene more: the view this machine's client has now (its bridge asked for it), to set beside a
// screenshot of the real pane.
// Usage: node scripts/preview-pane.mjs [--live]
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { page } from "../preview/render.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = join(ROOT, "preview", "out");
const CANVAS = join(ROOT, "docs", "design", "ui", "2026-10-30-agent-im-ui", "project");
/** Each scene and the canvas board it is drawn from. */
const BOARDS = { inbox: "GbInbox", "inbox-muted": "GbInbox", chat: "GbChat", "chat-card": "GbAsk", avatars: "GbAvatars", plus: "GbStart", empty: "GbStart", "contacts-empty": "GbStart", "invite-me": "GbInvite", "dm-began": "GbInvite", "dm-began-chat": "GbInvite", "new-group": "GbInvite", "call-failed": "GbInbox", info: "GbInfo", "leave-pick": "GbInfo", "avatar-edit": "GbAvatars", "base-edit": "GbAvatars", account: "GbAccount", logout: "GbAccount", invite: "GbChat", rotate: "GbChat", contacts: "GbContacts", contact: "GbContacts", dm: "GbBody", "dm-info": "GbContacts", live: "GbInbox" };
const PLUGIN = ["hooks", "dist", "types", ".claude-plugin", "package.json"];

const tmp = mkdtempSync(join(tmpdir(), "gemsbang-preview-"));
let out;
try {
  for (const f of PLUGIN) cpSync(join(ROOT, f), join(tmp, f), { recursive: true });
  let source = readFileSync(join(ROOT, "preview", "pane.preview.tsx"), "utf8");
  if (process.argv.includes("--live")) {
    const asked = spawnSync(process.execPath, [join(ROOT, "dist", "gemsbang.mjs"), "hook"], { input: JSON.stringify({ v: 1, call: "status", args: {} }), encoding: "utf8", timeout: 30_000 });
    const view = JSON.parse(asked.stdout || "{}")?.gb?.view;
    if (view === undefined) throw new Error(`the client gave no view: ${asked.stdout}${asked.stderr}`);
    source = source.replace("/* live */ null", JSON.stringify(view));
  }
  writeFileSync(join(tmp, "pane.test.tsx"), source);
  // Every scene's drawn tree comes back on one line: some megabytes in all, past spawnSync's own one.
  out = spawnSync("claude", ["plugin", "test", tmp], { encoding: "utf8", timeout: 180_000, maxBuffer: 64 * 1024 * 1024, shell: process.platform === "win32" });
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
if (out.error !== undefined) throw out.error;
const drawn = [];
for (const line of `${out.stdout}\n${out.stderr}`.split(/\r?\n/)) {
  const m = /^GEMSBANG-PREVIEW (\S+) (.*)$/.exec(line);
  if (m !== null) drawn.push({ name: m[1], tree: JSON.parse(m[2]) });
}
if (drawn.length === 0) { console.error(out.stdout, out.stderr); throw new Error("no scene was drawn"); }
mkdirSync(OUT, { recursive: true });
for (const s of drawn) s.html = page(s.tree);
for (const s of drawn) writeFileSync(join(OUT, `${s.name}.html`), s.html);
// Each side inlined (srcdoc): a browser that opens the index as a snapshot loads no file beside it.
const inline = (html) => `<iframe srcdoc="${html.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"></iframe>`;
const pair = (s) => {
  const board = BOARDS[s.name];
  const file = board === undefined ? undefined : join(CANVAS, `${board}.dc.html`);
  const left = file === undefined || !existsSync(file) ? "<p>(no board)</p>" : inline(readFileSync(file, "utf8"));
  return `<section><h2>${s.name}</h2><div class="pair"><figure><figcaption>画布 ${board ?? ""}</figcaption>${left}</figure><figure><figcaption>面板（预览）</figcaption>${inline(s.html)}</figure></div></section>`;
};
writeFileSync(join(OUT, "index.html"), `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>面板预览</title><style>body{margin:16px;font:13px -apple-system,"PingFang SC",sans-serif;background:#f6f8fa}h2{font-size:14px;margin:8px 0}.pair{display:flex;gap:16px;align-items:flex-start}figure{margin:0}figcaption{color:#59636e;margin-bottom:4px}iframe{width:480px;height:860px;border:1px solid #d0d7de;background:#fff}</style></head><body>${drawn.map(pair).join("")}</body></html>\n`);
console.log(`drew ${drawn.map((s) => s.name).join(", ")} · ${join(OUT, "index.html")}`);
