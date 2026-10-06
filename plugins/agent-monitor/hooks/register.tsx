import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { AgentRun } from '../types'
import { agentSvg, BAND_H, bandSvg, colorOf, HEADER_H, headerSvg, ROW_H } from './svg'
import type { Fmt } from './svg'

const agents = atom({ plugin: 'agent-monitor', key: 'agents' } as const, [])
const panel = atom({ plugin: 'agent-monitor', key: 'panel' } as const, {
  isDoneCollapsed: false,
  isBandHidden: false,
})
const now = atom({ plugin: 'agent-monitor', key: 'now' } as const, 0)

const PANE = 'agent-monitor'
const TITLE = '子代理'
const ACCENT = '#8f8cf4'
const STATUS_GLYPH: Record<string, string> = { running: '●', done: '✓', failed: '✗' }
const STATUS_COLOR: Record<string, string> = { running: ACCENT, done: 'green', failed: 'red' }
const STATUS_WORD: Record<string, string> = { running: '執行中', done: '完成', failed: '失敗' }

// USD per million tokens: input, output, cache read, cache write (5-minute TTL).
// The engine reports tokens, not money, so every cost here is an estimate.
const PRICES: [RegExp, [number, number, number, number]][] = [
  [/fable|mythos/, [10, 50, 0.25, 12.5]],
  [/opus-5-5/, [4, 20, 0.2, 5]],
  [/opus/, [5, 25, 0.5, 6.25]],
  [/sonnet/, [2, 10, 0.2, 2.5]],
  [/haiku/, [1, 5, 0.1, 1.25]],
]

type Usage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

const priceOf = (model: string): [number, number, number, number] =>
  PRICES.find(([re]) => re.test(model.toLowerCase()))?.[1] ?? [4, 20, 0.2, 5]

const costOf = (model: string, u: Usage): number => {
  const [i, o, r, w] = priceOf(model)
  return (
    ((u.input_tokens || 0) * i +
      (u.output_tokens || 0) * o +
      (u.cache_read_input_tokens || 0) * r +
      (u.cache_creation_input_tokens || 0) * w) /
    1e6
  )
}

// Tokens the step added: what it sent fresh, wrote to the cache and wrote back.
// Cache reads are the same prefix read again, so counting them each step inflates totals.
const newTokensOf = (u: Usage): number =>
  (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.output_tokens || 0)

// How full the context was: the whole request the model read, cached or not.
const contextOf = (u: Usage): number =>
  (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0)

const windowOf = (model: string): number => (/haiku/i.test(model) ? 200_000 : 1_000_000)

const FAMILIES = new Set(['fable', 'mythos', 'opus', 'sonnet', 'haiku'])

// "claude-opus-5-5[1m]" -> "Opus 5.5"; "claude-haiku-4-5-20251001" -> "Haiku 4.5".
const modelName = (id: string): string => {
  const bare = id.replace(/\[.*\]$/, '')
  const parts = bare.toLowerCase().split('-')
  const at = parts.findIndex(part => FAMILIES.has(part))
  const major = parts[at + 1] ?? ''
  if (at < 0 || !/^\d+$/.test(major)) return bare.replace(/^claude-/, '') || '—'
  const family = parts[at] ?? ''
  const minor = parts[at + 2] ?? ''
  const version = /^\d{1,2}$/.test(minor) ? `${major}.${minor}` : major
  return `${family[0]?.toUpperCase() ?? ''}${family.slice(1)} ${version}`
}

const TOKEN_UNITS: [size: number, suffix: string, digits: number][] = [
  [1e6, 'M', 1],
  [1e3, 'k', 0],
]

const fmtTokens = (n: number): string => {
  const unit = TOKEN_UNITS.find(([size]) => n >= size)
  return unit ? `${(n / unit[0]).toFixed(unit[2])}${unit[1]}` : String(Math.round(n))
}

const fmtCost = (usd: number): string => '$' + usd.toFixed(usd < 10 ? 2 : 1)

const pad2 = (n: number): string => String(n).padStart(2, '0')

// m:ss below an hour, h:mm:ss from there.
const fmtTime = (ms: number): string => {
  const secs = Math.max(0, Math.round(ms / 1000))
  const hours = Math.floor(secs / 3600)
  const mins = Math.floor(secs / 60) % 60
  const rest = pad2(secs % 60)
  return hours > 0 ? `${hours}:${pad2(mins)}:${rest}` : `${mins}:${rest}`
}

