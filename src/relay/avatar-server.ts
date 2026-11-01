// `node:http` around gemsbang's relay (transport §2.5, §7.1): a browser at
// `/i/<code>`, `/g/<group>` or `/login` gets the page (avatar-pages.ts), in
// its language; everything else is the JSON of avatar-api.ts, a body of at
// most a megabyte, the token from the Authorization header or the query.
// `GET /subscribe` is upgraded to a WebSocket whose client names the
// documents it follows (`{"subscribe": "<avatar>/<doc>"}`): each block is
// pushed as it lands, as the client may read it — a venue's to its members,
// a message's `by` left out where its avatar does not mark.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { JSON_TYPE, langOf, refusal, routeAvatars, type AvatarRequest } from "./avatar-api.js";
import { groupPage, HTML_TYPE, joinPage, loginPage } from "./avatar-pages.js";
import { AvatarRelay, type AvatarRelayOptions } from "./avatars.js";
import { AvatarHosted, type HostedRunner } from "./avatar-hosted.js";
import { fileAdapter, type PushAdapter } from "./push.js";
import { upgrade, type WsConnection } from "./ws.js";
import type { Lang } from "../core/avatar/words.js";

export interface AvatarServer { port: number; url: string; relay: AvatarRelay; hosted?: AvatarHosted; close(): Promise<void> }

/** A request body may be this long: a message, never a file's bytes. */
export const BODY_LIMIT = 1_048_576;

/** The pages by path, for a browser (`Accept: text/html`); a script at the same path gets the JSON. */
const PAGES: readonly [RegExp, (lang: Lang) => string][] = [[/^\/i\/[a-z0-9]{1,16}$/, joinPage], [/^\/g\/[gd]-[0-9a-f]{10}$/, groupPage], [/^\/login$/, loginPage]];

function readBody(req: IncomingMessage): Promise<string | undefined> {
  return new Promise((done, failed) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => { size += c.length; if (size <= BODY_LIMIT) chunks.push(c); });
    req.on("end", () => done(size > BODY_LIMIT ? undefined : Buffer.concat(chunks).toString("utf8")));
    req.on("error", failed);
  });
}

function tokenOf(req: IncomingMessage, url: URL): string | undefined {
  const auth = req.headers["authorization"];
  const m = typeof auth === "string" ? /^Bearer\s+(\S+)$/i.exec(auth) : null;
  return m?.[1] ?? url.searchParams.get("token") ?? undefined;
}

function reply(res: ServerResponse, status: number, body: string, type: string): void {
  res.writeHead(status, { "content-type": type, "content-length": Buffer.byteLength(body) });
  res.end(body);
}

/** How often the relay expires 需要你 cards and collects answers from its push channels. */
export const SWEEP_MS = 30_000;

