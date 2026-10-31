#!/usr/bin/env node
// gemworks — offline verbs over workflows and journals, the project verbs a
// person uses beside an agent (init, use, status, mark, unmark, advance,
// rollback), and `run`, which is the one verb that reaches outside this
// package (it starts dsh).
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { exists, readText, realPath, writeAtomic } from "./host-fs.js";
import { FLOW_FILE, GEML_DIR, WORKFLOWS_DIR } from "./core/layout.js";
import { run as runTask } from "./hosts/dsh/launch.js";
import { loadStatechart, hasErrors, type FlowDiagnostic } from "./core/statechart.js";
import { TOOLS_FILE } from "./core/dictionary.js";
import { readDictionary } from "./core/dictionary-file.js";
import { dictionaryPathOf, homeOf, installedWorkflows, migrateLayout } from "./project-home.js";
import { NO_TOOLS } from "./core/host-tools.js";
import { readJournal, renderJournalMarkdown, verifyJournal } from "./core/journal.js";
import { canonical } from "./core/snapshot.js";
import { addWorkflow, useWorkflow, type Added } from "./project.js";
import { handleRequest } from "./bridge.js";
import { runCodex } from "./codex.js";
import { installAntigravity, runAntigravity } from "./antigravity.js";
import { serveMcp } from "./mcp.js";
import { startRelay } from "./relay/server.js";
import { commandMailer } from "./relay/mail.js";
import { commandRunner } from "./relay/hosted.js";
import { Bridge } from "./phone/bridge.js";
import { TelegramTransport } from "./phone/telegram.js";
import { performanceLine, signalFaults, signalInput, signalText, type Performance, type Signal } from "./core/im/signal.js";
import { canAdvance, execLine, localRecord, riskOf, stageLines, STAGE_WORDS, type Risk } from "./core/im/risk.js";
import { priceWords, type ChannelPrice } from "./core/im/venue.js";
import { readExec, readRisk, writeRisk } from "./daemon/exec.js";
import { publishSignal, retractSignal } from "./daemon/deliver.js";
import { MODE_WORDS, type SocialMode } from "./core/im/social.js";
import { Relay } from "./relay/relay.js";
import { RelayClient, reasonOf } from "./daemon/client.js";
import { DIRECTION_WORDS, STATE_WORDS, VERIFY_WORDS, waitingOn, type Card, type VerifyKind } from "./core/im/card.js";
import { homeDir, listOutbox, readConfig, readState, writeConfig } from "./daemon/home.js";
import { Daemon } from "./daemon/sync.js";
import { decodeRequest, type BridgeResponse } from "./hosts/claude-code/protocol.js";
import { docReader, openWorkspace, resolvePromptRef, resolveWorkflow, type Workspace } from "./workspace.js";

const USAGE = [
  "usage: gemworks <check|snapshot|verify|export|init|use|migrate|status|mark|unmark|advance|pause|resume|rollback|run|hook|mcp|relay|connect> ...",
  "  check <workflow.geml>                   static checks of the workflow and its tool dictionary (exit 1 on errors)",
  "  snapshot <journal.geml> [--json]        the last revision",
  "  verify <journal.geml> [--workflow f]    hash chain and consistency",
  "  export <journal.geml> --to md           revision table with per-step diffs",
  "  init [dir] [--template coding|dev|matter|video] [--no-activate]  write a bundled workflow into .geml/workflows/",
  "  use <workflow>                          make a workflow the default for new work items",
  "  migrate                                 move the earlier layout (a workflow directory in the checkout) into the project's home",
  "  status [--json]                         the work item, the stage, its variables and next steps",
  "  mark <variable> | unmark <variable>     a person ticks or clears a variable whose source is a person",
  "  advance <state>                         a person moves the workflow",
  "  pause | resume                          a person holds the work item (evidence is recorded, nothing moves) or lets it go",
  "  rollback [<rev>|checkpoint]             a person restores an earlier revision's state and variables",
  "  run [--profile name] <task>             add the bundle to a dsh profile and run the task there",
  "  hook                                    the Claude Code bridge: one JSON request on stdin, one answer on stdout",
  "  codex                                   the Codex hook: one event on stdin, its answer on stdout (exit 0 always)",
  "  antigravity <Event> | install           the Antigravity editor's hook (one event on stdin), or put its hooks and MCP server in place",
  "  mcp [--host h] [--root dir]             the three model tools over stdio MCP (host default: mcp)",
  "  relay [--root dir] [--port N] [--name host] [--host addr] [--federation open|closed] [--free-credits N] [--mail-command cmd]  the IM relay, until it is stopped (root: ~/.gemworks/relay; login codes go to <root>/_relay/mail/ unless a command takes them: MAIL_TO and MAIL_SUBJECT in its environment, the text on stdin)",
  "  relay … [--hosted-command cmd] [--hosted-credits N]   also run the hosted agents' rounds (transport §6): the command gets the prompt on stdin and HOSTED_* in its environment, answers on stdout; a round costs the owner N credits (1)",
  "  relay token <person> [--root dir]       issue a person's token on that relay and print it",
  "  relay topup <person> <credits> [--note s] [--root dir]   credit a person's wallet on that relay (the platform's top-up, §9.1) and print the balance",
  "  relay price <market> <price> [--at iso] [--root dir]   a price point from a public source, on the relay's chain (§10.3)",
  "  connect [--home dir] [--once]           the IM daemon: mirror the relay, push the outbox, heartbeat (home: ~/.gemworks/im)",
  "  connect setup --relay <url> --token <t> | agent <name> --token <t> | status   set the daemon up, add an agent's token, say where it stands",
  "  connect adopt <agent>                    搬家 (transport §6): the hosted agent's token into connect.json, its workspace's files under the home; the account and the queue stay",
  "  connect phone-code                       a one-time code to bind the phone's bot with (transport §7.2)",
  "  phone --relay <url> --telegram-token <t> [--home dir] [--poll N]   the phone bridge: a Telegram bot mirroring the inbox, bound chat by chat with the code; N seconds between looks (15)",
  "  connect share --title <t> --agent <a> --scope <s> [--summary s] [--drafted] [--turns N] [--demo url] [--open url] [--repo r] [--commit c] [--license l] [--evidence line]... [--replay N:label]...   a share card on the relay (§11); prints its page's address",
  "  connect card <verb> [owner/id] [flags]   a task card (§8): new, publish, claim, grant, note, giveback, deliver, report, accept, changes, resume, dispute, settle, close, edit, split, tree, show, list",
  "  connect wallet [caps|tip|favor|gift|packet|claim] …   the wallet (§9.1): show it; caps [--agent-per-day N] [--per-card N] [--guest-per-day N] [--auto-buy N]; tip <who> <credits> [--note s]; favor <who> --note s [--gave]; gift <credits> [--to who] [--note s]; packet <owner/venue> <credits> <shares> [--note s]; claim <g-…|r-…>",
  "  connect room new <id> [--name 名] | list | join <owner/id> [--agent 名]   a public room (§11): make one, list them all, join one with an agent of yours",
  "  connect mode <agent> <lurk|ask|chat>    the agent's mode in rooms (§7.4): 只潜水, 被问才答, 可以搭话",
  "  connect digest --as <agent> --text <正文> | list [person]   a digest drafted as the agent for the owner's nod (§11), or the published ones",
  "  connect match <person> [--note 一句话] [--as agent] | suggest   牵线 (§11): propose, or see whose public works share words with yours",
  "  connect declare <agent> [--open|--close] [--hours 22:00-08:00+08:00|--no-hours] [--budget N] [--kinds a,b] [--skills a,b] [--network|--no-network]   the agent's 接单声明 (§9.2); prints the page's lines",
  "  connect profile <agent@owner>            the agent's page as the public sees it (§9.3)",
  "  connect channel new <id> --name 名 --agent <a> [--month N] [--signal N] | list | subscribe <owner/id> --month|--signals N   a 订阅频道 (§10.4): make one your agent publishes in, list them with their performance, subscribe (the disclaimer is printed)",
  "  connect signal publish --as <agent> --channel <owner/id> --market m --side yes|no --cap x --expires iso --confidence x [--size 0.02] [--thesis addr] | retract <id> --as <agent> | list <agent@owner>   a signal (§10.1): sealed on this host's chain, then pushed; retracted; an agent's chain with the four numbers",
  "  connect risk <owner/id> [--stage paper|small|auto] [--markets a,b] [--per-order N] [--per-day N] [--max-positions N] [--slippage x] [--cooldown min] [--min-confidence x] [--ask-above N] [--stop-drawdown x] [--stop-losses N] [--connector cmd|--no-connector] [--agent-reads|--no-agent-reads] [--unmute] | show   the channel's risk file (§10.5); a stage up needs its evidence",
].join("\n");

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (value === undefined || value.startsWith("--")) fail(`${name} needs a value`, 2);
  return value;
}
const has = (args: string[], name: string) => args.includes(name);

/** Every value of a flag that may repeat. */
function flags(args: string[], name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== name) continue;
    const value = args[i + 1];
    if (value === undefined || value.startsWith("--")) fail(`${name} needs a value`, 2);
    out.push(value);
    i++;
  }
  return out;
}

function printDiagnostics(ds: readonly FlowDiagnostic[]): void {
  for (const d of ds) console.error(`${d.severity}: ${d.code}: ${d.message} (line ${d.line})`);
  const errs = ds.filter((d) => d.severity === "error").length;
  const warns = ds.filter((d) => d.severity === "warning").length;
  const infos = ds.length - errs - warns;
  if (errs || warns) console.error(`${errs} error(s), ${warns} warning(s)${infos ? `, ${infos} info` : ""}`);
  else console.error(infos ? `ok: no errors or warnings (${infos} info)` : "ok: no diagnostics");
}

