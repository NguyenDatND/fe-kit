import assert from 'node:assert/strict'
import { chmod, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { UsageError } from '../src/lib/errors.mjs'
import { resolveProject } from '../src/lib/project.mjs'
import { projectTestCommand, runLocalTests } from '../src/lib/test-runner.mjs'
import { makeGitRepo, tempDir, writeTree } from './helpers.mjs'
import { localProject } from './local-project.mjs'

const TEST_FILES = '**/*.{test,spec}.{js,jsx,ts,tsx,mjs,cjs,mts,cts}'
const called = (result) => JSON.parse(result.output.split('\n').find((line) => line.startsWith('{')))
const config = (overrides) => JSON.stringify({ configs: [{ rootDir: '/x', roots: ['/x/src'], testRegex: [], testPathIgnorePatterns: ['/node_modules/'], ...overrides }] })
const jestEnv = (extra) => ({ ...process.env, ...extra })

// The recipe is the one measured with real jest 30.5.2 and 29.7.0 (tasks/phase-2.md, "Bằng chứng jest").
test('local tests run with the jest of the project: its own roots plus .fe-kit/tests, and a test match that names only the local tests', async (t) => {
  const { dir, project } = await localProject(t, { runner: 'jest' })

  const result = await runLocalTests(project)

  assert.equal(result.status, 'ran')
  assert.equal(result.runner, 'jest')
  assert.equal(result.passed, true)
  assert.deepEqual(result.files, ['.fe-kit/tests/a.test.ts', '.fe-kit/tests/sub/b.spec.tsx'])
  const call = called(result)
  assert.equal(call.cwd, dir)
  assert.equal(call.ci, 'true')
  assert.deepEqual(call.jest, [`--roots=${dir}/src`, `--roots=${dir}/.fe-kit/tests`, `--testMatch=<rootDir>/.fe-kit/tests/${TEST_FILES}`, '--coverage=false'])
  assert.equal(result.command, `jest --roots=src --roots=.fe-kit/tests --testMatch=<rootDir>/.fe-kit/tests/${TEST_FILES} --coverage=false`)
})

test('filters go before the flags, because a flag that takes a list swallows what follows it', async (t) => {
  const { project } = await localProject(t, { runner: 'jest' })

  const result = await runLocalTests(project, { filters: ['login', 'b.spec'] })

  assert.deepEqual(called(result).jest.slice(0, 2), ['login', 'b.spec'])
  assert.ok(called(result).jest[2].startsWith('--roots='))
})

test('a project whose config uses testRegex gets a testRegex, since jest refuses both together', async (t) => {
  const { project } = await localProject(t, { runner: 'jest' })

  const result = await runLocalTests(project, { env: jestEnv({ FAKE_SHOWCONFIG: config({ testRegex: ['.*\\.spec\\.js$'] }) }) })

  const flags = called(result).jest
  assert.ok(flags.includes('--testRegex=[/\\\\]\\.fe-kit[/\\\\]tests[/\\\\].*\\.(?:test|spec)\\.[cm]?[jt]sx?$'))
  assert.ok(!flags.some((flag) => flag.startsWith('--testMatch')))
})

test('the test match is relative to the rootDir of jest, which need not be the package', async (t) => {
  const { dir, project } = await localProject(t, { runner: 'jest' })

  const result = await runLocalTests(project, { env: jestEnv({ FAKE_SHOWCONFIG: config({ rootDir: `${dir}/src`, roots: [`${dir}/src`] }) }) })

  assert.ok(called(result).jest.includes(`--testMatch=<rootDir>/../.fe-kit/tests/${TEST_FILES}`))
})

test('the roots the project already has are kept, whatever they are', async (t) => {
  const { project } = await localProject(t, { runner: 'jest' })

  const result = await runLocalTests(project, { env: jestEnv({ FAKE_SHOWCONFIG: config({ roots: ['/x/src', '/x/lib'] }) }) })

  assert.deepEqual(called(result).jest.filter((flag) => flag.startsWith('--roots=')).slice(0, 2), ['--roots=/x/src', '--roots=/x/lib'])
})

test('a root that is the package itself is shown as a dot, not as an empty value', async (t) => {
  const { dir, project } = await localProject(t, { runner: 'jest' })

  const result = await runLocalTests(project, { env: jestEnv({ FAKE_SHOWCONFIG: config({ rootDir: dir, roots: [dir] }) }) })

  assert.ok(result.command.startsWith('jest --roots=. --roots=.fe-kit/tests '), result.command)
})

test('jest with several projects in one configuration is not supported, and the message says so', async (t) => {
  const { project } = await localProject(t, { runner: 'jest' })
  const several = JSON.stringify({ configs: [{ roots: [] }, { roots: [] }] })

  await assert.rejects(runLocalTests(project, { env: jestEnv({ FAKE_SHOWCONFIG: several }) }), (error) => error instanceof UsageError && /projects/.test(error.message))
})

test('a configuration jest cannot print is a usage error, not a guess', async (t) => {
  const { project } = await localProject(t, { runner: 'jest' })

  await assert.rejects(runLocalTests(project, { env: jestEnv({ FAKE_SHOWCONFIG: 'this is not json', FAKE_SHOWCONFIG_EXIT: '0' }) }), (error) => error instanceof UsageError && /--showConfig/.test(error.message))
  await assert.rejects(runLocalTests(project, { env: jestEnv({ FAKE_SHOWCONFIG_EXIT: '1' }) }), (error) => error instanceof UsageError && /--showConfig/.test(error.message))
})

test('what jest writes to stderr while printing its configuration does not break reading it', async (t) => {
  const { project } = await localProject(t, { runner: 'jest' }) // the fake jest warns on stderr before printing

  const result = await runLocalTests(project)

  assert.equal(result.status, 'ran')
})

test('the exit code of jest is the exit code of the run', async (t) => {
  const { project } = await localProject(t, { runner: 'jest' })

  const result = await runLocalTests(project, { env: jestEnv({ EXIT_JEST: '1' }) })

  assert.equal(result.exitCode, 1)
  assert.equal(result.passed, false)
})

test('jest declared but not installed asks for an install', async (t) => {
  const { project } = await localProject(t, { runner: 'jest', bin: false })

  await assert.rejects(runLocalTests(project), (error) => error instanceof UsageError && /jest is in package\.json but not installed/.test(error.message))
})

test('a project with neither vitest nor jest is told what is supported', async (t) => {
  const { project } = await localProject(t, { dependencies: { mocha: '10' } })

  await assert.rejects(runLocalTests(project), (error) => error instanceof UsageError && /vitest or jest/.test(error.message) && /does not add test libraries/.test(error.message))
})

test('a jest that cannot start cannot print its configuration, which is a usage error', async (t) => {
  const { dir, project } = await localProject(t, { runner: 'jest' })
  await writeFile(join(dir, 'node_modules/.bin/jest'), 'not a program')
  await chmod(join(dir, 'node_modules/.bin/jest'), 0o644)

  await assert.rejects(runLocalTests(project), (error) => error instanceof UsageError && /--showConfig/.test(error.message))
})

// ---- the project's own jest run, kept free of .fe-kit/tests

const kitRoot = fileURLToPath(new URL('..', import.meta.url))
// A stand-in for the jest of a project, run through its `test` script: it records how it was called, and prints a configuration for --showConfig.
const SCRIPT_JEST = `const args = process.argv.slice(2)
require('node:fs').writeFileSync('probe.json', JSON.stringify(args))
if (args.includes('--showConfig')) {
  process.stderr.write('{ a warning in braces that is not part of the JSON }\\n')
  const fallback = { configs: [{ testPathIgnorePatterns: ['/node_modules/', '/legacy/'] }] }
  process.stdout.write((process.env.FAKE_SHOWCONFIG ?? JSON.stringify(fallback, null, 2)) + '\\n')
  process.exit(Number(process.env.FAKE_SHOWCONFIG_EXIT ?? 0))
}
`

async function jestRun(t, { script = 'node fake-jest.cjs', commands } = {}) {
  const dir = await tempDir(t)
  const scripts = { test: script, pretest: 'node -e "require(\'node:fs\').writeFileSync(\'pretest.ran\', \'1\')"' }
  await writeTree(dir, { 'package.json': JSON.stringify({ scripts, devDependencies: { jest: '30.0.0' } }), 'fake-jest.cjs': SCRIPT_JEST })
  await makeGitRepo(dir)
  const project = await resolveProject({ cwd: dir, env: { HOME: await tempDir(t), FE_KIT_PROFILES_DIR: await tempDir(t) }, kitRoot })
  if (commands) project.commands = { ...project.commands, ...commands }
  return { dir, project }
}
const ANCHORED = "'--testPathIgnorePatterns=<rootDir>[/\\\\]\\.fe-kit[/\\\\]'"

test('a jest run is given every ignore pattern in effect, read through the test command itself, and one more for .fe-kit', async (t) => {
  const { dir, project } = await jestRun(t)

  const { command, note } = await projectTestCommand(project, { env: jestEnv({}) })

  assert.equal(command, `npm run test -- --testPathIgnorePatterns=/node_modules/ --testPathIgnorePatterns=/legacy/ ${ANCHORED}`)
  assert.equal(note, undefined)
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'probe.json'), 'utf8')), ['--showConfig']) // asked through `npm run test`, so the flags of the script count
})

