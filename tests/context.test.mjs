import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { chmod, mkdir, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { run } from '../src/commands/context.mjs'
import { canTestPermissions, git, makeGitRepo, tempDir, writeTree } from './helpers.mjs'

const kitRoot = fileURLToPath(new URL('..', import.meta.url))
const bin = join(kitRoot, 'bin/fe-kit.mjs')
const execFileAsync = promisify(execFile)

const viteReactProject = {
  'package.json': JSON.stringify({
    scripts: { dev: 'vite', build: 'tsc -b && vite build', lint: 'oxlint', test: 'vitest run' },
    dependencies: { react: '^19' },
    devDependencies: { vite: '^8', vitest: '^5', typescript: '~6' },
  }),
  'package-lock.json': '{}',
  'tsconfig.json': '{}',
}

async function context(t, files, { cwd = '', env = {}, profiles = {}, git: gitOptions } = {}) {
  const dir = await tempDir(t)
  await writeTree(dir, files)
  if (gitOptions) await makeGitRepo(dir, gitOptions)
  const profilesDir = await tempDir(t)
  await writeTree(profilesDir, profiles)
  const { data, text } = await run({
    args: [],
    flags: {},
    cwd: join(dir, cwd),
    env: { FE_KIT_PROFILES_DIR: profilesDir, HOME: dir, ...env },
    kitRoot,
  })
  return { dir, data, text }
}

test('reports stack and commands straight from package.json, and never invents a typecheck', async (t) => {
  const { dir, data } = await context(t, { ...viteReactProject, 'CLAUDE.md': '# conventions' }, { git: {} })

  assert.equal(data.projectRoot, dir)
  assert.equal(data.packageRoot, dir)
  assert.equal(data.isGit, true)
  assert.equal(data.profile, null)
  assert.equal(data.stack.framework, 'vite')
  assert.deepEqual(data.commands, {
    dev: 'npm run dev',
    build: 'npm run build',
    lint: 'npm run lint',
    typecheck: null,
    test: 'npm run test',
  })
  assert.deepEqual(data.tests, { policy: 'auto', projectHasTestSetup: true })
  assert.deepEqual(data.drafts, { dir: join(dir, '.fe-kit'), initialized: false, ignored: false, trackedFiles: 0 })
  assert.deepEqual(data.conventions, { claudeMd: true, agentsMd: false })
  assert.deepEqual(data.warnings, [])
})

test('a matching profile overrides commands and test policy; env variables are reported, never expanded', async (t) => {
  const profile = [
    '---',
    'name: shop-web',
    'match: { remotes: [gitlab.example.com/fe/shop-web] }',
    'commands: { lint: "pnpm eslint --max-warnings=0 {files}" }',
    'tests: { policy: local-only }',
    'baseBranch: origin/develop',
    'roles: [admin, staff]',
    'standards: [CONTRIBUTING.md]',
    'targets:',
    '  local: { start: "pnpm dev", url: "http://localhost:5173" }',
    '  staging: { url: "${env:SHOP_STAGING_URL}", readOnly: true }',
    '---',
    '',
  ].join('\n')
  const options = { profiles: { 'shop.md': profile }, git: { remote: 'git@gitlab.example.com:fe/shop-web.git' } }

  const missing = await context(t, viteReactProject, options)
  const resolved = await context(t, viteReactProject, { ...options, env: { SHOP_STAGING_URL: 'https://staging.example.com' } })

  assert.equal(missing.data.profile.name, 'shop-web')
  assert.equal(missing.data.commands.lint, 'pnpm eslint --max-warnings=0 {files}')
  assert.equal(missing.data.commands.test, 'npm run test')
  assert.equal(missing.data.tests.policy, 'local-only')
  assert.deepEqual(missing.data.profile.roles, ['admin', 'staff'])
  assert.equal(missing.data.profile.baseBranch, 'origin/develop')
  assert.equal(missing.data.profile.targets.staging.url, '${env:SHOP_STAGING_URL}')
  assert.deepEqual(missing.data.warnings, ['Environment variable SHOP_STAGING_URL is not set (used by a profile target)'])
  assert.deepEqual(missing.data.profile.env, { SHOP_STAGING_URL: 'missing' })
  assert.equal(resolved.data.profile.targets.staging.url, '${env:SHOP_STAGING_URL}')
  assert.deepEqual(resolved.data.profile.env, { SHOP_STAGING_URL: 'set' })
  assert.deepEqual(resolved.data.warnings, [])
})

test('inside a monorepo package the drafts live at the repo root and the commands come from the package', async (t) => {
  const { dir, data } = await context(
    t,
    {
      'package.json': JSON.stringify({ workspaces: ['packages/*'] }),
      'pnpm-lock.yaml': '',
      'packages/web/package.json': JSON.stringify({ scripts: { dev: 'vite' }, dependencies: { vue: '^3' } }),
      'packages/web/src/index.ts': '',
    },
    { cwd: 'packages/web/src', git: {} },
  )

  assert.equal(data.projectRoot, dir)
  assert.equal(data.packageRoot, join(dir, 'packages/web'))
  assert.equal(data.drafts.dir, join(dir, '.fe-kit'))
  assert.equal(data.stack.packageManager, 'pnpm')
  assert.equal(data.stack.uiLibrary, 'vue')
  assert.equal(data.commands.dev, 'pnpm run dev')
  assert.deepEqual(data.stack.monorepo, { tools: ['workspaces'], workspaces: ['packages/*'] })
})

test('outside git the project root is the nearest package.json directory', async (t) => {
  const { dir, data } = await context(t, { 'app/package.json': '{}', 'app/src/x.ts': '' }, { cwd: 'app/src' })

  assert.equal(data.isGit, false)
  assert.equal(data.projectRoot, join(dir, 'app'))
})

test('a directory with no package.json is reported as a warning, not a crash', async (t) => {
  const { data } = await context(t, { 'notes.txt': '' })

  assert.deepEqual(data.warnings, ['package.json not found'])
  assert.deepEqual(data.commands, { dev: null, build: null, lint: null, typecheck: null, test: null })
})

test('a broken profile file becomes a warning and the rest still works', async (t) => {
  const { data } = await context(t, viteReactProject, { profiles: { 'broken.md': '---\nname: [unclosed\n---\n' } })

  assert.equal(data.profile, null)
  assert.match(data.warnings[0], /^Profile broken\.md could not be read: /)
})

test('init state is reported once .fe-kit exists', async (t) => {
  const { data } = await context(t, { ...viteReactProject, '.fe-kit/.gitignore': '*\n' })

  assert.equal(data.drafts.initialized, true)
})

test('the text form carries the facts an agent needs', async (t) => {
  const { dir, text } = await context(t, viteReactProject)

  assert.match(text, new RegExp(`Project root: ${dir}`))
  assert.match(text, /lint: npm run lint/)
  assert.match(text, /typecheck: \(none\)/)
  assert.match(text, /not initialized/)
})

async function runBin(args, cwd, env = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [bin, ...args], { cwd, env: { ...process.env, ...env } })
    return { code: 0, stdout, stderr }
  } catch (error) {
    return { code: error.code, stdout: error.stdout, stderr: error.stderr }
  }
}

