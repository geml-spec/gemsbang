// The relay's HTTP surface (transport §2.5), as a function from a parsed
// request to a status and a body, so it is tested without a socket and
// served by server.ts. Every answer is JSON (`{"error": …}` on a failure)
// except a document asked for as GEML. The token names the speaker; the
// body never does. Statuses: 400 a bad body, 401 no or an invalid token,
// 403 the token may not, 404 nothing there, 405 the method, 409 already
// there, 429 density or a quota.
import { parseAddress } from "../core/im/address.js";
import type { Relay, Result } from "./relay.js";
import type { TokenRecord } from "./tokens.js";

/** The verbs on a card, `POST /tasks/<owner>/<id>/<verb>` (§8.2), each the relay's method of that name. */
const TASK_VERBS: Readonly<Record<string, (relay: Relay, by: TokenRecord, owner: string, id: string, body: unknown) => Result<object>>> = {
  publish: (r, by, o, i, b) => r.publishTask(by, o, i, b),
  claim: (r, by, o, i, b) => r.claimTask(by, o, i, b),
  grant: (r, by, o, i) => r.grantTask(by, o, i),
  note: (r, by, o, i, b) => r.noteTask(by, o, i, b),
  giveback: (r, by, o, i, b) => r.giveBackTask(by, o, i, b),
  deliver: (r, by, o, i, b) => r.deliverTask(by, o, i, b),
  report: (r, by, o, i, b) => r.reportTask(by, o, i, b),
  accept: (r, by, o, i) => r.acceptTask(by, o, i),
  changes: (r, by, o, i, b) => r.changesTask(by, o, i, b),
  resume: (r, by, o, i) => r.resumeTask(by, o, i),
  dispute: (r, by, o, i, b) => r.disputeTask(by, o, i, b),
  settle: (r, by, o, i, b) => r.settleTask(by, o, i, b),
  close: (r, by, o, i, b) => r.closeTask(by, o, i, b),
};

export interface ApiRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  token?: string;
  /** The body parsed as JSON, when there was one. */
  body?: unknown;
  /** The client asked for text (`Accept: text/plain`). */
  geml?: boolean;
  /** The client's network address, for the guest quota (server.ts knows it). */
  ip?: string;
}
export interface ApiResponse { status: number; body: string; type: string }

export const JSON_TYPE = "application/json; charset=utf-8";
export const GEML_TYPE = "text/plain; charset=utf-8";

const json = (status: number, value: unknown): ApiResponse => ({ status, body: JSON.stringify(value), type: JSON_TYPE });
const fail = (status: number, reason: string): ApiResponse => json(status, { error: reason });
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const obj = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** A verb's result as an answer: its fields without `ok`, or the failure's status and reason. */
function answer<T extends object>(r: Result<T>, status = 200, pick?: (t: T) => unknown): ApiResponse {
  if (!r.ok) return fail(r.status, r.reason);
  const { ok: _ok, ...rest } = r;
  return json(status, pick === undefined ? rest : pick(rest as T));
}

const scopeOf = (by: TokenRecord): "person" | "other" => (by.scope === "person" || by.scope === "inbox" ? "person" : "other");

