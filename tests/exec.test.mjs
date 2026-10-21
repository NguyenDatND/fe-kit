import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { isQuoted, runCommand, runFile, shellQuote } from '../src/lib/exec.mjs'
import { tempDir } from './helpers.mjs'

const execModule = fileURLToPath(new URL('../src/lib/exec.mjs', import.meta.url))
const ESC = String.fromCharCode(27)

async function script(t, body, name = 'run.mjs') {
  const dir = await tempDir(t)
  await writeFile(join(dir, name), body)
  return dir
}

const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
async function waitUntilGone(pid, ms = 3000) {
  for (let waited = 0; waited < ms && alive(pid); waited += 50) await sleep(50)
  return !alive(pid)
}
async function readPid(file) {
  for (let tries = 0; tries < 100; tries++) {
    const text = await readFile(file, 'utf8').catch(() => '')
    if (text.trim() !== '') return Number(text)
    await sleep(50)
  }
  throw new Error('the pid file never appeared')
}

test('reports the exit code and what was written to stdout and stderr', async (t) => {
  const dir = await script(t, "console.log('to-out'); console.error('to-err'); process.exit(3)")

  const result = await runCommand('node run.mjs', { cwd: dir })

  assert.equal(result.exitCode, 3)
  assert.equal(result.signal, null)
  assert.equal(result.timedOut, false)
  assert.match(result.output, /to-out/)
  assert.match(result.output, /to-err/)
  assert.ok(result.durationMs >= 0)
})

test('a command that succeeds has exit code 0, and no signal handler is left behind', async (t) => {
  const dir = await script(t, 'process.exit(0)')
  const handlers = () => process.listenerCount('SIGINT') + process.listenerCount('SIGTERM') + process.listenerCount('SIGHUP')
  const before = handlers()

  assert.equal((await runCommand('node run.mjs', { cwd: dir })).exitCode, 0)
  assert.equal(handlers(), before)
})

test('colour codes are removed and a progress line redrawn with carriage returns keeps its last state', async (t) => {
  const dir = await script(t, `process.stdout.write('${ESC}[31mred${ESC}[0m\\n10%\\r50%\\r100%\\ndone\\r\\n')`)

  const { output } = await runCommand('node run.mjs', { cwd: dir })

  assert.equal(output, 'red\n100%\ndone\n')
})

test('runs in the given directory and environment, with colour off and CI on unless the caller says otherwise', async (t) => {
  const dir = await script(t, 'console.log([process.cwd(), process.env.KEEP, process.env.NO_COLOR, process.env.FORCE_COLOR, process.env.CI].join("|"))')

  const defaults = await runCommand('node run.mjs', { cwd: dir, env: { ...process.env, KEEP: 'yes', FORCE_COLOR: '1', CI: undefined } })
  const explicit = await runCommand('node run.mjs', { cwd: dir, env: { ...process.env, KEEP: 'yes', CI: 'false' } })

  assert.equal(defaults.output.trim(), `${dir}|yes|1|0|true`)
  assert.equal(explicit.output.trim().split('|').at(-1), 'false')
})

test('the child is never left waiting for input', async (t) => {
  const dir = await script(t, "process.stdin.resume(); process.stdin.on('end', () => console.log('eof'))")

  const result = await runCommand('node run.mjs', { cwd: dir, timeoutMs: 5000 })

  assert.equal(result.timedOut, false)
  assert.match(result.output, /eof/)
})

test('a command that runs too long is stopped, and so is everything it started', async (t) => {
  const dir = await script(t, 'import { spawn } from "node:child_process"; import { writeFileSync } from "node:fs"; const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" }); writeFileSync("child.pid", String(child.pid)); setInterval(() => {}, 1000)')

  const started = Date.now()
  const result = await runCommand('node run.mjs', { cwd: dir, timeoutMs: 500 })
  const grandchild = await readPid(join(dir, 'child.pid'))

  assert.equal(result.timedOut, true)
  assert.ok(Date.now() - started < 5000, 'took too long to stop')
  assert.ok(await waitUntilGone(grandchild), 'the grandchild is still running')
})

test('a command that ignores the request to stop is killed after the grace period', async (t) => {
  const dir = await script(t, 'import { writeFileSync } from "node:fs"; process.on("SIGTERM", () => {}); writeFileSync("run.pid", String(process.pid)); setInterval(() => {}, 1000)')

  const started = Date.now()
  const result = await runCommand('node run.mjs', { cwd: dir, timeoutMs: 300, graceMs: 300 })

  assert.equal(result.timedOut, true)
  assert.ok(Date.now() - started < 4000)
  assert.ok(await waitUntilGone(await readPid(join(dir, 'run.pid'))), 'the command is still running')
})

