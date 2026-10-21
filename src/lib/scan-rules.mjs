import { matchesAny } from './glob.mjs'
import { profileScanRules } from './profile.mjs'

/**
 * The rules `scan` applies to added lines. They are regular expressions over one line, which is what the plan asks
 * for and all a diff offers: a line comes with no syntax tree. That makes them heuristics. Comments and the inside of
 * strings are blanked first (see codeView) so that prose does not trigger a code rule, and each rule is limited to
 * the kind of file it makes sense in. A rule that is wrong about a line is fixed in the rule, not silenced per line.
 */

const MAX_LINE_LENGTH = 2000 // longer lines are minified or generated; nobody wrote them, and a regex over them is slow

const CODE_FILE = /\.(?:[cm]?[jt]sx?|vue|svelte|astro)$/
const TYPESCRIPT_FILE = /\.(?:[cm]?ts|tsx)$/
const DOCUMENT_FILE = /\.(?:md|mdx|markdown|txt|rst|adoc)$/i
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$|(?:^|\/)(?:__tests__|tests?|e2e|cypress|spec)\//
// Places where printing is the point: tests, stories, scripts and tool configuration.
const PRINTING_FILE = /(?:^|\/)(?:__tests__|__mocks__|tests?|e2e|cypress|scripts|bin|tools|\.storybook)\/|\.(?:test|spec|stories|story|e2e|config)\.[cm]?[jt]sx?$/

/** Index of the quote that closes the one at `open` on this line, or -1. A backslash skips the next character. */
function closingQuote(line, open) {
  for (let index = open + 1; index < line.length; index++) {
    if (line[index] === '\\') index++
    else if (line[index] === line[open]) return index
  }
  return -1
}

/**
 * One line of JS or TS reduced to its code: comments gone, the inside of strings and template literals blanked. Without
 * the lines around it, a line in the middle of a block comment is recognised by its leading `*` only. A `'` or `"` that
 * does not close on its line is not a string (JSX text says "Don't", a regular expression holds a quote): it stays as
 * it is and the rest of the line is still read. A backtick that does not close may be a template literal that goes on.
 */
export function codeView(line) {
  const trimmed = line.trimStart()
  if (trimmed.startsWith('//') || /^\*(?:\s|\/|$)/.test(trimmed)) return ''
  let view = ''
  let index = 0
  while (index < line.length) {
    const char = line[index]
    if (char === '"' || char === "'" || char === '`') {
      const end = closingQuote(line, index)
      if (end !== -1) {
        view += char + ' '.repeat(end - index - 1) + char
        index = end + 1
      } else if (char === '`') {
        view += char + ' '.repeat(line.length - index - 1)
        break
      } else {
        view += char
        index++
      }
    } else if (char === '/' && line[index + 1] === '/') {
      break
    } else if (char === '/' && line[index + 1] === '*') {
      const end = line.indexOf('*/', index + 2)
      if (end === -1) break
      view += ' '
      index = end + 2
    } else {
      view += char
      index++
    }
  }
  return view
}

// `any` as a type, in the places a type can stand: after `:`, `<`, `,`, `|`, `&` or `[` (a tuple), after `=` or `=>` (a
// type alias, a generic default, the return type of a function type), and after `as`, `extends`, `keyof`, `readonly` or
// `is`. What follows must end the type, so prose ("Note: any change") and `expect.any(Number)` do not match.
const ANY_END = String.raw`(?=\s*(?:$|[;,)>\]|&}{\[=?]))`
const ANY_TYPE = new RegExp(
  [
    String.raw`[:<,|&[]\s*any\b${ANY_END}`,
    String.raw`=>?\s*any\b${ANY_END}`,
    String.raw`\b(?:as|extends|keyof|readonly|is)\s+any\b(?=\s*(?:$|[;,)>\]|&}{\[=?.]))`,
  ].join('|'),
)

const rule = (id, message, { files, view = 'code', test }) => ({ id, message, files, view, test })
/** Whether a file is JS or TS (or a component format of one): the files `{files}` and the code rules are about. */
export const isCodeFile = (file) => CODE_FILE.test(file)
const inCode = isCodeFile