test('bin: context --json prints parseable JSON', async (t) => {
  const dir = await tempDir(t)
  await writeTree(dir, viteReactProject)

  const { code, stdout } = await runBin(['context', '--json'], dir)

  assert.equal(code, 0)
  assert.equal(JSON.parse(stdout).stack.framework, 'vite')
})

test('bin: --version, --help, unknown and not-yet-implemented commands', async () => {
  const version = await runBin(['--version'], kitRoot)
  const help = await runBin(['--help'], kitRoot)
  const unknown = await runBin(['frobnicate'], kitRoot)
  const planned = await runBin(['mr'], kitRoot)

  assert.equal(version.code, 0)
  assert.match(version.stdout, /^\d+\.\d+\.\d+/)
  assert.equal(help.code, 0)
  assert.match(help.stdout, /context/)
  assert.equal(unknown.code, 2)
  assert.match(unknown.stderr, /unknown command: frobnicate/)
  assert.equal(planned.code, 2)
  assert.match(planned.stderr, /mr is not implemented yet/)
})

test('a profile with a wrongly typed match does not crash context and is reported', async (t) => {
  const broken = ['---', 'name: broken', 'match: { paths: ~/work/shop }', '---', ''].join('\n')
  const good = ['---', 'name: shop-web', 'match: { remotes: [gitlab.example.com/fe/shop-web] }', '---', ''].join('\n')

  const { data } = await context(t, viteReactProject, {
    profiles: { 'a-broken.md': broken, 'b-good.md': good },
    git: { remote: 'git@gitlab.example.com:fe/shop-web.git' },
  })

  assert.equal(data.profile.name, 'shop-web')
  assert.ok(data.warnings.some((w) => w.includes('a-broken.md') && w.includes('"match.paths" must be a list of strings')))
})

