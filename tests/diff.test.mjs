import assert from 'node:assert/strict'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { GIT_DIFF_ARGS, parseAddedLines } from '../src/lib/diff.mjs'
import { commitAll, git, makeGitRepo, tempDir, writeTree } from './helpers.mjs'

/** A repo whose first commit holds `before`; `change` then edits the working tree. Returns the parsed added lines. */
async function addedAfter(t, before, change) {
  const dir = await tempDir(t)
  await makeGitRepo(dir)
  await writeTree(dir, before)
  await commitAll(dir, 'base')
  await change(dir)
  const added = parseAddedLines(await git(dir, ...GIT_DIFF_ARGS, 'HEAD'))
  // Whatever the diff looked like, a reported line must be the very line at that number in the file now.
  for (const { file, line, text } of added) {
    const lines = (await readFile(join(dir, file), 'utf8')).split('\n').map((entry) => entry.replace(/\r$/, ''))
    assert.equal(lines[line - 1], text, `${file}:${line} is not what the diff says`)
  }
  return added
}

test('lists every added line of every hunk with its line number in the new file', async (t) => {
  const added = await addedAfter(t, { 'a.ts': 'one\ntwo\nthree\nfour\nfive\n' }, (dir) =>
    writeFile(join(dir, 'a.ts'), 'one\nNEW\ntwo\nthree\nfour\nfive\nsix\nseven\n'),
  )

  assert.deepEqual(added, [
    { file: 'a.ts', line: 2, text: 'NEW' },
    { file: 'a.ts', line: 7, text: 'six' },
    { file: 'a.ts', line: 8, text: 'seven' },
  ])
})

test('a changed line counts as added, a removed line does not', async (t) => {
  const added = await addedAfter(t, { 'a.ts': 'keep\nold\nkeep too\ngone\n' }, (dir) => writeFile(join(dir, 'a.ts'), 'keep\nnew\nkeep too\n'))

  assert.deepEqual(added, [{ file: 'a.ts', line: 2, text: 'new' }])
})

test('a staged new file is all added', async (t) => {
  const added = await addedAfter(t, { 'a.ts': 'x\n' }, async (dir) => {
    await writeTree(dir, { 'src/b.ts': 'first\nsecond\n' })
    await git(dir, 'add', 'src/b.ts')
  })

  assert.deepEqual(added, [
    { file: 'src/b.ts', line: 1, text: 'first' },
    { file: 'src/b.ts', line: 2, text: 'second' },
  ])
})

test('a renamed file reports its added lines under the new name, and a pure rename reports nothing', async (t) => {
  const body = 'a\nb\nc\nd\ne\nf\ng\nh\n'
  const added = await addedAfter(t, { 'old.ts': body, 'same.ts': body }, async (dir) => {
    await git(dir, 'mv', 'old.ts', 'new.ts')
    await writeFile(join(dir, 'new.ts'), `${body}extra\n`)
    await git(dir, 'mv', 'same.ts', 'moved.ts')
  })

  assert.deepEqual(added, [{ file: 'new.ts', line: 9, text: 'extra' }])
})

test('a deleted file and a binary file report nothing', async (t) => {
  const added = await addedAfter(t, { 'gone.ts': 'x\n', 'pic.bin': Buffer.from([0, 1, 2, 3]).toString('latin1') }, async (dir) => {
    await rm(join(dir, 'gone.ts'))
    await writeFile(join(dir, 'pic.bin'), Buffer.from([0, 9, 9, 9, 0]))
  })

  assert.deepEqual(added, [])
})

test('a line that looks like a diff header is still content: hunks are read by their line counts', async (t) => {
  const added = await addedAfter(t, { 'a.sql': 'x\n--- looks like an old header\ny\n' }, (dir) =>
    writeFile(join(dir, 'a.sql'), 'x\n++ looks like a new header\n-- sql comment\ny\n'),
  )

  assert.deepEqual(added, [
    { file: 'a.sql', line: 2, text: '++ looks like a new header' },
    { file: 'a.sql', line: 3, text: '-- sql comment' },
  ])
})

