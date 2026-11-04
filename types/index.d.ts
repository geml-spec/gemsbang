// The values gemsbang's hooks module keeps in $.state (plan R). What the bridge
// answers is kept as JSON; the module reads it as the client's types
// (src/gemsbang/ops.ts) and the pane's (src/hosts/claude-code/gb-panel.ts).
export type GemsbangJson = null | boolean | number | string | readonly GemsbangJson[] | { readonly [key: string]: GemsbangJson }

declare module 'claude-code' {
  interface PluginState {
    gemsbang: {
      /** Why the plugin cannot do its part (no Node, a bridge that does not answer or answers what does not parse); null while it can. */
      problem: string | null
      node: string | null
      /** The session's directory: the bridge runs there, and a task's repository is named from it. */
      root: string | null
      startedAt: number | null
      /** A tool or the command the engine would not register. */
      setup: string | null
      /** The plugin's version, from its manifest. */
      version: string | null
      /** The client's view as the bridge last read it (GbView). */
      view: GemsbangJson
      /** The chat open (GbChat), and its link while 叫人 shows (GbLink). */
      chat: GemsbangJson
      link: GemsbangJson
      /** The pane's page. */
      page: string
      /** The email a sign-in code was sent to, until the code is in; an email being added to the account, the same. */
      address: string | null
      adding: string | null
      /** The account as last read for its page (GbAccount). */
      account: GemsbangJson
      /** The avatar a new group is made as ('new' for a new one), and the new one's name. */
      groupAs: string
      groupAvatar: string | null
      /** The invitations for agents the person typed or pasted this session (spec §6.3). */
      pasted: GemsbangJson
      /** The card whose 自己写 field is open, by its row's key; null when none is. */
      writing: string | null
      /** The inbox's ＋ open; 建群's list of avatars open; 用链接进群 once the link was read (what it says, where the person is in it). */
      plusOpen: boolean
      /** Which item leads the list of a page with 聊天 · 我 pinned at its foot (S11). */
      listLead: number
      asOpen: boolean
      joining: GemsbangJson
      /** The account a browser opened to sign in with (S28): which, and its link. */
      sso: GemsbangJson
      /** 加一种登录方式's other accounts (S32), each with its link. */
      addLinks: GemsbangJson
      /** The card of 我 whose 改 is open, by its row's key; null when none is (one at a time). */
      editing: string | null
      /** 叫人's 换一个链接 asked, not yet answered (P4c); the page 叫人 was opened from, where its ‹ goes back to. */
      rotating: boolean
      inviteBack: string
      /** 我's languages open; a card's 任务 field open; 账号与登录's 加一种登录方式 open; 退出这台设备的登录 asked (P10c). */
      langOpen: boolean
      repoOpen: boolean
      addOpen: boolean
      loggingOut: boolean
      /** Each avatar's standing 以后不用问 (S23), read when 我 opens. */
      allows: GemsbangJson
      /** 退出群 asked (P7); the one the 群主 picked to keep the group. */
      leaving: boolean
      heir: string | null
      allow: GemsbangJson
      /** The agents this session started for jobs on this computer (spec §7.4), by agent id: whose job, its worktree, its commands, the facts seen. */
      borrowing: GemsbangJson
      /** The agents this session started to answer calls (architecture §6.3), by agent id: where the answer goes, replying to which line with how many hops. */
      rounds: GemsbangJson
    }
  }
}
