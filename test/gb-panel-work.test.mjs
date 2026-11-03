import { test } from "node:test";
import assert from "node:assert/strict";
import { fieldAction, paneRows } from "../dist/hosts/claude-code/gb-panel.js";

const JOHN = { id: "a-0000000001", name: "John", color: "#2f6fb3", initial: "J", venues: ["设置页改版"], mark: true, muted: false, repo: "/work/app" };
const LILY = { id: "a-0000000002", name: "Lily 爸爸", color: "#b5543c", initial: "L", venues: ["三年二班家长"], mark: false, muted: false };
const NOW = "2026-11-01T09:00:00Z";
const VIEW = (extra = {}) => ({ relay: "https://im.example", trusted: [], loggedIn: true, lang: "zh", avatars: [JOHN, LILY], rows: [], unread: 0, needs: [], muted: { avatars: [], venues: [] }, work: [], notes: [], bodies: {}, ...extra });
const STATE = (extra = {}) => ({ page: "inbox", filter: null, chat: null, link: null, phone: null, groupAs: "new", session: "s-1", problem: null, now: NOW, ...extra });
const JOB = (id, state, extra = {}) => ({ id, avatar: JOHN.id, avatarName: "John", need: "need-1", summary: `修 ${id}`, state, at: NOW, since: NOW, group: "设置页改版", fromName: "李四", words: "帮忙修一下", badge: JOHN, repo: "/work/app", ...extra });
const BORROW = (avatar, extra = {}) => ({ id: "need-1", avatar: avatar.id, kind: "borrow", summary: "修设置页缓存的写路径", options: [{ label: "现在干" }, { label: "排着" }, { label: "不干" }], expires: "2026-11-01T21:00:00Z", at: NOW, state: "open", avatarName: avatar.name, group: "设置页改版", badge: avatar, muted: false, ...extra });

test("任务 in the pane (spec §7.4, §7.5; once called 借电脑): a borrow card says where it would work and what may be done there, or that no repository is named; the jobs under 需要你, each with where it stands, a queued one with 现在干", () => {
  const card = paneRows(VIEW({ needs: [BORROW(JOHN, { repo: "/work/app" })] }), STATE()).find((r) => r.kind === "need");
  assert.equal(card.willSay, "在哪干：/work/app\n准做的：读、改、跑仓库里已有的命令；不推送，不碰密钥");
  assert.match(paneRows(VIEW({ needs: [BORROW(LILY)] }), STATE()).find((r) => r.kind === "need").willSay, /^还没指定仓库：先在「我」里指定\n/);
  const rows = paneRows(VIEW({ work: [JOB("work-1", "taken"), JOB("work-2", "queued"), JOB("work-3", "waiting", { auto: true }), JOB("work-4", "failed"), JOB("work-5", "done")] }), STATE());
  const at = rows.findIndex((r) => r.key === "work");
  assert.deepEqual(rows.slice(at, at + 7).map((r) => (r.kind === "buttons" ? r.items.map((i) => `[${i.label}]`).join("") : `${r.text}${r.tone !== undefined && r.tone !== "plain" ? ` (${r.tone})` : ""}`)), [
    "任务 3",
    "John · 在干 · 「设置页改版」：修 work-1",
    "John · 排着 · 「设置页改版」：修 work-2",
    "[现在干]",
    "John · 等电脑 · 放行过，没再问你 · 「设置页改版」：修 work-3",
    "John · 没干成 · 「设置页改版」：修 work-4 (error)",
    "John · 干完了 · 「设置页改版」：修 work-5 (dim)",
  ]);
  assert.deepEqual(rows[at + 3].items[0].action, { op: "work-now", avatar: JOHN.id, work: "work-2" });
  assert.equal(paneRows(VIEW(), STATE()).some((r) => r.key === "work"), false, "no jobs, no section");
});

