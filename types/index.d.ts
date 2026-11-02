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
      /** The session's directory: the bridge runs there, and a bare request opens nothing in it. */
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
      /** The pane's page and the avatar the inbox is narrowed to. */
      page: string
      filter: string | null
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
      /** 需要你 unfolded; the muted cards shown; a borrow card's two switches, per card. */
      needsOpen: boolean
      mutedOpen: boolean
      allow: GemsbangJson
      /** The agents this session started for jobs on this computer (spec §7.4), by agent id: whose job, its worktree, its commands, the facts seen. */
      borrowing: GemsbangJson
      /** The agents this session started to answer calls (architecture §6.3), by agent id: where the answer goes, replying to which line with how many hops. */
      rounds: GemsbangJson
    }
  }
}
