import { mkdir } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { readSession } from '../lib/auth-store.mjs'
import { draftsAreReady, draftsDir } from '../lib/drafts.mjs'
import { UsageError } from '../lib/errors.mjs'
import { lstatOrNull } from '../lib/fsx.mjs'
import { resolveProject } from '../lib/project.mjs'
import { formatUiText, writeUiReport } from '../lib/ui-report.mjs'
import { runUi } from '../lib/ui-runner.mjs'
import { loadSteps } from '../lib/ui-steps.mjs'
import { resolvePagePath, resolveUiTarget } from '../lib/ui-target.mjs'
import { parseViewports } from '../lib/ui-viewports.mjs'

export const options = { target: { type: 'string' }, role: { type: 'string' }, path: { type: 'string' }, viewports: { type: 'string' }, steps: { type: 'string' } }

export const usage = `Usage: fe-kit ui --target <name> [--role <name>] [--path <page>] [--viewports mobile,tablet,desktop|WxH,...] [--steps <file.json>] [--json]

Opens the target in a browser, takes a picture at each viewport, runs the steps, and reports console errors, failed responses
and what the guard refused. Pictures and report go to .fe-kit/ui/<time>-<target>/ (fe-kit init first).
A target the kit does not start itself is read-only: every write request (POST, PUT, PATCH, DELETE) is refused, except what the
profile lists in "safeRequests". With --role the saved login of that role is used (fe-kit auth login).
Steps are a JSON list (see templates/ui-steps.json) and run once, so they take one viewport (desktop unless --viewports says).
Exit code: 0 ok, 1 a step failed, the run took too long or the login could not be verified, 2 usage error, 3 the login is gone
(or never saved): run fe-kit auth login yourself.
`

const MAX_ATTEMPTS = 20
const stamp = (date) => date.toISOString().replace(/[:.]/g, '-')

/** A new folder under `.fe-kit/ui`; a second run in the same moment gets a number after the name. */
async function newRunFolder(project, name) {
  const ui = join(draftsDir(project.projectRoot), 'ui')
  const existing = await lstatOrNull(ui)
  if (existing && !existing.isDirectory()) throw new UsageError('.fe-kit/ui is not a real folder: remove it so that fe-kit can write pictures there')
  await mkdir(ui, { recursive: true })
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const folder = join(ui, attempt === 1 ? name : `${name}-${attempt}`)
    try {
      await mkdir(folder)
      return folder
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
  }
  throw new UsageError('could not make a folder for this run under .fe-kit/ui')
}

/** `deps` replaces the browser, the clock and the waits, for tests. */
export async function run({ args, flags, cwd, env, kitRoot, deps = {} }) {
  if (args.length > 0) throw new UsageError('ui takes no arguments, only options (see fe-kit ui --help)')
  const project = await resolveProject({ cwd, env, kitRoot })
  const resolved = resolveUiTarget({ settings: project.settings, flags, env })
  const address = resolvePagePath(resolved, flags.path)
  const steps = flags.steps === undefined ? [] : await loadSteps(resolve(cwd, flags.steps))
  const viewports = parseViewports(flags.viewports, { hasSteps: steps.length > 0 })
  if (!(await draftsAreReady(project.projectRoot))) throw new UsageError('.fe-kit is not set up in this project: run `fe-kit init` first, since the pictures are kept there, where git does not see them')

  const storageState = resolved.role === undefined ? undefined : await readSession(resolved.statePath)
  const name = `${stamp((deps.now ?? (() => new Date()))())}-${resolved.targetName}${resolved.role === undefined ? '' : `-${resolved.role}`}`
  const folder = await newRunFolder(project, name)
  const { data, exitCode } = await runUi({
    resolved,
    storageState,
    steps,
    viewports,
    pagePath: `${address.pathname}${address.search}`,
    outDir: folder,
    deps,
    allowRequest: flags['allow-request'],
    ...(deps.settleMs === undefined ? {} : { settleMs: deps.settleMs }),
  })

  const directory = relative(project.projectRoot, folder).split('\\').join('/')
  await writeUiReport(folder, data)
  return { data: { ...data, directory }, text: formatUiText(data, { directory }), exitCode }
}