test('every profile is validated, not only the one that matches', async (t) => {
  const { data } = await context(t, viteReactProject, { profiles: { 'nomatch.md': '---\nname: nomatch\n---\n' } })

  assert.deepEqual(data.warnings, ['Profile nomatch.md: "match" needs at least one of "paths" or "remotes"'])
})

test('a profiles directory that is not a directory becomes a warning and context still works', async (t) => {
  const dir = await tempDir(t)
  await writeTree(dir, { ...viteReactProject, 'profiles-as-file': 'x' })

  const { data } = await run({
    args: [],
    flags: {},
    cwd: dir,
    env: { FE_KIT_PROFILES_DIR: join(dir, 'profiles-as-file'), HOME: dir },
    kitRoot,
  })

  assert.match(data.warnings[0], /^Profiles directory could not be read: /)
  assert.equal(data.commands.lint, 'npm run lint')
})

test('bin: an unexpected failure exits 70, with a JSON error under --json', async (t) => {
  const dir = await tempDir(t)
  await writeTree(dir, { 'not-a-dir': 'x' })
  const args = ['validate', '--skills-dir', join(dir, 'not-a-dir')]

  const human = await runBin(args, dir)
  const json = await runBin([...args, '--json'], dir)

  assert.equal(human.code, 70)
  assert.match(human.stderr, /ENOTDIR|not a directory/i)
  assert.equal(json.code, 70)
  assert.match(JSON.parse(json.stdout).error, /ENOTDIR|not a directory/i)
})

test('context never prints the value of an environment variable', async (t) => {
  const profile = [
    '---',
    'name: shop-web',
    'match: { remotes: [gitlab.example.com/fe/shop-web] }',
    'targets:',
    '  staging: { url: "https://admin:${env:STAGING_PASSWORD}@staging.example.com" }',
    '---',
    '',
  ].join('\n')

  const { data, text } = await context(t, viteReactProject, {
    profiles: { 'shop.md': profile },
    git: { remote: 'git@gitlab.example.com:fe/shop-web.git' },
    env: { STAGING_PASSWORD: 's3cret-value' },
  })

  assert.equal(data.profile.targets.staging.url, 'https://[REDACTED]@staging.example.com')
  assert.deepEqual(data.profile.env, { STAGING_PASSWORD: 'set' })
  assert.doesNotMatch(JSON.stringify(data) + text, /s3cret-value/)
})

test('a YAML error in a profile does not echo the source text into the warnings', async (t) => {
  const broken = '---\nname: shop-web\nmatch: { remotes: [https://oauth2:glpat-SECRET@gitlab.example.com/fe/shop-web }\n---\n'

  const { data } = await context(t, viteReactProject, { profiles: { 'shop.md': broken } })

  assert.match(data.warnings[0], /^Profile shop\.md could not be read: /)
  assert.doesNotMatch(data.warnings.join('\n'), /glpat-SECRET/)
})

