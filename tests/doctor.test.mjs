import assert from 'node:assert/strict'
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { run as doctor } from '../src/commands/doctor.mjs'
import { run as link } from '../src/commands/link.mjs'
import { saveSession } from '../src/lib/auth-store.mjs'
import { canTestPermissions, commitAll, git, makeGitRepo, tempDir, writeTree } from './helpers.mjs'

const kitRoot = fileURLToPath(new URL('..', import.meta.url))
const NO_VERSIONS = async () => ({})

async function setup(t, { linked = true, linkNode = process.execPath } = {}) {
  const home = await tempDir(t)
  const state = await tempDir(t)
  const profiles = await tempDir(t)
  for (const folder of ['.claude', '.codex', '.gemini']) await mkdir(join(home, folder), { recursive: true })
  const env = { HOME: home, FE_KIT_STATE_DIR: state, FE_KIT_PROFILES_DIR: profiles, PATH: '/usr/bin' }
  if (linked) await link({ args: [], flags: { yes: true }, cwd: home, env, kitRoot, deps: { node: linkNode } })
  const check = (extra = {}, cwd = home, flags = {}) => doctor({ args: [], flags, cwd, env, kitRoot, deps: { versions: NO_VERSIONS, ...extra } })
  return { home, state, profiles, env, check }
}

const byId = (result, id) => result.data.checks.find((entry) => entry.id === id)

test('a machine where everything is linked and the guard answers is healthy', async (t) => {
  const { check, home } = await setup(t)
  const result = await check()
  assert.equal(result.exitCode, 0, result.text)
  assert.equal(byId(result, 'node').status, 'ok')
  assert.equal(byId(result, 'playwright').status, 'ok')
  assert.ok(['ok', 'pending'].includes(byId(result, 'chromium').status))
  for (const tool of ['claude', 'codex', 'antigravity']) {
    assert.equal(byId(result, `tool:${tool}`).status, 'ok', tool)
    assert.equal(byId(result, `hook:${tool}`).status, 'ok', `${tool}: ${byId(result, `hook:${tool}`).message}`)
    assert.equal(byId(result, `secrets:${tool}`).status, 'ok')
  }
  assert.ok(!result.text.includes(home), 'paths are shown with ~')
  assert.match(result.text, /Codex: open \/hooks in Codex and approve the fe-kit hook/)
})

test('what is not decided or not checked by hand is listed as pending, not as a failure', async (t) => {
  const { check } = await setup(t)
  const result = await check()
  for (const id of ['pending:rules', 'pending:superpowers', 'pending:gui']) assert.equal(byId(result, id).status, 'pending', id)
  assert.match(byId(result, 'pending:rules').message, /personal-core/)
  assert.equal(result.exitCode, 0)
})

test('a machine where nothing was linked is pending for each tool, with the command to run', async (t) => {
  const { check } = await setup(t, { linked: false })
  const result = await check()
  for (const tool of ['claude', 'codex', 'antigravity']) {
    assert.equal(byId(result, `tool:${tool}`).status, 'pending')
    assert.match(byId(result, `tool:${tool}`).message, /fe-kit link/)
    assert.equal(byId(result, `hook:${tool}`), undefined)
  }
  assert.equal(result.exitCode, 0)
})

test('a tool that has lost a part of what was linked is a problem that says what would put it back', async (t) => {
  const { check, home } = await setup(t)
  await rm(join(home, '.codex/rules/fe-kit.rules'))
  await rm(join(home, '.claude/skills/fe-verify'))
  const result = await check()
  assert.equal(result.exitCode, 1)
  assert.equal(byId(result, 'tool:codex').status, 'problem')
  assert.match(byId(result, 'tool:codex').message, /fe-kit link --yes/)
  assert.equal(byId(result, 'tool:claude').status, 'problem')
  assert.equal(byId(result, 'tool:antigravity').status, 'ok')
})

test('a file the guard is in that cannot be read any more is a problem', async (t) => {
  const { check, home } = await setup(t)
  await writeFile(join(home, '.claude/settings.json'), '{ nope')
  const result = await check()
  assert.equal(byId(result, 'tool:claude').status, 'problem')
  assert.match(byId(result, 'tool:claude').message, /not valid JSON/)
})

