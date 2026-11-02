// The service as the client reaches it: one call over `fetch` with the
// person's or device's token. A network failure is `RelayDown`, whatever the
// call; an answer is its status and its body, parsed when it is JSON.

export class RelayDown extends Error {
  constructor(message: string) { super(message); this.name = "RelayDown"; }
}

export interface Answer { status: number; body: unknown }

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
}
