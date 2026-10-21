import { mkdir, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { collectChanges, unreadableFiles } from '../lib/changes.mjs'
import { draftsAreReady, draftsDir } from '../lib/drafts.mjs'
import { UsageError } from '../lib/errors.mjs'
import { isQuoted, runCommand, shellQuote, succeeded } from '../lib/exec.mjs'
import { lastLines, plural, seconds, shortHash, warningsBlock } from '../lib/format.mjs'
import { lstatOrNull } from '../lib/fsx.mjs'
import { toPosix } from '../lib/glob.mjs'
import { redactCredentials } from '../lib/profile.mjs'
import { resolveProject } from '../lib/project.mjs'
import { isCodeFile, rulesFor, scanLines } from '../lib/scan-rules.mjs'
import { projectTestCommand, runLocalTests } from '../lib/test-runner.mjs'

export const options = { scope: { type: 'string' }, base: { type: 'string' } }

export const usage = `Usage: fe-kit verify [--scope changed|all] [--base <ref>] [--json]

Runs, in this order: scan (rules over the lines this work adds), lint, typecheck, test (the tests of the project) and
local-test (the tests kept in .fe-kit/tests). Every step runs even when an earlier one fails. A step with no command
is skipped and named under "Not verified"; nothing is guessed. The whole output of each step goes to a report under
.fe-kit/reports when .fe-kit is set up (fe-kit init). --scope and --base work as in fe-kit scan.
Exit code: 0 when no step failed and something ran, 1 otherwise, 2 for a usage error.
`

const FILES = '{files}'
const TAIL_LINES = 40
// File names handed to one command. The operating system's limit is far above this, but a repository with thousands
// of files would still reach it, and a lint that dies with "argument list too long" says nothing about the code.
const MAX_ARGUMENT_CHARS = 50_000
const NAME_WIDTH = 'local-test'.length
const LABELS = { pass: 'PASS', fail: 'FAIL', skip: 'SKIP' }

const skip = (name, reason) => ({ name, status: 'skip', reason })

function scanStep(project, changes) {
  if (!changes) return skip('scan', 'not a git repository: there is no diff to scan')
  const findings = scanLines(changes.added, rulesFor(project.settings))
  const unreadable = unreadableFiles(changes.skipped)
  if (changes.added.length === 0 && changes.skipped.length > 0) {
    // Nothing was read: an empty scan is not a clean one.
    return skip('scan', `no line could be scanned, the files were not read: ${changes.skipped.map(({ file, reason }) => `${file} (${reason})`).join(', ')}`)
  }
  return {
    name: 'scan',
    // A file that is there and could not be read may hold what the scan looks for: that is not a pass (a binary or a large file left out on purpose is).
    status: findings.length > 0 || unreadable.length > 0 ? 'fail' : 'pass',
    findings,
    unreadable,
    linesScanned: changes.added.length,
    filesScanned: new Set(changes.added.map(({ file }) => file)).size,
    unread: changes.skipped,
  }
}

/** The changed (or, in the scope all, every) JS and TS files of the package, relative to it: what `{files}` stands for. */
function packageFiles(project, changes) {
  if (!changes) return []
  const prefix = toPosix(relative(project.projectRoot, project.packageRoot))
  const inside = prefix === '' ? changes.files : changes.files.filter((file) => file.startsWith(`${prefix}/`)).map((file) => file.slice(prefix.length + 1))
  return inside.filter(isCodeFile)
}

/** Quoted file names in groups that each fit one command line. */
function batches(files) {
  const groups = []
  let group = []
  let size = 0
  // A name that starts with a dash would be taken for an option by the program that gets it.
  for (const quoted of files.map((file) => shellQuote(file.startsWith('-') ? `./${file}` : file))) {
    if (group.length > 0 && size + quoted.length + 1 > MAX_ARGUMENT_CHARS) {
      groups.push(group)
      group = []
      size = 0
    }
    group.push(quoted)
    size += quoted.length + 1
  }
  if (group.length > 0) groups.push(group)
  return groups
}

/** One step made of one or more runs of a command: it fails when any run did, and shows the first failure. */
function commandResult(name, display, runs) {
  const failure = runs.find((run) => !succeeded(run))
  const shown = failure ?? runs.at(-1)
  const unstarted = runs.find((run) => run.error)
  return {
    name,
    status: failure ? 'fail' : 'pass',
    command: display,
    exitCode: shown.exitCode,
    signal: shown.signal,
    timedOut: runs.some((run) => run.timedOut),
    ...(unstarted ? { error: unstarted.error } : {}),
    durationMs: runs.reduce((total, run) => total + run.durationMs, 0),
    output: runs.map((run) => run.output).join(''),
    omittedBytes: runs.reduce((total, run) => total + run.omittedBytes, 0),
    batches: runs.length,
  }
}

async function commandStep(name, command, { project, files, scope, env, limits }) {
  if (!command) return skip(name, `no ${name} command: add a \`${name}\` script to package.json or \`commands.${name}\` to the profile`)
  const options = { cwd: project.packageRoot, env, ...limits }
  if (!command.includes(FILES)) return commandResult(name, command, [await runCommand(command, options)])
  if (isQuoted(command, FILES)) return skip(name, `${FILES} in the ${name} command is inside quotes: write it bare, because fe-kit quotes each file name itself`)
  if (files.length === 0) return skip(name, `no changed JS or TS files for ${FILES}`)
  const runs = []
  for (const group of batches(files)) runs.push(await runCommand(command.split(FILES).join(group.join(' ')), options))
  const kind = scope === 'all' ? 'file' : 'changed file'
  return commandResult(name, command.split(FILES).join(`<${plural(files.length, kind)}>`), runs)
}

async function projectTestStep(context) {
  const { command, note } = await projectTestCommand(context.project, { env: context.env, ...context.limits })
  const step = await commandStep('test', command, context)
  return note ? { ...step, note } : step
}

async function localTestStep(project, env, limits) {
  try {
    const result = await runLocalTests(project, { env, ...limits })
    if (result.status === 'skipped') return skip('local-test', result.reason)
    return commandResult('local-test', result.command, [result])
  } catch (error) {
    if (error instanceof UsageError) return skip('local-test', error.message) // local tests exist but cannot run here: say so
    throw error
  }
}

const outcome = (step) => {
  if (step.error) return `could not start: ${step.error}`
  if (step.timedOut) return 'timed out'
  return step.signal ? `killed by ${step.signal}` : `exit ${step.exitCode}`
}

function describeChanges(data) {
  if (data.scope === null) return 'Verifying a project that is not a git repository.'
  if (data.scope === 'all') return `Verifying all files git would not ignore: ${plural(data.filesChanged, 'file')}.`
  const base = data.base ? `${data.base.ref} (merge-base ${shortHash(data.base.mergeBase)})` : 'the start of the repository'
  return `Verifying changes since ${base}: ${plural(data.filesChanged, 'file')}, ${plural(data.linesAdded, 'added line')}.`
}

function stepDetail(step) {
  if (step.status === 'skip') return step.reason
  if (step.name === 'scan') {
    if (step.status === 'pass') return `no findings (${plural(step.linesScanned, 'added line')} in ${plural(step.filesScanned, 'file')})`
    const unread = step.unreadable.length > 0 ? `; not read: ${step.unreadable.map(({ file, reason }) => `${file} (${reason})`).join(', ')}` : ''
    return `${plural(step.findings.length, 'finding')}${unread}`
  }
  return step.status === 'pass' ? `${step.command} (${seconds(step.durationMs)})` : `${step.command} (${outcome(step)}, ${seconds(step.durationMs)})`
}

function resultLine(data) {
  const ran = data.steps.some((step) => step.status !== 'skip')
  const verdict = data.failed.length > 0 ? `FAILED (${data.failed.join(', ')})` : ran ? 'PASSED' : 'NOTHING VERIFIED'
  return `Result: ${verdict}${data.skipped.length > 0 ? `. Not verified: ${data.skipped.join(', ')}` : ''}.`
}

function formatText(data) {
  const lines = [describeChanges(data)]
  for (const step of data.steps) {
    lines.push(`${LABELS[step.status]} ${step.name.padEnd(NAME_WIDTH)} ${stepDetail(step)}`)
    if (step.unread?.length > 0) lines.push(`       Not scanned: ${step.unread.map(({ file, reason }) => `${file} (${reason})`).join(', ')}`)
    if (step.status !== 'fail') continue
    for (const finding of step.findings ?? []) lines.push(`       ${finding.file}:${finding.line}: ${finding.rule}: ${finding.message}`, `         ${finding.text.slice(0, 200)}`)
    for (const line of (step.outputTail ?? '').split('\n')) if (line !== '') lines.push(`       ${line}`)
  }
  for (const note of data.notes) lines.push(`Note: ${note}`)
  lines.push(resultLine(data))
  if (data.report) lines.push(`Report: ${data.report}`)
  if (data.warnings.length > 0) lines.push(warningsBlock(data.warnings))
  return `${lines.join('\n')}\n`
}

/** A fence long enough that nothing inside the output can close it. */
function fence(text) {
  let longest = 2
  for (const run of text.matchAll(/`+/g)) longest = Math.max(longest, run[0].length) // a loop: a spread of this many runs overflows the call stack
  return '`'.repeat(longest + 1)
}

function formatReport(data, steps, when) {
  const lines = ['# fe-kit verify', '', `- Project: ${data.projectRoot}`, `- Time: ${when.toISOString()}`, `- ${describeChanges(data)}`, `- ${resultLine(data)}`]
  for (const step of steps) {
    lines.push('', `## ${step.name}: ${LABELS[step.status]}`)
    if (step.status === 'skip') {
      lines.push(step.reason)
    } else if (step.name === 'scan') {
      lines.push(plural(step.findings.length, 'finding'), '')
      for (const { file, reason } of step.unread ?? []) lines.push(`- not scanned: ${file} (${reason})`)
      for (const finding of step.findings) lines.push(`- ${finding.file}:${finding.line} ${finding.rule}: ${finding.message}`, `  \`${finding.text.slice(0, 200).replace(/`/g, "'")}\``)
    } else {
      lines.push(`Command: \`${step.command}\``)
      lines.push(`Exit code: ${step.exitCode ?? 'none'}, ${seconds(step.durationMs)}${step.timedOut ? ' (timed out)' : ''}${step.error ? ` (could not start: ${step.error})` : ''}`)
      if (step.note) lines.push(`Note: ${step.note}`)
      const mark = fence(step.output)
      lines.push('', mark, step.output.trimEnd(), mark)
    }
  }
  return `${lines.join('\n')}\n`
}

/** Writes the report under `.fe-kit/reports`, but only where a file would not show up in git status. */
async function writeReport(project, markdown, when) {
  if (!(await draftsAreReady(project.projectRoot))) {
    return { warning: 'report not written: .fe-kit is not set up here, or is not a real folder, and a file in it could show up in git status; run `fe-kit init`' }
  }
  const reports = join(draftsDir(project.projectRoot), 'reports')
  const existing = await lstatOrNull(reports)
  if (existing && !existing.isDirectory()) return { warning: 'report not written: .fe-kit/reports is not a real folder' }
  const name = `verify-${when.toISOString().replace(/[:.]/g, '-')}.md`
  try {
    await mkdir(reports, { recursive: true })
    await writeFile(join(reports, name), markdown, { flag: 'wx' })
  } catch (error) {
    return { warning: `report not written: ${error.message}` }
  }
  return { path: `.fe-kit/reports/${name}` }
}

/**
 * The checks that say whether work is done: the rules of `scan`, then the lint, the type-check and the tests of the
 * project, then the tests kept in `.fe-kit/tests`. Every step runs, whatever an earlier one found, because a report
 * that stops at the first failure hides the rest. A step that cannot run is skipped, says why, and is named in the
 * result as not verified: nothing is ever guessed, and nothing that did not run counts as passed.
 * `now` and `limits` (timeouts) are seams for tests; the command line does not set them.
 */
export async function run({ flags, cwd, env, kitRoot, now = () => new Date(), limits = {} }) {
  const project = await resolveProject({ cwd, env, kitRoot })
  const profileBase = typeof project.settings.baseBranch === 'string' ? project.settings.baseBranch : undefined
  if (!project.isGit && (flags.scope !== undefined || flags.base !== undefined)) throw new UsageError('not a git repository: --scope and --base need git')
  const changes = project.isGit ? await collectChanges(project.projectRoot, { scope: flags.scope, base: flags.base, profileBase }) : null

  const context = { project, files: packageFiles(project, changes), scope: changes?.scope, env, limits }
  const when = now()
  const steps = [
    scanStep(project, changes),
    await commandStep('lint', project.commands.lint, context),
    await commandStep('typecheck', project.commands.typecheck, context),
    await projectTestStep(context),
    await localTestStep(project, env, limits),
  ]

  const failed = steps.filter((step) => step.status === 'fail').map((step) => step.name)
  const skipped = steps.filter((step) => step.status === 'skip').map((step) => step.name)
  const data = {
    projectRoot: project.projectRoot,
    scope: changes?.scope ?? null,
    base: changes?.base ?? null,
    filesChanged: changes?.files.length ?? null,
    linesAdded: changes?.added.length ?? null,
    steps: [],
    passed: failed.length === 0 && steps.some((step) => step.status !== 'skip'), // nothing that did not run counts as passed
    failed,
    skipped,
    report: null,
    notes: [...(changes?.notes ?? []), ...steps.flatMap((step) => (step.note ? [step.note] : []))],
    warnings: [...project.warnings],
  }

  // Commands print what they like, and a URL in it may carry a password. Redaction comes before anything is shortened
  // (a finding is cut to 200 characters, a password cut in half has no `@` left to be found), and again on what goes out.
  const safe = redactCredentials(steps)
  data.steps = safe.map(({ output, ...rest }) => (output === undefined ? rest : { ...rest, outputTail: lastLines(output, TAIL_LINES) }))
  const written = await writeReport(project, redactCredentials(formatReport(data, safe, when)), when)
  if (written.path) data.report = written.path
  else data.warnings.push(written.warning)

  const printable = redactCredentials(data)
  return { data: printable, text: formatText(printable), exitCode: data.passed ? 0 : 1 }
}
