import { execFile, spawn } from 'node:child_process'
import { closeSync, constants, fchmodSync, openSync } from 'node:fs'
import { link, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { UsageError } from './errors.mjs'
import { lstatOrNull } from './fsx.mjs'

/**
 * The dev server of a target, kept running in the background across commands. It is not what `exec.mjs` does (that runs a
 * command to its end and kills what is left): the process is detached, its output goes to a log file, and a record in
 * `.fe-kit/dev.pid` says what was started. `stop` stops only what still matches the record: a pid can be handed to another
 * process once the first has died, and that one must not be killed.
 */

const execFileAsync = promisify(execFile)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const isText = (value) => typeof value === 'string' && value !== ''

export const recordPath = (drafts) => join(drafts, 'dev.pid')
export const logPath = (drafts) => join(drafts, 'dev.log')
const lockPath = (drafts) => join(drafts, 'dev.lock')

/** Another `fe-kit dev` command holds the lock; `pid` is its process. */
export class DevBusyError extends Error {
  constructor(pid) {
    super(`another fe-kit dev command is running (pid ${pid})`)
    this.pid = pid
  }
}

export function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM' // it exists, it is only not ours to signal
  }
}

/** When the process began, as `ps` prints it: what tells a process from another that got its pid later. Null when it is gone. */
async function startedAt(pid) {
  try {
    const { stdout } = await execFileAsync('ps', ['-o', 'lstart=', '-p', String(pid)])
    return stdout.trim() || null
  } catch {
    return null
  }
}

/** Whether something answers at the address (any status: it is up). */
export const answers = (url, timeoutMs = 2000) => fetch(url, { signal: AbortSignal.timeout(timeoutMs) }).then(() => true, () => false)

/** The record of the server fe-kit started, or null. A file that is not a record is a usage error and is not quoted. */
export async function readRecord(drafts) {
  const file = recordPath(drafts)
  const found = await lstatOrNull(file)
  if (!found) return null
  // A link would be read, and then written through, to something that is not ours.
  if (!found.isFile()) throw new UsageError('.fe-kit/dev.pid is a link or not a file: remove it, and stop the server by hand if one runs')
  let record
  try {
    record = JSON.parse(await readFile(file, 'utf8'))
  } catch {
    record = null
  }
  const valid = record !== null && typeof record === 'object' && Number.isInteger(record.pid) && record.pid > 0 && [record.started, record.command, record.url, record.target].every(isText)
  if (!valid) throw new UsageError('.fe-kit/dev.pid is not a record fe-kit wrote: remove it, and stop the server by hand if one runs')
  return record
}

/** What the record says about the process now: none, gone, other (the pid is another process's now) or running. */
export async function inspect(drafts) {
  const record = await readRecord(drafts)
  if (record === null) return { state: 'none', record: null }
  if (!isAlive(record.pid)) return { state: 'gone', record }
  return { state: (await startedAt(record.pid)) === record.started ? 'running' : 'other', record }
}

/** Whether anything of the group that `pid` leads is still there: the server's children outlive it for a moment after it ends. */
function groupAlive(pid) {
  try {
    process.kill(-pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

/** Ends the process group of a server that is `running` as inspected: asks, waits, then insists, and waits until the whole group is gone. */
async function terminate(pid, graceMs) {
  const signalGroup = (signal) => {
    try {
      process.kill(-pid, signal) // the server leads its own group, so its children go with it
    } catch {
      // already gone
    }
  }
  signalGroup('SIGTERM')
  for (let waited = 0; waited < graceMs && groupAlive(pid); waited += 50) await sleep(50)
  signalGroup('SIGKILL') // anything in the group that did not listen; a group that is empty does not mind
  for (let waited = 0; waited < 1000 && groupAlive(pid); waited += 50) await sleep(50)
}

/** The record is written to a new file and renamed over the old one: a link at its place is replaced, never written through. */
async function writeRecord(drafts, record) {
  const staging = `${recordPath(drafts)}.${process.pid}-${randomBytes(4).toString('hex')}.tmp`
  try {
    await writeFile(staging, `${JSON.stringify(record)}\n`, { flag: 'wx', mode: 0o600 })
    await rename(staging, recordPath(drafts))
  } catch (failure) {
    await rm(staging, { force: true })
    throw failure
  }
}

const readOwner = (file) => readFile(file, 'utf8').then((text) => {
  const owner = JSON.parse(text)
  return Number.isInteger(owner?.pid) && owner.pid > 0 ? owner : null
}, () => null).catch(() => null)
const UNREADABLE_STALE_MS = 30_000

/** Whether the lock's owner is still the process that took it (a pid can be handed to another process after it dies). */
async function holds(owner) {
  return isAlive(owner.pid) && (await startedAt(owner.pid)) === owner.started
}

/**
 * Takes the lock of the project's dev server, or throws DevBusyError. The lock file is published whole (written aside, then
 * linked into place, which fails if it is there), so nobody ever reads it empty. A lock whose owner is gone is taken over by
 * moving it aside under a name of ours, and looking at what was moved: if that is not what was found stale, a live lock was
 * published in between, and it is put back. A file that cannot be read is respected for as long as it is new.
 */
async function acquire(drafts) {
  const mine = { pid: process.pid, started: await startedAt(process.pid), nonce: randomBytes(8).toString('hex') }
  const staging = `${lockPath(drafts)}.${process.pid}-${mine.nonce}.tmp`
  await writeFile(staging, JSON.stringify(mine), { flag: 'wx', mode: 0o600 })
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await link(staging, lockPath(drafts))
        return mine
      } catch (error) {
        if (error.code !== 'EEXIST') throw error
      }
      const found = await stat(lockPath(drafts)).then((info) => ({ owner: null, age: Date.now() - info.mtimeMs }), () => null)
      if (found === null) continue // it went away while we looked
      found.owner = await readOwner(lockPath(drafts))
      if (found.owner !== null ? await holds(found.owner) : found.age < UNREADABLE_STALE_MS) throw new DevBusyError(found.owner?.pid ?? 'unknown')

      const aside = `${lockPath(drafts)}.stale-${process.pid}-${mine.nonce}`
      try {
        await rename(lockPath(drafts), aside)
      } catch (error) {
        if (error.code === 'ENOENT') continue
        throw error
      }
      const moved = await readOwner(aside)
      if (JSON.stringify(moved) !== JSON.stringify(found.owner)) {
        // Not the lock that was stale: someone published a live one after we looked. Put it back, and give way.
        await link(aside, lockPath(drafts)).catch(() => {}) // if that place is taken again too, the lock moved is lost; the odds are those of three commands in one moment
        await rm(aside, { force: true })
        throw new DevBusyError(moved?.pid ?? 'unknown')
      }
      await rm(aside, { force: true })
    }
    throw new DevBusyError('unknown')
  } finally {
    await rm(staging, { force: true })
  }
}

