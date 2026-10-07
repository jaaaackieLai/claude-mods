import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { DEEP, DEEPER, MAIN, SIDE, SURFACES, call, mountBand, stackPath, start, stored, writeStack, stubEngine } from './support'

/** 使用者在輸入列送出一則訊息，回傳附給 Claude 的 context */
const submit = async ($: Engine, text = '好') => {
  const ran = await $.prompt.submit({ text, origin: { kind: 'composer' }, wait: false } as never)

  return (ran.context ?? []).join('\n')
}

const texts = async (ui: Awaited<ReturnType<typeof mountBand>>) =>
  (await ui.findAll({ type: 'Text' })).map(node => node.text).join(' ')

test('檔案和工作堆疊：session.start 讀檔，每次變更後寫檔', async ($, on) => {
  const world = await start($, on, [MAIN])
  const pushed = await call($, 'push_work_item', { title: SIDE.title })
  expect(pushed.isError).toBeUndefined()
  expect(String(pushed.result)).toContain('已開支線：w2')
  expect(String(pushed.result)).toContain(`w1 ${MAIN.title}（暫停）`)
  expect(stored(world)).toEqual([MAIN, SIDE])
})

test('檔案不存在時用空的工作堆疊，第一個工作項是主線', async ($, on) => {
  const world = await start($, on)
  const pushed = await call($, 'push_work_item', { title: MAIN.title })
  expect(String(pushed.result)).toContain('已建立主線：w1')
  expect(stored(world)).toEqual([MAIN])
})

test('內容損壞時顯示空的工作堆疊並記錄到 debug log，不寫檔蓋掉它', async ($, on) => {
  const world = stubEngine(on)
  world.files.set(stackPath(), '{壞掉')
  await $.session.start({ cwd: '', surface: 'terminal', isInteractive: true })
  expect(world.debug.join('\n')).toContain('無法解析')
  const pushed = await call($, 'push_work_item', { title: 'x' })
  expect(pushed.isError).toBe(true)
  expect(String(pushed.result)).toContain('無法解析')
  expect(world.files.get(stackPath())).toBe('{壞掉')
  expect(await submit($)).toContain('無法解析')
})

test('有工作項的 id 或標題不是字串時視為無法解析，不寫檔丟掉它', async ($, on) => {
  const world = stubEngine(on)
  const broken = JSON.stringify({ version: 1, items: [MAIN, { id: 2, title: SIDE.title }], lastId: 2 })
  world.files.set(stackPath(), broken)
  await $.session.start({ cwd: '', surface: 'terminal', isInteractive: true })
  expect(world.debug.join('\n')).toContain('無法解析')
  expect((await call($, 'push_work_item', { title: 'x' })).isError).toBe(true)
  expect(world.files.get(stackPath())).toBe(broken)
})

test('工具：收支線、改標題、刪除工作項，找不到 id 時回傳錯誤', async ($, on) => {
  const world = await start($, on, [MAIN, SIDE, DEEP])
  expect((await call($, 'rename_work_item', { id: 'w3', title: '新標題' })).isError).toBeUndefined()
  expect(stored(world)[2]?.title).toBe('新標題')
  expect((await call($, 'remove_work_item', { id: 'w3' })).isError).toBeUndefined()
  expect(stored(world)).toEqual([MAIN, SIDE])
  const closed = await call($, 'close_work_item', {})
  expect(String(closed.result)).toContain(`回到主線：${MAIN.title}`)
  expect(stored(world)).toEqual([MAIN])
  expect((await call($, 'close_work_item', { id: 'nope' })).isError).toBe(true)
  expect((await call($, 'remove_work_item', { id: 'nope' })).isError).toBe(true)
  expect((await call($, 'push_work_item', { title: ' ' })).isError).toBe(true)
})

test('prompt.submit 附上工作堆疊和規則', async ($, on) => {
  await start($, on, [MAIN, SIDE])
  const context = await submit($)
  expect(context).toContain(`w2 ${SIDE.title}（進行中）`)
  expect(context).toContain('push_work_item')
  expect(context).not.toContain('剛回到主線')
})

