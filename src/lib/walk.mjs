import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { matchesGlob } from './glob.mjs'

const MAGIC = /[*?[\]{}\\]/
// Dependencies, git's own files and drafts are not documents of the project.
const SKIPPED_DIRECTORIES = new Set(['node_modules', '.git', '.fe-kit'])

const isFile = async (path) => (await stat(path).catch(() => null))?.isFile() ?? false

/** Relative paths of everything under `directory` that may be a file; directories that are symlinks are not entered. */
async function walk(root, directory, found, unreadable) {
  let entries
  try {
    entries = await readdir(join(root, directory), { withFileTypes: true })
  } catch (error) {
    // Not there is nothing to list; there but not readable is something the caller has to say, not an empty folder.
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') unreadable.push({ path: directory === '' ? '.' : directory, code: error.code ?? error.message })
    return
  }
  for (const entry of entries) {
    const relative = directory === '' ? entry.name : `${directory}/${entry.name}`
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) await walk(root, relative, found, unreadable)
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      found.push(relative)
    }
  }
}

/**
 * The files under `root` that the globs name, as sorted unique relative paths with `/` separators. A glob without
 * wildcards is one path; one with wildcards is searched for below its static prefix (`docs/frontend/**` walks only
 * `docs/frontend`). A symlink to a file is a file; a symlink to a directory is not followed. A glob that climbs out
 * of `root` with `..` is dropped and returned in `rejected`; a folder that exists and cannot be read is returned in
 * `unreadable` as `{ path, code }`.
 */
export async function expandGlobs(root, globs) {
  const found = new Set()
  const rejected = []
  const unreadable = []
  for (const original of globs) {
    const glob = original.replace(/^(?:\.\/)+/, '').replace(/^\/+/, '')
    const segments = glob.split('/')
    if (segments.includes('..')) {
      rejected.push(original)
      continue
    }
    const wildcard = segments.findIndex((segment) => MAGIC.test(segment))
    if (wildcard === -1) {
      if (await isFile(join(root, glob))) found.add(glob)
      continue
    }
    const candidates = []
    await walk(root, segments.slice(0, wildcard).join('/'), candidates, unreadable)
    for (const candidate of candidates) {
      if (matchesGlob(candidate, glob) && (await isFile(join(root, candidate)))) found.add(candidate)
    }
  }
  return { files: [...found].sort(), rejected, unreadable }
}