test('a result comes back, and fe-kit can exit, even when something that escaped the process group keeps the output open', async (t) => {
  const dir = await script(t, 'import { spawn } from "node:child_process"; import { writeFileSync } from "node:fs"; const escaped = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: ["ignore", "inherit", "inherit"] }); writeFileSync("escaped.pid", String(escaped.pid)); escaped.unref(); setInterval(() => {}, 1000)')
  await writeFile(join(dir, 'driver.mjs'), `import { runCommand } from ${JSON.stringify(execModule)}; const result = await runCommand('node run.mjs', { cwd: ${JSON.stringify(dir)}, timeoutMs: 300, graceMs: 300 }); console.log(JSON.stringify({ timedOut: result.timedOut }))`)
  const driver = spawn(process.execPath, [join(dir, 'driver.mjs')], { stdio: ['ignore', 'pipe', 'ignore'] })
  let printed = ''
  driver.stdout.on('data', (chunk) => (printed += chunk))
  const exited = new Promise((resolve) => driver.on('exit', (code, signal) => resolve({ code, signal })))
  const watchdog = setTimeout(() => driver.kill('SIGKILL'), 8000) // without the fix the driver never gets to exit

  const outcome = await exited
  clearTimeout(watchdog)
  const escaped = await readPid(join(dir, 'escaped.pid'))

  try {
    assert.deepEqual(outcome, { code: 0, signal: null })
    assert.match(printed, /"timedOut":true/)
  } finally {
    process.kill(escaped, 'SIGKILL') // it left the group on purpose, so nothing else will stop it
  }
})

for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  // SIGHUP is what a closed terminal or a dropped ssh session sends; the command has its own process group and would outlive fe-kit.
  test(`when fe-kit itself gets ${signal}, the command it is running stops too`, async (t) => {
    const dir = await script(t, 'import { writeFileSync } from "node:fs"; writeFileSync("sleeper.pid", String(process.pid)); setInterval(() => {}, 1000)', 'sleeper.mjs')
    await writeFile(join(dir, 'relay.mjs'), `import { runCommand } from ${JSON.stringify(execModule)}; await runCommand('node sleeper.mjs', { cwd: ${JSON.stringify(dir)}, timeoutMs: 60000 })`)
    const relay = spawn(process.execPath, [join(dir, 'relay.mjs')], { stdio: 'ignore' })
    const exited = new Promise((resolve) => relay.on('exit', (code, received) => resolve({ code, received })))
    const sleeper = await readPid(join(dir, 'sleeper.pid'))

    relay.kill(signal)
    const outcome = await exited

    assert.equal(outcome.received, signal)
    assert.ok(await waitUntilGone(sleeper), 'the command is still running')
  })
}

test('long output keeps its beginning and its end and says how much was left out', async (t) => {
  const dir = await script(t, "console.log('FIRST'); for (let i = 0; i < 30000; i++) console.log('line ' + i + ' ' + 'x'.repeat(100)); console.log('LAST')")

  const result = await runCommand('node run.mjs', { cwd: dir, maxOutputBytes: 100_000 })

  assert.match(result.output, /^FIRST\n/)
  assert.match(result.output, /LAST\n$/)
  assert.ok(result.omittedBytes > 1_000_000)
  assert.match(result.output, /\[\.\.\. \d+ bytes omitted \.\.\.\]/)
  assert.ok(result.output.length < 120_000)
})

test('output under the limit is returned whole and nothing is reported as omitted', async (t) => {
  const dir = await script(t, "console.log('small')")

  const result = await runCommand('node run.mjs', { cwd: dir })

  assert.equal(result.output, 'small\n')
  assert.equal(result.omittedBytes, 0)
})

test('a command the shell cannot find exits 127 with the shell saying so', async () => {
  const result = await runCommand('definitely-not-a-command-xyz')

  assert.equal(result.exitCode, 127)
  assert.match(result.output, /not found/)
})

test('runFile hands arguments over exactly as given, with no shell in between', async () => {
  const result = await runFile(process.execPath, ['-e', 'console.log(process.argv.slice(1).join("|"))', 'a b', '$HOME', '"q"', '*'])

  assert.equal(result.output, 'a b|$HOME|"q"|*\n')
})

test('a command line that cannot even be passed on is reported, not thrown', async () => {
  const result = await runCommand(`echo a${String.fromCharCode(0)}b`)

  assert.equal(result.exitCode, null)
  assert.match(result.error, /null bytes/)
})

