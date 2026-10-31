// The relay as the daemon reaches it (transport §2.5): the three channels
// over the global `fetch` and `WebSocket`, with one token. A network failure
// is `RelayDown`, whatever the call; an answer is its status and its body,
// parsed when it is JSON. The typed calls throw on a status they cannot use,
// with the relay's own reason.
import type { Visible } from "../relay/relay.js";

export class RelayDown extends Error {
  constructor(message: string) { super(message); this.name = "RelayDown"; }
}

export interface Answer { status: number; body: unknown }

/** The relay's reason for an answer, or its status when it gave none. */
export function reasonOf(a: Answer): string {
  const b = a.body as { error?: unknown } | null;
  return typeof b === "object" && b !== null && typeof b.error === "string" ? b.error : `HTTP ${a.status}`;
}

export interface VenueRow { owner: string; id: string; kind: string; name: string }

export class RelayClient {
  constructor(readonly url: string, readonly token?: string, private readonly fetchImpl: typeof fetch = fetch) {}

  async call(method: string, path: string, body?: unknown, accept?: string): Promise<Answer> {
    const headers: Record<string, string> = {};
    if (this.token !== undefined) headers["authorization"] = `Bearer ${this.token}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    if (accept !== undefined) headers["accept"] = accept;
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.url}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    } catch (e) {
      throw new RelayDown(`连不上中继 ${this.url}：${e instanceof Error ? e.message : String(e)}`);
    }
    const text = await res.text();
    let parsed: unknown = text;
    if ((res.headers.get("content-type") ?? "").startsWith("application/json")) { try { parsed = JSON.parse(text); } catch { parsed = text; } }
    return { status: res.status, body: parsed };
  }

  get(path: string, accept?: string): Promise<Answer> { return this.call("GET", path, undefined, accept); }
  post(path: string, body: unknown): Promise<Answer> { return this.call("POST", path, body); }

  /** A call that must answer 200 with JSON; anything else is an error carrying the relay's reason. */
  private async expect<T>(a: Promise<Answer>): Promise<T> {
    const r = await a;
    if (r.status !== 200) throw new Error(reasonOf(r));
    return r.body as T;
  }

  root(): Promise<{ name: string; version: string; federation: string }> { return this.expect(this.get("/")); }
  me(): Promise<{ speaker: string; scope: string; id: string }> { return this.expect(this.get("/me")); }
  venues(): Promise<VenueRow[]> { return this.expect(this.get("/venues")); }
  agents(): Promise<string[]> { return this.expect(this.get("/agents")); }
  /** The task cards the person is on (§8), as the relay lists them. */
  tasks(): Promise<{ owner: string; id: string; title: string; state: string; direction: string; role: string }[]> { return this.expect(this.get("/tasks")); }
  inbox(): Promise<unknown[]> { return this.expect(this.get("/inbox")); }

  /** The document as the relay renders it for this token, or undefined when there is none. */
  async readGeml(owner: string, doc: string): Promise<string | undefined> {
    const r = await this.get(`/${encodeURIComponent(owner)}/${doc.split("/").map(encodeURIComponent).join("/")}?format=geml`, "text/plain");
    if (r.status === 404) return undefined;
    if (r.status !== 200) throw new Error(reasonOf(r));
    return String(r.body);
  }

  append(owner: string, doc: string, body: unknown): Promise<Answer> { return this.post(`/${encodeURIComponent(owner)}/${doc.split("/").map(encodeURIComponent).join("/")}`, body); }
  presence(body: unknown): Promise<Answer> { return this.post("/presence", body); }

  /** Follow documents (`<owner>/<doc>`): their blocks as they land, and the close with why. The caller closes the socket. */
  subscribe(docs: readonly string[], o: { onBlock: (doc: string, block: Visible) => void; onOpen?: () => void; onClose?: (why: string) => void }): WebSocket {
    const ws = new WebSocket(`${this.url.replace(/^http/, "ws")}/subscribe?token=${encodeURIComponent(this.token ?? "")}`);
    let told = false;
    const closed = (why: string): void => { if (told) return; told = true; o.onClose?.(why); };
    ws.addEventListener("open", () => { for (const d of docs) ws.send(JSON.stringify({ subscribe: d })); o.onOpen?.(); });
    ws.addEventListener("message", (e) => {
      let m: unknown;
      try { m = JSON.parse(String(e.data)); } catch { return; }
      const r = m as { doc?: unknown; block?: unknown } | null;
      if (r !== null && typeof r === "object" && typeof r.doc === "string" && typeof r.block === "object" && r.block !== null) o.onBlock(r.doc, r.block as Visible);
    });
    ws.addEventListener("close", (e) => closed(`closed ${e.code}`));
    ws.addEventListener("error", () => closed("error"));
    return ws;
  }
}
