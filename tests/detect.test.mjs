import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'
import { deriveCommands, detectStack, scriptCommand } from '../src/lib/detect.mjs'
import { tempDir, writeTree } from './helpers.mjs'

const pkg = (value) => JSON.stringify(value)

test('detects a Vite + React + TypeScript + vitest project on npm (the sandbox shape)', async (t) => {
  const dir = await tempDir(t)
  await writeTree(dir, {
    'package.json': pkg({
      scripts: { dev: 'vite', build: 'tsc -b && vite build', lint: 'oxlint', test: 'vitest run' },
      dependencies: { react: '^19' },
      devDependencies: { vite: '^8', vitest: '^5', typescript: '~6' },
    }),
    'package-lock.json': '{}',
    'tsconfig.json': '{}',
  })

  const stack = await detectStack(dir)

  assert.equal(stack.packageManager, 'npm')
  assert.equal(stack.language, 'typescript')
  assert.equal(stack.uiLibrary, 'react')
  assert.equal(stack.framework, 'vite')
  assert.equal(stack.testRunner, 'vitest')
  assert.equal(stack.monorepo, null)
  assert.equal(stack.error, undefined)
})

test('detects Next + jest + pnpm in a turbo monorepo with its workspaces', async (t) => {
  const dir = await tempDir(t)
  await writeTree(dir, {
    'package.json': pkg({ dependencies: { next: '^15', react: '^19' }, devDependencies: { jest: '^30', turbo: '^2' } }),
    'pnpm-lock.yaml': '',
    'pnpm-workspace.yaml': 'packages:\n  - apps/*\n  - packages/*\n',
    'turbo.json': '{}',
  })

  const stack = await detectStack(dir)

  assert.equal(stack.packageManager, 'pnpm')
  assert.equal(stack.framework, 'next')
  assert.equal(stack.uiLibrary, 'react')
  assert.equal(stack.testRunner, 'jest')
  assert.deepEqual(stack.monorepo, { tools: ['pnpm-workspaces', 'turbo'], workspaces: ['apps/*', 'packages/*'] })
})

test('a sub-package inherits the lockfile and the monorepo from the project root', async (t) => {
  const root = await tempDir(t)
  await writeTree(root, {
    'package.json': pkg({ workspaces: ['packages/*'] }),
    'pnpm-lock.yaml': '',
    'packages/web/package.json': pkg({ dependencies: { vue: '^3' } }),
  })

  const stack = await detectStack(join(root, 'packages/web'), { projectRoot: root })

  assert.equal(stack.packageManager, 'pnpm')
  assert.equal(stack.uiLibrary, 'vue')
  assert.deepEqual(stack.monorepo, { tools: ['workspaces'], workspaces: ['packages/*'] })
})

test('the packageManager field beats a lockfile', async (t) => {
  const dir = await tempDir(t)
  await writeTree(dir, { 'package.json': pkg({ packageManager: 'yarn@4.1.0' }), 'package-lock.json': '{}' })

  assert.equal((await detectStack(dir)).packageManager, 'yarn')
})

test('detects Angular with its CLI', async (t) => {
  const dir = await tempDir(t)
  await writeTree(dir, {
    'package.json': pkg({ dependencies: { '@angular/core': '^19' }, devDependencies: { '@angular/cli': '^19', jest: '^29' } }),
    'yarn.lock': '',
  })

  const stack = await detectStack(dir)

  assert.equal(stack.uiLibrary, 'angular')
  assert.equal(stack.framework, 'angular-cli')
  assert.equal(stack.packageManager, 'yarn')
})

test('plain JavaScript with no dependencies yields neutral values', async (t) => {
  const dir = await tempDir(t)
  await writeTree(dir, { 'package.json': pkg({ name: 'plain' }) })

  assert.deepEqual(await detectStack(dir), {
    packageManager: null,
    language: 'javascript',
    uiLibrary: null,
    framework: null,
    testRunner: null,
    monorepo: null,
    scripts: {},
  })
})

test('a package.json that is not valid JSON is reported, not thrown', async (t) => {
  const dir = await tempDir(t)
  await writeTree(dir, { 'package.json': '{ "name": ' })

  const stack = await detectStack(dir)

  assert.match(stack.error, /not valid JSON/)
  assert.equal(stack.packageManager, null)
})

test('a missing package.json is reported', async (t) => {
  const dir = await tempDir(t)

  assert.match((await detectStack(dir)).error, /package\.json not found/)
})

test('scriptCommand builds the run command for each package manager', () => {
  assert.equal(scriptCommand('npm', 'lint'), 'npm run lint')
  assert.equal(scriptCommand('pnpm', 'lint'), 'pnpm run lint')
  assert.equal(scriptCommand('yarn', 'test'), 'yarn run test')
  assert.equal(scriptCommand('bun', 'build'), 'bun run build')
  assert.equal(scriptCommand(null, 'dev'), 'npm run dev')
})

test('deriveCommands only reports scripts that exist and never invents a typecheck', () => {
  const stack = { packageManager: 'pnpm', scripts: { dev: 'vite', start: 'x', build: 'b', lint: 'l', test: 't' } }

  assert.deepEqual(deriveCommands(stack), {
    dev: 'pnpm run dev',
    build: 'pnpm run build',
    lint: 'pnpm run lint',
    typecheck: null,
    test: 'pnpm run test',
  })
  assert.equal(deriveCommands({ packageManager: 'npm', scripts: { 'type-check': 'tsc --noEmit' } }).typecheck, 'npm run type-check')
  assert.equal(deriveCommands({ packageManager: 'npm', scripts: { start: 'node .' } }).dev, 'npm run start')
  assert.deepEqual(deriveCommands({ packageManager: 'npm', scripts: {} }), {
    dev: null,
    build: null,
    lint: null,
    typecheck: null,
    test: null,
  })
})

test('a packageManager field in the project root beats a lockfile for a sub-package that has none', async (t) => {
  const root = await tempDir(t)
  await writeTree(root, {
    'package.json': pkg({ packageManager: 'pnpm@9.1.0' }),
    'package-lock.json': '{}',
    'packages/web/package.json': pkg({}),
  })

  assert.equal((await detectStack(join(root, 'packages/web'), { projectRoot: root })).packageManager, 'pnpm')
})

test('a package.json that is valid JSON but not an object is reported, not thrown', async (t) => {
  for (const content of ['null', '[]', '"text"', '42']) {
    const dir = await tempDir(t)
    await writeTree(dir, { 'package.json': content })

    assert.match((await detectStack(dir)).error, /must contain a JSON object/, content)
  }
})

test('wrongly typed fields are ignored instead of crashing', async (t) => {
  const dir = await tempDir(t)
  await writeTree(dir, {
    'package.json': pkg({ scripts: 'bad', dependencies: [], devDependencies: 'x', workspaces: 'nope', packageManager: 42 }),
  })

  const stack = await detectStack(dir)

  assert.equal(stack.error, undefined)
  assert.deepEqual(stack.scripts, {})
  assert.equal(stack.monorepo, null)
  assert.deepEqual(deriveCommands(stack), { dev: null, build: null, lint: null, typecheck: null, test: null })
})

test('only string scripts count as commands', async (t) => {
  const dir = await tempDir(t)
  await writeTree(dir, { 'package.json': pkg({ scripts: { lint: 42, test: 'vitest run' } }) })

  const stack = await detectStack(dir)

  assert.deepEqual(stack.scripts, { test: 'vitest run' })
  assert.equal(deriveCommands(stack).lint, null)
})
