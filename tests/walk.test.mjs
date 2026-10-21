import assert from 'node:assert/strict'
import { chmod, mkdir, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { expandGlobs } from '../src/lib/walk.mjs'
import { canTestPermissions, tempDir, writeTree } from './helpers.mjs'

async function expand(t, files, globs) {
  const dir = await tempDir(t)
  await writeTree(dir, files)
  return { dir, ...(await expandGlobs(dir, globs)) }
}

test('a path without wildcards is taken as it is when it is a file, and ignored when it is not there', async (t) => {
  const { files } = await expand(t, { 'CONTRIBUTING.md': 'c', 'docs/a.md': 'a' }, ['CONTRIBUTING.md', 'MISSING.md', 'docs'])

  assert.deepEqual(files, ['CONTRIBUTING.md'])
})

test('wildcards are expanded below their static prefix', async (t) => {
  const { files } = await expand(t, { 'docs/frontend/react.md': 'r', 'docs/frontend/deep/ts.md': 't', 'docs/backend/db.md': 'd', 'docs/frontend/x.txt': 'x' }, [
    'docs/frontend/**/*.md',
  ])

  assert.deepEqual(files, ['docs/frontend/deep/ts.md', 'docs/frontend/react.md'])
})

test('a wildcard in the first segment walks from the root, and braces work', async (t) => {
  const { files } = await expand(t, { 'docs/a.md': 'a', 'guides/b.md': 'b', 'other/c.md': 'c' }, ['{docs,guides}/*.md'])

  assert.deepEqual(files, ['docs/a.md', 'guides/b.md'])
})

test('node_modules, .git and .fe-kit are never walked', async (t) => {
  const { files } = await expand(t, { 'a.md': 'a', 'node_modules/pkg/readme.md': 'n', '.git/notes.md': 'g', '.fe-kit/drafts.md': 'd', 'src/node_modules/x/y.md': 'y' }, ['**/*.md'])

  assert.deepEqual(files, ['a.md'])
})

test('a symlinked directory is not followed, a symlinked file is a file', async (t) => {
  const dir = await tempDir(t)
  const outside = await tempDir(t)
  await writeTree(outside, { 'secret.md': 's' })
  await writeTree(dir, { 'CLAUDE.md': 'c', 'docs/a.md': 'a' })
  await symlink(outside, join(dir, 'docs/linked'))
  await symlink('CLAUDE.md', join(dir, 'AGENTS.md'))
  await symlink('a.md', join(dir, 'docs/alias.md'))

  const { files } = await expandGlobs(dir, ['docs/**/*.md', 'AGENTS.md'])

  assert.deepEqual(files, ['AGENTS.md', 'docs/a.md', 'docs/alias.md'])
})

test('a symlink that does not lead to a file is not a file', async (t) => {
  const dir = await tempDir(t)
  await writeTree(dir, { 'docs/real.md': 'r', 'folder/readme.md': 'f' })
  await symlink('nowhere', join(dir, 'docs/broken.md'))
  await symlink(join(dir, 'folder'), join(dir, 'docs/folder.md'))

  const { files } = await expandGlobs(dir, ['docs/*.md'])

  assert.deepEqual(files, ['docs/real.md'])
})

test('a glob that leaves the project is dropped and named', async (t) => {
  const dir = await tempDir(t)
  const outside = await tempDir(t)
  await writeTree(outside, { 'x.md': 'x' })
  await mkdir(join(dir, 'sub'))

  const { files, rejected } = await expandGlobs(join(dir, 'sub'), ['../x.md', '/etc/hosts', 'ok/../../x.md'])

  assert.deepEqual(files, [])
  assert.deepEqual(rejected, ['../x.md', 'ok/../../x.md'])
})

test('a leading ./ or / means the project root, and results come back unique and sorted', async (t) => {
  const { files } = await expand(t, { 'b.md': 'b', 'a.md': 'a' }, ['./b.md', '/a.md', '*.md'])

  assert.deepEqual(files, ['a.md', 'b.md'])
})

test('no globs, or a root that is not there, give no files', async (t) => {
  assert.deepEqual((await expand(t, { 'a.md': 'a' }, [])).files, [])
  assert.deepEqual((await expandGlobs(join(await tempDir(t), 'missing'), ['**/*.md'])).files, [])
})

test('a folder that cannot be read is reported, not taken for an empty one', { skip: !canTestPermissions }, async (t) => {
  const dir = await tempDir(t)
  await writeTree(dir, { 'docs/a.md': 'a', 'docs/locked/b.md': 'b' })
  await chmod(join(dir, 'docs/locked'), 0o000)

  let result
  try {
    result = await expandGlobs(dir, ['docs/**/*.md'])
  } finally {
    await chmod(join(dir, 'docs/locked'), 0o755)
  }

  assert.deepEqual(result.files, ['docs/a.md'])
  assert.deepEqual(result.unreadable, [{ path: 'docs/locked', code: 'EACCES' }])
})
