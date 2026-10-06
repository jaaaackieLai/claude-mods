import { describe, expect, test } from 'claude-code/testing'

import type { Task } from '../types'
import {
  addDays,
  isOverdue,
  isValidDate,
  localDate,
  mondayOf,
  weekDays,
} from '../hooks/calendar'

const task = (over: Partial<Task>): Task => ({
  id: 'x',
  title: 't',
  date: '2026-10-05',
  done: false,
  createdAt: '2026-10-01T00:00:00.000Z',
  ...over,
})

describe('日期計算', () => {
  test('一週從週一開始，週日算同一週', async () => {
    expect(mondayOf('2026-10-05')).toBe('2026-10-05')
    expect(mondayOf('2026-10-11')).toBe('2026-10-05')
    expect(mondayOf('2026-10-07')).toBe('2026-10-05')
  })

  test('跨月：2026-10-01 所在週從 9/28 開始', async () => {
    expect(weekDays('2026-10-01', 0)).toEqual([
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
    ])
  })

  test('跨年：2026-12-31 所在週橫跨 2027', async () => {
    const days = weekDays('2026-12-31', 0)
    expect(days[0]).toBe('2026-12-28')
    expect(days[6]).toBe('2027-01-03')
  })

  test('切換週的 offset', async () => {
    expect(weekDays('2026-10-05', -1)[0]).toBe('2026-09-28')
    expect(weekDays('2026-10-05', 1)[0]).toBe('2026-10-12')
    expect(weekDays('2026-10-05', 13)[0]).toBe('2027-01-04')
  })

  test('閏年與月底', async () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(isValidDate('2028-02-29')).toBe(true)
    expect(isValidDate('2027-02-29')).toBe(false)
    expect(isValidDate('2026-13-01')).toBe(false)
    expect(isValidDate('2026/10/05')).toBe(false)
  })

  test('當地日期依時區偏移換算', async () => {
    const utcLate = Date.UTC(2026, 9, 4, 17, 0) // UTC 10/4 17:00 = 台北 10/5 01:00
    expect(localDate(utcLate, -480)).toBe('2026-10-05')
    expect(localDate(utcLate, 0)).toBe('2026-10-04')
  })
})

describe('過期判斷', () => {
  test('昨天未完成算過期，今天和已完成不算', async () => {
    expect(isOverdue(task({ date: '2026-10-04' }), '2026-10-05')).toBe(true)
    expect(isOverdue(task({ date: '2026-09-30' }), '2026-10-05')).toBe(true)
    expect(isOverdue(task({ date: '2026-10-05' }), '2026-10-05')).toBe(false)
    expect(isOverdue(task({ date: '2026-10-04', done: true }), '2026-10-05')).toBe(false)
  })

})