test('收支線後顯示回主線提醒和灰字建議，使用者送出下一則訊息後消失', async ($, on) => {
  const world = await start($, on, [MAIN, SIDE])
  await call($, 'close_work_item', { id: 'w2' })
  expect(world.suggested).toContain(`繼續${MAIN.title}`)

  for (const surface of SURFACES) {
    const ui = await mountBand($, surface)
    expect(await ui.find({ type: 'Text', text: /回到主線/ })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /剛離開/ }))?.text).toBe(`（剛離開：${SIDE.title}）`)
    expect((await ui.find({ key: 'item-w1' }))?.text).toBe(MAIN.title)
    await ui.unmount()
  }

  // 回合結束後再建議一次，因為回合中輸入列不顯示建議
  world.suggested.length = 0
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  expect(world.suggested).toEqual([`繼續${MAIN.title}`])

  // 引擎自己的建議換成回主線的建議
  const engine = await $.prompt.suggest({ text: '跑測試', origin: { kind: 'suggestion' } } as never)
  expect(engine.isShown).toBe(true)
  expect(world.suggested.at(-1)).toBe(`繼續${MAIN.title}`)

  const context = await submit($)
  expect(context).toContain(`使用者剛回到主線：${MAIN.title}`)
  const ui = await mountBand($, 'terminal')
  expect(await ui.find({ type: 'Text', text: /回到主線/ })).toBeUndefined()
  await ui.unmount()
  expect(await submit($)).not.toContain('剛回到主線')
})

test('不是使用者送出的訊息不附回主線提醒，也不清掉它', async ($, on) => {
  await start($, on, [MAIN, SIDE])
  await call($, 'close_work_item', { id: 'w2' })
  for (const kind of ['task-notification', 'scheduled-trigger', 'peer']) {
    const ran = await $.prompt.submit({ text: '通知', origin: { kind }, wait: false } as never)
    const context = (ran.context ?? []).join('\n')
    expect(context).toContain(`w1 ${MAIN.title}（進行中）`)
    expect(context).not.toContain('剛回到主線')
  }
  expect(await submit($)).toContain(`使用者剛回到主線：${MAIN.title}`)
})

test('收最底層的主線後，工作堆疊變空，金魚列隱藏，不顯示回主線提醒', async ($, on) => {
  const world = await start($, on, [MAIN])
  await call($, 'close_work_item', {})
  expect(stored(world)).toEqual([])
  expect(world.suggested).toEqual([])
  for (const surface of SURFACES) {
    const ui = await mountBand($, surface)
    expect(await ui.find({ type: 'Text', text: /usage row/ })).toBeDefined()
    expect(await ui.find({ key: 'gold-fish' })).toBeUndefined()
    await ui.unmount()
  }
})

for (const surface of SURFACES) {
  test(`金魚列：空的時候只畫下層的列（${surface}）`, async ($, on) => {
      await start($, on)
    const ui = await mountBand($, surface)
    expect(await ui.find({ key: 'gold-fish' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /usage row/ })).toBeDefined()
    await ui.unmount()
  })

  test(`金魚列：1 項時標出主線，沒有吃掉 beneath 的列（${surface}）`, async ($, on) => {
      await start($, on, [MAIN])
    const ui = await mountBand($, surface)
    expect((await ui.find({ type: 'Text', text: /^><>$/ }))?.text).toBe('><>')
    expect((await ui.find({ type: 'Text', text: /^><>$/ }))?.props.color).toBe('#FF8C1A')
    expect((await ui.find({ key: 'item-w1' }))?.text).toBe(MAIN.title)
    expect(await ui.find({ type: 'Text', text: /usage row/ })).toBeDefined()
    await ui.unmount()
  })

  test(`金魚列：多項時暫停的工作項用 ∘ 和 dim（${surface}）`, async ($, on) => {
      await start($, on, [MAIN, SIDE])
    const ui = await mountBand($, surface)
    expect((await ui.find({ type: 'Text', text: /^∘$/ }))?.text).toBe('∘')
    expect((await ui.find({ key: 'item-w1' }))?.props.dimColor).toBe(true)
    expect((await ui.findAll({ type: 'Text', text: /^><>$/ })).length).toBe(1)
    expect(await texts(ui)).toContain('›')
    expect(await ui.find({ type: 'Text', text: /usage row/ })).toBeDefined()
    await ui.unmount()
  })

  test(`金魚列：放不下時中間變成合併項（${surface}）`, async ($, on) => {
    await start($, on, [MAIN, SIDE, DEEP, DEEPER])
    const ui = await mountBand($, surface, 50)
    expect((await ui.find({ key: 'merged' }))?.text).toBe('∘ 2 項')
    expect(await ui.find({ key: 'item-w1' })).toBeDefined()
    expect(await ui.find({ key: 'item-w4' })).toBeDefined()
    expect(await ui.find({ key: 'item-w2' })).toBeUndefined()
    await ui.unmount()
  })
}

