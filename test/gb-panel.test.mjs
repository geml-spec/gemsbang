import { test } from "node:test";
import assert from "node:assert/strict";
import { fieldAction, gbBand, paneRows } from "../dist/hosts/claude-code/gb-panel.js";

const JOHN = { id: "a-0000000001", name: "John", color: "#2f6fb3", initial: "J", venues: ["设置页改版"], mark: true, muted: false };
const LILY = { id: "a-0000000002", name: "Lily 爸爸", color: "#b5543c", initial: "L", venues: ["三年二班家长"], mark: false, muted: false };
const ROW = (name, as, extra = {}) => ({ owner: as.id, id: `g-${name.length}000000000`.slice(0, 12), kind: "group", name, as, last: { who: "李四", text: "hi" }, at: "2026-11-01T06:00:00Z", time: "14:00", unread: 1, ...extra });
const VIEW = (extra = {}) => ({ relay: "https://im.example", loggedIn: true, lang: "zh", person: "p-0000000001", avatars: [JOHN, LILY], rows: [ROW("设置页改版", JOHN), ROW("三年二班家长", LILY)], unread: 2, needs: [], muted: { avatars: [], venues: [] }, notes: [], bodies: {}, ...extra });
const STATE = (extra = {}) => ({ page: "inbox", filter: null, chat: null, link: null, address: null, groupAs: "new", session: "s-1", problem: null, zoneMinutes: 480, now: "2026-11-01T12:00:00Z", ...extra });
const words = (rows) => rows.map((r) => r.kind === "head" ? `#${r.title}${r.sub ? `(${r.sub})` : ""}` : r.kind === "text" || r.kind === "section" ? r.text : r.kind === "chat" ? `[${r.row.as.initial}]${r.row.name}` : r.kind === "input" ? `<${r.placeholder}>` : r.kind === "chips" ? r.items.map((i) => `${i.on ? "*" : ""}${i.label}`).join("|") : r.kind === "buttons" ? r.items.map((i) => `[${i.label}]`).join("") : r.kind === "toggle" ? `${r.on ? "☑" : "☐"}${r.label}` : r.kind === "copy" ? `{${r.text}}[${r.label}]` : r.kind === "message" ? `${r.item.who}${r.tag !== undefined ? `(${r.tag})` : ""} ${r.time}: ${r.item.text}` : r.kind);

test("the sign-in (architecture §3.2): an email — no server to fill in — with why there is no password and that Claude never sees it, the language at the foot; the email given, where its code went, 重发 and 换个邮箱; a new person names their first avatar; just in, who this computer plays and the two ways to a first chat", () => {
  assert.deepEqual(words(paneRows(VIEW({ loggedIn: false, avatars: [], rows: [] }), STATE())), ["#Gemsbang(你的几个分身，替你在各个群里)", "<you@example.com，回车发验证码>", "不用密码。内测先用邮箱；以后手机号、Apple、Google、公司账号都能登。", "邮箱和验证码只填在这个侧栏里，Claude 看不到。", "select"]);
  assert.deepEqual(words(paneRows(VIEW({ loggedIn: false, lang: "en", relay: "https://gemsbang.com", avatars: [], rows: [] }), STATE({ address: "john@example.com" }))), ["#Enter the code", "The code went to john@example.com, from gemsbang.com. It works for 10 minutes", "<6 digits, Enter signs in>", "[Not there? Send again][Another email]"]);
  const first = paneRows(VIEW({ avatars: [], rows: [], unread: 0, synced: "2026-11-01T12:00:00Z" }), STATE());
  assert.deepEqual(words(first), ["#Gemsbang", "<名字，回车进去>", "这是你的第一个分身。到了别的场合可以换一个，比如在家长群里叫「Lily 爸爸」。以后随时能改名。"]);
  assert.equal(first[1].label, "大家怎么叫你？");
  assert.deepEqual(words(paneRows(VIEW({ avatars: [JOHN], rows: [], unread: 0, bodies: { "s-1": JOHN.id } }), STATE())), ["#Gemsbang", "这台电脑上的 Claude Code 接上了「John」。有人在群里叫到你，这里先问你回不回。", "还没有聊天。建一个群，把链接发给人或发给他们的 agent；别人发给你的进群链接，贴在下面就能进。", "<贴进群链接 https://…/i/…>", "[建群]"]);
});

