import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { stateRoot } from './auth-store.mjs'
import { isInside } from './fsx.mjs'
import { commandsOf, parseShell, resolveWordPath } from './shell-tokens.mjs'

// What the guard decides about one shell command line or one file path: `allow` (no opinion: the tool's own rules
// apply), `ask` (the person must approve it) or `deny`. It looks for the usual ways of calling the things the kit
// protects. It does not stop someone who is set on getting round it: aliases, functions, `$cmd` as the command, a
// script that was written a moment ago, code inside `node -e`.

const MAX_NESTING = 4 // `bash -c '… bash -c …'`
const MAX_WORDS = 5000
const STORE_REASON = 'this would read the folders where fe-kit keeps saved logins and secrets'
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
const GLOB_CHARACTER = /[*?[]/

// A path (or any text) that names a store even when the shell has not expanded it yet.
const STORE_NAMES = [/\.config\/fe-kit(\/|$)/, /\/fe-kit\/auth(\/|$)/, /\$\{?FE_KIT_STATE_DIR/]

const EXEMPT = new Set(['cd', 'pushd', 'popd', 'echo', 'printf', 'ls', 'pwd']) // they print a name or list names; they do not read content
const RECURSIVE = new Set(['grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack', 'find', 'tar', 'zip', 'rsync', 'cp', 'scp', 'ditto', '7z', 'bsdtar', 'fd']) // they read everything below the folder they are given
const READERS = new Set([
  ...RECURSIVE, 'cat', 'head', 'tail', 'less', 'more', 'sed', 'awk', 'cut', 'sort', 'uniq', 'wc', 'od', 'xxd', 'hexdump', 'strings', 'base64', 'openssl', 'mv', 'unzip', 'gzip', 'gunzip', 'bzip2', 'xz',
  'jq', 'yq', 'nl', 'tee', 'dd', 'diff', 'cmp', 'bat', 'open', 'source', '.', 'vim', 'vi', 'nano', 'emacs', 'code',
])
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'ash', 'fish'])

