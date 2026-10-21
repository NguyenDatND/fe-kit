import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { chmod, mkdir, readdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { run } from '../src/commands/verify.mjs'
import { UsageError } from '../src/lib/errors.mjs'
import { canTestPermissions, commitAll, git, makeGitRepo, tempDir, writeTree } from './helpers.mjs'

const kitRoot = fileURLToPath(new URL('..', import.meta.url))
const bin = join(kitRoot, 'bin/fe-kit.mjs')
const execFileAsync = promisify(execFile)

// Small programs in place of lint, tsc and a test runner: each reports its arguments and exits as the environment says.
const TOOL = `console.log(JSON.stringify({ tool: process.argv[1].split('/').at(-1), args: process.argv.slice(2) }))
const code = Number(process.env[\`EXIT_\${process.argv[1].split('/').at(-1).replace('.mjs', '').toUpperCase()}\`] ?? 0)
process.exit(code)
`
const FAKE_VITEST = '#!/usr/bin/env node\nconsole.log(JSON.stringify({ vitest: process.argv.slice(2) }))\nprocess.exit(Number(process.env.EXIT_VITEST ?? 0))\n'

/**
 * A git project on `main` with one commit, then a branch `feature` where `changes` are made (left uncommitted).
 * `scripts` are package.json scripts; `profile` is the text of a profile that matches this project by its remote.
 */
async function project(t, { scripts = { lint: 'node lint.mjs', typecheck: 'node typecheck.mjs', test: 'node test.mjs' }, dependencies = {}, base = {}, changes = {}, profile, drafts = true, localTests = null } = {}) {
  const dir = await tempDir(t)
  await makeGitRepo(dir, { remote: 'git@gitlab.local:fe/shop.git' })
  const files = { 'package.json': JSON.stringify({ scripts, devDependencies: dependencies }), 'lint.mjs': TOOL, 'typecheck.mjs': TOOL, 'test.mjs': TOOL, 'src/keep.ts': 'export const keep = 1\n', ...base }
  if (drafts) files['.fe-kit/.gitignore'] = '*\n'
  if (localTests) for (const [name, text] of Object.entries(localTests)) files[`.fe-kit/tests/${name}`] = text
  await writeTree(dir, files)
  await commitAll(dir, 'base')
  await git(dir, 'checkout', '-q', '-b', 'feature')
  await writeTree(dir, changes)
  const profiles = await tempDir(t)
  if (profile) await writeTree(profiles, { 'shop.md': `---\nname: shop\nmatch: { remotes: ["gitlab.local/fe/shop"] }\n${profile}\n---\n` })
  return { dir, profiles }
}
async function verify(t, { dir, profiles }, { flags = {}, env = {}, ...rest } = {}) {
  return run({ args: [], flags, cwd: dir, env: { ...process.env, HOME: await tempDir(t), FE_KIT_PROFILES_DIR: profiles, ...env }, kitRoot, ...rest })
}
const states = (data) => data.steps.map((step) => `${step.name}:${step.status}`)
const step = (data, name) => data.steps.find((candidate) => candidate.name === name)

test('every step passes: exit 0, the steps in order, and what was not verified is named', async (t) => {
  const p = await project(t, { changes: { 'src/new.ts': 'export const fine = 2\n' } })

  const { data, text, exitCode } = await verify(t, p)

  assert.equal(exitCode, 0)
  assert.deepEqual(states(data), ['scan:pass', 'lint:pass', 'typecheck:pass', 'test:pass', 'local-test:skip'])
  assert.equal(data.passed, true)
  assert.match(text, /^PASS scan /m)
  assert.match(text, /^PASS lint\s+npm run lint/m)
  assert.match(text, /^SKIP local-test\s+no local tests in \.fe-kit\/tests$/m)
  assert.match(text, /^Result: PASSED\. Not verified: local-test\.$/m)
})

test('a failing step does not stop the ones after it, and every failure is reported with its command and exit code', async (t) => {
  const p = await project(t, { changes: { 'src/new.ts': 'export const bad: any = 2\n' } })

  const { data, text, exitCode } = await verify(t, p, { env: { EXIT_LINT: '1', EXIT_TEST: '3' } })

  assert.equal(exitCode, 1)
  assert.deepEqual(states(data), ['scan:fail', 'lint:fail', 'typecheck:pass', 'test:fail', 'local-test:skip'])
  assert.deepEqual(data.failed, ['scan', 'lint', 'test'])
  assert.equal(step(data, 'lint').exitCode, 1)
  assert.equal(step(data, 'test').exitCode, 3)
  assert.equal(step(data, 'test').command, 'npm run test')
  assert.match(text, /^FAIL lint\s+npm run lint \(exit 1, \d/m)
  assert.match(text, /^Result: FAILED \(scan, lint, test\)\. Not verified: local-test\.$/m)
  assert.match(text, / {7}src\/new\.ts:1: no-explicit-any: /)
})

test('the scan step reports each finding with its place, and counts what it looked at', async (t) => {
  const p = await project(t, { changes: { 'src/a.tsx': 'const x = <div dangerouslySetInnerHTML={{ __html: h }} />\nconsole.log(x)\n' } })

  const { data } = await verify(t, p)

  const scan = step(data, 'scan')
  assert.deepEqual(scan.findings.map((finding) => `${finding.file}:${finding.line}:${finding.rule}`), ['src/a.tsx:1:dangerously-set-inner-html', 'src/a.tsx:2:console-log'])
  assert.equal(scan.linesScanned, 2)
  assert.equal(data.base.ref, 'main')
})

test('a step with no command is skipped with the reason and never guessed', async (t) => {
  const p = await project(t, { scripts: {} })

  const { data, text, exitCode } = await verify(t, p)

  assert.equal(exitCode, 0)
  assert.deepEqual(states(data), ['scan:pass', 'lint:skip', 'typecheck:skip', 'test:skip', 'local-test:skip'])
  assert.match(step(data, 'typecheck').reason, /no typecheck command: add a `typecheck` script to package\.json or `commands\.typecheck` to the profile/)
  assert.match(text, /Not verified: lint, typecheck, test, local-test\./)
})

test('{files} in a command stands for the changed JS and TS files, quoted, and nothing else', async (t) => {
  const p = await project(t, {
    profile: 'commands: { lint: "node lint.mjs {files}" }',
    changes: { 'src/my file.ts': 'a\n', 'src/b.tsx': 'b\n', 'README.md': 'docs\n', 'styles.css': 'x\n' },
  })

  const { data } = await verify(t, p)

  const lint = step(data, 'lint')
  assert.equal(lint.command, 'node lint.mjs <2 changed files>')
  assert.deepEqual(JSON.parse(lint.outputTail.split('\n')[0]).args, ['src/b.tsx', 'src/my file.ts'])
})

test('{files} with nothing to lint skips the step instead of linting everything or nothing', async (t) => {
  const p = await project(t, { profile: 'commands: { lint: "node lint.mjs {files}" }', changes: { 'README.md': 'docs\n' } })

  const { data } = await verify(t, p)

  assert.equal(step(data, 'lint').status, 'skip')
  assert.equal(step(data, 'lint').reason, 'no changed JS or TS files for {files}')
})

test('a very long file list is handed over in batches, and the step fails if any batch does', async (t) => {
  const changes = {}
  for (let index = 0; index < 400; index++) changes[`src/${'long-name-'.repeat(20)}${index}.ts`] = 'x\n'
  const p = await project(t, { profile: 'commands: { lint: "node lint.mjs {files}" }', changes })

  const { data } = await verify(t, p)

  const lint = step(data, 'lint')
  assert.equal(lint.status, 'pass')
  assert.ok(lint.batches >= 2, `expected several batches, got ${lint.batches}`)
  assert.equal(lint.command, 'node lint.mjs <400 changed files>')
})

test('in a package below the project root, {files} are the files of that package, relative to it', async (t) => {
  const p = await project(t, {
    scripts: {},
    base: { 'apps/web/package.json': JSON.stringify({ scripts: {} }), 'apps/web/lint.mjs': TOOL, 'apps/api/x.ts': 'x\n' },
    profile: 'commands: { lint: "node lint.mjs {files}" }',
    changes: { 'apps/web/src/a.ts': 'a\n', 'apps/api/b.ts': 'b\n' },
  })

  const { data } = await verify(t, { ...p, dir: join(p.dir, 'apps/web') })

  assert.deepEqual(JSON.parse(step(data, 'lint').outputTail.split('\n')[0]).args, ['src/a.ts'])
})

test('the scope all hands every file of the package to {files}', async (t) => {
  const p = await project(t, { profile: 'commands: { lint: "node lint.mjs {files}" }' })

  const { data, text } = await verify(t, p, { flags: { scope: 'all' } })

  assert.equal(data.scope, 'all')
  assert.equal(step(data, 'lint').command, 'node lint.mjs <4 files>')
  assert.match(text, /^Verifying all files git would not ignore: \d+ files\.$/m)
  assert.deepEqual(JSON.parse(step(data, 'lint').outputTail.split('\n')[0]).args, ['lint.mjs', 'src/keep.ts', 'test.mjs', 'typecheck.mjs'])
})

test('a vitest run is told to leave .fe-kit out, and the command shows it', async (t) => {
  const p = await project(t, { dependencies: { vitest: '5' }, scripts: { test: 'node test.mjs vitest' } })

  const { data } = await verify(t, p)

  const unit = step(data, 'test')
  assert.equal(unit.command, "npm run test -- --exclude '.fe-kit/**'")
  const printed = unit.outputTail.split('\n').find((line) => line.startsWith('{')) // npm prints its own header lines first
  assert.deepEqual(JSON.parse(printed).args, ['vitest', '--exclude', '.fe-kit/**'])
})

test('the local tests run through the vitest of the project, and a failure there fails the verification', async (t) => {
  const p = await project(t, { dependencies: { vitest: '5' }, localTests: { 'a.test.ts': 'x' } })
  await mkdir(join(p.dir, 'node_modules/.bin'), { recursive: true })
  await writeFile(join(p.dir, 'node_modules/.bin/vitest'), FAKE_VITEST)
  await chmod(join(p.dir, 'node_modules/.bin/vitest'), 0o755)

  const passing = await verify(t, p)
  const failing = await verify(t, p, { env: { EXIT_VITEST: '1' } })

  assert.equal(step(passing.data, 'local-test').status, 'pass')
  assert.match(step(passing.data, 'local-test').command, /^vitest run --config \.fe-kit\/vitest\.overlay\.config\.mjs --coverage\.enabled=false$/)
  assert.equal(step(failing.data, 'local-test').status, 'fail')
  assert.equal(failing.exitCode, 1)
})

test('local tests that cannot run are skipped with the reason, and the verification says they were not run', async (t) => {
  const p = await project(t, { localTests: { 'a.test.ts': 'x' } }) // no vitest in this project

  const { data, text } = await verify(t, p)

  assert.equal(step(data, 'local-test').status, 'skip')
  assert.match(step(data, 'local-test').reason, /vitest/)
  assert.match(text, /Not verified: local-test\./)
})

test('the report holds the whole output of every step and is written under .fe-kit/reports', async (t) => {
  const p = await project(t, { changes: { 'src/new.ts': 'export const bad: any = 2\n' } })

  const { data, text } = await verify(t, p, { env: { EXIT_LINT: '1' } })

  const files = await readdir(join(p.dir, '.fe-kit/reports'))
  assert.equal(files.length, 1)
  assert.match(files[0], /^verify-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z\.md$/)
  assert.equal(data.report, `.fe-kit/reports/${files[0]}`)
  assert.match(text, new RegExp(`^Report: \\.fe-kit/reports/${files[0].replace(/\./g, '\\.')}$`, 'm'))
  const report = await readFile(join(p.dir, '.fe-kit/reports', files[0]), 'utf8')
  assert.match(report, /^# fe-kit verify/m)
  assert.match(report, /^## scan: FAIL$/m)
  assert.match(report, /^## lint: FAIL$/m)
  assert.match(report, /^Command: `npm run lint`$/m)
  assert.match(report, /^Exit code: 1,/m)
  assert.match(report, /"tool":"lint\.mjs"/)
  assert.match(report, /^## local-test: SKIP$/m)
  assert.match(report, /src\/new\.ts:1 no-explicit-any/)
})

test('a report is not written where it would show up in git status, and the run says why', async (t) => {
  const notSetUp = await project(t, { drafts: false })
  const symlinked = await project(t, { drafts: false, dependencies: { vitest: '5' } })
  await mkdir(join(symlinked.dir, 'node_modules/.bin'), { recursive: true })
  await writeFile(join(symlinked.dir, 'node_modules/.bin/vitest'), FAKE_VITEST)
  await chmod(join(symlinked.dir, 'node_modules/.bin/vitest'), 0o755)
  await mkdir(join(symlinked.dir, 'elsewhere/tests'), { recursive: true })
  await writeFile(join(symlinked.dir, 'elsewhere/.gitignore'), '*\n') // looks set up, but the folder is a link
  await writeFile(join(symlinked.dir, 'elsewhere/tests/a.test.ts'), 'x')
  await symlink(join(symlinked.dir, 'elsewhere'), join(symlinked.dir, '.fe-kit'))

  for (const p of [notSetUp, symlinked]) {
    const { data, exitCode } = await verify(t, p)

    assert.equal(exitCode, 0)
    assert.equal(data.report, null)
    assert.ok(data.warnings.some((warning) => /report not written/.test(warning) && /fe-kit init/.test(warning)), JSON.stringify(data.warnings))
  }
  assert.deepEqual((await readdir(join(symlinked.dir, 'elsewhere'))).sort(), ['.gitignore', 'tests']) // nothing was written through the link
})

test('what the commands print is not echoed with the password of a URL, in the result or in the report', async (t) => {
  const p = await project(t, { base: { 'lint.mjs': "console.log('https://user:FAKE_SECRET@host/db'); process.exit(1)\n" } })

  const { data, text } = await verify(t, p)

  const report = await readFile(join(p.dir, '.fe-kit/reports', (await readdir(join(p.dir, '.fe-kit/reports')))[0]), 'utf8')
  for (const shown of [JSON.stringify(data), text, report]) assert.ok(!shown.includes('FAKE_SECRET'))
  assert.ok(report.includes('[REDACTED]'))
})

test('a failing step shows the end of its output, not all of it, and the JSON carries the same tail', async (t) => {
  const lots = "for (let i = 1; i <= 200; i++) console.log('line ' + i); process.exit(1)\n"
  const p = await project(t, { base: { 'lint.mjs': lots } })

  const { data, text } = await verify(t, p)

  assert.ok(text.includes('line 200') && text.includes('line 161') && !text.includes('line 160\n'))
  assert.ok(step(data, 'lint').outputTail.includes('line 200'))
  assert.ok(!('output' in step(data, 'lint')))
})

test('a project that is not a git repository runs everything except the scan', async (t) => {
  const dir = await tempDir(t)
  await writeTree(dir, { 'package.json': JSON.stringify({ scripts: { lint: 'node lint.mjs' } }), 'lint.mjs': TOOL })

  const { data } = await run({ args: [], flags: {}, cwd: dir, env: { ...process.env, HOME: await tempDir(t), FE_KIT_PROFILES_DIR: await tempDir(t) }, kitRoot })

  assert.equal(step(data, 'scan').status, 'skip')
  assert.match(step(data, 'scan').reason, /not a git repository/)
  assert.equal(step(data, 'lint').status, 'pass')
})

test('an unknown base or a bad scope is a usage error, before anything runs', async (t) => {
  const p = await project(t)

  await assert.rejects(verify(t, p, { flags: { base: 'nope' } }), UsageError)
  await assert.rejects(verify(t, p, { flags: { scope: 'some' } }), UsageError)
})

test('the command line exits 0, 1 or 2 as the verification goes', async (t) => {
  const p = await project(t, { changes: { 'src/new.ts': 'export const ok = 1\n' } })
  const environment = async (extra = {}) => ({ ...process.env, HOME: await tempDir(t), FE_KIT_PROFILES_DIR: p.profiles, ...extra })
  const exit = async (args, extra) => execFileAsync('node', [bin, 'verify', ...args], { cwd: p.dir, env: await environment(extra) }).then(() => 0, (error) => error.code)

  assert.equal(await exit([]), 0)
  assert.equal(await exit([], { EXIT_TEST: '1' }), 1)
  assert.equal(await exit(['--base', 'nope']), 2)
})

test('a step that runs too long is stopped and fails, saying that it timed out', async (t) => {
  const p = await project(t, { base: { 'lint.mjs': 'setInterval(() => {}, 1000)\n' } })

  const { data, text, exitCode } = await verify(t, p, { limits: { timeoutMs: 400, graceMs: 200 } })

  assert.equal(exitCode, 1)
  assert.equal(step(data, 'lint').status, 'fail')
  assert.equal(step(data, 'lint').timedOut, true)
  assert.match(text, /^FAIL lint\s+npm run lint \(timed out, /m)
})

test('a report is never written over another: a name that is taken is a warning', async (t) => {
  const p = await project(t)
  const fixed = () => new Date('2026-10-19T00:00:00.123Z')

  const first = await verify(t, p, { now: fixed })
  const second = await verify(t, p, { now: fixed })

  assert.equal(first.data.report, '.fe-kit/reports/verify-2026-10-19T00-00-00-123Z.md')
  assert.equal(second.data.report, null)
  assert.ok(second.data.warnings.some((warning) => /report not written: .*EEXIST/.test(warning)))
})

test('a reports folder that is a file or a link is not written through', async (t) => {
  const p = await project(t)
  await writeFile(join(p.dir, '.fe-kit/reports'), 'in the way')

  const { data } = await verify(t, p)

  assert.equal(data.report, null)
  assert.ok(data.warnings.some((warning) => /\.fe-kit\/reports is not a real folder/.test(warning)))
})

test('output that contains code fences cannot break the report', async (t) => {
  const p = await project(t, { base: { 'lint.mjs': "console.log('```js\\nx\\n```'); console.log('`````'); process.exit(1)\n" } })

  await verify(t, p)

  const report = await readFile(join(p.dir, '.fe-kit/reports', (await readdir(join(p.dir, '.fe-kit/reports')))[0]), 'utf8')
  const section = report.slice(report.indexOf('## lint: FAIL'), report.indexOf('## typecheck'))
  assert.match(section, /\n``````\n[\s\S]*\n``````\n/) // six backticks: one more than the longest run inside
})

test('a note about the test command is carried to the result', async (t) => {
  const p = await project(t, { dependencies: { vitest: '5' } }) // vitest is a dependency, but the script does not say that it runs it

  const { data, text } = await verify(t, p)

  assert.ok(data.notes.some((note) => /could not tell that the test command runs vitest/.test(note)))
  assert.match(text, /^Note: could not tell that the test command runs vitest/m)
})

test('files that were not read by the scan are named under it', async (t) => {
  const p = await project(t, { changes: { 'src/new.ts': 'export const fine = 2\n' } })
  await writeFile(join(p.dir, 'pic.bin'), Buffer.from([0, 1, 0]))

  const { text } = await verify(t, p)

  assert.match(text, /^ {7}Not scanned: pic\.bin \(binary\)$/m)
})

test('outside git, --scope and --base are usage errors', async (t) => {
  const dir = await tempDir(t)
  await writeTree(dir, { 'package.json': '{}' })
  const call = (flags) => run({ args: [], flags, cwd: dir, env: { ...process.env, HOME: dir + '-home', FE_KIT_PROFILES_DIR: dir + '-none' }, kitRoot })

  await assert.rejects(call({ base: 'main' }), UsageError)
  await assert.rejects(call({ scope: 'all' }), UsageError)
})

test('a step that was stopped has not passed, even if the program exited cleanly when asked to stop', async (t) => {
  const p = await project(t, { base: { 'typecheck.mjs': "process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000)\n" } })

  const { data, exitCode } = await verify(t, p, { limits: { timeoutMs: 400, graceMs: 200 } })

  assert.equal(step(data, 'typecheck').exitCode, 0)
  assert.equal(step(data, 'typecheck').timedOut, true)
  assert.equal(step(data, 'typecheck').status, 'fail')
  assert.equal(exitCode, 1)
})

test('a .fe-kit folder whose .gitignore does not hide everything gets no report either', async (t) => {
  const noFile = await project(t, { drafts: false })
  await mkdir(join(noFile.dir, '.fe-kit'))
  const partial = await project(t, { drafts: false })
  await mkdir(join(partial.dir, '.fe-kit'))
  await writeFile(join(partial.dir, '.fe-kit/.gitignore'), 'node_modules\n')

  for (const p of [noFile, partial]) {
    const { data } = await verify(t, p)

    assert.equal(data.report, null)
    assert.ok(data.warnings.some((warning) => /report not written/.test(warning)))
    assert.deepEqual((await readdir(join(p.dir, '.fe-kit'))).filter((name) => name === 'reports'), [])
  }
})

test('the base branch of the profile is where the changes are counted from', async (t) => {
  const p = await project(t, { profile: 'baseBranch: develop', changes: { 'src/new.ts': 'export const bad: any = 2\n' } })
  await commitAll(p.dir, 'feature work')
  await git(p.dir, 'branch', 'develop') // develop already has the feature work, so nothing is new against it

  const { data } = await verify(t, p)

  assert.equal(data.base.ref, 'develop')
  assert.deepEqual(step(data, 'scan').findings, [])
})

test('when nothing could run, nothing is claimed: the result says so and the exit code is 1', async (t) => {
  const dir = await tempDir(t)
  await writeTree(dir, { 'package.json': '{}' })

  const { data, text, exitCode } = await run({ args: [], flags: {}, cwd: dir, env: { ...process.env, HOME: await tempDir(t), FE_KIT_PROFILES_DIR: await tempDir(t) }, kitRoot })

  assert.equal(data.passed, false)
  assert.equal(exitCode, 1)
  assert.match(text, /^Result: NOTHING VERIFIED\. Not verified: scan, lint, typecheck, test, local-test\.$/m)
})

test('a local test runner that cannot be started fails the step and says why', async (t) => {
  const p = await project(t, { dependencies: { vitest: '5' }, localTests: { 'a.test.ts': 'x' } })
  await mkdir(join(p.dir, 'node_modules/.bin'), { recursive: true })
  await writeFile(join(p.dir, 'node_modules/.bin/vitest'), 'not a program')
  await chmod(join(p.dir, 'node_modules/.bin/vitest'), 0o644)

  const { data, text, exitCode } = await verify(t, p)

  assert.equal(step(data, 'local-test').status, 'fail')
  assert.match(step(data, 'local-test').error, /EACCES/)
  assert.match(text, /^FAIL local-test\s+vitest run .* \(could not start: .*EACCES/m)
  assert.equal(exitCode, 1)
})

test('in a workspace where .fe-kit cannot be written the checks still run, and what could not be written is said', { skip: !canTestPermissions }, async (t) => {
  const p = await project(t, { dependencies: { vitest: '5' }, localTests: { 'a.test.ts': 'x' } })
  await mkdir(join(p.dir, 'node_modules/.bin'), { recursive: true })
  await writeFile(join(p.dir, 'node_modules/.bin/vitest'), FAKE_VITEST)
  await chmod(join(p.dir, 'node_modules/.bin/vitest'), 0o755)
  await chmod(join(p.dir, '.fe-kit'), 0o555)

  try {
    const { data, exitCode } = await verify(t, p)

    assert.equal(exitCode, 0)
    assert.deepEqual(states(data), ['scan:pass', 'lint:pass', 'typecheck:pass', 'test:pass', 'local-test:skip'])
    assert.match(step(data, 'local-test').reason, /could not write \.fe-kit\/vitest\.overlay\.config\.mjs \(EACCES\)/)
    assert.equal(data.report, null)
    assert.ok(data.warnings.some((warning) => /report not written: .*EACCES/.test(warning)))
  } finally {
    await chmod(join(p.dir, '.fe-kit'), 0o755)
  }
})

test('a password in a long scanned line is not left half-cut in the report: lines are redacted before they are shortened', async (t) => {
  const line = `console.log("${'x'.repeat(165)}https://user:supersecretpassword@example.com/path")`
  const p = await project(t, { changes: { 'src/leak.ts': `${line}\n` } })

  const { data, text } = await verify(t, p)

  const report = await readFile(join(p.dir, '.fe-kit/reports', (await readdir(join(p.dir, '.fe-kit/reports')))[0]), 'utf8')
  assert.ok(step(data, 'scan').findings.length > 0)
  for (const shown of [JSON.stringify(data), text, report]) assert.ok(!shown.includes('supers'), 'part of the password is in the output')
})

test('a {files} inside quotes is not expanded: the step is skipped, and a hostile file name does nothing', async (t) => {
  const p = await project(t, {
    profile: 'commands: { lint: \'node lint.mjs "{files}"\', typecheck: "node typecheck.mjs \'{files}\'" }',
    changes: { '$(touch pwned).ts': 'x\n', 'src/b.ts': 'b\n' },
  })

  const { data } = await verify(t, p)

  assert.equal(step(data, 'lint').status, 'skip')
  assert.match(step(data, 'lint').reason, /\{files\} in the lint command is inside quotes: write it bare/)
  assert.equal(step(data, 'typecheck').status, 'skip')
  await assert.rejects(readFile(join(p.dir, 'pwned')), { code: 'ENOENT' })
  assert.ok(data.warnings.some((warning) => warning.includes('"commands.lint" has {files} inside quotes')))
})

test('a changed file whose name starts with a dash reaches the command as a path, not as an option', async (t) => {
  const p = await project(t, { profile: 'commands: { lint: "node lint.mjs {files}" }', changes: { '-dash.ts': 'x\n', 'src/b.ts': 'b\n' } })

  const { data } = await verify(t, p)

  assert.deepEqual(JSON.parse(step(data, 'lint').outputTail.split('\n')[0]).args, ['./-dash.ts', 'src/b.ts'])
})

test('a scan that read nothing is skipped, not passed: every file it was to look at was left unread', async (t) => {
  const p = await project(t)
  await writeFile(join(p.dir, 'pic.bin'), Buffer.from([0, 1, 0]))

  const { data, text } = await verify(t, p)

  assert.equal(step(data, 'scan').status, 'skip')
  assert.match(step(data, 'scan').reason, /pic\.bin \(binary\)/)
  assert.match(text, /Not verified: .*scan/)
})

test('output with very many backtick runs does not stop the report from being written', async (t) => {
  const p = await project(t, { base: { 'lint.mjs': "console.log('` '.repeat(1000000)); process.exitCode = 1\n" } })

  const { data } = await verify(t, p)

  assert.equal(step(data, 'lint').status, 'fail')
  assert.ok(data.report, 'the report is written')
})

test('a {files} in backticks or after a here-document marker is not expanded', async (t) => {
  const p = await project(t, {
    profile: 'commands: { lint: "echo `echo {files}`", typecheck: "cat <<EOF\\n{files}\\nEOF" }',
    changes: { 'src/a`touch pwned`.ts': 'x\n' },
  })

  const { data } = await verify(t, p)

  assert.equal(step(data, 'lint').status, 'skip')
  assert.equal(step(data, 'typecheck').status, 'skip')
  await assert.rejects(readFile(join(p.dir, 'pwned')), { code: 'ENOENT' })
})

test('a file the scan could not read fails the scan, even next to files that were scanned clean', { skip: !canTestPermissions }, async (t) => {
  const p = await project(t, { changes: { 'src/ok.ts': 'export const ok = 1\n' } })
  await writeFile(join(p.dir, 'src/bad.ts'), 'export const x: any = 1\n')
  await chmod(join(p.dir, 'src/bad.ts'), 0o000)

  let outcome
  try {
    outcome = await verify(t, p)
  } finally {
    await chmod(join(p.dir, 'src/bad.ts'), 0o644)
  }

  assert.equal(step(outcome.data, 'scan').status, 'fail')
  assert.equal(outcome.exitCode, 1)
  assert.match(outcome.text, /^FAIL scan .*could not be read/m)
  assert.match(outcome.text, /^Result: FAILED \(scan\)/m)
})