export function route(r: ApiRequest, relay: Relay): ApiResponse {
  const parts = r.path.split("/").filter((p) => p !== "").map((p) => { try { return decodeURIComponent(p); } catch { return p; } });
  const m = r.method.toUpperCase();
  const [a, b, c, d] = parts;
  if (parts.length === 0) return m === "GET" ? json(200, { name: relay.name, version: relay.version, federation: relay.federation }) : fail(405, "只有 GET");
  if (a === "guests" && parts.length === 1) return m === "POST" ? answer(relay.issueGuest(), 201, (x) => ({ token: x.token, speaker: x.record.speaker })) : fail(405, "只有 POST");
  // The guest page's two calls (transport §7.1): no token, or a guest's.
  if (a === "c" && parts.length === 2 && b !== undefined) {
    if (m !== "GET") return fail(405, "只有 GET");
    const viewer = r.token === undefined ? undefined : relay.verify(r.token);
    return answer(relay.shareOf(b, viewer?.scope === "guest" ? viewer.speaker : undefined));
  }
  if (a === "ask" && parts.length === 2 && b !== undefined) {
    if (m !== "POST") return fail(405, "只有 POST");
    const guest = r.token === undefined ? undefined : relay.verify(r.token);
    if (r.token !== undefined && guest === undefined) return fail(401, "令牌无效");
    return answer(relay.askAsGuest(guest, b, r.body, r.ip), 201);
  }
  const by = r.token === undefined ? undefined : relay.verify(r.token);
  if (r.token === undefined) return fail(401, "要令牌");
  if (by === undefined) return fail(401, "令牌无效");
  const body = obj(r.body);
  const issued = (x: { token: string; record: TokenRecord }): unknown => ({ token: x.token, speaker: x.record.speaker, scope: x.record.scope });

  if (a === "me" && parts.length === 1) return m === "GET" ? json(200, { speaker: by.speaker, scope: by.scope, id: by.id }) : fail(405, "只有 GET");
  if (a === "cards" && parts.length === 1) {
    if (m === "POST") return answer(relay.createShare(by, r.body), 201);
    if (m !== "GET") return fail(405, "GET 或 POST");
    if (scopeOf(by) !== "person") return fail(403, "只有本人能列自己的卡");
    return json(200, relay.sharesOf(by.speaker.slice("person:".length)));
  }
  if (a === "quota" && parts.length === 1) return m === "POST" ? answer(relay.setGuestQuota(by, r.body)) : fail(405, "只有 POST");
  if (a === "tasks") {
    if (parts.length === 1) {
      if (m === "POST") return answer(relay.createTask(by, r.body), 201);
      if (m !== "GET") return fail(405, "GET 或 POST");
      if (scopeOf(by) !== "person") return fail(403, "只有本人能列自己的任务卡");
      return json(200, relay.tasksOf(by.speaker.slice("person:".length)));
    }
    if (parts.length === 3 && b !== undefined && c !== undefined) return m === "GET" ? answer(relay.taskView(b, c, by.speaker)) : fail(405, "只有 GET");
    if (parts.length === 4 && b !== undefined && c !== undefined && d !== undefined) {
      if (m !== "POST") return fail(405, "只有 POST");
      const verb = TASK_VERBS[d];
      return verb === undefined ? fail(404, "没有这个动作") : answer(verb(relay, by, b, c, r.body));
    }
    return fail(404, "没有这个路径");
  }
  if (a === "tokens" && parts.length === 1) {
    if (m !== "POST") return fail(405, "只有 POST");
    if (body["scope"] === "inbox") return answer(relay.issueInbox(by), 201, issued);
    const agent = str(body["agent"]);
    if (agent === undefined) return fail(400, "要 agent 的名字，或 scope: inbox");
    return answer(relay.issueAgent(by, agent, body["policy"]), 201, issued);
  }
  if (a === "venues") {
    if (parts.length === 1) {
      if (m === "POST") return answer(relay.createVenue(by, r.body), 201);
      if (m !== "GET") return fail(405, "GET 或 POST");
      if (scopeOf(by) !== "person") return fail(403, "只有本人能列场所");
      return json(200, relay.venuesOf(by.speaker.slice("person:".length)).map((vd) => ({ owner: parseAddress(vd.venue.address)?.owner ?? "", id: vd.venue.id, kind: vd.venue.kind, name: vd.venue.name })));
    }
    if (parts.length === 4 && b !== undefined && c !== undefined) {
      if (m !== "POST") return fail(405, "只有 POST");
      if (d === "members") return answer(relay.addMember(by, b, c, str(body["speaker"]) ?? ""));
      if (d === "announce") return answer(relay.setAnnounce(by, b, c, str(body["text"]) ?? ""));
      if (d === "decisions") return answer(relay.markDecision(by, b, c, str(body["message"]) ?? ""));
      if (d === "messages") { const x = relay.appendMessage(by, b, c, r.body); return answer(x, x.ok && x.existed ? 200 : 201); }
    }
    return fail(404, "没有这个路径");
  }
  if (a === "agents" && parts.length === 1) {
    if (m !== "GET") return fail(405, "只有 GET");
    if (scopeOf(by) !== "person") return fail(403, "只有本人能列自己的 agent");
    return json(200, relay.agentsOf(by.speaker.slice("person:".length)));
  }
  if (a === "queues" && parts.length === 3 && b !== undefined && c !== undefined) {
    if (m === "GET") return answer(relay.queueOf(by, b, c));
    if (m === "POST") return answer(relay.mark(by, b, c, str(body["kind"]) ?? "", str(body["item"]) ?? "", str(body["reply"])), 201);
    return fail(405, "GET 或 POST");
  }
  if (a === "presence") {
    if (parts.length === 1) return m === "POST" ? answer(relay.setPresence(by, r.body)) : fail(405, "只有 POST");
    if (parts.length === 3 && b !== undefined && c !== undefined) return m === "GET" ? json(200, relay.presenceOf(`agent:${c}@${b}`)) : fail(405, "只有 GET");
    return fail(404, "没有这个路径");
  }
  if (a === "inbox" && parts.length === 1) {
    if (m !== "GET") return fail(405, "只有 GET");
    if (scopeOf(by) !== "person") return fail(403, "只有本人能看收件箱");
    return json(200, relay.inbox(by.speaker.slice("person:".length)));
  }
  if (a === "trust" && parts.length === 1) return m === "POST" ? answer(relay.trust(by, str(body["person"]) ?? "")) : fail(405, "只有 POST");
  if (a === "grants") {
    if (parts.length === 1) return m === "POST" ? answer(relay.grant(by, r.body), 201) : fail(405, "只有 POST");
    if (parts.length === 2 && b === "request") return m === "POST" ? answer(relay.requestGrant(by, str(body["owner"]) ?? "", str(body["block"]) ?? "", str(body["reason"])), 201) : fail(405, "只有 POST");
    if (parts.length === 2 && b === "refuse") return m === "POST" ? answer(relay.refuse(by, str(body["request"]) ?? "")) : fail(405, "只有 POST");
    if (parts.length === 2 && b !== undefined) {
      if (m !== "GET") return fail(405, "只有 GET");
      const mine = by.speaker === `person:${b}` || by.speaker.endsWith(`@${b}`);
      return mine ? json(200, relay.scopeGrantsOf(b)) : fail(403, "只有主人和它的 agent 能看放行");
    }
    return fail(404, "没有这个路径");
  }
  // A document: /<owner>/<doc>.geml
  if (parts.length >= 2 && a !== undefined) {
    const owner = a, doc = parts.slice(1).join("/");
    if (m === "GET") {
      const read = relay.read(owner, doc, by.speaker, r.query["block"]);
      if (!read.ok) return fail(read.status, read.reason);
      return r.geml === true || r.query["format"] === "geml" ? { status: 200, body: relay.renderVisible(read.blocks), type: GEML_TYPE } : json(200, { blocks: read.blocks });
    }
    if (m === "POST") {
      const venue = /^venues\/([^/]+)\.geml$/.exec(doc), queue = /^queues\/([^/]+)\.geml$/.exec(doc);
      if (venue !== null) { const x = relay.appendMessage(by, owner, venue[1]!, r.body); return answer(x, x.ok && x.existed ? 200 : 201); }
      if (queue !== null) return answer(relay.mark(by, owner, queue[1]!, str(body["kind"]) ?? "", str(body["item"]) ?? "", str(body["reply"])), 201);
      return fail(405, "只有场所和队列能追加");
    }
    return fail(405, "GET 或 POST");
  }
  return fail(404, "没有这个路径");
}
