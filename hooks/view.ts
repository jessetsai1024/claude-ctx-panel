import type { SessionUsage } from 'claude-code'

/** 一行裡的一小段字，帶自己的顏色與粗細。 */
export type Segment = {
  /** 要顯示的字。 */
  text: string
  /** 顏色，`#rrggbb`；沒給就是終端機預設字色。 */
  color?: string
  /** 粗體。 */
  bold?: boolean
  /** 暗一階，給次要資訊用。 */
  dim?: boolean
}

/** 畫面上的一行：由左到右排的幾段字；空陣列是空白行。 */
export type Line = Segment[]

/** 「前幾名」那一塊現在列哪一種：記憶檔、MCP 工具（依伺服器合計）、skill。 */
export type Tab = 'files' | 'mcp' | 'skills'

/** 「前幾名」清單裡的一筆：名字和它佔的 token 數。 */
export type Item = {
  /** 顯示的名字（檔案路徑、伺服器名、skill 名）。 */
  label: string
  /** 估計佔多少 token。 */
  tokens: number
}

/** 分類那一塊的一列，跟 /context 指令的分法一樣。 */
export type Category = {
  /** 中文名字；認不得的分類保留系統給的原名。 */
  name: string
  /** 估計佔多少 token。 */
  tokens: number
  /** used 佔著位子、free 空位、buffer 留給自動壓縮的、deferred 用到才載入所以不佔位子。 */
  kind: 'used' | 'free' | 'buffer' | 'deferred'
}

/**
 * 【職責】畫面板需要的全部資料，從系統給的用量報告整理出來的一份快照。
 *   只是資料；由 snapshotOf 建立、sectionsOf 讀。
 */
export type Snapshot = {
  /** 這一份是替哪個模型算的。 */
  model: string
  /** 現在用了多少 token：有上一次回應的實際數字就用它，沒有就用分類估計的總和。 */
  tokens: number
  /** 模型的 context 視窗有多大。 */
  window: number
  /** 自動壓縮在用到多少 token 時啟動；沒開自動壓縮是 null。 */
  compactAt: number | null
  /** 各分類，佔位子的在前、由大到小，再來是用到才載入的、壓縮預留、空位。 */
  categories: Category[]
  /** 記憶檔，由大到小。 */
  files: Item[]
  /** MCP 工具依伺服器合計（只算已經載入的），由大到小。 */
  mcp: Item[]
  /** skill，由大到小。 */
  skills: Item[]
  /** 上一次回應的輸入有多少是讀快取、多少是新寫進快取、多少沒走快取；還沒有回應是 null。 */
  cache: { read: number; written: number; fresh: number } | null
  /** 分類數字是不是向伺服器問過的精確值；false 是本機估的。 */
  isExact: boolean
}

/** 面板的三段：前幾名清單上面的、清單本身、清單下面的。分三段是因為清單上方要插一列可以按的分頁鈕。 */
export type Sections = {
  /** 總量、分類、每輪成長。 */
  top: Line[]
  /** 目前分頁的前幾名。 */
  list: Line[]
  /** 快取與註腳。 */
  bottom: Line[]
}

const NAMES: Record<string, string> = {
  Messages: '對話訊息',
  'Memory files': '記憶檔',
  'System tools': '系統工具',
  'MCP tools': 'MCP 工具',
  Skills: 'Skill 清單',
  'System prompt': '系統提示',
  'Custom agents': '自訂幫手',
  'Autocompact buffer': '壓縮預留',
  'Free space': '空位',
}

const COLORS: Record<string, string> = {
  對話訊息: '#b48cff',
  記憶檔: '#ff9f43',
  系統工具: '#4fc3f7',
  'MCP 工具': '#26c6a8',
  'Skill 清單': '#f7d154',
  系統提示: '#9aa7b8',
  自訂幫手: '#ff7eb6',
}
const SPARE_COLORS = ['#8bd17c', '#e57373', '#7986cb', '#a1887f']
const DIM = '#6b7280'
const GOOD = '#5ad67d'
const WARN = '#f7d154'
const BAD = '#ff6b6b'
const SPARKS = '▁▂▃▄▅▆▇█'
const MAX_SPARKS = 20
const AVERAGE_OVER = 10
/** 清單以外固定會用掉的列數，用來算清單可以放幾筆。 */
const FIXED_ROWS = 26
const MIN_ITEMS = 3
const MAX_ITEMS = 10

