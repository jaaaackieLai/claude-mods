import { describe, expect, test } from 'claude-code/testing'

import type { WorkItem } from '../types'
import { close, contextText, followReminder, layout, push, remove, rename, textWidth, truncate } from '../hooks/stack'

const MAIN: WorkItem = { id: 'w1', title: '修 typo-picker 重複標出' }
const SIDE: WorkItem = { id: 'w2', title: '確認 next(e) 的行為' }
const DEEP: WorkItem = { id: 'w3', title: '查 Ink 的 wrap 參數' }
const DEEPER: WorkItem = { id: 'w4', title: '看 Ink 原始碼' }

describe('push', () => {
  test('空的工作堆疊放進主線，id 從 w1 開始', async () => {
    const pushed = push([], '修 bug')
    expect(pushed).toEqual({ items: [{ id: 'w1', title: '修 bug' }], id: 'w1', lastId: 1 })
  })

  test('開支線放在最上層，id 比現有的都大', async () => {
    const pushed = push([MAIN, { id: 'w7', title: 'x' }], '新支線')
    expect(pushed.id).toBe('w8')
    expect(pushed.items.map(item => item.id)).toEqual(['w1', 'w7', 'w8'])
  })

  test('收掉的 id 不再重用：新 id 比用過的最大編號大', async () => {
    const pushed = push([MAIN], '新支線', 5)
    expect(pushed.id).toBe('w6')
    expect(pushed.lastId).toBe(6)
  })

  test('標題去掉前後空白', async () => {
    expect(push([], '  修 bug  ').items[0]?.title).toBe('修 bug')
  })
})

describe('close', () => {
  test('收最上層的支線，回到下面的主線', async () => {
    const closed = close([MAIN, SIDE], 'w2')
    expect(closed).toEqual({ items: [MAIN], left: SIDE, returnTo: MAIN })
  })

  test('省略 id 時收最上層', async () => {
    const closed = close([MAIN, SIDE])
    expect('error' in closed ? closed.error : closed.left).toEqual(SIDE)
  })

  test('收中間的支線，會一起移除上面的工作項', async () => {
    const closed = close([MAIN, SIDE, DEEP], 'w2')
    expect(closed).toEqual({ items: [MAIN], left: SIDE, returnTo: MAIN })
  })

  test('收最底層的主線後變空，returnTo 是 undefined', async () => {
    const closed = close([MAIN], 'w1')
    expect(closed).toEqual({ items: [], left: MAIN, returnTo: undefined })
  })

  test('找不到 id 時回傳錯誤訊息，不丟例外', async () => {
    expect(close([MAIN], 'nope')).toHaveProperty('error')
    expect(close([])).toHaveProperty('error')
  })
})

describe('remove 和 rename', () => {
  test('刪除工作項只移除那一項', async () => {
    expect(remove([MAIN, SIDE, DEEP], 'w2')).toEqual({ items: [MAIN, DEEP], removed: SIDE })
    expect(remove([MAIN], 'nope')).toHaveProperty('error')
  })

  test('改標題', async () => {
    expect(rename([MAIN, SIDE], 'w1', ' 新標題 ')).toEqual({
      items: [{ id: 'w1', title: '新標題' }, SIDE],
      item: { id: 'w1', title: '新標題' },
    })
    expect(rename([MAIN], 'nope', 'x')).toHaveProperty('error')
    expect(rename([MAIN], 'w1', '  ')).toHaveProperty('error')
  })
})

describe('followReminder', () => {
  const REMINDER = { id: MAIN.id, returnTo: MAIN.title, left: SIDE.title }

  test('最上層還是提醒的主線時保留提醒', async () => {
    expect(followReminder([MAIN], REMINDER)).toEqual(REMINDER)
    expect(followReminder([MAIN], null)).toBeNull()
  })

  test('主線被刪除、工作堆疊變空或開了新支線時清掉提醒', async () => {
    expect(followReminder([], REMINDER)).toBeNull()
    expect(followReminder([SIDE], REMINDER)).toBeNull()
    expect(followReminder([MAIN, DEEP], REMINDER)).toBeNull()
  })

  test('主線改標題時，提醒跟著改', async () => {
    expect(followReminder([{ id: MAIN.id, title: '新標題' }], REMINDER)).toEqual({ ...REMINDER, returnTo: '新標題' })
  })
})

describe('寬度', () => {
  test('中文字算 2 格，英文算 1 格', async () => {
    expect(textWidth('ab')).toBe(2)
    expect(textWidth('中文')).toBe(4)
    expect(textWidth('修 bug')).toBe(6)
  })

  test('截斷時加上 …，總寬度不超過上限', async () => {
    expect(truncate('修 typo-picker', 6)).toBe('修 ty…')
    expect(textWidth(truncate('中文中文中文', 5))).toBeLessThanOrEqual(5)
    expect(truncate('短', 10)).toBe('短')
  })

  test('寬的符號和 emoji 算 2 格', async () => {
    expect(textWidth('✅')).toBe(2)
    expect(textWidth('⚡')).toBe(2)
    expect(textWidth('⭐')).toBe(2)
    expect(textWidth('🐟')).toBe(2)
    expect(textWidth('›∘…')).toBe(3)
  })
})

