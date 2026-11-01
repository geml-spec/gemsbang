// The IM as the Claude Code shell draws it (transport §4): the five tools
// the model speaks through, the scope laid over a turn a queue item started
// (rule 5, §7.2), the band's 「需要我」 row (§6.9), the board header's line
// (§6.10), and the 「消息」 page's rows (§6.2, §6.5, rule 6). Pure and
// Node-free: the bridge brings the data (daemon/view.ts), the hooks module
// lays the rows out with the kinds it already draws and runs the presses.
import { CLAUDE_CODE_TOOLS } from "../../core/host-tools.js";
import { bandRow, sortNeeds, WRITE_IN, type Need } from "../../core/im/needs-me.js";
import { CARD_ACTIONS, type CardAction } from "../../core/im/card.js";
import { quietLine } from "../../core/im/needs-me.js";
import { PRESENCE_WORDS } from "../../core/im/presence.js";
import type { QueueItem } from "../../core/im/queue.js";
import { decide, LEVEL_WORDS, scopeWords, type ToolClass, type ToolScope } from "../../core/im/sender.js";
import type { CardRow, ImStatus, Thread } from "../../daemon/view.js";
import type { Pressable } from "./actions.js";
import { truncate, wrapCells, type Tone } from "./band.js";
import type { BoardRow, Icon } from "./board.js";
import type { T } from "./text.js";
import { hhmm } from "./time.js";

export const IM_TOOL_NAMES = ["im_say", "im_ask", "im_report", "im_read", "im_forward", "im_card", "im_signal"] as const;
export type ImToolName = (typeof IM_TOOL_NAMES)[number];
export interface ImToolSpec { name: ImToolName; description: string; inputSchema: Record<string, unknown> }

const VENUE = { type: "string", description: "The venue as `<owner>/<id>` (the 消息 page lists them; im_read with no arguments lists them too)." };
const EMBEDS = { type: "array", items: { type: "object", properties: { src: { type: "string", description: "A block's address on the relay, https://<relay>/<owner>/<doc>.geml#<block>." }, rev: { type: "number" }, hash: { type: "string" } }, required: ["src"], additionalProperties: false } };

