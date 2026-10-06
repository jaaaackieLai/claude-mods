<div align="center">

# todo-calendar

**在 Claude Code 直接寫代辦事項**

一個 **Claude Code Mod**：在面板顯示一週七天的待辦，可以直接打勾、編輯、刪除，也可以用一句話請 Claude 幫你排進去。

![Claude Code 2.1.286+](https://img.shields.io/badge/Claude_Code-2.1.286%2B-D97757)
![Terminal | Desktop](https://img.shields.io/badge/支援-終端機_%7C_桌面_App-555)

</div>

---

## 為什麼需要它

寫程式時想到「週五要交報告」，切去別的待辦 App 記下來，回來就忘了剛剛寫到哪。

todo-calendar 把週曆放在 Claude Code 裡。打一行 `/todo-calendar:add-task 週五交報告` 就記好了，日期由 Claude 換算。

## 三個重點

| | |
|---|---|
| 📅 **一週一眼看完** | 週一到週日並排，今天那欄有外框。過期的任務是紅色，完成的會劃掉 |
| 💬 **用說的就好** | 「把報告改到下週一」「看牙醫完成了」，Claude 會呼叫工具幫你改 |
| 🔄 **每個 session 同一份** | 任務存在一個固定檔案，同時開好幾個 session，30 秒內會互相同步 |

## 安裝

**在 Claude Code 裡面**（終端機和桌面 App 都可以）：

```text
/plugin marketplace add jaaaackieLai/claude-mods
```

```text
/plugin install todo-calendar@claude-mods
```

**或在終端機**：

```bash
claude plugin marketplace add jaaaackieLai/claude-mods
```

```bash
claude plugin install todo-calendar@claude-mods
```

**更新到最新版**：在終端機執行 `claude plugin update todo-calendar@claude-mods`，然後開一個新 session。

## 用法

### 開啟面板

| 想做的事 | 做法 |
|---|---|
| 開啟週曆面板 | `/todo` |
| 新 session 不要自動開面板 | `/todo auto off`（也可以在 `/config` 找「新 session 自動開啟面板」） |
| 恢復自動開啟 | `/todo auto on` |
| 查看目前設定 | `/todo auto` |

終端機寬度不到 144 欄時，系統不會自動開面板，打 `/todo` 就能打開。

### 在面板上操作

| 想做的事 | 做法 |
|---|---|
| 切換週 | 按「◀ 上週」「本週」「下週 ▶」，或按快速鍵 `p` `t` `n` |
| 標成完成 | 按任務前面的 `○`，變成 `✓`；再按一次取消 |
| 編輯名稱或日期 | 按任務後面的 `⋯`，再按「編輯」（`e`）。改完按 Enter 或「儲存」 |
| 刪除 | 按 `⋯`，再按「刪除」（`d`），最後按「確定刪除」（`y`） |
| 取消選取 | 按「取消」（`x`），或再按一次 `⋯` |

快速鍵只在面板有焦點時有效。在終端機按 ctrl+x tab 或點一下面板，就能把焦點移過去。

### 請 Claude 幫忙

| 想做的事 | 做法 |
|---|---|
| 用一句話新增 | `/todo-calendar:add-task 週五交報告`，Claude 會把「週五」換算成日期 |
| 修改、完成、刪除、查詢 | 直接說，例如「把報告改到下週一」「列出這週的任務」 |

「週五」指本週的週五。本週那天已經過了，就排到下週。沒寫日期就排今天。

<details>
<summary><b>任務檔</b></summary>

位置：`~/.claude/todo-calendar/tasks.json`。有設定 `CLAUDE_CONFIG_DIR` 時，放在那個目錄底下。

```json
{
  "version": 1,
  "tasks": [
    {
      "id": "dkl007n",
      "title": "執行 stage1-freq plan",
      "date": "2026-10-05",
      "done": false,
      "createdAt": "2026-10-05T13:02:11.000Z"
    }
  ]
}
```

- 一個任務只有一個日期，格式是 `YYYY-MM-DD`。
- 檔案內容損壞時，mod 不會覆寫它，工具會回報檔案路徑。修好或移走檔案就能繼續用。
- 要備份或搬到別台電腦，複製這個檔案就好。
- Claude 只在呼叫工具時讀到任務，不會在對話中自動看到。

</details>