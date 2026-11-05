import { test } from "node:test";
import assert from "node:assert/strict";
import { fieldAction, gbBand, paneRows } from "../dist/hosts/claude-code/gb-panel.js";

const JOHN = { id: "a-0000000001", name: "John", color: "#2f6fb3", initial: "J", venues: ["设置页改版"], mark: true, muted: false };
const LILY = { id: "a-0000000002", name: "Lily 爸爸", color: "#b5543c", initial: "L", venues: ["三年二班家长"], mark: false, muted: false };
const ROW = (name, as, extra = {}) => ({ owner: as.id, id: `g-${name.length}000000000`.slice(0, 12), kind: "group", name, as, last: { who: "李四", text: "hi" }, at: "2026-11-01T06:00:00Z", time: "14:00", unread: 1, ...extra });
const VIEW = (extra = {}) => ({ relay: "https://im.example", loggedIn: true, lang: "zh", person: "p-0000000001", avatars: [JOHN, LILY], rows: [ROW("设置页改版", JOHN), ROW("三年二班家长", LILY)], unread: 2, needs: [], muted: { avatars: [], venues: [] }, notes: [], bodies: {}, ...extra });
const STATE = (extra = {}) => ({ page: "inbox", chat: null, link: null, address: null, groupAs: "new", session: "s-1", problem: null, zoneMinutes: 480, now: "2026-11-01T12:00:00Z", ...extra });
const words = (rows) => rows.map((r) => r.kind === "head" ? `#${r.title}${r.sub ? `(${r.sub})` : ""}${r.actions.length > 0 ? ` ${r.actions.map((a) => `[${a.label}]`).join("")}` : ""}` : r.kind === "text" || r.kind === "section" || r.kind === "event" ? r.text : r.kind === "chat" ? `[${r.row.as.initial}]${r.row.name}${r.flag ?? ""}${r.muted ? "~" : ""}` : r.kind === "input" ? `<${r.placeholder}>` : r.kind === "buttons" ? r.items.map((i) => `[${i.label}]`).join("") : r.kind === "toggle" ? `${r.on ? "☑" : "☐"}${r.label}` : r.kind === "copy" ? `{${r.text}}[${r.label}]` : r.kind === "message" ? `${r.item.who}${r.tag !== undefined ? `(${r.tag})` : ""} ${r.time}: ${r.item.text}` : r.kind === "list" ? r.items.map((i) => `${i.label}${r.mark === "tick" ? (i.on ? "✓" : "") : "›"}`).join("|") : r.kind === "pick" ? `${r.lead}{${r.badge.name}}${r.trail}${r.press !== undefined ? `[${r.press.label}]` : ""}` : r.kind === "empty" ? `(${r.text})${r.items.map((i) => `[${i.label}]`).join("")}` : r.kind === "tabs" ? `▁${r.items.map((i) => `${i.on ? "*" : ""}${i.label}${i.count ?? ""}`).join("|")}` : r.kind);

test("the sign-in (architecture §3.2, S28, S29, sketch ①–④): the other accounts the service set up as links the browser opens, boxed, then 或者 and one field for an email or a number, that Claude never sees them, the language at the foot; a browser opened, the pane waits with its link again and 取消; the address given, where its code went, 重发 and 换个邮箱 (换个号码 for a number); a new person names their first avatar; just in, the two ways to a first chat", () => {
  assert.deepEqual(words(paneRows(VIEW({ loggedIn: false, avatars: [], rows: [] }), STATE())), ["#GemsBang(你的几个身份，替你在各个群里)", "<you@example.com 或 +63 917 123 4567，回车发验证码>", "邮箱、手机号和验证码只填在这个侧栏里，Claude 看不到。", "select"], "no account set up: the field alone");
  const links = [{ kind: "google", url: "https://gemsbang.com/login/sso/google?h=1" }, { kind: "github", url: "https://gemsbang.com/login/sso/github?h=1" }];
  const page = paneRows(VIEW({ loggedIn: false, avatars: [], rows: [], signIn: links }), STATE());
  assert.deepEqual(page.map((r) => r.kind), ["head", "links", "or", "input", "text", "select"]);
  assert.deepEqual([page[1].boxed, page[1].items.map((i) => [i.label, i.href]), page[2].text, page[3].label], [true, [["用 Google 继续", links[0].url], ["用 GitHub 继续", links[1].url]], "或者", "邮箱或手机号"]);
  const waiting = paneRows(VIEW({ loggedIn: false, avatars: [], rows: [], signIn: links }), STATE({ sso: { kind: "github", url: links[1].url } }));
  assert.deepEqual(words(waiting), ["#GemsBang(你的几个身份，替你在各个群里)", "在浏览器里登录 GitHub", "登好了，这里会自己进去。", "links", "[取消]", "邮箱、手机号和验证码只填在这个侧栏里，Claude 看不到。"]);
  assert.deepEqual([waiting[3].items, waiting[4].items[0].action], [[{ key: "sso-reopen", label: "浏览器没打开？点这里", href: links[1].url }], { op: "sso-cancel" }]);
  assert.equal(words(paneRows(VIEW({ loggedIn: false, avatars: [], rows: [] }), STATE({ address: "+63 917 123 4567" }))).at(-1), "[没收到？重发][换个号码]");
  assert.deepEqual(words(paneRows(VIEW({ loggedIn: false, lang: "en", relay: "https://gemsbang.com", avatars: [], rows: [] }), STATE({ address: "john@example.com" }))), ["#Enter the code", "The code went to john@example.com, from gemsbang.com. It works for 10 minutes", "<6 digits, Enter signs in>", "[Not there? Send again][Another email]"]);
  const first = paneRows(VIEW({ avatars: [], rows: [], unread: 0, synced: "2026-11-01T12:00:00Z" }), STATE());
  assert.deepEqual(words(first), ["#GemsBang", "<名字，回车进去>", "这是你的第一个身份。到了别的场合可以换一个，比如在家长群里叫「Lily 爸爸」。以后随时能改名。"]);
  assert.equal(first[1].label, "大家怎么叫你？");
  assert.deepEqual(words(paneRows(VIEW({ avatars: [JOHN], rows: [], unread: 0, bodies: { "s-1": JOHN.id } }), STATE())), ["#GemsBang [＋]", "(还没有聊天)[建群][用链接进群]", "▁*聊天|联系人|我"], "just in: no chat yet, the two ways in the middle (P1c)");
});

