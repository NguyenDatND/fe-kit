import assert from 'node:assert/strict'
import fsPromises, { chmod, lstat, mkdir, readdir, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { join } from 'node:path'
import { test } from 'node:test'
import { backupFile, defaultLinkMode, installDirectory, removeInstalled } from '../src/lib/fsx.mjs'
import { canTestPermissions, tempDir, writeTree } from './helpers.mjs'

async function exists(path) {
  return lstat(path).then(() => true, () => false)
}

async function makeSource(t, files = { 'SKILL.md': 'v1' }) {
  const root = await tempDir(t)
  const source = join(root, 'source dir')
  await writeTree(source, files)
  return { root, source }
}

/**
 * Replaces one fs.promises function until the test ends, so a failure can be injected at an exact step.
 * syncBuiltinESMExports is what makes the named imports inside fsx.mjs see the replacement.
 */
function injectFs(t, name, implementation) {
  const original = fsPromises[name]
  const patch = t.mock.method(fsPromises, name, (...args) => implementation(original, ...args))
  syncBuiltinESMExports()
  t.after(() => {
    patch.mock.restore()
    syncBuiltinESMExports()
  })
}
const enospc = () => Object.assign(new Error('ENOSPC: injected'), { code: 'ENOSPC' })
const withoutSource = async (root) => (await readdir(root)).filter((name) => name !== 'source dir').sort()

test('defaultLinkMode uses junctions on Windows and symlinks elsewhere', () => {
  assert.equal(defaultLinkMode('win32'), 'junction')
  assert.equal(defaultLinkMode('darwin'), 'symlink')
  assert.equal(defaultLinkMode('linux'), 'symlink')
})

test('installDirectory creates a symlink, then reports unchanged', async (t) => {
  const { root, source } = await makeSource(t)
  const target = join(root, 'tool', 'skills', 'hello')

  const first = await installDirectory(source, target, { mode: 'symlink' })
  const second = await installDirectory(source, target, { mode: 'symlink' })

  assert.equal(first.action, 'create')
  assert.equal(second.action, 'unchanged')
  assert.equal(await readlink(target), source)
  assert.equal(await readFile(join(target, 'SKILL.md'), 'utf8'), 'v1')
})

test('installDirectory never touches a real directory it did not create', async (t) => {
  const { root, source } = await makeSource(t)
  const target = join(root, 'mine')
  await writeTree(target, { 'keep.txt': 'user data' })

  const result = await installDirectory(source, target, { mode: 'symlink' })

  assert.equal(result.action, 'skip-foreign')
  assert.equal(await readFile(join(target, 'keep.txt'), 'utf8'), 'user data')
  assert.equal((await lstat(target)).isSymbolicLink(), false)
})

test('installDirectory leaves a symlink that points elsewhere alone', async (t) => {
  const { root, source } = await makeSource(t)
  const elsewhere = join(root, 'elsewhere')
  await mkdir(elsewhere)
  const target = join(root, 'link')
  await symlink(elsewhere, target)

  const result = await installDirectory(source, target, { mode: 'symlink' })

  assert.equal(result.action, 'skip-foreign')
  assert.equal(await readlink(target), elsewhere)
})

test('copy mode marks the copy as managed and refreshes it when the source changes', async (t) => {
  const { root, source } = await makeSource(t, { 'SKILL.md': 'v1', 'old.md': 'x' })
  const target = join(root, 'copy')

  const first = await installDirectory(source, target, { mode: 'copy' })
  await writeTree(source, { 'SKILL.md': 'v2' })
  await rm(join(source, 'old.md'))
  const second = await installDirectory(source, target, { mode: 'copy' })

  assert.equal(first.action, 'create')
  assert.equal(second.action, 'update')
  assert.equal(await readFile(join(target, 'SKILL.md'), 'utf8'), 'v2')
  assert.equal(await exists(join(target, 'old.md')), false)
  assert.equal(await exists(join(target, '.fe-kit-managed')), true)
})

test('a managed copy can be replaced by a symlink and a foreign copy cannot', async (t) => {
  const { root, source } = await makeSource(t)
  const managed = join(root, 'managed')
  await installDirectory(source, managed, { mode: 'copy' })
  const foreign = join(root, 'foreign')
  await writeTree(foreign, { 'SKILL.md': 'someone else' })

  const upgraded = await installDirectory(source, managed, { mode: 'symlink' })
  const skipped = await installDirectory(source, foreign, { mode: 'copy' })

  assert.equal(upgraded.action, 'update')
  assert.equal((await lstat(managed)).isSymbolicLink(), true)
  assert.equal(skipped.action, 'skip-foreign')
  assert.equal(await readFile(join(foreign, 'SKILL.md'), 'utf8'), 'someone else')
})

test('dryRun reports the action without changing the disk', async (t) => {
  const { root, source } = await makeSource(t)
  const target = join(root, 'dry')

  const result = await installDirectory(source, target, { mode: 'symlink', dryRun: true })

  assert.equal(result.action, 'create')
  assert.equal(await exists(target), false)
})

test('installDirectory fails loudly when the source is missing', async (t) => {
  const root = await tempDir(t)
  await assert.rejects(installDirectory(join(root, 'nope'), join(root, 'target')), /source/i)
})

test('removeInstalled removes only what the kit installed', async (t) => {
  const { root, source } = await makeSource(t)
  const link = join(root, 'link')
  const copy = join(root, 'copy')
  const foreign = join(root, 'foreign')
  await installDirectory(source, link, { mode: 'symlink' })
  await installDirectory(source, copy, { mode: 'copy' })
  await writeTree(foreign, { 'a.txt': 'a' })
  const stranger = join(root, 'stranger')
  await mkdir(join(root, 'elsewhere'))
  await symlink(join(root, 'elsewhere'), stranger)

  assert.equal((await removeInstalled(link, { source })).action, 'removed')
  assert.equal((await removeInstalled(copy)).action, 'removed')
  assert.equal((await removeInstalled(foreign)).action, 'skip-foreign')
  assert.equal((await removeInstalled(stranger, { source })).action, 'skip-foreign')
  assert.equal((await removeInstalled(join(root, 'absent'))).action, 'missing')
  assert.equal(await exists(link), false)
  assert.equal(await exists(copy), false)
  assert.equal(await exists(foreign), true)
  assert.equal(await exists(stranger), true)
  assert.equal(await exists(source), true, 'removing a symlink must not delete its source')
})

test('backupFile keeps the content and never overwrites an earlier backup', async (t) => {
  const root = await tempDir(t)
  const file = join(root, 'settings.json')
  await writeFile(file, '{"a":1}')
  const backupDir = join(root, 'backups')
  const sameMillisecond = () => new Date('2026-01-01T00:00:00.000Z')

  const first = await backupFile(file, backupDir, { now: sameMillisecond })
  await writeFile(file, '{"a":2}')
  const second = await backupFile(file, backupDir, { now: sameMillisecond })

  assert.notEqual(first, second)
  assert.equal(await readFile(first, 'utf8'), '{"a":1}')
  assert.equal(await readFile(second, 'utf8'), '{"a":2}')
  assert.match(first, /settings\.json\..+\.bak$/)
})

test('a managed copy is left alone while the source is unchanged', async (t) => {
  const { root, source } = await makeSource(t)
  const target = join(root, 'copy')
  await installDirectory(source, target, { mode: 'copy' })
  await writeFile(join(target, 'SKILL.md'), 'edited by hand')

  const again = await installDirectory(source, target, { mode: 'copy' })

  assert.equal(again.action, 'unchanged')
  assert.equal(await readFile(join(target, 'SKILL.md'), 'utf8'), 'edited by hand')
})

test('an update leaves no staging directory behind', async (t) => {
  const { root, source } = await makeSource(t)
  const target = join(root, 'tools', 'copy')
  await installDirectory(source, target, { mode: 'copy' })
  await writeTree(source, { 'SKILL.md': 'v2' })

  await installDirectory(source, target, { mode: 'copy' })

  assert.deepEqual(await readdir(join(root, 'tools')), ['copy'])
  assert.equal(await readFile(join(target, 'SKILL.md'), 'utf8'), 'v2')
})

test('a failed update keeps the old copy intact', { skip: !canTestPermissions }, async (t) => {
  const { root, source } = await makeSource(t)
  const parent = join(root, 'tools')
  const target = join(parent, 'copy')
  await installDirectory(source, target, { mode: 'copy' })
  await writeTree(source, { 'SKILL.md': 'v2' })

  await chmod(parent, 0o555)
  try {
    await assert.rejects(installDirectory(source, target, { mode: 'copy' }), /EACCES|EPERM/)
  } finally {
    await chmod(parent, 0o755)
  }

  assert.equal(await readFile(join(target, 'SKILL.md'), 'utf8'), 'v1')
  assert.equal(await exists(join(target, '.fe-kit-managed')), true)
  assert.deepEqual(await readdir(parent), ['copy'])
})

test('paths with spaces and Unicode work in every mode', async (t) => {
  const root = await tempDir(t)
  const source = join(root, 'kỹ năng', 'tiếng Việt')
  await writeTree(source, { 'SKILL.md': 'xin chào' })

  for (const mode of ['symlink', 'copy']) {
    const target = join(root, 'đích', mode, 'thư mục')
    assert.equal((await installDirectory(source, target, { mode })).action, 'create')
    assert.equal(await readFile(join(target, 'SKILL.md'), 'utf8'), 'xin chào')
    assert.equal((await installDirectory(source, target, { mode })).action, 'unchanged')
    assert.equal((await removeInstalled(target, { source })).action, 'removed')
  }
})

test('dryRun reports an update or a removal without touching a managed copy', async (t) => {
  const { root, source } = await makeSource(t)
  const target = join(root, 'copy')
  await installDirectory(source, target, { mode: 'copy' })
  await writeTree(source, { 'SKILL.md': 'v2' })

  assert.equal((await installDirectory(source, target, { mode: 'copy', dryRun: true })).action, 'update')
  assert.equal(await readFile(join(target, 'SKILL.md'), 'utf8'), 'v1')
  assert.equal((await removeInstalled(target, { dryRun: true })).action, 'removed')
  assert.equal(await exists(target), true)
})

test('a directory whose marker is empty, not JSON, a directory or a symlink is not treated as the kit own', async (t) => {
  const { root, source } = await makeSource(t)
  const forged = {
    empty: (dir) => writeFile(join(dir, '.fe-kit-managed'), ''),
    notJson: (dir) => writeFile(join(dir, '.fe-kit-managed'), 'definitely not json'),
    wrongShape: (dir) => writeFile(join(dir, '.fe-kit-managed'), '{"source":1}'),
    directory: (dir) => mkdir(join(dir, '.fe-kit-managed')),
    symlink: async (dir) => {
      await writeFile(join(root, 'valid-looking.json'), '{"source":"/x","hash":"y"}')
      await symlink(join(root, 'valid-looking.json'), join(dir, '.fe-kit-managed'))
    },
  }

  for (const [name, plant] of Object.entries(forged)) {
    const target = join(root, `forged-${name}`)
    await writeTree(target, { 'precious.txt': 'keep me' })
    await plant(target)

    assert.equal((await installDirectory(source, target, { mode: 'copy' })).action, 'skip-foreign', name)
    assert.equal((await removeInstalled(target)).action, 'skip-foreign', name)
    assert.equal(await readFile(join(target, 'precious.txt'), 'utf8'), 'keep me', name)
  }
})

test('a .fe-kit-managed that comes along from the source is never followed', async (t) => {
  const { root, source } = await makeSource(t)
  const victim = join(root, 'victim.txt')
  await writeFile(victim, 'user data')
  await symlink(victim, join(source, '.fe-kit-managed'))
  const target = join(root, 'copy')

  await installDirectory(source, target, { mode: 'copy' })

  assert.equal(await readFile(victim, 'utf8'), 'user data')
  assert.equal((await lstat(join(target, '.fe-kit-managed'))).isFile(), true)
})

test('a directory that sits where a staging copy used to go is left alone', async (t) => {
  const { root, source } = await makeSource(t)
  const target = join(root, 'copy')
  const bystander = `${target}.fe-kit-new-${process.pid}`
  await writeTree(bystander, { 'precious.txt': 'keep me' })

  await installDirectory(source, target, { mode: 'copy' })

  assert.equal(await readFile(join(bystander, 'precious.txt'), 'utf8'), 'keep me')
})

test('two installs of the same target at once leave it valid and leave no staging behind', async (t) => {
  const { root, source } = await makeSource(t)
  const parent = join(root, 'tools')
  const target = join(parent, 'copy')

  const results = await Promise.allSettled([
    installDirectory(source, target, { mode: 'copy' }),
    installDirectory(source, target, { mode: 'copy' }),
  ])

  assert.ok(results.some((result) => result.status === 'fulfilled'))
  assert.equal(await readFile(join(target, 'SKILL.md'), 'utf8'), 'v1')
  assert.deepEqual(await readdir(parent), ['copy'])
})

test('a source that is itself a symlink to a directory is copied as a directory, and its target gets no marker', async (t) => {
  const { root, source } = await makeSource(t)
  const alias = join(root, 'alias')
  await symlink(source, alias)
  const target = join(root, 'copy')

  await installDirectory(alias, target, { mode: 'copy' })

  assert.equal((await lstat(target)).isDirectory(), true)
  assert.equal(await readFile(join(target, 'SKILL.md'), 'utf8'), 'v1')
  assert.equal(await exists(join(source, '.fe-kit-managed')), false)
})

test('when the new copy cannot be put in place and the old one cannot be restored, the old one is kept and named', async (t) => {
  const { root, source } = await makeSource(t)
  const target = join(root, 'copy')
  await installDirectory(source, target, { mode: 'copy' })
  await writeTree(source, { 'SKILL.md': 'v2' })
  injectFs(t, 'rename', (rename, from, to) => (to === target ? Promise.reject(enospc()) : rename(from, to)))

  await assert.rejects(installDirectory(source, target, { mode: 'copy' }), /ENOSPC: injected \(the previous copy is kept at .*copy\.fe-kit-old-/)

  const left = await withoutSource(root)
  assert.equal(left.length, 1, `only the old copy should remain: ${left}`)
  assert.match(left[0], /^copy\.fe-kit-old-/)
  assert.equal(await readFile(join(root, left[0], 'SKILL.md'), 'utf8'), 'v1')
})

test('a failure to clean up the staging directory does not hide where the old copy was kept', async (t) => {
  const { root, source } = await makeSource(t)
  const target = join(root, 'copy')
  await installDirectory(source, target, { mode: 'copy' })
  await writeTree(source, { 'SKILL.md': 'v2' })
  injectFs(t, 'rename', (rename, from, to) => (to === target ? Promise.reject(enospc()) : rename(from, to)))
  injectFs(t, 'rm', (rm, path, options) =>
    /fe-kit-new-[0-9a-f-]{36}$/.test(String(path)) ? Promise.reject(Object.assign(new Error('EACCES: injected'), { code: 'EACCES' })) : rm(path, options),
  )

  await assert.rejects(
    installDirectory(source, target, { mode: 'copy' }),
    /^Error: ENOSPC: injected \(the previous copy is kept at .*copy\.fe-kit-old-.*\) \(also could not remove .*copy\.fe-kit-new-.*: EACCES: injected\)$/,
  )
})

test('when the new copy cannot be put in place, the old copy is restored and nothing is left behind', async (t) => {
  const { root, source } = await makeSource(t)
  const target = join(root, 'copy')
  await installDirectory(source, target, { mode: 'copy' })
  await writeTree(source, { 'SKILL.md': 'v2' })
  let failed = false
  injectFs(t, 'rename', (rename, from, to) => {
    if (to !== target || failed) return rename(from, to)
    failed = true
    return Promise.reject(enospc())
  })

  await assert.rejects(installDirectory(source, target, { mode: 'copy' }), /ENOSPC/)

  assert.deepEqual(await withoutSource(root), ['copy'])
  assert.equal(await readFile(join(target, 'SKILL.md'), 'utf8'), 'v1')
})

// Something appears at the target after the old copy was moved away and the swap-in failed. The restore then fails
// too, and nothing proves that what sits there is a valid replacement, so the old copy must survive in every case.
const occupants = {
  'a directory with no marker': {
    occupy: (target) => writeTree(target, { 'SKILL.md': 'from someone else' }),
    check: async (target) => assert.equal(await readFile(join(target, 'SKILL.md'), 'utf8'), 'from someone else'),
  },
  'a file': {
    occupy: (target) => writeFile(target, 'from someone else'),
    check: async (target) => assert.equal(await readFile(target, 'utf8'), 'from someone else'),
  },
  'a symlink': {
    occupy: (target) => symlink('/nonexistent-fe-kit-test', target),
    check: async (target) => assert.equal(await readlink(target), '/nonexistent-fe-kit-test'),
  },
}
for (const [label, { occupy, check }] of Object.entries(occupants)) {
  test(`when the restore fails because ${label} sits at the target, the old copy is kept and named`, async (t) => {
    const { root, source } = await makeSource(t)
    const target = join(root, 'copy')
    await installDirectory(source, target, { mode: 'copy' })
    await writeTree(source, { 'SKILL.md': 'v2' })
    injectFs(t, 'rename', async (rename, from, to) => {
      if (to !== target || !from.includes('fe-kit-new-')) return rename(from, to)
      await occupy(target)
      throw enospc()
    })

    await assert.rejects(installDirectory(source, target, { mode: 'copy' }), /ENOSPC: injected \(the previous copy is kept at .*copy\.fe-kit-old-/)

    const left = await withoutSource(root)
    assert.deepEqual(left.map((name) => name.replace(/-[0-9a-f-]{36}$/, '-<id>')), ['copy', 'copy.fe-kit-old-<id>'])
    assert.equal(await readFile(join(root, left[1], 'SKILL.md'), 'utf8'), 'v1')
    await check(target)
  })
}

test('a copy that fails midway leaves the old copy in place and no staging directory', async (t) => {
  const { root, source } = await makeSource(t)
  const target = join(root, 'copy')
  await installDirectory(source, target, { mode: 'copy' })
  await writeTree(source, { 'SKILL.md': 'v2' })
  injectFs(t, 'cp', async (cp, from, to, options) => {
    await cp(from, to, options) // the staging directory now exists and is full
    throw enospc()
  })

  await assert.rejects(installDirectory(source, target, { mode: 'copy' }), /ENOSPC/)

  assert.deepEqual(await withoutSource(root), ['copy'])
  assert.equal(await readFile(join(target, 'SKILL.md'), 'utf8'), 'v1')
})
