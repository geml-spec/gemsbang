// The task card (§8): one card and one state machine for 派出 and 外包; the
// seven-line 委托书 a person reads; the acceptance criteria with their five
// kinds of verification (§8.3); the deliverable package (§8.6) and the
// acceptance report the delegator's agent writes after re-running the
// machine checks; the three walks (§8.4): relay, split, contest. Pure: the
// records, their faults, the transitions and who may take them, the words.
import type { Embed } from "./embed.js";
import { parseSpeaker, personBehind } from "./identity.js";
import type { Run, ToolScope } from "./sender.js";

export type Direction = "outsource" | "dispatch";
export const DIRECTION_WORDS: Readonly<Record<Direction, string>> = { outsource: "外包", dispatch: "派出" };

export type CardState = "draft" | "open" | "awaiting-grant" | "in-progress" | "delivered" | "verifying" | "changes" | "accepted" | "dispute" | "closed";
export const STATE_WORDS: Readonly<Record<CardState, string>> = { draft: "草拟", open: "发布", "awaiting-grant": "待放行", "in-progress": "进行中", delivered: "已交付", verifying: "验收中", changes: "要改", accepted: "已接受", dispute: "争议", closed: "关闭" };
/** The main path (§8.2): the seven states the progress bar draws; 要改, 争议 and 关闭 are branches beside the state they left. */
export const MAIN_PATH: readonly CardState[] = ["draft", "open", "awaiting-grant", "in-progress", "delivered", "verifying", "accepted"];
export const FINAL_STATES: readonly CardState[] = ["accepted", "closed"];

/** The verbs a host drives a card with (transport §4.1 im_card): the relay's, plus show and list. */
export const CARD_ACTIONS = ["new", "publish", "claim", "grant", "note", "giveback", "deliver", "report", "accept", "changes", "resume", "dispute", "settle", "close", "show", "list"] as const;
export type CardAction = (typeof CARD_ACTIONS)[number];
export const isCardAction = (v: unknown): v is CardAction => typeof v === "string" && (CARD_ACTIONS as readonly string[]).includes(v);

export type VerifyKind = "command" | "file" | "repo" | "review" | "human";
export const VERIFY_WORDS: Readonly<Record<VerifyKind, string>> = { command: "命令", file: "文件", repo: "仓库", review: "审读", human: "人勾" };
/** The three the delegator's agent re-runs in its own sandbox (§8.3); the other two wait for a person. */
export const MACHINE: readonly VerifyKind[] = ["command", "file", "repo"];
export interface Verify { kind: VerifyKind; run?: string; glob?: string; pr?: string; rubric?: string }
export interface Criterion { n: number; text: string; verify: Verify }

export type VenueOfWork = "worker-sandbox" | "resource-sandbox";
export const WORK_WORDS: Readonly<Record<VenueOfWork, string>> = { "worker-sandbox": "接单方沙箱", "resource-sandbox": "资源方沙箱" };
export interface Budget { credits?: number; hours?: number; deadline?: string; hops?: number }
export type Mode = { kind: "single" } | { kind: "contest"; slots: number } | { kind: "splittable" };
export type Reward = { kind: "none" } | { kind: "tip" } | { kind: "escrow"; credits: number } | { kind: "prize"; credits: number; participation?: number };

/** The tools a card lets the worker use, by key; their words as the 委托书 shows them. */
export type ToolKey = "read" | "edit" | "test" | "run" | "comment" | "view" | "deploy";
export const TOOL_WORDS: Readonly<Record<ToolKey, string>> = { read: "读", edit: "改", test: "测", run: "跑", comment: "评论", view: "看图", deploy: "部署" };
const TOOL_KEYS = Object.keys(TOOL_WORDS) as ToolKey[];

/** What the delegator writes (§8.1); the relay adds the rest. */
export interface CardInput {
  title: string;
  goal: string;
  constraints?: string;
  inputs?: string;
  /** The context pack (§8.1): addresses to include, and the words of what is excluded. */
  context: { includes: string[]; excludes: string[] };
  accepts: Criterion[];
  direction: Direction;
  /** The person whose grant 待放行 waits on: 派出, the resource owner opening their thing; 外包, the delegator opening their inputs. None: the pack is self-contained. */
  grantFrom?: string;
  /** The worker named in advance, as a speaker (派出: the delegator's own agent); none: whoever claims. */
  worker?: string;
  venueOfWork: VenueOfWork;
  tools: ToolKey[];
  network: boolean;
  budget: Budget;
  mode: Mode;
  reward: Reward;
  /** The parent card's address, for a split. */
  parent?: string;
}