test("账号与登录 (architecture §3.1, P10): the ways in, 解绑 only when there are two; 加一种登录方式 a link that opens its field, then its code in the same place (P10b); the devices with the avatars their agents play, this one tagged, the others signed out one by one or all at once; 退出这台设备的登录 in red, asked first (P10c); back to 我; nothing read yet, said so", () => {
  const account = { methods: [{ id: "email-1", kind: "email", shown: "j***@example.com", at: "t" }], devices: [
    { id: "token-a", name: "Mac · Claude Code", at: "2026-11-01T09:00:00Z", current: true, avatars: [{ id: JOHN.id, name: "John" }, { id: LILY.id, name: "Lily 爸爸" }] },
    { id: "token-b", name: "网页 · Safari", at: "2026-10-31T13:14:00Z", current: false, avatars: [] },
  ] };
  const shown = (rows) => rows.map((r) => r.kind === "kv" ? `${r.label}：${r.value}${r.press !== undefined ? `[${r.press.label}]` : ""}` : r.kind === "item" ? `${r.title}/${r.sub}${r.tag !== undefined ? `(${r.tag})` : ""}${r.press !== undefined ? `[${r.press.label}]` : ""}` : r.kind === "line" ? `[${r.press.label}]` : r.kind === "buttons" ? r.items.map((b) => `[${b.label}${b.danger ? "!" : ""}]`).join("") : r.kind === "card" ? `{<${r.top.placeholder}>[${r.top.submitLabel}]}` : r.kind === "head" ? `#${r.title}` : r.kind === "input" ? `<${r.placeholder}>` : r.text);
  const rows = paneRows(VIEW(), STATE({ page: "account", account }));
  assert.deepEqual(shown(rows), ["#账号与登录", "登录方式", "邮箱：j***@example.com", "[加一种登录方式]", "登录的设备", "Mac · Claude Code/演「John」「Lily 爸爸」 · 现在(这台)", "网页 · Safari/10-31 21:14[退出]", "[退出其他所有设备]", "[退出这台设备的登录!]"]);
  assert.deepEqual([rows[0].back, rows[0].backLabel, rows[0].sub], [{ op: "page", page: "avatars" }, undefined, undefined], "back to 我, not 设置 (P10a)");
  assert.deepEqual(rows.find((r) => r.key === "device-token-b").press.action, { op: "device-revoke", id: "token-b" });
  assert.deepEqual(shown(paneRows(VIEW(), STATE({ page: "account", account, addOpen: true }))).slice(3, 4), ["{<邮箱或手机号>[发验证码]}"], "加一种登录方式 opens its field (P10b)");
  const add = paneRows(VIEW(), STATE({ page: "account", account, addOpen: true, addLinks: [{ kind: "github", url: "https://gemsbang.com/login/sso/github?h=2" }] })).find((r) => r.key === "add");
  assert.deepEqual([add.top.kind, add.top.items.map((i) => i.label), add.fields.map((f) => f.kind)], ["links", ["用 GitHub 继续"], ["or", "input"]], "the other accounts first, as on the sign-in page (S32, sketch ⑤)");
  const two = { ...account, methods: [...account.methods, { id: "email-2", kind: "email", shown: "j***@work.example", at: "t" }] };
  const adding = paneRows(VIEW(), STATE({ page: "account", account: two, adding: "j@work.example" }));
  assert.deepEqual(shown(adding).slice(1, 7), ["登录方式", "邮箱：j***@example.com[解绑]", "邮箱：j***@work.example[解绑]", "验证码已发到 j@work.example，发件人是 im.example。10 分钟内有效", "<6 位数字，回车登录>", "[换个邮箱]"]);
  assert.deepEqual(adding.find((r) => r.key === "method-email-2").press.action, { op: "method-remove", id: "email-2" });
  const out = paneRows(VIEW(), STATE({ page: "account", account, loggingOut: true }));
  assert.deepEqual(shown(out), ["#账号与登录", "退出以后，这台电脑上的会话都不再演你的身份，本机存的聊天清掉。别的设备不受影响。", "[退出!][算了]"]);
  assert.deepEqual(out.at(-1).items.map((b) => b.action), [{ op: "logout" }, { op: "logout-ask", open: false }]);
  assert.deepEqual(shown(paneRows(VIEW(), STATE({ page: "account", account: null }))), ["#账号与登录", "正在读账号…"]);
});

test("the total inbox (spec §7.1, S11, direction ①): WeChat's — the name with the unread and ＋ at the right (＋'s two ways, 建群 and 用链接进群, under it once pressed, P1b); the chats alone, each with its avatar's initial — no filters, no 对话 heading; 聊天 · 联系人 · 我 at the foot, 聊天 on with the unread; nothing yet, those two ways in the middle (P1c); a relay out of reach and an invitation not followed said first", () => {
  assert.deepEqual(words(paneRows(VIEW(), STATE())), ["#GemsBang(2 条未读) [＋]", "[J]设置页改版", "[L]三年二班家长", "▁*聊天2|联系人|我"]);
  const plus = paneRows(VIEW(), STATE({ plusOpen: true }));
  assert.deepEqual(words(plus).slice(0, 2), ["#GemsBang(2 条未读) [＋]", "建群›|用链接进群›"]);
  assert.deepEqual(plus[0].actions[0].action, { op: "plus" }, "＋ again folds it");
  assert.deepEqual(plus[1].items.map((i) => i.action), [{ op: "page", page: "new-group" }, { op: "page", page: "join" }]);
  assert.deepEqual(words(paneRows(VIEW({ avatars: [], rows: [], unread: 0, offline: "连不上中继：refused", notes: [{ url: "https://evil.example/i/abcd9ahe.md", at: "t" }] }), STATE())), [
    "#GemsBang [＋]", "断了：连不上中继：refused · 显示的是上次同步的", "有一份进群说明，没照做：不是你亲手贴的（https://evil.example/i/abcd9ahe.md）", "(还没有聊天)[建群][用链接进群]", "▁*聊天|联系人|我",
  ]);
  const tabs = paneRows(VIEW(), STATE()).at(-1);
  assert.deepEqual(tabs.items.map((t) => [t.icon, t.on, t.action]), [["chats", true, { op: "page", page: "inbox" }], ["contacts", false, { op: "page", page: "contacts" }], ["me", false, { op: "page", page: "avatars" }]], "聊天 · 联系人 · 我, the last row: 我 moved there from the head, 联系人 between (S34)");
});

