import { codexRulePrefixes, isCoveredByRules } from './guard-rules.mjs'
import { detectTool } from './hook-answer.mjs'
import { decideCommand, decidePath } from './shell-policy.mjs'

// What the three tools send a hook before a tool call, and how each wants the answer. Claude and Codex send
// `hook_event_name`, `tool_name`, `tool_input`, `cwd` (Codex adds `turn_id`); Antigravity sends `toolCall` and no event
// name. Samples of the real input are in tests/fixtures/hooks.

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

export { detectTool }

function requiredString(value, field) {
  if (typeof value !== 'string') throw new Error(`the tool call has no ${field}`)
  return value
}

function optionalString(value, field) {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`the tool call has a ${field} that is not text`)
  return value
}

/** `{ shell: { command, cwd } }`, `{ paths: [{ path, search }] }` or `{}` (nothing this guard looks at). Throws when a field is not what the tool sends. */
export function requestOf(input, tool) {
  if (tool === 'agy') {
    const { name, args } = input.toolCall
    if (name === 'run_command') return { shell: { command: requiredString(args.CommandLine, 'CommandLine'), cwd: optionalString(args.Cwd, 'Cwd') ?? input.workspacePaths?.[0] ?? null } }
    if (name === 'view_file') return { paths: [{ path: requiredString(args.AbsolutePath, 'AbsolutePath'), search: false }], cwd: input.workspacePaths?.[0] ?? null }
    return {}
  }
  if (!isObject(input.tool_input)) throw new Error('the tool call has no tool_input')
  const cwd = optionalString(input.cwd, 'cwd')
  const { tool_name: name, tool_input: fields } = input
  if (name === 'Bash') return { shell: { command: requiredString(fields.command, 'tool_input.command'), cwd } }
  if (tool === 'claude' && name === 'Read') return { paths: [{ path: requiredString(fields.file_path, 'tool_input.file_path'), search: false }], cwd }
  if (tool === 'claude' && (name === 'Grep' || name === 'Glob')) {
    const base = optionalString(fields.path, 'tool_input.path') ?? cwd
    const pattern = name === 'Glob' ? optionalString(fields.pattern, 'tool_input.pattern') : null
    const paths = base === null ? [] : [{ path: base, search: true }]
    if (pattern !== null && (pattern.startsWith('/') || pattern.startsWith('~'))) paths.push({ path: pattern, search: true })
    return { paths, cwd }
  }
  return {}
}

/** `{ decision, reason, covered }` for a request. `covered`: Codex's rules file asks about this command, so the hook does not need to. */
export function decideRequest(tool, request, { kitRoot, env, home }) {
  if (request.shell !== undefined) {
    const { command, cwd } = request.shell
    const outcome = decideCommand(command, { cwd, home, env })
    const covered = tool === 'codex' && outcome.decision === 'ask' && outcome.argv !== null && isCoveredByRules(outcome.argv, codexRulePrefixes(kitRoot))
    return { decision: outcome.decision, reason: outcome.reason, covered }
  }
  for (const { path, search } of request.paths ?? []) {
    const outcome = decidePath(path, { cwd: request.cwd ?? null, home, env }, { search })
    if (outcome.decision === 'deny') return { decision: 'deny', reason: outcome.reason, covered: false }
  }
  return { decision: 'allow', reason: 'nothing here needs approval', covered: false }
}

const claudeStyle = (decision, reason) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision, permissionDecisionReason: reason } })

/** `{ exitCode, stdout }` in the shape `tool` understands. `allow` says nothing, so the tool's own rules go on to apply. */
export function answerFor(tool, { decision, reason, covered = false }) {
  if (!['claude', 'codex', 'agy'].includes(tool)) throw new Error(`unknown tool ${tool}`)
  if (!['allow', 'ask', 'deny'].includes(decision)) throw new Error(`unknown decision ${decision}`)
  const say = (body) => ({ exitCode: 0, stdout: JSON.stringify(body) })
  if (decision === 'allow') return { exitCode: 0, stdout: '' }
  if (tool === 'agy') return say({ decision: decision === 'ask' ? 'force_ask' : 'deny', reason })
  if (tool === 'claude') return say(claudeStyle(decision, reason))
  // Codex runs the command when a hook asks, so it never gets an ask: the rules file asks, or the hook says no.
  if (decision === 'ask' && covered) return { exitCode: 0, stdout: '' }
  return say(claudeStyle('deny', decision === 'ask' ? `${reason}; Codex cannot ask here, so run it yourself in a terminal` : reason))
}
