import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { plural } from './format.mjs'

const SHOWN = 10

const subject = (data) => `${data.target}${data.role === null ? '' : ` as ${data.role}`}`
const loginCommand = (data) => `fe-kit auth login --target ${data.target} --role ${data.role}`

/** The lines of a list, at most SHOWN of them, and a last line saying how many were left out. */
function listed(lines, rest) {
  const shown = lines.slice(0, SHOWN).map((line) => `  - ${line}`)
  if (lines.length > SHOWN) shown.push(`  - and ${lines.length - SHOWN} more in ${rest}`)
  return shown
}

function loginLines(data) {
  const { state, evidence } = data.session
  if (state === 'not-required') return []
  const seen = evidence.length > 0 ? ` (${evidence.join('; ')})` : ''
  if (state === 'authenticated') return [`Login: authenticated`]
  if (state === 'expired') return [`Login: expired${seen}`, `  Log in again, yourself: ${loginCommand(data)}`]
  return ['Login: unknown, so it was not verified: nothing the target is configured to show was seen on the page']
}

/** What `fe-kit ui` prints. `directory` is where the pictures and the report were written, as it should be shown. */
export function formatUiText(data, { directory }) {
  const lines = [`fe-kit ui: ${subject(data)} (${data.readOnly ? 'read-only' : 'writable'}), ${data.url}`, ...loginLines(data)]
  if (data.timedOut) lines.push('The run was stopped: it took too long.')
  if (data.navigationError !== null) lines.push(`Could not open the page: ${data.navigationError}`)

  const pictures = data.viewports.filter((viewport) => viewport.screenshot !== null)
  if (pictures.length > 0) lines.push('Pictures:', ...pictures.map((viewport) => `  - ${directory}/${viewport.screenshot} (${viewport.width}x${viewport.height})`))

  if (data.steps.length > 0) {
    const count = (status) => data.steps.filter((step) => step.status === status).length
    const parts = [`${count('ok')} ok`, ...(count('failed') > 0 ? [`${count('failed')} failed`] : []), ...(count('skipped') > 0 ? [`${count('skipped')} skipped`] : [])]
    lines.push(`Steps: ${parts.join(', ')}`)
    for (const step of data.steps.filter((candidate) => candidate.status === 'failed')) lines.push(`  - step ${step.index + 1}: ${step.error}`)
  }

  const dropped = data.droppedFindings > 0 ? ` (and ${data.droppedFindings} more not kept)` : ''
  lines.push(data.consoleErrors.length === 0 ? 'Console errors: none' : `Console errors: ${data.consoleErrors.length}${dropped}`)
  lines.push(...listed(data.consoleErrors.map((entry) => `${entry.type}: ${entry.text}`), 'report.md'))
  lines.push(data.failedResponses.length === 0 ? 'Failed responses: none' : `Failed responses: ${data.failedResponses.length}`)
  lines.push(...listed(data.failedResponses.map((entry) => `${entry.status} ${entry.method} ${entry.url}`), 'report.md'))
  const refused = data.guard.filter((event) => event.kind !== 'allowed-write')
  if (refused.length > 0) {
    lines.push(`Refused by the guard: ${refused.length}`)
    lines.push(...listed(refused.map((event) => `${event.method === undefined ? '' : `${event.method} `}${event.url}: ${event.reason}`), 'report.md'))
  }
  const allowed = data.guard.filter((event) => event.kind === 'allowed-write')
  if (allowed.length > 0) {
    lines.push(`Writes let through: ${allowed.length}`)
    lines.push(...listed(allowed.map((event) => `${event.method} ${event.url} (${event.via})`), 'report.md'))
  }
  lines.push(`Report: ${directory}/report.md`)
  return `${lines.join('\n')}\n`
}

const cell = (text) => String(text ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')

/** The report that is kept next to the pictures. */
export function formatUiMarkdown(data) {
  const lines = [`# UI check: ${subject(data)}`, '', '## Result', '', `- target: ${data.target} (${data.readOnly ? 'read-only' : 'writable'}), ${data.url}`, `- exit code: ${data.exitCode}`]
  if (data.timedOut) lines.push('- the run was stopped: it took too long')
  if (data.navigationError !== null) lines.push(`- could not open the page: ${data.navigationError}`)
  lines.push('', '## Login', '', `- state: ${data.session.state}`, ...data.session.evidence.map((line) => `- ${line}`))
  lines.push('', '## Pictures', '')
  for (const viewport of data.viewports.filter((entry) => entry.screenshot !== null)) lines.push(`- ${viewport.name} (${viewport.width}x${viewport.height}), ended on ${viewport.finalUrl}`, `  ![${viewport.name}](${viewport.screenshot})`)
  lines.push('', '## Steps', '')
  if (data.steps.length === 0) lines.push('No steps.')
  else {
    lines.push('| # | action | target | status | note |', '|---|---|---|---|---|')
    for (const step of data.steps) lines.push(`| ${step.index + 1} | ${cell(step.action)} | ${cell(step.selector ?? step.path ?? step.name ?? step.key)} | ${step.status} | ${cell(step.error)} |`)
  }
  lines.push('', '## Console errors', '', ...(data.consoleErrors.length === 0 ? ['None.'] : data.consoleErrors.map((entry) => `- ${entry.type}: ${cell(entry.text)}`)))
  if (data.droppedFindings > 0) lines.push(`- and ${data.droppedFindings} more were not kept`)
  lines.push('', '## Failed responses', '', ...(data.failedResponses.length === 0 ? ['None.'] : data.failedResponses.map((entry) => `- ${entry.status} ${entry.method} ${entry.url}`)))
  if (data.failedRequests.length > 0) lines.push('', '## Requests that failed', '', ...data.failedRequests.map((entry) => `- ${entry.method} ${entry.url}: ${entry.reason}`))
  lines.push('', '## Refused by the guard', '')
  const refused = data.guard.filter((event) => event.kind !== 'allowed-write')
  lines.push(...(refused.length === 0 ? ['Nothing was refused.'] : refused.map((event) => `- ${event.kind}: ${event.method === undefined ? '' : `${event.method} `}${event.url}: ${event.reason}`)))
  const allowed = data.guard.filter((event) => event.kind === 'allowed-write')
  if (allowed.length > 0) lines.push('', `Writes let through (${plural(allowed.length, 'request')}):`, ...allowed.map((event) => `- ${event.method} ${event.url} (${event.via})`))
  return `${lines.join('\n')}\n`
}

/** Writes report.json and report.md in `directory`, which must be new: an earlier report is never overwritten. */
export async function writeUiReport(directory, data) {
  await writeFile(join(directory, 'report.json'), `${JSON.stringify(data, null, 2)}\n`, { flag: 'wx' })
  await writeFile(join(directory, 'report.md'), formatUiMarkdown(data), { flag: 'wx' })
}