test("a chat (spec §7.2, S13, direction ①): its name, its size and who you are there; a group's head opens 群信息 (P5, Q17), a two-person chat's its 聊天信息 (S36); the earlier lines counted; who came in, and when; the lines as bubbles — the person's own at the right — with a stamp where the talk picks up, `身份` where an agent said it, a mention of the person's avatar set off; a call's bar above the box 「以 <身份> 说…」", () => {
  const chat = { owner: JOHN.id, id: "g-000000000a", kind: "group", name: "设置页改版", count: 4, as: JOHN, earlier: 21, isOwner: true, items: [
    { kind: "joined", id: "member-2", avatar: "a-00000000b1", who: "李四", at: "2026-11-01T06:01:00Z" },
    { kind: "message", id: "m-1", avatar: "a-00000000b1", who: "李四", text: "v4 稿子在这", at: "2026-11-01T06:02:00Z", mark: true, mine: false },
    { kind: "message", id: "m-2", avatar: JOHN.id, who: "John", text: "收到", at: "2026-11-01T06:03:00Z", mark: false, mine: true },
  ] };
  const rows = paneRows(VIEW(), STATE({ page: "chat", chat }));
  assert.deepEqual(words(rows), ["#设置页改版(4 人 · 你在这里是 John)", "还有 21 条更早的", "李四 进群了", "14:02", "李四(身份) 14:02: v4 稿子在这", "John 14:03: 收到", "<以 John 说…>"]);
  assert.deepEqual([rows[0].actions, rows[0].open, rows[0].back, rows[0].backLabel], [[], { op: "page", page: "info" }, { op: "page", page: "inbox" }, undefined], "叫人 and 静音 moved to 群信息; the head opens it, ‹ only as the sketch draws it");
  assert.deepEqual([rows[4].side, rows[4].name, rows[5].side, rows[5].name, rows[5].badge.id], ["left", "李四", "right", undefined, JOHN.id], "bubbles: another's at the left under their name, the person's own at the right with their avatar's badge (S13)");
  assert.deepEqual([rows[1].kind, rows[2].kind, rows[2].time, rows[3].kind], ["event", "event", "14:01", "event"], "centred lines; who came in, with when; a stamp before the talk");
  assert.deepEqual(rows.at(-1).compose, { as: JOHN, placeholder: "以 John 说…", submitLabel: "发送" }, "「以 John 说…」 in the box, 发送 beside it");
  const later = { ...chat, items: [...chat.items, { kind: "message", id: "m-9", avatar: "a-00000000b1", who: "李四", text: "好", at: "2026-11-01T06:20:00Z", mark: false, mine: false }] };
  assert.deepEqual(words(paneRows(VIEW(), STATE({ page: "chat", chat: later }))).slice(5, 8), ["John 14:03: 收到", "14:20", "李四 14:20: 好"], "a stamp again after a quiet five minutes, as WeChat's");
  assert.equal(paneRows(VIEW(), STATE({ page: "chat", chat: { ...chat, kind: "dm" } }))[4].name, undefined, "a two-person chat names nobody over a bubble");
  const called = { ...chat, items: [...chat.items.slice(0, 2), { kind: "message", id: "m-3", avatar: "a-00000000b1", who: "李四", text: "那 @John 周五前能看吗", at: "2026-11-01T06:04:00Z", mark: true, mine: false }, chat.items[2]] };
  const call = { avatar: JOHN.id, owner: JOHN.id, id: "g-000000000a", kind: "group", group: "设置页改版", lines: [{ id: "m-3", who: "李四", text: "那 @John 周五前能看吗", reason: "mention", at: "2026-11-01T06:04:00Z" }], last: "m-3", at: "2026-11-01T06:04:00Z", auto: false, badge: JOHN, muted: false };
  const withCall = paneRows(VIEW({ calls: [call] }), STATE({ page: "chat", chat: called }));
  assert.deepEqual(withCall.map((r) => r.key).slice(-2), [`call-${JOHN.id}-${JOHN.id}-g-000000000a`, "say"], "the bar above the box, not among the lines (S14)");
  assert.deepEqual(withCall.find((r) => r.key === "msg-m-3").body, [{ text: "那 " }, { text: "@John", mark: true }, { text: " 周五前能看吗" }]);
  const card = withCall.find((r) => r.kind === "need");
  assert.deepEqual([card.line, card.body, card.options.map((o) => o.label)], [true, [[{ text: "李四 @ 了你" }]], ["交给 agent 回"]], "one step on the bar; answering yourself is the box below, not answering is leaving it");
  const dmHead = paneRows(VIEW(), STATE({ page: "chat", chat: { ...chat, kind: "dm", items: [] } }))[0];
  assert.deepEqual([dmHead.actions, dmHead.sub, dmHead.open], [[], undefined, { op: "page", page: "info" }], "a two-person chat's head is its name, and opens its 聊天信息, where 静音 and 自动回 are (S36, Q23 (a))");
  assert.deepEqual(words(paneRows(VIEW(), STATE({ page: "chat", chat: null }))).slice(0, 1), ["#GemsBang(2 条未读) [＋]"], "no chat open: the inbox");
  assert.equal(rows.some((r) => r.kind === "tabs"), false, "in a chat the row at the foot folds away, as WeChat's");
});

test("群信息 (P6 ②, Q17): 叫人 ›, 静音, 自动回 and, for the owner, 进群要我同意 as switches, above the members — the owner first, 你 and 群主 marked; a member has no 进群要我同意; every member listed — a row each for the first two hundred, the rest named in one line — so anyone can be found; another's row opens their name card (S18)", () => {
  const members = [{ id: "a-00000000b1", name: "李四" }, { id: JOHN.id, name: "John" }, { id: "a-00000000b2", name: "张三" }, { id: "a-00000000b3", name: "王五" }];
  const chat = { owner: JOHN.id, id: "g-000000000a", kind: "group", name: "设置页改版", count: 4, as: JOHN, members, earlier: 0, isOwner: true, rules: { forward: true, approve: true }, items: [] };
  const rows = paneRows(VIEW(), STATE({ page: "info", chat }));
  const people = rows.find((r) => r.kind === "people"), menu = rows.find((r) => r.kind === "menu");
  assert.deepEqual([rows[0].title, rows[0].back, rows.map((r) => r.kind)], ["设置页改版 · 群信息", { op: "page", page: "chat" }, ["head", "menu", "section", "people", "menu"]], "what is pressed often above, the list below it, 退出群 at the foot (②, 2026-11-03)");
  assert.equal(rows[2].text, "成员 4");
  assert.deepEqual(people.items.map((m) => [m.name, m.note, m.color]), [["John", "你 · 群主", JOHN.color], ["李四", undefined, undefined], ["张三", undefined, undefined], ["王五", undefined, undefined]]);
  assert.deepEqual(people.items.map((m) => m.action), [undefined, { op: "contact", id: "a-00000000b1", as: JOHN.id, back: "info" }, { op: "contact", id: "a-00000000b2", as: JOHN.id, back: "info" }, { op: "contact", id: "a-00000000b3", as: JOHN.id, back: "info" }], "another's row opens their name card; the person's own has none (S18)");
  assert.deepEqual(menu.items.map((i) => [i.label, i.go === true, i.on]), [["叫人", true, undefined], ["静音", false, false], ["自动回", false, false], ["进群要我同意", false, true]]);
  assert.deepEqual(menu.items.map((i) => i.action), [{ op: "page", page: "invite" }, { op: "mute", venue: `${JOHN.id}/g-000000000a`, on: true }, { op: "auto", avatar: JOHN.id, venue: `${JOHN.id}/g-000000000a`, on: true }, { op: "link-rules", approve: false }]);
  const member = { ...chat, owner: "a-00000000b1", as: LILY, members: [{ id: "a-00000000b1", name: "李四" }, { id: LILY.id, name: "Lily 爸爸" }], isOwner: false };
  const seen = paneRows(VIEW({ muted: { avatars: [], venues: [`a-00000000b1/g-000000000a`] } }), STATE({ page: "info", chat: member }));
  assert.deepEqual(seen.find((r) => r.kind === "people").items.map((m) => [m.name, m.note]), [["李四", "群主"], ["Lily 爸爸", "你"]]);
  assert.deepEqual(seen.find((r) => r.kind === "menu").items.map((i) => [i.label, i.on]), [["叫人", undefined], ["静音", true], ["自动回", false]], "成员也能叫人 (Q6); muted, the switch on");
  const crowd = (n) => ({ ...chat, members: Array.from({ length: n }, (_, i) => ({ id: `a-${String(i).padStart(10, "0")}`, name: `人${i}` })) });
  const many = paneRows(VIEW(), STATE({ page: "info", chat: crowd(34) })).find((r) => r.kind === "people");
  assert.deepEqual([many.items.length, many.rest], [34, undefined], "a big group: everyone a row");
  const huge = paneRows(VIEW(), STATE({ page: "info", chat: crowd(203) })).find((r) => r.kind === "people");
  assert.deepEqual([huge.items.length, huge.rest], [200, "人200、人201、人202"], "past what the desktop draws as rows: the rest named, never only counted");
});

