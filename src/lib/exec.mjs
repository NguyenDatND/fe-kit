import { spawn } from 'node:child_process'

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000
const DEFAULT_MAX_OUTPUT_BYTES = 2 * 1024 * 1024
const DRAIN_MS = 1500 // after the program has exited: how long what it left behind may keep its output open
const GRACE_MS = 3000 // after asking a timed-out command to stop: wait this long, then kill it; wait as long again, then stop waiting for it
const WORD_LOOKBACK = 4096 // how far from a cut to look for the whitespace to cut at
const ESC = String.fromCharCode(27)
const ANSI = new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]`, 'g')
const POSIX = process.platform !== 'win32'

/**
 * Colour codes out, and a line redrawn with carriage returns (a progress bar) reduced to its last state. Line by line, so
 * the time stays linear: a regex that looked for "anything up to a \r" would retry from every character of a long line
 * that has none (one JSON report is one line), and this runs synchronously, out of reach of any timeout.
 */
const clean = (text) =>
  text
    .replace(ANSI, '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.slice(line.lastIndexOf('\r') + 1))
    .join('\n')

/** Stops the process and everything it started: its own process group on POSIX, `taskkill /T` on Windows. */
function killTree(child, signal) {
  if (child.pid === undefined) return
  try {
    if (POSIX) process.kill(-child.pid, signal)
    else spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  } catch {
    // already gone
  }
}

/** The text up to its last whitespace, when there is one near the end: a word cut in half at the edge is dropped. */
function endAtWord(text) {
  for (let index = text.length - 1; index >= Math.max(0, text.length - WORD_LOOKBACK); index--) {
    if (/\s/.test(text[index])) return text.slice(0, index)
  }
  return text
}

/** The text from its first whitespace, when there is one near the start. */
function startAtWord(text) {
  const index = text.slice(0, WORD_LOOKBACK).search(/\s/)
  return index === -1 ? text : text.slice(index)
}

/**
 * Keeps the first and the last half of `maxBytes`. What a command prints at the start (the first error) and at the end
 * (the summary) is what is read; the middle is what a long run can afford to lose.
 */
function outputCollector(maxBytes) {
  const headLimit = Math.floor(maxBytes / 2)
  const tailLimit = maxBytes - headLimit
  let head = Buffer.alloc(0)
  let tail = Buffer.alloc(0)
  let omitted = 0
  return {
    add(chunk) {
      if (head.length < headLimit) {
        const room = headLimit - head.length
        head = Buffer.concat([head, chunk.subarray(0, room)])
        chunk = chunk.subarray(room)
      }
      if (chunk.length > 0) {
        tail = Buffer.concat([tail, chunk])
        if (tail.length > tailLimit) {
          omitted += tail.length - tailLimit
          tail = tail.subarray(tail.length - tailLimit)
        }
      }
    },
    result() {
      // The cut falls wherever the byte count says, which can be inside a URL with a password: the half that is left
      // at an edge has no `@` for the redaction to find. So a cut is made between words.
      const cut = omitted > 0
      const marker = cut ? `\n[... ${omitted} bytes omitted ...]\n` : ''
      const first = cut ? endAtWord(head.toString('utf8')) : head.toString('utf8')
      const last = cut ? startAtWord(tail.toString('utf8')) : tail.toString('utf8')
      return { output: clean(`${first}${marker}${last}`), omittedBytes: omitted }
    },
  }
}

const childEnvironment = (env) => ({ ...env, NO_COLOR: '1', FORCE_COLOR: '0', CI: env.CI ?? 'true' })

/** Runs what `start` spawns to the end. Never rejects: a command that fails, hangs or cannot start is a result. */
function capture(start, { timeoutMs = DEFAULT_TIMEOUT_MS, maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES, graceMs = GRACE_MS, drainMs = DRAIN_MS, stderr = 'merge' } = {}) {
  return new Promise((resolve) => {
    const began = performance.now()
    const collector = outputCollector(maxOutputBytes)
    const finish = (extra) => resolve({ exitCode: null, signal: null, timedOut: false, ...collector.result(), durationMs: Math.round(performance.now() - began), ...extra })

    let child
    try {
      child = start()
    } catch (error) {
      finish({ error: error.message })
      return
    }

    let timedOut = false
    let settled = false
    const timers = []
    const relays = []
    const settle = (extra) => {
      if (settled) return
      settled = true
      for (const timer of timers) clearTimeout(timer)
      for (const [signal, relay] of relays) process.off(signal, relay)
      // Something that left the process group can hold the pipes open for ever, and open pipes keep fe-kit from exiting.
      child.stdout.destroy()
      child.stderr.destroy()
      child.unref()
      finish({ timedOut, ...extra })
    }

    child.stdout.on('data', (chunk) => collector.add(chunk))
    if (stderr === 'discard') child.stderr.resume() // read and dropped, so that the program is never blocked on a full pipe
    else child.stderr.on('data', (chunk) => collector.add(chunk))
    child.on('error', (error) => {
      if (child.pid === undefined) settle({ error: error.message })
    })
    child.on('close', (exitCode, signal) => {
      killTree(child, 'SIGKILL') // what the command left running with its output sent elsewhere would outlive it
      settle({ exitCode, signal })
    })
    // `close` waits for every holder of the output pipes, and a program can exit while something it started (`vite
    // preview &`) still holds them: the program's own exit is its result. Give the last of its output a moment to
    // arrive, then stop what it left behind and settle.
    child.on('exit', (exitCode, signal) => {
      if (settled) return
      timers.push(
        setTimeout(() => {
          killTree(child, 'SIGKILL')
          settle({ exitCode, signal })
        }, drainMs),
      )
    })

    timers.push(
      setTimeout(() => {
        timedOut = true
        killTree(child, 'SIGTERM')
        timers.push(
          setTimeout(() => killTree(child, 'SIGKILL'), graceMs),
          setTimeout(() => settle({ exitCode: null, signal: 'SIGKILL' }), graceMs * 2),
        )
      }, timeoutMs),
    )

    // When fe-kit is told to stop, what it started must not go on running on its own: it has its own process group.
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
      const relay = () => {
        killTree(child, 'SIGKILL')
        process.kill(process.pid, signal) // the handler is gone now (once), so this takes the default way out
      }
      relays.push([signal, relay])
      process.once(signal, relay)
    }
  })
}

