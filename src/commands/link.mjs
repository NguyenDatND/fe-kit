import { mkdir } from 'node:fs/promises'
import { UsageError } from '../lib/errors.mjs'
import { defaultLinkMode } from '../lib/fsx.mjs'
import { ConfigProblem } from '../lib/guard-config.mjs'
import { applyPlan, buildPlan, chooseTools, ConfigChangedError, findOnPath, homeOf, lockPath, readState, recover, stateDirOf } from '../lib/install.mjs'
import { withProcessLock } from '../lib/process-lock.mjs'

export const options = { tools: { type: 'string' }, yes: { type: 'boolean' }, copy: { type: 'boolean' }, with: { type: 'string' } }

export const usage = `Usage: fe-kit link [--tools claude,codex,antigravity] [--yes] [--copy] [--json]

Puts the kit's skills and its shell-guard into each tool: the skills as links to ~/Code/fe-kit/skills, and the guard
(ask before commits, pushes and the fe-kit commands that change things; refuse reads of saved logins) into the tool's own
configuration. Without --yes it only says what it would do. Things are only added at the end of your files, a copy is kept
before a file is changed, and "fe-kit unlink" takes out exactly what was added. Running it again changes nothing.
--tools   default: the tools whose folder exists (~/.claude, ~/.codex, ~/.gemini)
--copy    copy the skills instead of linking them (what Windows needs)
Exit code: 0 ok, 1 something stops it (nothing is written then), 2 usage error.
`

class LinkBusyError extends Error {
  constructor(pid) {
    super(`another fe-kit link or unlink is running (pid ${pid})`)
  }
}

/** The next steps that only the person can do. */
const CHECKLIST = {
  codex: 'Codex: open /hooks in Codex and approve the fe-kit hook (Codex asks once).',
}

function describe(plan, home) {
  const show = (text) => text.replaceAll(home, '~')
  const lines = []
  for (const entry of Object.values(plan.tools)) {
    lines.push(entry.label)
    const counts = {}
    for (const skill of entry.skills) counts[skill.action] = (counts[skill.action] ?? 0) + 1
    if (entry.skills.length > 0) lines.push(`  skills (${entry.mode}): ${Object.entries(counts).map(([action, count]) => `${count} ${action}`).join(', ')}`)
    for (const item of entry.files) lines.push(`  ${show(item.file)}: ${item.action}${item.count ? ` (adds ${item.count} item${item.count === 1 ? '' : 's'})` : ''}`)
  }
  return lines
}

export async function run({ flags, env, kitRoot, deps = {} }) {
  const home = homeOf(env)
  const stateDir = stateDirOf(env)
  const show = (text) => text.replaceAll(home, '~')
  if (flags.with !== undefined) {
    throw new UsageError(flags.with === 'rules' ? '--with rules is not available yet: the rules are installed only after you have read and approved them' : `unknown component "${flags.with}"`)
  }
  const node = deps.node ?? (await findOnPath('node', env.PATH))
  if (node === null) throw new UsageError('node is not on the PATH, so the hook cannot be registered with a stable path to it')
  const { tools, skipped } = await chooseTools(flags.tools, home)
  const dryRun = flags.yes !== true
  const mode = flags.copy === true ? 'copy' : defaultLinkMode()

  const outcome = (lines, extra) => {
    const data = { dryRun, tools: {}, skipped, problems: [], recovered: [], backups: [], checklist: [], ...extra }
    const text = `${[...lines.map(show), ...skipped.map(({ tool, reason }) => `${tool === 'claude' ? 'Claude Code' : tool === 'codex' ? 'Codex' : 'Antigravity'}: skipped (${show(reason)})`)].join('\n')}\n`
    return { data, text, exitCode: data.problems.length > 0 ? 1 : 0 }
  }

  const work = async () => {
    if (!dryRun) await readState(stateDir) // a record that cannot be read stops the run before anything is changed
    const recovered = dryRun ? { messages: [], conflicts: [] } : await recover(stateDir)
    const plan = await buildPlan({ kitRoot, home, env, node, tools, mode })
    const problems = plan.problems.map(({ file, message }) => `${show(file)}: ${show(message)}`)
    const notes = recovered.conflicts.map(({ file, message }) => `Note: ${show(file)} ${show(message)}`)
    const data = { tools: Object.fromEntries(Object.entries(plan.tools).map(([tool, entry]) => [tool, { skills: entry.skills.map(({ name, action }) => ({ name, action })), files: entry.files.map(({ file, kind, action }) => ({ file, kind, action })) }])), problems, recovered: recovered.messages }
    if (problems.length > 0) return outcome([...recovered.messages, ...notes, ...describe(plan, home), 'Problems (nothing was changed):', ...problems.map((problem) => `  - ${problem}`)], data)
    const nothing = Object.values(plan.tools).every((entry) => entry.skills.every((skill) => skill.action === 'unchanged') && entry.files.every((item) => item.action === 'unchanged'))
    if (nothing) return outcome([...recovered.messages, ...notes, 'Nothing to change.'], data)
    if (dryRun) return outcome([...describe(plan, home), '', 'Dry run: nothing was changed. Run `fe-kit link --yes` to apply.'], data)
    const { backups } = await applyPlan(plan, { stateDir, kitRoot, node, deps })
    const checklist = tools.filter((tool) => CHECKLIST[tool] !== undefined).map((tool) => CHECKLIST[tool])
    checklist.push('Restart the sessions of the tools that are already open: they read their configuration when they start.')
    return outcome([...recovered.messages, ...notes, ...describe(plan, home), '', `Done. ${backups.length} file${backups.length === 1 ? '' : 's'} backed up in ${show(stateDir)}/backups.`, 'Still yours to do:', ...checklist.map((step) => `  - ${step}`)], { ...data, backups, checklist })
  }

  try {
    if (dryRun) return await work()
    await mkdir(stateDir, { recursive: true, mode: 0o700 })
    return await withProcessLock(lockPath(stateDir), work, (pid) => new LinkBusyError(pid))
  } catch (error) {
    if (!(error instanceof LinkBusyError) && !(error instanceof ConfigChangedError) && !(error instanceof ConfigProblem)) throw error
    const extra = error instanceof ConfigChangedError ? '\nWhat was started is remembered: run the command again when the tool is closed.' : ''
    return { data: { dryRun, problems: [error.message], tools: {}, skipped }, text: `${show(error.message)}${extra}\n`, exitCode: 1 }
  }
}
