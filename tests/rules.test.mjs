import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { chmod, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { run, run as runRules } from '../src/commands/rules.mjs'
import { UsageError } from '../src/lib/errors.mjs'
import { canTestPermissions, tempDir, writeTree } from './helpers.mjs'

const realKitRoot = fileURLToPath(new URL('..', import.meta.url))
const execFileAsync = promisify(execFile)
const REFERENCES = 'skills/fe-standards/references'

const KIT = {
  [`${REFERENCES}/react.md`]: '---\npaths: ["**/*.tsx", "**/*.jsx"]\n---\n# React\n',
  [`${REFERENCES}/typescript.md`]: '---\npaths: "**/*.{ts,tsx}"\n---\n# TypeScript\n',
  [`${REFERENCES}/general.md`]: '# General\nno frontmatter, so it applies everywhere\n',
}

/** Runs `rules` in a temp project (a package.json makes it the root). `profile` gets the project directory. */
async function rules(t, { project = {}, kit = KIT, profile, cwd = '', args = [], flags = {} } = {}) {
  const dir = await tempDir(t)
  await writeTree(dir, { 'package.json': '{}', ...project })
  const kitRoot = await tempDir(t)
  await writeTree(kitRoot, kit)
  const profilesDir = await tempDir(t)
  if (profile) await writeTree(profilesDir, { 'p.md': profile(dir) })
  const result = await run({ args, flags, cwd: join(dir, cwd), env: { FE_KIT_PROFILES_DIR: profilesDir, HOME: await tempDir(t) }, kitRoot })
  return { dir, kitRoot, ...result }
}
const profileWith = (standards) => (dir) => `---\nname: p\nmatch: { paths: ["${dir}"] }\nstandards: ${standards}\n---\n`
const names = (data) => data.rules.map(({ origin, relative }) => `${origin}:${relative}`)

test('a kit reference applies to the files its paths match, and one without paths applies to every file', async (t) => {
  const tsx = await rules(t, { flags: { files: ['src/a.tsx'] } })
  const ts = await rules(t, { flags: { files: ['src/b.ts'] } })
  const css = await rules(t, { flags: { files: ['src/c.css'] } })

  assert.deepEqual(names(tsx.data), [`kit:${REFERENCES}/general.md`, `kit:${REFERENCES}/react.md`, `kit:${REFERENCES}/typescript.md`])
  assert.deepEqual(names(ts.data), [`kit:${REFERENCES}/general.md`, `kit:${REFERENCES}/typescript.md`])
  assert.deepEqual(names(css.data), [`kit:${REFERENCES}/general.md`])
  assert.deepEqual(tsx.data.rules[1].paths, ['**/*.tsx', '**/*.jsx'])
  assert.equal(tsx.data.rules[0].paths, null)
  assert.equal(tsx.data.rules[1].path, join(tsx.kitRoot, REFERENCES, 'react.md'))
})

test('each rule says which of the given files it applies to', async (t) => {
  const { data } = await rules(t, { flags: { files: ['src/a.tsx', 'src/b.css'] } })

  const byName = Object.fromEntries(data.rules.map((rule) => [rule.relative.split('/').at(-1), rule.appliesTo]))
  assert.deepEqual(byName, { 'general.md': ['src/a.tsx', 'src/b.css'], 'react.md': ['src/a.tsx'], 'typescript.md': ['src/a.tsx'] })
})

test('project standards named by the profile come first, expanded from globs, and narrow themselves with paths', async (t) => {
  const project = {
    'CONTRIBUTING.md': '# Contributing\n',
    'docs/frontend/react.md': '# React at work\n',
    'docs/frontend/vue.md': '---\npaths: ["**/*.vue"]\n---\n# Vue at work\n',
    'CLAUDE.md': '# not listed by the profile\n',
  }

  const { data } = await rules(t, { project, profile: profileWith('["CONTRIBUTING.md", "docs/frontend/**/*.md"]'), flags: { files: ['src/a.tsx'] } })

  assert.deepEqual(names(data), ['project:CONTRIBUTING.md', 'project:docs/frontend/react.md', `kit:${REFERENCES}/general.md`, `kit:${REFERENCES}/react.md`, `kit:${REFERENCES}/typescript.md`])
})

test('without a profile list the usual documents are used, and AGENTS.md linked to CLAUDE.md counts once', async (t) => {
  const project = { 'CONTRIBUTING.md': '# c\n', 'CLAUDE.md': '# cl\n' }
  const { dir, data } = await rules(t, { project, kit: {}, flags: { files: ['src/a.ts'] } })
  await symlink('CLAUDE.md', join(dir, 'AGENTS.md'))
  const again = await run({ args: [], flags: { files: ['src/a.ts'] }, cwd: dir, env: { FE_KIT_PROFILES_DIR: await tempDir(t), HOME: dir }, kitRoot: await tempDir(t) })

  assert.deepEqual(names(data), ['project:CONTRIBUTING.md', 'project:CLAUDE.md'])
  assert.deepEqual(names(again.data), ['project:CONTRIBUTING.md', 'project:CLAUDE.md'])
})

test('a profile that lists no standards means none, and a profile with a malformed list falls back to the usual documents', async (t) => {
  const project = { 'CONTRIBUTING.md': '# c\n' }
  const none = await rules(t, { project, kit: {}, profile: profileWith('[]'), flags: { files: ['a.ts'] } })
  const malformed = await rules(t, { project, kit: {}, profile: profileWith('CONTRIBUTING.md'), flags: { files: ['a.ts'] } })

  assert.deepEqual(names(none.data), [])
  assert.deepEqual(names(malformed.data), ['project:CONTRIBUTING.md'])
})

test('files may be given as arguments, as --files, relative to where the command runs, or as absolute paths', async (t) => {
  const dir = await tempDir(t)
  const options = { project: { 'src/keep.txt': '' }, kit: { [`${REFERENCES}/react.md`]: KIT[`${REFERENCES}/react.md`] } }

  const fromSub = await rules(t, { ...options, cwd: 'src', args: ['a.tsx'], flags: { files: ['b.tsx'] } })
  const absolute = await rules(t, { ...options, flags: { files: [join(dir, 'x')] } })

  assert.deepEqual(fromSub.data.files, ['src/b.tsx', 'src/a.tsx'])
  assert.deepEqual(names(fromSub.data), [`kit:${REFERENCES}/react.md`])
  assert.equal(absolute.data.files.length, 0)
  assert.match(absolute.data.warnings[0], /is outside the project/)
})

test('a path inside the project given absolutely is taken relative to the project', async (t) => {
  const dir = await tempDir(t)
  await writeTree(dir, { 'package.json': '{}' })
  const kitRoot = await tempDir(t)
  await writeTree(kitRoot, KIT)

  const { data } = await run({ args: [], flags: { files: [join(dir, 'src/a.tsx')] }, cwd: dir, env: { FE_KIT_PROFILES_DIR: await tempDir(t), HOME: dir }, kitRoot })

  assert.deepEqual(data.files, ['src/a.tsx'])
})

test('a path spelled through a symlink to the project is still inside it, even when its folders do not exist yet', async (t) => {
  const dir = await tempDir(t)
  const elsewhere = await tempDir(t)
  await writeTree(dir, { 'package.json': '{}' })
  await symlink(dir, join(elsewhere, 'link'))
  const kitRoot = await tempDir(t)
  await writeTree(kitRoot, KIT)

  const { data } = await run({ args: [], flags: { files: [join(elsewhere, 'link/src/new/dir/a.tsx')] }, cwd: dir, env: { FE_KIT_PROFILES_DIR: await tempDir(t), HOME: await tempDir(t) }, kitRoot })

  assert.deepEqual(data.files, ['src/new/dir/a.tsx'])
  assert.deepEqual(data.warnings, [])
})

test('the same file given twice is one file', async (t) => {
  const { data } = await rules(t, { args: ['src/a.tsx'], flags: { files: ['src/a.tsx', './src/a.tsx'] } })

  assert.deepEqual(data.files, ['src/a.tsx'])
})

test('only markdown files in the kit references folder are rules', async (t) => {
  const kit = { ...KIT, [`${REFERENCES}/notes.txt`]: 'scratch', [`${REFERENCES}/.hidden`]: 'x' }

  const { data } = await rules(t, { kit, flags: { files: ['src/a.tsx'] } })

  assert.ok(data.rules.every((rule) => rule.relative.endsWith('.md')))
})

test('a standards glob that leaves the project is reported and not used', async (t) => {
  const { data } = await rules(t, { kit: {}, profile: profileWith('["../outside.md", "CONTRIBUTING.md"]'), project: { 'CONTRIBUTING.md': '#' }, flags: { files: ['a.ts'] } })

  assert.deepEqual(names(data), ['project:CONTRIBUTING.md'])
  assert.ok(data.warnings.some((warning) => warning.includes('"../outside.md" leaves the project')))
})

test('a document whose frontmatter cannot be read, or whose paths is not a list of strings, applies to every file and is reported', async (t) => {
  const project = { 'CONTRIBUTING.md': '---\npaths: [oops\n---\n', 'CLAUDE.md': '---\npaths: 7\n---\n' }

  const { data } = await rules(t, { project, kit: {}, flags: { files: ['a.css'] } })

  assert.deepEqual(names(data), ['project:CONTRIBUTING.md', 'project:CLAUDE.md'])
  assert.equal(data.warnings.length, 2)
  assert.match(data.warnings[0], /^CONTRIBUTING\.md: invalid YAML \(/)
  assert.match(data.warnings[1], /^CLAUDE\.md: "paths" must be a glob or a list of globs/)
})

test('a document that cannot be read is still listed, with a warning', { skip: !canTestPermissions }, async (t) => {
  const dir = await tempDir(t)
  await writeTree(dir, { 'package.json': '{}', 'CONTRIBUTING.md': '# c\n' })
  await chmod(join(dir, 'CONTRIBUTING.md'), 0o000)
  const env = { FE_KIT_PROFILES_DIR: await tempDir(t), HOME: await tempDir(t) }

  const { data } = await run({ args: [], flags: { files: ['a.ts'] }, cwd: dir, env, kitRoot: await tempDir(t) })

  assert.deepEqual(names(data), ['project:CONTRIBUTING.md'])
  assert.deepEqual(data.warnings, ['CONTRIBUTING.md: could not be read (EACCES)'])
})

test('a URL with a password inside a glob that is reported does not print the password', async (t) => {
  const { data, text } = await rules(t, { kit: {}, profile: profileWith('["../https://user:FAKE_SECRET@host/a.md"]'), flags: { files: ['a.ts'] } })

  assert.ok(!JSON.stringify(data).includes('FAKE_SECRET'))
  assert.ok(!text.includes('FAKE_SECRET'))
  assert.ok(data.warnings.some((warning) => warning.includes('[REDACTED]')))
})

test('a document whose paths hold a glob that cannot be compiled covers every file, and says so, instead of stopping the command', async (t) => {
  const project = { 'CONTRIBUTING.md': '---\npaths: ["src/[z-a]/*.ts"]\n---\n' }

  const { data } = await rules(t, { project, kit: {}, flags: { files: ['src/a.css'] } })

  assert.deepEqual(names(data), ['project:CONTRIBUTING.md'])
  assert.deepEqual(data.warnings, ['CONTRIBUTING.md: "paths" has a glob that is not valid'])
})

test('no files is a usage error', async (t) => {
  await assert.rejects(rules(t, {}), (error) => error instanceof UsageError && /fe-kit rules --files/.test(error.message))
})

test('the text names each document with where it comes from and what it covers', async (t) => {
  const project = { 'CONTRIBUTING.md': '# c\n' }

  const { text } = await rules(t, { project, flags: { files: ['src/a.tsx', 'src/b.css'] } })

  assert.match(text, /^Rules for 2 files/)
  assert.match(text, /^CONTRIBUTING\.md \(project\)$/m)
  assert.match(text, /react\.md \(kit, paths \*\*\/\*\.tsx \*\*\/\*\.jsx\) for src\/a\.tsx$/m)
  assert.match(text, /general\.md \(kit\)$/m)
})

test('nothing to read is said so', async (t) => {
  const { text } = await rules(t, { kit: {}, flags: { files: ['a.ts'] } })

  assert.match(text, /No rules apply\./)
})

test('a document limited to a framework applies only to projects that use it', async (t) => {
  const kit = { [`${REFERENCES}/next.md`]: '---\nframeworks: [next]\npaths: ["**/*.tsx"]\n---\n# Next\n' }
  const next = { 'package.json': JSON.stringify({ dependencies: { next: '15.0.0' } }) }
  const vite = { 'package.json': JSON.stringify({ devDependencies: { vite: '8.0.0' } }) }

  const inNext = await rules(t, { project: next, kit, flags: { files: ['app/page.tsx'] } })
  const inVite = await rules(t, { project: vite, kit, flags: { files: ['app/page.tsx'] } })

  assert.deepEqual(names(inNext.data), [`kit:${REFERENCES}/next.md`])
  assert.deepEqual(inNext.data.rules[0].frameworks, ['next'])
  assert.deepEqual(names(inVite.data), [])
})

test('frameworks may be a single name, and a value of the wrong type is reported and ignored', async (t) => {
  const kit = {
    [`${REFERENCES}/one.md`]: '---\nframeworks: next\n---\n',
    [`${REFERENCES}/bad.md`]: '---\nframeworks: 7\n---\n',
  }
  const project = { 'package.json': JSON.stringify({ dependencies: { next: '15' } }) }

  const { data } = await rules(t, { project, kit, flags: { files: ['a.ts'] } })

  assert.deepEqual(names(data), [`kit:${REFERENCES}/bad.md`, `kit:${REFERENCES}/one.md`])
  assert.deepEqual(data.warnings, [`${REFERENCES}/bad.md: "frameworks" must be a name or a list of names`])
})

test('the six references that ship with the kit cover the files they are meant for', async (t) => {
  const sample = {
    'typescript.md': ['src/a.ts', 'src/b.tsx'],
    'react.md': ['src/App.tsx', 'src/hook.jsx', 'src/hooks/useThing.ts', 'src/useThing.ts'],
    'next.md': ['app/page.tsx', 'next.config.mjs', 'src/app/api/users/route.ts', 'middleware.ts'],
    'testing.md': ['src/a.test.ts', 'src/a.spec.tsx', 'e2e/login.spec.ts', '.fe-kit/tests/login.test.tsx'],
    'a11y.md': ['src/Button.tsx', 'public/index.html'],
    'security.md': ['src/api.ts', 'src/Page.tsx'],
  }
  const run = async (project, files) => {
    const dir = await tempDir(t)
    await writeTree(dir, { 'package.json': JSON.stringify(project) })
    const result = await runRules({ args: [], flags: { files }, cwd: dir, env: { FE_KIT_PROFILES_DIR: join(dir, 'no-profiles'), HOME: await tempDir(t) }, kitRoot: realKitRoot })
    return result.data
  }

  const data = await run({ dependencies: { next: '15' } }, Object.values(sample).flat())

  for (const [reference, files] of Object.entries(sample)) {
    const rule = data.rules.find((candidate) => candidate.origin === 'kit' && candidate.path.endsWith(`/${reference}`))
    assert.ok(rule, `${reference} is not among the rules`)
    for (const file of files) assert.ok(rule.appliesTo.includes(file), `${reference} should apply to ${file}`)
  }
  const stylesheet = await run({ dependencies: { next: '15' } }, ['src/a.css'])
  assert.deepEqual(stylesheet.rules, [], 'a stylesheet is not TypeScript, React, Next.js, a test or markup')
  const notNext = await run({ dependencies: { react: '19' } }, ['app/page.tsx'])
  assert.ok(!notNext.rules.some((rule) => rule.path.endsWith('/next.md')), 'next.md is for Next.js projects only')
})

test('the command line prints the rules for a file, in text and in JSON', async (t) => {
  const dir = await tempDir(t)
  await writeTree(dir, { 'package.json': '{}', 'CONTRIBUTING.md': '# c\n' })
  const env = { ...process.env, HOME: dir, FE_KIT_PROFILES_DIR: await tempDir(t) }
  const bin = join(realKitRoot, 'bin/fe-kit.mjs')

  const json = await execFileAsync('node', [bin, 'rules', '--files', 'src/a.tsx', 'src/b.ts', '--json'], { cwd: dir, env })

  const data = JSON.parse(json.stdout)
  assert.deepEqual(data.files, ['src/a.tsx', 'src/b.ts'])
  assert.ok(data.rules.some((rule) => rule.relative === 'CONTRIBUTING.md'))
})

test('a standards folder that cannot be read is a warning, not "no rules apply"', { skip: !canTestPermissions }, async (t) => {
  const dir = await tempDir(t)
  await writeTree(dir, { 'package.json': '{}', 'docs/a.md': '# a\n', 'docs/locked/b.md': '# b\n' })
  await chmod(join(dir, 'docs/locked'), 0o000)
  const env = { FE_KIT_PROFILES_DIR: await tempDir(t), HOME: await tempDir(t) }
  await writeTree(env.FE_KIT_PROFILES_DIR, { 'p.md': profileWith('["docs/**/*.md"]')(dir) })

  let result
  try {
    result = await run({ args: [], flags: { files: ['a.ts'] }, cwd: dir, env, kitRoot: await tempDir(t) })
  } finally {
    await chmod(join(dir, 'docs/locked'), 0o755)
  }

  assert.deepEqual(result.data.warnings, ['docs/locked: could not be read, so documents in it are missing (EACCES)'])
})
