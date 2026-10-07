import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { PLUGIN, SURFACES, stubEngine } from './support'

const PUSHED = '已開支線：w2 確認 next(e) 的行為。\n工作堆疊（由下往上，最後一項是進行中的工作項）：\n- w1 修 typo-picker 重複標出（暫停）'

/** transcript 裡一個工具呼叫的列 */
const mountToolUse = (
  $: Engine,
  surface: (typeof SURFACES)[number],
  props: { tool: string; input?: unknown; output?: unknown; isRunning?: boolean; isErrored?: boolean; isInterrupted?: boolean },
) =>
  $.ui.mount({
    plugin: PLUGIN,
    surface,
    component: 'ToolUse',
    props: {
      tool_use_id: 'toolu_1',
      input: {},
      isRunning: false,
      isErrored: false,
      isInterrupted: false,
      ...props,
    },
  } as never)

for (const surface of SURFACES) {
  test(`工具列：gold-fish 工具成功時縮成一行淡色字（${surface}）`, async ($, on) => {
    stubEngine(on)
    const ui = await mountToolUse($, surface, {
      tool: 'mcp__gold-fish__push_work_item',
      input: { title: '確認 next(e) 的行為' },
      output: PUSHED,
    })
    const texts = await ui.findAll({ type: 'Text' })
    expect(texts.map(node => node.text)).toEqual(['🐟 已開支線：w2 確認 next(e) 的行為。'])
    expect(texts[0]?.props.dimColor).toBe(true)
    await ui.unmount()
  })

  test(`工具列：執行中畫動作和標題或 id（${surface}）`, async ($, on) => {
    stubEngine(on)
    const running = [
      ['push_work_item', { title: '查 Ink 的 wrap 參數' }, '🐟 開工作項：查 Ink 的 wrap 參數…'],
      ['close_work_item', { id: 'w2' }, '🐟 收工作項：w2…'],
      ['close_work_item', {}, '🐟 收工作項：最上層…'],
      ['rename_work_item', { id: 'w1', title: '新標題' }, '🐟 改標題：w1 新標題…'],
      ['remove_work_item', { id: 'w3' }, '🐟 刪除工作項：w3…'],
    ] as const
    for (const [tool, input, line] of running) {
      const ui = await mountToolUse($, surface, { tool: `mcp__gold-fish__${tool}`, input, isRunning: true })
      const texts = await ui.findAll({ type: 'Text' })
      expect(texts.map(node => node.text)).toEqual([line])
      expect(texts[0]?.props.dimColor).toBe(true)
      await ui.unmount()
    }
  })

  // 引擎畫列時，gold-fish 工具回傳的 isError 不一定變成 isErrored。結果只有一行（沒有工作堆疊）就是失敗
  test(`工具列：gold-fish 工具失敗時畫一行紅字（${surface}）`, async ($, on) => {
    stubEngine(on)
    for (const isErrored of [true, false]) {
      const ui = await mountToolUse($, surface, {
        tool: 'mcp__gold-fish__remove_work_item',
        input: { id: 'nope' },
        output: '找不到 id 為 nope 的工作項。',
        isErrored,
      })
      const texts = await ui.findAll({ type: 'Text' })
      expect(texts.map(node => node.text)).toEqual(['🐟 失敗：找不到 id 為 nope 的工作項。'])
      expect(texts[0]?.props.color).toBe('#FF5F5F')
      expect(texts[0]?.props.dimColor).toBeUndefined()
      await ui.unmount()
    }
  })

  test(`工具列：中斷的 gold-fish 工具和其他工具照引擎原本的畫法（${surface}）`, async ($, on) => {
    stubEngine(on)
    const rows = [
      { tool: 'mcp__gold-fish__push_work_item', input: { title: 'x' }, isInterrupted: true },
      { tool: 'Bash', input: { command: 'ls' }, output: 'README.md' },
    ]
    for (const props of rows) {
      const ui = await mountToolUse($, surface, props)
      expect((await ui.findAll({ type: 'Text' })).map(node => node.text)).toEqual(['usage row'])
      await ui.unmount()
    }
  })

  test(`工具結果：gold-fish 工具的結果已經畫在工具列上，不畫；其他工具照引擎原本的畫法（${surface}）`, async ($, on) => {
    stubEngine(on)
    const results = [
      { tool: 'mcp__gold-fish__push_work_item', output: PUSHED, isErrored: false, drawn: [] },
      { tool: 'mcp__gold-fish__remove_work_item', output: '找不到 nope。', isErrored: true, drawn: [] },
      { tool: 'Bash', output: 'README.md', isErrored: false, drawn: ['usage row'] },
    ]
    for (const { drawn, ...props } of results) {
      const ui = await $.ui.mount({
        plugin: PLUGIN,
        surface,
        component: 'ToolResult',
        props: { tool_use_id: 'toolu_1', ...props },
      } as never)
      expect((await ui.findAll({ type: 'Text' })).map(node => node.text)).toEqual(drawn)
      await ui.unmount()
    }
  })
}