test("叫人 (spec §6.1, P4): the link for people with its QR code, the line for an agent, each with the words to select and a copy for the terminal; how to pass them on; how long the link works, the owner's 换一个链接 asked first (P4c); a member sees the days only", () => {
  const chat = { owner: JOHN.id, id: "g-000000000a", kind: "group", name: "周末爬山", count: 4, as: JOHN, earlier: 0, isOwner: true, items: [] };
  const link = { code: "k7pqm3", url: "https://gemsbang.com/i/k7pqm3", line: "读 https://gemsbang.com/i/k7pqm3.md ，照着做：用我的身份进「周末爬山」。", days: 7, forward: true, approve: false, isOwner: true, group: "周末爬山" };
  const rows = paneRows(VIEW(), STATE({ page: "invite", chat, link }));
  const shown = (r) => r.kind === "share" ? `${r.label}{${r.text}}${r.qr ? "▦" : ""}[${r.copy}]` : r.kind === "tip" ? `(${r.text})` : r.kind === "line" ? `${r.text}${r.press !== undefined ? `·[${r.press.label}]` : ""}` : r.kind === "head" ? `#${r.title}` : r.kind;
  assert.deepEqual(rows.map(shown), ["#叫人进 周末爬山", `给人的链接{${link.url}}▦[复制链接]`, `给 agent 的一句{${link.line}}[复制这句]`, "(选中后按 ⌘C；手机微信扫一扫，在手机上转。)", "链接 7 天有效·[换一个链接]"]);
  assert.deepEqual([rows[0].back, rows.at(-1).press.action], [{ op: "page", page: "chat" }, { op: "rotate-ask", open: true }]);
  assert.equal(paneRows(VIEW(), STATE({ page: "invite", chat, link, inviteBack: "info", copyKey: "Ctrl+C" }))[0].back.page, "info", "back where it was opened from");
  assert.equal(paneRows(VIEW(), STATE({ page: "invite", chat, link, copyKey: "Ctrl+C" })).find((r) => r.kind === "tip").text, "选中后按 Ctrl+C；手机微信扫一扫，在手机上转。", "Windows copies with Ctrl+C");
  const asked = paneRows(VIEW(), STATE({ page: "invite", chat, link, rotating: true }));
  assert.deepEqual(words(asked), ["#叫人进 周末爬山", "换了以后，旧链接立刻失效，拿旧链接的人要找你要新的。", "[换][算了]"]);
  assert.deepEqual(asked.at(-1).items.map((i) => i.action), [{ op: "rotate" }, { op: "rotate-ask", open: false }]);
  assert.deepEqual(paneRows(VIEW(), STATE({ page: "invite", chat, link: { ...link, isOwner: false, days: 3 } })).map(shown).slice(-1), ["链接 3 天有效"]);
  assert.deepEqual(words(paneRows(VIEW(), STATE({ page: "invite", chat, link: { ...link, isOwner: false }, rotating: true }))).length, 5, "only the owner swaps the link");
  assert.deepEqual(words(paneRows(VIEW(), STATE({ page: "invite", chat, link: null }))).slice(-1), ["…"]);
});