test("我 (spec §7.5, P8, S23): what each avatar's tasks may do unasked, each taken back with 撤; where each avatar's computer works, by its folder's name, and none said only once 改 is open (P8b), where 换 opens a field to name or clear it; in a chat, the facts the host saw under the line they came with", () => {
  const repoOf = (rows) => rows.filter((r) => r.kind === "card" && r.badge !== undefined).map((r) => [r.lines.find((x) => x.key.startsWith("repo-"))?.value, r.fields.filter((f) => f.key.startsWith("repo-input-")).map((f) => [f.placeholder, f.value])]);
  assert.deepEqual(repoOf(paneRows(VIEW(), STATE({ page: "avatars" }))), [["在 app 里干", []], [undefined, []]], "none named: no line until 改");
  const open = paneRows(VIEW(), STATE({ page: "avatars", editing: `avatar-${LILY.id}` }));
  assert.deepEqual(repoOf(open)[1], ["还没指定仓库（任务要它）", []]);
  assert.deepEqual(open.find((r) => r.key === `avatar-${LILY.id}`).lines[0].presses.map((p) => [p.label, p.action]), [["换", { op: "repo-open", open: true }]]);
  assert.deepEqual(repoOf(paneRows(VIEW(), STATE({ page: "avatars", editing: `avatar-${JOHN.id}`, repoOpen: true })))[0][1], [["这台电脑上仓库的完整路径，回车保存；空着回车清掉", "/work/app"]], "换 opens the field, the path in it");
  // 不用问 (S23, P8a): whose tasks or which chat's go ahead unasked, each with its 撤; none, no line.
  const allowsOf = (allows) => paneRows(VIEW(), STATE({ page: "avatars", allows: { [JOHN.id]: allows } }))[1].lines.find((x) => x.key.startsWith("allows-"));
  assert.equal(allowsOf([]), undefined);
  const one = allowsOf([{ key: "person:a-00000000b2", person: "a-00000000b2", venue: { owner: JOHN.id, id: "g-000000000a" }, who: "张三", group: "设置页改版" }]);
  assert.deepEqual([one.label, one.value, one.presses.map((p) => [p.label, p.action])], ["不用问", "张三的活（设置页改版）", [["撤", { op: "allow-off", avatar: JOHN.id, allow: "person:a-00000000b2" }]]]);
  const two = allowsOf([{ key: "person:a-00000000b2", person: "a-00000000b2", who: "张三" }, { key: `venue:${JOHN.id}/g-000000000a`, venue: { owner: JOHN.id, id: "g-000000000a" }, group: "设置页改版" }]);
  assert.deepEqual([two.value, two.presses.map((p) => p.label)], ["张三的活 · 「设置页改版」里的活", ["撤「张三」", "撤「设置页改版」"]]);
  const s = { chat: null, phone: null, groupAs: "new" };
  assert.deepEqual(fieldAction("repo", " /work/app ", s, JOHN.id), { call: "repo", args: { avatar: JOHN.id, path: "/work/app" } });
  assert.deepEqual(fieldAction("repo", "", s, JOHN.id), { call: "repo", args: { avatar: JOHN.id, path: "" } }, "empty clears it");
  const chat = { owner: JOHN.id, id: "g-000000000a", kind: "group", name: "设置页改版", count: 2, as: JOHN, earlier: 0, isOwner: true, items: [
    { kind: "message", id: "msg-3", avatar: JOHN.id, who: "John", text: "登录页修好了。", at: NOW, mark: true, mine: true, facts: [{ label: "npm test", ok: true }, { label: "npm run build", ok: true }] },
    { kind: "message", id: "msg-4", avatar: JOHN.id, who: "John", text: "测试没过。", at: NOW, mark: true, mine: true, facts: [{ label: "npm test", ok: false }] },
  ] };
  const lines = paneRows(VIEW(), STATE({ page: "chat", chat })).filter((r) => r.key.startsWith("facts-")).map((r) => [r.text, r.tone]);
  assert.deepEqual(lines, [["已核实：npm test 通过 · npm run build 通过", "success"], ["已核实：npm test 没通过", "error"]]);
});
