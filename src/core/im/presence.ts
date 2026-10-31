// Presence and receipts (§6.10). A session's presence is one of five words;
// an agent account's is its most active session's. What others see of it is
// made only of what the venue may see: 「正在做 #42」 where #42 is visible,
// 「忙」 elsewhere. A person's message shows delivered or read-by; a prompt's
// three states are the queue's (queue.ts, senderStatus). Pure.

export type Presence = "thinking" | "tool" | "waiting" | "idle" | "asleep";

/** The owner's words for their own agent's state (the board's header). */
export const PRESENCE_WORDS: Readonly<Record<Presence, string>> = { thinking: "思考", tool: "跑工具", waiting: "等你", idle: "空闲", asleep: "睡着" };

const ACTIVITY: Readonly<Record<Presence, number>> = { thinking: 0, tool: 1, waiting: 2, idle: 3, asleep: 4 };

/** The most active of the account's sessions; none means asleep. */
export function agentPresence(sessions: readonly { presence: Presence }[]): Presence {
  let best: Presence = "asleep";
  for (const s of sessions) if (ACTIVITY[s.presence] < ACTIVITY[best]) best = s.presence;
  return best;
}

export const isAlive = (p: Presence): boolean => p !== "asleep";

/** The status others see (§6.10): the task only where this venue may see it, else 忙; the tool's seconds when known. */
export function presenceText(p: Presence, o: { task?: string; taskVisibleHere?: boolean; toolSeconds?: number }): string {
  const tool = `跑工具${o.toolSeconds === undefined ? "" : ` ${o.toolSeconds} 秒`}`;
  switch (p) {
    case "thinking": case "tool": {
      if (o.task !== undefined) return o.taskVisibleHere === true ? `正在做 ${o.task}${p === "tool" ? ` · ${tool}` : ""}` : "忙";
      return p === "tool" ? tool : "思考";
    }
    case "waiting": return "等主人";
    case "idle": return "空闲";
    case "asleep": return "睡着";
  }
}

/** The line under a person's message: who read it, or that it arrived, or that it is on its way (a pending block, transport §2.7). */
export function receiptLine(o: { delivered: boolean; readBy: readonly string[] }): string {
  if (!o.delivered) return "发送中";
  return o.readBy.length === 0 ? "送达" : `已读 · ${o.readBy.join("、")}`;
}
