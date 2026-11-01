// gemsbang's pages (transport §7.1): static HTML, one per road, served by
// avatar-server.ts to a browser and filled from the relay's JSON. `/i/<code>`
// is the way into a group for a person: who is in it, what happens once in,
// the phone and the code, which avatar goes in and what it is called;
// `/g/<group>` is the group, open to every member (spec §7.2); `/login` the
// phone code alone. Each page carries its words in the request's language
// (spec §7.6) and the relay answers its refusals in it too. No build step, no
// framework: every node is built with DOM calls, so nothing the relay
// returns runs as markup. The person's token lives in the browser's storage.
import { CODES, say, type Lang } from "../core/avatar/words.js";

export const HTML_TYPE = "text/html; charset=utf-8";

const STYLE = `
:root { --ink: #1a1a1a; --dim: #6b6b6b; --line: #e3e3e3; --bg: #f5f5f4; --card: #fff; --blue: #0a74c0; --green: #1f7a3a; --amber: #b8860b; }
* { box-sizing: border-box; }
body { margin: 0; font: 15px/1.6 -apple-system, "PingFang SC", "Hiragino Sans", "Microsoft YaHei", system-ui, sans-serif; color: var(--ink); background: var(--bg); }
header { display: flex; gap: 12px; align-items: center; padding: 10px 16px; background: var(--card); border-bottom: 1px solid var(--line); }
header .brand { font-weight: 700; color: var(--blue); }
header nav { margin-left: auto; display: flex; gap: 8px; font-size: 13px; }
header nav a { color: var(--dim); text-decoration: none; }
header nav a.on { color: var(--ink); font-weight: 600; }
main { max-width: 560px; margin: 16px auto; padding: 0 16px; display: flex; flex-direction: column; gap: 12px; }
section { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 16px; }
h1 { font-size: 20px; margin: 0 0 4px; }
h2 { font-size: 14px; color: var(--dim); margin: 0 0 8px; font-weight: 600; }
.dim { color: var(--dim); font-size: 13px; }
.note { color: var(--amber); font-size: 13px; min-height: 1.2em; }
.banner { background: #eef7f0; color: var(--green); border-color: #cfe8d6; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
.chip { display: inline-flex; gap: 6px; align-items: center; padding: 3px 10px 3px 3px; border: 1px solid var(--line); border-radius: 999px; font-size: 13px; background: var(--card); }
button.chip { cursor: pointer; padding: 4px 12px; }
button.chip.on { border-color: var(--blue); color: var(--blue); }
.face { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; color: #fff; font-size: 12px; background: #8a8a8a; }
form, .row { display: flex; gap: 8px; margin: 8px 0; align-items: center; }
input[type=text], input[type=tel] { flex: 1; font: inherit; padding: 8px 12px; border: 1px solid var(--line); border-radius: 8px; min-width: 0; }
button { font: inherit; padding: 8px 14px; border: 1px solid var(--line); border-radius: 8px; background: var(--card); cursor: pointer; color: var(--ink); }
button.primary { background: var(--blue); color: #fff; border-color: var(--blue); }
button.link { border: 0; background: none; color: var(--dim); padding: 4px 0; text-decoration: underline; }
label.pick { display: flex; gap: 8px; align-items: center; padding: 6px 0; }
#thread { display: flex; flex-direction: column; gap: 10px; min-height: 160px; }
.msg { display: flex; gap: 10px; }
.msg .face { width: 32px; height: 32px; font-size: 14px; flex: none; }
.msg .who { font-size: 12px; color: var(--dim); }
.msg .tag { font-size: 11px; color: var(--blue); border: 1px solid #cfe2f3; border-radius: 4px; padding: 0 4px; margin-left: 4px; }
.msg .text { white-space: pre-wrap; word-break: break-word; }
.sys { color: var(--dim); font-size: 13px; text-align: center; }
.need { border: 1px dashed var(--amber); border-radius: 12px; padding: 12px 16px; background: var(--card); }
.need .who { color: var(--amber); font-size: 12px; }
.need .say { background: #f3f3f3; border-radius: 8px; padding: 6px 10px; margin: 6px 0; }
`;

