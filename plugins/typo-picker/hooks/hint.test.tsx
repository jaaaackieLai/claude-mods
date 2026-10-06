import { expect, test } from 'claude-code/testing'
import { edit } from './support'

const HINT = {
  plugin: 'typo-picker',
  surface: 'terminal',
  component: 'PromptHint',
  props: { isDraft: false, isWorking: false, hint: 'auto mode on (shift+tab to cycle)' },
} as const

test('the status rides at the end of the hint line, not on its own row', async ($, on) => {
  let tail: string | undefined
  let isStatusSet = false

  // Stands for the engine: records what the plugin hands down.
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    tail = e.props.tail
    const { Text } = $.ui.resolve(e)
    return <Text key="hint">{e.props.hint}</Text>
  })
  on('ui.status', (_$, e) => {
    if (e.text !== undefined) isStatusSet = true
    return undefined as any
  })
  on('prompt.edit', (_$, e) => {
    const text = e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end)
    return { text, cursor: e.start + e.inputText.length }
  })

  await edit($, { origin: { kind: 'composer' }, text: '這因', cursor: 2, start: 2, end: 2, inputText: '該' })

  const ui = await $.ui.mount(HINT as any)
  expect(tail).toMatch(/^typo-picker: 表\d+筆 \| AI 待命$/)
  // No status row of its own any more.
  expect(isStatusSet).toBe(false)
  await ui.unmount()
})
