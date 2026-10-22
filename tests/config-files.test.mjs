import assert from 'node:assert/strict'
import { chmod, lstat, mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { ConfigChangedError, deleteFileSafely, hashText, readTextIfExists, writeTextSafely } from '../src/lib/config-files.mjs'
import { ConfigProblem } from '../src/lib/guard-config.mjs'
import { canTestPermissions, tempDir } from './helpers.mjs'

const mode = async (file) => (await lstat(file)).mode & 0o777

test('a file that is not there is null; one that is there is read as text', async (t) => {
  const dir = await tempDir(t)
  assert.equal(await readTextIfExists(join(dir, 'none.json')), null)
  await writeFile(join(dir, 'a.json'), '{"é":1}\n')
  assert.equal(await readTextIfExists(join(dir, 'a.json')), '{"é":1}\n')
  assert.equal(await readTextIfExists(join(dir, 'missing-folder', 'a.json')), null)
})

test('a link, a folder or a file that cannot be read is a problem, never read through', async (t) => {
  const dir = await tempDir(t)
  await writeFile(join(dir, 'real.json'), '{}')
  await symlink(join(dir, 'real.json'), join(dir, 'link.json'))
  await mkdir(join(dir, 'folder.json'))
  await assert.rejects(readTextIfExists(join(dir, 'link.json')), (error) => error instanceof ConfigProblem && /link/.test(error.message))
  await assert.rejects(readTextIfExists(join(dir, 'folder.json')), (error) => error instanceof ConfigProblem && /not a file/.test(error.message))
})

test('a new file is made with the folders above it, private to the user', { skip: !canTestPermissions }, async (t) => {
  const dir = await tempDir(t)
  const file = join(dir, 'a/b/settings.json')
  const result = await writeTextSafely(file, '{"x":1}\n', { expectedBefore: null, backupDir: join(dir, 'backups') })
  assert.equal(await readFile(file, 'utf8'), '{"x":1}\n')
  assert.equal(await mode(file), 0o600)
  assert.equal(result.backup, null)
  assert.deepEqual(await readdir(join(dir, 'a/b')), ['settings.json'])
})

test('an existing file is backed up first, privately, and keeps its own mode', { skip: !canTestPermissions }, async (t) => {
  const dir = await tempDir(t)
  const file = join(dir, 'settings.json')
  await writeFile(file, '{"old":true}\n')
  await chmod(file, 0o640)
  const { backup } = await writeTextSafely(file, '{"new":true}\n', { expectedBefore: '{"old":true}\n', backupDir: join(dir, 'backups') })
  assert.equal(await readFile(backup, 'utf8'), '{"old":true}\n')
  assert.equal(await mode(backup), 0o600)
  assert.equal(await mode(join(dir, 'backups')), 0o700)
  assert.equal(await readFile(file, 'utf8'), '{"new":true}\n')
  assert.equal(await mode(file), 0o640)
  assert.deepEqual((await readdir(dir)).sort(), ['backups', 'settings.json'])
})

test('a file that changed since it was read is left as it is, and nothing of ours stays behind', async (t) => {
  const dir = await tempDir(t)
  const file = join(dir, 'settings.json')
  await writeFile(file, '{"old":true}\n')
  const changeIt = () => writeFile(file, '{"the tool wrote this":true}\n')
  await assert.rejects(writeTextSafely(file, '{"new":true}\n', { expectedBefore: '{"old":true}\n', backupDir: join(dir, 'backups'), beforeCommit: changeIt }), ConfigChangedError)
  assert.equal(await readFile(file, 'utf8'), '{"the tool wrote this":true}\n')
  assert.deepEqual((await readdir(dir)).filter((name) => name.includes('fe-kit-new')), [])

  const appear = () => writeFile(join(dir, 'fresh.json'), '{"someone":1}\n')
  await assert.rejects(writeTextSafely(join(dir, 'fresh.json'), '{"new":true}\n', { expectedBefore: null, backupDir: join(dir, 'backups'), beforeCommit: appear }), ConfigChangedError)
  assert.equal(await readFile(join(dir, 'fresh.json'), 'utf8'), '{"someone":1}\n')

  const vanish = () => import('node:fs/promises').then(({ rm }) => rm(file))
  await assert.rejects(writeTextSafely(file, 'x', { expectedBefore: '{"the tool wrote this":true}\n', backupDir: join(dir, 'backups'), beforeCommit: vanish }), ConfigChangedError)
})

test('a file that is a link is not written through or over', async (t) => {
  const dir = await tempDir(t)
  await writeFile(join(dir, 'real.json'), '{"real":1}\n')
  await symlink(join(dir, 'real.json'), join(dir, 'link.json'))
  await assert.rejects(writeTextSafely(join(dir, 'link.json'), '{}', { expectedBefore: '{"real":1}\n', backupDir: join(dir, 'backups') }), ConfigProblem)
  assert.equal(await readFile(join(dir, 'real.json'), 'utf8'), '{"real":1}\n')
})

test('hashes tell texts apart', () => {
  assert.match(hashText('a'), /^[0-9a-f]{64}$/)
  assert.equal(hashText('a'), hashText('a'))
  assert.notEqual(hashText('a'), hashText('b'))
})

test('a file is deleted only if it still holds what was read, after a copy is kept', async (t) => {
  const dir = await tempDir(t)
  const file = join(dir, 'a.rules')
  await writeFile(file, 'one')
  const { backup } = await deleteFileSafely(file, { expectedBefore: 'one', backupDir: join(dir, 'backups') })
  assert.equal(await readFile(backup, 'utf8'), 'one')
  assert.equal(await readTextIfExists(file), null)

  await writeFile(file, 'two')
  await assert.rejects(deleteFileSafely(file, { expectedBefore: 'one', backupDir: join(dir, 'backups') }), ConfigChangedError)
  assert.equal(await readFile(file, 'utf8'), 'two')
  assert.equal((await readdir(join(dir, 'backups'))).length, 1, 'no copy is made of a file that is not the one that was read')
  const change = () => writeFile(file, 'three')
  await assert.rejects(deleteFileSafely(file, { expectedBefore: 'two', backupDir: join(dir, 'backups'), beforeCommit: change }), ConfigChangedError)
  assert.equal(await readFile(file, 'utf8'), 'three')
})