export type SlotState = "claimed" | "working" | "delivered" | "returned" | "accepted" | "closed";
export interface Slot { n: number; agent: string; by: string; at: string; state: SlotState }
export interface Transition { to: CardState; by: string; at: string; note?: string; slot?: number }
export interface Note { n: number; by: string; at: string; text: string; evidence: Embed[] }
export type PartType = "repo" | "file" | "media" | "doc";
export interface DeliverablePart { type: PartType; url?: string; branch?: string; commit?: string; name?: string; sha256?: string; size?: number; seconds?: number }
export interface Evidence { claim: string; source: "tool" | "file" | "git" | "human"; command?: string; exit?: number; path?: string; rev?: number }
export interface AcceptsMap { criterion: number; met: boolean | null; evidence?: number; note?: string }
/** A deliverable version (§8.6): immutable, hashed by the worker's host; six parts. */
export interface Deliverable {
  version: number;
  /** The version this one follows; `prev` itself is the chain's. */
  prevVersion?: number;
  by: string;
  at: string;
  sha256: string;
  kind: "code" | "app" | "video" | "doc";
  parts: DeliverablePart[];
  usage: string;
  madeBy: { model?: string; skills?: string[]; turns?: number; journal?: string };
  evidence: Evidence[];
  accepts: AcceptsMap[];
  changes?: string[];
  rights: { owner: string; thirdParty?: string; aiGenerated: boolean };
  /** 半成品 (§8.6): a relay's input, never accepted as the end. */
  halfDone: boolean;
}
export interface ReportResult { criterion: number; met: boolean | null; note?: string }
/** The delegator's agent's acceptance report: each criterion re-run in its own sandbox, the review's opinion, the human's left null. */
export interface Report { version: number; by: string; at: string; results: ReportResult[] }
export interface Comment { n: number; by: string; at: string; version: number; anchor: string; text: string; replyTo?: string }

export interface Card extends CardInput {
  kind: "task";
  id: string;
  /** The delegator, as a speaker. */
  by: string;
  at: string;
  /** Where it was published (`owner/id`), and the thread anchored on it. */
  venue?: string;
  thread?: string;
  state: CardState;
  transitions: Transition[];
  slots: Slot[];
  notes: Note[];
  versions: Deliverable[];
  reports: Report[];
  comments: Comment[];
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const obj = (v: unknown): Record<string, unknown> | undefined => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()) : []);
const DIRECTIONS = new Set<string>(Object.keys(DIRECTION_WORDS));
const WORKS = new Set<string>(Object.keys(WORK_WORDS));
const VERIFIES = new Set<string>(Object.keys(VERIFY_WORDS));
const AGENT_RE = /^agent:[^@\s]+@[^\s@]+$/;
const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,63}$/u;

/** A tool by its key or its word; undefined for a word the card does not know. */
const toolKeyOf = (v: string): ToolKey | undefined => TOOL_KEYS.find((k) => k === v || TOOL_WORDS[k] === v);
export const toolWords = (tools: readonly ToolKey[]): string => tools.map((k) => TOOL_WORDS[k]).join(" · ");

function verifyFaults(i: number, v: unknown): string[] {
  const o = obj(v);
  const kind = o === undefined ? undefined : str(o["kind"]);
  if (kind === undefined || !VERIFIES.has(kind)) return [`第 ${i} 条验法不合法`];
  if (kind === "command" && (str(o!["run"]) ?? "") === "") return [`第 ${i} 条命令验法要有 run`];
  if (kind === "file" && (str(o!["glob"]) ?? "") === "") return [`第 ${i} 条文件验法要有 glob`];
  if (kind === "review" && (str(o!["rubric"]) ?? "") === "") return [`第 ${i} 条审读验法要有 rubric`];
  return [];
}

