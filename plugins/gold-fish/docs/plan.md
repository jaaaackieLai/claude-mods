# gold-fish 實作計畫

術語見 [CONTEXT.md](CONTEXT.md)。

## 目標

在 session 裡，使用者和 Claude 常從主線分出支線。處理完支線後，兩邊都忘了主線。
`gold-fish` 自動記住工作堆疊，用金魚列顯示，收支線後提醒使用者回到主線。

## 已確定的決定

| # | 問題 | 決定 |
|---|---|---|
| 1 | 誰判斷開支線和收支線 | Claude 呼叫工具。每次使用者送出訊息，mod 把工作堆疊附給 Claude |
| 2 | 工作堆疊存多久 | 每個 session 一個檔案，`--resume` 後還在 |
| 3 | 開支線要不要問使用者 | 直接記錄 |
| 4 | 只有 1 個工作項時 | 顯示金魚列。工作堆疊是空的時候隱藏 |
| 5 | 回主線提醒的形式 | 金魚列標出「↩ 回到主線」，加上輸入列灰字建議 |
| 6 | 主線什麼時候建立 | 多步驟工作開始時。簡單問答不建立 |
| 7 | 工作項記什麼 | 只有標題和狀態 |
| 8 | 記錯時怎麼修正 | 點金魚列上的工作項，跳出選單 |
| 9 | 回主線提醒何時消失 | 使用者送出下一則訊息時 |
| 10 | 選單操作 | 收支線、改標題、刪除工作項 |
| 11 | 快捷鍵 | 不要，避免和 `typo-picker` 的選字列衝突 |
| 12 | 金魚列放不下時 | 保留兩端，中間變成合併項 |
| 13 | 支線完成和放棄 | 不分開，都算收支線 |
| 14 | 最底層的主線完成時 | 工作堆疊變空，金魚列直接隱藏，不顯示回主線提醒 |
| 15 | 點合併項 | 列出裡面的工作項，選一個後再跳出操作選單 |
| 16 | 舊檔案 | 不清除。`$.fs` 沒有刪檔方法，檔案很小。README 說明可手動刪除 |

限制：金魚列必須呼叫 `next(e)`，不能吃掉列。

## 金魚列的樣子

```text
1. 只有主線
><> 修 typo-picker 重複標出

2. 開支線
∘ 修 typo-picker 重複標出 › ><> 確認 next(e) 的行為

3. 放不下時，中間變成合併項
∘ 修 typo-picker 重複標出 › ∘ 2 項 › ><> 查 Ink 的 wrap 參數

4. 收支線後的回主線提醒
[↩ 回到主線] ><> 修 typo-picker 重複標出（剛離開：確認 next(e) 的行為）
> 繼續修 typo-picker 重複標出            ← 輸入列灰字建議，Tab 採用
```

顏色：`><>` 用金魚橘，暫停的工作項用 dim，「↩ 回到主線」用深橘底亮橘字。

## 檔案結構

仿照 `typo-picker` 和 `todo-calendar`：

```text
plugins/gold-fish/
├── .claude-plugin/plugin.json
├── README.md
├── docs/CONTEXT.md
├── docs/plan.md            ← 本檔
├── hooks/hooks.json        { "modules": ["./register.tsx"] }
├── hooks/register.tsx      hook 註冊、金魚列、工具、選單
├── hooks/stack.ts          工作堆疊的純函式（不依賴 $）
├── tests/stack.test.ts     純函式測試
├── tests/plugin.test.tsx   hook 和金魚列的測試
├── tsconfig.json
└── types/index.d.ts        PluginState
```

## 資料模型

```ts
type WorkItem = { id: string; title: string }
// 狀態不另外存：最上層是「進行中」，其他是「暫停」
// lastId 是用過的最大 id 編號，收掉或刪除的 id 不再重用。沒有 lastId 的舊檔案從現有的 id 算起
type StackFile = { version: 1; items: WorkItem[]; lastId: number; updatedAt: number }
```

