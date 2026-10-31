// `node:http` around the relay (transport §2.5): JSON requests routed by
// api.ts (the guest page at /c/<id> for a browser), a body of at most a megabyte, the token from the Authorization
// header or the query, and `GET /subscribe` upgraded to a WebSocket whose
// client names the documents it follows — each pushed as its blocks land,
// visible or a stub by the same rule as a read.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { canRead } from "./access.js";
import { JSON_TYPE, route, type ApiRequest } from "./api.js";
import { HTML_TYPE, sharePage } from "./page.js";
import { Relay, type RelayOptions } from "./relay.js";
import { upgrade, type WsConnection } from "./ws.js";

export interface RelayServer { port: number; url: string; relay: Relay; close(): Promise<void> }

/** A request body may be this long: a message, a card, never a package's bytes (§2.1). */
export const BODY_LIMIT = 1_048_576;

/** The body, or undefined when it ran over the limit (read to its end all the same, so the answer reaches the client). */
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

export function startRelay(o: RelayOptions & { port?: number; host?: string }): Promise<RelayServer> {
  const relay = new Relay(o);
  const host = o.host ?? "127.0.0.1";
  const subscribers = new Map<WsConnection, { speaker: string; docs: Set<string> }>();
  const off = relay.onAppend(({ owner, doc, block }) => {
    const key = `${owner}/${doc}`;
    const w = relay.world();
    for (const [conn, s] of subscribers) {
      if (!s.docs.has(key)) continue;
      const visible = canRead({ relay: relay.name, owner, doc, block: block.id, viewer: s.speaker }, w) ? { id: block.id, value: block.value } : { id: block.id, stub: relay.stubOf(owner, block) };
      conn.send(JSON.stringify({ doc: key, block: visible }));
    }
  });

  const server = createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? "/", "http://relay");
        // A browser at a card's address gets the page (transport §7.1); a script asking for JSON gets the card from the API below.
        if ((req.method ?? "GET").toUpperCase() === "GET" && /^\/c\/[^/]+$/.test(url.pathname) && /text\/html/.test(String(req.headers["accept"] ?? ""))) { reply(res, 200, sharePage(), HTML_TYPE); return; }
        const text = await readBody(req);
        if (text === undefined) { reply(res, 413, JSON.stringify({ error: "正文超过 1 MB" }), JSON_TYPE); return; }
        let body: unknown;
        if (text !== "") {
          try { body = JSON.parse(text); } catch { reply(res, 400, JSON.stringify({ error: "正文不是 JSON" }), JSON_TYPE); return; }
        }
        const token = tokenOf(req, url);
        const r: ApiRequest = { method: req.method ?? "GET", path: url.pathname, query: Object.fromEntries(url.searchParams), ...(req.socket.remoteAddress !== undefined ? { ip: req.socket.remoteAddress } : {}), ...(token !== undefined ? { token } : {}), ...(body !== undefined ? { body } : {}), ...(/text\/plain/.test(String(req.headers["accept"] ?? "")) ? { geml: true } : {}) };
        const out = route(r, relay);
        reply(res, out.status, out.body, out.type);
      } catch (e) {
        reply(res, 500, JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), JSON_TYPE);
      }
    })();
  });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://relay");
    if (url.pathname !== "/subscribe") { socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n"); socket.destroy(); return; }
    const token = tokenOf(req, url);
    const by = token === undefined ? undefined : relay.verify(token);
    if (by === undefined) { socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n"); socket.destroy(); return; }
    const conn = upgrade(req, socket, head);
    if (conn === undefined) return;
    const sub = { speaker: by.speaker, docs: new Set<string>() };
    subscribers.set(conn, sub);
    conn.onMessage((text) => {
      let msg: unknown;
      try { msg = JSON.parse(text); } catch { conn.send(JSON.stringify({ error: "JSON 不合法" })); return; }
      const m = typeof msg === "object" && msg !== null ? (msg as Record<string, unknown>) : {};
      if (typeof m["subscribe"] === "string") {
        const key = m["subscribe"];
        const slash = key.indexOf("/");
        const owner = slash === -1 ? "" : key.slice(0, slash), doc = slash === -1 ? "" : key.slice(slash + 1);
        if (owner !== "" && doc !== "" && relay.mayFollow(owner, doc, by.speaker)) { sub.docs.add(key); conn.send(JSON.stringify({ subscribed: key })); }
        else conn.send(JSON.stringify({ error: "无权或没有这份文档" }));
      } else if (m["ping"] !== undefined) conn.send(JSON.stringify({ pong: m["ping"] }));
      else conn.send(JSON.stringify({ error: "不认识这条消息" }));
    });
    conn.onClose(() => { subscribers.delete(conn); });
  });

  // The minute's sweep (§8.2): a worker silent past the limit has its card given back; the stuck entries need no sweep, the inbox computes them.
  const sweep = setInterval(() => { try { relay.tick(); } catch { /* next minute */ } }, 60_000);
  sweep.unref();
  return new Promise((done, failed) => {
    server.once("error", failed);
    server.listen(o.port ?? 0, host, () => {
      const port = (server.address() as AddressInfo).port;
      done({
        port, url: `http://${host}:${port}`, relay,
        close: () => new Promise((closed) => {
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