/** What every page's script shares: nodes, the stored token, the relay's API in the page's language, the phone-and-code box, the language links. */
const SHARED_JS = `
  function el(tag, cls, children) { var e = document.createElement(tag); if (cls) e.className = cls; (children || []).forEach(function (c) { e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); }); return e; }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function say(code, params) { var w = WORDS[code] || code; return w.replace(/\\{(\\w+)\\}/g, function (all, k) { return params && k in params ? String(params[k]) : all; }); }
  function getToken() { try { return localStorage.getItem("gemsbang.token") || ""; } catch (e) { return ""; } }
  function setToken(t) { try { if (t) localStorage.setItem("gemsbang.token", t); else localStorage.removeItem("gemsbang.token"); } catch (e) {} }
  function api(method, path, body) {
    var headers = { accept: "application/json" };
    var token = getToken();
    if (token) headers.authorization = "Bearer " + token;
    if (body) headers["content-type"] = "application/json";
    var url = path + (path.indexOf("?") === -1 ? "?" : "&") + "lang=" + LANG;
    return fetch(url, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined })
      .then(function (res) { return res.json().then(function (data) { if (res.status === 401 && token) setToken(""); return { status: res.status, data: data }; }); });
  }
  function face(name) { var f = el("span", "face", [Array.from(name || "?")[0]]); return f; }
  function chip(name) { return el("span", "chip", [face(name), name]); }
  function loginBox(into, done) {
    var note = el("div", "note");
    var phone = el("input"); phone.type = "tel"; phone.placeholder = say("page.phone"); phone.autocomplete = "tel";
    var send = el("button", "primary", [say("page.sendCode")]);
    var code = el("input"); code.type = "text"; code.inputMode = "numeric"; code.placeholder = say("page.code"); code.autocomplete = "one-time-code";
    var verify = el("button", "primary", [say("page.verify")]);
    var second = el("form", "", [code, verify]); second.style.display = "none";
    var first = el("form", "", [phone, send]);
    first.onsubmit = function (e) { e.preventDefault(); note.textContent = ""; api("POST", "/login", { phone: phone.value }).then(function (r) { if (r.status !== 200) { note.textContent = r.data.reason; return; } note.textContent = say("code.sent"); second.style.display = ""; code.focus(); }); };
    second.onsubmit = function (e) { e.preventDefault(); api("POST", "/login/verify", { phone: phone.value, code: code.value }).then(function (r) { if (r.status !== 200) { note.textContent = r.data.reason; return; } setToken(r.data.token); done(); }); };
    into.appendChild(first); into.appendChild(second); into.appendChild(note);
  }
  function langLinks() {
    var nav = document.querySelector("header nav");
    ["zh", "en", "ja"].forEach(function (l) {
      var q = new URLSearchParams(location.search); q.set("lang", l);
      var a = el("a", l === LANG ? "on" : "", [{ zh: "中文", en: "English", ja: "日本語" }[l]]); a.href = location.pathname + "?" + q.toString();
      nav.appendChild(a);
    });
  }
  langLinks();
`;

