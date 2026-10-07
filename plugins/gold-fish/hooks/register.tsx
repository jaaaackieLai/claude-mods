import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ToolCallResult } from 'claude-code'

import type { Reminder, Stack, WorkItem } from '../types'
import {
  CURRENT_MARK,
  GAP,
  PAUSED_MARK,
  SEPARATOR,
  close,
  contextText,
  followReminder,
  highestId,
  layout,
  push,
  remove,
  rename,
  stackText,
  textWidth,
  truncate,
} from './stack'
import type { Failure } from './stack'

/** 工作堆疊檔所在的資料夾，相對於 Claude Code 設定目錄 */
const STACK_DIR = 'gold-fish'
/** 金魚橘：目前的工作項的記號 */
const GOLD = '#FF8C1A'
/** 回主線提醒：深橘底、亮橘字 */
const REMIND_BG = '#5C2E00'
const REMIND_FG = '#FFB347'
const REMIND_LABEL = ' ↩ 回到主線 '
/** 「剛離開」後面的支線標題最多佔金魚列寬度的幾分之一，但至少有 LEFT_MIN 格 */
const LEFT_SHARE = 4
const LEFT_MIN = 12
/** 顯示「剛離開」後，金魚列至少要留給工作項的格數 */
const ITEMS_MIN = 12
/** 選單的 3 個操作 */
const ACTION = { close: '收支線', rename: '改標題', remove: '刪除' } as const
const KEEP_TITLE = '保留原標題'
const CANCEL = '取消'
/** $.ui.ask 一次最多 4 個選項；合併項超過時分頁，最後一格是「更多」 */
const ASK_MAX = 4
const MORE = '更多…'
/** 使用者自己送出的訊息。其他來源（通知、排程、其他 session）不清掉回主線提醒 */
const USER_ORIGINS: readonly string[] = ['composer', 'bridge', 'sdk']

/** transcript 裡 gold-fish 工具的列 */
const TOOL_PREFIX = 'mcp__gold-fish__'
const FISH = '🐟'
const FAIL_COLOR = '#FF5F5F'

const EMPTY: Stack = { items: [], lastId: 0 }

const stackAtom = atom({ plugin: 'gold-fish', key: 'stack' } as const, EMPTY)
const reminderAtom = atom({ plugin: 'gold-fish', key: 'reminder' } as const, null)
const loadedAtom = atom({ plugin: 'gold-fish', key: 'loaded' } as const, null)

type Args = Record<string, unknown>

// 不用 $.store：它依 mod 的載入方式和 Claude Code 版本分成不同檔案（同 todo-calendar）。
// 每個 session 一個檔案，--resume 後還讀得到。
const stackPath = async ($: EngineInterface, session: string): Promise<string> => {
  const file = `${STACK_DIR}/${session}.json`
  const configDir = await $.env.get('CLAUDE_CONFIG_DIR')
  if (configDir !== undefined && configDir !== '') {
    return `${configDir.replace(/[\\/]+$/, '')}/${file}`
  }
  const home = (await $.env.get('USERPROFILE')) || (await $.env.get('HOME')) || ''

  return `${home.replace(/[\\/]+$/, '')}/.claude/${file}`
}

/** 工具還在執行時，列上寫的動作和對象 */
const runningText = (name: string, input: Args): string => {
  const title = str(input.title)
  const id = str(input.id)
  if (name === 'push_work_item') {
    return `開工作項：${title}…`
  }
  if (name === 'close_work_item') {
    return `收工作項：${id ?? '最上層'}…`
  }
  if (name === 'rename_work_item') {
    return `改標題：${id} ${title}…`
  }

  return `刪除工作項：${id}…`
}

const isFailure = (value: object): value is Failure => 'error' in value

const isWorkItem = (item: unknown): item is WorkItem =>
  typeof item === 'object' &&
  item !== null &&
  typeof (item as Args).id === 'string' &&
  typeof (item as Args).title === 'string'