/** The faults in what a client sent (§8.1), as a person reads them; none means `cardInput` gives the record. */
export function cardFaults(v: unknown): string[] {
  const o = obj(v);
  if (o === undefined) return ["要一个 JSON 对象"];
  const out: string[] = [];
  if ((str(o["title"])?.trim() ?? "") === "") out.push("缺标题");
  if ((str(o["goal"])?.trim() ?? "") === "") out.push("缺目标（去办什么）");
  const direction = str(o["direction"]);
  if (direction === undefined || !DIRECTIONS.has(direction)) out.push("方向是 outsource 或 dispatch");
  const work = str(o["venueOfWork"]);
  if (work === undefined || !WORKS.has(work)) out.push("执行场地是 worker-sandbox 或 resource-sandbox");
  const accepts = Array.isArray(o["accepts"]) ? o["accepts"] : [];
  if (accepts.length === 0) out.push("验收标准至少一条");
  accepts.forEach((a, i) => {
    const c = obj(a);
    if ((c === undefined ? "" : str(c["text"])?.trim() ?? "") === "") out.push(`第 ${i + 1} 条验收标准没有文字`);
    out.push(...verifyFaults(i + 1, c?.["verify"]));
  });
  const mode = obj(o["mode"]);
  const modeKind = mode === undefined ? "single" : str(mode["kind"]);
  if (modeKind !== "single" && modeKind !== "contest" && modeKind !== "splittable") out.push("模式是 single、contest 或 splittable");
  if (modeKind === "contest") {
    const slots = num(mode?.["slots"]);
    if (slots === undefined || !Number.isInteger(slots) || slots < 2) out.push("竞赛至少两个槽");
    if (!accepts.every((a) => MACHINE.includes((str(obj(a)?.["verify"] !== undefined ? obj(obj(a)!["verify"])?.["kind"] : undefined) ?? "") as VerifyKind))) out.push("竞赛只对验收标准全是机器验法的卡开放");
  }
  const reward = obj(o["reward"]);
  const rewardKind = reward === undefined ? "none" : str(reward["kind"]);
  if (rewardKind !== "none" && rewardKind !== "tip" && rewardKind !== "escrow" && rewardKind !== "prize") out.push("报酬是 none、tip、escrow 或 prize");
  else if ((rewardKind === "escrow" || rewardKind === "prize") && num(reward?.["credits"]) === undefined) out.push(rewardKind === "escrow" ? "托管要有积分数" : "奖金要有积分数");
  const budget = obj(o["budget"]) ?? {};
  for (const [k, word] of [["credits", "积分"], ["hours", "小时"], ["hops", "跳数"]] as const) { const x = budget[k]; if (x !== undefined && (num(x) === undefined || (num(x) as number) < 0)) out.push(`${word}要是非负数`); }
  const worker = o["worker"];
  if (worker !== undefined && (str(worker) === undefined || !AGENT_RE.test(worker as string))) out.push("接单方要写成 agent:<名>@<主人>");
  const grantFrom = o["grantFrom"];
  if (grantFrom !== undefined && (str(grantFrom) === undefined || !NAME_RE.test(grantFrom as string))) out.push("放行人的名字不合法");
  if (o["tools"] !== undefined && !Array.isArray(o["tools"])) out.push("工具要是数组");
  return out;
}

/** The record from a body `cardFaults` passed: trimmed, the criteria numbered in order, the tools by key (a word the card does not know is dropped), defaults filled. */
export function cardInput(v: unknown): CardInput | undefined {
  if (cardFaults(v).length > 0) return undefined;
  const o = obj(v)!;
  const ctx = obj(o["context"]) ?? {};
  const mode = obj(o["mode"]), reward = obj(o["reward"]), budget = obj(o["budget"]) ?? {};
  const input: CardInput = {
    title: str(o["title"])!.trim(), goal: str(o["goal"])!.trim(),
    context: { includes: strings(ctx["includes"]), excludes: strings(ctx["excludes"]) },
    accepts: (o["accepts"] as unknown[]).map((a, i): Criterion => {
      const c = obj(a)!, ver = obj(c["verify"])!;
      const verify: Verify = { kind: str(ver["kind"]) as VerifyKind };
      for (const k of ["run", "glob", "pr", "rubric"] as const) { const s = str(ver[k])?.trim(); if (s !== undefined && s !== "") verify[k] = s; }
      return { n: i + 1, text: str(c["text"])!.trim(), verify };
    }),
    direction: str(o["direction"]) as Direction,
    venueOfWork: str(o["venueOfWork"]) as VenueOfWork,
    tools: [...new Set(strings(o["tools"]).map(toolKeyOf).filter((k): k is ToolKey => k !== undefined))],
    network: o["network"] === true,
    budget: {},
    mode: mode === undefined || mode["kind"] === "single" ? { kind: "single" } : mode["kind"] === "contest" ? { kind: "contest", slots: num(mode["slots"]) as number } : { kind: "splittable" },
    reward: reward === undefined || reward["kind"] === "none" ? { kind: "none" } : reward["kind"] === "tip" ? { kind: "tip" } : reward["kind"] === "escrow" ? { kind: "escrow", credits: num(reward["credits"]) as number } : { kind: "prize", credits: num(reward["credits"]) as number, ...(num(reward["participation"]) !== undefined ? { participation: num(reward["participation"]) as number } : {}) },
  };
  for (const k of ["constraints", "inputs", "grantFrom", "worker", "parent"] as const) { const s = str(o[k])?.trim(); if (s !== undefined && s !== "") input[k] = s; }
  for (const k of ["credits", "hours", "hops"] as const) { const x = num(budget[k]); if (x !== undefined) input.budget[k] = x; }
  const deadline = str(budget["deadline"]); if (deadline !== undefined) input.budget.deadline = deadline;
  return input;
}