/** The way in (spec §6.2): the group, then the phone and the code, then which avatar and what it is called, then 进群. */
const JOIN_JS = `
  var code = location.pathname.split("/")[2];
  var params = new URLSearchParams(location.search);
  var main = document.getElementById("app");
  function infoPath() { var q = []; if (params.get("by")) q.push("by=" + encodeURIComponent(params.get("by"))); if (params.get("call")) q.push("call=" + encodeURIComponent(params.get("call"))); return "/i/" + code + (q.length ? "?" + q.join("&") : ""); }
  function load() { api("GET", infoPath()).then(function (r) { clear(main); if (r.status !== 200) { main.appendChild(el("section", "", [el("p", "", [r.data.reason])])); return; } render(r.data); }); }
  function render(info) {
    var top = el("section", "", [el("h1", "", [say("page.join.title", { group: info.group.name })])]);
    var chips = el("div", "chips", info.group.members.map(function (m) { return chip(m.name); }));
    chips.appendChild(el("span", "dim", [say("page.join.count", { count: info.group.count })]));
    top.appendChild(chips);
    if (info.owner) top.appendChild(el("div", "dim", [say("page.join.owner", { name: info.owner.name })]));
    top.appendChild(el("p", "", [say("page.join.promise")]));
    if (info.approve) top.appendChild(el("div", "dim", [say("page.join.approve")]));
    main.appendChild(top);
    var step = el("section");
    main.appendChild(step);
    if (!info.you) { loginBox(step, load); return; }
    if (info.you.pick.kind === "in") { location.href = "/g/" + info.group.id; return; }
    var choice = info.you.pick.kind === "known" ? info.you.pick.avatar : "new";
    var note = el("div", "note");
    var naming = el("div");
    if (info.you.avatars.length > 0) {
      step.appendChild(el("h2", "", [say("page.join.as")]));
      info.you.avatars.concat([{ id: "new", name: say("page.join.new") }]).forEach(function (a) {
        var radio = el("input"); radio.type = "radio"; radio.name = "as"; radio.value = a.id; radio.checked = a.id === choice;
        radio.onchange = function () { choice = a.id; naming.style.display = choice === "new" ? "" : "none"; };
        var label = el("label", "pick", [radio, a.id === "new" ? a.name : chip(a.name)]);
        if (a.id === choice && a.id !== "new") label.appendChild(el("span", "dim", [say("page.join.known")]));
        step.appendChild(label);
      });
    }
    naming.style.display = choice === "new" ? "" : "none";
    naming.appendChild(el("h2", "", [say("page.name.title")]));
    var own = el("input"); own.type = "text"; own.placeholder = say("page.name.own"); own.maxLength = 24;
    var child = el("input"); child.type = "text"; child.placeholder = say("page.name.child"); child.maxLength = 12;
    var childRow = el("div", "row", [child]); childRow.style.display = "none";
    var template = "";
    child.oninput = function () { own.value = child.value.trim() ? template.replace("__", child.value.trim()) : ""; };
    var sugg = el("div", "chips");
    info.suggestions.forEach(function (s) {
      var b = el("button", "chip", [s.text]); b.type = "button";
      b.onclick = function () { Array.from(sugg.children).forEach(function (x) { x.className = "chip"; }); b.className = "chip on"; if (s.blank) { template = s.text; childRow.style.display = ""; child.focus(); own.value = ""; } else { childRow.style.display = "none"; own.value = s.text; } };
      sugg.appendChild(b);
      if (s.kind === "default") sugg.appendChild(el("div", "dim", [say("page.name.defaultNote")]));
    });
    naming.appendChild(sugg); naming.appendChild(childRow); naming.appendChild(el("div", "row", [own]));
    var skip = el("button", "link", [say("page.name.skip")]); skip.type = "button";
    naming.appendChild(skip);
    step.appendChild(naming);
    var go = el("button", "primary", [say("page.join.go")]);
    step.appendChild(el("div", "row", [go])); step.appendChild(note);
    function join(body) {
      api("POST", "/i/" + code + "/join", body).then(function (r) {
        if (r.status >= 300) { note.textContent = r.data.reason; return; }
        if (r.data.pending) { clear(step); step.appendChild(el("p", "", [say("page.join.pending")])); return; }
        location.href = "/g/" + r.data.venue.id + "?joined=" + encodeURIComponent(r.data.avatar.name);
      });
    }
    var by = params.get("by") ? { by: params.get("by") } : {};
    go.onclick = function () { if (choice !== "new") join(Object.assign({ as: choice }, by)); else if (own.value.trim()) join(Object.assign({ name: own.value.trim() }, by)); else join(Object.assign({ new: true }, by)); };
    skip.onclick = function () { join(Object.assign({ new: true }, by)); };
  }
  load();
`;

