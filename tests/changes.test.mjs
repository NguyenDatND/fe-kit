import assert from 'node:assert/strict'
import { chmod, mkdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { collectChanges } from '../src/lib/changes.mjs'
import { UsageError } from '../src/lib/errors.mjs'
import { canTestPermissions, commitAll, git, makeGitRepo, tempDir, writeTree } from './helpers.mjs'

/** A repo on `main` whose first commit holds `files`. */
async function repo(t, files) {
  const dir = await tempDir(t)
  await makeGitRepo(dir)
  await writeTree(dir, files)
  await commitAll(dir, 'base')
  return dir
}
const shown = ({ added }) => added.map(({ file, line, text }) => `${file}:${line}:${text}`)
const sha = async (dir, ref) => (await git(dir, 'rev-parse', ref)).trim()

test('changes since the merge-base include what is committed, uncommitted and untracked', async (t) => {
  const dir = await repo(t, { 'a.ts': 'one\ntwo\n', 'keep.ts': 'k\n' })
  await git(dir, 'checkout', '-q', '-b', 'feature')
  await writeTree(dir, { 'a.ts': 'one\ntwo\ncommitted\n' })
  await commitAll(dir, 'feature work')
  await writeTree(dir, { 'a.ts': 'one\ntwo\ncommitted\nuncommitted\n', 'new.ts': 'untracked line\n' })

  const changes = await collectChanges(dir, {})

  assert.deepEqual(shown(changes), ['a.ts:3:committed', 'a.ts:4:uncommitted', 'new.ts:1:untracked line'])
  assert.deepEqual(changes.files, ['a.ts', 'new.ts'])
  assert.equal(changes.scope, 'changed')
  assert.deepEqual(changes.base, { ref: 'main', mergeBase: await sha(dir, 'main') })
  assert.deepEqual(changes.notes, [])
})

test('the merge-base is where the branch left main, not where main is now', async (t) => {
  const dir = await repo(t, { 'a.ts': 'one\ntwo\n' })
  const fork = await sha(dir, 'HEAD')
  await git(dir, 'checkout', '-q', '-b', 'feature')
  await writeTree(dir, { 'feature.ts': 'mine\n' })
  await commitAll(dir, 'feature work')
  await git(dir, 'checkout', '-q', 'main')
  await writeTree(dir, { 'other.ts': 'not mine\n', 'a.ts': 'one\n' }) // main drops a line that the feature branch still has
  await commitAll(dir, 'main moved on')
  await git(dir, 'checkout', '-q', 'feature')

  const changes = await collectChanges(dir, {})

  assert.equal(changes.base.mergeBase, fork)
  assert.deepEqual(shown(changes), ['feature.ts:1:mine'])
})

test('an explicit base wins over the profile base, which wins over the default', async (t) => {
  const dir = await repo(t, { 'a.ts': 'one\n' })
  await git(dir, 'branch', 'dev')
  await git(dir, 'branch', 'release')

  assert.equal((await collectChanges(dir, { base: 'dev', profileBase: 'release' })).base.ref, 'dev')
  assert.equal((await collectChanges(dir, { profileBase: 'release' })).base.ref, 'release')
  assert.equal((await collectChanges(dir, {})).base.ref, 'main')
})

test('a profile base that does not exist here falls back to the default and says so', async (t) => {
  const dir = await repo(t, { 'a.ts': 'one\n' })

  const changes = await collectChanges(dir, { profileBase: 'origin/develop' })

  assert.equal(changes.base.ref, 'main')
  assert.deepEqual(changes.notes, ['baseBranch "origin/develop" of the profile was not found in this repository; using main'])
})

test('origin/HEAD is the first choice and is shown as the branch it points to', async (t) => {
  const dir = await repo(t, { 'a.ts': 'one\n' })
  const pushed = await sha(dir, 'HEAD')
  await git(dir, 'update-ref', 'refs/remotes/origin/main', pushed)
  await git(dir, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main')
  await writeTree(dir, { 'unpushed.ts': 'u\n' })
  await commitAll(dir, 'not pushed yet')

  const changes = await collectChanges(dir, {})

  assert.equal(changes.base.ref, 'origin/main')
  assert.equal(changes.base.mergeBase, pushed)
  assert.deepEqual(shown(changes), ['unpushed.ts:1:u'])
})

test('on the base branch itself only uncommitted and untracked changes count', async (t) => {
  const dir = await repo(t, { 'a.ts': 'one\n' })
  await writeTree(dir, { 'a.ts': 'one\ntwo\n', 'new.ts': 'n\n' })

  const changes = await collectChanges(dir, {})

  assert.deepEqual(shown(changes), ['a.ts:2:two', 'new.ts:1:n'])
  assert.equal(changes.base.mergeBase, await sha(dir, 'HEAD'))
})

test('with no base branch to be found it compares with HEAD and says so', async (t) => {
  const dir = await repo(t, { 'a.ts': 'one\n' })
  await git(dir, 'branch', '-m', 'trunk')
  await writeTree(dir, { 'a.ts': 'one\ntwo\n' })

  const changes = await collectChanges(dir, {})

  assert.deepEqual(shown(changes), ['a.ts:2:two'])
  assert.equal(changes.base.ref, 'HEAD')
  assert.deepEqual(changes.notes, ['no base branch found (origin/HEAD, origin/main, origin/master, main, master); comparing with HEAD, so only uncommitted changes count'])
})

test('a repository without commits has everything staged or untracked as added', async (t) => {
  const dir = await tempDir(t)
  await makeGitRepo(dir)
  await writeTree(dir, { 'staged.ts': 's1\ns2\n', 'loose.ts': 'l1\n' })
  await git(dir, 'add', 'staged.ts')

  const changes = await collectChanges(dir, {})

  assert.deepEqual(shown(changes), ['staged.ts:1:s1', 'staged.ts:2:s2', 'loose.ts:1:l1'])
  assert.deepEqual(changes.files, ['loose.ts', 'staged.ts'])
  assert.deepEqual(changes.notes, ['this repository has no commits yet, so everything counts as new'])
})

test('a repository that uses SHA-256 and has no commits yet is read like any other', async (t) => {
  const dir = await tempDir(t)
  try {
    await git(dir, 'init', '-q', '-b', 'main', '--object-format=sha256')
  } catch {
    t.skip('this git cannot make a SHA-256 repository')
    return
  }
  await writeTree(dir, { 'staged.ts': 's1\n', 'loose.ts': 'l1\n' })
  await git(dir, 'add', 'staged.ts')

  const changes = await collectChanges(dir, {})

  assert.deepEqual(shown(changes), ['staged.ts:1:s1', 'loose.ts:1:l1'])
})

test('a base that is not a commit, an option look-alike, a bad scope and a folder outside git are usage errors', async (t) => {
  const dir = await repo(t, { 'a.ts': 'one\n' })
  const notGit = await tempDir(t)

  await assert.rejects(collectChanges(dir, { base: 'nope' }), (error) => error instanceof UsageError && /unknown base "nope"/.test(error.message))
  await assert.rejects(collectChanges(dir, { base: '--output=/tmp/x' }), (error) => error instanceof UsageError)
  await assert.rejects(collectChanges(dir, { scope: 'everything' }), (error) => error instanceof UsageError && /--scope/.test(error.message))
  await assert.rejects(collectChanges(notGit, {}), (error) => error instanceof UsageError && /not a git repository/.test(error.message))
})

test('drafts under .fe-kit are never scanned, whether tracked or not', async (t) => {
  const dir = await repo(t, { 'a.ts': 'one\n', '.fe-kit/tracked.md': 't\n' })
  await writeTree(dir, { '.fe-kit/tracked.md': 't\nchanged\n', '.fe-kit/loose.md': 'l\n', 'src/b.ts': 'b\n' })

  const changes = await collectChanges(dir, {})

  assert.deepEqual(changes.files, ['src/b.ts'])
  assert.deepEqual(shown(changes), ['src/b.ts:1:b'])
})

test('a deleted file is not listed, a renamed file is listed under its new name', async (t) => {
  const body = 'a\nb\nc\nd\ne\nf\ng\nh\n'
  const dir = await repo(t, { 'gone.ts': 'x\n', 'old.ts': body })
  await rm(join(dir, 'gone.ts'))
  await rename(join(dir, 'old.ts'), join(dir, 'new.ts'))
  await git(dir, 'add', '-A')

  const changes = await collectChanges(dir, {})

  assert.deepEqual(changes.files, ['new.ts'])
  assert.deepEqual(changes.added, [])
})

test('an untracked binary file, an oversized file and a symlink are skipped and named, never read', async (t) => {
  const dir = await repo(t, { 'a.ts': 'one\n' })
  await writeFile(join(dir, 'pic.bin'), Buffer.from([1, 0, 2, 0]))
  await writeFile(join(dir, 'big.txt'), 'x'.repeat(50))
  await symlink('/etc/hosts', join(dir, 'link.txt'))
  await writeTree(dir, { 'fine.ts': 'ok\n' })

  const changes = await collectChanges(dir, { maxFileBytes: 20 })

  assert.deepEqual(shown(changes), ['fine.ts:1:ok'])
  assert.deepEqual(changes.skipped, [
    { file: 'big.txt', reason: 'larger than 20 bytes' },
    { file: 'link.txt', reason: 'symbolic link' },
    { file: 'pic.bin', reason: 'binary' },
  ])
  assert.deepEqual(changes.files, ['big.txt', 'fine.ts', 'link.txt', 'pic.bin'])
})

test('an untracked file with CRLF endings is read without the carriage returns', async (t) => {
  const dir = await repo(t, { 'a.ts': 'one\n' })
  await writeFile(join(dir, 'crlf.ts'), 'first\r\nsecond\r\n')

  assert.deepEqual(shown(await collectChanges(dir, {})), ['crlf.ts:1:first', 'crlf.ts:2:second'])
})

test('scope all takes every line of every file git would not ignore', async (t) => {
  const dir = await repo(t, { 'a.ts': 'one\ntwo\n', '.gitignore': 'dist/\n', 'dist/out.js': 'built\n', '.fe-kit/x.md': 'draft\n' })
  await mkdir(join(dir, 'src'))
  await writeFile(join(dir, 'src/new.ts'), 'n\n')

  const changes = await collectChanges(dir, { scope: 'all' })

  assert.equal(changes.scope, 'all')
  assert.equal(changes.base, null)
  assert.deepEqual(changes.files, ['.gitignore', 'a.ts', 'src/new.ts'])
  assert.deepEqual(shown(changes), ['.gitignore:1:dist/', 'a.ts:1:one', 'a.ts:2:two', 'src/new.ts:1:n'])
})

test('scope all skips a tracked file that is gone from the working tree', async (t) => {
  const dir = await repo(t, { 'a.ts': 'one\n', 'b.ts': 'two\n' })
  await rm(join(dir, 'b.ts'))

  const changes = await collectChanges(dir, { scope: 'all' })

  assert.deepEqual(changes.files, ['a.ts'])
})

test('a file that cannot be read is named as skipped, not taken for a deleted one', { skip: !canTestPermissions }, async (t) => {
  const dir = await repo(t, { 'a.ts': 'one\n' })
  await writeTree(dir, { 'secret.ts': 'x\n' })
  await chmod(join(dir, 'secret.ts'), 0o000)

  let changes
  try {
    changes = await collectChanges(dir, { scope: 'all' })
  } finally {
    await chmod(join(dir, 'secret.ts'), 0o644) // the temp folder is removed by a hook that runs before any `t.after` made here
  }

  assert.ok(changes.files.includes('secret.ts'))
  assert.deepEqual(changes.skipped, [{ file: 'secret.ts', reason: 'could not be read (EACCES)' }])
})

test('a file under the size limit with very many lines is read in full', async (t) => {
  const dir = await repo(t, { 'a.ts': 'one\n' })
  await writeFile(join(dir, 'long.txt'), 'x\n'.repeat(200_000))

  const changes = await collectChanges(dir, {})

  assert.equal(changes.added.length, 200_000)
})

test('a file whose folder cannot be searched is named as skipped, not taken for a deleted one', { skip: !canTestPermissions }, async (t) => {
  const dir = await repo(t, { 'locked/a.ts': 'one\n', 'b.ts': 'two\n' })
  await chmod(join(dir, 'locked'), 0o000)

  let changes
  try {
    changes = await collectChanges(dir, { scope: 'all' })
  } finally {
    await chmod(join(dir, 'locked'), 0o755)
  }

  assert.deepEqual(changes.skipped, [{ file: 'locked/a.ts', reason: 'could not be read (EACCES)' }])
})
