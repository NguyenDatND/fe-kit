import { lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseAddedLines } from './diff.mjs'
import { UsageError } from './errors.mjs'
import {
  DEFAULT_BASES,
  emptyTree,
  findDefaultBase,
  getChangedPaths,
  getMergeBase,
  getPatch,
  isWorkTree,
  listAllFiles,
  listUntracked,
  resolveCommit,
} from './git.mjs'

const MAX_FILE_BYTES = 1024 * 1024
const BINARY_SNIFF_BYTES = 8000 // what git itself looks at

/**
 * The reason given for a file that is there but could not be read. Unlike a binary, a symbolic link or a large file,
 * which are left out on purpose, it hides lines that may hold findings.
 */
export const UNREADABLE = 'could not be read'
export const unreadableFiles = (skipped) => skipped.filter(({ reason }) => reason.startsWith(UNREADABLE))

// Drafts are never code, and git status does not show them, so they are not scanned or listed either.
const isDraft = (path) => path === '.fe-kit' || path.startsWith('.fe-kit/')

/** Every line of one file as an added line; or why it is not read (`reason`), or that it is not a file any more (`gone`). */
async function readWhole(root, file, maxBytes) {
  const path = join(root, file)
  let info
  try {
    info = await lstat(path)
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return { gone: true }
    return { reason: `${UNREADABLE} (${error.code ?? error.message})` }
  }
  if (!info.isFile() && !info.isSymbolicLink()) return { gone: true } // a directory (a submodule)
  if (info.isSymbolicLink()) return { reason: 'symbolic link' }
  if (info.size > maxBytes) return { reason: `larger than ${maxBytes} bytes` }
  let buffer
  try {
    buffer = await readFile(path)
  } catch (error) {
    if (error.code === 'ENOENT') return { gone: true }
    return { reason: `${UNREADABLE} (${error.code ?? error.message})` } // a file that is there but unreadable is not a deleted one
  }
  if (buffer.subarray(0, BINARY_SNIFF_BYTES).includes(0)) return { reason: 'binary' }
  const lines = buffer.toString('utf8').split('\n')
  if (lines.at(-1) === '') lines.pop()
  return { lines: lines.map((text, index) => ({ file, line: index + 1, text: text.replace(/\r$/, '') })) }
}

/** Reads whole files: `added` gets their lines, `skipped` the ones that were not read and why, `gone` the ones that are not there. */
async function readFiles(root, files, maxBytes) {
  const added = []
  const skipped = []
  const gone = new Set()
  for (const file of files) {
    const read = await readWhole(root, file, maxBytes)
    if (read.lines) for (const line of read.lines) added.push(line) // not `push(...lines)`: a big file would overflow the call stack
    else if (read.reason) skipped.push({ file, reason: read.reason })
    else gone.add(file)
  }
  return { added, skipped, gone }
}

/** An explicit base, else the profile's, else the first usual one. Null (with a note) when there is none to be found. */
async function chooseBase(root, { base, profileBase }, notes) {
  if (base !== undefined) {
    const commit = await resolveCommit(root, base)
    if (!commit) throw new UsageError(`unknown base "${base}": it is not a commit in this repository`)
    return { ref: base, commit }
  }
  if (profileBase !== undefined) {
    const commit = await resolveCommit(root, profileBase)
    if (commit) return { ref: profileBase, commit }
  }
  const found = await findDefaultBase(root)
  if (profileBase !== undefined) {
    notes.push(`baseBranch "${profileBase}" of the profile was not found in this repository; using ${found?.ref ?? 'HEAD'}`)
  }
  if (!found) notes.push(`no base branch found (${DEFAULT_BASES.join(', ')}); comparing with HEAD, so only uncommitted changes count`)
  return found
}

/**
 * The lines this work adds. `changed` (default): everything since the branch left its base branch, committed or not,
 * plus files git does not know yet. `all`: every line of every file git would not ignore.
 * Returns `{ scope, base, files, added, skipped, notes }`: `files` are the changed (or all) paths, `added` the lines
 * as `{ file, line, text }`, `skipped` the files that were not read and why, `notes` anything that fell back.
 */
export async function collectChanges(root, { scope = 'changed', base, profileBase, maxFileBytes = MAX_FILE_BYTES } = {}) {
  if (scope !== 'changed' && scope !== 'all') throw new UsageError(`--scope must be "changed" or "all", not "${scope}"`)
  if (!(await isWorkTree(root))) throw new UsageError('not a git repository: scan and verify look at what git says changed')

  const notes = []
  const fail = () => new Error('git could not list the changes')

  if (scope === 'all') {
    const listed = await listAllFiles(root)
    if (listed === null) throw fail()
    const candidates = listed.filter((file) => !isDraft(file)).sort()
    const { added, skipped, gone } = await readFiles(root, candidates, maxFileBytes)
    return { scope, base: null, files: candidates.filter((file) => !gone.has(file)), added, skipped, notes }
  }

  const head = await resolveCommit(root, 'HEAD')
  let comparedWith = null
  let baseInfo = null
  if (head) {
    const chosen = await chooseBase(root, { base, profileBase }, notes)
    let mergeBase = chosen ? await getMergeBase(root, chosen.commit) : null
    if (chosen && !mergeBase) notes.push(`${chosen.ref} and HEAD have no common ancestor; comparing with HEAD`)
    mergeBase ??= head
    comparedWith = mergeBase
    baseInfo = { ref: mergeBase === head && !chosen ? 'HEAD' : (chosen?.ref ?? 'HEAD'), mergeBase }
  } else {
    if (base !== undefined) throw new UsageError(`unknown base "${base}": this repository has no commits yet`)
    comparedWith = await emptyTree(root)
    notes.push('this repository has no commits yet, so everything counts as new')
  }

  const [patch, changedPaths, untracked] = await Promise.all([getPatch(root, comparedWith), getChangedPaths(root, comparedWith), listUntracked(root)])
  if (patch === null || changedPaths === null || untracked === null) throw fail()

  const loose = untracked.filter((file) => !isDraft(file)).sort()
  const files = [...new Set([...changedPaths, ...loose])].filter((file) => !isDraft(file)).sort()
  const added = parseAddedLines(patch).filter(({ file }) => !isDraft(file))
  const whole = await readFiles(root, loose, maxFileBytes)
  return {
    scope,
    base: baseInfo,
    files,
    added: [...added, ...whole.added],
    skipped: whole.skipped,
    notes,
  }
}
