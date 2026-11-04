// The pane as the desktop draws it, for scripts/preview-pane.mjs: the engine's
// own test host mounts the gemsbang Pane on the desktop surface, a scripted
// bridge answers with the people and chats of a canvas board
// (docs/design/ui/2026-10-30-agent-im-ui/project), and each scene's drawn tree
// is printed as one `GEMSBANG-PREVIEW <scene> <json>` line. Not a test: it is
// named so `claude plugin test .` never runs it; the script copies it in as one.
import type { On } from 'claude-code'
import { mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const ROOT = '/work/app'
const SESSION = 'sess-preview'
const RELAY = 'https://gemsbang.com'
const PANE = { title: 'Gemsbang', isFocused: true, bodyColumns: 56, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 60 }, view: {} }

// GbInbox: John and his second avatar, Lily 爸爸.
const JOHN = { id: 'a-0000000001', name: 'John', color: '#2563eb', initial: 'J', venues: ['设置页改版', '前端周会'], mark: true, muted: false, autos: [] }
const LILY = { id: 'a-0000000002', name: 'Lily 爸爸', color: '#c2410c', initial: 'L', venues: ['三年二班家长'], mark: false, muted: false, autos: [] }
const badge = (a: typeof JOHN) => ({ id: a.id, name: a.name, color: a.color, initial: a.initial })
const at = (hh: number, mm: number, day = 2) => new Date(Date.UTC(2026, 10, day, hh, mm)).toISOString()
const WEEKLY = { owner: 'a-00000000w5', id: 'g-00000000wk' }
const CLASS = { owner: 'a-00000000t1', id: 'g-00000000cl' }
const INBOX = {
  relay: RELAY, loggedIn: true, lang: 'zh', person: 'p-0000000001', avatars: [JOHN, LILY], unread: 6,
  calls: [{ avatar: JOHN.id, ...WEEKLY, kind: 'group', group: '前端周会', lines: [{ id: 'm-w1', who: '王五', text: '@John 明天站会谁来讲 Safari 导出的问题？', reason: 'mention', at: at(19, 40) }], last: 'm-w1', at: at(19, 40), auto: false, badge: badge(JOHN), muted: false }],
  needs: [{ id: 'n-1', avatar: LILY.id, kind: 'promise', summary: '王老师问周五春游能不能来当志愿者。', checked: '你的日程：周五下午空。', draft: '周五我可以去，几点集合？', options: [{ label: '能去，问集合时间', text: '周五我可以去，几点集合？' }, { label: '去不了', text: '这周五去不了，不好意思。' }], at: at(19, 31), state: 'open', avatarName: 'Lily 爸爸', group: '三年二班家长', badge: badge(LILY), muted: false, venue: CLASS },
    // The third, folded behind 还有 1 件: a task 张三 gave John's computer.
    { id: 'n-2', avatar: JOHN.id, kind: 'borrow', summary: '张三派了个任务：修 Safari 里导出按钮没反应', options: [{ label: '现在干' }, { label: '排着' }, { label: '不干' }], at: at(14, 5), state: 'open', avatarName: 'John', group: '设置页改版', badge: badge(JOHN), muted: false, venue: { owner: JOHN.id, id: 'g-00000000st' } }],
  work: [],
  rows: [
    { owner: JOHN.id, id: 'g-00000000st', kind: 'group', name: '设置页改版', as: badge(JOHN), last: { who: '李四', text: '@John 周五前能给稿子反馈吗？' }, at: at(14, 11), time: '14:11', unread: 4 },
    { ...WEEKLY, kind: 'group', name: '前端周会', as: badge(JOHN), last: { who: '王五', text: '@John 明天站会谁来讲 Safari 导出的问题？' }, at: at(19, 40), time: '19:40', unread: 1 },
    { ...CLASS, kind: 'group', name: '三年二班家长', as: badge(LILY), last: { who: '王老师', text: '周五下午能来开家长会吗？' }, at: at(19, 31), time: '19:31', unread: 1 },
    { owner: JOHN.id, id: 'd-00000000ls', kind: 'dm', name: '李四', as: badge(JOHN), last: { who: '你', text: '收到，周五前给你' }, at: at(18, 2, 1), time: '昨天', unread: 0 },
  ],
  muted: { avatars: [], venues: [] }, notes: [], bodies: { [SESSION]: JOHN.id }, recent: JOHN.id, synced: at(19, 45),
}

