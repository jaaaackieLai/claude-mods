import { mock } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import type { WorkItem } from '../types'

export const PLUGIN = 'gold-fish'
export const SESSION = 'sess-1'
export const HOME = 'C:/Users/tester'
export const SURFACES = ['terminal', 'desktop'] as const

/** 引擎在 Windows 上會把路徑轉成反斜線再交給 hook，假檔案系統用同一種寫法當 key */
export const norm = (path: string) => path.replace(/\//g, '\\')
export const stackPath = (session = SESSION) => norm(`${HOME}/.claude/gold-fish/${session}.json`)

export type World = {
  files: Map<string, string>
  /** $.session.id() 回傳的值。/clear 或在同一個程序裡 resume 後會換成新的 */
  session: string
  /** 外掛呼叫 $.prompt.suggest 的灰字 */
  suggested: string[]
  /** 寫到 debug log 的訊息 */
  debug: string[]
  /** $.ui.ask 問過的問題和選項 */
  asked: { question: string; options: string[] }[]
  /** 依序回答 $.ui.ask。undefined 代表使用者關掉對話框 */
  answers: (string | undefined)[]
}

/** 在 plugin 底下扮演引擎：檔案系統、環境變數、session id、輸入列建議和問答對話框 */
export const stubEngine = (on: On): World => {
  const world: World = { files: new Map(), session: SESSION, suggested: [], debug: [], asked: [], answers: [] }
  mock.clock(on, { now: 0 })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_$, e) => ({ text: e.text, context: e.context, origin: e.origin }))
  on('turn.complete', (_$, e) => ({ text: e.reason === 'refusal' ? '' : e.answer }))
  // 一條下層的列：金魚列必須把它一起畫出來
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text key="beneath">usage row</Text>
  })
  on('session.id', () => ({ value: world.session }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  // 設定檔的 SessionStart hook：/clear 和在同一個程序裡 resume 以後也會觸發
  on('classic.SessionStart', () => ({}))
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__${PLUGIN}__${e.name}` } }))
  on('env.get', (_$, e) => ({ value: e.name === 'USERPROFILE' ? HOME : undefined }))
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
  on('ui.log', (_$, e) => {
    world.debug.push(e.text)

    return { value: undefined }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.suggest', (_$, e) => {
    world.suggested.push(e.text)

    return { isShown: true }
  })
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    const question = e.questions[0]!
    world.asked.push({ question: question.question, options: question.options.map(option => option.label) })
    const reply = world.answers.shift()
    if (reply === undefined) {
      return { deny: '使用者關掉對話框' }
    }

    return { result: { questions: e.questions, answers: { [question.question]: reply } } } as never
  })

  return world
}

export const writeStack = (world: World, items: WorkItem[], session = SESSION) =>
  world.files.set(stackPath(session), JSON.stringify({ version: 1, items, updatedAt: 0 }))

export const stored = (world: World, session = SESSION): WorkItem[] =>
  (JSON.parse(world.files.get(stackPath(session)) ?? '{"items":[]}') as { items: WorkItem[] }).items

export const start = async ($: Engine, on: On, items?: WorkItem[]) => {
  const world = stubEngine(on)
  if (items !== undefined) {
    writeStack(world, items)
  }
  await $.session.start({ cwd: '', surface: 'terminal', isInteractive: true })

  return world
}

export const call = async ($: Engine, tool: string, args: Record<string, unknown> = {}) =>
  (await $.tool.call({ tool: `mcp__gold-fish__${tool}`, ...args } as never)) as {
    result?: unknown
    isError?: true
    text?: string
  }

export const BAND = {
  plugin: PLUGIN,
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 9 },
    view: {},
  },
} as const

export const mountBand = ($: Engine, surface: (typeof SURFACES)[number], bodyColumns = 100) =>
  $.ui.mount({ ...BAND, surface, props: { ...BAND.props, bodyColumns } } as never)

export const MAIN: WorkItem = { id: 'w1', title: '修 typo-picker 重複標出' }
export const SIDE: WorkItem = { id: 'w2', title: '確認 next(e) 的行為' }
export const DEEP: WorkItem = { id: 'w3', title: '查 Ink 的 wrap 參數' }
export const DEEPER: WorkItem = { id: 'w4', title: '看 Ink 原始碼' }