/** 讀工作堆疊檔。檔案不存在時用空的工作堆疊；內容無法解析時回傳錯誤 */
const readStackFile = async ($: EngineInterface, path: string): Promise<Stack | Failure> => {
  if (!(await $.fs.exists(path))) {
    return EMPTY
  }
  try {
    const parsed = JSON.parse(await $.fs.read(path)) as { items?: unknown; lastId?: unknown }
    // 有一個工作項格式不對就整個當成無法解析。只丟掉那一項的話，下次寫檔會把它從檔案刪掉
    if (Array.isArray(parsed.items) && parsed.items.every(isWorkItem)) {
      const items = parsed.items

      // 沒有 lastId 的舊檔案，從現有的 id 算起
      return { items, lastId: highestId(items, typeof parsed.lastId === 'number' ? parsed.lastId : 0) }
    }
  } catch {
    // 落到下面的錯誤
  }

  return { error: `工作堆疊檔 ${path} 的內容無法解析。請修正或移走它，gold-fish 才會再記錄工作項。` }
}

/**
 * 讀目前 session 的工作堆疊檔到 $.state，並清掉回主線提醒。內容無法解析時顯示空的工作堆疊，
 * loaded 留 null：之後的變更都回傳錯誤，不寫檔蓋掉它
 */
const loadStack = async ($: EngineInterface): Promise<Failure | undefined> => {
  const session = await $.session.id()
  const file = await readStackFile($, await stackPath($, session))
  const failed = isFailure(file)
  await update($, stackAtom, () => (failed ? EMPTY : file))
  await update($, reminderAtom, () => null)
  await update($, loadedAtom, () => (failed ? null : session))
  if (failed) {
    $.ui.log(file.error, { to: 'debug' })

    return file
  }

  return undefined
}

/** session 換了（/clear、resume），或工作堆疊檔還沒讀成功時，重讀一次 */
const ensureLoaded = async ($: EngineInterface): Promise<Failure | undefined> =>
  (await read($, loadedAtom)) === (await $.session.id()) ? undefined : loadStack($)

/** 把 $.state 裡最新的工作堆疊寫檔 */
const saveStack = async ($: EngineInterface): Promise<void> => {
  const path = await stackPath($, await $.session.id())
  const updatedAt = await $.clock.now()
  const { items, lastId } = await read($, stackAtom)
  await $.fs.write(path, `${JSON.stringify({ version: 1, items, lastId, updatedAt }, null, 2)}\n`)
}

/**
 * 改工作堆疊並寫檔。change 必須是純函式：update 遇到同時的變更時，會用最新的工作堆疊重算。
 * 回主線提醒跟著新的工作堆疊調整，例如開新的工作項或刪除主線後清掉
 */
const mutate = async <R extends { items: WorkItem[]; lastId?: number }>(
  $: EngineInterface,
  change: (items: WorkItem[], lastId: number) => R | Failure,
): Promise<R | Failure> => {
  const failed = await ensureLoaded($)
  if (failed !== undefined) {
    return failed
  }
  let outcome = undefined as R | Failure | undefined
  const stack = await update($, stackAtom, current => {
    outcome = change(current.items, current.lastId)

    return isFailure(outcome) ? current : { items: outcome.items, lastId: outcome.lastId ?? current.lastId }
  })
  const result = outcome!
  if (isFailure(result)) {
    return result
  }
  await update($, reminderAtom, reminder => followReminder(stack.items, reminder))
  await saveStack($)

  return result
}

const returnText = (reminder: Reminder) => `繼續${reminder.returnTo}`

const suggestReturn = ($: EngineInterface, reminder: Reminder) => {
  void $.prompt.suggest({ text: returnText(reminder) })
}

/** 收支線：Claude 的工具和選單共用。工作堆疊沒變空時顯示回主線提醒 */
const closeItem = async ($: EngineInterface, id: string | undefined): Promise<string | Failure> => {
  const closed = await mutate($, items => close(items, id))
  if (isFailure(closed)) {
    return closed
  }
  if (closed.returnTo === undefined) {
    return `已收起主線：${closed.left.title}。工作堆疊是空的。`
  }
  const reminder = { id: closed.returnTo.id, returnTo: closed.returnTo.title, left: closed.left.title }
  await update($, reminderAtom, () => reminder)
  // 回合進行中時輸入列不顯示建議，turn.complete 會再建議一次
  suggestReturn($, reminder)

  return `已收支線：${closed.left.title}。回到主線：${closed.returnTo.title}。`
}