/** The six tools (transport §4.1). Each signs as the session's agent, im_card as the owner when told. */
export const IM_TOOLS: readonly ImToolSpec[] = [
  { name: "im_say", description: "Say something in a venue as this session's agent: a chat message, pushed by the daemon when it can. Only words; a report with evidence is im_report, a question for a person is im_ask.", inputSchema: { type: "object", properties: { venue: VENUE, text: { type: "string" }, parts: { ...EMBEDS, description: "Things to attach by reference (rule 10), never copied." }, replyTo: { type: "string", description: "The message answered, by its block id." } }, required: ["venue", "text"], additionalProperties: false } },
  { name: "im_ask", description: "Ask a person (or a role) something in a venue, as a question card with options; the answer comes back as a message replying to it, and reaches you as a prompt when it names you. 自己写 is added to the options.", inputSchema: { type: "object", properties: { venue: VENUE, question: { type: "string" }, options: { type: "array", items: { type: "string" } }, who: { type: "string", description: "person:<id>, or a role." }, expires: { type: "string", description: "ISO time; after it the question is dropped." } }, required: ["venue", "question", "options", "who"], additionalProperties: false } },
  { name: "im_report", description: "Report into a venue with evidence: embeds of what the host observed (test results, journal revisions, commits) drawn as 已核实, and your opinion apart from them. The text says what was done.", inputSchema: { type: "object", properties: { venue: VENUE, text: { type: "string" }, evidence: { ...EMBEDS, description: "Addresses of the facts: journal revisions, a message, a block." }, opinion: { type: "string" }, turn: { type: "string", description: "The session turn to link back to (the owner alone can open it)." } }, required: ["venue", "text"], additionalProperties: false } },
  { name: "im_read", description: "Read what a venue said lately, or one block by its address (rule 3: what is not in your prompt you read on demand). With no arguments, the venues you are in.", inputSchema: { type: "object", properties: { venue: VENUE, src: { type: "string", description: "A block's address." }, limit: { type: "number", description: "How many recent messages (default 12)." } }, additionalProperties: false } },
  { name: "im_forward", description: "Forward a message or a block into another venue by reference (rule 10): the receivers see it by their own permission, a stub otherwise.", inputSchema: { type: "object", properties: { from: { type: "string", description: "The block's address, or `<owner>/<venue>#<message>`." }, to: VENUE, note: { type: "string", description: "A line of your own with it." } }, required: ["from", "to"], additionalProperties: false } },
  { name: "im_card", description: "A task card (§8). action: new (draft one from the fields: title, goal, accepts [{text, verify:{kind: command|file|repo|review|human, run|glob|pr|rubric}}], direction outsource|dispatch, venueOfWork worker-sandbox|resource-sandbox, tools, budget, context {includes, excludes}, grantFrom, worker, mode, reward), publish {venue}, claim, grant, note {text, evidence} (your record on the card: the heartbeat), giveback {note, deliverable}, deliver (a version: kind, sha256, parts, usage, madeBy, evidence, accepts, rights), report {results:[{criterion, met, note}], comments} (the acceptance report after re-running the machine checks in your sandbox), accept, changes {comments}, resume, dispute {reason}, settle {outcome}, close {reason}, show, list. The answer is one line: the card's move.", inputSchema: { type: "object", properties: { action: { type: "string", enum: [...CARD_ACTIONS] }, card: { type: "string", description: "`<owner>/<id>`; not for new and list." }, body: { type: "object", description: "The verb's fields.", additionalProperties: true }, as: { type: "string", enum: ["person", "agent"], description: "Whose token signs: the owner's (person: new, publish, grant, report, accept, changes, dispute, settle, close) or this session's agent's (agent: claim, note, giveback, deliver, resume). Left out, the verb picks." } }, required: ["action"], additionalProperties: false } },
  { name: "im_signal", description: "A signal (§10). publish: one into a channel your owner made with you as its publisher — body: channel (owner/id), market, side yes|no, sizeHint {kind: fraction-of-bankroll, value}, priceCap, expires (ISO), confidence 0..1, thesis (an address); it is data, never a prompt, sealed on this host's chain first. retract: one by id (it stays on the chain and still counts). skip: a signal in a channel your owner subscribes to, after you read its thesis and object (id, reason) — your owner must have let you take part; you can never widen the risk file. list: an agent's chain and performance (target: agent@owner).", inputSchema: { type: "object", properties: { action: { type: "string", enum: ["publish", "retract", "skip", "list"] }, body: { type: "object", description: "publish: the signal's fields and its channel.", additionalProperties: true }, id: { type: "string", description: "retract, skip: the signal's id on the relay." }, reason: { type: "string", description: "skip: why." }, target: { type: "string", description: "list: `<agent>@<owner>`." } }, required: ["action"], additionalProperties: false } },
];

export const OWN = "mcp__gemsbang__";
export const isImTool = (name: string): boolean => imToolOf(name) !== undefined;
export const imToolOf = (name: string): ImToolName | undefined => IM_TOOL_NAMES.find((n) => name === `${OWN}${n}`);

/** The one line a call answers with (transport §4.1): the tool, the venue or card, what it did; no blank after a closing 」, as the spec types it. */
export const toolLine = (tool: string, where: string, what: string): string => `${tool} · ${where}${where.endsWith("」") ? "· " : " · "}${what}`;
export const venueKey = (owner: string, id: string): string => `${owner}/${id}`;

/** A turn a queue item started (decision 2): the agent, the item, the scope its level gives, 回群前先给我看, how many calls were refused, and the guest room when the item is a card's. */
export interface ImTurn { agent: string; item: QueueItem; scope: ToolScope; draftFirst: boolean; refused: number; room?: string }

