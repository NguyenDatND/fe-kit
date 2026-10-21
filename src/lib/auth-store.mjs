import { randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { mkdir, open, rename, rm, writeFile } from 'node:fs/promises'
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

/** What is wrong with a folder that holds saved logins, in words; null when it is fine, or when it is not there yet. */
async function folderProblem(folder) {
  const found = await lstatOrNull(folder)
  if (found === null) return null
  if (!found.isDirectory()) return `the folder ${folder} is a link or not a folder: the saved logins are not read or written through it`
  if (POSIX && found.uid !== process.getuid()) return `the folder ${folder} belongs to another user`
  if (POSIX && (found.mode & 0o077) !== 0) return `the folder ${folder} can be entered by other users (mode ${(found.mode & 0o777).toString(8)}); run chmod 700 on it`
  return null
}

/** The first problem with the two folders above a saved login (`auth` and the profile's); null when both are fine or not there. */
async function foldersProblem(file) {
  const profileFolder = dirname(file)
  return (await folderProblem(dirname(profileFolder))) ?? (await folderProblem(profileFolder))
}

/** Makes `folder` (mode 700) when it is not there; one that is there must already be a private folder of ours. */
async function ensureFolder(folder) {
  const problem = await folderProblem(folder)
  if (problem !== null) throw new UsageError(problem)
  if ((await lstatOrNull(folder)) === null) await mkdir(folder, { mode: 0o700 }) // the umask can only take bits away from this, never add any
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

/** The state in a text, or null when it is not one. The parse error is not passed on: it can quote the file. */
function parseSession(text) {
  try {
    const value = JSON.parse(text)
    return isSession(value) ? value : null
  } catch {
    return null
  }
}

const fileProblem = (found) => (POSIX && (found.mode & 0o077) !== 0 ? `the file can be read by other users (mode ${(found.mode & 0o777).toString(8)}); run chmod 600 on it` : null)

/** The saved state, or null when there is none. A link, folders or a file others can get at, or a file that is not a saved login, is a usage error. */
export async function readSession(file) {
  const folders = await foldersProblem(file)
  if (folders !== null) throw new UsageError(folders)
  const found = await lstatOrNull(file)
  if (found === null) return null
  if (!found.isFile()) throw new UsageError(`${file} is a link or not a regular file: it is not read`)
  const unsafe = fileProblem(found)
  if (unsafe !== null) throw new UsageError(`${file}: ${unsafe}`)
  let state = null
  // Opened without following a link: a file swapped for one after the check above is not read.
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    state = parseSession(await handle.readFile('utf8'))
  } finally {
    await handle.close()
  }
  if (state === null) throw new UsageError(`${file} is not a saved login (run \`fe-kit auth login\` again)`)
  return state
}

/** What is saved, without any value of it: `{ state, ... }` with state missing, present, unsafe or invalid. */
export async function sessionStatus(file) {
  const folders = await foldersProblem(file)
  if (folders !== null) return { state: 'unsafe', problem: folders }
  const found = await lstatOrNull(file)
  if (found === null) return { state: 'missing' }
  if (!found.isFile()) return { state: 'unsafe', problem: 'it is a link or not a regular file' }
  const unsafe = fileProblem(found)
  if (unsafe !== null) return { state: 'unsafe', problem: unsafe }
  const state = await readSession(file).catch(() => null)
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
