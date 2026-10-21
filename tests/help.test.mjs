import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const kitRoot = fileURLToPath(new URL('..', import.meta.url))
const bin = join(kitRoot, 'bin/fe-kit.mjs')
const execFileAsync = promisify(execFile)
const COMMANDS = ['context', 'init', 'validate', 'scan', 'rules', 'test', 'verify']

// An agent that is unsure how to call a command asks it with --help; an error there sends it off to do the job by hand.
for (const name of COMMANDS) {
  test(`fe-kit ${name} --help and -h print its usage and exit 0, and name every option it takes`, async () => {
    const command = await import(`../src/commands/${name}.mjs`)
    for (const flag of ['--help', '-h']) {
      const { stdout, stderr } = await execFileAsync('node', [bin, name, flag])

      assert.match(stdout, new RegExp(`^Usage: fe-kit ${name}\\b`))
      assert.equal(stderr, '')
      for (const option of ['json', ...Object.keys(command.options)]) assert.ok(stdout.includes(`--${option}`), `--${option} is not in the usage of ${name}`)
    }
  })
}

test('--help after -- is an argument, not a request for help', async () => {
  const { stdout } = await execFileAsync('node', [bin, 'rules', '--json', '--', '--help'], { cwd: kitRoot }).catch((error) => error)

  assert.ok(!(stdout ?? '').startsWith('Usage:'))
})

test('the usage text says what the command is for and how it exits, so a reader need not guess', async () => {
  const { stdout } = await execFileAsync('node', [bin, 'verify', '--help'])

  assert.match(stdout, /scan/)
  assert.match(stdout, /lint/)
  assert.match(stdout, /Exit code/)
})