const embeds = (v: unknown): Embed[] => (Array.isArray(v) ? v.map(obj).filter((e): e is Record<string, unknown> => e !== undefined && typeof e["src"] === "string").map((e) => { const out: Embed = { src: e["src"] as string }; const rev = num(e["rev"]); if (rev !== undefined) out.rev = rev; const hash = str(e["hash"]); if (hash !== undefined) out.hash = hash; return out; }) : []);

function deliverableOf(v: Record<string, unknown>): Deliverable {
  const madeBy = obj(v["madeBy"]) ?? {}, rights = obj(v["rights"]) ?? {};
  const d: Deliverable = {
    version: num(v["version"]) ?? 1, by: str(v["by"]) ?? "", at: str(v["at"]) ?? "", sha256: str(v["sha256"]) ?? "",
    kind: (["code", "app", "video", "doc"] as const).find((k) => k === v["kind"]) ?? "code",
    parts: (Array.isArray(v["parts"]) ? v["parts"] : []).map(obj).filter((p): p is Record<string, unknown> => p !== undefined).map((p) => ({ type: ((["repo", "file", "media", "doc"] as const).find((k) => k === p["type"]) ?? "file"), ...Object.fromEntries(["url", "branch", "commit", "name", "sha256"].filter((k) => str(p[k]) !== undefined).map((k) => [k, p[k]])), ...Object.fromEntries(["size", "seconds"].filter((k) => num(p[k]) !== undefined).map((k) => [k, p[k]])) }) as DeliverablePart),
    usage: str(v["usage"]) ?? "",
    madeBy: { ...(str(madeBy["model"]) !== undefined ? { model: madeBy["model"] as string } : {}), ...(Array.isArray(madeBy["skills"]) ? { skills: strings(madeBy["skills"]) } : {}), ...(num(madeBy["turns"]) !== undefined ? { turns: madeBy["turns"] as number } : {}), ...(str(madeBy["journal"]) !== undefined ? { journal: madeBy["journal"] as string } : {}) },
    evidence: (Array.isArray(v["evidence"]) ? v["evidence"] : []).map(obj).filter((e): e is Record<string, unknown> => e !== undefined).map((e) => ({ claim: str(e["claim"]) ?? "", source: ((["tool", "file", "git", "human"] as const).find((k) => k === e["source"]) ?? "tool"), ...(str(e["command"]) !== undefined ? { command: e["command"] as string } : {}), ...(num(e["exit"]) !== undefined ? { exit: e["exit"] as number } : {}), ...(str(e["path"]) !== undefined ? { path: e["path"] as string } : {}), ...(num(e["rev"]) !== undefined ? { rev: e["rev"] as number } : {}) })),
    accepts: (Array.isArray(v["accepts"]) ? v["accepts"] : []).map(obj).filter((a): a is Record<string, unknown> => a !== undefined && num(a["criterion"]) !== undefined).map((a) => ({ criterion: a["criterion"] as number, met: a["met"] === true ? true : a["met"] === false ? false : null, ...(num(a["evidence"]) !== undefined ? { evidence: a["evidence"] as number } : {}), ...(str(a["note"]) !== undefined ? { note: a["note"] as string } : {}) })),
    rights: { owner: str(rights["owner"]) ?? "委托方", aiGenerated: rights["aiGenerated"] === true, ...(str(rights["thirdParty"]) !== undefined ? { thirdParty: rights["thirdParty"] as string } : {}) },
    halfDone: v["halfDone"] === true,
  };
  const prevVersion = num(v["prevVersion"]); if (prevVersion !== undefined) d.prevVersion = prevVersion;
  if (Array.isArray(v["changes"])) d.changes = strings(v["changes"]);
  return d;
}