test('a profile with a cyclic YAML alias is reported and the rest of context still works', async (t) => {
  const cyclic = '---\nname: loop\nmatch: { paths: [/nowhere] }\ntargets: &cycle { self: *cycle }\n---\n'

  const { data } = await context(t, viteReactProject, { profiles: { 'loop.md': cyclic } })

  assert.match(data.warnings[0], /^Profile loop\.md could not be read: .*cyclic/)
  assert.equal(data.commands.lint, 'npm run lint')
})

test('a .fe-kit/.gitignore without a catch-all line is reported', async (t) => {
  const { data } = await context(t, { ...viteReactProject, '.fe-kit/.gitignore': 'something-else\n' }, { git: {} })

  assert.equal(data.drafts.initialized, true)
  assert.equal(data.drafts.ignored, false)
  assert.ok(data.warnings.some((warning) => /no catch-all/.test(warning)))
})

test('a .fe-kit/.gitignore with a catch-all line counts as ignoring the drafts and raises no warning', async (t) => {
  const { data } = await context(t, { ...viteReactProject, '.fe-kit/.gitignore': '# mine\n*\n' }, { git: {} })

  assert.equal(data.drafts.ignored, true)
  assert.deepEqual(data.warnings, [])
})

test('drafts that git already tracks are reported, because ignoring does not apply to them', async (t) => {
  const { dir, data: before } = await context(t, { ...viteReactProject, '.fe-kit/.gitignore': '*\n', '.fe-kit/leaked.md': 'x' }, { git: {} })
  assert.equal(before.drafts.trackedFiles, 0)
  await git(dir, 'add', '-f', '.fe-kit/leaked.md')

  const { data } = await run({ args: [], flags: {}, cwd: dir, env: { FE_KIT_PROFILES_DIR: join(dir, 'none'), HOME: dir }, kitRoot })

  assert.equal(data.drafts.trackedFiles, 1)
  assert.ok(data.warnings.some((warning) => /1 file\(s\) under \.fe-kit are tracked by git/.test(warning)))
})

test('the userinfo of a profile URL is never printed, and a literal password in it is flagged without being echoed', async (t) => {
  const profile = [
    '---',
    'name: shop-web',
    'match: { remotes: [gitlab.example.com/fe/shop-web] }',
    'targets:',
    '  staging: { url: "https://admin:hunter2@staging.example.com" }',
    '  odd: { url: "https://admin:p@ss@staging.example.com/app" }',
    '  git: { url: "ssh://git@staging.example.com/repo.git" }',
    '  reference: { url: "https://admin:${env:STAGING_PASSWORD}@staging.example.com" }',
    '---',
    '',
  ].join('\n')

  const { data, text } = await context(t, viteReactProject, {
    profiles: { 'shop.md': profile },
    git: { remote: 'git@gitlab.example.com:fe/shop-web.git' },
    env: { STAGING_PASSWORD: 'set-but-secret' },
  })

  const { targets } = data.profile
  assert.equal(targets.staging.url, 'https://[REDACTED]@staging.example.com')
  assert.equal(targets.odd.url, 'https://[REDACTED]@staging.example.com/app')
  assert.equal(targets.git.url, 'ssh://[REDACTED]@staging.example.com/repo.git')
  assert.equal(targets.reference.url, 'https://[REDACTED]@staging.example.com')
  assert.deepEqual(data.profile.env, { STAGING_PASSWORD: 'set' }) // hidden in the URL, still reported by name
  assert.doesNotMatch(JSON.stringify(data) + text, /hunter2|p@ss|set-but-secret/)
  assert.deepEqual(data.warnings, [
    'Profile shop.md: "targets.staging.url" has a literal password in a URL; use ${env:NAME} instead',
    'Profile shop.md: "targets.odd.url" has a literal password in a URL; use ${env:NAME} instead',
  ])
})

