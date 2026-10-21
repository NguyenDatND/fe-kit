import assert from 'node:assert/strict'
import { chmod, link, readdir, readFile, rename, stat, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { UsageError } from '../src/lib/errors.mjs'
import { extractJson, findLocalTests, projectTestCommand, runLocalTests } from '../src/lib/test-runner.mjs'
import { localProject, reported } from './local-project.mjs'
import { canTestPermissions, tempDir } from './helpers.mjs'

test('finds the test and spec files below .fe-kit/tests, and nothing else', async (t) => {
  const { dir } = await localProject(t, { tests: { 'a.test.ts': 'x', 'deep/b.spec.tsx': 'x', 'c.test.mjs': 'x', 'helper.ts': 'x', 'notes.md': 'x', 'd.test.ts.snap': 'x' } })

  assert.deepEqual(await findLocalTests(dir), ['.fe-kit/tests/a.test.ts', '.fe-kit/tests/c.test.mjs', '.fe-kit/tests/deep/b.spec.tsx'])
})

test('no .fe-kit/tests, or an empty one, means no local tests', async (t) => {
  assert.deepEqual(await findLocalTests(await tempDir(t)), [])
  const { dir } = await localProject(t, { tests: {} })
  assert.deepEqual(await findLocalTests(dir), [])
})

test('runs the project vitest from the package root against an overlay of the project config', async (t) => {
  const { dir, project } = await localProject(t)

  const result = await runLocalTests(project)

  assert.equal(result.status, 'ran')
  assert.equal(result.runner, 'vitest')
  assert.equal(result.exitCode, 0)
  assert.deepEqual(result.files, ['.fe-kit/tests/a.test.ts', '.fe-kit/tests/sub/b.spec.tsx'])
  const call = reported(result)
  assert.equal(call.cwd, dir)
  assert.deepEqual(call.args, ['run', '--config', join(dir, '.fe-kit/vitest.overlay.config.mjs'), '--coverage.enabled=false'])
  assert.equal(call.ci, 'true')
  assert.equal(call.config, await readFile(join(dir, '.fe-kit/vitest.overlay.config.mjs'), 'utf8'))
  assert.match(call.config, /import base from "\.\.\/vite\.config\.ts"/)
  assert.match(call.config, /include: \["\.fe-kit\/tests\/\*\*\/\*\.\{test,spec\}\.\{js,jsx,ts,tsx,mjs,cjs,mts,cts\}"\]/)
})

test('the overlay replaces include, so tests the project config names do not run as well', async (t) => {
  const { project } = await localProject(t)

  const { config } = reported(await runLocalTests(project))

  assert.match(config, /test: \{ \.\.\.resolved\.test, dir: "\/[^"]+", include: /)
  assert.ok(!config.includes('mergeConfig'), 'mergeConfig would add to the include of the project instead of replacing it')
})

test('the overlay sets test.dir to the package itself, so a project that sets dir or root still finds the local tests', async (t) => {
  const { dir, project } = await localProject(t)

  const { config } = reported(await runLocalTests(project))

  assert.ok(config.includes(`dir: ${JSON.stringify(dir)}, include: `))

  assert.match(config, /test: \{ \.\.\.resolved\.test, dir: "\/[^"]+", include: /)
})

test('coverage is switched off for the local tests: a threshold of the project would fail a run of three drafts', async (t) => {
  const { project } = await localProject(t)

  const result = await runLocalTests(project)

  assert.ok(reported(result).args.includes('--coverage.enabled=false'))
  assert.match(result.command, /--coverage\.enabled=false$/)
})

test('a vitest configuration with projects (a workspace) is not supported: the overlay says so and the step is skipped with that reason', async (t) => {
  const { project } = await localProject(t)

  const { config } = reported(await runLocalTests(project))
  const skipped = await runLocalTests(project, { env: { ...process.env, FAKE_PROJECTS: '1' } })

  assert.match(config, /resolved\.test\?\.projects \|\| resolved\.test\?\.workspace/)
  assert.match(config, /fe-kit: vitest projects are not supported by local tests yet/)
  assert.deepEqual(skipped, { status: 'skipped', reason: 'vitest projects (a workspace) are not supported by local tests yet' })
})

test('the overlay works whether the project config is an object or a function', async (t) => {
  const { project } = await localProject(t)

  const { config } = reported(await runLocalTests(project))

  assert.match(config, /typeof base === 'function' \? await base\(env\) : await base/)
})

test('vitest.config is the base when there is one, as it is for vitest itself, and no config means no import', async (t) => {
  const both = await localProject(t, { extra: { 'vitest.config.mts': 'export default {}\n' } })
  const none = await localProject(t, { config: null })

  assert.match(reported(await runLocalTests(both.project)).config, /import base from "\.\.\/vitest\.config\.mts"/)
  const bare = reported(await runLocalTests(none.project)).config
  assert.ok(!bare.includes('import base'))
  assert.match(bare, /include: /)
})

test('filters go after the config, and the exit code of vitest is the exit code of the run', async (t) => {
  const { dir, project } = await localProject(t)

  const result = await runLocalTests(project, { filters: ['login', 'b.spec'], env: { ...process.env, FAKE_EXIT: '1' } })

  assert.equal(result.exitCode, 1)
  assert.deepEqual(reported(result).args, ['run', '--config', join(dir, '.fe-kit/vitest.overlay.config.mjs'), '--coverage.enabled=false', 'login', 'b.spec'])
})

test('below the project root the config, the include and the working directory follow the package', async (t) => {
  const { dir, project } = await localProject(t, { packageDir: 'apps/web' })

  const result = await runLocalTests(project)

  const call = reported(result)
  assert.equal(call.cwd, join(dir, 'apps/web'))
  assert.match(call.config, /import base from "\.\.\/apps\/web\/vite\.config\.ts"/)
  assert.match(call.config, /include: \["\.\.\/\.\.\/\.fe-kit\/tests\/\*\*\//)
})

test('below the project root, bare imports of local tests are resolved from the package, because .fe-kit has no node_modules', async (t) => {
  const { dir, project } = await localProject(t, { packageDir: 'apps/web' })
  const single = await localProject(t)

  const { config } = reported(await runLocalTests(project))
  const plain = reported(await runLocalTests(single.project)).config

  assert.match(config, /name: 'fe-kit-resolve-from-package'/)
  assert.ok(config.includes(JSON.stringify(`${dir}/.fe-kit/`)), 'the plugin acts on files under .fe-kit only')
  assert.ok(config.includes(JSON.stringify(`${dir}/apps/web/package.json`)), 'and resolves as if from the package')
  assert.match(config, /plugins: \[\.\.\.\(resolved\.plugins \?\? \[\]\), fromPackage\]/)
  assert.ok(!plain.includes('fromPackage'), 'a package at the project root needs none')
})

test('a monorepo package with no config of its own still gets the resolver', async (t) => {
  const { project } = await localProject(t, { packageDir: 'apps/web', config: null })

  const { config } = reported(await runLocalTests(project))

  assert.ok(!config.includes('import base'))
  assert.match(config, /export default \{ plugins: \[fromPackage\], test: \{ include: /)
})

test('the overlay is rewritten only when it changes', async (t) => {
  const { dir, project } = await localProject(t)
  const overlay = join(dir, '.fe-kit/vitest.overlay.config.mjs')

  await runLocalTests(project)
  const first = (await stat(overlay)).mtimeMs
  await new Promise((resolve) => setTimeout(resolve, 20))
  await runLocalTests(project)

  assert.equal((await stat(overlay)).mtimeMs, first)
})

test('the overlay follows the project when its config changes', async (t) => {
  const { dir, project } = await localProject(t)
  const overlay = join(dir, '.fe-kit/vitest.overlay.config.mjs')

  await runLocalTests(project)
  assert.match(await readFile(overlay, 'utf8'), /import base from "\.\.\/vite\.config\.ts"/)
  await writeFile(join(dir, 'vitest.config.mts'), 'export default {}\n')
  await runLocalTests(project)

  assert.match(await readFile(overlay, 'utf8'), /import base from "\.\.\/vitest\.config\.mts"/)
})

test('a run that had to be stopped is not a pass, even if vitest then exited cleanly', async (t) => {
  const { project } = await localProject(t)

  const result = await runLocalTests(project, { env: { ...process.env, FAKE_HANG: '1' }, timeoutMs: 300, graceMs: 300 })

  assert.equal(result.timedOut, true)
  assert.equal(result.exitCode, 0)
  assert.equal(result.passed, false)
})

test('a run is a pass only when vitest exits 0 and nothing went wrong around it', async (t) => {
  const { project } = await localProject(t)

  assert.equal((await runLocalTests(project)).passed, true)
  assert.equal((await runLocalTests(project, { env: { ...process.env, FAKE_EXIT: '1' } })).passed, false)
})

test('a .fe-kit folder that cannot be written (a read-only workspace) is a usage error naming the file', { skip: !canTestPermissions }, async (t) => {
  const { dir, project } = await localProject(t)
  await chmod(join(dir, '.fe-kit'), 0o555)

  try {
    await assert.rejects(runLocalTests(project), (error) => error instanceof UsageError && /could not write \.fe-kit\/vitest\.overlay\.config\.mjs \(EACCES\)/.test(error.message))
  } finally {
    await chmod(join(dir, '.fe-kit'), 0o755)
  }
})

test('an overlay file that is a link to something else is never written through', async (t) => {
  const { dir, project } = await localProject(t, { extra: { 'src/important.js': 'KEEP\n' } })
  await symlink('../src/important.js', join(dir, '.fe-kit/vitest.overlay.config.mjs'))

  await assert.rejects(runLocalTests(project), (error) => error instanceof UsageError && /vitest\.overlay\.config\.mjs is not a regular file/.test(error.message))

  assert.equal(await readFile(join(dir, 'src/important.js'), 'utf8'), 'KEEP\n')
})

test('a .fe-kit that is a link to a folder elsewhere is not a place to write, even when that folder looks set up', async (t) => {
  const { dir, project } = await localProject(t)
  const elsewhere = await tempDir(t)
  await rename(join(dir, '.fe-kit'), join(elsewhere, 'drafts'))
  await symlink(join(elsewhere, 'drafts'), join(dir, '.fe-kit'))

  await assert.rejects(runLocalTests(project), (error) => error instanceof UsageError && /fe-kit init/.test(error.message))

  await assert.rejects(stat(join(elsewhere, 'drafts/vitest.overlay.config.mjs')), { code: 'ENOENT' })
})

test('without local tests nothing runs, even when everything else is missing', async (t) => {
  const { project } = await localProject(t, { tests: {}, bin: false, gitignore: null })

  assert.deepEqual(await runLocalTests(project), { status: 'skipped', reason: 'no local tests in .fe-kit/tests' })
})

test('drafts that are not set up are refused before anything is written', async (t) => {
  const { dir, project } = await localProject(t, { gitignore: null })

  await assert.rejects(runLocalTests(project), (error) => error instanceof UsageError && /fe-kit init/.test(error.message))
  await assert.rejects(stat(join(dir, '.fe-kit/vitest.overlay.config.mjs')), { code: 'ENOENT' })
})

test('a project without a supported test runner is a usage error that says what is supported', async (t) => {
  const mocha = await localProject(t, { dependencies: { mocha: '10' } })
  const none = await localProject(t, { dependencies: {} })

  for (const { project } of [mocha, none]) {
    await assert.rejects(runLocalTests(project), (error) => error instanceof UsageError && /vitest/.test(error.message) && /does not add test libraries/.test(error.message))
  }
})

test('vitest declared but not installed asks for an install', async (t) => {
  const { project } = await localProject(t, { bin: false })

  await assert.rejects(runLocalTests(project), (error) => error instanceof UsageError && /not installed/.test(error.message))
})

test('a vitest installed above the project is not the project\'s vitest', async (t) => {
  const { project } = await localProject(t, { binAbove: true })

  await assert.rejects(runLocalTests(project), (error) => error instanceof UsageError && /not installed/.test(error.message))
})

test('a vitest that cannot start is reported in the result, not thrown', async (t) => {
  const { dir, project } = await localProject(t)
  await writeFile(join(dir, 'node_modules/.bin/vitest'), 'not a program')
  await chmod(join(dir, 'node_modules/.bin/vitest'), 0o644)

  const result = await runLocalTests(project)

  assert.equal(result.status, 'ran')
  assert.ok(result.error)
})

// What the project's own test command is, as `resolveProject` reports it.
const setup = ({ packageManager = 'npm', runner = 'vitest', test = 'vitest run', commands, same = true, scripts } = {}) => ({
  projectRoot: '/p',
  packageRoot: same ? '/p' : '/p/apps/web',
  stack: { packageManager, testRunner: runner, scripts: scripts ?? { test } },
  commands: commands ?? { test: `${packageManager} run test` },
})

const commandOf = async (project) => (await projectTestCommand(project)).command

test('projectTestCommand leaves .fe-kit out of a vitest run, the way each package manager takes arguments', async () => {
  assert.deepEqual(await projectTestCommand(setup()), { command: "npm run test -- --exclude '.fe-kit/**'" })
  assert.deepEqual(await projectTestCommand(setup({ packageManager: 'pnpm' })), { command: "pnpm run test --exclude '.fe-kit/**'" })
  assert.deepEqual(await projectTestCommand(setup({ packageManager: 'yarn' })), { command: "yarn run test --exclude '.fe-kit/**'" })
})

test('npm hands arguments to the script only after --, and pnpm would pass that -- on to the script', async () => {
  // The two facts above, as measured: npm swallows `--exclude` as its own option unless it follows `--`; pnpm passes `--` through to the script.
  assert.match(await commandOf(setup()), / -- --exclude /)
  assert.ok(!/ -- /.test(await commandOf(setup({ packageManager: 'pnpm' }))))
})

test('a test command from the profile gets the argument appended; one that already has -- does not get a second', async () => {
  assert.equal(await commandOf(setup({ commands: { test: 'pnpm vitest run --coverage' } })), "pnpm vitest run --coverage --exclude '.fe-kit/**'")
  assert.equal(await commandOf(setup({ scripts: { 'test:unit': 'vitest run' }, commands: { test: 'npm run test:unit' } })), "npm run test:unit -- --exclude '.fe-kit/**'")
  assert.equal(await commandOf(setup({ scripts: { 'test:unit': 'vitest run' }, commands: { test: 'npm run test:unit -- --coverage' } })), "npm run test:unit -- --coverage --exclude '.fe-kit/**'")
  assert.equal(await commandOf(setup({ commands: { test: 'npm test' } })), "npm test -- --exclude '.fe-kit/**'")
})

test('when the command may not be vitest the run is left as it is and the note says what that means', async () => {
  const other = await projectTestCommand(setup({ test: 'playwright test' }))

  assert.equal(other.command, 'npm run test')
  assert.match(other.note, /could not tell that the test command runs vitest/)
  assert.equal((await projectTestCommand(setup({ test: 'npm run test:unit', scripts: { test: 'npm run test:unit', 'test:unit': 'vitest run' } }))).note.length > 0, true)
})

test('a test script made of several commands is left alone, because an argument would reach only the last one', async () => {
  for (const runner of ['vitest', 'jest']) {
    for (const script of [`${runner} run && node check.js`, `${runner} run || echo failed`, `${runner} run; echo done`, `${runner} run | tee log`, `${runner} run & node server.js`, `${runner} run\necho done`]) {
      const result = await projectTestCommand(setup({ runner, test: script }))

      assert.equal(result.command, 'npm run test', script)
      assert.match(result.note, /runs several commands/, script)
    }
  }
})

test('operators in the test command of the profile count too, not only those in the package.json script', async () => {
  for (const test of ['npm test && echo done', 'npm run test | tee test.log', 'pnpm test && pnpm lint']) {
    const result = await projectTestCommand(setup({ commands: { test } }))

    assert.equal(result.command, test)
    assert.match(result.note, /runs several commands/, test)
  }
})

test('a redirection in the test script is not several commands', async () => {
  const result = await projectTestCommand(setup({ test: 'vitest run 2>&1 >/dev/null' }))

  assert.equal(result.command, "npm run test -- --exclude '.fe-kit/**'")
  assert.equal(result.note, undefined)
})

test('other runners and no command at all need no change and no note', async () => {
  assert.deepEqual(await projectTestCommand(setup({ runner: 'mocha', test: 'mocha' })), { command: 'npm run test' })
  assert.deepEqual(await projectTestCommand(setup({ runner: null, commands: { test: null } })), { command: null })
})

test('a package below the project root does not see .fe-kit, so its test run is left alone', async () => {
  assert.deepEqual(await projectTestCommand(setup({ same: false })), { command: 'npm run test' })
})

test('extractJson finds the object among banner lines and trailing notices, and says null when there is none', () => {
  const object = JSON.stringify({ configs: [{ a: 1 }] }, null, 2)

  assert.deepEqual(extractJson(`> proj@1.0.0 test\n> jest --showConfig --setting {x}\n\n${object}\nnpm notice a new version is available\n`), { configs: [{ a: 1 }] })
  assert.deepEqual(extractJson(JSON.stringify({ compact: true })), { compact: true })
  assert.equal(extractJson('no braces at all'), null)
  assert.equal(extractJson('{ not json }'), null)
  assert.equal(extractJson(''), null)
  assert.equal(extractJson('a } before a {\n'), null)
})

test('the overlay does not let a run pass when it found no test: a project config with passWithNoTests would hide that the local tests were excluded', async (t) => {
  const { project } = await localProject(t)

  const { config } = reported(await runLocalTests(project))

  assert.match(config, /passWithNoTests: false/)
})

test('an overlay file that is a hard link to a file of the project is replaced, not written through', async (t) => {
  const { dir, project } = await localProject(t, { extra: { 'src/important.js': 'KEEP\n' } })
  await link(join(dir, 'src/important.js'), join(dir, '.fe-kit/vitest.overlay.config.mjs'))

  await runLocalTests(project)

  assert.equal(await readFile(join(dir, 'src/important.js'), 'utf8'), 'KEEP\n')
  assert.match(await readFile(join(dir, '.fe-kit/vitest.overlay.config.mjs'), 'utf8'), /passWithNoTests/)
})

test('passWithNoTests is off in the overlay of a project that has no vite config too', async (t) => {
  const { project } = await localProject(t, { config: null })

  const { config } = reported(await runLocalTests(project))

  assert.match(config, /passWithNoTests: false/)
})

test('an argument that is an option of the runner is refused: it could make the runner print its help and exit 0', async (t) => {
  const { project } = await localProject(t)

  await assert.rejects(runLocalTests(project, { filters: ['--help'] }), (error) => error instanceof UsageError && /--help/.test(error.message))
  await assert.rejects(runLocalTests(project, { filters: ['login', '--passWithNoTests'] }), UsageError)
})

test('two packages of one project get an overlay each, so runs at the same time cannot read each other\'s', async (t) => {
  const web = await localProject(t, { packageDir: 'apps/web' })
  await runLocalTests(web.project)
  const root = await localProject(t)
  await runLocalTests(root.project)

  const names = (await readdir(join(web.dir, '.fe-kit'))).filter((name) => name.startsWith('vitest.overlay'))
  const rootNames = (await readdir(join(root.dir, '.fe-kit'))).filter((name) => name.startsWith('vitest.overlay'))

  assert.deepEqual(rootNames, ['vitest.overlay.config.mjs'])
  assert.equal(names.length, 1)
  assert.notEqual(names[0], 'vitest.overlay.config.mjs')
})

test('no temporary file is left behind by writing the overlay', async (t) => {
  const { dir, project } = await localProject(t)

  await runLocalTests(project)

  assert.deepEqual((await readdir(join(dir, '.fe-kit'))).filter((name) => name.includes('.tmp')), [])
})

test('a local tests folder that cannot be read is an error, not "no local tests"', { skip: !canTestPermissions }, async (t) => {
  const { dir, project } = await localProject(t)
  await chmod(join(dir, '.fe-kit/tests/sub'), 0o000)

  try {
    await assert.rejects(runLocalTests(project), (error) => error instanceof UsageError && /\.fe-kit\/tests\/sub/.test(error.message))
  } finally {
    await chmod(join(dir, '.fe-kit/tests/sub'), 0o755)
  }
})
