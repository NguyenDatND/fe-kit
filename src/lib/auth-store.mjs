import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { UsageError } from './errors.mjs'
import { lstatOrNull } from './fsx.mjs'

/**
 * The saved logins (Playwright `storageState`): one file per profile, target and role, outside any project, in a folder only
 * the user can open. The files are secrets. Nothing here ever returns a cookie or a token to be printed: `sessionStatus`
 * counts and dates, and an error never repeats the content of a file.
 */

const POSIX = process.platform !== 'win32'
const SAFE_NAME = /^[A-Za-z0-9_-]+$/
const SAFE_PROFILE = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/

export const stateRoot = (env) => env.FE_KIT_STATE_DIR ?? join(env.HOME ?? homedir(), '.local', 'state', 'fe-kit')

/** `<root>/auth/<profile>/<target>.<role>.json`. A name that could point outside the folder is a usage error. */
export function sessionPath(root, { profile, target, role }) {
  if (!SAFE_PROFILE.test(profile)) throw new UsageError('the profile name cannot be used in a file name: start it with a letter, digit or "_" and use only letters, digits, ".", "-" and "_"')
  for (const [label, name] of [['target', target], ['role', role]]) {
    if (!SAFE_NAME.test(name)) throw new UsageError(`the ${label} name cannot be used in a file name: use only letters, digits, "-" and "_"`)
  }
  return join(root, 'auth', profile, `${target}.${role}.json`)
}

/** Makes `folder` (mode 700) when it is not there; a link or a file in its place is refused. */
async function ensureFolder(folder) {
  const found = await lstatOrNull(folder)
  if (found === null) {
    await mkdir(folder, { mode: 0o700 }) // the umask can only take bits away from this, never add any
  } else if (!found.isDirectory()) {
    throw new UsageError(`${folder} is a link or a file, not a folder: the saved logins are not written through it`)
  }
}

export async function saveSession(file, state) {
  const profileFolder = dirname(file)
  const authFolder = dirname(profileFolder)
  await mkdir(dirname(authFolder), { recursive: true }) // the state folder itself: it is the user's, and only what is below it is made private
  await ensureFolder(authFolder)
  await ensureFolder(profileFolder)
  // A new file renamed over the old one: a link at `file` is replaced, never written through, and a reader never sees half a file.
  const staging = `${file}.${process.pid}-${randomBytes(4).toString('hex')}.tmp`
  try {
    await writeFile(staging, JSON.stringify(state), { flag: 'wx', mode: 0o600 })
    await rename(staging, file)
  } catch (failure) {
    await rm(staging, { force: true })
    throw failure
  }
}

const isSession = (value) => value !== null && typeof value === 'object' && Array.isArray(value.cookies) && Array.isArray(value.origins)

async function parseSession(file) {
  let value
  try {
    value = JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return null // the parse error is not passed on: it can quote the file
  }
  return isSession(value) ? value : null
}

/** The saved state, or null when there is none. A link, or a file that is not a saved login, is a usage error. */
export async function readSession(file) {
  const found = await lstatOrNull(file)
  if (found === null) return null
  if (!found.isFile()) throw new UsageError(`${file} is a link or not a regular file: it is not read`)
  const state = await parseSession(file)
  if (state === null) throw new UsageError(`${file} is not a saved login (run \`fe-kit auth login\` again)`)
  return state
}

/** What is saved, without any value of it: `{ state, ... }` with state missing, present, unsafe or invalid. */
export async function sessionStatus(file) {
  const found = await lstatOrNull(file)
  if (found === null) return { state: 'missing' }
  if (!found.isFile()) return { state: 'unsafe', problem: 'it is a link or not a regular file' }
  if (POSIX) {
    const folder = await lstatOrNull(dirname(file))
    for (const [label, entry] of [['file', found], ['folder', folder]]) {
      if (entry !== null && (entry.mode & 0o077) !== 0) {
        return { state: 'unsafe', problem: `the ${label} can be read by other users (mode ${(entry.mode & 0o777).toString(8)}); run chmod ${label === 'file' ? '600' : '700'} on it` }
      }
    }
  }
  const state = await parseSession(file)
  if (state === null) return { state: 'invalid' }
  const expiries = state.cookies.map((cookie) => cookie?.expires).filter((expires) => typeof expires === 'number' && expires > 0)
  return {
    state: 'present',
    savedAt: found.mtime.toISOString(),
    cookies: state.cookies.length,
    origins: state.origins.length,
    expiresAt: expiries.length === 0 ? null : new Date(Math.min(...expiries) * 1000).toISOString(),
  }
}