test('選單：收支線', async ($, on) => {
  const world = await start($, on, [MAIN, SIDE])
  world.answers.push('收支線')
  const ui = await mountBand($, 'desktop')
  await ui.press({ key: 'item-w2' })
  expect(world.asked[0]?.options).toEqual(['收支線', '改標題', '刪除'])
  expect(stored(world)).toEqual([MAIN])
  expect(await ui.find({ type: 'Text', text: /回到主線/ })).toBeDefined()
  expect(world.suggested).toContain(`繼續${MAIN.title}`)
  await ui.unmount()
})

test('選單：改標題，選「保留原標題」或關掉對話框時不變', async ($, on) => {
  const world = await start($, on, [MAIN])
  const ui = await mountBand($, 'terminal')
  world.answers.push('改標題', '新的主線')
  await ui.press({ key: 'item-w1' })
  expect(stored(world)[0]?.title).toBe('新的主線')
  expect((await ui.find({ key: 'item-w1' }))?.text).toBe('新的主線')

  world.answers.push('改標題', '保留原標題')
  await ui.press({ key: 'item-w1' })
  world.answers.push('改標題', undefined)
  await ui.press({ key: 'item-w1' })
  world.answers.push(undefined)
  await ui.press({ key: 'item-w1' })
  expect(stored(world)[0]?.title).toBe('新的主線')
  await ui.unmount()
})

test('選單：刪除工作項，不顯示回主線提醒', async ($, on) => {
  const world = await start($, on, [MAIN, SIDE])
  world.answers.push('刪除')
  const ui = await mountBand($, 'desktop')
  await ui.press({ key: 'item-w2' })
  expect(stored(world)).toEqual([MAIN])
  expect(await ui.find({ type: 'Text', text: /回到主線/ })).toBeUndefined()
  expect(world.suggested).toEqual([])
  await ui.unmount()
})

test('選單：點合併項列出裡面的工作項，選一個後再跳出選單', async ($, on) => {
  const world = await start($, on, [MAIN, SIDE, DEEP, DEEPER])
  world.answers.push(DEEP.title, '刪除')
  const ui = await mountBand($, 'terminal', 50)
  await ui.press({ key: 'merged' })
  expect(world.asked[0]?.options).toEqual([SIDE.title, DEEP.title])
  expect(stored(world)).toEqual([MAIN, SIDE, DEEPER])
  await ui.unmount()
})

test('選單：合併項超過 4 項時分頁', async ($, on) => {
  const many = Array.from({ length: 7 }, (_, index) => ({ id: `w${index + 1}`, title: `工作項第 ${index + 1} 件` }))
  const world = await start($, on, many)
  world.answers.push('更多…', '工作項第 6 件', '收支線')
  const ui = await mountBand($, 'terminal', 40)
  await ui.press({ key: 'merged' })
  expect(world.asked[0]?.options).toEqual(['工作項第 2 件', '工作項第 3 件', '工作項第 4 件', '更多…'])
  expect(world.asked[1]?.options).toEqual(['工作項第 5 件', '工作項第 6 件'])
  expect(stored(world).map(item => item.id)).toEqual(['w1', 'w2', 'w3', 'w4', 'w5'])
  await ui.unmount()
})

test('--resume 後讀回同一個 session 的工作堆疊', async ($, on) => {
  const world = stubEngine(on)
  writeStack(world, [MAIN, SIDE])
  await $.session.start({ cwd: '', surface: 'terminal', isInteractive: true })
  expect(await submit($)).toContain(`w1 ${MAIN.title}（暫停）`)
})

