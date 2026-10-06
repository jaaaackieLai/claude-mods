import { expect, test } from 'claude-code/testing'
import type { AgentRun } from '../types'
import { agentSvg } from '../hooks/svg'
import type { Fmt } from '../hooks/svg'

const FMT: Fmt = {
  cost: usd => `$${usd.toFixed(2)}`,
  tokens: n => `${n} tok`,
  time: ms => `${Math.round(ms / 1000)}s`,
  model: id => id.replace(/^claude-/, ''),
}

const run = (over: Partial<AgentRun> = {}): AgentRun => ({
  id: 'r1',
  type: 'Explore',
  description: '找檔案',
  model: 'claude-sonnet-4-6',
  status: 'done',
  startedAt: 0,
  endedAt: 5_000,
  contextTokens: 20_000,
  contextMax: 200_000,
  tokens: 1234,
  costUsd: 0.05,
  steps: 3,
  ...over,
})

test('row shows what the subagent did last, escaped', () => {
  const out = agentSvg(480, run({ activity: 'Grep <x>' }), 10, 5_000, FMT)
  expect(out).toContain('Grep &lt;x&gt;')
  expect(out.includes('Grep <x>')).toBe(false)
})

test('row has no activity text before the first tool call', () => {
  const out = agentSvg(480, run(), 10, 5_000, FMT)
  expect(out.includes('class="s act"')).toBe(false)
})

test('row keeps the description and truncates a long one with an ellipsis', () => {
  expect(agentSvg(480, run(), 10, 5_000, FMT)).toContain('找檔案')
  const long = '搜尋'.repeat(100)
  const out = agentSvg(300, run({ description: long }), 10, 5_000, FMT)
  expect(out.includes(long)).toBe(false)
  expect(out).toContain('…')
})
