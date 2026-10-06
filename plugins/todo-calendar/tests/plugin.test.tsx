import { expect, test } from 'claude-code/testing'

import { NOW, PANE, PLUGIN, SURFACES, TASKS_PATH, TYPED, call, seed, start, stored, norm, stubEngine, writeTasks } from './support'
import { mock } from 'claude-code/testing'

test('新增任務', async ($, on) => {
  await start($, on)
  const ran = await call($, 'add_task', { title: '交報告', date: '2026-10-09' })
  expect(ran.isError).toBeUndefined()
  expect(String(ran.result)).toContain('交報告')
  const tasks = await stored($)
  expect(tasks).toHaveLength(1)
  expect(tasks[0]).toMatchObject({ title: '交報告', date: '2026-10-09', done: false })
  expect(tasks[0]!.createdAt).toBe(new Date(NOW).toISOString())
})

test('新增任務拒絕無效日期和空白名稱', async ($, on) => {
  await start($, on)
  expect((await call($, 'add_task', { title: 'x', date: '2026-02-30' })).isError).toBe(true)
  expect((await call($, 'add_task', { title: 'x', date: '週五' })).isError).toBe(true)
  expect((await call($, 'add_task', { title: '  ', date: '2026-10-09' })).isError).toBe(true)
  expect(await stored($)).toHaveLength(0)
})

test('修改任務的名稱和日期', async ($, on) => {
  await start($, on, seed)
  await call($, 'update_task', { id: 'today1', date: '2026-10-12' })
  await call($, 'update_task', { id: 'old1', title: '繳電費' })
  const tasks = await stored($)
  expect(tasks.find(t => t.id === 'today1')).toMatchObject({ title: '開會', date: '2026-10-12' })
  expect(tasks.find(t => t.id === 'old1')).toMatchObject({ title: '繳電費', date: '2026-10-02' })
  expect((await call($, 'update_task', { id: 'nope', title: 'x' })).isError).toBe(true)
  expect((await call($, 'update_task', { id: 'old1' })).isError).toBe(true)
})

test('完成和取消完成任務', async ($, on) => {
  await start($, on, seed)
  await call($, 'complete_task', { id: 'today1', done: true })
  expect((await stored($)).find(t => t.id === 'today1')?.done).toBe(true)
  await call($, 'complete_task', { id: 'today1', done: false })
  expect((await stored($)).find(t => t.id === 'today1')?.done).toBe(false)
})

test('刪除任務', async ($, on) => {
  await start($, on, seed)
  await call($, 'delete_task', { id: 'done1' })
  expect((await stored($)).map(t => t.id)).toEqual(['old1', 'today1'])
  expect((await call($, 'delete_task', { id: 'done1' })).isError).toBe(true)
})

test('列出任務並依日期範圍篩選', async ($, on) => {
  await start($, on, seed)
  const all = String((await call($, 'list_tasks', {})).result)
  expect(all).toContain('[old1]')
  expect(all).toContain('今天是 2026-10-05')
  const some = String((await call($, 'list_tasks', { from: '2026-10-03', to: '2026-10-05' })).result)
  expect(some).not.toContain('[old1]')
  expect(some).toContain('[done1]')
  expect(some).toContain('[today1]')
})


for (const surface of SURFACES) {
  for (const bodyColumns of [60, 140]) {
    test(`面板：切換週（${surface}，寬 ${bodyColumns}）`, async ($, on) => {
      await start($, on, seed)
      const ui = await $.ui.mount({
        plugin: PLUGIN,
        surface,
        component: 'Pane',
        requestId: 'todo-calendar',
        props: { ...PANE, bodyColumns },
      })
      expect((await ui.find({ type: 'Text', text: / 至 / }))?.text).toContain('10/5 至')
      await ui.press({ key: 'prev' })
      expect((await ui.find({ type: 'Text', text: / 至 / }))?.text).toContain('9/28 至')
      await ui.press({ key: 'prev' })
      expect((await ui.find({ type: 'Text', text: / 至 / }))?.text).toContain('9/21 至')
      await ui.press({ key: 'this' })
      expect((await ui.find({ type: 'Text', text: / 至 / }))?.text).toContain('10/5 至')
      await ui.press({ key: 'next' })
      expect((await ui.find({ type: 'Text', text: / 至 / }))?.text).toContain('10/12 至')
      await ui.unmount()
    })

    test(`面板：今天醒目、過期警告、完成暗色（${surface}，寬 ${bodyColumns}）`, async ($, on) => {
      await start($, on, seed)
      const ui = await $.ui.mount({
        plugin: PLUGIN,
        surface,
        component: 'Pane',
        requestId: 'todo-calendar',
        props: { ...PANE, bodyColumns },
      })
      // 本週看不到上週的過期任務，先看今天
      const todayBox = await ui.find({ key: 'day-2026-10-05' })
      expect(todayBox?.props.borderColor).toBe('#D4A017')
      expect((await ui.find({ type: 'Text', text: /今天/ }))?.props.color).toBe('#D4A017')
      await ui.press({ key: 'prev' })
      expect((await ui.find({ type: 'Text', text: /繳費/ }))?.props.color).toBe('error')
      const done = await ui.find({ type: 'Text', text: /買菜/ })
      expect(done?.props.strikethrough).toBe(true)
      expect(done?.props.dimColor).toBe(true)
      await ui.unmount()
    })
  }
}