test('file names with spaces, quotes or a backslash come back as they are', async (t) => {
  const names = ['my file.ts', 'q"uote.ts', 'back\\slash.ts', 'tab\there.ts', 'café.ts']
  const added = await addedAfter(t, { 'keep.ts': 'k\n' }, async (dir) => {
    for (const name of names) await writeFile(join(dir, name), 'added\n')
    await git(dir, 'add', '-A')
  })

  assert.deepEqual(added.map(({ file }) => file).sort(), [...names].sort())
})

test('file names with control characters come back as they are, whichever way git spells them', async (t) => {
  const names = [`ctl${String.fromCharCode(1)}.ts`, `bell${String.fromCharCode(7)}.ts`, `back${String.fromCharCode(8)}.ts`, `form${String.fromCharCode(12)}.ts`, `vert${String.fromCharCode(11)}.ts`, `del${String.fromCharCode(127)}.ts`]
  const before = Object.fromEntries(names.map((name) => [name, 'one\n']))
  const added = await addedAfter(t, before, async (dir) => {
    for (const name of names) await writeFile(join(dir, name), 'one\ntwo\n')
  })

  assert.deepEqual(added.map(({ file }) => file).sort(), [...names].sort())
})

test('the missing newline marker is not a line, and CRLF endings are not part of the text', async (t) => {
  const added = await addedAfter(t, { 'a.txt': 'x\n' }, async (dir) => {
    await writeFile(join(dir, 'a.txt'), 'x\nlast without newline')
    await writeFile(join(dir, 'crlf.txt'), 'one\r\ntwo\r\n')
    await git(dir, 'add', '-A')
  })

  assert.deepEqual(added, [
    { file: 'a.txt', line: 2, text: 'last without newline' },
    { file: 'crlf.txt', line: 1, text: 'one' },
    { file: 'crlf.txt', line: 2, text: 'two' },
  ])
})

test('a file that had no newline at the end and was changed still reports its new lines', async (t) => {
  const added = await addedAfter(t, { 'a.txt': 'a\nb' }, (dir) => writeFile(join(dir, 'a.txt'), 'a\nc\nd\n'))

  assert.deepEqual(added, [
    { file: 'a.txt', line: 2, text: 'c' },
    { file: 'a.txt', line: 3, text: 'd' },
  ])
})

test('context lines, when a diff has them, are skipped and still counted', async (t) => {
  const dir = await tempDir(t)
  await makeGitRepo(dir)
  await writeTree(dir, { 'a.ts': '1\n2\n3\n4\n5\n6\n7\n8\n' })
  await commitAll(dir, 'base')
  await writeFile(join(dir, 'a.ts'), '1\n2\n3\n4\nfour and a half\n5\n6\n7\n8\nnine\n')

  const added = parseAddedLines(await git(dir, ...GIT_DIFF_ARGS, '-U3', 'HEAD'))

  assert.deepEqual(added, [
    { file: 'a.ts', line: 5, text: 'four and a half' },
    { file: 'a.ts', line: 10, text: 'nine' },
  ])
})

test('an empty diff and text that is not a diff have no added lines', () => {
  assert.deepEqual(parseAddedLines(''), [])
  assert.deepEqual(parseAddedLines('nothing to see\n+not in a hunk\n'), [])
  assert.deepEqual(parseAddedLines('@@ -0,0 +1 @@\n+a hunk with no file header\n'), [])
})

for (const setting of ['diff.noprefix', 'diff.mnemonicPrefix']) {
  test(`a user's ${setting} setting does not change what is read`, async (t) => {
    const added = await addedAfter(t, { 'b/x.ts': 'one\n' }, async (dir) => {
      await git(dir, 'config', setting, 'true')
      await writeFile(join(dir, 'b/x.ts'), 'one\ntwo\n')
    })

    assert.deepEqual(added, [{ file: 'b/x.ts', line: 2, text: 'two' }])
  })
}
