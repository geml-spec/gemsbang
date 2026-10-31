// The guest page (transport §7.1, main §11): one static page for every
// share card — the card on the left, 「问作者的 agent」 on the right — served
// by server.ts at `/c/<id>` to a browser and filled from the relay's JSON
// (`GET /c/<id>`, `POST /ask/<id>`, the guest DM read as a document, every
// three seconds while the page is open). No build step, no framework: the
// page is this string, and every node is built with DOM calls, so nothing
// the relay returns runs as markup. The words it shares with the board come
// rendered from core/im/share.ts in the JSON, written and tested once. The
// guest's token lives in the browser's storage, so the DM survives a
// reload; a token the relay no longer knows is dropped and the page starts
// over. 登录, 要一个自己的 agent and 打赏 stand where the mockup has them and
// say they are not here yet (transport §7.1's other routes, ⑤).
export const HTML_TYPE = "text/html; charset=utf-8";

export function sharePage(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Gemsbang · 分享卡</title>
<style>
:root { --ink: #1a1a1a; --dim: #6b6b6b; --line: #e3e3e3; --bg: #fafafa; --card: #fff; --blue: #0a74c0; --green: #1f7a3a; --amber: #b8860b; }
* { box-sizing: border-box; }
body { margin: 0; font: 15px/1.6 -apple-system, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif; color: var(--ink); background: var(--bg); }
header, footer { display: flex; gap: 16px; align-items: center; padding: 12px 24px; background: var(--card); border-bottom: 1px solid var(--line); }
footer { border-top: 1px solid var(--line); border-bottom: 0; justify-content: center; color: var(--dim); }
header .brand { font-weight: 700; color: var(--blue); }
header .tag, .dim { color: var(--dim); }
header nav { margin-left: auto; display: flex; gap: 8px; }
button { font: inherit; padding: 6px 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--card); cursor: pointer; }
button[disabled] { color: var(--dim); cursor: default; }
button.primary { background: var(--blue); color: #fff; border-color: var(--blue); }
main { display: grid; grid-template-columns: 3fr 2fr; gap: 24px; max-width: 1200px; margin: 24px auto; padding: 0 24px; }
@media (max-width: 860px) { main { grid-template-columns: 1fr; } }
section, aside { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 20px 24px; }
h1 { font-size: 22px; margin: 0 0 4px; }
h2 { font-size: 14px; color: var(--dim); margin: 20px 0 6px; font-weight: 600; }
h2.first { margin-top: 0; }
ul { margin: 0; padding-left: 20px; }
.evidence li { color: var(--green); }
.tip { display: inline-block; padding: 2px 8px; border-radius: 999px; background: #eef6ff; color: var(--blue); font-size: 13px; }
#thread { display: flex; flex-direction: column; gap: 12px; min-height: 200px; margin: 12px 0; }
.msg { display: flex; gap: 10px; }
.avatar { flex: none; width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; font-size: 13px; color: #fff; background: #9a9a9a; }
.msg.agent .avatar { border-radius: 8px; background: var(--blue); }
.msg .body { flex: 1; }
.msg .text { white-space: pre-wrap; }
.msg .badge, .msg .who { font-size: 12px; color: var(--dim); }
.msg.system { color: var(--dim); font-size: 13px; }
form { display: flex; gap: 8px; }
input[type=text] { flex: 1; font: inherit; padding: 8px 12px; border: 1px solid var(--line); border-radius: 8px; }
.note { color: var(--amber); font-size: 13px; min-height: 1.2em; }
</style>
</head>
<body>
<header><span class="brand">Gemsbang</span><span class="tag">不用注册就能看、能问</span><nav><button disabled title="还没上线">登录</button><button disabled title="还没上线">要一个自己的 agent</button></nav></header>
<main>
<section id="card"><p class="dim">正在读取…</p></section>
<aside id="ask"><h2 class="first">问作者的 agent</h2><p class="dim">正在读取…</p></aside>
</main>
<footer>想要一个知道你自己项目的 agent？&nbsp;<a href="#" title="还没上线">注册，先给你一个托管的</a></footer>
<script>
(function () {
  var id = location.pathname.split("/").filter(Boolean)[1] || "";
  var key = "gemsbang-guest:" + location.host;
  var token = null; try { token = localStorage.getItem(key); } catch (e) {}
  var view = null, owner = null, venue = null, left = 0, timer = null, retried = false;
  function el(tag, cls, children) { var e = document.createElement(tag); if (cls) e.className = cls; (children || []).forEach(function (c) { e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); }); return e; }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function link(href, label) { var a = el("a", "", [label]); a.href = href; return a; }
  function api(method, path, body) {
    var headers = { accept: "application/json" };
    if (token) headers.authorization = "Bearer " + token;
    if (body) headers["content-type"] = "application/json";
    return fetch(path, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined })
      .then(function (res) { return res.json().catch(function () { return {}; }).then(function (json) { return { status: res.status, json: json }; }); });
  }
  function keep(t) { token = t; try { localStorage.setItem(key, t); } catch (e) {} }
  function drop() { token = null; try { localStorage.removeItem(key); } catch (e) {} }
  function load() {
    return api("GET", "/c/" + encodeURIComponent(id)).then(function (r) {
      if (r.status === 401 && !retried) { retried = true; drop(); return load(); }
      var card = document.getElementById("card"), ask = document.getElementById("ask");
      if (r.status !== 200) { clear(card); card.appendChild(el("p", "dim", [r.json.error || "没有这张卡"])); clear(ask); return; }
      view = r.json; owner = view.owner; left = view.guest ? view.guest.left : view.quota.perGuestPerDay; venue = view.guest && view.guest.venue ? view.guest.venue : null;
      drawCard(); drawAsk(); if (venue) poll();
    });
  }
  function drawCard() {
    var c = view.card, L = view.lines, root = document.getElementById("card");
    clear(root);
    root.appendChild(el("h1", "", [c.title]));
    root.appendChild(el("div", "dim", [L.byline]));
    if (c.demo || c.open) {
      var p = el("p");
      if (c.demo) p.appendChild(link(c.demo, "演示录像"));
      if (c.demo && c.open) p.appendChild(document.createTextNode(" · "));
      if (c.open) { p.appendChild(document.createTextNode("在你的浏览器里也能试：")); p.appendChild(link(c.open, "打开 demo")); }
      root.appendChild(p);
    }
    if (c.summary) { var s = el("p", "", [c.summary]); if (L.summaryTag) { s.appendChild(document.createTextNode(" ")); s.appendChild(el("span", "tip", [L.summaryTag])); } root.appendChild(s); }
    if (c.replay.length) {
      root.appendChild(el("h2", "", ["怎么做出来的 · 回放"]));
      var ul = el("ul");
      c.replay.forEach(function (r) { var li = el("li", "", ["第 " + r.turn + " 轮 · " + r.label]); if (r.src) { li.appendChild(document.createTextNode(" ")); li.appendChild(el("span", "dim", [r.src])); } ul.appendChild(li); });
      root.appendChild(ul);
    }
    root.appendChild(el("h2", "", ["公开范围"]));
    root.appendChild(el("p", "", [L.range]));
    if (c.evidence.length) { root.appendChild(el("h2", "", ["证据"])); var ev = el("ul", "evidence"); c.evidence.forEach(function (e) { ev.appendChild(el("li", "", [e])); }); root.appendChild(ev); }
    if (L.use) { root.appendChild(el("h2", "", ["拿去用"])); root.appendChild(el("p", "", [L.use])); }
    root.appendChild(el("h2", "", ["打赏"]));
    var tip = el("p");
    ["2 积分", "5 积分"].forEach(function (t) { var b = el("button", "", [t]); b.disabled = true; b.title = "打赏要登录"; tip.appendChild(b); tip.appendChild(document.createTextNode(" ")); });
    tip.appendChild(el("span", "dim", ["打赏要登录"]));
    root.appendChild(tip);
  }
  function drawAsk() {
    var a = view.agent, L = view.lines, root = document.getElementById("ask");
    clear(root);
    root.appendChild(el("h2", "first", ["问作者的 agent"]));
    root.appendChild(el("div", "", [el("b", "", [a.name]), " · " + a.presenceWord]));
    var line = el("div", "dim", [L.guestHeader]); line.id = "guest-line"; root.appendChild(line);
    var thread = el("div"); thread.id = "thread"; root.appendChild(thread);
    var form = el("form"), input = el("input"), btn = el("button", "primary", ["问"]);
    input.type = "text"; input.id = "text"; input.placeholder = "问" + a.name + "…"; input.maxLength = 2000; btn.type = "submit";
    form.appendChild(input); form.appendChild(btn); root.appendChild(form);
    var n = el("div", "note"); n.id = "note"; root.appendChild(n);
    form.addEventListener("submit", function (e) { e.preventDefault(); var t = input.value.trim(); if (t) send(t); });
  }
  function note(s) { document.getElementById("note").textContent = s || ""; }
  function send(text) {
    note("");
    return api("POST", "/ask/" + encodeURIComponent(id), { text: text }).then(function (r) {
      if (r.status === 401 && !retried) { retried = true; drop(); return send(text); }
      if (r.status !== 201) { note(r.json.error || "没发出去"); return; }
      if (r.json.token) keep(r.json.token);
      venue = r.json.venue; left = r.json.left;
      document.getElementById("text").value = "";
      document.getElementById("guest-line").textContent = view.lines.guestHeader.replace(/今天还能问 \\d+ 句/, "今天还能问 " + left + " 句");
      poll();
    });
  }
  function poll() {
    if (timer) clearTimeout(timer);
    if (!venue) return;
    api("GET", "/" + encodeURIComponent(owner) + "/venues/" + encodeURIComponent(venue) + ".geml").then(function (r) {
      if (r.status === 200) drawThread(r.json.blocks || []);
      timer = setTimeout(poll, 3000);
    });
  }
  function drawThread(blocks) {
    var a = view.agent, thread = document.getElementById("thread");
    clear(thread);
    blocks.forEach(function (b) {
      var v = b.value; if (!v || typeof v.text !== "string" || typeof v.speaker !== "string") return;
      if (v.speaker === "host") { thread.appendChild(el("div", "msg system", [v.text])); return; }
      var guest = v.speaker.indexOf("guest:") === 0, agent = v.speaker.indexOf("agent:") === 0, who = v.speaker.replace(/^person:/, "");
      var body = el("div", "body", [el("div", "text", [v.text])]);
      if (agent) body.appendChild(el("div", "badge", [view.lines.agentBadge]));
      else if (!guest) body.appendChild(el("div", "who", [who]));
      thread.appendChild(el("div", guest ? "msg guest" : agent ? "msg agent" : "msg", [el("div", "avatar", [guest ? "客" : agent ? a.name.slice(0, 1) : who.slice(0, 1)]), body]));
    });
  }
  load();
})();
</script>
</body>
</html>
`;
}
