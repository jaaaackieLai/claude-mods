import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { On } from 'claude-code'

// Stand in for the engine beneath the plugin: a clock, an empty drawing, a finished turn.
const engine = (on: On) => {
  const clock = mock.clock(on, { now: 1_000 })
  on('ui.render', async ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('turn.complete', async (_$, e) => ({ text: e.answer, usage: e.usage }))
  return clock
}

const SURFACES = ['terminal', 'desktop'] as const

type Found = { text?: string; props?: Record<string, unknown> }
type Drawing = { findAll: (q: { type: string; text?: RegExp }) => Promise<Found[]> }

// What a drawing shows matching `re`: a Text's own text on the terminal, an Svg's alt on the desktop.
const shown = async (ui: Drawing, re: RegExp): Promise<string | undefined> => {
  const [text] = await ui.findAll({ type: 'Text', text: re })
  if (text) return text.text
  const svgs = await ui.findAll({ type: 'Svg' })
  return svgs.map(one => String(one.props?.alt ?? '')).find(alt => re.test(alt))
}

// The band's summary: what counts the subagents.
const summaryOf = (ui: Drawing) => shown(ui, /執行中/)

const BAND = {
  plugin: 'agent-monitor',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 4,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 4 },
    view: {},
  },
} as const

const PANE = {
  plugin: 'agent-monitor',
  component: 'Pane',
  requestId: 'agent-monitor',
  props: {
    title: '子代理',
    isFocused: true,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const USAGE = {
  model: 'claude-opus-5-5',
  input_tokens: 1_000_000,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
}

test('band stays hidden before any subagent runs', async ($, on) => {
  engine(on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ key: 'am-dismiss' })).toBeUndefined()
    await ui.unmount()
  }
})

test('band and pane follow a subagent from spawn to finish', async ($, on) => {
  engine(on)
  on('agent.spawn', async () => ({ model: 'claude-opus-5-5', agentId: 'a1' }))

  await $.agent.spawn({
    tool_use_id: 't1',
    prompt: 'read the repo',
    description: '讀取 repo',
    subagentType: 'Explore',
  } as never)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await summaryOf(ui)).toMatch(/1 執行中/)
    await ui.unmount()
  }

  await $.turn.complete({
    answer: 'ok',
    durationMs: 1000,
    isAborted: false,
    turnId: 'turn-1',
    agentId: 'a1',
    reason: 'answer',
    usage: USAGE,
  })

  for (const surface of SURFACES) {
    const band = await $.ui.mount({ ...BAND, surface })
    const summary = await summaryOf(band)
    expect(summary).toMatch(/1 完成/)
    // 1M input tokens on Opus 5.5 at $4 per million.
    expect(summary).toMatch(/\$4\.00/)
    await band.unmount()

    const pane = await $.ui.mount({ ...PANE, surface })
    expect(await shown(pane, /讀取 repo/)).toBeDefined()
    await pane.unmount()
  }
})

test('band keeps what the plugins beneath draw (e.g. typo-picker)', async ($, on) => {
  mock.clock(on, { now: 1_000 })
  on('ui.render', async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="beneath">選字列</Text>
  })
  on('agent.spawn', async () => ({ model: 'claude-opus-5-5', agentId: 'a1' }))
  await $.agent.spawn({ tool_use_id: 't1', prompt: 'x', description: 'x', subagentType: 'Explore' } as never)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await summaryOf(ui)).toMatch(/1 執行中/)
    expect(await ui.find({ type: 'Text', text: /選字列/ })).toBeDefined()
    await ui.unmount()
  }
})

test('dismiss hides the band until the next subagent starts', async ($, on) => {
  engine(on)
  let n = 0
  on('agent.spawn', async () => ({ model: 'claude-haiku-4-5', agentId: `a${++n}` }))
  const spawn = (d: string) =>
    $.agent.spawn({ tool_use_id: d, prompt: d, description: d, subagentType: 'general-purpose' } as never)

  await spawn('one')
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'am-dismiss' })
  expect(await ui.find({ key: 'am-dismiss' })).toBeUndefined()
  await ui.unmount()

  await spawn('two')
  const again = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await summaryOf(again)).toMatch(/2 執行中/)
  await again.unmount()
})

test('clear removes finished subagents from the pane', async ($, on) => {
  engine(on)
  on('agent.spawn', async () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }))
  await $.agent.spawn({ tool_use_id: 't1', prompt: 'x', description: '整理筆記', subagentType: 'general-purpose' } as never)
  await $.turn.complete({
    answer: 'ok',
    durationMs: 10,
    isAborted: false,
    turnId: 'turn-1',
    agentId: 'a1',
    reason: 'answer',
    usage: USAGE,
  })

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ text: '整理筆記' })).toBeDefined()
  await pane.press({ key: 'am-clear' })
  expect(await pane.find({ text: '整理筆記' })).toBeUndefined()
  await pane.unmount()
})

test('desktop draws pictures and the terminal draws text', async ($, on) => {
  engine(on)
  on('agent.spawn', async () => ({ model: 'claude-opus-5-5', agentId: 'a1' }))
  await $.agent.spawn({ tool_use_id: 't1', prompt: 'x', description: '找檔案', subagentType: 'Explore' } as never)

  const desk = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const svgs = await desk.findAll({ type: 'Svg' })
  // The header tiles, then one row per subagent.
  expect(svgs.length).toBe(2)
  expect(String(svgs[0]?.props?.alt)).toMatch(/費用/)
  expect(String(svgs[1]?.props?.source)).toMatch(/找檔案/)
  await desk.unmount()

  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await band.findAll({ type: 'Svg' })).toHaveLength(1)
  await band.unmount()

  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await term.findAll({ type: 'Svg' })).toHaveLength(0)
  expect(await term.find({ type: 'Text', text: /費用/ })).toBeDefined()
  await term.unmount()
})