/** The group (spec §7.2): who you are here, what was said, the box to say something as your avatar, 把群转给别人, 有事时提醒我. */
const GROUP_JS = `
  var id = location.pathname.split("/")[2];
  var params = new URLSearchParams(location.search);
  var main = document.getElementById("app");
  var mine = null, shown = "", needs = [];
  function load() {
    if (!getToken()) { clear(main); var s = el("section", "", [el("h2", "", [say("page.group.login")])]); main.appendChild(s); loginBox(s, load); return; }
    api("GET", "/venues").then(function (r) {
      if (r.status !== 200) { clear(main); main.appendChild(el("section", "", [r.data.reason])); return; }
      mine = r.data.filter(function (v) { return v.id === id; })[0];
      if (!mine) { clear(main); main.appendChild(el("section", "", [say("page.group.notMember")])); return; }
      return api("GET", "/needs").then(function (rn) {
        needs = rn.status === 200 ? rn.data.filter(function (n) { return n.state === "open" && n.venue && n.venue.owner === mine.owner && n.venue.id === id; }) : [];
        return api("GET", "/venues/" + mine.owner + "/" + id + "?as=" + mine.as);
      }).then(function (r2) { if (r2 && r2.status === 200) render(r2.data); });
    });
  }
  function nameOf(venue, speaker) { var aid = String(speaker || "").replace(/^avatar:/, ""); var m = venue.members.filter(function (x) { return x.id === aid; })[0]; return m ? m.name : aid; }
  function render(data) {
    var key = data.blocks.length + ":" + (data.blocks.length ? data.blocks[data.blocks.length - 1].id : "") + ":" + needs.map(function (n) { return n.id; }).join(",");
    if (key === shown && document.getElementById("thread")) return;
    shown = key;
    var me = data.venue.members.filter(function (x) { return x.id === mine.as; })[0];
    var myName = me ? me.name : mine.as;
    clear(main);
    if (params.get("joined")) main.appendChild(el("section", "banner", [say("page.join.in", { name: params.get("joined") })]));
    main.appendChild(el("section", "", [el("h1", "", [data.venue.name]), el("div", "dim", [say("page.join.count", { count: data.venue.members.length }) + " · " + say("page.group.as", { name: myName })])]));
    needs.forEach(function (n) { main.appendChild(needCard(n)); });
    var thread = el("div"); thread.id = "thread";
    var said = 0;
    data.blocks.forEach(function (b) {
      var v = b.value;
      if (/^member-\\d+$/.test(b.id)) { thread.appendChild(el("div", "sys", [say("page.group.joined", { name: nameOf(data.venue, v.avatar) })])); return; }
      if (/^note-\\d+$/.test(b.id) && v.note === "hops") { thread.appendChild(el("div", "sys", [say("page.group.hops")])); return; }
      if (typeof v.text !== "string" || !v.speaker) return;
      said++;
      var name = nameOf(data.venue, v.speaker);
      var who = el("div", "who", [name]);
      if (v.by === "agent") who.appendChild(el("span", "tag", [say("page.group.mark")]));
      var body = el("div", "", [who, el("div", "text", [v.text])]);
      if (Array.isArray(v.facts) && v.facts.length > 0) body.appendChild(el("div", "dim", [say("page.group.facts", { facts: v.facts.map(function (f) { return f.label + " " + say(f.ok ? "page.group.factOk" : "page.group.factFailed"); }).join(" · ") })]));
      thread.appendChild(el("div", "msg", [face(name), body]));
    });
    if (said === 0) thread.appendChild(el("div", "dim", [say("page.group.empty")]));
    main.appendChild(el("section", "", [thread]));
    var input = el("input"); input.type = "text"; input.placeholder = say("page.group.say", { name: myName }); input.maxLength = 4000;
    var note = el("div", "note");
    var form = el("form", "", [input, el("button", "primary", [say("page.group.send")])]);
    form.onsubmit = function (e) { e.preventDefault(); if (!input.value.trim()) return; var text = input.value; input.value = ""; api("POST", "/venues/" + mine.owner + "/" + id + "/messages", { as: mine.as, text: text, id: "w-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) }).then(function (r) { if (r.status >= 300) { note.textContent = r.data.reason; input.value = text; } else load(); }); };
    var share = el("button", "", [say("page.group.share")]); share.type = "button";
    share.onclick = function () { api("GET", "/venues/" + mine.owner + "/" + id + "/link?as=" + mine.as).then(function (r) { if (r.status !== 200) { note.textContent = r.data.reason; return; } var url = location.origin + r.data.link.path; try { navigator.clipboard.writeText(url); } catch (e) {} note.textContent = say("page.group.copied", { url: url }); }); };
    var notify = el("button", "", [say("page.group.notify")]); notify.type = "button";
    notify.onclick = function () { note.textContent = say("page.group.notifyLater"); };
    main.appendChild(el("section", "", [form, el("div", "row", [share, notify]), note]));
    window.scrollTo(0, document.body.scrollHeight);
  }
  /** A 需要你 card of the person's own avatar here (spec §7.3): only they see it; the words it would send; an option sends its words, 自己写 sends theirs. */
  function needCard(n) {
    var note = el("div", "note");
    var answer = function (body) { api("POST", "/needs/" + n.avatar + "/" + n.id, body).then(function (r) { if (r.status >= 300) note.textContent = r.data.reason; else { shown = ""; load(); } }); };
    var card = el("section", "need", [el("div", "who", [say("need.onlyYou") + " · " + say("need.kind." + n.kind) + " · " + say("need.waiting")]), el("p", "", [n.summary])]);
    if (n.checked) card.appendChild(el("div", "dim", [say("need.checked", { text: n.checked })]));
    if (n.draft) card.appendChild(el("div", "say", [say("need.willSay", { text: n.draft })]));
    var row = el("div", "row");
    n.options.forEach(function (o, i) { var b = el("button", i === 0 ? "primary" : "", [o.label]); b.onclick = function () { answer({ choice: i }); }; row.appendChild(b); });
    card.appendChild(row);
    if (n.kind !== "borrow" && n.kind !== "error") {
      var own = el("input"); own.type = "text"; own.placeholder = say("need.ownHint");
      var f = el("form", "", [own, el("button", "", [say("need.own")])]);
      f.onsubmit = function (e) { e.preventDefault(); if (own.value.trim()) answer({ choice: "own", text: own.value }); };
      card.appendChild(f);
    }
    card.appendChild(note);
    return card;
  }
  load();
  setInterval(function () { if (mine) load(); }, 4000);
`;

