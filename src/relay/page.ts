// The relay's pages (transport §7.1): static HTML, one per road, served by
// server.ts to a browser and filled from the relay's JSON. `/c/<id>` is the
// share card — the card on the left, 「问作者的 agent」 on the right, 打赏 once
// logged in; `/login` the email code, 登录即注册, the token shown once with
// the line that connects a desktop; `/g/<id>` and `/r/<id>` the claim pages
// of a gift and a red packet. No build step, no framework: every node is
// built with DOM calls, so nothing the relay returns runs as markup. The
// guest's token and the person's live in the browser's storage; a token the
// relay no longer knows is dropped. The words the pages share with the board
// come rendered in the JSON, written and tested once.
export const HTML_TYPE = "text/html; charset=utf-8";

const STYLE = `
:root { --ink: #1a1a1a; --dim: #6b6b6b; --line: #e3e3e3; --bg: #fafafa; --card: #fff; --blue: #0a74c0; --green: #1f7a3a; --amber: #b8860b; }
* { box-sizing: border-box; }
body { margin: 0; font: 15px/1.6 -apple-system, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif; color: var(--ink); background: var(--bg); }
header, footer { display: flex; gap: 16px; align-items: center; padding: 12px 24px; background: var(--card); border-bottom: 1px solid var(--line); }
footer { border-top: 1px solid var(--line); border-bottom: 0; justify-content: center; color: var(--dim); }
header .brand { font-weight: 700; color: var(--blue); }
header .tag, .dim { color: var(--dim); }
header nav { margin-left: auto; display: flex; gap: 8px; align-items: center; }
button, a.btn { font: inherit; padding: 6px 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--card); cursor: pointer; color: var(--ink); text-decoration: none; }
button[disabled] { color: var(--dim); cursor: default; }
button.primary { background: var(--blue); color: #fff; border-color: var(--blue); }
main { display: grid; grid-template-columns: 3fr 2fr; gap: 24px; max-width: 1200px; margin: 24px auto; padding: 0 24px; }
main.one { grid-template-columns: 1fr; max-width: 640px; }
@media (max-width: 860px) { main { grid-template-columns: 1fr; } }
section, aside { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 20px 24px; }
section.wide { grid-column: 1 / -1; }
.hidden { display: none; }
h1 { font-size: 22px; margin: 0 0 4px; }
h2 { font-size: 14px; color: var(--dim); margin: 20px 0 6px; font-weight: 600; }
h2.first { margin-top: 0; }
ul { margin: 0; padding-left: 20px; }
pre { white-space: pre-wrap; word-break: break-all; background: #f3f3f3; padding: 8px 12px; border-radius: 8px; }
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
form { display: flex; gap: 8px; margin: 8px 0; }
input[type=text], input[type=email] { flex: 1; font: inherit; padding: 8px 12px; border: 1px solid var(--line); border-radius: 8px; min-width: 0; }
.note { color: var(--amber); font-size: 13px; min-height: 1.2em; }
`;

/** What every page's script shares: nodes, fetch with a token, the stored person, the login box (email → the code mailed → a name the first time: 登录即注册). */
const SHARED_JS = `
  function el(tag, cls, children) { var e = document.createElement(tag); if (cls) e.className = cls; (children || []).forEach(function (c) { e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); }); return e; }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function link(href, label) { var a = el("a", "", [label]); a.href = href; return a; }
  function api(method, path, body, token) {
    var headers = { accept: "application/json" };
    if (token) headers.authorization = "Bearer " + token;
    if (body) headers["content-type"] = "application/json";
    return fetch(path, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined })
      .then(function (res) { return res.json().catch(function () { return {}; }).then(function (json) { return { status: res.status, json: json }; }); });
  }
  var PERSON_KEY = "gemsbang-person:" + location.host;
  function person() { try { var v = JSON.parse(localStorage.getItem(PERSON_KEY) || "null"); return v && v.token ? v : null; } catch (e) { return null; } }
  function keepPerson(p) { try { localStorage.setItem(PERSON_KEY, JSON.stringify(p)); } catch (e) {} }
  function dropPerson() { try { localStorage.removeItem(PERSON_KEY); } catch (e) {} }
  function loginBox(root, onDone) {
    clear(root);
    root.appendChild(el("h2", "first", ["登录 · 邮件验证码 · 登录即注册"]));
    var email = el("input"); email.type = "email"; email.placeholder = "邮箱"; email.required = true;
    var code = el("input"); code.type = "text"; code.placeholder = "六位验证码"; code.maxLength = 6;
    var name = el("input", "hidden"); name.type = "text"; name.placeholder = "取个名字（第一次登录）"; name.maxLength = 64;
    var sendBtn = el("button", "", ["发验证码"]), goBtn = el("button", "primary", ["登录"]);
    var note = el("div", "note");
    var f1 = el("form", "", [email, sendBtn]), f2 = el("form", "hidden", [code, name, goBtn]);
    root.appendChild(f1); root.appendChild(f2); root.appendChild(note);
    f1.addEventListener("submit", function (e) {
      e.preventDefault(); note.textContent = "";
      api("POST", "/login", { email: email.value.trim() }).then(function (r) {
        if (r.status !== 200) { note.textContent = r.json.error || "没发出去"; return; }
        note.textContent = "验证码发到邮箱了，10 分钟内有效"; f2.classList.remove("hidden"); if (!r.json.known) name.classList.remove("hidden"); code.focus();
      });
    });
    f2.addEventListener("submit", function (e) {
      e.preventDefault(); note.textContent = "";
      var body = { email: email.value.trim(), code: code.value.trim() }; if (name.value.trim()) body.name = name.value.trim();
      api("POST", "/login/verify", body).then(function (r) {
        if (r.status !== 200) { note.textContent = r.json.error || "没登上"; return; }
        keepPerson({ token: r.json.token, person: r.json.person }); onDone(r.json);
      });
    });
  }
`;