test('其他 session 改了任務檔，定時同步後面板跟著更新', async ($, on) => {
  const { clock, world } = await start($, on, seed)
  const ui = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'desktop',
    component: 'Pane',
    requestId: 'todo-calendar',
    props: { ...PANE, bodyColumns: 140 },
  })
  expect(await ui.find({ type: 'Text', text: /別的 session/ })).toBeUndefined()
  writeTasks(world, [
    ...seed,
    { id: 'other', title: '別的 session 加的', date: '2026-10-06', done: false, createdAt: '2026-10-05T00:00:00.000Z' },
  ])
  await clock.advance(30_000)
  expect(await ui.find({ type: 'Text', text: /別的 session/ })).toBeDefined()
  await ui.unmount()
})

test('session 開始時開啟面板，不跳提醒也不寫對話紀錄', async ($, on) => {
  const { world } = await start($, on, seed)
  expect(world.opened).toContain('todo-calendar')
  expect(world.toasts).toEqual([])
  expect(world.appended).toEqual([])
})

test('/todo 開啟面板', async ($, on) => {
  const { world } = await start($, on)
  world.opened.length = 0
  const ran = await $.command.run({ command: 'todo', args: '', ...TYPED })
  expect(ran.text).toContain('已開啟')
  expect(world.opened).toEqual(['todo-calendar'])
})

test('任務檔放在 CLAUDE_CONFIG_DIR 底下，沒設定時放在家目錄的 .claude 底下', async ($, on) => {
  const { world } = await start($, on)
  await call($, 'add_task', { title: '交報告', date: '2026-10-09' })
  expect(world.files.has(TASKS_PATH)).toBe(true)
})

test('有設定 CLAUDE_CONFIG_DIR 時用它', async ($, on) => {
  const world = stubEngine(on)
  world.env.CLAUDE_CONFIG_DIR = 'D:/cfg'
  mock.clock(on, { now: NOW })
  await $.session.start({ cwd: '', surface: 'terminal', isInteractive: true })
  await call($, 'add_task', { title: '交報告', date: '2026-10-09' })
  expect(world.files.has(norm('D:/cfg/todo-calendar/tasks.json'))).toBe(true)
})

test('任務檔內容損壞時不覆寫，工具回報錯誤', async ($, on) => {
  const { world } = await start($, on)
  world.files.set(TASKS_PATH, '{ broken')
  const ran = await call($, 'add_task', { title: '交報告', date: '2026-10-09' })
  expect(ran.isError).toBe(true)
  expect(String(ran.result)).toContain('todo-calendar/tasks.json 的內容無法解析')
  expect(world.files.get(TASKS_PATH)).toBe('{ broken')
})

test('autoOpen 設成 false 時，開 session 不自動開啟面板', { options: { autoOpen: false } }, async ($, on) => {
  const { world } = await start($, on, seed)
  expect(world.opened).toEqual([])
})

test('/todo auto off 和 /todo auto on 會改 autoOpen 設定', async ($, on) => {
  const { world } = await start($, on)
  const off = await $.command.run({ command: 'todo', args: 'auto off', ...TYPED })
  expect(world.configSets).toEqual([{ key: 'todo-calendar.autoOpen', value: false }])
  expect(off.text).toBe('已關閉：新 session 不會自動開啟面板。用 /todo 手動開啟。')
  const onRan = await $.command.run({ command: 'todo', args: 'auto on', ...TYPED })
  expect(world.configSets.at(-1)).toEqual({ key: 'todo-calendar.autoOpen', value: true })
  expect(onRan.text).toBe('已開啟：新 session 會自動開啟面板。')
})

test('/todo auto 顯示目前設定', { options: { autoOpen: false } }, async ($, on) => {
  await start($, on)
  const ran = await $.command.run({ command: 'todo', args: 'auto', ...TYPED })
  expect(ran.text).toBe('新 session 自動開啟面板：關閉。用 /todo auto on 或 /todo auto off 切換。')
})

test('/todo 不認得的參數會顯示用法，不開面板', async ($, on) => {
  const { world } = await start($, on)
  world.opened.length = 0
  const ran = await $.command.run({ command: 'todo', args: 'xyz', ...TYPED })
  expect(ran.text).toBe('用法：/todo 開啟面板，/todo auto on|off 設定新 session 是否自動開啟。')
  expect(world.opened).toEqual([])
})

test('/todo auto off 被引擎拒絕時，顯示引擎給的原因', async ($, on) => {
  const { world } = await start($, on)
  world.configError = 'no row has key todo-calendar.autoOpen'
  const ran = await $.command.run({ command: 'todo', args: 'auto off', ...TYPED })
  expect(ran.text).toContain('無法變更設定')
  expect(ran.text).toContain('no row has key todo-calendar.autoOpen')
})