test("我 (spec §7.5, S22, P8): a card per avatar — where it is, who plays it, the chats that answer on their own, where a task works once named, whether agent lines are marked, 静音 beside its name — and 改 opening one card in place, the others folded (P8b); under the cards 默认名, 界面语言 with 换, 账号 ›, 关于 with the version; no 设置 page; 建群", () => {
  const card = (r) => `${r.title ?? "-"}${r.tag !== undefined ? `(${r.tag})` : ""}${r.edit !== undefined ? ` [${r.edit.label}]` : ""}${r.lines.map((x) => ` ; ${x.label}：${x.value}${(x.presses ?? []).map((p) => `[${p.label}]`).join("")}`).join("")}`;
  const own = (r) => r.kind === "kv" ? `${r.label}：${r.value}${r.note !== undefined ? `·${r.note}` : ""}${r.press !== undefined ? `[${r.press.label}]` : ""}${r.go !== undefined ? "›" : ""}` : r.kind === "input" ? `<${r.placeholder}|${r.value ?? ""}|${r.submitLabel}>` : r.kind === "list" ? r.items.map((i) => `${i.label}${i.on ? "✓" : ""}`).join("|") : r.kind;
  const rows = paneRows(VIEW({ defaultName: "老张", bodies: { "s-1": LILY.id }, avatars: [JOHN, { ...LILY, muted: true }] }), STATE({ page: "avatars", version: "0.5.24" }));
  assert.deepEqual([rows[0].title, rows[0].sub, rows[0].back, rows[0].backLabel, rows[0].actions], ["我", undefined, undefined, undefined, []], "the page is 我, reached from the row at the foot: no ‹ (S22)");
  assert.deepEqual(words([rows.at(-1)]), ["▁聊天2|联系人|*我"], "聊天 · 联系人 · 我 at its foot too, 我 on");
  assert.deepEqual(rows.filter((r) => r.kind === "card").map(card), [
    "John [改] ; 在哪：设置页改版 ; 谁来演：还没有会话 ; 自动回：没有 ; agent 说的话：对外标出来",
    "Lily 爸爸(静音) [改] ; 在哪：三年二班家长 ; 谁来演：这个会话 ; 自动回：没有 ; agent 说的话：对外不标",
  ]);
  assert.deepEqual(rows.filter((r) => r.kind === "kv").map(own), ["默认名：老张·起名时作建议，不预选[改]", "界面语言：中文[换]", "账号：登录方式和登录的设备›", "关于：GemsBang 0.5.24"]);
  assert.deepEqual(rows.filter((r) => r.kind === "section" || r.key === "base-none").map((r) => `${r.text}${r.press !== undefined ? `[${r.press.label}]` : ""}`), ["底子[改]", "没有"], "底子 under the cards, nothing in it yet");
  assert.equal(rows[1].lines[1].presses, undefined, "no 让这个会话替它: an avatar no session plays asks the person instead (B1)");
  assert.deepEqual(paneRows(VIEW({ bodies: { "s-9": JOHN.id }, played: [JOHN.id] }), STATE({ page: "avatars" })).slice(1, 3).map((r) => r.lines[1].value), ["别的会话", "还没有会话"], "another open session plays John; none plays Lily 爸爸");
  assert.equal(paneRows(VIEW({ recent: LILY.id }), STATE({ page: "avatars" }))[2].lines[1].value, "这个会话", "a new session plays the avatar last spoken as (S21)");
  const editing = paneRows(VIEW(), STATE({ page: "avatars", editing: `avatar-${JOHN.id}` }));
  const open = editing[1];
  assert.deepEqual([open.top.field, open.top.value, open.top.submitLabel, open.title, open.edit], ["rename", "John", "好了", undefined, undefined], "its name in the field with 好了 (P8b)");
  assert.deepEqual(open.fields.map((f) => f.kind === "menu" ? f.items.map((i) => `${i.on ? "☑" : "☐"}${i.label}`).join(" ") : f.kind === "tip" ? `(${f.text})` : f.kind), ["☑agent 说的话对外标出来 ☐静音这个身份", "(改了名字，群里的人看到的是新名字。)"]);
  assert.deepEqual(card(editing[2]), "Lily 爸爸 [改]", "the other card folded to its name");
  assert.deepEqual(open.fields[0].items.map((i) => i.action), [{ op: "mark", avatar: JOHN.id, mark: false }, { op: "mute", avatar: JOHN.id, on: true }]);
  const naming = paneRows(VIEW({ defaultName: "老张" }), STATE({ page: "avatars", editing: "default-name" }));
  const at = naming.findIndex((r) => r.key === "default-name");
  assert.deepEqual(naming.slice(at, at + 2).map(own), ["默认名：老张·起名时作建议，不预选[改]", "<只在起名时作建议，不预选；回车保存|老张|好了>"]);
  const langs = paneRows(VIEW(), STATE({ page: "avatars", langOpen: true }));
  assert.deepEqual(own(langs.find((r) => r.key === "langs")), "中文✓|English|日本語", "换 lists the languages, the one on ticked");
  assert.deepEqual(langs.find((r) => r.key === "langs").items[2].action, { op: "lang", lang: "ja" });
  const ja = paneRows(VIEW({ lang: "ja" }), STATE({ page: "avatars" }));
  assert.deepEqual(ja.filter((r) => r.kind === "kv").map((r) => r.label), ["既定の名前", "表示言語", "アカウント", "情報"]);
  assert.equal(paneRows(VIEW(), STATE({ page: "settings" }))[0].key, "head-inbox", "no 设置 page: 我 is the settings");
  const groupOf = (extra) => words(paneRows(VIEW(extra.view ?? {}), STATE({ page: "new-group", groupAs: "", ...extra.state })));
  assert.deepEqual(groupOf({ view: { avatars: [JOHN] } }), ["#建群", "<群名>"], "one avatar: only the name (P2a)");
  assert.deepEqual(groupOf({ view: { recent: LILY.id } }), ["#建群", "<群名>", "以{Lily 爸爸}建[换]"], "several: the one last spoken as, and 换 (P2b, Q1)");
  assert.deepEqual(groupOf({}), ["#建群", "<群名>", "以{John}建[换]"], "nothing said yet: the first");
  assert.equal(paneRows(VIEW(), STATE({ page: "new-group", groupAs: "" })).find((r) => r.key === "group").submitLabel, "建");
  assert.deepEqual([paneRows(VIEW(), STATE({ page: "new-group", groupAs: "" }))[0].backLabel, paneRows(VIEW({ lang: "en" }), STATE({ page: "join" }))[0].backLabel], ["聊天", "Chats"], "back to 聊天, as the tab says: never 收件箱 (S11, 2026-11-04)");
  assert.deepEqual(groupOf({ state: { asOpen: true, groupAs: LILY.id } }), ["#建群", "<群名>", "John|Lily 爸爸✓|新的身份…"], "换: theirs, a new one last (P2c, Q2)");
  assert.deepEqual(groupOf({ view: { defaultName: "老张" }, state: { groupAs: "new" } }), ["#建群", "<群名>", "[老张]", "<自己写一个>"], "a new one: the default name a suggestion, not picked (Q9)");
  assert.equal(groupOf({ state: { groupAs: "new" } }).some((w) => w.includes("贴进群链接")), false, "no link to paste here any more");
  assert.deepEqual(fieldAction("group", "周末爬山", { chat: null, address: null, groupAs: LILY.id }), { call: "group", args: { name: "周末爬山", as: LILY.id } });
  assert.deepEqual(fieldAction("group", "周末爬山", { chat: null, address: null, groupAs: "new", groupAvatar: "老张" }), { call: "group", args: { name: "周末爬山", avatarName: "老张" } });
  const alone = paneRows(VIEW(), STATE({ page: "chat", chat: { owner: JOHN.id, id: "g-000000000z", kind: "group", name: "周末爬山", count: 1, as: JOHN, earlier: 0, isOwner: true, items: [] } }));
  assert.deepEqual(words(alone).slice(1, 2), ["(群里还只有你)[叫人]"], "made a moment ago: straight in, 叫人 first (P2d)");
});