export const GENERAL_RULES = [
  rule('conflict-marker', 'merge conflict marker left in the file', {
    files: () => true,
    view: 'raw',
    // `=======` underlines a heading in prose, so it only counts in code and data files.
    test: (text, file) => /^(?:<{7}|>{7})(?: |$)/.test(text) || (/^={7}\s*$/.test(text) && !DOCUMENT_FILE.test(file)),
  }),
  rule('no-explicit-any', 'explicit `any` turns type checking off; use a specific type or `unknown`', {
    files: (file) => TYPESCRIPT_FILE.test(file),
    test: (text) => ANY_TYPE.test(text),
  }),
  rule('dangerously-set-inner-html', '`dangerouslySetInnerHTML` renders raw HTML, an XSS risk; sanitize the input or avoid it', {
    files: inCode,
    test: (text) => /\bdangerouslySetInnerHTML\b/.test(text),
  }),
  rule('no-eval', '`eval` and `new Function` run a string as code; avoid them', {
    files: (file) => inCode(file) && !file.endsWith('.d.ts'), // a declaration file declares, it does not call
    test: (text) => /(?<![\w$.])(?<!function\s+)eval\s*\(|\b(?:window|globalThis|self)\.eval\s*\(|\(\s*0\s*,\s*eval\s*\)\s*\(|\bnew\s+Function\s*\(/.test(text),
  }),
  rule('inner-html-assignment', 'writing raw HTML (`innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`) is an XSS risk; use textContent or sanitize', {
    files: inCode,
    test: (text) => /\.(?:inner|outer)HTML\s*\+?=(?!=)|\.insertAdjacentHTML\s*\(|\bdocument\.write(?:ln)?\s*\(/.test(text),
  }),
  rule('focused-or-skipped-test', 'a focused or skipped test: the rest of the suite does not run, or a test is switched off', {
    files: inCode,
    // `fit(` and `xit(` are the old Jasmine names, and `fitAddon.fit()` is a method of something else: those count only
    // as a bare call, and only where tests live.
    test: (text, file) => /\b(?:describe|it|test)(?:\.\w+)*\.(?:only|skip)\b/.test(text) || (TEST_FILE.test(file) && /(?<![\w$.])(?:fit|fdescribe|xit|xdescribe|xtest)\s*\(/.test(text)),
  }),
  rule('console-log', '`console.log` left in code', {
    files: (file) => inCode(file) && !PRINTING_FILE.test(file),
    test: (text) => /\bconsole\.log\s*\(/.test(text),
  }),
  rule('fe-kit-leak', 'mentions .fe-kit, whose drafts are local and must not reach the repository', {
    files: (file) => file.split('/').at(-1) !== '.gitignore',
    view: 'raw',
    test: (text) => /\.fe-kit\b/.test(text),
  }),
]

/** Rules from the `scan` entries of a profile (see profileScanRules): matched against the raw line, in the files they name. */
export function compileProfileRules(entries) {
  return entries.map(({ id, pattern, message, files }) => {
    const regex = RegExp(pattern)
    return rule(id, message, { files: files ? (file) => matchesAny(file, files) : () => true, view: 'raw', test: (text) => regex.test(text) })
  })
}

/** The general rules and the well-formed `scan` rules of the profile in `settings`. */
export const rulesFor = (settings) => [...GENERAL_RULES, ...compileProfileRules(profileScanRules(settings))]

/** Findings (`{ rule, file, line, text, message }`) of `rules` over added lines (`{ file, line, text }`), in line order. */
export function scanLines(added, rules) {
  const findings = []
  for (const { file, line, text } of added) {
    if (text.length > MAX_LINE_LENGTH) continue
    const applicable = rules.filter((candidate) => candidate.files(file))
    if (applicable.length === 0) continue
    const code = inCode(file) ? codeView(text) : text
    for (const candidate of applicable) {
      if (candidate.test(candidate.view === 'code' ? code : text, file)) {
        findings.push({ rule: candidate.id, file, line, text: text.trim(), message: candidate.message })
      }
    }
  }
  return findings
}
