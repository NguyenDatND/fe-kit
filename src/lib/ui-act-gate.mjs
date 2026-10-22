import { closeSync, openSync, writeSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { ReadStream } from 'node:tty'
import { UsageError } from './errors.mjs'

/**
 * `ui-act` lets one write request through on a read-only target. What makes that safe is a person seeing the request before it
 * is sent. The person types `yes` at the terminal (`/dev/tty`), which a program that was started by a tool, with no terminal of
 * its own, cannot do for them: there the command stops and says to run it in a terminal. It is not proof against an agent that
 * builds a terminal of its own, or one that drives Playwright by itself; that is outside what the kit can stop.
 * The runner holds a second lock (`assertUiActEnabled`) so that no other way of calling it lets a write through unasked.
 */

const ANSWER_WAIT_MS = 120_000

export function assertUiActEnabled(deps) {
  if (deps?.uiActGate?.() !== true) {
    throw new UsageError('ui-act cannot run without a person confirming the request at a terminal: use the fe-kit ui-act command')
  }
}

/**
 * The terminal of the person at the keyboard, or null when this process has none (a tool's shell has not). The input is a
 * terminal stream and not a file handle: a file handle waits for a read that is under way before it closes, and a read of
 * a terminal nobody types on never ends, so the time limit could not end the question.
 */
function openTty() {
  let input
  let output
  try {
    input = openSync('/dev/tty', 'r')
    output = openSync('/dev/tty', 'w')
    return { input: new ReadStream(input), output: { write: (text) => writeSync(output, text) }, close: () => { closeSync(output) } }
  } catch {
    for (const fd of [input, output]) if (fd !== undefined) closeSync(fd)
    return null
  }
}

/** Shows `message` and reads one line: true for exactly `yes`, false for anything else or no answer in time, null with no terminal. */
export async function confirmOnTerminal(message, { openTerminal = openTty, timeoutMs = ANSWER_WAIT_MS } = {}) {
  const terminal = await openTerminal()
  if (terminal === null) return null
  const lines = createInterface({ input: terminal.input })
  let timer
  try {
    return await new Promise((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs)
      lines.once('line', (line) => resolve(line.trim() === 'yes'))
      lines.once('close', () => resolve(false))
      terminal.output.write(`${message}\n> `)
    })
  } finally {
    clearTimeout(timer)
    lines.close()
    terminal.input.destroy()
    await terminal.close()
  }
}

/** Asks the person; resolves when they said yes, otherwise throws a usage error that says why. `deps.confirm` is a seam for tests. */
export async function confirmUiAct({ request, target, role, deps }) {
  const message = [
    'fe-kit ui-act wants to let ONE write request through on a read-only target:',
    `  ${request}`,
    `  target: ${target}${role === undefined ? '' : `, role: ${role}`}`,
    'This can change data on that server. Type yes to allow it; anything else refuses.',
  ].join('\n')
  const answer = await (deps?.confirm ?? confirmOnTerminal)(message)
  if (answer === null) throw new UsageError('ui-act needs a person at a terminal to confirm the request, and there is none here: run the command yourself in a terminal')
  if (answer !== true) throw new UsageError('ui-act was not confirmed: nothing was sent')
}
