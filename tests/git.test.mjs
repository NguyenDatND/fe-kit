import assert from 'node:assert/strict'
import { mkdir, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { findPackageRoot, findProjectRoot, getExcludeFile, getRemotes, listTracked } from '../src/lib/git.mjs'
import { git, makeGitRepo, tempDir, writeTree } from './helpers.mjs'

test('findProjectRoot returns the git top-level from a nested directory', async (t) => {
  const repo = await tempDir(t)
  await makeGitRepo(repo)
  await writeTree(repo, { 'packages/web/src/app.ts': '' })

  const found = await findProjectRoot(join(repo, 'packages/web/src'))

  assert.deepEqual(found, { root: repo, isGit: true })
})

test('findProjectRoot outside git falls back to the nearest package.json, then to cwd', async (t) => {
  const dir = await tempDir(t)
  await writeTree(dir, { 'app/package.json': '{}', 'app/src/index.ts': '', 'loose/readme.txt': '' })

  const withPackage = await findProjectRoot(join(dir, 'app/src'), { home: dir })
  const without = await findProjectRoot(join(dir, 'loose'), { home: dir })

  assert.deepEqual(withPackage, { root: join(dir, 'app'), isGit: false })
  assert.deepEqual(without, { root: join(dir, 'loose'), isGit: false })
})

test('findPackageRoot walks up to the nearest package.json and stops at the limit', async (t) => {
  const repo = await tempDir(t)
  await writeTree(repo, {
    'package.json': '{}',
    'packages/web/package.json': '{}',
    'packages/web/src/deep/file.ts': '',
    'packages/ui/file.ts': '',
  })

  assert.equal(await findPackageRoot(join(repo, 'packages/web/src/deep'), repo), join(repo, 'packages/web'))
  assert.equal(await findPackageRoot(join(repo, 'packages/ui'), repo), repo)
  await writeTree(repo, { 'tools/x.ts': '' })
  assert.equal(await findPackageRoot(join(repo, 'tools'), join(repo, 'tools')), null)
})

test('getExcludeFile finds info/exclude of a repo and is null outside one', async (t) => {
  const repo = await tempDir(t)
  await makeGitRepo(repo)
  const loose = await tempDir(t)

  assert.equal(await getExcludeFile(repo), join(repo, '.git/info/exclude'))
  assert.equal(await getExcludeFile(loose), null)
})

test('getRemotes lists each remote url once and is empty without remotes', async (t) => {
  const withRemote = await tempDir(t)
  await makeGitRepo(withRemote, { remote: 'git@gitlab.example.com:fe/shop-web.git' })
  const without = await tempDir(t)
  await makeGitRepo(without)

  assert.deepEqual(await getRemotes(withRemote), ['git@gitlab.example.com:fe/shop-web.git'])
  assert.deepEqual(await getRemotes(without), [])
})

test('findProjectRoot ignores a stray package.json in the home directory', async (t) => {
  const home = await tempDir(t)
  await writeTree(home, {
    'package.json': '{}',
    'scratch/notes.txt': '',
    'work/app/package.json': '{}',
    'work/app/src/index.ts': '',
  })

  assert.deepEqual(await findProjectRoot(join(home, 'scratch'), { home }), { root: join(home, 'scratch'), isGit: false })
  assert.deepEqual(await findProjectRoot(join(home, 'work/app/src'), { home }), { root: join(home, 'work/app'), isGit: false })
})

test('findProjectRoot returns the real path when the caller came in through a symlink', async (t) => {
  const dir = await tempDir(t)
  await writeTree(dir, { 'real/package.json': '{}' })
  await symlink(join(dir, 'real'), join(dir, 'alias'))
  const repo = join(dir, 'real-repo')
  await mkdir(repo)
  await makeGitRepo(repo)
  await symlink(repo, join(dir, 'repo-alias'))

  assert.equal((await findProjectRoot(join(dir, 'alias'), { home: dir })).root, join(dir, 'real'))
  assert.equal((await findProjectRoot(join(dir, 'repo-alias'), { home: dir })).root, repo)
})

test('getExcludeFile of a linked worktree is the shared info/exclude of the main repo', async (t) => {
  const base = await tempDir(t)
  const repo = join(base, 'repo')
  await mkdir(repo)
  await makeGitRepo(repo)
  await git(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '--allow-empty', '-m', 'init')
  await git(repo, 'worktree', 'add', join(base, 'wt'))

  assert.equal(await getExcludeFile(join(base, 'wt')), join(repo, '.git/info/exclude'))
})

test('listTracked lists what git tracks under a path, and is empty when nothing is', async (t) => {
  const repo = await tempDir(t)
  await makeGitRepo(repo)
  await writeTree(repo, { '.fe-kit/leaked.md': 'x', '.fe-kit/untracked.md': 'y', 'src/app.ts': '' })
  await git(repo, 'add', '-f', '.fe-kit/leaked.md', 'src/app.ts')

  assert.deepEqual(await listTracked(repo, '.fe-kit'), ['.fe-kit/leaked.md'])
  assert.deepEqual(await listTracked(repo, 'docs'), [])
})

test('listTracked answers null, not an empty list, when git cannot say: outside a repo or with a broken index', async (t) => {
  const loose = await tempDir(t)
  const broken = await tempDir(t)
  await makeGitRepo(broken)
  await writeFile(join(broken, '.git/index'), 'garbage')

  assert.equal(await listTracked(loose, '.fe-kit'), null)
  assert.equal(await listTracked(broken, '.fe-kit'), null)
})
