import { test } from "node:test";
import assert from "node:assert/strict";
import { callKey, callOf, callsOf, roundFor } from "../dist/core/avatar/calls.js";
import { roundPrompt } from "../dist/core/avatar/round.js";

const JOHN = { id: "a-0000000001", name: "John" }, LILY = { id: "a-0000000002", name: "Lily 爸爸" };
const ZHANG = { id: "a-0000000008", name: "张三" }, LI = { id: "a-0000000007", name: "李四" }, WANG = { id: "a-0000000009", name: "王老师" };
const line = (id, who, text, at, extra = {}) => ({ id, value: { speaker: `avatar:${who.id}`, by: "person", text, at, ...extra } });
const GROUP = {
  owner: JOHN.id, id: "g-000000000a", kind: "group", name: "设置页改版", members: [JOHN, ZHANG, LI], as: JOHN.id,
  blocks: [
    { id: "member-1", value: { avatar: ZHANG.id, at: "2026-11-02T06:00:00Z" } },
    line("m-1", LI, "v4 稿子在这，周五前要定", "2026-11-02T06:02:00Z"),
    line("m-2", ZHANG, "@John Safari 里导出按钮点了没反应", "2026-11-02T06:03:00Z"),
    line("m-3", JOHN, "我看看", "2026-11-02T06:04:00Z"),
    line("m-4", LI, "@John 周五前能给稿子反馈吗？", "2026-11-02T06:11:00Z"),
    line("m-5", ZHANG, "急，今天能看吗", "2026-11-02T06:15:00Z"),
  ],
};
const DM = { owner: LILY.id, id: "d-000000000b", kind: "dm", name: "王老师", members: [LILY, WANG], as: LILY.id, blocks: [line("m-1", WANG, "周五春游能来当志愿者吗", "2026-11-02T07:00:00Z")] };
const MIRROR = { at: "2026-11-02T08:00:00Z", relay: "https://im.example", person: "p-1", lang: "zh", avatars: [JOHN, LILY], venues: [GROUP, DM] };

test("被提及 (architecture §6.3): the lines that call the avatar after its own last line — an @, a two-person chat, its name, a reply to it — gathered into one call per chat; none, no call; a line let go ends the call up to it", () => {
  const c = callOf(GROUP, { name: "John", auto: false });
  assert.deepEqual([c.lines.map((l) => [l.id, l.who, l.reason]), c.last, c.at, c.group, c.auto], [[["m-4", "李四", "mention"]], "m-4", "2026-11-02T06:11:00Z", "设置页改版", false], "the @ before its own 我看看 is answered already; 急，今天能看吗 calls nobody");
  assert.equal(callOf(GROUP, { name: "John", auto: false, since: "m-4" }), undefined, "let go up to m-4");
  const quiet = { ...GROUP, blocks: GROUP.blocks.slice(0, 4) };
  assert.equal(callOf(quiet, { name: "John", auto: false }), undefined, "nothing after its own line");
  const named = { ...GROUP, blocks: [...GROUP.blocks, line("m-6", ZHANG, "John 你周五在吗", "2026-11-02T06:20:00Z"), line("m-7", LI, "收到", "2026-11-02T06:21:00Z", { replyTo: "m-3" })] };
  assert.deepEqual(callOf(named, { name: "John", auto: false }).lines.map((l) => [l.id, l.reason]), [["m-4", "mention"], ["m-6", "name"], ["m-7", "reply"]], "a new line joins the call");
  const hopped = { ...DM, blocks: [line("m-1", WANG, "好的", "2026-11-02T07:00:00Z", { by: "agent", hops: 3 })] };
  assert.equal(callOf(hopped, { name: "Lily 爸爸", auto: false }), undefined, "avatars calling avatars stop at three hops");
});

test("every chat's call, newest first (architecture §6.3): per avatar its own name; the chats it answers on its own marked; a line let go per avatar and chat", () => {
  const calls = callsOf(MIRROR, { dismissed: {}, autos: { [LILY.id]: [`${DM.owner}/${DM.id}`] } });
  assert.deepEqual(calls.map((c) => [c.avatar, c.group, c.lines.map((l) => l.reason), c.auto]), [[LILY.id, "王老师", ["dm"]], [JOHN.id, "设置页改版", ["mention"]]].map(([a, g, r]) => [a, g, r, a === LILY.id]));
  assert.equal(callKey(JOHN.id, GROUP.owner, GROUP.id), `${JOHN.id}|${GROUP.owner}/${GROUP.id}`);
  assert.deepEqual(callsOf(MIRROR, { dismissed: { [callKey(JOHN.id, GROUP.owner, GROUP.id)]: "m-4" }, autos: {} }).map((c) => c.group), ["王老师"]);
});

test("the round that answers a call (architecture §6.3): the chat's last lines with its own marked, why it answers, replying to the last line that called it, its hops one more than an agent's", () => {
  const call = callOf(GROUP, { name: "John", auto: false });
  const r = roundFor(GROUP, call, { name: "John", why: "asked", mark: true });
  assert.deepEqual([r.replyTo, r.hops, r.group, r.input.reason, r.input.why], ["m-4", 0, "设置页改版", "mention", "asked"]);
  assert.deepEqual(r.input.lines.map((l) => `${l.mine ? "（你）" : ""}${l.who}：${l.text}`).slice(-3), ["（你）John：我看看", "李四：@John 周五前能给稿子反馈吗？", "张三：急，今天能看吗"]);
  const agentLine = { ...DM, blocks: [line("m-1", WANG, "@Lily 爸爸 周五能来吗", "2026-11-02T07:00:00Z", { by: "agent", hops: 1 })] };
  const c2 = callOf(agentLine, { name: "Lily 爸爸", auto: true });
  assert.equal(roundFor(agentLine, c2, { name: "Lily 爸爸", why: "auto", mark: false }).hops, 2);
  assert.match(roundPrompt(r.input), /他让你回这一轮/);
  assert.match(roundPrompt({ ...r.input, why: "auto" }), /这个聊天他设成了自动回/);
  assert.doesNotMatch(roundPrompt(r.input), /他不在时你先回/);
});