const FMT: Fmt = { cost: fmtCost, tokens: fmtTokens, time: fmtTime, model: id => modelName(id) }

const elapsed = (a: AgentRun, at: number): number => (a.endedAt ?? Math.max(at, a.startedAt)) - a.startedAt

const ctxOf = (a: AgentRun): number => (a.contextMax ? Math.min(100, Math.round((a.contextTokens / a.contextMax) * 100)) : 0)

const bar = (pct: number, width: number): string => {
  const filled = Math.round((width * pct) / 100)
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled))
}

const totals = (list: AgentRun[], at: number) => {
  const cost = list.reduce((s, a) => s + a.costUsd, 0)
  const tokens = list.reduce((s, a) => s + a.tokens, 0)
  const start = Math.min(...list.map(a => a.startedAt))
  const end = Math.max(...list.map(a => a.endedAt ?? Math.max(at, a.startedAt)))
  const count = (s: AgentRun['status']) => list.filter(a => a.status === s).length
  return { cost, tokens, time: list.length ? end - start : 0, running: count('running'), done: count('done'), failed: count('failed') }
}

// The band shows totals only, so a 5-second step is enough and spares the whole
// AbovePrompt chain (other mods' bands too) a redraw every second. The open pane
// shows each subagent's own m:ss, so it keeps the 1-second step while it is shown.
const PANE_TICK_MS = 1_000
const BAND_TICK_MS = 5_000
// The band folds away by itself this long after the last subagent finished.
const COLLAPSE_MS = 10_000

const isRunning = (a: AgentRun): boolean => a.status === 'running'

const isPaneShown = async ($: EngineInterface): Promise<boolean> => {
  try {
    return (await $.ui.panes()).some(p => p.id === PANE && p.isShown)
  } catch {
    return false
  }
}

// One ticker at most; it stops by itself once no subagent runs.
let ticker: Timer | undefined

async function tick($: EngineInterface): Promise<void> {
  if (!(await read($, agents)).some(isRunning)) {
    ticker?.cancel()
    ticker = undefined
    return
  }
  const at = await $.clock.now()
  if (!(await isPaneShown($))) {
    if ((await read($, panel)).isBandHidden) return
    if (at - (await read($, now)) < BAND_TICK_MS) return
  }
  await update($, now, () => at)
}

function startTicker($: EngineInterface): void {
  ticker ??= $.clock.every(PANE_TICK_MS, () => void tick($))
}

// A short label for one tool call: the tool, plus its file, pattern or command when it has one.
const ACTIVITY_MAX = 40

const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

const activityOf = (e: { tool: string } & Record<string, unknown>): string => {
  const arg = (key: string): string => (typeof e[key] === 'string' ? (e[key] as string) : '')
  const base = (path: string): string => path.split(/[\\/]/).pop() ?? path
  let detail = ''
  if (['Read', 'Edit', 'Write', 'NotebookEdit'].includes(e.tool)) detail = base(arg('file_path') || arg('notebook_path'))
  else if (e.tool === 'Grep' || e.tool === 'Glob') detail = arg('pattern') && `'${arg('pattern')}'`
  else if (e.tool === 'Bash') detail = arg('command').replace(/\s+/g, ' ').trim().slice(0, 30)
  return clip(detail ? `${e.tool} ${detail}` : e.tool, ACTIVITY_MAX)
}

