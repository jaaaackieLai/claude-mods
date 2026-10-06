import { expect, test } from 'claude-code/testing'

import { SURFACES, mountPane, seed, start, stored } from './support'

const doneOf = async (id: string) => (await stored(undefined as never)).find(task => task.id === id)?.done

for (const surface of SURFACES) {
  test(`打勾按鈕切換完成（${surface}）`, async ($, on) => {
    await start($, on, seed)
    const ui = await mountPane($, surface)
    expect((await ui.find({ key: 'check-today1' }))?.text).toBe('○')
    await ui.press({ key: 'check-today1' })
    expect(await doneOf('today1')).toBe(true)
    expect((await ui.find({ key: 'check-today1' }))?.text).toBe('✓')
    expect((await ui.find({ type: 'Text', text: /開會/ }))?.props.strikethrough).toBe(true)
    await ui.press({ key: 'check-today1' })
    expect(await doneOf('today1')).toBe(false)
    await ui.unmount()
  })
}

for (const surface of SURFACES) {
  test(`選取任務出現操作列，取消後關閉（${surface}）`, async ($, on) => {
    await start($, on, seed)
    const ui = await mountPane($, surface)
    expect(await ui.find({ key: 'edit' })).toBeUndefined()
    await ui.press({ key: 'pick-today1' })
    expect(await ui.find({ type: 'Text', text: /開會（10\/5 一）/ })).toBeDefined()
    expect(await ui.find({ key: 'edit' })).toBeDefined()
    expect(await ui.find({ key: 'delete' })).toBeDefined()
    await ui.press({ key: 'cancel' })
    expect(await ui.find({ key: 'edit' })).toBeUndefined()
    await ui.unmount()
  })
}

const idsLeft = async () => (await stored(undefined as never)).map(task => task.id)

for (const surface of SURFACES) {
  test(`刪除要再按一次確認，取消就不刪（${surface}）`, async ($, on) => {
    await start($, on, seed)
    const ui = await mountPane($, surface)
    await ui.press({ key: 'pick-today1' })
    await ui.press({ key: 'delete' })
    expect(await idsLeft()).toContain('today1')
    expect(await ui.find({ type: 'Text', text: /刪除「開會」？/ })).toBeDefined()
    await ui.press({ key: 'cancel' })
    expect(await idsLeft()).toContain('today1')
    expect(await ui.find({ key: 'confirm-delete' })).toBeUndefined()

    await ui.press({ key: 'pick-today1' })
    await ui.press({ key: 'delete' })
    await ui.press({ key: 'confirm-delete' })
    expect(await idsLeft()).toEqual(['old1', 'done1'])
    expect(await ui.find({ type: 'Text', text: /開會/ })).toBeUndefined()
    await ui.unmount()
  })
}

const taskOf = async (id: string) => (await stored(undefined as never)).find(task => task.id === id)

for (const surface of SURFACES) {
  test(`編輯名稱和日期後儲存（${surface}）`, async ($, on) => {
    await start($, on, seed)
    const ui = await mountPane($, surface)
    await ui.press({ key: 'pick-today1' })
    await ui.press({ key: 'edit' })
    expect((await ui.find({ key: 'edit-title' }))?.props.value).toBe('開會')
    expect((await ui.find({ key: 'edit-date' }))?.props.value).toBe('2026-10-05')
    await ui.input({ key: 'edit-title', text: '週會', kind: 'change' })
    await ui.input({ key: 'edit-date', text: '2026-10-07', kind: 'change' })
    await ui.press({ key: 'save' })
    expect(await taskOf('today1')).toMatchObject({ title: '週會', date: '2026-10-07', done: false })
    expect(await ui.find({ key: 'edit-title' })).toBeUndefined()
    await ui.unmount()
  })

  test(`在輸入框按 Enter 也會儲存（${surface}）`, async ($, on) => {
    await start($, on, seed)
    const ui = await mountPane($, surface)
    await ui.press({ key: 'pick-today1' })
    await ui.press({ key: 'edit' })
    await ui.input({ key: 'edit-title', text: '站會' })
    expect((await taskOf('today1'))?.title).toBe('站會')
    await ui.unmount()
  })

  test(`日期格式錯誤時顯示提示且不存檔（${surface}）`, async ($, on) => {
    await start($, on, seed)
    const ui = await mountPane($, surface)
    await ui.press({ key: 'pick-today1' })
    await ui.press({ key: 'edit' })
    await ui.input({ key: 'edit-date', text: '10/7', kind: 'change' })
    await ui.press({ key: 'save' })
    expect((await taskOf('today1'))?.date).toBe('2026-10-05')
    expect((await ui.find({ type: 'Text', text: /YYYY-MM-DD/ }))?.props.color).toBe('warning')
    expect(await ui.find({ key: 'edit-title' })).toBeDefined()
    await ui.input({ key: 'edit-title', text: '', kind: 'change' })
    await ui.input({ key: 'edit-date', text: '2026-10-07', kind: 'change' })
    await ui.press({ key: 'save' })
    expect((await taskOf('today1'))?.title).toBe('開會')
    expect(await ui.find({ type: 'Text', text: /名稱不可空白/ })).toBeDefined()
    await ui.unmount()
  })
}

