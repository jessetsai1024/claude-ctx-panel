# ctx-panel：側邊欄的 context 用量面板

一個 [Claude Code](https://claude.com/claude-code) 的 mod。這個對話的 context 視窗用了多少、分成哪幾類（系統提示、工具、記憶檔、對話…）、每一輪長了多少、最佔空間的是哪幾個檔案／MCP 工具／skill、上一輪的快取，最底下是 Claude 現在在做什麼。`/ctx` 開或關、`/ctx full` 算精確的（會打一次 token 計數 API）、`/ctx files|mcp|skills` 換「前幾名」列哪一種。

English summary at the end.

側邊欄會在新視窗自己打開，但只有終端機夠寬時（系統規定：沒手動開過要 144 格以上，手動開過一次之後 110 格）；不夠寬就等你打指令，不是壞掉。



## 需要什麼

- Claude Code **2.1.287 以上**（mod 功能 2026-10-01 起預設開放）。
- 不用 Node、不用裝套件。mod 跑在 Claude Code 自己的引擎裡。

## 安裝

**用 marketplace（推薦）**

```bash
claude plugin marketplace add jessetsai1024/claude-ctx-panel
claude plugin install ctx-panel@claude-ctx-panel
```

然後在對話裡打 `/reload-plugins`，或重開 Claude Code。

**或者 clone 下來接捷徑**（之後 `git pull` 就是更新）

macOS／Linux：

```bash
git clone https://github.com/jessetsai1024/claude-ctx-panel.git
cd claude-ctx-panel && ./install.sh
```

Windows（原生版，在 PowerShell 裡）：

```powershell
git clone https://github.com/jessetsai1024/claude-ctx-panel.git
cd claude-ctx-panel
.\install.ps1
```

原理：放在 `~/.claude/skills/ctx-panel/` 底下的 plugin 會被 Claude Code 自動載入，腳本只是建一個捷徑指回這個 repo（Windows 用目錄接合點，不需要管理員權限）。PowerShell 說不准跑腳本就先 `Set-ExecutionPolicy -Scope Process Bypass`。裝完關掉所有 Claude Code 視窗再重開。

移除：`./uninstall.sh` 或 `.\uninstall.ps1`，只拿掉捷徑。

## 注意

- 不要同時用兩種方式載入同一個 mod（marketplace 裝了就不要再接捷徑；`settings.json` 的 `env` 裡也別再放 `CLAUDE_CODE_PLUGIN_DIRS` 指到它），會出現兩份。
- **Windows 還沒實機跑過。**路徑處理有單元測試，但作者手邊沒有 Windows 機器。有問題請開 issue，附 Claude Code 版本和畫面。
- 想改：直接改檔案，存檔後 Claude Code 會熱重載。`claude plugin validate .`、`claude plugin test .`；第一次載入後 `.claude-plugin/types/` 會出現型別檔，之後 `tsc -p .` 可以做型別檢查（那個資料夾是引擎寫的，已在 `.gitignore`）。

## 來歷

2026 年 10 月 2 日到 3 日之間做的，作者是 Jesse 與螢（鏡 螢，號石火，一個 Claude 分身）。原本六個 mod 放在同一個 repo [claude-mods](https://github.com/jessetsai1024/claude-mods)，10 月 6 日拆成一個 mod 一個 repo。MIT 授權。

---

## English

**ctx-panel** is a mod for Claude Code: A pane showing the context window: how full, by category (system prompt, tools, memory files, messages…), growth per turn, the biggest files / MCP tools / skills, last turn's cache hit, and what Claude is doing right now. `/ctx` toggles, `/ctx full` counts precisely (one token-count API call), `/ctx files|mcp|skills` picks the top-N list. The pane opens by itself in a new session only when the terminal is wide enough (144 columns, or 110 once you have opened it by hand); narrower than that it waits for the command. 

Install with `claude plugin marketplace add jessetsai1024/claude-ctx-panel` then `claude plugin install ctx-panel@claude-ctx-panel`; or clone and run `./install.sh` (macOS/Linux) or `.\install.ps1` (native Windows, junction, no admin), which links the repo into `~/.claude/skills/ctx-panel` so `git pull` is the update. Requires Claude Code ≥ 2.1.287. UI text is Traditional Chinese. Windows has unit tests but no on-device test yet. Split out of [claude-mods](https://github.com/jessetsai1024/claude-mods) on 2026-10-06. MIT.
