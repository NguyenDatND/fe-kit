import assert from 'node:assert/strict'
import { chmod, mkdir, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { hasCatchAll } from '../src/lib/drafts.mjs'
import { canTestPermissions, tempDir } from './helpers.mjs'

// Each verdict was measured with git 2.55 (`git status` with a draft present). Git skips a UTF-8 BOM, drops one CR
// before the LF and trims trailing SPACES only, and the last rule that matches wins: so a catch-all only counts
// when the last rule is exactly `*`.
const cases = [
  ['a plain catch-all', '*\n', true],
  ['no final newline', '*', true],
  ['trailing spaces', '*   \n', true],
  ['a BOM and CRLF line ends', '\uFEFF*\r\n', true],
  ['comments and blank lines after it', '# mine\n!keep.txt\n*\n# note\n\n', true],
  ['negations after it', '*\n!reports/\n!reports/**\n', false],
  ['a tab after it', '*\t\n', false],
  ['a non-breaking space after it', '*\u00A0\n', false],
  ['an escaped trailing space', '*\\ \n', false],
  ['other rules only', 'custom\n', false],
  ['an empty file', '', false],
]

for (const [label, content, expected] of cases) {
  test(`hasCatchAll: ${label} is ${expected ? '' : 'not '}a catch-all`, async (t) => {
    const dir = await tempDir(t)
    await writeFile(join(dir, '.gitignore'), content)

    assert.equal(await hasCatchAll(join(dir, '.gitignore')), expected)
  })
}

test('hasCatchAll is false for a missing file, a directory and a symlink (git does not read those)', async (t) => {
  const dir = await tempDir(t)
  await writeFile(join(dir, 'real'), '*\n')
  await mkdir(join(dir, 'dir'))
  await symlink(join(dir, 'real'), join(dir, 'link'))

  assert.equal(await hasCatchAll(join(dir, 'missing')), false)
  assert.equal(await hasCatchAll(join(dir, 'dir')), false)
  assert.equal(await hasCatchAll(join(dir, 'link')), false)
})

test('hasCatchAll throws when the file exists but cannot be read, instead of guessing', { skip: !canTestPermissions }, async (t) => {
  const dir = await tempDir(t)
  const file = join(dir, '.gitignore')
  await writeFile(file, '*\n')
  await chmod(file, 0o200)

  try {
    await assert.rejects(hasCatchAll(file), /E(ACCES|PERM)/)
  } finally {
    await chmod(file, 0o644)
  }
})

test('hasCatchAll is false below a path that is a file', async (t) => {
  const dir = await tempDir(t)
  await writeFile(join(dir, 'plain'), 'x')

  assert.equal(await hasCatchAll(join(dir, 'plain', '.gitignore')), false)
})