/** What a tool does, as the scope classes it: write, run, else read (answering is reading's twin). */
export function toolClassOf(tool: string): ToolClass {
  if (CLAUDE_CODE_TOOLS.write.includes(tool)) return "write";
  if (CLAUDE_CODE_TOOLS.run.includes(tool)) return "run";
  return "read";
}

/** Why a call is refused in a delivered turn (rule 5, §7.2), or nothing: one line the model reads in the deny. */
export function scopeRefusal(turn: ImTurn, tool: string): string | undefined {
  const d = decide(turn.scope, toolClassOf(tool));
  if (d === "allow") return undefined;
  const head = `IM：这一轮来自 ${turn.item.senderName}（${LEVEL_WORDS[turn.item.level]}），权限：${scopeWords(turn.scope)}；`;
  const tail = "要更多权限，在回复里说明，由主人放行。";
  return d === "sandbox" ? `${head}${tool} 要在沙箱里跑，这一轮没有客房（只有任务卡的轮次有），没有执行。${tail}` : `${head}${tool} 不在范围内，没有执行。${tail}`;
}

/** What the hooks module does with a call in a delivered turn: refuse it with a line, or start a run in the room. */
export type CallRule = { deny: string } | { cwd: string } | undefined;

/** A path under the room, on either kind of slash; a sibling that shares the prefix is outside. */
const within = (path: string, room: string): boolean => {
  const p = path.split("\\").join("/"), r = room.split("\\").join("/").replace(/\/+$/, "");
  return p === r || p.startsWith(`${r}/`);
};

/** The rule over a call in a delivered turn (rule 5, §7.2, §7.5): reads and answers pass; what the scope refuses is refused; in a card's turn with a room, a write outside the room is refused with the room's path and a sandbox run is started in the room; the owner's own turn is not confined. Which keys name a file follows the host's tools (file_path, path, notebook_path). */
export function callRule(turn: ImTurn, tool: string, input: Record<string, unknown> = {}): CallRule {
  const cls = toolClassOf(tool);
  if (cls === "read" || cls === "answer") return undefined;
  const d = decide(turn.scope, cls);
  if (d === "refuse") return { deny: scopeRefusal(turn, tool) ?? "" };
  if (turn.room === undefined) return d === "allow" ? undefined : { deny: scopeRefusal(turn, tool) ?? "" };
  if (turn.scope.run === "workflow") return undefined;
  if (cls === "write") {
    const path = ["file_path", "path", "notebook_path"].map((k) => input[k]).find((v): v is string => typeof v === "string");
    if (path !== undefined && !within(path, turn.room)) return { deny: `IM：这一轮是任务卡 #${turn.item.card?.id ?? ""} 的客房，只能写到 ${turn.room} 里；${tool} 写的是 ${path}，没有执行。` };
    return undefined;
  }
  return { cwd: turn.room };
}

export interface ImBandRow { verb: string; tone: Tone; text: string; actions: Pressable[]; more: number }

/** The band's row (§6.9): the first need in the band's order, its buttons as presses (自己写 included: the hooks module opens the thread with the box answering the ask), how many more wait; nothing when none. */
export function imBand(status: ImStatus | null): ImBandRow | undefined {
  if (status === null || !status.configured) return undefined;
  const row = bandRow(status.needs);
  const need = sortNeeds(status.needs)[0];
  if (row === undefined || need === undefined) return undefined;
  const tone: Tone = row.tone === "red" ? "error" : row.tone === "amber" ? "warning" : "success";
  return { verb: row.verb, tone, text: row.text, more: row.more, actions: row.actions.map((label, i) => needPress(need, label, i, `im-need-${i}`)) };
}

const needPress = (need: Need, label: string, i: number, key: string): Pressable =>
  ({ key, label, ...(i === 0 ? { primary: true } : {}), action: { op: "im-need", key: need.key, action: label } });

export const unreadOf = (status: ImStatus | null): number => (status === null ? 0 : status.venues.reduce((n, v) => n + v.unread, 0));