- 檔案位置：`<CLAUDE_CONFIG_DIR 或 ~/.claude>/gold-fish/<session-id>.json`。
  路徑寫法照抄 `todo-calendar` 的 `tasksPath`。不用 `$.store`，原因相同。
- `session-id` 用 `$.session.id()` 取得。
- 回主線提醒只放在 atom，不寫檔：`{ id: string; returnTo: string; left: string } | null`。id 是主線的 id。
- `/clear` 和在同一個程序裡 resume 後，session id 會換，但不會觸發 `session.start`。`session.end` 清空工作堆疊和回主線提醒，下一則訊息或下一次變更時再讀新 session 的檔案。

## stack.ts 純函式

| 函式 | 行為 |
|---|---|
| `push(items, title, lastId)` | 加到最上層，回傳新陣列、新 id 和新的 lastId |
| `close(items, id)` | 移除 id 和它上面的工作項。回傳 `{ items, left, returnTo }`。移除後變空時 `returnTo` 為 `undefined` |
| `remove(items, id)` | 只移除 id |
| `rename(items, id, title)` | 改標題 |
| `followReminder(items, reminder)` | 工作堆疊改變後的回主線提醒。最上層不是提醒的主線時回傳 `null`，主線改標題時跟著改 |
| `layout(items, columns)` | 算金魚列要顯示哪些工作項。放不下時保留兩端，中間變成合併項 |
| `contextText(items)` | 產生附給 Claude 的文字：目前的工作堆疊加上工具使用規則 |

找不到 id 時，函式回傳錯誤訊息，不丟例外。

## Claude 的工具

全部在 `session.start` 用 `$.tool.register` 註冊，在 `tool.call` 處理。

| 工具 | 參數 | 對應術語 |
|---|---|---|
| `push_work_item` | `title` | 工作堆疊是空的時候建立主線，否則開支線 |
| `close_work_item` | `id`（省略時用最上層） | 收支線 |
| `rename_work_item` | `id`、`title` | 改標題 |
| `remove_work_item` | `id` | 刪除工作項 |

工具結果回傳更新後的工作堆疊，讓 Claude 知道 id。

## 附給 Claude 的 context

`prompt.submit` hook 在 `e.context` 加一段文字，然後呼叫 `next`。內容：

1. 目前的工作堆疊（id、標題、哪一個是進行中）。空的時候寫「工作堆疊是空的」。
2. 規則（簡短）：
   - 開始多步驟工作時，呼叫 `push_work_item` 建立主線。簡單問答不建立。
   - 話題轉到需要先處理的問題時，呼叫 `push_work_item` 開支線。
   - 支線完成或放棄時，呼叫 `close_work_item`。
   - 使用者說工作項記錯時，用 `rename_work_item` 或 `remove_work_item` 修正。
3. 有回主線提醒時，加一句「使用者剛回到主線：<標題>」。

同一個 `prompt.submit` hook 也清掉回主線提醒（決定 9）。

## 金魚列

- `on('ui.render', { component: 'AbovePrompt' })`，先 `await next(e)`，再把金魚列放在下層的列上面。
- 工作堆疊是空的時候，直接回傳 `next(e)` 的結果。
- 每個工作項是一個 `Button`，不設 `hotkey`。合併項也是 `Button`。
- 寬度用 `e.props.bodyColumns`，交給 `layout()` 計算。

## 選單

- 點工作項：`$.ui.ask(標題, ['收支線', '改標題', '刪除'])`。
- 改標題：用 `$.ui.ask` 讓使用者輸入新標題。實作時先確認 `ask` 不帶 options 時能不能輸入文字。不能的話改用 `$.ui.input`。
- 點合併項：先 `$.ui.ask` 列出裡面的工作項，選一個後再跳出上面的選單。
- 使用者從選單收支線時，行為和 Claude 呼叫 `close_work_item` 一樣，也顯示回主線提醒。

