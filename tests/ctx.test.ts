import type { SessionUsage } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import {
  activityOf,
  agoOf,
  clockOf,
  detailOf,
  fit,
  growthOf,
  sectionsOf,
  share,
  short,
  snapshotOf,
  toolNameOf,
  widthOf,
} from '../hooks/view'
import type { Activity, Line } from '../hooks/view'

const HOME = '/Users/someone'

function usageOf(tokens: number): SessionUsage {
  return {
    startedAt: 0,
    rateLimits: [],
    context: {
      tokens,
      window: 1_000_000,
      percent: Math.round(tokens / 10_000),
      breakdown: {
        categories: [
          { name: 'System prompt', tokens: 6000, color: 'promptBorder', isDeferred: false, kind: 'used' },
          { name: 'System tools', tokens: 22_000, color: 'inactive', isDeferred: false, kind: 'used' },
          { name: 'MCP tools (deferred)', tokens: 90_000, color: 'inactive', isDeferred: true, kind: 'deferred' },
          { name: 'Memory files', tokens: 41_000, color: 'permission', isDeferred: false, kind: 'used' },
          { name: 'Messages', tokens: tokens - 69_000, color: 'permission', isDeferred: false, kind: 'used' },
          { name: 'Free space', tokens: 967_000 - tokens, color: 'inactive', isDeferred: false, kind: 'free' },
          { name: 'Autocompact buffer', tokens: 33_000, color: 'inactive', isDeferred: false, kind: 'buffer' },
        ],
        totalTokens: tokens,
        maxTokens: 1_000_000,
        rawMaxTokens: 1_000_000,
        autocompactSource: 'auto',
        percentage: Math.round(tokens / 10_000),
        gridRows: [],
        model: 'Fable 5.1',
        memoryFiles: [
          { path: `${HOME}/.claude/CLAUDE.md`, type: 'User', tokens: 4200 },
          { path: `${HOME}/.claude/projects/-Users-someone-Workspace-talk/memory/MEMORY.md`, type: 'AutoMem', tokens: 17_800 },
          { path: '/work/talk/CLAUDE.md', type: 'Project', tokens: 1600 },
        ],
        mcpTools: [
          { name: 'mcp__xapi__search', serverName: 'xapi', tokens: 900, isLoaded: true },
          { name: 'mcp__xapi__credits', serverName: 'xapi', tokens: 300, isLoaded: true },
          { name: 'mcp__github__issues', serverName: 'github', tokens: 5000, isLoaded: false },
        ],
        agents: [],
        skills: {
          totalSkills: 2,
          includedSkills: 2,
          tokens: 700,
          skillFrontmatter: [
            { name: 'ask-jev', source: 'userSettings', tokens: 300 },
            { name: 'gpt-image', source: 'userSettings', tokens: 400 },
          ],
        },
        autoCompactThreshold: 967_000,
        isAutoCompactEnabled: true,
        apiUsage: {
          input_tokens: 3000,
          output_tokens: 500,
          cache_read_input_tokens: tokens - 11_000,
          cache_creation_input_tokens: 8000,
        },
      },
    },
  }
}

function textOf(line: Line): string {
  return line.map(segment => segment.text).join('')
}

test('數字寫短、寬度會算中文、太長會裁', async () => {
  expect([850, 3200, 6000, 312_000, 1_000_000, 1_240_000, -5].map(short)).toEqual(['850', '3.2k', '6k', '312k', '1M', '1.2M', '0'])
  expect(widthOf('記憶檔 MCP')).toBe(10)
  expect(widthOf('█░■')).toBe(3)
  expect(fit('~/.claude/CLAUDE.md', 12, true)).toBe('…e/CLAUDE.md')
  expect(fit('對話訊息很長很長', 9)).toBe('對話訊息…')
  expect(fit('短', 9)).toBe('短')
})

test('長條分格加起來剛好等於寬度，小的至少一格', async () => {
  const cells = share([214_000, 41_000, 22_000, 6000, 33_000, 684_000], 47)

  expect(cells.reduce((a, b) => a + b, 0)).toBe(47)
  expect(Math.min(...cells)).toBeGreaterThanOrEqual(1)
  expect(share([0, 0], 10)).toEqual([0, 0])
  expect(share([5, 0, 5], 10)).toEqual([5, 0, 5])
})

test('每一輪長多少：後減前，變少的算 0', async () => {
  expect(growthOf([100, 130, 135, 60, 90])).toEqual([30, 5, 0, 30])
  expect(growthOf([100])).toEqual([])
})

