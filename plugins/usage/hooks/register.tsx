import { atom, read, update } from 'claude-code'
import type {
  ElementConstructor,
  EngineInterface,
  Register,
  RenderChildren,
  SessionMeasureInput,
  SessionUsage,
  TextProps,
} from 'claude-code'

import type { Breakdown, CompactInfo, GitInfo, LimitWindow, Usage } from '../types'

// Usage band above the prompt: model, folder, git branch/worktree, a context
// "forecast" measured against the auto-compact threshold, and the rate limits;
// plus threshold toasts, /limits and a /ctx pane.

const PANE = 'usage-ctx'
// The snapshot goes to <home>/.claude/usage-state.json, the .claude folder
// found in the plugin's own install path (…/.claude/plugins/cache/…).
const stateFileFor = (pluginRoot: string) => {
  const m = /^(.*?[\\/]\.claude)[\\/]/.exec(pluginRoot)
  return m ? `${m[1]}/usage-state.json` : undefined
}
// Only the last two turns are kept: enough for the per-turn delta.
const HISTORY_TURNS = 2

const usageAtom = atom({ plugin: 'usage', key: 'usage' } as const, null)
const nowAtom = atom({ plugin: 'usage', key: 'now' } as const, 0)
const firedAtom = atom({ plugin: 'usage', key: 'fired' } as const, [])
const breakdownAtom = atom({ plugin: 'usage', key: 'breakdown' } as const, null)
const loadingAtom = atom({ plugin: 'usage', key: 'isLoading' } as const, false)
const compactAtom = atom({ plugin: 'usage', key: 'compact' } as const, null)
const historyAtom = atom({ plugin: 'usage', key: 'history' } as const, [])
const effortAtom = atom({ plugin: 'usage', key: 'effort' } as const, null)

// -- colors and the three levels ------------------------------------------------
const C_GREEN = '#3EB859'
const C_YELLOW = '#F1FA8C'
const C_RED = '#FF5555'
const C_ORANGE = '#FFB86C'
const C_BRANCH = '#8BE9FD'

// -- chip palette, tuned for a dark background ------------------------------------
// Each chip is a dim tinted surface (bg), its accent (fg, icons and labels), a
// muted note color (dim), a divider (line) and the meter's empty track.
type Tone = { bg: string; fg: string; dim: string; line: string; track: string }
const T_TEXT = '#E6E6EB'
const TONE_MODEL: Tone = { bg: '#2B2440', fg: '#C3A6FF', dim: '#8C7BB8', line: '#4A3F6B', track: '#3C3358' }
const TONE_DIR: Tone = { bg: '#24262E', fg: '#9AA3B5', dim: '#6B7280', line: '#3A3D48', track: '#353843' }
const TONE_CTX: Tone = { bg: '#1F2A36', fg: '#7CB8E8', dim: '#5F7F9C', line: '#33465A', track: '#2E3E50' }
const TONE_H5: Tone = { bg: '#1C2E24', fg: '#7FD49B', dim: '#5E9A73', line: '#2F4A3A', track: '#2C4436' }
const TONE_D7: Tone = { bg: '#272540', fg: '#A9A2F0', dim: '#7C76B8', line: '#3E3A66', track: '#36335A' }

// A short bar: the used part in the level's color, the rest as the chip's track.
const METER_CELLS = 3
function meter(Text: ElementConstructor<TextProps>, pct: number, tone: Tone) {
  const filled = Math.max(pct > 0 ? 1 : 0, Math.min(METER_CELLS, Math.round((pct / 100) * METER_CELLS)))
  return (
    <Text>
      <Text color={colorOf(pct)}>{'━'.repeat(filled)}</Text>
      <Text color={tone.track}>{'━'.repeat(METER_CELLS - filled)}</Text>
    </Text>
  )
}

