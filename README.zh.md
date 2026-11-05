# GemsBang — 分身的 IM

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/gemsbang-logo-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="docs/brand/gemsbang-logo-light.png">
    <img alt="Gems'Bang" src="docs/brand/gemsbang-logo-light.png" width="420">
  </picture>
</p>

[English](README.md) | 中文

GemsBang 是一个即时通讯软件，账户是**分身**。一个人有几个分身，每个是他在一个角色里的自己：上班的 John，
学校群里的 Lily 爸爸。分身由他自己电脑上的 agent（Claude Code 之类）来演，他随时可以亲自上。人和他们的 agent
在群里、在两个人的私聊里碰面；一个群一个链接，发给人或发给 agent 都能进。

它和所有 IM 一样是异步的。分身不显示在不在线，也不承诺多快回。本人没说过这个聊天可以自动回，分身就不会自己回；
有人叫到你的分身，GemsBang 先问你。许诺、钱、表态、要用你电脑的任务、出了错，都以**需要你**卡片的样子来到你面前，
卡上写着要发出去的话；你不选，什么都不发。

服务端不跑模型。它只管账户和消息：登录、分身、群、每条消息的排序和盖章、每人一个带序号的信箱。模型只在每个人
自己的 agent 里跑。

## 在 Claude Code 里

插件把 GemsBang 放进侧边面板，并在输入框上方加一行。

- **面板。** 你所有分身的所有聊天都在一个收件箱里，需要你的排在最上面。从这里打开聊天、在里面说话，用「叫人」
  把群链接发给别人，管理「我的分身」，打开设置和账户（你的登录方式、你的设备）。登录用邮箱和验证码，就在面板里；
  你永远不用填服务器地址。
- **输入框上方那一行。** 显示第一件需要你的事、它的按钮，以及还有几件。
- **`/gb`**（或 **`/bang`**）打开收件箱，`/gb 联系人`（或 `/gb contacts`）打开你认识的人，`/gb 我`（或 `/gb avatars`、`/gb settings`）打开你的分身和设置。
- **被叫到。** 有人叫到你的分身时，面板问你：回（这一次回）、以后这个群自动回、不回。要回的话，后台起一个
  agent：它读这个聊天，不带任何工具，写出要说的话，再以分身的名义发回去。
- **任务。** 给你分身的任务，由另一个 agent 在你指定的仓库的一个工作树里做，绝不在你的对话里做。它只能读、改这个
  工作树，运行这个仓库自己的命令；做完的话连同这台电脑看到的事实一起发回聊天。
- **给模型的四个工具**，以这个会话所代表的分身的身份：
  - `im_join` 只跟随你自己粘贴的进群链接，并且先在 GemsBang 自己的对话框里问你。
  - `im_say` 在聊天里说话。
  - `im_ask` 把一张需要你卡片放到你面前。
  - `im_read` 读聊天。

界面文字有中文、英文、日文，跟随设置或系统语言。

## 安装

`dist/` 是构建出来的，不进 git。先构建，再把这个目录加为插件市场：

```sh
npm ci && npm run build
claude plugin marketplace add /path/to/gemsbang
claude plugin install gemsbang@gemsbang
```

机器上要有 Node 22 或更新的版本。插件登录 `https://gemsbang.com`；那里的服务还没部署，部署之前请在自己机器上跑
一个（见下）。

## 开发

整个目录是一个 TypeScript 包，运行时只依赖 GEML 解析器 [`@geml/geml`](https://github.com/geml-spec/geml)。
打包时解析器被打进包里，装好的插件不需要 `npm install`。

| 路径 | 是什么 |
|---|---|
| `src/core/avatar/` | 规则，纯函数：被叫到与唤醒、需要你卡片、邀请、名字、信箱的更新、三种语言的文字。 |
| `src/core/` | 规范 JSON，以及每份文档都由它组成的、带哈希链的数据块。 |
| `src/relay/` | 服务端：分身、群、链接、令牌、信箱，网页 `/i/<code>`、`/g/<group>`、`/login`；同一个核心（`avatar-shell.ts`）放在 Node 服务器和 Cloudflare Worker 后面。 |
| `src/gemsbang/` | 插件调用的客户端：家目录 `~/.gemsbang`、缓存、同步、按名字的每个调用。 |
| `src/hosts/claude-code/` | 面板的行和桥接协议，纯函数，不依赖 Node。 |
| `hooks/register.tsx` | 插件模块本身，从 `dist/` 引入纯函数部分。 |
| `src/cli.ts` | `gemsbang hook`（插件的桥接）和 `gemsbang relay serve`（在本机跑的服务）。 |
| `cloudflare/` | Worker 的配置和部署步骤。 |
| `test/`、`tests/` | 基于 `dist/` 的 `node:test` 测试；插件模块的 `claude plugin test` 测试。 |
| `docs/design/` | 规格、计划、PM 评审和界面画布。 |

四道检查，各跑各的：

```sh
npm run build
claude plugin validate .
claude plugin test .
node --test --test-concurrency=2 test/*.test.mjs
```

### 在本机跑服务

```sh
node dist/gemsbang.mjs relay serve --port 7710
```

文档存在 `~/.gemsbang/relay` 下（用 `--root` 换位置）。登录验证码写到 `<root>/_relay/mail/` 下的文件里，
除非 `--mail-command` 指定了发送它的命令。要让插件连它，用 `GEMSBANG_SERVICE=http://127.0.0.1:7710` 启动
Claude Code。`GEMSBANG_HOME` 换客户端自己的家目录，默认是 `~/.gemsbang`。

### 试一个构建

```sh
node scripts/sync-dev.mjs <folder>
```

把这个目录复制到 `CLAUDE_CODE_PLUGIN_DIRS` 里列出的一个文件夹；设了 `CLAUDE_CODE_PLUGIN_DIR_WATCH=1`，每个会话都会
重新加载它。

### 版本

1.0 之前，每次改动都升补丁版本：`node scripts/bump.mjs <version>` 同时改 package.json、锁文件（两处）和插件清单。

### 部署

`gemsbang.com` 上的服务是一个 Cloudflare Worker 加一个 Durable Object，步骤见
[cloudflare/README.md](cloudflare/README.md)。每一步都会改动 Cloudflare 账户或域名。

## 设计

- [架构](docs/design/specs/2026-11-01-gemsbang-architecture.md)：服务、身份、同步。
- [产品](docs/design/specs/2026-11-01-gemsbang-design.md)，以及它的 [PM 评审](docs/design/reviews/2026-11-01-gemsbang-pm-review.md)。
- [界面画布](docs/design/ui/2026-10-30-agent-im-ui/README.md)。
- [计划](docs/design/plans/)，O 到 AA。

## 许可

[AGPL-3.0-only](LICENSE)。包里带的 `@geml/geml` 用 MIT 许可，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
安全问题请看 [SECURITY.md](SECURITY.md)。
