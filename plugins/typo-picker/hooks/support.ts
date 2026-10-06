import type { PromptEditInput, PromptEditResult } from 'claude-code'
import type { Engine } from 'claude-code/testing'

// Raises prompt.edit as the composer does. The engine takes the call,
// but this build's Engine type leaves `edit` out of `$.prompt`.
export const edit = ($: Engine, e: PromptEditInput) =>
  ($.prompt as unknown as { edit: (e: PromptEditInput) => Promise<PromptEditResult> }).edit(e)
