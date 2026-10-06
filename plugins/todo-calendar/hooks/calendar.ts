import type { Task } from '../types'

// 日期一律用 YYYY-MM-DD 字串，計算時轉成 UTC 午夜，避免時區和夏令時間影響加減天數。

const DAY_MS = 24 * 60 * 60 * 1000
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

export const WEEKDAY_NAMES = ['一', '二', '三', '四', '五', '六', '日']

export const isValidDate = (date: string): boolean => {
  const match = DATE_PATTERN.exec(date)
  if (match === null) {
    return false
  }
  const [, year, month, day] = match.map(Number)
  const parsed = new Date(Date.UTC(year!, month! - 1, day!))

  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month! - 1 &&
    parsed.getUTCDate() === day
  )
}

const toUtcMs = (date: string): number => {
  const [year, month, day] = date.split('-').map(Number)

  return Date.UTC(year!, month! - 1, day!)
}

const fromUtcMs = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

export const addDays = (date: string, days: number): string =>
  fromUtcMs(toUtcMs(date) + days * DAY_MS)

/** 星期一為 0，星期日為 6 */
export const weekdayIndex = (date: string): number =>
  (new Date(toUtcMs(date)).getUTCDay() + 6) % 7

export const mondayOf = (date: string): string => addDays(date, -weekdayIndex(date))

/** 某一天所在週，往後或往前 offset 週的七天（週一到週日） */
export const weekDays = (today: string, offset: number): string[] => {
  const monday = addDays(mondayOf(today), offset * 7)

  return Array.from({ length: 7 }, (_, i) => addDays(monday, i))
}

/** 以毫秒時間和時區偏移（分鐘，與 Date#getTimezoneOffset 同號）算出當地日期 */
export const localDate = (nowMs: number, offsetMinutes: number): string =>
  fromUtcMs(nowMs - offsetMinutes * 60 * 1000)

export const isOverdue = (task: Task, today: string): boolean =>
  !task.done && task.date < today

export const tasksOn = (tasks: readonly Task[], date: string): Task[] =>
  tasks.filter(task => task.date === date)

export const tasksBetween = (
  tasks: readonly Task[],
  from?: string,
  to?: string,
): Task[] =>
  tasks
    .filter(task => (from === undefined || task.date >= from) && (to === undefined || task.date <= to))
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))

/** "10/5" 這種短日期 */
export const shortDate = (date: string): string => {
  const [, month, day] = date.split('-').map(Number)

  return `${month}/${day}`
}

/** "2026 年 10/5 至 10/11"，年份取週一那天 */
export const weekLabel = (days: readonly string[]): string =>
  `${days[0]!.slice(0, 4)} 年 ${shortDate(days[0]!)} 至 ${shortDate(days[6]!)}`
