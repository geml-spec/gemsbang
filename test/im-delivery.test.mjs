import { test } from "node:test";
import assert from "node:assert/strict";
import { deliver } from "../dist/core/im/delivery.js";
import { stamp } from "../dist/core/im/message.js";
import { DEFAULT_POLICY } from "../dist/core/im/venue.js";
import { hopsSystemText } from "../dist/core/im/sender.js";

const T0 = "2026-10-30T10:00:00Z";
const john = { kind: "person", id: "john" }, lisi = { kind: "person", id: "lisi" }, xp = { kind: "agent", name: "xiaoping", owner: "john" };
const relXp = { owner: "john", trusted: ["lisi"], members: ["john", "zhangsan", "lisi"] };
const relXc = { owner: "zhangsan", trusted: [], members: ["john", "zhangsan", "lisi"] };
const g = { id: "g-7", kind: "group", name: "前端周会", address: "https://r/john/venues/g-7.geml", people: ["john", "zhangsan", "lisi"], agents: ["小评", "小测"], policy: DEFAULT_POLICY, decisions: [] };
const agents = [{ name: "小评", speaker: "agent:xiaoping@john", relations: relXp }, { name: "小测", speaker: "agent:xiaoce@zhangsan", relations: relXc }];
const roster = [{ name: "小评", kind: "agent" }, { name: "小测", kind: "agent" }, { name: "张三", kind: "person" }, { name: "李四", kind: "person" }, { name: "空闲的", kind: "role" }];
const msg = (text, speaker, extra = {}) => stamp({ venue: "g-7", kind: "chat", text, ...extra }, { id: "m-1", speaker, at: T0, prev: null });
const input = { venue: g, agents, roster };
const nothing = { prompts: [], mentioned: [], notified: [], degraded: [], unresolved: [], system: [] };

test("in a group a leading @ is a prompt at the sender's level toward that agent; a mid-sentence @ mentions; people are notified (§6.4, §6.5)", () => {
  const d = deliver(msg("@小评 @小测 看看 @张三 的 PR，@李四 也知道一下", lisi), input);
  assert.deepEqual(d, { ...nothing, prompts: [{ agent: "小评", level: "trusted", hops: 0 }, { agent: "小测", level: "member", hops: 0 }], notified: ["张三", "李四"] });
  assert.deepEqual(deliver(msg("让 @小评 看过了", john), input), { ...nothing, mentioned: ["小评"] });
  assert.deepEqual(deliver(msg("今天没事", john), input), nothing);
});

test("a role resolves by the venue's rule and the prompt says which role it came through; unresolved is reported", () => {
  const d = deliver(msg("@空闲的 跑一下测试", john), { ...input, resolve: (r) => (r === "空闲的" ? "小测" : undefined) });
  assert.deepEqual(d.prompts, [{ agent: "小测", level: "member", hops: 0, via: "空闲的" }]);
  const u = deliver(msg("@空闲的 跑一下测试", john), input);
  assert.deepEqual(u, { ...nothing, unresolved: ["空闲的"] });
});

test("a DM and a guest DM need no @: every message from the other party is a prompt to the agent (§6.2, §6.4)", () => {
  const dm = { ...g, id: "d-1", kind: "dm", name: "小评", agents: ["小评"] };
  assert.deepEqual(deliver(msg("把测试跑一下", john, { venue: "d-1" }), { venue: dm, agents: [agents[0]], roster: [] }), { ...nothing, prompts: [{ agent: "小评", level: "owner", hops: 0 }] });
  const guest = { ...g, id: "v-1", kind: "guest-dm", name: "访客 a1b2", agents: ["小评"], host: "小评" };
  assert.deepEqual(deliver(msg("这个项目用什么框架？", { kind: "guest", id: "a1b2" }, { venue: "v-1" }), { venue: guest, agents: [agents[0]], roster: [] }), { ...nothing, prompts: [{ agent: "小评", level: "guest", hops: 0 }] });
  assert.deepEqual(deliver(msg("用 React。", xp, { venue: "v-1" }), { venue: guest, agents: [agents[0]], roster: [], handling: 0 }), nothing, "the agent's own answer prompts nobody");
  assert.deepEqual(deliver(msg("我来答", john, { venue: "v-1" }), { venue: guest, agents: [agents[0]], roster: [] }), nothing, "the owner cutting in speaks for themself, not to the agent");
});

test("agent to agent: a prompt only when the target's policy takes it, one hop past the one being handled, degraded past the limit (rule 2, §6.5, §7.4)", () => {
  assert.deepEqual(deliver(msg("@小测 你那边也跑一下", xp), { ...input, handling: 0 }).prompts, [{ agent: "小测", level: "member", hops: 1 }]);
  const far = deliver(msg("@小测 再跑", xp), { ...input, handling: 3 });
  assert.deepEqual(far, { ...nothing, degraded: [{ agent: "小测", reason: "超过 3 跳" }], system: [hopsSystemText("小测", 4, 3)] });
  const closed = deliver(msg("@小测 再跑", xp), { ...input, agents: [agents[0], { ...agents[1], policy: { promptFrom: "nobody", allow: [] } }], handling: 0 });
  assert.deepEqual(closed, { ...nothing, degraded: [{ agent: "小测", reason: "对方策略不收 agent 的指令，只当消息读到" }] });
  const listed = deliver(msg("@小测 再跑", xp), { ...input, agents: [agents[0], { ...agents[1], policy: { promptFrom: "allowlist", allow: ["agent:xiaoping@john"] } }], handling: 0 });
  assert.equal(listed.prompts.length, 1);
  const byOwner = deliver(msg("@小测 再跑", xp), { ...input, agents: [agents[0], { ...agents[1], policy: { promptFrom: "allowlist", allow: ["person:john"] } }], handling: 0 });
  assert.equal(byOwner.prompts.length, 1, "listing the owner lists their agents");
  const person = deliver(msg("@小测 跑", john), { ...input, agents: [agents[0], { ...agents[1], policy: { promptFrom: "nobody", allow: [] } }] });
  assert.equal(person.prompts.length, 1, "a person's @ is always a prompt (rule 2)");
  const venueWide = deliver(msg("@小测 再跑", xp), { ...input, venue: { ...g, policy: { ...DEFAULT_POLICY, promptFrom: "nobody" } }, handling: 0 });
  assert.equal(venueWide.prompts.length, 0, "the venue's policy stands when the agent has none of its own");
});

test("a system message, a signal and a reply in a thread without @ deliver nothing; a called agent not in the venue is degraded", () => {
  const sys = stamp({ venue: "g-7", kind: "system", text: "@小评 进入 #verify" }, { id: "m-s", speaker: { kind: "host" }, at: T0, prev: null });
  assert.deepEqual(deliver(sys, input), nothing);
  const signal = stamp({ venue: "c-1", kind: "signal", text: "@小评 买入" }, { id: "m-x", speaker: xp, at: T0, prev: null });
  assert.deepEqual(deliver(signal, { ...input, venue: { ...g, id: "c-1", kind: "channel", name: "小评的信号" } }), nothing);
  const t = { ...g, id: "t-1", kind: "thread", name: "回复：看看", anchor: "https://r/john/venues/g-7.geml#m-3", parent: "g-7" };
  assert.deepEqual(deliver(msg("同意", john, { venue: "t-1", thread: "m-3", replyTo: "m-3" }), { ...input, venue: t }), nothing);
  const away = deliver(msg("@小写 看看", john), { ...input, roster: [...roster, { name: "小写", kind: "agent" }] });
  assert.deepEqual(away, { ...nothing, degraded: [{ agent: "小写", reason: "不在这个场所" }] });
});
