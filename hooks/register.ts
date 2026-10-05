import type { Register } from 'claude-code'

import { activityOf, detailOf, sectionsOf, snapshotOf, toolNameOf } from './view'
import type { Line, Snapshot, Tab, ToolRun } from './view'

const PANE = 'ctx'
const REFRESH_MS = 5000
const MAX_HISTORY = 200
// 側邊欄縮在輸入框上面時拿不到真正的高度，用這個當作可用列數
const INLINE_ROWS = 34
// 自動打開時晚一點開，讓這個側邊欄比其他自動開的（files、timeline）後開、排在最前面
const AUTO_OPEN_DELAY_MS = 1000
const MAX_RECENT = 3
const TABS: readonly { tab: Tab; label: string; hotkey: string }[] = [
  { tab: 'files', label: '記憶檔', hotkey: '1' },
  { tab: 'mcp', label: 'MCP', hotkey: '2' },
  { tab: 'skills', label: 'Skill', hotkey: '3' },
]

/**
 * 【職責】把 context 用量面板接上 Claude Code：提供 /ctx，在側邊欄顯示現在的 context 視窗用了多少、
 *   各分類各佔多少、每一輪長了多少、最佔地方的前幾名、上一輪的快取，最底下是 Claude 現在在做什麼。
 *   讀系統給的用量數字、工具呼叫的名稱與參數、幫手清單；不讀對話的文字、不連網路、不寫檔。
 * 【何時能呼叫】引擎載入這個 mod 時呼叫一次；重新載入會再呼叫，「每一輪長多少」的紀錄從頭開始記。
 * 【行為】有人在用的 session（不是 claude -p）開始 1 秒後自己打開側邊欄；終端機不夠寬時先等著，
 *   寬度夠了才出現（主人自己開過的 110 格，沒開過的 144 格，這是系統的規定）。
 *   /ctx：側邊欄沒開就開、開著就關。/ctx close：關掉。/ctx 數字：用那個寬度（格數）開。
 *   /ctx files、/ctx mcp、/ctx skills：切換「前幾名」列哪一種並打開；側邊欄裡那三顆鈕（按 1、2、3 或用滑鼠點）做同一件事。
 *   /ctx full：向伺服器問精確的分類數字再打開，比較慢；精確數字會留到下一輪結束，之後又回到估計值。
 *   不論側邊欄開著沒，每一輪（主對話的）結束都會記一筆用量，所以晚點才打開也看得到之前每一輪長了多少。
 *   側邊欄開著的時候另外每 5 秒重新讀一次估計值並重畫，所以 Claude 工作到一半也看得到用量在長、計時在跑。
 *   「現在在做什麼」：主對話一輪開始到結束算工作中；每次用工具（主對話和幫手的都算）開始與結束都立刻重畫；
 *   最近跑完的 3 個工具留在畫面上；正在跑的幫手每次重畫時向系統問。不論側邊欄開著沒都在記。
 *   這個 mod 只看工具呼叫，不改它、不擋它，工具的結果原樣交回去。
 *   /clear 之後紀錄與畫面都歸零重來。
 */
