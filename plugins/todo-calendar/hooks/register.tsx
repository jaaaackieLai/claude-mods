import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ToolCallResult } from 'claude-code'

import type { Selection, Task } from '../types'
import {
  WEEKDAY_NAMES,
  isOverdue,
  isValidDate,
  localDate,
  shortDate,
  tasksBetween,
  tasksOn,
  weekDays,
  weekLabel,
  weekdayIndex,
} from './calendar'

const PANE = 'todo-calendar'
const PANE_TITLE = 'TODO 週曆'
/** 任務檔相對於 Claude Code 設定目錄的位置 */
const TASKS_FILE = 'todo-calendar/tasks.json'
const SYNC_MS = 30_000
/** 面板內容寬度達到這個值，七天才橫向排列，否則直向排列 */
const WIDE_COLUMNS = 105
/** 今天的顏色：深金黃。主題色的 suggestion 給週末、error 給過期，所以用固定色碼 */
const TODAY_COLOR = '#D4A017'

const tasksAtom = atom({ plugin: 'todo-calendar', key: 'tasks' } as const, [])
const weekOffsetAtom = atom({ plugin: 'todo-calendar', key: 'weekOffset' } as const, 0)
const todayAtom = atom({ plugin: 'todo-calendar', key: 'today' } as const, '')
const selectionAtom = atom({ plugin: 'todo-calendar', key: 'selection' } as const, null)

type Args = Record<string, unknown>

const computeToday = async ($: EngineInterface): Promise<string> => {
  const now = await $.clock.now()

  return localDate(now, new Date(now).getTimezoneOffset())
}

// 不用 $.store：它依 mod 的載入方式（--plugin-dir、marketplace）和 Claude Code 版本
// 分成不同檔案，各 session 會讀到不同資料。改存在設定目錄下的固定檔案。
const tasksPath = async ($: EngineInterface): Promise<string> => {
  const configDir = await $.env.get('CLAUDE_CONFIG_DIR')
  if (configDir !== undefined && configDir !== '') {
    return `${configDir.replace(/[\\/]+$/, '')}/${TASKS_FILE}`
  }
  const home = (await $.env.get('USERPROFILE')) || (await $.env.get('HOME')) || ''

  return `${home.replace(/[\\/]+$/, '')}/.claude/${TASKS_FILE}`
}

/** 讀任務檔。檔案不存在時回傳空陣列；內容損壞時丟出錯誤，避免之後的寫入蓋掉它 */
const loadTasks = async ($: EngineInterface): Promise<Task[]> => {
  const path = await tasksPath($)
  if (!(await $.fs.exists(path))) {
    return []
  }
  const text = await $.fs.read(path)
  try {
    const parsed = JSON.parse(text) as { tasks?: unknown }

    if (Array.isArray(parsed.tasks)) {
      return parsed.tasks as Task[]
    }
  } catch {
    // 落到下面的錯誤
  }
  throw new Error(`任務檔 ${path} 的內容無法解析，請修正或移走它。`)
}

const saveTasks = async ($: EngineInterface, tasks: Task[]): Promise<void> => {
  await $.fs.write(await tasksPath($), `${JSON.stringify({ version: 1, tasks }, null, 2)}
`)
  await update($, tasksAtom, () => tasks)
}

type TaskChange = Partial<Pick<Task, 'title' | 'date' | 'done'>>

/** 面板和工具共用：改一個任務，找不到 id 時回傳 undefined */
const changeTask = async ($: EngineInterface, id: string | undefined, change: TaskChange) => {
  const tasks = await loadTasks($)
  const found = tasks.find(task => task.id === id)
  if (found === undefined) {
    return undefined
  }
  const changed: Task = { ...found, ...change }
  await saveTasks($, tasks.map(task => (task.id === found.id ? changed : task)))

  return changed
}

/** 面板和工具共用：刪除一個任務，找不到 id 時回傳 undefined */
const removeTask = async ($: EngineInterface, id: string | undefined) => {
  const tasks = await loadTasks($)
  const found = tasks.find(task => task.id === id)
  if (found !== undefined) {
    await saveTasks($, tasks.filter(task => task.id !== found.id))
  }

  return found
}

