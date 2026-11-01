import { test } from "node:test";
import assert from "node:assert/strict";
import { fieldAction, gbBand, paneRows } from "../dist/hosts/claude-code/gb-panel.js";

const JOHN = { id: "a-0000000001", name: "John", color: "#2f6fb3", initial: "J", venues: ["设置页改版"], mark: true, muted: false, paused: false, away: false, week: 4 };
const LILY = { id: "a-0000000002", name: "Lily 爸爸", color: "#b5543c", initial: "L", venues: ["三年二班家长"], mark: false, muted: false, paused: true, away: false, week: 0 };
const ROW = (name, as, extra = {}) => ({ owner: as.id, id: `g-${name.length}000000000`.slice(0, 12), kind: "group", name, as, last: { who: "李四", text: "hi" }, at: "2026-11-01T06:00:00Z", time: "14:00", unread: 1, ...extra });
const VIEW = (extra = {}) => ({ relay: "https://im.example", trusted: ["https://im.example"], loggedIn: true, lang: "zh", person: "p-0000000001", avatars: [JOHN, LILY], rows: [ROW("设置页改版", JOHN), ROW("三年二班家长", LILY)], unread: 2, needs: [], muted: { avatars: [], venues: [] }, notes: [], bodies: {}, ...extra });
const STATE = (extra = {}) => ({ page: "inbox", filter: null, chat: null, link: null, phone: null, groupAs: "new", session: "s-1", problem: null, zoneMinutes: 480, now: "2026-11-01T12:00:00Z", ...extra });
const words = (rows) => rows.map((r) => r.kind === "head" ? `#${r.title}${r.sub ? `(${r.sub})` : ""}` : r.kind === "text" || r.kind === "section" ? r.text : r.kind === "chat" ? `[${r.row.as.initial}]${r.row.name}` : r.kind === "input" ? `<${r.placeholder}>` : r.kind === "chips" ? r.items.map((i) => `${i.on ? "*" : ""}${i.label}`).join("|") : r.kind === "buttons" ? r.items.map((i) => `[${i.label}]`).join("") : r.kind === "toggle" ? `${r.on ? "☑" : "☐"}${r.label}` : r.kind === "copy" ? `{${r.text}}[${r.label}]` : r.kind === "message" ? `${r.item.who}${r.tag !== undefined ? `(${r.tag})` : ""} ${r.time}: ${r.item.text}` : r.kind);

test("the login (spec §6.2): no relay, its address; a relay, the phone; the phone given, the code and 发验证码 again; the language at the foot", () => {
  assert.deepEqual(words(paneRows(VIEW({ loggedIn: false, relay: "", avatars: [], rows: [] }), STATE())), ["#登录 gemsbang", "<比如 https://im.example.com>", "select"]);
  assert.deepEqual(words(paneRows(VIEW({ loggedIn: false, avatars: [], rows: [] }), STATE())), ["#登录 gemsbang", "中继：https://im.example", "<手机号>", "<https://im.example>", "select"]);
  assert.deepEqual(words(paneRows(VIEW({ loggedIn: false, lang: "en", avatars: [], rows: [] }), STATE({ phone: "13800138000" }))), ["#Log in to gemsbang", "Relay: https://im.example", "13800138000 · The code is on its way; it works for 10 minutes", "<Code>", "[Send the code]", "<https://im.example>", "select"]);
});

test("the total inbox (spec §7.1): 我的分身 and 设置 at the top, the unread beside the name; a filter per avatar when there are two or more; every chat with its avatar's initial; a link to paste and 建群 under them; nothing yet, the way in; a relay out of reach and an invitation not followed said first", () => {
  assert.deepEqual(words(paneRows(VIEW(), STATE())), ["#Gemsbang(2 条未读)", "*全部|John|Lily 爸爸", "对话", "[J]设置页改版", "[L]三年二班家长", "<贴进群链接 https://…/i/…>", "[建群]"]);
  assert.deepEqual(words(paneRows(VIEW(), STATE({ filter: LILY.id }))).slice(1, 4), ["全部|John|*Lily 爸爸", "对话", "[L]三年二班家长"]);
  assert.deepEqual(words(paneRows(VIEW({ avatars: [], rows: [], unread: 0, offline: "连不上中继：refused", notes: [{ url: "https://evil.example/i/abcd9ahe.md", at: "t" }] }), STATE())), [
    "#Gemsbang", "断了：连不上中继：refused · 显示的是上次同步的", "有一份进群说明，没照做：不是你亲手贴的（https://evil.example/i/abcd9ahe.md）", "还没有对话。贴一个进群链接，或者建一个群。", "<贴进群链接 https://…/i/…>", "[建群]",
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
    "#叫人进「设置页改版」(4 人 · 你在这里是 John)", "发给人", "发到微信、短信都行。对方点开，填手机号验证码、起个名，就在群里了。前 7 天他的分身替他先回。", `{${link.url}}[复制链接]`,
    "发给 agent", "对方把这句贴给他自己的 agent，Claude Code、Codex 都行。agent 先问他点头，再自己进来，它就是他在群里的分身。", `{${link.line}}[复制这句]`,
    "☑群里每个人都能转这个链接", "☐进群要我同意", "你是群主，这两项随时改 · 链接 7 天有效", "[换一个链接（旧的立刻失效）]",
  ]);
  assert.deepEqual(rows.find((r) => r.key === "approve").action, { op: "link-rules", approve: true });
  assert.deepEqual(words(paneRows(VIEW(), STATE({ page: "invite", chat, link: { ...link, isOwner: false, days: 3 } }))).slice(-1), ["链接还有 3 天有效"]);
  assert.deepEqual(words(paneRows(VIEW(), STATE({ page: "invite", chat, link: null }))).slice(-1), ["…"]);
});

