# CONTEXT.md

這個 repo 的術語表。同一個東西永遠用這裡的名稱。

| 名稱 | 意思 |
|---|---|
| **mod** | 一個 Claude Code plugin，用 function hooks 寫成，放在 `plugins/<名稱>/`。這個 repo 有 4 個 mod：`usage`、`agent-monitor`、`todo-calendar`、`typo-picker` |
| **marketplace** | 這個 repo 本身。`.claude-plugin/marketplace.json` 列出 4 個 mod，使用者用 `/plugin marketplace add` 加入 |
| **列** | 畫在輸入列上方的一行，對應 `ui.render` 的 `AbovePrompt` component。`usage`、`agent-monitor`、`typo-picker` 各畫一條列 |
| **下層的列** | 一個 mod 呼叫 `next(e)` 拿到的內容，也就是排在它後面的 mod 畫的列 |
| **吃掉列** | 一個 mod 畫 `AbovePrompt` 時沒有呼叫 `next(e)`，下層的列因此不顯示。這是 mod 之間的衝突 |
| **面板** | 用 `$.ui.open` 開的 pane。`agent-monitor`、`todo-calendar` 和 `usage`（`/ctx`）各有一個 |
| **chip** | `usage` 列上的一格，例如模型 chip、ctx chip、5h chip、7d chip |
| **長條** | chip 裡顯示用量比例的 `━` 格子，格數由 `METER_CELLS` 決定 |
| **選字列** | `typo-picker` 的列：錯字和候選字按鈕 |
| **錯字表** | `typo-picker` 的規則檔 `~/.claude/typo-picker/rules.txt` |
| **熱載入** | 開發時讓 session 直接載入 `plugins/` 裡的 mod，改檔後下一輪自動重新載入 |
