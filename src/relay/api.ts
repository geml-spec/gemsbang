// The relay's HTTP surface (transport §2.5), as a function from a parsed
// request to a status and a body, so it is tested without a socket and
// served by server.ts. Every answer is JSON (`{"error": …}` on a failure)
// except a document asked for as GEML. The token names the speaker; the
// body never does. Statuses: 400 a bad body, 401 no or an invalid token,
// 403 the token may not, 404 nothing there, 405 the method, 409 already
// there, 410 gone (a packet past its day), 429 density or a quota.
import { parseAddress } from "../core/im/address.js";
import type { Relay, Result } from "./relay.js";
import { workspaceFiles } from "./hosted.js";
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
  edit: (r, by, o, i, b) => r.editTask(by, o, i, b),
  split: (r, by, o, i, b) => r.splitTask(by, o, i, b),
};

/** The wallet's verbs, `POST /wallet/<verb>` (§9.1), each the relay's method of that name. */
const WALLET_VERBS: Readonly<Record<string, (relay: Relay, by: TokenRecord, body: unknown) => Result<object>>> = {
  caps: (r, by, b) => r.setCaps(by, b),
  spend: (r, by, b) => r.spend(by, b),
  ask: (r, by, b) => r.askCredits(by, b),
  allow: (r, by, b) => r.allowCredits(by, b),
  tip: (r, by, b) => r.tip(by, b),
  favor: (r, by, b) => r.favor(by, b),
  gift: (r, by, b) => r.gift(by, b),
  packet: (r, by, b) => r.packet(by, b),
};
/** The verbs whose answer is a thing made. */
const MADE: ReadonlySet<string> = new Set(["ask", "packet"]);

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
  if (a === "g" && parts.length === 2 && b !== undefined && m === "GET") return answer(relay.giftOf(b));
  // Login (transport §7.1): no token yet, by definition.
  if (a === "login") {
    if (m !== "POST") return fail(405, "只有 POST");
    if (parts.length === 1) return answer(relay.startLogin(r.body, r.ip));
    if (parts.length === 2 && b === "verify") return answer(relay.finishLogin(r.body));
    return fail(404, "没有这个路径");
  }
  // The agent's page (§9.3 像公众号): public, like the person's.
  if (a === "a" && parts.length === 3 && b !== undefined && c !== undefined && m === "GET") return answer(relay.agentView(b, c));
  // The signal chain and its performance (§10.3): public.
  if (a === "signals" && parts.length === 3 && b !== undefined && c !== undefined && m === "GET") return answer(relay.signalPage(b, c));
  // The bot binds with the code (transport §7.2): no token yet.
  if (a === "phone" && parts.length === 2 && b === "bind") return m === "POST" ? answer(relay.phoneBind(r.body)) : fail(405, "只有 POST");
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
  if (a === "wallet") {
    if (parts.length === 1) {
      if (m !== "GET") return fail(405, "只有 GET");
      if (scopeOf(by) !== "person") return fail(403, "只有本人能看钱包");
      return json(200, relay.walletOf(by.speaker.slice("person:".length)));
    }
    if (parts.length === 2 && b !== undefined) {
      if (m !== "POST") return fail(405, "只有 POST");
      const verb = WALLET_VERBS[b];
      if (verb === undefined) return fail(404, "没有这个动作");
      const x = verb(relay, by, r.body);
      return answer(x, x.ok && (MADE.has(b) || (b === "gift" && "id" in x)) ? 201 : 200);
    }
    return fail(404, "没有这个路径");
  }
  if (a === "g" && parts.length === 3 && b !== undefined && c === "claim") return m === "POST" ? answer(relay.claimGift(by, b)) : fail(405, "只有 POST");
  if (a === "r" && b !== undefined) {
    if (parts.length === 2) return m === "GET" ? answer(relay.packetOf(b, by.speaker)) : fail(405, "只有 GET");
    if (parts.length === 3 && c === "claim") return m === "POST" ? answer(relay.claimPacket(by, b)) : fail(405, "只有 POST");
    return fail(404, "没有这个路径");
  }
  if (a === "tasks") {
    if (parts.length === 1) {
      if (m === "POST") return answer(relay.createTask(by, r.body), 201);
      if (m !== "GET") return fail(405, "GET 或 POST");
      if (scopeOf(by) !== "person") return fail(403, "只有本人能列自己的任务卡");
      return json(200, relay.tasksOf(by.speaker.slice("person:".length)));
    }
    if (parts.length === 3 && b !== undefined && c !== undefined) return m === "GET" ? answer(relay.taskView(b, c, by.speaker)) : fail(405, "只有 GET");
    if (parts.length === 4 && b !== undefined && c !== undefined && d !== undefined) {
      if (d === "tree") return m === "GET" ? answer(relay.treeOf(b, c, by.speaker)) : fail(405, "只有 GET");
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
      return json(200, relay.venuesOf(by.speaker.slice("person:".length)).map((vd) => ({ owner: parseAddress(vd.venue.address)?.owner ?? "", id: vd.venue.id, kind: vd.venue.kind, name: vd.venue.name, ...(vd.venue.publisher !== undefined ? { publisher: vd.venue.publisher } : {}) })));
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
  if (a === "agents" && parts.length === 3 && b !== undefined && c === "declare") return m === "POST" ? answer(relay.declare(by, { ...obj(r.body), agent: b })) : fail(405, "只有 POST");
  if (a === "agents" && parts.length === 3 && b !== undefined && c === "social") return m === "POST" ? answer(relay.setSocialMode(by, { ...obj(r.body), agent: b })) : fail(405, "只有 POST");
  if (a === "signals") {
    if (parts.length === 1) return m === "POST" ? answer(relay.publishSignal(by, r.body), 201) : fail(405, "只有 POST");
    if (parts.length === 3 && b !== undefined && c === "retract") return m === "POST" ? answer(relay.retractSignal(by, b, r.body)) : fail(405, "只有 POST");
    return fail(404, "没有这个路径");
  }
  if (a === "channels") {
    if (parts.length === 1) return m === "GET" ? json(200, relay.listChannels()) : fail(405, "只有 GET");
    if (parts.length === 4 && b !== undefined && c !== undefined && d === "subscribe") return m === "POST" ? answer(relay.subscribe(by, b, c, r.body)) : fail(405, "只有 POST");
    return fail(404, "没有这个路径");
  }
  if (a === "prices" && parts.length === 2 && b !== undefined) return m === "GET" ? json(200, { market: b, points: relay.pricesOf(b) }) : fail(405, "只有 GET");
  if (a === "hosted") {
    if (parts.length === 1) {
      if (m !== "GET") return fail(405, "只有 GET");
      if (scopeOf(by) !== "person") return fail(403, "只有本人能看托管的 agent");
      return json(200, relay.hostedOf(by.speaker.slice("person:".length)));
    }
    if (parts.length === 3 && b !== undefined && c === "move") {
      if (m !== "POST") return fail(405, "只有 POST");
      const r = relay.moveHosted(by, b);
      return answer(r.ok ? { ok: true as const, token: r.token, files: workspaceFiles(r.workspace) } : r);
    }
    return fail(404, "没有这个路径");
  }
  if (a === "rooms") {
    if (parts.length === 1) return m === "GET" ? json(200, relay.listRooms()) : fail(405, "只有 GET");
    if (parts.length === 4 && b !== undefined && c !== undefined && d === "join") return m === "POST" ? answer(relay.joinRoom(by, b, c, r.body)) : fail(405, "只有 POST");
    return fail(404, "没有这个路径");
  }
  if (a === "digests") {
    if (parts.length === 1) return m === "POST" ? answer(relay.draftDigest(by, r.body), 201) : fail(405, "只有 POST");
    if (parts.length === 2 && b === "answer") return m === "POST" ? answer(relay.answerDigest(by, r.body)) : fail(405, "只有 POST");
    if (parts.length === 2 && b !== undefined) return m === "GET" ? json(200, relay.digestsOf(b)) : fail(405, "只有 GET");
    return fail(404, "没有这个路径");
  }
  if (a === "match") {
    if (parts.length === 1) return m === "POST" ? answer(relay.proposeMatch(by, r.body), 201) : fail(405, "只有 POST");
    if (parts.length === 2 && b === "suggest") return m === "GET" ? json(200, relay.suggestMatches(by.speaker.startsWith("person:") ? by.speaker.slice("person:".length) : by.speaker.replace(/^agent:[^@]+@/, ""))) : fail(405, "只有 GET");
    if (parts.length === 4 && b !== undefined && c !== undefined && d === "answer") return m === "POST" ? answer(relay.answerMatch(by, b, c, r.body)) : fail(405, "只有 POST");
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
  if (a === "phone" && parts.length === 2 && b === "code") return m === "POST" ? answer(relay.phoneCode(by), 201) : fail(405, "只有 POST");
  if (a === "inbox" && parts.length === 2 && b === "answer") return m === "POST" ? answer(relay.answerNeed(by, str(body["key"]) ?? "", str(body["action"]) ?? "", str(body["text"]))) : fail(405, "只有 POST");
  if (a === "tell" && parts.length === 1) return m === "POST" ? answer(relay.tell(by, r.body), 201) : fail(405, "只有 POST");
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