/** The faults in a deliverable a worker sends (§8.6): the parts, the usage, the rights; the relay stamps the rest. */
export function deliverableFaults(v: unknown): string[] {
  const o = obj(v);
  if (o === undefined) return ["要一个 JSON 对象"];
  const out: string[] = [];
  if (!["code", "app", "video", "doc"].includes(str(o["kind"]) ?? "")) out.push("交付物种类是 code、app、video 或 doc");
  if (!Array.isArray(o["parts"]) || o["parts"].length === 0) out.push("交付物至少一个部分（仓库、文件、媒体或文档）");
  if ((str(o["sha256"]) ?? "") === "") out.push("交付物要有哈希");
  if ((str(o["usage"])?.trim() ?? "") === "") out.push("交付物要有用法");
  return out;
}

const ACTIVE: readonly SlotState[] = ["claimed", "working", "delivered"];

/** A card folded from its document's blocks: the `card` block of kind task, then the transitions, claims, notes, versions, reports and comments in order; undefined when the first block is no task card. */
export function foldCard(id: string, blocks: readonly { id: string; value: Record<string, unknown> }[]): Card | undefined {
  const head = blocks.find((b) => b.id === "card")?.value;
  if (head === undefined || head["kind"] !== "task") return undefined;
  const input = cardInput(head);
  if (input === undefined) return undefined;
  const card: Card = { kind: "task", id, by: str(head["by"]) ?? "", at: str(head["at"]) ?? "", state: "draft", transitions: [], slots: [], notes: [], versions: [], reports: [], comments: [], ...input };
  for (const b of blocks) {
    const v = b.value;
    let m: RegExpExecArray | null;
    if (b.id === "card") continue;
    if (/^state-\d+$/.test(b.id)) {
      const to = str(v["to"]) as CardState | undefined;
      if (to === undefined || !(to in STATE_WORDS)) continue;
      const t: Transition = { to, by: str(v["by"]) ?? "", at: str(v["at"]) ?? "" };
      const note = str(v["note"]); if (note !== undefined) t.note = note;
      const slot = num(v["slot"]); if (slot !== undefined) t.slot = slot;
      const venue = str(v["venue"]); if (venue !== undefined) card.venue = venue;
      const thread = str(v["thread"]); if (thread !== undefined) card.thread = thread;
      card.transitions.push(t);
      card.state = to;
      const mine = slot === undefined ? undefined : card.slots.find((s) => s.n === slot);
      if (mine !== undefined) {
        if (to === "in-progress") mine.state = "working";
        else if (to === "delivered") mine.state = "delivered";
        else if (to === "open") mine.state = "returned";
        else if (to === "awaiting-grant") mine.state = "claimed";
      }
      if (to === "accepted") for (const s of card.slots) s.state = s.n === slot ? "accepted" : ACTIVE.includes(s.state) ? "closed" : s.state;
      if (to === "closed") for (const s of card.slots) if (ACTIVE.includes(s.state)) s.state = "closed";
    } else if ((m = /^claim-(\d+)$/.exec(b.id)) !== null) {
      card.slots.push({ n: Number(m[1]), agent: str(v["agent"]) ?? "", by: str(v["by"]) ?? "", at: str(v["at"]) ?? "", state: "claimed" });
    } else if ((m = /^note-(\d+)$/.exec(b.id)) !== null) {
      card.notes.push({ n: Number(m[1]), by: str(v["by"]) ?? "", at: str(v["at"]) ?? "", text: str(v["text"]) ?? "", evidence: embeds(v["evidence"]) });
    } else if (/^deliverable-\d+$/.test(b.id)) {
      card.versions.push(deliverableOf(v));
    } else if (/^report-\d+$/.test(b.id)) {
      card.reports.push({ version: num(v["version"]) ?? 0, by: str(v["by"]) ?? "", at: str(v["at"]) ?? "", results: (Array.isArray(v["results"]) ? v["results"] : []).map(obj).filter((r): r is Record<string, unknown> => r !== undefined && num(r["criterion"]) !== undefined).map((r) => ({ criterion: r["criterion"] as number, met: r["met"] === true ? true : r["met"] === false ? false : null, ...(str(r["note"]) !== undefined ? { note: r["note"] as string } : {}) })) });
    } else if ((m = /^comment-(\d+)$/.exec(b.id)) !== null) {
      const c: Comment = { n: Number(m[1]), by: str(v["by"]) ?? "", at: str(v["at"]) ?? "", version: num(v["version"]) ?? 0, anchor: str(v["anchor"]) ?? "", text: str(v["text"]) ?? "" };
      const replyTo = str(v["replyTo"]); if (replyTo !== undefined) c.replyTo = replyTo;
      card.comments.push(c);
    }
  }
  return card;
}

