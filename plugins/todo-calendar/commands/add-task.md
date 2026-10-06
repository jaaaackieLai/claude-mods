---
description: 用一句話新增 TODO 任務，Claude 會解析日期
argument-hint: <任務描述，例如：週五交報告>
allowed-tools: mcp__todo-calendar__add_task, mcp__todo-calendar__list_tasks
---

使用者要新增一個 TODO 任務：「$ARGUMENTS」

1. 呼叫 `mcp__todo-calendar__list_tasks`，`from` 和 `to` 都填 `1900-01-01`。它回傳的第一行是今天的日期和星期。一週從週一開始。
2. 從描述中拆出任務名稱和日期。日期相對於今天換算成 YYYY-MM-DD。「週五」指本週的週五；如果本週的那天已經過了，改用下週的那天。描述沒有寫日期就用今天。
3. 呼叫 `mcp__todo-calendar__add_task`，傳入 `title` 和 `date`。
4. 用一句話回報新增的任務名稱和日期（含星期幾）。不要做其他事。