test('reading the configuration does not run the pretest and posttest hooks of the project a second time', async (t) => {
  const { dir, project } = await jestRun(t)

  await projectTestCommand(project, { env: jestEnv({}) })

  await assert.rejects(readFile(join(dir, 'pretest.ran')), { code: 'ENOENT' })
})

test('the hooks are left out of the probe also when the command of the profile has its own --', async (t) => {
  const { dir, project } = await jestRun(t, { commands: { test: 'npm run test -- --ci' } })

  const { command } = await projectTestCommand(project, { env: jestEnv({}) })

  await assert.rejects(readFile(join(dir, 'pretest.ran')), { code: 'ENOENT' })
  assert.ok(command.startsWith('npm run test -- --ci --testPathIgnorePatterns='), command)
})

test('a configuration that lists no ignore patterns gets the default one kept', async (t) => {
  const { project } = await jestRun(t)

  const { command } = await projectTestCommand(project, { env: jestEnv({ FAKE_SHOWCONFIG: JSON.stringify({ configs: [{}] }) }) })

  assert.equal(command, `npm run test -- --testPathIgnorePatterns=/node_modules/ ${ANCHORED}`)
})

test('the pattern for .fe-kit is anchored at the rootDir, so a folder above the project with that name does not hide every test', async (t) => {
  const { project } = await jestRun(t)

  const { command } = await projectTestCommand(project, { env: jestEnv({}) })

  assert.ok(command.includes(ANCHORED))
})

test('several jest projects, a configuration that cannot be read, or a command that does not run jest leave the run as it is, with a note', async (t) => {
  const { project } = await jestRun(t)
  const several = await projectTestCommand(project, { env: jestEnv({ FAKE_SHOWCONFIG: JSON.stringify({ configs: [{}, {}] }) }) })
  const unreadable = await projectTestCommand(project, { env: jestEnv({ FAKE_SHOWCONFIG_EXIT: '1' }) })
  const garbage = await projectTestCommand(project, { env: jestEnv({ FAKE_SHOWCONFIG: 'not json' }) })
  const other = await jestRun(t, { script: 'node playwright-runner.cjs' })

  assert.equal(several.command, 'npm run test')
  assert.match(several.note, /several projects/)
  assert.equal(unreadable.command, 'npm run test')
  assert.match(unreadable.note, /could not read the jest configuration/)
  assert.match(garbage.note, /could not read the jest configuration/)
  const unknown = await projectTestCommand(other.project, { env: jestEnv({}) })
  assert.equal(unknown.command, 'npm run test')
  assert.match(unknown.note, /could not tell that the test command runs jest/)
})
