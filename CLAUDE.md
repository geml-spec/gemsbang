# Gemsbang — notes for Claude

Gemsbang is the IM of avatars: a Claude Code plugin (a side pane, a line above the prompt, five `im_*` tools), the
service behind it as a Node server and a Cloudflare Worker, and a small CLI (`gemsbang`). It depends on the
published `@geml/geml` parser and nothing else at runtime. The design is in `docs/design/` (the architecture spec
wins where the specs disagree).

## Layout

- `src/core/` — pure: canonical JSON, the chained data blocks; `src/core/avatar/` the rules (calls, cards, links,
  names, the box's updates, the words in three languages).
- `src/relay/` — the service: one core (`avatar-shell.ts`) behind the Node server (`avatar-server.ts`) and the
  Worker (`worker.ts`); documents behind `doc-store.ts` (files, memory or SQLite).
- `src/gemsbang/` — the client the plugin asks (home `~/.gemsbang`, cache, sync), and its bridge.
- `src/hosts/claude-code/` — the pane's rows and the bridge protocol, Node-free; `hooks/register.tsx` is the plugin
  module itself and imports them from `dist/`.
- `cloudflare/` — the Worker's configuration and the deploy steps.
- `test/*.test.mjs` — node:test suites over `dist/`; `tests/*.test.ts` — `claude plugin test` suites for the module.

## Build and check

Run each gate as its own command and report it.

```sh
npm run build                                     # tsc + bundle (dist/gemsbang.mjs)
claude plugin validate .
claude plugin test .
node --test --test-concurrency=2 test/*.test.mjs  # includes the hooks type check
```

A gate that finds nothing to check (no type declarations, no prerequisite) has failed, not passed.

## Versions

Until 1.0, every change to the plugin bumps the patch version: the pane's header shows it, and that is how anyone
can tell which build they run. `node scripts/bump.mjs <version>` changes all four places (package.json, the lockfile
twice, the plugin manifest); the plugin-files test fails when they disagree. Release notes are prose for people:
they are not written as a side effect of a bump.

## Trying a build

`node scripts/sync-dev.mjs <folder>` copies the checkout into a folder named in `CLAUDE_CODE_PLUGIN_DIRS` (with
`CLAUDE_CODE_PLUGIN_DIR_WATCH=1` every session reloads it). Sync only after all gates pass. A fix is not done until
the running version is the synced one: check the version in the pane's header or the session's last reload
before saying so. The plugin signs in to https://gemsbang.com; `GEMSBANG_SERVICE` points it at
`node dist/gemsbang.mjs relay serve` instead.

## Rules that bite

- Cross-platform: every test must hold on Linux and macOS as well as Windows — path separators, CRLF, `cmd.exe`
  quoting, case-sensitive file systems. CI runs all three.
- The plugin never stops the person on its own failure: anything it cannot decide in two seconds lets the call
  through.
- A rendering hook is pure (it reads state, never writes it); desktop panes fail past about 1,100 elements.
- Read the engine's own declarations before fixing behaviour that depends on it.
- A person never sees the service's insides: no 中继, no server address, in anything a person reads.
- Services and ports a test starts are closed in `finally`, or a red test hangs until the timeout.
- `.geml/` in this checkout is working data and never goes into git.
- Commit messages are in English; nothing goes to npm, GitHub or Cloudflare without the maintainer's say-so.
