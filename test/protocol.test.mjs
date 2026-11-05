import { test } from "node:test";
import assert from "node:assert/strict";
import { PROTOCOL_VERSION, decodeRequest, decodeResponse, encodeRequest, unreadableText } from "../dist/hosts/claude-code/protocol.js";

test("requests: one JSON line, one call of the client by name with its arguments; the CLI refuses what it cannot run", () => {
  const req = { v: 1, call: "say", args: { venue: "a-1/g-1", text: "确定" } };
  assert.equal(encodeRequest(req), `${JSON.stringify(req)}\n`);
  assert.deepEqual(decodeRequest(encodeRequest(req)), req);
  assert.deepEqual(decodeRequest('{"v":1,"call":"status"}'), { v: 1, call: "status" }, "no arguments");
  assert.deepEqual(decodeRequest('{"v":1,"call":"status","root":"/r","op":"gb"}'), { v: 1, call: "status" }, "what else it carries is not read");
  assert.deepEqual(decodeRequest("nope"), { error: "the request is not JSON" });
  assert.deepEqual(decodeRequest("[1]"), { error: "the request is not an object" });
  assert.deepEqual(decodeRequest('{"v":2,"call":"status"}'), { error: "protocol version 2; this CLI speaks 1" });
  assert.deepEqual(decodeRequest('{"v":1}'), { error: "call is required" });
  assert.deepEqual(decodeRequest('{"v":1,"call":""}'), { error: "call is required" });
  for (const args of ['["x"]', "null", '"x"']) assert.deepEqual(decodeRequest(`{"v":1,"call":"setup","args":${args}}`), { error: "args is an object" }, args);
});

test("answers: the last line that parses as this protocol's version", () => {
  const ok = { v: PROTOCOL_VERSION, ok: true, gb: { ok: true } };
  assert.deepEqual(decodeResponse(`noise\n${JSON.stringify(ok)}\n`), ok);
  assert.deepEqual(decodeResponse(`${JSON.stringify(ok)}\n{"v":1,"ok":false,"error":"x"}\n`), { v: 1, ok: false, error: "x" });
  assert.equal(decodeResponse('{"v":9,"ok":true}\n'), undefined);
  assert.equal(decodeResponse(""), undefined);
});

test("an answer that did not parse: stderr's error line, and the build to run when a module is missing", () => {
  const missing = "node:internal/modules/cjs/loader:1479\n  throw err;\n  ^\n\nError: Cannot find module '/plugin/dist/gemsbang.mjs'\n    at Module._resolveFilename (node:internal/modules/cjs/loader:1476:15)\n";
  assert.equal(unreadableText(1, missing, "/plugin"),
    "GemsBang：没有构建 — 在 /plugin 运行 npm run build（Error: Cannot find module '/plugin/dist/gemsbang.mjs'）");
  assert.equal(unreadableText(1, "Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@geml/geml' imported from /plugin/dist/gemsbang.mjs\n", "/plugin"),
    "GemsBang：没有构建 — 在 /plugin 运行 npm run build（Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@geml/geml' imported from /plugin/dist/gemsbang.mjs）");
  assert.equal(unreadableText(1, "file:///plugin/dist/gemsbang.mjs:3\n    at x\nTypeError: x is not a function\n", "/plugin"),
    "GemsBang：应答无法解析（退出码 1：TypeError: x is not a function）");
  assert.equal(unreadableText(134, "Aborted\n", "/plugin"), "GemsBang：应答无法解析（退出码 134：Aborted）", "no error line: the first line");
  assert.equal(unreadableText(0, "", "/plugin"), "GemsBang：应答无法解析（退出码 0）");
});
