import { lastLines, plural, seconds } from '../lib/format.mjs'
import { redactCredentials } from '../lib/profile.mjs'
import { resolveProject } from '../lib/project.mjs'
import { PROJECTS_SKIP, runLocalTests } from '../lib/test-runner.mjs'

export const options = {}

export const usage = `Usage: fe-kit test [<filter>...] [--json]

Runs the tests kept in .fe-kit/tests with the vitest or jest of the project, using the project's own configuration
with only the test files replaced. Arguments filter which test files run. Needs fe-kit init to have been run.
Exit code: 0 when they pass or there are none, 1 when a test fails or the runner cannot run them (a vitest workspace, say), 2 for a usage error.
`

// A passing run needs its summary; a failing one needs the failures, which a runner prints before its summary.
const PASSED_LINES = 10
const FAILED_LINES = 100

function outcome(result) {
  if (result.error) return `could not start: ${result.error}`
  if (result.timedOut) return 'timed out'
  return result.signal ? `killed by ${result.signal}` : `exit ${result.exitCode}`
}

function formatRun(data) {
  const lines = [
    `Ran ${plural(data.files.length, 'local test file')} with ${data.runner}: ${data.command}`,
    `${data.passed ? 'PASS' : 'FAIL'} (${outcome(data)}, ${seconds(data.durationMs)})`,
  ]
  const shown = lastLines(data.output, data.passed ? PASSED_LINES : FAILED_LINES)
  if (shown !== '') lines.push(shown)
  return `${lines.join('\n')}\n`
}

/**
 * Runs the tests in `.fe-kit/tests` with the project's own vitest or jest. Arguments filter which test files run.
 * Exit code: 0 when they pass or there are none, 1 when a test fails or the runner cannot run.
 */
export async function run({ args, cwd, env, kitRoot }) {
  const project = await resolveProject({ cwd, env, kitRoot })
  const result = await runLocalTests(project, { filters: args, env })
  if (result.status === 'skipped') {
    // No local tests is nothing to run; tests that exist and cannot run are not a pass.
    return { data: result, text: `${result.reason[0].toUpperCase()}${result.reason.slice(1)}.\n`, exitCode: result.reason === PROJECTS_SKIP ? 1 : 0 }
  }

  // What the runner printed is quoted back, and it may hold a URL with a password: the same single exit as `context`.
  const data = redactCredentials(result)
  return { data, text: formatRun(data), exitCode: result.passed ? 0 : 1 }
}