// GbChat: 设置页改版 as John, 李四's agent and 张三 calling him, the card after the last line that called.
const ZHANG = '张三', LI = '李四'
const LI_ID = 'a-00000000b1', ZHANG_ID = 'a-00000000b2'
const CHAT_VIEW = { ...INBOX, calls: [{ avatar: JOHN.id, owner: JOHN.id, id: 'g-00000000st', kind: 'group', group: '设置页改版', lines: [{ id: 'm-2', who: ZHANG, text: '@John Safari 里导出按钮点了没反应', reason: 'mention', at: at(14, 3) }, { id: 'm-3', who: LI, text: '@John 周五前能给稿子反馈吗?', reason: 'mention', at: at(14, 11) }], last: 'm-3', at: at(14, 11), auto: false, badge: badge(JOHN), muted: false }], needs: [] }
const MEMBERS = [{ id: JOHN.id, name: 'John' }, { id: LI_ID, name: LI }, { id: ZHANG_ID, name: ZHANG }, { id: 'a-00000000b3', name: '王五' }]
const CHAT = { owner: JOHN.id, id: 'g-00000000st', kind: 'group', name: '设置页改版', count: 4, as: badge(JOHN), members: MEMBERS, rules: { forward: true, approve: true }, earlier: 21, isOwner: true, items: [
  { kind: 'joined', id: 'j-1', avatar: LI_ID, who: LI, at: at(14, 1) },
  { kind: 'message', id: 'm-1', avatar: LI_ID, who: LI, text: 'v4 稿子在这 [设置页 v4.fig]，周五前要定。', at: at(14, 2), mark: true, mine: false },
  { kind: 'message', id: 'm-2', avatar: ZHANG_ID, who: ZHANG, text: '@John Safari 里导出按钮点了没反应', at: at(14, 3), mark: false, mine: false },
  { kind: 'message', id: 'm-3', avatar: LI_ID, who: LI, text: '@John 周五前能给稿子反馈吗?', at: at(14, 11), mark: true, mine: false },
  { kind: 'message', id: 'm-4', avatar: JOHN.id, who: 'John', text: '我下午看，先说 Safari 的。', at: at(14, 16), mark: false, mine: true },
  { kind: 'left', id: 'leave-1', avatar: 'a-00000000b9', who: 'Mia', at: at(17, 20) },
] }

// Direction ①'s bar: 三年二班家长 as Lily 爸爸, 王老师's question and the card about it above the box.
const CLASS_CHAT = { ...CLASS, kind: 'group', name: '三年二班家长', count: 12, as: badge(LILY), members: [{ id: LILY.id, name: 'Lily 爸爸' }, { id: 'a-00000000t2', name: '王老师' }], earlier: 0, isOwner: false, items: [
  { kind: 'message', id: 'm-c1', avatar: 'a-00000000t2', who: '王老师', text: '周五春游能来当志愿者吗？', at: at(19, 30), mark: false, mine: false },
] }
// The inbox with a muted group someone called in: it stays in its place, a grey dot for its unread (S17).
const QUIET = { owner: 'a-00000000q1', id: 'g-00000000qt' }
const MUTED_VIEW = { ...INBOX, rows: [...INBOX.rows.slice(0, 3), { ...QUIET, kind: 'group', name: '小区业主群', as: badge(LILY), last: { who: '物业', text: '@Lily 爸爸 车位的事明天定' }, at: at(13, 5), time: '13:05', unread: 3 }, INBOX.rows[3]], calls: [...INBOX.calls, { avatar: LILY.id, ...QUIET, kind: 'group', group: '小区业主群', lines: [{ id: 'm-q1', who: '物业', text: '@Lily 爸爸 车位的事明天定', reason: 'mention', at: at(13, 5) }], last: 'm-q1', at: at(13, 5), auto: false, badge: badge(LILY), muted: true }], muted: { avatars: [], venues: [`${QUIET.owner}/${QUIET.id}`] } }