// Programs that run another program: which options take a value, whether `NAME=value` words come before it, how many
// words before it are not options (`timeout 5 cmd`), and the subcommand they need (`npm exec`).
const WRAPPERS = {
  env: { arg: ['-u', '-C', '--unset', '--chdir'], assignments: true, refuse: ['-S', '--split-string'] },
  command: { query: ['-v', '-V'] },
  builtin: {},
  exec: { arg: ['-a'] },
  nohup: {},
  nice: { arg: ['-n', '--adjustment'] },
  setsid: {},
  time: { arg: ['-f', '-o', '--format', '--output'] },
  sudo: { arg: ['-u', '-g', '-C', '-D', '-h', '-p', '-r', '-t', '-T', '-U'] },
  doas: { arg: ['-u', '-C'] },
  timeout: { arg: ['-k', '-s', '--kill-after', '--signal'], positional: 1 },
  stdbuf: { arg: ['-i', '-o', '-e'] },
  caffeinate: { arg: ['-t', '-w'] },
  xargs: { arg: ['-I', '-n', '-P', '-L', '-s', '-d', '-E', '-a', '-J', '-R', '-S', '--max-args', '--max-procs', '--delimiter', '--arg-file', '--max-lines', '--eof'], xargs: true },
  npx: { arg: ['-p', '--package'], code: ['-c', '--call'] },
  bunx: { arg: ['-p', '--package'] },
  npm: { subcommands: ['exec', 'x'] },
  pnpm: { subcommands: ['exec', 'dlx'] },
  yarn: { subcommands: ['exec', 'dlx'] },
  bun: { subcommands: ['x'] },
}
const NODE_OPTIONS_WITH_VALUE = ['-r', '--require', '--import', '--loader', '--experimental-loader', '-C', '--conditions', '--inspect-port']
const NODE_INLINE_CODE = ['-e', '-p', '--eval', '--print']
const GIT_OPTIONS_WITH_VALUE = ['-C', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env']
const FIND_RUNS = ['-exec', '-execdir', '-ok', '-okdir']

const allow = { decision: 'allow', reason: 'nothing here needs approval' }
const ask = (reason) => ({ decision: 'ask', reason })
const deny = (reason) => ({ decision: 'deny', reason })

/** The real path of `path`, or of its nearest folder that exists (the path itself may not exist yet). */
function realPath(path) {
  try {
    return realpathSync(path)
  } catch {
    const parent = dirname(path)
    return parent === path ? path : join(realPath(parent), basename(path))
  }
}

/** The folders that hold the kit's secrets: the config folder, and the saved logins where `FE_KIT_STATE_DIR` points and in the default place. */
function protectedRoots(env, home) {
  const roots = [join(home, '.config', 'fe-kit'), join(stateRoot({ ...env, HOME: home }), 'auth'), join(home, '.local', 'state', 'fe-kit', 'auth')]
  return [...new Set(roots.flatMap((root) => [resolve(root), realPath(resolve(root))]))]
}

const prepare = ({ cwd = null, home = homedir(), env = process.env } = {}) => ({ cwd, home, roots: protectedRoots(env, home) })

const namesStore = (text, ctx) => STORE_NAMES.some((pattern) => pattern.test(text)) || ctx.roots.some((root) => text.includes(root))

const touchesStore = (path, ctx) => [path, realPath(path)].some((candidate) => ctx.roots.some((root) => isInside(candidate, root)))

/** Whether `path` is a folder with a store below it, or is one (a search from there would read the store). */
const containsStore = (path, ctx) => [path, realPath(path)].some((candidate) => ctx.roots.some((root) => isInside(root, candidate)))

/** Whether one name in a glob (`fe-*`, `.l*`, `[e]nv`) can match `name`; a `*` does not match a leading dot, as in the shell. */
function segmentMatches(pattern, name) {
  if (name.startsWith('.') && !pattern.startsWith('.')) return false
  if (pattern.length > 200) return true
  let source = ''
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index]
    if (char === '*') source += '[^/]*'
    else if (char === '?') source += '[^/]'
    else if (char === '[' && pattern.indexOf(']', index + 2) !== -1) {
      const end = pattern.indexOf(']', index + 2)
      const set = pattern.slice(index + 1, end).replace(/\\/g, '\\\\')
      source += `[${set.startsWith('!') ? `^${set.slice(1)}` : set}]`
      index = end
    } else source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  try {
    return new RegExp(`^${source}$`).test(name)
  } catch {
    return true // a pattern that cannot be read as a set could be anything
  }
}

/** `inside` when a glob below a folder can name the store or something in it, `ancestor` when it can name a folder above it, null otherwise. */
function globReach(patternSegments, rootSegments) {
  for (let index = 0; index < Math.min(patternSegments.length, rootSegments.length); index++) {
    if (patternSegments[index] === '**') return 'inside'
    if (!segmentMatches(patternSegments[index], rootSegments[index])) return null
  }
  return patternSegments.length >= rootSegments.length ? 'inside' : 'ancestor'
}

function globHitsStore(word, cwd, ctx, recursive) {
  const first = word.text.search(GLOB_CHARACTER)
  const slash = word.text.lastIndexOf('/', first)
  const folder = resolveWordPath({ ...word, text: slash === -1 ? '.' : word.text.slice(0, slash + 1), glob: false }, cwd, ctx.home)
  if (folder === null) return false
  const segments = word.text.slice(slash + 1).split('/').filter(Boolean)
  for (const base of new Set([folder, realPath(folder)])) {
    for (const root of ctx.roots) {
      if (isInside(base, root)) return true
      if (!isInside(root, base)) continue
      const reach = globReach(segments, relative(base, root).split(sep))
      if (reach === 'inside' || (reach === 'ancestor' && recursive)) return true
    }
  }
  return false
}