/** The board header's line (transport §4): the agent, 代 whom, its presence, whether the relay is reached. */
export function imHeaderLine(status: ImStatus | null, agent: string | undefined, t: T): string | undefined {
  if (status === null || !status.configured) return undefined;
  const link = status.connected === false ? t("断了") : t("在线");
  if (agent === undefined) return `${status.person ?? ""} · ${t("没选 agent")} · ${link}`;
  return `${agent} · 代 ${status.person ?? ""} · ${PRESENCE_WORDS[status.presence[agent] ?? "asleep"]} · ${link}`;
}

export interface ImPageInput { status: ImStatus | null; thread: Thread | null; replyTo: string | null; columns: number; now: string; t: T }

const text = (s: string, tone: Tone = "dim"): BoardRow => ({ kind: "text", text: s, tone });
const section = (key: string, s: string, count?: number): BoardRow => ({ kind: "section", key, text: s, ...(count !== undefined ? { count } : {}) });
const NEED_ICON: Readonly<Record<Need["kind"], Icon>> = { decide: "ask", grant: "ask", accept: "done", stuck: "warn", offline: "warn" };
const NEED_VERB: Readonly<Record<Need["kind"], string>> = { offline: "断了", decide: "定", accept: "验收", grant: "放行", stuck: "卡住" };

/** The 消息 page's rows (decision 5): the list, or the open thread. */
export function imTabRows(o: ImPageInput): BoardRow[] {
  const { t, columns } = o;
  const s = o.status;
  if (s === null) return [text(t("正在读取消息…"))];
  if (!s.configured) return [text(t("还没连上中继：在终端里运行 gemworks connect setup --relay <地址> --token <令牌>，再 gemworks connect。"))];
  if (o.thread !== null) return imThreadRows(o.thread, o.replyTo, columns, t);
  const link = s.connected === false ? t("断了") : s.connected === true ? t("在线") : t("没同步过");
  return [
    { kind: "heading", key: "im-head", text: t("消息"), sub: `${s.person ?? ""} @ ${s.relay ?? ""} · ${link}`, action: { key: "im-refresh", label: t("刷新"), action: { op: "im-refresh" } } },
    ...imNeedRows(s, t), ...imDraftRows(s, t), ...imCardRows(s, t), ...(s.agents.length > 0 ? [imBriefRow(t)] : []), ...imWalletRows(s, t), ...imVenueRows(s, t),
  ];
}

/** 需要我 (§6.9): a card per need, in the band's order, its buttons the need's own. */
export function imNeedRows(s: ImStatus, t: T): BoardRow[] {
  if (s.needs.length === 0) return [];
  return [section("im-needs", t("需要我"), s.needs.length), ...sortNeeds(s.needs).map((n): BoardRow => ({ kind: "card", key: `im-need-${n.key}`, icon: NEED_ICON[n.kind], verb: NEED_VERB[n.kind], title: n.text, ...(n.venue !== undefined ? { tag: n.venue } : {}), detail: [], actions: n.actions.map((label, i) => needPress(n, label, i, `im-need-${i}-${n.key}`)) }))];
}

/** The drafts held for the person (§6.5, 回群前先给我看): each as its card, then a line to change it before it goes. */
export function imDraftRows(s: ImStatus, t: T, heading: string = t("等你过目")): BoardRow[] {
  if (s.drafts.length === 0) return [];
  const rows: BoardRow[] = [section("im-drafts", heading, s.drafts.length)];
  for (const d of s.drafts) {
    rows.push({ kind: "card", key: `im-draft-${d.id}`, icon: "ask", verb: t("草稿"), title: d.venueName, tag: d.agent, detail: [d.text], actions: [{ key: `im-send-${d.id}`, label: t("就这么发"), primary: true, action: { op: "im-draft", id: d.id, send: true } }, { key: `im-drop-${d.id}`, label: t("不发"), action: { op: "im-draft", id: d.id, send: false } }] });
    rows.push({ kind: "input", key: `im-draft-${d.id}`, placeholder: t("改一下再发"), field: "im-draft", target: d.id, value: d.text });
  }
  return rows;
}