test('快照把分類翻成中文並排好，路徑換成 ~，MCP 只算載入的', async () => {
  const snap = snapshotOf(usageOf(312_000), HOME, false)

  expect(snap.categories.map(category => category.name)).toEqual([
    '對話訊息',
    '記憶檔',
    '系統工具',
    '系統提示',
    'MCP 工具（未載入）',
    '壓縮預留',
    '空位',
  ])
  expect(snap.files[0]?.label).toBe('~/.claude/projects/-Users-someone-Workspace-talk/memory/MEMORY.md')
  expect(snap.files[2]?.label).toBe('/work/talk/CLAUDE.md')
  expect(snap.mcp).toEqual([{ label: 'xapi', tokens: 1200 }])
  expect(snap.skills[0]?.label).toBe('gpt-image')
  expect(snap.compactAt).toBe(967_000)
  expect(snap.cache).toEqual({ read: 301_000, written: 8000, fresh: 3000 })
})

test('排出來的每一行都不超過側邊欄寬度，五塊都在', async () => {
  const snap = snapshotOf(usageOf(312_000), HOME, false)
  const history = [280_000, 283_000, 300_000, 303_200, 312_000]

  for (const columns of [23, 47, 73, 140]) {
    const { top, list, bottom } = sectionsOf(snap, history, 'files', columns, 38)

    for (const line of [...top, ...list, ...bottom]) {
      expect(widthOf(textOf(line))).toBeLessThanOrEqual(columns)
    }
  }

  const { top, list, bottom } = sectionsOf(snap, history, 'files', 47, 38)
  const all = [...top, ...list, ...bottom].map(textOf).join('\n')

  expect(all).toContain('用了 312k / 1M')
  expect(all).toContain('31%')
  // 離門檻 655k，最近四輪平均長 8k，大約 81 輪
  expect(all).toContain('離自動壓縮還有 655k，照現在速度約 81 輪')
  expect(all).toContain('對話訊息')
  expect(all).toContain('上一輪 +8.8k')
  expect(all).toContain('MEMORY.md')
  expect(all).toContain('讀快取 301k · 新寫 8k · 沒快取 3k')
  expect(all).toContain('分類是估計值')
  // 長條那一行剛好跟側邊欄一樣寬
  expect(widthOf(textOf(top[2] ?? []))).toBe(47)
})

test('側邊欄畫得出來，按分頁鈕會換清單，一輪結束會記一筆', async ($, on) => {
  mock.clock(on)
  let tokens = 312_000

  on('session.usage', () => ({ value: usageOf(tokens) }))
  on('env.get', () => ({ value: HOME }))
  on('ui.invalidate', (_, e, next) => next(e))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))
  on('agent.list', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))

  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({
    plugin: 'ctx-panel',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'ctx',
    props: {
      title: 'Context',
      isFocused: false,
      bodyColumns: 47,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 38 },
      view: {},
    },
  })

  expect(await ui.find({ type: 'Text', text: /用了 312k/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /MEMORY\.md/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /xapi/ })).toBeUndefined()

  await ui.press({ key: 'tab-mcp' })
  expect(await ui.find({ type: 'Text', text: /xapi/ })).toBeDefined()

  // 載入時已經記了 312k 當起點；這一輪結束時變成 320k，所以上一輪長了 8k
  expect(await ui.find({ type: 'Text', text: /還沒有紀錄/ })).toBeDefined()
  tokens = 320_000
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(await ui.find({ type: 'Text', text: /上一輪 \+8k/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /用了 320k/ })).toBeDefined()

  await ui.unmount()
})


test('工具名稱與說明寫短、時間寫成白話', async () => {
  expect(toolNameOf('mcp__xapi__search_posts')).toBe('xapi/search_posts')
  expect(toolNameOf('Bash')).toBe('Bash')
  expect(detailOf({ command: 'npm   test\n  --watch', description: '跑測試' }, HOME)).toBe('npm test --watch')
  expect(detailOf({ file_path: `${HOME}/work/view.ts` }, HOME)).toBe('~/work/view.ts')
  expect(detailOf({ file_path: 'C:\\Users\\jesse\\work\\view.ts' }, 'C:/Users/jesse')).toBe('~/work/view.ts')
  expect(detailOf({ file_path: `${HOME}2/view.ts` }, HOME)).toBe(`${HOME}2/view.ts`)
  expect(detailOf({ command: '  ', pattern: 'turn.step' }, HOME)).toBe('turn.step')
  expect(detailOf({ todos: [] }, HOME)).toBe('')
  expect([0, 5_000, 80_000, 3_723_000].map(clockOf)).toEqual(['0:00', '0:05', '1:20', '1:02:03'])
  expect([400, 12_000, 185_000, 7_300_000].map(agoOf)).toEqual(['剛剛', '12 秒前', '3 分前', '2 小時前'])
})

