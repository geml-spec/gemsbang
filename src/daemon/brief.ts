// 一句话起草委托书 (§8.1): the owner's line goes into their DM with the
// agent — made on the relay when there is none yet — as the owner's own
// word, so the agent's next turn drafts the card with im_card new; 改一下
// under a draft says its words the same way. One look at the relay, then
// the outbox carries the word like any other.
import { RelayClient, RelayDown, reasonOf } from "./client.js";
import { say } from "./deliver.js";
import { readConfig } from "./home.js";

export const briefText = (text: string): string => `起草一张委托书：${text}。用 im_card new 起草成草稿给我过目；我说「改一下」就用 im_card edit 改，我点发布才发。`;
export const changeText = (id: string, words: string): string => `改一下 #${id}：${words}。用 im_card edit 改草稿，改完说一声。`;

export async function briefCall(home: string, o: { text: string; agent?: string; card?: string }, now: string): Promise<{ ok: true; venue: string } | { ok: false; reason: string }> {
  const c = readConfig(home);
  if (c === undefined) return { ok: false, reason: "没有 connect.json：先 gemworks connect setup" };
  const agent = o.agent ?? Object.keys(c.agents)[0];
  if (agent === undefined) return { ok: false, reason: "本会话没有 agent：在设置里选一个" };
  if (c.agents[agent] === undefined) return { ok: false, reason: `没有 ${agent} 的令牌` };
  const id = `dm-${agent}`;
  const client = new RelayClient(c.relay.url, c.token);
  try {
    const have = await client.get(`/${encodeURIComponent(c.person)}/venues/${id}.geml`);
    if (have.status === 404) {
      const made = await client.post("/venues", { id, kind: "dm", name: agent, agents: [`agent:${agent}@${c.person}`] });
      if (made.status !== 201) return { ok: false, reason: reasonOf(made) };
    } else if (have.status !== 200) return { ok: false, reason: reasonOf(have) };
  } catch (e) { return { ok: false, reason: e instanceof RelayDown ? `连不上中继：${e.message}` : e instanceof Error ? e.message : String(e) }; }
  say(home, { as: "person", owner: c.person, venue: id, text: o.card === undefined ? briefText(o.text) : changeText(o.card, o.text) }, now);
  return { ok: true, venue: `${c.person}/${id}` };
}
