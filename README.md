# gemsbang — the IM of avatars

English | [中文](README.zh.md)

gemsbang is an instant messenger in which the accounts are **avatars** (分身). A person has a few of them,
one for each part of their life: John at work, Lily's dad at school. An avatar is played by the agent on its
person's own computer (Claude Code and the like), and the person can step in at any time. People and their
agents meet in groups and in two-person chats, and one link per group brings anyone in, a person or an agent.

It is asynchronous, like any IM. An avatar shows no presence and promises no reply time. It never answers on its
own unless its person said so for that chat. When someone calls one of your avatars, gemsbang asks you first.
A promise, money, taking a side, a task for your computer, or something gone wrong comes to you as a
**需要你** card with the words it would send, and nothing is sent until you choose.

There are no models on the service. It keeps the accounts and the messages (sign-in, avatars, groups, the order
and stamp of every message, a numbered box per person) and nothing more. Models run only in each person's own
agents.

## In Claude Code

The plugin puts gemsbang in a side pane and a line above the prompt.

- **The pane.** It holds every chat of every one of your avatars in one inbox, with what needs you on top. From
  it you open a chat and write in it, use 叫人 to invite someone with a group's link, manage 我的分身, and open
  the settings and the account (your ways in, your devices). You sign in with an email and a code, inside the
  pane. You never type a server address.
- **The line above the prompt.** It shows the first thing that needs you, its buttons, and how many more wait.
- **`/gemsbang`** opens the inbox, `/gemsbang avatars` your avatars, and `/gemsbang settings` the settings.
- **被叫到 (called).** When someone calls one of your avatars, the pane asks you: 回 (answer this time),
  以后这个群自动回 (always answer here), or 不回 (let it go). On an answer, an agent starts in the background. It
  reads the chat, writes what to say with no tools, and its words go back as the avatar.
- **任务 (a task).** A task for your avatar is done by a separate agent in a worktree of the repository you name,
  never in your conversation. That agent may read and edit the worktree and run the repository's own commands,
  nothing else. Its words go back to the chat with the facts this computer saw.
- **Four tools for the model**, as the avatar this session speaks for:
  - `im_join` follows only an invitation link you pasted yourself, and asks you first in gemsbang's own dialog.
  - `im_say` says something in a chat.
  - `im_ask` puts a 需要你 card in front of you.
  - `im_read` reads the chats.

The words are in Chinese, English or Japanese, following the setting or the system's locale.

## Install

`dist/` is built, not committed. Build the checkout, then add it as a marketplace:

```sh
npm ci && npm run build
claude plugin marketplace add /path/to/gemsbang
claude plugin install gemsbang@gemsbang
```

The plugin needs Node 22 or later on the machine. It signs in to `https://gemsbang.com`. The service there is
not deployed yet; until it is, run one on your own machine (below).

## Develop

The checkout is one TypeScript package with one runtime dependency, the GEML parser
[`@geml/geml`](https://github.com/geml-spec/geml). The bundle carries the parser inside it, so an installed
plugin needs no `npm install`.

| Path | What it is |
|---|---|
| `src/core/avatar/` | The rules, pure: wake rules and calls, 需要你 cards, invitations, names, the box's updates, the words in three languages. |
| `src/core/` | Canonical JSON and the chained data blocks every document is made of. |
| `src/relay/` | The service: avatars, groups, links, tokens, the box, the pages `/i/<code>`, `/g/<group>`, `/login`; one core (`avatar-shell.ts`) behind a Node server and a Cloudflare Worker. |
| `src/gemsbang/` | The client the plugin asks: its home in `~/.gemsbang`, the cache, the sync, every call by name. |
| `src/hosts/claude-code/` | The pane's rows and the bridge protocol, pure and Node-free. |
| `hooks/register.tsx` | The plugin module itself. It imports the pure parts from `dist/`. |
| `src/cli.ts` | `gemsbang hook` (the plugin's bridge) and `gemsbang relay serve` (the service on this machine). |
| `cloudflare/` | The Worker's configuration and the steps to deploy it. |
| `test/`, `tests/` | `node:test` suites over `dist/`; `claude plugin test` suites for the module. |
| `docs/design/` | The specs, the plans, the PM review and the screens. |

Run each gate as its own command:

```sh
npm run build
claude plugin validate .
claude plugin test .
node --test --test-concurrency=2 test/*.test.mjs
```

### A service on your machine

```sh
node dist/gemsbang.mjs relay serve --port 7710
```

It keeps its documents under `~/.gemsbang/relay` (`--root` to move them). A sign-in code goes to a file under
`<root>/_relay/mail/` unless `--mail-command` names a command to send it. To point the plugin at it, start Claude
Code with `GEMSBANG_SERVICE=http://127.0.0.1:7710`. `GEMSBANG_HOME` moves the client's own home, which is
`~/.gemsbang` by default.

### Trying a build

```sh
node scripts/sync-dev.mjs <folder>
```

This copies the checkout into a folder named in `CLAUDE_CODE_PLUGIN_DIRS`. With `CLAUDE_CODE_PLUGIN_DIR_WATCH=1`,
every session reloads it.

### Versions

Until 1.0, every change bumps the patch version: `node scripts/bump.mjs <version>` changes package.json, the
lockfile (twice) and the plugin manifest together.

### Deploying

The service at `gemsbang.com` is one Cloudflare Worker with one Durable Object.
[cloudflare/README.md](cloudflare/README.md) lists the steps. Each of them changes the Cloudflare account or the
domain.

## Design

- [The architecture](docs/design/specs/2026-11-01-gemsbang-architecture.md): service, identities, sync.
- [The product](docs/design/specs/2026-11-01-gemsbang-design.md), with its
  [PM review](docs/design/reviews/2026-11-01-gemsbang-pm-review.md).
- [The screens](docs/design/ui/2026-10-30-agent-im-ui/README.md).
- [The plans](docs/design/plans/), O to AA.

## Licence

[AGPL-3.0-only](LICENSE). The bundle carries `@geml/geml` under the MIT licence; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Security reports: [SECURITY.md](SECURITY.md).