/** Whether a word names a store, or something in one, from any directory the command may run in. `search`: it reads everything below a folder it is given. */
function wordHitsStore(word, cwds, search, ctx) {
  if (namesStore(word.text, ctx)) return true
  return cwds.some((cwd) => {
    if (word.glob) return globHitsStore(word, cwd, ctx, search)
    const path = resolveWordPath(word, cwd, ctx.home)
    return path !== null && (touchesStore(path, ctx) || (search && containsStore(path, ctx)))
  })
}

/** Each way a program can be handed code or a command: the program, and what it runs. */
function skipOptions(args, spec, name) {
  let index = 0
  for (; index < args.length; ) {
    const text = args[index].text
    if (text === '--') {
      index++
      break
    }
    if (spec.assignments && ASSIGNMENT.test(text)) {
      index++
      continue
    }
    if (!text.startsWith('-') || text === '-') break
    if (spec.refuse?.some((option) => text === option || text.startsWith(option.startsWith('--') ? `${option}=` : option))) return { ask: `${name} ${text} hides the command it runs` }
    if (spec.query?.includes(text)) return { words: [] } // `command -v git` only looks
    if (spec.code?.includes(text)) return args[index + 1] === undefined || args[index + 1].dynamic ? { ask: `${name} ${text} runs code that is not known until it runs` } : { code: args[index + 1].text }
    index += spec.arg?.includes(text) ? 2 : 1
  }
  return { words: args.slice(index + (spec.positional ?? 0)) }
}

/** What `sh|bash|zsh … ` runs: the string after -c, or a script file; a shell that reads from standard input cannot be checked. */
function shellLaunch(name, args) {
  let code = false
  let stdin = false
  let index = 0
  for (; index < args.length; index++) {
    const text = args[index].text
    if (text === '--') {
      index++
      break
    }
    if (!text.startsWith('-') && !text.startsWith('+')) break
    if (text === '-') break
    if (['-o', '+o', '--rcfile', '--init-file'].includes(text)) index++
    else if (text.startsWith('-') && !text.startsWith('--')) {
      code ||= text.includes('c')
      stdin ||= text.includes('s')
    }
  }
  const rest = args.slice(index)
  if (code) return rest[0] === undefined || rest[0].dynamic ? { kind: 'ask', reason: `${name} is given a command that is not known until it runs` } : { kind: 'code', code: rest[0].text }
  if (stdin || rest.length === 0 || rest[0].text === '-') return { kind: 'ask', reason: `${name} reads its commands from standard input, which cannot be checked` }
  return { kind: 'run', name, args: rest }
}

/**
 * What a command really runs once `env`, `sudo`, `xargs`, `npx` and the like are taken off the front:
 * `{ kind: 'run', name, args }`, `{ kind: 'code', code }` (a string for a shell), `{ kind: 'ask', reason }`, or null.
 */
