// The gemsbang plugin as the Claude Code shell draws it (plan O): the IM on
// its own, beside gemworks or without it. One line above the prompt (the
// 「需要我」 row, else where the session's agent is), a pane with the agent's
// line and three tabs (消息, 任务, 钱包), and its settings and about dialogs,
// as rows of the kinds the board already draws. Pure and Node-free: the bridge
// brings ImStatus (daemon/view.ts); the hooks module draws and runs the presses.
import { PRESENCE_WORDS } from "../../core/im/presence.js";
import type { ImStatus, Thread } from "../../daemon/view.js";
import type { Pressable } from "./actions.js";
import { truncate, type Tone } from "./band.js";
import type { BoardRow } from "./board.js";
import { imBand, imBriefRow, imCardRows, imDraftRows, imNeedRows, imQuietLine, imThreadRows, imVenueRows, imWalletRows } from "./im.js";
import type { Settings } from "./settings.js";
import { langOf, type T } from "./text.js";
import { hhmm } from "./time.js";

export const GEMSBANG_BOARD_ID = "gemsbang-board";
export const GEMSBANG_DIALOG_ID = "gemsbang-dialog";
export const GEMSBANG_TABS = ["messages", "tasks", "wallet"] as const;
export type GemsbangTab = (typeof GEMSBANG_TABS)[number];
export const GEMSBANG_REPO = "https://github.com/geml-spec/gemsbang";

/** The mark: a speech bubble holding a gem, on a blue disc, with the red dot of something new. */
export const GEMSBANG_MARK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="gb" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="64"><stop offset="0" stop-color="#42b4f4"/><stop offset="1" stop-color="#0a74c0"/></linearGradient></defs><circle cx="32" cy="32" r="32" fill="url(#gb)"/><path d="M20 16H44A6 6 0 0 1 50 22V38A6 6 0 0 1 44 44H28L17 53L19 44H20A6 6 0 0 1 14 38V22A6 6 0 0 1 20 16Z" fill="#fff"/><path d="M26 23H38L43 29L32 40L21 29Z" fill="url(#gb)"/><path d="M21 29H43M26 23l6 6 6-6M32 29v11" fill="none" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/><circle cx="52" cy="12" r="8" fill="#ef3b3f" stroke="#fff" stroke-width="2.5"/></svg>';
/** The mark where the surface draws no pictures: one character in the mark's blue. */
export const GEMSBANG_MARK_CHAR = "@";
export const GEMSBANG_BLUE = "#0a74c0";

const text = (s: string, tone: Tone = "dim"): BoardRow => ({ kind: "text", text: s, tone });
const section = (key: string, s: string): BoardRow => ({ kind: "section", key, text: s });
const open = (c: ImStatus["cards"][number]): boolean => c.state !== "accepted" && c.state !== "closed";

/** The tabs with their counts: 消息 what waits on the person (the needs and the drafts), 任务 the cards still on their way. */
export function gemsbangTabs(s: ImStatus | null, t: T): { id: GemsbangTab; label: string }[] {
  const waiting = s === null || !s.configured ? 0 : s.needs.length + s.drafts.length;
  const cards = s === null || !s.configured ? 0 : s.cards.filter(open).length;
  return [
    { id: "messages", label: waiting > 0 ? `${t("消息")} ${waiting}` : t("消息") },
    { id: "tasks", label: cards > 0 ? `${t("任务")} ${cards}` : t("任务") },
    { id: "wallet", label: t("钱包") },
  ];
}

/** The session's agent as the pane's second line shows it: its name, 代 whom, its presence and the wallet; whether the relay is reached. */
export interface AgentLine { name: string; line: string; link: string; tone: Tone }

