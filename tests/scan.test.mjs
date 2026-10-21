import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { chmod, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { run } from '../src/commands/scan.mjs'
import { UsageError } from '../src/lib/errors.mjs'
import { canTestPermissions, commitAll, git, makeGitRepo, tempDir, writeTree } from './helpers.mjs'

const kitRoot = fileURLToPath(new URL('..', import.meta.url))
const bin = join(kitRoot, 'bin/fe-kit.mjs')
const execFileAsync = promisify(execFile)

/** A repo on `main` holding `base`, then a branch `feature` for the work. */
async function project(t, base) {
  const dir = await tempDir(t)
  await makeGitRepo(dir, { remote: 'git@gitlab.local:fe/shop.git' })
  await writeTree(dir, { 'package.json': '{}', ...base })
  await commitAll(dir, 'base')
  await git(dir, 'checkout', '-q', '-b', 'feature')
  return dir
}

async function scan(t, dir, { flags = {}, profiles = {} } = {}) {
  const profilesDir = await tempDir(t)
  await writeTree(profilesDir, profiles)
  return run({ args: [], flags, cwd: dir, env: { FE_KIT_PROFILES_DIR: profilesDir, HOME: dir }, kitRoot })
}

const place = (finding) => `${finding.file}:${finding.line}:${finding.rule}`

test('reports what the branch adds, with file, line and rule, and exits 1', async (t) => {
  const dir = await project(t, { 'src/a.ts': 'export const ok = 1\n' })
  await writeTree(dir, { 'src/a.ts': 'export const ok = 1\nexport const bad: any = 2\n' })
  await commitAll(dir, 'work')
  await writeTree(dir, { 'src/b.tsx': 'export const B = () => <div dangerouslySetInnerHTML={{ __html: x }} />\n' })

  const { data, text, exitCode } = await scan(t, dir)

  assert.deepEqual(data.findings.map(place), ['src/a.ts:2:no-explicit-any', 'src/b.tsx:1:dangerously-set-inner-html'])
  assert.equal(exitCode, 1)
  assert.match(text, /^src\/a\.ts:2: no-explicit-any: explicit `any`/m)
  assert.match(text, /^ {4}export const bad: any = 2$/m)
  assert.match(text, /2 findings in 2 files/)
  assert.equal(data.scope, 'changed')
  assert.equal(data.base.ref, 'main')
})

test('a clean change has no findings and exits 0', async (t) => {
  const dir = await project(t, { 'src/a.ts': 'export const ok = 1\n' })
  await writeTree(dir, { 'src/a.ts': 'export const ok = 1\nexport const fine: number = 2\n' })

  const { data, text, exitCode } = await scan(t, dir)

  assert.deepEqual(data.findings, [])
  assert.equal(exitCode, 0)
  assert.match(text, /No findings \(1 added line in 1 file\)\./)
})

test('problems that were already on the base branch are not reported, unless the scope is all', async (t) => {
  const dir = await project(t, { 'src/old.ts': 'export const old: any = 1\n' })
  await writeTree(dir, { 'src/new.ts': 'export const fresh = 1\n' })

  const changed = await scan(t, dir)
  const everything = await scan(t, dir, { flags: { scope: 'all' } })

  assert.deepEqual(changed.data.findings, [])
  assert.deepEqual(everything.data.findings.map(place), ['src/old.ts:1:no-explicit-any'])
  assert.equal(everything.data.scope, 'all')
  assert.equal(everything.exitCode, 1)
})

test('the base comes from --base, then from the profile', async (t) => {
  const dir = await project(t, { 'src/a.ts': 'export const ok = 1\n' })
  await writeTree(dir, { 'src/a.ts': 'export const ok = 1\nconsole.log(ok)\n' })
  await commitAll(dir, 'feature work')
  await git(dir, 'branch', 'develop') // develop already holds the feature work, so nothing is new against it
  const profiles = { 'shop.md': '---\nname: shop\nmatch: { remotes: ["gitlab.local/fe/shop"] }\nbaseBranch: develop\n---\n' }

  const byDefault = await scan(t, dir)
  const byProfile = await scan(t, dir, { profiles })
  const explicit = await scan(t, dir, { profiles, flags: { base: 'main' } })

  assert.deepEqual(byDefault.data.findings.map(place), ['src/a.ts:2:console-log'])
  assert.deepEqual(byProfile.data.findings.map(place), [])
  assert.equal(byProfile.data.base.ref, 'develop')
  assert.deepEqual(explicit.data.findings.map(place), ['src/a.ts:2:console-log'])
})

test('the rules of the matching profile run next to the general ones, and a broken one is a warning', async (t) => {
  const dir = await project(t, { 'src/a.ts': 'export const ok = 1\n' })
  await writeTree(dir, { 'src/a.ts': "export const ok = 1\nimport moment from 'moment'\n" })
  const profile = `---
name: shop
match: { remotes: ["gitlab.local/fe/shop"] }
scan:
  - { id: no-moment, pattern: "from 'moment'", message: "use date-fns", files: ["src/**/*.ts"] }
  - { id: broken, pattern: "(", message: "never runs" }
---
`

  const { data, text } = await scan(t, dir, { profiles: { 'shop.md': profile } })

  assert.deepEqual(data.findings.map(place), ['src/a.ts:2:no-moment'])
  assert.ok(data.warnings.some((warning) => warning.includes('"scan[1].pattern" must be a valid regular expression')))
  assert.match(text, /Warnings:\n {2}- Profile shop\.md: "scan\[1\]\.pattern"/)
})

test('a scan rule with a glob that cannot be compiled is dropped with a warning, and the scan still runs', async (t) => {
  const dir = await project(t, { 'src/a.ts': 'export const ok = 1\n' })
  await writeTree(dir, { 'src/a.ts': 'export const ok = 1\nconsole.log(ok)\n' })
  const profile = `---
name: shop
match: { remotes: ["gitlab.local/fe/shop"] }
scan:
  - { id: broken, pattern: "ok", message: "never runs", files: ["src/[z-a]/*.ts"] }
---
`

  const { data, exitCode } = await scan(t, dir, { profiles: { 'shop.md': profile } })

  assert.deepEqual(data.findings.map(place), ['src/a.ts:2:console-log'])
  assert.equal(exitCode, 1)
  assert.ok(data.warnings.some((warning) => warning.includes('"scan[0].files" has a glob that is not valid')))
})

test('drafts in .fe-kit are not scanned', async (t) => {
  const dir = await project(t, { 'a.ts': 'x\n' })
  await writeTree(dir, { '.fe-kit/notes.md': 'see .fe-kit/specs\n<<<<<<< HEAD\n' })

  assert.deepEqual((await scan(t, dir)).data.findings, [])
})

test('files that were not read are named, and fallbacks are explained', async (t) => {
  const dir = await project(t, { 'a.ts': 'x\n' })
  await writeFile(join(dir, 'ok.ts'), 'export const ok = 1\n')
  await writeFile(join(dir, 'pic.bin'), Buffer.from([0, 1, 0]))

  const { data, text } = await scan(t, dir, { profiles: { 'shop.md': '---\nname: shop\nmatch: { remotes: ["gitlab.local/fe/shop"] }\nbaseBranch: nowhere\n---\n' } })

  assert.deepEqual(data.skipped, [{ file: 'pic.bin', reason: 'binary' }])
  assert.match(text, /Not scanned: pic\.bin \(binary\)/)
  assert.match(text, /baseBranch "nowhere" of the profile was not found/)
})

test('a credential in a scanned line is not echoed in the URL form', async (t) => {
  const dir = await project(t, { 'a.ts': 'x\n' })
  await writeTree(dir, { 'a.ts': 'x\nconsole.log("https://user:FAKE_SECRET@host/path")\n' })

  const { data, text } = await scan(t, dir)

  assert.equal(data.findings.length, 1)
  assert.ok(!JSON.stringify(data).includes('FAKE_SECRET'))
  assert.ok(!text.includes('FAKE_SECRET'))
})

test('an unknown base, a bad scope and a folder that is not a repository are usage errors', async (t) => {
  const dir = await project(t, { 'a.ts': 'x\n' })
  const notGit = await tempDir(t)

  await assert.rejects(scan(t, dir, { flags: { base: 'nope' } }), UsageError)
  await assert.rejects(scan(t, dir, { flags: { scope: 'some' } }), UsageError)
  await assert.rejects(scan(t, notGit), UsageError)
})

test('the command line exits 2 with a message on a usage error, and 1 on findings, in text and in JSON', async (t) => {
  const dir = await project(t, { 'a.ts': 'x\n' })
  await writeTree(dir, { 'a.ts': 'x\nconst y: any = 1\n' })
  const env = { ...process.env, HOME: dir, FE_KIT_PROFILES_DIR: await tempDir(t) }
  const call = (...args) => execFileAsync('node', [bin, ...args], { cwd: dir, env }).then((out) => ({ code: 0, ...out }), (error) => error)

  const found = await call('scan', '--json')
  const wrongBase = await call('scan', '--base', 'nope')
  const wrongBaseJson = await call('scan', '--base', 'nope', '--json')

  assert.equal(found.code, 1)
  assert.equal(JSON.parse(found.stdout).findings[0].rule, 'no-explicit-any')
  assert.equal(wrongBase.code, 2)
  assert.match(wrongBase.stderr, /^fe-kit: unknown base "nope"/)
  assert.equal(wrongBase.stdout, '')
  assert.equal(wrongBaseJson.code, 2)
  assert.match(JSON.parse(wrongBaseJson.stdout).error, /unknown base "nope"/)
})

test('a profile with very many warnings still prints them', async (t) => {
  const dir = await project(t, { 'src/a.ts': 'export const ok = 1\n' })
  const profile = `---\nname: shop\nmatch: { remotes: ["gitlab.local/fe/shop"] }\nscan: [${'null,'.repeat(200_000)}]\n---\n`

  const { text } = await scan(t, dir, { profiles: { 'shop.md': profile } })

  assert.match(text, /^Warnings:$/m)
})

test('when no file could be read nothing was scanned, and that is not a clean result', { skip: !canTestPermissions }, async (t) => {
  const dir = await project(t, { 'a.ts': 'x\n' })
  await writeFile(join(dir, 'bad.ts'), 'export const x: any = 1\n')
  await chmod(join(dir, 'bad.ts'), 0o000)

  let outcome
  try {
    outcome = await scan(t, dir)
  } finally {
    await chmod(join(dir, 'bad.ts'), 0o644)
  }

  assert.equal(outcome.exitCode, 1)
  assert.match(outcome.text, /^Nothing was scanned: .*bad\.ts \(could not be read \(EACCES\)\)/m)
})

test('a file that could not be read fails the scan even when other files were scanned clean', { skip: !canTestPermissions }, async (t) => {
  const dir = await project(t, { 'a.ts': 'x\n' })
  await writeFile(join(dir, 'ok.ts'), 'export const ok = 1\n')
  await writeFile(join(dir, 'bad.ts'), 'export const x: any = 1\n')
  await chmod(join(dir, 'bad.ts'), 0o000)

  let outcome
  try {
    outcome = await scan(t, dir)
  } finally {
    await chmod(join(dir, 'bad.ts'), 0o644)
  }

  assert.equal(outcome.exitCode, 1)
  assert.match(outcome.text, /^Could not read: bad\.ts \(could not be read \(EACCES\)\)/m)
})

test('files skipped for being binary or large are not a failure when something else was scanned', async (t) => {
  const dir = await project(t, { 'a.ts': 'x\n' })
  await writeFile(join(dir, 'ok.ts'), 'export const ok = 1\n')
  await writeFile(join(dir, 'pic.bin'), Buffer.from([0, 1, 0]))

  assert.equal((await scan(t, dir)).exitCode, 0)
})