/**
 * 【行為】一段字在終端機佔幾格寬：中日韓文字、全形標點、表情符號算 2 格，其他算 1 格。
 *   方塊字元（█ ░ ■ 這類）算 1 格，跟主人的終端機實際畫法一致。
 */
export function widthOf(text: string): number {
  let width = 0

  for (const glyph of text) {
    const code = glyph.codePointAt(0) ?? 0
    const isWide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe4f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1f300 && code <= 0x1faff) ||
      (code >= 0x20000 && code <= 0x3fffd)
    width += isWide ? 2 : 1
  }

  return width
}

/**
 * 【行為】把 token 數寫成短的樣子：不到一千照寫（850），不到一萬帶一位小數（3.2k，剛好整數就寫 6k），
 *   不到一百萬取整數千（312k），一百萬以上用 M（1M、1.2M）。負數當 0。
 */
export function short(tokens: number): string {
  const n = Math.max(0, Math.round(tokens))

  if (n < 1000) {
    return `${n}`
  }

  if (n < 10_000) {
    const thousands = (n / 1000).toFixed(1)

    return `${thousands.endsWith('.0') ? thousands.slice(0, -2) : thousands}k`
  }

  if (n < 999_500) {
    return `${Math.round(n / 1000)}k`
  }

  const millions = (n / 1_000_000).toFixed(1)

  return `${millions.endsWith('.0') ? millions.slice(0, -2) : millions}M`
}

/**
 * 【行為】把一段字裁到最多 max 格寬。超過時留開頭、結尾補「…」；keepTail 為 true 時改成留結尾、開頭補「…」
 *   （檔案路徑用這個，因為檔名在最後面）。本來就放得下就原樣回傳。
 */
export function fit(text: string, max: number, keepTail = false): string {
  if (widthOf(text) <= max) {
    return text
  }

  const glyphs = Array.from(text)
  let kept = ''

  if (keepTail) {
    for (let at = glyphs.length - 1; at >= 0; at -= 1) {
      const next = (glyphs[at] ?? '') + kept

      if (widthOf(next) > max - 1) {
        break
      }

      kept = next
    }

    return `…${kept}`
  }

  for (const glyph of glyphs) {
    if (widthOf(kept + glyph) > max - 1) {
      break
    }

    kept += glyph
  }

  return `${kept}…`
}

/**
 * 【行為】把一條 width 格寬的長條分給幾個數量，回傳每個數量該佔幾格，加起來剛好等於 width。
 *   照比例分；大於 0 的數量至少給 1 格（不然小分類會整個看不到），多出來的從最長的那段扣。
 *   全部是 0 或 width 不夠每個大於 0 的各給 1 格時，盡量分、分不到的給 0。
 */
export function share(amounts: readonly number[], width: number): number[] {
  const total = amounts.reduce((sum, amount) => sum + Math.max(0, amount), 0)
  const cells = amounts.map(() => 0)

  if (total <= 0 || width <= 0) {
    return cells
  }

  const exact = amounts.map(amount => (Math.max(0, amount) / total) * width)

  exact.forEach((value, at) => {
    cells[at] = (amounts[at] ?? 0) > 0 ? Math.max(1, Math.floor(value)) : 0
  })

  let sum = cells.reduce((a, b) => a + b, 0)

  while (sum > width) {
    const widest = cells.indexOf(Math.max(...cells))

    if ((cells[widest] ?? 0) <= 0) {
      break
    }

    cells[widest] = (cells[widest] ?? 0) - 1
    sum -= 1
  }

  while (sum < width) {
    // 補給「照比例還差最多」的那一段
    let best = 0
    let gap = -Infinity

    exact.forEach((value, at) => {
      if (value - (cells[at] ?? 0) > gap) {
        gap = value - (cells[at] ?? 0)
        best = at
      }
    })
    cells[best] = (cells[best] ?? 0) + 1
    sum += 1
  }

  return cells
}