export function agentLine(s: ImStatus | null, agent: string | undefined, t: T): AgentLine | undefined {
  if (s === null || !s.configured) return undefined;
  const link = s.connected === false ? t("断了") : s.connected === true ? t("在线") : t("没同步过");
  const tone: Tone = s.connected === false ? "error" : s.connected === true ? "success" : "dim";
  const wallet = s.wallet !== undefined ? ` · ${t("钱包")} ${s.wallet.balance}` : "";
  if (agent === undefined) return { name: t("没选 agent"), line: `${s.person ?? ""}${wallet}`, link, tone };
  return { name: agent, line: `代 ${s.person ?? ""} · ${PRESENCE_WORDS[s.presence[agent] ?? "asleep"]}${wallet}`, link, tone };
}

export interface PageInput { tab: GemsbangTab; status: ImStatus | null; thread: Thread | null; replyTo: string | null; columns: number; t: T }

/** One tab's rows: 消息 the needs, the drafts and the venues, or the open thread; 任务 the cards and the brief; 钱包 the wallet. */
export function gemsbangRows(o: PageInput): BoardRow[] {
  const { status: s, t } = o;
  if (s === null) return [text(t("正在读取消息…"))];
  if (!s.configured) return setupRows(t);
  if (o.tab === "messages") {
    if (o.thread !== null) return imThreadRows(o.thread, o.replyTo, o.columns, t);
    const refresh: Pressable = { key: "im-refresh", label: t("刷新"), action: { op: "im-refresh" } };
    return [...imNeedRows(s, t), ...imDraftRows(s, t, t("回群前先给你看")), ...imVenueRows(s, t, [refresh])];
  }
  if (o.tab === "tasks") {
    const rows = imCardRows(s, t);
    if (rows.length === 0) rows.push(text(t("还没有任务卡：一句话起草委托书，agent 起草成卡给你过目，你点发布才发。")));
    if (s.agents.length > 0) rows.push(imBriefRow(t));
    return rows;
  }
  const wallet = imWalletRows(s, t);
  return wallet.length > 0 ? wallet : [text(t("钱包还没同步过来：守护进程镜像了账本，这里就有余额、上限和最近的流水。"))];
}

/** Not connected yet: what to run, and a press to read again. */
function setupRows(t: T): BoardRow[] {
  return [
    { kind: "heading", key: "setup", text: t("还没连上中继"), sub: "" },
    text(t("gemsbang 通过本机的守护进程收发消息。在终端里运行："), "normal"),
    { kind: "prose", key: "setup-command", text: "gemworks connect setup --relay <url> --token <token>\ngemworks connect" },
    text(t("连上之后，这里列出需要你的事、场所、任务卡和钱包。")),
    { kind: "buttons", items: [{ key: "im-refresh", label: t("再读一次"), action: { op: "im-refresh" } }] },
  ];
}

/** The band's line: what it says, in which tone, its buttons, how many more wait. */
export interface GemsbangBand { verb: string; title: string; tone: Tone; note: string; actions: Pressable[]; more: number }

/** The band (§6.9): a problem of the plugin's own first, then the first need with its buttons, else the agent and where things stand; nothing before the first read. */
export function gemsbangBand(s: ImStatus | null, agent: string | undefined, problem: string | null, t: T): GemsbangBand | undefined {
  if (problem !== null) return { verb: "", title: problem, tone: "error", note: "", actions: [], more: 0 };
  if (s === null) return undefined;
  if (!s.configured) return { verb: "", title: t("还没连上中继"), tone: "dim", note: t("看板里有连法"), actions: [], more: 0 };
  const row = imBand(s);
  if (row !== undefined) return { verb: row.verb, title: row.text, tone: row.tone, note: "", actions: row.actions, more: row.more };
  const quiet = imQuietLine(s);
  const presence = agent !== undefined ? PRESENCE_WORDS[s.presence[agent] ?? "asleep"] : t("没选 agent");
  return { verb: agent ?? "", title: quiet === undefined || quiet === "没有需要你的事" ? presence : `${presence} · ${quiet}`, tone: "dim", note: "", actions: [], more: 0 };
}

export interface SettingsInput { status: ImStatus | null; settings: Settings; locale: string | undefined; phoneCode: string | null; columns: number; t: T }

