import { createInterface } from 'node:readline/promises'
import { saveSession, sessionStatus } from '../lib/auth-store.mjs'
import { loadPlaywright } from '../lib/browser.mjs'
import { UsageError } from '../lib/errors.mjs'
import { plainUrl } from '../lib/plain-url.mjs'
import { plural } from '../lib/format.mjs'
import { resolveProject } from '../lib/project.mjs'
import { resolvePagePath, resolveUiTarget } from '../lib/ui-target.mjs'

export const options = { target: { type: 'string' }, role: { type: 'string' }, path: { type: 'string' } }

export const usage = `Usage: fe-kit auth login|status --target <name> --role <name> [--path <page>] [--json]

login   opens the target in a browser window; you log in as that role, come back and press Enter, and the login is
        saved outside the project (mode 600). Run it yourself in a terminal: it waits for you.
status  says whether a saved login exists, how many cookies it holds and when the first of them expires (never a value).
Exit code: 0 ok, 1 no usable saved login (status), 2 usage error.
`

const defaultDeps = {
  isInteractive: Boolean(process.stdin.isTTY),
  say: (text) => process.stderr.write(`${text}\n`),
  waitForEnter: async () => {
    const lines = createInterface({ input: process.stdin, output: process.stderr })
    try {
      await lines.question('')
    } finally {
      lines.close()
    }
  },
  launchBrowser: async (launchOptions) => (await loadPlaywright()).chromium.launch(launchOptions),
}

const loginCommand = ({ target, role }) => `fe-kit auth login --target ${target} --role ${role}`
const day = (iso) => iso.slice(0, 10)

async function status(resolved, { now = Date.now } = {}) {
  const found = await sessionStatus(resolved.statePath)
  const data = { profile: resolved.profile, target: resolved.targetName, role: resolved.role, file: resolved.statePath, ...found }
  const login = loginCommand({ target: resolved.targetName, role: resolved.role })
  const subject = `${resolved.targetName} as ${resolved.role}`
  if (found.state === 'missing') return { data, text: `No saved login for ${subject}. Run it yourself: ${login}\n`, exitCode: 1 }
  if (found.state === 'invalid') return { data, text: `The saved login for ${subject} is not readable. Run it again: ${login}\n`, exitCode: 1 }
  if (found.state === 'unsafe') return { data, text: `The saved login for ${subject} is not safe to use: ${found.problem}\n`, exitCode: 1 }
  if (found.expiresAt !== null && Date.parse(found.expiresAt) <= now()) {
    return { data: { ...data, expired: true }, text: `The saved login for ${subject} has expired (its first cookie ran out ${day(found.expiresAt)}). Run it again: ${login}\n`, exitCode: 1 }
  }
  const expiry = found.expiresAt === null ? 'no cookie with an expiry date (session cookies only)' : `first cookie expires ${day(found.expiresAt)}`
  return { data, text: `Saved login for ${subject}: ${plural(found.cookies, 'cookie')}, ${plural(found.origins, 'origin')}, saved ${day(found.savedAt)}, ${expiry}.\n`, exitCode: 0 }
}

async function login(resolved, flags, deps) {
  const address = resolvePagePath(resolved, flags.path)
  if (!deps.isInteractive) {
    throw new UsageError(`auth login waits for you to log in, so it needs a terminal: run \`${loginCommand({ target: resolved.targetName, role: resolved.role })}\` yourself`)
  }

  const browser = await deps.launchBrowser({ headless: false })
  try {
    const context = await browser.newContext()
    try {
      await (await context.newPage()).goto(address.href)
    } catch (error) {
      // The address the browser was given can carry a token in its query string, and the message of the error quotes it.
      const reason = String(error?.message ?? error).split('\n')[0].replace(/https?:\/\/\S+/g, (url) => plainUrl(url))
      throw new UsageError(`could not open ${plainUrl(address.href)}: ${reason.slice(0, 200)}`)
    }
    deps.say(`Opened ${address.origin}${address.pathname}. Log in as ${resolved.role} in the window, then press Enter here.`) // the query string stays out of the terminal: it can hold a token
    await deps.waitForEnter()
    const state = await context.storageState({ indexedDB: true })
    // Nothing in the browser means the login did not happen; a good saved login is not replaced by that.
    if (state.cookies.length === 0 && state.origins.length === 0) throw new UsageError('nothing to save: the browser holds no cookies or storage for this site (did the login finish?)')
    await saveSession(resolved.statePath, state)
    const subject = `${resolved.targetName} as ${resolved.role}`
    const summary = `${plural(state.cookies.length, 'cookie')}, ${plural(state.origins.length, 'origin')}`
    return {
      data: { profile: resolved.profile, target: resolved.targetName, role: resolved.role, file: resolved.statePath, cookies: state.cookies.length, origins: state.origins.length },
      text: `Saved the login for ${subject} (${summary}). Check it with: fe-kit auth status --target ${resolved.targetName} --role ${resolved.role}\n`,
      exitCode: 0,
    }
  } finally {
    await browser.close()
  }
}

/** `auth login` and `auth status`. `deps` replaces the browser, the terminal and the clock, for tests. */
export async function run({ args, flags, cwd, env, kitRoot, deps = {} }) {
  const [subcommand] = args
  if (subcommand !== 'login' && subcommand !== 'status') throw new UsageError('auth takes login or status (see fe-kit auth --help)')
  const project = await resolveProject({ cwd, env, kitRoot })
  const resolved = resolveUiTarget({ settings: project.settings, flags, env, roleRequired: true })
  return subcommand === 'status' ? status(resolved, deps) : login(resolved, flags, { ...defaultDeps, ...deps })
}