test('bin: no kind of YAML error prints the profile source, on stdout or on stderr', async (t) => {
  const dir = await tempDir(t)
  const profilesDir = await tempDir(t)
  await writeTree(dir, viteReactProject)
  await writeTree(profilesDir, {
    'a-header.md': '---\nname: a\ntargets: |glpat-SECRET\n---\n',
    'b-alias.md': '---\nname: b\npassword: *glpat-SECRET\n---\n',
    'c-tag.md': '---\nname: c\npassword: !!glpat-SECRET value\n---\n',
    'd-flow.md': '---\nname: d\nmatch: { remotes: [https://oauth2:glpat-SECRET@gitlab.example.com/fe/d }\n---\n',
  })

  const { code, stdout, stderr } = await runBin(['context', '--json'], dir, { FE_KIT_PROFILES_DIR: profilesDir })

  assert.equal(code, 0)
  assert.doesNotMatch(stdout + stderr, /glpat-SECRET/)
  const { warnings } = JSON.parse(stdout)
  assert.match(warnings.find((warning) => warning.includes('a-header.md')), /could not be read: invalid YAML \(UNEXPECTED_TOKEN\) at line 2, column \d+ of the frontmatter$/)
  assert.match(warnings.find((warning) => warning.includes('b-alias.md')), /could not be read: invalid YAML \(alias error\)$/)
  assert.equal(stderr, '')
})

test('a .fe-kit/.gitignore that is a symlink does not count as ignoring the drafts, because git does not read it', async (t) => {
  const dir = await tempDir(t)
  await writeTree(dir, { ...viteReactProject, 'ignore-all.txt': '*\n' })
  await makeGitRepo(dir)
  await mkdir(join(dir, '.fe-kit'))
  await symlink(join(dir, 'ignore-all.txt'), join(dir, '.fe-kit/.gitignore'))

  const { data } = await run({ args: [], flags: {}, cwd: dir, env: { FE_KIT_PROFILES_DIR: join(dir, 'none'), HOME: dir }, kitRoot })

  assert.equal(data.drafts.ignored, false)
  assert.ok(data.warnings.some((warning) => /no catch-all/.test(warning)))
})

test('bin: a value that a validation message could echo cannot carry a credential out, matched profile or not', async (t) => {
  const dir = await tempDir(t)
  const profilesDir = await tempDir(t)
  await writeTree(dir, viteReactProject)
  await writeTree(profilesDir, {
    'never-matches.md': '---\nname: x\nmatch: { paths: [/nowhere] }\ntests: { policy: "https://u:FAKE_SECRET@h" }\n---\n',
  })

  const { code, stdout, stderr } = await runBin(['context', '--json'], dir, { FE_KIT_PROFILES_DIR: profilesDir })

  assert.equal(code, 0)
  assert.doesNotMatch(stdout + stderr, /FAKE_SECRET/)
  assert.ok(JSON.parse(stdout).warnings.some((warning) => warning.endsWith('"tests.policy" must be auto, commit or local-only')))
})

test('everything context prints is masked, package.json scripts included', async (t) => {
  const files = {
    ...viteReactProject,
    'package.json': JSON.stringify({ scripts: { deploy: 'curl https://deploy:hunter2@host.example.com/api', test: 'vitest run' } }),
  }

  const { data, text } = await context(t, files)

  assert.equal(data.stack.scripts.deploy, 'curl https://[REDACTED]@host.example.com/api')
  assert.doesNotMatch(JSON.stringify(data) + text, /hunter2/)
})

