<div align="center">

# claude-mods

![Claude Code 2.1.286+](https://img.shields.io/badge/Claude_Code-2.1.286%2B-D97757)
![Terminal | Desktop](https://img.shields.io/badge/支援-終端機_%7C_桌面_App-555)

</div>

---

## 有哪些 mod

| mod | 做什麼 | 說明 |
|---|---|---|
| **usage** | 輸入列上方顯示模型、effort、資料夾、git 分支、context、5h 和 7d 額度。`/limits` 看文字版，`/ctx` 開 context 明細面板 | |
| **agent-monitor** | 子代理在跑時，輸入列上方顯示摘要列。`/agent-monitor` 開面板，列出每個子代理的模型、context、token、估計費用和時間 | [README](plugins/agent-monitor/README.md) |
| **todo-calendar** | 面板顯示一週的待辦。打 `/todo` 開面板，也可以請 Claude 幫你新增或修改任務 | [README](plugins/todo-calendar/README.md) |
| **typo-picker** | 打錯字時畫底線，輸入列上方跳出候選字，點一下就換掉 | [README](plugins/typo-picker/README.md) |
| **gold-fish** | 自動記住工作堆疊，輸入列上方的金魚列顯示主線和支線。支線結束時，提醒你回到主線 | [README](plugins/gold-fish/README.md) |


## 安裝

**1. 加入 marketplace**（在 Claude Code 輸入列打）：

```text
/plugin marketplace add jaaaackieLai/claude-mods
```

**2. 選要裝的 mod**：打 `/plugin`，到 marketplace 的清單裡選 mod 安裝。要幾個就裝幾個。

**或在終端機，一次裝一個**：

```bash
claude plugin marketplace add jaaaackieLai/claude-mods
```

```bash
claude plugin install usage@claude-mods
```

把 `usage` 換成 `agent-monitor`、`todo-calendar`、`typo-picker` 或 `gold-fish`，就能裝其他 mod。

**更新**：在終端機執行 `claude plugin marketplace update claude-mods`，然後開一個新 session。

## 開發

```bash
sh scripts/check.sh
```

這個腳本檢查 marketplace 和每個 mod：`claude plugin validate`、`claude plugin test`、`tsc`。它也檢查 mod 之間的衝突：指令名稱、面板 id 和 `$.state` 有沒有重複。

畫在輸入列上方（`AbovePrompt`）的 mod 必須呼叫 `next(e)`，並把下層 mod 的列一起畫出來。每個這類 mod 都要有一個測試，檢查下層的列還在。

## 致謝

`agent-monitor` 改寫自 [JohnnyVizz/claude-kit](https://github.com/JohnnyVizz/claude-kit) 的 [savvy-progress](https://github.com/JohnnyVizz/claude-kit/tree/main/plugins/savvy-progress)（MIT 授權，著作權人 johnnyvizz）。原作的著作權聲明保留在 [plugins/agent-monitor/LICENSE](plugins/agent-monitor/LICENSE)。

## 授權

[MIT](LICENSE)。`agent-monitor` 另有自己的 [LICENSE](plugins/agent-monitor/LICENSE)，裡面保留原作者 johnnyvizz 的著作權聲明。
