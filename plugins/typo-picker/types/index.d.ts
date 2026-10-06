export type Finding = {
  start: number
  end: number
  wrong: string
  candidates: string[]
  source: 'table' | 'model'
}

// The rule being edited in the band: what the two fields start with.
// `replaces` is a table rule the save takes the place of.
export type Editing = { wrong: string; right: string; replaces?: string }

declare module 'claude-code' {
  interface PluginState {
    'typo-picker': { findings: Finding[]; editing: Editing | null; status: string }
  }
}
