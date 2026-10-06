import { mock } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import type { Task } from '../types'

export const PLUGIN = 'todo-calendar'
// 2026-10-05（週一）中午 UTC：在 UTC-11 到 UTC+11 都是同一天
export const NOW = Date.UTC(2026, 9, 5, 12, 0)
export const SURFACES = ['terminal', 'desktop'] as const

export const seed: Task[] = [
  { id: 'old1', title: '繳費', date: '2026-10-02', done: false, createdAt: '2026-09-01T00:00:00.000Z' },
  { id: 'done1', title: '買菜', date: '2026-10-03', done: true, createdAt: '2026-09-01T00:00:00.000Z' },
  { id: 'today1', title: '開會', date: '2026-10-05', done: false, createdAt: '2026-09-01T00:00:00.000Z' },
]

export type World = {
  files: Map<string, string>
  env: Record<string, string>
  appended: { type: string; text: string }[]
  toasts: string[]
  opened: string[]
  /** 外掛透過 $.config.set 寫入的設定 */
  configSets: { key: string; value: unknown }[]
  /** 設定後，$.config.set 會回傳這個 deny，模擬引擎拒絕 */
  configError?: string
}

/** 在 plugin 底下扮演引擎：記錄附加的訊息、toast 和開啟的面板 */
export const TYPED = {
  origin: { kind: 'composer' },
  presentation: { isFullscreen: true, columns: 160 },
} as const

export const stubEngine = (on: On): World => {
  const world: World = { files: new Map(), env: { USERPROFILE: HOME }, appended: [], toasts: [], opened: [], configSets: [] }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__${PLUGIN}__${e.name}` } }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', (_$, e) => {
    world.opened.push(e.id)

    return { value: { isPlaced: true } }
  })
  on('ui.toast', (_$, e) => {
    world.toasts.push(e.text)

    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  // 扮演 /config 選單：只有這個外掛的 autoOpen 一列
  on('config.list', () => ({
    value: [
      {
        key: `${PLUGIN}.autoOpen`,
        label: '新 session 自動開啟面板',
        kind: 'boolean',
        value: true,
        provider: { plugin: PLUGIN, tier: 'user' },
        isLocked: false,
      },
    ],
  }))
  on('config.set', (_$, e) => {
    if (world.configError !== undefined) {
      return { deny: world.configError }
    }
    world.configSets.push({ key: e.key, value: e.value })

    return { value: e.value }
  })
  // 扮演檔案系統和環境變數，測試才能模擬其他 session 直接改檔案
  on('env.get', (_$, e) => ({ value: world.env[e.name] }))
  on('fs.exists', (_$, e) => ({ value: world.files.has(norm(e.path)) }))
  on('fs.read', (_$, e) => {
    const text = world.files.get(norm(e.path))
    if (text === undefined) {
      throw new Error(`ENOENT: ${e.path}`)
    }

    return { value: text }
  })
  on('fs.write', (_$, e) => {
    world.files.set(norm(e.path), e.text)

    return { value: undefined }
  })
  on('session.append', (_$, e) => {
    const block = e.message.content[0] as { text?: string } | undefined
    world.appended.push({ type: e.message.type, text: block?.text ?? '' })

    return { message: e.message, uuid: `row-${world.appended.length}` }
  })

  return world
}

/** 引擎在 Windows 上會把路徑轉成反斜線再交給 hook，假檔案系統用同一種寫法當 key */
export const norm = (path: string) => path.replace(/\//g, '\\')

export const HOME = 'C:/Users/tester'
export const TASKS_PATH = norm(`${HOME}/.claude/todo-calendar/tasks.json`)

export const writeTasks = (world: World, tasks: Task[], path = TASKS_PATH) =>
  world.files.set(norm(path), JSON.stringify({ version: 1, tasks }))

let current: World | undefined

export const start = async ($: Engine, on: On, tasks: Task[] = []) => {
  const world = stubEngine(on)
  writeTasks(world, tasks)
  const clock = mock.clock(on, { now: NOW })
  current = world
  await $.session.start({ cwd: '', surface: 'terminal', isInteractive: true })

  return { clock, world }
}

export const call = async ($: Engine, tool: string, args: Record<string, unknown>) => {
  const ran = await $.tool.call({ tool: `mcp__todo-calendar__${tool}`, ...args } as never)

  return ran as { result?: unknown; isError?: true; text?: string }
}

export const stored = async (_$: Engine) =>
  (JSON.parse(current!.files.get(TASKS_PATH) ?? '{"tasks":[]}') as { tasks: Task[] }).tasks


export const PANE = { title: 'TODO 週曆', isFocused: false, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as const

/** 掛載週曆面板 */
export const mountPane = <S extends (typeof SURFACES)[number] | 'mobile'>($: Engine, surface: S, bodyColumns = 140) =>
  $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: 'todo-calendar', props: { ...PANE, bodyColumns } })