for (const surface of SURFACES) {
  test(`週標題顯示日期範圍和完成數，週末用桌曆配色（${surface}）`, async ($, on) => {
    await start($, on, seed)
    const ui = await mountPane($, surface)
    expect(await ui.find({ type: 'Text', text: '2026 年 10/5 至 10/11' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '共 1 項，完成 0' })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: '六' }))?.props.color).toBe('suggestion')
    expect((await ui.find({ type: 'Text', text: '日' }))?.props.color).toBe('suggestion')
    await ui.press({ key: 'prev' })
    expect(await ui.find({ type: 'Text', text: '2026 年 9/28 至 10/4' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '共 2 項，完成 1' })).toBeDefined()
    await ui.unmount()
  })
}

test('mobile 沒有輸入框：不顯示編輯，但能打勾和刪除', async ($, on) => {
  await start($, on, seed)
  const ui = await mountPane($, 'mobile', 60)
  await ui.press({ key: 'check-today1' })
  expect(await doneOf('today1')).toBe(true)
  await ui.press({ key: 'pick-today1' })
  expect(await ui.find({ key: 'edit' })).toBeUndefined()
  await ui.press({ key: 'delete' })
  await ui.press({ key: 'confirm-delete' })
  expect(await idsLeft()).toEqual(['old1', 'done1'])
  await ui.unmount()
})

for (const surface of SURFACES) {
  test(`日期是一行高的底色標籤，沒有框線，底色跟著標題（${surface}）`, async ($, on) => {
    await start($, on, seed)
    const ui = await mountPane($, surface, 60)
    // 字串是「包含」比對，會先撞到週標題，所以用整串比對的正規式
    const chipOf = (text: string) => ui.find({ type: 'Text', text: new RegExp(`^${text}$`) })
    expect((await chipOf(' 10/6 '))?.props).toMatchObject({ inverse: true, dimColor: true })
    expect((await chipOf(' 10/5 '))?.props).toMatchObject({ inverse: true, color: '#D4A017' })
    expect((await chipOf(' 10/10 '))?.props).toMatchObject({ inverse: true, color: 'suggestion' })
    expect((await chipOf(' 10/11 '))?.props).toMatchObject({ inverse: true, color: 'suggestion' })
    expect(await ui.find({ key: 'date-2026-10-06' })).toBeUndefined()
    await ui.unmount()
  })

  test(`直排時每天之間空一行，週切換按鈕寫「上週」「下週」（${surface}）`, async ($, on) => {
    await start($, on, seed)
    const ui = await mountPane($, surface, 60)
    expect((await ui.find({ key: 'days' }))?.props.gap).toBe(1)
    expect((await ui.find({ key: 'prev' }))?.text).toBe('◀ 上週')
    expect((await ui.find({ key: 'next' }))?.text).toBe('下週 ▶')
    await ui.unmount()
  })
}

for (const surface of SURFACES) {
  test(`看本週時「本週」按鈕用主要色，切到別週就恢復（${surface}）`, async ($, on) => {
    await start($, on, seed)
    const ui = await mountPane($, surface)
    expect((await ui.find({ key: 'this' }))?.props).toMatchObject({ variant: 'primary' })
    expect((await ui.find({ key: 'this' }))?.props.plain).toBeUndefined()
    await ui.press({ key: 'next' })
    expect((await ui.find({ key: 'this' }))?.props.variant).toBeUndefined()
    await ui.press({ key: 'this' })
    expect((await ui.find({ key: 'this' }))?.props.variant).toBe('primary')
    await ui.unmount()
  })
}