const END = { cwd: '', resume: { id: 'sess-1' }, sessionId: 'sess-1' }
const COMPLETE = { answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' }

test('/clear 後換成新 session 的空工作堆疊，舊 session 的檔案不變', async ($, on) => {
  const world = await start($, on, [MAIN, SIDE])
  await call($, 'close_work_item', { id: 'w2' })
  world.session = 'sess-2'
  await $.session.end({ ...END, reason: 'clear' } as never)
  const ui = await mountBand($, 'terminal')
  expect(await ui.find({ key: 'gold-fish' })).toBeUndefined()
  await ui.unmount()
  const context = await submit($)
  expect(context).toContain('工作堆疊是空的')
  expect(context).not.toContain('剛回到主線')
  await call($, 'push_work_item', { title: DEEP.title })
  expect(stored(world, 'sess-2')).toEqual([{ id: 'w1', title: DEEP.title }])
  expect(stored(world)).toEqual([MAIN])
})

test('在同一個程序裡 resume 後，讀回那個 session 的工作堆疊，不蓋掉它', async ($, on) => {
  const world = await start($, on, [MAIN, SIDE])
  writeStack(world, [DEEP], 'sess-2')
  world.session = 'sess-2'
  await $.session.end({ ...END, reason: 'resume' } as never)
  expect(await submit($)).toContain(`${DEEP.id} ${DEEP.title}（進行中）`)
  await call($, 'push_work_item', { title: DEEPER.title })
  expect(stored(world, 'sess-2')).toEqual([DEEP, DEEPER])
  expect(stored(world)).toEqual([MAIN, SIDE])
})

test('在同一個程序裡 resume 後，不用送出訊息，金魚列就顯示那個 session 的工作堆疊', async ($, on) => {
  const world = await start($, on, [MAIN, SIDE])
  writeStack(world, [DEEP], 'sess-2')
  world.session = 'sess-2'
  await $.session.end({ ...END, reason: 'resume' } as never)
  await $.classic.SessionStart({ source: 'resume', session_id: 'sess-2' })
  for (const surface of SURFACES) {
    const ui = await mountBand($, surface)
    expect((await ui.find({ key: 'item-w3' }))?.text).toBe(DEEP.title)
    expect(await ui.find({ key: 'item-w1' })).toBeUndefined()
    await ui.unmount()
  }
})

test('同時改工作堆疊時，兩個變更都留下', async ($, on) => {
  const world = await start($, on, [MAIN, SIDE])
  await Promise.all([
    call($, 'push_work_item', { title: DEEP.title }),
    call($, 'rename_work_item', { id: 'w1', title: '新主線' }),
  ])
  expect(stored(world)).toEqual([{ id: 'w1', title: '新主線' }, SIDE, DEEP])
})

test('收掉的 id 不再重用', async ($, on) => {
  const world = await start($, on, [MAIN, SIDE])
  await call($, 'close_work_item', { id: 'w2' })
  expect(String((await call($, 'push_work_item', { title: DEEP.title })).result)).toContain('已開支線：w3')
  expect(stored(world).map(item => item.id)).toEqual(['w1', 'w3'])
})

test('刪除提醒的主線後，回主線提醒消失', async ($, on) => {
  const world = await start($, on, [MAIN, SIDE])
  await call($, 'close_work_item', { id: 'w2' })
  await call($, 'remove_work_item', { id: 'w1' })
  world.suggested.length = 0
  await $.turn.complete(COMPLETE as never)
  expect(world.suggested).toEqual([])
  expect(await submit($)).not.toContain('剛回到主線')
})

test('提醒的主線改標題後，回主線提醒跟著改', async ($, on) => {
  const world = await start($, on, [MAIN, SIDE])
  await call($, 'close_work_item', { id: 'w2' })
  await call($, 'rename_work_item', { id: 'w1', title: '新主線' })
  world.suggested.length = 0
  await $.turn.complete(COMPLETE as never)
  expect(world.suggested).toEqual(['繼續新主線'])
})

test('選單：合併項裡標題相同時，選項加上 id 區分', async ($, on) => {
  const twinA = { id: 'w2', title: '同名' }
  const twinB = { id: 'w3', title: '同名' }
  const world = await start($, on, [MAIN, twinA, twinB, DEEPER])
  world.answers.push('同名（w3）', '刪除')
  const ui = await mountBand($, 'terminal', 40)
  await ui.press({ key: 'merged' })
  expect(world.asked[0]?.options).toEqual(['同名（w2）', '同名（w3）'])
  expect(stored(world)).toEqual([MAIN, twinA, DEEPER])
  await ui.unmount()
})