test("the band and the fields: signed in with nothing waiting, the name and the chats with something new (S12); what stops gemsbang; nobody logged in; Enter in each field does its one thing, an empty one nothing", () => {
  assert.deepEqual(gbBand(VIEW(), null), { text: "GemsBang · 2 个聊天有新消息", tone: "dim", open: "打开", actions: [], more: 0 });
  assert.deepEqual(gbBand(VIEW({ loggedIn: false }), null), { text: "GemsBang 还没登录", tone: "dim", open: "打开", actions: [], more: 0 });
  assert.deepEqual(gbBand(null, "GemsBang：找不到 node"), { text: "GemsBang：找不到 node", tone: "error", open: "打开", actions: [], more: 0 });
  const s = { chat: { owner: JOHN.id, id: "g-000000000a" }, address: "john@example.com", adding: "j@work.example", groupAs: "new", groupAvatar: "John", session: "s-1" };
  assert.deepEqual(fieldAction("email", " john@example.com ", s), { local: "email", email: "john@example.com" });
  assert.deepEqual(fieldAction("code", "123456", s), { call: "login-verify", args: { email: "john@example.com", code: "123456" } });
  assert.deepEqual(fieldAction("code", "123456", { ...s, address: "+63 917 123 4567" }), { call: "login-verify", args: { phone: "+63 917 123 4567", code: "123456" } }, "a number's code (S29)");
  assert.equal(fieldAction("code", "123456", { ...s, address: null }), undefined);
  assert.deepEqual(fieldAction("first-name", "John", s), { call: "first-avatar", args: { name: "John", session: "s-1" } });
  assert.deepEqual(fieldAction("add-email", "j@work.example", s), { local: "add-email", email: "j@work.example" });
  assert.deepEqual(fieldAction("add-code", "654321", s), { call: "method-verify", args: { email: "j@work.example", code: "654321" } });
  assert.equal(fieldAction("add-code", "654321", { ...s, adding: null }), undefined);
  assert.deepEqual(fieldAction("say", "稿子 v4", s), { call: "say", args: { owner: JOHN.id, id: "g-000000000a", text: "稿子 v4" } });
  assert.deepEqual(fieldAction("group", "周会", s), { call: "group", args: { name: "周会", avatarName: "John" } });
  assert.deepEqual(fieldAction("group", "周会", { ...s, groupAs: JOHN.id }), { call: "group", args: { name: "周会", as: JOHN.id } });
  assert.deepEqual(fieldAction("join", "https://im.example/i/abcd9ahe", s), { local: "join", url: "https://im.example/i/abcd9ahe" });
  assert.deepEqual(fieldAction("rename", "乐乐爸爸", s, LILY.id), { call: "rename", args: { avatar: LILY.id, name: "乐乐爸爸" } });
  assert.deepEqual(fieldAction("default-name", "  ", s), { call: "default-name", args: { name: "" } });
  assert.equal(fieldAction("say", "   ", s), undefined);
});

test("用链接进群 (S9, P3): the link pasted with 进; read, the group and who owns it; the avatar the inviter knows, with 好, 换个身份, 不要; no shared place, theirs to pick and a new one; a new one named from the suggestions, the default name first and none picked, a blank one filled with what is typed", () => {
  const paste = paneRows(VIEW(), STATE({ page: "join" }));
  assert.deepEqual(words(paste), ["#用链接进群", "<贴进群链接 https://…/i/…>"]);
  assert.equal(paste[1].submitLabel, "进");
  const J = { url: "https://im.example/i/k7pqm3", group: "前端周会", count: 6, owner: "王五", pick: { kind: "known", avatar: JOHN.id }, suggestions: [{ text: "John" }] };
  const known = paneRows(VIEW(), STATE({ page: "join", joining: J }));
  assert.deepEqual(words(known), ["#用链接进群", "「前端周会」· 6 人 · 群主 王五", "用{John}进「前端周会」？", "[好][换个身份][不要]"]);
  assert.deepEqual(known.at(-1).items.map((i) => i.action), [{ op: "join-as", as: JOHN.id }, { op: "join-switch" }, { op: "join-cancel" }]);
  assert.deepEqual(words(paneRows(VIEW(), STATE({ page: "join", joining: { ...J, switching: true } }))).slice(2), ["用哪个身份进「前端周会」", "John›|Lily 爸爸›|新的身份…›", "[不要]"]);
  const naming = paneRows(VIEW({ defaultName: "John" }), STATE({ page: "join", joining: { ...J, group: "三年二班家长", naming: true, suggestions: [{ text: "John" }, { text: "__ 爸爸", blank: true }, { text: "__ 妈妈", blank: true }] } }));
  assert.deepEqual(words(naming), ["#进「三年二班家长」，起个名", "[John][__ 爸爸][__ 妈妈]", "<自己写一个>"]);
  assert.equal(naming[1].items.some((i) => i.primary === true), false, "none picked (Q9)");
  assert.equal(naming.at(-1).submitLabel, "进群");
  assert.equal(paneRows(VIEW(), STATE({ page: "join", joining: { ...J, naming: true, blank: "__ 爸爸" } })).at(-1).placeholder, "孩子的名字", "a blank one picked: the box asks for the child's name");
  assert.deepEqual(fieldAction("join-name", "乐乐", { chat: null, address: null, groupAs: "", blank: "__ 爸爸" }), { local: "join-name", name: "乐乐 爸爸" });
  assert.deepEqual(fieldAction("join-name", "老张", { chat: null, address: null, groupAs: "" }), { local: "join-name", name: "老张" });
  assert.deepEqual(fieldAction("join", " https://im.example/i/k7pqm3 ", { chat: null, address: null, groupAs: "" }), { local: "join", url: "https://im.example/i/k7pqm3" });
});