/** 一句话起草委托书 (plan K): the line the agent drafts a card from. */
export const imBriefRow = (t: T): BoardRow => ({ kind: "input", key: "im-brief", placeholder: t("一句话起草委托书：去帮谁办什么、按什么准则、别花超过多少积分"), field: "im-brief" });

/** 场所: the venues, each a press that opens its thread; `actions` at the heading's end. */
export function imVenueRows(s: ImStatus, t: T, actions?: Pressable[]): BoardRow[] {
  const rows: BoardRow[] = [{ ...section("im-venues", t("场所"), s.venues.length), ...(actions !== undefined ? { actions } : {}) }];
  if (s.venues.length === 0) rows.push(text(t("还没有场所：等守护进程同步，或在中继上建一个群")));
  for (const v of s.venues) rows.push({ kind: "entry", key: `im-venue-${v.owner}-${v.id}`, title: `${v.kindWord}「${v.name}」`, tag: v.unread > 0 ? t("{0} 未读", v.unread) : "", tone: v.unread > 0 ? "normal" : "dim", detail: v.status, action: { op: "im-open", owner: v.owner, id: v.id } });
  return rows;
}

/** A card's button as the press it raises (§8.1): 问一句 opens the card's thread; the rest are the card's verbs. */
const CARD_VERBS: Readonly<Record<string, CardAction | "brief">> = { 发布: "publish", 算了: "close", 撤回: "close", 关闭: "close", 要求交回: "giveback", 交回: "giveback", 接受: "accept", 要改: "changes", 争议: "dispute", 认领: "claim", 写记录: "note", 交付: "deliver", 继续: "resume", 放行: "grant", 改一下: "brief" };
/** The buttons that take a line of words first (the comment, the reason, the record, the note). */
const CARD_WORDS: ReadonlySet<string> = new Set(["要改", "争议", "写记录", "交回", "要求交回", "关闭", "算了", "撤回", "改一下"]);
const CARD_ICON = (state: CardRow["state"]): Icon => (state === "accepted" ? "done" : state === "dispute" || state === "closed" || state === "changes" ? "warn" : "ask");

function cardPress(row: CardRow, label: string, i: number): Pressable {
  const action = label === "问一句" ? { op: "im-open" as const, owner: row.owner, id: row.card.thread ?? row.id } : { op: "im-card" as const, action: CARD_VERBS[label] ?? label, owner: row.owner, id: row.id };
  return { key: `im-card-${i}-${row.owner}/${row.id}`, label, ...(i === 0 ? { primary: true } : {}), action };
}

/** The 任务卡 section (§8.1): a card row per card the person is on — its state as the verb, the progress line and the 委托书 as the detail, the role's buttons — and a line of words under the ones that take one. */
export function imCardRows(s: ImStatus, t: T): BoardRow[] {
  if (s.cards.length === 0) return [];
  const rows: BoardRow[] = [section("im-cards", t("任务卡"), s.cards.length)];
  for (const c of s.cards) {
    const tag = [c.directionWord, ...(c.waitingOn !== undefined ? [`等 ${c.waitingOn}`] : []), ...(c.worker !== undefined ? [c.worker] : [])].join(" · ");
    const detail = [c.progress, ...c.brief.map((l) => `${l.label}：${l.text}`), `${t("心跳")}：${c.heartbeat}`, ...(c.versions > 0 ? [t("第 {0} 版", c.versions)] : [])];
    rows.push({ kind: "card", key: `im-card-${c.owner}/${c.id}`, icon: CARD_ICON(c.state), verb: c.stateWord, title: `#${c.id} ${c.title}`, tag, detail, actions: c.actions.map((label, i) => cardPress(c, label, i)) });
    if (c.actions.some((a) => CARD_WORDS.has(a))) rows.push({ kind: "input", key: `im-card-words-${c.owner}/${c.id}`, placeholder: t("先写一行（要改什么、理由、记录），再按按钮"), field: "im-card", target: `${c.owner}/${c.id}` });
  }
  return rows;
}

