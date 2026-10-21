import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { chmod, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { run } from '../src/commands/test.mjs'
import { UsageError } from '../src/lib/errors.mjs'
import { localProject } from './local-project.mjs'
import { tempDir } from './helpers.mjs'

const kitRoot = fileURLToPath(new URL('..', import.meta.url))
const bin = join(kitRoot, 'bin/fe-kit.mjs')
const execFileAsync = promisify(execFile)

const call = async (t, project, { args = [], env = {} } = {}) =>
  run({ args, flags: {}, cwd: project.project.packageRoot, env: { ...process.env, HOME: await tempDir(t), FE_KIT_PROFILES_DIR: await tempDir(t), ...env }, kitRoot })

test('a passing run exits 0 and says what ran and how it ended', async (t) => {
  const project = await localProject(t)

  const { data, text, exitCode } = await call(t, project)

  assert.equal(exitCode, 0)
  assert.match(text, /^Ran 2 local test files with vitest: vitest run --config \.fe-kit\/vitest\.overlay\.config\.mjs --coverage\.enabled=false$/m)
  assert.match(text, /^PASS \(exit 0, \d+(?:\.\d+)?s\)$/m)
  assert.equal(data.status, 'ran')
  assert.equal(data.runner, 'vitest')
  assert.deepEqual(data.files, ['.fe-kit/tests/a.test.ts', '.fe-kit/tests/sub/b.spec.tsx'])
  assert.equal(data.exitCode, 0)
})

test('a failing run exits 1 and ends with what the runner printed last', async (t) => {
  const project = await localProject(t)

  const { text, exitCode } = await call(t, project, { env: { FAKE_EXIT: '1' } })

  assert.equal(exitCode, 1)
  assert.match(text, /^FAIL \(exit 1, /m)
  assert.match(text, /"args":\["run","--config"/) // the fake vitest prints its call as its output
})

test('a passing run shows only the last lines of a long output, a failing run shows more', async (t) => {
  const project = await localProject(t)
  const long = `#!/usr/bin/env node\nfor (let i = 1; i <= 300; i++) console.log('line ' + i)\nprocess.exit(Number(process.env.FAKE_EXIT ?? 0))\n`
  await writeFile(join(project.dir, 'node_modules/.bin/vitest'), long)
  await chmod(join(project.dir, 'node_modules/.bin/vitest'), 0o755)

  const passed = (await call(t, project)).text
  const failed = (await call(t, project, { env: { FAKE_EXIT: '1' } })).text

  assert.ok(passed.includes('line 300') && !passed.includes('line 280\n'))
  assert.ok(failed.includes('line 300') && failed.includes('line 210\n') && !failed.includes('line 150\n'))
})

test('arguments are filters for the test files', async (t) => {
  const project = await localProject(t)

  const { text, data } = await call(t, project, { args: ['login', 'b.spec'] })

  assert.match(text, /--coverage\.enabled=false login b\.spec$/m)
  assert.deepEqual(JSON.parse(data.output).args.slice(-2), ['login', 'b.spec'])
})

test('without local tests it says so and exits 0', async (t) => {
  const project = await localProject(t, { tests: {} })

  const { data, text, exitCode } = await call(t, project)

  assert.equal(exitCode, 0)
  assert.equal(text, 'No local tests in .fe-kit/tests.\n')
  assert.deepEqual(data, { status: 'skipped', reason: 'no local tests in .fe-kit/tests' })
})

test('local tests that are skipped for a reason say that reason', async (t) => {
  const project = await localProject(t)

  const { text, exitCode } = await call(t, project, { env: { FAKE_PROJECTS: '1' } })

  assert.equal(exitCode, 1) // local tests exist and could not run: that is not a pass
  assert.equal(text, 'Vitest projects (a workspace) are not supported by local tests yet.\n')
})

test('a vitest that cannot start is a failed run with the reason', async (t) => {
  const project = await localProject(t)
  await writeFile(join(project.dir, 'node_modules/.bin/vitest'), 'not a program')
  await chmod(join(project.dir, 'node_modules/.bin/vitest'), 0o644)

  const { text, exitCode } = await call(t, project)

  assert.equal(exitCode, 1)
  assert.match(text, /^FAIL \(could not start: .*EACCES/m)
})

test('a credential in the output is not printed in the URL form', async (t) => {
  const project = await localProject(t)
  const leaky = `#!/usr/bin/env node\nconsole.log('connect https://user:FAKE_SECRET@host/db')\n`
  await writeFile(join(project.dir, 'node_modules/.bin/vitest'), leaky)
  await chmod(join(project.dir, 'node_modules/.bin/vitest'), 0o755)

  const { data, text } = await call(t, project)

  assert.ok(!text.includes('FAKE_SECRET'))
  assert.ok(!JSON.stringify(data).includes('FAKE_SECRET'))
})

test('drafts that are not set up are a usage error', async (t) => {
  const project = await localProject(t, { gitignore: null })

  await assert.rejects(call(t, project), UsageError)
})

test('the command line exits with the code of the run, and 2 for a usage error', async (t) => {
  const passing = await localProject(t)
  const failing = await localProject(t)
  const unset = await localProject(t, { gitignore: null })
  const env = async () => ({ ...process.env, HOME: await tempDir(t), FE_KIT_PROFILES_DIR: await tempDir(t) })
  const exit = (project, extra = {}, args = []) =>
    execFileAsync('node', [bin, 'test', ...args], { cwd: project.dir, env: { ...extra } }).then(() => 0, (error) => error.code)

  assert.equal(await exit(passing, await env()), 0)
  assert.equal(await exit(failing, { ...(await env()), FAKE_EXIT: '1' }), 1)
  assert.equal(await exit(unset, await env()), 2)
})