/**
 * 【行為】把每一輪結束時的用量變成「每一輪長了多少」：後一筆減前一筆。
 *   用量變少的那一輪（壓縮過、清過對話）算 0，不算負的。少於兩筆回空陣列。
 */
export function growthOf(history: readonly number[]): number[] {
  const growth: number[] = []

  for (let at = 1; at < history.length; at += 1) {
    growth.push(Math.max(0, (history[at] ?? 0) - (history[at - 1] ?? 0)))
  }

  return growth
}

/**
 * 【行為】把系統給的用量報告整理成快照。home 是家目錄，路徑裡的家目錄會換成「~」。
 *   報告沒帶分類明細時（呼叫時沒要求），分類與三份清單都是空的、isExact 是 false。
 *   isExact 由呼叫端告知這次是不是要求精確計算。
 */
export function snapshotOf(usage: SessionUsage, home: string, isExact: boolean): Snapshot {
  const breakdown = usage.context.breakdown
  const order = { used: 0, deferred: 1, buffer: 2, free: 3 }
  const categories: Category[] = (breakdown?.categories ?? [])
    .map(row => {
      const base = row.name.replace(/\s*\(deferred\)\s*$/i, '')
      const name = NAMES[base] ?? base

      return { name: row.kind === 'deferred' ? `${name}（未載入）` : name, tokens: row.tokens, kind: row.kind }
    })
    .sort((a, b) => order[a.kind] - order[b.kind] || b.tokens - a.tokens)
  const bySize = (a: Item, b: Item): number => b.tokens - a.tokens
  const servers = new Map<string, number>()

  for (const tool of breakdown?.mcpTools ?? []) {
    if (tool.isLoaded) {
      servers.set(tool.serverName, (servers.get(tool.serverName) ?? 0) + tool.tokens)
    }
  }

  const api = breakdown?.apiUsage ?? null

  return {
    model: breakdown?.model ?? '',
    tokens: usage.context.tokens ?? breakdown?.totalTokens ?? 0,
    window: usage.context.window,
    compactAt: breakdown?.isAutoCompactEnabled === true ? (breakdown.autoCompactThreshold ?? null) : null,
    categories,
    files: (breakdown?.memoryFiles ?? [])
      .map(file => ({
        label: tildeOf(file.path, home),
        tokens: file.tokens,
      }))
      .sort(bySize),
    mcp: Array.from(servers, ([label, tokens]) => ({ label, tokens })).sort(bySize),
    skills: (breakdown?.skills?.skillFrontmatter ?? [])
      .map(skill => ({ label: skill.name, tokens: skill.tokens }))
      .sort(bySize),
    cache:
      api === null
        ? null
        : { read: api.cache_read_input_tokens, written: api.cache_creation_input_tokens, fresh: api.input_tokens },
    isExact: isExact && breakdown !== undefined,
  }
}

function colorOf(name: string, at: number): string {
  return COLORS[name] ?? SPARE_COLORS[at % SPARE_COLORS.length] ?? DIM
}

/** 左邊一串、右邊一段字，中間用空白撐到剛好 columns 格寬；左邊太長會被裁掉。 */
function row(left: Segment[], right: Segment, columns: number): Line {
  const room = Math.max(0, columns - widthOf(right.text) - 1)
  const kept: Segment[] = []
  let used = 0

  for (const segment of left) {
    const text = fit(segment.text, room - used)

    if (room - used <= 0) {
      break
    }

    kept.push({ ...segment, text })
    used += widthOf(text)
  }

  return [...kept, { text: ' '.repeat(Math.max(1, columns - used - widthOf(right.text))) }, right]
}

function percentOf(part: number, whole: number): string {
  if (whole <= 0 || part <= 0) {
    return '0%'
  }

  const percent = (part / whole) * 100

  return percent < 0.5 ? '<1%' : `${Math.round(percent)}%`
}

