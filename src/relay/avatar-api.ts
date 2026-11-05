// gemsbang's relay over HTTP (transport §2.5), as a function from a parsed
// request to a status and a body, so it is tested without a socket and
// served by avatar-server.ts. Every answer is JSON but an agent's join
// instructions (`/i/<code>.md`, Markdown). A refusal is
// `{"error": <code>, "params"?: …, "reason": <its words>}`, the words in the
// request's language: `?lang=`, else the person's own, else the browser's
// (`Accept-Language`), else Chinese (spec §7.6). The token names who asks;
// the body never does.
import { AVATAR_ID, parseWho } from "../core/avatar/who.js";
import { DEFAULT_LANG, isLang, pickLang, say, type Lang } from "../core/avatar/words.js";
import type { AvatarRelay, Fail, Result } from "./avatars.js";
import type { TokenRecord } from "./tokens.js";

export interface AvatarRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  token?: string;
  /** The body parsed as JSON, when there was one. */
  body?: unknown;
  /** The client's network address, for the code quota. */
  ip?: string;
  /** The `Accept-Language` header. */
  languages?: string;
  /** Where the relay is reached, `https://host`, for the addresses an agent is told. */
  base?: string;
  version?: string;
}
export interface AvatarResponse { status: number; body: string; type: string }

export const JSON_TYPE = "application/json; charset=utf-8";
export const MARKDOWN_TYPE = "text/markdown; charset=utf-8";

const json = (status: number, value: unknown): AvatarResponse => ({ status, body: JSON.stringify(value), type: JSON_TYPE });
const obj = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** A refusal in the language: its code, its parameters, its words. */
export function refusal(status: number, code: string, lang: Lang, params?: Record<string, string | number>): AvatarResponse {
  return json(status, { error: code, ...(params !== undefined ? { params } : {}), reason: say(code, lang, params) });
}

/** The language a request is answered in: asked for in the query or the body, else the person's, else the browser's. */
export function langOf(r: Pick<AvatarRequest, "query" | "languages" | "body">, person?: Lang): Lang {
  const asked = r.query["lang"] ?? obj(r.body)["lang"];
  return isLang(asked) ? asked : (person ?? pickLang(r.languages) ?? DEFAULT_LANG);
}

/** A link's code in a path part, `<code>` or `<code>.md`. */
const LINK_PART = /^([a-z0-9]{1,16})(\.md)?$/;

