/**
 * Arguments (after `git`) that produce the diff `parseAddedLines` reads. The prefixes are spelled out because a
 * user's `diff.noprefix` or `diff.mnemonicPrefix` would change them, and `core.quotePath=false` keeps non-ASCII names
 * readable. Renames are followed, so a moved file does not count as all new.
 */
export const GIT_DIFF_ARGS = [
  '-c',
  'core.quotePath=false',
  'diff',
  '--no-color',
  '--no-ext-diff',
  '--no-textconv',
  '-M',
  '-U0',
  '--ignore-submodules=all',
  '--src-prefix=a/',
  '--dst-prefix=b/',
]

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/
// How git writes a name it has to quote: these short forms, and three octal digits for any other control character.
const ESCAPES = { a: String.fromCharCode(7), b: '\b', f: '\f', v: '\v', t: '\t', n: '\n', r: '\r', '"': '"', '\\': '\\' }

/** The new path in a `+++` header. Git quotes a name with a tab, quote or backslash, and adds a tab after one with spaces. */
function headerPath(header) {
  let path = header.replace(/\t$/, '')
  if (path.startsWith('"') && path.endsWith('"') && path.length > 1) {
    path = path.slice(1, -1).replace(/\\([0-7]{3}|.)/g, (escaped, code) => (code.length === 3 ? String.fromCharCode(parseInt(code, 8)) : (ESCAPES[code] ?? escaped)))
  }
  return path.startsWith('b/') ? path.slice(2) : path
}

/**
 * The lines a unified diff adds, as `{ file, line, text }` with `line` counted in the new file. A hunk is read by the
 * line count in its header, never by what a line starts with, so an added line that reads `++ x` (`+++ x` in the
 * diff) is content and not a file header. Removed lines never matter: only the new side is counted.
 */
export function parseAddedLines(diff) {
  const added = []
  let file = null
  let left = 0 // lines of the new file the current hunk still has to show, added and context alike
  let line = 0

  for (const text of diff.split('\n')) {
    if (left > 0) {
      const marker = text[0]
      if (marker === '-' || marker === '\\') continue // a removed line, or "\ No newline at end of file"
      if (marker === '+' && file !== null) added.push({ file, line, text: text.slice(1).replace(/\r$/, '') })
      line++
      left--
    } else if (text.startsWith('+++ ')) {
      file = headerPath(text.slice(4))
    } else {
      const hunk = HUNK_HEADER.exec(text)
      if (hunk) {
        line = Number(hunk[1])
        left = hunk[2] === undefined ? 1 : Number(hunk[2])
      }
    }
  }
  return added
}