function fail(msg: string, code: 1 | 2): never {
  console.error(msg);
  process.exit(code);
}

/** Read a file the user named, or exit 1 with one clean line instead of a stack trace. */
function readOrFail(path: string): string {
  try { return readText(path); }
  catch (e) {
    const err = e as NodeJS.ErrnoException;
    return fail(`gemworks: cannot read ${path}${err.code ? ` (${err.code})` : ""}`, 1);
  }
}

/**
 * The arguments that are neither a flag nor a flag's value. A flag the verb
 * does not know is a usage error: a misspelt `--jsno` must not run as if it
 * had not been typed.
 */
function positionals(verb: string, args: string[], flags: readonly string[], valued: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (valued.includes(a)) { i++; continue; }
    if (flags.includes(a)) continue;
    if (a.startsWith("--")) fail(`gemworks ${verb}: unknown option ${a}`, 2);
    out.push(a);
  }
  return out;
}

const slashed = (p: string): string => p.split(sep).join("/");

/** How a path under the working directory is shown: relative to it, `/`-separated. */
const shown = (p: string): string => slashed(relative(process.cwd(), p) || ".");

/**
 * The project a workflow file belongs to: the home whose
 * `.geml/workflows/<name>.geml` it is — the checkout the shell stands in when
 * that is one of the home's — or where `.geml/workflows/<name>/` (the earlier
 * layout) says it is; a workflow file anywhere else is checked against the
 * working directory.
 */
function projectOf(flowPath: string): string {
  const workflowDir = dirname(flowPath);
  if (basename(flowPath).toLowerCase() !== FLOW_FILE && basename(workflowDir) === "workflows" && basename(dirname(workflowDir)) === GEML_DIR) {
    const home = dirname(dirname(workflowDir));
    return realPath(homeOf(process.cwd())) === realPath(home) ? process.cwd() : home;
  }
  const above = resolve(workflowDir, "..", "..", "..");
  return resolve(above, WORKFLOWS_DIR, basename(workflowDir)) === workflowDir ? above : process.cwd();
}

/**
 * Whether a state's `prompt` names a section or document that exists,
 * resolved as the workspace resolves it for Stagehand (`resolvePromptRef`); a
 * reference outside the project is an error, not a miss.
 */
function promptResolver(flowPath: string, root: string): (ref: string) => boolean {
  return (ref) => {
    const found = resolvePromptRef(ref, flowPath, root);
    if (found.kind === "outside") throw new Error("the path lies outside the project");
    return found.kind === "found";
  };
}

/**
 * Open the project's workspace and run `fn` on it. Opening can fail with a
 * reason, and opening or acting can throw (a journal that fails verification,
 * a verb that kept conflicting with another process): both are one line and
 * exit 1, never a stack trace.
 */
function withWorkspace(fn: (ws: Workspace) => number): number {
  try {
    const opened = openWorkspace({ root: process.cwd(), tools: NO_TOOLS });
    if (!opened.ok) return fail(`gemworks: ${opened.reason}`, 1);
    return fn(opened.ws);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return fail(message.startsWith("gemworks:") ? message : `gemworks: ${message}`, 1);
  }
}

const chain = (states: readonly string[]): string => states.map((s) => `#${s}`).join(" → ");

/** `gemworks hook`: one request in, one answer line out. The exit code is 0 whatever the answer says; handleRequest never throws. */
async function runHook(): Promise<number> {
  process.stdin.setEncoding("utf8");
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  const req = decodeRequest(text);
  const res: BridgeResponse = "error" in req ? { v: 1, ok: false, error: req.error } : await handleRequest(req);
  process.stdout.write(`${JSON.stringify(res)}\n`);
  return 0;
}

/** `gemworks codex`: one Codex hook event in, its answer out. Exit 0 whatever happened: a hook that fails must not take the session with it; the reason goes to stderr. */
async function runCodexHook(): Promise<number> {
  process.stdin.setEncoding("utf8");
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  try {
    const r = await runCodex(text, process.env);
    process.stdout.write(r.stdout);
    return r.code;
  } catch (e) {
    process.stderr.write(`gemworks codex: ${e instanceof Error ? e.message : String(e)}\n`);
    return 0;
  }
}

/** `gemworks antigravity <Event>`: one Antigravity hook event in, its answer out; exit 0 whatever happened. `install` puts the hooks and the MCP server in place. */
async function runAntigravityHook(event: string | undefined): Promise<number> {
  if (event === "install") {
    for (const f of installAntigravity(resolve(process.argv[1] ?? "gemworks.mjs"))) process.stdout.write(`${f}\n`);
    return 0;
  }
  process.stdin.setEncoding("utf8");
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  try {
    process.stdout.write(runAntigravity(event ?? "", text).stdout);
  } catch (e) {
    process.stderr.write(`gemworks antigravity: ${e instanceof Error ? e.message : String(e)}\n`);
  }
  return 0;
}

/** The package's version for the relay's answer to `GET /`: the bundle may start with no package.json beside it. */
function packageVersion(): string {
  try { return (JSON.parse(readText(new URL("../package.json", import.meta.url).pathname)) as { version?: string }).version ?? "unknown"; } catch { return "unknown"; }
}

