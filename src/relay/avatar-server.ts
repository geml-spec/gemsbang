// `node:http` around gemsbang's relay (transport §2.5, §7.1; architecture
// §2.4: a company's own servers and local work), its documents on files.
// `GET /subscribe` is upgraded to a WebSocket whose client names the
// documents it follows (`{"subscribe": "<avatar>/<doc>"}`): each block is
// pushed as it lands, as the client may read it — a venue's to its members,
// a message's `by` left out where its avatar does not mark. What it answers
// is avatar-shell.ts's, the same core the Worker's Durable Object runs.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { answerRequest, BODY_LIMIT } from "./avatar-shell.js";
import { AvatarRelay, type AvatarRelayOptions } from "./avatars.js";
import { fileAdapter, type PushAdapter } from "./push.js";
import { upgrade, type WsConnection } from "./ws.js";

export interface AvatarServer { port: number; url: string; relay: AvatarRelay; close(): Promise<void> }

export { BODY_LIMIT };

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

/** The Node shell keeps the relay on files under `root`. */
export function startAvatarRelay(o: AvatarRelayOptions & { root: string; port?: number; host?: string; publicUrl?: string; version?: string }): Promise<AvatarServer> {
  // The file channel unless the operator gave others (spec §7.3: the outlet first, real channels later).
  const push: PushAdapter[] = o.push ?? [fileAdapter(o.root)];
  const relay = new AvatarRelay({ ...o, push, ...(o.publicUrl !== undefined && o.origin === undefined ? { origin: o.publicUrl } : {}) });
  const sweep = setInterval(() => { try { relay.sweep(); void relay.collectPush().catch(() => undefined); } catch { /* the next round */ } }, SWEEP_MS);
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
      const header = (name: string): string | undefined => (typeof req.headers[name] === "string" ? req.headers[name] : undefined);
      const out = await answerRequest(relay, {
        method: req.method ?? "GET", url, base: o.publicUrl ?? `http://${req.headers["host"] ?? host}`, body: () => readBody(req),
        gone: new Promise<void>((done) => { res.once("close", () => done()); }),
        ...(header("accept") !== undefined ? { accept: header("accept")! } : {}), ...(header("accept-language") !== undefined ? { languages: header("accept-language")! } : {}),
        ...(header("authorization") !== undefined ? { authorization: header("authorization")! } : {}), ...(req.socket.remoteAddress !== undefined ? { ip: req.socket.remoteAddress } : {}), ...(o.version !== undefined ? { version: o.version } : {}),
      });
      if (!res.destroyed) reply(res, out.status, out.body, out.type);
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
      relay.useOrigin(`http://${host}:${port}`);
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
