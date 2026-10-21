import { execFile } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { GIT_DIFF_ARGS } from './diff.mjs'
import { exists, isInside } from './fsx.mjs'

const execFileAsync = promisify(execFile)

/**
 * Runs git in `cwd`; null when git fails or is missing, which callers treat as "not a git repo". The output is trimmed
 * unless `raw` is set (diffs and NUL-separated lists must stay as they are); `maxBuffer` is for output that can be large.
 */
async function git(cwd, args, { raw = false, maxBuffer } = {}) {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer })
    return raw ? stdout : stdout.trim()
  } catch {
    return null
  }
}

/** Nearest directory at or above `cwd` (never above `stopAt`) that has a package.json, or null. */
export async function findPackageRoot(cwd, stopAt = '/') {
  const stop = resolve(stopAt)
  let dir = resolve(cwd)
  for (;;) {
    if (await exists(join(dir, 'package.json'))) return dir
    if (dir === stop || dirname(dir) === dir) return null
    dir = dirname(dir)
  }
}

/**
 * The git top-level; outside git, the nearest package.json directory, else `cwd` itself. Always a real path.
 * Outside git a package.json in the home directory (or above it) does not count: a stray ~/package.json
 * must not turn every scratch folder under it into a project.
 */
export async function findProjectRoot(cwd, { home = homedir() } = {}) {
  const here = await realpath(cwd)
  const top = await git(here, ['rev-parse', '--show-toplevel'])
  if (top) return { root: resolve(top), isGit: true }

  const realHome = await realpath(home).catch(() => resolve(home))
  const found = await findPackageRoot(here, isInside(here, realHome) ? realHome : '/')
  return { root: found && found !== realHome ? found : here, isGit: false }
}

/** Absolute path of the repo's `info/exclude` (worktrees and submodules keep it elsewhere than `.git/`). */
export async function getExcludeFile(root) {
  const path = await git(root, ['rev-parse', '--git-path', 'info/exclude'])
  return path ? resolve(root, path) : null
}

/** Files git tracks under `path` (relative to `root`): a list, empty when there are none; null when git cannot say. */
export async function listTracked(root, path) {
  const output = await git(root, ['ls-files', '--', path])
  if (output === null) return null // not a repo, or a broken index: not the same as "nothing tracked"
  return output === '' ? [] : output.split('\n')
}

export async function getRemotes(root) {
  const output = await git(root, ['config', '--get-regexp', '^remote\\..*\\.url$'])
  if (!output) return []
  return [...new Set(output.split('\n').map((line) => line.split(/\s+/)[1]).filter(Boolean))]
}

// A diff of the whole repository can be big (a lockfile, generated code), and execFile's default buffer is 1 MB.
const BIG_OUTPUT = 256 * 1024 * 1024
// What an unborn branch is compared with: the empty tree, which git knows without the object being stored. Its hash depends on the hash function of the repository.
const EMPTY_TREE_SHA1 = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
const EMPTY_TREE_SHA256 = '6ef19b41225c5369f1c104d45d8d85efa9b057b53b14b4b9b939dd74decc5321'
/** The branches tried, in this order, when nothing says which one a branch started from. */
export const DEFAULT_BASES = ['origin/HEAD', 'origin/main', 'origin/master', 'main', 'master']

const splitNul = (text) => text.split('\0').filter(Boolean)

export async function emptyTree(root) {
  return (await git(root, ['rev-parse', '--show-object-format'])) === 'sha256' ? EMPTY_TREE_SHA256 : EMPTY_TREE_SHA1
}

export async function isWorkTree(root) {
  return (await git(root, ['rev-parse', '--is-inside-work-tree'])) === 'true'
}

/** The commit `ref` names, as a full hash; null when it names none. A `ref` that looks like an option is never passed to git. */
export async function resolveCommit(root, ref) {
  if (ref.startsWith('-')) return null
  return git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])
}

/** Where `commit` and HEAD last had a common ancestor; null when they have none. */
export const getMergeBase = (root, commit) => git(root, ['merge-base', commit, 'HEAD'])

/** The first of the usual base branches that exists here (`origin/HEAD` is shown as the branch it points to), or null. */
export async function findDefaultBase(root) {
  for (const candidate of DEFAULT_BASES) {
    const commit = await resolveCommit(root, candidate)
    if (!commit) continue
    const ref = candidate === 'origin/HEAD' ? ((await git(root, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])) ?? candidate) : candidate
    return { ref, commit }
  }
  return null
}

/** The diff (as `GIT_DIFF_ARGS` makes it) of the working tree against `commit`; null when git fails. */
export const getPatch = (root, commit) => git(root, [...GIT_DIFF_ARGS, commit, '--'], { raw: true, maxBuffer: BIG_OUTPUT })

/** Paths that differ from `commit` and still exist: added, copied, modified, renamed (new name) or retyped. Null when git fails. */
export async function getChangedPaths(root, commit) {
  const args = ['diff', '--name-only', '--diff-filter=ACMRT', '-z', '-M', '--ignore-submodules=all', commit, '--']
  const output = await git(root, args, { raw: true, maxBuffer: BIG_OUTPUT })
  return output === null ? null : splitNul(output)
}

/** Files git neither tracks nor ignores; null when git fails. */
export async function listUntracked(root) {
  const output = await git(root, ['ls-files', '--others', '--exclude-standard', '-z'], { raw: true, maxBuffer: BIG_OUTPUT })
  return output === null ? null : splitNul(output)
}

/** Every file git tracks or would let you add, whether or not it is still on disk; null when git fails. */
export async function listAllFiles(root) {
  const output = await git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { raw: true, maxBuffer: BIG_OUTPUT })
  return output === null ? null : splitNul(output)
}
