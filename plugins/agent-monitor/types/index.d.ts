export type AgentStatus = 'running' | 'done' | 'failed'

export type AgentRun = {
  id: string
  agentId?: string
  type: string
  description: string
  model: string
  status: AgentStatus
  startedAt: number
  endedAt?: number
  contextTokens: number
  contextMax: number
  tokens: number
  costUsd: number
  steps: number
  /** What the subagent did last, e.g. "Read register.tsx"; absent before its first tool call. */
  activity?: string
}

export type Panel = {
  isDoneCollapsed: boolean
  isBandHidden: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'agent-monitor': {
      agents: AgentRun[]
      panel: Panel
      now: number
    }
  }
}
