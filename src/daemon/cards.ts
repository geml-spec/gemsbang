// The task card's verbs for a host (§8, transport §4.1 im_card): one call
// to the relay with the person's token or an agent's, and the line the tool
// answers with. Unlike messages, a card's verbs are not queued in the
// outbox — a claim is a lock, a delivery a stamp — so the relay answers now,
// and a relay out of reach is the answer.
import { briefLines, DIRECTION_WORDS, progressLine, STATE_WORDS, waitingOn, type Card, type CardAction, type CardState } from "../core/im/card.js";
import { RelayClient, RelayDown, reasonOf } from "./client.js";
import { readConfig } from "./home.js";

export { CARD_ACTIONS, isCardAction, type CardAction } from "../core/im/card.js";

export interface CardView { card: Card; address: string; brief: { label: string; text: string }[]; progress: string; waitingOn?: string; heartbeat: string }
export interface CardListRow { owner: string; id: string; title: string; state: string; direction: string; role: string }
/** What a card call answers: the card after the verb (and its state before it), the report's decision, a new card's address, a view, a list; always the line. */
export interface CardAnswer { card?: Card; before?: CardState; decision?: "accepted" | "changes" | "inbox"; address?: string; view?: CardView; rows?: CardListRow[]; line: string }

const ROLE_WORDS: Readonly<Record<string, string>> = { delegator: "委托人", worker: "接单方", granter: "放行人" };
const DECISION_WORDS = { accepted: "已接受", changes: "要改", inbox: "等主人验收" } as const;

/** The card as `show` prints it: the head line, the 委托书, whom it waits on, the heartbeat. */
export function showLines(v: CardView): string {
  const lines = [`#${v.card.id} ${v.card.title} · ${DIRECTION_WORDS[v.card.direction]} · ${v.progress}`, ...v.brief.map((l) => `${l.label}：${l.text}`)];
  if (v.waitingOn !== undefined) lines.push(`等：${v.waitingOn}`);
  lines.push(`心跳：${v.heartbeat}`);
  return lines.join("\n");
}

export async function cardCall(home: string, o: { action: CardAction; owner?: string; id?: string; body?: unknown; as?: string }): Promise<{ ok: true; answer: CardAnswer } | { ok: false; reason: string }> {
  const c = readConfig(home);
  if (c === undefined) return { ok: false, reason: "没有 connect.json：先 gemworks connect setup" };
  const agent = o.as === undefined || o.as === "person" ? undefined : o.as.replace(/^agent:/, "");
  const token = agent === undefined ? c.token : c.agents[agent];
  if (token === undefined) return { ok: false, reason: `没有 ${agent} 的令牌` };
  const client = new RelayClient(c.relay.url, token);
  try {
    if (o.action === "list") {
      const r = await client.get("/tasks");
      if (r.status !== 200) return { ok: false, reason: reasonOf(r) };
      const rows = r.body as CardListRow[];
      return { ok: true, answer: { rows, line: rows.length === 0 ? "没有任务卡" : rows.map((t) => `${t.owner}/${t.id} · ${t.title} · ${STATE_WORDS[t.state as CardState] ?? t.state} · ${ROLE_WORDS[t.role] ?? t.role}`).join("\n") } };
    }
    if (o.action === "new") {
      const r = await client.post("/tasks", o.body ?? {});
      if (r.status !== 201) return { ok: false, reason: reasonOf(r) };
      const made = r.body as { card: Card; address: string };
      return { ok: true, answer: { card: made.card, address: made.address, line: `起草 · ${made.card.title}` } };
    }
    if (o.owner === undefined || o.id === undefined) return { ok: false, reason: "要卡的 owner/id" };
    const path = `/tasks/${encodeURIComponent(o.owner)}/${encodeURIComponent(o.id)}`;
    const seen = await client.get(path);
    if (seen.status !== 200) return { ok: false, reason: reasonOf(seen) };
    const view = seen.body as CardView;
    if (o.action === "show") return { ok: true, answer: { card: view.card, view, line: showLines(view) } };
    const r = await client.post(`${path}/${o.action}`, o.body ?? {});
    if (r.status !== 200) return { ok: false, reason: reasonOf(r) };
    const out = r.body as { card: Card; decision?: "accepted" | "changes" | "inbox" };
    const w = waitingOn(out.card);
    const moved = out.card.state !== view.card.state;
    const line = moved ? `${STATE_WORDS[view.card.state]} → ${STATE_WORDS[out.card.state]}${w === undefined ? "" : ` · ${w}`}` : o.action === "note" ? "记了一笔" : o.action === "report" ? `验收报告 · ${DECISION_WORDS[out.decision ?? "inbox"]}` : STATE_WORDS[out.card.state];
    return { ok: true, answer: { card: out.card, before: view.card.state, ...(out.decision !== undefined ? { decision: out.decision } : {}), line } };
  } catch (e) {
    return { ok: false, reason: e instanceof RelayDown ? `连不上中继：${e.message}` : e instanceof Error ? e.message : String(e) };
  }
}

/** The brief as the model may read it back after `show`, for a tool's second line. */
export const briefOf = (card: Card): string => briefLines(card).map((l) => `${l.label}：${l.text}`).join("\n");
export { progressLine };