// --- who may move it where (§8.2) ---

export type Role = "delegator" | "worker" | "granter" | "host";
const ROLE_WORDS: Readonly<Record<Role, string>> = { delegator: "委托人", worker: "接单方", granter: "放行人", host: "宿主" };
export interface Actor { person?: string; agent?: string; host?: boolean }

/** The roles a caller has on the card: the delegator by their person; a worker by their agent or as the owner of one on an active slot; the granter; the host. */
export function rolesOf(card: Card, by: Actor): Set<Role> {
  const out = new Set<Role>();
  const delegator = personBehind(parseSpeaker(card.by) ?? { kind: "host" });
  if (by.person !== undefined && by.person === delegator) out.add("delegator");
  const active = card.slots.filter((s) => ACTIVE.includes(s.state));
  if (active.some((s) => s.agent === by.agent || (by.person !== undefined && personBehind(parseSpeaker(s.agent) ?? { kind: "host" }) === by.person))) out.add("worker");
  if (by.person !== undefined && by.person === card.grantFrom) out.add("granter");
  if (by.host === true) out.add("host");
  return out;
}

/** The transition table (§8.2): from, to, who may. The host is the relay acting on a rule (a claim, 已交付 → 验收中, a timeout, the policy's auto-accept). */
export const MOVES: ReadonlyArray<{ from: CardState; to: CardState; who: readonly Role[] }> = [
  { from: "draft", to: "open", who: ["delegator"] },
  { from: "draft", to: "closed", who: ["delegator"] },
  { from: "open", to: "awaiting-grant", who: ["worker", "host"] },
  { from: "open", to: "in-progress", who: ["worker", "host"] },
  { from: "open", to: "closed", who: ["delegator", "host"] },
  { from: "awaiting-grant", to: "in-progress", who: ["granter", "host"] },
  { from: "awaiting-grant", to: "closed", who: ["delegator", "host"] },
  { from: "in-progress", to: "delivered", who: ["worker"] },
  { from: "in-progress", to: "open", who: ["worker", "delegator", "host"] },
  { from: "in-progress", to: "closed", who: ["delegator"] },
  { from: "delivered", to: "verifying", who: ["host"] },
  { from: "delivered", to: "dispute", who: ["delegator", "worker"] },
  { from: "verifying", to: "accepted", who: ["delegator", "host"] },
  { from: "verifying", to: "changes", who: ["delegator", "host"] },
  { from: "verifying", to: "dispute", who: ["delegator", "worker"] },
  { from: "changes", to: "in-progress", who: ["worker"] },
  { from: "changes", to: "dispute", who: ["delegator", "worker"] },
  { from: "changes", to: "closed", who: ["delegator"] },
  { from: "dispute", to: "accepted", who: ["delegator", "host"] },
  { from: "dispute", to: "closed", who: ["delegator", "worker", "host"] },
];

/** Why the caller may not move the card there; undefined when they may. */
export function moveFault(card: Card, to: CardState, by: Actor): string | undefined {
  const move = MOVES.find((m) => m.from === card.state && m.to === to);
  if (move === undefined) return `卡不能从${STATE_WORDS[card.state]}直接到${STATE_WORDS[to]}`;
  const roles = rolesOf(card, by);
  if (move.who.some((r) => roles.has(r))) return undefined;
  return `只有${move.who.filter((r) => r !== "host").map((r) => ROLE_WORDS[r]).join("或")}能把卡从${STATE_WORDS[card.state]}移到${STATE_WORDS[to]}`;
}