/** 重讀任務檔和今天日期，有變動才寫進 $.state，觸發重畫 */
const sync = async ($: EngineInterface): Promise<void> => {
  const stored = await loadTasks($).catch(() => undefined)
  if (stored === undefined) {
    return
  }
  const shown = await read($, tasksAtom)
  if (JSON.stringify(stored) !== JSON.stringify(shown)) {
    await update($, tasksAtom, () => stored)
  }
  const today = await computeToday($)
  if ((await read($, todayAtom)) !== today) {
    await update($, todayAtom, () => today)
  }
}

const newId = (): string =>
  Math.random().toString(36).slice(2, 6) + Date.now().toString(36).slice(-3)

const ok = (text: string): ToolCallResult => ({ result: text })
const fail = (text: string): ToolCallResult => ({ isError: true, result: text, text })

/** 讀寫任務檔失敗時（例如檔案損壞），把錯誤當成工具結果回給模型 */
const failed = (error: { message?: string }): ToolCallResult =>
  fail(error.message ?? '讀寫任務檔失敗。')

const describeTask = (task: Task): string =>
  `[${task.id}] ${task.date} ${task.done ? '(完成) ' : ''}${task.title}`

const notFound = (id: unknown): string =>
  `找不到 id 為 ${String(id)} 的任務，請先用 list_tasks 查詢。`

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined

const dayName = (date: string): string => `週${WEEKDAY_NAMES[weekdayIndex(date)]}`

const openPane = ($: EngineInterface) => $.ui.open({ id: PANE, title: PANE_TITLE })

/** userConfig 欄位在 /config 的名稱：`<plugin>.<field>` */
const AUTO_OPEN_KEY = 'todo-calendar.autoOpen'

/** /todo auto [on|off]：透過 /config 的同一列設定讀寫，選單和指令保持一致 */
const setAutoOpen = async ($: EngineInterface, isAutoOpen: boolean, word: string | undefined) => {
  if (word === undefined) {
    return {
      text: `新 session 自動開啟面板：${isAutoOpen ? '開啟' : '關閉'}。用 /todo auto on 或 /todo auto off 切換。`,
    }
  }
  if (word !== 'on' && word !== 'off') {
    return { text: '用法：/todo auto on 或 /todo auto off。' }
  }
  // 直接寫入，不先查 $.config.list()：2.1.289 實測列表裡找不到這一列
  const reason = await $.config
    .set({ key: AUTO_OPEN_KEY, value: word === 'on' })
    .then(result => result.deny)
    .catch((error: unknown) => (error instanceof Error ? error.message : String(error)))
  if (reason !== undefined) {
    return { text: `無法變更設定（${AUTO_OPEN_KEY}）：${reason}` }
  }

  return {
    text: word === 'on' ? '已開啟：新 session 會自動開啟面板。' : '已關閉：新 session 不會自動開啟面板。用 /todo 手動開啟。',
  }
}

