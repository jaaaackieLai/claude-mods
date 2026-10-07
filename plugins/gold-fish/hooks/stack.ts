// 工作堆疊的純函式。不依賴 $，測試直接呼叫。
// 陣列的第 0 項是最底層的主線，最後一項是目前的工作項。
import type { Reminder, WorkItem } from '../types'

export type Failure = { error: string }

/** 金魚列上的一格：一個工作項，或放不下時合併的中間工作項 */
export type Slot =
  | { kind: 'item'; item: WorkItem; isCurrent: boolean; label: string }
  | { kind: 'merged'; items: WorkItem[]; label: string }

/** 目前的工作項的記號，後面空一格 */
export const CURRENT_MARK = '><>'
/** 暫停的工作項的記號，後面空一格 */
export const PAUSED_MARK = '∘'
/** 工作項之間的分隔，左右各空一格 */
export const SEPARATOR = '›'

const ELLIPSIS = '…'
/** 截斷時，最底層的主線至少留下的寬度 */
const MIN_TITLE = 4

const notFound = (id: string | undefined): Failure => ({
  error: id === undefined ? '工作堆疊是空的。' : `找不到 id 為 ${id} 的工作項。`,
})

const indexOf = (items: readonly WorkItem[], id: string | undefined): number =>
  id === undefined ? items.length - 1 : items.findIndex(item => item.id === id)

/** 用過的最大 id 編號：lastId 和現有的工作項 id（w 後面的數字）取最大 */
export const highestId = (items: readonly WorkItem[], lastId = 0): number =>
  Math.max(lastId, ...items.map(item => Number(/^w(\d+)$/.exec(item.id)?.[1] ?? 0)))

/**
 * 把新的工作項放到最上層。新 id 的編號比 lastId 和現有的 id 都大，
 * 所以收掉或刪除的 id 不會再用，舊的工具結果裡的 id 不會指到別的工作項
 */
export const push = (
  items: readonly WorkItem[],
  title: string,
  lastId = 0,
): { items: WorkItem[]; id: string; lastId: number } => {
  const next = highestId(items, lastId) + 1
  const id = `w${next}`

  return { items: [...items, { id, title: title.trim() }], id, lastId: next }
}

/** 收支線：移除 id 和它上面的工作項。省略 id 時收最上層 */
export const close = (
  items: readonly WorkItem[],
  id?: string,
): { items: WorkItem[]; left: WorkItem; returnTo: WorkItem | undefined } | Failure => {
  const index = indexOf(items, id)
  const left = items[index]
  if (left === undefined) {
    return notFound(id)
  }
  const kept = items.slice(0, index)

  return { items: kept, left, returnTo: kept[kept.length - 1] }
}

/** 刪除工作項：只移除 id 這一項 */
export const remove = (items: readonly WorkItem[], id: string): { items: WorkItem[]; removed: WorkItem } | Failure => {
  const removed = items.find(item => item.id === id)
  if (removed === undefined) {
    return notFound(id)
  }

  return { items: items.filter(item => item !== removed), removed }
}

/** 改標題 */
export const rename = (
  items: readonly WorkItem[],
  id: string,
  title: string,
): { items: WorkItem[]; item: WorkItem } | Failure => {
  const trimmed = title.trim()
  if (trimmed === '') {
    return { error: '標題不可空白。' }
  }
  const found = items.find(item => item.id === id)
  if (found === undefined) {
    return notFound(id)
  }
  const item = { ...found, title: trimmed }

  return { items: items.map(each => (each === found ? item : each)), item }
}

/**
 * 工作堆疊改變後的回主線提醒。最上層不再是提醒的主線時（主線被刪除、工作堆疊變空、
 * 開了新的工作項）回傳 null。主線改標題時，提醒跟著改
 */
export const followReminder = (items: readonly WorkItem[], reminder: Reminder | null): Reminder | null => {
  const top = items[items.length - 1]
  if (reminder === null || top === undefined || top.id !== reminder.id) {
    return null
  }

  return top.title === reminder.returnTo ? reminder : { ...reminder, returnTo: top.title }
}