/** Whom the card waits on now, as a name: the granter, the delegator, the working agent; nothing when it waits on nobody in particular. */
export function waitingOn(card: Card): string | undefined {
  const agentName = (s: string): string => parseSpeaker(s)?.kind === "agent" ? (parseSpeaker(s) as { name: string }).name : s;
  const working = card.slots.find((s) => s.state === "working" || s.state === "claimed");
  switch (card.state) {
    case "awaiting-grant": return card.grantFrom;
    case "in-progress": case "changes": return working === undefined ? undefined : agentName(working.agent);
    case "delivered": case "verifying": return personBehind(parseSpeaker(card.by) ?? { kind: "host" });
    case "open": return card.worker === undefined ? undefined : agentName(card.worker);
    default: return undefined;
  }
}

// --- the words ---

/** A criterion's tag: its verification and the parameter (命令 · npm test; 文件 · out/*.pdf; 审读 · ui-rubric; 人勾). */
export function acceptTag(c: Criterion): string {
  const p = c.verify.run ?? c.verify.glob ?? c.verify.pr ?? c.verify.rubric;
  return `${VERIFY_WORDS[c.verify.kind]}${p === undefined ? "" : ` · ${p}`}`;
}

/** The limits in one line: 20 积分 · 2 小时 · 跳数 1; 无 when none. */
export function budgetWords(b: Budget): string {
  const parts = [...(b.credits !== undefined ? [`${b.credits} 积分`] : []), ...(b.hours !== undefined ? [`${b.hours} 小时`] : []), ...(b.deadline !== undefined ? [`截止 ${b.deadline}`] : []), ...(b.hops !== undefined ? [`跳数 ${b.hops}`] : [])];
  return parts.length === 0 ? "无" : parts.join(" · ");
}

/** The 委托书 (§8.1): the seven lines a person reads before it goes. */
export function briefLines(card: CardInput): { label: string; text: string }[] {
  const goal = [card.goal, ...(card.constraints !== undefined ? [card.constraints] : []), ...(card.inputs !== undefined ? [card.inputs] : [])].join("；");
  const where = card.venueOfWork === "resource-sandbox" ? "资源方沙箱 · 只读、跑、评 · 产出只有 patch、PR、评论" : `接单方沙箱 · ${toolWords(card.tools)} · ${card.network ? "可联网" : "不联网"}`;
  const grant = card.grantFrom === undefined ? "不需要放行" : `${card.grantFrom} 放开自己的${card.direction === "dispatch" ? "实物" : "输入"}`;
  return [
    { label: "去办", text: goal },
    { label: "验收", text: card.accepts.map((c) => `${c.n} ${c.text} · ${acceptTag(c)}`).join("；") },
    { label: "带去", text: `${card.context.includes.join(" · ")}${card.context.excludes.length > 0 ? `${card.context.includes.length > 0 ? " · " : ""}排除：${card.context.excludes.join("、")}` : ""}` },
    { label: "在哪干", text: where },
    { label: "工具", text: toolWords(card.tools) },
    { label: "上限", text: budgetWords(card.budget) },
    { label: "要谁放行", text: grant },
  ];
}
export const briefText = (card: CardInput): string => briefLines(card).map((l) => `${l.label}：${l.text}`).join("\n");

/** The sentence under 验收: which criteria the delegator's agent re-runs, which wait for a person. */
export function rerunNote(card: Pick<Card, "accepts">): string {
  const groups: { ns: number[]; text: (ns: string) => string }[] = [
    { ns: card.accepts.filter((c) => MACHINE.includes(c.verify.kind)).map((c) => c.n), text: (ns) => `第 ${ns} 条由委托人的 agent 在沙箱里重跑` },
    { ns: card.accepts.filter((c) => c.verify.kind === "review").map((c) => c.n), text: (ns) => `第 ${ns} 条审读完进「验收」等人勾` },
    { ns: card.accepts.filter((c) => c.verify.kind === "human").map((c) => c.n), text: (ns) => `第 ${ns} 条等人勾` },
  ];
  return groups.filter((g) => g.ns.length > 0).sort((a, b) => a.ns[0]! - b.ns[0]!).map((g) => g.text(g.ns.join("、"))).join("；");
}

export interface Progress { path: { state: CardState; word: string; current: boolean }[]; branch?: { state: CardState; word: string; beside: CardState } }