/**
 * 【何時能呼叫】columns 至少 20 才排得好看；更窄也不會壞，只是字會被裁掉。
 * 【行為】把快照排成面板的三段文字，每一行都不超過 columns 格寬：
 *   top 是總量（用了多少、長條、離自動壓縮還有多少與照最近速度大約還能幾輪）、分類表、每輪成長的小柱狀圖；
 *   list 是 tab 指定的那一種前幾名，筆數看 rows（側邊欄高度）剩多少，最少 3 筆最多 10 筆，沒有資料時是一行說明；
 *   bottom 是上一輪的快取（三個數字加一條長條）與一行註腳（分類是估的還是精確的）。
 *   history 是每一輪結束時的用量，最舊的在前；「大約還能幾輪」取最近 10 輪有成長的平均，沒有成長紀錄就不寫。
 */
export function sectionsOf(
  snap: Snapshot,
  history: readonly number[],
  tab: Tab,
  columns: number,
  rows: number,
): Sections {
  const top: Line[] = []
  const used = snap.categories.filter(category => category.kind === 'used')
  const inWindow = snap.categories.filter(category => category.kind !== 'deferred')
  const total = inWindow.reduce((sum, category) => sum + category.tokens, 0)
  const growth = growthOf(history)

  // 一、總量
  top.push(row([{ text: 'Context', bold: true }], { text: snap.model, dim: true }, columns))
  top.push(
    row(
      [{ text: `用了 ${short(snap.tokens)} / ${short(snap.window)}` }],
      { text: percentOf(snap.tokens, snap.window), bold: true },
      columns,
    ),
  )

  if (inWindow.length > 0) {
    const cells = share(
      inWindow.map(category => category.tokens),
      columns,
    )

    top.push(
      inWindow.map((category, at) => {
        const count = cells[at] ?? 0

        if (category.kind === 'used') {
          return { text: '█'.repeat(count), color: colorOf(category.name, used.indexOf(category)) }
        }

        return { text: (category.kind === 'buffer' ? '▒' : '░').repeat(count), color: DIM }
      }),
    )
  }

  const recent = growth.slice(-AVERAGE_OVER).filter(delta => delta > 0)
  const average = recent.length === 0 ? 0 : recent.reduce((a, b) => a + b, 0) / recent.length

  if (snap.compactAt === null) {
    top.push([{ text: fit(`自動壓縮沒開；空位還有 ${short(snap.window - snap.tokens)}`, columns), dim: true }])
  } else if (snap.compactAt <= snap.tokens) {
    top.push([{ text: fit('已經超過自動壓縮的門檻', columns), color: BAD }])
  } else {
    const left = snap.compactAt - snap.tokens
    const turns = average > 0 ? `，照現在速度約 ${Math.floor(left / average)} 輪` : ''

    top.push([{ text: fit(`離自動壓縮還有 ${short(left)}${turns}`, columns), dim: true }])
  }

  // 二、分類
  top.push([])
  top.push(row([{ text: '分類', bold: true }], { text: ' tokens    %', dim: true }, columns))

  if (snap.categories.length === 0) {
    top.push([{ text: fit('還沒有分類資料', columns), dim: true }])
  }

  for (const category of snap.categories) {
    const numbers = `${short(category.tokens).padStart(7)} ${(category.kind === 'deferred' ? '' : percentOf(category.tokens, total)).padStart(4)}`

    if (category.kind === 'used') {
      const color = colorOf(category.name, used.indexOf(category))

      top.push(row([{ text: '■ ', color }, { text: category.name }], { text: numbers }, columns))
    } else {
      const mark = category.kind === 'buffer' ? '▒ ' : category.kind === 'free' ? '□ ' : '· '

      top.push(
        row([{ text: mark, color: DIM }, { text: category.name, dim: true }], { text: numbers, dim: true }, columns),
      )
    }
  }

  // 三、每一輪長多少
  const shown = growth.slice(-Math.max(1, Math.min(MAX_SPARKS, columns - 16)))
  const tallest = Math.max(1, ...shown)

  top.push([])
  top.push([{ text: fit(`每一輪長多少（最近 ${Math.max(shown.length, 1)} 輪）`, columns), bold: true }])

  if (shown.length === 0) {
    top.push([{ text: fit('還沒有紀錄，下一輪結束後開始畫', columns), dim: true }])
  } else {
    const bars = shown
      .map(delta => SPARKS.charAt(Math.min(SPARKS.length - 1, Math.floor((delta / tallest) * (SPARKS.length - 1)))))
      .join('')

    top.push(
      row([{ text: bars, color: GOOD }], { text: `上一輪 +${short(shown[shown.length - 1] ?? 0)}` }, columns),
    )
  }

  top.push([])

  // 四、前幾名
  const items = tab === 'files' ? snap.files : tab === 'mcp' ? snap.mcp : snap.skills
  const room = Math.max(MIN_ITEMS, Math.min(MAX_ITEMS, rows - FIXED_ROWS))
  const list: Line[] = items
    .slice(0, room)
    .map(item => row([{ text: fit(item.label, columns - 9, tab === 'files') }], { text: short(item.tokens) }, columns))

  if (list.length === 0) {
    list.push([{ text: fit(tab === 'mcp' ? '沒有已載入的 MCP 工具' : '沒有資料', columns), dim: true }])
  } else if (items.length > room) {
    list.push([{ text: fit(`…還有 ${items.length - room} 個`, columns), dim: true }])
  }

  // 五、快取
  const bottom: Line[] = [[], [{ text: '上一輪的快取', bold: true }]]

  if (snap.cache === null) {
    bottom.push([{ text: fit('還沒有資料，要等下一次回應', columns), dim: true }])
  } else {
    const { read, written, fresh } = snap.cache
    const cells = share([read, written, fresh], columns)

    bottom.push([
      { text: fit(`讀快取 ${short(read)} · 新寫 ${short(written)} · 沒快取 ${short(fresh)}`, columns) },
    ])
    bottom.push([
      { text: '█'.repeat(cells[0] ?? 0), color: GOOD },
      { text: '█'.repeat(cells[1] ?? 0), color: WARN },
      { text: '█'.repeat(cells[2] ?? 0), color: BAD },
    ])
  }

  bottom.push([
    { text: fit(snap.isExact ? '分類是精確計算的' : '分類是估計值；/ctx full 算精確的', columns), dim: true },
  ])

  return { top, list, bottom }
}

