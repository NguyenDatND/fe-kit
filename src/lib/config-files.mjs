import { createHash, randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { backupFile, lstatOrNull } from './fsx.mjs'
import { ConfigProblem } from './guard-config.mjs'

// Reading and replacing the configuration files of the tools, which belong to the person and which a tool may be
// writing at the same moment. A file is read as text, replaced through a new file in the same folder, and never
// replaced when it is no longer what was read.

/** The file changed (or appeared, or vanished) between the moment it was read and the moment it was to be replaced. */
export class ConfigChangedError extends Error {
  constructor(file) {
    super(`${file} changed while fe-kit was working on it (a tool may be writing it): close the tool and run the command again`)
  }
}

export const hashText = (text) => createHash('sha256').update(text).digest('hex')

/** The text of `file`, or null when it is not there. A link, a folder or anything else is a problem, so nothing is ever read through. */
export async function readTextIfExists(file) {
  const found = await lstatOrNull(file)
  if (found === null) return null
  if (found.isSymbolicLink()) throw new ConfigProblem(`${file} is a link: fe-kit does not change files through links, so make it a file or do the change yourself`)
  if (!found.isFile()) throw new ConfigProblem(`${file} is not a file`)
  return readFile(file, 'utf8')
}

/**
 * Replaces `file` with `text` (a new one is private to the user; an old one keeps its mode and is copied to `backupDir`
 * first). `expectedBefore` is what the file held when the new text was worked out, null for no file: right before the
 * swap it is read again, and if it differs nothing is replaced. `beforeCommit` is a seam for tests. Returns `{ backup }`.
 */
export async function writeTextSafely(file, text, { expectedBefore, backupDir, beforeCommit }) {
  await readTextIfExists(file) // refuses a link or a folder before anything is made
  await mkdir(dirname(file), { recursive: true })
  const existing = await lstatOrNull(file)
  let backup = null
  if (existing !== null) {
    await mkdir(backupDir, { recursive: true, mode: 0o700 })
    await chmod(backupDir, 0o700)
    backup = await backupFile(file, backupDir)
    await chmod(backup, 0o600)
  }
  const staging = `${file}.fe-kit-new-${process.pid}-${randomBytes(4).toString('hex')}`
  try {
    await writeFile(staging, text, { flag: 'wx', mode: 0o600 })
    if (existing !== null) await chmod(staging, existing.mode & 0o777)
    await beforeCommit?.()
    const now = await readTextIfExists(file) // again, as close to the swap as it gets
    if (now !== expectedBefore) throw new ConfigChangedError(file)
    await rename(staging, file)
  } catch (error) {
    await rm(staging, { force: true })
    throw error
  }
  return { backup }
}

/** Removes `file` after copying it to `backupDir`, if it still holds `expectedBefore`; otherwise leaves it. Returns `{ backup }`. */
export async function deleteFileSafely(file, { expectedBefore, backupDir, beforeCommit }) {
  if ((await readTextIfExists(file)) !== expectedBefore) throw new ConfigChangedError(file)
  await mkdir(backupDir, { recursive: true, mode: 0o700 })
  await chmod(backupDir, 0o700)
  const backup = await backupFile(file, backupDir)
  await chmod(backup, 0o600)
  await beforeCommit?.()
  if ((await readTextIfExists(file)) !== expectedBefore) throw new ConfigChangedError(file)
  await rm(file)
  return { backup }
}
