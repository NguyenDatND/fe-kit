import { mkdir } from 'node:fs/promises'
import { ConfigProblem } from '../lib/guard-config.mjs'
import { applyRemoval, buildRemoval, chooseTools, ConfigChangedError, homeOf, lockPath, readState, recover, stateDirOf } from '../lib/install.mjs'
import { withProcessLock } from '../lib/process-lock.mjs'

export const options = { tools: { type: 'string' }, yes: { type: 'boolean' } }

export const usage = `Usage: fe-kit unlink [--tools claude,codex,antigravity] [--yes] [--json]

Takes out what "fe-kit link" put into the tools: the skills, and exactly the items it added to your configuration files
(an item that you changed since is left and named). A copy of each file is kept before it is changed. Without --yes it only
says what it would do.
Exit code: 0 ok, 1 something was left as it is or stops it, 2 usage error.
`

class UnlinkBusyError extends Error {
  constructor(pid) {
    super(`another fe-kit link or unlink is running (pid ${pid})`)
  }
}

export async function run({ flags, env, deps = {} }) {
  const home = homeOf(env)
  const stateDir = stateDirOf(env)
  const show = (text) => text.replaceAll(home, '~')
  const dryRun = flags.yes !== true
  const selected = flags.tools === undefined ? null : (await chooseTools(flags.tools, home)).tools

  const work = async () => {
    const recovered = dryRun ? { messages: [] } : await recover(stateDir)
    const said = recovered.messages.map((message) => `${message}\n`).join('')
    const state = await readState(stateDir)
    const names = Object.keys(state.tools).filter((tool) => selected === null || selected.includes(tool))
    if (names.length === 0) return { data: { dryRun, tools: {}, kept: [], problems: [] }, text: `${said}fe-kit has not installed anything (there is no record of it for these tools).\n`, exitCode: 0 }
    const removal = await buildRemoval({ state, home, tools: names })
    const problems = removal.problems.map(({ file, message }) => `${show(file)}: ${show(message)}`)
    const data = { dryRun, tools: Object.fromEntries(Object.entries(removal.tools).map(([tool, entry]) => [tool, { skills: entry.skills.map(({ name, action }) => ({ name, action })), files: entry.files.map(({ file, kind, action }) => ({ file, kind, action })) }])), kept: removal.kept, problems }
    const lines = [...recovered.messages]
    for (const entry of Object.values(removal.tools)) {
      lines.push(entry.label)
      const removable = entry.skills.filter((skill) => skill.action === 'removed').length
      lines.push(`  skills: ${removable} to remove`)
      for (const item of entry.files) lines.push(`  ${show(item.file)}: ${item.action}`)
    }
    for (const item of removal.kept) lines.push(`  ${show(item.file)}: ${show(item.message)}`)
    if (problems.length > 0) {
      lines.push('Problems (nothing was changed):', ...problems.map((problem) => `  - ${problem}`))
      return { data, text: `${lines.join('\n')}\n`, exitCode: 1 }
    }
    if (dryRun) lines.push('', 'Dry run: nothing was changed. Run `fe-kit unlink --yes` to apply.')
    else {
      const { backups } = await applyRemoval(removal, { stateDir, deps })
      lines.push('', `Done. ${backups.length} file${backups.length === 1 ? '' : 's'} backed up in ${show(stateDir)}/backups.`)
    }
    return { data, text: `${lines.join('\n')}\n`, exitCode: removal.kept.length > 0 ? 1 : 0 }
  }

  try {
    if (dryRun) return await work()
    await mkdir(stateDir, { recursive: true, mode: 0o700 })
    return await withProcessLock(lockPath(stateDir), work, (pid) => new UnlinkBusyError(pid))
  } catch (error) {
    if (!(error instanceof UnlinkBusyError) && !(error instanceof ConfigChangedError) && !(error instanceof ConfigProblem)) throw error
    return { data: { dryRun, problems: [error.message], tools: {}, kept: [] }, text: `${show(error.message)}\n`, exitCode: 1 }
  }
}
