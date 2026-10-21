import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** chmod-based tests cannot work as root or on Windows. */
export const canTestPermissions = process.platform !== 'win32' && process.getuid?.() !== 0

/** Creates a temp directory that is removed after the test. Resolved, because macOS tmpdir is a symlink. */
export async function tempDir(t, prefix = 'fe-kit-test-') {
  const dir = await realpath(await mkdtemp(join(tmpdir(), prefix)))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

/** Writes a { 'relative/path': 'content' } tree under dir. */
export async function writeTree(dir, files) {
  for (const [relative, content] of Object.entries(files)) {
    const file = join(dir, relative)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, content)
  }
}

/** git init in dir, optionally with an origin remote. */
export async function makeGitRepo(dir, { remote } = {}) {
  await run('git', ['init', '-q', '-b', 'main'], { cwd: dir })
  if (remote) await run('git', ['remote', 'add', 'origin', remote], { cwd: dir })
}

export function git(dir, ...args) {
  return run('git', args, { cwd: dir }).then(({ stdout }) => stdout)
}

/** Stages everything and commits it, with an identity of its own so that a machine without one still works. */
export async function commitAll(dir, message = 'commit') {
  await git(dir, 'add', '-A')
  await git(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', message)
}