test('a command that cannot be started is reported, not thrown', async () => {
  const shell = await runCommand('true', { cwd: '/definitely/not/a/directory' })
  const file = await runFile('/definitely/not/a/binary', [])

  for (const result of [shell, file]) {
    assert.equal(result.exitCode, null)
    assert.match(result.error, /ENOENT/)
    assert.equal(result.timedOut, false)
  }
})

test('shellQuote leaves a plain word as it is, so that a command reads as it would be typed', () => {
  assert.equal(shellQuote('--exclude'), '--exclude')
  assert.equal(shellQuote('src/a-b_c.test.ts'), 'src/a-b_c.test.ts')
  assert.equal(shellQuote('a=b:c,d@1+2%'), 'a=b:c,d@1+2%')
  assert.notEqual(shellQuote('a b'), 'a b')
  assert.notEqual(shellQuote('*.ts'), '*.ts')
  assert.notEqual(shellQuote(''), '')
})

test('shellQuote hands any argument through the shell as one word, whatever it holds', { skip: process.platform === 'win32' }, async () => {
  const awkward = ['plain', 'two words', "it's", '"double"', '$HOME', '`date`', '$(date)', 'semi;colon', 'star*', 'back\\slash', 'new\nline', 'caf\u00e9', '', '--flag=a b', '-n']

  for (const argument of awkward) {
    const result = await runCommand(`${shellQuote(process.execPath)} -e 'process.stdout.write(process.argv[1])' -- ${shellQuote(argument)}`)

    assert.equal(result.output, argument.replace(/\r?\n/g, '\n'), `argument ${JSON.stringify(argument)}`)
  }
})

test('with stderr: discard only what the program writes to stdout is kept', async (t) => {
  const dir = await script(t, "console.log('to-out'); console.error('to-err')")

  const both = await runCommand('node run.mjs', { cwd: dir })
  const only = await runCommand('node run.mjs', { cwd: dir, stderr: 'discard' })
  const file = await runFile(process.execPath, [join(dir, 'run.mjs')], { stderr: 'discard' })

  assert.match(both.output, /to-err/)
  assert.equal(only.output, 'to-out\n')
  assert.equal(file.output, 'to-out\n')
})

test('one very long line with no carriage return is cleaned in linear time (a JSON report is one line)', async (t) => {
  const dir = await script(t, "process.stdout.write('a'.repeat(1_000_000) + '\\n')")

  const started = performance.now()
  const result = await runCommand('node run.mjs', { cwd: dir })

  assert.equal(result.output.length, 1_000_001)
  assert.ok(performance.now() - started < 3000, `took ${Math.round(performance.now() - started)} ms`)
})

test('a command that exits but leaves something running with its output is done when it exits, and what it left behind is stopped', async (t) => {
  const dir = await script(t, 'import { spawn } from "node:child_process"; import { writeFileSync } from "node:fs"; const left = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: ["ignore", "inherit", "inherit"] }); writeFileSync("left.pid", String(left.pid)); console.log("done"); process.exit(0)')

  const started = Date.now()
  const result = await runCommand('node run.mjs', { cwd: dir, timeoutMs: 20_000, drainMs: 300 })
  const left = await readPid(join(dir, 'left.pid'))

  assert.equal(result.exitCode, 0)
  assert.equal(result.timedOut, false)
  assert.match(result.output, /done/)
  assert.ok(Date.now() - started < 5000, 'waited for the leftover instead of for the command')
  assert.ok(await waitUntilGone(left), 'what the command left running is still there')
})

test('a command that finishes normally does not wait for the drain period', async (t) => {
  const dir = await script(t, "console.log('quick')")

  const started = Date.now()
  await runCommand('node run.mjs', { cwd: dir, drainMs: 10_000 })

  assert.ok(Date.now() - started < 3000)
})

test('when output is cut, it is cut between words, so no half of a URL with a password stays at either edge', async (t) => {
  const url = ' https://user3:thirdpassword@h.io/p '
  const tailFill = 500 - 1 - (url.length - 20) // the last 500 bytes then begin 20 bytes into the URL, inside its password
  const body = 'a'.repeat(470) + ' https://user:supersecretpassword@example.com/path ' + 'b'.repeat(2000) + ' tail-start ' + 'c'.repeat(100) + url + 'd'.repeat(tailFill)
  const dir = await script(t, `process.stdout.write(${JSON.stringify(body)} + '\\n')`)

  const result = await runCommand('node run.mjs', { cwd: dir, maxOutputBytes: 1000 })

  assert.ok(result.omittedBytes > 0)
  assert.ok(!result.output.includes('supers'), 'the head ends inside a password')
  assert.ok(!result.output.includes('ssword@'), 'the tail starts inside a password')
  assert.match(result.output, /^a{470}\n\[\.\.\. \d+ bytes omitted \.\.\.\]\n /)
})