export const register: Register = on => {
  let snap: Snapshot | null = null
  let history: number[] = []
  let tab: Tab = 'files'
  let home = ''
  let isHoldingExact = false
  // 主對話這一輪：turn.start 給的 id 和開始時間；閒著是 null
  let turn: { id: string; since: number } | null = null
  let lastMs: number | null = null
  let callCount = 0
  const calls = new Map<number, ToolRun & { agentId?: string }>()
  let recent: (ToolRun & { agentId?: string })[] = []

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'ctx',
      description: '側邊欄的 context 用量面板（最底下是 Claude 現在在做什麼）：/ctx 開或關、/ctx full 算精確的、/ctx files|mcp|skills 換清單',
      immediate: true,
    })
    // Windows 沒有 HOME，家目錄在 USERPROFILE；統一成「/」隔開，比對路徑時才對得上
    home = ((await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? '').replace(/\\/g, '/')

    // 一開 session 就自己打開；不是主人叫的，終端機要夠寬才放得出來，不夠寬就先等著，不用等它
    if (e.isInteractive) {
      $.clock.after(AUTO_OPEN_DELAY_MS, () => {
        void $.ui.open({ id: PANE, title: 'Context' })
      })
    }

    // 重新載入時已經有用量了，先記一筆當起點，下一輪結束就算得出成長
    const { context } = await $.session.usage()

    if (context.tokens !== undefined) {
      history.push(context.tokens)
    }

    $.clock.every(REFRESH_MS, () => {
      if (isHoldingExact) {
        return
      }

      void $.ui.panes().then(async panes => {
        if (!panes.some(pane => pane.id === PANE && pane.isShown)) {
          return
        }

        snap = snapshotOf(await $.session.usage({ breakdown: 'summary' }), home, false)
        $.ui.invalidate('ui.render')
      })
    })

    return next(e)
  })

  on('classic.SessionStart', { source: ['clear'] }, ($, e, next) => {
    snap = null
    history = []
    isHoldingExact = false
    recent = []
    lastMs = null
    $.ui.invalidate('ui.render')

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    // 幫手的輪次如果也走這裡，主對話正在跑時不會蓋掉它；結束時用 id 對回來
    if (turn === null) {
      turn = { id: e.turnId, since: await $.clock.now() }
      $.ui.invalidate('ui.render')
    }

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const id = callCount
    callCount += 1
    calls.set(id, {
      tool: toolNameOf(e.tool),
      detail: detailOf(e, home),
      at: await $.clock.now(),
      ...(e.agentId === undefined ? {} : { agentId: e.agentId }),
    })
    $.ui.invalidate('ui.render')

    try {
      return await next(e)
    } finally {
      const call = calls.get(id)
      calls.delete(id)

      if (call !== undefined) {
        recent = [call, ...recent].slice(0, MAX_RECENT)
      }

      $.ui.invalidate('ui.render')
    }
  })

  on('turn.complete', ($, e, next) => {
    if (e.agentId === undefined || e.turnId === turn?.id) {
      if (e.agentId === undefined) {
        lastMs = e.durationMs
      }

      turn = null
    }

    // 幫手跑完也要重畫，幫手清單才會更新
    $.ui.invalidate('ui.render')

    if (e.agentId === undefined) {
      void $.session.usage({ breakdown: 'summary' }).then(usage => {
        isHoldingExact = false
        snap = snapshotOf(usage, home, false)

        if (usage.context.tokens !== undefined) {
          history = [...history, usage.context.tokens].slice(-MAX_HISTORY)
        }

        $.ui.invalidate('ui.render')
      })
    }

    return next(e)
  })

  on('command.run', { command: 'ctx' }, async ($, e) => {
    const arg = e.args.trim()
    const wanted = Number.parseInt(arg, 10)
    const isUp = (await $.ui.panes()).some(pane => pane.id === PANE)

    if (arg === 'close' || (arg === '' && isUp)) {
      await $.ui.close({ id: PANE })

      return {}
    }

    if (arg === 'files' || arg === 'mcp' || arg === 'skills') {
      tab = arg
    }

    const isExact = arg === 'full'

    snap = snapshotOf(await $.session.usage({ breakdown: isExact ? 'full' : 'summary' }), home, isExact)
    isHoldingExact = isExact

    const opened = await $.ui.open(
      Number.isInteger(wanted) && wanted > 0
        ? { id: PANE, title: 'Context', columns: wanted }
        : { id: PANE, title: 'Context' },
    )

    if (!opened.isPlaced) {
      return { text: `側邊欄沒有被放出來：${opened.reason}` }
    }

    // 重新打開時引擎可能直接拿上次畫好的結果來用，所以自己要求重畫
    $.ui.invalidate('ui.render')

    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)

    if (snap === null) {
      snap = snapshotOf(await $.session.usage({ breakdown: 'summary' }), home, false)
    }

    const agents = await $.agent.list()
    const typeOf = new Map(agents.map(agent => [agent.id, agent.type]))
    const withWho = ({ agentId, ...run }: ToolRun & { agentId?: string }): ToolRun =>
      agentId === undefined ? run : { ...run, who: typeOf.get(agentId) ?? '幫手' }
    const tail = activityOf(
      {
        since: turn?.since ?? null,
        lastMs,
        running: [...calls.values()].filter(call => call.agentId === undefined).map(withWho),
        recent: recent.map(withWho),
        helpers: agents
          .filter(agent => agent.status === 'running')
          .map(agent => ({ type: agent.type, description: agent.description })),
      },
      await $.clock.now(),
      e.props.bodyColumns,
    )
    const rows = e.props.placement === 'dock' ? e.props.scroll.bodyRows : INLINE_ROWS
    // 「現在在做什麼」那一塊固定要放得下，所以把它佔的列數從可用列數扣掉，讓前幾名清單去縮
    const { top, list, bottom } = sectionsOf(snap, history, tab, e.props.bodyColumns, rows - tail.length)
    const lineOf = (line: Line) =>
      Text({
        wrap: 'truncate-end',
        children:
          line.length === 0
            ? [' ']
            : line
                .filter(segment => segment.text !== '')
                .map(segment =>
                  Text({
                    ...(segment.color === undefined ? {} : { color: segment.color }),
                    ...(segment.bold === true ? { bold: true } : {}),
                    ...(segment.dim === true ? { dimColor: true } : {}),
                    children: [segment.text],
                  }),
                ),
      })

    return Box({
      flexDirection: 'column',
      children: [
        ...top.map(lineOf),
        Text({ bold: true, children: ['最佔地方的前幾名'] }),
        Box({
          flexDirection: 'row',
          columnGap: 2,
          children: TABS.map(item =>
            Button({
              key: `tab-${item.tab}`,
              label: item.label,
              hotkey: item.hotkey,
              plain: true,
              ...(tab === item.tab ? {} : { dimColor: true }),
              onPress: () => {
                tab = item.tab
                $.ui.invalidate('ui.render')
              },
            }),
          ),
        }),
        ...list.map(lineOf),
        ...bottom.map(lineOf),
        ...tail.map(lineOf),
      ],
    })
  })
}

