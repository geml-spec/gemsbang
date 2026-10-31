#!/usr/bin/env node
// gemworks — offline verbs over workflows and journals, the project verbs a
// person uses beside an agent (init, use, status, mark, unmark, advance,
// rollback), and `run`, which is the one verb that reaches outside this
// package (it starts dsh).
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { exists, readText, realPath } from "./host-fs.js";
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
  "  relay [--root dir] [--port N] [--name host] [--host addr] [--federation open|closed]  the IM relay, until it is stopped (root: ~/.gemworks/relay)",
  "  relay token <person> [--root dir]       issue a person's token on that relay and print it",
  "  connect [--home dir] [--once]           the IM daemon: mirror the relay, push the outbox, heartbeat (home: ~/.gemworks/im)",
  "  connect setup --relay <url> --token <t> | agent <name> --token <t> | status   set the daemon up, add an agent's token, say where it stands",
  "  connect share --title <t> --agent <a> --scope <s> [--summary s] [--drafted] [--turns N] [--demo url] [--open url] [--repo r] [--commit c] [--license l] [--evidence line]... [--replay N:label]...   a share card on the relay (§11); prints its page's address",
  "  connect card <verb> [owner/id] [flags]   a task card (§8): new, publish, claim, grant, note, giveback, deliver, report, accept, changes, resume, dispute, settle, close, show, list",
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
  if (positionals("relay", rest, [], ["--root", "--port", "--name", "--host", "--federation"]).length > 0) fail(USAGE, 2);
  const port = Number(flag(rest, "--port") ?? "7700");
  if (!Number.isInteger(port) || port < 0 || port > 65535) fail("gemworks relay: --port needs a number from 0 to 65535", 2);
  const federation = flag(rest, "--federation") ?? "closed";
  if (federation !== "open" && federation !== "closed") fail("gemworks relay: --federation is open or closed", 2);
  const host = flag(rest, "--host") ?? "127.0.0.1";
  const name = flag(rest, "--name") ?? "localhost";
  const s = await startRelay({ root, name, port, host, federation, version: packageVersion() });
  console.log(`relay ${name} listening on ${s.url} · documents under ${root}`);
  await new Promise<void>((done) => {
    const stop = (): void => { void s.close().then(done); };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  return 0;
}

const CARD_VERBS = ["new", "publish", "claim", "grant", "note", "giveback", "deliver", "report", "accept", "changes", "resume", "dispute", "settle", "close", "show", "list"] as const;
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
  const valued = ["--home", "--venue", "--agent", "--text", "--evidence", "--note", "--deliverable", "--result", "--comment", "--reason", "--outcome"];
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
    default: break;
  }
  try {
    const r = await client.post(`${path}/${verb}`, body);
    if (r.status !== 200) return refused(r);
    const out = r.body as { card: Card; decision?: "accepted" | "changes" | "inbox" };
    const decision = out.decision === undefined ? "" : out.decision === "accepted" ? " · 已接受" : out.decision === "changes" ? " · 要改" : " · 等你验收";
    console.log(`${cardWords(out.card)}${decision}`);
    return 0;
  } catch (e) { return fail(`gemworks connect card ${verb}: ${e instanceof Error ? e.message : String(e)}`, 1); }
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
else if (argv[0] === "mcp") {
  const rest = argv.slice(1);
  if (positionals("mcp", rest, [], ["--host", "--root"]).length > 0) fail(USAGE, 2);
  void serveMcp({ root: resolve(flag(rest, "--root") ?? "."), host: flag(rest, "--host") ?? "mcp" });
} else process.exit(main(argv));