test('the hook is run the way the tools run it, and a hook that cannot start or answers wrongly is a problem', async (t) => {
  const { check } = await setup(t, { linkNode: '/opt/node/bin/node' })
  const missing = await check()
  for (const tool of ['claude', 'codex', 'antigravity']) {
    assert.equal(byId(missing, `hook:${tool}`).status, 'problem')
    assert.match(byId(missing, `hook:${tool}`).message, /could not be started/)
  }
  const { check: healthy } = await setup(t)
  const wrong = await healthy({ runHook: async () => ({ exitCode: 1, stdout: '', stderr: 'boom' }) })
  assert.equal(byId(wrong, 'hook:claude').status, 'problem')
  assert.match(byId(wrong, 'hook:claude').message, /did not answer as expected/)
  const silentDeny = await healthy({ runHook: async () => ({ exitCode: 0, stdout: '', stderr: '' }) })
  assert.equal(byId(silentDeny, 'hook:claude').status, 'problem') // a hook that lets the read of the secrets through
})

test('saved logins: those that are fine, close to ending, over, unsafe or not logins at all', async (t) => {
  const { check, state } = await setup(t)
  const day = 86_400
  const cookies = (expires) => ({ cookies: [{ name: 'a', value: 'secret-value', domain: 'x', path: '/', expires }], origins: [] })
  const now = Math.floor(Date.now() / 1000)
  await saveSession(join(state, 'auth/shop/local.admin.json'), cookies(now + 30 * day))
  await saveSession(join(state, 'auth/shop/local.staff.json'), cookies(now + day / 2))
  await saveSession(join(state, 'auth/shop/staging.admin.json'), cookies(now - day))
  await saveSession(join(state, 'auth/shop/local.guest.json'), { cookies: [], origins: [] })
  await writeFile(join(state, 'auth/shop/local.bad.json'), 'not a login', { mode: 0o600 })
  const result = await check()
  assert.equal(byId(result, 'session:shop/local.admin').status, 'ok')
  assert.equal(byId(result, 'session:shop/local.staff').status, 'warn')
  assert.equal(byId(result, 'session:shop/staging.admin').status, 'warn')
  assert.match(byId(result, 'session:shop/staging.admin').message, /fe-kit auth login --target staging --role admin/)
  assert.equal(byId(result, 'session:shop/local.bad').status, 'problem')
  assert.ok(!result.text.includes('secret-value'))
  assert.equal(result.exitCode, 1)
  if (canTestPermissions) {
    await chmod(join(state, 'auth/shop/local.admin.json'), 0o644)
    assert.equal(byId(await check(), 'session:shop/local.admin').status, 'problem')
  }
})

test('inside a project: the profile that matches, and whether the drafts folder is ready', async (t) => {
  const { check, profiles, home } = await setup(t)
  const project = join(home, 'shop')
  await mkdir(project)
  await makeGitRepo(project, { remote: 'git@gitlab.local:fe/shop.git' })
  await writeTree(project, { 'package.json': '{}' })
  await commitAll(project, 'base')
  await writeTree(profiles, { 'shop.md': '---\nname: shop\nmatch: { remotes: ["gitlab.local/fe/shop"] }\n---\n' })
  const noDrafts = await check({}, project)
  assert.equal(byId(noDrafts, 'project').status, 'ok')
  assert.match(byId(noDrafts, 'project').message, /profile shop/)
  assert.equal(byId(noDrafts, 'drafts').status, 'pending')
  assert.match(byId(noDrafts, 'drafts').message, /fe-kit init/)
  await mkdir(join(project, '.fe-kit'))
  await writeFile(join(project, '.fe-kit/.gitignore'), '*\n')
  assert.equal(byId(await check({}, project), 'drafts').status, 'ok')
  await git(project, 'remote', 'set-url', 'origin', 'git@gitlab.local:other/thing.git')
  assert.equal(byId(await check({}, project), 'project').status, 'info')
  assert.match(byId(await check({}, project), 'project').message, /no profile matches/)
  assert.equal(byId(await check({}, home), 'project').status, 'info')
})

test('the versions of the tools are reported, and one that is not there is not a failure', async (t) => {
  const { check } = await setup(t)
  const result = await check({ versions: async () => ({ claude: 'Claude Code 2.1.302', codex: null, antigravity: 'agy 1.4.0' }) })
  assert.match(byId(result, 'version:claude').message, /2\.1\.302/)
  assert.match(byId(result, 'version:codex').message, /not found/)
  assert.equal(byId(result, 'version:codex').status, 'info')
  assert.equal(result.exitCode, 0)
})

