import { spawn } from 'node:child_process'

// Claude and Codex run the command when a hook crashes, prints something unreadable or is killed for taking too long
// (measured, docs/spike.md S12). So the hook is a small supervisor: it reads the input, hands it to a worker in a
// process of its own, and answers itself. The time limit runs from the first moment and is shorter than the one the
// host is told to use, and anything but a clean, well-formed answer is a block (exit 2, which all three tools obey).
// What it cannot cover is the supervisor itself failing to start; `fe-kit doctor` runs it to find out.

export const HOST_TIMEOUT_SECONDS = 10
export const DEADLINE_MS = 6000
const MAX_INPUT = 1024 * 1024
const MAX_OUTPUT = 64 * 1024

/**
 * Resolves `{ exitCode, stdout, stderr }`, never rejects. The worker prints `{ exitCode, stdout }` as JSON, where
 * `exitCode` is 0 (answer with `stdout`) or 2 (block).
 */
export function supervise({ input, workerPath, command = process.execPath, deadlineMs = DEADLINE_MS, maxInput = MAX_INPUT, maxOutput = MAX_OUTPUT }) {
  return new Promise((resolve) => {
    let settled = false
    let child = null
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child?.kill('SIGKILL')
      input.destroy?.()
      resolve(result)
    }
    const block = (why) => finish({ exitCode: 2, stdout: '', stderr: `fe-kit shell-guard: blocked because the guard could not decide (${why}); run the command yourself in a terminal if you meant it\n` })
    const timer = setTimeout(() => block('the guard did not answer in time'), deadlineMs)

    const received = []
    let receivedBytes = 0
    input.on('error', () => block('the input could not be read'))
    input.on('data', (chunk) => {
      receivedBytes += chunk.length
      if (receivedBytes > maxInput) block('the input is too large')
      else received.push(chunk)
    })
    input.on('end', () => {
      if (!settled) startWorker(Buffer.concat(received))
    })

    function startWorker(body) {
      child = spawn(command, [workerPath], { stdio: ['pipe', 'pipe', 'ignore'] })
      child.on('error', () => block('the guard could not be started'))
      child.stdin.on('error', () => {}) // a worker that exits before reading everything: its exit tells
      child.stdin.end(body)
      let output = ''
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk) => {
        output += chunk
        if (output.length > maxOutput) return block('the answer is too large')
        const answer = output.endsWith('}') ? readAnswer(output) : null
        if (answer === false) block('the guard gave an answer that cannot be read')
        else if (answer !== null) finish({ exitCode: answer.exitCode, stdout: answer.stdout, stderr: typeof answer.stderr === 'string' ? answer.stderr : '' })
      })
      child.on('close', () => block('the guard gave no answer'))
    }
  })
}

/** The worker's answer when `text` is a whole, valid one; null while it is not whole yet; false when it is whole and wrong. */
function readAnswer(text) {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  return (parsed?.exitCode === 0 || parsed?.exitCode === 2) && typeof parsed.stdout === 'string' ? parsed : false
}