// #region AI-NOTES
// AI-NOTES：agent 專用備忘。當時為真、非契約、非指令；改到相關程式碼時重驗，錯了就刪。
// 2026-10-02 這個面板全是字，用 Text 畫不用 Raster；一行是一個 Text 裡面包幾個帶顏色的小 Text，
//   不用橫排的 Box，因為補空白對齊靠的是字元寬度，交給 flex 怕空白被吃掉。顏色用 #rrggbb。
//   主人的畫面人家看不到：顏色有沒有出來、中文對不對得齊，都要他看。
// 2026-10-02 不靠「開著」的旗標，要判斷就問 $.ui.panes()。字元雨踩過旗標只在 ui.render 裡設、重開後沒重跑 render 的坑
//   （~/Workspace/projects/matrix-rain/hooks/register.ts 的 AI-NOTES）。
// 2026-10-02 turn.complete 和計時器裡的 $.session.usage 都不 await（void 加 then）：不想讓面板拖慢一輪的收尾。
//   「summary」是本機估的，型別檔說不花錢；「full」會打 token 計數 API，只在主人打 /ctx full 時用。
// 2026-10-02 每輪成長只記主對話（e.agentId 是 undefined）的輪次；幫手的輪次不記，不然一輪會被記成好幾筆。
// 2026-10-02 session.start 自動打開用 void、不 await：不夠寬時 $.ui.open 會等著，不能卡住 session 開始。
//   晚 1 秒是因為主人要 ctx 排在其他自動開的側邊欄前面（當時是 crew，已刪；現在是 files、timeline），系統沒有指定分頁的設定，最後打開的排最前面（型別檔沒寫，2026-10-03 主人實測確認）。
//   主人用 /ctx 關掉算「親手關」，下次自動打開的門檻會回到 144 格（型別檔 PaneOpenArgs 的說明）。
// 2026-10-02 「現在在做什麼」：型別檔沒講 turn.start 會不會替幫手的輪次觸發（TurnStartInput 沒有 agentId），
//   所以只在閒著時記開始、結束時用 turnId 對回來；未在真機驗過。tool.call 的 hook 一定要 await next(e) 原樣回傳，
//   紀錄放 finally，工具出錯或被擋也會從「正在跑」移走。說明檔講 next 在跑的時間不算進 hook 的時間額度。
// #endregion