/** The settings dialog: whose words this session speaks, the relay and 重连, the phone's code, the language; 完成 closes it. */
export function gemsbangSettingsRows(o: SettingsInput): BoardRow[] {
  const { status: s, settings, t } = o;
  const ready = s !== null && s.configured;
  const rows: BoardRow[] = [section("agent", t("本会话代谁说话"))];
  if (!ready || s.agents.length === 0) rows.push(text(t("还没有 agent：连上中继、在中继上建好 agent 之后在这里选。")));
  else {
    const chosen = settings.im.agent !== "" && s.agents.includes(settings.im.agent) ? settings.im.agent : s.agents[0];
    for (const a of s.agents) rows.push({ kind: "button", key: `im-agent-${a}`, label: `${a === chosen ? "(•)" : "( )"} ${a} · ${PRESENCE_WORDS[s.presence[a] ?? "asleep"]}`, ...(a === chosen ? { primary: true } : {}), action: { op: "setting", key: "im.agent", value: a } });
    rows.push(text(t("这个会话用它的身份说话、接它队列里的事；换一个，从下一件起算。")));
  }
  rows.push(section("relay", t("中继")));
  if (!ready) rows.push(text(t("还没连上：在终端里运行 gemworks connect setup --relay <地址> --token <令牌>")));
  else {
    const when = s.at === undefined ? t("还没同步过") : s.connected === false ? t("{0} 连不上", hhmm(s.at)) : t("{0} 同步过", hhmm(s.at));
    rows.push(text(truncate(`${s.relay ?? ""} · ${s.person ?? ""} · ${when} · ${t("待发 {0}", s.outbox ?? 0)}`, o.columns), s.connected === false ? "error" : "normal"));
    if (s.connected === false && s.error !== undefined) rows.push(text(truncate(s.error, o.columns)));
    rows.push({ kind: "buttons", items: [{ key: "im-sync", label: t("重连"), action: { op: "im-sync" } }] });
  }
  rows.push(section("phone", t("手机")));
  rows.push(text(t("在手机的 bot 里收「需要我」、按按钮、/tell 你的 agent。")));
  if (ready) rows.push({ kind: "buttons", items: [{ key: "im-phone-code", label: t("生成绑定码"), action: { op: "im-phone-code" } }] });
  if (o.phoneCode !== null) rows.push(text(t("绑定码 {0} · 十分钟内在 bot 里发 /bind {0}", o.phoneCode), "success"));
  rows.push(section("language", t("语言")));
  const system = langOf("system", o.locale);
  const names: Record<string, string> = { zh: "中文", en: "English", ja: "日本語" };
  rows.push({ kind: "buttons", items: ([["system", t("跟随系统（{0}）", names[system] ?? system)], ["zh", "中文"], ["en", "English"], ["ja", "日本語"]] as const).map(([v, label]): Pressable => ({ key: `lang-${v}`, label, ...(settings.language === v ? { primary: true } : {}), action: { op: "setting", key: "language", value: v } })) });
  rows.push({ kind: "buttons", items: [{ key: "settings-done", label: t("完成"), primary: true, action: { op: "dialog", dialog: null } }] });
  return rows;
}

/** The about dialog: the mark, what gemsbang is, its version beside gemworks, the licence and the repository. */
export function gemsbangAboutRows(version: string, t: T): BoardRow[] {
  return [
    { kind: "image", key: "mark", svg: GEMSBANG_MARK_SVG, alt: "Gemsbang", width: 48 },
    text(t("给人和他们的 agent 用的 IM：需要你的事在输入框上方一行，消息、任务卡和钱包在看板里；这个会话的 agent 收它队列里的事，照发件人的权限办，把回复发回去。"), "normal"),
    text(t("插件 gemsbang {0}", version)),
    text(t("可以和 gemworks 并排装：gemworks 管流程，gemsbang 管 IM，状态带上各占一行。")),
    text(t("许可 AGPL-3.0-only")),
    { kind: "link", key: "link-repo", href: GEMSBANG_REPO, label: t("仓库") },
  ];
}