/** 一次工具呼叫，給「現在在做什麼」那一塊用。 */
export type ToolRun = {
  /** 工具名稱；MCP 工具已經整理成「伺服器/工具」。 */
  tool: string
  /** 一小段說它在做什麼：指令、檔案路徑、搜尋字串…；沒有就是空字串。 */
  detail: string
  /** 哪一種幫手用的（Explore、Plan…）；主對話用的是 undefined。 */
  who?: string
  /** 開始的時間，毫秒。 */
  at: number
}

/**
 * 【職責】畫「現在在做什麼」那一塊需要的資料。只是資料；由 register.ts 收集、activityOf 讀。
 */
export type Activity = {
  /** 主對話這一輪從什麼時候開始（毫秒）；閒著是 null。 */
  since: number | null
  /** 上一輪主對話花了多久（毫秒）；還沒有紀錄是 null。 */
  lastMs: number | null
  /** 主對話正在跑的工具，先開始的在前。 */
  running: ToolRun[]
  /** 最近跑完的工具（主對話和幫手都算），新的在前。 */
  recent: ToolRun[]
  /** 正在跑的幫手：種類和說明。 */
  helpers: { type: string; description: string }[]
}

const TOOL = '#4fc3f7'
const HELPER = '#ff7eb6'
const MAX_RUNNING = 3
const DETAIL_KEYS = ['command', 'file_path', 'notebook_path', 'pattern', 'url', 'query', 'skill', 'description', 'prompt', 'path']