// Opens the pane, or closes it when it is up; true when it ends up open.
async function togglePane($: EngineInterface): Promise<boolean> {
  const isOpen = (await $.ui.panes()).some(p => p.id === PANE)
  if (isOpen) {
    await $.ui.close({ id: PANE })
    return false
  }
  const at = await $.clock.now()
  await update($, now, () => at)
  await $.ui.open({ id: PANE, title: TITLE })
  return true
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'agent-monitor',
      description: '開關子代理面板：執行中和已完成的子代理，含模型、context、token、估計費用和時間',
    })

    // A reload drops the old ticker; pick the clocks up again for subagents still running.
    if ((await read($, agents)).some(isRunning)) startTicker($)
    return started
  })

  // Notes what each subagent did last; the call itself goes on untouched.
  on('tool.call', async ($, e, next) => {
    const agentId = e.agentId
    if (agentId) {
      const activity = activityOf(e as { tool: string } & Record<string, unknown>)
      const list = await read($, agents)
      if (list.some(a => a.agentId === agentId && a.activity !== activity)) {
        await update($, agents, prev => prev.map(a => (a.agentId === agentId ? { ...a, activity } : a)))
      }
    }
    return next(e)
  })

  on('command.run', { command: 'agent-monitor' }, async $ => {
    const isOpen = await togglePane($)
    return { text: isOpen ? '子代理面板已開啟。' : '子代理面板已關閉。' }
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started.deny !== undefined) return started

    const at = await $.clock.now()
    const run: AgentRun = {
      id: started.agentId ?? e.tool_use_id,
      agentId: started.agentId,
      type: e.subagentType,
      description: e.description,
      model: started.model,
      status: 'running',
      startedAt: at,
      contextTokens: 0,
      contextMax: windowOf(started.model),
      tokens: 0,
      costUsd: 0,
      steps: 0,
    }
    await update($, agents, list => [...list.filter(a => a.id !== run.id), run].slice(-200))
    await update($, now, () => at)
    // A new subagent brings a dismissed band back.
    await update($, panel, p => ({ ...p, isBandHidden: false }))
    startTicker($)
    return started
  })

  // Each model request of a subagent: live context, tokens and cost.
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    const agentId = e.agentId
    const usage = result.usage
    if (!agentId || !usage) return result

    const model = usage.model || e.model
    await update($, agents, list =>
      list.map(a =>
        a.agentId !== agentId
          ? a
          : {
              ...a,
              model,
              contextTokens: contextOf(usage),
              contextMax: windowOf(model),
              tokens: a.tokens + newTokensOf(usage),
              costUsd: a.costUsd + costOf(model, usage),
              steps: a.steps + 1,
            },
      ),
    )
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const agentId = e.agentId
    if (agentId) {
      const at = await $.clock.now()
      await update($, agents, list =>
        list.map(a => {
          if (a.agentId !== agentId) return a
          // A run whose steps went unseen still gets the turn's own sum.
          const usage = a.steps === 0 ? e.usage : undefined
          return {
            ...a,
            status: e.reason === 'answer' ? 'done' : 'failed',
            endedAt: at,
            ...(usage
              ? { model: usage.model || a.model, tokens: newTokensOf(usage), costUsd: costOf(usage.model || a.model, usage) }
              : {}),
          }
        }),
      )
      await update($, now, () => at)
      // Redraw once more when the band's collapse time comes, with no ticker running then.
      if (!(await read($, agents)).some(isRunning)) {
        $.clock.after(COLLAPSE_MS, () => {
          void (async () => {
            const later = await $.clock.now()
            await update($, now, () => later)
          })()
        })
      }
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, agents)
    const p = await read($, panel)
    if (e.props.hasSurvey || list.length === 0 || p.isBandHidden) return next(e)

    const at = Math.max(await read($, now), ...list.map(a => a.startedAt))
    const t = totals(list, at)
    const lastEnd = Math.max(...list.map(a => a.endedAt ?? a.startedAt))
    if (t.running === 0 && at - lastEnd >= COLLAPSE_MS) return next(e)

    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const counts = [`${t.running} 執行中`, `${t.done} 完成`, ...(t.failed ? [`${t.failed} 失敗`] : [])].join(' · ')
    const cost = `≈${fmtCost(t.cost)} · ${fmtTokens(t.tokens)} tokens · ${fmtTime(t.time)}`
    const buttons = [
      <Button key="am-open" label="面板" plain onPress={() => void togglePane($)} />,
      <Button
        key="am-dismiss"
        label="✕"
        plain
        role="dismiss"
        onPress={() => update($, panel, prev => ({ ...prev, isBandHidden: true }))}
      />,
    ]

    let band
    if (e.surface === 'desktop' && 'Svg' in ui) {
      const { Svg } = ui
      // About 8 CSS px per reported column; the rest is the two buttons and their gaps.
      const width = Math.max(180, Math.min(1600, (e.props.bodyColumns || 100) * 8 - 96))
      const summary = `${counts} · ${cost}`
      band = (
        <Box flexDirection="row" alignItems="center" gap={1}>
          <Svg source={bandSvg(width, list, summary)} alt={`${TITLE}：${summary}`} width={width} height={BAND_H} />
          {buttons}
        </Box>
      )
    } else {
      band = (
        <Box flexDirection="row" gap={2}>
          <Text color={t.running ? ACCENT : 'green'}>
            {t.running ? '●' : '✓'} {TITLE}
          </Text>
          <Text wrap="truncate-end">
            {counts} <Text dimColor>· {cost}</Text>
          </Text>
          {buttons}
        </Box>
      )
    }

    // Share the band: whatever the plugins beneath draw (e.g. typo-picker) goes under this row.
    const below = await next(e)
    if (!below) return band
    return (
      <Box flexDirection="column">
        {band}
        {below}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const list = await read($, agents)
    const p = await read($, panel)
    const at = Math.max(await read($, now), ...list.map(a => a.startedAt), 0)
    const t = totals(list, at)

    const running = list.filter(a => a.status === 'running').reverse()
    const finished = list.filter(a => a.status !== 'running').reverse()
    const summary = `費用 ≈${fmtCost(t.cost)}，Tokens ${fmtTokens(t.tokens)}，時間 ${fmtTime(t.time)}`

    const empty = list.length === 0 && <Text dimColor>目前沒有子代理。</Text>
    const runningHead = running.length > 0 && <Text dimColor>執行中 · {running.length}</Text>
    const finishedHead = finished.length > 0 && (
      <Box flexDirection="row" gap={2}>
        <Button
          key="am-done"
          label={`${p.isDoneCollapsed ? '▸' : '▾'} 已完成 · ${finished.length}`}
          plain
          onPress={() => update($, panel, prev => ({ ...prev, isDoneCollapsed: !prev.isDoneCollapsed }))}
        />
        <Button
          key="am-clear"
          label="清除已完成"
          plain
          onPress={() => update($, agents, prev => prev.filter(a => a.status === 'running'))}
        />
      </Box>
    )

    if (e.surface === 'desktop' && 'Svg' in ui) {
      const { Svg } = ui
      const W = Math.max(240, Math.min(900, (e.props.bodyColumns || 40) * 8 - 8))
      const row = (a: AgentRun) => (
        <Svg
          key={a.id}
          source={agentSvg(W, a, ctxOf(a), elapsed(a, at), FMT)}
          alt={`${a.description}：${a.type} · ${modelName(a.model)} · ${STATUS_WORD[a.status]}`}
          width={W}
          height={ROW_H}
        />
      )
      return (
        <Box flexDirection="column">
          <Svg source={headerSvg(W, t, FMT)} alt={summary} width={W} height={HEADER_H} />
          {empty}
          {runningHead}
          {running.map(row)}
          {finishedHead}
          {!p.isDoneCollapsed && finished.map(row)}
        </Box>
      )
    }

    // Terminal: the same content in text rows.
    const barW = Math.max(6, Math.min(24, (e.props.bodyColumns || 40) - 34))
    const stat = (k: string, v: string) => (
      <Text key={k}>
        <Text dimColor>{k} </Text>
        <Text bold>{v}</Text>
      </Text>
    )
    const row = (a: AgentRun) => {
      const ctx = ctxOf(a)
      const color = colorOf(a.model)
      return (
        <Box key={a.id} flexDirection="column" marginBottom={1}>
          <Box flexDirection="row" justifyContent="space-between">
            <Text bold wrap="truncate-end">
              {a.description || a.type}
            </Text>
            <Text color={STATUS_COLOR[a.status]}>{STATUS_GLYPH[a.status]}</Text>
          </Box>
          <Text wrap="truncate-end">
            <Text color={color}>{a.type}</Text>
            <Text dimColor> {modelName(a.model)}</Text>
          </Text>
          {a.activity && (
            <Text dimColor wrap="truncate-end">
              {a.activity}
            </Text>
          )}
          <Text wrap="truncate-end">
            <Text dimColor>
              ctx {ctx}% · {fmtTokens(a.tokens)} ≈{fmtCost(a.costUsd)} {fmtTime(elapsed(a, at))}
            </Text>
          </Text>
          <Text color={color}>{bar(a.status === 'done' ? 100 : ctx, barW)}</Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={3}>
          {stat('費用', `≈${fmtCost(t.cost)}`)}
          {stat('Tokens', fmtTokens(t.tokens))}
          {stat('時間', fmtTime(t.time))}
        </Box>
        <Box flexDirection="column" marginTop={1}>
          {empty}
          {runningHead}
          {running.map(row)}
          {finishedHead}
          {!p.isDoneCollapsed && finished.map(row)}
        </Box>
      </Box>
    )
  })
}
