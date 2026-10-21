import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { resolveProject } from '../src/lib/project.mjs'
import { makeGitRepo, tempDir, writeTree } from './helpers.mjs'

const kitRoot = fileURLToPath(new URL('..', import.meta.url))

const viteProject = {
  'package.json': JSON.stringify({
    scripts: { build: 'tsc -b && vite build', lint: 'oxlint', test: 'vitest run' },
    devDependencies: { vite: '^8', vitest: '^5', typescript: '~6' },
  }),
  'package-lock.json': '{}',
}
const shopProfile = (extra = '') => `---\nname: shop\nmatch: { remotes: ["gitlab.local/fe/shop"] }\n${extra}---\nprose\n`

async function resolve(t, files, { profiles = {}, remote, cwd = '' } = {}) {
  const dir = await tempDir(t)
  await writeTree(dir, files)
  await makeGitRepo(dir, { remote })
  const profilesDir = await tempDir(t)
  await writeTree(profilesDir, profiles)
  const project = await resolveProject({ cwd: join(dir, cwd), env: { FE_KIT_PROFILES_DIR: profilesDir, HOME: dir }, kitRoot })
  return { dir, project }
}

test('finds the roots, the stack and the derived commands when no profile matches', async (t) => {
  const { dir, project } = await resolve(t, viteProject)

  assert.equal(project.projectRoot, dir)
  assert.equal(project.packageRoot, dir)
  assert.equal(project.isGit, true)
  assert.equal(project.matched, null)
  assert.deepEqual(project.settings, {})
  assert.equal(project.stack.testRunner, 'vitest')
  assert.deepEqual(project.commands, { dev: null, build: 'npm run build', lint: 'npm run lint', typecheck: null, test: 'npm run test' })
  assert.deepEqual(project.warnings, [])
})

test('a matching profile overrides derived commands and exposes its settings', async (t) => {
  const profile = shopProfile('baseBranch: origin/develop\ncommands: { lint: "pnpm eslint {files}" }\n')
  const { project } = await resolve(t, viteProject, { profiles: { 'shop.md': profile }, remote: 'git@gitlab.local:fe/shop.git' })

  assert.equal(project.matched.data.name, 'shop')
  assert.equal(project.settings.baseBranch, 'origin/develop')
  assert.equal(project.commands.lint, 'pnpm eslint {files}')
  assert.equal(project.commands.test, 'npm run test')
})

test('a broken package.json and a broken profile become warnings, never exceptions', async (t) => {
  const { project } = await resolve(t, { 'package.json': '{not json' }, { profiles: { 'bad.md': '---\nname: [oops\n---\n' } })

  assert.match(project.warnings[0], /package\.json is not valid JSON/)
  assert.match(project.warnings[1], /^Profile bad\.md could not be read: invalid YAML/)
  assert.equal(project.matched, null)
})

test('the package root is the nearest package.json, the project root the git top-level', async (t) => {
  const { dir, project } = await resolve(t, { ...viteProject, 'apps/web/package.json': '{"scripts":{"lint":"x"}}' }, { cwd: 'apps/web' })

  assert.equal(project.projectRoot, dir)
  assert.equal(project.packageRoot, join(dir, 'apps/web'))
  assert.equal(project.commands.lint, 'npm run lint')
})

test('a command override that is not a string is ignored instead of reaching a shell', async (t) => {
  const profile = shopProfile('commands: { lint: 123, test: ["a"], typecheck: "tsc -b" }\n')
  const { project } = await resolve(t, viteProject, { profiles: { 'shop.md': profile }, remote: 'git@gitlab.local:fe/shop.git' })

  assert.equal(project.commands.lint, 'npm run lint')
  assert.equal(project.commands.test, 'npm run test')
  assert.equal(project.commands.typecheck, 'tsc -b')
  assert.ok(project.warnings.some((warning) => warning.includes('"commands.lint" must be a non-empty string')))
})