export const register: Register = (on, options) => {
  // userConfig 的 autoOpen；設定改變時引擎會用新值重新載入模組
  const isAutoOpen = options.autoOpen !== false

  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'add_task',
      description:
        '新增一個 TODO 任務到使用者的週曆。date 必須是 YYYY-MM-DD；相對日期（例如「週五」「明天」）請先依今天日期換算。',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '任務名稱' },
          date: { type: 'string', description: '日期，格式 YYYY-MM-DD' },
        },
        required: ['title', 'date'],
      },
    })
    await $.tool.register({
      name: 'update_task',
      description:
        '修改一個 TODO 任務的名稱或日期。先用 list_tasks 查到 id。只傳要改的欄位。',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '任務 id，用 list_tasks 查詢' },
          title: { type: 'string', description: '新的任務名稱' },
          date: { type: 'string', description: '新的日期，格式 YYYY-MM-DD' },
        },
        required: ['id'],
      },
    })
    await $.tool.register({
      name: 'complete_task',
      description: '把一個 TODO 任務標成完成（done: true）或未完成（done: false）。先用 list_tasks 查到 id。',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '任務 id' },
          done: { type: 'boolean', description: 'true 表示完成' },
        },
        required: ['id', 'done'],
      },
    })
    await $.tool.register({
      name: 'delete_task',
      description: '刪除一個 TODO 任務。先用 list_tasks 查到 id。',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: '任務 id' } },
        required: ['id'],
      },
    })
    await $.tool.register({
      name: 'list_tasks',
      description:
        '列出 TODO 任務（含 id），可用 from / to（YYYY-MM-DD，含當天）限制日期範圍。修改、完成或刪除任務前先用它查 id。',
      inputSchema: {
        type: 'object',
        properties: {
          from: { type: 'string', description: '起始日期 YYYY-MM-DD' },
          to: { type: 'string', description: '結束日期 YYYY-MM-DD' },
        },
      },
    })
    await $.command.register({
      name: 'todo',
      description: '開啟 TODO 週曆面板；/todo auto on|off 設定新 session 是否自動開啟',
      argumentHint: '[auto on|off]',
    })
    // /add-task 放在 commands/add-task.md：command.run 回傳的 context
    // 不會讓模型接著處理（2.1.289 實測 num_turns 為 0），一般指令檔才會開始一輪對話。

    await sync($)
    // 重新載入時模組會重跑，但舊環境的計時器已被取消，所以這裡重新建立
    $.clock.every(SYNC_MS, () => {
      void sync($)
    })

    if (isAutoOpen) {
      void openPane($)
    }

    return next(e)
  })

  on('command.run', { command: 'todo' }, async ($, e) => {
    const args = e.args.trim().split(/\s+/).filter(word => word !== '')
    if (args[0] === 'auto') {
      return setAutoOpen($, isAutoOpen, args[1])
    }
    if (args.length > 0) {
      return { text: '用法：/todo 開啟面板，/todo auto on|off 設定新 session 是否自動開啟。' }
    }
    const opened = await openPane($)

    return { text: opened.isPlaced ? '已開啟 TODO 週曆面板。' : `面板未顯示：${opened.reason}` }
  })

  on('tool.call', { tool: 'mcp__todo-calendar__add_task' }, async ($, e) => {
    const args = e as unknown as Args
    const title = str(args.title)
    const date = str(args.date)
    if (title === undefined) {
      return fail('title 不可空白。')
    }
    if (date === undefined || !isValidDate(date)) {
      return fail(`date 必須是有效的 YYYY-MM-DD，收到：${String(args.date)}`)
    }
    const task: Task = {
      id: newId(),
      title,
      date,
      done: false,
      createdAt: new Date(await $.clock.now()).toISOString(),
    }
    await saveTasks($, [...(await loadTasks($)), task])

    return ok(`已新增：${describeTask(task)}（${dayName(date)}）`)
  }).catch(($, e, next) => failed(next.error))

  on('tool.call', { tool: 'mcp__todo-calendar__update_task' }, async ($, e) => {
    const args = e as unknown as Args
    const id = str(args.id)
    const title = str(args.title)
    const date = str(args.date)
    if (date !== undefined && !isValidDate(date)) {
      return fail(`date 必須是有效的 YYYY-MM-DD，收到：${date}`)
    }
    if (title === undefined && date === undefined) {
      return fail('至少要給 title 或 date 其中一個。')
    }
    const changed = await changeTask($, id, { ...(title && { title }), ...(date && { date }) })
    if (changed === undefined) {
      return fail(notFound(args.id))
    }

    return ok(`已修改：${describeTask(changed)}`)
  }).catch(($, e, next) => failed(next.error))

  on('tool.call', { tool: 'mcp__todo-calendar__complete_task' }, async ($, e) => {
    const args = e as unknown as Args
    const id = str(args.id)
    if (typeof args.done !== 'boolean') {
      return fail('done 必須是 true 或 false。')
    }
    const done = args.done
    const changed = await changeTask($, id, { done })
    if (changed === undefined) {
      return fail(notFound(args.id))
    }

    return ok(`已標成${done ? '完成' : '未完成'}：${describeTask(changed)}`)
  }).catch(($, e, next) => failed(next.error))

  on('tool.call', { tool: 'mcp__todo-calendar__delete_task' }, async ($, e) => {
    const args = e as unknown as Args
    const id = str(args.id)
    const removed = await removeTask($, id)
    if (removed === undefined) {
      return fail(notFound(args.id))
    }

    return ok(`已刪除：${describeTask(removed)}`)
  }).catch(($, e, next) => failed(next.error))

  on('tool.call', { tool: 'mcp__todo-calendar__list_tasks' }, async ($, e) => {
    const args = e as unknown as Args
    const from = str(args.from)
    const to = str(args.to)
    for (const date of [from, to]) {
      if (date !== undefined && !isValidDate(date)) {
        return fail(`from / to 必須是有效的 YYYY-MM-DD，收到：${date}`)
      }
    }
    const today = await computeToday($)
    const found = tasksBetween(await loadTasks($), from, to)
    const header = `今天是 ${today}（${dayName(today)}）。共 ${found.length} 項任務：`

    return ok([header, ...found.map(describeTask)].join('\n'))
  }).catch(($, e, next) => failed(next.error))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Text, Button } = elements
    // mobile 沒有 Input，那裡不提供編輯
    const Input = e.surface !== 'mobile' && 'Input' in elements ? elements.Input : undefined
    const tasks = await read($, tasksAtom)
    const offset = await read($, weekOffsetAtom)
    const today = (await read($, todayAtom)) || (await computeToday($))
    const selection = await read($, selectionAtom)
    const days = weekDays(today, offset)
    const weekTasks = tasksBetween(tasks, days[0], days[6])
    const isWide = e.props.bodyColumns >= WIDE_COLUMNS
    // 橫排時七欄之間有 6 格空隙
    const columnWidth = Math.floor((e.props.bodyColumns - 6) / 7)

    const taskTitle = (task: Task) => {
      if (task.done) {
        return (
          <Text dimColor strikethrough wrap="wrap">
            {task.title}
          </Text>
        )
      }
      if (isOverdue(task, today)) {
        return (
          <Text color="error" wrap="wrap">
            {task.title}
          </Text>
        )
      }

      return <Text wrap="wrap">{task.title}</Text>
    }

    const taskLine = (task: Task) => (
      <Box key={`task-${task.id}`} flexDirection="row" gap={1}>
        <Button
          key={`check-${task.id}`}
          plain
          label={task.done ? '✓' : '○'}
          dimColor={task.done}
          onPress={() => changeTask($, task.id, { done: !task.done })}
        />
        <Box flexGrow={1}>{taskTitle(task)}</Box>
        <Button
          key={`pick-${task.id}`}
          plain
          label="⋯"
          dimColor={selection?.id !== task.id}
          onPress={() =>
            update($, selectionAtom, held =>
              held?.id === task.id ? null : { id: task.id, mode: 'menu', title: task.title, date: task.date, error: '' },
            )
          }
        />
      </Box>
    )

    const selected = tasks.find(task => task.id === selection?.id)
    const close = () => update($, selectionAtom, () => null)
    // 週末都用藍色，今天用深金黃，整個面板只有今天最搶眼
    const headingColor = (date: string, isToday: boolean) => {
      if (isToday) {
        return TODAY_COLOR
      }
      const index = weekdayIndex(date)

      return index >= 5 ? 'suggestion' : undefined
    }

    const day = (date: string) => {
      const isToday = date === today
      const list = tasksOn(tasks, date)
      const color = headingColor(date, isToday)

      return (
        <Box
          key={`day-${date}`}
          flexDirection="column"
          width={isWide ? columnWidth : undefined}
          borderStyle={isWide || isToday ? 'round' : undefined}
          borderColor={isToday ? TODAY_COLOR : undefined}
          borderDimColor={!isToday}
          paddingX={isWide || isToday ? 1 : 0}
        >
          {/* 星期幾、日期標籤、今天的記號，彼此空一格 */}
          <Box flexDirection="row" flexWrap="wrap" alignItems="center" gap={1}>
            <Text bold color={color}>
              {WEEKDAY_NAMES[weekdayIndex(date)]}
            </Text>
            {/* 一行高的底色標籤：inverse 把字色當底色，平日用暗色底 */}
            <Text bold inverse color={color} dimColor={color === undefined}>
              {` ${shortDate(date)} `}
            </Text>
            {isToday && (
              <Text bold color={color}>
                ● 今天
              </Text>
            )}
          </Box>
          {list.length === 0 ? <Text dimColor>—</Text> : list.map(taskLine)}
        </Box>
      )
    }

    const pickedLabel = (picked: Task) =>
      `${picked.title}（${shortDate(picked.date)} ${WEEKDAY_NAMES[weekdayIndex(picked.date)]}）`

    const setDraft = (draft: Partial<Selection>) =>
      update($, selectionAtom, held => (held === null ? null : { ...held, ...draft }))

    /** 讀最新的草稿再存檔，避免用到畫面當下抓到的舊值 */
    const saveDraft = async (draft: Partial<Selection> = {}) => {
      const held = await read($, selectionAtom)
      if (held === null) {
        return
      }
      const title = (draft.title ?? held.title).trim()
      const date = (draft.date ?? held.date).trim()
      if (title === '') {
        await setDraft({ ...draft, error: '名稱不可空白。' })
        return
      }
      if (!isValidDate(date)) {
        await setDraft({ ...draft, error: '日期要用 YYYY-MM-DD 格式，例如 2026-10-07。' })
        return
      }
      await changeTask($, held.id, { title, date })
      await close()
    }

    const actionBar = (picked: Task, held: Selection) => {
      if (held.mode === 'edit' && Input !== undefined) {
        return (
          <Box flexDirection="column" borderStyle="round" borderColor="permission" paddingX={1} marginTop={1}>
            <Input
              key="edit-title"
              label="名稱 "
              value={held.title}
              autoFocus
              submitLabel="儲存"
              onInput={(title: string) => setDraft({ title })}
              onSubmit={(title: string) => saveDraft({ title })}
            />
            <Input
              key="edit-date"
              label="日期 "
              value={held.date}
              placeholder="YYYY-MM-DD"
              submitLabel="儲存"
              onInput={(date: string) => setDraft({ date })}
              onSubmit={(date: string) => saveDraft({ date })}
            />
            {held.error !== '' && <Text color="warning">{held.error}</Text>}
            <Box flexDirection="row" gap={2}>
              <Button key="save" plain label="儲存" onPress={() => saveDraft()} />
              <Button key="cancel" plain label="取消" onPress={close} />
            </Box>
          </Box>
        )
      }
      if (held.mode === 'confirm') {
        return (
          <Box flexDirection="column" borderStyle="round" borderColor="warning" paddingX={1} marginTop={1}>
            <Text>刪除「{picked.title}」？刪除後無法復原。</Text>
            <Box flexDirection="row" gap={2}>
              <Button
                key="confirm-delete"
                plain
                hotkey="y"
                label="確定刪除"
                onPress={async () => {
                  await removeTask($, picked.id)
                  await close()
                }}
              />
              <Button key="cancel" plain hotkey="x" label="取消" onPress={close} />
            </Box>
          </Box>
        )
      }

      return (
        <Box flexDirection="column" borderStyle="round" borderColor="permission" paddingX={1} marginTop={1}>
          <Text bold>{pickedLabel(picked)}</Text>
          <Box flexDirection="row" gap={2}>
            {Input !== undefined && (
              <Button key="edit" plain hotkey="e" label="編輯" onPress={() => update($, selectionAtom, () => ({ ...held, mode: 'edit' }))} />
            )}
            <Button key="delete" plain hotkey="d" label="刪除" onPress={() => update($, selectionAtom, () => ({ ...held, mode: 'confirm' }))} />
            <Button key="cancel" plain hotkey="x" label="取消" onPress={close} />
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between" flexWrap="wrap">
          <Text bold>{weekLabel(days)}</Text>
          <Text dimColor>
            共 {weekTasks.length} 項，完成 {weekTasks.filter(task => task.done).length}
          </Text>
        </Box>
        <Box flexDirection="row" gap={3} flexWrap="wrap" marginBottom={1}>
          <Button key="prev" plain hotkey="p" label="◀ 上週" onPress={() => update($, weekOffsetAtom, n => n - 1)} />
          {/* 看本週時用主要色標出來；plain 會蓋掉 variant，所以那時不加 plain */}
          {offset === 0 ? (
            <Button key="this" variant="primary" hotkey="t" label="本週" onPress={() => update($, weekOffsetAtom, () => 0)} />
          ) : (
            <Button key="this" plain hotkey="t" label="本週" onPress={() => update($, weekOffsetAtom, () => 0)} />
          )}
          <Button key="next" plain hotkey="n" label="下週 ▶" onPress={() => update($, weekOffsetAtom, n => n + 1)} />
        </Box>
        <Box key="days" flexDirection={isWide ? 'row' : 'column'} gap={1}>
          {days.map(day)}
        </Box>
        {selected !== undefined && selection !== null && actionBar(selected, selection)}
      </Box>
    )
  })
}