/**
 * 終端機畫成 2 格的字（Unicode East Asian Width 是 W 或 F）：中日韓文字、全形符號，
 * 和 emoji，包括 ✅ ⚡ ⭐ 這類在 U+1F300 以前的寬符號
 */
const WIDE: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f],
  [0x231a, 0x231b],
  [0x2329, 0x232a],
  [0x23e9, 0x23ec],
  [0x23f0, 0x23f0],
  [0x23f3, 0x23f3],
  [0x25fd, 0x25fe],
  [0x2614, 0x2615],
  [0x2648, 0x2653],
  [0x267f, 0x267f],
  [0x2693, 0x2693],
  [0x26a1, 0x26a1],
  [0x26aa, 0x26ab],
  [0x26bd, 0x26be],
  [0x26c4, 0x26c5],
  [0x26ce, 0x26ce],
  [0x26d4, 0x26d4],
  [0x26ea, 0x26ea],
  [0x26f2, 0x26f3],
  [0x26f5, 0x26f5],
  [0x26fa, 0x26fa],
  [0x26fd, 0x26fd],
  [0x2705, 0x2705],
  [0x270a, 0x270b],
  [0x2728, 0x2728],
  [0x274c, 0x274c],
  [0x274e, 0x274e],
  [0x2753, 0x2755],
  [0x2757, 0x2757],
  [0x2795, 0x2797],
  [0x27b0, 0x27b0],
  [0x27bf, 0x27bf],
  [0x2b1b, 0x2b1c],
  [0x2b50, 0x2b50],
  [0x2b55, 0x2b55],
  [0x2e80, 0x303e],
  [0x3040, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f004, 0x1f004],
  [0x1f0cf, 0x1f0cf],
  [0x1f18e, 0x1f18e],
  [0x1f191, 0x1f19a],
  [0x1f200, 0x1f2ff],
  [0x1f300, 0x1faff],
  [0x20000, 0x3fffd],
]

/** 一個字在終端機佔的格數 */
const charWidth = (code: number): number => (WIDE.some(([low, high]) => code >= low && code <= high) ? 2 : 1)

export const textWidth = (text: string): number => {
  let width = 0
  for (const char of text) {
    width += charWidth(char.codePointAt(0) ?? 0)
  }

  return width
}

/** 截斷到 max 格以內，截掉時結尾放 … */
export const truncate = (text: string, max: number): string => {
  if (textWidth(text) <= max) {
    return text
  }
  let out = ''
  let width = 0
  for (const char of text) {
    const next = charWidth(char.codePointAt(0) ?? 0)
    if (width + next > max - 1) {
      break
    }
    out += char
    width += next
  }

  return out + ELLIPSIS
}

/** 金魚列的 Box 在每個元素之間空的格數（gap）。寬度的計算都用它，register.tsx 畫列時也用它 */
export const GAP = 1

/** 記號的寬度，含後面的 gap */
const MARK_WIDTH = { current: textWidth(CURRENT_MARK) + GAP, paused: textWidth(PAUSED_MARK) + GAP }
/** 分隔的寬度，含左右的 gap */
const SEPARATOR_WIDTH = textWidth(SEPARATOR) + 2 * GAP

const mergedLabel = (count: number) => `${PAUSED_MARK} ${count} 項`

/** 一列格子的總寬度，含記號和分隔 */
const slotsWidth = (slots: readonly Slot[]): number =>
  slots.reduce((sum, slot) => {
    const mark = slot.kind === 'merged' ? 0 : slot.isCurrent ? MARK_WIDTH.current : MARK_WIDTH.paused

    return sum + mark + textWidth(slot.label)
  }, SEPARATOR_WIDTH * Math.max(0, slots.length - 1))

const itemSlot = (item: WorkItem, isCurrent: boolean): Slot => ({ kind: 'item', item, isCurrent, label: item.title })

/** 截斷標題到 max 格。max 至少是 1，所以標題至少留下「…」，按鈕不會變成空白 */
const fit = (slot: Slot, max: number): Slot => (slot.kind === 'item' ? { ...slot, label: truncate(slot.label, max) } : slot)