/** The 钱包 section (§9.1): the balance and the four caps with today's use, then the last entries, a line each; nothing until the daemon mirrored the ledger. */
export function imWalletRows(s: ImStatus, t: T): BoardRow[] {
  if (s.wallet === undefined) return [];
  return [section("im-wallet", t("钱包")), ...s.wallet.lines.map((l) => text(l, "normal")), ...s.wallet.recent.map((l) => text(l))];
}

/** The band when nothing needs the person (§6.9): the first card still on its way that is theirs to drive, and the groups' unread. */
export function imQuietLine(status: ImStatus | null): string | undefined {
  if (status === null || !status.configured) return undefined;
  const card = status.cards.find((c) => c.state !== "accepted" && c.state !== "closed" && (c.role === "delegator" || c.role === "worker"));
  const unaddressed = status.venues.filter((v) => v.kind === "group").reduce((n, v) => n + v.unread, 0);
  return quietLine({ ...(card !== undefined ? { card: { id: `#${card.id}`, state: card.stateWord, ...(card.waitingOn !== undefined ? { waitingOn: card.waitingOn } : {}) } } : {}), unaddressed });
}

/** One venue open: its head, the messages as notes, a question's options, the box that speaks as the person (a channel has none). */
export function imThreadRows(th: Thread, replyTo: string | null, columns: number, t: T): BoardRow[] {
  const rows: BoardRow[] = [{ kind: "heading", key: "im-thread", text: `${th.kindWord}「${th.name}」`, sub: `${th.people.length} 人 · ${th.agents.length} 个 agent${th.draftFirst ? ` · ${t("回群前先给我看")}` : ""}${th.channel !== undefined ? ` · ${th.channel.price}` : ""}`, action: { key: "im-back", label: t("返回"), action: { op: "im-close" } } }];
  if (th.announce !== undefined) rows.push(text(truncate(`${t("公告")}：${th.announce}`, columns)));
  // A channel (§10.4): the stage card under the head, each signal as its card, the footer last, and no input.
  if (th.channel !== undefined) for (const l of th.channel.stage) rows.push(text(truncate(l, columns)));
  if (th.total > th.messages.length) rows.push(text(t("还有 {0} 条更早的", th.total - th.messages.length)));
  for (const m of th.messages) {
    const tags = [m.label, hhmm(m.at)];
    if (m.sourceTag !== undefined) tags.push(m.sourceTag);
    if (m.kind !== "chat") tags.push(m.kindWord);
    if (m.decision) tags.push(t("决策"));
    if (m.status !== undefined) tags.push(m.status);
    const body = m.kind === "system" ? `（${m.text}）` : m.text;
    rows.push({ kind: "note", key: `im-m-${m.id}`, lines: m.signal !== undefined ? m.signal.map((l) => truncate(l, Math.max(10, columns - 4))) : wrapCells(body, Math.max(10, columns - 4), 6), tag: tags.join(" · "), action: { op: "im-reply", message: replyTo === m.id ? null : m.id } });
    for (const p of [...m.evidence, ...m.parts]) rows.push(text(truncate(`  ↳ ${p.src}：${p.text !== undefined ? p.text.split("\n")[0] ?? "" : p.stub !== undefined ? p.stub : t("没镜像到本机")}`, columns)));
    if (m.opinion !== undefined) rows.push(text(truncate(`  ${t("意见")}：${m.opinion}`, columns)));
    if (m.kind === "ask" && m.ask !== undefined) rows.push({ kind: "buttons", items: m.ask.options.map((opt, i): Pressable => ({ key: `im-ask-${m.id}-${i}`, label: opt, action: opt === WRITE_IN ? { op: "im-reply", message: m.id } : { op: "im-say", text: opt, replyTo: m.id } })) });
  }
  if (th.channel !== undefined) rows.push(text(truncate(th.channel.footer, columns)));
  else rows.push({ kind: "input", key: "im-say", placeholder: replyTo !== null ? t("回复 {0}…", replyTo) : t("以本人身份发到这里"), field: "im-say", target: venueKey(th.owner, th.id) });
  return rows;
}