describe('layout', () => {
  const labels = (slots: ReturnType<typeof layout>) =>
    slots.map(slot => (slot.kind === 'merged' ? `∘ ${slot.items.length} 項` : slot.label))
  /** 一列格子的總寬度："><> " 4 格、"∘ " 2 格、" › " 3 格 */
  const width = (slots: ReturnType<typeof layout>) =>
    slots.reduce(
      (sum, slot, index) =>
        sum + (index === 0 ? 0 : 3) + (slot.kind === 'merged' ? 0 : slot.isCurrent ? 4 : 2) + textWidth(slot.label),
      0,
    )

  test('空的工作堆疊沒有任何格子', async () => {
    expect(layout([], 80)).toEqual([])
  })

  test('剛好放得下時全部顯示，最上層是目前的工作項', async () => {
    const items = [MAIN, SIDE]
    // "∘ " + 主線 + " › " + "><> " + 支線
    const exact = 2 + textWidth(MAIN.title) + 3 + 4 + textWidth(SIDE.title)
    const slots = layout(items, exact)
    expect(labels(slots)).toEqual([MAIN.title, SIDE.title])
    expect(slots.map(slot => slot.kind === 'item' && slot.isCurrent)).toEqual([false, true])
  })

  test('放不下時保留兩端，中間變成合併項', async () => {
    const items = [MAIN, SIDE, DEEP, DEEPER]
    const slots = layout(items, 2 + textWidth(MAIN.title) + 3 + 6 + 3 + 4 + textWidth(DEEPER.title))
    expect(labels(slots)).toEqual([MAIN.title, '∘ 2 項', DEEPER.title])
    const merged = slots[1]
    expect(merged?.kind === 'merged' && merged.items).toEqual([SIDE, DEEP])
  })

  test('空間夠時，合併項以外盡量多顯示靠近目前的工作項', async () => {
    const items = [MAIN, SIDE, DEEP, DEEPER]
    const full = 2 + textWidth(MAIN.title) + 3 + 2 + textWidth(SIDE.title) + 3 + 2 + textWidth(DEEP.title) + 3 + 4 + textWidth(DEEPER.title)
    const slots = layout(items, full - 1)
    expect(labels(slots)).toEqual([MAIN.title, '∘ 1 項', DEEP.title, DEEPER.title])
  })

  test('只有 2 項時放不下就截斷標題，目前的工作項留得比較長', async () => {
    const slots = layout([MAIN, SIDE], 24)
    const [first, current] = labels(slots)
    expect(first?.endsWith('…')).toBe(true)
    expect(textWidth(first ?? '') + textWidth(current ?? '') + 2 + 3 + 4).toBeLessThanOrEqual(24)
    expect(textWidth(current ?? '')).toBeGreaterThan(textWidth(first ?? ''))
  })

  test('目前的工作項用不完的空間留給主線', async () => {
    const long = { id: 'w1', title: 'a'.repeat(60) }
    const slots = layout([long, { id: 'w2', title: 'x' }], 50)
    expect(labels(slots)[1]).toBe('x')
    expect(width(slots)).toBe(50)
  })

  test('很窄時也不超過寬度，每個工作項至少留 1 格標題', async () => {
    const stacks = [[MAIN], [MAIN, SIDE], [MAIN, SIDE, DEEP], [MAIN, SIDE, DEEP, DEEPER]]
    for (const items of stacks) {
      for (let columns = 0; columns <= 40; columns += 1) {
        const slots = layout(items, columns)
        expect(width(slots)).toBeLessThanOrEqual(columns)
        expect(slots.every(slot => slot.kind === 'merged' || textWidth(slot.label) >= 1)).toBe(true)
      }
    }
  })

  test('太窄時只顯示目前的工作項，連它都放不下時不顯示任何格子', async () => {
    const items = [MAIN, SIDE, DEEP]
    const only = layout(items, 8)
    expect(only.map(slot => slot.kind === 'item' && slot.item.id)).toEqual([DEEP.id])
    expect(layout(items, 4)).toEqual([])
  })

  test('合併項比被合併的工作項寬時，不合併', async () => {
    const short = { id: 'w2', title: 'x' }
    const items = [MAIN, short, SIDE]
    const full = 2 + textWidth(MAIN.title) + 3 + 2 + 1 + 3 + 4 + textWidth(SIDE.title)
    const slots = layout(items, full - 1)
    expect(slots.some(slot => slot.kind === 'merged')).toBe(false)
    expect(labels(slots)[1]).toBe('x')
    expect(width(slots)).toBeLessThanOrEqual(full - 1)
  })

  test('只有 1 項時放不下就截斷標題', async () => {
    const slots = layout([MAIN], 10)
    expect(labels(slots)[0]).toBe(truncate(MAIN.title, 6))
  })

  test('合併以後還放不下，就截斷兩端的標題', async () => {
    const slots = layout([MAIN, SIDE, DEEP], 30)
    const shown = labels(slots)
    expect(shown[1]).toBe('∘ 1 項')
    expect(textWidth(shown.join(''))).toBeLessThanOrEqual(30)
  })
})

describe('contextText', () => {
  test('空的工作堆疊說明是空的，並附上工具規則', async () => {
    const text = contextText([], null)
    expect(text).toContain('工作堆疊是空的')
    expect(text).toContain('push_work_item')
    expect(text).toContain('close_work_item')
    expect(text).toContain('rename_work_item')
    expect(text).toContain('remove_work_item')
  })

  test('列出 id、標題和哪一個是進行中', async () => {
    const text = contextText([MAIN, SIDE], null)
    expect(text).toContain(`w1 ${MAIN.title}（暫停）`)
    expect(text).toContain(`w2 ${SIDE.title}（進行中）`)
    expect(text).not.toContain('剛回到主線')
  })

  test('有回主線提醒時，加一句使用者剛回到主線', async () => {
    const text = contextText([MAIN], { id: MAIN.id, returnTo: MAIN.title, left: SIDE.title })
    expect(text).toContain(`使用者剛回到主線：${MAIN.title}`)
  })
})