test('a token in a file the guard is in is named by its kind and place, never shown', async (t) => {
  const { check, home } = await setup(t)
  const token = `ghp_${'a1B2c3D4e5'.repeat(4).slice(0, 36)}`
  const settings = join(home, '.claude/settings.json')
  const config = JSON.parse(await readFile(settings, 'utf8'))
  config.env = { GITHUB_TOKEN: token, other: 'Bearer abcdefghijklmnopqrstuvwxyz0123456789' }
  await writeFile(settings, `${JSON.stringify(config, null, 2)}\n`)
  const result = await check()
  assert.equal(byId(result, 'secrets:claude').status, 'problem')
  assert.match(byId(result, 'secrets:claude').message, /GitHub token/)
  assert.match(byId(result, 'secrets:claude').message, /Bearer token/)
  assert.ok(!result.text.includes(token))
  assert.ok(!JSON.stringify(result.data).includes(token))
  assert.equal(result.exitCode, 1)
})

test('the data for --json holds every check, with an id, a status and a message', async (t) => {
  const { check } = await setup(t)
  const { data } = await check()
  assert.ok(data.checks.length >= 15)
  for (const entry of data.checks) assert.deepEqual(Object.keys(entry).sort(), ['id', 'message', 'status'])
  assert.deepEqual([...new Set(data.checks.map((entry) => entry.status))].sort().filter((status) => !['ok', 'info', 'pending', 'warn', 'problem'].includes(status)), [])
})

const DENY = { claude: { hookSpecificOutput: { permissionDecision: 'deny' } }, codex: { hookSpecificOutput: { permissionDecision: 'deny' } }, antigravity: { decision: 'deny' } }
const commandOf = (input) => input.tool_input?.command ?? input.toolCall?.args?.CommandLine

test('the node of the machine and the playwright of the kit are judged', async (t) => {
  const { check } = await setup(t)
  const old = await check({ nodeVersion: '18.19.0' })
  assert.equal(byId(old, 'node').status, 'problem')
  assert.match(byId(old, 'node').message, /too old/)
  const missing = await check({ importPlaywright: async () => { throw Object.assign(new Error("Cannot find package 'playwright' imported from x"), { code: 'ERR_MODULE_NOT_FOUND' }) } })
  assert.equal(byId(missing, 'playwright').status, 'problem')
  assert.match(byId(missing, 'playwright').message, /npm install/)
  for (const executablePath of [() => '/nonexistent/chromium', () => { throw new Error('no browser') }]) {
    const pending = await check({ importPlaywright: async () => ({ chromium: { executablePath } }) })
    assert.equal(byId(pending, 'chromium').status, 'pending')
    assert.match(byId(pending, 'chromium').message, /npx playwright install chromium/)
  }
})

test('a record of the install that cannot be read is one problem and the rest is still checked', async (t) => {
  const { check, state } = await setup(t)
  await writeFile(join(state, 'install.json'), 'garbage')
  const result = await check()
  assert.equal(byId(result, 'install').status, 'problem')
  assert.match(byId(result, 'install').message, /install\.json cannot be read/)
  assert.equal(byId(result, 'node').status, 'ok')
  assert.equal(result.exitCode, 1)
})

test('a tool whose folder is not on the machine is not asked to be linked', async (t) => {
  const { check, home } = await setup(t, { linked: false })
  await rm(join(home, '.gemini'), { recursive: true })
  const result = await check()
  assert.equal(byId(result, 'tool:antigravity').status, 'info')
  assert.match(byId(result, 'tool:antigravity').message, /not on this machine/)
  assert.equal(byId(result, 'tool:claude').status, 'pending')
})

test('skills that were linked as copies are checked as copies', async (t) => {
  const home = await tempDir(t)
  const state = await tempDir(t)
  for (const folder of ['.claude', '.codex', '.gemini']) await mkdir(join(home, folder), { recursive: true })
  const env = { HOME: home, FE_KIT_STATE_DIR: state, FE_KIT_PROFILES_DIR: await tempDir(t), PATH: '/usr/bin' }
  await link({ args: [], flags: { yes: true, copy: true }, cwd: home, env, kitRoot, deps: { node: process.execPath } })
  const result = await doctor({ args: [], flags: {}, cwd: home, env, kitRoot, deps: { versions: NO_VERSIONS } })
  assert.equal(byId(result, 'tool:claude').status, 'ok', result.text)
})

test('the hook is not run for a tool that has lost part of what was linked', async (t) => {
  const { check, home } = await setup(t)
  await rm(join(home, '.codex/rules/fe-kit.rules'))
  const result = await check()
  assert.equal(byId(result, 'hook:codex'), undefined)
  assert.equal(byId(result, 'secrets:codex'), undefined)
  assert.ok(byId(result, 'hook:claude'))
})