function launchOf(words) {
  let current = words
  let viaXargs = false
  for (let step = 0; step < 10; step++) {
    const [first, ...rest] = current
    if (first === undefined) return null
    const name = basename(first.text)
    if (/[$`*?[]/.test(name) && (first.dynamic || first.glob)) return null // the program itself is not known; `$HOME/bin/git` is: its name is
    if (name === 'eval') return rest.some((word) => word.dynamic) ? { kind: 'ask', reason: 'eval runs something that is not known until it runs' } : { kind: 'code', code: rest.map((word) => word.text).join(' ') }
    if (SHELLS.has(name)) return shellLaunch(name, rest)
    const spec = WRAPPERS[name]
    if (spec !== undefined) {
      if (spec.subcommands !== undefined && !spec.subcommands.includes(rest[0]?.text)) return { kind: 'run', name, args: rest, viaXargs }
      const unwrapped = skipOptions(spec.subcommands === undefined ? rest : rest.slice(1), spec, name)
      if (unwrapped.ask !== undefined) return { kind: 'ask', reason: unwrapped.ask }
      if (unwrapped.code !== undefined) return { kind: 'code', code: unwrapped.code }
      viaXargs ||= spec.xargs === true
      current = unwrapped.words
      continue
    }
    return { kind: 'run', name, args: rest, viaXargs }
  }
  return { kind: 'ask', reason: 'commands wrapped too deep to check' }
}

/** The git subcommand and what follows it; options in front (`-c k=v`, `-C dir`) are passed over. `problem` when an alias is defined on the line. */
function gitSubcommand(args) {
  for (let index = 0; index < args.length; index++) {
    const text = args[index].text
    if (text === '-c') {
      const value = args[index + 1]
      if (value === undefined || value.dynamic || /^alias\./i.test(value.text)) return { problem: 'git is given an alias on the line, and it may stand for a command that needs approval' }
      index++
    } else if (/^-calias\./i.test(text)) return { problem: 'git is given an alias on the line, and it may stand for a command that needs approval' }
    else if (GIT_OPTIONS_WITH_VALUE.includes(text)) index++
    else if (!text.startsWith('-')) return { sub: args[index], rest: args.slice(index + 1) }
  }
  return {}
}

function gitReason(args, viaXargs) {
  const { sub, rest, problem } = gitSubcommand(args)
  if (problem !== undefined) return problem
  if (sub === undefined) return viaXargs ? 'git gets its subcommand from xargs, which cannot be checked' : null
  if (sub.dynamic || sub.glob) return 'git is run with a subcommand that is not known until it runs'
  if (sub.text === 'commit' || sub.text === 'push') return `git ${sub.text} needs your approval`
  if (sub.text === 'reset' && rest.some((word) => word.text.startsWith('--hard'))) return 'git reset --hard needs your approval'
  if (sub.text === 'clean' && rest.some((word) => word.text === '--force' || /^-[A-Za-z]*f[A-Za-z]*$/.test(word.text))) return 'git clean -f needs your approval'
  return null
}

function feKitReason(args, viaXargs) {
  const [sub] = args
  if (sub === undefined) return viaXargs ? 'fe-kit gets its subcommand from xargs, which cannot be checked' : null
  if (sub.dynamic || sub.glob) return 'fe-kit is run with a subcommand that is not known until it runs'
  if (['ui-act', 'link', 'unlink'].includes(sub.text)) return `fe-kit ${sub.text} needs your approval`
  if (sub.text === 'mr') {
    const action = args.slice(1).find((word) => !word.text.startsWith('-'))
    if (action?.dynamic) return 'fe-kit mr is run with an action that is not known until it runs'
    if (action !== undefined && ['post', 'publish'].includes(action.text)) return `fe-kit mr ${action.text} needs your approval`
  }
  return null
}

/** The launches inside `find … -exec CMD ;` (or `+`). */
function findLaunches(args) {
  const launches = []
  for (let index = 0; index < args.length; index++) {
    if (!FIND_RUNS.includes(args[index].text)) continue
    const words = []
    for (index++; index < args.length && args[index].text !== ';' && args[index].text !== '+'; index++) words.push(args[index])
    launches.push(launchOf(words))
  }
  return launches
}

/** Pushes what a launch needs asking about; a string for a shell is read as a command line of its own. */
function inspectLaunch(launch, cwds, ctx, depth, findings) {
  if (launch === null) return
  if (launch.kind === 'ask') findings.push(ask(launch.reason))
  else if (launch.kind === 'code') for (const cwd of cwds) inspectLine(launch.code, ctx, cwd, depth + 1, findings)
  else {
    let reason = null
    if (launch.name === 'git') reason = gitReason(launch.args, launch.viaXargs)
    else if (launch.name === 'fe-kit') reason = feKitReason(launch.args, launch.viaXargs)
    else if (launch.name === 'node') reason = nodeReason(launch.args)
    else if (launch.name === 'find') for (const found of findLaunches(launch.args)) inspectLaunch(found, cwds, ctx, depth, findings)
    if (reason !== null) findings.push(ask(reason))
  }
}

/** `node …/fe-kit.mjs <subcommand>`: node's own options are passed over. */
function nodeReason(args) {
  for (let index = 0; index < args.length; index++) {
    const text = args[index].text
    if (NODE_INLINE_CODE.includes(text)) return null
    if (NODE_OPTIONS_WITH_VALUE.includes(text)) index++
    else if (!text.startsWith('-')) return basename(text) === 'fe-kit.mjs' ? feKitReason(args.slice(index + 1), false) : null
  }
  return null
}

// How the programs that search below a folder are called. Each one: the short options that take a value (`rg -g '*.js'`), and
// below, the short flags, the long options that take a value and the long flags that all of them share. A word that is none of
// these may or may not take the next word as its value, and the person is asked about it instead of the guard guessing.
const SEARCH_VALUE_LETTERS = { rg: 'efgtTABCEjMmrd', grep: 'efmABCdD', egrep: 'efmABCdD', fgrep: 'efmABCdD', ag: 'ABCGgmp', ack: 'ABCmgG' }
const SEARCH_FLAG_LETTERS = 'iIsSFwvnNlLcqHhoUuaxPzZVbrRkKTpyE0123456789'
const SEARCH_LONG_VALUES = new Set([
  '--regexp', '--file', '--glob', '--iglob', '--type', '--type-not', '--type-add', '--type-clear', '--after-context', '--before-context', '--context', '--max-count', '--max-depth', '--maxdepth', '--max-filesize', '--max-columns', '--threads',
  '--directories', '--devices', '--include', '--exclude', '--exclude-dir', '--exclude-from', '--include-dir', '--label', '--replace', '--engine', '--sort', '--sortr', '--pre', '--pre-glob', '--colors', '--color', '--path-separator', '--ignore-file',
  '--encoding', '--binary-files', '--group-separator', '--context-separator', '--field-context-separator', '--field-match-separator', '--dfa-size-limit', '--regex-size-limit', '--hostname-bin', '--hyperlink-format', '--generate', '--depth',
  '--workers', '--pager', '--file-search-regex', '--ignore', '--path-to-ignore',
])
const SEARCH_LONG_FLAGS = new Set([
  '--files', '--hidden', '--no-ignore', '--no-ignore-vcs', '--no-ignore-dot', '--no-ignore-global', '--no-ignore-parent', '--no-ignore-files', '--no-require-git', '--follow', '--count', '--count-matches', '--ignore-case', '--smart-case', '--case-sensitive',
  '--fixed-strings', '--word-regexp', '--line-regexp', '--line-number', '--no-line-number', '--heading', '--no-heading', '--with-filename', '--no-filename', '--files-with-matches', '--files-without-match', '--invert-match', '--json', '--vimgrep',
  '--column', '--no-messages', '--text', '--multiline', '--multiline-dotall', '--stats', '--null', '--null-data', '--quiet', '--silent', '--only-matching', '--pretty', '--unrestricted', '--trim', '--binary', '--no-config', '--debug', '--trace',
  '--glob-case-insensitive', '--one-file-system', '--sort-files', '--pcre2', '--crlf', '--mmap', '--no-mmap', '--block-buffered', '--line-buffered', '--passthru', '--search-zip', '--no-unicode', '--recursive', '--dereference-recursive',
  '--extended-regexp', '--basic-regexp', '--perl-regexp', '--initial-tab', '--byte-offset', '--no-ignore-case', '--color', '--colour', '--literal', '--all-text', '--skip-vcs-ignores', '--numbers', '--nonumbers', '--word', '--invert',
])
const SEARCH_NO_PATTERN = new Set(['--files', '--type-list', '--version', '--help', '--pcre2-version', '--generate', '-V'])
const SEARCH_NO_SEARCH = new Set(['--type-list', '--version', '--help', '--pcre2-version', '--generate', '-V'])
const PATTERN_LETTERS = 'ef' // the pattern comes from an option: the next word is it (-e) or a file of them (-f)
const PATTERN_LONG = ['--regexp', '--file']
const RG_ONLY_VALUES = ['--color'] // `grep --color` takes its value attached; for rg it is the next word
const GREPS = new Set(['grep', 'egrep', 'fgrep'])
const FIND_EXPRESSION_START = /^(-|!$|\(|\)$)/

/**
 * What a program that searches below a folder is given: `patterns` (the words that are the pattern, not folders), whether it
 * `searches` the folder it runs in for certain (given no folder) or `maybe` (given an option it does not know, which could
 * have used up the one word that looks like a folder). Null for a program that is not one of these, or a call that searches nothing.
 */
function searchShape(name, args) {
  if (name === 'find') return { patterns: [], searches: args.length === 0 || FIND_EXPRESSION_START.test(args[0].text), maybe: false }
  const letters = SEARCH_VALUE_LETTERS[name]
  if (letters === undefined) return null
  if (GREPS.has(name) && !args.some((word) => /^-[A-Za-z]*[rR]/.test(word.text) || /^--(dereference-)?recursive$/.test(word.text))) return null // without -r it reads its input
  const operands = []
  const patterns = [] // the words that are the pattern, taken from -e
  let patternFromOption = false
  let withoutPattern = false
  let unknown = 0
  for (let index = 0; index < args.length; index++) {
    const text = args[index].text
    if (text === '--') {
      operands.push(...args.slice(index + 1))
      break
    }
    if (SEARCH_NO_SEARCH.has(text)) return null
    if (!text.startsWith('-') || text === '-') operands.push(args[index])
    else if (text.startsWith('--')) {
      const [option, attached] = [text.split('=')[0], text.includes('=')]
      if (SEARCH_NO_PATTERN.has(option)) withoutPattern = true
      if (PATTERN_LONG.includes(option)) patternFromOption = true
      if (SEARCH_LONG_VALUES.has(option) && !(name !== 'rg' && RG_ONLY_VALUES.includes(option))) {
        if (!attached) {
          if (option === '--regexp') patterns.push(args[index + 1])
          index++
        }
      } else if (!SEARCH_LONG_FLAGS.has(option) && !attached) unknown++
    } else {
      for (let at = 1; at < text.length; at++) {
        const letter = text[at]
        if (letters.includes(letter)) {
          if (PATTERN_LETTERS.includes(letter)) patternFromOption = true
          if (at === text.length - 1) {
            if (letter === 'e') patterns.push(args[index + 1])
            index++ // the value is the next word; otherwise it is attached
          }
          break
        }
        if (!SEARCH_FLAG_LETTERS.includes(letter)) {
          unknown++
          break
        }
      }
    }
  }
  const patternCount = patternFromOption || withoutPattern ? 0 : 1
  const folders = operands.length - patternCount
  return { patterns: [...patterns, ...operands.slice(0, patternCount)].filter((word) => word !== undefined), searches: folders <= 0, maybe: folders > 0 && folders - unknown <= 0 }
}

function inspectStore(command, launch, ctx, findings) {
  const name = launch?.kind === 'run' ? launch.name : null
  const found = () => findings.push(deny(STORE_REASON))
  for (const word of command.assigns) if (namesStore(word.text, ctx)) found()
  for (const heredoc of command.heredocs) if (namesStore(heredoc.body, ctx)) found()
  for (const { target } of command.redirects) if (wordHitsStore(target, command.cwds, false, ctx)) found() // a redirection reads or writes the file whatever the command is
  if (command.words.length === 0 || (name !== null && EXEMPT.has(name))) return
  const recursive = name !== null && RECURSIVE.has(name)
  const shape = recursive ? searchShape(name, launch.args) : null
  if (command.cwds.some((cwd) => cwd !== null && touchesStore(cwd, ctx))) found()
  for (const [index, word] of command.words.entries()) {
    if (index === 0 && !word.text.includes('/')) continue // a program found on the PATH is not a file in this folder
    if (shape?.patterns.includes(word)) {
      if (namesStore(word.text, ctx)) found() // what it looks for is not a folder, but a name that is a store is refused
      continue
    }
    if (wordHitsStore(word, command.cwds, recursive, ctx)) found()
  }
  if (shape !== null && (shape.searches || shape.maybe)) {
    if (command.cwds.some((cwd) => cwd !== null && containsStore(cwd, ctx))) {
      if (shape.searches) found()
      else findings.push(ask(`${name} is given an option that is not known, so it may search the folder it runs in, which holds the folders of fe-kit's secrets`))
    } else if (command.cwds.includes(null)) findings.push(ask(`${name} searches the folder it runs in, and that is not known (after a cd that could not be followed)`))
  }
  // A relative name read after a `cd` that cannot be followed may be anywhere, the store included.
  if (name !== null && READERS.has(name) && command.cwds.includes(null)) {
    const dependsOnDirectory = (word) => !word.text.startsWith('-') && resolveWordPath(word, '/', ctx.home) !== null && resolveWordPath(word, null, ctx.home) === null
    if (launch.args.some(dependsOnDirectory)) findings.push(ask(`${name} reads a name relative to a folder that is not known (after a cd that could not be followed)`))
  }
}

function inspectLine(line, ctx, cwd, depth, findings) {
  if (depth > MAX_NESTING) {
    findings.push(ask('shell commands nested too deep to check'))
    return null
  }
  const parsed = parseShell(line)
  if (!parsed.ok) {
    findings.push(ask(`the command line could not be read (${parsed.error}), so it is not checked`))
    if (namesStore(line, ctx)) findings.push(deny(STORE_REASON))
    return null
  }
  const commands = commandsOf(parsed.root, { cwd, home: ctx.home })
  if (commands.reduce((total, command) => total + command.words.length + command.assigns.length, 0) > MAX_WORDS) {
    findings.push(ask('too many words in the command line to check'))
    return null
  }
  for (const command of commands) {
    const launch = launchOf(command.words)
    inspectStore(command, launch, ctx, findings)
    inspectLaunch(launch, command.cwds, ctx, depth, findings)
  }
  return { root: parsed.root, commands }
}

/** The words of a line that is one plain command (no assignment, redirection, expansion or nesting): what the tool's own rules see as its argv. */
function plainArgv(read) {
  if (read === null || read.root.items.length !== 1 || read.root.items[0].node.type !== 'command' || !['\n', ';', null].includes(read.root.items[0].op)) return null
  const [command] = read.commands
  if (read.commands.length !== 1) return null
  const plain = command.assigns.length === 0 && command.redirects.length === 0 && command.heredocs.length === 0 && command.words.every((word) => !word.dynamic && word.subs.length === 0)
  return plain && command.words.length > 0 ? command.words.map((word) => word.text) : null
}

const strongest = (findings) => findings.find((finding) => finding.decision === 'deny') ?? findings.find((finding) => finding.decision === 'ask') ?? allow

/** `{ decision, reason, argv }` for a shell command line (`argv`: see `plainArgv`, else null). `context`: `{ cwd, home, env }`. */
export function decideCommand(commandLine, context) {
  const findings = []
  const ctx = prepare(context)
  const read = inspectLine(String(commandLine ?? ''), ctx, ctx.cwd, 0, findings)
  return { ...strongest(findings), argv: plainArgv(read) }
}

/**
 * `{ decision, reason }` for a file a tool is about to read. With `search`, the path is a folder (or a glob) a search
 * starts from, so a folder that has a store below it counts.
 */
export function decidePath(path, context, { search = false } = {}) {
  if (typeof path !== 'string' || path === '') return allow
  const ctx = prepare(context)
  const word = { text: path, dynamic: false, quoted: false, glob: GLOB_CHARACTER.test(path), tilde: path === '~' || path.startsWith('~/'), subs: [] }
  return wordHitsStore(word, [ctx.cwd], search, ctx) ? deny(STORE_REASON) : allow
}