// P8's 我: John works in settings-app and answers 设置页改版 on his own; Lily 爸爸 muted; both played.
const BASE = [
  { id: 'base-1', label: '家人', text: 'Lily，8 岁，三年二班', for: [LILY.id], state: 'kept', by: 'person', at: at(9, 0) },
  { id: 'base-2', label: '时区', text: '上海', for: [JOHN.id, LILY.id], state: 'kept', by: 'person', at: at(9, 0) },
  { id: 'base-3', label: '家人', text: 'Lily 对花生过敏', for: [LILY.id], state: 'pending', by: LILY.id, who: '王老师', at: at(19, 40) },
]
const ME_VIEW = { ...INBOX, base: BASE, defaultName: 'John', bodies: { [SESSION]: JOHN.id }, played: [JOHN.id, LILY.id], avatars: [{ ...JOHN, repo: '/Users/john/settings-app', autos: [{ venue: `${JOHN.id}/g-00000000st`, name: '设置页改版' }] }, { ...LILY, muted: true }] }
// P10's account: one email, this Mac and a browser.
const ACCOUNT = { methods: [{ id: 'email-1', kind: 'email', shown: 'test@example.com', at: at(9, 0) }], devices: [
  { id: 'token-a', name: '这台 Mac · Claude Code', at: at(11, 50), current: true, avatars: [{ id: JOHN.id, name: 'John' }, { id: LILY.id, name: 'Lily 爸爸' }] },
  { id: 'token-b', name: '网页 · Safari', at: at(13, 14, 1), current: false, avatars: [] },
] }
// P4's link, as the client hands it.
const LINK = { code: 'k7pqm3', url: `${RELAY}/i/k7pqm3`, line: `读 ${RELAY}/i/k7pqm3.md ，照着做：用我的身份进「设置页改版」。`, days: 7, forward: true, approve: true, isOwner: true, group: '设置页改版' }

