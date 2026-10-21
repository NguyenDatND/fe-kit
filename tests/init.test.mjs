import assert from 'node:assert/strict'
import { chmod, link, lstat, mkdir, readdir, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { run } from '../src/commands/init.mjs'
import { canTestPermissions, git, makeGitRepo, tempDir, writeTree } from './helpers.mjs'

const kitRoot = fileURLToPath(new URL('..', import.meta.url))

async function init(dir, flags = {}) {
  const { data, text } = await run({ args: [], flags, cwd: dir, env: { HOME: dir }, kitRoot })
  return { text, actions: data.actions.map((a) => `${a.action} ${relative(dir, a.path)}`), data }
}

const exists = (path) =>
  lstat(path).then(
    () => true,
    () => false,
  )

async function repoWith(t, files) {
  const dir = await tempDir(t)
  await writeTree(dir, files)
  await makeGitRepo(dir)
  return dir
}

test('creates the drafts directory and the AGENTS.md link, and git status stays clean', async (t) => {
  const dir = await repoWith(t, { 'CLAUDE.md': '# conventions\n' })

  const { actions } = await init(dir)

  assert.deepEqual(actions, [
    'created .fe-kit',
    'created .fe-kit/.gitignore',
    'created AGENTS.md',
    'updated .git/info/exclude',
  ])
  assert.equal(await readFile(join(dir, '.fe-kit/.gitignore'), 'utf8'), '*\n')
  assert.equal(await readlink(join(dir, 'AGENTS.md')), 'CLAUDE.md')
  assert.equal(await git(dir, 'status', '--porcelain', '--untracked-files=all'), '?? CLAUDE.md\n')
})

test('a second run changes nothing and does not duplicate the exclude line', async (t) => {
  const dir = await repoWith(t, { 'CLAUDE.md': '# conventions\n' })
  await init(dir)

  const { actions } = await init(dir)

  assert.deepEqual(actions, [
    'unchanged .fe-kit',
    'unchanged .fe-kit/.gitignore',
    'unchanged AGENTS.md',
    'unchanged .git/info/exclude',
  ])
  const exclude = await readFile(join(dir, '.git/info/exclude'), 'utf8')
  assert.equal(exclude.split('\n').filter((line) => line === '/AGENTS.md').length, 1)
})

test('a project that already ignores .fe-kit is left alone', async (t) => {
  const dir = await repoWith(t, { '.gitignore': '.fe-kit/\nnode_modules/\n' })

  await init(dir)

  assert.equal(await readFile(join(dir, '.gitignore'), 'utf8'), '.fe-kit/\nnode_modules/\n')
  assert.equal(await git(dir, 'status', '--porcelain', '--untracked-files=all'), '?? .gitignore\n')
})

test('an AGENTS.md that is a real file is never touched', async (t) => {
  const dir = await repoWith(t, { 'CLAUDE.md': '# claude\n', 'AGENTS.md': '# mine\n' })
  const excludeBefore = await readFile(join(dir, '.git/info/exclude'), 'utf8')

  const { actions } = await init(dir)

  assert.deepEqual(actions, ['created .fe-kit', 'created .fe-kit/.gitignore', 'skipped AGENTS.md'])
  assert.equal(await readFile(join(dir, 'AGENTS.md'), 'utf8'), '# mine\n')
  assert.equal(await readFile(join(dir, '.git/info/exclude'), 'utf8'), excludeBefore)
})

test('a CLAUDE.md that already points at AGENTS.md does not get a link loop', async (t) => {
  const dir = await repoWith(t, {})
  await symlink('AGENTS.md', join(dir, 'CLAUDE.md'))

  const { actions } = await init(dir)

  assert.deepEqual(actions, ['created .fe-kit', 'created .fe-kit/.gitignore', 'skipped AGENTS.md'])
  assert.equal(await exists(join(dir, 'AGENTS.md')), false)
})

test('without a CLAUDE.md there is nothing to link', async (t) => {
  const dir = await repoWith(t, {})

  const { actions, data } = await init(dir)

  assert.deepEqual(actions, ['created .fe-kit', 'created .fe-kit/.gitignore', 'skipped AGENTS.md'])
  assert.match(data.actions[2].note, /no CLAUDE\.md/)
})

test('--dry-run reports what would happen and writes nothing', async (t) => {
  const dir = await repoWith(t, { 'CLAUDE.md': '# conventions\n' })

  const { actions, data } = await init(dir, { 'dry-run': true })

  assert.deepEqual(actions, [
    'created .fe-kit',
    'created .fe-kit/.gitignore',
    'created AGENTS.md',
    'updated .git/info/exclude',
  ])
  assert.equal(data.dryRun, true)
  assert.equal(await exists(join(dir, '.fe-kit')), false)
  assert.equal(await exists(join(dir, 'AGENTS.md')), false)
  assert.doesNotMatch(await readFile(join(dir, '.git/info/exclude'), 'utf8'), /AGENTS/)
})

test('--no-agents-link only creates the drafts directory', async (t) => {
  const dir = await repoWith(t, { 'CLAUDE.md': '# conventions\n' })

  const { actions } = await init(dir, { 'no-agents-link': true })

  assert.deepEqual(actions, ['created .fe-kit', 'created .fe-kit/.gitignore'])
  assert.equal(await exists(join(dir, 'AGENTS.md')), false)
})

test('outside git it still works and has no exclude file to update', async (t) => {
  const dir = await tempDir(t)
  await writeTree(dir, { 'package.json': '{}', 'CLAUDE.md': '# conventions\n' })

  const { actions, data } = await init(dir)

  assert.deepEqual(actions, ['created .fe-kit', 'created .fe-kit/.gitignore', 'created AGENTS.md'])
  assert.match(data.actions[2].note, /not a git repo/)
})

test('the text form lists every action with its note', async (t) => {
  const dir = await repoWith(t, { 'CLAUDE.md': '# conventions\n' })

  const { text } = await init(dir)

  assert.match(text, /created\s+\.fe-kit\/\.gitignore/)
  assert.match(text, /updated\s+\.git\/info\/exclude/)
})

test('a custom .fe-kit/.gitignore without a catch-all line keeps its own lines and gets the missing `*`', async (t) => {
  const dir = await repoWith(t, { '.fe-kit/.gitignore': 'custom\n' })

  const { actions } = await init(dir)

  assert.deepEqual(actions, ['unchanged .fe-kit', 'updated .fe-kit/.gitignore', 'skipped AGENTS.md'])
  assert.equal(await readFile(join(dir, '.fe-kit/.gitignore'), 'utf8'), 'custom\n*\n')
  assert.equal(await git(dir, 'status', '--porcelain', '--untracked-files=all'), '')
})

test('a custom .fe-kit/.gitignore whose last rule is a catch-all is left alone, whatever else it says', async (t) => {
  const dir = await repoWith(t, { '.fe-kit/.gitignore': '# mine\n!keep.txt\n*\n# note\n\n' })

  const { actions } = await init(dir)

  assert.deepEqual(actions, ['unchanged .fe-kit', 'unchanged .fe-kit/.gitignore', 'skipped AGENTS.md'])
  assert.equal(await readFile(join(dir, '.fe-kit/.gitignore'), 'utf8'), '# mine\n!keep.txt\n*\n# note\n\n')
})

test('a .fe-kit that is a symlink or a file is left alone and nothing is written through it', async (t) => {
  const viaLink = await repoWith(t, {})
  const elsewhere = await tempDir(t)
  await symlink(elsewhere, join(viaLink, '.fe-kit'))
  const viaFile = await repoWith(t, { '.fe-kit': 'I am a file' })

  const link = await init(viaLink)
  const file = await init(viaFile)

  assert.deepEqual(link.actions, ['skipped .fe-kit', 'skipped AGENTS.md'])
  assert.deepEqual(file.actions, ['skipped .fe-kit', 'skipped AGENTS.md'])
  assert.deepEqual(await readdir(elsewhere), [])
  assert.equal(await readFile(join(viaFile, '.fe-kit'), 'utf8'), 'I am a file')
})

test('when info/exclude cannot be written no AGENTS.md link is left behind', { skip: !canTestPermissions }, async (t) => {
  const dir = await repoWith(t, { 'CLAUDE.md': '# conventions\n' })
  const exclude = join(dir, '.git/info/exclude')
  await chmod(exclude, 0o444)

  try {
    const { actions, data } = await init(dir)

    assert.deepEqual(actions, ['created .fe-kit', 'created .fe-kit/.gitignore', 'skipped AGENTS.md'])
    assert.match(data.actions[2].note, /info\/exclude/)
    assert.equal(await exists(join(dir, 'AGENTS.md')), false)
  } finally {
    await chmod(exclude, 0o644)
  }
})

test('a CLAUDE.md that links to AGENTS.md through another path does not become a loop', async (t) => {
  const dir = await repoWith(t, {})
  const alias = await tempDir(t)
  await symlink(dir, join(alias, 'repo'))
  await symlink(join(alias, 'repo', 'AGENTS.md'), join(dir, 'CLAUDE.md'))

  const { actions } = await init(dir)

  assert.deepEqual(actions, ['created .fe-kit', 'created .fe-kit/.gitignore', 'skipped AGENTS.md'])
  assert.equal(await exists(join(dir, 'AGENTS.md')), false)
})

test('two runs at the same time both succeed', async (t) => {
  const dir = await repoWith(t, { 'CLAUDE.md': '# conventions\n' })

  const [first, second] = await Promise.all([init(dir), init(dir)])

  assert.ok(first.actions.length > 0 && second.actions.length > 0)
  assert.equal(await readFile(join(dir, '.fe-kit/.gitignore'), 'utf8'), '*\n')
  assert.equal(await readlink(join(dir, 'AGENTS.md')), 'CLAUDE.md')
})

test('a project rule that re-includes part of .fe-kit does not expose the drafts once the catch-all is there', async (t) => {
  const dir = await repoWith(t, {
    '.gitignore': '/.fe-kit/*\n!/.fe-kit/reports/\n!/.fe-kit/reports/**\n',
    '.fe-kit/.gitignore': 'custom\n',
    '.fe-kit/reports/report.md': 'draft',
  })

  await init(dir)

  assert.equal(await git(dir, 'status', '--porcelain', '--untracked-files=all'), '?? .gitignore\n')
})

test('a dry run reports the missing catch-all and writes nothing', async (t) => {
  const dir = await repoWith(t, { '.fe-kit/.gitignore': 'custom\n' })

  const { actions } = await init(dir, { 'dry-run': true })

  assert.deepEqual(actions, ['unchanged .fe-kit', 'updated .fe-kit/.gitignore', 'skipped AGENTS.md'])
  assert.equal(await readFile(join(dir, '.fe-kit/.gitignore'), 'utf8'), 'custom\n')
})

test('a .fe-kit/.gitignore that cannot be written is reported as skipped, not thrown', { skip: !canTestPermissions }, async (t) => {
  const dir = await repoWith(t, { '.fe-kit/.gitignore': 'custom\n' })
  const file = join(dir, '.fe-kit/.gitignore')
  await chmod(file, 0o444)

  try {
    const { actions, data } = await init(dir)

    assert.deepEqual(actions, ['unchanged .fe-kit', 'skipped .fe-kit/.gitignore', 'skipped AGENTS.md'])
    assert.match(data.actions[1].note, /^could not write it: E(ACCES|PERM)/)
  } finally {
    await chmod(file, 0o644)
  }
  assert.equal(await readFile(file, 'utf8'), 'custom\n')
})

test('a .fe-kit/.gitignore that is a symlink or a directory is left alone', async (t) => {
  const viaLink = await repoWith(t, {})
  const elsewhere = await tempDir(t)
  await writeFile(join(elsewhere, 'precious.txt'), 'keep me\n')
  await mkdir(join(viaLink, '.fe-kit'))
  await symlink(join(elsewhere, 'precious.txt'), join(viaLink, '.fe-kit/.gitignore'))
  const viaDirectory = await repoWith(t, {})
  await mkdir(join(viaDirectory, '.fe-kit/.gitignore'), { recursive: true })

  const link = await init(viaLink)
  const directory = await init(viaDirectory)

  assert.deepEqual(link.actions.slice(0, 2), ['unchanged .fe-kit', 'skipped .fe-kit/.gitignore'])
  assert.deepEqual(directory.actions.slice(0, 2), ['unchanged .fe-kit', 'skipped .fe-kit/.gitignore'])
  assert.equal(await readFile(join(elsewhere, 'precious.txt'), 'utf8'), 'keep me\n')
})

// With a draft in .fe-kit/reports, `git status` has to come out empty after init, whatever the file said before.
// What counts as a catch-all is what git itself does with these bytes (see tests/drafts.test.mjs).
const ignoreFiles = [
  ['a catch-all that later rules undo', '*\n!reports/\n!reports/**\n', 'updated'],
  ['a * followed by a tab', '*\t\n', 'updated'],
  ['a * followed by a non-breaking space', '*\u00A0\n', 'updated'],
  ['a BOM and CRLF line ends around the *', '\uFEFF*\r\n', 'unchanged'],
  ['trailing spaces after the *', '*   \n', 'unchanged'],
]
for (const [label, content, expected] of ignoreFiles) {
  test(`init leaves no draft visible to git with ${label}`, async (t) => {
    const dir = await repoWith(t, { '.fe-kit/.gitignore': content, '.fe-kit/reports/report.md': 'draft' })

    const { actions } = await init(dir)

    assert.equal(actions[1], `${expected} .fe-kit/.gitignore`)
    assert.equal(await git(dir, 'status', '--porcelain', '--untracked-files=all'), '')
  })
}

test('a .fe-kit/.gitignore that can be written but not read is skipped, and nothing is appended blindly', { skip: !canTestPermissions }, async (t) => {
  const dir = await repoWith(t, { '.fe-kit/.gitignore': 'custom' })
  const file = join(dir, '.fe-kit/.gitignore')
  await chmod(file, 0o200)

  try {
    const real = await init(dir)
    const dry = await init(dir, { 'dry-run': true })

    for (const { actions, data } of [real, dry]) {
      assert.deepEqual(actions.slice(0, 2), ['unchanged .fe-kit', 'skipped .fe-kit/.gitignore'])
      assert.match(data.actions[1].note, /^could not read it: E(ACCES|PERM)/)
    }
  } finally {
    await chmod(file, 0o644)
  }
  assert.equal(await readFile(file, 'utf8'), 'custom')
})

test('an info/exclude that can be written but not read is left alone, and no AGENTS.md link is made', { skip: !canTestPermissions }, async (t) => {
  const dir = await repoWith(t, { 'CLAUDE.md': '# conventions\n' })
  const exclude = join(dir, '.git/info/exclude')
  await writeFile(exclude, 'foo') // no trailing newline: appending blindly would glue the new line onto it
  await chmod(exclude, 0o200)

  try {
    const { actions, data } = await init(dir)

    assert.deepEqual(actions, ['created .fe-kit', 'created .fe-kit/.gitignore', 'skipped AGENTS.md'])
    assert.match(data.actions[2].note, /info\/exclude/)
  } finally {
    await chmod(exclude, 0o644)
  }
  assert.equal(await readFile(exclude, 'utf8'), 'foo')
  assert.equal(await exists(join(dir, 'AGENTS.md')), false)
})

test('a .fe-kit/.gitignore that is a hard link to another file is not appended to', async (t) => {
  const dir = await repoWith(t, { 'src/important.txt': 'KEEP\n', '.fe-kit/placeholder': '' })
  await link(join(dir, 'src/important.txt'), join(dir, '.fe-kit/.gitignore'))

  const { actions } = await init(dir)

  assert.ok(actions.includes('skipped .fe-kit/.gitignore'), actions.join(', '))
  assert.equal(await readFile(join(dir, 'src/important.txt'), 'utf8'), 'KEEP\n')
})

test('an info/exclude that is a symlink is not appended to', async (t) => {
  const dir = await repoWith(t, { 'CLAUDE.md': '# conventions\n', 'elsewhere.txt': 'KEEP\n' })
  await rm(join(dir, '.git/info/exclude'), { force: true })
  await symlink(join(dir, 'elsewhere.txt'), join(dir, '.git/info/exclude'))

  const { actions } = await init(dir)

  assert.ok(!actions.includes('created AGENTS.md'), actions.join(', '))
  assert.equal(await readFile(join(dir, 'elsewhere.txt'), 'utf8'), 'KEEP\n')
})

test('a dry run says the same as the real run when a file it would append to is a hard link', async (t) => {
  const dir = await repoWith(t, { 'src/important.txt': 'KEEP\n', '.fe-kit/placeholder': '' })
  await link(join(dir, 'src/important.txt'), join(dir, '.fe-kit/.gitignore'))

  const dry = await init(dir, { 'dry-run': true })
  const real = await init(dir)

  assert.deepEqual(dry.actions, real.actions)
})

test('a dry run does not promise an AGENTS.md link when info/exclude is a hard link', async (t) => {
  const dir = await repoWith(t, { 'CLAUDE.md': '# conventions\n', 'elsewhere.txt': 'KEEP\n' })
  await rm(join(dir, '.git/info/exclude'), { force: true })
  await link(join(dir, 'elsewhere.txt'), join(dir, '.git/info/exclude'))

  const dry = await init(dir, { 'dry-run': true })
  const real = await init(dir)

  assert.deepEqual(dry.actions, real.actions)
  assert.ok(!real.actions.includes('created AGENTS.md'))
})
