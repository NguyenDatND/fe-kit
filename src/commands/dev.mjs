import { draftsAreReady, draftsDir } from '../lib/drafts.mjs'
import { answers, DevBusyError, inspect, logPath, startDev, stopDev } from '../lib/dev-server.mjs'
import { UsageError } from '../lib/errors.mjs'
import { plainUrl } from '../lib/plain-url.mjs'
import { redactCredentials } from '../lib/profile.mjs'
import { createScrubber } from '../lib/scrub.mjs'
import { resolveProject } from '../lib/project.mjs'
import { resolveUiTarget } from '../lib/ui-target.mjs'

export const options = { target: { type: 'string' }, timeout: { type: 'string' } }

export const usage = `Usage: fe-kit dev start|stop|status [--target <name>] [--timeout <seconds>] [--json]

start   runs the "start" command of a target in the background, waits until its address answers (60 s unless --timeout),
        and keeps its output in .fe-kit/dev.log. It does nothing when one it started is already running, and refuses when
        something else already answers at the address.
stop    stops what start started, with everything it started, and only if it is still that process.
status  says whether it runs and answers. Exit code 0 when it runs, 1 when it does not.
Needs fe-kit init. Exit code: 0 ok, 1 it could not start or is not running, 2 usage error.
`

const DEFAULT_TIMEOUT_S = 60
const MAX_TIMEOUT_S = 600

function parseTimeout(text) {
  if (text === undefined) return DEFAULT_TIMEOUT_S
  const seconds = Number(text)
  if (!/^\d+$/.test(text) || seconds < 1 || seconds > MAX_TIMEOUT_S) throw new UsageError(`--timeout is a whole number of seconds from 1 to ${MAX_TIMEOUT_S}`)
  return seconds
}

/** The target `start` runs: the one named, else the only one that has a `start` command. */
function startTarget(settings, flags, env) {
  const names = Object.entries(settings.targets ?? {}).filter(([, target]) => target?.start !== undefined).map(([name]) => name)
  if (flags.target === undefined) {
    if (names.length === 0) throw new UsageError('no target has a "start" command: add one to the target in the profile')
    if (names.length > 1) throw new UsageError(`--target is required: ${names.join(', ')} each have a "start" command`)
  }
  const resolved = resolveUiTarget({ settings, flags: { target: flags.target ?? names[0] }, env })
  if (resolved.target.start === undefined) throw new UsageError(`target "${resolved.targetName}" has no "start" command, so the kit cannot start it`)
  return resolved
}

const where = (record) => `${record.target} (pid ${record.pid})`

/** `dev start`, `dev stop`, `dev status`. One at a time per project: a second one says so and does nothing. */
export async function run(context) {
  try {
    return await dispatch(context)
  } catch (error) {
    if (!(error instanceof DevBusyError)) throw error
    return { data: { status: 'busy', pid: error.pid }, text: `Nothing was done: ${error.message}; wait for it to end.\n`, exitCode: 1 }
  }
}

async function dispatch({ args, flags, cwd, env, kitRoot }) {
  const [subcommand] = args
  if (!['start', 'stop', 'status'].includes(subcommand)) throw new UsageError('dev takes start, stop or status (see fe-kit dev --help)')
  if (process.platform === 'win32') throw new UsageError('dev is not supported on Windows yet')
  const project = await resolveProject({ cwd, env, kitRoot })
  if (!(await draftsAreReady(project.projectRoot))) throw new UsageError('.fe-kit is not set up in this project: run `fe-kit init` first, since the record and the log of the server are kept there')
  const drafts = draftsDir(project.projectRoot)

  if (subcommand === 'stop') {
    const { state, record } = await stopDev(drafts)
    const text = {
      none: 'No dev server was started by fe-kit in this project.',
      gone: `The dev server for ${record?.target} (pid ${record?.pid}) is no longer running; its record was removed.`,
      other: `pid ${record?.pid} is not the process fe-kit started for ${record?.target} (the pid was reused); nothing was stopped and the record was removed.`,
      running: `Stopped the dev server for ${record?.target} (pid ${record?.pid}).`,
    }[state]
    return { data: { state, ...(record === null ? {} : { pid: record.pid, target: record.target }) }, text: `${text}\n`, exitCode: 0 }
  }

  if (subcommand === 'status') {
    const { state, record } = await inspect(drafts)
    if (state !== 'running') {
      const note = state === 'none' ? '' : ` (the record of ${where(record)} does not match a running process)`
      return { data: { running: false, state }, text: `The dev server is not running${note}.\n`, exitCode: 1 }
    }
    // A record kept by an earlier version may hold an address with a query string: it is shown, and asked, without it.
    const address = plainUrl(record.url)
    const answering = await answers(address)
    const text = answering ? `The dev server for ${where(record)} is running and answers at ${address}.` : `The dev server for ${where(record)} is running, but ${address} does not answer (yet).`
    return { data: { running: true, answering, pid: record.pid, target: record.target, url: address }, text: `${text}\n`, exitCode: 0 }
  }

  const resolved = startTarget(project.settings, flags, env)
  const seconds = parseTimeout(flags.timeout)
  // The address is used, kept and shown without its query string: it can carry a token, and any answer will do to tell the server is up.
  const address = plainUrl(resolved.url)
  const result = await startDev({ drafts, command: resolved.target.start, cwd: project.packageRoot, url: address, target: resolved.targetName, env, timeoutMs: seconds * 1000 })
  const log = '.fe-kit/dev.log'
  const scrub = createScrubber([]) // a server logs what it likes: a header, an address with a token
  const tail = (text) => (text === '' ? '' : `Last lines of ${log}:\n${redactCredentials(scrub(text))}\n`)
  switch (result.status) {
    case 'already-running':
      return { data: { status: result.status, pid: result.record.pid, target: result.record.target, url: plainUrl(result.record.url) }, text: `The dev server for ${where(result.record)} is already running at ${plainUrl(result.record.url)}.\n`, exitCode: 0 }
    case 'occupied':
      return { data: { status: result.status, url: address }, text: `Something already answers at ${address}, so nothing was started: it would be taken for the dev server of ${resolved.targetName}. Stop that first, or change the url of the target.\n`, exitCode: 1 }
    case 'exited': {
      const how = result.code === null ? `was ended by ${result.signal ?? 'an error'}` : `exited with code ${result.code}`
      return { data: { status: result.status, code: result.code }, text: `The start command ${how} before ${address} answered.\n${tail(result.log)}`, exitCode: 1 }
    }
    case 'timeout':
      return { data: { status: result.status }, text: `The dev server did not answer within ${seconds} s at ${address}, and was stopped.\n${tail(result.log)}`, exitCode: 1 }
    default:
      return {
        data: { status: result.status, pid: result.record.pid, target: result.record.target, url: plainUrl(result.record.url), log: logPath(drafts) },
        text: `Started the dev server for ${where(result.record)}: ${plainUrl(result.record.url)}\nLog: ${log}\nStop it with: fe-kit dev stop\n`,
        exitCode: 0,
      }
  }
}