export function routeAvatars(r: AvatarRequest, relay: AvatarRelay): AvatarResponse {
  const parts = r.path.split("/").filter((p) => p !== "").map((p) => { try { return decodeURIComponent(p); } catch { return p; } });
  const m = r.method.toUpperCase();
  const by: TokenRecord | undefined = r.token === undefined ? undefined : relay.verify(r.token);
  const person = by === undefined ? undefined : relay.personOf(by);
  const lang = langOf(r, person === undefined ? undefined : relay.languageOf(person));
  const no = (status: number, code: string, params?: Record<string, string | number>): AvatarResponse => refusal(status, code, lang, params);
  const answer = <T extends object>(x: Result<T>, status = 200): AvatarResponse => {
    if (!x.ok) return no((x as Fail).status, (x as Fail).code, (x as Fail).params);
    const { ok: _ok, ...rest } = x as { ok: true } & T;
    return json(status, rest);
  };
  const only = (method: string, then: () => AvatarResponse): AvatarResponse => (m === method ? then() : no(405, "method.wrong"));
  const [a, b, c, d] = parts;

  if (parts.length === 0) return only("GET", () => json(200, { name: relay.name, kind: "gemsbang", ...(r.version !== undefined ? { version: r.version } : {}) }));
  // Logging in (spec §6.2): no token yet, by definition.
  if (a === "login" && parts.length === 1) return only("POST", () => answer(relay.startLogin({ lang, ...obj(r.body) }, r.ip)));
  if (a === "login" && parts.length === 2 && b === "verify") return only("POST", () => answer(relay.finishLogin({ lang, ...obj(r.body) })));
  // Through another account (S28): the accounts set up, and the check of the client holding a sign-in's secret (the shell holds a waiting one open).
  if (a === "login" && parts.length === 2 && b === "providers") return only("GET", () => json(200, { providers: relay.providers() }));
  if (a === "login" && parts.length === 3 && b === "sso" && c === "check") return only("POST", () => answer(relay.ssoCheck(r.body)));
  // A link (spec §6.1–§6.3): its page's facts for anyone, the agent's instructions, the way in.
  const lp = a === "i" && b !== undefined ? LINK_PART.exec(b) : null;
  if (lp !== null && parts.length === 2) {
    return only("GET", () => {
      const info = relay.linkInfo(lp[1]!, by, { ...(r.query["by"] !== undefined ? { by: r.query["by"] } : {}), ...(r.query["call"] !== undefined ? { call: r.query["call"] } : {}), lang });
      if (lp[2] === undefined || !info.ok) return answer(info);
      const days = Math.max(1, Math.ceil((Date.parse(info.expires) - Date.parse(relay.now())) / 86_400_000));
      const base = r.base ?? "";
      const text = say("md.join", lang, { group: info.group.name, owner: info.owner?.name ?? "", days, relay: base === "" ? relay.name : base, join: `${base}/i/${lp[1]}/join` });
      return { status: 200, body: text, type: MARKDOWN_TYPE };
    });
  }
  if (lp !== null && parts.length === 3 && c === "join" && lp[2] === undefined) {
    return only("POST", () => {
      if (r.token === undefined) return answer(relay.joinWithCode(lp[1]!, { lang, ...obj(r.body) }), 201);
      if (by === undefined) return no(401, "token.invalid");
      const x = relay.joinByLink(by, lp[1]!, r.body);
      return answer(x, x.ok && !x.already ? 201 : 200);
    });
  }

  // An avatar's own link (S37): its page's facts, the agent's instructions, the way into a two-person chat with it.
  const up = a === "u" && b !== undefined ? LINK_PART.exec(b) : null;
  if (up !== null && parts.length === 2) {
    return only("GET", () => {
      const info = relay.personLinkInfo(up[1]!, by, { lang });
      if (up[2] === undefined || !info.ok) return answer(info);
      const days = Math.max(1, Math.ceil((Date.parse(info.expires) - Date.parse(relay.now())) / 86_400_000));
      const base = r.base ?? "";
      const text = say("md.dm", lang, { name: info.avatar.name, days, relay: base === "" ? relay.name : base, join: `${base}/u/${up[1]}/join` });
      return { status: 200, body: text, type: MARKDOWN_TYPE };
    });
  }
  if (up !== null && parts.length === 3 && c === "join" && up[2] === undefined) {
    return only("POST", () => {
      if (r.token === undefined) return answer(relay.joinWithPersonCode(up[1]!, { lang, ...obj(r.body) }), 201);
      if (by === undefined) return no(401, "token.invalid");
      const x = relay.joinByPersonLink(by, up[1]!, r.body);
      return answer(x, x.ok && !x.already ? 201 : 200);
    });
  }

  if (r.token === undefined) return no(401, "token.required");
  if (by === undefined) return no(401, "token.invalid");
  const body = obj(r.body);

  if (a === "me" && parts.length === 1) {
    return only("GET", () => {
      const w = parseWho(by.speaker);
      if (person !== undefined) return json(200, { scope: by.scope, person, lang: relay.languageOf(person), avatars: relay.avatarsOf(person), push: relay.pushOf(person), ...(relay.defaultNameOf(person) !== undefined ? { defaultName: relay.defaultNameOf(person) } : {}), base: relay.baseOfPerson(person) });
      return json(200, { scope: by.scope, ...(w?.kind === "avatar" ? { avatar: relay.card(w.id) } : {}) });
    });
  }
  // 底子 (S27): the person's, or what an avatar's agent may read; made (by the person, or waiting from an agent); changed by the person.
  if (a === "base" && parts.length === 1) return m === "GET" ? answer(relay.baseFor(by)) : only("POST", () => answer(relay.addBase(by, r.body), 201));
  if (a === "base" && parts.length === 2 && b !== undefined) return only("POST", () => answer(relay.setBase(by, b, r.body)));
  if (a === "me" && parts.length === 2 && b === "lang") return only("POST", () => answer(relay.setLanguage(by, r.body)));
  if (a === "me" && parts.length === 2 && b === "default-name") return only("POST", () => answer(relay.setDefaultName(by, r.body)));
  if (a === "me" && parts.length === 2 && b === "push") return only("POST", () => answer(relay.setPush(by, r.body)));
  // The account (architecture §3.1): the ways in, the devices signed in, signing out.
  if (a === "me" && b === "methods") {
    if (parts.length === 2) return m === "GET" ? answer(relay.methods(by)) : only("POST", () => answer(relay.startMethod(by, r.body, r.ip)));
    if (parts.length === 3 && c === "verify") return only("POST", () => answer(relay.addMethod(by, r.body)));
    // 加一种 through another account (S32): the hash the person's client holds, before its browser opens the account.
    if (parts.length === 3 && c === "sso") return only("POST", () => answer(relay.ssoAdd(by, r.body)));
    if (parts.length === 4 && c !== undefined && d === "remove") return only("POST", () => answer(relay.removeMethod(by, c)));
  }
  if (a === "me" && b === "devices") {
    if (parts.length === 2) return only("GET", () => answer(relay.devicesOf(by)));
    if (parts.length === 3 && c === "revoke-others") return only("POST", () => answer(relay.revokeOthers(by)));
    if (parts.length === 4 && c !== undefined && d === "revoke") return only("POST", () => answer(relay.revokeDevice(by, c)));
  }
  if (a === "me" && parts.length === 2 && b === "logout") return only("POST", () => answer(relay.logout(by)));
  // The person's box (architecture §5.2): where it stands, the difference, and the wait (the shell holds an empty one open).
  if (a === "updates" && parts.length === 2 && b === "state") return only("GET", () => answer(relay.updatesState(by)));
  if (a === "updates" && (parts.length === 1 || (parts.length === 2 && b === "difference"))) return only("GET", () => answer(relay.difference(by, r.query)));
  // 需要你 (spec §7.3): an avatar asks; the person lists and answers.
  if (a === "needs" && parts.length === 1) {
    if (m === "POST") return answer(relay.ask(by, r.body), 201);
    return only("GET", () => {
      if (person !== undefined && by.scope === "person") return json(200, relay.needsOf(person));
      const w = parseWho(by.speaker);
      return by.scope === "avatar" && w?.kind === "avatar" ? json(200, relay.needsOfAvatar(w.id).filter((n) => n.state !== "answered")) : no(403, "person.only");
    });
  }
  if (a === "needs" && parts.length === 3 && b !== undefined && c !== undefined) return only("POST", () => answer(relay.answerNeed(by, b, c, r.body)));
  // 任务 (spec §7.4, once called 借电脑): the person's jobs for their computer, and the computer moving one on.
  if (a === "work" && parts.length === 1) return only("GET", () => (person !== undefined && by.scope === "person" ? json(200, relay.worksOf(person)) : no(403, "person.only")));
  if (a === "work" && parts.length === 3 && b !== undefined && c !== undefined) return only("POST", () => answer(relay.setWork(by, b, c, r.body)));
  if (a === "devices" && parts.length === 1) return only("POST", () => answer(relay.issueDevice(by), 201));
  if (a === "avatars" && parts.length === 1) return only("POST", () => answer(relay.firstAvatar(by, r.body), 201));
  if (a === "avatars" && parts.length === 3 && b !== undefined) {
    if (c === "name") return only("POST", () => answer(relay.rename(by, b, r.body)));
    if (c === "rules") return only("POST", () => answer(relay.setRules(by, b, r.body)));
    if (c === "token") return only("POST", () => answer(relay.issueAvatar(by, b), 201));
    if (c === "auto") return only("POST", () => answer(relay.setAuto(by, b, r.body)));
    // The avatar's own link (S37): the current one, or a new one in its place.
    if (c === "link") return m === "GET" ? answer(relay.personLinkFor(by, b)) : only("POST", () => answer(relay.rotatePersonLink(by, b)));
    // 不用问 (S23): the standing ones listed, one taken back.
    if (c === "allows") return m === "GET" ? answer(relay.allowsFor(by, b)) : only("POST", () => answer(relay.revokeAllow(by, b, r.body)));
    return no(404, "path.missing");
  }
  if (a === "venues" && parts.length === 1) {
    return only("GET", () => {
      if (person !== undefined && by.scope === "person") return json(200, relay.venuesOf(person));
      const w = parseWho(by.speaker);
      if (by.scope !== "avatar" || w?.kind !== "avatar") return no(403, "person.only");
      return json(200, relay.joinedOf(w.id).map((v) => relay.venueView(v.owner, v.venue, w.id)).filter((v) => v !== undefined).map((v) => ({ ...v, as: w.id })));
    });
  }
  if (a === "groups" && parts.length === 1) return only("POST", () => answer(relay.createGroup(by, r.body), 201));
  if (a === "dms" && parts.length === 1) return only("POST", () => answer(relay.openDm(by, r.body), 201));
  if (a === "venues" && b !== undefined && c !== undefined && AVATAR_ID.test(b)) {
    if (parts.length === 3) {
      return only("GET", () => {
        const view = relay.venueView(b, c, str(r.query["as"]));
        const read = relay.read(by, b, `venues/${c}.geml`);
        if (!read.ok) return answer(read);
        return view === undefined ? no(404, "group.missing") : json(200, { venue: view, rules: relay.linkRulesOf(b, c), blocks: read.blocks });
      });
    }
    if (parts.length === 4 && d === "messages") return only("POST", () => { const x = relay.say(by, b, c, r.body); return answer(x, x.ok && x.existed ? 200 : 201); });
    if (parts.length === 4 && d === "members") return only("POST", () => answer(relay.addMember(by, b, c, r.body)));
    // 退出群 (S19): a member out; the 群主 names who keeps it; the last one, the group gone.
    if (parts.length === 4 && d === "leave") return only("POST", () => answer(relay.leaveVenue(by, b, c, r.body)));
    if (parts.length === 4 && d === "link") {
      if (m === "GET") return answer(relay.linkFor(by, b, c, { as: r.query["as"] }));
      return only("POST", () => answer(relay.rotateLink(by, b, c, r.body)));
    }
    if (parts.length === 4 && d === "link-rules") return only("POST", () => answer(relay.setLinkRules(by, b, c, r.body)));
    return no(404, "path.missing");
  }
  if (a === "requests" && b !== undefined && AVATAR_ID.test(b)) {
    if (parts.length === 2) {
      return only("GET", () => {
        const doc = relay.read(by, b, "requests.geml");
        if (!doc.ok && doc.code !== "doc.missing") return answer(doc);
        return json(200, relay.requestsOf(b));
      });
    }
    if (parts.length === 3 && c !== undefined) return only("POST", () => answer(relay.answerRequest(by, b, c, r.body)));
    return no(404, "path.missing");
  }
  // A document: /<avatar>/<doc>.geml
  if (parts.length >= 2 && a !== undefined) return only("GET", () => answer(relay.read(by, a, parts.slice(1).join("/"))));
  return no(404, "path.missing");
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
