import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { acceptKey, decodeFrame, encodeFrame, upgrade } from "../dist/relay/ws.js";

/** A client's frame: masked, as RFC 6455 §5.1 demands of a client. */
function masked(text, opcode = 1) {
  const data = Buffer.from(text, "utf8");
  const mask = Buffer.from([1, 2, 3, 4]);
  const len = data.length;
  const head = len < 126 ? Buffer.from([0x80 | opcode, 0x80 | len]) : len < 65536 ? Buffer.concat([Buffer.from([0x80 | opcode, 0x80 | 126]), (() => { const b = Buffer.alloc(2); b.writeUInt16BE(len); return b; })()]) : Buffer.concat([Buffer.from([0x80 | opcode, 0x80 | 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(len)); return b; })()]);
  return Buffer.concat([head, mask, Buffer.from(data.map((x, i) => x ^ mask[i % 4]))]);
}

test("the accept key is RFC 6455's example", () => {
  assert.equal(acceptKey("dGhlIHNhbXBsZSBub25jZQ=="), "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
});

test("frames encode unmasked with 7-, 16- and 64-bit lengths and decode masked ones, whole or not yet", () => {
  for (const text of ["hi", "x".repeat(125), "y".repeat(126), "z".repeat(65535), "w".repeat(65536), "中文"]) {
    const f = encodeFrame(text);
    assert.equal(f[0], 0x81, "fin, text");
    assert.equal(f[1] & 0x80, 0, "a server frame is not masked");
    const back = decodeFrame(f);
    assert.deepEqual([back.frame.fin, back.frame.opcode, back.frame.payload.toString("utf8"), back.rest.length], [true, 1, text, 0]);
    const m = decodeFrame(masked(text));
    assert.equal(m.frame.payload.toString("utf8"), text, "unmasked on the way in");
  }
  const two = Buffer.concat([masked("a"), masked("b")]);
  const first = decodeFrame(two);
  assert.equal(first.frame.payload.toString(), "a");
  assert.equal(decodeFrame(first.rest).frame.payload.toString(), "b");
  assert.equal(decodeFrame(masked("hello").subarray(0, 4)), undefined, "not whole yet");
  assert.equal(decodeFrame(Buffer.alloc(1)), undefined);
  assert.equal(encodeFrame("", 0x8)[0], 0x88, "a close frame");
  assert.equal(decodeFrame(masked("", 0x9)).frame.opcode, 9, "a ping");
});

test("a connection over a real upgrade: text in and out, a ping answered with a pong, a binary frame closed with 1003", async () => {
  const seen = [];
  let closed = null;
  const server = createServer((_req, res) => { res.writeHead(404); res.end(); });
  server.on("upgrade", (req, socket, head) => {
    const conn = upgrade(req, socket, head);
    if (conn === undefined) return;
    conn.onMessage((text) => { seen.push(text); conn.send(`echo ${text}`); });
    conn.onClose((code) => { closed = code; });
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const port = server.address().port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/x`);
  const got = [];
  const next = () => new Promise((done) => { ws.addEventListener("message", (e) => done(e.data), { once: true }); });
  await new Promise((done, failed) => { ws.addEventListener("open", done, { once: true }); ws.addEventListener("error", failed, { once: true }); });
  ws.send("你好");
  got.push(await next());
  ws.send("again");
  got.push(await next());
  assert.deepEqual(got, ["echo 你好", "echo again"]);
  assert.deepEqual(seen, ["你好", "again"]);
  const closedEvent = new Promise((done) => { ws.addEventListener("close", (e) => done(e.code), { once: true }); });
  ws.send(new Uint8Array([1, 2, 3]));
  assert.equal(await closedEvent, 1003);
  await new Promise((done) => setTimeout(done, 50));
  assert.equal(closed, 1003);
  await new Promise((done) => server.close(done));
});