/** 【行為】把工具名稱寫短：mcp__xapi__search 變成 xapi/search，其他照原樣。 */
export function toolNameOf(tool: string): string {
  const match = /^mcp__(.+?)__(.+)$/.exec(tool)

  return match === null ? tool : `${match[1]}/${match[2]}`
}

/**
 * 【行為】從工具的參數挑一段最能說明它在做什麼的字：依序找 command、file_path、notebook_path、pattern、url、
 *   query、skill、description、prompt、path，第一個不是空字串的就用它。換行和連續空白壓成一個空白，
 *   開頭是家目錄的換成「~」（Windows 的「\\」先換成「/」再比對）。都沒有就回空字串。
 */
export function detailOf(args: Readonly<Record<string, unknown>>, home: string): string {
  for (const key of DETAIL_KEYS) {
    const value = args[key]

    if (typeof value === 'string' && value.trim() !== '') {
      const text = value.replace(/\s+/g, ' ').trim()

      return tildeOf(text, home)
    }
  }

  return ''
}

/** 【行為】開頭是家目錄的換成「~」；Windows 的「\\」先換成「/」再比對，不在家目錄底下的原樣回傳。home 要是「/」隔開的。 */
export function tildeOf(text: string, home: string): string {
  const posix = text.replace(/\\/g, '/')

  return home !== '' && (posix === home || posix.startsWith(`${home}/`)) ? `~${posix.slice(home.length)}` : text
}

/** 【行為】把毫秒寫成時鐘的樣子：不到一小時是「分:秒」（1:05），一小時以上是「時:分:秒」（1:02:03）。負數當 0。 */
export function clockOf(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const s = `${seconds % 60}`.padStart(2, '0')
  const minutes = Math.floor(seconds / 60)

  if (minutes < 60) {
    return `${minutes}:${s}`
  }

  return `${Math.floor(minutes / 60)}:${`${minutes % 60}`.padStart(2, '0')}:${s}`
}