test('「現在在做什麼」每一行都不超過寬度，工作中和閒著各寫對的字', async () => {
  const busy: Activity = {
    since: 1_000,
    lastMs: null,
    running: [{ tool: 'Bash', detail: 'npm test -- --reporter=verbose --coverage 很長很長的指令', at: 70_000 }],
    recent: [
      { tool: 'Read', detail: '~/Workspace/projects/ctx-panel/hooks/view.ts', at: 69_000 },
      { tool: 'Grep', detail: 'turn.step', who: 'Explore', at: 51_000 },
    ],
    helpers: [{ type: 'Explore', description: '找 mod 的型別檔' }],
  }

  for (const columns of [23, 47, 73]) {
    for (const line of activityOf(busy, 81_000, columns)) {
      expect(widthOf(textOf(line))).toBeLessThanOrEqual(columns)
    }
  }

  const all = activityOf(busy, 81_000, 47).map(textOf).join('\n')

  expect(all).toContain('● 工作中 1:20')
  expect(all).toContain('Bash  npm test')
  expect(all).toContain('view.ts')
  expect(all).toContain('12 秒前')
  expect(all).toContain('Explore·Grep  turn.step')
  expect(all).toContain('幫手（1 個在跑）')

  const idle = activityOf({ since: null, lastMs: 125_000, running: [], recent: [], helpers: [] }, 0, 47)
    .map(textOf)
    .join('\n')

  expect(idle).toContain('○ 閒著・上一輪花了 2:05')
  expect(idle).toContain('還沒有')
  expect(idle).not.toContain('幫手')

  const thinking = activityOf({ since: 0, lastMs: null, running: [], recent: [], helpers: [] }, 3_000, 47)
    .map(textOf)
    .join('\n')

  expect(thinking).toContain('思考中')
})

test('一輪開始顯示工作中，工具跑完進最近清單，一輪結束變閒著', async ($, on) => {
  mock.clock(on)

  on('session.usage', () => ({ value: usageOf(312_000) }))
  on('env.get', () => ({ value: HOME }))
  on('ui.invalidate', (_, e, next) => next(e))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.list', () => ({
    value: [{ id: 'a1', description: '找 mod 的型別檔', type: 'Explore', status: 'running' }],
  }))
  on('tool.call', () => ({ result: { stdout: 'ok', stderr: '', interrupted: false } as never }))

  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({
    plugin: 'ctx-panel',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'ctx',
    props: {
      title: 'Context',
      isFocused: false,
      bodyColumns: 47,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 38 },
      view: {},
    },
  })

  expect(await ui.find({ type: 'Text', text: /閒著/ })).toBeDefined()

  await $.turn.start({ text: '跑測試', turnId: 't1' })
  expect(await ui.find({ type: 'Text', text: /工作中/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /思考中/ })).toBeDefined()

  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await $.tool.call({ tool: 'Grep', pattern: 'turn.step', agentId: 'a1' } as never)
  expect(await ui.find({ type: 'Text', text: /Bash  npm test/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /幫手（1 個在跑）/ })).toBeDefined()

  await $.turn.complete({ answer: '', durationMs: 65_000, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(await ui.find({ type: 'Text', text: /閒著・上一輪花了 1:05/ })).toBeDefined()

  await ui.unmount()
})

test('有人在用的 session 開始 1 秒後自己打開側邊欄，claude -p 不開', async ($, on) => {
  const clock = mock.clock(on)
  const opened: string[] = []

  on('session.usage', () => ({ value: usageOf(312_000) }))
  on('env.get', () => ({ value: HOME }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.open', (_, e) => {
    opened.push(e.id)

    return { value: { isPlaced: true } }
  })

  await $.session.start({ cwd: '/tmp', surface: null, isInteractive: false })
  await clock.advance(2000)
  expect(opened).toEqual([])

  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await clock.advance(500)
  expect(opened).toEqual([])
  await clock.advance(500)
  expect(opened).toEqual(['ctx'])
})