test("我的分身 (spec §7.5) and the settings: each avatar's chats, its marking as a switch, a new name, whether this session speaks for it; the default name and the language; the relay and logging out", () => {
  const rows = paneRows(VIEW({ defaultName: "老张", bodies: { "s-1": LILY.id } }), STATE({ page: "avatars" }));
  assert.deepEqual(words(rows), [
    "#我的分身(每个分身是你在一个角色里的样子)",
    "John", "在哪：设置页改版", "☑它说的话：对外标出来", "谁来演：托管 · 这周跑了 4 轮", "☐暂停自动回复", "☐静音", "<我看一下，晚点回。>", "<改名，回车生效>", "[让这个会话替它]", "在哪个仓库干：还没指定（借电脑的活要它）", "<这台电脑上仓库的完整路径，回车保存；空着回车清掉>",
    "Lily 爸爸", "在哪：三年二班家长", "☐它说的话：对外不标", "谁来演：托管 · 这周跑了 0 轮", "☑暂停自动回复", "☐静音", "<我看一下，晚点回。>", "<改名，回车生效>", "[这个会话在替它 · 不替了]", "在哪个仓库干：还没指定（借电脑的活要它）", "<这台电脑上仓库的完整路径，回车保存；空着回车清掉>",
    "默认名", "<只在起名时作建议，不预选；回车保存>", "select",
  ]);
  assert.deepEqual(rows.find((r) => r.key === `body-${LILY.id}`).items[0].action, { op: "bind", avatar: null });
  assert.deepEqual(words(paneRows(VIEW({ lang: "ja" }), STATE({ page: "settings" }))), ["#設定", "リレー：https://im.example", "<https://im.example>", "select", "[ログアウト]"]);
  assert.deepEqual(words(paneRows(VIEW(), STATE({ page: "new-group", groupAs: "new" }))), ["#建群", "用哪个分身建", "John|Lily 爸爸|*新的分身", "<自己写一个>", "<群名，回车就建>"]);
  assert.deepEqual(words(paneRows(VIEW(), STATE({ page: "new-group", groupAs: JOHN.id }))).slice(2), ["*John|Lily 爸爸|新的分身", "<群名，回车就建>"]);
});

test("the band and the fields: nothing unless gemsbang cannot work or nobody is logged in; Enter in each field does its one thing, an empty one nothing", () => {
  assert.equal(gbBand(VIEW(), null), undefined);
  assert.deepEqual(gbBand(VIEW({ loggedIn: false }), null), { text: "gemsbang 还没登录", tone: "dim", open: "打开", actions: [], more: 0 });
  assert.deepEqual(gbBand(null, "gemsbang：找不到 node"), { text: "gemsbang：找不到 node", tone: "error", open: "打开", actions: [], more: 0 });
  const s = { chat: { owner: JOHN.id, id: "g-000000000a" }, phone: "13800138000", groupAs: "new", groupAvatar: "John" };
  assert.deepEqual(fieldAction("relay", " https://im.example ", s), { call: "setup", args: { relay: "https://im.example" } });
  assert.deepEqual(fieldAction("phone", "13800138000", s), { local: "phone", phone: "13800138000" });
  assert.deepEqual(fieldAction("code", "123456", s), { call: "login-verify", args: { phone: "13800138000", code: "123456" } });
  assert.equal(fieldAction("code", "123456", { ...s, phone: null }), undefined);
  assert.deepEqual(fieldAction("say", "稿子 v4", s), { call: "say", args: { owner: JOHN.id, id: "g-000000000a", text: "稿子 v4" } });
  assert.deepEqual(fieldAction("group", "周会", s), { call: "group", args: { name: "周会", avatarName: "John" } });
  assert.deepEqual(fieldAction("group", "周会", { ...s, groupAs: JOHN.id }), { call: "group", args: { name: "周会", as: JOHN.id } });
  assert.deepEqual(fieldAction("join", "https://im.example/i/abcd9ahe", s), { local: "join", url: "https://im.example/i/abcd9ahe" });
  assert.deepEqual(fieldAction("rename", "乐乐爸爸", s, LILY.id), { call: "rename", args: { avatar: LILY.id, name: "乐乐爸爸" } });
  assert.deepEqual(fieldAction("default-name", "  ", s), { call: "default-name", args: { name: "" } });
  assert.equal(fieldAction("say", "   ", s), undefined);
});
