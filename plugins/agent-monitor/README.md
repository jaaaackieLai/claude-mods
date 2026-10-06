# agent-monitor

一個 **Claude Code Mod**：子代理在跑時，輸入列上方顯示一條摘要列，列出執行中和完成的數量、估計費用、token 和時間。

## 用法

| 想做的事 | 做法 |
|---|---|
| 開關子代理面板 | `/agent-monitor`，或按摘要列的「面板」 |
| 隱藏摘要列 | 按摘要列的 ✕。全部子代理結束 10 秒後，摘要列也會自動收起。下一個子代理開始時，摘要列會再出現 |
| 清掉已完成的子代理 | 在面板按「清除已完成」 |

面板列出每個子代理的模型、context、token、估計費用和時間，以及它最近呼叫的工具，例如 `Read register.tsx`。桌面 App 用會走路的像素螃蟹顯示，終端機用文字顯示。

費用是用 token 數和公開價格估算的，不是帳單金額。

## 安裝

```text
/plugin marketplace add jaaaackieLai/claude-mods
```

```text
/plugin install agent-monitor@claude-mods
```

## 致謝與授權

改寫自 [JohnnyVizz/claude-kit](https://github.com/JohnnyVizz/claude-kit) 的 [savvy-progress](https://github.com/JohnnyVizz/claude-kit/tree/main/plugins/savvy-progress)。原作移除了搭配 savvy-flow skill 的進度條，只保留子代理監看，並改成和其他 mod 共用輸入列上方的位置。

螃蟹像素圖、面板的 SVG、價格表和大部分工具函式沿用原作。原作和這個 mod 都是 MIT 授權，著作權聲明見 [LICENSE](LICENSE)。
