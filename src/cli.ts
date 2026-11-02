#!/usr/bin/env node
// gemsbang — the plugin's bridge (`hook`: one JSON request on stdin, one
// answer on stdout) and, for development and tests, the service on this
// machine (`relay serve`). The service people use is https://gemsbang.com,
// the same relay in a Cloudflare Worker (src/relay/worker.ts).
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { answer } from "./gemsbang/bridge.js";
import { decodeRequest, type BridgeResponse } from "./hosts/claude-code/protocol.js";
import { startAvatarRelay } from "./relay/avatar-server.js";
import { commandMailer } from "./relay/mail.js";
import { commandTexter } from "./relay/text.js";

const USAGE = [
  "usage: gemsbang <hook|relay serve> ...",
  "  hook                                    the Claude Code bridge: one JSON request on stdin, one answer on stdout",
  "  relay serve [--root dir] [--port N] [--name host] [--host addr] [--public-url url] [--mail-command cmd] [--mail-from addr] [--text-command cmd]   the service on this machine: avatars, groups, links, the pages /i/<code>, /g/<group>, /login (root: ~/.gemsbang/relay; an email's code goes to <root>/_relay/mail/, a phone's to <root>/_relay/texts/, unless a command takes it: MAIL_TO and MAIL_SUBJECT, or TEXT_TO, in its environment, the text on stdin; --mail-from is who the mail says it comes from, the name unless given)",
].join("\n");

function fail(msg: string, code: 1 | 2): never {
  console.error(msg);
  process.exit(code);
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (value === undefined || value.startsWith("--")) fail(`${name} needs a value`, 2);
  return value;
}

/** The arguments that are not options; an option this verb does not know is a usage error. */
function positionals(verb: string, args: string[], valued: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (valued.includes(a)) { i++; continue; }
    if (a.startsWith("--")) fail(`gemsbang ${verb}: unknown option ${a}`, 2);
    out.push(a);
  }
  return out;
}

function packageVersion(): string {
  try { return (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string }).version ?? "unknown"; } catch { return "unknown"; }
}

/** `gemsbang hook`: one request on stdin, its answer as one line on stdout. */
async function runHook(): Promise<number> {
  process.stdin.setEncoding("utf8");
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  const req = decodeRequest(text);
  const res: BridgeResponse = "error" in req ? { v: 1, ok: false, error: req.error } : await answer(req);
  process.stdout.write(`${JSON.stringify(res)}\n`);
  return 0;
}

/** `gemsbang relay serve`: the service on this machine until it is stopped. */
async function serve(rest: string[]): Promise<number> {
  if (positionals("relay serve", rest, ["--root", "--port", "--name", "--host", "--public-url", "--mail-command", "--mail-from", "--text-command"]).length > 0) fail(USAGE, 2);
  const root = resolve(flag(rest, "--root") ?? join(homedir(), ".gemsbang", "relay"));
  const port = Number(flag(rest, "--port") ?? "7710");
  if (!Number.isInteger(port) || port < 0 || port > 65535) fail("gemsbang relay serve: --port needs a number from 0 to 65535", 2);
  const publicUrl = flag(rest, "--public-url");
  if (publicUrl !== undefined && !/^https?:\/\/[^/\s]+$/.test(publicUrl)) fail("gemsbang relay serve: --public-url is http(s)://host, with no path", 2);
  const host = flag(rest, "--host") ?? "127.0.0.1";
  const name = flag(rest, "--name") ?? "localhost";
  const text = flag(rest, "--text-command"), mail = flag(rest, "--mail-command"), mailFrom = flag(rest, "--mail-from");
  const s = await startAvatarRelay({ root, name, port, host, version: packageVersion(), ...(publicUrl !== undefined ? { publicUrl } : {}), ...(text !== undefined ? { texter: commandTexter(text) } : {}), ...(mail !== undefined ? { mailer: commandMailer(mail) } : {}), ...(mailFrom !== undefined ? { mailFrom } : {}) });
  console.log(`gemsbang relay ${name} listening on ${s.url} · documents under ${root}`);
  await new Promise<void>((done) => {
    const stop = (): void => { void s.close().then(done); };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  return 0;
}

const argv = process.argv.slice(2);
if (argv[0] === "hook") void runHook().then((code) => { process.exitCode = code; });
else if (argv[0] === "relay" && argv[1] === "serve") void serve(argv.slice(2)).then((code) => { process.exitCode = code; });
else fail(USAGE, 2);