/** `gemworks phone`: the phone bridge until it is stopped (transport §7.2). */
async function runPhone(rest: string[]): Promise<number> {
  if (positionals("phone", rest, [], ["--relay", "--telegram-token", "--home", "--poll"]).length > 0) fail(USAGE, 2);
  const relay = flag(rest, "--relay"), token = flag(rest, "--telegram-token"), poll = flag(rest, "--poll");
  if (relay === undefined || token === undefined) fail("gemworks phone: --relay <url> and --telegram-token <t> are required", 2);
  if (poll !== undefined && !/^\d+$/.test(poll)) fail("gemworks phone: --poll is a number of seconds", 2);
  const home = homeDir(flag(rest, "--home"), process.env);
  const bridge = new Bridge({ relayUrl: relay!.replace(/\/$/, ""), home, transport: new TelegramTransport(token!), ...(poll !== undefined ? { pollMs: Number(poll) * 1000 } : {}), log: (line) => console.error(line) });
  bridge.start();
  console.log(`phone bridge on ${relay} · bindings under ${join(home, "phone")}`);
  await new Promise<void>((done) => {
    const stop = (): void => { bridge.stop(); done(); };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  return 0;
}

/** `gemworks relay`: the relay until it is stopped; `gemworks relay token <person>`: a person's token, printed once. */
async function runRelay(rest: string[]): Promise<number> {
  const root = resolve(flag(rest, "--root") ?? join(homedir(), ".gemworks", "relay"));
  if (rest[0] === "token") {
    const pos = positionals("relay token", rest.slice(1), [], ["--root"]);
    const person = pos[0];
    if (person === undefined || pos.length !== 1) fail(USAGE, 2);
    const r = new Relay({ root, name: "cli" }).issuePerson(person);
    if (!r.ok) return fail(`gemworks relay: ${r.reason}`, 1);
    console.log(r.token);
    return 0;
  }
  if (rest[0] === "topup") {
    const pos = positionals("relay topup", rest.slice(1), [], ["--root", "--note"]);
    const [person, credits] = pos;
    if (person === undefined || credits === undefined || pos.length !== 2 || !/^\d+$/.test(credits)) fail(USAGE, 2);
    const r = new Relay({ root, name: "cli" }).topUp(person, Number(credits), flag(rest, "--note"));
    if (!r.ok) return fail(`gemworks relay: ${r.reason}`, 1);
    console.log(`${person} ${r.balance}`);
    return 0;
  }
  if (rest[0] === "price") {
    const pos = positionals("relay price", rest.slice(1), [], ["--root", "--at"]);
    const [market, price] = pos;
    if (market === undefined || price === undefined || pos.length !== 2 || !/^\d+(\.\d+)?$/.test(price)) fail("gemworks relay price: <market> <price> [--at iso]", 2);
    const at = flag(rest, "--at");
    const r = new Relay({ root, name: "cli" }).setPrice(market!, Number(price), ...(at !== undefined ? [at] : []));
    if (!r.ok) return fail(`gemworks relay price: ${r.reason}`, 1);
    console.log(`${r.market} ${r.price} @ ${r.at}`);
    return 0;
  }
  if (positionals("relay", rest, [], ["--root", "--port", "--name", "--host", "--federation", "--free-credits", "--mail-command", "--hosted-command", "--hosted-credits"]).length > 0) fail(USAGE, 2);
  const port = Number(flag(rest, "--port") ?? "7700");
  if (!Number.isInteger(port) || port < 0 || port > 65535) fail("gemworks relay: --port needs a number from 0 to 65535", 2);
  const federation = flag(rest, "--federation") ?? "closed";
  if (federation !== "open" && federation !== "closed") fail("gemworks relay: --federation is open or closed", 2);
  const host = flag(rest, "--host") ?? "127.0.0.1";
  const name = flag(rest, "--name") ?? "localhost";
  const free = flag(rest, "--free-credits");
  if (free !== undefined && !/^\d+$/.test(free)) fail("gemworks relay: --free-credits needs a whole number", 2);
  const mail = flag(rest, "--mail-command");
  const hostedCommand = flag(rest, "--hosted-command"), hostedCredits = flag(rest, "--hosted-credits");
  if (hostedCredits !== undefined && !/^\d+$/.test(hostedCredits)) fail("gemworks relay: --hosted-credits needs a whole number", 2);
  const s = await startRelay({ root, name, port, host, federation, version: packageVersion(), ...(free !== undefined ? { freeCredits: Number(free) } : {}), ...(mail !== undefined ? { mailer: commandMailer(mail) } : {}), ...(hostedCommand !== undefined ? { hosted: { runner: commandRunner(hostedCommand), ...(hostedCredits !== undefined ? { credits: Number(hostedCredits) } : {}) } } : {}) });
  console.log(`relay ${name} listening on ${s.url} · documents under ${root}${hostedCommand !== undefined ? ` · 托管 agent 由「${hostedCommand}」跑` : ""}`);
  await new Promise<void>((done) => {
    const stop = (): void => { void s.close().then(done); };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  return 0;
}

const CARD_VERBS = ["new", "publish", "claim", "grant", "note", "giveback", "deliver", "report", "accept", "changes", "resume", "dispute", "settle", "close", "edit", "split", "tree", "show", "list"] as const;
const ROLE_WORDS: Readonly<Record<string, string>> = { delegator: "委托人", worker: "接单方", granter: "放行人" };
const VERIFY_KEYS: Readonly<Record<string, VerifyKind>> = { command: "command", file: "file", repo: "repo", review: "review", human: "human", 命令: "command", 文件: "file", 仓库: "repo", 审读: "review", 人勾: "human" };
const VERIFY_PARAM: Readonly<Record<VerifyKind, "run" | "glob" | "pr" | "rubric" | undefined>> = { command: "run", file: "glob", repo: "pr", review: "rubric", human: undefined };

/** A card's line after a verb: its id, its state, whom it waits on. */
function cardWords(card: Card): string {
  const w = waitingOn(card);
  return `#${card.id} ${STATE_WORDS[card.state]}${w === undefined ? "" : ` · 等 ${w}`}`;
}

/** `gemworks connect card <verb>`: one call to the relay with the daemon's token, one line back (§8). */
async function runCard(home: string, args: string[]): Promise<number> {
  const verb = args[0] as (typeof CARD_VERBS)[number] | undefined;
  if (verb === undefined || !CARD_VERBS.includes(verb)) fail(USAGE, 2);
  const rest = args.slice(1);
  const c = readConfig(home);
  if (c === undefined) return fail("gemworks connect card: no connect.json here; run gemworks connect setup first", 1);
  const client = new RelayClient(c.relay.url, c.token);
  const refused = (r: { status: number; body: unknown }): number => fail(`gemworks connect card ${verb}: ${reasonOf(r)}`, 1);
  if (verb === "new") {
    if (positionals("connect card new", rest, ["--network"], ["--home", "--title", "--goal", "--constraints", "--inputs", "--direction", "--where", "--accept", "--include", "--exclude", "--tools", "--credits", "--hours", "--deadline", "--hops", "--mode", "--reward", "--grant-from", "--worker", "--parent"]).length > 0) fail(USAGE, 2);
    const title = flag(rest, "--title"), goal = flag(rest, "--goal"), direction = flag(rest, "--direction"), where = flag(rest, "--where");
    if (title === undefined || goal === undefined || direction === undefined || where === undefined) fail("gemworks connect card new: --title, --goal, --direction and --where are required", 2);
    const accepts = flags(rest, "--accept").map((a) => {
      const [k, param, ...text] = a.split("|");
      const kind = k === undefined ? undefined : VERIFY_KEYS[k];
      if (kind === undefined || text.length === 0) fail("gemworks connect card new: --accept takes <kind>|<param>|<text> (kinds: 命令 文件 仓库 审读 人勾)", 2);
      const p = VERIFY_PARAM[kind];
      return { text: text.join("|"), verify: { kind, ...(p !== undefined && param !== undefined && param !== "" ? { [p]: param } : {}) } };
    });
    const modeArg = flag(rest, "--mode") ?? "single", rewardArg = flag(rest, "--reward") ?? "none";
    const modeM = /^contest:(\d+)$/.exec(modeArg), rewardM = /^(escrow|prize):(\d+)(?::(\d+))?$/.exec(rewardArg);
    const budget: Record<string, unknown> = {};
    for (const [k, v] of [["credits", flag(rest, "--credits")], ["hours", flag(rest, "--hours")], ["hops", flag(rest, "--hops")]] as const) if (v !== undefined) budget[k] = Number(v);
    const deadline = flag(rest, "--deadline"); if (deadline !== undefined) budget["deadline"] = deadline;
    const constraints = flag(rest, "--constraints"), inputs = flag(rest, "--inputs"), grantFrom = flag(rest, "--grant-from"), worker = flag(rest, "--worker"), parent = flag(rest, "--parent");
    const body = {
      title, goal, direction, venueOfWork: where, accepts,
      ...(constraints !== undefined ? { constraints } : {}), ...(inputs !== undefined ? { inputs } : {}), ...(grantFrom !== undefined ? { grantFrom } : {}), ...(worker !== undefined ? { worker } : {}), ...(parent !== undefined ? { parent } : {}),
      context: { includes: flags(rest, "--include"), excludes: flags(rest, "--exclude") },
      tools: (flag(rest, "--tools") ?? "read").split(",").map((t) => t.trim()).filter((t) => t !== ""), network: has(rest, "--network"), budget,
      mode: modeM !== null ? { kind: "contest", slots: Number(modeM[1]) } : { kind: modeArg },
      reward: rewardM !== null ? { kind: rewardM[1], credits: Number(rewardM[2]), ...(rewardM[3] !== undefined ? { participation: Number(rewardM[3]) } : {}) } : { kind: rewardArg },
    };
    try {
      const r = await client.post("/tasks", body);
      if (r.status !== 201) return refused(r);
      const made = r.body as { card: Card; address: string };
      console.log(`${c.person}/${made.card.id} ${made.address}`);
      return 0;
    } catch (e) { return fail(`gemworks connect card new: ${e instanceof Error ? e.message : String(e)}`, 1); }
  }
  if (verb === "list") {
    if (positionals("connect card list", rest, [], ["--home"]).length > 0) fail(USAGE, 2);
    try {
      const rows = await client.tasks();
      for (const t of rows) console.log(`${t.owner}/${t.id} · ${t.title} · ${STATE_WORDS[t.state as keyof typeof STATE_WORDS] ?? t.state} · ${ROLE_WORDS[t.role] ?? t.role}`);
      return 0;
    } catch (e) { return fail(`gemworks connect card list: ${e instanceof Error ? e.message : String(e)}`, 1); }
  }
  const valued = ["--home", "--venue", "--agent", "--text", "--evidence", "--note", "--deliverable", "--result", "--comment", "--reason", "--outcome", "--title", "--goal", "--constraints", "--inputs", "--tools", "--credits", "--hours", "--deadline", "--child"];
  const pos = positionals(`connect card ${verb}`, rest, [], valued);
  const target = /^([^/\s]+)\/([^/\s]+)$/.exec(pos[0] ?? "");
  if (pos.length !== 1 || target === null) fail(`gemworks connect card ${verb}: the card is <owner>/<id>`, 2);
  const owner = target[1]!, id = target[2]!;
  const path = `/tasks/${encodeURIComponent(owner)}/${encodeURIComponent(id)}`;
  if (verb === "show") {
    try {
      const r = await client.get(path);
      if (r.status !== 200) return refused(r);
      const v = r.body as { card: Card; brief: { label: string; text: string }[]; progress: string; waitingOn?: string; heartbeat: string };
      console.log(`#${v.card.id} ${v.card.title} · ${DIRECTION_WORDS[v.card.direction]} · ${v.progress}`);
      for (const l of v.brief) console.log(`${l.label}：${l.text}`);
      if (v.waitingOn !== undefined) console.log(`等：${v.waitingOn}`);
      console.log(`心跳：${v.heartbeat}`);
      return 0;
    } catch (e) { return fail(`gemworks connect card show: ${e instanceof Error ? e.message : String(e)}`, 1); }
  }
  if (verb === "tree") {
    try {
      const r = await client.get(`${path}/tree`);
      if (r.status !== 200) return refused(r);
      const lines = (t: { id: string; title: string; stateWord: string; children: unknown[] }, depth: number): string[] => [`${"  ".repeat(depth)}#${t.id} ${t.title} · ${t.stateWord}`, ...(t.children as typeof t[]).flatMap((c) => lines(c, depth + 1))];
      for (const l of lines((r.body as { tree: { id: string; title: string; stateWord: string; children: unknown[] } }).tree, 0)) console.log(l);
      return 0;
    } catch (e) { return fail(`gemworks connect card tree: ${e instanceof Error ? e.message : String(e)}`, 1); }
  }
  let body: Record<string, unknown> = {};
  const json = (name: string): unknown => { const t = flag(rest, name); if (t === undefined) return undefined; try { return JSON.parse(t) as unknown; } catch { return fail(`gemworks connect card ${verb}: ${name} is not JSON`, 2); } };
  const comments = flags(rest, "--comment").map((x) => { const i = x.indexOf("|"); return i === -1 ? { anchor: "", text: x } : { anchor: x.slice(0, i), text: x.slice(i + 1) }; });
  switch (verb) {
    case "publish": { const venue = flag(rest, "--venue"); if (venue === undefined) fail("gemworks connect card publish: --venue <owner/id> is required", 2); body = { venue }; break; }
    case "claim": { const agent = flag(rest, "--agent"); body = agent === undefined ? {} : { agent }; break; }
    case "note": { const text = flag(rest, "--text"); if (text === undefined) fail("gemworks connect card note: --text is required", 2); body = { text, evidence: flags(rest, "--evidence").map((src) => ({ src })) }; break; }
    case "giveback": { const note = flag(rest, "--note"), deliverable = json("--deliverable"); body = { ...(note !== undefined ? { note } : {}), ...(deliverable !== undefined ? { deliverable } : {}) }; break; }
    case "deliver": { const deliverable = json("--deliverable"); if (deliverable === undefined) fail("gemworks connect card deliver: --deliverable <json> is required", 2); body = deliverable as Record<string, unknown>; break; }
    case "report": {
      const results = flags(rest, "--result").map((x) => { const m = /^(\d+):(met|unmet|wait)(?::(.*))?$/.exec(x); if (m === null) fail("gemworks connect card report: --result takes <n>:met|unmet|wait[:note]", 2); return { criterion: Number(m![1]), met: m![2] === "met" ? true : m![2] === "unmet" ? false : null, ...(m![3] !== undefined ? { note: m![3] } : {}) }; });
      body = { results, comments }; break;
    }
    case "changes": body = { comments }; break;
    case "dispute": case "close": { const reason = flag(rest, "--reason"); body = reason === undefined ? {} : { reason }; break; }
    case "settle": { const outcome = flag(rest, "--outcome"); if (outcome === undefined) fail("gemworks connect card settle: --outcome accepted|closed is required", 2); body = { outcome }; break; }
    case "edit": {
      for (const [f, k] of [["--title", "title"], ["--goal", "goal"], ["--constraints", "constraints"], ["--inputs", "inputs"]] as const) { const v = flag(rest, f); if (v !== undefined) body[k] = v; }
      const tools = flag(rest, "--tools"); if (tools !== undefined) body["tools"] = tools.split(",").map((t) => t.trim()).filter((t) => t !== "");
      const budget: Record<string, unknown> = {};
      for (const [k, v] of [["credits", flag(rest, "--credits")], ["hours", flag(rest, "--hours")]] as const) if (v !== undefined) budget[k] = Number(v);
      const deadline = flag(rest, "--deadline"); if (deadline !== undefined) budget["deadline"] = deadline;
      if (Object.keys(budget).length > 0) body["budget"] = budget;
      if (Object.keys(body).length === 0) fail("gemworks connect card edit: nothing to change (--title, --goal, --constraints, --inputs, --tools, --credits, --hours, --deadline)", 2);
      break;
    }
    case "split": {
      const children = flags(rest, "--child").map((x) => { try { return JSON.parse(x) as unknown; } catch { return fail("gemworks connect card split: --child is a JSON card", 2); } });
      if (children.length === 0) fail("gemworks connect card split: --child <json> at least once", 2);
      body = { children };
      break;
    }
    default: break;
  }
  try {
    const r = await client.post(`${path}/${verb}`, body);
    if (r.status !== 200) return refused(r);
    const out = r.body as { card: Card; decision?: "accepted" | "changes" | "inbox" };
    const decision = out.decision === undefined ? "" : out.decision === "accepted" ? " · 已接受" : out.decision === "changes" ? " · 要改" : " · 等你验收";
    console.log(`${cardWords(out.card)}${decision}`);
    for (const c of (out as { children?: { owner: string; id: string }[] }).children ?? []) console.log(`${c.owner}/${c.id}`);
    return 0;
  } catch (e) { return fail(`gemworks connect card ${verb}: ${e instanceof Error ? e.message : String(e)}`, 1); }
}

const WALLET_VERBS = ["show", "caps", "tip", "favor", "gift", "packet", "claim"] as const;

/** `gemworks connect wallet [verb]` (§9.1): the wallet shown, the caps set, a tip, a favour, a gift, a red packet, a claim — one call to the relay with the person's token, one line back. */
async function runWallet(home: string, args: string[]): Promise<number> {
  const named = args[0] !== undefined && !args[0].startsWith("--");
  const verb = (named ? args[0] : "show") as (typeof WALLET_VERBS)[number];
  if (!WALLET_VERBS.includes(verb)) fail(USAGE, 2);
  const rest = named ? args.slice(1) : args;
  const c = readConfig(home);
  if (c === undefined) return fail("gemworks connect wallet: no connect.json here; run gemworks connect setup first", 1);
  const client = new RelayClient(c.relay.url, c.token);
  const refused = (r: { status: number; body: unknown }): number => fail(`gemworks connect wallet ${verb}: ${reasonOf(r)}`, 1);
  const count = (v: string | undefined, what: string): number => { if (v === undefined || !/^\d+$/.test(v)) fail(`gemworks connect wallet ${verb}: ${what} is a whole number of credits`, 2); return Number(v); };
  /** `name@owner` is an agent; anything else a person. */
  const speaker = (v: string): string => (/^[^@\s]+@[^@\s]+$/.test(v) ? `agent:${v}` : v);
  try {
    switch (verb) {
      case "show": {
        if (positionals("connect wallet", rest, [], ["--home"]).length > 0) fail(USAGE, 2);
        const r = await client.get("/wallet");
        if (r.status !== 200) return refused(r);
        const w = r.body as { lines: string[]; recent: string[] };
        for (const l of [...w.lines, ...w.recent]) console.log(l);
        return 0;
      }
      case "caps": {
        if (positionals("connect wallet caps", rest, [], ["--home", "--agent-per-day", "--per-card", "--guest-per-day", "--auto-buy"]).length > 0) fail(USAGE, 2);
        const body: Record<string, number> = {};
        for (const [f, k] of [["--agent-per-day", "agentPerDay"], ["--per-card", "perCard"], ["--guest-per-day", "guestPerDay"], ["--auto-buy", "autoBuy"]] as const) { const v = flag(rest, f); if (v !== undefined) body[k] = count(v, f); }
        const r = await client.post("/wallet/caps", body);
        if (r.status !== 200) return refused(r);
        const caps = (r.body as { caps: Record<string, number> }).caps;
        console.log(`每天 ${caps["agentPerDay"]} · 每张卡 ${caps["perCard"]} · 访客问答每天 ${caps["guestPerDay"]} · 自动买东西 ${caps["autoBuy"]}`);
        return 0;
      }
      case "tip": {
        const pos = positionals("connect wallet tip", rest, [], ["--home", "--note"]);
        if (pos.length !== 2) fail("gemworks connect wallet tip: <person|name@owner> <credits> [--note s]", 2);
        const credits = count(pos[1], "the amount"), note = flag(rest, "--note");
        const r = await client.post("/wallet/tip", { to: speaker(pos[0]!), credits, ...(note !== undefined ? { note } : {}) });
        if (r.status !== 200) return refused(r);
        console.log(`打赏 ${credits} 给 ${pos[0]} · 钱包 ${(r.body as { balance: number }).balance}`);
        return 0;
      }
      case "favor": {
        const pos = positionals("connect wallet favor", rest, ["--gave"], ["--home", "--note"]);
        const note = flag(rest, "--note");
        if (pos.length !== 1 || note === undefined) fail("gemworks connect wallet favor: <person> --note <line> [--gave]  (they helped you; --gave: you helped them)", 2);
        const gave = has(rest, "--gave");
        const r = await client.post("/wallet/favor", { ...(gave ? { to: pos[0] } : { from: pos[0] }), note });
        if (r.status !== 200) return refused(r);
        console.log(`记了人情 · ${gave ? `${c.person} 给 ${pos[0]}` : `${pos[0]} 给 ${c.person}`} · ${note}`);
        return 0;
      }
      case "gift": {
        const pos = positionals("connect wallet gift", rest, [], ["--home", "--to", "--note"]);
        if (pos.length !== 1) fail("gemworks connect wallet gift: <credits> [--to person] [--note s]", 2);
        const credits = count(pos[0], "the amount"), to = flag(rest, "--to"), note = flag(rest, "--note");
        const r = await client.post("/wallet/gift", { credits, ...(to !== undefined ? { to } : {}), ...(note !== undefined ? { note } : {}) });
        if (r.status !== 200 && r.status !== 201) return refused(r);
        const g = r.body as { url?: string; balance: number };
        console.log(g.url !== undefined ? `${c.relay.url}${g.url} · 钱包 ${g.balance}` : `送了 ${credits} 给 ${to} · 钱包 ${g.balance}`);
        return 0;
      }
      case "packet": {
        const pos = positionals("connect wallet packet", rest, [], ["--home", "--note"]);
        if (pos.length !== 3) fail("gemworks connect wallet packet: <owner/venue> <credits> <shares> [--note s]", 2);
        const credits = count(pos[1], "the amount"), shares = count(pos[2], "the shares"), note = flag(rest, "--note");
        const r = await client.post("/wallet/packet", { venue: pos[0], credits, shares, ...(note !== undefined ? { note } : {}) });
        if (r.status !== 201) return refused(r);
        const p = r.body as { id: string; balance: number };
        console.log(`红包 ${p.id} · ${credits} 积分 · ${shares} 份 · 钱包 ${p.balance}`);
        return 0;
      }
      case "claim": {
        const pos = positionals("connect wallet claim", rest, [], ["--home"]);
        const id = pos[0];
        if (pos.length !== 1 || id === undefined || !/^[gr]-/.test(id)) fail("gemworks connect wallet claim: <g-…|r-…>", 2);
        const r = await client.post(id.startsWith("g-") ? `/g/${id}/claim` : `/r/${id}/claim`, {});
        if (r.status !== 200) return refused(r);
        const got = r.body as { credits?: number; amount?: number; left?: number; balance: number };
        console.log(id.startsWith("g-") ? `领了 ${got.credits} · 钱包 ${got.balance}` : `领了 ${got.amount} · 还剩 ${got.left} 份 · 钱包 ${got.balance}`);
        return 0;
      }
    }
  } catch (e) { return fail(`gemworks connect wallet ${verb}: ${e instanceof Error ? e.message : String(e)}`, 1); }
  return 0;
}

/** `gemworks connect channel|signal|risk` (§10): a channel made, listed, subscribed; a signal sealed here and pushed, retracted, an agent's chain listed; the channel's risk file. */
async function runSignals(home: string, sub: "channel" | "signal" | "risk", args: string[]): Promise<number> {
  const c = readConfig(home);
  if (c === undefined) return fail(`gemworks connect ${sub}: no connect.json here; run gemworks connect setup first`, 1);
  const client = new RelayClient(c.relay.url, c.token);
  const refused = (r: { status: number; body: unknown }): number => fail(`gemworks connect ${sub}: ${reasonOf(r)}`, 1);
  const target = (v: string | undefined, what: string): [string, string] => { const m = /^([^/\s]+)\/([^/\s]+)$/.exec(v ?? ""); if (m === null) fail(`gemworks connect ${sub} ${what}: <owner/id>`, 2); return [m![1]!, m![2]!]; };
  try {
    if (sub === "channel") {
      const verb = args[0];
      if (verb === "new") {
        const pos = positionals("connect channel new", args.slice(1), [], ["--home", "--name", "--agent", "--month", "--signal"]);
        const id = pos[0], agent = flag(args, "--agent");
        if (id === undefined || pos.length !== 1 || agent === undefined) fail("gemworks connect channel new: <id> --name 名 --agent <a> [--month N] [--signal N]", 2);
        const price: Record<string, number> = {};
        for (const [f, k] of [["--month", "month"], ["--signal", "signal"]] as const) { const v = flag(args, f); if (v !== undefined) { if (!/^\d+$/.test(v)) fail(`gemworks connect channel new: ${f} is a whole number of credits`, 2); price[k] = Number(v); } }
        const r = await client.post("/venues", { id, kind: "channel", name: flag(args, "--name") ?? id, agents: [`agent:${agent}@${c.person}`], price });
        if (r.status !== 201) return refused(r);
        const v = (r.body as { venue: { price?: ChannelPrice } }).venue;
        console.log(`${c.person}/${id} · ${priceWords(v.price)}`);
        return 0;
      }
      if (verb === "list") {
        if (positionals("connect channel list", args.slice(1), [], ["--home"]).length > 0) fail(USAGE, 2);
        const r = await client.get("/channels");
        if (r.status !== 200) return refused(r);
        const rows = r.body as { owner: string; id: string; name: string; publisher: string; price: ChannelPrice; subscribers: number; performance: Performance }[];
        if (rows.length === 0) console.log("还没有订阅频道");
        for (const x of rows) console.log(`${x.owner}/${x.id} · ${x.name} · ${x.publisher} · ${priceWords(x.price)} · ${x.subscribers} 订阅 · ${performanceLine(x.performance)}`);
        return 0;
      }
      if (verb === "subscribe") {
        const pos = positionals("connect channel subscribe", args.slice(1), ["--month"], ["--home", "--signals"]);
        const [owner, id] = target(pos[0], "subscribe");
        const signals = flag(args, "--signals");
        if (pos.length !== 1 || (!has(args, "--month") && signals === undefined) || (signals !== undefined && !/^\d+$/.test(signals))) fail("gemworks connect channel subscribe: <owner/id> --month | --signals N", 2);
        const r = await client.post(`/channels/${encodeURIComponent(owner)}/${encodeURIComponent(id)}/subscribe`, has(args, "--month") ? { month: true } : { signals: Number(signals) });
        if (r.status !== 200) return refused(r);
        const x = r.body as { venue: { name: string }; disclaimer: string; until?: string; left?: number };
        console.log(x.disclaimer);
        console.log(`已订阅「${x.venue.name}」· ${x.until !== undefined ? `到 ${x.until}` : `还有 ${x.left ?? 0} 条`}`);
        return 0;
      }
      fail(USAGE, 2);
    }
    if (sub === "signal") {
      const verb = args[0];
      if (verb === "list") {
        const pos = positionals("connect signal list", args.slice(1), [], ["--home"]);
        const m = /^([^@\s]+)@([^@\s]+)$/.exec(pos[0] ?? "");
        if (pos.length !== 1 || m === null) fail("gemworks connect signal list: <agent@owner>", 2);
        const r = await client.get(`/signals/${encodeURIComponent(m![2]!)}/${encodeURIComponent(m![1]!)}`);
        if (r.status !== 200) return refused(r);
        const page = r.body as { signals: Signal[]; performance: Performance };
        console.log(performanceLine(page.performance));
        for (const s of page.signals) console.log(`${signalText(s)}${s.retracted !== undefined ? " · 已撤回" : ""}`);
        return 0;
      }
      const as = flag(args, "--as");
      if (as === undefined || c.agents[as] === undefined) fail(`gemworks connect signal ${verb ?? ""}: --as <agent> (one with a token here)`, 2);
      const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
      if (verb === "retract") {
        const pos = positionals("connect signal retract", args.slice(1), [], ["--home", "--as"]);
        if (pos.length !== 1) fail("gemworks connect signal retract: <id> --as <agent>", 2);
        retractSignal(home, as!, pos[0]!, now);
        const pushed = await new Daemon({ home }).flushOutbox();
        if (pushed.failed > 0) return fail(`gemworks connect signal retract: the relay refused it (see ${join(home, "outbox", "failed")})`, 1);
        console.log(`撤回 ${pos[0]} · 已推送 ${pushed.pushed} 条`);
        return 0;
      }
      if (verb === "publish") {
        if (positionals("connect signal publish", args.slice(1), [], ["--home", "--as", "--channel", "--market", "--side", "--cap", "--expires", "--confidence", "--size", "--thesis"]).length > 0) fail(USAGE, 2);
        const channel = flag(args, "--channel"), market = flag(args, "--market"), side = flag(args, "--side"), cap = flag(args, "--cap"), expires = flag(args, "--expires"), confidence = flag(args, "--confidence");
        if (channel === undefined || market === undefined || side === undefined || cap === undefined || expires === undefined || confidence === undefined) fail("gemworks connect signal publish: --as <agent> --channel <owner/id> --market m --side yes|no --cap x --expires iso --confidence x [--size 0.02] [--thesis addr]", 2);
        target(channel, "publish");
        const thesis = flag(args, "--thesis");
        const body = { market, side, sizeHint: { kind: "fraction-of-bankroll", value: Number(flag(args, "--size") ?? "0.02") }, priceCap: Number(cap), expires, confidence: Number(confidence), ...(thesis !== undefined ? { thesis } : {}) };
        const faults = signalFaults(body);
        if (faults.length > 0) return fail(`gemworks connect signal publish: ${faults.join("；")}`, 1);
        const made = publishSignal(home, as!, { ...signalInput(body)!, channel: channel! }, now);
        const pushed = await new Daemon({ home }).flushOutbox();
        if (pushed.failed > 0) return fail(`gemworks connect signal publish: the relay refused it (see ${join(home, "outbox", "failed")})`, 1);
        console.log(`信号 ${made.id} 已封在本机链上 · 已推送 ${pushed.pushed} 条`);
        return 0;
      }
      fail(USAGE, 2);
    }
    // risk
    const pos = positionals("connect risk", args, ["--agent-reads", "--no-agent-reads", "--no-connector", "--unmute"], ["--home", "--stage", "--markets", "--per-order", "--per-day", "--max-positions", "--slippage", "--cooldown", "--min-confidence", "--ask-above", "--stop-drawdown", "--stop-losses", "--connector"]);
    const [owner, id] = target(pos[0], "");
    const show = pos[1] === "show";
    if (pos.length !== (show ? 2 : 1)) fail("gemworks connect risk: <owner/id> [flags] | show", 2);
    const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    const current = readRisk(home, owner, id);
    const state = readExec(home, owner, id);
    if (show) {
      for (const l of stageLines(current, localRecord(state), now)) console.log(l);
      console.log(`市场：${current.markets.length === 0 ? "没有白名单" : current.markets.join("、")} · 单笔 ${current.perOrder} · 当日 ${current.perDay} · 最多 ${current.maxPositions} 仓 · 滑点 ${Math.round(current.maxSlippage * 1000) / 10}% · 冷却 ${current.cooldownMinutes} 分钟 · 信心 ≥ ${current.minConfidence} · 止损 回撤 ${Math.round(current.stop.drawdown * 1000) / 10}% / 连亏 ${current.stop.losses}${current.askAbove > 0 ? ` · 超过 ${current.askAbove} 必须问我` : ""}${current.agentReads ? " · agent 读论点" : ""}${current.connector !== undefined ? ` · connector ${current.connector}` : " · 没有 connector"}`);
      for (const r of state.records) console.log(`${r.at.slice(11, 16)} ${r.signal === "" ? "—" : r.signal} ${execLine(r)}`);
      return 0;
    }
    const body: Record<string, unknown> = {};
    const stage = flag(args, "--stage");
    if (stage !== undefined) {
      if (stage !== "paper" && stage !== "small" && stage !== "auto") fail("gemworks connect risk: --stage is paper, small or auto", 2);
      const order: Record<Risk["stage"], number> = { paper: 0, small: 1, auto: 2 };
      if (order[stage] > order[current.stage]) {
        const up = canAdvance(current, localRecord(state), now);
        if (!up.ok || up.to !== stage) return fail(`gemworks connect risk: 不能升到${STAGE_WORDS[stage]}：${up.ok ? `先到${STAGE_WORDS[up.to]}` : up.why}`, 1);
      }
      body["stage"] = stage;
      if (stage !== current.stage) body["stageSince"] = now;
    }
    const markets = flag(args, "--markets"); if (markets !== undefined) body["markets"] = markets.split(",").map((x) => x.trim()).filter((x) => x !== "");
    for (const [f, k] of [["--per-order", "perOrder"], ["--per-day", "perDay"], ["--max-positions", "maxPositions"], ["--slippage", "maxSlippage"], ["--cooldown", "cooldownMinutes"], ["--min-confidence", "minConfidence"], ["--ask-above", "askAbove"]] as const) { const v = flag(args, f); if (v !== undefined) { if (!/^\d+(\.\d+)?$/.test(v)) fail(`gemworks connect risk: ${f} is a number`, 2); body[k] = Number(v); } }
    const stop: Record<string, number> = {};
    for (const [f, k] of [["--stop-drawdown", "drawdown"], ["--stop-losses", "losses"]] as const) { const v = flag(args, f); if (v !== undefined) { if (!/^\d+(\.\d+)?$/.test(v)) fail(`gemworks connect risk: ${f} is a number`, 2); stop[k] = Number(v); } }
    if (Object.keys(stop).length > 0) body["stop"] = stop;
    const connector = flag(args, "--connector"); if (connector !== undefined) body["connector"] = connector;
    if (has(args, "--no-connector")) body["connector"] = null;
    if (has(args, "--agent-reads")) body["agentReads"] = true;
    if (has(args, "--no-agent-reads")) body["agentReads"] = false;
    if (has(args, "--unmute")) body["muted"] = false;
    const next = riskOf(body, current);
    writeRisk(home, owner, id, next);
    for (const l of stageLines(next, localRecord(state), now)) console.log(l);
    return 0;
  } catch (e) { return fail(`gemworks connect ${sub}: ${e instanceof Error ? e.message : String(e)}`, 1); }
}

/** `gemworks connect declare <agent> …` and `connect profile <agent@owner>` (§9.2, §9.3): the declaration written, the page read. */
async function runDeclare(home: string, sub: "declare" | "profile", args: string[]): Promise<number> {
  const c = readConfig(home);
  if (c === undefined) return fail(`gemworks connect ${sub}: no connect.json here; run gemworks connect setup first`, 1);
  const client = new RelayClient(c.relay.url, c.token);
  try {
    if (sub === "profile") {
      const pos = positionals("connect profile", args, [], ["--home"]);
      const m = /^([^@\s]+)@([^@\s]+)$/.exec(pos[0] ?? "");
      if (pos.length !== 1 || m === null) fail("gemworks connect profile: <agent@owner>", 2);
      const r = await client.get(`/a/${encodeURIComponent(m![2]!)}/${encodeURIComponent(m![1]!)}`);
      if (r.status !== 200) return fail(`gemworks connect profile: ${reasonOf(r)}`, 1);
      const v = r.body as { label: string; presenceWord: string; modeWord: string; numbers: { accepted: number; reviews: number; disputes: number }; askable: boolean; lines: string[]; latest?: string };
      console.log(`${v.label} · ${v.presenceWord} · ${v.modeWord}`);
      console.log(`已接受 ${v.numbers.accepted} · 评价 ${v.numbers.reviews} · 争议 ${v.numbers.disputes}${v.askable ? " · 可以请它评" : ""}`);
      for (const l of v.lines) console.log(l);
      if (v.latest !== undefined) console.log(`最近公开：${v.latest}`);
      return 0;
    }
    const pos = positionals("connect declare", args, ["--open", "--close", "--no-hours", "--network", "--no-network"], ["--home", "--hours", "--budget", "--kinds", "--skills"]);
    if (pos.length !== 1) fail("gemworks connect declare: <agent> [--open|--close] [--hours 22:00-08:00+08:00|--no-hours] [--budget N] [--kinds a,b] [--skills a,b] [--network|--no-network]", 2);
    const body: Record<string, unknown> = {};
    if (has(args, "--open")) body["open"] = true;
    if (has(args, "--close")) body["open"] = false;
    const hours = flag(args, "--hours"); if (hours !== undefined) body["hours"] = hours;
    if (has(args, "--no-hours")) body["hours"] = null;
    const budget = flag(args, "--budget"); if (budget !== undefined) { if (!/^\d+$/.test(budget)) fail("gemworks connect declare: --budget is a whole number of tokens", 2); body["budget"] = Number(budget); }
    for (const [f, k] of [["--kinds", "kinds"], ["--skills", "skills"]] as const) { const v = flag(args, f); if (v !== undefined) body[k] = v.split(",").map((x) => x.trim()).filter((x) => x !== ""); }
    if (has(args, "--network")) body["network"] = true;
    if (has(args, "--no-network")) body["network"] = false;
    const r = await client.post(`/agents/${encodeURIComponent(pos[0]!)}/declare`, body);
    if (r.status !== 200) return fail(`gemworks connect declare: ${reasonOf(r)}`, 1);
    for (const l of (r.body as { lines: string[] }).lines) console.log(l);
    return 0;
  } catch (e) { return fail(`gemworks connect ${sub}: ${e instanceof Error ? e.message : String(e)}`, 1); }
}

/** `gemworks connect room|mode|digest|match` (§11, §7.4): rooms made, listed and joined; an agent's mode; a digest drafted as the agent, or the published ones; 牵线 proposed, or what two people's public works share. */
async function runSocial(home: string, sub: "room" | "mode" | "digest" | "match", args: string[]): Promise<number> {
  const c = readConfig(home);
  if (c === undefined) return fail(`gemworks connect ${sub}: no connect.json here; run gemworks connect setup first`, 1);
  const client = new RelayClient(c.relay.url, c.token);
  const refused = (r: { status: number; body: unknown }): number => fail(`gemworks connect ${sub}: ${reasonOf(r)}`, 1);
  try {
    if (sub === "room") {
      const verb = args[0];
      if (verb === "new") {
        const pos = positionals("connect room new", args.slice(1), [], ["--home", "--name"]);
        if (pos.length !== 1) fail("gemworks connect room new: <id> [--name 名字]", 2);
        const r = await client.post("/venues", { id: pos[0], kind: "room", name: flag(args, "--name") ?? pos[0] });
        if (r.status !== 201) return refused(r);
        console.log(`房间 ${c.person}/${pos[0]}`);
        return 0;
      }
      if (verb === "list") {
        if (positionals("connect room list", args.slice(1), [], ["--home"]).length > 0) fail(USAGE, 2);
        const r = await client.get("/rooms");
        if (r.status !== 200) return refused(r);
        for (const x of r.body as { owner: string; id: string; name: string; people: number; agents: number }[]) console.log(`${x.owner}/${x.id} · ${x.name} · ${x.people} 人 · ${x.agents} 个 agent`);
        return 0;
      }
      if (verb === "join") {
        const pos = positionals("connect room join", args.slice(1), [], ["--home", "--agent"]);
        const target = /^([^/\s]+)\/([^/\s]+)$/.exec(pos[0] ?? "");
        if (pos.length !== 1 || target === null) fail("gemworks connect room join: <owner/id> [--agent 名字]", 2);
        const agent = flag(args, "--agent");
        const r = await client.post(`/rooms/${encodeURIComponent(target![1]!)}/${encodeURIComponent(target![2]!)}/join`, agent === undefined ? {} : { agent });
        if (r.status !== 200) return refused(r);
        console.log(`进了房间「${(r.body as { venue: { name: string } }).venue.name}」${agent === undefined ? "" : ` · ${agent} 跟着`}`);
        return 0;
      }
      fail(USAGE, 2);
    }
    if (sub === "mode") {
      const pos = positionals("connect mode", args, [], ["--home"]);
      if (pos.length !== 2) fail("gemworks connect mode: <agent> <lurk|ask|chat>", 2);
      const r = await client.post(`/agents/${encodeURIComponent(pos[0]!)}/social`, { mode: pos[1] });
      if (r.status !== 200) return refused(r);
      console.log(`${pos[0]} ${MODE_WORDS[(r.body as { mode: SocialMode }).mode]}`);
      return 0;
    }
    if (sub === "digest") {
      if (args[0] === "list") {
        const pos = positionals("connect digest list", args.slice(1), [], ["--home"]);
        if (pos.length > 1) fail(USAGE, 2);
        const r = await client.get(`/digests/${encodeURIComponent(pos[0] ?? c.person)}`);
        if (r.status !== 200) return refused(r);
        for (const d of r.body as { text: string; agent: string; source: string; at: string }[]) console.log(`${d.at.slice(0, 10)} ${d.agent}${d.source === "edited" ? "（改过）" : ""}：${d.text}`);
        return 0;
      }
      if (positionals("connect digest", args, [], ["--home", "--as", "--text"]).length > 0) fail(USAGE, 2);
      const as = flag(args, "--as"), text = flag(args, "--text");
      if (as === undefined || text === undefined) fail("gemworks connect digest: --as <agent> --text <正文>, or list [person]", 2);
      const token = c.agents[as];
      if (token === undefined) return fail(`gemworks connect digest: 没有 ${as} 的令牌`, 1);
      const r = await new RelayClient(c.relay.url, token).post("/digests", { text });
      if (r.status !== 201) return refused(r);
      console.log(`${(r.body as { id: string }).id} · 等 ${c.person} 定`);
      return 0;
    }
    if (args[0] === "suggest") {
      if (positionals("connect match suggest", args.slice(1), [], ["--home"]).length > 0) fail(USAGE, 2);
      const r = await client.get("/match/suggest");
      if (r.status !== 200) return refused(r);
      const rows = r.body as { person: string; shared: string[] }[];
      if (rows.length === 0) console.log("没有公开作品相近的人");
      for (const x of rows) console.log(`${x.person} · ${x.shared.join(" ")}`);
      return 0;
    }
    const pos = positionals("connect match", args, [], ["--home", "--note", "--as"]);
    if (pos.length !== 1) fail("gemworks connect match: <person> [--note 一句话] [--as agent], or suggest", 2);
    const as = flag(args, "--as"), note = flag(args, "--note");
    const token = as === undefined ? c.token : c.agents[as];
    if (token === undefined) return fail(`gemworks connect match: 没有 ${as} 的令牌`, 1);
    const r = await new RelayClient(c.relay.url, token).post("/match", { person: pos[0], ...(note !== undefined ? { note } : {}) });
    if (r.status !== 201) return refused(r);
    console.log(`${(r.body as { id: string }).id} · 等 ${pos[0]} 点头${as === undefined ? "" : "，也等你"}`);
    return 0;
  } catch (e) { return fail(`gemworks connect ${sub}: ${e instanceof Error ? e.message : String(e)}`, 1); }
}

/** `gemworks connect`: the daemon until it is stopped; `setup`, `agent`, `status` and `--once` beside it. */
async function runConnect(rest: string[]): Promise<number> {
  const home = homeDir(flag(rest, "--home"), process.env);
  const sub = rest[0] !== undefined && !rest[0].startsWith("--") ? rest[0] : undefined;
  const args = sub === undefined ? rest : rest.slice(1);
  if (sub === "setup") {
    if (positionals("connect setup", args, [], ["--home", "--relay", "--token"]).length > 0) fail(USAGE, 2);
    const given = flag(args, "--relay"), token = flag(args, "--token");
    if (given === undefined || token === undefined) fail("gemworks connect setup: --relay <url> and --token <token> are required", 2);
    const url = given.replace(/\/+$/, "");
    try {
      const root = await new RelayClient(url).root();
      const me = await new RelayClient(url, token).me();
      if (!me.speaker.startsWith("person:") || me.scope !== "person") return fail("gemworks connect setup: the token is not a person's", 1);
      writeConfig(home, { relay: { url, name: root.name }, person: me.speaker.slice("person:".length), token, agents: readConfig(home)?.agents ?? {} });
      console.log(`connected ${me.speaker} to ${root.name} (${url}) · home ${home}`);
      return 0;
    } catch (e) {
      return fail(`gemworks connect setup: ${e instanceof Error ? e.message : String(e)}`, 1);
    }
  }
  if (sub === "agent") {
    const pos = positionals("connect agent", args, [], ["--home", "--token"]);
    const name = pos[0], token = flag(args, "--token");
    if (name === undefined || pos.length !== 1 || token === undefined) fail(USAGE, 2);
    const c = readConfig(home);
    if (c === undefined) return fail("gemworks connect agent: no connect.json here; run gemworks connect setup first", 1);
    writeConfig(home, { ...c, agents: { ...c.agents, [name]: token } });
    console.log(`agent ${name} added · home ${home}`);
    return 0;
  }
  if (sub === "adopt") {
    const pos = positionals("connect adopt", args, [], ["--home"]);
    const agent = pos[0];
    if (agent === undefined || pos.length !== 1) fail("gemworks connect adopt: <agent>", 2);
    const c = readConfig(home);
    if (c === undefined) return fail("gemworks connect adopt: no connect.json here; run gemworks connect setup first", 1);
    try {
      const r = await new RelayClient(c.relay.url, c.token).post(`/hosted/${encodeURIComponent(agent!)}/move`, {});
      if (r.status !== 200) return fail(`gemworks connect adopt: ${reasonOf(r)}`, 1);
      const moved = r.body as { token: string; files: { path: string; text: string }[] };
      writeConfig(home, { ...c, agents: { ...c.agents, [agent!]: moved.token } });
      const dir = join(home, "hosted", agent!);
      for (const f of moved.files) writeAtomic(join(dir, ...f.path.split("/")), f.text);
      console.log(`${agent} 搬来了 · 令牌已记入 connect.json · ${moved.files.length} 个文件在 ${dir}`);
      return 0;
    } catch (e) { return fail(`gemworks connect adopt: ${e instanceof Error ? e.message : String(e)}`, 1); }
  }
  if (sub === "phone-code") {
    if (positionals("connect phone-code", args, [], ["--home"]).length > 0) fail("gemworks connect phone-code takes no argument", 2);
    const c = readConfig(home);
    if (c === undefined) return fail("gemworks connect phone-code: no connect.json here; run gemworks connect setup first", 1);
    try {
      const r = await new RelayClient(c.relay.url, c.token).post("/phone/code", {});
      if (r.status !== 201) return fail(`gemworks connect phone-code: ${reasonOf(r)}`, 1);
      const code = (r.body as { code: string }).code;
      console.log(`绑定码 ${code} · 十分钟内在 bot 里发 /bind ${code}`);
      return 0;
    } catch (e) { return fail(`gemworks connect phone-code: ${e instanceof Error ? e.message : String(e)}`, 1); }
  }
  if (sub === "share") {
    if (positionals("connect share", args, ["--drafted"], ["--home", "--title", "--agent", "--scope", "--summary", "--turns", "--demo", "--open", "--repo", "--commit", "--license", "--evidence", "--replay"]).length > 0) fail(USAGE, 2);
    const title = flag(args, "--title"), agent = flag(args, "--agent"), scope = flag(args, "--scope");
    if (title === undefined || agent === undefined || scope === undefined) fail("gemworks connect share: --title, --agent and --scope are required", 2);
    const replay = flags(args, "--replay").map((r) => { const m = /^(\d+):(.+)$/.exec(r); return m === null ? undefined : { turn: Number(m[1]), label: m[2]!.trim() }; });
    if (replay.some((r) => r === undefined)) fail("gemworks connect share: --replay takes <turn>:<label>", 2);
    const c = readConfig(home);
    if (c === undefined) return fail("gemworks connect share: no connect.json here; run gemworks connect setup first", 1);
    const turns = flag(args, "--turns"), demo = flag(args, "--demo"), open = flag(args, "--open"), repo = flag(args, "--repo"), commit = flag(args, "--commit"), license = flag(args, "--license");
    const body = {
      title, agent, scope, summary: flag(args, "--summary") ?? "", summarySource: has(args, "--drafted") ? "drafted" : "self",
      ...(turns !== undefined ? { turns: Number(turns) } : {}), ...(demo !== undefined ? { demo } : {}), ...(open !== undefined ? { open } : {}),
      replay, evidence: flags(args, "--evidence"),
      use: { ...(repo !== undefined ? { repo } : {}), ...(commit !== undefined ? { commit } : {}), ...(license !== undefined ? { license } : {}), ai: "AI 生成，人审过" },
    };
    try {
      const r = await new RelayClient(c.relay.url, c.token).post("/cards", body);
      if (r.status !== 201) return fail(`gemworks connect share: ${reasonOf(r)}`, 1);
      console.log(`${c.relay.url}${(r.body as { url: string }).url}`);
      return 0;
    } catch (e) {
      return fail(`gemworks connect share: ${e instanceof Error ? e.message : String(e)}`, 1);
    }
  }
  if (sub === "card") return runCard(home, args);
  if (sub === "wallet") return runWallet(home, args);
  if (sub === "room" || sub === "mode" || sub === "digest" || sub === "match") return runSocial(home, sub, args);
  if (sub === "declare" || sub === "profile") return runDeclare(home, sub, args);
  if (sub === "channel" || sub === "signal" || sub === "risk") return runSignals(home, sub, args);
  if (sub === "status") {
    if (positionals("connect status", args, [], ["--home"]).length > 0) fail(USAGE, 2);
    const c = readConfig(home);
    if (c === undefined) { console.log(`not set up · home ${home}`); return 1; }
    const s = readState(home);
    const where = s === undefined ? "never synced" : s.connected ? `connected at ${s.at}` : `disconnected at ${s.at}: ${s.error ?? ""}`;
    console.log(`${c.person} on ${c.relay.name} (${c.relay.url}) · agents ${Object.keys(c.agents).join(", ") || "none"} · ${where} · outbox ${listOutbox(home).length} · home ${home}`);
    return s?.connected === true ? 0 : 1;
  }
  if (sub !== undefined) fail(USAGE, 2);
  if (positionals("connect", args, ["--once"], ["--home"]).length > 0) fail(USAGE, 2);
  const daemon = new Daemon({ home, log: (line) => console.error(line) });
  if (has(args, "--once")) {
    const r = await daemon.syncOnce();
    console.log(JSON.stringify(r));
    return r.connected ? 0 : 1;
  }
  const stop = (): void => daemon.stop();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  await daemon.run();
  return 0;
}

function main(argv: string[]): number {
  const [verb, ...rest] = argv;
  if (!verb) fail(USAGE, 2);
  switch (verb) {
    case "check": {
      const pos = positionals("check", rest, [], []);
      const file = pos[0];
      if (file === undefined || pos.length !== 1) fail(USAGE, 2);
      const path = resolve(file);
      const root = projectOf(path);
      const r = loadStatechart(readOrFail(path), file, { resolveRef: promptResolver(path, root), readDoc: docReader(dirname(path), root) });
      const ds = [...r.diagnostics];
      // The workflow's dictionary is checked against it — the project's one against all its workflows: its states must be theirs, its uses declared.
      const dict = dictionaryPathOf(path);
      if (r.statechart !== undefined && exists(dict)) {
        const own = dict === join(dirname(path), TOOLS_FILE);
        const others = own ? [] : installedWorkflows(root).filter((w) => realPath(w.path) !== realPath(path))
          .flatMap((w) => { try { return [loadStatechart(readText(w.path), w.path).statechart].filter((c) => c !== undefined); } catch { return []; } });
        for (const d of readDictionary(readOrFail(dict), [r.statechart, ...others]).diagnostics) ds.push({ ...d, message: `${TOOLS_FILE}: ${d.message}` });
      }
      printDiagnostics(ds);
      return hasErrors(ds) ? 1 : 0;
    }
    case "snapshot": {
      const file = rest[0]; if (!file || file.startsWith("--")) fail(USAGE, 2);
      const journal = readJournal(readOrFail(resolve(file)));
      const last = journal.snapshots[journal.snapshots.length - 1];
      if (!last) fail(`${file}: no revision`, 1);
      if (has(rest, "--json")) { console.log(JSON.stringify(last)); return 0; }
      const from = last.from !== undefined ? ` · from #${last.from}` : "";
      const restores = last.restores !== undefined ? ` · restores ${last.restores}` : "";
      console.log(`rev ${last.rev} · state #${last.state} · cause ${last.cause}${from}${restores}\nvars: ${canonical(last.vars)}\nhash: ${last.hash}\nat: ${last.at}`);
      return 0;
    }
    case "verify": {
      const file = rest[0]; if (!file || file.startsWith("--")) fail(USAGE, 2);
      const scPath = flag(rest, "--workflow");
      let sc;
      if (scPath) {
        const path = resolve(scPath);
        const r = loadStatechart(readOrFail(path), scPath, { readDoc: docReader(dirname(path), projectOf(path)) });
        if (!r.statechart) { printDiagnostics(r.diagnostics); return 1; }
        sc = r.statechart;
      }
      const errors = verifyJournal(readJournal(readOrFail(resolve(file))), sc);
      for (const e of errors) console.error(e);
      console.error(errors.length ? `${errors.length} error(s)` : "ok: chain verified");
      return errors.length ? 1 : 0;
    }
    case "export": {
      const file = rest[0]; if (!file || file.startsWith("--")) fail(USAGE, 2);
      if (flag(rest, "--to") !== "md") fail("export: only --to md is supported", 2);
      console.log(renderJournalMarkdown(readJournal(readOrFail(resolve(file)))));
      return 0;
    }
    case "init": {
      // `coding` is the default because that is what a repository is for: the
      // states are explore / plan / implement / verify / review, and the point
      // of them is that a file cannot be edited before a plan is recorded and
      // nothing reaches "done" without a recorded test result.
      const template = flag(rest, "--template") ?? "coding";
      const pos = positionals("init", rest, ["--no-activate"], ["--template"]);
      if (pos.length > 1) fail(USAGE, 2);
      let r: Added;
      try { r = addWorkflow(resolve(pos[0] ?? "."), template, { activate: !has(rest, "--no-activate") }); }
      catch (e) { return fail(String(e), 1); }
      if (!r.ok) return fail(r.code === 1 ? `${shown(r.target)} already exists; not overwriting` : r.reason, r.code);
      console.log(`wrote ${shown(r.target)}${r.activated ? " (active)" : ""}`);
      return 0;
    }
    case "use": {
      const pos = positionals("use", rest, [], []);
      if (pos.length !== 1) fail(USAGE, 2);
      const name = pos[0]!;
      const r = useWorkflow(process.cwd(), name);
      if (!r.ok) return fail(`gemworks: ${r.reason}`, 1);
      console.log(`default workflow: ${name} (a work item with a journal keeps its own)`);
      return 0;
    }
    case "status": {
      if (positionals("status", rest, ["--json"], []).length > 0) fail(USAGE, 2);
      return withWorkspace((ws) => {
        const s = ws.status();
        if (has(rest, "--json")) { console.log(JSON.stringify(s)); return 0; }
        if (s.item.kind !== "item") { console.log(s.item.reason); return 0; }
        const under = s.workflow.default !== undefined ? ` · workflow ${s.workflow.name} (default ${s.workflow.default})` : "";
        console.log(`${s.item.id} · ${s.state ? `#${s.state.id}` : "(no stage)"}${under}${s.paused ? " · paused" : ""}`);
        for (const [name, value] of Object.entries(s.vars)) {
          const source = s.sources[name];
          console.log(`  ${name} = ${JSON.stringify(value)}${source !== undefined ? `  (${source})` : ""}`);
        }
        for (const n of s.next) {
          const how = n.approval ? "a person approves" : n.judge === "machine" ? "on its own" : "by move";
          const guard = n.guard !== undefined ? `  when ${n.guard}${n.judge === "machine" ? (n.holds ? " (holds)" : ` (missing ${n.missing.join(", ")})`) : ""}` : "";
          console.log(`  → #${n.to}  ${how}${guard}`);
        }
        if (s.gh !== undefined && !s.gh.available) console.log(`  git evidence unavailable: ${s.gh.reason}`);
        return 0;
      });
    }
    case "mark":
    case "unmark": {
      const pos = positionals(verb, rest, [], []);
      if (pos.length !== 1) fail(USAGE, 2);
      const name = pos[0]!;
      return withWorkspace((ws) => {
        const r = ws.mark(name, verb === "mark");
        if (!r.ok) return fail(`gemworks: ${r.reason}`, 1);
        console.log(`${verb}ed ${name}${r.entered.length ? ` · entered ${chain(r.entered)}` : ""}`);
        return 0;
      });
    }
    case "advance": {
      const pos = positionals("advance", rest, [], []);
      if (pos.length !== 1) fail(USAGE, 2);
      const to = pos[0]!;
      return withWorkspace((ws) => {
        const r = ws.advance(to);
        if (!r.ok) return fail(`gemworks: ${r.reason}`, 1);
        console.log(`entered ${chain(r.entered)}`);
        return 0;
      });
    }
    case "pause":
    case "resume": {
      if (positionals(verb, rest, [], []).length !== 0) fail(USAGE, 2);
      return withWorkspace((ws) => {
        if (verb === "pause") {
          const r = ws.pause();
          if (!r.ok) return fail(`gemworks: ${r.reason}`, 1);
          console.log("paused");
          return 0;
        }
        const r = ws.resume();
        if (!r.ok) return fail(`gemworks: ${r.reason}`, 1);
        console.log(`resumed${r.entered.length ? ` · entered ${chain(r.entered)}` : ""}`);
        return 0;
      });
    }
    case "rollback": {
      const pos = positionals("rollback", rest, [], []);
      if (pos.length > 1) fail(USAGE, 2);
      const arg = pos[0] ?? "checkpoint";
      const target = arg === "checkpoint" ? "checkpoint" : Number(arg);
      if (target !== "checkpoint" && (!Number.isInteger(target) || target < 0)) fail("gemworks rollback: expected a revision number or checkpoint", 2);
      return withWorkspace((ws) => {
        const r = ws.rollback(target);
        if (!r.ok) return fail(`gemworks: ${r.reason}`, 1);
        console.log(`rev ${r.rev} restores rev ${r.restores} · state #${r.state}${r.entered.length ? ` · entered ${chain(r.entered)}` : ""}`);
        return 0;
      });
    }
    case "migrate": {
      if (positionals("migrate", rest, [], []).length > 0) fail(USAGE, 2);
      const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "");
      const moved = migrateLayout(process.cwd(), join(homedir(), ".gemworks", "trash", `${stamp}-layout`));
      if (moved.length === 0) { console.log("nothing to move: no workflow directory or .geml/gemflow.geml here"); return 0; }
      for (const m of moved) console.log(`${shown(m.from)} → ${shown(m.to)}${m.kept ? " (git tracks it: left where it is; remove it with git rm)" : ` (moved to ${m.trashed})`}`);
      return 0;
    }
    case "run": {
      const profile = has(rest, "--profile") ? (flag(rest, "--profile") as string) : "headless";
      // Everything that is not the flag or its value is the task. Joined rather
      // than taking one argument, so an unquoted task still reads sensibly.
      const skip = new Set<number>();
      const at = rest.indexOf("--profile");
      if (at >= 0) { skip.add(at); skip.add(at + 1); }
      const task = rest.filter((_, i) => !skip.has(i)).join(" ").trim();
      if (task.length === 0) fail(USAGE, 2);
      let workflow: ReturnType<typeof resolveWorkflow>;
      try { workflow = resolveWorkflow(process.cwd()); }
      catch (e) { workflow = { error: e instanceof Error ? e.message : String(e), kind: "invalid" }; }
      if ("error" in workflow) console.error(`gemworks: ${workflow.error} — the agent will run unsupervised`);
      return runTask({ profile, task });
    }
    default:
      fail(USAGE, 2);
  }
}

const argv = process.argv.slice(2);
// The async verbs end by letting the process drain: process.exit right after a
// write to a pipe can cut the answer short on macOS.
if (argv[0] === "hook") void runHook().then((code) => { process.exitCode = code; });
else if (argv[0] === "codex") void runCodexHook().then((code) => { process.exitCode = code; });
else if (argv[0] === "antigravity") void runAntigravityHook(argv[1]).then((code) => { process.exitCode = code; });
else if (argv[0] === "connect") void runConnect(argv.slice(1)).then((code) => { process.exitCode = code; });
else if (argv[0] === "relay") void runRelay(argv.slice(1)).then((code) => { process.exitCode = code; });
else if (argv[0] === "phone") void runPhone(argv.slice(1)).then((code) => { process.exitCode = code; });
else if (argv[0] === "mcp") {
  const rest = argv.slice(1);
  if (positionals("mcp", rest, [], ["--host", "--root"]).length > 0) fail(USAGE, 2);
  void serveMcp({ root: resolve(flag(rest, "--root") ?? "."), host: flag(rest, "--host") ?? "mcp" });
} else process.exit(main(argv));