test('each half of the hook\'s answer is checked, and each tool is sent the call it sends', async (t) => {
  const { check } = await setup(t)
  const answers = (allowed, refused) => async ({ input }) => (commandOf(input).includes('fe-kit-doctor') ? allowed : refused)
  const ok = { exitCode: 0, stdout: '', stderr: '' }
  for (const tool of ['claude', 'codex', 'antigravity']) {
    const deny = { exitCode: 0, stdout: JSON.stringify(DENY[tool]), stderr: '' }
    assert.equal(byId(await check({ runHook: answers(ok, deny) }), `hook:${tool}`).status, 'ok', tool)
    assert.equal(byId(await check({ runHook: answers({ ...ok, exitCode: 2 }, deny) }), `hook:${tool}`).status, 'problem', 'a plain command that is stopped')
    assert.equal(byId(await check({ runHook: answers({ ...ok, stdout: '{"x":1}' }, deny) }), `hook:${tool}`).status, 'problem', 'a plain command that is answered')
    assert.equal(byId(await check({ runHook: answers(ok, { ...deny, exitCode: 2 }) }), `hook:${tool}`).status, 'problem', 'a refusal that is also an error exit')
    assert.equal(byId(await check({ runHook: answers(ok, { ...deny, stdout: JSON.stringify({ hookSpecificOutput: { permissionDecision: 'ask' }, decision: 'force_ask' }) }) }), `hook:${tool}`).status, 'problem', 'asking is not refusing')
  }
  const seen = {}
  await check({ runHook: async ({ input }) => { seen[input.turn_id !== undefined ? 'codex' : input.toolCall ? 'antigravity' : 'claude'] = input; return { exitCode: 0, stdout: '', stderr: '' } } })
  assert.equal(seen.codex.turn_id, 'doctor')
  assert.equal(seen.claude.tool_name, 'Bash')
  assert.equal(seen.antigravity.toolCall.name, 'run_command')
})

test('a secret in a JSON member is found, and the paths in the answers are shown with ~', async (t) => {
  const { check, home } = await setup(t)
  const settings = join(home, '.claude/settings.json')
  const config = JSON.parse(await readFile(settings, 'utf8'))
  config.mcp = { password: 'hunter2hunter2' }
  await writeFile(settings, `${JSON.stringify(config, null, 2)}\n`)
  const result = await check()
  assert.match(byId(result, 'secrets:claude').message, /secret in a JSON member/)
  assert.match(byId(result, 'secrets:claude').message, /~\/\.claude\/settings\.json/)
  assert.ok(!result.text.includes(home))
  assert.ok(!result.text.includes('hunter2'))
})

test('a login that has ended and one that is about to end are told apart', async (t) => {
  const { check, state } = await setup(t)
  const now = Math.floor(Date.now() / 1000)
  const cookie = (expires) => ({ cookies: [{ name: 'a', value: 'v', domain: 'x', path: '/', expires }], origins: [] })
  await saveSession(join(state, 'auth/shop/local.over.json'), cookie(now - 86_400))
  await saveSession(join(state, 'auth/shop/local.soon.json'), cookie(now + 3600))
  const result = await check()
  assert.match(byId(result, 'session:shop/local.over').message, /ended on/)
  assert.match(byId(result, 'session:shop/local.soon').message, /ends on/)
  const later = await check({ now: () => Date.now() + 10 * 86_400_000 })
  assert.match(byId(later, 'session:shop/local.soon').message, /ended on/)
})

test('outside a git project there is no profile to look for and no drafts folder to check', async (t) => {
  const { check, home } = await setup(t)
  const result = await check({}, home)
  assert.match(byId(result, 'project').message, /not inside a git project/)
  assert.equal(byId(result, 'drafts'), undefined)
})

test('a profile that cannot be read is a warning', async (t) => {
  const { check, profiles } = await setup(t)
  await writeFile(join(profiles, 'bad.md'), '---\nname: [unclosed\n---\n')
  const result = await check()
  assert.equal(byId(result, 'profile-warning:0').status, 'warn')
  assert.match(byId(result, 'profile-warning:0').message, /bad\.md/)
})

test('a record that cannot be opened for lack of permission is a problem, not a crash', { skip: !canTestPermissions }, async (t) => {
  const { check, state } = await setup(t)
  await chmod(join(state, 'install.json'), 0o000)
  const result = await check()
  await chmod(join(state, 'install.json'), 0o600)
  assert.equal(byId(result, 'install').status, 'problem')
  assert.match(byId(result, 'install').message, /EACCES/)
})