test("账号与登录 (architecture §3.1): the ways in, the last one kept; adding an email, its code; the devices with the avatars their agents play, this one first, the others signed out one by one or all at once; nothing read yet, said so", () => {
  const account = { methods: [{ id: "email-1", kind: "email", shown: "j***@example.com", at: "t" }], devices: [
    { id: "token-a", name: "Mac · Claude Code", at: "2026-11-01T09:00:00Z", current: true, avatars: [{ id: JOHN.id, name: "John" }, { id: LILY.id, name: "Lily 爸爸" }] },
    { id: "token-b", name: "网页 · Safari", at: "2026-10-31T13:14:00Z", current: false, avatars: [] },
  ] };
  const rows = paneRows(VIEW(), STATE({ page: "account", account }));
  assert.deepEqual(words(rows), [
    "#账号与登录(用哪种方式登进来，都是同一个你)", "登录方式", "邮箱 · j***@example.com", "只剩一种登录方式时不能解绑，免得找不回账号。",
    "加一种登录方式", "<you@example.com，回车发验证码>", "手机号、Apple、Google、公司账号：内测只开了邮箱，这几种正式版开。", "换手机号、换公司、换用的 AI，都只是换绑一种登录方式。你的分身、群和聊天记录都不变。",
    "登录的设备", "Mac · Claude Code · 演「John」「Lily 爸爸」 · 这台", "网页 · Safari · 10-31 21:14", "[退出]", "[退出其他所有设备]",
  ]);
  assert.deepEqual(rows[0].back, { op: "page", page: "settings" });
  assert.deepEqual(rows.find((r) => r.key === "device-revoke-token-b").items[0].action, { op: "device-revoke", id: "token-b" });
  const two = { ...account, methods: [...account.methods, { id: "email-2", kind: "email", shown: "j***@work.example", at: "t" }] };
  const adding = paneRows(VIEW(), STATE({ page: "account", account: two, adding: "j@work.example" }));
  assert.deepEqual(words(adding).slice(1, 10), ["登录方式", "邮箱 · j***@example.com", "[解绑]", "邮箱 · j***@work.example", "[解绑]", "加一种登录方式", "验证码已发到 j@work.example，发件人是 im.example。10 分钟内有效", "<6 位数字，回车登录>", "[换个邮箱]"]);
  assert.deepEqual(adding.find((r) => r.key === "method-remove-email-2").items[0].action, { op: "method-remove", id: "email-2" });
  assert.deepEqual(words(paneRows(VIEW(), STATE({ page: "account", account: null }))), ["#账号与登录(用哪种方式登进来，都是同一个你)", "正在读账号…"]);
});

test("the total inbox (spec §7.1): 我的分身 and 设置 at the top, the unread beside the name; a filter per avatar when there are two or more; every chat with its avatar's initial; a link to paste and 建群 under them; nothing yet, the way in; a relay out of reach and an invitation not followed said first", () => {
  assert.deepEqual(words(paneRows(VIEW(), STATE())), ["#Gemsbang(2 条未读)", "*全部|John|Lily 爸爸", "对话", "[J]设置页改版", "[L]三年二班家长", "<贴进群链接 https://…/i/…>", "[建群]"]);
  assert.deepEqual(words(paneRows(VIEW(), STATE({ filter: LILY.id }))).slice(1, 4), ["全部|John|*Lily 爸爸", "对话", "[L]三年二班家长"]);
  assert.deepEqual(words(paneRows(VIEW({ avatars: [], rows: [], unread: 0, offline: "连不上中继：refused", notes: [{ url: "https://evil.example/i/abcd9ahe.md", at: "t" }] }), STATE())), [
    "#Gemsbang", "断了：连不上中继：refused · 显示的是上次同步的", "有一份进群说明，没照做：不是你亲手贴的（https://evil.example/i/abcd9ahe.md）", "还没有聊天。建一个群，把链接发给人或发给他们的 agent；别人发给你的进群链接，贴在下面就能进。", "<贴进群链接 https://…/i/…>", "[建群]",
  ]);
  const head = paneRows(VIEW(), STATE())[0];
  assert.deepEqual(head.actions.map((a) => a.action), [{ op: "page", page: "avatars" }, { op: "page", page: "settings" }]);
});

test("a chat (spec §7.2): its name, its size and who you are there, 叫人 for a group; the earlier lines counted; who came in; each line with `分身` where an agent said it, its time in the person's zone; the box 「以 <分身> 说」", () => {
  const chat = { owner: JOHN.id, id: "g-000000000a", kind: "group", name: "设置页改版", count: 4, as: JOHN, earlier: 21, isOwner: true, items: [
    { kind: "joined", id: "member-2", avatar: "a-00000000b1", who: "李四", at: "2026-11-01T06:01:00Z" },
    { kind: "message", id: "m-1", avatar: "a-00000000b1", who: "李四", text: "v4 稿子在这", at: "2026-11-01T06:02:00Z", mark: true, mine: false },
    { kind: "message", id: "m-2", avatar: JOHN.id, who: "John", text: "收到", at: "2026-11-01T06:03:00Z", mark: false, mine: true },
  ] };
  const rows = paneRows(VIEW(), STATE({ page: "chat", chat }));
  assert.deepEqual(words(rows), ["#设置页改版(4 人 · 你在这里是 John)", "还有 21 条更早的", "李四 进群了", "李四(分身) 14:02: v4 稿子在这", "John 14:03: 收到", "<以 John 说>"]);
  assert.deepEqual(rows[0].actions.map((a) => a.label), ["叫人", "静音"]);
  assert.equal(rows[4].badge.id, JOHN.id, "the person's own line carries their avatar's badge");
  assert.deepEqual(paneRows(VIEW(), STATE({ page: "chat", chat: { ...chat, kind: "dm", items: [] } }))[0].actions.map((a) => a.label), ["静音"], "a two-person chat invites nobody");
  assert.deepEqual(words(paneRows(VIEW(), STATE({ page: "chat", chat: null }))).slice(0, 1), ["#Gemsbang(2 条未读)"], "no chat open: the inbox");
});

