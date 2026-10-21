import { createHash, randomUUID } from 'node:crypto'
import {
  access,
  constants,
  copyFile,
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

/** Written inside every copy the kit makes, so a copy can be told apart from someone else's directory. */
export const MARKER = '.fe-kit-managed'

export const exists = (path) =>
  access(path).then(
    () => true,
    () => false,
  )

/** lstat, but null when the path is absent. A broken symlink still counts as present. */
export async function lstatOrNull(path) {
  try {
    return await lstat(path)
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null
    throw error
  }
}

/** True when `path` is `parent` or lies below it. Purely lexical: resolve symlinks first if that matters. */
export function isInside(path, parent) {
  const rel = relative(resolve(parent), resolve(path))
  return rel === '' || !(rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
}

export function defaultLinkMode(platform = process.platform) {
  return platform === 'win32' ? 'junction' : 'symlink'
}

async function linkPointsAt(link, source) {
  return resolve(dirname(link), await readlink(link)) === resolve(source)
}

/**
 * What the kit wrote into a copy, or null when the directory holds nothing the kit could have written:
 * only a regular file with `{ source, hash }` counts, so a directory that merely has a path of that name
 * (empty, not JSON, a symlink, a folder) is never taken for the kit's own and never gets removed.
 */
async function readMarker(directory) {
  try {
    const file = join(directory, MARKER)
    if (!(await lstat(file)).isFile()) return null
    const marker = JSON.parse(await readFile(file, 'utf8'))
    return typeof marker?.source === 'string' && typeof marker?.hash === 'string' ? marker : null
  } catch {
    return null
  }
}

/** Content hash of a directory tree (names and bytes; symlinks by their target text). */
async function hashTree(directory) {
  const hash = createHash('sha256')
  async function walk(dir) {
    const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1))
    for (const entry of entries) {
      const path = join(dir, entry.name)
      const name = relative(directory, path)
      if (entry.isSymbolicLink()) {
        hash.update(`l:${name}\0${await readlink(path)}\0`)
      } else if (entry.isDirectory()) {
        hash.update(`d:${name}\0`)
        await walk(path)
      } else {
        hash.update(`f:${name}\0`)
        hash.update(await readFile(path))
      }
    }
  }
  await walk(directory)
  return hash.digest('hex')
}

/**
 * Copies `source` next to `target` under a name nobody else has, then swaps it in with renames, so a failure
 * leaves the previous copy untouched and an interrupted run leaves nothing at `target` that looks half done.
 * Only the staging directory this call created is ever removed.
 */
async function copyAtomically(source, target, hash, replaceExisting) {
  const id = randomUUID()
  const staging = `${target}.fe-kit-new-${id}`
  const previous = `${target}.fe-kit-old-${id}`
  try {
    // cp copies a symlink as a symlink, so a source that is itself a link to a directory is resolved first.
    await cp(await realpath(source), staging, { recursive: true, force: false, errorOnExist: true })
    // The source may carry a path named like the marker (even a symlink to a file elsewhere): drop it and
    // create the marker exclusively, so the write can never travel through a link out of the copy.
    await rm(join(staging, MARKER), { recursive: true, force: true })
    await writeFile(join(staging, MARKER), `${JSON.stringify({ source: resolve(source), hash })}\n`, { flag: 'wx' })
    if (!replaceExisting) {
      await rename(staging, target)
      return
    }
    await rename(target, previous)
    try {
      await rename(staging, target)
    } catch (error) {
      // Put the old copy back. If that fails too it may be the only copy left, and nothing proves that whatever
      // now sits at `target` is a valid replacement, so it stays where it is and the error says where.
      try {
        await rename(previous, target)
      } catch {
        throw new Error(`${error.message} (the previous copy is kept at ${previous})`, { cause: error })
      }
      throw error
    }
    await rm(previous, { recursive: true, force: true })
  } catch (error) {
    try {
      await rm(staging, { recursive: true, force: true })
    } catch (cleanupError) {
      // The error above may be the one that says where the old copy was kept; do not replace it.
      throw new Error(`${error.message} (also could not remove ${staging}: ${cleanupError.message})`, { cause: error })
    }
    throw error
  }
}

/**
 * Makes `target` a symlink (junction on Windows) to `source`, or a marked copy of it.
 * Idempotent, and never overwrites anything the kit did not create. A managed copy is replaced only
 * when the source tree changed, so a hand edit survives until then.
 * @returns {Promise<{ action: 'create' | 'update' | 'unchanged' | 'skip-foreign', mode: string, target: string }>}
 */
export async function installDirectory(source, target, { mode = defaultLinkMode(), dryRun = false } = {}) {
  try {
    await stat(source)
  } catch {
    throw new Error(`source not found: ${source}`)
  }

  const found = await lstatOrNull(target)
  const sourceHash = mode === 'copy' ? await hashTree(source) : null
  let action = 'create'
  let existing = null // what sits at the target and gets replaced: 'link' or 'copy'

  if (found) {
    const marker = found.isDirectory() ? await readMarker(target) : null
    if (found.isSymbolicLink() && (await linkPointsAt(target, source))) {
      if (mode !== 'copy') return { action: 'unchanged', mode, target }
      action = 'update'
      existing = 'link'
    } else if (marker) {
      if (mode === 'copy' && marker.hash === sourceHash) return { action: 'unchanged', mode, target }
      action = 'update'
      existing = 'copy'
    } else {
      return { action: 'skip-foreign', mode, target }
    }
  }
  if (dryRun) return { action, mode, target }

  await mkdir(dirname(target), { recursive: true })
  if (mode === 'copy') {
    if (existing === 'link') await unlink(target)
    await copyAtomically(source, target, sourceHash, existing === 'copy')
  } else {
    if (existing === 'copy') await rm(target, { recursive: true })
    await symlink(resolve(source), target, mode === 'junction' ? 'junction' : 'dir')
  }
  return { action, mode, target }
}

/**
 * Removes a link to `source` or a marked copy. Anything else is left alone.
 * A symlink is only removed when `source` is given and it points there.
 */
export async function removeInstalled(target, { source, dryRun = false } = {}) {
  const found = await lstatOrNull(target)
  if (!found) return { action: 'missing', target }

  const ours = found.isSymbolicLink()
    ? source !== undefined && (await linkPointsAt(target, source))
    : found.isDirectory() && (await readMarker(target)) !== null
  if (!ours) return { action: 'skip-foreign', target }

  if (!dryRun) await (found.isSymbolicLink() ? unlink(target) : rm(target, { recursive: true }))
  return { action: 'removed', target }
}

/** Copies `file` into `backupDir` as `<name>.<timestamp>.bak`; never overwrites an earlier backup. */
export async function backupFile(file, backupDir, { now = () => new Date() } = {}) {
  await mkdir(backupDir, { recursive: true })
  const stamp = now().toISOString().replace(/[:.]/g, '-')
  for (let attempt = 0; ; attempt++) {
    const suffix = attempt === 0 ? '' : `-${attempt}`
    const destination = join(backupDir, `${basename(file)}.${stamp}${suffix}.bak`)
    try {
      await copyFile(file, destination, constants.COPYFILE_EXCL)
      return destination
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
  }
}