test("底子 in 我 (S27, P8a, P8c, P9b′): each entry with whom it is given to, 改 at the right; 改 makes the page 底子 alone — each entry's words in a field, 给： its avatars as pills (the last one stays), 删, and 加一条 given to the avatar this session plays; an agent's entry waits with 记下 · 不记, and 我 at the foot carries how many wait", () => {
  const base = [
    { id: "base-1", label: "家人", text: "Lily，8 岁，三年二班", for: [LILY.id], state: "kept", by: "person", at: "t" },
    { id: "base-2", label: "时区", text: "上海", for: [JOHN.id, LILY.id], state: "kept", by: "person", at: "t" },
    { id: "base-3", label: "家人", text: "Lily 对花生过敏", for: [LILY.id], state: "pending", by: LILY.id, who: "王老师", at: "t" },
  ];
  const rows = paneRows(VIEW({ base }), STATE({ page: "avatars" }));
  const from = rows.findIndex((r) => r.key === "base");
  const shown = (r) => r.kind === "kv" ? `${r.label}：${r.value}·${r.note}` : r.kind === "card" ? `{${r.badge?.name ?? ""}|${r.top.text}|${r.fields.map((f) => f.kind === "buttons" ? f.items.map((b) => `[${b.label}]`).join("") : f.text).join("|")}}` : r.kind === "section" ? `#${r.text}[${r.press.label}]` : r.kind;
  assert.deepEqual(rows.slice(from, from + 4).map(shown), ["#底子[改]", "家人：Lily，8 岁，三年二班·给 Lily 爸爸", "时区：上海·给全部", "{Lily 爸爸|Lily 爸爸想记（王老师说的）|家人 · Lily 对花生过敏 · 给 Lily 爸爸|[记下][不记]}"]);
  const wait = rows.find((r) => r.key === "base-wait-base-3");
  assert.deepEqual(wait.fields[1].items.map((b) => b.action), [{ op: "base-keep", item: "base-3", keep: true }, { op: "base-keep", item: "base-3", keep: false }]);
  assert.deepEqual(rows[from].press.action, { op: "edit", card: "base" });
  const tabs = paneRows(VIEW({ base }), STATE()).at(-1);
  assert.deepEqual(tabs.items.map((t) => [t.label, t.count]), [["聊天", 2], ["联系人", undefined], ["我", 1]], "the waiting one counted on 我, at the foot");
  assert.equal(paneRows(VIEW({ base: base.slice(0, 2) }), STATE()).at(-1).items[1].count, undefined);
  // 改 (P8c): the page is 底子 alone.
  const open = paneRows(VIEW({ base }), STATE({ page: "avatars", editing: "base" }));
  assert.deepEqual(open.map((r) => r.kind), ["head", "section", "card", "card", "input", "card"]);
  assert.equal(open[1].press.label, "好了");
  const kid = open[2];
  assert.deepEqual([kid.top.field, kid.top.target, kid.top.value, kid.top.label], ["base-text", "base-1", "Lily，8 岁，三年二班", "家人"]);
  assert.deepEqual(kid.fields[0].items.map((p) => [p.badge.name, p.on, p.action]), [["John", false, { op: "base-for", item: "base-1", for: [LILY.id, JOHN.id] }], ["Lily 爸爸", true, undefined]], "the last avatar it is given to stays");
  assert.deepEqual(open[3].fields[0].items.map((p) => p.action), [{ op: "base-for", item: "base-2", for: [LILY.id] }, { op: "base-for", item: "base-2", for: [JOHN.id] }]);
  assert.deepEqual(kid.fields[0].press.action, { op: "base-drop", item: "base-1" });
  assert.deepEqual([open[4].placeholder, open[4].submitLabel], ["加一条：称呼、家人、时区、偏好…", "加"]);
  const s = { chat: null, address: null, groupAs: "new", baseFor: LILY.id };
  assert.deepEqual(fieldAction("base-add", "家人：Lily 爱画画", s), { call: "base-add", args: { text: "家人：Lily 爱画画", for: [LILY.id] } });
  assert.deepEqual(fieldAction("base-text", " Lily，9 岁 ", s, "base-1"), { call: "base-set", args: { item: "base-1", text: "Lily，9 岁" } });
});

test("退出群 (S19, P7): 群信息's foot; a member asked in its place (P7a), the last one told the group goes with them; the 群主 with others in picks who keeps it first (P7b) — 退出 grey until then, then 交给某某，退出; the chat says who left, and who took it over (P7c)", () => {
  const members = [{ id: JOHN.id, name: "John" }, { id: "a-00000000b1", name: "李四" }, { id: "a-00000000b2", name: "张三" }];
  const chat = { owner: JOHN.id, id: "g-000000000a", kind: "group", name: "设置页改版", count: 3, as: JOHN, members, keeper: JOHN.id, earlier: 0, isOwner: true, items: [] };
  const leave = paneRows(VIEW(), STATE({ page: "info", chat })).at(-1);
  assert.deepEqual(leave.items.map((i) => [i.label, i.danger, i.action]), [["退出群", true, { op: "leave-ask", open: true }]]);
  const member = { ...chat, as: LILY, members: [...members.slice(0, 2), { id: LILY.id, name: "Lily 爸爸" }], isOwner: false };
  const asked = paneRows(VIEW(), STATE({ page: "info", chat: member, leaving: true }));
  assert.deepEqual(words(asked.slice(-2)), ["退出「设置页改版」？这个群从你的列表里消失，这里的自动回一起去掉。", "[退出][算了]"]);
  assert.deepEqual(asked.at(-1).items.map((b) => [b.danger, b.action]), [[true, { op: "leave" }], [undefined, { op: "leave-ask", open: false }]]);
  const alone = { ...chat, members: [members[0]], count: 1 };
  assert.deepEqual(words(paneRows(VIEW(), STATE({ page: "info", chat: alone, leaving: true })).slice(-2)), ["退出「设置页改版」？你是群里最后一个人，退出后这个群就没了，群和它的聊天一起删掉。", "[退出][算了]"]);
  const pick = paneRows(VIEW(), STATE({ page: "info", chat, leaving: true }));
  assert.deepEqual(words(pick), ["#退出 设置页改版", "你是群主，先选一个人接手。", "李四|张三", "[退出][算了]"], "no ✓ yet");
  assert.deepEqual([pick.at(-1).items[0].disabled, pick[2].items[0].action], [true, { op: "heir", avatar: "a-00000000b1" }], "退出 grey until someone is picked");
  const picked = paneRows(VIEW(), STATE({ page: "info", chat, leaving: true, heir: "a-00000000b1" }));
  assert.deepEqual(words(picked).slice(2), ["李四✓|张三", "[交给李四，退出][算了]"]);
  assert.deepEqual([picked.at(-1).items[0].action, picked[0].back], [{ op: "leave", heir: "a-00000000b1" }, { op: "leave-ask", open: false }]);
  const said = paneRows(VIEW(), STATE({ page: "chat", chat: { ...chat, keeper: "a-00000000b1", isOwner: false, items: [
    { kind: "left", id: "leave-1", avatar: "a-00000000b2", who: "张三", at: "2026-11-01T09:20:00Z" },
    { kind: "left", id: "leave-2", avatar: JOHN.id, who: "John", at: "2026-11-01T09:21:00Z", heir: "李四" },
  ] } })).filter((r) => r.kind === "event");
  assert.deepEqual(said.map((r) => [r.text, r.time]), [["张三 退出了群", "17:20"], ["John 退出了群，群主换成了李四", "17:21"]]);
  assert.deepEqual(paneRows(VIEW(), STATE({ page: "info", chat: { ...chat, keeper: "a-00000000b1", isOwner: false } })).find((r) => r.kind === "people").items.map((m) => [m.name, m.note]), [["李四", "群主"], ["John", "你"], ["张三", undefined]], "the 群主 now first");
});