const renameItem = async ($: EngineInterface, id: string, title: string): Promise<string | Failure> => {
  const renamed = await mutate($, items => rename(items, id, title))

  return isFailure(renamed) ? renamed : `已改標題：${renamed.item.id} ${renamed.item.title}。`
}

const removeItem = async ($: EngineInterface, id: string): Promise<string | Failure> => {
  const removed = await mutate($, items => remove(items, id))

  return isFailure(removed) ? removed : `已刪除工作項：${removed.removed.title}。`
}

/** 工具結果：做了什麼，加上更新後的工作堆疊，讓 Claude 知道 id */
const answer = async ($: EngineInterface, done: string | Failure): Promise<ToolCallResult> => {
  if (typeof done !== 'string') {
    return { isError: true, result: done.error, text: done.error }
  }

  return { result: `${done}\n${stackText((await read($, stackAtom)).items)}` }
}

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined

/** 問使用者。使用者關掉對話框時回傳 undefined */
const ask = ($: EngineInterface, question: string, options: readonly string[], header: string) =>
  $.ui.ask(question, { options, header }).catch(() => undefined)

/** 點工作項跳出的選單：收支線、改標題、刪除工作項 */
const openMenu = async ($: EngineInterface, item: WorkItem) => {
  const choice = await ask($, `「${item.title}」要怎麼處理？`, [ACTION.close, ACTION.rename, ACTION.remove], 'gold-fish')
  let done: string | Failure | undefined
  if (choice === ACTION.close) {
    done = await closeItem($, item.id)
  } else if (choice === ACTION.remove) {
    done = await removeItem($, item.id)
  } else if (choice === ACTION.rename) {
    // 選項以外，使用者可以在對話框直接輸入文字，那段文字就是新標題
    const title = await ask($, `「${item.title}」的新標題是什麼？請直接輸入新標題。`, [KEEP_TITLE, CANCEL], ACTION.rename)
    if (title !== undefined && title !== KEEP_TITLE && title !== CANCEL) {
      done = await renameItem($, item.id, title)
    }
  }
  // 選單跳出後，工作項可能已經被 Claude 移走
  if (done !== undefined && typeof done !== 'string') {
    $.ui.toast(done.error)
  }
}

