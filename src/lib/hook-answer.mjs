// Which tool sent a hook call, and whether what the guard is about to print is something that tool understands. The
// supervisor uses this and nothing else of the kit, so it can still block when the rest of it is broken.

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

export function detectTool(input) {
  if (!isObject(input)) return null
  if (isObject(input.toolCall)) return typeof input.toolCall.name === 'string' ? 'agy' : null
  if (typeof input.tool_name !== 'string' || typeof input.hook_event_name !== 'string') return null
  if (input.turn_id !== undefined) return typeof input.turn_id === 'string' ? 'codex' : null
  return 'claude'
}

const parseObject = (text) => {
  try {
    const parsed = JSON.parse(text)
    return isObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

// Claude and Codex run the command when they cannot read what a hook printed (docs/spike.md S12), and Codex runs it when the hook asks.
const DECISIONS = {
  claude: (answer) => {
    const output = answer.hookSpecificOutput
    return isObject(output) && output.hookEventName === 'PreToolUse' && ['ask', 'deny'].includes(output.permissionDecision) && typeof output.permissionDecisionReason === 'string'
  },
  codex: (answer) => {
    const output = answer.hookSpecificOutput
    return isObject(output) && output.hookEventName === 'PreToolUse' && output.permissionDecision === 'deny' && typeof output.permissionDecisionReason === 'string'
  },
  agy: (answer) => ['force_ask', 'deny'].includes(answer.decision) && typeof answer.reason === 'string',
}

/** Whether `stdout` (silence, or a decision) is what the tool that sent `inputText` understands. An input that is not a call of a known tool accepts nothing. */
export function answerAccepted(inputText, stdout) {
  const tool = detectTool(parseObject(inputText))
  if (tool === null) return false
  if (stdout === '') return true
  const answer = parseObject(stdout)
  return answer !== null && DECISIONS[tool](answer)
}
