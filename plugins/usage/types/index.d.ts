export type LimitWindow = { pct: number; resetsAt?: string }

export type GitInfo = { branch: string; worktree?: string }

export type Usage = {
  model: string
  dir: string
  git?: GitInfo
  /** Input tokens of the last response; undefined before the first one. */
  ctxTokens?: number
  /** The model's full window. */
  ctxWindow: number
  /** Where auto-compaction runs, in tokens; the full window when it is off. */
  compactAt: number
  isCompactOn: boolean
  /** ctxTokens over compactAt, 0 to 100. */
  ctxPct?: number
  h5?: LimitWindow
  d7?: LimitWindow
}

/** The auto-compact threshold as last read, and for which model. */
export type CompactInfo = { model: string; at: number; isOn: boolean }

export type BreakdownRow = { name: string; tokens: number; kind: string }

export type Breakdown = {
  detail: 'summary' | 'full'
  model: string
  total: number
  max: number
  pct: number
  rows: BreakdownRow[]
  memory: { path: string; tokens: number }[]
  mcpTokens: number
  skillsTokens: number
}

declare module 'claude-code' {
  interface PluginState {
    'usage': {
      usage: Usage | null
      now: number
      fired: string[]
      breakdown: Breakdown | null
      isLoading: boolean
      compact: CompactInfo | null
      history: number[]
      /** The main loop's effort as of its last model request; null before one or on a model without effort. */
      effort: string | null
    }
  }
}