// Line icons for surfaces that draw Svg (14px, stroked in the chip's accent); glyphs on the terminal.
type IconName = 'model' | 'folder' | 'gauge' | 'calendar'
const ICON_GLYPH: Record<IconName, string> = {
  model: '✨',
  folder: '📁',
  gauge: '⏳',
  calendar: '📅',
}
const ICON_PATHS: Record<IconName, string> = {
  model: '<path d="M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  gauge: '<path d="M4.5 17a8.5 8.5 0 1 1 15 0"/><path d="M12 13l4-4"/><circle cx="12" cy="13" r="1.2"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
}
const iconSvg = (name: IconName, color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name]}</svg>`

// One set of thresholds for context and both rate limits: green < 50 <= yellow < 80 <= red.
const LEVELS = [50, 80] as const
type Level = 0 | 1 | 2
const levelOf = (p: number): Level => (p >= LEVELS[1] ? 2 : p >= LEVELS[0] ? 1 : 0)
const LEVEL_COLOR = [C_GREEN, C_YELLOW, C_RED] as const
const colorOf = (p: number) => LEVEL_COLOR[levelOf(p)]

// The context forecast, one per level.
const WEATHER = [
  { icon: '🌞', word: '晴' },
  { icon: '☔', word: '陣雨' },
  { icon: '⚡', word: '快壓縮' },
] as const

// -- helpers ------------------------------------------------------------------
function untilStr(resetsAt: string | undefined, nowMs: number, days = false) {
  if (!resetsAt) return ''
  const t = Date.parse(resetsAt)
  if (Number.isNaN(t)) return ''
  const d = Math.max(0, Math.floor((t - nowMs) / 1000))
  if (days && d >= 86400) return `${Math.floor(d / 86400)}d${Math.floor((d % 86400) / 3600)}h`
  if (d >= 3600) return `${Math.floor(d / 3600)}h${String(Math.floor((d % 3600) / 60)).padStart(2, '0')}m`
  if (d >= 60) return `${Math.floor(d / 60)}m`
  return `${d}s`
}

const base = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p

function dirLabel(cwd: string, root: string) {
  const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase()
  if (cwd && root && norm(cwd).startsWith(norm(root))) {
    return cwd.slice(root.length).replace(/^[\\/]+/, '') || base(root)
  }
  return base(cwd || root || '?')
}

// claude-opus-5-5 -> Opus 5.5, claude-haiku-4-5-20251001 -> Haiku 4.5,
// claude-sonnet-5-5[1m] -> Sonnet 5.5 1M; an already readable name keeps its form.
function shortModel(m: string) {
  const isLong = /\[1m\]$/i.test(m)
  const id = m.replace(/\[1m\]$/i, '').replace(/^claude[-\s]+/i, '').replace(/-\d{8}$/, '')
  const suffix = isLong ? ' 1M' : ''
  if (!id.includes('-')) return id.charAt(0).toUpperCase() + id.slice(1) + suffix
  const words: string[] = []
  for (const part of id.split('-')) {
    const prev = words[words.length - 1]
    if (/^\d+$/.test(part) && prev !== undefined && /^[\d.]+$/.test(prev)) {
      words[words.length - 1] = `${prev}.${part}`
    } else {
      words.push(/^\d/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1))
    }
  }
  return words.join(' ') + suffix
}
const fmtTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : String(n))
const gitLabel = (g: GitInfo) => (g.worktree ? `🌿 ${g.branch} · worktree ${g.worktree}` : `🌿 ${g.branch}`)
const pctOf = (tokens: number, of: number) => Math.min(100, Math.round((tokens / Math.max(1, of)) * 100))
const toEpoch = (iso?: string) => {
  const t = iso ? Date.parse(iso) : NaN
  return Number.isNaN(t) ? null : Math.floor(t / 1000)
}

// Branch, and the worktree's folder name when cwd is a linked worktree; undefined outside git.
async function readGit($: EngineInterface, cwd: string): Promise<GitInfo | undefined> {
  try {
    const run = await $.process.run(
      ['git', 'rev-parse', '--path-format=absolute', '--abbrev-ref', 'HEAD', '--show-toplevel', '--git-dir', '--git-common-dir'],
      { cwd, timeoutMs: 3000 },
    )
    if (run.exitCode !== 0) return undefined
    const [ref = '', top = '', gitDir = '', commonDir = ''] = run.stdout.trim().split(/\r?\n/)
    let branch = ref
    if (ref === 'HEAD') {
      const sha = await $.process.run(['git', 'rev-parse', '--short', 'HEAD'], { cwd, timeoutMs: 3000 })
      branch = sha.exitCode === 0 ? `detached@${sha.stdout.trim()}` : 'detached'
    }
    const norm = (x: string) => x.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
    const isWorktree = norm(gitDir) !== norm(commonDir)
    return { branch, worktree: isWorktree ? base(top) : undefined }
  } catch {
    return undefined
  }
}

// The auto-compact threshold, read from a local (free) breakdown estimate and
// cached per model; `force` rereads it after /autocompact changes it.
async function readCompact($: EngineInterface, model: string, window: number, force = false): Promise<CompactInfo> {
  const cached = await read($, compactAtom)
  if (!force && cached && cached.model === model) return cached
  let info: CompactInfo = { model, at: window, isOn: false }
  try {
    const b = (await $.session.usage({ breakdown: 'summary' })).context.breakdown
    if (b) info = { model, at: b.isAutoCompactEnabled && b.autoCompactThreshold ? b.autoCompactThreshold : window, isOn: b.isAutoCompactEnabled }
  } catch {
    // fall back to the full window
  }
  await update($, compactAtom, () => info)
  return info
}

// The effort before the first model request: the config panel's effort row, when it has one.
async function readEffortSetting($: EngineInterface) {
  try {
    const row = (await $.config.list()).find(r => /effort/i.test(r.key))
    if (row && (typeof row.value === 'string' || typeof row.value === 'number') && row.value !== '') {
      await update($, effortAtom, () => String(row.value))
    }
  } catch {
    // shown from the first request instead
  }
}

// Reads every figure the band shows; `measured` is session.measure's input when there is one.
async function refresh($: EngineInterface, measured?: SessionUsage | SessionMeasureInput, forceCompact = false) {
  const figures = measured ?? (await $.session.usage())
  const [model, cwd, root] = await Promise.all([$.session.model(), $.session.cwd(), $.session.root()])
  const compact = await readCompact($, model, figures.context.window, forceCompact)
  const pick = (kind: string): LimitWindow | undefined => {
    const w = figures.rateLimits.find(r => r.kind === kind)
    return w ? { pct: Math.round(w.percentUsed), resetsAt: w.resetsAt } : undefined
  }
  const tokens = figures.context.tokens
  const usage: Usage = {
    model: shortModel(model),
    dir: dirLabel(cwd, root),
    git: await readGit($, cwd),
    ctxTokens: tokens,
    ctxWindow: figures.context.window,
    compactAt: compact.at,
    isCompactOn: compact.isOn,
    ctxPct: tokens === undefined ? undefined : pctOf(tokens, compact.at),
    h5: pick('five_hour'),
    d7: pick('seven_day'),
  }
  await update($, usageAtom, () => usage)
  await update($, nowAtom, () => Date.now())
  return usage
}

// A toast when a figure climbs into yellow or red; a level re-arms once it falls back below.
async function checkThresholds($: EngineInterface, usage: Usage) {
  const checks: [string, string, number | undefined][] = [
    ['ctx', 'Context 距自動壓縮', usage.ctxPct],
    ['h5', '5 小時額度', usage.h5?.pct],
    ['d7', '7 天額度', usage.d7?.pct],
  ]
  const fired = new Set(await read($, firedAtom))
  for (const [id, label, pct] of checks) {
    if (pct === undefined) continue
    for (const level of LEVELS) {
      const key = `${id}:${level}`
      if (pct < level) {
        fired.delete(key)
      } else if (!fired.has(key)) {
        fired.add(key)
        // Only the highest crossed level toasts; lower ones are marked silently.
        if (level === Math.max(...LEVELS.filter(l => pct >= l))) {
          const hint = id === 'ctx' && level === LEVELS[1] ? '，可考慮 /compact' : ''
          $.ui.toast(`${label}已達 ${pct}%${hint}`, { timeoutMs: 8000 })
        }
      }
    }
  }
  await update($, firedAtom, () => [...fired])
}

// Same shape statusline.js wrote, so usage-check.js and schedulers keep working.
async function writeSnapshot($: EngineInterface, usage: Usage) {
  if (!usage.h5 && !usage.d7) return
  const win = (w?: LimitWindow) => ({
    used_percentage: w ? w.pct : null,
    resets_at: toEpoch(w?.resetsAt),
  })
  const state = {
    updated_at: Math.floor(Date.now() / 1000),
    five_hour: win(usage.h5),
    seven_day: win(usage.d7),
  }
  const file = stateFileFor($.plugin.root)
  if (!file) return
  try {
    await $.fs.write(file, JSON.stringify(state, null, 2))
  } catch {
    // never break the band over a failed write
  }
}

async function loadBreakdown($: EngineInterface, detail: 'summary' | 'full') {
  await update($, loadingAtom, () => true)
  try {
    const { context } = await $.session.usage({ breakdown: detail })
    const b = context.breakdown
    if (!b) return
    const result: Breakdown = {
      detail,
      model: shortModel(b.model),
      total: b.totalTokens,
      max: b.isAutoCompactEnabled && b.autoCompactThreshold ? b.autoCompactThreshold : b.rawMaxTokens,
      pct: 0,
      rows: b.categories
        .filter(c => c.kind === 'used')
        .map(c => ({ name: c.name, tokens: c.tokens, kind: c.kind })),
      memory: [...b.memoryFiles]
        .sort((a, z) => z.tokens - a.tokens)
        .slice(0, 5)
        .map(m => ({ path: m.path, tokens: m.tokens })),
      mcpTokens: b.mcpTools.filter(t => t.isLoaded).reduce((s, t) => s + t.tokens, 0),
      skillsTokens: b.skills?.tokens ?? 0,
    }
    result.pct = pctOf(result.total, result.max)
    await update($, breakdownAtom, () => result)
  } finally {
    await update($, loadingAtom, () => false)
  }
}

// -- pie chart for the /ctx pane ------------------------------------------------
// Categorical slots in fixed order (dark-surface steps, validated with dataviz's
// validate_palette.js); the rest of the window up to auto-compaction is gray.
const PIE_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9'] as const
const C_FREE = '#3a3a38'
const PIE_COLS = 24 // 24 columns x 12 rows of half blocks = a 24x24 pixel circle
const MAX_NAMED = PIE_COLORS.length - 1 // the last slot is for 其他

type Slice = { name: string; tokens: number; color: string }

function pieSlices(b: Breakdown): Slice[] {
  const used = [...b.rows].sort((a, z) => z.tokens - a.tokens).filter(r => r.tokens > 0)
  const named = used.length > PIE_COLORS.length ? used.slice(0, MAX_NAMED) : used
  const rest = used.slice(named.length).reduce((s, r) => s + r.tokens, 0)
  const slices: Slice[] = named.map((r, i) => ({ name: r.name, tokens: r.tokens, color: PIE_COLORS[i] ?? C_FREE }))
  if (rest > 0) slices.push({ name: '其他', tokens: rest, color: PIE_COLORS[MAX_NAMED] ?? C_FREE })
  const free = Math.max(0, b.max - b.total)
  if (free > 0) slices.push({ name: '尚可用（到壓縮）', tokens: free, color: C_FREE })
  return slices
}

const DEFAULT_COLOR = 0x01000000
const hexToInt = (hex: string) => parseInt(hex.slice(1), 16)

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
function toBase64(bytes: Uint8Array) {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1] ?? 0
    const c = bytes[i + 2] ?? 0
    const n = (a << 16) | (b << 8) | c
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + (i + 1 < bytes.length ? B64[(n >> 6) & 63]! : '=') + (i + 2 < bytes.length ? B64[n & 63]! : '=')
  }
  return out
}

// A clockwise pie from 12 o'clock; each cell is '▀' with the upper pixel as
// foreground and the lower as background, so pixels come out square.
function pieCells(slices: Slice[], cols: number) {
  const rows = cols / 2
  const total = Math.max(1, slices.reduce((s, x) => s + x.tokens, 0))
  const ends: number[] = []
  let acc = 0
  for (const s of slices) ends.push((acc += s.tokens) / total)
  const colors = slices.map(s => hexToInt(s.color))
  const c = (cols - 1) / 2
  const radius = cols / 2 - 0.5
  const pixel = (x: number, y: number) => {
    const dx = x - c
    const dy = y - c
    if (dx * dx + dy * dy > radius * radius) return DEFAULT_COLOR
    let turn = Math.atan2(dx, -dy) / (2 * Math.PI)
    if (turn < 0) turn += 1
    const i = ends.findIndex(end => turn < end)
    return colors[i === -1 ? colors.length - 1 : i] ?? DEFAULT_COLOR
  }
  const words = new Uint32Array(cols * rows * 3)
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const top = pixel(col, row * 2)
      const bottom = pixel(col, row * 2 + 1)
      const k = (row * cols + col) * 3
      const isBlank = top === DEFAULT_COLOR && bottom === DEFAULT_COLOR
      words[k] = isBlank ? 0x20 : 0x2580
      words[k + 1] = top
      words[k + 2] = bottom
    }
  }
  return toBase64(new Uint8Array(words.buffer))
}

async function openPane($: EngineInterface) {
  await $.ui.open({ id: PANE, title: 'Context 明細', focus: true, closeOnEscape: true })
  void loadBreakdown($, 'summary')
}

function ctxText(usage: Usage) {
  if (usage.ctxPct === undefined) return '尚無資料'
  const w = WEATHER[levelOf(usage.ctxPct)]
  const target = usage.isCompactOn ? '距自動壓縮' : '自動壓縮已關閉，佔視窗'
  return `${w.icon} ${w.word} · ${target} ${usage.ctxPct}%（${fmtTokens(usage.ctxTokens ?? 0)} / ${fmtTokens(usage.compactAt)}）`
}

function limitsText(usage: Usage, effort: string | null, nowMs: number) {
  const line = (label: string, w: LimitWindow | undefined, days: boolean) =>
    w ? `  ${label}：已用 ${w.pct}%，${untilStr(w.resetsAt, nowMs, days) || '?'} 後重置` : `  ${label}：尚無資料`
  return [
    `${usage.model}${effort ? ` (${effort})` : ''} · ${usage.dir}${usage.git ? ` ${gitLabel(usage.git)}` : ''}`,
    `  Context：${ctxText(usage)}`,
    line('5h', usage.h5, false),
    line('7d', usage.d7, true),
  ].join('\n')
}

export const register: Register = on => {
  // -- events -----------------------------------------------------------------
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'limits', description: '顯示 context、5h／7d 額度與重置倒數' })
    await $.command.register({ name: 'ctx', description: '開啟 context 用量明細面板' })
    await refresh($)
    await readEffortSetting($)
    // Keeps the reset countdowns moving between measurements.
    $.clock.every(60_000, () => {
      void update($, nowAtom, () => Date.now())
    })
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const usage = await refresh($, e)
    if (e.changed.includes('context') && usage.ctxTokens !== undefined) {
      const tokens = usage.ctxTokens
      await update($, historyAtom, list => [...list, tokens].slice(-HISTORY_TURNS))
    }
    await checkThresholds($, usage)
    if (e.changed.includes('rateLimits')) await writeSnapshot($, usage)
    return next(e)
  })

  // Each main-loop request carries the effort it is sent with (after /effort or a downgrade).
  // turn.step streams, so the hook is a generator that forwards the stream untouched.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      const effort = e.effort === undefined ? null : String(e.effort)
      if ((await read($, effortAtom)) !== effort) await update($, effortAtom, () => effort)
    }
    return yield* next(e)
  })

  // /autocompact moves the threshold the forecast measures against.
  on('command.run', { command: 'autocompact' }, async ($, e, next) => {
    const ran = await next(e)
    await refresh($, undefined, true)
    return ran
  })

  on('command.run', { command: 'limits' }, async $ => {
    const usage = await refresh($)
    return { text: limitsText(usage, await read($, effortAtom), Date.now()) }
  })

  on('command.run', { command: 'ctx' }, async $ => {
    await openPane($)
    return { text: 'Context 明細面板已開啟（Esc 關閉）。' }
  })

  // -- the band above the prompt ----------------------------------------------
  // Tinted chips that wrap: model + effort | folder + branch | context | 5h | 7d; /ctx opens the pane.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const usage = await read($, usageAtom)
    if (e.props.hasSurvey || usage === null) return next(e)
    const nowMs = await read($, nowAtom)
    const history = await read($, historyAtom)
    const effort = await read($, effortAtom)
    const ui = $.ui.resolve(e)
    const { Box, Text } = ui
    const isNarrow = e.props.bodyColumns < 80
    const hasSvg = e.surface !== 'terminal' && 'Svg' in ui

    // Desktop surfaces draw the line icons; the terminal a glyph in the same color.
    const icon = (name: IconName, color: string) =>
      hasSvg ? (
        <ui.Svg source={iconSvg(name, color)} alt={name} width={14} height={14} />
      ) : (
        <Text color={color}>{ICON_GLYPH[name]}</Text>
      )

    const chip = (key: string, tone: Tone, children: RenderChildren) => (
      <Box key={key} flexDirection="row" alignItems="center" columnGap={1} backgroundColor={tone.bg} paddingX={1}>
        {children}
      </Box>
    )
    const divider = (tone: Tone) => <Text color={tone.line}>│</Text>

    const ctx = usage.ctxPct
    const prev = history.length >= 2 ? history[history.length - 2] : undefined
    const last = history.length >= 1 ? history[history.length - 1] : undefined
    const delta = prev !== undefined && last !== undefined ? last - prev : 0

    const rate = (key: string, name: IconName, tone: Tone, w: LimitWindow | undefined, days: boolean) => {
      if (!w) return chip(key, tone, [icon(name, tone.fg), <Text color={tone.dim}>--</Text>])
      const until = untilStr(w.resetsAt, nowMs, days)
      return chip(key, tone, [
        icon(name, tone.fg),
        !isNarrow && meter(Text, w.pct, tone),
        <Text color={levelOf(w.pct) === 0 ? T_TEXT : colorOf(w.pct)} bold>{w.pct}%</Text>,
        until && divider(tone),
        until && <Text color={T_TEXT}>{until}</Text>,
      ])
    }

    const chips = [
      !isNarrow &&
        chip('model', TONE_MODEL, [
          icon('model', TONE_MODEL.fg),
          <Text color={T_TEXT} bold>{usage.model}</Text>,
          effort && divider(TONE_MODEL),
          effort && <Text color={TONE_MODEL.fg}>{effort}</Text>,
        ]),
      !isNarrow &&
        chip('dir', TONE_DIR, [
          icon('folder', TONE_DIR.fg),
          <Text color={T_TEXT}>{usage.dir}</Text>,
          usage.git && divider(TONE_DIR),
          usage.git && <Text color={C_BRANCH}>🌿 {usage.git.branch}</Text>,
          usage.git?.worktree && <Text color={C_ORANGE}>wt:{usage.git.worktree}</Text>,
        ]),
      ctx === undefined
        ? chip('ctx', TONE_DIR, [<Text color={TONE_DIR.dim}>ctx --</Text>])
        : chip('ctx', TONE_CTX, [
            <Text color={TONE_CTX.fg}>ctx</Text>,
            !isNarrow && meter(Text, ctx, TONE_CTX),
            <Text color={levelOf(ctx) === 0 ? T_TEXT : colorOf(ctx)} bold>{ctx}%</Text>,
            !isNarrow && Math.abs(delta) >= 1000 && (
              <Text color={TONE_CTX.dim}>{delta > 0 ? '▲' : '▼'}{fmtTokens(Math.abs(delta))}</Text>
            ),
          ]),
      rate('h5', 'gauge', TONE_H5, usage.h5, false),
      rate('d7', 'calendar', TONE_D7, usage.d7, true),
    ]

    const band = (
      <Box flexDirection="row" flexWrap="wrap" columnGap={1} rowGap={0} alignItems="center">
        {chips.filter(Boolean)}
      </Box>
    )

    // Share the band: whatever the plugins beneath draw (e.g. typo-picker) goes under the chips.
    const below = await next(e)
    if (!below) return band
    return (
      <Box flexDirection="column">
        {band}
        {below}
      </Box>
    )
  })

  // -- the /ctx pane: a pie of what fills the context, against the auto-compact threshold --
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const b = await read($, breakdownAtom)
    const isLoading = await read($, loadingAtom)

    const buttons = (
      <Box flexDirection="row" gap={1} marginTop={1}>
        <Button key="refresh" label="重新估算" hotkey="r" onPress={() => loadBreakdown($, 'summary')} />
        <Button key="full" label="精確計算" hotkey="f" onPress={() => loadBreakdown($, 'full')} />
        <Button key="close" label="關閉" hotkey="q" onPress={() => $.ui.close({ id: PANE })} />
      </Box>
    )

    if (b === null) {
      return (
        <Box flexDirection="column">
          <Text dimColor>{isLoading ? '計算中…' : '尚無資料'}</Text>
          {buttons}
        </Box>
      )
    }

    const slices = pieSlices(b)
    const legend = (
      <Box flexDirection="column" justifyContent="center">
        {slices.map(s => (
          <Text>
            <Text color={s.color}>■</Text> {s.name.padEnd(18).slice(0, 18)}
            <Text dimColor> {fmtTokens(s.tokens).padStart(6)} {String(pctOf(s.tokens, b.max)).padStart(3)}%</Text>
          </Text>
        ))}
      </Box>
    )

    // The terminal draws a real pie; other surfaces get one 100% stacked bar.
    const chart =
      e.surface === 'terminal' && 'Raster' in ui ? (
        <ui.Raster key="pie" columns={PIE_COLS} rows={PIE_COLS / 2} cells={pieCells(slices, PIE_COLS)} />
      ) : (
        <Text>
          {slices.map(s => (
            <Text color={s.color}>{'█'.repeat(Math.max(s.tokens > 0 ? 1 : 0, Math.round((s.tokens / b.max) * 40)))}</Text>
          ))}
        </Text>
      )

    return (
      <Box flexDirection="column">
        <Text bold>
          已用 {fmtTokens(b.total)} / 自動壓縮 {fmtTokens(b.max)}（<Text color={colorOf(b.pct)}>{b.pct}%</Text>）
          <Text dimColor> {b.detail === 'full' ? '精確' : '估算'}{isLoading ? '，更新中…' : ''}</Text>
        </Text>
        <Box flexDirection="row" gap={3} marginTop={1}>
          {chart}
          {legend}
        </Box>
        <Box flexDirection="column" marginTop={1}>
          {b.memory.length > 0 && <Text dimColor>最大的記憶檔：</Text>}
          {b.memory.map(m => (
            <Text dimColor wrap="truncate-start">
              {'  '}{fmtTokens(m.tokens).padStart(7)} {m.path}
            </Text>
          ))}
        </Box>
        {buttons}
      </Box>
    )
  })
}
