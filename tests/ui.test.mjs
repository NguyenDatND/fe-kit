import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { chmod, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { run } from '../src/commands/ui.mjs'
import { saveSession, sessionPath } from '../src/lib/auth-store.mjs'
import { loadPlaywright } from '../src/lib/browser.mjs'
import { UsageError } from '../src/lib/errors.mjs'
import { loginState, startApp } from './ui-fixture.mjs'
import { makeGitRepo, tempDir, writeTree } from './helpers.mjs'

const kitRoot = fileURLToPath(new URL('..', import.meta.url))
const bin = join(kitRoot, 'bin/fe-kit.mjs')
const execFileAsync = promisify(execFile)

let playwright = null
let browser = null
let skipReason = false
try {
  playwright = await loadPlaywright()
  browser = await playwright.chromium.launch()
} catch (error) {
  skipReason = `Chromium could not be started: ${error.message.split('\n')[0]}`
}
const app = await startApp()
after(async () => {
  await browser?.close()
  await app.close()
})

const profileFor = (origin) => `---
name: shop
match: { remotes: ["gitlab.local/fe/shop"] }
roles: [admin, staff]
targets:
  local:
    start: "pnpm dev"
    url: "${origin}"
    session: { loggedInMarker: "[data-user]", loginMarker: "form#login" }
  staging:
    url: "${origin}"
    session: { loggedInMarker: "[data-user]", loginMarker: "form#login" }
---
`

async function setup(t, { drafts = true } = {}) {
  const dir = await tempDir(t)
  await makeGitRepo(dir, { remote: 'git@gitlab.local:fe/shop.git' })
  await writeTree(dir, { 'package.json': '{}', ...(drafts ? { '.fe-kit/.gitignore': '*\n' } : {}) })
  const profilesDir = await tempDir(t)
  await writeTree(profilesDir, { 'shop.md': profileFor(app.origin) })
  const state = await tempDir(t)
  const env = { HOME: dir, FE_KIT_PROFILES_DIR: profilesDir, FE_KIT_STATE_DIR: state }
  return { dir, env, state }
}

const call = (dir, env, flags, deps = {}, args = []) =>
  run({ args, flags, cwd: dir, env, kitRoot, deps: { launchBrowser: () => playwright.chromium.launch(), settleMs: 400, ...deps } })
const fakeSteps = async (dir, steps) => {
  await writeFile(join(dir, 'steps.json'), JSON.stringify(steps))
  return 'steps.json'
}

describe('fe-kit ui from the command line', { skip: skipReason }, () => {
  test('a plain run writes pictures and a report under .fe-kit/ui and says where', async (t) => {
    const { dir, env } = await setup(t)
    app.reset()

    const { text, data, exitCode } = await call(dir, env, { target: 'local', path: '/plain', viewports: 'mobile,desktop' })

    assert.equal(exitCode, 0)
    const files = await readdir(join(dir, data.directory))
    assert.deepEqual(files.sort(), ['page.desktop.png', 'page.mobile.png', 'report.json', 'report.md'])
    assert.match(data.directory, /^\.fe-kit\/ui\/\d{4}-\d\d-\d\dT[\d-]+Z-local$/)
    assert.match(text, new RegExp(`${data.directory.replaceAll('.', '\\.')}/page\\.mobile\\.png`))
    assert.equal(JSON.parse(await readFile(join(dir, data.directory, 'report.json'), 'utf8')).target, 'local')
    assert.equal(data.readOnly, false)
  })

  test('with a role it uses the saved login, and the report holds no cookie or token value', async (t) => {
    const { dir, env, state } = await setup(t)
    const storageState = await loginState(browser, app, 'admin')
    await saveSession(sessionPath(state, { profile: 'shop', target: 'staging', role: 'admin' }), storageState)

    const { data, exitCode } = await call(dir, env, { target: 'staging', role: 'admin', path: '/', viewports: 'desktop' })

    assert.equal(exitCode, 0)
    assert.equal(data.session.state, 'authenticated')
    const everything = [await readFile(join(dir, data.directory, 'report.json'), 'utf8'), await readFile(join(dir, data.directory, 'report.md'), 'utf8'), JSON.stringify(data)].join('\n')
    for (const cookie of storageState.cookies) assert.ok(!everything.includes(cookie.value), cookie.name)
  })

  test('a target that is not started by the kit is read-only by default: a submit is refused and nothing is written', async (t) => {
    const { dir, env, state } = await setup(t)
    await saveSession(sessionPath(state, { profile: 'shop', target: 'staging', role: 'admin' }), await loginState(browser, app, 'admin'))
    const steps = await fakeSteps(dir, [
      { action: 'fill', selector: '#customer', value: 'Ada' },
      { action: 'click', selector: '#save' },
      { action: 'expectText', text: 'save refused', selector: '#result' },
      { action: 'expectValue', selector: '#customer', value: 'Ada' },
    ])
    app.reset()

    const { data, exitCode } = await call(dir, env, { target: 'staging', role: 'admin', path: '/orders', steps })

    assert.equal(exitCode, 0)
    assert.equal(data.readOnly, true)
    assert.deepEqual(app.writes(), [])
    assert.equal(data.guard.filter((event) => event.kind === 'blocked').length, 1)
  })

  test('the same steps on the local target (started by the kit) write for real', async (t) => {
    const { dir, env, state } = await setup(t)
    await saveSession(sessionPath(state, { profile: 'shop', target: 'local', role: 'admin' }), await loginState(browser, app, 'admin'))
    const steps = await fakeSteps(dir, [{ action: 'fill', selector: '#customer', value: 'Ada' }, { action: 'click', selector: '#save' }, { action: 'expectText', text: 'saved 201', selector: '#result' }])
    app.reset()

    const { exitCode } = await call(dir, env, { target: 'local', role: 'admin', path: '/orders', steps })

    assert.equal(exitCode, 0)
    assert.deepEqual(app.writes(), ['POST /api/orders'])
  })

  test('a saved login in a folder that others can enter is not used, and the run does not start', async (t) => {
    const { dir, env, state } = await setup(t)
    await saveSession(sessionPath(state, { profile: 'shop', target: 'staging', role: 'admin' }), await loginState(browser, app, 'admin'))
    await chmod(join(state, 'auth', 'shop'), 0o755)
    app.reset()

    await assert.rejects(call(dir, env, { target: 'staging', role: 'admin', path: '/' }), (error) => error instanceof UsageError && /chmod 700/.test(error.message))

    assert.deepEqual(app.requests, [])
    await chmod(join(state, 'auth', 'shop'), 0o700)
  })

  test('no saved login is exit 3 and says which command to run', async (t) => {
    const { dir, env } = await setup(t)

    const { text, exitCode } = await call(dir, env, { target: 'staging', role: 'staff', viewports: 'desktop' })

    assert.equal(exitCode, 3)
    assert.match(text, /fe-kit auth login --target staging --role staff/)
  })

  test('a failing step is exit 1, and the report says which', async (t) => {
    const { dir, env } = await setup(t)
    const steps = await fakeSteps(dir, [{ action: 'expectText', text: 'nothing like this', timeoutMs: 300 }])

    const { text, exitCode } = await call(dir, env, { target: 'local', path: '/plain', steps })

    assert.equal(exitCode, 1)
    assert.match(text, /step 1: expectText: timeout after 300 ms/)
  })

  test('two runs in the same moment get two folders', async (t) => {
    const { dir, env } = await setup(t)
    const now = () => new Date('2026-10-21T10:00:00.000Z')

    const first = await call(dir, env, { target: 'local', path: '/plain', viewports: 'desktop' }, { now })
    const second = await call(dir, env, { target: 'local', path: '/plain', viewports: 'desktop' }, { now })

    assert.notEqual(first.data.directory, second.data.directory)
    assert.deepEqual((await readdir(join(dir, '.fe-kit/ui'))).length, 2)
  })

  test('without .fe-kit set up it says to run fe-kit init, and writes nothing', async (t) => {
    const { dir, env } = await setup(t, { drafts: false })

    await assert.rejects(call(dir, env, { target: 'local', path: '/plain' }), (error) => error instanceof UsageError && /fe-kit init/.test(error.message))
    await assert.rejects(stat(join(dir, '.fe-kit')), { code: 'ENOENT' })
  })

  test('the query string of --path reaches the page', async (t) => {
    const { dir, env } = await setup(t)
    app.reset()

    await call(dir, env, { target: 'local', path: '/plain?tab=1', viewports: 'desktop' })

    assert.ok(app.requests.some((request) => request.url === '/plain?tab=1'))
  })

  test('.fe-kit/ui that is a file is refused, and nothing is run', async (t) => {
    const { dir, env } = await setup(t)
    await writeFile(join(dir, '.fe-kit/ui'), 'not a folder')
    app.reset()

    await assert.rejects(call(dir, env, { target: 'local', path: '/plain' }), (error) => error instanceof UsageError && /not a real folder/.test(error.message))
    assert.deepEqual(app.requests, [])
  })

  test('usage errors: an argument, a bad viewport, steps with several viewports, a missing steps file, a path off the target', async (t) => {
    const { dir, env } = await setup(t)
    const steps = await fakeSteps(dir, [{ action: 'press', key: 'Tab' }])

    await assert.rejects(call(dir, env, { target: 'local' }, {}, ['extra']), UsageError)
    await assert.rejects(call(dir, env, { target: 'local', viewports: 'phone' }), UsageError)
    await assert.rejects(call(dir, env, { target: 'local', steps, viewports: 'mobile,desktop' }), UsageError)
    await assert.rejects(call(dir, env, { target: 'local', steps: 'missing.json' }), UsageError)
    await assert.rejects(call(dir, env, { target: 'local', path: '//evil.example.com/x' }), UsageError)
  })

  test('the command line: exit 3 for a lost login, text by default and JSON with --json', async (t) => {
    const { dir, env } = await setup(t)
    const call2 = (...args) => execFileAsync('node', [bin, 'ui', ...args], { cwd: dir, env: { ...process.env, ...env } }).then((out) => ({ code: 0, ...out }), (error) => error)

    const lost = await call2('--target', 'staging', '--role', 'admin', '--viewports', 'desktop')
    const lostJson = await call2('--target', 'staging', '--role', 'admin', '--viewports', 'desktop', '--json')
    const wrong = await call2('--target', 'nowhere')

    assert.equal(lost.code, 3)
    assert.match(lost.stdout, /fe-kit auth login --target staging --role admin/)
    assert.equal(lostJson.code, 3)
    assert.equal(JSON.parse(lostJson.stdout).session.state, 'expired')
    assert.equal(wrong.code, 2)
    assert.match(wrong.stderr, /unknown target "nowhere"/)
  })
})
