import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { lstatOrNull } from './fsx.mjs'

export const draftsDir = (root) => join(root, '.fe-kit')

/**
 * Whether the last rule of a `.gitignore` is a catch-all `*`. The last matching rule wins, so a `*` that a later
 * rule undoes (`!reports/`) proves nothing, while a last `*` inside `.fe-kit/` also beats every rule of the
 * project's own (a .gitignore closer to the path wins): no draft can be re-included from above.
 * It is read as git reads it: a UTF-8 BOM is skipped, one CR before the LF is dropped, trailing SPACES (not tabs,
 * not no-break spaces) are trimmed, blank lines and comments do not count. A `.gitignore` that is a symlink is not
 * read by git, so it does not count either. False when the file is missing or not a regular file; it throws when
 * the file exists but cannot be read, because then nobody can say and the caller must not guess.
 */
export async function hasCatchAll(gitignoreFile) {
  if (!(await lstatOrNull(gitignoreFile))?.isFile()) return false
  const rules = (await readFile(gitignoreFile, 'utf8'))
    .replace(/^\uFEFF/, '')
    .split('\n')
    .map((line) => line.replace(/\r$/, '').replace(/ +$/, ''))
    .filter((line) => line !== '' && !line.startsWith('#'))
  return rules.at(-1) === '*'
}

/**
 * Whether drafts can be written under `.fe-kit`: it is a real folder (a link would send what is written there somewhere
 * else, possibly into the project) and its .gitignore hides everything in it (see hasCatchAll).
 */
export async function draftsAreReady(root) {
  const found = await lstatOrNull(draftsDir(root))
  return Boolean(found?.isDirectory()) && (await hasCatchAll(join(draftsDir(root), '.gitignore')).catch(() => false))
}
