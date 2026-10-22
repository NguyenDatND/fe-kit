import { isAbsolute, resolve } from 'node:path'

// Splits a shell command line into the commands that would run, without running or expanding anything. It reads what
// a policy needs: the words of each command with their quotes taken off, the operator after it, redirections,
// here-documents, and every command that sits inside a substitution, a subshell or a nested list. What it cannot read
// it refuses (`ok: false`): a policy that is handed a half-understood line must not allow it.
// Not covered, on purpose: aliases, functions, `$cmd` as the command, `case`, and what a script does once it runs.

const MAX_LENGTH = 256 * 1024 // a command line of a few KiB is normal; more is not worth reading
const MAX_DEPTH = 16 // substitutions and subshells inside each other
const WORD_END = new Set([' ', '\t', '\n', ';', '&', '|', '(', ')', '<', '>'])
const KEYWORDS = new Set(['if', 'then', 'elif', 'else', 'fi', 'while', 'until', 'do', 'done', '!', 'time', '{', '}'])
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*\+?=/
const REDIRECT_OPERATORS = ['<<<', '<<-', '<<', '<>', '<&', '>&', '>>', '>|', '&>>', '&>', '<', '>']
const ANSI_ESCAPES = { a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', '\\': '\\', "'": "'", '"': '"', '?': '?' }

class SyntaxProblem extends Error {}

const isDigit = (char) => char >= '0' && char <= '9'
const needsMore = (operator) => operator === '&&' || operator === '||' || operator === '|' || operator === '|&'

/** One word: what it says once quotes are off (an expansion stays as written), and what the shell would still do to it. */
const newWord = () => ({ text: '', dynamic: false, quoted: false, glob: false, tilde: false, subs: [] })

class Parser {
  constructor(source, depth) {
    this.source = source
    this.pos = 0
    this.depth = depth
    this.pending = [] // here-documents whose body starts after the next newline
  }

  atEnd() {
    return this.pos >= this.source.length
  }

  peek(offset = 0) {
    return this.source[this.pos + offset]
  }

  startsWith(text) {
    return this.source.startsWith(text, this.pos)
  }

  /** Spaces, tabs, a backslash-newline, and a comment up to the end of its line (a `#` only starts one at the start of a word). */
  skipBlanks() {
    for (;;) {
      const char = this.peek()
      if (char === ' ' || char === '\t') this.pos++
      else if (char === '\\' && this.peek(1) === '\n') this.pos += 2
      else if (char === '#') {
        const end = this.source.indexOf('\n', this.pos)
        this.pos = end === -1 ? this.source.length : end
      } else return
    }
  }

  /** A list of commands up to the end of the input (`close` null) or up to the `)` that closes a substitution or subshell. */
  parseList(close) {
    if (++this.depth > MAX_DEPTH) throw new SyntaxProblem('nested too deep to check')
    try {
      const items = []
      for (;;) {
        this.skipBlanks()
        const last = items.at(-1)
        const char = this.peek()
        if (char === undefined || (char === ')' && close === ')')) {
          if (char === undefined && close !== null) throw new SyntaxProblem(`missing ${close}`)
          if (last && needsMore(last.op)) throw new SyntaxProblem(`nothing after ${last.op}`)
          if (char !== undefined) this.pos++
          return { type: 'list', items }
        }
        if (char === '\n') {
          this.pos++
          this.readHeredocBodies()
          if (last && last.op === null) last.op = '\n'
        } else if (char === ';') {
          if (!last || last.op !== null) throw new SyntaxProblem('unexpected ;')
          last.op = ';'
          this.pos++
        } else if (char === '&' || char === '|') {
          const two = this.source.slice(this.pos, this.pos + 2)
          const operator = two === '&&' || two === '||' || two === '|&' ? two : char
          if (!last || last.op !== null) throw new SyntaxProblem(`unexpected ${operator}`)
          last.op = operator
          this.pos += operator.length
        } else if (char === ')') {
          throw new SyntaxProblem('unexpected )')
        } else {
          if (last && last.op === null) throw new SyntaxProblem('unexpected token after a subshell')
          items.push({ node: this.parseNode(), op: null })
        }
      }
    } finally {
      this.depth--
    }
  }

  parseNode() {
    if (this.peek() !== '(') return this.parseCommand()
    this.pos++
    const subshell = { type: 'subshell', body: this.parseList(')'), redirects: [], heredocs: [] }
    for (this.skipBlanks(); this.isRedirectStart(); this.skipBlanks()) this.parseRedirect(subshell)
    return subshell
  }

  /** Words, redirections and leading assignments, up to an operator. Keywords in front of the command (`then`, `do`, `!`, `{`) are dropped. */
  parseCommand() {
    const command = { type: 'command', words: [], assigns: [], redirects: [], heredocs: [] }
    let atStart = true
    let afterTime = false // `time -p cmd`: the -p (and a -- after it) belong to the keyword
    for (;;) {
      this.skipBlanks()
      const char = this.peek()
      if (char === undefined || char === '\n' || char === ';' || char === ')' || char === '|') break
      if (char === '&' && this.peek(1) !== '>') break
      if (this.isRedirectStart()) {
        this.parseRedirect(command)
        continue
      }
      const start = this.pos
      const word = this.parseWord()
      if (atStart) {
        if (afterTime && !word.quoted && (word.text === '-p' || word.text === '--')) continue
        afterTime = !word.quoted && word.text === 'time'
        if (!word.quoted && KEYWORDS.has(word.text)) continue
        if (ASSIGNMENT.test(this.source.slice(start, Math.min(this.pos, start + 256)))) {
          command.assigns.push(word)
          continue
        }
        atStart = false
      }
      command.words.push(word)
    }
    return command
  }

  isRedirectStart() {
    if (this.startsWith('&>')) return true
    let index = this.pos
    while (isDigit(this.source[index])) index++
    const char = this.source[index]
    if (char !== '<' && char !== '>') return false
    return index > this.pos || this.source[index + 1] !== '(' // `<(` with no number in front is a process substitution
  }

  parseRedirect(owner) {
    let fd = null
    const digits = /^[0-9]+/.exec(this.source.slice(this.pos, this.pos + 12))
    if (digits && (this.peek(digits[0].length) === '<' || this.peek(digits[0].length) === '>')) {
      fd = digits[0]
      this.pos += fd.length
    }
    const operator = REDIRECT_OPERATORS.find((candidate) => this.startsWith(candidate))
    this.pos += operator.length
    this.skipBlanks()
    const next = this.peek()
    if (next === undefined || WORD_END.has(next)) throw new SyntaxProblem(`nothing after ${operator}`)
    const target = this.parseWord()
    if (operator === '<<' || operator === '<<-') {
      const heredoc = { delimiter: target.text, quoted: target.quoted, stripTabs: operator === '<<-', body: '', unterminated: false, subs: [] }
      owner.heredocs.push(heredoc)
      this.pending.push(heredoc)
    } else {
      owner.redirects.push({ fd, op: operator, target })
    }
  }

  /** The bodies of the here-documents opened on the line that just ended. An unquoted one still has its substitutions run. */
  readHeredocBodies() {
    for (const heredoc of this.pending) {
      let found = false
      let body = ''
      while (!found && !this.atEnd()) {
        const newline = this.source.indexOf('\n', this.pos)
        const end = newline === -1 ? this.source.length : newline
        const line = this.source.slice(this.pos, end)
        this.pos = newline === -1 ? end : end + 1
        const text = heredoc.stripTabs ? line.replace(/^\t+/, '') : line
        if (text === heredoc.delimiter) found = true
        else body += text + (newline === -1 ? '' : '\n')
      }
      heredoc.body = body
      heredoc.unterminated = !found
      if (!heredoc.quoted) heredoc.subs = new Parser(body, this.depth).scanText()
    }
    this.pending = []
  }

  /** The substitutions inside text that is not split into words (the body of a here-document). */
  scanText() {
    const word = newWord()
    while (!this.atEnd()) {
      const char = this.peek()
      if (char === '\\') this.pos += 2
      else if (char === '$') this.readDollar(word, true)
      else if (char === '`') this.readBackticks(word)
      else this.pos++
    }
    return word.subs
  }

  parseWord() {
    const word = newWord()
    const start = this.pos
    if (this.startsWith('<(') || this.startsWith('>(')) {
      this.pos += 2
      word.subs.push(this.parseList(')'))
      word.text = this.source.slice(start, this.pos)
      word.dynamic = true
      return word
    }
    while (!this.atEnd()) {
      const char = this.peek()
      if (WORD_END.has(char)) break
      if (char === '\\') {
        if (this.peek(1) === '\n') this.pos += 2
        else if (this.peek(1) === undefined) {
          word.text += '\\'
          this.pos++
        } else {
          word.text += this.peek(1)
          word.quoted = true
          this.pos += 2
        }
      } else if (char === "'") {
        const end = this.source.indexOf("'", this.pos + 1)
        if (end === -1) throw new SyntaxProblem('a single quote is not closed')
        word.text += this.source.slice(this.pos + 1, end)
        word.quoted = true
        this.pos = end + 1
      } else if (char === '"') {
        this.parseDoubleQuoted(word)
        word.quoted = true
      } else if (char === '$') {
        this.readDollar(word, false)
      } else if (char === '`') {
        this.readBackticks(word)
      } else {
        if (char === '~' && this.pos === start) word.tilde = true
        else if (char === '*' || char === '?' || char === '[') word.glob = true
        word.text += char
        this.pos++
      }
    }
    if (this.pos === start) throw new SyntaxProblem('unexpected character')
    // `git{,}` and `{a,b}` become several words; which ones is not worked out here
    if (/\{[^{}]*(,|\.\.)[^{}]*\}/.test(this.source.slice(start, this.pos))) word.dynamic = true
    return word
  }

  parseDoubleQuoted(word) {
    this.pos++
    for (;;) {
      if (this.atEnd()) throw new SyntaxProblem('a double quote is not closed')
      const char = this.peek()
      if (char === '"') {
        this.pos++
        return
      }
      if (char === '\\') {
        const next = this.peek(1)
        if (next === '\n') this.pos += 2
        else if (next === '"' || next === '\\' || next === '$' || next === '`') {
          word.text += next
          this.pos += 2
        } else {
          word.text += '\\'
          this.pos++
        }
      } else if (char === '$') {
        this.readDollar(word, true)
      } else if (char === '`') {
        this.readBackticks(word)
      } else {
        word.text += char
        this.pos++
      }
    }
  }

  /** At a `$`: `$(…)`, `$((…))`, `${…}`, `$'…'`, `$name`, or a plain `$`. */
  readDollar(word, inDoubleQuotes) {
    const start = this.pos
    const next = this.peek(1)
    if (next === '(') {
      const arithmeticEnd = this.peek(2) === '(' ? this.arithmeticEnd() : -1
      if (arithmeticEnd !== -1) this.pos = arithmeticEnd
      else {
        this.pos += 2
        word.subs.push(this.parseList(')'))
      }
      word.text += this.source.slice(start, this.pos)
      word.dynamic = true
    } else if (next === '{') {
      this.readParameter(word)
    } else if (next === "'" && !inDoubleQuotes) {
      this.pos += 2
      this.readAnsiC(word)
      word.quoted = true
    } else if (next === '"' && !inDoubleQuotes) {
      this.pos++ // $"…" is a double-quoted string that may be translated
    } else if (next !== undefined && /[A-Za-z_]/.test(next)) {
      this.pos++
      while (/[A-Za-z0-9_]/.test(this.peek() ?? '')) this.pos++
      word.text += this.source.slice(start, this.pos)
      word.dynamic = true
    } else if (next !== undefined && /[0-9@*#?$!-]/.test(next)) {
      this.pos += 2
      word.text += this.source.slice(start, this.pos)
      word.dynamic = true
    } else {
      word.text += '$'
      this.pos++
    }
  }

  /** Where a plain `$((…))` ends, or -1 when it holds something that could run a command (then it is read as a substitution). */
  arithmeticEnd() {
    let depth = 0
    for (let index = this.pos + 3; index < this.source.length; index++) {
      const char = this.source[index]
      if (char === '(') depth++
      else if (char === ')') {
        if (depth === 0) return this.source[index + 1] === ')' ? index + 2 : -1
        depth--
      } else if (';&|\n`'.includes(char) || (char === '$' && this.source[index + 1] === '(')) return -1
    }
    return -1
  }

  /** `${…}` up to its closing brace; substitutions inside it run. */
  readParameter(word) {
    const start = this.pos
    const inside = newWord() // collects what is read inside; the word itself gets the text as one piece
    this.pos += 2
    for (let depth = 1; depth > 0; ) {
      if (this.atEnd()) throw new SyntaxProblem('a ${ is not closed')
      const char = this.peek()
      if (char === '}') {
        depth--
        this.pos++
      } else if (char === '{') {
        depth++
        this.pos++
      } else if (char === '$') {
        this.readDollar(inside, true)
      } else if (char === '`') {
        this.readBackticks(inside)
      } else if (char === "'") {
        const end = this.source.indexOf("'", this.pos + 1)
        if (end === -1) throw new SyntaxProblem('a single quote is not closed')
        this.pos = end + 1
      } else if (char === '"') {
        this.parseDoubleQuoted(inside)
      } else if (char === '\\') {
        this.pos += 2
      } else {
        this.pos++
      }
    }
    word.text += this.source.slice(start, this.pos)
    word.dynamic = true
    word.subs.push(...inside.subs)
  }

  /** `…` up to the closing backtick; a backslash only escapes a backtick, a backslash or a dollar. The inside is read as its own line. */
  readBackticks(word) {
    const start = this.pos
    let inside = ''
    this.pos++
    for (;;) {
      if (this.atEnd()) throw new SyntaxProblem('a backtick is not closed')
      const char = this.peek()
      if (char === '`') break
      if (char === '\\' && '`\\$'.includes(this.peek(1) ?? '')) {
        inside += this.peek(1)
        this.pos += 2
      } else {
        inside += char
        this.pos++
      }
    }
    this.pos++
    const parser = new Parser(inside, this.depth)
    word.subs.push(parser.parseList(null))
    word.text += this.source.slice(start, this.pos)
    word.dynamic = true
  }

  /** `$'…'`, after its opening: backslash escapes are decoded as bash does. */
  readAnsiC(word) {
    for (;;) {
      if (this.atEnd()) throw new SyntaxProblem('a $\' string is not closed')
      const char = this.peek()
      if (char === "'") {
        this.pos++
        return
      }
      if (char !== '\\') {
        word.text += char
        this.pos++
        continue
      }
      const next = this.peek(1) ?? ''
      const ahead = this.source.slice(this.pos + 2, this.pos + 10)
      const numeric = next === 'x' ? /^[0-9a-fA-F]{1,2}/.exec(ahead) : next === 'u' ? /^[0-9a-fA-F]{1,4}/.exec(ahead) : next === 'U' ? /^[0-9a-fA-F]{1,8}/.exec(ahead) : /^[0-7]{0,2}/.exec(ahead)
      if (Object.hasOwn(ANSI_ESCAPES, next)) {
        word.text += ANSI_ESCAPES[next]
        this.pos += 2
      } else if (/[xuU]/.test(next) && numeric) {
        const code = Number.parseInt(numeric[0], 16)
        word.text += code <= 0x10ffff ? String.fromCodePoint(code) : ''
        this.pos += 2 + numeric[0].length
      } else if (/[0-7]/.test(next)) {
        const digits = next + numeric[0]
        word.text += String.fromCharCode(Number.parseInt(digits, 8) & 0xff)
        this.pos += 1 + digits.length
      } else {
        word.text += '\\'
        this.pos++
      }
    }
  }
}

/** Reads `command`. `{ ok: true, root }` holds a list of `{ node, op }`; otherwise `{ ok: false, error }` and the line must not be allowed. */
export function parseShell(command) {
  if (command.length > MAX_LENGTH) return { ok: false, error: 'the command is too long to check' }
  try {
    return { ok: true, root: new Parser(command, 0).parseList(null) }
  } catch (error) {
    if (error instanceof SyntaxProblem) return { ok: false, error: error.message }
    throw error
  }
}

/**
 * The path a word names, resolved from `cwd` and `home`, or null when it cannot be known without the shell: a glob, a
 * variable other than a plain leading `$HOME`, a substitution, `~user`, a relative path with no known directory.
 */
export function resolveWordPath(word, cwd, home) {
  if (word.glob) return null
  let text = word.text
  if (word.tilde) {
    if ((text !== '~' && !text.startsWith('~/')) || home == null) return null
    text = home + text.slice(1)
  } else if (word.dynamic) {
    const match = /^(?:\$HOME|\$\{HOME\})(\/.*)?$/s.exec(text)
    const rest = match?.[1] ?? ''
    if (!match || /[$`*?[{]/.test(rest) || home == null) return null
    text = home + rest
  }
  if (isAbsolute(text)) return resolve(text)
  return cwd == null ? null : resolve(cwd, text)
}

const CHANGES_DIRECTORY = new Set(['cd', 'pushd'])

/** The words of a command with `command` and `builtin` (and `command -p`, `--`) taken off the front: they run the builtin in this shell. */
function withoutBuiltinPrefix(words) {
  let index = 0
  while (index < words.length && (words[index].text === 'command' || words[index].text === 'builtin') ) {
    index++
    while (index < words.length && (words[index].text === '-p' || words[index].text === '--')) index++
  }
  return words.slice(index)
}

/** The directories after `cd` or `pushd` ran in each of `cwds`; null where it cannot be told. */
function directoriesAfterCd(command, cwds, home) {
  const [name, ...args] = command.words
  if (name.text === 'popd') return [null]
  while (args.length > 0 && ['-L', '-P', '-e', '-@', '--'].includes(args[0].text)) args.shift()
  if (args.length === 0) return [name.text === 'cd' && home != null ? home : null]
  if (args[0].text === '-') return [null]
  return cwds.map((cwd) => resolveWordPath(args[0], cwd, home))
}

/**
 * Every simple command in the parsed line, nested ones included, in the order they appear, each with `cwds`: the
 * directories it may run in (a path, or null for one that cannot be told). `cd` can fail, so after it both the old
 * and the new directory count. A `cd` inside a subshell, a substitution, a pipeline or a background command does not
 * reach the commands after it.
 */
export function commandsOf(root, { cwd = null, home = null } = {}) {
  const found = []

  const walkWord = (word, cwds) => {
    for (const list of word.subs) walkList(list, cwds)
  }

  const walkExtras = (node, cwds) => {
    for (const redirect of node.redirects) walkWord(redirect.target, cwds)
    for (const heredoc of node.heredocs) for (const list of heredoc.subs) walkList(list, cwds)
  }

  const walkNode = (node, cwds) => {
    if (node.type === 'subshell') {
      walkList(node.body, cwds)
      walkExtras(node, cwds)
      return cwds
    }
    found.push({ ...node, cwds })
    for (const word of [...node.assigns, ...node.words]) walkWord(word, cwds)
    walkExtras(node, cwds)
    const words = withoutBuiltinPrefix(node.words)
    if (words.length === 0 || !(CHANGES_DIRECTORY.has(words[0].text) || words[0].text === 'popd')) return cwds
    return [...new Set([...cwds, ...directoriesAfterCd({ words }, cwds, home)])]
  }

  const walkList = (list, cwds) => {
    let current = cwds
    let previous = null
    for (const { node, op } of list.items) {
      const after = walkNode(node, current)
      const detached = previous === '|' || previous === '|&' || op === '|' || op === '|&' || op === '&'
      if (!detached) current = after
      previous = op
    }
    return current
  }

  walkList(root, [cwd])
  return found
}