test('a credential in a profile map key is masked in the output and in the warnings', async (t) => {
  const profile = [
    '---',
    'name: shop-web',
    'match: { remotes: [gitlab.example.com/fe/shop-web] }',
    'targets:',
    '  "https://admin:FAKE_SECRET@staging.example.com": { url: "https://admin:OTHER_SECRET@staging.example.com" }',
    '---',
    '',
  ].join('\n')

  const { data, text } = await context(t, viteReactProject, {
    profiles: { 'shop.md': profile },
    git: { remote: 'git@gitlab.example.com:fe/shop-web.git' },
  })

  assert.deepEqual(Object.keys(data.profile.targets), ['https://[REDACTED]@staging.example.com'])
  assert.doesNotMatch(JSON.stringify(data) + text, /FAKE_SECRET|OTHER_SECRET/)
  assert.ok(data.warnings.some((warning) => warning.includes('"targets.https://[REDACTED]@staging.example.com"')))
})

test('a broken git index is reported instead of a silent zero tracked files', async (t) => {
  const dir = await tempDir(t)
  await writeTree(dir, { ...viteReactProject, '.fe-kit/.gitignore': '*\n' })
  await makeGitRepo(dir)
  await writeFile(join(dir, '.git/index'), 'garbage')

  const { data } = await run({ args: [], flags: {}, cwd: dir, env: { FE_KIT_PROFILES_DIR: join(dir, 'none'), HOME: dir }, kitRoot })

  assert.equal(data.isGit, true)
  assert.equal(data.drafts.trackedFiles, null)
  assert.ok(data.warnings.some((warning) => /could not tell whether git tracks files under \.fe-kit/.test(warning)))
})

test('a malformed ${env:...} placeholder in a URL does not stop its password from being masked', async (t) => {
  const profile = [
    '---',
    'name: shop-web',
    'match: { remotes: [gitlab.example.com/fe/shop-web] }',
    'targets:',
    '  staging: { url: "https://u${env:}:FAKE_SECRET@staging.example.com" }',
    '---',
    '',
  ].join('\n')

  const { data, text } = await context(t, viteReactProject, {
    profiles: { 'shop.md': profile },
    git: { remote: 'git@gitlab.example.com:fe/shop-web.git' },
  })

  assert.equal(data.profile.targets.staging.url, 'https://[REDACTED]@staging.example.com')
  assert.doesNotMatch(JSON.stringify(data) + text, /FAKE_SECRET/)
  assert.ok(data.warnings.includes('Profile shop.md: "targets.staging.url" has a literal password in a URL; use ${env:NAME} instead'))
})

test('a .fe-kit/.gitignore that cannot be read does not stop context; the drafts just count as not ignored', { skip: !canTestPermissions }, async (t) => {
  const dir = await tempDir(t)
  await writeTree(dir, { ...viteReactProject, '.fe-kit/.gitignore': '*\n' })
  await makeGitRepo(dir)
  const file = join(dir, '.fe-kit/.gitignore')
  await chmod(file, 0o200)

  try {
    const { data } = await run({ args: [], flags: {}, cwd: dir, env: { FE_KIT_PROFILES_DIR: join(dir, 'none'), HOME: dir }, kitRoot })

    assert.equal(data.drafts.initialized, true)
    assert.equal(data.drafts.ignored, false)
  } finally {
    await chmod(file, 0o644)
  }
})

test('context says where profiles are kept and what the git remotes are, with any password in a remote hidden', async (t) => {
  const { data, text } = await context(t, viteReactProject, { git: { remote: 'https://user:s3cret@gitlab.local/fe/shop.git' } })
  assert.equal(typeof data.profilesDir, 'string')
  assert.ok(data.profilesDir.length > 0)
  assert.deepEqual(data.remotes.length, 1)
  assert.ok(!JSON.stringify(data).includes('s3cret'))
  assert.ok(!text.includes('s3cret'))
  assert.match(text, /Profiles folder: /)
  assert.match(text, /Remotes: .*gitlab\.local\/fe\/shop/)
  const outside = await context(t, viteReactProject)
  assert.deepEqual(outside.data.remotes, [])
})
