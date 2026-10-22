import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { link, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'

/**
 * A lock between fe-kit commands, kept in a file. Node has no lock of the operating system, so this is the best that files
 * allow: published whole, owned by a process that can be told from a later one with the same pid, taken over when its owner
 * is gone. Three commands in one moment can still beat it.
 */

const execFileAsync = promisify(execFile)

export function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM' // it exists, it is only not ours to signal
  }
}

/** When the process began, as `ps` prints it: what tells a process from another that got its pid later. Null when it is gone. */
export async function startedAt(pid) {
  try {
    const { stdout } = await execFileAsync('ps', ['-o', 'lstart=', '-p', String(pid)])
    return stdout.trim() || null
  } catch {
    return null
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
 * Takes the lock, or throws what `busy` makes. The lock file is published whole (written aside, then
 * linked into place, which fails if it is there), so nobody ever reads it empty. A lock whose owner is gone is taken over by
 * moving it aside under a name of ours, and looking at what was moved: if that is not what was found stale, a live lock was
 * published in between, and it is put back. A file that cannot be read is respected for as long as it is new.
 */
async function acquire(lockFile, busy) {
  const mine = { pid: process.pid, started: await startedAt(process.pid), nonce: randomBytes(8).toString('hex') }
  const staging = `${lockFile}.${process.pid}-${mine.nonce}.tmp`
  await writeFile(staging, JSON.stringify(mine), { flag: 'wx', mode: 0o600 })
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await link(staging, lockFile)
        return mine
      } catch (error) {
        if (error.code !== 'EEXIST') throw error
      }
      const found = await stat(lockFile).then((info) => ({ owner: null, age: Date.now() - info.mtimeMs }), () => null)
      if (found === null) continue // it went away while we looked
      found.owner = await readOwner(lockFile)
      if (found.owner !== null ? await holds(found.owner) : found.age < UNREADABLE_STALE_MS) throw busy(found.owner?.pid ?? 'unknown')

      const aside = `${lockFile}.stale-${process.pid}-${mine.nonce}`
      try {
        await rename(lockFile, aside)
      } catch (error) {
        if (error.code === 'ENOENT') continue
        throw error
      }
      const moved = await readOwner(aside)
      if (JSON.stringify(moved) !== JSON.stringify(found.owner)) {
        // Not the lock that was stale: someone published a live one after we looked. Put it back, and give way.
        await link(aside, lockFile).catch(() => {}) // if that place is taken again too, the lock moved is lost; the odds are those of three commands in one moment
        await rm(aside, { force: true })
        throw busy(moved?.pid ?? 'unknown')
      }
      await rm(aside, { force: true })
    }
    throw busy('unknown')
  } finally {
    await rm(staging, { force: true })
  }
}

/** Runs `work` while holding the lock at `lockFile`, or throws `busy(pid)` when another command holds it. */
export async function withProcessLock(lockFile, work, busy) {
  const mine = await acquire(lockFile, busy)
  try {
    return await work()
  } finally {
    // Only a lock that is still ours: one that a rival took over meanwhile is not for us to remove.
    if ((await readOwner(lockFile))?.nonce === mine.nonce) await rm(lockFile, { force: true })
  }
}