/** 點合併項：列出裡面的工作項，選一個後再跳出選單。超過 4 項時分頁 */
const pickMerged = async ($: EngineInterface, merged: readonly WorkItem[]) => {
  let rest = merged
  while (rest.length > 1) {
    const fits = rest.length <= ASK_MAX
    const page = fits ? rest : rest.slice(0, ASK_MAX - 1)
    // 選項不可重複：標題相同，或和「更多…」相同時，加上 id 區分
    const labels = page.map(item =>
      item.title === MORE || page.some(other => other !== item && other.title === item.title)
        ? `${item.title}（${item.id}）`
        : item.title,
    )
    const choice = await ask($, '要處理哪一個工作項？', fits ? labels : [...labels, MORE], 'gold-fish')
    const picked = choice === undefined ? undefined : page[labels.indexOf(choice)]
    if (picked !== undefined) {
      return openMenu($, picked)
    }
    if (choice !== MORE) {
      return
    }
    rest = rest.slice(page.length)
  }
  if (rest[0] !== undefined) {
    await openMenu($, rest[0])
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'push_work_item',
      description:
        '把一個工作項放到 gold-fish 工作堆疊的最上層。工作堆疊是空的時候建立主線，否則開支線。開始多步驟工作，或話題轉到需要先處理的問題時呼叫。簡單問答不要呼叫。',
      inputSchema: {
        type: 'object',
        properties: { title: { type: 'string', description: '工作項標題，簡短寫出要做什麼' } },
        required: ['title'],
      },
    })
    await $.tool.register({
      name: 'close_work_item',
      description:
        '收支線：支線完成或放棄時呼叫。會一起移除它上面的工作項，並提醒使用者回到主線。最底層的主線完成時也用它。',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: '工作項 id，例如 w2。省略時收最上層的工作項' } },
      },
    })
    await $.tool.register({
      name: 'rename_work_item',
      description: '改工作項的標題。使用者說工作項記錯時用。',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '工作項 id，例如 w1' },
          title: { type: 'string', description: '新的標題' },
        },
        required: ['id', 'title'],
      },
    })
    await $.tool.register({
      name: 'remove_work_item',
      description: '刪除一個記錯的工作項。只移除這一項，不提醒回主線。',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: '工作項 id，例如 w2' } },
        required: ['id'],
      },
    })
    const failed = await loadStack($)
    if (failed !== undefined) {
      $.ui.toast(failed.error)
    }

    return next(e)
  })

  // /clear 和在同一個程序裡 resume 以後，session id 換了，但不會再觸發 session.start。
  // 先清空，等設定檔的 SessionStart 事件讀新 session 的工作堆疊檔。
  // 沒等到時，下一則訊息或下一次變更時再讀（ensureLoaded）
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') {
      await update($, stackAtom, () => EMPTY)
      await update($, reminderAtom, () => null)
      await update($, loadedAtom, () => null)
    }

    return next(e)
  })

  // /clear 和 resume 以後設定檔的 SessionStart 事件仍會觸發。在這裡讀新 session 的工作堆疊檔，
  // 金魚列不用等使用者送出訊息就顯示（ui.render 不能寫 $.state，所以不能在畫列時讀檔）。
  // startup 不處理：session.start 已經讀過，檔案無法解析時才不會重複跳出錯誤
  on('classic.SessionStart', async ($, e, next) => {
    if (e.source === 'clear' || e.source === 'resume') {
      const failed = await ensureLoaded($)
      if (failed !== undefined) {
        $.ui.toast(failed.error)
      }
    }

    return next(e)
  })

  on('tool.call', { tool: 'mcp__gold-fish__push_work_item' }, async ($, e) => {
    const title = str((e as unknown as Args).title)
    if (title === undefined) {
      return answer($, { error: 'title 不可空白。' })
    }
    // 開始新的工作項後，mutate 會清掉過時的回主線提醒
    const pushed = await mutate($, (items, lastId) => ({ ...push(items, title, lastId), isMain: items.length === 0 }))
    if (isFailure(pushed)) {
      return answer($, pushed)
    }

    return answer($, `${pushed.isMain ? '已建立主線' : '已開支線'}：${pushed.id} ${title}。`)
  })

  on('tool.call', { tool: 'mcp__gold-fish__close_work_item' }, async ($, e) =>
    answer($, await closeItem($, str((e as unknown as Args).id))),
  )

  on('tool.call', { tool: 'mcp__gold-fish__rename_work_item' }, async ($, e) => {
    const args = e as unknown as Args
    const id = str(args.id)
    const title = str(args.title)
    if (id === undefined || title === undefined) {
      return answer($, { error: 'id 和 title 都不可空白。' })
    }

    return answer($, await renameItem($, id, title))
  })

  on('tool.call', { tool: 'mcp__gold-fish__remove_work_item' }, async ($, e) => {
    const id = str((e as unknown as Args).id)
    if (id === undefined) {
      return answer($, { error: 'id 不可空白。' })
    }

    return answer($, await removeItem($, id))
  })

  // 每則訊息都附上工作堆疊和規則。回主線提醒只附在使用者送出的訊息上，送出後提醒消失。
  // 通知、排程和其他 session 的訊息不是使用者回到主線，不附提醒，也不清掉它
  on('prompt.submit', async ($, e, next) => {
    const failed = await ensureLoaded($)
    const fromUser = USER_ORIGINS.includes(e.origin.kind)
    const reminder = fromUser ? await read($, reminderAtom) : null
    const text =
      failed === undefined ? contextText((await read($, stackAtom)).items, reminder) : `[gold-fish] ${failed.error}`
    if (reminder !== null) {
      await update($, reminderAtom, () => null)
    }

    return next({ ...e, context: [...(e.context ?? []), text] })
  })

  // Claude 在回合中收支線時，輸入列還不能顯示建議，回合結束後再建議
  on('turn.complete', async ($, e, next) => {
    const ran = await next(e)
    const reminder = await read($, reminderAtom)
    if (reminder !== null) {
      suggestReturn($, reminder)
    }

    return ran
  })

  // 引擎自己的建議會蓋掉回主線的建議，有提醒時換成「繼續<主線>」
  on('prompt.suggest', async ($, e, next) => {
    const reminder = await read($, reminderAtom)
    if (reminder !== null && e.origin.kind === 'suggestion') {
      return next({ ...e, text: returnText(reminder) })
    }

    return next(e)
  })

  // transcript 裡 gold-fish 工具的列縮成一行淡色字，金魚列已經顯示整個工作堆疊
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const { tool, input, output, isRunning, isErrored, isInterrupted } = e.props
    // 中斷時照引擎原本的畫法，它會寫 Interrupted
    if (!tool.startsWith(TOOL_PREFIX) || isInterrupted) {
      return next(e)
    }
    const { Text } = $.ui.resolve(e)
    if (isRunning) {
      return <Text dimColor>{`${FISH} ${runningText(tool.slice(TOOL_PREFIX.length), input as Args)}`}</Text>
    }
    if (typeof output !== 'string') {
      return next(e)
    }
    // 引擎畫列時，answer 回傳的 isError 不一定變成 isErrored。成功的結果後面一定附上工作堆疊，
    // 所以只有一行的結果也是失敗
    const [first, ...rest] = output.split('\n')
    if (isErrored || rest.length === 0) {
      return <Text color={FAIL_COLOR}>{`${FISH} 失敗：${first}`}</Text>
    }

    return <Text dimColor>{`${FISH} ${first}`}</Text>
  })

  // 工具結果已經畫在工具列上，結果區塊不畫
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (!e.props.tool.startsWith(TOOL_PREFIX) || typeof e.props.output !== 'string') {
      return next(e)
    }
    const { Box } = $.ui.resolve(e)

    return <Box />
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    const { items } = await read($, stackAtom)
    if (e.props.hasSurvey || items.length === 0) {
      return below
    }
    const { Box, Button, Text } = $.ui.resolve(e)
    const reminder = await read($, reminderAtom)

    let columns = e.props.bodyColumns
    let left: string | undefined
    if (reminder !== null) {
      columns -= textWidth(REMIND_LABEL) + GAP
      const leftText = `（剛離開：${truncate(reminder.left, Math.max(LEFT_MIN, Math.floor(columns / LEFT_SHARE)))}）`
      const leftWidth = textWidth(leftText) + GAP
      // 太窄時省略「剛離開」，把空間留給工作項
      if (columns - leftWidth >= ITEMS_MIN) {
        left = leftText
        columns -= leftWidth
      }
    }

    const slots = layout(items, columns)
    // 太窄，連目前的工作項都放不下時不畫金魚列
    if (slots.length === 0) {
      return below
    }
    const cells = slots.flatMap((slot, index) => {
      const separator =
        index === 0
          ? []
          : [
              <Text key={`separator-${index}`} dimColor>
                {SEPARATOR}
              </Text>,
            ]
      if (slot.kind === 'merged') {
        return [
          ...separator,
          <Button key="merged" plain dimColor label={slot.label} onPress={() => pickMerged($, slot.items)} />,
        ]
      }
      const { item, isCurrent } = slot
      const mark = isCurrent ? (
        <Text key={`mark-${item.id}`} color={GOLD} bold>
          {CURRENT_MARK}
        </Text>
      ) : (
        <Text key={`mark-${item.id}`} dimColor>
          {PAUSED_MARK}
        </Text>
      )

      return [
        ...separator,
        mark,
        <Button key={`item-${item.id}`} plain dimColor={!isCurrent} label={slot.label} onPress={() => openMenu($, item)} />,
      ]
    })

    const row = (
      <Box key="gold-fish" flexDirection="row" alignItems="center" gap={GAP}>
        {reminder !== null && (
          <Text bold color={REMIND_FG} backgroundColor={REMIND_BG}>
            {REMIND_LABEL}
          </Text>
        )}
        {cells}
        {left !== undefined && (
          <Text dimColor wrap="truncate-end">
            {left}
          </Text>
        )}
      </Box>
    )

    if (!below) {
      return row
    }

    return (
      <Box flexDirection="column">
        {row}
        {below}
      </Box>
    )
  })
}
