import { expect, mock, test } from 'claude-code/testing'
import { edit } from './support'

test('a pause asks the model, and its typo reaches the band', async ($, on) => {
  // Stands for the plugins beneath (usage-band): one row the band must keep.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="beneath">usage row</Text>
  })
  const clock = mock.clock(on)
  let draft = '請幫我按裝套件'
  let asked = ''

  on('prompt.edit', (_$, e) => {
    const text = e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end)
    draft = text
    return { text, cursor: e.start + e.inputText.length }
  })
  on('prompt.read', () => ({ value: { text: draft, cursor: draft.length } }))
  on('prompt.fill', (_$, e) => ({ isFilled: true, text: e.text, cursor: e.text.length }))
  on('ui.status', () => ({ value: undefined }) as any)
  on('model.complete', (_$, e) => {
    asked = e.prompt
    return { value: {
      isAnswered: true,
      text: '[{"wrong":"按裝","candidates":["安裝"]}]',
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    } } as any
  })

  await edit($, { origin: { kind: 'composer' }, text: '請幫我按裝套', cursor: 6, start: 6, end: 6, inputText: '件' })
  expect(asked).toBe('')

  await clock.advance(1000)
  expect(asked).toBe('<draft>\n請幫我按裝套件\n</draft>')

  const ui = await $.ui.mount({
    plugin: 'typo-picker',
    surface: 'desktop',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 9 }, view: {} },
  } as any)
  expect((await ui.find({ key: 'c0' }))?.text).toBe('安裝')
  expect(await ui.find({ key: 'save' })).toBeDefined()
  await ui.unmount()
})

test('an English draft that reads like a request is still proofread', async ($, on) => {
  const clock = mock.clock(on)
  let draft = 'resteate mu intent before continuin'

  on('prompt.edit', (_$, e) => {
    const text = e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end)
    draft = text
    return { text, cursor: e.start + e.inputText.length }
  })
  on('prompt.read', () => ({ value: { text: draft, cursor: draft.length } }))
  on('prompt.fill', (_$, e) => ({ isFilled: true, text: e.text, cursor: e.text.length }))
  on('ui.status', () => ({ value: undefined }) as any)
  on('model.complete', () => ({
    value: {
      isAnswered: true,
      text: '```json\n[{"wrong":"resteate","candidates":["restate"]},{"wrong":"mu","candidates":["my"]}]\n```',
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  }) as any)

  await edit($, { origin: { kind: 'composer' }, text: draft, cursor: draft.length, start: draft.length, end: draft.length, inputText: 'g' })
  await clock.advance(1000)

  const box = await edit($, { origin: { kind: 'composer' }, text: draft, cursor: draft.length, start: draft.length, end: draft.length, inputText: ' ' })
  expect(box.decorations?.length).toBe(2)
})

test('a reply that corrects itself is read from its last array', async ($, on) => {
  const clock = mock.clock(on)
  let draft = '變樹名稱取得不'

  on('prompt.edit', (_$, e) => {
    const text = e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end)
    draft = text
    return { text, cursor: e.start + e.inputText.length }
  })
  on('prompt.read', () => ({ value: { text: draft, cursor: draft.length } }))
  on('prompt.fill', (_$, e) => ({ isFilled: true, text: e.text, cursor: e.text.length }))
  on('ui.status', () => ({ value: undefined }) as any)
  on('model.complete', () => ({
    value: {
      isAnswered: true,
      // A real reply from claude-sonnet-5-5 at effort low.
      text: '[{"wrong":"變樹","candidates":["變數"]},{"wrong":"取得不好","candidates":["取得不好"]}]\n\nCorrection: the second item is not a typo, so the reply should be only:\n\n[{"wrong":"變樹","candidates":["變數"]}]',
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  }) as any)

  await edit($, { origin: { kind: 'composer' }, text: draft, cursor: draft.length, start: draft.length, end: draft.length, inputText: '好' })
  await clock.advance(1000)

  const box = await edit($, { origin: { kind: 'composer' }, text: draft, cursor: draft.length, start: draft.length, end: draft.length, inputText: ' ' })
  expect(box.decorations?.length).toBe(1)
})
