import { expect, mock, test } from 'claude-code/testing'
import { edit } from './support'

const BAND = {
  plugin: 'typo-picker',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 9 },
    view: {},
  },
} as const

test('typing a typo flags it and the band offers candidates', async ($, on) => {
  // Stands for the plugins beneath (usage-band): one row the band must keep.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="beneath">usage row</Text>
  })
  on('prompt.edit', (_$, e) => {
    const text = e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end)
    return { text, cursor: e.start + e.inputText.length }
  })
  on('ui.status', () => undefined as any)
  const box = await edit($, {
    origin: { kind: 'composer' },
    text: '這因',
    cursor: 2,
    start: 2,
    end: 2,
    inputText: '該',
  })
  expect(box.text).toBe('這因該')
  expect(box.decorations?.length).toBe(1)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface } as any)
    expect(await ui.find({ key: 'c0' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /usage row/ })).toBeDefined()
    await ui.unmount()
  }
})

test('backslash then a digit picks a candidate', async ($, on) => {
  on('prompt.edit', (_$, e) => {
    const text = e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end)
    return { text, cursor: e.start + e.inputText.length }
  })
  on('ui.status', () => undefined as any)
  const box = await edit($, {
    origin: { kind: 'composer' },
    text: '這因該好\\',
    cursor: 5,
    start: 5,
    end: 5,
    inputText: '1',
  })
  expect(box.text).toBe('這應該好')
  expect(box.cursor).toBe(4)
  expect(box.decorations?.length ?? 0).toBe(0)
})

test('the edit row changes both the wrong word and the fix', async ($, on) => {
  mock.env(on, { USERPROFILE: 'C:/home' })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="beneath">usage row</Text>
  })
  const files = new Map<string, string>()
  on('fs.exists', (_$, e) => ({ value: files.has(e.path) }))
  on('fs.read', (_$, e) => ({ value: files.get(e.path) ?? '' }))
  on('fs.write', (_$, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.stat', () => ({ value: { mtimeMs: Math.random() } }) as any)
  on('ui.status', () => ({ value: undefined }) as any)
  on('ui.toast', () => ({ value: undefined }) as any)
  let draft = '是有婦在裡面嗎'
  on('prompt.read', () => ({ value: { text: draft, cursor: draft.length } }))
  on('prompt.edit', (_$, e) => {
    const text = e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end)
    draft = text
    return { text, cursor: e.start + e.inputText.length }
  })

  await $.command.run({ command: 'typo', args: '有婦在 有復在 存在' } as any)
  await edit($, { origin: { kind: 'composer' }, text: '是有婦在裡面', cursor: 6, start: 6, end: 6, inputText: '嗎' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface } as any)
    expect((await ui.find({ key: 'save' }))?.text).toBe('改表')
    await ui.press({ key: 'save' })
    expect(await ui.find({ key: 'wrong' })).toBeDefined()
    await ui.press({ key: 'cancel' })
    await ui.unmount()
  }

  const ui = await $.ui.mount<'desktop', 'AbovePrompt'>({ ...BAND, surface: 'desktop' } as any)
  await ui.press({ key: 'save' })
  await ui.input({ key: 'wrong', text: '婦在', kind: 'change' })
  await ui.input({ key: 'right', text: '附在' })
  expect(await ui.find({ key: 'wrong' })).toBeUndefined()
  await ui.unmount()

  const rules = [...files.values()].join('\n')
  expect(rules).toContain('婦在 附在')
  expect(rules).not.toContain('有婦在')
})

test('/typo alone opens an empty edit row, for a typo nothing caught', async ($, on) => {
  mock.env(on, { USERPROFILE: 'C:/home' })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="beneath">usage row</Text>
  })
  on('fs.exists', () => ({ value: true }))
  on('fs.read', () => ({ value: '' }))
  on('fs.write', () => ({ value: undefined }))
  on('fs.stat', () => ({ value: { mtimeMs: 1 } }) as any)
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))

  await $.command.run({ command: 'typo', args: '' } as any)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' } as any)
  expect(await ui.find({ key: 'wrong' })).toBeDefined()
  expect(await ui.find({ key: 'right' })).toBeDefined()
  // Enter in either field saves; its hint is the one 存, no extra button.
  expect(await ui.findAll({ type: 'Button', text: '存' })).toHaveLength(0)
  await ui.press({ key: 'cancel' })
  expect(await ui.find({ key: 'wrong' })).toBeUndefined()
  await ui.unmount()
})