/** 【行為】把「過了多久」寫成白話：不到 1 秒是「剛剛」，再來是「12 秒前」「3 分前」「2 小時前」。 */
export function agoOf(ms: number): string {
  const seconds = Math.floor(Math.max(0, ms) / 1000)

  if (seconds < 1) {
    return '剛剛'
  }

  if (seconds < 60) {
    return `${seconds} 秒前`
  }

  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)} 分前`
  }

  return `${Math.floor(seconds / 3600)} 小時前`
}

/** 幾段字由左到右排，超過 columns 格寬的部分裁掉。 */
function clipped(segments: Segment[], columns: number): Line {
  const kept: Segment[] = []
  let used = 0

  for (const segment of segments) {
    if (columns - used <= 0) {
      break
    }

    const text = fit(segment.text, columns - used)

    kept.push({ ...segment, text })
    used += widthOf(text)
  }

  return kept
}

/** 一個工具一行：縮排、誰用的、工具名、說明；有 right 就靠右放。說明是路徑時留結尾。 */
function toolLine(run: ToolRun, columns: number, right?: Segment): Line {
  const room = right === undefined ? columns : Math.max(0, columns - widthOf(right.text) - 1)
  const head = clipped(
    [{ text: '  ' }, ...(run.who === undefined ? [] : [{ text: `${run.who}·`, dim: true }]), { text: run.tool, color: TOOL }],
    room,
  )
  const used = head.reduce((sum, segment) => sum + widthOf(segment.text), 0)
  const left = room - used - 2
  const isPath = run.detail.startsWith('/') || run.detail.startsWith('~') || /^[A-Za-z]:[\\/]/.test(run.detail)
  const line: Line = left >= 2 && run.detail !== '' ? [...head, { text: `  ${fit(run.detail, left, isPath)}` }] : head

  if (right === undefined) {
    return line
  }

  const width = line.reduce((sum, segment) => sum + widthOf(segment.text), 0)

  return [...line, { text: ' '.repeat(Math.max(1, columns - width - widthOf(right.text))) }, right]
}

/**
 * 【何時能呼叫】columns 至少 20 才排得好看；更窄也不會壞，只是字會被裁掉。
 * 【行為】把 activity 排成面板最底下「現在在做什麼」那一塊，每一行都不超過 columns 格寬，第一行是空白行。
 *   狀態：主對話一輪進行中（since 不是 null）或有工具在跑，寫「● 工作中」加上已經多久（since 是 null 就不寫時間），
 *   下面列正在跑的工具（最多 3 個），沒有工具在跑就寫「思考中」；否則寫「○ 閒著」，有上一輪的紀錄就加上它花了多久。
 *   再來是「最近用的工具」：recent 全部列出，右邊寫幾秒前（now 減開始時間）；沒有就寫「還沒有」。
 *   helpers 不是空的才多一段「幫手（N 個在跑）」逐個列出。now 是現在的時間，毫秒。
 */
export function activityOf(activity: Activity, now: number, columns: number): Line[] {
  const lines: Line[] = [[], [{ text: fit('現在在做什麼', columns), bold: true }]]
  const isBusy = activity.since !== null || activity.running.length > 0

  if (isBusy) {
    const elapsed = activity.since === null ? '' : ` ${clockOf(now - activity.since)}`

    lines.push(clipped([{ text: '● ', color: GOOD }, { text: `工作中${elapsed}` }], columns))

    if (activity.running.length === 0) {
      lines.push([{ text: fit('  思考中', columns), dim: true }])
    }

    for (const run of activity.running.slice(0, MAX_RUNNING)) {
      lines.push(toolLine(run, columns))
    }

    if (activity.running.length > MAX_RUNNING) {
      lines.push([{ text: fit(`  …還有 ${activity.running.length - MAX_RUNNING} 個`, columns), dim: true }])
    }
  } else {
    const last = activity.lastMs === null ? '' : `・上一輪花了 ${clockOf(activity.lastMs)}`

    lines.push(clipped([{ text: '○ ', color: DIM }, { text: `閒著${last}`, dim: true }], columns))
  }

  lines.push([{ text: fit('最近用的工具', columns), bold: true }])

  if (activity.recent.length === 0) {
    lines.push([{ text: fit('  還沒有', columns), dim: true }])
  }

  for (const run of activity.recent) {
    lines.push(toolLine(run, columns, { text: agoOf(now - run.at), dim: true }))
  }

  if (activity.helpers.length > 0) {
    lines.push([{ text: fit(`幫手（${activity.helpers.length} 個在跑）`, columns), bold: true }])

    for (const helper of activity.helpers) {
      lines.push(
        clipped([{ text: '  ' }, { text: helper.type, color: HELPER }, { text: `  ${helper.description}` }], columns),
      )
    }
  }

  return lines
}

// #region AI-NOTES
// AI-NOTES：agent 專用備忘。當時為真、非契約、非指令；改到相關程式碼時重驗，錯了就刪。
// 2026-10-03 為了原生 Windows：記憶檔標籤與 detailOf 都經 tildeOf，比對家目錄前先把「\\」換成「/」；isPath 也認磁碟機代號。沒有 Windows 機器實測。
// 2026-10-02 對齊不靠引擎的排版，自己用 widthOf 算格數補空白：中文字佔兩格，交給 flex 的 space-between 沒把握，
//   自己補的話測試可以直接驗「每一行不超過 columns」。方塊字元（█░■）在 Unicode 屬於寬度不明的那一類，
//   這裡當 1 格，依據是毛毛和字元雨用半格字在主人的終端機畫出來沒歪。
// 2026-10-02 分類名字系統給英文（Messages、Memory files…），型別檔交代「分支要看 kind 不要看 name」，
//   所以邏輯全部看 kind，name 只拿來查中文對照表，查不到就顯示原名。
// 2026-10-02 總量用 context.tokens（上一次回應的實際輸入量），分類用 breakdown（估計值、對的是壓縮視窗），
//   兩邊加起來不一定相等，型別檔有明講。長條與百分比的分母用分類自己的總和，才不會畫超過。
// 2026-10-02 這個檔刻意不碰 $：靜態檢查不准把 $ 傳給別檔的函式。
// #endregion
