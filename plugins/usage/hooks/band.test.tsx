import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const props = (bodyColumns: number) => ({
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
})

const HOUR = 3600_000
const FIGURES = {
  context: { tokens: 62_000, window: 200_000 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 25, resetsAt: new Date(3 * HOUR).toISOString() },
    { kind: 'seven_day', percentUsed: 82, resetsAt: new Date(5 * 24 * HOUR).toISOString() },
  ],
}

// The session the plugin reads at start, answered beneath it.
function world(on: On) {
  mock.clock(on)
  const any = on as unknown as (event: string, hook: ($: unknown, e: never) => unknown) => void
  any('session.usage', () => ({ value: FIGURES }))
  any('session.model', () => ({ value: 'claude-opus-5-5' }))
  any('session.cwd', () => ({ value: '/home/me/blog' }))
  any('session.root', () => ({ value: '/home/me/blog' }))
  any('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }))
  any('config.list', () => ({ value: [{ key: 'effortLevel', label: 'Effort', kind: 'choice', value: 'high' }] }))
  any('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  any('command.register', (_$: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  // The band beneath: an empty row, as when no other plugin draws there.
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="beneath" />
  })
}

test('draws model + effort, and limits, no cost, on every surface', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/home/me/blog', surface: 'terminal', isInteractive: true })
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ plugin: 'usage', surface, component: 'AbovePrompt', props: props(120) })
    expect(await ui.find({ type: 'Text', text: 'Opus 5.5' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'high' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\$/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: '82%' })).toBeDefined()
    await ui.unmount()
  }
})

test('narrow terminal drops the model and folder chips', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/home/me/blog', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'usage', surface: 'terminal', component: 'AbovePrompt', props: props(60) })
  expect(await ui.find({ type: 'Text', text: 'Opus 5.5' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '25%' })).toBeDefined()
  await ui.unmount()
})

test('keeps the row a plugin beneath draws (e.g. typo-picker), under the chips', async ($, on) => {
  mock.clock(on)
  const any = on as unknown as (event: string, hook: ($: unknown, e: never) => unknown) => void
  any('session.usage', () => ({ value: FIGURES }))
  any('session.model', () => ({ value: 'claude-opus-5-5' }))
  any('session.cwd', () => ({ value: '/home/me/blog' }))
  any('session.root', () => ({ value: '/home/me/blog' }))
  any('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }))
  any('config.list', () => ({ value: [] }))
  any('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  any('command.register', (_$: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="beneath">typo row</Text>
  })
  await $.session.start({ cwd: '/home/me/blog', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'usage', surface: 'terminal', component: 'AbovePrompt', props: props(120) })
  expect(await ui.find({ type: 'Text', text: '82%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'typo row' })).toBeDefined()
  await ui.unmount()
})
