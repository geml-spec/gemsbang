// The least of RFC 6455 the relay's subscriptions need (transport §2.5),
// written here because the package depends on nothing but the parser: the
// accept key, text frames with the three length forms, the masking a client
// must apply and a server must not, ping answered with pong, close with a
// code. No fragmentation, no binary, no extensions: a frame of either closes
// the connection with 1003 (unsupported data).
import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export const acceptKey = (key: string): string => createHash("sha1").update(key + GUID).digest("base64");

export const TEXT = 0x1, CLOSE = 0x8, PING = 0x9, PONG = 0xa;

/** A server frame: final, unmasked, the payload's length in the shortest form that holds it. */
export function encodeFrame(text: string | Buffer, opcode = TEXT): Buffer {
  const data = typeof text === "string" ? Buffer.from(text, "utf8") : text;
  const len = data.length;
  let head: Buffer;
  if (len < 126) head = Buffer.from([0x80 | opcode, len]);
  else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | opcode; head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x80 | opcode; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([head, data]);
}

export interface Frame { fin: boolean; opcode: number; payload: Buffer }

/** The frame at the front of the buffer and what follows it, or undefined while it is not whole yet. */
export function decodeFrame(buf: Buffer): { frame: Frame; rest: Buffer } | undefined {
  if (buf.length < 2) return undefined;
  const b0 = buf[0]!, b1 = buf[1]!;
  const fin = (b0 & 0x80) !== 0, opcode = b0 & 0x0f, isMasked = (b1 & 0x80) !== 0;
  let len = b1 & 0x7f, at = 2;
  if (len === 126) { if (buf.length < 4) return undefined; len = buf.readUInt16BE(2); at = 4; }
  else if (len === 127) {
    if (buf.length < 10) return undefined;
    const big = buf.readBigUInt64BE(2);
    if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("frame too long");
    len = Number(big); at = 10;
  }
  const maskLen = isMasked ? 4 : 0;
  if (buf.length < at + maskLen + len) return undefined;
  const mask = isMasked ? buf.subarray(at, at + 4) : undefined;
  at += maskLen;
  const payload = Buffer.from(buf.subarray(at, at + len));
  if (mask !== undefined) for (let i = 0; i < payload.length; i++) payload[i] = payload[i]! ^ mask[i % 4]!;
  return { frame: { fin, opcode, payload }, rest: buf.subarray(at + len) };
}

/** One upgraded connection: text out with `send`, text in through `onMessage`, the close code through `onClose`. */
export class WsConnection {
  private buffer: Buffer = Buffer.alloc(0);
  private messageHandlers: ((text: string) => void)[] = [];
  private closeHandlers: ((code: number) => void)[] = [];
  private closed = false;

  constructor(private readonly socket: Duplex, head: Buffer) {
    socket.on("data", (chunk: Buffer) => this.feed(chunk));
    socket.on("close", () => this.finish(1006));
    socket.on("error", () => this.finish(1006));
    if (head.length > 0) this.feed(head);
  }

  onMessage(fn: (text: string) => void): void { this.messageHandlers.push(fn); }
  onClose(fn: (code: number) => void): void { this.closeHandlers.push(fn); }

  send(text: string): void { if (!this.closed) this.socket.write(encodeFrame(text)); }

  /** Close with a code (1000 by default): a close frame, then the socket. */
  close(code = 1000): void {
    if (this.closed) return;
    const payload = Buffer.alloc(2);
    payload.writeUInt16BE(code);
    try { this.socket.write(encodeFrame(payload, CLOSE)); } catch { /* the socket is already gone */ }
    this.socket.end();
    this.finish(code);
  }

  private finish(code: number): void {
    if (this.closed) return;
    this.closed = true;
    for (const fn of this.closeHandlers) fn(code);
  }

  private feed(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      let got: ReturnType<typeof decodeFrame>;
      try { got = decodeFrame(this.buffer); } catch { this.close(1009); return; }
      if (got === undefined) return;
      this.buffer = got.rest;
      const { frame } = got;
      if (!frame.fin || frame.opcode === 0x0 || frame.opcode === 0x2) { this.close(1003); return; }
      if (frame.opcode === PING) { if (!this.closed) this.socket.write(encodeFrame(frame.payload, PONG)); continue; }
      if (frame.opcode === PONG) continue;
      if (frame.opcode === CLOSE) { this.close(frame.payload.length >= 2 ? frame.payload.readUInt16BE(0) : 1000); return; }
      if (frame.opcode === TEXT) { const text = frame.payload.toString("utf8"); for (const fn of this.messageHandlers) fn(text); continue; }
      this.close(1003);
      return;
    }
  }
}

/** Accept an upgrade request as a WebSocket, or answer 400 and give nothing back. */
export function upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): WsConnection | undefined {
  const key = req.headers["sec-websocket-key"];
  const version = req.headers["sec-websocket-version"];
  if (typeof key !== "string" || version !== "13" || !/websocket/i.test(String(req.headers["upgrade"] ?? ""))) {
    socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return undefined;
  }
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`);
  return new WsConnection(socket, head);
}