## 回主線提醒

收支線後，如果工作堆疊不是空的：

1. 設定提醒 atom，金魚列前面出現「↩ 回到主線」，後面加「（剛離開：<支線標題>）」。
2. 呼叫 `$.prompt.suggest`，灰字是「繼續<主線標題>」。

使用者送出下一則訊息時，`prompt.submit` 清掉提醒 atom。

## 實作步驟（TDD）

每一步先寫失敗的測試，再實作，再重構。

1. 建立 mod 骨架：`plugin.json`、`hooks.json`、`tsconfig.json`、`types/index.d.ts`、空的 `register`。執行 `claude plugin validate`。
2. `stack.ts`：`push`、`close`、`remove`、`rename`。包含「收最底層的主線後變空」和「收中間的支線會一起移除上面的工作項」。
3. `stack.ts`：`layout`。包含「剛好放得下」「放不下時合併中間」「只有 2 項時放不下就截斷標題」。
4. `stack.ts`：`contextText`。
5. 檔案讀寫：`session.start` 讀檔，每次變更後寫檔。檔案不存在時用空陣列。內容損壞時金魚列顯示空的工作堆疊，並記錄到 debug log，不讓 session 壞掉。之後的變更都回傳錯誤，不寫檔蓋掉損壞的檔案。
6. 工具：4 個工具的註冊和 `tool.call` 處理。
7. `prompt.submit`：附 context、清提醒。
8. 金魚列：空的時候不畫、1 項、多項、合併項、回主線提醒。**必須有一個 test 畫出 `beneath` 的列，證明沒有吃掉列**（`scripts/check.sh` 會檢查）。
9. 選單：收支線、改標題、刪除、點合併項。
10. `$.prompt.suggest` 的灰字建議。
11. 文件：`README.md`（照 `typo-picker` 的格式），`.claude-plugin/marketplace.json` 加一筆，根目錄 `CONTEXT.md` 把「4 個 mod」改成 5 個並加上 `gold-fish`。

## 驗收

- `sh scripts/check.sh` 全部通過，包含 conflicts 段落。
- 熱載入後實際測試：
  1. 開始一件多步驟工作，金魚列出現主線。
  2. 轉到另一個問題，金魚列出現支線。
  3. 支線結束，金魚列出現「↩ 回到主線」，輸入列有灰字建議。
  4. 送出下一則訊息，提醒消失。
  5. 點工作項，選單的 3 個操作都正常。
  6. 和 `usage`、`typo-picker` 一起載入時，三條列都顯示。
  7. `--resume` 回到 session 後，工作堆疊還在。

## 尚未驗證的假設

- `$.ui.ask` 不帶 options 時能否輸入文字（影響改標題）。
- Claude 是否穩定地依 context 的規則呼叫工具。熱載入測試時觀察，必要時調整 `contextText` 的文字。

## 實作紀錄

- `$.ui.input` 不存在。`$.ui.ask` 選項少於 2 個時會補上 Yes/No，對話框另有自由輸入欄。
  改標題因此用 `$.ui.ask(問題, ['保留原標題', '取消'])`，使用者直接輸入的文字就是新標題。
- `$.ui.ask` 一次最多 4 個選項。合併項超過 4 項時，前 3 項加「更多…」分頁。
- 回合進行中時，`$.prompt.suggest` 不顯示灰字。Claude 在回合中收支線後，`turn.complete` 再建議一次。
  引擎自己的建議（`prompt.suggest`，origin 是 `suggestion`）在有提醒時換成「繼續<主線標題>」。
- 只有使用者送出的訊息（origin 是 `composer`、`bridge`、`sdk`）清掉回主線提醒。通知和排程不清。
- 測試裡 `Text` 的 `key` 不會留在畫出的樹上，所以測試用文字找 `Text`。