export function startAvatarRelay(o: AvatarRelayOptions & { port?: number; host?: string; publicUrl?: string; version?: string; hosted?: { runner: HostedRunner; days?: number; replies?: number } }): Promise<AvatarServer> {
  // The file channel unless the operator gave others (spec §7.3: the outlet first, real channels later).
  const push: PushAdapter[] = o.push ?? [fileAdapter(o.root)];
  const relay = new AvatarRelay({ ...o, push });
  // The hosted bodies (transport §6), awake to every chat while the server runs.
  const hosted = o.hosted === undefined ? undefined : new AvatarHosted({ relay, runner: o.hosted.runner, ...(o.hosted.days !== undefined ? { days: o.hosted.days } : {}), ...(o.hosted.replies !== undefined ? { replies: o.hosted.replies } : {}), log: (line) => console.error(`hosted: ${line}`) });
  hosted?.start();
  const sweep = setInterval(() => { try { relay.sweep(); void relay.collectPush().catch(() => undefined); void hosted?.tick().catch(() => undefined); } catch { /* the next round */ } }, SWEEP_MS);
  sweep.unref();
  const host = o.host ?? "127.0.0.1";
  const subscribers = new Map<WsConnection, { token: string; docs: Set<string> }>();
  const off = relay.onAppend(({ owner, doc, block }) => {
    const key = `${owner}/${doc}`;
    for (const [conn, s] of subscribers) {
      if (!s.docs.has(key)) continue;
      const by = relay.verify(s.token);
      const read = by === undefined ? undefined : relay.read(by, owner, doc);
      const seen = read?.ok === true ? read.blocks.find((b) => b.id === block.id) : undefined;
      if (seen !== undefined) conn.send(JSON.stringify({ doc: key, block: seen }));
    }
  });

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://relay");
      const languages = typeof req.headers["accept-language"] === "string" ? req.headers["accept-language"] : undefined;
      const query = Object.fromEntries(url.searchParams);
      try {
        const page = (req.method ?? "GET").toUpperCase() === "GET" && /text\/html/.test(String(req.headers["accept"] ?? "")) ? PAGES.find(([re]) => re.test(url.pathname)) : undefined;
        if (page !== undefined) { reply(res, 200, page[1](langOf({ query, ...(languages !== undefined ? { languages } : {}) })), HTML_TYPE); return; }
        const text = await readBody(req);
        const lang = langOf({ query, ...(languages !== undefined ? { languages } : {}) });
        if (text === undefined) { const r = refusal(413, "body.tooLarge", lang); reply(res, r.status, r.body, r.type); return; }
        let body: unknown;
        if (text !== "") {
          try { body = JSON.parse(text); } catch { const r = refusal(400, "body.notJson", lang); reply(res, r.status, r.body, r.type); return; }
        }
        const token = tokenOf(req, url);
        const base = o.publicUrl ?? `http://${req.headers["host"] ?? `${host}`}`;
        const r: AvatarRequest = { method: req.method ?? "GET", path: url.pathname, query, base, ...(o.version !== undefined ? { version: o.version } : {}), ...(languages !== undefined ? { languages } : {}), ...(req.socket.remoteAddress !== undefined ? { ip: req.socket.remoteAddress } : {}), ...(token !== undefined ? { token } : {}), ...(body !== undefined ? { body } : {}) };
        const out = routeAvatars(r, relay, hosted);
        reply(res, out.status, out.body, out.type);
      } catch (e) {
        const r = refusal(500, "server.error", langOf({ query }), { detail: e instanceof Error ? e.message : String(e) });
        reply(res, r.status, r.body, JSON_TYPE);
      }
    })();
  });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://relay");
    if (url.pathname !== "/subscribe") { socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n"); socket.destroy(); return; }
    const token = tokenOf(req, url);
    if (token === undefined || relay.verify(token) === undefined) { socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n"); socket.destroy(); return; }
    const conn = upgrade(req, socket, head);
    if (conn === undefined) return;
    const sub = { token, docs: new Set<string>() };
    subscribers.set(conn, sub);
    conn.onMessage((text) => {
      let msg: unknown;
      try { msg = JSON.parse(text); } catch { conn.send(JSON.stringify({ error: "body.notJson" })); return; }
      const m = typeof msg === "object" && msg !== null ? (msg as Record<string, unknown>) : {};
      if (typeof m["subscribe"] === "string") {
        const key = m["subscribe"], slash = key.indexOf("/");
        const owner = slash === -1 ? "" : key.slice(0, slash), doc = slash === -1 ? "" : key.slice(slash + 1);
        const by = relay.verify(token);
        if (by !== undefined && relay.mayFollow(by, owner, doc)) { sub.docs.add(key); conn.send(JSON.stringify({ subscribed: key })); }
        else conn.send(JSON.stringify({ error: "doc.denied", subscribe: key }));
      } else if (m["ping"] !== undefined) conn.send(JSON.stringify({ pong: m["ping"] }));
      else conn.send(JSON.stringify({ error: "path.missing" }));
    });
    conn.onClose(() => { subscribers.delete(conn); });
  });

  return new Promise((done, failed) => {
    server.once("error", failed);
    server.listen(o.port ?? 0, host, () => {
      const port = (server.address() as AddressInfo).port;
      done({
        port, url: `http://${host}:${port}`, relay, ...(hosted !== undefined ? { hosted } : {}),
        close: () => new Promise((closed) => {
          hosted?.stop();
          clearInterval(sweep);
          off();
          for (const c of subscribers.keys()) c.close();
          server.closeAllConnections();
          server.close(() => closed());
        }),
      });
    });
  });
}