// Raises one model request of subagent `agentId` that reports `usage`.
const step = async ($: Parameters<TestBody>[0], agentId: string, index: number) => {
  const s = $.turn.step({ turnId: 'turn-1', index, model: 'claude-haiku-4-5', messageCount: 1, agentId })
  for await (const _ of s) void _
  return s.result
}

const STEP_USAGE = {
  model: 'claude-haiku-4-5',
  input_tokens: 2_000,
  output_tokens: 10_000,
  cache_read_input_tokens: 50_000,
  cache_creation_input_tokens: 1_000,
}

test('tokens count only new tokens per step, and context only the request side', async ($, on) => {
  engine(on)
  on('agent.spawn', async () => ({ model: 'claude-haiku-4-5', agentId: 'a1' }))
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'tool_use', usage: STEP_USAGE }
  })
  await $.agent.spawn({ tool_use_id: 't1', prompt: 'x', description: '算 token', subagentType: 'Explore' } as never)
  await step($, 'a1', 0)
  await step($, 'a1', 1)

  // Two steps of 2k input + 1k cache write + 10k output; cache reads are not new tokens.
  for (const surface of SURFACES) {
    const band = await $.ui.mount({ ...BAND, surface })
    expect(await summaryOf(band)).toMatch(/26k tokens/)
    await band.unmount()
  }
  // Context: 2k + 50k + 1k of Haiku's 200k window, output not included.
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: /ctx 27% · 26k/ })).toBeDefined()
  await pane.unmount()
})

const spawnOne = ($: Parameters<TestBody>[0], description = 'x') =>
  $.agent.spawn({ tool_use_id: 't1', prompt: 'x', description, subagentType: 'Explore' } as never)

test('band ticks at most every 5 seconds while a subagent runs', async ($, on) => {
  const clock = engine(on)
  on('agent.spawn', async () => ({ model: 'claude-opus-5-5', agentId: 'a1' }))
  await spawnOne($)

  await clock.advance(4_000)
  for (const surface of SURFACES) {
    const band = await $.ui.mount({ ...BAND, surface })
    expect(await shown(band, /0:00/)).toBeDefined()
    expect(await shown(band, /0:04/)).toBeUndefined()
    await band.unmount()
  }

  await clock.advance(1_000)
  for (const surface of SURFACES) {
    const band = await $.ui.mount({ ...BAND, surface })
    expect(await shown(band, /0:05/)).toBeDefined()
    await band.unmount()
  }
})

test('nothing ticks while the band is dismissed and the pane is closed', async ($, on) => {
  const clock = engine(on)
  on('agent.spawn', async () => ({ model: 'claude-opus-5-5', agentId: 'a1' }))
  await spawnOne($)

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await band.press({ key: 'am-dismiss' })
  await band.unmount()

  await clock.advance(10_000)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: /0:10/ })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: /0:00/ })).toBeDefined()
  await pane.unmount()
})

test('an open pane ticks every second', async ($, on) => {
  const clock = engine(on)
  on('agent.spawn', async () => ({ model: 'claude-opus-5-5', agentId: 'a1' }))
  // The engine reports the pane as open and shown.
  on('ui.panes', async () => ({
    value: [{ id: 'agent-monitor', title: '子代理', isShown: true, isFocused: false, isPlaced: true }],
  }))
  await spawnOne($)

  await clock.advance(1_000)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: /0:01/ })).toBeDefined()
  await pane.unmount()
})

test('band collapses by itself 10 seconds after the last subagent finishes', async ($, on) => {
  const clock = engine(on)
  on('agent.spawn', async () => ({ model: 'claude-opus-5-5', agentId: 'a1' }))
  await spawnOne($)
  await $.turn.complete({
    answer: 'ok',
    durationMs: 10,
    isAborted: false,
    turnId: 'turn-1',
    agentId: 'a1',
    reason: 'answer',
    usage: USAGE,
  })

  await clock.advance(9_000)
  for (const surface of SURFACES) {
    const band = await $.ui.mount({ ...BAND, surface })
    expect(await summaryOf(band)).toMatch(/1 完成/)
    await band.unmount()
  }

  await clock.advance(1_000)
  for (const surface of SURFACES) {
    const band = await $.ui.mount({ ...BAND, surface })
    expect(await band.find({ key: 'am-dismiss' })).toBeUndefined()
    await band.unmount()
  }
})

test('the terminal pane shows what each subagent did last', async ($, on) => {
  engine(on)
  on('agent.spawn', async () => ({ model: 'claude-opus-5-5', agentId: 'a1' }))
  on('tool.call', async () => ({ result: 'done' }))
  await spawnOne($, '讀程式')

  const read = await $.tool.call({ tool: 'Read', file_path: '/repo/hooks/register.tsx', agentId: 'a1' } as never)
  // The call's own result passes through untouched.
  expect((read as { result?: unknown }).result).toBe('done')
  let pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: /Read register\.tsx/ })).toBeDefined()
  await pane.unmount()

  await $.tool.call({ tool: 'Grep', pattern: 'foo', agentId: 'a1' } as never)
  pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: /Grep 'foo'/ })).toBeDefined()
  await pane.unmount()

  await $.tool.call({ tool: 'Bash', command: 'npm run build && npm test -- --watch=false', agentId: 'a1' } as never)
  pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: /Bash npm run build && npm test -- -/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /watch=false/ })).toBeUndefined()
  await pane.unmount()

  // A call on the main loop changes no subagent's line.
  await $.tool.call({ tool: 'Glob', pattern: '**/*.ts' } as never)
  pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: /Glob/ })).toBeUndefined()
  await pane.unmount()
})