/** Start and stop change what the record says, and two of them at once could each undo what the other did. One at a time per project. */
export async function withLock(drafts, work) {
  const mine = await acquire(drafts)
  try {
    return await work()
  } finally {
    // Only a lock that is still ours: one that a rival took over meanwhile is not for us to remove.
    if ((await readOwner(lockPath(drafts)))?.nonce === mine.nonce) await rm(lockPath(drafts), { force: true })
  }
}

async function stopLocked(drafts, graceMs) {
  const { state, record } = await inspect(drafts)
  if (state === 'running') await terminate(record.pid, graceMs)
  if (record !== null) await rm(recordPath(drafts), { force: true })
  return { state, record }
}

export const stopDev = (drafts, { graceMs = 5000 } = {}) => withLock(drafts, () => stopLocked(drafts, graceMs))

/** Removes the record, but only if it is the record of this process: never one that a later start has written. */
async function removeRecordOf(drafts, pid) {
  const record = await readRecord(drafts).catch(() => null)
  if (record?.pid === pid) await rm(recordPath(drafts), { force: true })
}

async function logTail(drafts) {
  return (await readFile(logPath(drafts), 'utf8').catch(() => '')).trimEnd().split('\n').slice(-20).join('\n')
}

/**
 * Starts `command` in `cwd` and waits until `url` answers. Resolves `{ status }`: started, already-running, occupied (something
 * else answers at the address, and it must not be taken for ours), exited (with `code` and the `log` tail) or timeout
 * (the server is stopped again).
 */
export const startDev = (options) => withLock(options.drafts, () => startLocked(options))

async function startLocked({ drafts, command, cwd, url, target, env, timeoutMs, pollMs = 250, hooks }) {
  const existing = await inspect(drafts)
  if (existing.state === 'running') return { status: 'already-running', record: existing.record }
  if (existing.record !== null) await rm(recordPath(drafts), { force: true }) // an old record of a process that is gone

  if (await answers(url, 1000)) return { status: 'occupied' }

  const logged = await lstatOrNull(logPath(drafts))
  if (logged && !logged.isFile()) throw new UsageError('.fe-kit/dev.log is a link or not a file: remove it so that fe-kit can write the log there')
  // No following of a link that appears in the meantime, and no opening for writing a file that someone else can read.
  const log = openSync(logPath(drafts), constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600)
  fchmodSync(log, 0o600) // the mode above is for a new file; one that was there keeps the one it had
  let child
  try {
    child = spawn(command, { shell: true, cwd, env, detached: true, stdio: ['ignore', log, log] })
  } finally {
    closeSync(log) // the child has its own copy; the parent must not hold the file
  }
  let exit = null
  child.on('exit', (code, signal) => {
    exit = { code, signal }
  })
  child.on('error', () => {
    exit = { code: null, signal: null }
  })
  child.unref()

  // From here the server runs, and whatever fails must not leave it running with nothing that says so.
  try {
    hooks?.afterSpawn?.(child)
    const record = { pid: child.pid, started: (await startedAt(child.pid)) ?? 'unknown', command, url, target }
    if (child.pid !== undefined) await writeRecord(drafts, record)
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (exit !== null) {
        await removeRecordOf(drafts, child.pid)
        return { status: 'exited', code: exit.code, signal: exit.signal, log: await logTail(drafts) }
      }
      if (await answers(url, 1000)) return { status: 'started', record }
      await sleep(pollMs)
    }
    await terminate(child.pid, 5000)
    await removeRecordOf(drafts, child.pid)
    return { status: 'timeout', log: await logTail(drafts) }
  } catch (failure) {
    await terminate(child.pid, 2000)
    await removeRecordOf(drafts, child.pid)
    throw failure
  }
}