type Req = { v: number; call: string; args: Record<string, unknown> }
function world(on: On, view: Record<string, unknown>) {
  const ran = (stdout: string, exitCode = 0) => ({ exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false })
  on('process.run', ($, e) => {
    if (e.argv[1] === '--version') return { value: ran('v24.1.0\n') }
    if (e.argv[0] === '/bin/sh') return { value: ran('', 1) }
    if (e.argv[2] === 'hook') {
      const req = JSON.parse(e.init?.stdin ?? '{}') as Req
      const gb = req.call === 'wait' ? { ok: true } : req.call === 'open' ? { ok: true, chat: req.args['id'] === CLASS.id ? CLASS_CHAT : CHAT, view } : req.call === 'link' ? { ok: true, link: LINK, view } : req.call === 'account' ? { ok: true, account: ACCOUNT } : { ok: true, view }
      return { value: ran(`${JSON.stringify({ v: 1, ok: true, gb })}\n`) }
    }
    return { deny: `unexpected ${e.argv.join(' ')}` }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('fs.read', ($, e) => (e.path.split('\\').join('/').endsWith('/.claude-plugin/plugin.json') ? { value: JSON.stringify({ version: 'preview' }) } : { deny: 'ENOENT' }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__gemsbang__${e.name}` } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.id', () => ({ value: SESSION }))
}

async function scene(name: string, $: Engine, on: On, view: Record<string, unknown>, go: (pane: Awaited<ReturnType<Engine['ui']['mount']>>, press: (key: string) => Promise<void>) => Promise<void> = async () => {}) {
  world(on, view)
  const clock = mock.clock(on)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  await clock.settle()
  const mount = () => $.ui.mount({ plugin: 'gemsbang', surface: 'desktop', component: 'Pane', requestId: 'gemsbang-board', props: PANE })
  // A press on the page drawn now: the first mount let go, then mounted again, as the page may have changed since.
  let first: Awaited<ReturnType<typeof mount>> | undefined = await mount()
  const press = async (key: string): Promise<void> => {
    if (first !== undefined) { await first.unmount(); first = undefined }
    const p = await mount(); await p.press({ key }); await p.unmount()
  }
  await go(first, press)
  if (first !== undefined) await first.unmount()
  // Drawn again after what `go` pressed: the page it went to.
  const pane = await mount()
  console.log(`GEMSBANG-PREVIEW ${name} ${JSON.stringify(await pane.drawn())}`)
  await pane.unmount()
}

/** The view this machine's client has now, put in by `node scripts/preview-pane.mjs --live`; null without it. */
const LIVE = /* live */ null as Record<string, unknown> | null

test('inbox', async ($, on) => scene('inbox', $, on, INBOX))
test('chat', async ($, on) => scene('chat', $, on, CHAT_VIEW, async (pane) => { await pane.press({ key: `chat-${JOHN.id}-g-00000000st-go` }) }))
test('chat-card', async ($, on) => scene('chat-card', $, on, INBOX, async (pane) => { await pane.press({ key: `chat-${CLASS.owner}-${CLASS.id}-go` }) }))
test('inbox-muted', async ($, on) => scene('inbox-muted', $, on, MUTED_VIEW))
test('avatars', async ($, on) => scene('avatars', $, on, ME_VIEW, async (pane) => { await pane.press({ key: 'tab-me' }) }))
test('avatar-edit', async ($, on) => scene('avatar-edit', $, on, ME_VIEW, async (_, press) => { await press('tab-me'); await press(`edit-${JOHN.id}`) }))
test('base-edit', async ($, on) => scene('base-edit', $, on, ME_VIEW, async (_, press) => { await press('tab-me'); await press('edit-base') }))
test('account', async ($, on) => scene('account', $, on, ME_VIEW, async (_, press) => { await press('tab-me'); await press('account-open') }))
test('logout', async ($, on) => scene('logout', $, on, ME_VIEW, async (_, press) => { await press('tab-me'); await press('account-open'); await press('logout-ask') }))
test('plus', async ($, on) => scene('plus', $, on, INBOX, async (pane) => { await pane.press({ key: 'plus' }) }))
test('info', async ($, on) => scene('info', $, on, CHAT_VIEW, async (_, press) => { await press(`chat-${JOHN.id}-g-00000000st-go`); await press('head-chat-open') }))
test('invite', async ($, on) => scene('invite', $, on, CHAT_VIEW, async (_, press) => { await press(`chat-${JOHN.id}-g-00000000st-go`); await press('head-chat-open'); await press('info-invite') }))
test('rotate', async ($, on) => scene('rotate', $, on, CHAT_VIEW, async (_, press) => { await press(`chat-${JOHN.id}-g-00000000st-go`); await press('head-chat-open'); await press('info-invite'); await press('rotate-ask') }))
test('leave-pick', async ($, on) => scene('leave-pick', $, on, CHAT_VIEW, async (_, press) => { await press(`chat-${JOHN.id}-g-00000000st-go`); await press('head-chat-open'); await press('leave-open'); await press(`heir-${LI_ID}`) }))
test('call-failed', async ($, on) => scene('call-failed', $, on, { ...INBOX, calls: (INBOX.calls as Record<string, unknown>[]).map((c) => ({ ...c, failed: 'error' })) }))
test('new-group', async ($, on) => scene('new-group', $, on, { ...INBOX, rows: [], calls: [], needs: [] }, async (pane) => { await pane.press({ key: 'empty-new-group' }) }))
if (LIVE !== null) test('live', async ($, on) => scene('live', $, on, LIVE))
