<div align="center">

# gold-fish

**處理完支線，記得回主線。**

一個 **Claude Code Mod**：自動記住 session 裡的工作堆疊，在輸入列上方畫一條金魚列。支線結束時，提醒你回到主線。

![Claude Code 2.1.286+](https://img.shields.io/badge/Claude_Code-2.1.286%2B-D97757)
![Terminal | Desktop](https://img.shields.io/badge/支援-終端機_%7C_桌面_App-555)

</div>

---

## 為什麼需要它

在 session 裡修一個 bug，中途發現要先確認另一個行為，接著又查了一份文件。支線處理完以後，你和 Claude 都忘了原本在修什麼。

gold-fish 讓 Claude 自己記下主線和支線。支線收起來時，金魚列提醒你回到主線。

## 三個重點

| | |
|---|---|
| 🐟 **自動記住** | Claude 開始多步驟工作時建立主線，話題轉開時開支線，你不用手動記錄 |
| ↩ **回主線提醒** | 支線結束時，金魚列標出「↩ 回到主線」，輸入列放一句灰字建議，按 Tab 採用 |
| 💾 **跟著 session** | 每個 session 有自己的工作堆疊，`--resume` 回來後還在 |

## 金魚列的樣子

```text
1. 只有主線
><> 修 typo-picker 重複標出

2. 開支線
∘ 修 typo-picker 重複標出 › ><> 確認 next(e) 的行為

3. 放不下時，中間變成合併項
∘ 修 typo-picker 重複標出 › ∘ 2 項 › ><> 查 Ink 的 wrap 參數

4. 收支線後的回主線提醒
 ↩ 回到主線  ><> 修 typo-picker 重複標出 （剛離開：確認 next(e) 的行為）
> 繼續修 typo-picker 重複標出            ← 輸入列灰字建議，Tab 採用
```

`><>` 標出目前的工作項，`∘` 標出暫停的工作項。工作堆疊是空的時候，金魚列不顯示。

## 安裝

**在 Claude Code 裡面**（輸入列直接打，終端機和桌面 App 都可以）：

```text
/plugin marketplace add jaaaackieLai/claude-mods
```

```text
/plugin install gold-fish@claude-mods
```

**或在終端機**：

```bash
claude plugin marketplace add jaaaackieLai/claude-mods
```

```bash
claude plugin install gold-fish@claude-mods
```

**更新到最新版**：在 Claude Code 裡打 `/plugin marketplace update claude-mods`，或在終端機執行 `claude plugin marketplace update claude-mods`。

## 用法

平常不用做任何事。Claude 會依對話內容記錄工作堆疊。

| 想做的事 | 做法 |
|---|---|
| 收支線、改標題、刪除記錯的工作項 | 點金魚列上的工作項，從選單選一個操作 |
| 改標題 | 選「改標題」後，在對話框直接輸入新標題 |
| 處理合併項裡的工作項 | 點「∘ N 項」，先選工作項，再選操作。超過 4 項時選「更多…」翻頁 |
| 請 Claude 修正 | 直接說，例如「主線應該是修登入流程」，Claude 會改標題或刪除工作項 |
| 回到主線 | 收支線後，在輸入列按 Tab 採用灰字建議。送出下一則訊息後，提醒消失 |

<details>
<summary><b>名詞</b></summary>

| 名稱 | 意思 |
|---|---|
| 工作項 | 一件正在處理的工作，只有標題和狀態（進行中或暫停） |
| 主線 | 分出支線的工作項。最底層的工作項也叫主線 |
| 支線 | 從主線分出來的工作項。支線也可以再分出支線 |
| 收支線 | 把一個支線和它上面的工作項移出工作堆疊。支線完成或放棄都算 |
| 刪除工作項 | 只移除一個記錯的工作項，不顯示回主線提醒 |

完整的術語表見 [docs/CONTEXT.md](docs/CONTEXT.md)。

</details>

<details>
<summary><b>運作方式</b></summary>

- 你每送出一則訊息，gold-fish 把目前的工作堆疊和使用規則附給 Claude。你看不到這段文字
- Claude 用 4 個工具改工作堆疊：`push_work_item`、`close_work_item`、`rename_work_item`、`remove_work_item`
- 這 4 個工具在對話紀錄裡只顯示一行淡色字，例如「🐟 已開支線：w2 …」。工具失敗時改成紅字「🐟 失敗：…」
- 收起最底層的主線時，工作堆疊變空，金魚列直接隱藏，不顯示回主線提醒
- 金魚列不設快捷鍵，避免和 `typo-picker` 的選字列衝突。它和其他 mod 的列一起顯示

</details>

## 資料位置與費用

- 工作堆疊存在 `~/.claude/gold-fish/<session-id>.json`，一個 session 一個檔案。有設定 `CLAUDE_CONFIG_DIR` 時，改存在那個資料夾下
- 檔案內容無法解析時，gold-fish 不會寫檔蓋掉它，工具會回傳錯誤。修正或移走這個檔案後，gold-fish 才會再記錄工作項
- gold-fish 不會自動刪除舊檔案。檔案很小，不需要時可以手動刪除整個 `gold-fish` 資料夾
- 每則訊息附給 Claude 的文字只有幾行，會算在 context 用量裡