const KNOWN = (name, as, extra = {}) => ({ id: `a-${name.length}0000000b${name.charCodeAt(0) % 10}`, name, as, letter: "L", groups: [{ owner: JOHN.id, id: "g-000000000a", name: "设置页改版", count: 4 }], ...extra });
test("联系人 (S34, Q22 (a), sketch ②): 聊天 · 联系人 · 我 at the foot, 联系人 on and no count; the wordmark and ＋ on top; a letter over each run of names; each one's picture with the avatar that knows them, where they met — a group, 等 N 个群, 私聊过 — pressed, their name card; nobody yet, the two ways in", () => {
  const lisi = KNOWN("李四", JOHN, { groups: [{ owner: JOHN.id, id: "g-000000000a", name: "设置页改版", count: 4 }, { owner: JOHN.id, id: "g-000000000b", name: "前端周会", count: 6 }] });
  const zhang = KNOWN("张三", JOHN, { letter: "Z", dm: { owner: JOHN.id, id: "d-0000000001" } });
  const teacher = KNOWN("王老师", LILY, { letter: "W", groups: [], dm: { owner: LILY.id, id: "d-0000000002" } });
  const rows = paneRows(VIEW({ contacts: [lisi, teacher, zhang] }), STATE({ page: "contacts" }));
  assert.deepEqual(rows.map((r) => r.kind), ["head", "section", "contact", "section", "contact", "section", "contact", "text", "tabs"]);
  assert.deepEqual([rows[0].key, rows[0].actions.map((a) => a.label)], ["head-contacts", ["＋"]], "the wordmark's head, as the inbox's (sketch ②)");
  assert.deepEqual(rows.filter((r) => r.kind === "section").map((r) => r.text), ["L", "W", "Z"]);
  assert.deepEqual(rows.filter((r) => r.kind === "contact").map((r) => [r.name, r.as.initial, r.sub]), [["李四", "J", "设置页改版 等 2 个群"], ["王老师", "L", "私聊过"], ["张三", "J", "设置页改版 · 私聊过"]]);
  assert.deepEqual(rows[2].action, { op: "contact", id: lisi.id, as: JOHN.id, back: "contacts" });
  assert.deepEqual(rows.at(-1).items.map((t) => [t.label, t.on, t.count, t.action.page]), [["聊天", false, 2, "inbox"], ["联系人", true, undefined, "contacts"], ["我", false, undefined, "avatars"]]);
  assert.deepEqual(words(paneRows(VIEW({ contacts: [] }), STATE({ page: "contacts" }))), ["#联系人 [＋]", "(进了群，群里的人就在这里)[建群][用链接进群]", "▁聊天2|*联系人|我"]);
  assert.equal(paneRows(VIEW({ lang: "en", contacts: [lisi] }), STATE({ page: "contacts" })).find((r) => r.kind === "contact").sub, "设置页改版 and others, 2 groups");
});

test("a name card (S35, sketch ③) and a two-person chat's 聊天信息 (S36, Q23 (a), sketch ⑤): ‹ back to 联系人 or the group; the picture, the name, 你以 <身份> 认识; 共同的群, each to go to; 发消息 opens the chat the two have, or a new one; 聊天信息 carries 静音 and 自动回 and says what a two-person chat cannot do", () => {
  const zhang = KNOWN("张三", JOHN, { letter: "Z" });
  const card = paneRows(VIEW({ contacts: [zhang] }), STATE({ page: "contact", contact: { id: zhang.id, as: JOHN.id, back: "contacts" } }));
  assert.deepEqual(card.map((r) => r.kind), ["head", "profile", "section", "list", "buttons", "text"], "no row at the foot on a page under 联系人");
  assert.deepEqual([card[0].back, card[0].backLabel, card[1].name, card[1].as.name, card[1].lead, card[1].trail], [{ op: "page", page: "contacts" }, "联系人", "张三", "John", "你以", "认识"]);
  assert.deepEqual([card[2].text, card[3].items.map((i) => [i.label, i.note, i.group, i.action])], ["共同的群", [["设置页改版", "4 人", true, { op: "open", owner: JOHN.id, id: "g-000000000a" }]]]);
  assert.deepEqual(card[4].items.map((b) => [b.label, b.primary, b.action]), [["发消息", true, { op: "dm", as: JOHN.id, with: zhang.id }]], "the first time: a new chat");
  assert.equal(card[5].text, "私聊里你是 John，张三是这个身份；你们别的身份都不露。");
  const had = { ...zhang, dm: { owner: JOHN.id, id: "d-0000000001" } };
  assert.deepEqual(paneRows(VIEW({ contacts: [had] }), STATE({ page: "contact", contact: { id: zhang.id, as: JOHN.id, back: "contacts" } })).find((r) => r.kind === "buttons").items[0].action, { op: "dm", as: JOHN.id, with: zhang.id, owner: JOHN.id, id: "d-0000000001" }, "after: the same chat");
  const group = { owner: JOHN.id, id: "g-000000000a", kind: "group", name: "设置页改版", count: 4, as: JOHN, earlier: 0, isOwner: true, items: [] };
  assert.deepEqual(paneRows(VIEW({ contacts: [zhang] }), STATE({ page: "contact", chat: group, contact: { id: zhang.id, as: JOHN.id, back: "info" } }))[0].backLabel, "设置页改版", "from 群信息: back to the group");
  assert.equal(paneRows(VIEW({ contacts: [] }), STATE({ page: "contact", contact: { id: zhang.id, as: JOHN.id, back: "contacts" } }))[0].key, "head-contacts", "someone no longer known: 联系人");
  const dm = { owner: JOHN.id, id: "d-0000000001", kind: "dm", name: "张三", count: 2, as: JOHN, members: [{ id: JOHN.id, name: "John" }, { id: zhang.id, name: "张三" }], earlier: 0, isOwner: true, items: [] };
  const info = paneRows(VIEW({ contacts: [had], muted: { avatars: [], venues: [`${JOHN.id}/d-0000000001`] } }), STATE({ page: "info", chat: dm }));
  assert.deepEqual(info.map((r) => r.kind), ["head", "profile", "menu", "section", "list", "text"]);
  assert.deepEqual([info[0].title, info[0].backLabel, info[0].back], ["聊天信息", "张三", { op: "page", page: "chat" }]);
  assert.deepEqual(info[2].items.map((i) => [i.label, i.on, i.hint]), [["静音", true, undefined], ["自动回", false, "张三发来的，交给 agent 回，不再问你；五种事照样问你"]]);
  assert.deepEqual(info[2].items.map((i) => i.action), [{ op: "mute", venue: `${JOHN.id}/d-0000000001`, on: false }, { op: "auto", avatar: JOHN.id, venue: `${JOHN.id}/d-0000000001`, on: true }]);
  assert.equal(info.at(-1).text, "两个人的私聊没有链接，不能加人，也退不了。");
});