/** The progress bar (§8.2): the main path with the current state marked; a branch state stands beside the main state it left. */
export function progress(card: Card): Progress {
  const onPath = MAIN_PATH.includes(card.state);
  const beside = onPath ? card.state : [...card.transitions].reverse().find((t) => MAIN_PATH.includes(t.to))?.to ?? "draft";
  const out: Progress = { path: MAIN_PATH.map((s) => ({ state: s, word: STATE_WORDS[s], current: s === beside })) };
  if (!onPath) out.branch = { state: card.state, word: STATE_WORDS[card.state], beside };
  return out;
}
export function progressLine(card: Card): string {
  const p = progress(card);
  return `${p.path.map((s) => (s.current ? `[${s.word}]` : s.word)).join(" · ")}${p.branch === undefined ? "" : ` （${p.branch.word}）`}`;
}

/** The tool's line for a move (transport §4.1): `#t-57 · 发布 → 待放行 · 李四`. */
export const cardLine = (card: Pick<Card, "id" | "state">, from: CardState, who?: string): string => `#${card.id} · ${STATE_WORDS[from]} → ${STATE_WORDS[card.state]}${who === undefined ? "" : ` · ${who}`}`;

// --- acceptance (§8.3) ---

/** What the report decides: a machine check failed is 要改; every check machine and passed is 已接受 when the policy allows; anything waiting on a person goes to the delegator's inbox. */
export function acceptance(card: Pick<Card, "accepts">, report: Report, o: { autoAccept: boolean }): "accepted" | "changes" | "inbox" {
  const byN = new Map(report.results.map((r) => [r.criterion, r]));
  const machine = card.accepts.filter((c) => MACHINE.includes(c.verify.kind));
  if (machine.some((c) => byN.get(c.n)?.met === false)) return "changes";
  if (card.accepts.length === machine.length && machine.every((c) => byN.get(c.n)?.met === true) && o.autoAccept) return "accepted";
  return "inbox";
}

// --- the walks (§8.4) ---

export const slotsOf = (card: Pick<Card, "mode">): number => (card.mode.kind === "contest" ? card.mode.slots : 1);
export const openSlots = (card: Pick<Card, "mode" | "slots">): number => slotsOf(card) - card.slots.filter((s) => ACTIVE.includes(s.state)).length;
export const SPLIT_DEPTH = 2;

/** Why a split may not happen: the depth, the budgets' sum. */
export function splitFault(parent: Pick<Card, "budget">, children: readonly { budget: Budget }[], depth: number): string | undefined {
  if (depth >= SPLIT_DEPTH) return "拆分最多两层";
  const sum = children.reduce((n, c) => n + (c.budget.credits ?? 0), 0);
  if (parent.budget.credits !== undefined && sum > parent.budget.credits) return `子卡的预算总和 ${sum} 超过父卡的 ${parent.budget.credits}`;
  return undefined;
}

/** The scope a card gives the worker's turn (§7.2, §7.5): writes where the tools say 改 or 部署; a run in the sandbox where they say 测 or 跑 (a resource sandbox always allows a run: 只读、跑、评); the budget the card's credits. */
export function scopeOfCard(card: Pick<Card, "tools" | "venueOfWork" | "budget">): ToolScope {
  const write = card.tools.includes("edit") || card.tools.includes("deploy");
  const run: Run = card.venueOfWork === "resource-sandbox" || card.tools.includes("test") || card.tools.includes("run") ? "sandbox" : "none";
  return { write, run, budget: card.budget.credits ?? null };
}

/** Whether an in-progress card has gone silent: no note (nor transition) within the time. */
export function isStale(card: Card, now: string, stuckAfterMs: number): boolean {
  if (card.state !== "in-progress") return false;
  const last = card.notes[card.notes.length - 1]?.at ?? card.transitions[card.transitions.length - 1]?.at ?? card.at;
  return Date.parse(now) - Date.parse(last) > stuckAfterMs;
}

/** 心跳: how long since the last note. */
export function heartbeatWords(card: Pick<Card, "notes">, now: string): string {
  const last = card.notes[card.notes.length - 1];
  if (last === undefined) return "还没写记录";
  return `${Math.max(0, Math.floor((Date.parse(now) - Date.parse(last.at)) / 60_000))} 分钟前写了记录`;
}