/** Whether a run went well: it exited 0 and was not stopped. A program that exits 0 when asked to stop has still run too long. */
export const succeeded = (result) => result.exitCode === 0 && !result.timedOut

/**
 * One word for the shell, whatever the argument holds: a plain word as it is, otherwise POSIX single quotes (a `'` is written `'\''`), cmd.exe double
 * quotes (a `"` is doubled). The Windows form is a best effort and has not been tried (Phase 8).
 */
export function shellQuote(argument) {
  if (/^[\w@%+=:,./-]+$/.test(argument)) return argument // nothing in it for a shell to act on
  return POSIX ? `'${argument.replace(/'/g, "'\\''")}'` : `"${argument.replace(/"/g, '""')}"`
}

/**
 * Whether `needle` stands inside quotes or backticks, in a here-document, or right after a backslash, in a shell command line. A file name that fe-kit
 * puts there would not be one word any more: inside double quotes `$(...)` and backticks would run.
 */
export function isQuoted(command, needle) {
  let quote = null
  for (let index = 0; index < command.length; index++) {
    if (command.startsWith(needle, index)) {
      if (quote !== null) return true
      index += needle.length - 1
      continue
    }
    const char = command[index]
    if (quote === null && char === '#' && (index === 0 || /[\s;&|(]/.test(command[index - 1]))) {
      // A comment runs to the end of the line, and a name with a newline in it would end it: the code after it would run.
      const end = command.indexOf('\n', index)
      return command.slice(index, end === -1 ? command.length : end).includes(needle) || (end !== -1 && isQuoted(command.slice(end + 1), needle))
    }
    if (quote === "'") {
      if (char === "'") quote = null
    } else if (quote === "$'") {
      // $'...' is the one single-quoted form where a backslash escapes: `$'a\'{files}'` is still inside the string.
      if (char === '\\') index++
      else if (char === "'") quote = null
    } else if (char === '\\') {
      if (command.startsWith(needle, index + 1)) return true
      index++ // the next character is a plain one, whatever it is
    } else if (quote === '`') {
      if (char === '`') quote = null // a name with a backtick in it would end the command substitution and run what follows
    } else if (quote === '"' && (command.startsWith('$(', index) || command.startsWith('${', index) || char === '`')) {
      // Inside these the quotes start afresh, so the `"` that follows is not the end of this string. Telling which one
      // it ends would take a parser; a name anywhere after this point counts as quoted (a bare one gets refused too, which is the safe side).
      return command.includes(needle, index)
    } else if (char === '"') {
      quote = quote === '"' ? null : '"'
    } else if (quote === null && (char === "'" || char === '`')) {
      quote = char === "'" && command[index - 1] === '$' ? "$'" : char
    } else if (quote === null && command.startsWith('$((', index)) {
      // Arithmetic, where `<<` is a shift: a plain expression up to its `))`. `$((echo a); echo b)` is a subshell and is read on.
      const close = command.indexOf('))', index + 3)
      const inside = close === -1 ? null : command.slice(index + 3, close)
      if (inside !== null && !/[;&|\n`]|\$\(/.test(inside)) {
        if (inside.includes(needle)) return true
        index = close + 1
      }
    } else if (quote === null && char === '<' && command.startsWith('<<', index) && command[index + 2] !== '<' && command[index - 1] !== '<') {
      return command.includes(needle, index) // a here-document: its lines are not words at all, so a name in them is never quoted
    }
  }
  return false
}

const SPAWN_OPTIONS = { stdio: ['ignore', 'pipe', 'pipe'], detached: POSIX }

/**
 * Runs a shell command line (a script from package.json, a command from a profile). Every step is one-shot: stdin is
 * closed, colour is off and CI is on so that a test runner does not wait in watch mode.
 * Resolves `{ exitCode, signal, timedOut, output, omittedBytes, durationMs, error? }`. `output` holds stdout and stderr in the
 * order they came; with `{ stderr: 'discard' }` it holds stdout only (for a program whose stdout is data and whose
 * stderr may carry warnings).
 */
export const runCommand = (command, { cwd, env = process.env, ...limits } = {}) =>
  capture(() => spawn(command, { ...SPAWN_OPTIONS, shell: true, cwd, env: childEnvironment(env) }), limits)

/** Like runCommand, but runs a program with an argument list: nothing goes through a shell, so nothing is interpreted. */
export const runFile = (file, args, { cwd, env = process.env, ...limits } = {}) =>
  capture(() => spawn(file, args, { ...SPAWN_OPTIONS, cwd, env: childEnvironment(env) }), limits)