test('isQuoted tells whether a word in a shell command line stands inside quotes or after a backslash', () => {
  const quoted = [
    'eslint "{files}"',
    "eslint '{files}'",
    'eslint "--ext ts {files}"',
    'eslint \\{files}',
    'echo "a \\" {files}"', // the escaped quote does not end the string
    "echo 'it' \"x {files}\"",
    'echo "it\'s {files}"', // an apostrophe inside double quotes is a plain character
  ]
  const bare = [
    'eslint {files}',
    'eslint --max-warnings=0 {files}',
    'eslint "a b" {files}',
    "eslint 'a b' {files} 'c'",
    'eslint \\" {files}', // the backslash makes the quote a plain character
    'echo {files} && echo {files}',
    'echo "it\'s" {files}',
    'eslint',
  ]
  const comments = [
    ["# don't lint generated files\neslint {files}", false],
    ['eslint {files} # {files}', true],
    ['echo # {files}', true],
    ['echo a#b {files}', false],
  ]

  for (const command of quoted) assert.equal(isQuoted(command, '{files}'), true, command)
  for (const command of bare) assert.equal(isQuoted(command, '{files}'), false, command)
  for (const [command, expected] of comments) assert.equal(isQuoted(command, '{files}'), expected, command)
})

test('something the command left running with its output redirected away is stopped too', async (t) => {
  const dir = await script(t, 'import { spawn } from "node:child_process"; import { writeFileSync } from "node:fs"; const left = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" }); writeFileSync("left.pid", String(left.pid)); process.exit(0)')

  await runCommand('node run.mjs', { cwd: dir, drainMs: 300 })
  const left = await readPid(join(dir, 'left.pid'))

  assert.ok(await waitUntilGone(left), 'a leftover with no pipe is still running')
})

test('isQuoted also covers backticks and here-documents, where a file name could end the word and run code', () => {
  const quoted = ['echo `echo {files}`', 'echo "`echo {files}`"', 'cat <<EOF\n{files}\nEOF', 'cat <<-EOF\n{files}\nEOF', "cat <<'EOF'\n{files}\nEOF"]
  const bare = ['echo $(echo {files})', 'eslint {files} `echo done`', 'echo "a" `date` {files}', 'echo <<< {files}']

  for (const command of quoted) assert.equal(isQuoted(command, '{files}'), true, command)
  for (const command of bare) assert.equal(isQuoted(command, '{files}'), false, command)
})

test("isQuoted reads $'...' as the shell does: a backslash there escapes a quote", () => {
  assert.equal(isQuoted("printf %s $'a\\'{files}'", '{files}'), true) // the quote after the backslash does not end the string
  assert.equal(isQuoted("printf %s $'a' {files}", '{files}'), false)
  assert.equal(isQuoted("printf %s $'a\\\\' {files}", '{files}'), false) // an escaped backslash, then the end of the string
})

test('<< inside an arithmetic expansion is a shift, not a here-document', () => {
  assert.equal(isQuoted('THREADS=$((1<<2)) printf %s {files}', '{files}'), false)
  assert.equal(isQuoted('cat <<EOF\n{files}\nEOF', '{files}'), true)
})

test('a double quote inside $(...), backticks or ${...} that sit in a double-quoted string does not end the outer string', () => {
  const quoted = ['echo "$(echo "{files}")"', 'echo "`echo "{files}"`"', 'echo "${X:-"{files}"}"', 'echo "$(echo "a" "{files}")"']

  for (const command of quoted) assert.equal(isQuoted(command, '{files}'), true, command)
})

test('a $(( that is a subshell, not arithmetic, does not hide a here-document after it', () => {
  assert.equal(isQuoted('echo $((echo a); echo b) ; cat <<EOF\n{files}\nEOF', '{files}'), true)
  assert.equal(isQuoted('THREADS=$((1<<2)) printf %s {files}', '{files}'), false)
  assert.equal(isQuoted('echo $((2 * 3)) {files}', '{files}'), false)
  assert.equal(isQuoted('echo $((cat <<EOF); echo $((1+2))\n{files}\nEOF', '{files}'), true) // the here-document starts inside what looked like arithmetic
})