test("叫人 (spec §6.1): the link for a person and the line for an agent, each with its copy; the owner's two switches, the days and a new link; a member sees the days only", () => {
  const chat = { owner: JOHN.id, id: "g-000000000a", kind: "group", name: "设置页改版", count: 4, as: JOHN, earlier: 0, isOwner: true, items: [] };
  const link = { code: "abcd9ahe", url: "https://im.example/i/abcd9ahe?by=a-0000000001", line: "读 https://im.example/i/abcd9ahe.md ，照着做：用我的身份进「设置页改版」。", days: 7, forward: true, approve: false, isOwner: true, group: "设置页改版" };
  const rows = paneRows(VIEW(), STATE({ page: "invite", chat, link }));
  assert.deepEqual(words(rows), [
    "#叫人进「设置页改版」(4 人 · 你在这里是 John)", "发给人", "发到微信、短信都行。对方点开，填邮箱验证码、起个名，就在群里了，不用装任何东西。", `{${link.url}}[复制链接]`,
    "发给 agent", "对方把这句贴给他自己的 agent，Claude Code、Codex 都行。agent 先问他点头，再自己进来，它就是他在群里的分身。", `{${link.line}}[复制这句]`,
    "☑群里每个人都能转这个链接", "☐进群要我同意", "你是群主，这两项随时改 · 链接 7 天有效", "[换一个链接（旧的立刻失效）]",
  ]);
  assert.deepEqual(rows.find((r) => r.key === "approve").action, { op: "link-rules", approve: true });
  assert.deepEqual(words(paneRows(VIEW(), STATE({ page: "invite", chat, link: { ...link, isOwner: false, days: 3 } }))).slice(-1), ["链接还有 3 天有效"]);
  assert.deepEqual(words(paneRows(VIEW(), STATE({ page: "invite", chat, link: null }))).slice(-1), ["…"]);
});

test("我的分身 (spec §7.5) and the settings: each avatar's chats, its marking as a switch, a new name, whether this session speaks for it; the default name and the language; the account and signing out, no server", () => {
  const rows = paneRows(VIEW({ defaultName: "老张", bodies: { "s-1": LILY.id } }), STATE({ page: "avatars" }));
  assert.deepEqual(words(rows), [
    "#我的分身(每个分身是你在一个角色里的样子)",
    "John", "在哪：设置页改版", "☑它说的话：对外标出来", "被叫到：先问你回不回", "自动回：没有", "☐静音", "<我看一下，晚点回。>", "<改名，回车生效>", "[让这个会话替它]", "在哪个仓库干：还没指定（任务要它）", "<这台电脑上仓库的完整路径，回车保存；空着回车清掉>",
    "Lily 爸爸", "在哪：三年二班家长", "☐它说的话：对外不标", "被叫到：先问你回不回", "自动回：没有", "☐静音", "<我看一下，晚点回。>", "<改名，回车生效>", "[这个会话在替它 · 不替了]", "在哪个仓库干：还没指定（任务要它）", "<这台电脑上仓库的完整路径，回车保存；空着回车清掉>",
    "默认名", "<只在起名时作建议，不预选；回车保存>", "select",
  ]);
  assert.deepEqual(rows.find((r) => r.key === `body-${LILY.id}`).items[0].action, { op: "bind", avatar: null });
  assert.deepEqual(words(paneRows(VIEW({ lang: "ja" }), STATE({ page: "settings" }))), ["#設定", "select", "[アカウントとログイン]", "[ログアウト]"]);
  assert.deepEqual(words(paneRows(VIEW(), STATE({ page: "new-group", groupAs: "new" }))), ["#建群", "用哪个分身建", "John|Lily 爸爸|*新的分身", "<自己写一个>", "<群名，回车就建>"]);
  assert.deepEqual(words(paneRows(VIEW(), STATE({ page: "new-group", groupAs: JOHN.id }))).slice(2), ["*John|Lily 爸爸|新的分身", "<群名，回车就建>"]);
});

test("the band and the fields: nothing unless gemsbang cannot work or nobody is logged in; Enter in each field does its one thing, an empty one nothing", () => {
  assert.equal(gbBand(VIEW(), null), undefined);
  assert.deepEqual(gbBand(VIEW({ loggedIn: false }), null), { text: "gemsbang 还没登录", tone: "dim", open: "打开", actions: [], more: 0 });
  assert.deepEqual(gbBand(null, "gemsbang：找不到 node"), { text: "gemsbang：找不到 node", tone: "error", open: "打开", actions: [], more: 0 });
  const s = { chat: { owner: JOHN.id, id: "g-000000000a" }, address: "john@example.com", adding: "j@work.example", groupAs: "new", groupAvatar: "John", session: "s-1" };
  assert.deepEqual(fieldAction("email", " john@example.com ", s), { local: "email", email: "john@example.com" });
  assert.deepEqual(fieldAction("code", "123456", s), { call: "login-verify", args: { email: "john@example.com", code: "123456" } });
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