/**
 * 算金魚列要顯示哪些格子。放不下時保留最底層的主線和目前的工作項，
 * 中間從靠近目前的工作項開始盡量顯示，其餘變成合併項。還是放不下就截斷兩端的標題。
 * 兩端的標題各留 1 格還放不下時，只顯示目前的工作項。連它都放不下時不顯示任何格子。
 */
export const layout = (items: readonly WorkItem[], columns: number): Slot[] => {
  const last = items.length - 1
  const all = items.map((item, index) => itemSlot(item, index === last))
  if (all.length === 0 || slotsWidth(all) <= columns) {
    return all
  }
  const first = all[0]!
  const current = all[last]!

  // shown 是中間要完整顯示的工作項數，從最上層往下算。shown 等於中間的項數時不合併
  const middle = items.slice(1, last)
  const build = (shown: number): Slot[] => {
    const hidden = middle.slice(0, middle.length - shown)
    const visible = all.slice(1 + hidden.length, last)
    const merged: Slot[] = hidden.length > 0 ? [{ kind: 'merged', items: hidden, label: mergedLabel(hidden.length) }] : []

    return [first, ...merged, ...visible, current]
  }
  // 從顯示最多的開始找放得下的。都放不下時，用最窄的去截斷標題：
  // 合併項「∘ 1 項」可能比它取代的短標題寬，這時不合併比較窄
  let slots = all
  for (let shown = middle.length - 1; shown >= 0; shown -= 1) {
    const candidate = build(shown)
    if (slotsWidth(candidate) <= columns) {
      return candidate
    }
    if (slotsWidth(candidate) < slotsWidth(slots)) {
      slots = candidate
    }
  }

  // 截斷兩端的標題：主線最多分到三分之一（至少 MIN_TITLE 格），目前的工作項用不完的空間也給主線
  const ends = slots.length === 1 ? [current] : [first, current]
  const blank = slots.map(slot => (slot.kind === 'item' && ends.includes(slot) ? { ...slot, label: '' } : slot))
  const room = columns - slotsWidth(blank)
  if (room < ends.length) {
    // 兩端的標題各留 1 格都放不下：只顯示目前的工作項
    const alone = columns - MARK_WIDTH.current

    return alone >= 1 ? [fit(current, alone)] : []
  }
  if (slots.length === 1) {
    return [fit(current, room)]
  }
  const share = Math.max(MIN_TITLE, Math.floor(room / 3), room - textWidth(current.label))
  // 至少留 1 格給目前的工作項
  const firstBudget = Math.max(1, Math.min(textWidth(first.label), share, room - 1))

  return [fit(first, firstBudget), ...slots.slice(1, -1), fit(current, room - firstBudget)]
}

const TOOL = 'mcp__gold-fish__'

/** 工作堆疊的文字：id、標題，和哪一個是進行中。工具結果和附給 Claude 的文字共用 */
export const stackText = (items: readonly WorkItem[]): string => {
  if (items.length === 0) {
    return '工作堆疊是空的。'
  }
  const last = items.length - 1

  return [
    '工作堆疊（由下往上，最後一項是進行中的工作項）：',
    ...items.map((item, index) => `- ${item.id} ${item.title}（${index === last ? '進行中' : '暫停'}）`),
  ].join('\n')
}

/** 附給 Claude 的文字：目前的工作堆疊、工具使用規則，和回主線提醒 */
export const contextText = (items: readonly WorkItem[], reminder: Reminder | null): string => {
  const rules = [
    '規則：',
    `- 開始多步驟工作時，呼叫 ${TOOL}push_work_item 建立主線。簡單問答不建立。`,
    `- 話題轉到需要先處理的問題時，呼叫 ${TOOL}push_work_item 開支線。`,
    `- 支線完成或放棄時，呼叫 ${TOOL}close_work_item。`,
    `- 使用者說工作項記錯時，用 ${TOOL}rename_work_item 或 ${TOOL}remove_work_item 修正。`,
    '- 標題用使用者的語言，簡短寫出這件工作要做什麼。',
  ]
  const back = reminder === null ? [] : [`使用者剛回到主線：${reminder.returnTo}（剛離開：${reminder.left}）`]

  return ['[gold-fish]', stackText(items), ...rules, ...back].join('\n')
}

