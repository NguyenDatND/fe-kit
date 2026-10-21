import { collectChanges, unreadableFiles } from '../lib/changes.mjs'
import { plural, shortHash, warningsBlock } from '../lib/format.mjs'
import { redactCredentials } from '../lib/profile.mjs'
import { resolveProject } from '../lib/project.mjs'
import { rulesFor, scanLines } from '../lib/scan-rules.mjs'

export const options = { scope: { type: 'string' }, base: { type: 'string' } }

export const usage = `Usage: fe-kit scan [--scope changed|all] [--base <ref>] [--json]

Rule checks on the lines this work adds: an explicit any, dangerouslySetInnerHTML, eval, innerHTML assignment, a focused
or skipped test, console.log, a conflict marker, a mention of .fe-kit, and the scan rules of the project profile.
By default it looks at what changed since the branch left its base branch (--base picks another one), uncommitted and
untracked files included; --scope all looks at every line of every file git would not ignore.
Exit code: 0 no findings, 1 findings, or nothing could be scanned, or a file could not be read; 2 usage error.
`

function describeScope({ scope, base }) {
  if (scope === 'all') return 'all files git would not ignore'
  return base ? `changes since ${base.ref} (merge-base ${shortHash(base.mergeBase)})` : 'changes in a repository without commits'
}

function formatScan(data) {
  const files = new Set(data.findings.map(({ file }) => file)).size
  const lines = [`Scanning ${describeScope(data)}: ${plural(data.linesScanned, 'added line')} in ${plural(data.filesScanned, 'file')}.`]
  for (const note of data.notes) lines.push(`Note: ${note}`)
  for (const finding of data.findings) {
    lines.push(`${finding.file}:${finding.line}: ${finding.rule}: ${finding.message}`, `    ${finding.text.slice(0, 200)}`)
  }
  const listed = (entries) => entries.map(({ file, reason }) => `${file} (${reason})`).join(', ')
  const unread = unreadableFiles(data.skipped)
  if (data.findings.length > 0) lines.push(`${plural(data.findings.length, 'finding')} in ${plural(files, 'file')}.`)
  else if (data.linesScanned === 0 && data.skipped.length > 0) lines.push(`Nothing was scanned: ${listed(data.skipped)}`)
  else lines.push(`No findings (${plural(data.linesScanned, 'added line')} in ${plural(data.filesScanned, 'file')}).`)
  if (unread.length > 0) lines.push(`Could not read: ${listed(unread)}`)
  else if (data.skipped.length > 0 && data.linesScanned > 0) lines.push(`Not scanned: ${listed(data.skipped)}`)
  if (data.warnings.length > 0) lines.push(warningsBlock(data.warnings))
  return `${lines.join('\n')}\n`
}

/**
 * Rule checks on the lines this work adds. Mechanical mistakes belong to a script, not to a sentence in a prompt: a
 * focused test or a leftover `console.log` is found the same way every time. See scan-rules.mjs for what is checked.
 */
export async function run({ flags, cwd, env, kitRoot }) {
  const project = await resolveProject({ cwd, env, kitRoot })
  const profileBase = typeof project.settings.baseBranch === 'string' ? project.settings.baseBranch : undefined
  const changes = await collectChanges(project.projectRoot, { scope: flags.scope, base: flags.base, profileBase })
  const findings = scanLines(changes.added, rulesFor(project.settings))

  const data = {
    projectRoot: project.projectRoot,
    scope: changes.scope,
    base: changes.base,
    filesScanned: new Set(changes.added.map(({ file }) => file)).size,
    linesScanned: changes.added.length,
    findings,
    skipped: changes.skipped,
    notes: changes.notes,
    warnings: project.warnings,
  }
  // The scanned lines are quoted back, and a line may hold a URL with a password: same single exit as `context`.
  const printable = redactCredentials(data)
  // A scan that read nothing, or could not read a file, has not shown that the code is clean.
  const unverified = unreadableFiles(changes.skipped).length > 0 || (changes.added.length === 0 && changes.skipped.length > 0)
  return { data: printable, text: formatScan(printable), exitCode: findings.length > 0 || unverified ? 1 : 0 }
}