function html(title: string, body: string, script: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${STYLE}</style>
</head>
<body>
${body}
<script>
(function () {${SHARED_JS}
${script}
})();
</script>
</body>
</html>
`;
}

/** `/c/<id>`: the share card and 「问作者的 agent」; 登录 in the header, 打赏 to the card's agent once logged in. */
export function sharePage(): string {
  return html("Gemsbang · 分享卡", `<header><span class="brand">Gemsbang</span><span class="tag">不用注册就能看、能问</span><nav><button id="login-btn">登录</button><a class="btn" href="/login">要一个自己的 agent</a></nav></header>
<main>
<section id="login-box" class="wide hidden"></section>
<section id="card"><p class="dim">正在读取…</p></section>
<aside id="ask"><h2 class="first">问作者的 agent</h2><p class="dim">正在读取…</p></aside>
</main>
<footer>想要一个知道你自己项目的 agent？&nbsp;<a href="/login">注册，先给你一个托管的</a></footer>`, `
  var id = location.pathname.split("/").filter(Boolean)[1] || "";
  var key = "gemsbang-guest:" + location.host;
  var token = null; try { token = localStorage.getItem(key); } catch (e) {}
  var view = null, owner = null, venue = null, left = 0, timer = null, retried = false;
  function keep(t) { token = t; try { localStorage.setItem(key, t); } catch (e) {} }
  function drop() { token = null; try { localStorage.removeItem(key); } catch (e) {} }
  function drawHeader() {
    var btn = document.getElementById("login-btn"), box = document.getElementById("login-box"), p = person();
    btn.textContent = p ? "已登录 " + p.person + " · 退出" : "登录";
    btn.onclick = function () {
      if (person()) { dropPerson(); box.classList.add("hidden"); drawHeader(); if (view) drawCard(); return; }
      box.classList.remove("hidden");
      loginBox(box, function () { box.classList.add("hidden"); drawHeader(); if (view) drawCard(); });
    };
  }
  function load() {
    return api("GET", "/c/" + encodeURIComponent(id), null, token).then(function (r) {
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
    var tip = el("p"), me = person();
    [2, 5].forEach(function (n) {
      var b = el("button", "", [n + " 积分"]);
      if (me) b.addEventListener("click", function () { sendTip(n); }); else { b.disabled = true; b.title = "打赏要登录"; }
      tip.appendChild(b); tip.appendChild(document.createTextNode(" "));
    });
    tip.appendChild(el("span", "dim", [me ? "给 " + view.agent.name + "，落到 " + owner + " 的钱包" : "打赏要登录"]));
    root.appendChild(tip);
    var tn = el("div", "note"); tn.id = "tip-note"; root.appendChild(tn);
  }
  function sendTip(n) {
    var me = person(), note = document.getElementById("tip-note");
    if (!me) return;
    api("POST", "/wallet/tip", { to: "agent:" + view.agent.name + "@" + owner, credits: n }, me.token).then(function (r) {
      if (r.status === 401) { dropPerson(); drawHeader(); drawCard(); document.getElementById("tip-note").textContent = "登录过期了，再登一次"; return; }
      note.textContent = r.status === 200 ? "打赏了 " + n + " 积分 · 钱包还有 " + r.json.balance : (r.json.error || "没打成");
    });
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
    return api("POST", "/ask/" + encodeURIComponent(id), { text: text }, token).then(function (r) {
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
    api("GET", "/" + encodeURIComponent(owner) + "/venues/" + encodeURIComponent(venue) + ".geml", null, token).then(function (r) {
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
  drawHeader();
  load();`);
}

/** `/login`: the email code, 登录即注册; afterwards who you are, the hosted agent's DM on a first login, and the line that connects a desktop — the token shown this once. */
export function loginPage(): string {
  return html("Gemsbang · 登录", `<header><span class="brand">Gemsbang</span><span class="tag">登录即注册 · 邮件验证码</span></header>
<main class="one"><section id="box"></section></main>
<footer>注册后，你的托管 agent 在私信里等你。</footer>`, `
  var box = document.getElementById("box");
  function show(p, fresh) {
    clear(box);
    box.appendChild(el("h1", "", ["你是 " + p.person]));
    if (fresh && fresh.new) box.appendChild(el("p", "", ["你的托管 agent " + fresh.agent + " 已在私信「" + fresh.venue + "」里等你。"]));
    if (fresh) { box.appendChild(el("p", "", ["在电脑上连上（令牌只显示这一次）："])); box.appendChild(el("pre", "", ["gemworks connect setup --relay " + location.origin + " --token " + fresh.token])); }
    var out = el("button", "", ["退出"]);
    out.addEventListener("click", function () { dropPerson(); loginBox(box, function (r) { show({ person: r.person }, r); }); });
    box.appendChild(out);
  }
  var p = person();
  if (p) show(p, null); else loginBox(box, function (r) { show({ person: r.person }, r); });`);
}

/** `/g/<id>`: who gives how much with what line; 领取 once logged in (登录即注册), once. */
export function giftPage(): string {
  return html("Gemsbang · 礼物", `<header><span class="brand">Gemsbang</span><span class="tag">礼物</span></header>
<main class="one"><section id="gift"><p class="dim">正在读取…</p></section><section id="box" class="hidden"></section></main>
<footer>领礼物要登录，登录即注册。</footer>`, `
  var id = location.pathname.split("/").filter(Boolean)[1] || "";
  var root = document.getElementById("gift"), box = document.getElementById("box");
  function draw() {
    api("GET", "/g/" + encodeURIComponent(id)).then(function (r) {
      clear(root);
      if (r.status !== 200) { root.appendChild(el("p", "dim", [r.json.error || "没有这份礼物"])); return; }
      var g = r.json;
      root.appendChild(el("h1", "", [g.from + " 送你 " + g.credits + " 积分"]));
      if (g.note) root.appendChild(el("p", "", ["「" + g.note + "」"]));
      if (g.claimed) { root.appendChild(el("p", "dim", ["已经被 " + g.claimed + " 领了"])); box.classList.add("hidden"); return; }
      var me = person(), note = el("div", "note"), b = el("button", "primary", ["领取"]);
      if (!me) { b.disabled = true; root.appendChild(el("p", "dim", ["领礼物要登录，登录即注册"])); box.classList.remove("hidden"); loginBox(box, function () { box.classList.add("hidden"); draw(); }); }
      b.addEventListener("click", function () {
        api("POST", "/g/" + encodeURIComponent(id) + "/claim", {}, me.token).then(function (c) {
          if (c.status === 401) { dropPerson(); draw(); return; }
          if (c.status !== 200) { note.textContent = c.json.error || "没领到"; return; }
          note.textContent = "领了 " + c.json.credits + " 积分 · 钱包 " + c.json.balance; draw();
        });
      });
      root.appendChild(b); root.appendChild(note);
    });
  }
  draw();`);
}

/** `/r/<id>`: the packet as a member sees it — the total, the shares, who took what; 领一份 while any is left. */
export function packetPage(): string {
  return html("Gemsbang · 红包", `<header><span class="brand">Gemsbang</span><span class="tag">红包</span></header>
<main class="one"><section id="packet"><p class="dim">正在读取…</p></section><section id="box" class="hidden"></section></main>
<footer>领红包要登录，登录即注册。</footer>`, `
  var id = location.pathname.split("/").filter(Boolean)[1] || "";
  var root = document.getElementById("packet"), box = document.getElementById("box");
  function draw() {
    var me = person();
    if (!me) { clear(root); root.appendChild(el("p", "dim", ["看红包要登录，登录即注册"])); box.classList.remove("hidden"); loginBox(box, function () { box.classList.add("hidden"); draw(); }); return; }
    api("GET", "/r/" + encodeURIComponent(id), null, me.token).then(function (r) {
      clear(root);
      if (r.status === 401) { dropPerson(); draw(); return; }
      if (r.status !== 200) { root.appendChild(el("p", "dim", [r.json.error || "没有这个红包"])); return; }
      var p = r.json;
      root.appendChild(el("h1", "", [p.from + " 的红包 · " + p.credits + " 积分 · " + p.shares + " 份"]));
      if (p.note) root.appendChild(el("p", "", ["「" + p.note + "」"]));
      root.appendChild(el("p", "dim", ["领了 " + p.claims.length + " 份" + (p.returned ? " · 24 小时没领完，退回了" : " · 还剩 " + p.left + " 份")]));
      var ul = el("ul"); p.claims.forEach(function (c) { ul.appendChild(el("li", "", [c.by + " · " + c.amount + " 积分"])); }); root.appendChild(ul);
      if (typeof p.mine === "number") { root.appendChild(el("p", "", ["你领到 " + p.mine + " 积分"])); return; }
      if (p.returned || p.left === 0) return;
      var note = el("div", "note"), b = el("button", "primary", ["领一份"]);
      b.addEventListener("click", function () {
        api("POST", "/r/" + encodeURIComponent(id) + "/claim", {}, me.token).then(function (c) {
          if (c.status !== 200) { note.textContent = c.json.error || "没领到"; return; }
          note.textContent = "领了 " + c.json.amount + " 积分 · 钱包 " + c.json.balance; draw();
        });
      });
      root.appendChild(b); root.appendChild(note);
    });
  }
  draw();`);
}