/** The phone code alone; back to where the person came from (`?next=`). */
const LOGIN_JS = `
  var main = document.getElementById("app");
  var s = el("section", "", [el("h1", "", [say("page.login.title")])]);
  main.appendChild(s);
  loginBox(s, function () { var next = new URLSearchParams(location.search).get("next"); if (next && next.charAt(0) === "/" && next.charAt(1) !== "/") location.href = next; else { clear(s); s.appendChild(el("p", "", [say("page.login.done")])); } });
`;

/** The page's words in the language: every page.* code and the few others the script says. */
function wordsFor(lang: Lang): Record<string, string> {
  const out: Record<string, string> = {};
  for (const code of CODES) if (code.startsWith("page.") || code.startsWith("need.") || code === "code.sent") out[code] = say(code, lang);
  return out;
}

function page(title: string, script: string, lang: Lang): string {
  const words = JSON.stringify(wordsFor(lang)).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="${lang}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>${STYLE}</style></head>
<body>
<header><span class="brand">gemsbang</span><nav></nav></header>
<main id="app"></main>
<script>
var LANG = ${JSON.stringify(lang)};
var WORDS = ${words};
${SHARED_JS}
${script}
</script>
</body>
</html>
`;
}

export const joinPage = (lang: Lang): string => page("gemsbang", JOIN_JS, lang);
export const groupPage = (lang: Lang): string => page("gemsbang", GROUP_JS, lang);
export const loginPage = (lang: Lang): string => page(say("page.login.title", lang), LOGIN_JS, lang);
