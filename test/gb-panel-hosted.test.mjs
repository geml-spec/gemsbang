import { test } from "node:test";
import assert from "node:assert/strict";
import { fieldAction, paneRows } from "../dist/hosts/claude-code/gb-panel.js";

const LILY = { id: "a-0000000002", name: "Lily 爸爸", color: "#b5543c", initial: "L", venues: ["三年二班家长"], mark: false, muted: false, paused: false, away: true, week: 12 };
const VIEW = (extra = {}) => ({ relay: "https://im.example", trusted: [], loggedIn: true, lang: "zh", avatars: [LILY], rows: [], unread: 0, needs: [], muted: { avatars: [], venues: [] }, notes: [], bodies: {}, ...extra });
const STATE = (extra = {}) => ({ page: "avatars", filter: null, chat: null, link: null, phone: null, groupAs: "new", session: "s-1", problem: null, now: "2026-11-01T09:00:00Z", ...extra });
const said = (rows) => rows.filter((r) => /^(hosted|pause|quota|key|api-key|away)/.test(r.key)).map((r) => r.kind === "toggle" ? `${r.on ? "☑" : "☐"}${r.label}` : r.kind === "input" ? `<${r.placeholder}>` : r.kind === "buttons" ? r.items.map((i) => `[${i.label}]`).join("") : r.text);

test("我的分身 (spec §7.5, §8.3): who plays it and how much this week, 本人在时才回 when it only receives, 暂停自动回复; the quota, how the person pays, a field for their key and its removal; in a chat, who answers only when here, and where the avatars stopped calling each other", () => {
  assert.deepEqual(said(paneRows(VIEW({ quota: { free: true, daysLeft: 3, repliesLeft: 20, key: false } }), STATE())), [
    "谁来演：托管 · 这周跑了 12 轮 · 本人在时才回", "☐暂停自动回复", "免费额度：还剩 3 天、20 次", "付费方式：还没有；用完免费额度后分身只收不回", "<粘贴你的模型 API key，回车保存（只给中继的托管编排器）>",
  ]);
  const paid = paneRows(VIEW({ avatars: [{ ...LILY, paused: true, away: false }], quota: { free: false, daysLeft: 0, repliesLeft: 0, key: true } }), STATE());
  assert.deepEqual(said(paid), ["谁来演：托管 · 这周跑了 12 轮", "☑暂停自动回复", "免费额度：用完了", "付费方式：自己的 API key（已接上）", "<粘贴你的模型 API key，回车保存（只给中继的托管编排器）>", "[移除 API key]"]);
  assert.deepEqual(paid.find((r) => r.key === "pause-a-0000000002").action, { op: "pause", avatar: LILY.id, paused: false });
  assert.equal(paneRows(VIEW({ quota: { free: false, daysLeft: 0, repliesLeft: 0, key: false } }), STATE()).find((r) => r.key === "quota").tone, "error");
  assert.deepEqual(said(paneRows(VIEW(), STATE())), ["谁来演：托管 · 这周跑了 12 轮 · 本人在时才回", "☐暂停自动回复"], "a relay that hosts nobody: no quota");
  assert.deepEqual(fieldAction("api-key", "  sk-1 ", { chat: null, phone: null, groupAs: "new" }), { call: "key", args: { apiKey: "sk-1" } });
  const chat = { owner: "a-00000000c1", id: "g-000000000b", kind: "group", name: "三年二班家长", count: 3, as: LILY, earlier: 0, isOwner: false, items: [{ kind: "note", id: "note-1", note: "hops", at: "2026-11-01T08:00:00Z" }], away: ["李四"] };
  const rows = paneRows(VIEW(), STATE({ page: "chat", chat }));
  assert.deepEqual(said(rows), ["「李四」本人在时才回"]);
  assert.deepEqual(rows.filter((r) => r.key === "note-note-1").map((r) => [r.text, r.tone]), [["分身之间来回叫了三次，先停在这里，等本人来接", "dim"]]);
});
